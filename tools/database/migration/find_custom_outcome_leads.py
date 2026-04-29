#!/usr/bin/env python3
"""
Find all leads (companies) that have one or more "custom" call outcomes — i.e.
any outcome that isn't in the built-in set the dashboard ships with. This
covers anything created through the call form's "Other +" affordance.

Usage:
    python find_custom_outcome_leads.py
    python find_custom_outcome_leads.py --outcome "Voicemail"
    python find_custom_outcome_leads.py --details
    python find_custom_outcome_leads.py --csv out.csv

Environment (loaded from tools/database/.env):
    POCKETBASE_URL       (default: http://crmdb.tableturnerr.com)
    PB_ADMIN_EMAIL       superuser email
    PB_ADMIN_PASSWORD    superuser password
"""

import argparse
import csv
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable

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

# Mirror of apps/dashboard/src/lib/call-outcomes.ts — anything not in this set is
# considered a custom outcome (whether it lives in custom_call_outcomes or was
# typed long ago before that collection existed).
BUILTIN_OUTCOMES: frozenset[str] = frozenset({
    'Interested',
    'Not Interested',
    'Callback',
    'No Answer',
    'Fumbled',
    'Bad Lead',
    'Send Email',
    'Hung Up (Rude Recep)',
    'Hung Up (Other)',
    'Missed Call',
    'Other',
    'Other +',
    'Untouched',
    'Callback (Recep hung up)',
    'Callback (Owner hung up)',
    'Callback (Audio Issue)',
    'Callback (Other)',
})

# Lower-cased lookup so we treat "Warm Lead" and "warm lead" as the same outcome
# when matching against the registered custom_call_outcomes list.
BUILTIN_LC: frozenset[str] = frozenset(o.lower() for o in BUILTIN_OUTCOMES)

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


def fetch_registered_custom_outcomes(client: httpx.Client, headers: dict) -> list[dict]:
    """Read every entry from custom_call_outcomes — these are the names the form
    has been registering since the collection was introduced."""
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


def iter_call_logs(client: httpx.Client, headers: dict) -> Iterable[dict]:
    """Stream every call log, expanding the company so we can show its name."""
    page = 1
    while True:
        r = client.get(
            f'{POCKETBASE_URL}/api/collections/call_logs/records',
            headers=headers,
            params={
                'page': page,
                'perPage': 200,
                'sort': '-call_time',
                'expand': 'company',
                'fields': 'id,call_time,call_outcome,company,expand.company.id,expand.company.company_name',
            },
        )
        r.raise_for_status()
        data = r.json()
        for item in data.get('items', []):
            yield item
        total_pages = data.get('totalPages', 1)
        if page >= total_pages:
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


def normalize_outcomes(call_outcome: object) -> list[str]:
    """Coerce whatever PB returns for `call_outcome` into a list of strings.

    PocketBase stores multi-select fields as JSON arrays, but legacy records
    that were saved when the field was single-select come back as a plain
    string. Some records also come back as a JSON-encoded string. Tolerate
    every shape so we don't silently skip half the data.
    """
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


