import { useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/apiClient";
import { useCanEdit } from "../lib/authContext";
import { parseCsvWithHeaders, toCsv, toCsvTable, type ParsedCsv } from "../lib/csv";
import { saveCustomer } from "../lib/customerStore";
import type { RowResult, RowStatus } from "../lib/importParsers";
import {
  loadImportContext,
  markExistingOrders,
  parseCustomers,
  parseInventory,
  parseItems,
  parseSalesOrders,
  rowStatus,
} from "../lib/importParsers";
import { saveItem, updateItem } from "../lib/itemStore";
import { saveOrder } from "../lib/orderStore";
import type { Customer, Item, PurchaseOrder } from "../types";

type ImportType = "customers" | "items" | "orders" | "inventory";
type ImportRecord = Customer | Item | PurchaseOrder;
type Row = RowResult<ImportRecord>;

const LABELS: Record<ImportType, string> = {
  customers: "Customers",
  items: "Items",
  orders: "Sales Orders",
  inventory: "Inventory",
};

const TEMPLATES: Record<ImportType, { headers: string[]; sample: string[] }> = {
  customers: {
    headers: [
      "Customer Name",
      "Account Number",
      "Address",
      "City",
      "State",
      "Zip",
      "Terms",
      "Ship Via",
      "FOB",
      "Rep",
      "Ship Complete Only",
    ],
    sample: [
      "Acme Rope Co",
      "ACME-01",
      "123 Dock St",
      "Manteno",
      "IL",
      "60950",
      "Net 30",
      "Common Carrier",
      "Origin",
      "J. Smith",
      "No",
    ],
  },
  items: {
    headers: ["Item Number", "Description", "U/M", "Rate", "On Hand", "On Purchase Order", "Weight"],
    sample: ["RP-100", "1/2in Twisted Rope, 600ft coil", "EA", "42.50", "120", "0", "24.5"],
  },
  inventory: {
    headers: ["Item Number", "On Hand", "On Purchase Order"],
    sample: ["RP-100", "120", "0"],
  },
  orders: {
    headers: [
      "PO Number",
      "Customer Name",
      "Order Date",
      "Due Date",
      "Item Number",
      "Description",
      "U/M",
      "Ordered Qty",
      "Rate",
      "Terms",
      "Ship Via",
      "Notes",
    ],
    sample: [
      "PO-1001",
      "Acme Rope Co",
      "2026-09-22",
      "2026-09-22",
      "RP-100",
      "1/2in Twisted Rope, 600ft coil",
      "EA",
      "10",
      "42.50",
      "Net 30",
      "Common Carrier",
      "Thank you for your order!",
    ],
  },
};

// What happened to one row when the import ran.
type Outcome =
  | { kind: "created" | "updated"; detail: string }
  | { kind: "skipped"; detail: string }
  | { kind: "failed"; detail: string }
  | { kind: "invalid"; detail: string };

type Phase = "idle" | "parsing" | "ready" | "saving" | "done";

const PREVIEW_STATUS: Record<RowStatus, { text: string; cls: string }> = {
  ready: { text: "Ready", cls: "import-status-ready" },
  duplicate: { text: "Skip (already exists)", cls: "import-status-skipped" },
  error: { text: "Error", cls: "import-status-failed" },
};

const OUTCOME_STATUS: Record<Outcome["kind"], { text: string; cls: string }> = {
  created: { text: "Created", cls: "import-status-created" },
  updated: { text: "Updated", cls: "import-status-created" },
  skipped: { text: "Skipped (already exists)", cls: "import-status-skipped" },
  failed: { text: "Failed", cls: "import-status-failed" },
  invalid: { text: "Not imported", cls: "import-status-failed" },
};

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // Validation failures come back as a structured object rather than a
    // message, which apiClient turns into "Request failed (400)".
    if (err.status === 400) return "The server rejected this row as invalid (400) - check its values";
    if (err.status === 403) return "You don't have permission to create these records";
    return err.message;
  }
  if (err instanceof TypeError) return "Couldn't reach the server";
  return err instanceof Error ? err.message : String(err);
}

