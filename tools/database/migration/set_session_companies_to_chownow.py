#!/usr/bin/env python3
"""
Set lead_category to "ChowNow" for every company called in the given
cold_calling_sessions.

Usage:
    python set_session_companies_to_chownow.py --dry-run
    python set_session_companies_to_chownow.py
    python set_session_companies_to_chownow.py --overwrite   # also overwrite companies that already have a different category

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
from rich.rule import Rule
from rich.table import Table

load_dotenv(Path(__file__).parent.parent / '.env')

POCKETBASE_URL = os.getenv('POCKETBASE_URL', 'http://crmdb.tableturnerr.com').rstrip('/')
PB_ADMIN_EMAIL = os.getenv('PB_ADMIN_EMAIL', '')
PB_ADMIN_PASSWORD = os.getenv('PB_ADMIN_PASSWORD', '')

CATEGORY_NAME = 'ChowNow'

SESSION_IDS = [
    'h4ste5ndqfha5i2',
    'f0pwa53vabnjbhv',
    'w9idp6kzv947jj2',
    'wbkzkj9hr2h9mrz',
    'my6c73va0qfb00i',
    'owb4b1qewkqhi8i',
    's6x7cayz5i6j71k',
    '8do4cjdaxcxitqx',
    'xyjzzdl1ck98cfv',
]

console = Console()


def progress_bar(description: str = '') -> Progress:
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


def get_category_id(client: httpx.Client, headers: dict, name: str) -> str:
    r = client.get(
        f'{POCKETBASE_URL}/api/collections/lead_categories/records',
        headers=headers,
        params={'filter': f'name="{name}"', 'perPage': 1},
    )
    r.raise_for_status()
    items = r.json().get('items', [])
    if not items:
        console.print(f'[bold red]lead_category "{name}" not found[/] — run seed_lead_categories.py first')
        sys.exit(1)
    return items[0]['id']


def fetch_session_company_ids(client: httpx.Client, headers: dict, session_id: str) -> set[str]:
    company_ids: set[str] = set()
    page = 1
    while True:
        r = client.get(
            f'{POCKETBASE_URL}/api/collections/call_logs/records',
            headers=headers,
            params={
                'page': page,
                'perPage': 200,
                'filter': f'session="{session_id}"',
                'fields': 'id,company',
            },
        )
        r.raise_for_status()
        data = r.json()
        for item in data.get('items', []):
            if item.get('company'):
                company_ids.add(item['company'])
        if page >= data.get('totalPages', 1):
            break
        page += 1
    return company_ids


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing')
    parser.add_argument('--overwrite', action='store_true',
                        help='Overwrite companies that already have a different lead_category')
    args = parser.parse_args()

    console.print(Panel.fit(
        f'[bold cyan]Set lead_category[/] → [bold green]{CATEGORY_NAME}[/]\n'
        f'[dim]Sessions:[/] {len(SESSION_IDS)}\n'
        f'[dim]Endpoint:[/] {POCKETBASE_URL}\n'
        f'[dim]Mode:[/] '
        + ('[yellow]DRY RUN[/]' if args.dry_run else '[red]WRITE[/]')
        + ('  [magenta](overwrite)[/]' if args.overwrite else ''),
        title='set_session_companies_to_chownow',
        border_style='cyan',
    ))

    with httpx.Client(timeout=60.0) as client:
        with console.status('[cyan]Authenticating…[/]'):
            token = authenticate(client)
        headers = {'Content-Type': 'application/json', 'Authorization': token}

        with console.status(f'[cyan]Looking up category "{CATEGORY_NAME}"…[/]'):
            category_id = get_category_id(client, headers, CATEGORY_NAME)
        console.print(f'[green]✓[/] Category [bold]{CATEGORY_NAME}[/] → [dim]{category_id}[/]')

        console.print(Rule('[bold]Step 1 — collect company IDs from sessions[/]', style='cyan'))
        all_company_ids: set[str] = set()
        per_session_counts: list[tuple[str, int]] = []
        with progress_bar() as bar:
            task = bar.add_task('[cyan]Fetching call_logs by session', total=len(SESSION_IDS))
            for sid in SESSION_IDS:
                ids = fetch_session_company_ids(client, headers, sid)
                per_session_counts.append((sid, len(ids)))
                all_company_ids.update(ids)
                bar.advance(task)

        tbl = Table(title='Per-session company counts', show_header=True, header_style='bold cyan')
        tbl.add_column('Session ID', style='dim')
        tbl.add_column('Unique companies', justify='right', style='green')
        for sid, n in per_session_counts:
            tbl.add_row(sid, str(n))
        tbl.add_row('[bold]TOTAL UNIQUE[/]', f'[bold green]{len(all_company_ids)}[/]', end_section=True)
        console.print(tbl)

        console.print(Rule('[bold]Step 2 — classify companies[/]', style='cyan'))
        to_update: list[str] = []
        already_correct = 0
        skipped_other_category = 0
        fetch_failed = 0
        with progress_bar() as bar:
            task = bar.add_task('[cyan]Inspecting companies', total=len(all_company_ids))
            for cid in all_company_ids:
                try:
                    r = client.get(
                        f'{POCKETBASE_URL}/api/collections/companies/records/{cid}',
                        headers=headers,
                        params={'fields': 'id,company_name,lead_category'},
                    )
                    if r.status_code != 200:
                        fetch_failed += 1
                        bar.advance(task)
                        continue
                    c = r.json()
                    current = c.get('lead_category') or ''
                    if current == category_id:
                        already_correct += 1
                    elif current and not args.overwrite:
                        skipped_other_category += 1
                    else:
                        to_update.append(cid)
                finally:
                    bar.advance(task)

        summary = Table(show_header=False, box=None)
        summary.add_column(style='bold')
        summary.add_column(justify='right')
        summary.add_row('[cyan]To update[/]', f'[bold yellow]{len(to_update)}[/]')
        summary.add_row(f'[green]Already {CATEGORY_NAME}[/]', f'{already_correct}')
        summary.add_row('[magenta]Skipped (other category, no --overwrite)[/]', f'{skipped_other_category}')
        if fetch_failed:
            summary.add_row('[red]Fetch failures[/]', f'{fetch_failed}')
        console.print(Panel(summary, title='Classification', border_style='cyan'))

        if args.dry_run:
            console.print('[bold yellow]Dry run — no changes written.[/]')
            return

        if not to_update:
            console.print('[bold green]Nothing to update.[/]')
            return

        console.print(Rule('[bold]Step 3 — patch lead_category[/]', style='cyan'))
        updated = 0
        failed = 0
        with progress_bar() as bar:
            task = bar.add_task('[cyan]Updating companies', total=len(to_update))
            for cid in to_update:
                try:
                    r = client.patch(
                        f'{POCKETBASE_URL}/api/collections/companies/records/{cid}',
                        headers=headers,
                        json={'lead_category': category_id},
                    )
                    r.raise_for_status()
                    updated += 1
                except httpx.HTTPStatusError as e:
                    failed += 1
                    console.print(f'  [red]![/] failed {cid}: {e.response.status_code} {e.response.text}')
                finally:
                    bar.advance(task)

        result = Table(show_header=False, box=None)
        result.add_column(style='bold')
        result.add_column(justify='right')
        result.add_row('[green]Updated[/]', f'[bold green]{updated}[/]')
        result.add_row('[red]Failed[/]', f'[bold red]{failed}[/]')
        console.print(Panel(result, title='Done', border_style='green' if failed == 0 else 'yellow'))


if __name__ == '__main__':
    main()
