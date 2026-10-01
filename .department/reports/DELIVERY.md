# Department Base checkpoint — 2026-10-01

Local implementation and real pilot complete. Integration remains a draft PR against
`phase-4-admin-panel-completion`; it does not merge the unfinished Phase 4 branch into
main or certify its completion gate.

Evidence:
- `604395a`: contracts, four registries, bounded engine, CI and pre-flight.
- `7e30b41`: fix isolated Git handling of Windows CRLF; preserve failed attempt.
- `ce82656`: real successful hygiene pilot plus report.
- 18 targeted safety/behavior tests PASS, zero skipped; task and report validation
  PASS; new-file credential heuristic scan PASS; scoped Git whitespace checks PASS.
- First pilot failed closed at whitespace validation. Corrected second task passed
  scope, secret-scan, whitespace and Supabase-ignore gates. Each task had one attempt.
  Both reports are retained beside this document; context packs are not published.

GitHub backbone: issue https://github.com/siyartarash-creator/my-car/issues/1,
delivery branch `department/base`, draft PR and CI linked from the issue by the PM.
CI is checked separately after publication; this document does not preclaim its result.

Main protection was applied and API-verified: PRs required, administrators covered,
force-push and deletion disabled, conversations must be resolved. Required approving
review count is zero to preserve proportional low-risk review in a single-owner repo.
Required status checks are not yet configured: activate the Department check only
when its workflow is integrated into the relevant base branches. A workflow file
alone is not a required merge gate, and this check cannot certify application changes.

New spend: $0. No tools/dependencies installed, paid API/model invocation, staging or
Production access/change, database command, deployment, merge or destructive action.
Standard public-repository hosted CI is free under GitHub's documented pricing:
https://docs.github.com/en/actions/concepts/billing-and-usage

Remaining limits: only the deterministic hygiene route is active; Claude/Codex CLI
adapters are disabled until real sandbox and subscription/overage controls are
verified. State/report publication uses the supervised PM, not a daemon. Repository
policy is not OS isolation; the safety suite and pilot needed Windows runtime
permission for Node subprocesses. The original checkout was not modified.

Next owner decision is phase acceptance/integration, not operating GitHub. No merge
or broader autonomous worker activation is implied by this checkpoint.
