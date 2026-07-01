"""Central telemetry for the Insta Outreach Agent.

Ships a uptime heartbeat and structured log records to the parent-site ingest
API so this agent shows up on the admin Status/Logs dashboard. Standard library
only (urllib) so it adds no dependency, and every network call runs on a daemon
thread and swallows errors -- telemetry must never block or crash the agent.

Config comes from the environment (set in .env):
    TELEMETRY_URL    parent-site base, e.g. https://tableturnerr.com
    TELEMETRY_TOKEN  bearer for the ingest API (server-side secret)
    SERVICE_KEY      defaults to "insta-outreach-agent"

If TELEMETRY_URL or TELEMETRY_TOKEN is unset the whole module is a no-op.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import threading
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional

_LEVEL_MAP = {
    "DEBUG": "debug",
    "INFO": "info",
    "WARNING": "warn",
    "ERROR": "error",
    "CRITICAL": "fatal",
}

_FLUSH_INTERVAL_SEC = 5.0
_MAX_BATCH = 100


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _post(url: str, token: str, payload: dict[str, Any], timeout: float = 5.0) -> None:
    """Fire a single JSON POST. Best-effort; never raises."""
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
        )
        urllib.request.urlopen(req, timeout=timeout).close()
    except Exception:  # noqa: BLE001 -- telemetry must never propagate
        pass


class TelemetryClient:
    """Batched log shipper + heartbeat sender. No-op when not configured."""

    def __init__(
        self,
        service_key: str,
        url: Optional[str] = None,
        token: Optional[str] = None,
        default_context: Optional[dict[str, Any]] = None,
    ) -> None:
        self.service_key = service_key
        self.url = (url or os.environ.get("TELEMETRY_URL") or "").rstrip("/")
        self.token = token or os.environ.get("TELEMETRY_TOKEN") or ""
        self.default_context = default_context or {}
        self.enabled = bool(self.url and self.token)
        self._queue: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=10000)
        self._stop = threading.Event()
        self._worker: Optional[threading.Thread] = None
        if self.enabled:
            self._worker = threading.Thread(target=self._run, name="telemetry", daemon=True)
            self._worker.start()
        else:
            logging.getLogger(__name__).warning(
                "telemetry disabled (TELEMETRY_URL/TELEMETRY_TOKEN unset)"
            )

    # -- logs ----------------------------------------------------------------
    def log(
        self,
        level: str,
        message: str,
        event: Optional[str] = None,
        context: Optional[dict[str, Any]] = None,
    ) -> None:
        if not self.enabled:
            return
        entry: dict[str, Any] = {
            "level": level,
            "message": message[:8192],
            "ts": _now_iso(),
        }
        if event:
            entry["event"] = event
        merged = {**self.default_context, **(context or {})}
        if merged:
            entry["context"] = merged
        try:
            self._queue.put_nowait(entry)
        except queue.Full:
            pass

    def _run(self) -> None:
        while not self._stop.is_set():
            time.sleep(_FLUSH_INTERVAL_SEC)
            self._flush()
        self._flush()

    def _flush(self) -> None:
        entries: list[dict[str, Any]] = []
        while len(entries) < _MAX_BATCH:
            try:
                entries.append(self._queue.get_nowait())
            except queue.Empty:
                break
        if not entries:
            return
        _post(
            f"{self.url}/api/telemetry/logs",
            self.token,
            {"service_key": self.service_key, "entries": entries},
        )

    # -- heartbeat -----------------------------------------------------------
    def heartbeat(
        self,
        version: Optional[str] = None,
        status: str = "ok",
        meta: Optional[dict[str, Any]] = None,
    ) -> None:
        if not self.enabled:
            return
        payload: dict[str, Any] = {"service_key": self.service_key, "status": status}
        if version:
            payload["version"] = version
        if meta:
            payload["meta"] = meta
        threading.Thread(
            target=_post,
            args=(f"{self.url}/api/telemetry/heartbeat", self.token, payload),
            daemon=True,
        ).start()

    def close(self) -> None:
        self._stop.set()
        if self._worker:
            self._worker.join(timeout=3.0)


class _TelemetryLogHandler(logging.Handler):
    """Routes Python log records into the TelemetryClient queue."""

    def __init__(self, client: TelemetryClient) -> None:
        super().__init__()
        self._client = client

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = _LEVEL_MAP.get(record.levelname, "info")
            self._client.log(
                level,
                record.getMessage(),
                event=f"{record.name}",
                context={"logger": record.name, "module": record.module},
            )
        except Exception:  # noqa: BLE001
            pass


def configure_telemetry(
    service_key: Optional[str] = None,
    attach_root: bool = True,
    level: int = logging.INFO,
) -> TelemetryClient:
    """Build the client and (optionally) attach a handler to the root logger so
    existing ``logging`` calls are mirrored centrally. Returns the client so the
    caller can send heartbeats and close() on shutdown."""
    key = service_key or os.environ.get("SERVICE_KEY") or "insta-outreach-agent"
    client = TelemetryClient(key)
    if attach_root and client.enabled:
        handler = _TelemetryLogHandler(client)
        handler.setLevel(level)
        logging.getLogger().addHandler(handler)
    return client
