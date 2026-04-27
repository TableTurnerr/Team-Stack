#!/usr/bin/env python3
"""
One-off reset + import: wipes all financial data (bank_accounts, fin_categories,
fin_transactions, recurring_transactions, balance_adjustments) and rebuilds
them from the UBL 19-Jan-2026 to 19-Apr-2026 bank statement for account
1581-300477553 (Ahmed Hashaam Zahid).

Creates two bank accounts (TableTurnerr UBL, Ahmed Hashaam Zahid UBL), seeds a
taxonomy of categories, books every business transaction under the rules the
user provided, and reconciles any remaining gap to the actual closing balance
with a single "Personal & Untracked" entry.

Usage:
    python reset_and_import_ubl_financials.py --dry-run
    python reset_and_import_ubl_financials.py

Environment (loaded from tools/database/.env):
    POCKETBASE_URL       default http://127.0.0.1:8090
    PB_ADMIN_EMAIL       superuser email
    PB_ADMIN_PASSWORD    superuser password
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parents[1] / '.env'
load_dotenv(ENV_PATH)

POCKETBASE_URL = os.getenv('POCKETBASE_URL', 'http://127.0.0.1:8090').rstrip('/')
PB_ADMIN_EMAIL = os.getenv('PB_ADMIN_EMAIL', '')
PB_ADMIN_PASSWORD = os.getenv('PB_ADMIN_PASSWORD', '')
OWNER_EMAIL = 'hashaam.zahid.work@gmail.com'

OPENING_BALANCE = 234521.47
CLOSING_BALANCE = 211121.92
STATEMENT_START = '2026-01-19'
STATEMENT_END = '2026-04-19'

# ---------------------------------------------------------------------------
# Category taxonomy
# ---------------------------------------------------------------------------
CATEGORIES: list[dict[str, Any]] = [
    {'name': 'Internal Team Wages', 'type': 'expense', 'color': '#2563eb', 'icon': 'users'},
    {'name': 'External Team Wages - Other', 'type': 'expense', 'color': '#7c3aed', 'icon': 'user'},
    {'name': 'External Team Wages - Design & Social Media', 'type': 'expense', 'color': '#db2777', 'icon': 'palette'},
    {'name': 'Return Borrowed Money', 'type': 'both', 'color': '#eab308', 'icon': 'repeat'},
    {'name': 'Borrowed Money Received', 'type': 'income', 'color': '#06b6d4', 'icon': 'download'},
    {'name': 'Loan Given', 'type': 'expense', 'color': '#f97316', 'icon': 'upload'},
    {'name': 'Income - Web Dev', 'type': 'income', 'color': '#10b981', 'icon': 'code'},
    {'name': 'Income - Other', 'type': 'income', 'color': '#14b8a6', 'icon': 'plus-circle'},
    {'name': 'Income - PartnerStack', 'type': 'income', 'color': '#059669', 'icon': 'handshake'},
    {'name': 'Business Expense - Tools & Equipment - AI', 'type': 'expense', 'color': '#6366f1', 'icon': 'cpu'},
    {'name': 'Bank Fees & Taxes', 'type': 'expense', 'color': '#64748b', 'icon': 'landmark'},
    {'name': 'Donation', 'type': 'expense', 'color': '#16a34a', 'icon': 'gift'},
    {'name': 'Personal & Untracked', 'type': 'both', 'color': '#9ca3af', 'icon': 'help-circle'},
]

# ---------------------------------------------------------------------------
# Bank accounts
# ---------------------------------------------------------------------------
BANK_ACCOUNTS: list[dict[str, Any]] = [
    {
        'name': 'TableTurnerr UBL',
        'currency': 'PKR',
        'balance': 40000.0,
        'account_type': 'checking',
        'color': '#0ea5e9',
        'icon': 'building-2',
        'notes': 'TableTurnerr business UBL account.',
        'is_active': True,
    },
    {
        'name': 'Ahmed Hashaam Zahid UBL',
        'currency': 'PKR',
        'balance': CLOSING_BALANCE,
        'account_type': 'checking',
        'color': '#f59e0b',
        'icon': 'wallet',
        'notes': f'UBL Ameen Esaar Current 1581-300477553. Imported from statement '
                 f'{STATEMENT_START} to {STATEMENT_END}. Opening {OPENING_BALANCE} -> closing {CLOSING_BALANCE}.',
        'is_active': True,
    },
]

HASHAAM_UBL_KEY = 'Ahmed Hashaam Zahid UBL'

# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------
@dataclass
class Txn:
    date: str
    type: str            # 'income' | 'expense'
    amount: float
    category: str
    tags: list[str] = field(default_factory=list)
    description: str = ''
    fee_amount: float = 0.0


T: list[Txn] = []

def add(t: Txn) -> None:
    T.append(t)

# --- January ---
add(Txn('2026-01-20', 'expense', 55000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary to Nooh Ali (routed via RAAST P2P to external payee)'))
add(Txn('2026-01-21', 'income', 130000, 'Return Borrowed Money', ['Nooh Ali'],
        'Nooh Ali returning money borrowed from company (internal UBL)'))
add(Txn('2026-01-24', 'expense', 20000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-01-25', 'expense', 20000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-01-29', 'expense', 120000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))

# --- February ---
# 10-Feb RAAST to Ahmed HBL 35,500 -> 20k salary + 15.5k return-borrowed
add(Txn('2026-02-10', 'expense', 20000, 'Internal Team Wages', ['Hashaam Zahid'],
        'Monthly salary to Hashaam Zahid (RAAST P2P to Ahmed HBL, split from 35,500)'))
add(Txn('2026-02-10', 'expense', 15500, 'Return Borrowed Money', ['Hashaam Zahid'],
        'Return of money company borrowed from Hashaam Zahid (split from 35,500 Ahmed HBL transfer)'))
add(Txn('2026-02-10', 'expense', 30000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-02-12', 'income', 50000, 'Return Borrowed Money', ['Nooh Ali'],
        'Nooh Ali returning borrowed money (internal UBL)'))
# 14-Feb Claude.ai (old smaller plan) = POS 5,643 + fee 253.93 + WHT 564.3 = 6,461.23
add(Txn('2026-02-14', 'expense', 6461.23, 'Business Expense - Tools & Equipment - AI', ['Claude'],
        'Claude.ai subscription (old plan). Breakdown: POS PKR 5,643.00, Int\'l MC conversion fee PKR 253.93, WHT on int\'l card txn PKR 564.30.',
        fee_amount=818.23))
add(Txn('2026-02-18', 'expense', 7000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-02-20', 'expense', 3000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-02-20', 'expense', 25000, 'External Team Wages - Other', ['Saleha Amjad'],
        'Wage to Saleha Amjad (IBFT to NayaPay)'))
add(Txn('2026-02-22', 'income', 93027.24, 'Income - Web Dev', ['Grill Shack'],
        'Web Dev income from Grill Shack (received via Danish Pervez, ATM-IBFT)'))
add(Txn('2026-02-23', 'expense', 3500, 'External Team Wages - Design & Social Media', ['Usama'],
        'Wage to Usama (designer, RAAST P2P to Meezan)'))
add(Txn('2026-02-28', 'expense', 70000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))

# --- March ---
add(Txn('2026-03-01', 'expense', 3500, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-03-04', 'expense', 1300, 'Internal Team Wages', ['Idrees Ali'],
        'Salary/wage to Idrees Ali (IBFT to SadaPay titled Shoukat Ali Hassan)'))
# 05-Mar Ahmed HBL 29,816 -> 20k salary + 9,816 return-borrowed
add(Txn('2026-03-05', 'expense', 20000, 'Internal Team Wages', ['Hashaam Zahid'],
        'Monthly salary to Hashaam Zahid (RAAST P2P to Ahmed HBL, split from 29,816)'))
add(Txn('2026-03-05', 'expense', 9816, 'Return Borrowed Money', ['Hashaam Zahid'],
        'Return of money company borrowed from Hashaam Zahid (split from 29,816 Ahmed HBL transfer)'))
add(Txn('2026-03-06', 'expense', 10000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-03-06', 'expense', 6000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (RAAST to Nooh JazzCash)'))
add(Txn('2026-03-06', 'expense', 5000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-03-08', 'expense', 30000, 'Internal Team Wages', ['Idrees Ali'],
        'Salary/wage to Idrees Ali (IBFT to SadaPay titled Shoukat Ali Hassan)'))
add(Txn('2026-03-08', 'expense', 5.29, 'Bank Fees & Taxes', ['IBFT fee'],
        'IBFT fee for digital channel'))
add(Txn('2026-03-08', 'expense', 1.01, 'Bank Fees & Taxes', ['FED'],
        'Federal Excise Duty on IBFT'))
add(Txn('2026-03-09', 'income', 19500, 'Return Borrowed Money', ['Nooh Ali'],
        'Nooh Ali returning borrowed money (internal UBL)'))
# 09-Mar Claude.ai new larger plan = POS 27,016.45 + fee 1,215.74 + WHT 2,701.65 = 30,933.84
add(Txn('2026-03-09', 'expense', 30933.84, 'Business Expense - Tools & Equipment - AI', ['Claude'],
        'Claude.ai subscription (upgraded plan). Breakdown: POS PKR 27,016.45, Int\'l MC conversion fee PKR 1,215.74, WHT on int\'l card txn PKR 2,701.65.',
        fee_amount=3917.39))
add(Txn('2026-03-15', 'income', 15000, 'Borrowed Money Received', ['Fatima Zahid'],
        'Company borrowed 15,000 from Fatima Zahid (internal UBL)'))
add(Txn('2026-03-18', 'income', 625413.58, 'Income - PartnerStack',
        ['PartnerStack'],
        'PartnerStack payout received via ATM-IBFT from PARTNERSTACK INC'))
add(Txn('2026-03-19', 'expense', 15000, 'Return Borrowed Money', ['Fatima Zahid'],
        'Return of 15,000 borrowed from Fatima Zahid the previous day'))
add(Txn('2026-03-19', 'expense', 12300, 'External Team Wages - Other', ['Saleha Amjad'],
        'Wage to Saleha Amjad (IBFT to NayaPay)'))
add(Txn('2026-03-19', 'expense', 20000, 'Donation', ['School Fee', 'Muhammad Khurram Zubair'],
        'Donation - School Fee (internal UBL to Muhammad Khurram Zubair)'))
add(Txn('2026-03-19', 'expense', 10.33, 'Bank Fees & Taxes', ['IBFT fee'],
        'IBFT fee for digital channel'))
add(Txn('2026-03-19', 'expense', 1.97, 'Bank Fees & Taxes', ['FED'],
        'Federal Excise Duty on IBFT'))
add(Txn('2026-03-19', 'expense', 7000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-03-19', 'expense', 1000, 'External Team Wages - Other', ['Saleha Amjad'],
        'Wage to Saleha Amjad (IBFT to NayaPay)'))
add(Txn('2026-03-19', 'expense', 0.84, 'Bank Fees & Taxes', ['IBFT fee'],
        'IBFT fee for digital channel'))
add(Txn('2026-03-19', 'expense', 0.16, 'Bank Fees & Taxes', ['FED'],
        'Federal Excise Duty on IBFT'))
add(Txn('2026-03-19', 'expense', 12000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
# 22-Mar Zahid Iftikhar +101,000. 24-Mar Ahmed HBL -21,000 within 2 days = passthrough.
# Book the remainder (80,000) as Income - Other (Hamza). Skip the 24-Mar outflow entirely.
add(Txn('2026-03-22', 'income', 80000, 'Income - Other', ['Hamza'],
        'Income from Hamza routed via Zahid Iftikhar +101,000 on 22-Mar. '
        'Subtracted 21,000 passed through to Hashaam (Ahmed HBL) on 24-Mar as personal.'))
add(Txn('2026-03-27', 'expense', 5000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-03-29', 'expense', 3000, 'Internal Team Wages', ['Idrees Ali'],
        'Salary/wage to Idrees Ali (IBFT to SadaPay titled Shoukat Ali Hassan)'))
add(Txn('2026-03-29', 'expense', 2.52, 'Bank Fees & Taxes', ['IBFT fee'],
        'IBFT fee for digital channel'))
add(Txn('2026-03-29', 'expense', 0.48, 'Bank Fees & Taxes', ['FED'],
        'Federal Excise Duty on IBFT'))
add(Txn('2026-03-30', 'expense', 14000, 'External Team Wages - Other', ['Saleha Amjad'],
        'Wage to Saleha Amjad (IBFT to NayaPay)'))
add(Txn('2026-03-30', 'expense', 11.76, 'Bank Fees & Taxes', ['IBFT fee'],
        'IBFT fee for digital channel'))
add(Txn('2026-03-30', 'expense', 2.24, 'Bank Fees & Taxes', ['FED'],
        'Federal Excise Duty on IBFT'))
# 31-Mar Ahmed HBL 36,000 -> 20k salary + 16k return-borrowed (9 days after Zahid, outside week)
add(Txn('2026-03-31', 'expense', 20000, 'Internal Team Wages', ['Hashaam Zahid'],
        'Monthly salary to Hashaam Zahid (RAAST P2P to Ahmed HBL, split from 36,000)'))
add(Txn('2026-03-31', 'expense', 16000, 'Return Borrowed Money', ['Hashaam Zahid'],
        'Return of money company borrowed from Hashaam Zahid (split from 36,000 Ahmed HBL transfer)'))

# --- April ---
add(Txn('2026-04-01', 'expense', 60000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-04-05', 'expense', 999, 'Internal Team Wages', ['Idrees Ali'],
        'Salary/wage to Idrees Ali (IBFT to SadaPay titled Shoukat Ali Hassan)'))
add(Txn('2026-04-05', 'expense', 800, 'External Team Wages - Other', ['Saleha Amjad'],
        'Wage to Saleha Amjad (IBFT to NayaPay)'))
add(Txn('2026-04-05', 'expense', 23000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-04-05', 'expense', 3000, 'External Team Wages - Design & Social Media', ['Usama'],
        'Wage to Usama (designer, RAAST P2P to Meezan)'))
add(Txn('2026-04-05', 'income', 30000, 'Return Borrowed Money', ['Nooh Ali'],
        'Nooh Ali returning borrowed money (internal UBL)'))
add(Txn('2026-04-08', 'expense', 90000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
# 09-Apr Claude.ai = POS 28,160 + fee 1,267.2 + WHT 2,816 = 32,243.2
add(Txn('2026-04-09', 'expense', 32243.20, 'Business Expense - Tools & Equipment - AI', ['Claude'],
        'Claude.ai subscription (current plan). Breakdown: POS PKR 28,160.00, Int\'l MC conversion fee PKR 1,267.20, WHT on int\'l card txn PKR 2,816.00.',
        fee_amount=4083.20))
# 09-Apr Ahmed HBL 29,670 -> 20k salary + 9,670 return-borrowed
add(Txn('2026-04-09', 'expense', 20000, 'Internal Team Wages', ['Hashaam Zahid'],
        'Monthly salary to Hashaam Zahid (RAAST P2P to Ahmed HBL, split from 29,670)'))
add(Txn('2026-04-09', 'expense', 9670, 'Return Borrowed Money', ['Hashaam Zahid'],
        'Return of money company borrowed from Hashaam Zahid (split from 29,670 Ahmed HBL transfer)'))
add(Txn('2026-04-15', 'expense', 20000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-04-15', 'expense', 10000, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-04-16', 'expense', 3500, 'Internal Team Wages', ['Nooh Ali'],
        'Salary/wage to Nooh Ali (internal UBL transfer)'))
add(Txn('2026-04-19', 'expense', 150000, 'Loan Given', ['Azeem Ur Rehman'],
        'Loan given to Azeem Ur Rehman (RAAST P2P to Meezan)'))
add(Txn('2026-04-19', 'expense', 5000, 'External Team Wages - Other', ['Saleha Amjad'],
        'Wage to Saleha Amjad (RAAST P2P to SadaPay)'))

# ---------------------------------------------------------------------------
# PocketBase helpers
# ---------------------------------------------------------------------------
def auth(client: httpx.Client) -> str:
    if not PB_ADMIN_EMAIL or not PB_ADMIN_PASSWORD:
        sys.exit('PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD must be set in tools/database/.env')
    r = client.post(
        f'{POCKETBASE_URL}/api/collections/_superusers/auth-with-password',
        json={'identity': PB_ADMIN_EMAIL, 'password': PB_ADMIN_PASSWORD},
    )
    r.raise_for_status()
    return r.json()['token']


def find_user_id(client: httpx.Client, headers: dict, email: str) -> str:
    r = client.get(
        f'{POCKETBASE_URL}/api/collections/users/records',
        headers=headers,
        params={'filter': f'email="{email}"', 'perPage': 1, 'fields': 'id,email'},
    )
    r.raise_for_status()
    items = r.json().get('items', [])
    if not items:
        sys.exit(f'User not found in PocketBase users collection: {email}')
    return items[0]['id']


def wipe_collection(client: httpx.Client, headers: dict, collection: str) -> int:
    deleted = 0
    while True:
        r = client.get(
            f'{POCKETBASE_URL}/api/collections/{collection}/records',
            headers=headers,
            params={'page': 1, 'perPage': 200, 'fields': 'id'},
        )
        r.raise_for_status()
        items = r.json().get('items', [])
        if not items:
            break
        for item in items:
            dr = client.delete(
                f"{POCKETBASE_URL}/api/collections/{collection}/records/{item['id']}",
                headers=headers,
            )
            if dr.status_code not in (200, 204):
                print(f"  ! failed delete {collection}/{item['id']}: {dr.status_code} {dr.text}")
                continue
            deleted += 1
    return deleted


def create_record(client: httpx.Client, headers: dict, collection: str, payload: dict) -> dict:
    r = client.post(
        f'{POCKETBASE_URL}/api/collections/{collection}/records',
        headers=headers,
        json=payload,
    )
    if r.status_code not in (200, 201):
        raise RuntimeError(f'create {collection} failed: {r.status_code} {r.text}\npayload={payload}')
    return r.json()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Preview the reconciliation math without touching the DB')
    parser.add_argument('--yes', action='store_true', help='Skip the destructive-confirmation prompt')
    args = parser.parse_args()

    # Reconciliation math (runs regardless of --dry-run)
    recorded_income = sum(t.amount for t in T if t.type == 'income')
    recorded_expense = sum(t.amount for t in T if t.type == 'expense')
    recorded_net = recorded_income - recorded_expense
    actual_net = CLOSING_BALANCE - OPENING_BALANCE
    personal_delta = actual_net - recorded_net
    # personal_delta positive -> missing income; negative -> missing expense

    print('=' * 72)
    print(f'UBL 1581-300477553 import ({STATEMENT_START} .. {STATEMENT_END})')
    print('=' * 72)
    print(f'Opening balance:       {OPENING_BALANCE:>14,.2f}')
    print(f'Closing balance:       {CLOSING_BALANCE:>14,.2f}')
    print(f'Actual net change:     {actual_net:>14,.2f}')
    print(f'Recorded income:       {recorded_income:>14,.2f}  ({sum(1 for t in T if t.type == "income")} txns)')
    print(f'Recorded expense:      {recorded_expense:>14,.2f}  ({sum(1 for t in T if t.type == "expense")} txns)')
    print(f'Recorded net:          {recorded_net:>14,.2f}')
    print(f'Personal & Untracked:  {personal_delta:>14,.2f}  (reconciliation plug)')
    print('=' * 72)

    if args.dry_run:
        print('\nDRY RUN — no changes written. Summary by category:')
        by_cat: dict[str, tuple[float, float]] = {}
        for t in T:
            inc, exp = by_cat.get(t.category, (0.0, 0.0))
            if t.type == 'income':
                inc += t.amount
            else:
                exp += t.amount
            by_cat[t.category] = (inc, exp)
        for cat, (inc, exp) in sorted(by_cat.items()):
            print(f'  {cat:<50}  income {inc:>12,.2f}   expense {exp:>12,.2f}')
        return

    if not args.yes:
        print()
        print(f'!! This will WIPE all rows in bank_accounts, fin_categories,')
        print(f'!! fin_transactions, recurring_transactions, balance_adjustments')
        print(f'!! on {POCKETBASE_URL}')
        resp = input('Type "RESET" to continue: ').strip()
        if resp != 'RESET':
            print('Aborted.')
            return

    with httpx.Client(timeout=60.0) as client:
        token = auth(client)
        headers = {'Content-Type': 'application/json', 'Authorization': token}

        owner_id = find_user_id(client, headers, OWNER_EMAIL)
        print(f'\nOwner user id for {OWNER_EMAIL}: {owner_id}')

        # 1. Wipe (order matters for FK cascades)
        print('\nWiping existing financial data...')
        for coll in ('balance_adjustments', 'recurring_transactions',
                     'fin_transactions', 'fin_categories', 'bank_accounts'):
            n = wipe_collection(client, headers, coll)
            print(f'  wiped {coll}: {n} rows')

        # 2. Create categories
        print('\nCreating fin_categories...')
        cat_by_name: dict[str, str] = {}
        for cat in CATEGORIES:
            payload = {**cat, 'created_by': owner_id, 'budget_currency': 'PKR'}
            rec = create_record(client, headers, 'fin_categories', payload)
            cat_by_name[cat['name']] = rec['id']
            print(f'  + {cat["name"]} ({cat["type"]}) -> {rec["id"]}')

        # 3. Create bank accounts
        print('\nCreating bank_accounts...')
        acct_by_name: dict[str, str] = {}
        for acct in BANK_ACCOUNTS:
            payload = {**acct, 'created_by': owner_id}
            rec = create_record(client, headers, 'bank_accounts', payload)
            acct_by_name[acct['name']] = rec['id']
            print(f'  + {acct["name"]} (bal {acct["balance"]:,}) -> {rec["id"]}')

        hashaam_ubl_id = acct_by_name[HASHAAM_UBL_KEY]

        # 4. Insert transactions
        print(f'\nInserting {len(T)} fin_transactions...')
        for i, t in enumerate(T, 1):
            if t.category not in cat_by_name:
                raise RuntimeError(f'Unknown category "{t.category}" in txn {t}')
            payload = {
                'bank_account': hashaam_ubl_id,
                'type': t.type,
                'amount': round(t.amount, 2),
                'currency': 'PKR',
                'fee_amount': round(t.fee_amount, 2),
                'category': cat_by_name[t.category],
                'tags': t.tags,
                'description': t.description,
                'status': 'cleared',
                'date': f'{t.date} 12:00:00.000Z',
                'created_by': owner_id,
                'is_recurring': False,
            }
            create_record(client, headers, 'fin_transactions', payload)
            if i % 10 == 0:
                print(f'  ...inserted {i}/{len(T)}')

        # 5. Reconciliation entry
        if abs(personal_delta) > 0.005:
            kind = 'income' if personal_delta > 0 else 'expense'
            amount = abs(personal_delta)
            print(f'\nInserting Personal & Untracked reconciliation ({kind} {amount:,.2f})...')
            payload = {
                'bank_account': hashaam_ubl_id,
                'type': kind,
                'amount': round(amount, 2),
                'currency': 'PKR',
                'fee_amount': 0,
                'category': cat_by_name['Personal & Untracked'],
                'tags': ['reconciliation', 'personal'],
                'description': (
                    f'Personal & Untracked reconciliation plug. Net of all personal '
                    f'POS purchases, personal RAAST transfers (Irfan A. Khan, Munazza '
                    f'Batool, Muzamil Khan, Azad Ali), Mah Jabeen transactions (both '
                    f'directions), Fatima +1,570 and the Zahid Iftikhar 21,000 '
                    f'passthrough to Hashaam. Makes recorded ledger match actual '
                    f'closing balance PKR {CLOSING_BALANCE:,.2f} from opening '
                    f'PKR {OPENING_BALANCE:,.2f}.'
                ),
                'status': 'cleared',
                'date': f'{STATEMENT_END} 23:59:00.000Z',
                'created_by': owner_id,
                'is_recurring': False,
            }
            create_record(client, headers, 'fin_transactions', payload)

        print('\nDone.')
        print(f'  Ahmed Hashaam Zahid UBL id: {hashaam_ubl_id}')
        print(f'  TableTurnerr UBL id:        {acct_by_name["TableTurnerr UBL"]}')
        print(f'  Final recorded balance ≈   {OPENING_BALANCE + recorded_net + personal_delta:,.2f}')
        print(f'  Expected actual balance =  {CLOSING_BALANCE:,.2f}')


if __name__ == '__main__':
    main()
