# MY CAR — Master Project Roadmap

**Document role:** canonical AI-to-AI project roadmap and phase register

**Owner and final authority:** Mehdi

**Current verified state:** Phase 4 PASS; Phase 4.5 DONE; Phase 5 technical
result READY FOR OWNER PASS (Owner decision pending)

**Next product phase:** Phase 5 technical work complete; awaiting Owner
PASS/BLOCKED decision before any further phase

**Production launch:** not a current objective

**Default external spend authorization:** USD 0

**Last verified checkpoint:** `be654cf7be57a1e84628dcf63bee3f194f4895b8` — Phase 4 closure

## 1. Purpose and source of truth

This document records what is verified, active, planned, deferred, blocked, authorized, and explicitly out of scope. It does not authorize work by implication. A placeholder, route, navigation link, comment, old chat statement, or future-facing schema does not define phase scope.

When sources conflict, use this order:

1. Actual, currently verified repository state and test evidence.
2. Current repository security and operating instructions, including `AGENTS.md`.
3. The latest verified Git checkpoint.
4. This roadmap.
5. Management memory.
6. Older chat claims or plans.

Update this roadmap at every phase boundary and record the checkpoint against which the state was verified. Repository evidence always overrides stale roadmap text.

## 2. Status vocabulary

- **DONE:** implementation and required gate are complete.
- **PASS:** the required evidence supports closure; the Owner retains final PASS authority.
- **IN PROGRESS:** explicitly authorized work is underway.
- **PLANNED:** defined future work with no execution authority yet.
- **DEFERRED:** intentionally postponed.
- **BLOCKED:** cannot safely close because a named condition remains unresolved.
- **NOT STARTED / NOT IMPLEMENTED:** no implementation authority has been exercised.

## 3. Authority and phase control

- **Mehdi / Owner:** final authority for scope, phase start, phase PASS or BLOCKED, cost, major product/architecture decisions, Production actions, and launch.
- **ChatGPT / PM:** planning, bounded assignments, pre-flight, coordination, evidence interpretation, independent-review coordination, and roadmap maintenance.
- **Workers/reviewers:** execute or review only the assigned scope; they do not authorize a phase, cost, Production access, or subsequent work.

Only one project phase is active unless the Owner explicitly authorizes independent tracks. Completion never authorizes the next phase. Every phase follows:

`Scope -> Pre-flight -> Implementation -> Tests -> Security/Regression Review -> Gate -> PASS or BLOCKED -> Checkpoint -> Roadmap Update`

For high-risk RLS or migration work, the author must not be the sole reviewer. Mehdi has final PASS/BLOCKED authority. If a phase is BLOCKED, no partial, unreviewed migration may be left as an accepted mainline state; it must be reverted, isolated, or explicitly checkpointed as non-deployable with a clear disposition.

## 4. Verified completed phases

### Phase 1 — Security Foundation

**Status: DONE**

Supabase Auth, PostgreSQL/RLS, ownership and authorization foundations, and foundational security tests were established.

### Phase 2 — Store Foundation

**Status: DONE**

Products, categories, compatibility, offers, seller foundations, storage foundations, Store database structures, and public catalog foundations were established.

### Phase 3 — Purchase and Orders

**Status: DONE**

Cart, server-authoritative quotation, coupon validation, Cash on Delivery checkout, atomic and idempotent order creation, stock locking, buyer order history/detail/cancellation, seller fulfillment, and multi-seller isolation were established.

### Phase 4 — Admin Panel Completion and Security

**Status: PASS; closure artifacts are checkpointed by Phase 4.5**

Verified scope includes Super Admin and operator permissions, Admin dashboard and audit, product/coupon management, offer moderation, discount approval, product-request review, order access, order-item RLS, server/direct-URL authorization, least privilege, buyer/seller isolation, IDOR protection, and transactional audit for privileged mutations.

Key permissions are `products.write`, `offers.moderate`, `discounts.approve`, `requests.review`, `orders.read`, and `coupons.manage`.

The accepted dirty closure set before the Phase 4.5 checkpoint is exactly:

- `app/admin/audit/page.tsx`
- `docs/admin-completion-gate.md`
- `tests/database-security.mjs`
- `supabase/migrations/202610020001_admin_order_item_read.sql`
- `tests/admin-local-functional.mjs`