def custom_outcomes_in(call_outcome: object, registered_lc: set[str]) -> list[str]:
    """Return the subset of `call_outcome` that isn't a built-in outcome.

    A value counts as custom if it isn't in the built-in set OR if its
    case-folded form matches a name registered in `custom_call_outcomes`.
    The case-folded check ensures legacy records typed in different casing
    (e.g. "warm lead" vs "Warm Lead") still surface as customs.
    """
    out: list[str] = []
    for o in normalize_outcomes(call_outcome):
        lc = o.lower()
        if lc in BUILTIN_LC and lc not in registered_lc:
            continue
        out.append(o)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--outcome', help='Restrict to one specific custom outcome (case-sensitive)')
    parser.add_argument('--details', action='store_true', help='Print every matching call log, not just the per-company summary')
    parser.add_argument('--csv', metavar='PATH', help='Also write the per-company summary to this CSV path')
    args = parser.parse_args()

    console.print(Panel.fit(
        f'[bold cyan]Find leads with custom call outcomes[/]\n'
        f'[dim]Endpoint:[/]  {POCKETBASE_URL}\n'
        f'[dim]Filter:[/]    '
        + (f'[yellow]outcome="{args.outcome}"[/]' if args.outcome else '[green]any custom outcome[/]'),
        title='find_custom_outcome_leads',
        border_style='cyan',
    ))

    with httpx.Client(timeout=60.0) as client:
        with console.status('[cyan]Authenticating…[/]'):
            token = authenticate(client)
        headers = {'Content-Type': 'application/json', 'Authorization': token}

        # Step 1 — show what custom outcomes exist on record.
        console.print(Rule('[bold]Step 1 — registered custom outcomes[/]', style='cyan'))
        with console.status('[cyan]Loading custom_call_outcomes…[/]'):
            registered = fetch_registered_custom_outcomes(client, headers)
        registered_names = [r.get('name', '') for r in registered if r.get('name')]
        registered_lc: set[str] = {n.lower() for n in registered_names}
        if registered:
            reg_table = Table(show_header=True, header_style='bold cyan')
            reg_table.add_column('Name', style='magenta')
            reg_table.add_column('Created', style='dim')
            for r in registered:
                reg_table.add_row(r.get('name', ''), r.get('created', ''))
            console.print(reg_table)
        else:
            console.print('[dim]No entries in custom_call_outcomes — any custom outcomes you find below pre-date the collection.[/]')

        # Step 2 — scan every call log for non-builtin outcomes.
        console.print(Rule('[bold]Step 2 — scan call logs[/]', style='cyan'))
        with console.status('[cyan]Counting call logs…[/]'):
            total = total_call_log_count(client, headers)
        console.print(f'[dim]Scanning[/] [bold]{total:,}[/] [dim]call logs…[/]')

        # company_id -> {'name': str, 'count': int, 'outcomes': set, 'last_call': str, 'logs': [..]}
        per_company: dict[str, dict] = defaultdict(lambda: {
            'name': '',
            'count': 0,
            'outcomes': set(),
            'last_call': '',
            'logs': [],
        })
        outcome_counter: dict[str, int] = defaultdict(int)
        # Diagnostic — every distinct value seen in `call_outcome`, regardless of
        # whether we classify it as custom. Helps spot data we're missing.
        all_values_counter: dict[str, int] = defaultdict(int)
        empty_logs = 0
        matching_logs = 0

        outcome_lc_filter = args.outcome.lower() if args.outcome else None

        with progress_bar() as bar:
            task = bar.add_task('[cyan]Scanning call logs', total=total)
            for log in iter_call_logs(client, headers):
                bar.advance(task)
                raw = log.get('call_outcome')
                values = normalize_outcomes(raw)
                if not values:
                    empty_logs += 1
                for v in values:
                    all_values_counter[v] += 1
                custom = custom_outcomes_in(raw, registered_lc)
                if not custom:
                    continue
                if outcome_lc_filter and outcome_lc_filter not in {c.lower() for c in custom}:
                    continue

                matching_logs += 1
                for o in custom:
                    outcome_counter[o] += 1

                cid = log.get('company') or '__unattached__'
                expand = log.get('expand') or {}
                company_obj = expand.get('company') or {}
                cname = company_obj.get('company_name') or '(unknown company)'

                row = per_company[cid]
                row['name'] = cname
                row['count'] += 1
                row['outcomes'].update(custom)
                if not row['last_call'] or (log.get('call_time') and log['call_time'] > row['last_call']):
                    row['last_call'] = log.get('call_time', '')
                if args.details:
                    row['logs'].append({
                        'id': log['id'],
                        'call_time': log.get('call_time', ''),
                        'outcomes': custom,
                    })

        # Step 3 — render results.
        console.print(Rule('[bold]Step 3 — results[/]', style='cyan'))

        # Diagnostic: every distinct value seen in `call_outcome` across the
        # whole table. If custom names registered in custom_call_outcomes aren't
        # showing up here, PB is dropping/rejecting them on save (most likely
        # because the select field's `values` list doesn't include them).
        diag = Table(
            title=f'All distinct call_outcome values seen ({len(all_values_counter)} unique, {empty_logs} empty)',
            show_header=True,
            header_style='bold cyan',
        )
        diag.add_column('Value', style='magenta')
        diag.add_column('Calls', justify='right', style='yellow')
        diag.add_column('Classification', style='cyan')
        diag.add_column('Registered', style='green')
        for value, count in sorted(all_values_counter.items(), key=lambda kv: -kv[1]):
            lc = value.lower()
            is_registered = lc in registered_lc
            if is_registered:
                classification = '[bold magenta]custom (registered)[/]'
            elif lc not in BUILTIN_LC:
                classification = '[bold yellow]custom (legacy)[/]'
            else:
                classification = '[dim]built-in[/]'
            diag.add_row(value, str(count), classification, '[green]✓[/]' if is_registered else '')
        console.print(diag)

        # Highlight registered names that NEVER appeared in any call log.
        seen_lc = {v.lower() for v in all_values_counter}
        unused = [n for n in registered_names if n.lower() not in seen_lc]
        if unused:
            console.print(Panel(
                '[bold yellow]Registered custom outcomes that don\'t appear in any call log:[/]\n'
                + '\n'.join(f'  • {n}' for n in unused)
                + '\n\n[dim]Likely cause: the call_logs.call_outcome field is a strict select '
                'whose `values` list doesn\'t include these names, so PocketBase is rejecting '
                'or dropping them on save. Either widen the enum or store custom outcomes in a '
                'separate text field.[/]',
                border_style='yellow',
            ))

        if not per_company:
            msg = 'No matching calls.' if args.outcome else 'No call logs use any custom outcome.'
            console.print(Panel(f'[bold green]{msg}[/]', border_style='green'))
            return

        # Custom outcome usage breakdown
        usage = Table(title='Custom outcome usage', show_header=True, header_style='bold cyan')
        usage.add_column('Outcome', style='magenta')
        usage.add_column('Calls', justify='right', style='yellow')
        for name, count in sorted(outcome_counter.items(), key=lambda kv: -kv[1]):
            usage.add_row(name, str(count))
        console.print(usage)

        # Per-company breakdown — sort by call count desc then last call desc
        leads = sorted(
            per_company.items(),
            key=lambda kv: (-kv[1]['count'], kv[1]['last_call']),
        )
        leads_table = Table(
            title=f'Leads with custom outcomes ({len(leads)} companies, {matching_logs} calls)',
            show_header=True,
            header_style='bold cyan',
        )
        leads_table.add_column('#', style='dim', justify='right')
        leads_table.add_column('Company', style='magenta')
        leads_table.add_column('Calls', justify='right', style='yellow')
        leads_table.add_column('Custom outcomes used', style='cyan')
        leads_table.add_column('Last call', style='dim')
        leads_table.add_column('Company ID', style='dim')
        for idx, (cid, row) in enumerate(leads, start=1):
            leads_table.add_row(
                str(idx),
                row['name'],
                str(row['count']),
                ', '.join(sorted(row['outcomes'])),
                (row['last_call'] or '')[:19].replace('T', ' '),
                cid if cid != '__unattached__' else '[red]<no company>[/]',
            )
        console.print(leads_table)

        if args.details:
            console.print(Rule('[bold]Per-call detail[/]', style='cyan'))
            for cid, row in leads:
                console.print(f'[bold magenta]{row["name"]}[/] [dim]({cid})[/]')
                for log in sorted(row['logs'], key=lambda l: l['call_time'], reverse=True):
                    when = (log['call_time'] or '')[:19].replace('T', ' ')
                    console.print(f"  [dim]{when}[/]  {', '.join(log['outcomes'])}  [dim]{log['id']}[/]")

        if args.csv:
            csv_path = Path(args.csv)
            with csv_path.open('w', newline='', encoding='utf-8') as fh:
                w = csv.writer(fh)
                w.writerow(['company_id', 'company_name', 'call_count', 'custom_outcomes', 'last_call'])
                for cid, row in leads:
                    w.writerow([
                        cid,
                        row['name'],
                        row['count'],
                        '|'.join(sorted(row['outcomes'])),
                        row['last_call'],
                    ])
            console.print(f'[green]✓[/] Wrote summary to [bold]{csv_path}[/]')

        console.print(Panel.fit(
            f'[bold green]Done[/]  •  {matching_logs} calls across {len(leads)} companies  •  '
            f'{len(outcome_counter)} distinct custom outcome(s)',
            border_style='green',
        ))


if __name__ == '__main__':
    main()
