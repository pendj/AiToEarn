# LuxSabers Social

Private, single-operator AiToEarn deployment for the existing ARM server. A
restricted model connection and private quota reader are verified, but generation
is not enabled. No social account or publishing grant is configured. This is not
a completed social publishing service yet.

Verified gateway/AI release: `5dff12c32f2339762d597bc269aff72534c1a08b`
(2026-09-18); server remains `b6321d6`, automation `814be0f`, with private R2 media.
Eight services are healthy; real private HTTP, native image upload, exact R2
download and desktop/mobile controls pass. The worker remains paused with no model
reservations or dispatches. This is not evidence of a real generated or published
post. The existing unrelated business containers were not recreated or restarted.

## Scope and design

- Upstream source and Linux ARM64 images are pinned in `images.lock.json`.
- MongoDB, Redis, app services, and storage have their own internal Docker
  network and volumes. AI/server have only target-specific R2 egress; the small
  automation companion can check the allowlisted public commerce sources.
- Only `127.0.0.1:18880` (authenticated workspace) and `127.0.0.1:19000`
  (short-lived, signed image uploads via the gateway) are bound on the host.
  The object store itself has no host port. Uploads are limited to JPEG, PNG,
  or WebP, at most 50 MiB, and the signed URL is verified by the real S3 service.
- The upstream automatic administrator token is disabled. A small private
  gateway authenticates the operator, uses an HttpOnly encrypted session, and
  signs a five-minute upstream JWT only on the server. The frontend's local
  storage marker is not a usable credential.
- Raw configuration and credential-management APIs are blocked at the gateway.
  Model calls, account connections, and publication remain blocked pending
  their specific authorizations. An upstream config file is not a secret UI.
- This adapter depends on the pinned upstream `User` store format; verify it
  before updating the web image. Future public OAuth callbacks need a separately
  scoped route and must not bypass private management authentication.

## Local verification

In a checkout of `pendj/AiToEarn` on `main`, first run
`cd deploy/luxsabers-social`. Commands in this guide use this deployment directory
as their working directory, not the repository root. The root Compose file is
the upstream quick-start and is not used for the private LuxSabers installation.
The original `luxsabers-social` branch is retained as the import source.

Requires Node.js 22.21+ or 24.5+, npm, Python 3 with Pillow, and Docker Compose for
configuration checks. Media conversion is tested with the host's Pillow 10.2.0;
each prepared image records the encoder version. Pillow is local tooling, not
a new deployed application service.

```sh
npm ci
npm test
npm run check
```

Unit tests use synthetic credentials and a local test HTTP server. They prove
gateway behavior, not real AI connectivity, social account access, or publishing.
Do not print rendered Compose configuration after secret provisioning; use
`docker compose config --quiet` instead.

## Private publishing media

Registered product photos can be prepared locally before platform/storage
authorization. This tool uses only source-hash-matched images from
`automation/sources.json`; it reuses the private asset cache when available.

```sh
python3 scripts/prepare-media.py --source model-003-exterior
python3 scripts/prepare-media.py --source model-018-exterior
```

JPEG files and provenance sidecars stay in ignored `.runtime/prepared-media/`
(directory 0700, files 0600). Output is 1080x1080, retains the complete image
without cropping or enlarging it, uses white padding when needed, and removes
EXIF metadata. Unsupported color profiles stop for review rather than silently
changing the product colors. Existing differing outputs are never overwritten.
The original image and source records are unchanged. The sidecar contains both
original and output SHA-256 hashes; it is not a publishing grant.

Models 003/018 have real prepared private JPEGs (56,898 and 86,102 bytes).
Nothing is uploaded to OBS/R2 or published by this command. Platform-readable
URLs, actual provider acceptance and source freshness at send time are separate
checks required before publishing.

## R2 storage status

