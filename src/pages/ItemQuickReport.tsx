import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getItem, getItemQuickReport } from "../lib/itemStore";
import type { ReportRow } from "../lib/reports/types";
import type { Item } from "../types";

interface QuickReportData {
  summary: {
    onHand: number;
    onSalesOrder: number;
    allocated: number;
    onPurchaseOrder: number;
    available: number;
    // Only for a login that may see cost (E-05).
    cost?: number | null;
    valueAtCost?: number | null;
    margin?: number;
  } | null;
  soLines: ReportRow[];
  // Set when the item's order history was cut off at the fetch cap.
  notice?: string;
  poLines: ReportRow[];
  pricesHidden?: boolean;
  costHidden?: boolean;
}

const money = (v: unknown) => (typeof v === "number" ? `$${v.toFixed(2)}` : v === null || v === undefined ? "—" : String(v));

const SO_COLUMNS: { key: string; label: string; align?: "right" }[] = [
  { key: "soNumber", label: "S.O. #" },
  { key: "customer", label: "Customer" },
  { key: "orderDate", label: "Order Date" },
  { key: "status", label: "Status" },
  { key: "ordered", label: "Ordered", align: "right" },
  { key: "shipped", label: "Shipped", align: "right" },
  { key: "remaining", label: "Remaining", align: "right" },
  { key: "allocated", label: "Allocated", align: "right" },
];
// Rate and margin ride along for logins that may see prices and cost.
const SO_PRICE_COLUMNS: typeof SO_COLUMNS = [
  { key: "rate", label: "Rate", align: "right" },
  { key: "amount", label: "Amount", align: "right" },
];
const SO_MARGIN_COLUMNS: typeof SO_COLUMNS = [
  { key: "margin", label: "Margin / unit", align: "right" },
  { key: "lineMargin", label: "Line margin", align: "right" },
];
const PO_COST_COLUMNS: typeof SO_COLUMNS = [{ key: "cost", label: "Cost", align: "right" }];
const MONEY_KEYS = new Set(["rate", "amount", "margin", "lineMargin", "cost"]);

const PO_COLUMNS: { key: string; label: string; align?: "right" }[] = [
  { key: "poNumber", label: "PO #" },
  { key: "vendor", label: "Vendor" },
  { key: "orderDate", label: "Order Date" },
  { key: "status", label: "Status" },
  { key: "orderedQty", label: "Ordered", align: "right" },
  { key: "receivedQty", label: "Received", align: "right" },
  { key: "outstanding", label: "Outstanding", align: "right" },
];

function ReportTable({ columns, rows, emptyText }: { columns: typeof SO_COLUMNS; rows: ReportRow[]; emptyText: string }) {
  if (rows.length === 0) return <p className="muted">{emptyText}</p>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((c) => (
              <td key={c.key} className={c.align === "right" ? "amount-cell" : undefined}>
                {MONEY_KEYS.has(c.key) ? money(row[c.key]) : row[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ItemQuickReport() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | undefined>(undefined);
  const [loadingItem, setLoadingItem] = useState(true);
  const [data, setData] = useState<QuickReportData | null>(null);

  useEffect(() => {
    if (!id) {
      setLoadingItem(false);
      return;
    }
    getItem(id).then((i) => {
      setItem(i);
      setLoadingItem(false);
    });
  }, [id]);

  // One request for the whole report (D-10).
  useEffect(() => {
    if (!item) return;
    getItemQuickReport(item.id).then(setData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (loadingItem) {
    return (
      <div className="page">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="page">
        <p>Item not found.</p>
        <Link to="/items">&larr; Back to Item Catalog</Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  const { summary } = data;
  const showCost = !data.costHidden && summary?.cost !== undefined;
  const soColumns = [...SO_COLUMNS, ...(data.pricesHidden ? [] : SO_PRICE_COLUMNS), ...(!data.pricesHidden && showCost && summary?.margin !== undefined ? SO_MARGIN_COLUMNS : [])];
  const poColumns = [...PO_COLUMNS, ...(showCost ? PO_COST_COLUMNS : [])];

  return (
    <div className="page">
      <div className="page-header no-print">
        <Link to={`/items/${item.id}`} className="link-btn">
          &larr; Back to {item.itemNumber}
        </Link>
        <div className="inline-actions">
          <button type="button" className="secondary-btn print-btn" onClick={() => window.print()}>
            Print / Preview
          </button>
        </div>
      </div>

      <div className="page-header">
        <h1>Quick Report: {item.itemNumber}</h1>
        <p className="muted">{item.description}</p>
      </div>

      {summary && (
        <table className="meta-table order-details-table">
          <thead>
            <tr>
              <th>On Hand</th>
              <th>On Sales Order</th>
              <th>Allocated</th>
              <th>On Purchase Order</th>
              <th>Available</th>
              {showCost && <th>Cost</th>}
              {showCost && <th>On-Hand at Cost</th>}
              {showCost && summary.margin !== undefined && <th>Margin / unit</th>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{summary.onHand}</td>
              <td>{summary.onSalesOrder}</td>
              <td>{summary.allocated}</td>
              <td>{summary.onPurchaseOrder}</td>
              <td>{summary.available}</td>
              {showCost && <td>{money(summary.cost)}</td>}
              {showCost && <td>{money(summary.valueAtCost)}</td>}
              {showCost && summary.margin !== undefined && <td>{money(summary.margin)}</td>}
            </tr>
          </tbody>
        </table>
      )}

      <section className="lane-section">
        <h3 className="item-profile-heading">Sales Orders</h3>
        {data.notice && <p className="muted">{data.notice}</p>}
        <ReportTable columns={soColumns} rows={data.soLines} emptyText="This item is not on any sales order." />
      </section>

      <section className="lane-section">
        <h3 className="item-profile-heading">Purchase Orders</h3>
        <ReportTable columns={poColumns} rows={data.poLines} emptyText="This item is not on any purchase order." />
      </section>
    </div>
  );
}
