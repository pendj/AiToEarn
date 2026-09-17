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

- Status: private deployment verified at release
  `814be0ff08f78717e48ec771ff6c4dd38f4ddcde`; eight services are healthy. Real
  private HTTP, source-matched image storage, desktop/mobile workspace and
  automation controls pass. Only server/gateway/automation were updated; the
  other social services and eight unrelated business container IDs are unchanged.
  Cold backup/isolated restore passed. Cloud media storage is still pending.
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

- Status: real model generation pending; paid calls remain disabled. Both
  registered product photos have source-matched private JPEG derivatives and
  provenance records; no public image URL or provider media acceptance yet.
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

- Status: companion and native retry guard deployed; real pause controls,
  zero-budget resume denial, native queue limits and automation-only restart
  preservation pass. Real authorized generation and scheduled publication,
  including recovery of an actual provider flow, remain pending.
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
- Implementation decision: add a small single-worker companion, not a new
  social platform. Keep daily intent, provenance, content fingerprints, cost
  reservations and flow reconciliation in a private SQLite volume. Reuse
  AiToEarn chat and publishing APIs; constrain its shared publishing queues to
  one active job. Only release a flow at dispatch time after current source,
  permissions and pause checks. Persist the flow ID before submission; unknown
  outcomes are read back rather than submitted again. Private session UI exposes
  status and pause, never credentials or authorization editing.
- Initial schedule proposal: 13:00 America/New_York, one theme and at most one
  post/account/day, at most two designated accounts. No actual publishing is
  enabled by this proposal. Model output selects source-backed English elements;
  no unsupported price, stock, delivery, warranty, review or purchase claims.
- Source freshness: verify the exact current public catalog and selected image
  hashes before generation/dispatch; changed or unreachable source pauses the
  affected content. No commerce API writes or customer data reads are needed.

## Platform findings (2026-09-17)

- The pinned source includes direct Facebook, Instagram and Pinterest providers;
  the optional hosted relay is not mandatory for those direct integrations.
  Credentials/app review are still required; no account is currently connected.
- Facebook Pages: own/managed Page, Facebook Login and Page content permissions.
  Personal profiles are not a Page-publishing destination. Official guide:
  https://developers.facebook.com/docs/pages-api/posts/
- Instagram: professional account, Instagram Login business basic and content
  publish permissions; JPEG media must be reachable by Meta at publication time.
  This deployment's private WebP storage is not yet a public publishing asset.
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/
- Pinterest: Trial-created Pins/Boards are sandbox entities visible only to their
  creator, so Trial cannot prove this goal's public-post acceptance. Standard
  access and an owned target board must be confirmed for real publication.
  https://developers.pinterest.com/docs/key-concepts/access-tiers/
- Actual provider/app approval, relay fees if selected, model price and limits
  must be confirmed for the designated account. Software self-hosting alone is
  not evidence of free or unattended access.

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
- Bucket-scoped R2 runtime access, integration and storage-cost authority;
  `luxsabers-social-media` exists privately, but JPEG derivatives for Models
  003/018 remain local and no cloud object access has been verified.

## OBS storage addition (2026-09-17)

- User requested using an existing Huawei OBS package to reduce local media
  storage: standard multi-AZ, 40GB monthly package. Endpoint supplied by user:
  `obs.cn-south-4.myhuaweicloud.com`; existing bucket `pendjun`, host
  `pendjun.obs.cn-south-4.myhuaweicloud.com`.
- Proposed layout: originals, videos and media derivatives under a dedicated
  `luxsabers-social/` prefix; local database/schedule state and bounded temporary
  cache remain on the server. Do not modify the commerce site's media, list other
  bucket objects, or grant anonymous bucket-wide read access.
- User supplied a credential; it is held disabled in ignored local private
  configuration (0600), not transferred remotely. Scope is unverified, additional
  budget remains zero, and the user reports the traffic package has expired.
  No OBS API call, migration, lifecycle change or new billable resource occurred.
- Huawei separates storage, request and public-egress billing. The existing
  server and social providers are not same-region Huawei ECS; their downloads
  may incur public egress. A 40GB storage package is not a bandwidth allowance or
  an automatic spending cap. Confirm matching region/multi-AZ coverage, request
  costs and permitted egress before an authenticated storage test.
