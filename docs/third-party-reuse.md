# Third-party reuse (MIT attribution)

Tracks substantial copied/adapted source code from external references used
while building the Admin panel (see `.claude/skills/my-car-admin/SKILL.md`).
Policy: prefer existing My Car code, then adaptation, then small selective
copied/adapted components only when materially useful. Never a whole
dependency graph or a foreign backend/auth/RBAC architecture.

Validated references:
- `Kiranism/next-shadcn-dashboard-starter` (MIT)
- `satnaing/shadcn-admin` (MIT)

## Entries

None yet. Admin Core (Checkpoint A: shell, navigation, operator management)
was written directly against existing My Car components and conventions —
no component body was copied from either reference. This file is created
now so later checkpoints (Store Admin tables/filters/forms) record any
actual copied/adapted code here at the time it is added, rather than
retroactively.

When an entry is added, record: the source file/component, the My Car file
it landed in, and the MIT notice/link.
