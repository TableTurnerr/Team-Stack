#!/usr/bin/env python3
"""
Backfill RBAC ownership fields for the role-based access rollout.

For every record where the ownership field is empty, set it to the configured
default user (noohalihassan@gmail.com):

  - companies.assigned_to       → default user
  - follow_ups.created_by       → default user (if empty)
  - follow_ups.assigned_to      → default user (if empty)

Also migrates each role's `data_access` from the legacy split shape
    { companies: { mode, company_ids }, leads: { mode } }
to the unified shape
    { mode, company_ids }
Precedence when collapsing: all > specific > assigned > none.
The Member role specifically gets flipped from 'all' to 'assigned'.

Usage:
    python backfill_rbac_assignments.py --dry-run
    python backfill_rbac_assignments.py
    python backfill_rbac_assignments.py --user other@example.com

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

DEFAULT_USER_EMAIL = 'noohalihassan@gmail.com'

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


def get_user_id_by_email(client: httpx.Client, headers: dict, email: str) -> str:
    r = client.get(
        f'{POCKETBASE_URL}/api/collections/users/records',
        headers=headers,
        params={'filter': f'email="{email}"', 'perPage': 1},
    )
    r.raise_for_status()
    items = r.json().get('items', [])
    if not items:
        console.print(f'[bold red]User "{email}" not found in users collection[/]')
        sys.exit(1)
    return items[0]['id']


def find_records_missing_field(
    client: httpx.Client,
    headers: dict,
    collection: str,
    field: str,
) -> list[str]:
    """Return record IDs in `collection` where `field` is empty."""
    ids: list[str] = []
    page = 1
    while True:
        r = client.get(
            f'{POCKETBASE_URL}/api/collections/{collection}/records',
            headers=headers,
            params={
                'page': page,
                'perPage': 200,
                'filter': f'{field} = "" || {field} = null',
                'fields': 'id',
            },
        )
        r.raise_for_status()
        data = r.json()
        for item in data.get('items', []):
            ids.append(item['id'])
        if page >= data.get('totalPages', 1):
            break
        page += 1
    return ids


def patch_records(
    client: httpx.Client,
    headers: dict,
    collection: str,
    ids: list[str],
    payload: dict,
    label: str,
) -> tuple[int, int]:
    updated = 0
    failed = 0
    if not ids:
        return updated, failed
    with progress_bar() as bar:
        task = bar.add_task(f'[cyan]{label}', total=len(ids))
        for rid in ids:
            try:
                r = client.patch(
                    f'{POCKETBASE_URL}/api/collections/{collection}/records/{rid}',
                    headers=headers,
                    json=payload,
                )
                r.raise_for_status()
                updated += 1
            except httpx.HTTPStatusError as e:
                failed += 1
                console.print(f'  [red]![/] failed {collection}/{rid}: {e.response.status_code} {e.response.text}')
            finally:
                bar.advance(task)
    return updated, failed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing')
    parser.add_argument('--user', default=DEFAULT_USER_EMAIL,
                        help=f'Email of the user to backfill to (default: {DEFAULT_USER_EMAIL})')
    args = parser.parse_args()

    console.print(Panel.fit(
        f'[bold cyan]Backfill RBAC assignments[/]\n'
        f'[dim]Default user:[/] [bold green]{args.user}[/]\n'
        f'[dim]Endpoint:[/]     {POCKETBASE_URL}\n'
        f'[dim]Mode:[/]         '
        + ('[yellow]DRY RUN[/]' if args.dry_run else '[red]WRITE[/]'),
        title='backfill_rbac_assignments',
        border_style='cyan',
    ))

    with httpx.Client(timeout=60.0) as client:
        with console.status('[cyan]Authenticating…[/]'):
            token = authenticate(client)
        headers = {'Content-Type': 'application/json', 'Authorization': token}

        with console.status(f'[cyan]Resolving user "{args.user}"…[/]'):
            user_id = get_user_id_by_email(client, headers, args.user)
        console.print(f'[green]✓[/] User [bold]{args.user}[/] → [dim]{user_id}[/]')

        console.print(Rule('[bold]Step 1 — find records missing ownership[/]', style='cyan'))

        targets: list[tuple[str, str, list[str]]] = []
        for collection, field in [
            ('companies', 'assigned_to'),
            ('follow_ups', 'created_by'),
            ('follow_ups', 'assigned_to'),
        ]:
            with console.status(f'[cyan]Scanning {collection}.{field}…[/]'):
                ids = find_records_missing_field(client, headers, collection, field)
            targets.append((collection, field, ids))

        summary = Table(title='Records to backfill', show_header=True, header_style='bold cyan')
        summary.add_column('Collection', style='magenta')
        summary.add_column('Field', style='dim')
        summary.add_column('Count', justify='right', style='yellow')
        total = 0
        for collection, field, ids in targets:
            summary.add_row(collection, field, str(len(ids)))
            total += len(ids)
        summary.add_row('[bold]TOTAL[/]', '', f'[bold yellow]{total}[/]', end_section=True)
        console.print(summary)

        # Migrate every role's data_access to the unified shape:
        #   { companies: { mode, company_ids }, leads: { mode } }  →  { mode, company_ids }
        # Precedence when collapsing: all > specific > assigned > none.
        # Member role specifically gets flipped to 'assigned' if either side was 'all'.
        role_updates: list[dict] = []
        try:
            r = client.get(
                f'{POCKETBASE_URL}/api/collections/roles/records',
                headers=headers,
                params={'perPage': 200, 'fields': 'id,name,data_access'},
            )
            r.raise_for_status()
            roles = r.json().get('items', [])
            mode_rank = {'all': 3, 'specific': 2, 'assigned': 1, 'none': 0}

            for role in roles:
                da = role.get('data_access') or {}
                # Already migrated?
                if 'mode' in da and 'companies' not in da and 'leads' not in da:
                    continue

                companies_mode = (da.get('companies') or {}).get('mode')
                leads_mode = (da.get('leads') or {}).get('mode')
                company_ids = (da.get('companies') or {}).get('company_ids') or []

                # Member role: collapse 'all' down to 'assigned' (per RBAC default)
                if role.get('name') == 'Member':
                    if companies_mode == 'all':
                        companies_mode = 'assigned'
                    if leads_mode == 'all':
                        leads_mode = 'assigned'

                # Pick the higher-precedence mode across the two legacy fields
                modes = [m for m in (companies_mode, leads_mode) if m]
                if not modes:
                    continue
                unified_mode = max(modes, key=lambda m: mode_rank.get(m, 0))

                new_da: dict = {'mode': unified_mode}
                if unified_mode == 'specific' and company_ids:
                    new_da['company_ids'] = company_ids

                role_updates.append({
                    'id': role['id'],
                    'name': role.get('name'),
                    'old': f'companies={companies_mode}, leads={leads_mode}',
                    'new': unified_mode,
                    'data_access': new_da,
                })
                console.print(
                    f'[yellow]Role "{role.get("name")}" data_access will migrate:[/] '
                    f'companies={companies_mode}, leads={leads_mode} → mode={unified_mode}'
                )
        except httpx.HTTPStatusError as e:
            console.print(f'[red]Could not list roles for migration: {e.response.status_code}[/]')

        if args.dry_run:
            console.print('[bold yellow]Dry run — no changes written.[/]')
            return

        if total == 0 and not role_updates:
            console.print('[bold green]Nothing to backfill.[/]')
            return

        console.print(Rule('[bold]Step 2 — patch records[/]', style='cyan'))
        results: list[tuple[str, str, int, int]] = []
        for collection, field, ids in targets:
            label = f'Updating {collection}.{field}'
            updated, failed = patch_records(
                client, headers, collection, ids, {field: user_id}, label,
            )
            results.append((collection, field, updated, failed))

        for upd in role_updates:
            try:
                r = client.patch(
                    f'{POCKETBASE_URL}/api/collections/roles/records/{upd["id"]}',
                    headers=headers,
                    json={'data_access': upd['data_access']},
                )
                r.raise_for_status()
                console.print(f'[green]✓[/] Role "{upd["name"]}" data_access → mode={upd["new"]}')
            except httpx.HTTPStatusError as e:
                console.print(f'[red]Failed to update role "{upd["name"]}": {e.response.status_code} {e.response.text}[/]')

        result = Table(title='Backfill result', show_header=True, header_style='bold cyan')
        result.add_column('Collection', style='magenta')
        result.add_column('Field', style='dim')
        result.add_column('Updated', justify='right', style='green')
        result.add_column('Failed', justify='right', style='red')
        any_failed = False
        for collection, field, updated, failed in results:
            result.add_row(collection, field, str(updated), str(failed))
            if failed:
                any_failed = True
        console.print(Panel(result, border_style='yellow' if any_failed else 'green'))


if __name__ == '__main__':
    main()
