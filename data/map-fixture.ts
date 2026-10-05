// SYNTHETIC FIXTURE -- not a real Mehdi-supplied dataset. Every row is
// invented for Phase 1 round-trip testing of the ingestion pipeline
// (validate -> normalize -> dedup -> promote) and is tagged with the
// 'synthetic_fixture' map_sources row, never the 'admin_manual' one, so it
// can never be mistaken for a real import once a real dataset exists.
import type { RawMapRow } from "@/lib/map/ingestion/csv";

export const SYNTHETIC_MAP_FIXTURE: RawMapRow[] = [
  { name_fa: "[نمونه] تعمیرگاه آزادی", lat: 35.6997, lng: 51.338, category_slug: "repair_shop", external_ref: "SYNTH-001" },
  { name_fa: "[نمونه] فروشگاه قطعات ولیعصر", lat: 35.7219, lng: 51.4215, category_slug: "parts_store", external_ref: "SYNTH-002" },
  { name_fa: "[نمونه] نقطه امداد اتوبان کرج", lat: 35.7452, lng: 51.0167, category_slug: "rescue_point", external_ref: "SYNTH-003" },
  { name_fa: "[نمونه] میدان آزادی", lat: 35.6997, lng: 51.338, category_slug: "landmark", external_ref: "SYNTH-004" },
  { name_fa: "", lat: 35.7, lng: 51.4, category_slug: "repair_shop", external_ref: "SYNTH-005-invalid" },
];
