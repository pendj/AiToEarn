# LuxSabers Social

Private, single-operator AiToEarn deployment for the existing ARM server. The
initial release has no model credentials, no connected social accounts, and no
publishing authorization. It is not a completed social publishing service yet.

## Scope and design

- Upstream source and Linux ARM64 images are pinned in `images.lock.json`.
- MongoDB, Redis, app services, and storage have their own internal Docker
  network and volumes. No application egress is enabled initially.
- Only `127.0.0.1:18080` (authenticated workspace) and `127.0.0.1:19000`
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

Requires Node.js 22+, npm, Python 3, and Docker Compose for configuration checks.

```sh
npm ci
npm test
npm run check
```

Unit tests use synthetic credentials and a local test HTTP server. They prove
gateway behavior, not real AI connectivity, social account access, or publishing.
Do not print rendered Compose configuration after secret provisioning; use
`docker compose config --quiet` instead.

## Deployment

Target: `ubuntu@163.192.46.78`; deployment directory `/srv/luxsabers-social`.
All following commands run inside that directory.
Transfer only committed deployment files, never local `node_modules`, `.private`,
or unrelated workspace files. Pin `<verified-commit>` to a full local Git SHA.

```sh
python3 scripts/provision.py
python3 scripts/prepare-release.py --release <verified-commit>
docker compose config --quiet
docker compose build gateway
docker compose pull mongodb redis storage ai server web
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

## Private access

Keep this forwarding session open on the local machine:

```sh
ssh -i /root/.ssh/163.192.46.78.key -o IdentitiesOnly=yes -o ForwardAgent=no -o ExitOnForwardFailure=yes -N -L 127.0.0.1:18080:127.0.0.1:18080 -L 127.0.0.1:19000:127.0.0.1:19000 ubuntu@163.192.46.78
```

Then open `http://127.0.0.1:18080/session/login`. Session status and sign-out are
at `/session`. HTTP cookies are allowed only for the private SSH-forwarded
loopback setup. Any later HTTPS exposure must enable Secure cookies, update
trusted origins, and retain private management access controls.

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
- Backup: before an update with data, stop only this project's writers, take a
  consistent dump of its MongoDB and its own Redis/storage volumes, and protect
  the matching `.private/` configuration in a restricted backup directory.
  Restore into isolated test volumes before claiming a verified backup. No
  successful backup/restore claim is made by this initial runbook.

## Cost and account boundaries

MIT software licensing is free. The existing server does not remove model,
social API, relay, storage, or traffic charges. Current approved spend is zero.
Do not use another application's key or subscribe to a paid service implicitly.

The complete execution state and required real-service evidence are maintained
in `superpowers/docs/plans/2026-09-17-101328-01-plan-aitoearn-deployment.md`.
