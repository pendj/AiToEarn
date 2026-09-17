# AiToEarn for LuxSabers

**Goal:** Safely deploy AiToEarn on the existing ARM server and operate daily,
source-backed English social content through at least one explicitly authorized
account, including actual scheduled publishing and provider-side verification.

**Why planning is required:** Deployment shares a host with live businesses and
depends on model cost authorization, social account authorization, and a durable
publisher that must not post twice or make unsupported product claims.

**Acceptance:** All six outcomes below must have current evidence. A running UI,
mock provider, draft, or configured schedule is not evidence of a real post.
No unrelated business service, data, pricing, policy, or payment state may change.

## Environment and authority

- Target: `ubuntu@163.192.46.78`; ARM64, two CPU cores, 11,932 MiB RAM.
- Read-only baseline, 2026-09-17: 10,246 MiB available RAM and 27 GiB free disk.
  Eight existing containers are running; commerce gateway and app are healthy.
- No existing local or remote same-scope deployment directory was found.
- Inspected latest upstream source `9413d73918271bd716b9ea59f61c9f59e485619b`.
  Selected release source `8bbf520cd56807ba30712fca415bc774b8038cb6` instead,
  matching the published web and server images. AI image source `e3abc458` has no
  AI/shared-backend changes before that commit. Actual startup and API/UI
  compatibility still require runtime verification.
- Local implementation, scoped remote deployment, a new social subdomain if
  necessary, and local commits are authorized. No push is authorized.
- Paid calls/resources: NOT authorized, budget zero.
- Account connection: no specific account has been designated yet.
- First public post and ongoing publication policy: NOT authorized yet.
- Existing SSH access is valid. No repeated authentication or secret discovery.

## Outcome 1: Minimal implementation record and baseline

- Status: complete; local record and read-only server baseline established.
- Work: keep this plan as the status, decisions, and blocker record; keep runtime
  instructions in the project README. Record upstream source and image pins.
- Verify: local directory and Git status; scoped remote resource and service
  baseline; inspect upstream deployment, authentication, storage, and scheduling.

## Outcome 2: Isolated, private, recoverable deployment

- Status: in progress; local deployment and authentication adapter implemented,
  not yet deployed. Six authentication/proxy tests and two provisioning tests
  pass. Real app integration and browser checks remain outstanding.
- Work: dedicated Compose project, internal stores, independent volumes, pinned
  compatible ARM images, unique secrets, no auto-admin login, private management
  through SSH forwarding, resource caps, log rotation, and disk/retention limits.
- Acceptance: authenticated private UI and real app health; no new public DB,
  Redis, object-store console, or admin token; unrelated services stay healthy.
- Recovery: record the exact deployed config and digests before changing them;
  stop only the new project on regression. Preserve data volumes and back up
  before schema changes. Never use host-wide cleanup or container restarts.
- Stop conditions: insufficient reserved disk/RAM, impact on existing services,
  authentication bypass, unexpected public exposure, or unauthorized expenditure.
- Verify: Compose render validation without secret output, service health,
  anonymous/authenticated HTTP behavior, bound ports, resource use, scoped
  backup/restore and rollback instructions, desktop/mobile real UI.
- Authentication decision: the upstream OSS backend lacks its hosted email
  login handlers. Use a small password/session gateway, not the upstream shared
  automatic administrator token. Keep upstream JWTs server-side; use a
  non-credential frontend state marker after actual private authentication.
- Source metadata lookup found `minio/mc:latest` unavailable. Bucket setup uses
  the gateway's official S3 SDK instead; no separate init-tool image is needed.

## Outcome 3: Real source-backed English content generation

- Status: pending; paid calls remain disabled.
- Work: reuse authorized product photos and verified current public product
  facts, retain source/configuration provenance and freshness, and use an
  explicitly authorized model connection. Start with text and existing images.
- Rules: no invented reviews, offers, inventory, delivery, warranty, IP rights,
  or live purchase claims while checkout remains a test flow. No video generation
  or local model inference by default.
- Verify: real authorized model output and its factual/asset checks. Mock tests
  prove local behavior only, never model connectivity or factual completeness.

## Outcome 4: One real authorized social platform

- Status: pending; designated account and authorization missing.
- Work: evaluate Facebook, Instagram, and Pinterest using current official and
  upstream interfaces. Select one based on the user's actual account and
  supported content; connect at most two initially. Identify direct-provider vs
  relay dependencies, app approval, token renewal, and real costs.
- Boundaries: official/allowed authorization only. User handles login, 2FA, and
  required agreements. No account impersonation or browser-bypass publisher.
- Verify: actual account capabilities and least-privilege authorization; no
  public post until explicit publishing authority is recorded.

## Outcome 5: Persistent daily automation with controlled publishing

- Status: pending.
- Work: default one theme per day, at most one post per enabled account per day,
  `America/New_York` timezone, concurrency one; persistent draft/schedule states,
  provenance, deduplication, bounded retries, failures, expiry, and pause controls.
- Use upstream APIs/tasks where suitable. Add only missing orchestration.
- An ambiguous provider response must be reconciled before resubmission.
- Before first publication, obtain one consolidated authorization for specific
  accounts, content rules, schedule, and maximum costs. Then run within those
  limits without requiring daily manual approval.
- Verify: idempotency, crash/restart recovery, paused state, expired facts, failure
  limits, and real scheduled dispatch/result lookup after authorization.

## Outcome 6: Verified delivery and local commits

- Status: pending.
- Work: provide private access and daily operations, cost breakdown, account
  renewal, backup, and exact rollback instructions; commit verified deployment
  code locally. Keep sensitive evidence local and excluded from Git.
- Verify: real model generation and one authorized scheduled post plus provider
  status/permalink; desktop/mobile access; existing service health; evidence for
  each preceding outcome. No engagement or sales target is added as acceptance.

## Current missing items

These do not block independent installation and implementation work:

- A designated owned Facebook/Instagram/Pinterest account and its authorization.
- An applicable model connection and explicit permitted spend (currently zero).
- One-time first-post and ongoing publishing authorization after exact rules,
  accounts, schedule, and fees are presented.

## Work log

- 2026-09-17: Goal execution started. Read applicable skills and project context;
  verified existing SSH and server baseline. No remote mutations yet. Upstream
  source/configuration inspection is next; the goal remains active.
- 2026-09-17: Added pinned deployment configuration, isolated stores, a private
  session gateway and source-matched initialization. Six local authentication
  and proxy tests plus two provisioning tests pass; npm audit reported zero
  known vulnerabilities. No model/provider calls or remote changes yet.
