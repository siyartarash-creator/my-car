# Mehdi Case Intake Template

Fill one of these per real diagnostic/repair case. This becomes a row in `automotive_case_intake`; a reviewer later turns it into a published `automotive_knowledge_entries` row. Do not submit hypothetical or textbook cases here -- only things you actually diagnosed/repaired.

```
Vehicle(s) this applies to: (make, model, year or year range -- or "general/not vehicle-specific")

Observed:
  What was the customer's complaint / what did you see, hear, or measure?

Diagnosis:
  What did you conclude was wrong, and why?

Diagnostic test performed (if any):
  What check confirmed it? What result would have pointed elsewhere?

Resolution:
  What repair/action fixed it? Confirm it actually resolved the complaint.

Uncertainty notes:
  Anything you're not fully sure about, or cases where this cause is one of
  several possibilities rather than confirmed.

Safety notes:
  Does this touch brakes, airbags/SRS, fuel, high-current electrical, or
  structural/suspension work? Any warning a less experienced mechanic should
  have before attempting this?
```

## What happens after submission

1. Saved as `automotive_case_intake` with `status = 'draft'`, `author_profile_id` = your profile.
2. Reviewed (by Mehdi or another admin) -- `status = 'reviewed'`.
3. Turned into an `automotive_knowledge_entries` row with `source_type = 'mechanic_authored'`, `reviewed_by`/`reviewed_at` set, and risk level assigned per the safety model in [ARCHITECTURE.md](./ARCHITECTURE.md#5-safety-model).
4. Case marked `published` and linked to that entry via `published_entry_id` -- enforced by a DB constraint, so a case can't be marked published without an actual entry behind it.

Until real cases exist, only `isFixture: true` test data populates the pipeline (see `tests/automotive/fixtures.mjs`) -- those are clearly marked and excluded from retrieval, never shown as real knowledge.
