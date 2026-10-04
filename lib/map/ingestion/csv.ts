// Minimal $0 CSV parser for Map admin import -- no dependency, handles
// quoted fields and escaped quotes ("") per RFC 4180. Good enough for
// admin-supplied POI spreadsheets exported as CSV; Excel (.xlsx) import
// reuses this same raw-row shape once a sheet is exported/converted to CSV,
// so no separate ingestion path is needed for that format in Phase 1.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export type RawMapRow = {
  name_fa: string;
  lat: number | null;
  lng: number | null;
  category_slug: string;
  external_ref: string | null;
};

// Expects a header row: name_fa,lat,lng,category_slug,external_ref (any
// column order; unknown columns are ignored).
export function csvToRawRows(text: string): RawMapRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = (col: string) => header.indexOf(col);
  const iName = idx("name_fa"), iLat = idx("lat"), iLng = idx("lng"), iCat = idx("category_slug"), iRef = idx("external_ref");
  return rows.slice(1).map((r) => ({
    name_fa: (r[iName] ?? "").trim(),
    lat: r[iLat] != null && r[iLat] !== "" ? Number(r[iLat]) : null,
    lng: r[iLng] != null && r[iLng] !== "" ? Number(r[iLng]) : null,
    category_slug: (r[iCat] ?? "").trim(),
    external_ref: iRef >= 0 && r[iRef] !== "" ? r[iRef] : null,
  }));
}
