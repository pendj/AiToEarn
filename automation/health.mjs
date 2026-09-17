import { DatabaseSync } from 'node:sqlite';
try {
  const db = new DatabaseSync('/data/automation.sqlite', { readOnly: true });
  const row = db.prepare('SELECT heartbeat FROM control WHERE id=1').get();
  db.close();
  process.exit(row?.heartbeat && Date.now() - Date.parse(row.heartbeat) < 300000 ? 0 : 1);
} catch { process.exit(1); }
