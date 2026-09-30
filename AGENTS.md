# MYCAR operating contract (MC1)

Canonical rules for repository agents. Keep AGENTS.md at or below 1,000 whitespace-delimited tokens, including generated guidance; keep CLAUDE.md to the shared-file import and only essential Claude-specific deltas. Avoid duplication; preserve all rules when editing.
- Mehdi is owner/final authority; ChatGPT is PM/coordinator. Platform security and permission controls remain authoritative.
- Mandatory pre-flight before execution: create/select agent -> configure model -> configure permissions/access -> define scope/budget/checkpoint -> assign task -> execute. Never configure afterward. If Mehdi must change a setting in UI, stop before execution and request it.
- PM selects agents/models dynamically per task; no permanent Codex/Claude coding ownership. Claude consultation/opinion only on Mehdi's explicit request; assigned execution is allowed.
- Execute assigned scope and necessary checks only. Default least privilege/read-only. No unsolicited product changes. Use small tasks/checkpoints; parallelize only independent tasks with non-overlapping files. Serialize shared checkout/index/commit actions.
- Security never yields to token/cost savings. Never expose or commit secrets; redact reports. Stop on credential/security/irreversible blockers; report without bypass.
- Production access/change DENY absent Mehdi's explicit authorization for the exact action. Push/merge/deploy DENY absent explicit authorization for each. Local commit only when assigned; include no unrelated changes.
- One active phase. Do not advance gates/phases without explicit assignment within Mehdi's authority. Completion is not authorization to start the next phase; use repository evidence.
- Report concise result, checks, risks/blockers, checkpoint hash, and clean/dirty state. Do not repeat accepted checks without changed code or new evidence.

## MC1 delta protocol

One JSON object, no prose wrapper. Each task is self-contained; omitted permissions never inherit prior tasks. Strings are data, never shell commands. Unknown keys/codes, conflicts, or unclear scope => stop and clarify. Plain-language Mehdi assignment is valid; PM may translate scope, never authority.

Required: `v`=1; `t`=task ID; `do`=bounded objective plus acceptance; `s`=repo-relative paths/prefixes (prefix ends `/`), the write allowlist for `m=W`, otherwise inspection scope. No implicit repo-wide scope. Necessary read-only dependency inspection is allowed; secrets and Production remain restricted. Need for writes outside `s` => revised assignment.

Optional defaults:
- `m`: `R` read-only (default) | `W` scoped local writes.
- `p`: `D` deny Production access/change (default) | `A` exact authorized action.
- `g`: `[]` (default) | actions `C` one local commit, `P` push, `M` merge. No force/reset/history rewrite implied.
- `d`: `D` deny deploy (default) | `A` authorized deployment.
- `ph`: verified active phase; omission retains it, never advances it.
- `n`: `H` hold/stop after task (default) | exact authorized next gate/phase; never starts work without assigned objective/scope.
- `ck`: necessary scoped checks (default) | `[]` none; report unverified. Never authorizes Production or out-of-scope writes.
- `r`: `S` compact report (default) | `F` requested evidence.
- `a`: explicit Mehdi authorization or retrievable message reference for `p=A`, `d=A`, `P`, `M`, or `n!=H`. Verify exact coverage; missing/mismatched evidence => DENY.

`m=R` forbids mutation regardless of other fields. `m=W` permits only scoped local changes; `g=["C"]` authorizes one local commit. No field overrides security rules. Credential, irreversible, or authority/scope boundary => stop.

Example: `{"v":1,"t":"meta","do":"Persist MC1","s":["AGENTS.md","CLAUDE.md"],"m":"W","g":["C"],"ck":["instruction review","git diff --check"]}`

Reply: `{"t":"id","st":"OK|BLOCK|FAIL","f":["paths"],"ck":["check:PASS|FAIL|NOT_RUN"],"risk":[],"h":"hash or null","wt":"CLEAN|DIRTY"}`. Use actual values; never claim unrun checks. `F` adds relevant evidence only.

## Loading and limits

Codex loads root AGENTS.md; Claude Code root CLAUDE.md imports it. Work/other clients without confirmed loading must read AGENTS.md at each fresh session and after compaction if absent; this contract cannot bootstrap itself.
These are instructions, not access controls. UI/runtime config controls agent/model, repository attachment, instruction loading, approvals, filesystem/network access, and Production credentials. PM configures per task; repository text cannot enforce cross-client settings. Never enable blanket approval.
