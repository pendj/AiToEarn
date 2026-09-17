export const timezone = 'America/New_York';
export const scheduleMinute = 13 * 60;

export function localSchedule(now) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, minute: Number(values.hour) * 60 + Number(values.minute) };
}

export function modelPermission(authority, now) {
  const model = authority?.model;
  if (!model?.authorized || !model.approvalRef || !model.connectionVerified || typeof model.name !== 'string' || !model.name || !Number.isFinite(Date.parse(model.expiresAt)) || Date.parse(model.expiresAt) <= now) return 'model_authorization_missing';
  for (const key of ['maxCallMicrousd', 'dailyBudgetMicrousd', 'monthlyBudgetMicrousd']) if (!Number.isSafeInteger(model[key]) || model[key] < 0) return 'model_budget_invalid';
  if (!Number.isSafeInteger(model.maxTokens) || model.maxTokens < 100 || model.maxTokens > 2000) return 'model_limit_invalid';
  if (!model.hardProviderLimitVerified) return 'provider_spending_limit_unverified';
  return null;
}

export function publishingPermission(authority, now) {
  const grant = authority?.publishing;
  if (!grant?.authorized || !grant.approvalRef || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now) return 'publishing_authorization_missing';
  if (grant.timezone !== timezone || grant.hour !== 13 || grant.maxPostsPerAccountPerDay !== 1 || grant.contentRule !== 'source-backed-product-preview-v1') return 'publishing_rule_mismatch';
  if (!grant.nativeNoBlindRetryVerified) return 'native_retry_boundary_unverified';
  if (!Array.isArray(grant.accounts) || grant.accounts.length < 1 || grant.accounts.length > 2 || new Set(grant.accounts.map(x => x.id)).size !== grant.accounts.length) return 'account_authorization_missing';
  for (const account of grant.accounts) {
    if (!/^[a-f0-9]{24}$/.test(account.id || '') || !['facebook','instagram','pinterest'].includes(account.platform) || !account.connectionVerified || !account.publicAccessVerified || !account.platformUid) return 'account_capability_unverified';
  }
  return null;
}

export const openers = {
  closeup: 'A closer look at',
  details: 'In the details:',
  spotlight: 'Product spotlight:',
  collection: 'From the LuxSabers collection:',
};
export const closers = {
  explore: 'Explore the product details on our website.',
  compare: 'Take a look at the model and its listed configurations.',
  design: 'See the exterior reference and product details.',
};

export function renderSelection(selection, source) {
  if (!selection || Object.keys(selection).some(key => !['openerId','closerId','factIds'].includes(key)) || !Object.hasOwn(openers, selection.openerId) || !Object.hasOwn(closers, selection.closerId) || !Array.isArray(selection.factIds) || selection.factIds.length < 1 || selection.factIds.length > 3 || new Set(selection.factIds).size !== selection.factIds.length || selection.factIds.some(id => !Object.hasOwn(source.facts, id))) throw new Error('invalid_model_selection');
  const body = `${openers[selection.openerId]} ${source.name}.\n\n${selection.factIds.map(id => source.facts[id]).join(' ')}\n\n${source.imageNotice}\n\n${closers[selection.closerId]}\n${source.targetUrl}\n\nProduct preview only. Website checkout is in test mode; this is not a live purchase offer.\n\n#LuxSabers #SaberDesign`;
  return { title: `${source.name} | Product preview`, body, factIds: selection.factIds, image: source.image.url, targetUrl: source.targetUrl, sourceId: source.id };
}

export function adaptContent(content, account) {
  const limit = { facebook: 5000, instagram: 2200, pinterest: 800 }[account.platform];
  if (!limit || content.body.length > limit || content.title.length > 100) throw new Error('platform_content_limit');
  return { title: content.title, body: content.body, media: [{ url: content.image, options: {} }] };
}
