import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Optional

class LocalDB:
    def __init__(self, db_path: str = "local_data.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            # Events queue
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS pending_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    actor_username TEXT NOT NULL,
                    target_username TEXT NOT NULL,
                    details TEXT,
                    message_text TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    synced INTEGER DEFAULT 0,
                    pb_id TEXT
                )
            ''')
            # Local leads cache
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS leads_cache (
                    username TEXT PRIMARY KEY,
                    status TEXT,
                    data TEXT,
                    updated_at TIMESTAMP
                )
            ''')
            conn.commit()

    def add_event(self, event_type: str, actor: str, target: str, details: str, message: Optional[str] = None):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO pending_events (event_type, actor_username, target_username, details, message_text)
                VALUES (?, ?, ?, ?, ?)
            ''', (event_type, actor, target, details, message))
            return cursor.lastrowid

    def get_pending_events(self) -> List[Dict]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM pending_events WHERE synced = 0 ORDER BY created_at ASC')
            return [dict(row) for row in cursor.fetchall()]

    def mark_event_synced(self, local_id: int, pb_id: str):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE pending_events 
                SET synced = 1, pb_id = ? 
                WHERE id = ?
            ''', (pb_id, local_id))
