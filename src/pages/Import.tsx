import { useRef, useState } from "react";
import { parseCsvWithHeaders, toCsv } from "../lib/csv";
import { saveCustomer } from "../lib/customerStore";
import type { RowResult } from "../lib/importParsers";
import { parseCustomers, parseInventory, parseItems, parseSalesOrders } from "../lib/importParsers";
import { saveItem, updateItem } from "../lib/itemStore";
import { nextSalesOrderNumber, saveOrder } from "../lib/orderStore";
import type { Customer, Item, PurchaseOrder } from "../types";

type ImportType = "customers" | "items" | "orders" | "inventory";

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

export default function Import() {
  const [type, setType] = useState<ImportType>("customers");
  const [fileName, setFileName] = useState("");
  const [customerRows, setCustomerRows] = useState<RowResult<Customer>[] | null>(null);
  const [itemRows, setItemRows] = useState<RowResult<Item>[] | null>(null);
  const [orderRows, setOrderRows] = useState<RowResult<PurchaseOrder>[] | null>(null);
  const [orderSourceRowCount, setOrderSourceRowCount] = useState(0);
  const [inventoryRows, setInventoryRows] = useState<RowResult<Item>[] | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setCustomerRows(null);
    setItemRows(null);
    setOrderRows(null);
    setOrderSourceRowCount(0);
    setInventoryRows(null);
    setImported(null);
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function switchType(next: ImportType) {
    setType(next);
    reset();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImported(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async () => {
      const parsed = parseCsvWithHeaders(String(reader.result ?? ""));
      if (type === "customers") setCustomerRows(parseCustomers(parsed));
      else if (type === "items") setItemRows(parseItems(parsed));
      else if (type === "inventory") setInventoryRows(parseInventory(parsed));
      else {
        setOrderRows(await parseSalesOrders(parsed));
        setOrderSourceRowCount(parsed.rows.length);
      }
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const t = TEMPLATES[type];
    const blob = new Blob([toCsv(t.headers, t.sample)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-import-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function commitImport() {
    if (type === "customers" && customerRows) {
      const valid = customerRows.filter((r) => r.data).map((r) => r.data!);
      for (const c of valid) await saveCustomer(c);
      setImported(valid.length);
    } else if (type === "items" && itemRows) {
      const valid = itemRows.filter((r) => r.data).map((r) => r.data!);
      for (const it of valid) saveItem(it);
      setImported(valid.length);
    } else if (type === "orders" && orderRows) {
      const valid = orderRows.filter((r) => r.data).map((r) => r.data!);
      for (const o of valid) saveOrder({ ...o, soNumber: nextSalesOrderNumber() });
      setImported(valid.length);
    } else if (type === "inventory" && inventoryRows) {
      const valid = inventoryRows.filter((r) => r.data).map((r) => r.data!);
      for (const it of valid) updateItem(it);
      setImported(valid.length);
    }
  }

  const rows =
    type === "customers"
      ? customerRows
      : type === "items"
        ? itemRows
        : type === "inventory"
          ? inventoryRows
          : orderRows;
  const validCount = rows?.filter((r) => r.errors.length === 0).length ?? 0;
  const errorRows = rows?.filter((r) => r.errors.length > 0) ?? [];

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
              ignored.
            </p>
            <p className="import-columns">{TEMPLATES[type].headers.join(" · ")}</p>
            {type === "orders" && (
              <p className="muted">
                Each row is one line item. Rows that share the same PO Number are combined into a single
                multi-line sales order. A matching Customer Name pulls that customer's address and terms
                automatically. S.O. numbers are always assigned by the system, same as Order Entry.
              </p>
            )}
            {type === "inventory" && (
              <p className="muted">
                Item Number must already exist in the item catalog - this only updates stock levels on
                existing items, it never creates new ones. Leave On Hand or On Purchase Order blank to
                leave that value unchanged.
              </p>
            )}
          </div>
          <button type="button" className="secondary-btn" onClick={downloadTemplate}>
            Download CSV Template
          </button>
        </div>

        <div className="toolbar">
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFile} />
          {fileName && <span className="muted">{fileName}</span>}
        </div>

        {rows && (
          <>
            <p className="muted">
              {type === "orders"
                ? `${rows.length} order${rows.length === 1 ? "" : "s"} parsed from ${orderSourceRowCount} spreadsheet row${orderSourceRowCount === 1 ? "" : "s"}`
                : `${rows.length} row${rows.length === 1 ? "" : "s"} parsed`}{" "}
              — {validCount} ready to import
              {errorRows.length > 0 ? `, ${errorRows.length} with errors` : ""}.
            </p>

            {errorRows.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {errorRows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td>{r.rowNumber}</td>
                      <td>{r.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="button-row">
              <button
                type="button"
                className="primary-btn"
                disabled={validCount === 0}
                onClick={commitImport}
              >
                Import {validCount} {LABELS[type]}
              </button>
              <button type="button" className="secondary-btn" onClick={reset}>
                Clear
              </button>
            </div>
          </>
        )}

        {imported !== null && (
          <div className="decision-outcome outcome-success">
            <div className="decision-outcome-label">Import complete</div>
            <div className="decision-outcome-detail">
              Imported {imported} {LABELS[type].toLowerCase()}.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