The user-authorized bucket `luxsabers-social-media` was created through the
existing Cloudflare MCP on 2026-09-17 at 13:19:30 UTC. It uses Standard storage
and the default jurisdiction; automatic placement returned WNAM. Fresh metadata
readback confirms r2.dev access is disabled and no custom domains are attached.
This operation uploaded no objects and created no runtime credentials.

AiToEarn now uses this private R2 bucket. The existing 16,804-byte image was
copied at its original key, with the local original preserved. One authorized
56,898-byte JPEG passed actual native browser upload, confirmation, direct R2
byte comparison and desktop/mobile private reads. Total: two Standard images,
73,702 bytes. Anonymous access is denied. Persistent storage/request guards pass,
including gateway restart. Authorized platform-readable media remains pending.
Do not reuse MCP OAuth as an application storage credential or enable public
bucket access implicitly. The bucket is in use; do not delete it or its contents.
The exact application rollback is documented below and preserves R2 objects.

The existing MCP can manage this bucket, but both account and user token
permission-group endpoints return error 9109. Do not repeat login or use a broad
administrator key. In Cloudflare R2 > Overview > Manage API Tokens, create an
account or user token with **Object Read & Write**, limited to
`luxsabers-social-media` only. Do not choose Admin Read & Write or all buckets.
The [official R2 authentication guide](https://developers.cloudflare.com/r2/api/tokens/)
describes the distinction. Existing credentials are already configured; do not
request or create another token without need. For a fresh installation only:

```sh
python3 scripts/configure-r2.py
node scripts/verify-r2.mjs --check-config
```

Both prompts hide input. The helper writes only `.private/r2.json` (0600),
refuses existing files, and does not upload, transfer credentials or switch the
application. The offline check validates the target, file mode and key format,
not actual permission scope or service access.

After free allowance/cost authority is confirmed, an explicitly invoked
`node scripts/verify-r2.mjs --private-roundtrip` performs at most seven requests
with SDK retries disabled: one less-than-1-KiB random temporary object, metadata,
exact download, anonymous GET denial, ownership-checked cleanup and absence
check. It never lists other objects or migrates media. Private intent and result
files remain under `.runtime/r2-checks`; an interrupted check's intent identifies
the exact probe for recovery. Unknown ownership prevents deletion. A failed or
ambiguous write is not automatically repeated. These calls still consume R2
operations; the tool is not a billing cap. The first real check found that R2
returns 400 with `InvalidArgument` / `Authorization` for unsigned requests. The
checker now recognizes that exact response, while rejecting other 400 responses;
the corrected real check passes. Both probes were removed. Application migration
and verification now also pass. Current usage is well below the Standard free
allowances, but those allowances are shared and are not a hard spending limit.

The local gateway now honors the configured storage signing region. Its R2
initializer performs only a bucket HEAD, never bucket creation, CORS, policy or
lifecycle writes. Signed-upload host routing, old-object continuity, restricted
server/AI egress and actual desktop/mobile image reads have been verified.
`node scripts/verify-r2-app.mjs --private-image` uses the real browser file input,
never generation/publishing. Its ignored local intent/result prevents repeated
uploads on rerun; failures must be reconciled, not bypassed by deleting evidence.
The check requires the existing SSH tunnel and prepared Model 003 JPEG.

### Private R2 migration

The integration uses native S3 signing for the real R2 host, a private upload
proxy with CORS/type/size checks, and a target-only TLS CONNECT listener on
gateway port 8082 (no host/public port). The native server and AI retain their
internal-only networks. Both compiled S3 modules are hash-checked before adding
the explicit HTTPS proxy agent; non-R2 configuration remains unchanged.

R2 upload intents reserve bytes in `/data/media.sqlite` before signing. The
initial private allowance is 10 GB (10,000,000,000 bytes), including migrated
images, with a 100 MB safety reserve: new uploads stop at 9.9 GB reserved bytes.
At most 32 intents/day are enabled. Stored bytes do not reset each month.
The Standard free request limits are 1,000,000 Class A and 10,000,000 Class B;
the shared persistent ledger stops 10,000 operations short of each limit, using
a conservative rolling 32-day window across billing boundaries. Gateway reads,
signed upload requests and native S3 calls reserve quota before remote access.
The native reservation RPC is authenticated and private. Unknown operation types
or an unavailable quota service fail closed. Failed intents/calls stay reserved
until deliberate reconciliation;
do not remove the ledger to reset usage. This is an application limit, not an
account-wide Cloudflare billing cap. Video upload and public media remain off.
Failed/abandoned uploads remain reserved conservatively. Deleting an image does
not automatically reclaim the ledger allowance; reconcile exact object state
before adjusting it. Do not delete database rows to reset limits each month.
These are Standard-storage allowances, not Infrequent Access allowances.

For the existing installation, after building the reviewed gateway/server/AI
images, securely transfer only `.private/r2.json` with mode 0600. Never print it.
Preserve the previous `.env` and source revision. Stop only `gateway server ai`
to freeze image writes, then copy the reviewed source images without deleting
the originals or overwriting any conflicting R2 object:

```sh
docker compose stop gateway server ai
docker compose run --rm --no-deps -v /srv/luxsabers-social/scripts:/app/scripts:ro -v /srv/luxsabers-social/.private:/migration/.private:ro -v /srv/luxsabers-social/.runtime/r2-migration:/migration/.runtime/r2-migration gateway node scripts/migrate-r2.mjs --copy /migration
python3 scripts/activate-r2.py
docker compose config --quiet
docker compose up -d --no-deps --wait --wait-timeout 180 gateway ai server
```

Private `.runtime/r2-migration/copy.json` records exact keys, byte hashes and
source/configuration identity; `activation.json` and `original-config/` preserve
only the three affected configurations. Run real HTTP and browser verification,
including original `/oss/` links, a new upload, confirmation and exact R2 bytes.
Do not call migration complete before those checks pass.

Rollback storage configuration with `python3 scripts/activate-r2.py --rollback`
while the three affected services are stopped. It refuses later-edited configs.
Restore the prior source revision and matching retained `.env`, validate Compose,
then restart only `gateway ai server` with `--no-build --no-deps`. Local originals
and all R2 objects remain untouched. New R2-only images remain recoverable in R2
but are not visible through the original local-storage app until reactivation or
an explicitly verified reverse copy. Preserve the media allowance ledger too.

The deployed switch retains `.runtime/releases/pre-r2-source-814be0f.tar.gz`
(original source and `.env`) and the exact original configurations under
`.runtime/r2-migration/original-config/`. To undo this switch only, from
`/srv/luxsabers-social`, before making later application/config changes:

```sh
docker compose stop gateway server ai
python3 scripts/activate-r2.py --rollback
tar -xzf .runtime/releases/pre-r2-source-814be0f.tar.gz -C /srv/luxsabers-social
docker compose config --quiet
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 gateway ai server
```

The original `814be0f` gateway/server tags and pinned upstream AI image are
retained. Do not roll back databases or automation authority. This rollback has
not been executed; the bounded copy and original-byte checks passed.

## Deployment

Target: `ubuntu@163.192.46.78`; deployment directory `/srv/luxsabers-social`.
All following commands run inside that directory.
Transfer only committed deployment files, never local `node_modules`, `.private`,
or unrelated workspace files. Pin `<verified-commit>` to a full local Git SHA.
For a `main` commit, export only the tree
`<verified-commit>:deploy/luxsabers-social`, keeping its contents directly under
`/srv/luxsabers-social`. Do not transfer the whole fork or overwrite existing
private configuration, runtime state, or volumes. Git integration itself does
not update any running service.

```sh
python3 scripts/provision.py
python3 scripts/provision-automation.py
python3 scripts/prepare-release.py --release <verified-commit>
docker compose config --quiet
docker compose build gateway server ai
docker compose pull mongodb redis storage web
docker compose up -d
docker compose ps
```

Provisioning creates unique secrets in `.private/` (directory 0700, files 0600).
It refuses partial/conflicting state and does not rotate existing credentials.
The username is `luxsabers`; the generated password is in the protected
`.private/operator-password.txt` file. Never paste credentials into chat or Git.
Do not run host-wide prune/cleanup, `down -v`, or remove data volumes.
The apps run directly as the deployment UID, without the upstream command that
appends public resolvers to `/etc/resolv.conf`. The gateway uses a pinned glibc
ARM64 base because its session-encryption library has no musl ARM64 prebuild.
The native encryption module is loaded during the image build as a smoke check.
The derived server disables the pinned upstream's automatic publish retries;
the patch refuses an unexpected compiled source hash rather than editing an
unknown version.

For an existing installation, first run the scoped backup below using the
currently deployed configuration. After transferring the reviewed source and
running both provisioning scripts and `prepare-release.py`, build the required
images, then update only the changed services:

```sh
docker compose run --rm --no-deps automation-init
docker compose up -d --no-deps --wait --wait-timeout 180 server automation gateway
```

## Private access

Keep this forwarding session open on the local machine:

```sh
ssh -i /root/.ssh/163.192.46.78.key -o IdentitiesOnly=yes -o ForwardAgent=no -o ExitOnForwardFailure=yes -N -L 127.0.0.1:18880:127.0.0.1:18880 -L 127.0.0.1:19000:127.0.0.1:19000 ubuntu@163.192.46.78
```

Then open `http://127.0.0.1:18880/session/login`. Session status and sign-out are
at `/session`. HTTP cookies are allowed only for the private SSH-forwarded
loopback setup. Any later HTTPS exposure must enable Secure cookies, update
trusted origins, and retain private management access controls.

## Daily automation

- `/session` shows the worker heartbeat, daily budget, draft history and native
  publication outcomes. `/session/automation.json` is also session-protected.
- The worker persists its pause flag, daily intent, source evidence, cost
  reservations and dispatch IDs in `.runtime/automation/automation.sqlite`.
  It checks every 15 seconds and proposes one theme at 13:00 America/New_York;
  preparation is limited to 12:00-14:00 and sends to 13:00-14:00 local time.
- `.private/automation-authority.json` starts with no model or publishing grant.
  The browser cannot change grants. Resume is rejected without a current model
  grant and does not itself release native publishing queues.
- A pause prevents new submissions and settles the native queues paused. An
  already-started provider request may still finish; pause is not post deletion.
  The status page's native verification confirms provider metadata/caption, not
  an independent public-browser image comparison or the initial live acceptance.
- A dispatch is persisted before the sole flow-create request. After restart,
  only an exact read-back of that same queued flow can release it, within the
  current window, unchanged grant and source checks. Unknown results receive at
  most six readbacks, then pause for reconciliation; they are never resubmitted.
- Do not run a second worker or invoke one-off ticks beside the Compose worker.
  Retain private state when restarting; do not delete it to clear a failed day.

Initial zero-authorization runtime check (no model or provider requests):

```sh
docker compose exec -T automation node --input-type=module < scripts/verify-paused-worker.mjs
python3 scripts/verify-http.py
```

## Operations and recovery

- Startup/update: change only this project's reviewed files/image pins, record
  the commit and existing image IDs, preserve `.private/` and volumes, validate,
  then recreate only changed project services. Confirm other containers retain
  their IDs/start times and health.
- Resource stop: do not deploy below 12 GiB free disk. Pause new content/upload
  jobs below 10 GiB free disk. No local model inference or video generation.
  R2 private media allowance is capped at 10 GB total; per-file limit is 50 MiB. Logs are
  capped at 2 x 5 MiB per service. R2 multipart/video uploads are disabled; no
  bucket-wide lifecycle was changed. The retained local store's seven-day
  incomplete-upload rule does not imply an R2 lifecycle. Confirmed assets are
  retained until deliberate removal.
- Emergency isolation: from this exact project directory, `docker compose stop`
  stops only this new stack and keeps its volumes. This is the first-install
  rollback and does not require changing the existing proxy or commerce app.
- Application rollback: retain the previous committed deployment files and
  gateway image tag. Restore the matching `.runtime/releases/<sha>.env`, run
  `docker compose config --quiet`, then `docker compose up -d --no-build` with
  those files. Do not downgrade database/storage versions across incompatible
  schemas. A later data migration requires a verified backup first.
- Backup: `python3 scripts/project-backup.py snapshot` briefly stops only this
  project's running services, archives its four cold volumes and private
  configuration, including `.runtime/automation` when present, then starts the
  same services. Run from the exact deployment
  directory. Backups are private under `.runtime/backups/<snapshot-id>/` and are
  not uploaded to OBS/R2 or automatically deleted. This backup does not copy
  R2-only objects; those require a separately budgeted object backup strategy.
- Verify recovery: `python3 scripts/project-backup.py verify --snapshot <snapshot-id>`
  verifies all checksums, restores into new isolated volumes, compares every
  volume's bytes, starts restored MongoDB/Redis with no network access, and
  removes only those newly created test copies. It never restores over live data.
  The original backup stays available. This does not prove an off-server backup.
- Application rollback for the automation upgrade: stop `automation`, `gateway`
  and `server` in this project; recover the snapshot's `compose.yaml`, `.env`,
  `images.lock.json`, `gateway/`, `scripts/` and `.private/gateway.json` using
  `tar -xzf .runtime/backups/<snapshot-id>/configuration.tar.gz <exact-members>`.
  Then run `docker compose config --quiet` and
  `docker compose up -d --no-build --no-deps server gateway`. Leave the stopped
  automation container and all data volumes intact. Do not restore the complete
  secret directory or roll live databases back just to revert application code.

The retained pre-upgrade snapshot is `20260917T121131Z-4433cc9`. Its matching
gateway image `luxsabers-social-gateway:4433cc94318daa07c83988ebcb8f0e5c1e923b81`
and pinned upstream server image remain on the host. The snapshot's four volume
restores and MongoDB/Redis startup passed before this upgrade. Application
rollback has not been executed; it must keep the native queues paused and must
not restore any grant or enable publishing implicitly.

## Model gateway connection

On 2026-09-17, the user separately authorized maintenance of existing ccload
deployments. Remote runs `ghcr.io/caidaoli/ccload:v4.10.11-beta.6`, pinned to
`sha256:fbe81b27c813387b3f015a7e64821f22ab4cde0d246d9f39d740c1a3223bc3d9`.
Local subsequently moved to `ghcr.io/caidaoli/ccload:v4.10.11-beta.7`, pinned to
`sha256:d7e89be275a3eb6aa816aa295df1a49888f5d223c083a39b4c916ec3b135ce4e`.
Both are prereleases; beta.7 was the latest release at the local upgrade check.

- Remote: `ubuntu@147.224.48.149`, `/home/ubuntu/ccload`, existing loopback API
  `127.0.0.1:18080`; not the AiToEarn server. Upgraded from `v4.6.21-beta.1`.
  One designated Codex Pro channel was imported using ccload's native endpoint
  over SSH, with upstream credential validation. Total: 3 channels, 2 access
  token, 1 API key and 27 model entries. No model-generation call was made.
- Local: `/root/ccload`, UI `http://127.0.0.1:8080/web/`. Upgraded from
  `v4.10.10-beta.3` through beta.6 to beta.7; retains 614 channels, 2 access tokens,
  7 API keys and 6,099 model entries. Local account and environment configuration
  are unchanged. The beta.7 change modifies only the Compose image reference.
- Both services pass HTTP/Docker health and SQLite integrity/foreign-key checks.
  Other container IDs are unchanged. Remote's legacy HEAD health probe was
  replaced with the upstream GET probe; no ports, proxy or environment changed.
- Local beta.7 verification: Docker healthy with zero restarts; health and web
  HTTP 200; anonymous admin and model APIs HTTP 401; SQLite integrity and foreign
  keys pass. Fourteen other running container IDs are unchanged. One startup
  model-catalog fetch logged an upstream connection reset; existing model
  entries remain intact. No model-generation request was used for verification.

Protected online SQLite backups also contain the original Compose and environment:

- Remote: `/home/ubuntu/ccload/backups/pre-v4.10.11-beta.6-lmdFlchB`.
- Local beta.7 rollback to beta.6:
  `/root/ccload/data/backups/pre-v4.10.11-beta.7-k4dQH8ZE`.
  The retained beta.6 runtime image is
  `sha256:d3da99428b4e5c3b091568db52bc1024f109c5200f6dc4ca0b6a1ebce3758f8f`.
- Earlier local rollback to `v4.10.10-beta.3`:
  `/root/ccload/data/backups/pre-v4.10.11-beta.6-TddqPJWG`.

Old images are retained. For an authorized rollback, first make a fresh online
SQLite backup in a new protected directory, then stop only `ccload` using that
host's exact Compose file. Preserve the stopped database and any WAL/SHM files
in that new directory; restore the pre-upgrade database and original Compose,
validate configuration, and start only `ccload` with `up -d --no-deps ccload`.
Verify health and database counts. Never overwrite a running database. Restoring
the old database removes later state, including the newly imported remote
channel; environment restoration is unnecessary unless independently changed.
No rollback has been executed.

A dedicated native access token (ID 2) now permits only channel 3 and
`gpt-5.6-luna`, with concurrency one and a seven-day expiry. Its creation followed
an integrity-checked online backup at
`/home/ubuntu/ccload/backups/pre-social-model-o9r4pr9b/ccload.db`. The existing
token is unchanged. The scoped connection file is protected at
`/home/ubuntu/ccload/.private/luxsabers-social-model.json` and in this project's
local/remote `.private/ccload-model.json`; no admin/OAuth credential is copied
to AiToEarn. Read-only HTTPS checks from the social server return only Luna
(200) and deny admin access (401). The initial default Python request identifier
was denied by Cloudflare; the explicit `LuxSabers-Social/1.0` identifier passes,
without firewall, DNS or proxy changes.

Connection release `5dff12c32f2339762d597bc269aff72534c1a08b` is deployed to
gateway/AI only. Server remains `b6321d6`, automation `814be0f`. It adds only
internal gateway port 8083, with no host publication or native-service network expansion.
The native AI gets a separate internal key, not the ccload token. Only filtered
model metadata and bounded text chat are supported. Generation requires the
existing authority, unpaused state and daily reservation; its upstream attempt
is persisted before sending and cannot be repeated after an ambiguous result.
Native SDK retries are disabled with a pinned-artifact hash guard.

For activation, first preserve exact old source/images/environment and make an
online automation SQLite backup. Transfer reviewed source only, then run as the
deployment user, not root:

```sh
python3 scripts/activate-model.py --root /srv/luxsabers-social
python3 scripts/prepare-release.py --release <verified-commit>
docker compose config --quiet
docker compose build gateway ai
docker compose up -d --no-deps --wait --wait-timeout 180 gateway ai
docker compose exec -T gateway node --input-type=module < scripts/verify-model-connection.mjs
```

`activate-model.py` changes only `.private/gateway.json` and `.private/ai.yaml`;
originals and hashes stay in `.runtime/model-connection/original-config` and
`activation.json`. All authority, R2, publishing and worker settings remain
unchanged. The verifier checks actual provider metadata, native registration and
unauthorized generation denial; it refuses an authorized model configuration.
It does not verify generation. Rollback uses the same script with `--rollback`,
matching pre-change source/environment and only the old gateway/AI images. It
refuses later configuration edits. Preserve media, authority and the additive
`model_requests` table; do not restore an old live database to erase attempts.
Never remove an attempt to force a retry. Replace an expiring scoped token only
through ccload's native management interface, retaining the same restrictions;
an expired token stops the connection, not the rest of the app.

Real post-deployment checks pass: filtered HTTPS provider metadata, native model
registration, unauthorized gateway/native chat denial, zero generation attempts,
private HTTP login and desktop/mobile workspace/controls. All eight services
are healthy; eight business containers and six unchanged social containers keep
their IDs/start times. Existing R2 reservations (56,898 bytes plus the recorded
original) and request ledger remain intact. No model inference or public post
was made. Local checks pass 53 Node tests, 23 Python tests and syntax.

Exact deployment rollback assets are under remote `.runtime/model-connection`:
`pre-model-source.tar.gz`, `pre-model.env`, `original-config/`, `activation.json`,
`baseline.json`, and integrity-checked online `pre-model-automation.sqlite` /
`pre-model-media.sqlite` snapshots. The first backup precheck used an incorrect
media filename and stopped before configuration/deployment; the corrected
`media.sqlite` check passed without overwriting the first valid backup.
The retained old gateway/AI image references both use full release
`b6321d67fd070f15c2ab90a959682276e5b533a7`. To revert this connection only, from
`/srv/luxsabers-social`, first confirm the recorded configuration hashes still
match, then:

```sh
python3 scripts/activate-model.py --rollback
tar -xzf .runtime/model-connection/pre-model-source.tar.gz compose.yaml images.lock.json ai automation gateway server
cp -p .runtime/model-connection/pre-model.env .env
docker compose config --quiet
docker compose up -d --no-deps --no-build --wait --wait-timeout 180 gateway ai
```

Keep the new protected connection file, manifest and database attempts for
audit; do not restore the SQLite snapshots for an application-only rollback.
No rollback was executed. The current image IDs are gateway
`sha256:6734b0ea17685b6914e5ed8e717257ef79d3834b6b02bf71aff9838ef11eafe2`
and AI `sha256:2dce43c3c5410333c5f34b384f700c72f8e82e0aab7604328ae7fe68d160bb5a`.

Real generation remains pending. The read-only designated Pro quota reports
usage available and no purchased credits, but that is not a durable spending
cap. ccload's zero cost limit means unlimited. Do not change the existing
`hardProviderLimitVerified` flag without evidence or enable paid fallback.
Subscription usage and additional purchased credits are distinct:
https://learn.chatgpt.com/docs/pricing.md .
Both copies currently share the account's OAuth session;
independent renewal and concurrent long-term use have not been verified. Codex
subscription sign-in is not a general OpenAI Platform API key:
https://learn.chatgpt.com/docs/auth . Paid-call budget remains zero, and automation
and public publishing remain paused.

## Private Codex quota reader

On 2026-09-18 the user authorized this additional read-only access. It is deployed
outside the application containers and adds no public listener or scheduled job.
Run on `ubuntu@163.192.46.78`:

```sh
python3 /srv/luxsabers-social/scripts/codex_quota.py
python3 /srv/luxsabers-social/scripts/verify-codex-quota.py
```

The first command returns only sanitized quota status for the pinned channel 3.
The second also verifies cache reuse, denial of arbitrary commands/other-channel
arguments and denial of SSH port forwarding. It reads real services, not a mock.
Neither command generates content, refreshes OAuth, buys/resets credits, changes
authority or publishes. The upstream usage endpoint is an internal interface
already used by pinned ccload, not a guaranteed stable public API. An incompatible
response, expired credential, timeout or connection failure stops the check.

The client key stays on the social host at `.private/quota-readonly/id_ed25519`
(0600) and is not mounted into any app container. The adjacent `known_hosts`
pins the previously verified ccload SSH host key. The ccload host has exactly one
additional `authorized_keys` line, restricted to source `163.192.46.78`, with
`restrict` and a fixed `/usr/bin/python3 -I` command. Only `quota-v1` is accepted.
Shells, other commands, PTY, agent/X11/port forwarding and user RC are disabled;
sshd configuration, existing keys and ccload's image/configuration are unchanged.

The root-owned helper/scope live under `/opt/luxsabers-codex-quota`. It opens the
existing SQLite database read-only, selects only channel 3 and verifies the pinned
account identity before making one fixed HTTPS GET, with no proxy or redirects.
OAuth/admin credentials never reach the social host or the output. A 60-second
sanitized cache and exclusive lock bound repeated requests; interrupted or failed
requests retain their attempt timestamp. No raw provider response is persisted.
Freshness and zero purchased credits are observations, not a lasting spending cap;
`spendingCapVerified` and `grantsGeneration` are always false. No application
preflight or model-authorization flag was weakened to accept these observations.

Verified helper SHA256:
`aef42a740b34e17b6c126bf1be2a835de5a34c1d5b9c8b60b34f99044dcf5374`.
The installation record and exact prior authorized keys are root-only under
`/var/lib/luxsabers-codex-quota-install`. To revoke this access, use the retained,
reviewed installer on `147.224.48.149`:

```sh
sudo -n /usr/bin/python3 -I /home/ubuntu/ccload/.runtime/quota-readonly/install-codex-quota.py --revoke
```

Installer SHA256:
`e0fa3d5abc78386d164b080f94714a67a4b1e58a0410135ff94f749c61d3676b`.
Revocation removes only the exact added key, preserving later user keys. It
restores original bytes when there are no later edits and retains code/state/audit
files. Do not replace the whole current authorized-keys file with an old backup.
After revocation, the client must fail while the original administrator SSH
connection continues working. This production revocation has not been performed;
exact restoration and later-key preservation pass local regression tests.

Final real verification passed on 2026-09-18: available Pro allowance, no purchased
credits, fresh cache reuse, four command denials and authenticated forwarding
denial. The initial verifier expected a denial string suppressed by SSH's ERROR
log level; private VERBOSE capture corrected the test without changing access.
All 10 ccload-host and 16 social-host containers retained their IDs/start times,
all listeners were unchanged, and ccload remained healthy. Existing social private
configuration and the designated credential are unchanged; budget, model attempts
and dispatches remain zero and automation remains paused. Baseline/verification
records stay under each deployment's ignored `.runtime/quota-readonly` directory.
Local syntax and all 35 Python tests pass, including 12 new quota tests. No model
generation, social connection, public post, paid resource or Git push occurred.

## Cost and account boundaries

MIT software licensing is free. The existing server does not remove model,
social API, relay, storage, or traffic charges. Current approved spend is zero.
Do not use another application's key or subscribe to a paid service implicitly.

Huawei OBS is disabled: its supplied key remains only in ignored local private
configuration; the user reports the traffic package expired. No OBS requests or
migration occurred. R2 integration is authorized only inside the Standard free
envelope: 10 GB-month, 1M Class A and 10M Class B requests/month, with no R2 egress
charge. See https://developers.cloudflare.com/r2/pricing/ . Application limits
stop at 9.9 GB total reserved storage and 10,000 requests short of each allowance.
No ongoing billable usage is approved. Storage does not reset at month-end.
R2 free allowances are account-wide, not a hard spending cap. Billing metadata
is permission-denied, which is not an expired login. Do not request a full
re-login based on that denial alone.

The complete execution state and required real-service evidence are maintained
in `superpowers/docs/plans/2026-09-17-101328-01-plan-aitoearn-deployment.md`.
