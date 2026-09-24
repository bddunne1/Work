// Minimal RFC4180-style CSV parser: handles quoted fields (embedded
// commas, newlines, and "" as an escaped quote) and both \n and \r\n line
// endings. A hand-written character scan rather than a regex, so a
// pathological file can't trigger catastrophic backtracking.
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  function endField() {
    row.push(field);
    field = "";
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      endField();
      i++;
    } else if (ch === "\r") {
      i++;
    } else if (ch === "\n") {
      endRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_]+/g, " ");
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvWithHeaders(text: string): ParsedCsv {
  const table = parseRows(text).filter((r) => !(r.length === 1 && r[0].trim() === ""));
  if (table.length === 0) return { headers: [], rows: [] };
  const headers = table[0].map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (cells[c] ?? "").trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
}

// Looks up a cell by trying each alias (case/spacing-insensitive) in turn,
// so a spreadsheet can use any of several common header spellings.
export function field(row: Record<string, string>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value) return value;
  }
  return "";
}

// One CSV cell, safe to open in Excel: quoted when it contains a comma,
// quote or line break, and prefixed with ' when it would otherwise be run as
// a formula (a customer named "=HYPERLINK(...)" or "@SUM(...)"). Plain
// negative numbers are left alone so they stay numeric.
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-\d+(\.\d+)?$/.test(v))) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(headers: string[], sampleRow: string[]): string {
  return [headers.map(csvCell).join(","), sampleRow.map(csvCell).join(",")].join("\n");
}
