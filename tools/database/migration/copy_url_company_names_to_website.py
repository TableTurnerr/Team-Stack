#!/usr/bin/env python3
"""
One-off migration: if a company's `company_name` is a URL, copy it into the
`website` field (unless a website is already set).

Usage:
    python copy_url_company_names_to_website.py --dry-run
    python copy_url_company_names_to_website.py
    python copy_url_company_names_to_website.py --overwrite   # overwrite existing website values too

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

URL_RE = re.compile(r'^\s*(https?://|www\.)', re.IGNORECASE)


def looks_like_url(name: str) -> bool:
    return bool(name) and bool(URL_RE.match(name))


def normalize_url(name: str) -> str:
    """Return a canonical URL: prepend https:// if missing, trim whitespace."""
    v = name.strip()
    if not re.match(r'^https?://', v, re.IGNORECASE):
        v = 'https://' + v.lstrip('/')
    return v


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
            params={'page': page, 'perPage': 200, 'fields': 'id,company_name,website'},
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
    parser.add_argument('--overwrite', action='store_true', help='Overwrite non-empty website values too')
    args = parser.parse_args()

    print(f'Connecting to {POCKETBASE_URL}')
    with httpx.Client(timeout=30.0) as client:
        token = authenticate(client)
        headers = {'Content-Type': 'application/json', 'Authorization': token}

        companies = fetch_all_companies(client, headers)
        print(f'Fetched {len(companies)} companies')

        url_named = [c for c in companies if looks_like_url(c.get('company_name', ''))]
        print(f'{len(url_named)} have URL-like company_name')

        to_update = []
        skipped_has_website = 0
        for c in url_named:
            existing = (c.get('website') or '').strip()
            if existing and not args.overwrite:
                skipped_has_website += 1
                continue
            to_update.append(c)

        print(f'{len(to_update)} will be updated  ({skipped_has_website} skipped — website already set)')

        if args.dry_run:
            for c in to_update[:20]:
                print(f"  [DRY] {c['id']}  name='{c['company_name']}'  -> website='{normalize_url(c['company_name'])}'")
            if len(to_update) > 20:
                print(f'  ... and {len(to_update) - 20} more')
            print('\nDry run — no changes written.')
            return

        updated = 0
        failed = 0
        for c in to_update:
            new_website = normalize_url(c['company_name'])
            try:
                r = client.patch(
                    f"{POCKETBASE_URL}/api/collections/companies/records/{c['id']}",
                    headers=headers,
                    json={'website': new_website},
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