`supabase/.temp/` is local runtime metadata and must not be committed.

## 5. Phase 4.5 — Phase 4 Closure Checkpoint

**Status: DONE / PASS**

This is not feature development. Its only purpose is to turn the verified Phase 4 PASS closure set into a durable, reviewable Git checkpoint.

Definition of Done:

1. The dirty tree is inspected and only the five accepted closure artifacts are staged.
2. Their diff matches retained Phase 4 PASS evidence.
3. The security-relevant migration/RLS change receives independent review.
4. Required local tests pass.
5. `supabase/.temp/`, secrets, unrelated cleanup, and new features are excluded.
6. A traceable local closure commit exists and its real hash is recorded here.
7. The working tree is controlled and its remaining local metadata is reported.
8. Work stops; Phase 5 is not started automatically.

No Production/hosted action, deploy, push, merge, paid service, secret exposure, RLS weakening, or unrelated cleanup is authorized.

**Closure checkpoint:** `be654cf7be57a1e84628dcf63bee3f194f4895b8` (`chore(admin): checkpoint Phase 4 closure`)

The five accepted artifacts were independently reviewed where security-relevant and passed the required local checks. The only remaining untracked path after closure is `supabase/.temp/`, intentionally excluded local runtime metadata. Phase 5 was not started.

## 6. Phase 5 — Store Completion

**Status: technical result READY FOR OWNER PASS** (local verification,
2026-10-02; branch `phase-5-store-completion`). Full evidence:
`docs/phase-5-store-completion-gate.md`. Mehdi/Owner retains final
PASS/BLOCKED authority; no subsequent phase is authorized by this result.

### Actual completed capabilities

- Admin order detail/line-item UI (`app/admin/orders/[id]/page.tsx`),
  read-only, gated by the existing `orders.read` permission and the
  existing `item_orders_read` RLS policy from Phase 4.5 — no new
  migration, permission key, or RPC.
- Real pagination on `/admin/orders` and `/admin/audit`, replacing their
  fixed 100/200-row caps, preserving existing filters and stable ordering.
- One dead-link fix on the public landing page (`/contact` → `/shop`).
- Bounded end-to-end review of Buyer/Seller/Admin Store flows; every
  discovered gap classified (see `docs/phase-5-store-completion-gate.md`
  section 3) — no gap left undecided.
- Payment-provider boundary and SMS/phone-verification boundary documented
  from actual implementation evidence (no provider/SMS code added).
- Concurrency verification requirement satisfied by reference: no Phase 5
  change touches locking/stock/order-consistency code; the existing Gate 1
  PostgreSQL suite already proportionally proves those properties and was
  not invalidated.

### Deferred gaps / accepted limitations

- `/admin/offers`, `/admin/discount-requests` (200-row caps) and
  `/admin/operators` (100-row cap, and its query scope spans all profiles)
  — accepted/deferred; current seed/real volumes are far below each cap.
- `/admin/coupons` has no row cap at all (inconsistent with other admin
  lists) — accepted at current scale.
- A dead UI button branch in seller orders tied to an unreachable
  fulfillment status value — accepted, not a functional defect.
- A pre-existing, unrelated `react-hooks/set-state-in-effect` lint finding
  in `app/page.tsx` — deferred, not introduced or touched by Phase 5.

### Test evidence

`npm run typecheck`, `npm run build`, scoped lint on touched files,
`node tests/database-security.mjs` (302×2 security/transaction assertions
+ 15×2 HTTP-to-PostgreSQL assertions, no regression from the Phase 4.5
baseline), `node tests/write-boundary.mjs` (31 assertions),
`npm run test:admin-seed` (17 cross-checks + 4 reset checks), and
`node tests/admin-local-functional.mjs` (186 assertions, up from 172 at
Phase 4.5, with new coverage for order-detail authorization, invalid-id
handling, and pagination) all PASS. An independent reviewer examined the
new/changed authorization surface (order detail page + pagination) and
returned PASS with no findings.

### Known technical debt entering any future phase

