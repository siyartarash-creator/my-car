# Automation 1 pre-flight — 2026-10-01

Status: safe integration completed; intelligent-worker activation BLOCKED.
This is a supervised PM checkpoint, not an intelligent-worker pilot.

## Assignment and execution boundary

Owner assignment: continue PR #2, integrate the zero-new-cost portion, establish a
non-deadlocking CI gate, inspect installed workers, and stop before unproven billing
or isolation. The current supervised session performs this checkpoint. No separate
model execution, vendor account change, installation, or product-phase advancement
is authorized by this record. Repository writes are limited to `.department/`.
New external spend ceiling: USD 0. One documentation commit and draft PR are allowed;
merging that PR is a separate checkpoint. GitHub transport belongs to the PM.

## Integration decision

Verified refs before integration:

- `main`: `f072c520d56cb6ebea55a910b6f851fdc5edb58c`.
- `phase-4-admin-panel-completion`: `87c388f801388a02306ca54b8085737794174567`.
- PR #2 / `department/base`: `a71c1726a4f9f634b087d7083a7955dcfab8d624`.

Phase 4 contains 13 commits beyond main. PR #2 adds four Department commits:
`604395a`, `7e30b41`, `ce82656`, `a71c172`. Its 21 changed files are confined to
`.department/`, `.github/`, and `.gitignore`. Main has neither Department code nor
its workflow. PR #2 is open, draft, mergeable, and targets Phase 4.

The safe development path is `department/development` at PR #2's exact head. This
preserves every product and Department commit without rebasing, cherry-picking,
rewriting history, or moving either original branch. This branch is the integration
base for subsequent Department work. It is not a release branch and does not accept
Phase 4 as complete. PR #2 remains draft as the original delivery record.

Merging or retargeting PR #2 into main would pull in unfinished Phase 4. A separate
Department-only backport to main would duplicate commits and require product/release
coordination. Neither is needed for this checkpoint. Any future promotion to main
must inspect its complete diff and product readiness first.

## Required CI gate and branch compatibility

Create the development branch first, verify its workflow content, then require the
`Department Base` check from GitHub Actions app ID 15368 on that exact branch only.
Use strict/up-to-date checks, PRs, administrator enforcement, conversation resolution,
zero required human approvals, and block force-push/deletion. Existing branches and
main's existing protection must remain unchanged.

The workflow has no path, branch, draft, or job condition filters. It uses
`pull_request`, a read-only token, pinned checkout, no persisted credential, standard
Ubuntu runner, no install, no cache/artifact upload, and a three-minute timeout.
The prior check passed at the exact integration head in run 36899558287. A new
documentation-only draft PR into the development base verifies normal PR delivery
of the required check without changing application code.

Existing branches are not subject to this new requirement. When one is deliberately
proposed into this development base, GitHub's test merge includes Department files
from the base; actual conflicts must be resolved normally. No skipped-check bypass,
fake status, wildcard branch rule, or merge queue is configured. Do not use CI skip
commit messages for PRs into the protected development base. The Department check
does not certify application, database, or Phase 4 correctness.

## Installed worker and billing observations

- Claude Code 2.1.285: `claude.ai`, first-party provider, Pro subscription. The
  inspected user settings have no API-key helper, configured environment, or sandbox
  setting. Account-level extra usage/usage credits and auto-reload were not verified.
- Codex CLI 0.158.0: login status reports ChatGPT. User configuration selects
  `gpt-6-astra` and Windows `unelevated`; no forced ChatGPT login was found. The app
  account reports Plus, zero credits, no unlimited credit balance, and available
  included usage. This does not establish every future CLI invocation's account,
  inherited provider configuration, auto-purchase policy, or hard spend stop.
- No Anthropic/OpenAI API-key or cloud-provider variable names were found in the
  inspected process, user, or machine environment. Values and credential files were
  not printed, copied into worker context, or committed. Absence of these variables
  alone is not a complete billing proof.
- Docker is not available on PATH. `wsl --list --quiet` returned help/error instead
  of an installed distribution; a usable WSL2 environment was not established.

Claude's built-in sandbox supports macOS/Linux/WSL2, not native Windows. Permission
rules are not a substitute for OS confinement. Codex offers native elevated and
unelevated sandbox modes; elevated uses dedicated restricted users and firewall
rules, while unelevated uses a restricted token and weaker offline controls. The
observed configuration is unelevated. No worker-specific filesystem-read or egress
canary test has passed. The current app's boundary does not prove a separately
launched CLI worker is equivalently confined. No sandbox installation, firewall
change, account creation, credential transfer, or bypass-permission flag was used.

