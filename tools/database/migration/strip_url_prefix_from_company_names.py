#!/usr/bin/env python3
"""
One-off migration: strip URL-like prefixes (https://, http://, www.) and a
trailing '/' from company_name values.

Usage:
    python strip_url_prefix_from_company_names.py --dry-run
    python strip_url_prefix_from_company_names.py

Environment:
    POCKETBASE_URL       (default: http://127.0.0.1:8090)
    PB_ADMIN_EMAIL       superuser email
    PB_ADMIN_PASSWORD    superuser password
"""

import argparse
import os
import re
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()

POCKETBASE_URL = os.getenv('POCKETBASE_URL', 'http://127.0.0.1:8090').rstrip('/')
PB_ADMIN_EMAIL = os.getenv('PB_ADMIN_EMAIL', '')
PB_ADMIN_PASSWORD = os.getenv('PB_ADMIN_PASSWORD', '')

PREFIX_RE = re.compile(r'^\s*(https?://)?(www\.)', re.IGNORECASE)
SCHEME_RE = re.compile(r'^\s*https?://', re.IGNORECASE)


def clean_name(name: str) -> str:
    """Strip https://, http://, www. prefix and any trailing '/'."""
    v = (name or '').strip()
    v = SCHEME_RE.sub('', v)
    if v.lower().startswith('www.'):
        v = v[4:]
    while v.endswith('/'):
        v = v[:-1]
    return v


def needs_cleaning(name: str) -> bool:
    if not name:
        return False
    return clean_name(name) != name.strip() or name != name.strip()


def authenticate(client: httpx.Client) -> str:
    if not PB_ADMIN_EMAIL or not PB_ADMIN_PASSWORD:
        sys.exit('PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD must be set in env/.env')
    r = client.post(
        f'{POCKETBASE_URL}/api/collections/_superusers/auth-with-password',
        json={'identity': PB_ADMIN_EMAIL, 'password': PB_ADMIN_PASSWORD},
    )
    r.raise_for_status()
    return r.json()['token']


def fetch_all_companies(client: httpx.Client, headers: dict) -> list:
    companies = []
    page = 1
    while True:
        r = client.get(
            f'{POCKETBASE_URL}/api/collections/companies/records',
            headers=headers,
            params={'page': page, 'perPage': 200, 'fields': 'id,company_name'},
        )
        r.raise_for_status()
        data = r.json()
        companies.extend(data.get('items', []))
        if page >= data.get('totalPages', 1):
            break
        page += 1
    return companies


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without writing')
    args = parser.parse_args()

    print(f'Connecting to {POCKETBASE_URL}')
    with httpx.Client(timeout=30.0) as client:
        token = authenticate(client)
        headers = {'Content-Type': 'application/json', 'Authorization': token}

        companies = fetch_all_companies(client, headers)
        print(f'Fetched {len(companies)} companies')

        to_update = []
        for c in companies:
            original = c.get('company_name', '') or ''
            cleaned = clean_name(original)
            if cleaned and cleaned != original:
                to_update.append((c, original, cleaned))

        print(f'{len(to_update)} will be updated')

        if args.dry_run:
            for c, original, cleaned in to_update[:20]:
                print(f"  [DRY] {c['id']}  '{original}'  ->  '{cleaned}'")
            if len(to_update) > 20:
                print(f'  ... and {len(to_update) - 20} more')
            print('\nDry run — no changes written.')
            return

        updated = 0
        failed = 0
        for c, original, cleaned in to_update:
            try:
                r = client.patch(
                    f"{POCKETBASE_URL}/api/collections/companies/records/{c['id']}",
                    headers=headers,
                    json={'company_name': cleaned},
                )
                r.raise_for_status()
                updated += 1
                if updated % 25 == 0:
                    print(f'  ...updated {updated}')
            except httpx.HTTPStatusError as e:
                failed += 1
                print(f"  ! failed {c['id']}: {e.response.status_code} {e.response.text}")

        print(f'\nDone. Updated: {updated}  Failed: {failed}')


if __name__ == '__main__':
    main()
