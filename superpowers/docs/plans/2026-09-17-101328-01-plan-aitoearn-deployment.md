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

- Status: private R2 gateway/server/AI verified at release
  `b6321d67fd070f15c2ab90a959682276e5b533a7`; automation remains on `814be0f`.
  Eight services are healthy. Real
  private HTTP, source-matched image storage, desktop/mobile workspace and
  automation controls pass. Only gateway/server/AI changed in the R2 rollout;
  other social services and eight unrelated business container IDs are unchanged.
  Cold backup/isolated restore passed. Private R2 image storage and free-envelope
  guards are deployed; platform-readable media is not enabled.
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
  A user-designated Codex channel is now imported and credential-validated in
  existing ccload on `147.224.48.149`; AiToEarn integration and generation are
  still unverified. This is not an API billing or publishing authorization.
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
  Reuse the designated ccload candidate; do not rediscover accounts or treat its
  successful import as proof of AiToEarn connectivity or unlimited free usage.
- One-time first-post and ongoing publishing authorization after exact rules,
  accounts, schedule, and fees are presented.
- Platform-readable media and actual provider acceptance after account selection.
  Private R2 app storage/free-envelope guards are complete; wider credential scope
  is not independently proven. R2-only media has no off-provider backup yet.
  Model 003 JPEG is uploaded privately; Model 018 JPEG remains local.

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
- Continuation scope: prepare bucket-only runtime credentials and a bounded
  private storage check. Account and user token permission-group endpoints both
  return Cloudflare error 9109 with the existing MCP; do not retry authentication
  or substitute a broad administrator key. Local secure credential input and
  R2 signing support can proceed, but cloud read/write and the application
  storage switch require the dedicated credential. Keep the existing storage
  and links unchanged until a real-service migration check passes. In particular,
  the pinned upstream signs its public endpoint host; R2 upload routing, existing
  object continuity and isolated server egress need verification before switching.

## R2 integration slice

- Preserve existing RustFS objects and exact configuration/image rollback.
  Inventory only this project's bucket, copy bounded existing objects with exact
  keys and verified bytes before activation, and do not delete local originals.
- Keep both AiToEarn services internal-only. Their pinned Node 24.17/24.18 runtimes
  supports an explicit HTTPS agent proxy. Apply a hash-guarded S3-client patch
  with one attempt and a target-only CONNECT proxy in the existing gateway;
  no general proxy, TLS interception, or unrelated outbound access.
- Sign native URLs for the real R2 host. Rewrite only the authenticated native
  upload-sign response to the private upload listener, restoring the R2 Host
  when forwarding. Preserve type/size/disk checks and short expiry. No direct
  browser-to-R2 uploads or bucket CORS/public-domain changes.
- Transfer only the dedicated storage credential, back up three affected private
  configuration files, and retain all other settings/authorizations. Check real
  app upload, confirmation, byte-identical private reads, old links, anonymous
  denial, and desktop/mobile UI before calling integration complete. Constrain
  initial media to private images. User now explicitly requires the R2 Standard
  free envelope: 10 GB total storage (not 10 GB new each month), 1M Class A and
  10M Class B monthly requests. Upstream does not enforce its stored operator
  quota; use a persistent shared gateway ledger, at most 32 upload intents/day,
  counting failures until deliberate reconciliation. Keep 100 MB of the storage
  envelope reserved as headroom; upload reservations stop at 9.9 GB. Apply request limits
  over a conservative rolling 32-day window, reserving 10,000 operations of each
  class for pre-integration/tooling usage. Native S3 calls authenticate quota
  reservation before network access; unknown operations or quota-service failure
  stop access. No paid generation/video calls. Retain
  R2-only new objects and the quota ledger during rollback. These local limits
  do not cap account-wide Cloudflare billing from other credentials/services.

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
- 2026-09-17: Added hidden terminal credential input, a dedicated-target/private
  file check and an explicitly invoked sub-1-KiB R2 roundtrip checker. Credentials
  are not supplied yet; the real offline command exits with the expected missing
  configuration message before any network access. A focused test reproduced
  the gateway ignoring its configured signing region; it now honors `auto`.
  R2 initialization is read-only and cannot create/configure a bucket with the
  runtime credential. All 36 Node and 18 Python checks pass, including unknown
  upload cleanup without a second PUT, public-access rejection and preservation
  of unowned objects/configuration. Storage-service tests are synthetic, not
  Cloudflare object-access evidence. No server update, R2 object request, token
  creation, media migration, model call or publication occurred. The live
  application remains release `814be0f`; cloud integration and overall goal
  remain incomplete.
