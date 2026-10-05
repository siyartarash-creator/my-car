# MY CAR integration baseline

- Integration merge: `89987ced13cf32a340bb81f745894b2d93702551`
- Branch: `my-car-integration-baseline-2026-10-05`
- Included checkpoints: Profiles Phase 2 `cc7b1de`; Seller/Store `79eb30c`; Map Phase 3 `c688525`; Admin closure `be654cf` and recorded phase head `e7c9797`; main ancestor `f072c52`.
- Ancestry: Profiles already contained Seller/Store and Admin. Map was the only independent checkpoint merged.
- Compatibility fix: retained all test scripts in `package.json`; moved the Seller identity migration version from conflicting `202610030000` to unique `202610021001`, before Map foundation. SQL content is unchanged.
- Validation: typecheck PASS; production build PASS with local non-secret Supabase placeholders; database/security and write-boundary PASS; Profile PASS; Seller identity PASS; Admin seed/functional PASS; Map 13/13 files PASS; integration-scoped lint PASS; `git diff --check` PASS.
- Migration compatibility: PASS locally. All repository migrations loaded together in the security suite; no duplicate migration version remains. Staging-only PostGIS scripts were not applied to a remote environment.
- Deferred, non-blocking: repository-wide lint still reports 30 pre-existing errors in untouched Orders, Home, Profile, and Seller Orders files. Build also reports the existing Next.js middleware deprecation warning.
- Production: untouched. Main: untouched. Cost: `$0`.
- Next strategic domain: Commerce + Services + Shared Financial Core (audit/design only when separately authorized).
