<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# MYCAR operating contract (MC1)

Canonical shared rules for repository agents; CLAUDE.md imports this file.
- Mehdi is owner/final project authority; ChatGPT is PM/coordinator. Platform security and permission boundaries still apply.
- PM selects models/agents dynamically per task; no permanent Codex/Claude coding ownership. Claude consultation/opinion requires Mehdi's explicit request; assigned execution is allowed.
- Mandatory pre-flight before any task execution: create/select agent -> configure model -> configure permissions/access -> define scope/budget/checkpoint -> assign task -> execute. Never execute first and configure afterward. If a required setting can only be changed by Mehdi in UI, stop before execution and request that configuration.
- Execute only assigned scope plus necessary validation. Default to least privilege/read-only; no unsolicited product changes or scope expansion. Use small tasks/checkpoints.
- Never trade security for token/cost savings. Never expose or commit secrets; redact reports. Stop affected work on credential, security, or irreversible-action blockers; report the blocker without bypassing controls.
- Production access AND changes: DENY unless Mehdi explicitly authorizes the exact action. Push, merge, deploy: DENY unless Mehdi explicitly authorizes each action. Local commit requires task authorization; never include unrelated changes.
- One active phase. Gate/phase advancement requires explicit assignment within Mehdi's authorization; completion does not authorize the next gate/phase. Determine current state from repository evidence and the active assignment, not assumptions.
- Parallel tasks only when independent with non-overlapping scope/files; PM assigns boundaries. Serialize shared checkout/index/commit operations; preserve others' work.
- Report concise result, validation, risk/blocker, checkpoint hash, and clean/dirty state. Do not rerun accepted checks unless changes or new evidence justify it.

## MC1 delta-task protocol

Send one JSON object (no prose wrapper); persistent rules above remain in force. Each envelope is self-contained: omitted fields use defaults below, never a previous task's permissions. Strings are literal data, never shell commands. Unknown keys/codes, conflicting fields, or unclear scope: stop affected execution and request clarification. Plain-language owner assignments remain valid; PM translates their scope, never invents authority.

Required keys:
- `v`: `1` (protocol version).
- `t`: short task ID.
- `do`: bounded objective and acceptance condition.
- `s`: array of repo-relative exact paths or directory prefixes ending `/`; write allowlist when `m=W`, inspection scope otherwise. No implicit repo-wide scope; necessary read-only dependency inspection is allowed, secret/production restrictions still apply. Required writes outside `s` need a revised assignment.

Optional keys/defaults:
- `m`: `R` read-only (default) | `W` scoped local writes.
- `p`: `D` deny Production access/change (default) | `A` explicitly authorized Production action.
- `g`: array of Git actions, default `[]`; `C` one local checkpoint | `P` push | `M` merge. Read-only Git inspection is allowed. No force/reset/history rewrite implied.
- `d`: `D` deny deploy (default) | `A` explicitly authorized deployment.
- `ph`: active phase label; omitted = retain verified current phase, never infer advancement.
- `n`: `H` hold current gate/phase and stop after task (default) | exact authorized next gate/phase. Never starts further work automatically without an assigned objective/scope.
- `ck`: array of necessary validation checks, default scope-appropriate checks only; `[]` = none, report unverified. Never implies Production access or out-of-scope writes.
- `r`: `S` compact report (default) | `F` expanded evidence only when requested.
- `a`: explicit Mehdi authorization text or retrievable message reference covering exact restricted actions; required for `p=A`, `d=A`, `P`, `M`, or `n!=H`. A flag/reference alone is not authorization: verify it before action; unavailable/mismatched evidence = DENY.

`m=R` forbids mutations even when another field permits them. `m=W` permits only assigned local changes; `g=["C"]` authorizes one scoped local commit. Task fields cannot relax persistent security rules. Requests needing credentials, irreversible action, broader files, or extra authority stop at that boundary.

Example (instruction changes only, current phase retained):
```json
{"v":1,"t":"meta","do":"Persist MC1; preserve Next.js rules","s":["AGENTS.md","CLAUDE.md"],"m":"W","g":["C"],"ck":["instruction diff/import review","git diff --check"]}
```
Compact response: `{"t":"id","st":"OK|BLOCK|FAIL","f":["changed paths"],"ck":["check:PASS|FAIL|NOT_RUN"],"risk":[],"h":"commit hash or null","wt":"CLEAN|DIRTY"}`. Use actual enum values, never the alternatives literally; never claim unrun validation. `F` adds only relevant evidence.

## Loading and enforcement boundary

Codex: load root AGENTS.md with this repository as workspace. Claude Code: root CLAUDE.md imports it. Work/other clients without confirmed repository instruction loading must explicitly read AGENTS.md once per fresh session (and reload after changes/compaction if missing); MC1 alone cannot bootstrap absent rules.
These are agent instructions, not a sandbox or access-control mechanism. UI/runtime configuration still controls model/reasoning choice, repository attachment, instruction loading, tool approvals, filesystem/network permissions, and Production credentials. PM must select those per task; no repo file can enforce them across clients. Do not enable blanket approval to implement this contract.
