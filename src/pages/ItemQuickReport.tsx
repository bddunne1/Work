import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { itemQuickReportData } from "../lib/reports/dataSources";
import { getItem } from "../lib/itemStore";
import type { ReportRow } from "../lib/reports/types";
import type { Item } from "../types";

interface QuickReportData {
  summary: {
    onHand: number;
    onSalesOrder: number;
    allocated: number;
    onPurchaseOrder: number;
    available: number;
  } | null;
  soLines: ReportRow[];
  poLines: ReportRow[];
}

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
                {row[c.key]}
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
  const item: Item | undefined = id ? getItem(id) : undefined;
  const [data, setData] = useState<QuickReportData | null>(null);

  useEffect(() => {
    if (!item) return;
    itemQuickReportData(item.itemNumber).then(setData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.itemNumber]);

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
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{summary.onHand}</td>
              <td>{summary.onSalesOrder}</td>
              <td>{summary.allocated}</td>
              <td>{summary.onPurchaseOrder}</td>
              <td>{summary.available}</td>
            </tr>
          </tbody>
        </table>
      )}

      <section className="lane-section">
        <h3 className="item-profile-heading">Sales Orders</h3>
        <ReportTable columns={SO_COLUMNS} rows={data.soLines} emptyText="This item is not on any sales order." />
      </section>

      <section className="lane-section">
        <h3 className="item-profile-heading">Purchase Orders</h3>
        <ReportTable columns={PO_COLUMNS} rows={data.poLines} emptyText="This item is not on any purchase order." />
      </section>
    </div>
  );
}