## Activation policy: deny until verified

Both worker registry entries remain disabled and have no permissions. No general
AI execution adapter is implemented in v0; changing `enabled` is insufficient and
is not authorized by this document. The runner admits only the deterministic local
hygiene adapter. The following are requirements for a future reviewed adapter,
not claims of controls already implemented:

1. Pin the installed binary/version, provider, account, explicit model, and approved
   task. Evaluate the cheapest capable included model first (Codex GPT-6 Luna is a
   candidate listed in the installed CLI model cache); do not inherit the Astra default
   or silently fall back to another model/provider. Claude remains ineligible on
   this native Windows host without a separately verified isolation solution.
2. Require subscription-only authentication, no API keys/key helper/custom metered
   provider, no usage credits/overage/automatic purchase, and a hard stop at the
   included limit. Recheck before every run. Unknown, expired, or contradictory
   evidence blocks activation. Do not convert a USD 0 budget into an estimate.
3. Use a disposable, credential-free task checkout with an enforced read and write
   allowlist. Keep Git credentials, user home, `.env*`, vendor credentials, Supabase
   metadata, database configuration, and private context outside worker access.
   The trusted model-auth transport must remain inaccessible to model tools.
4. Deny worker network egress; only the trusted subscription model transport may
   contact its approved vendor. Disable inherited MCP servers, hooks, plugins,
   remote tools, and shell profiles. Approval escalation, sandbox escape/fallback,
   and installation are denied. Validate using synthetic filesystem and network
   canaries before supplying source context; never probe real secrets or services.
5. Initial pilot ceilings: one task, one attempt, zero retries, one worker, eight
   model turns, 120 seconds with process-tree termination, two explicitly listed
   source/test files, 50 KB reviewed context, 500 changed lines, USD 0 new spend.
   These ceilings do not replace the vendor's billing hard stop. Existing v0 local
   tasks retain their current 60-second cooperative deadline.
6. Production, staging, databases, auth/RLS/payments/migrations, secrets, deployment,
   destructive operations, git push/merge, and phase advancement remain denied to
   the worker. The PM alone may publish reviewed code/report and a draft PR.
7. Deterministic gates must check exact scope, sensitive-content heuristics plus
   diff review, bounded task acceptance, relevant local tests, whitespace, attempt
   and timeout limits, and a report tied to actual base/head/context hashes. A
   blocked launch must report zero attempts, not masquerade as a completed pilot.

## Current decision and remaining work

Local checks: 18 existing Department tests passed, zero skipped; both task contracts
validated; the report passed the credential heuristic scan and manual content
review; whitespace checks passed; both AI registry entries remain disabled. The
first sandboxed test-runner launch failed with `spawn EPERM` before the suite ran;
the same suite then passed under a narrowly approved local test invocation. This
is not evidence of a successfully sandboxed AI worker. No broad product tests ran.

Live branch protection verification confirmed the workflow blob
`f12eb172130e1183de3b26edb425ef04400fbc87` on the new base before enforcement,
strict required check `Department Base` bound to app 15368, administrator
enforcement, force-push/deletion disabled, and unchanged main/Phase 4 heads. The
new draft PR's CI result must be verified on its actual head before claiming that
the development gate has passed. Subsequent delivery metadata belongs in its PR.

Worker attempts: 0. Separate model/API calls: 0. Installs: 0. New external spend:
USD 0. No Production/staging/database access, deployment, merge, or destructive
operation. The existing subscription cost is unchanged; this is not a provider
invoice audit or a claim that all account usage is free.

Owner decision is needed before worker activation: retain the disabled state, or
authorize a narrowly scoped setup to establish subscription-only billing and an
enforced worker sandbox. Recommend Codex first if its account and sandbox controls
can be verified without installation or cost. If setup needs administrator changes,
an install, sensitive authentication transfer, or paid usage, present the exact
action/cost before proceeding. Do not launch the requested intelligent coding pilot
until all gates pass. A supervised documentation PR is not a substitute for it.

## Official sources checked

- https://learn.chatgpt.com/docs/auth
- https://learn.chatgpt.com/docs/windows/windows-sandbox
- https://learn.chatgpt.com/docs/pricing
- https://code.claude.com/docs/en/sandboxing
- https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code
- https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
