import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';

export const fingerprint = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

export class AutomationState {
  constructor(path) {
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (![0, 1].includes(version)) { this.db.close(); throw new Error('Unsupported automation state version'); }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS control (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 1, reason TEXT NOT NULL, heartbeat TEXT, health TEXT);
      INSERT OR IGNORE INTO control(id,paused,reason) VALUES(1,1,'awaiting_authorization');
      CREATE TABLE IF NOT EXISTS themes (day TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, state TEXT NOT NULL, source TEXT, content TEXT, fingerprint TEXT UNIQUE, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (day TEXT PRIMARY KEY, month TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0), authorization TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dispatches (day TEXT NOT NULL, account_id TEXT NOT NULL, platform TEXT NOT NULL, flow_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, grant_hash TEXT NOT NULL, state TEXT NOT NULL, checks INTEGER NOT NULL DEFAULT 0, next_check TEXT, work_id TEXT, work_link TEXT, reason TEXT, PRIMARY KEY(day,account_id), UNIQUE(account_id,fingerprint));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, time TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
  control() { return this.db.prepare('SELECT * FROM control WHERE id=1').get(); }
  pause(reason = 'operator_paused') { this.db.prepare('UPDATE control SET paused=1,reason=? WHERE id=1').run(reason); }
  resume() { this.db.prepare("UPDATE control SET paused=0,reason='running' WHERE id=1").run(); }
  heartbeat(now, health) { this.db.prepare('UPDATE control SET heartbeat=?,health=? WHERE id=1').run(now, health); }
  event(now, kind, reason) {
    this.db.prepare('INSERT INTO events(time,kind,reason) VALUES(?,?,?)').run(now, kind, reason);
    this.db.prepare('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 1000)').run();
  }
  theme(day) {
    const row = this.db.prepare('SELECT * FROM themes WHERE day=?').get(day);
    return row && { ...row, source: row.source && JSON.parse(row.source), content: row.content && JSON.parse(row.content) };
  }
  intent(day, now) {
    this.db.prepare("INSERT OR IGNORE INTO themes(day,id,state,created_at,updated_at) VALUES(?,?,'planned',?,?)").run(day, randomUUID(), now, now);
    return this.theme(day);
  }
  beginGeneration(day, source, model, now) {
    return this.transaction(() => {
      const row = this.theme(day);
      if (!row || row.state !== 'planned' || this.control().paused) return false;
      const total = Number(this.db.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM reservations WHERE month=?').get(day.slice(0, 7)).amount);
      if (model.maxCallMicrousd > model.dailyBudgetMicrousd || total + model.maxCallMicrousd > model.monthlyBudgetMicrousd) return false;
      this.db.prepare('INSERT INTO reservations(day,month,amount,authorization) VALUES(?,?,?,?)').run(day, day.slice(0, 7), model.maxCallMicrousd, model.approvalRef);
      this.db.prepare("UPDATE themes SET state='generating',source=?,updated_at=? WHERE day=?").run(JSON.stringify(source), now, day);
      return true;
    });
  }
  saveContent(day, content, now) {
    const hash = fingerprint({ body: content.body, image: content.image });
    try {
      this.db.prepare("UPDATE themes SET state='draft',content=?,fingerprint=?,updated_at=?,reason=NULL WHERE day=? AND state='generating'").run(JSON.stringify(content), hash, now, day);
      return this.theme(day);
    } catch (error) {
      if (!String(error.message).includes('UNIQUE constraint')) throw error;
      this.fail(day, 'duplicate_content', now);
      return null;
    }
  }
  fail(day, reason, now) { this.db.prepare("UPDATE themes SET state='blocked',reason=?,updated_at=? WHERE day=?").run(reason, now, day); }
  saveDraftResult(day, materialId, now) {
    const theme = this.theme(day);
    if (!theme?.content) return;
    theme.content.materialId = materialId;
    this.db.prepare('UPDATE themes SET content=?,updated_at=? WHERE day=?').run(JSON.stringify(theme.content), now, day);
  }
  beginDispatch(day, account, publishing = {}) {
    return this.transaction(() => {
      const theme = this.theme(day);
      if (!theme || theme.state !== 'draft' || this.control().paused) return null;
      if (this.db.prepare('SELECT 1 FROM dispatches WHERE day=? AND account_id=?').get(day, account.id)) return null;
      const flowId = `lux-${randomUUID()}`;
      this.db.prepare("INSERT INTO dispatches(day,account_id,platform,flow_id,fingerprint,grant_hash,state) VALUES(?,?,?,?,?,?,'unknown')").run(day, account.id, account.platform, flowId, theme.fingerprint, fingerprint(publishing));
      return this.dispatch(flowId);
    });
  }
  dispatch(flowId) { return this.db.prepare('SELECT * FROM dispatches WHERE flow_id=?').get(flowId); }
  pendingDispatches(now) { return this.db.prepare("SELECT * FROM dispatches WHERE state IN ('unknown','submitted') AND (next_check IS NULL OR next_check<=?) ORDER BY day,account_id").all(now); }
  recordDispatch(flowId, { state, checks, nextCheck = null, workId = null, workLink = null, reason = null }) {
    this.db.prepare('UPDATE dispatches SET state=?,checks=?,next_check=?,work_id=?,work_link=?,reason=? WHERE flow_id=?').run(state, checks, nextCheck, workId, workLink, reason, flowId);
  }
  unresolved() { return Number(this.db.prepare("SELECT COUNT(*) AS total FROM dispatches WHERE state NOT IN ('verified','failed','canceled')").get().total); }
  status() {
    return { control: this.control(), themes: this.db.prepare('SELECT day,state,reason FROM themes ORDER BY day DESC LIMIT 14').all(),
      dispatches: this.db.prepare('SELECT day,platform,state,reason,work_link FROM dispatches ORDER BY day DESC LIMIT 28').all(),
      reservedMicrousd: Number(this.db.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM reservations').get().amount),
      events: this.db.prepare('SELECT time,kind,reason FROM events ORDER BY id DESC LIMIT 10').all() };
  }
}