- The pinned AiToEarn uses the AWS S3 SDK for uploads, signed URLs, metadata and
  multipart operations. OBS compatibility, signing, prefix isolation, and
  overseas platform retrieval still require an authorized real-service check;
  do not claim that changing the endpoint alone completes integration.
- Official references: resource package balance
  https://support.huaweicloud.com/price-obs/obs_42_0017.html ; public egress
  https://support.huaweicloud.com/price-obs/obs_42_0005.html ; scoped object policy
  https://support.huaweicloud.com/perms-cfg-obs/obs_40_0018.html ; IAM access key
  https://support.huaweicloud.com/usermanual-iam/iam_02_0003.html .
- R2 Standard was proposed as an alternative: verified current official pricing
  includes 10 GB-month storage, 1M Class A and 10M Class B monthly operations,
  with no R2 egress charge. Allowances are account-wide, not a spending cap.
  https://developers.cloudflare.com/r2/pricing/ . After an empty bucket-list
  read, the user explicitly requested creation of one bucket. A same-name
  preflight returned no buckets, then `POST /accounts/{account_id}/r2/buckets`
  created `luxsabers-social-media` at 2026-09-17T13:19:30.855Z (HTTP 200).
  Creation and fresh readback confirm Standard storage and automatic WNAM
  placement in the default jurisdiction. The managed-domain read returned
  `enabled: false`; the custom-domain list is empty. No object upload, runtime
  credential creation, public access, DNS or application storage change occurred.
  The application continues using its private local store. Billing-subscription
  metadata remains permission-denied; do not repeat the valid MCP login or infer
  runtime object access, free-only usage guarantees or billable-use authority.

## Work log

- 2026-09-17: Goal execution started. Read applicable skills and project context;
  verified existing SSH and server baseline. No remote mutations yet. Upstream
  source/configuration inspection is next; the goal remains active.
- 2026-09-17: Added pinned deployment configuration, isolated stores, a private
  session gateway and source-matched initialization. Six local authentication
  and proxy tests plus two provisioning tests pass; npm audit reported zero
  known vulnerabilities. No model/provider calls or remote changes yet.
- 2026-09-17: Deployed initial source `b7e4dbb` independently. Fixed MongoDB's
  entrypoint password permissions, invalid initial replica-key encoding, and
  mongosh's thrown NotYetInitialized response. Only the invalid never-activated
  initialization key was rotated; all data volumes and other credentials were
  preserved. Diagnostics now redact replica keys, including the original
  invalid-key error. The initial diagnostic exposed that unusable key; its value
  is not retained in this record. New services use no existing business database.
- 2026-09-17: AI/server/web became healthy after bypassing the upstream
  root-only resolver mutation. Gateway startup found a missing ARM64-musl sodium
  binary; selected a pinned ARM64 glibc base and added a native-load build check.
  Docker's internal network prevented direct storage port publication, so signed
  image uploads now pass through a second loopback-only gateway listener. Initial
  real HTTP verification failed because the gateway was not yet listening; this
  is not a passed check. No model call, social connection, public post or fee.
- 2026-09-17: Release `efeb3a5` gateway builds and loads real ARM64 session
  encryption. Real HTTP login/operator identity, private HTML, forbidden
  configuration/model/publishing calls, logout and anonymous denial pass.
  A source-hash-matched authorized Model 003 photo passes real signed upload,
  application confirmation and byte-identical private download; not a social
  post. Local port 18080 is occupied by an unrelated service, so private access
  moves to 18880 with a guarded three-file origin migration and retained backup.
  Browser login exposes `Origin: null` caused by the no-referrer policy; the
  same-origin referrer fix preserves CSRF checking and passes regression tests.
  Browser rerun is pending. Eight original container IDs remain unchanged;
  9,423 MiB RAM and 23 GiB disk are available after deployment.
- 2026-09-17: Release `4433cc9` real browser verification passes at 1440x1000
  and 390x844: authenticated workspace, correct login origin, logout, no runtime
  errors, no initial broken images and no horizontal overflow. Screenshots stay
  under the ignored local runtime directory.
