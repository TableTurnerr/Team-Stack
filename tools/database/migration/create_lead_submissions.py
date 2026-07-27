"""Idempotently add the PII-free lead_submissions attribution collection.

This intentionally does not run as part of application startup. Apply it to a
staging PocketBase first, then production as a separately approved rollout step.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "packages" / "pocketbase-client" / "pb_db_schema.json"
PB_URL = os.environ.get("POCKETBASE_URL", "http://localhost:8090").rstrip("/")
ADMIN_EMAIL = os.environ.get("PB_ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.environ.get("PB_ADMIN_PASSWORD", "")


def main() -> None:
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        raise SystemExit("PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD are required")
    collections = json.loads(SCHEMA.read_text(encoding="utf-8"))
    desired = next(item for item in collections if item["name"] == "lead_submissions")
    auth = requests.post(
        f"{PB_URL}/api/collections/_superusers/auth-with-password",
        json={"identity": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    auth.raise_for_status()
    headers = {"Authorization": auth.json()["token"]}
    existing = requests.get(f"{PB_URL}/api/collections/lead_submissions", headers=headers, timeout=20)
    if existing.status_code == 200:
        print("lead_submissions already exists; no changes made")
        return
    if existing.status_code != 404:
        existing.raise_for_status()
    result = requests.post(f"{PB_URL}/api/collections", headers=headers, json=desired, timeout=30)
    result.raise_for_status()
    print("created lead_submissions")


if __name__ == "__main__":
    main()
