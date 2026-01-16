import time
import threading
import logging
from typing import Optional
from .local_db import LocalDB
from .pocketbase_sync import PocketBaseSync

class SyncEngine:
    def __init__(self, db_path: str = "local_data.db"):
        self.local_db = LocalDB(db_path)
        self.pb_sync = PocketBaseSync()
        self.logger = logging.getLogger(__name__)
        self.running = False
        self.thread: Optional[threading.Thread] = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        self.logger.info("Sync engine started")

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join()
        self.logger.info("Sync engine stopped")

    def _run_loop(self):
        while self.running:
            try:
                self.sync_events()
            except Exception as e:
                self.logger.error(f"Sync error: {e}")
            
            # Sleep in intervals to allow quick stop
            for _ in range(60): 
                if not self.running:
                    break
                time.sleep(1)

    def sync_events(self):
        events = self.local_db.get_pending_events()
        if not events:
            return

        self.logger.info(f"Found {len(events)} pending events to sync")
        
        # Ensure connection
        if not self.pb_sync.pb.is_authenticated:
            self.pb_sync.connect()

        for event in events:
            try:
                pb_event = self.pb_sync.log_outreach_event(
                    actor_username=event['actor_username'],
                    target_username=event['target_username'],
                    event_type=event['event_type'],
                    details=event['details'],
                    message_text=event['message_text']
                )
                self.local_db.mark_event_synced(event['id'], pb_event['id'])
                self.logger.info(f"Synced event {event['id']}")
            except Exception as e:
                self.logger.error(f"Failed to sync event {event['id']}: {e}")