Admin list caps on offers/discount-requests/operators/coupons remain
fixed/inconsistent (accepted at current scale, revisit if volume grows);
the landing-page `react-hooks/set-state-in-effect` lint finding remains
unfixed (pre-existing, unrelated to Phase 5); data durability/backup
capability for any future hosted environment remains **NOT VERIFIED —
REQUIRES FUTURE HOSTED CHECK** (not a Phase 5 blocker).

### Historical scope record (as authorized before execution)

**Status at authorization: PLANNED — NOT STARTED AND NOT AUTHORIZED BY PHASE 4.5 COMPLETION**

### Objective and scope

Complete the software Store Core without making public launch, real payment, or real SMS a PASS prerequisite.

Planned work:

- Complete Admin order detail and order-line UI using the existing `orders.read` permission and RLS boundaries.
- Replace known fixed caps with correct pagination where required, including Admin Orders and Admin Audit, plus any bounded-review Store/Admin list gap explicitly accepted into Phase 5.
- Perform one bounded end-to-end review of Buyer, Seller, Admin Store Operations, Product, Offer, Coupon, Cart, Checkout, Order, Fulfillment, and Stock flows.
- Classify every discovered gap as **FIX IN PHASE 5**, **DEFERRED TO NAMED FUTURE WORK**, or **ACCEPTED LIMITATION WITH RATIONALE**. No known gap may remain undecided.
- Review the current order model for future non-COD compatibility without integrating a provider.
- Document payment and SMS/phone-verification boundaries from the repository's actual implementation, not from generic designs.

### Payment and phone boundaries

Real payment, real SMS, and real OTP remain deferred. Payment preparation should describe the future boundary:

`Payment Attempt -> Provider Reference -> Async Result/Webhook/Poll -> Authoritative Payment State`

The current mobile-to-synthetic-email behavior may remain temporarily, but all future work must preserve this invariant:

`Mobile identifier != verified phone ownership`

### Concurrency rule

Concurrency verification is required when an affected RPC uses multiple row locks, interacts with advisory locks, or can affect stock/order consistency under concurrent execution. Do not substitute aimless stress testing. For any such RPC, verify the concrete lock ordering, idempotency, and consistency risks.

### Security baseline

Phase 5 must not regress RLS, ownership isolation, buyer/seller separation, least privilege, server-side/direct-URL authorization, atomic audit, operator restrictions, Super Admin restrictions, order/order-item visibility, IDOR defenses, or the prohibition on using a service role to bypass product authorization architecture. High-risk RLS/migrations require independent review.

### Definition of Done

Phase 5 may be proposed for Owner PASS only when:

1. Phase 4.5 has a valid checkpoint.
2. Admin order detail/line-item UI is complete.
3. Required Store/Admin pagination is complete.
4. The bounded Buyer/Seller/Admin Store-flow review is complete.
5. Every discovered gap is FIXED, NAMED-DEFERRED, or ACCEPTED WITH RATIONALE.
6. Future non-COD order/payment modeling has been reviewed.
7. The payment-provider boundary is documented from actual implementation.
8. The SMS/phone-verification boundary is documented from actual implementation.
9. Defined concurrency risks have proportional verification.
10. The Phase 4 security baseline has no regression.
11. Required tests, typecheck, build, and scoped lint pass.
12. No unrelated future module enters the phase.
13. This roadmap records the factual end state.
14. High-risk RLS/migrations have an independent reviewer.
15. A BLOCKED result leaves no partial unreviewed migration accepted on mainline.
16. The result is submitted to Mehdi for final **PASS** or **BLOCKED** decision.

Phase 5 PASS does not authorize either future track.

### Explicit Phase 5 exclusions

Real Payment Gateway, real SMS/OTP, Production deployment/launch, AI Assistant, customer Vehicle Profile, service history, roadside assistance, vehicle services, academy, automotive news/content, heavy-vehicle features, multi-currency, multi-language, multi-tenancy, speculative optimization, and unrelated future modules are out of scope.

## 7. Future Track A — Store / Platform

**Status: PLANNED / NOT AUTHORIZED**

When separately authorized, this track may include real payment verification and lifecycle, asynchronous provider results, refunds, real SMS/OTP, and verified phone ownership.

### Production Readiness and Launch

**Status: DEFERRED**

Production Readiness begins only on Owner instruction and may include deployment, hosted-configuration verification, observability, rate/abuse controls, backup/restore drills, scaling, legal/public surfaces, and a launch gate. It is not a prerequisite for isolated Automotive Intelligence development.

