#!/usr/bin/env python3
"""
Backfill "Warm Lead" into call_logs.call_outcome for any record where
warm_lead === true and the outcome array does not yet contain it.

This brings historical rows into line with the warm_lead_outcome_sync.pb.js
hook, which only enforces the invariant on writes going forward.

Usage:
    python backfill_warm_lead_outcome.py --dry-run
    python backfill_warm_lead_outcome.py
    python backfill_warm_lead_outcome.py --yes

Environment (loaded from tools/database/.env):
    POCKETBASE_URL       (default: http://crmdb.tableturnerr.com)
    PB_ADMIN_EMAIL       superuser email
    PB_ADMIN_PASSWORD    superuser password
"""

import argparse
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)
from rich.prompt import Confirm
from rich.rule import Rule
from rich.table import Table

load_dotenv(Path(__file__).parent.parent / '.env')

POCKETBASE_URL = os.getenv('POCKETBASE_URL', 'http://crmdb.tableturnerr.com').rstrip('/')
PB_ADMIN_EMAIL = os.getenv('PB_ADMIN_EMAIL', '')
PB_ADMIN_PASSWORD = os.getenv('PB_ADMIN_PASSWORD', '')

WARM_LEAD = 'Warm Lead'

console = Console()


def progress_bar() -> Progress:
    return Progress(
        SpinnerColumn(),
        TextColumn('[progress.description]{task.description}'),
        BarColumn(),
        MofNCompleteColumn(),
        TextColumn('•'),
        TimeElapsedColumn(),
        TextColumn('•'),
        TimeRemainingColumn(),
        console=console,
        transient=False,
    )


def authenticate(client: httpx.Client) -> str:
    if not PB_ADMIN_EMAIL or not PB_ADMIN_PASSWORD:
        console.print('[bold red]PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD must be set in tools/database/.env[/]')
        sys.exit(1)
    r = client.post(
        f'{POCKETBASE_URL}/api/collections/_superusers/auth-with-password',
        json={'identity': PB_ADMIN_EMAIL, 'password': PB_ADMIN_PASSWORD},
    )
    r.raise_for_status()
    return r.json()['token']


def iter_warm_lead_logs(client: httpx.Client, headers: dict):
    page = 1
    while True:
        r = client.get(
            f'{POCKETBASE_URL}/api/collections/call_logs/records',
            headers=headers,
            params={
                'page': page,
                'perPage': 200,
                'sort': '-created',
                'filter': 'warm_lead = true',
                'fields': 'id,call_outcome,warm_lead',
            },
        )
        r.raise_for_status()
        data = r.json()
        for item in data.get('items', []):
            yield item
        if page >= data.get('totalPages', 1):
            break
        page += 1


def total_warm_lead_count(client: httpx.Client, headers: dict) -> int:
    r = client.get(
        f'{POCKETBASE_URL}/api/collections/call_logs/records',
        headers=headers,
        params={'page': 1, 'perPage': 1, 'filter': 'warm_lead = true', 'fields': 'id'},
    )
    r.raise_for_status()
    return r.json().get('totalItems', 0)


def normalize_outcomes(call_outcome) -> list[str]:
    if call_outcome is None or call_outcome == '':
        return []
    if isinstance(call_outcome, list):
        return [o for o in call_outcome if isinstance(o, str) and o]
    if isinstance(call_outcome, str):
        s = call_outcome.strip()
        if not s:
            return []
        if s.startswith('['):
            try:
                parsed = json.loads(s)
                if isinstance(parsed, list):
                    return [o for o in parsed if isinstance(o, str) and o]
            except json.JSONDecodeError:
                pass
        return [s]
    return []


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing')
    parser.add_argument('--yes', action='store_true', help='Skip the interactive confirmation')
    args = parser.parse_args()

    console.print(Panel.fit(
        f'[bold cyan]Backfill[/] [green]"{WARM_LEAD}"[/] into call_outcome '
        f'for call_logs where warm_lead = true.\n'
        f'[dim]Endpoint:[/]  {POCKETBASE_URL}'
        + ('\n[bold yellow]DRY RUN — no changes will be written[/]' if args.dry_run else ''),
        title='backfill_warm_lead_outcome',
        border_style='cyan',
    ))

    with httpx.Client(timeout=60.0) as client:
        with console.status('[cyan]Authenticating…[/]'):
            token = authenticate(client)
        headers = {'Content-Type': 'application/json', 'Authorization': token}

        console.print(Rule('[bold]Step 1 — scan call_logs (warm_lead = true)[/]', style='cyan'))
        with console.status('[cyan]Counting…[/]'):
            total = total_warm_lead_count(client, headers)
        console.print(f'[dim]Scanning[/] [bold]{total:,}[/] [dim]warm-lead call logs…[/]')

        affected: list[dict] = []
        with progress_bar() as bar:
            task = bar.add_task('[cyan]Scanning', total=total)
            for log in iter_warm_lead_logs(client, headers):
                bar.advance(task)
                outcomes = normalize_outcomes(log.get('call_outcome'))
                if WARM_LEAD not in outcomes:
                    affected.append({
                        'id': log['id'],
                        'old': outcomes,
                        'new': outcomes + [WARM_LEAD],
                    })

        if not affected:
            console.print(Panel('[bold green]Nothing to do — every warm_lead log already has "Warm Lead" in call_outcome.[/]', border_style='green'))
            return

        preview = Table(
            title=f'{len(affected)} call log(s) to update',
            show_header=True,
            header_style='bold cyan',
        )
        preview.add_column('Log ID', style='dim')
        preview.add_column('Old outcome(s)', style='magenta')
        preview.add_column('New outcome(s)', style='green')
        for row in affected[:50]:
            preview.add_row(row['id'], ', '.join(row['old']) or '—', ', '.join(row['new']))
        if len(affected) > 50:
            preview.add_row(f'… and {len(affected) - 50} more', '', '')
        console.print(preview)

        console.print(Rule('[bold]Step 2 — confirm[/]', style='cyan'))
        if args.dry_run:
            console.print('[bold yellow]Dry run — stopping here.[/]')
            return
        if not args.yes:
            if not Confirm.ask(
                f'Append [green]"{WARM_LEAD}"[/] to call_outcome on '
                f'[bold]{len(affected)}[/] call_logs?',
                default=False,
            ):
                console.print('[yellow]Aborted.[/]')
                return

        console.print(Rule('[bold]Step 3 — apply[/]', style='cyan'))
        updated = 0
        failed: list[tuple[str, str]] = []
        with progress_bar() as bar:
            task = bar.add_task('[green]Updating', total=len(affected))
            for row in affected:
                try:
                    resp = client.patch(
                        f'{POCKETBASE_URL}/api/collections/call_logs/records/{row["id"]}',
                        headers=headers,
                        json={'call_outcome': row['new']},
                    )
                    resp.raise_for_status()
                    updated += 1
                except httpx.HTTPError as e:
                    failed.append((row['id'], str(e)))
                bar.advance(task)

        if failed:
            err = Table(title='Failures', show_header=True, header_style='bold red')
            err.add_column('ID', style='dim')
            err.add_column('Reason', style='red')
            for rid, reason in failed:
                err.add_row(rid, reason)
            console.print(err)

        console.print(Panel.fit(
            f'[bold green]Done[/]  •  call_logs: {updated} updated'
            + (f'  [red]({len(failed)} failed)[/]' if failed else ''),
            border_style='green' if not failed else 'yellow',
        ))


if __name__ == '__main__':
    main()
