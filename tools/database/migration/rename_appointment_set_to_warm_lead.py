#!/usr/bin/env python3
"""
Rename the "Appointment Set" call outcome to "Warm Lead" across the database.

Two things are updated:
  1. custom_call_outcomes — any record whose name is "Appointment Set"
     (case-insensitive) is renamed to "Warm Lead".
  2. call_logs — any record whose call_outcome array/string contains
     "Appointment Set" (case-insensitive) has that value replaced with
     "Warm Lead".

Usage:
    python rename_appointment_set_to_warm_lead.py --dry-run
    python rename_appointment_set_to_warm_lead.py
    python rename_appointment_set_to_warm_lead.py --yes

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

OLD_NAME = 'Appointment Set'
NEW_NAME = 'Warm Lead'

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


def fetch_custom_outcomes(client: httpx.Client, headers: dict) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        r = client.get(
            f'{POCKETBASE_URL}/api/collections/custom_call_outcomes/records',
            headers=headers,
            params={'page': page, 'perPage': 200, 'sort': 'name', 'fields': 'id,name'},
        )
        r.raise_for_status()
        data = r.json()
        out.extend(data.get('items', []))
        if page >= data.get('totalPages', 1):
            break
        page += 1
    return out


def iter_call_logs(client: httpx.Client, headers: dict):
    page = 1
    while True:
        r = client.get(
            f'{POCKETBASE_URL}/api/collections/call_logs/records',
            headers=headers,
            params={
                'page': page,
                'perPage': 200,
                'sort': '-created',
                'fields': 'id,call_outcome',
            },
        )
        r.raise_for_status()
        data = r.json()
        for item in data.get('items', []):
            yield item
        if page >= data.get('totalPages', 1):
            break
        page += 1


def total_call_log_count(client: httpx.Client, headers: dict) -> int:
    r = client.get(
        f'{POCKETBASE_URL}/api/collections/call_logs/records',
        headers=headers,
        params={'page': 1, 'perPage': 1, 'fields': 'id'},
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


def replace_outcome(outcomes: list[str]) -> tuple[list[str], bool]:
    """Replace OLD_NAME with NEW_NAME (case-insensitive). Returns new list and whether changed."""
    new = [NEW_NAME if o.lower() == OLD_NAME.lower() else o for o in outcomes]
    return new, new != outcomes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without writing')
    parser.add_argument('--yes', action='store_true', help='Skip the interactive confirmation')
    args = parser.parse_args()

    console.print(Panel.fit(
        f'[bold cyan]Rename call outcome:[/]  [red]{OLD_NAME}[/]  →  [green]{NEW_NAME}[/]\n'
        f'[dim]Endpoint:[/]  {POCKETBASE_URL}'
        + ('\n[bold yellow]DRY RUN — no changes will be written[/]' if args.dry_run else ''),
        title='rename_appointment_set_to_warm_lead',
        border_style='cyan',
    ))

    with httpx.Client(timeout=60.0) as client:
        with console.status('[cyan]Authenticating…[/]'):
            token = authenticate(client)
        headers = {'Content-Type': 'application/json', 'Authorization': token}

        # ── Step 1: custom_call_outcomes ─────────────────────────────────────
        console.print(Rule('[bold]Step 1 — custom_call_outcomes[/]', style='cyan'))
        with console.status('[cyan]Fetching custom_call_outcomes…[/]'):
            custom_outcomes = fetch_custom_outcomes(client, headers)

        matches = [r for r in custom_outcomes if r.get('name', '').lower() == OLD_NAME.lower()]
        if matches:
            t = Table(show_header=True, header_style='bold cyan')
            t.add_column('ID', style='dim')
            t.add_column('Current name', style='magenta')
            t.add_column('New name', style='green')
            for r in matches:
                t.add_row(r['id'], r['name'], NEW_NAME)
            console.print(t)
        else:
            console.print(f'[dim]No custom_call_outcomes record named "{OLD_NAME}" found.[/]')

        # ── Step 2: call_logs scan ────────────────────────────────────────────
        console.print(Rule('[bold]Step 2 — scan call_logs[/]', style='cyan'))
        with console.status('[cyan]Counting call logs…[/]'):
            total = total_call_log_count(client, headers)
        console.print(f'[dim]Scanning[/] [bold]{total:,}[/] [dim]call logs…[/]')

        affected: list[dict] = []
        with progress_bar() as bar:
            task = bar.add_task('[cyan]Scanning', total=total)
            for log in iter_call_logs(client, headers):
                bar.advance(task)
                outcomes = normalize_outcomes(log.get('call_outcome'))
                new_outcomes, changed = replace_outcome(outcomes)
                if changed:
                    affected.append({'id': log['id'], 'old': outcomes, 'new': new_outcomes})

        if affected:
            preview = Table(
                title=f'{len(affected)} call log(s) to update',
                show_header=True,
                header_style='bold cyan',
            )
            preview.add_column('Log ID', style='dim')
            preview.add_column('Old outcome(s)', style='magenta')
            preview.add_column('New outcome(s)', style='green')
            for row in affected[:50]:
                preview.add_row(row['id'], ', '.join(row['old']), ', '.join(row['new']))
            if len(affected) > 50:
                preview.add_row(f'… and {len(affected) - 50} more', '', '')
            console.print(preview)
        else:
            console.print(f'[dim]No call logs contain "{OLD_NAME}" as an outcome.[/]')

        if not matches and not affected:
            console.print(Panel('[bold green]Nothing to do — no records found.[/]', border_style='green'))
            return

        # ── Step 3: confirm ───────────────────────────────────────────────────
        console.print(Rule('[bold]Step 3 — confirm[/]', style='cyan'))
        if args.dry_run:
            console.print('[bold yellow]Dry run — stopping here.[/]')
            return
        if not args.yes:
            if not Confirm.ask(
                f'Rename [red]{OLD_NAME}[/] → [green]{NEW_NAME}[/] in '
                f'[bold]{len(matches)}[/] custom_call_outcomes and '
                f'[bold]{len(affected)}[/] call_logs?',
                default=False,
            ):
                console.print('[yellow]Aborted.[/]')
                return

        # ── Step 4: apply ─────────────────────────────────────────────────────
        console.print(Rule('[bold]Step 4 — apply[/]', style='cyan'))

        cco_updated = 0
        cco_failed: list[tuple[str, str]] = []
        for r in matches:
            try:
                resp = client.patch(
                    f'{POCKETBASE_URL}/api/collections/custom_call_outcomes/records/{r["id"]}',
                    headers=headers,
                    json={'name': NEW_NAME},
                )
                resp.raise_for_status()
                cco_updated += 1
            except httpx.HTTPError as e:
                cco_failed.append((r['id'], str(e)))

        log_updated = 0
        log_failed: list[tuple[str, str]] = []
        with progress_bar() as bar:
            task = bar.add_task('[green]Updating call_logs', total=len(affected))
            for row in affected:
                try:
                    resp = client.patch(
                        f'{POCKETBASE_URL}/api/collections/call_logs/records/{row["id"]}',
                        headers=headers,
                        json={'call_outcome': row['new']},
                    )
                    resp.raise_for_status()
                    log_updated += 1
                except httpx.HTTPError as e:
                    log_failed.append((row['id'], str(e)))
                bar.advance(task)

        if cco_failed or log_failed:
            err = Table(title='Failures', show_header=True, header_style='bold red')
            err.add_column('Collection', style='cyan')
            err.add_column('ID', style='dim')
            err.add_column('Reason', style='red')
            for rid, reason in cco_failed:
                err.add_row('custom_call_outcomes', rid, reason)
            for rid, reason in log_failed:
                err.add_row('call_logs', rid, reason)
            console.print(err)

        console.print(Panel.fit(
            f'[bold green]Done[/]  •  '
            f'custom_call_outcomes: {cco_updated} updated'
            + (f'  [red]({len(cco_failed)} failed)[/]' if cco_failed else '')
            + f'  •  call_logs: {log_updated} updated'
            + (f'  [red]({len(log_failed)} failed)[/]' if log_failed else ''),
            border_style='green' if not (cco_failed or log_failed) else 'yellow',
        ))


if __name__ == '__main__':
    main()
