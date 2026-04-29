#!/usr/bin/env python3
"""
Delete every record from `custom_call_outcomes`.

The dashboard's "Other +" affordance writes every typed name here. We're
clearing the slate so the new dynamic-enum-widening hook can repopulate the
collection (and the call_logs.call_outcome enum) cleanly going forward.

Usage:
    python clear_custom_call_outcomes.py            # confirms before deleting
    python clear_custom_call_outcomes.py --yes      # skip the confirmation

Environment (loaded from tools/database/.env):
    POCKETBASE_URL       (default: http://crmdb.tableturnerr.com)
    PB_ADMIN_EMAIL       superuser email
    PB_ADMIN_PASSWORD    superuser password
"""

import argparse
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


def fetch_all(client: httpx.Client, headers: dict) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        r = client.get(
            f'{POCKETBASE_URL}/api/collections/custom_call_outcomes/records',
            headers=headers,
            params={'page': page, 'perPage': 200, 'sort': 'name', 'fields': 'id,name,created'},
        )
        r.raise_for_status()
        data = r.json()
        out.extend(data.get('items', []))
        if page >= data.get('totalPages', 1):
            break
        page += 1
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--yes', action='store_true', help='Skip the interactive confirmation')
    args = parser.parse_args()

    console.print(Panel.fit(
        f'[bold cyan]Clear custom_call_outcomes[/]\n'
        f'[dim]Endpoint:[/]  {POCKETBASE_URL}',
        title='clear_custom_call_outcomes',
        border_style='cyan',
    ))

    with httpx.Client(timeout=60.0) as client:
        with console.status('[cyan]Authenticating…[/]'):
            token = authenticate(client)
        headers = {'Content-Type': 'application/json', 'Authorization': token}

        console.print(Rule('[bold]Step 1 — preview[/]', style='cyan'))
        with console.status('[cyan]Fetching custom_call_outcomes…[/]'):
            records = fetch_all(client, headers)

        if not records:
            console.print(Panel('[bold green]Already empty — nothing to delete.[/]', border_style='green'))
            return

        preview = Table(show_header=True, header_style='bold cyan')
        preview.add_column('Name', style='magenta')
        preview.add_column('Created', style='dim')
        for r in records:
            preview.add_row(r.get('name', ''), r.get('created', ''))
        console.print(preview)

        console.print(Rule('[bold]Step 2 — confirm[/]', style='cyan'))
        if not args.yes:
            if not Confirm.ask(f'Delete all [bold red]{len(records)}[/] records?', default=False):
                console.print('[yellow]Aborted.[/]')
                return

        console.print(Rule('[bold]Step 3 — delete[/]', style='cyan'))
        deleted = 0
        failed: list[tuple[str, str]] = []
        with progress_bar() as bar:
            task = bar.add_task('[red]Deleting outcomes', total=len(records))
            for rec in records:
                rid = rec.get('id', '')
                try:
                    r = client.delete(
                        f'{POCKETBASE_URL}/api/collections/custom_call_outcomes/records/{rid}',
                        headers=headers,
                    )
                    if r.status_code in (200, 204):
                        deleted += 1
                    else:
                        failed.append((rec.get('name', rid), f'HTTP {r.status_code}'))
                except httpx.HTTPError as e:
                    failed.append((rec.get('name', rid), str(e)))
                bar.advance(task)

        if failed:
            err = Table(title='Failed deletions', show_header=True, header_style='bold red')
            err.add_column('Name', style='magenta')
            err.add_column('Reason', style='red')
            for name, reason in failed:
                err.add_row(name, reason)
            console.print(err)

        console.print(Panel.fit(
            f'[bold green]Done[/]  •  deleted {deleted} of {len(records)}'
            + (f'  •  [red]{len(failed)} failed[/]' if failed else ''),
            border_style='green' if not failed else 'yellow',
        ))


if __name__ == '__main__':
    main()