- 2026-09-17: Stored supplied S3 credentials with 0600 permissions in the ignored
  private directory; did not store/use the separate API token. Account metrics
  show zero stored bytes, and month-to-date operations contain only 18 bucket
  lists, one bucket creation and one bucket HEAD before object verification.
  Official Standard free allowances rechecked; these are not a spending cap.
  First real probe uploaded/downloaded correctly but failed anonymous status
  classification: R2 uses 400/InvalidArgument/Authorization, not 401/403.
  A focused regression failed before the fix; only the exact authentication
  rejection is now accepted. The corrected real roundtrip passes; both probes
  were ownership-checked and removed. All 37 Node and 18 Python checks pass.
  Private evidence stays in `.runtime/r2-checks`. No remote/app change yet.
- 2026-09-17: Implemented private R2 upload routing, target-only TLS egress,
  hash-guarded native S3 transports, bounded verified image copy, and exact
  three-config activation/rollback. Remote read-only inventory is one 16,804-byte
  image; both native S3 compiled hashes match. User expanded storage requirements
  to the R2 Standard free envelope. Added 9.9 GB effective upload reservation cap
  beneath 10 GB, plus shared Class A/B reservations with 10,000-request headroom
  and a rolling 32-day window. Failed operations remain counted. Native quota
  reservations are authenticated; missing quota service fails closed. No general
  server/AI egress, public bucket, model calls or posting. Local checks: 46 Node,
  21 Python and syntax. A raw local Compose check initially lacked private
  runtime env files; isolated generated configuration now renders successfully.
  These checks are not ARM deployment or real app/R2 evidence; remote remains
  `814be0f` pending the scoped rollout.
- 2026-09-17: Local commit `b6321d6` built on ARM and deployed only to
  gateway/server/AI. Dedicated R2 configuration transferred with 0600 mode;
  hash-guarded activation changed only the three services' storage settings.
  Existing source/environment retained at
  `.runtime/releases/pre-r2-source-814be0f.tar.gz`, configuration originals at
  `.runtime/r2-migration/original-config`, and original images retained. One
  16,804-byte local image was copied to the same key, verified, never removed.
  Real native browser file selection then passed signing, PUT and confirmation
  for the 56,898-byte authorized Model 003 JPEG; signature binds content length.
  Direct R2 bytes and old/private links match; desktop/mobile reads and anonymous
  denial pass. R2 inventory is two Standard objects / 73,702 bytes. Screenshots
  and object identifiers remain private in `.runtime/r2-app`.
  The browser verifier's first navigation wait failed before any upload; using
  DOM-ready navigation passed. The first restart check ran while Docker health
  was still starting; the subsequent health-aware check passed. Gateway restart
  retained one byte reservation and Class A/B counts of 1/7; no quota reset.
  Real server/AI unrelated CONNECT target and general Internet access are denied.
  Eight social services healthy, other eight business container IDs unchanged,
  23 GiB disk free. Exact image IDs: gateway
  `sha256:51c5448e45834c0bf2f7be4752fee58c00402eede28f161c7c405b21cc8df928`,
  server `sha256:45ba775f83c015247140e2077ad3bfe5117098a572070d18a4fed0fb13e8725c`,
  AI `sha256:35f25f8b400e1a1a99941c7c29cab29e8f43da29d7678c83f0784b5ba8907f8e`.
  Source/volume originals and R2 media remain intact; no storage rollback was
  executed. Video/public-media, model calls, social authorization and posting
  remain disabled. No Git push, public DNS/bucket changes or paid resource.
  Post-restart desktop/mobile readback and native confirmation passed without
  another upload. Added a reusable guarded browser check; syntax and all 21
  Python checks pass, with the unchanged 46 Node-test evidence retained.
- 2026-09-17: On explicit user authorization, located existing ccload on
  `147.224.48.149` (not `163.192.46.78`), upgraded it and local `/root/ccload` to
  pinned `v4.10.11-beta.6`. Verified private SQLite backups before changes and
  retained old images/configuration; exact rollback locations are in README.
  Remote initially failed its legacy HEAD health probe despite a working GET;
  the upstream GET probe fixes it. Both final Docker/HTTP health and database
  integrity pass. Remote received exactly one designated channel through native
  import and upstream credential validation; existing channels/tokens retained.
  Local retains 614 channels/2 access tokens/7 API keys/6,099 model entries.
  Environment files and unrelated container IDs are unchanged. No credentials
  were logged or committed, and the temporary import script was removed. No
  model-generation call, AiToEarn configuration change, social connection,
  publication, paid resource or Git push occurred.