function rowDetail(r: Row): string {
  if (r.errors.length > 0) return r.errors.join("; ");
  return r.duplicateReason ?? "";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function saveRow(type: ImportType, data: ImportRecord): Promise<Outcome> {
  switch (type) {
    case "customers":
      await saveCustomer(data as Customer);
      return { kind: "created", detail: "" };
    case "items":
      try {
        await saveItem(data as Item);
        return { kind: "created", detail: "" };
      } catch (err) {
        // Someone added the same item # after the preview was built.
        if (err instanceof ApiError && err.status === 409) return { kind: "skipped", detail: err.message };
        throw err;
      }
    case "orders": {
      const saved = await saveOrder(data as PurchaseOrder);
      return { kind: "created", detail: saved?.soNumber ? `S.O. #${saved.soNumber}` : "" };
    }
    case "inventory":
      await updateItem(data as Item);
      return { kind: "updated", detail: "" };
  }
}

export default function Import() {
  const canEdit = useCanEdit();
  const [type, setType] = useState<ImportType>("customers");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [loadError, setLoadError] = useState("");
  const [orderCheckWarning, setOrderCheckWarning] = useState("");
  const [outcomes, setOutcomes] = useState<(Outcome | undefined)[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bumped whenever the file or type changes, so a slow parse for an
  // earlier file can't overwrite the current one's preview.
  const parseToken = useRef(0);

  const saving = phase === "saving";

  // Leaving mid-import would silently stop it partway through.
  useEffect(() => {
    if (!saving) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving]);

  function reset() {
    parseToken.current++;
    setCsv(null);
    setRows(null);
    setPhase("idle");
    setLoadError("");
    setOrderCheckWarning("");
    setOutcomes([]);
    setProgress({ done: 0, total: 0 });
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function switchType(next: ImportType) {
    if (saving) return;
    setType(next);
    reset();
  }

  async function buildPreview(importType: ImportType, parsed: ParsedCsv, token: number) {
    try {
      const ctx = await loadImportContext(importType);
      let result: Row[];
      let warning = "";
      if (importType === "customers") result = parseCustomers(parsed, ctx.customers);
      else if (importType === "items") result = parseItems(parsed, ctx.items);
      else if (importType === "inventory") result = parseInventory(parsed, ctx.items);
      else {
        const orders = parseSalesOrders(parsed, ctx.customers, ctx.items, ctx.leadTimeDays);
        const checked = await markExistingOrders(orders);
        result = checked.results;
        if (checked.unchecked > 0) {
          warning = `${plural(checked.unchecked, "order")} couldn't be compared against existing sales orders, so they'll be created even if they were imported before. Check Open Orders for these PO numbers first.`;
        }
      }
      if (token !== parseToken.current) return;
      setRows(result);
      setOrderCheckWarning(warning);
      setPhase("ready");
    } catch (err) {
      if (token !== parseToken.current) return;
      setLoadError(`Couldn't load existing records to check this file against: ${errorMessage(err)}`);
      setPhase("idle");
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || saving) return;
    const importType = type;
    reset();
    const token = parseToken.current;
    setFileName(file.name);
    setPhase("parsing");
    const reader = new FileReader();
    reader.onload = () => {
      if (token !== parseToken.current) return;
      const parsed = parseCsvWithHeaders(String(reader.result ?? ""));
      setCsv(parsed);
      void buildPreview(importType, parsed, token);
    };
    reader.onerror = () => {
      if (token !== parseToken.current) return;
      setLoadError("Couldn't read that file.");
      setPhase("idle");
    };
    reader.readAsText(file);
    // Clear the input so picking the same (now corrected) file again still
    // fires onChange - the chosen name is shown next to it instead.
    e.target.value = "";
  }

  function downloadBlob(text: string, name: string) {
    const blob = new Blob([text], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadTemplate() {
    const t = TEMPLATES[type];
    downloadBlob(toCsv(t.headers, t.sample), `${type}-import-template.csv`);
  }

  async function commitImport() {
    if (!rows || phase !== "ready" || !canEdit) return;
    const importType = type;
    const token = parseToken.current;
    const initial: (Outcome | undefined)[] = rows.map((r) => {
      const status = rowStatus(r);
      if (status === "error") return { kind: "invalid", detail: rowDetail(r) };
      if (status === "duplicate") return { kind: "skipped", detail: r.duplicateReason ?? "" };
      return undefined;
    });
    const todo = rows.map((_, i) => i).filter((i) => initial[i] === undefined);
    setOutcomes(initial);
    setProgress({ done: 0, total: todo.length });
    setPhase("saving");

    const results = [...initial];
    // One row at a time, never stopping the run on a rejection: each row's
    // outcome is recorded so the user sees exactly what was and wasn't saved.
    for (let n = 0; n < todo.length; n++) {
      const i = todo[n];
      try {
        results[i] = await saveRow(importType, rows[i].data!);
      } catch (err) {
        results[i] = { kind: "failed", detail: errorMessage(err) };
      }
      if (token === parseToken.current) {
        setOutcomes([...results]);
        setProgress({ done: n + 1, total: todo.length });
      }
    }
    if (token === parseToken.current) setPhase("done");
  }

  function downloadFailedRows() {
    if (!csv || !rows) return;
    // Drop an "Error" column carried over from a previous failed-rows file
    // so re-exporting doesn't stack them up.
    const keep = csv.headers.map((h, i) => ({ h, i })).filter(({ h }) => h !== "error");
    const headers = [...keep.map(({ i }) => csv.rawHeaders[i] ?? csv.headers[i]), "Error"];
    const out: string[][] = [];
    rows.forEach((r, idx) => {
      const outcome = outcomes[idx];
      const failed = outcome ? outcome.kind === "failed" || outcome.kind === "invalid" : rowStatus(r) === "error";
      if (!failed) return;
      const message = outcome?.detail || rowDetail(r);
      for (const src of r.sourceRows) out.push([...keep.map(({ h }) => src[h] ?? ""), message]);
    });
    const base = fileName.replace(/\.csv$/i, "") || type;
    downloadBlob(toCsvTable(headers, out), `${base}-failed-rows.csv`);
  }

  const statuses = rows?.map(rowStatus) ?? [];
  const readyCount = statuses.filter((s) => s === "ready").length;
  const duplicateCount = statuses.filter((s) => s === "duplicate").length;
  const errorCount = statuses.filter((s) => s === "error").length;
  const hasOutcomes = phase === "saving" || phase === "done";
  const count = (kind: Outcome["kind"]) => outcomes.filter((o) => o?.kind === kind).length;
  const createdCount = count("created") + count("updated");
  const failedCount = count("failed");
  const skippedCount = count("skipped");
  const invalidCount = count("invalid");
  const downloadableCount = hasOutcomes ? failedCount + invalidCount : errorCount;
  const sourceRowCount = csv?.rows.length ?? 0;

  let importLabel = `Import ${readyCount} ${LABELS[type]}`;
  if (saving) importLabel = `Saving ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
  else if (phase === "done") importLabel = "Import finished";

  return (
    <div className="page">
      <div className="page-header">
        <h1>Import Data</h1>
        <p className="muted">
          Upload a CSV exported from Excel, Google Sheets, or your current system to bulk-load customers,
          items, sales orders, or inventory levels.
        </p>
      </div>

      <div className="import-type-tabs">
        {(Object.keys(LABELS) as ImportType[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`decision-btn ${type === t ? "selected" : ""}`}
            onClick={() => switchType(t)}
            disabled={saving}
          >
            {LABELS[t]}
          </button>
        ))}
      </div>

      <div className="import-panel">
        <div className="import-panel-header">
          <div>
            <h3>Expected columns</h3>
            <p className="muted">
              Header names are matched loosely (case and spacing don't matter) and extra columns are
              ignored. Amounts like $1,234.50 are fine; dates can be YYYY-MM-DD or M/D/YYYY.
            </p>
            <p className="import-columns">{TEMPLATES[type].headers.join(" · ")}</p>
            {type === "orders" && (
              <p className="muted">
                Each row is one line item. Rows that share the same PO Number are combined into a single
                multi-line sales order. A matching Customer Name pulls that customer's address and terms
                automatically. S.O. numbers are always assigned by the system, same as Order Entry. An
                order whose PO Number is already on file for that customer is skipped.
              </p>
            )}
            {type === "inventory" && (
              <p className="muted">
                Item Number must already exist in the item catalog - this only updates stock levels on
                existing items, it never creates new ones. Leave On Hand or On Purchase Order blank to
                leave that value unchanged.
              </p>
            )}
            {(type === "customers" || type === "items") && (
              <p className="muted">
                {type === "customers"
                  ? "Customers whose name or account number is already on file are skipped, so a file can safely be re-imported."
                  : "Items whose Item Number is already in the catalog are skipped, so a file can safely be re-imported."}
              </p>
            )}
          </div>
          <button type="button" className="secondary-btn" onClick={downloadTemplate}>
            Download CSV Template
          </button>
        </div>

        {!canEdit && (
          <div className="decision-outcome outcome-warning import-banner">
            <div className="decision-outcome-label">View-only access</div>
            <div className="decision-outcome-detail">
              You can download templates and preview a file, but importing needs edit access to this page.
            </div>
          </div>
        )}

        <div className="toolbar">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            disabled={saving}
          />
          {fileName && <span className="muted">{fileName}</span>}
        </div>

        {phase === "parsing" && <p className="muted">Checking {fileName} against existing records…</p>}

        {loadError && (
          <div className="decision-outcome outcome-hold import-banner">
            <div className="decision-outcome-label">Couldn't check this file</div>
            <div className="decision-outcome-detail">{loadError}</div>
          </div>
        )}

        {rows && (
          <>
            {orderCheckWarning && (
              <div className="decision-outcome outcome-warning import-banner">
                <div className="decision-outcome-label">Couldn't check for duplicate orders</div>
                <div className="decision-outcome-detail">{orderCheckWarning}</div>
              </div>
            )}

            {!hasOutcomes && (
              <p className="muted">
                {type === "orders"
                  ? `${plural(rows.length, "order")} parsed from ${plural(sourceRowCount, "spreadsheet row")}`
                  : `${plural(rows.length, "row")} parsed`}{" "}
                — {readyCount} ready to import
                {duplicateCount > 0 ? `, ${duplicateCount} already exist (will be skipped)` : ""}
                {errorCount > 0 ? `, ${errorCount} with errors (won't be imported)` : ""}.
              </p>
            )}

            {hasOutcomes && (
              <div
                className={`decision-outcome import-banner ${
                  saving ? "" : failedCount > 0 ? "outcome-hold" : "outcome-success"
                }`}
                role="status"
                aria-live="polite"
              >
                <div className="decision-outcome-label">
                  {saving
                    ? `Saving ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                    : failedCount > 0
                      ? "Import finished with failures"
                      : "Import complete"}
                </div>
                <div className="decision-outcome-detail">
                  {type === "inventory" ? "Updated" : "Created"} {createdCount} · Skipped (already exist){" "}
                  {skippedCount} · Failed {failedCount}
                  {invalidCount > 0 ? ` · Not imported (row errors) ${invalidCount}` : ""}
                  {!saving && downloadableCount > 0
                    ? ". Download the failed rows, fix them, and import that file - rows already created will be skipped."
                    : ""}
                </div>
              </div>
            )}

            {rows.length > 0 && (
              <div className="import-results-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Record</th>
                      <th>Status</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => {
                      const outcome = outcomes[idx];
                      const pending = hasOutcomes && !outcome;
                      const status = outcome
                        ? OUTCOME_STATUS[outcome.kind]
                        : pending
                          ? { text: "Waiting", cls: "import-status-ready" }
                          : PREVIEW_STATUS[statuses[idx]];
                      const detail = outcome ? outcome.detail : rowDetail(r);
                      return (
                        <tr key={r.rowNumber}>
                          <td>
                            {r.rowNumbers.length > 4
                              ? `${r.rowNumbers.slice(0, 3).join(", ")}, … (${r.rowNumbers.length} rows)`
                              : r.rowNumbers.join(", ")}
                          </td>
                          <td>{r.label}</td>
                          <td>
                            <span className={`import-status ${status.cls}`}>{status.text}</span>
                          </td>
                          <td>{detail}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="button-row">
              {canEdit && (
                <button
                  type="button"
                  className="primary-btn"
                  disabled={phase !== "ready" || readyCount === 0}
                  onClick={commitImport}
                >
                  {importLabel}
                </button>
              )}
              {downloadableCount > 0 && !saving && (
                <button type="button" className="secondary-btn" onClick={downloadFailedRows}>
                  {hasOutcomes ? "Download failed rows as CSV" : "Download rows with errors as CSV"}
                </button>
              )}
              <button type="button" className="secondary-btn" onClick={reset} disabled={saving}>
                Clear
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
