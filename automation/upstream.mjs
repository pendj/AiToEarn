import { SignJWT } from 'jose';
import { Queue } from 'bullmq';
import { openers, closers } from './policy.mjs';

export class NativeQueues {
  constructor(connection) {
    this.queues = ['post_publish','post_media_task','update_published_post'].map(name => {
      const queue = new Queue(name, { prefix: '{bull}', connection: { ...connection, connectTimeout: 5000, maxRetriesPerRequest: 1, retryStrategy: times => times <= 2 ? 1000 : null } });
      queue.on('error', () => {});
      return queue;
    });
  }
  async pause() { for (const queue of this.queues) { await queue.setGlobalConcurrency(1); await queue.pause(); } }
  async resume() { for (const queue of this.queues) { await queue.setGlobalConcurrency(1); await queue.resume(); } }
  async status() {
    const statuses = [];
    for (const queue of this.queues) statuses.push({ name: queue.name, paused: await queue.isPaused(), concurrency: await queue.getGlobalConcurrency(), active: await queue.getActiveCount() });
    return statuses;
  }
  async close() { for (const queue of this.queues) await queue.close(); }
}

export class AiToEarnClient {
  constructor(config) { this.config = config; }
  async request(path, { body, ai = false } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('invalid_native_path');
    const token = await new SignJWT({ id: this.config.operatorId, name: 'LuxSabers Operator', mail: 'operator@luxsabers.local' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(this.config.jwtSecret));
    const response = await fetch(new URL(path, ai ? this.config.aiOrigin : this.config.serverOrigin), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(ai ? 60000 : 30000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('native_request_unconfirmed'); }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) { length += chunk.length; if (length > 1024 * 1024) throw new Error('native_response_limit'); chunks.push(chunk); }
    const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (envelope.code !== 0 || !envelope.data) throw new Error('native_request_unconfirmed');
    return envelope.data;
  }
  async generate(source, model) {
    const prompt = JSON.stringify({ task: 'Choose an English product preview composition. Return only JSON with openerId, closerId, factIds. Select existing keys only. No extra text or fields.', source: { name: source.name, facts: source.facts }, openers, closers });
    if (prompt.length > 6000) throw new Error('model_input_limit');
    const data = await this.request('/ai/chat', { ai: true, body: { model: model.name, messages: [{ role: 'user', content: prompt }], maxTokens: model.maxTokens, temperature: 0.7 } });
    if (typeof data.content !== 'string' || data.content.length > 4000) throw new Error('model_output_invalid');
    return JSON.parse(data.content);
  }
  async saveDraft(theme) {
    const groups = await this.request('/material/group/list/1/20');
    const group = groups.list?.find(x => x.isDefault);
    if (!/^[a-f0-9]{24}$/.test(group?.id || '')) throw new Error('native_draft_group_unavailable');
    const draft = await this.request('/material', { body: { groupId: group.id, title: `${theme.content.title} [${theme.day}]`, desc: theme.content.body,
      mediaList: [{ type: 'img', url: theme.content.image }], type: 'article', topics: [], accountTypes: [], maxUseCount: 1,
      option: { luxsabersAutomationId: theme.id, sourceId: theme.source.id, sourceSha256: theme.source.manifestSha256 } } });
    if (!/^[a-f0-9]{24}$/.test(draft.id || '')) throw new Error('native_draft_unconfirmed');
    return draft.id;
  }
  async createFlow(flowId, account, content, now) {
    const result = await this.request('/v2/channels/publish/flows', { body: { flowId, content, publishAt: new Date(now).toISOString(), items: [{ accountId: account.id, platform: account.platform, option: account.options || {} }] } });
    if (result.flowId !== flowId || !Array.isArray(result.tasks) || result.tasks.length !== 1 || result.tasks[0].accountId !== account.id || result.tasks[0].platform !== account.platform) throw new Error('native_flow_target_unconfirmed');
    return result;
  }
  flow(flowId) { return this.request(`/v2/channels/publish/flows/${encodeURIComponent(flowId)}`); }
  work(account, workId) { return this.request(`/v2/channels/works/${encodeURIComponent(account.platform)}/${encodeURIComponent(workId)}?accountId=${encodeURIComponent(account.id)}`); }
}
