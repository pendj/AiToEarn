import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { freeLimits } from '../server/r2-policy.cjs';

export class MediaBudget {
  constructor(path, { initialBytes = 0, maxBytes = freeLimits.storageBytes, dailyUploads = 32 } = {}) {
    if (![initialBytes, maxBytes, dailyUploads].every(Number.isSafeInteger) || initialBytes < 0
      || maxBytes > freeLimits.storageBytes || Math.min(maxBytes, freeLimits.storageBytes - freeLimits.storageReserve) <= initialBytes || dailyUploads <= 0 || dailyUploads > 32) {
      throw new Error('Invalid private media allowance');
    }
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS media_reservations (id TEXT PRIMARY KEY, day TEXT NOT NULL, bytes INTEGER NOT NULL);');
    this.db.exec('CREATE TABLE IF NOT EXISTS r2_operations (day TEXT NOT NULL, class TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,class));');
    this.initialBytes = initialBytes;
    this.maxBytes = Math.min(maxBytes, freeLimits.storageBytes - freeLimits.storageReserve);
    this.dailyUploads = dailyUploads;
  }
  reserveOperation(kind, now = new Date()) {
    if (kind === 'free') return true;
    if (!['a', 'b'].includes(kind)) return false;
    const day = now.toISOString().slice(0, 10);
    const since = new Date(now.getTime() - 31 * 86400000).toISOString().slice(0, 10);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const total = this.db.prepare('SELECT COALESCE(SUM(count),0) AS total FROM r2_operations WHERE class=? AND day>=?').get(kind, since).total;
      // A rolling 32-day window is conservative across billing-month boundaries.
      if (total + freeLimits.requestReserve >= freeLimits[kind]) { this.db.exec('ROLLBACK'); return false; }
      this.db.prepare('INSERT INTO r2_operations VALUES (?,?,1) ON CONFLICT(day,class) DO UPDATE SET count=count+1').run(day, kind);
      this.db.exec('COMMIT');
      return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  reserve(bytes, day = new Date().toISOString().slice(0, 10)) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const used = this.db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM media_reservations').get().bytes;
      const today = this.db.prepare('SELECT COUNT(*) AS count FROM media_reservations WHERE day=?').get(day).count;
      if (this.initialBytes + used + bytes > this.maxBytes || today >= this.dailyUploads) {
        this.db.exec('ROLLBACK');
        return false;
      }
      this.db.prepare('INSERT INTO media_reservations VALUES (?,?,?)').run(randomUUID(), day, bytes);
      this.db.exec('COMMIT');
      return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
