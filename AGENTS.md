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

Resume checkpoint: remote `/srv/luxsabers-social` has isolated healthy stores,
AI/server/web and private gateway. Use private UI port 18880 and signed-image
port 19000 through the existing SSH tunnel; local 18080 belongs to another
service. Initial MongoDB and ARM gateway fixes are recorded in the plan. Real
HTTP login, source-matched private image upload, and real desktop/mobile workspace
checks pass. Automation changes after `4433cc9` are local only until explicitly
recorded as deployed: SQLite daily intent, cost reservations, pause controls,
source checks, and a hash-guarded native retry patch. No model/provider calls.
Current local tests: 27 Node and ten Python tests pass; new remote worker and
private controls validation are pending. Pre-upgrade cold snapshot
`20260917T121131Z-4433cc9` passed four isolated volume byte comparisons and
restored MongoDB/Redis startup. Restore-test copies were removed; backup retained.
Pause/resume races and same-flow restart recovery have focused regression tests;
never run a second worker beside the Compose service.
Model budget remains zero and no social account is connected.

OBS addition: user owns bucket `pendjun`, endpoint
`obs.cn-south-4.myhuaweicloud.com`, bucket host
`pendjun.obs.cn-south-4.myhuaweicloud.com`, with a 40GB standard multi-AZ storage
package. Proposed isolated prefix is `luxsabers-social/`; do not read/list/change
other bucket contents. A key is stored disabled in ignored local `.private/obs.json`
(0600); never print it. User reports the traffic package expired. No OBS request,
credential transfer or integration has occurred. Do not assume a storage package
covers requests/egress or mutate bucket-wide policies. R2 is only a proposed
alternative: subscription, storage authority and runtime credentials are missing.
Existing Cloudflare MCP login successfully reads `luxsabers.com`; subscription
metadata returns a permission error. Do not repeat login or claim R2 is active.
