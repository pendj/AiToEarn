import { fingerprint } from './state.mjs';
import { localSchedule, modelPermission, publishingPermission, renderSelection, adaptContent, scheduleMinute } from './policy.mjs';

const terminal = new Map([[-1,'needs_reconciliation'],[9,'canceled']]);
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const allowedPostHosts = { facebook: ['facebook.com','www.facebook.com'], instagram: ['instagram.com','www.instagram.com'], pinterest: ['pinterest.com','www.pinterest.com'] };

function safePermalink(value, platform) {
  try { const url = new URL(value); return url.protocol === 'https:' && allowedPostHosts[platform].includes(url.hostname) && !url.username && !url.password && !url.search ? url.href : null; }
  catch { return null; }
}

export class DailyAutomation {
  constructor({ state, client, queues, manifest, readAuthority, verifySource, diskStatus }) {
    Object.assign(this, { state, client, queues, manifest, readAuthority, verifySource, diskStatus });
  }
  async tick(now = Date.now()) {
    const time = new Date(now).toISOString();
    const disk = await this.diskStatus();
    if (!disk.ok) { this.state.pause('disk_reserve_unavailable'); await this.queues.pause(); this.state.heartbeat(time, 'disk_reserve_unavailable'); return; }
    const authority = await this.readAuthority();
    const modelBlock = modelPermission(authority, now);
    const publishBlock = publishingPermission(authority, now);
    // Pausing stops new writes. Previously submitted flows may still be read back.
    if (this.state.control().paused || publishBlock) await this.queues.pause();
    if (!publishBlock) await this.reconcile(authority, now);
    if (this.state.control().paused || modelBlock) {
      this.state.heartbeat(time, this.state.control().paused ? this.state.control().reason : modelBlock);
      return;
    }
    const clock = localSchedule(now);
    this.state.heartbeat(time, publishBlock || 'running');
    if (clock.minute < scheduleMinute - 60 || clock.minute >= scheduleMinute + 60) return;
    let theme = this.state.intent(clock.day, time);
    if (theme.state === 'generating') { this.state.fail(clock.day, 'model_result_unknown_no_retry', time); return; }
    if (theme.state === 'planned') {
      const index = Math.floor(Date.parse(clock.day) / 86400000) % this.manifest.sources.length;
      let source;
      try { source = await this.verifySource(this.manifest, this.manifest.sources[index], now); }
      catch { this.state.fail(clock.day, 'source_unconfirmed', time); return; }
      const latest = await this.readAuthority();
      if (modelPermission(latest, Date.now()) || fingerprint(latest.model) !== fingerprint(authority.model) || this.state.control().paused) return;
      if (!this.state.beginGeneration(clock.day, source, authority.model, time)) { this.state.fail(clock.day, 'budget_or_pause_blocked', time); return; }
      try {
        const selection = await this.client.generate(source, authority.model);
        theme = this.state.saveContent(clock.day, renderSelection(selection, source), new Date().toISOString());
        if (!theme) return;
      } catch { this.state.fail(clock.day, 'model_result_invalid_or_unknown_no_retry', time); return; }
      if (!this.state.control().paused) {
        // A timed-out material creation is never blindly retried; SQLite keeps the draft.
        try { this.state.saveDraftResult(clock.day, await this.client.saveDraft(theme), new Date().toISOString()); }
        catch { this.state.event(time, 'draft', 'native_draft_sync_unconfirmed_no_retry'); }
      }
    }
    theme = this.state.theme(clock.day);
    if (theme.state !== 'draft' || publishBlock || clock.minute < scheduleMinute || this.state.unresolved()) return;
    if (!Number.isFinite(Date.parse(theme.source.expiresAt)) || Date.parse(theme.source.expiresAt) <= now || theme.source.manifestSha256 !== fingerprint(this.manifest)) { this.state.fail(clock.day, 'draft_source_expired_or_changed', time); return; }
    try { await this.verifySource(this.manifest, theme.source, now); }
    catch { this.state.fail(clock.day, 'dispatch_source_unconfirmed', time); await this.queues.pause(); return; }
    const latest = await this.readAuthority();
    if (publishingPermission(latest, Date.now()) || fingerprint(latest.publishing) !== fingerprint(authority.publishing) || this.state.control().paused) return;
    for (const account of authority.publishing.accounts) {
      if (this.state.unresolved()) return;
      // The original private WebP is not an approved platform publishing derivative.
      const media = authority.publishing.media?.[theme.source.id];
      if (!media || media.sourceSha256 !== theme.source.image.sha256 || media.type !== 'image/jpeg' || !media.publicFetchVerified || !media.authorized) {
        this.state.event(time, 'dispatch', 'publishing_image_not_ready'); return;
      }
      const content = adaptContent({ ...theme.content, image: media.url }, account);
      const dispatch = this.state.beginDispatch(clock.day, account, authority.publishing);
      if (!dispatch) continue;
      // Durable unknown state precedes the sole create request. Any crash uses GET.
      try {
        if (this.state.control().paused || !(await this.diskStatus()).ok) { await this.queues.pause(); return; }
        await this.queues.pause();
        if (this.state.control().paused) return;
        await this.client.createFlow(dispatch.flow_id, account, content, now);
        this.state.recordDispatch(dispatch.flow_id, { state: 'submitted', checks: 0 });
        await this.releaseQueues(authority, now);
      } catch {
        await this.queues.pause();
        this.state.event(time, 'dispatch', 'submission_unknown_no_retry');
      }
      return;
    }
  }
  async releaseQueues(authority, now) {
    let released = false;
    const permitted = latest => !publishingPermission(latest, Math.max(now, Date.now())) && fingerprint(latest.publishing) === fingerprint(authority.publishing);
    try {
      const latest = await this.readAuthority();
      const disk = await this.diskStatus();
      if (!permitted(latest) || !disk.ok || this.state.control().paused) return false;
      await this.queues.resume();
      // A pause can arrive while Redis processes resume. Always settle paused.
      const after = await this.readAuthority();
      released = permitted(after) && !this.state.control().paused;
      return released;
    } finally {
      if (!released) await this.queues.pause();
    }
  }
  async reconcile(authority, now) {
    for (const pending of this.state.pendingDispatches(new Date(now).toISOString())) {
      const account = authority.publishing.accounts.find(x => x.id === pending.account_id && x.platform === pending.platform);
      if (!account) { this.state.pause('reconciliation_account_unavailable'); await this.queues.pause(); return; }
      const checks = pending.checks + 1;
      let update = { state: checks >= 6 ? 'needs_reconciliation' : pending.state, checks, nextCheck: new Date(now + Math.min(30, 2 ** checks) * 60000).toISOString(), reason: 'provider_result_unconfirmed' };
      try {
        const flow = await this.client.flow(pending.flow_id);
        if (flow.flowId !== pending.flow_id || !Array.isArray(flow.tasks) || flow.tasks.length !== 1) throw new Error('flow_mismatch');
        const task = flow.tasks[0];
        if (task.accountId !== account.id || task.platform !== account.platform) throw new Error('account_mismatch');
        if (terminal.has(task.status)) update = { state: terminal.get(task.status), checks, reason: 'native_terminal_status' };
        else if ([0, 6].includes(task.status) && checks < 6 && !this.state.control().paused) {
          const theme = this.state.theme(pending.day);
          const clock = localSchedule(now);
          if (pending.grant_hash !== fingerprint(authority.publishing) || clock.day !== pending.day || clock.minute < scheduleMinute || clock.minute >= scheduleMinute + 60 ||
              !theme?.source || !Number.isFinite(Date.parse(theme.source.expiresAt)) || Date.parse(theme.source.expiresAt) <= now || theme.source.manifestSha256 !== fingerprint(this.manifest)) {
            update = { state: 'needs_reconciliation', checks, reason: 'queued_flow_authority_window_or_source_changed' };
          } else {
            await this.verifySource(this.manifest, theme.source, now);
            if (await this.releaseQueues(authority, now)) update = { ...update, state: 'submitted', reason: 'same_native_flow_resumed' };
          }
        }
        else if (task.status === 1 && task.platformWorkId) {
          const result = await this.client.work(account, task.platformWorkId);
          const theme = this.state.theme(pending.day);
          const permalink = safePermalink(result.work?.url || task.workLink, account.platform);
          if (result.platform !== account.platform || result.work?.id !== task.platformWorkId || !permalink || normalize(result.work.description) !== normalize(theme.content.body) || !result.work.coverUrl) throw new Error('provider_content_unconfirmed');
          update = { state: 'verified', checks, workId: task.platformWorkId, workLink: permalink, reason: 'provider_post_and_caption_confirmed' };
        }
      } catch { /* Provider payloads and credentials never enter the durable log. */ }
      this.state.recordDispatch(pending.flow_id, update);
      if (['verified','failed','canceled','needs_reconciliation'].includes(update.state)) await this.queues.pause();
      if (update.state === 'needs_reconciliation') this.state.pause('provider_result_needs_reconciliation');
    }
  }
}