Checking whether a backup capability exists is a distinct technical inventory task. It does not by itself constitute Production Readiness, a restore drill, or launch approval.

## 8. Future Track B — Automotive Intelligence

**Status: PLANNED / NOT AUTHORIZED**

This track may begin after Store Completion without waiting for real payment, SMS, or public launch, but only with explicit Owner authorization.

### Stage B1 — Minimal Vehicle Domain Foundation

Create only the stable identifiers, ownership model, minimum vehicle schema/contracts, authorization boundaries, and lifecycle assumptions required by later automotive work. Do not overbuild a full customer-facing Vehicle Profile product. Re-open PII/retention, deletion, audit preservation, vehicle ownership transfer, and VIN handling decisions here.

### Stage B2 — Automotive Foundation

Define structured automotive knowledge, sources/provenance, diagnostic knowledge architecture, safety boundaries, retrieval/evaluation design, and interfaces to the minimal vehicle domain.

### Stage B3 — Read-only Automotive AI Assistant

Build an isolated, non-production, read-only prototype for technical Q&A, retrieval, diagnostic reasoning, and structured vehicle context. It may not execute privileged Store mutations, autonomous actions, or broad cross-domain reads.

Later integration with user vehicles, service history, Store/parts, services, or roadside assistance requires separately reviewed authorization contracts.

## 9. Controlled parallel development after Phase 5

Parallel Store/Platform and Automotive Intelligence work is allowed only if the Owner explicitly opens both tracks and all of these controls are established:

- Each task has explicit path ownership and independent acceptance criteria.
- Track-owned files do not overlap.
- Shared surfaces—authentication/authorization helpers, shared types, common UI shell, cross-domain contracts, test infrastructure, and database schema—have a named integration owner and reviewed changes.
- Database migrations are serialized. Two workers may author independently, but they must not apply unordered migrations to a shared environment. Timestamp/order is reconciled against current mainline before integration.
- No worker silently changes the other track's domain or refactors shared tests unilaterally. Shared-test changes are additive and reviewed.
- Cross-domain reads use reviewed, RLS-scoped contracts. No broad SECURITY DEFINER RPC or service-role bypass may be introduced for convenience.
- Integration occurs through explicit, reviewed contracts and traceable checkpoints.

## 10. Cost and external-service gate

The cost gate is independent of phase and Production authority. Default authorized external spend is **USD 0**. Any paid LLM, embedding, vector hosting, SMS, payment, infrastructure, subscription, recharge, storage/database upgrade, or other paid API/service requires explicit Owner authorization for that exact use. A phase start, promotional credit, or available credential is not blanket spending authority.

## 11. Deferred technical items

Unless a verified dependency makes one necessary earlier, these remain deferred: Production observability/scaling, Production backup drill, Admin bulk/export, full seller payout execution, real-traffic optimization, broad multi-module permission generalization, and complete PII/data-retention implementation. Deferral must be revisited when the relevant domain becomes active.

## 12. Current phase register

- Phase 1: **DONE**
- Phase 2: **DONE**
- Phase 3: **DONE**
- Phase 4: **PASS**
- Phase 4.5: **DONE / PASS** — checkpoint `be654cf7be57a1e84628dcf63bee3f194f4895b8`
- Phase 5: **technical result READY FOR OWNER PASS** — awaiting Owner
  PASS/BLOCKED decision; see `docs/phase-5-store-completion-gate.md`
- Real Payment: **DEFERRED**
- Real SMS/OTP: **DEFERRED**
- Production Readiness: **DEFERRED**
- Minimal Vehicle Domain Foundation: **PLANNED / NOT AUTHORIZED**
- Automotive Foundation: **PLANNED / NOT AUTHORIZED**
- Read-only Automotive AI Assistant: **PLANNED / NOT AUTHORIZED**

## 13. Immediate authorized action

Phase 5's technical scope is complete and locally checkpointed on branch
`phase-5-store-completion`; its result is READY FOR OWNER PASS, not a
PASS. Stop. No further phase, track, or scope starts until Mehdi reviews
`docs/phase-5-store-completion-gate.md` and records a PASS or BLOCKED
decision.
