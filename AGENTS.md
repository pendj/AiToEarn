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

Resume checkpoint: remote `/srv/luxsabers-social` gateway/server/AI run release
`b6321d67fd070f15c2ab90a959682276e5b533a7` with private R2 storage. Automation
remains on `814be0f`; all eight services are healthy. No unrelated container was
recreated or restarted.
Use private UI port 18880 and signed-image
port 19000 through the existing SSH tunnel; local 18080 belongs to another
service. Initial MongoDB and ARM gateway fixes are recorded in the plan. Real
HTTP login, source-matched private image upload, and real desktop/mobile workspace
checks pass. The SQLite companion, pause controls and hash-guarded native retry
patch are deployed. Real zero-budget resume denial, idle paused queues with
concurrency one, and automation-only restart with persistent pause pass.
Desktop/mobile controls pass at 1440x1000 and 390x844; screenshots stay private.
Models 003/018 pass source/image hashes and test-checkout checks from the server.
No model/provider calls. R2 implementation passes 46 Node and 21 Python tests,
including isolated Compose rendering. ARM build and actual app verification pass.
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

OBS is disabled: the user reports the traffic package expired. The unused key
remains only in ignored local `.private/obs.json`; no OBS request or transfer.

R2: dedicated bucket `luxsabers-social-media`, Standard/WNAM, r2.dev disabled and
no custom domains. Supplied S3 keys are in local/remote `.private/r2.json` (0600);
never print them. The separately supplied API token was not stored or used.
Existing Cloudflare MCP login works; permission-group/subscription metadata is
denied. Do not repeat login or seek broad admin keys. Wider S3 credential scope
has not been independently proven. Direct private roundtrip already passes;
both tiny probes were removed. Unsigned R2 GET uses the exact
400/InvalidArgument/Authorization response, not arbitrary HTTP 400.
One 16,804-byte original was copied without deleting the local object. A real
56,898-byte source-matched JPEG upload through the native browser UI passed
sign/PUT/confirm, exact R2 bytes and desktop/mobile private reads. Total R2 usage
at delivery: two Standard images, 73,702 bytes. Original `/oss` links work.
Evidence stays private under `.runtime/r2-app` and remote `.runtime/r2-migration`.
The browser verifier reuses its recorded object on rerun; never remove its intent
to force a second upload after an ambiguous result.
Native server/AI remain internal-only. Their target-only CONNECT proxy permits
only this R2 endpoint; real unrelated-target and general-egress denial pass.
Only gateway/server/AI storage fields changed; other config and services retained.
User requires the complete R2 Standard free envelope: 10 GB total storage, 1M
Class A and 10M Class B operations/month. Local implementation reserves 100 MB
and 10,000 operations/class for headroom, counts requests over rolling 32 days,
and keeps byte/operation reservations across restarts. Stored space never resets
monthly; failed reservations stay counted. This does not cap unrelated account
usage or direct requests outside the application. No billing guarantee is made.
Gateway restart preserved one 56,898-byte upload reservation and Class A/B counts
(1/7 at check). An early check ran before Docker health became ready; the final
health-aware check passes. Video upload and public media remain disabled.
Exact R2 rollback retains pre-change source archive
`.runtime/releases/pre-r2-source-814be0f.tar.gz`, previous environment/images and
hash-guarded originals under `.runtime/r2-migration/original-config`. Follow the
README; keep all R2 objects and quota state. R2-only new images are not visible
through the old local-store app during rollback. No actual storage rollback,
model generation, platform authorization or public publication is claimed.
