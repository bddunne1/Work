import { describe, expect, it } from "vitest";
import type { Item } from "../types";
import { parseCsvWithHeaders } from "./csv";
import { parseSalesOrders, rowStatus } from "./importParsers";

const catalog: Item[] = [{ id: "i1", itemNumber: "BR-1001", description: "Braided rope", um: "EA", rate: 2.5, qtyOnHand: 100, qtyOnPurchaseOrder: 0, qtyReserved: 0, createdAt: "2026-01-01T00:00:00.000Z" }];

function orders(rows: string) {
  const csv = parseCsvWithHeaders(`PO Number,Customer Name,Item Number,Ordered Qty,Rate\n${rows}`);
  return parseSalesOrders(csv, [], catalog, 5);
}

describe("parseSalesOrders rates", () => {
  // The server's line schema refuses a negative rate, so the preview must
  // say so too instead of letting the row fail at import time.
  it("reports a negative rate as an error on the row", () => {
    const [r] = orders("PO-1,Acme,BR-1001,10,-5.00");
    expect(rowStatus(r)).toBe("error");
    expect(r.errors).toEqual(["Rate can't be negative"]);
  });

  it("accepts a zero or positive rate", () => {
    const [free, paid] = orders('PO-1,Acme,BR-1001,10,0\nPO-2,Acme,BR-1001,10,"$1,234.50"');
    expect(rowStatus(free)).toBe("ready");
    expect(free.data?.lineItems[0].rate).toBe(0);
    expect(rowStatus(paid)).toBe("ready");
    expect(paid.data?.lineItems[0].rate).toBe(1234.5);
  });

  it("rounds a rate to the four decimals the server accepts", () => {
    const [r] = orders("PO-1,Acme,BR-1001,10,0.33333");
    expect(rowStatus(r)).toBe("ready");
    expect(r.data?.lineItems[0].rate).toBe(0.3333);
  });
});
