# LuxSabers Social

This is an independent AiToEarn deployment project. Do not modify the commerce,
Temu, community, AR, or mobile projects as part of this goal.

- Read the current implementation plan before continuing. Update the same record,
  not a new handoff for each session.
- Remote target: `ubuntu@163.192.46.78`. Reuse the existing protected SSH key;
  never copy its contents into this project. Verify host identity normally.
- Only this project's containers, files, networks, volumes, and optional
  `social.luxsabers.com` records are in write scope. Never prune Docker resources
  or restart unrelated services.
- No paid API calls, purchases, social connections, or public posts without the
  corresponding explicit authorization. Current budget is zero. Workers must
  default to paused and public publishing must fail closed.
- Do not inspect unrelated credentials, customer records, orders, or business
  databases. Keep secrets and runtime data outside Git and public logs.
- Use authorized product assets and current, source-backed claims. A test
  checkout must never be promoted as a functioning live purchase flow.
- Prefer upstream capabilities and small configuration changes. Pin versions and
  inspect actual runtime behavior; mock tests do not prove real publishing.
- Verify affected behavior, inspect the diff, and make local commits after useful
  implementation outcomes. Do not push without separate authorization.
- Preserve the complete user goal: secure deployment, real generation, an
  authorized platform, persistent scheduling, actual posting and result checks.
  Deployment alone is not goal completion.

Current plan:
`superpowers/docs/plans/2026-09-17-101328-01-plan-aitoearn-deployment.md`.

Resume checkpoint: remote `/srv/luxsabers-social` runs application release
`814be0ff08f78717e48ec771ff6c4dd38f4ddcde` with eight healthy isolated services.
Use private UI port 18880 and signed-image
port 19000 through the existing SSH tunnel; local 18080 belongs to another
service. Initial MongoDB and ARM gateway fixes are recorded in the plan. Real
HTTP login, source-matched private image upload, and real desktop/mobile workspace
checks pass. The SQLite companion, pause controls and hash-guarded native retry
patch are deployed. Real zero-budget resume denial, idle paused queues with
concurrency one, and automation-only restart with persistent pause pass.
Desktop/mobile controls pass at 1440x1000 and 390x844; screenshots stay private.
Models 003/018 pass source/image hashes and test-checkout checks from the server.
No model/provider calls. Local tests: 36 Node and 18 Python tests pass.
`scripts/prepare-media.py` now prepares source-hash-matched private JPEGs without
cropping, metadata or public upload. Both real Model 003/018 outputs and provenance
sidecars are local under ignored `.runtime/prepared-media`; they are not public
publishing assets yet. This local-tooling change does not alter deployed images.
Pre-upgrade cold snapshot
`20260917T121131Z-4433cc9` passed four isolated volume byte comparisons and
restored MongoDB/Redis startup. Restore-test copies were removed; backup retained.
Pause/resume races and same-flow restart recovery have focused regression tests;
real scheduled-post recovery is not yet verified. Never run a second worker
beside the Compose service. Eight unrelated business container IDs are unchanged.
Model budget remains zero and no social account is connected.

OBS addition: user owns bucket `pendjun`, endpoint
`obs.cn-south-4.myhuaweicloud.com`, bucket host
`pendjun.obs.cn-south-4.myhuaweicloud.com`, with a 40GB standard multi-AZ storage
package. Proposed isolated prefix is `luxsabers-social/`; do not read/list/change
other bucket contents. A key is stored disabled in ignored local `.private/obs.json`
(0600); never print it. User reports the traffic package expired. No OBS request,
credential transfer or integration has occurred. Do not assume a storage package
covers requests/egress or mutate bucket-wide policies. User explicitly authorized
one R2 bucket: `luxsabers-social-media` was created on 2026-09-17 at 13:19:30 UTC
through the existing Cloudflare MCP. Readback confirms Standard storage, default
jurisdiction, automatic placement reported as WNAM, r2.dev disabled and no custom
domains. No files were uploaded, credentials created or application settings
changed. Do not create another bucket or infer public access/billable-use
authority. Runtime bucket-scoped credentials, object access and AiToEarn storage
integration remain pending. Subscription metadata remains permission-denied;
the existing MCP login works. Both account/user token permission-group endpoints
return 9109; do not repeat login or seek a broad administrator credential.
Local `scripts/configure-r2.py` accepts hidden S3 key input for this bucket only
and preserves existing files; it has not been run with real keys.
`scripts/verify-r2.mjs --check-config` is offline; its explicitly invoked
`--private-roundtrip` uses one sub-1-KiB temporary object, at most seven requests,
no SDK retry, anonymous denial and ownership-checked removal. No real R2 object
request has occurred. Gateway region support and read-only R2 initialization are
local-only preparation; do not switch deployed storage before upload-signing
host routing, old-object continuity, egress and real app checks are addressed.
