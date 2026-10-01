# My Car Department Base v0

This is the smallest local-first Department checkpoint, scoped to the existing
admin-panel branch without advancing its product phase. Node 22+ and Git are the
only execution dependencies. No package install or paid service is required.

## Operator flow

The PM handles GitHub; Mehdi receives progress, delivery and genuine decisions.
An internal issue identifies the task, branch, state, base commit and report. Its
text is **untrusted data**, never a command, permission grant or automatic trigger.
The PM translates it into a committed `.department/tasks/<id>.json` contract.

From a clean `department/<name>` branch at the repository root:

```sh
node .department/cli.mjs validate
node --test .department/tests/department.test.mjs
node .department/cli.mjs run pilot-ignore-supabase-temp
```

The runner reads only admitted context files, records their hashes and the base
commit, chooses an admitted worker by routing, runs it once, checks the result,
and writes `.department/local/<id>.report.json`. Context packs and transient state
stay in ignored `.department/local/`. The PM reviews the diff, commits only the
assigned files, publishes a sanitized report to the issue/branch and opens a draft
PR. Publishing is a separate supervised PM operation, never a worker privilege.

The real pilot fixes an observed repository problem: the Supabase CLI left an
untracked `.temp` directory in the existing checkout. The built-in worker adds an
exact ignore rule. A gate checks both the ignored directory and a migration file
that must remain eligible for version control. It never reads the temp directory.
This is an executed deterministic worker pilot, not a claim of Claude execution.

## State and contracts

`queued → validated → running → checking → completed`. Validation failures become
`blocked`; worker/gate failures become `failed`. Terminal states cannot restart.
An exclusive lock serializes local runs. A persisted task report prevents replay.
After a crash, the PM examines the existing lock, state, branch and diff; there is
no automatic lock deletion, reset, retry or rollback. A reviewed new task ID is
required for another attempt. Evidence includes ordered transitions, gate results,
base commit, changed files, attempts and new spend.

The three JSON contracts reject unknown keys. Registries contain no shell strings:
workers select hard-coded adapters; tools document admitted capabilities; gates
select hard-coded checks; routing chooses scope and checks. Only repository hygiene
is admitted in v0. Unknown work is blocked. Medium/high-risk routes require a later
explicitly scoped implementation and appropriate independent review; no silent
fallback to this low-risk route is possible.

One attempt and zero new dollars are enforced. The time budget is checked between
steps; individual Git subprocesses have a 10-second timeout, so this is a bounded
cooperative deadline, not an OS-enforced wall-clock limit. There is no daemon,
scheduler, webhook executor, background polling or automatic API/model invocation.

## Security boundary and honest limits

The runner permits an exact `.gitignore` write only, fixed local Git reads and
three context filenames. It rejects unsafe paths, symbolic links, dirty checkouts,
protected branch names, unexpected changes and several credential formats. It
does not inherit API-token environment variables into Git. Source text and shell
stderr are not copied into failure reports. Heuristic scanning is defense in depth,
not proof that arbitrary content is safe to publish.

This runner is **not an OS sandbox**. It executes trusted built-in code under the
operator's runtime boundary. Policy JSON and AGENTS.md do not isolate arbitrary
code or hostile concurrent processes. Use a dedicated checkout and serialize its
writes. The current supervised Windows sandbox blocked Node child processes; the
local safety tests needed a narrow runtime approval. No unrestricted AI CLI was
launched. GitHub credentials remain in the PM transport, outside worker input.

Claude Code and Codex CLI adapters are registered but disabled. Installation and
subscription login alone do not establish zero overage or adequate filesystem and
network confinement. Before enabling either: verify subscription-only usage/no
metered fallback, configure a real sandbox with no secrets and restricted egress,
pin the selected model/runtime, pass only reviewed context, limit tool access and
turns, and validate the report. Never use bypass-permission flags. A new vendor,
real data exposure or meaningful spend needs Mehdi's exact approval.

Production, staging, auth/RLS/payments/migrations, deployment, auto-merge, destructive
commands and phase advancement have no execution route. Local Git commits and
GitHub issue/branch/PR updates are performed by the supervised PM under the current
assignment, not by task-controlled instructions.

## CI and release boundary

The Department Base workflow runs only local contracts/security tests and whitespace
checks on PRs, with a read-only token, no persisted checkout credential, no secrets,
no environment, a pinned checkout action and a three-minute timeout. It does not
run the application, install packages, connect to Supabase or deploy. It covers this
Department change only; it cannot certify arbitrary application/security changes.
Standard GitHub-hosted runners are free for this public repository.

GitHub is the durable issue/branch/PR/report store. The state machine is local and
its report is published by the PM; v0 does not claim automatic GitHub synchronization.
Main protection and required checks must be verified separately from workflow text.
No merge is authorized by a successful report or a green check.

## Owner channel

Delivery: result, tested evidence, commit, remaining blocker and cost.
Decision: one concrete action, why it matters, options, recommendation and exact
approval scope. Only meaningful new spend, sensitive data/credentials, staging or
Production, destructive/irreversible actions and real product/phase decisions reach
Mehdi. Routine routing, local checks and GitHub bookkeeping remain with the PM.