- 2026-09-17: Local automation foundation has 20 passing Node tests, including
  real SQLite reopen, daily deduplication, DST schedule, conservative model cost
  reservations, paused/low-disk denial, source expiry and unknown-submit readback.
  Provider tests are synthetic boundary tests, not live AI or platform evidence.
  Disk regression initially reached storage instead of rejecting; the guard now
  rejects below-reserve or unmeasurable disk before an upload is proxied.
  The pinned upstream native publisher retries some failed submissions, so a
  narrowly scoped patch is guarded by compiled artifact SHA-256
  `83d1273d0d0403e18dbef4e8212e56547cdd278bf4d55083cc7d49f9880eb68d`.
  Runtime patch build, new worker deployment, private controls, backup/restore
  and broader management navigation are still pending. No source changes after
  `4433cc9` are deployed yet. Read-only production source check passed for Model
  018; Model 003 had a transient fetch failure, while its public page still
  confirms the test checkout. Do not turn that partial source check into a
  completed generation/publishing claim.
- 2026-09-17: Expanded the local automation to 27 passing Node tests and nine
  Python checks. Three focused tests first reproduced pause/resume races,
  authorization revoked during create, and a queued flow stuck after restart;
  those regressions now pass. Recovery preserves the original grant hash and
  never creates a second flow; changed grants/windows or six unresolved reads
  settle paused. Added idempotent automation provisioning and scoped cold
  snapshot/isolated restore tooling. Actual ARM build/deployment and backup
  restoration are still pending; no model/platform/storage-cloud calls.
- 2026-09-17: Cold snapshot `20260917T121131Z-4433cc9` preserves the original
  running service image IDs, exact private configuration and four project
  volumes. Initial isolated restore failed because Docker stdin was not enabled;
  a regression test reproduced it, the input-forwarding fix passed, and the real
  rerun verified archive checksums, four byte-identical restored volumes and
  MongoDB/Redis startup. Temporary restore containers/volumes were removed;
  original services and the 1.7 MiB snapshot remain. No off-server backup or
  restored public-media/model/provider acceptance is claimed. Local checks now
  comprise 27 Node tests and ten Python tests.
- 2026-09-17: Built and deployed exact source `814be0f` on ARM64. Gateway and
  automation image ID is
  `sha256:a861ffc1f56850ec8ce9d5e6a9456a7a1915343b4baa4f89eed2e435d1dd598e`;
  derived server image ID is
  `sha256:90d6323ee4978e0f52ac4232e5e7004c38cc1945bdd85170e065e39cfa60e885`.
  Runtime verification confirms the native resubmission branch is disabled,
  three idle paused queues have concurrency one, and there are no model cost
  reservations or dispatches. Real HTTP login/status/logout and zero-budget
  resume rejection pass. Desktop 1440x1000 and mobile 390x844 private controls
  pass without horizontal overflow or runtime errors; screenshots remain local.
  Restarting only automation preserves `operator_paused`, zero activity and a
  live heartbeat. Both Model 003/018 public catalog/image hashes and test-checkout
  checks pass from the server; no model/provider calls. Pre-upgrade exact images
  and configuration remain available; no application rollback was executed.
  Actual container limits and log rotation match Compose, with only two loopback
  gateway ports exposed. Eight unrelated container IDs are unchanged; 23 GiB disk
  and 9,222 MiB RAM remain available. R2 metadata read is now allowed, but its
  current bucket list is empty; there are still no cloud-storage writes.
- 2026-09-17: Added local, registered-source-only JPEG preparation. Five focused
  tests cover complete-frame retention, source hash rejection, private modes,
  no-overwrite replay, symlink denial and EXIF orientation/metadata removal.
  The initial checks failed because the preparation tool was absent; all now
  pass. Real Model 003/018 photos produce nonblank 1080x1080 JPEGs of 56,898 and
  86,102 bytes, with matching source/output hashes in private sidecars. Neither
  source files nor publishing authority changed. Local Python checks now total
  15; deployed application remains `814be0f`. No upload, provider call or public
  media availability is claimed.
- 2026-09-17: Created the one authorized private Standard R2 bucket
  `luxsabers-social-media`. Bucket metadata and both public-domain checks return
  HTTP 200; r2.dev is disabled and no custom domain exists. Updated the same
  project records; no server or commerce configuration changed. Object access,
  runtime integration and actual generation/publishing remain unverified.
