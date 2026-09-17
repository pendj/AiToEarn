# LuxSabers Social

Private, single-operator AiToEarn deployment for the existing ARM server. The
initial release has no model credentials, no connected social accounts, and no
publishing authorization. It is not a completed social publishing service yet.

Verified application release: `814be0ff08f78717e48ec771ff6c4dd38f4ddcde`
(2026-09-17). Eight services are healthy; real private HTTP and desktop/mobile
controls pass. The worker stays paused across a service restart with no model
reservations or dispatches. This is not evidence of a real generated or published
post. The existing unrelated business containers were not recreated or restarted.

## Scope and design

- Upstream source and Linux ARM64 images are pinned in `images.lock.json`.
- MongoDB, Redis, app services, and storage have their own internal Docker
  network and volumes. AI/server have no external egress initially; the small
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

Requires Node.js 22+, npm, Python 3 with Pillow, and Docker Compose for
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

AiToEarn still uses its existing private local object store. R2 integration
requires credentials limited to this bucket, a scoped real upload/download
check, cost controls, and an authorized platform-readable media access design.
Do not reuse MCP OAuth as an application storage credential or enable public
bucket access implicitly. No service restart or application rollback is needed
for this bucket-only change. If it is later abandoned, verify it is still empty
and unused and obtain deletion approval; never delete objects to force removal.

## Deployment

Target: `ubuntu@163.192.46.78`; deployment directory `/srv/luxsabers-social`.
All following commands run inside that directory.
Transfer only committed deployment files, never local `node_modules`, `.private`,
or unrelated workspace files. Pin `<verified-commit>` to a full local Git SHA.

```sh
python3 scripts/provision.py
python3 scripts/provision-automation.py
python3 scripts/prepare-release.py --release <verified-commit>
docker compose config --quiet
docker compose build gateway server
docker compose pull mongodb redis storage ai web
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
running both provisioning scripts and `prepare-release.py`, build the two local
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
  Operator asset allowance starts at 512 MiB; per-file limit is 50 MiB. Logs are
  capped at 2 x 5 MiB per service. Incomplete multipart uploads expire after
  seven days; confirmed user assets are retained until deliberate removal.
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
  not uploaded to OBS/R2 or automatically deleted.
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

## Cost and account boundaries

MIT software licensing is free. The existing server does not remove model,
social API, relay, storage, or traffic charges. Current approved spend is zero.
Do not use another application's key or subscribe to a paid service implicitly.

Huawei OBS is disabled: its supplied key remains only in ignored local private
configuration; the user reports the traffic package expired. No OBS requests or
migration occurred. The private R2 bucket above now exists under specific user
authorization; no uploads, runtime integration or approval for ongoing billable
usage were added.
R2 free allowances are account-wide, not a hard spending cap. Billing metadata
is permission-denied, which is not an expired login. Do not request a full
re-login based on that denial alone.

The complete execution state and required real-service evidence are maintained
in `superpowers/docs/plans/2026-09-17-101328-01-plan-aitoearn-deployment.md`.
