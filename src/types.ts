export interface Address {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  notes?: string;
}

export interface LineItem {
  id: string;
  item: string;
  description: string;
  um: string;
  ordered: number;
  rate: number;
}

export type OrderStatus =
  | "Entered"
  | "Checked"
  | "Allocated"
  | "Backordered"
  | "Pick & Packed"
  | "Shipped";

export interface AllocationLine {
  lineItemId: string;
  allocatedQty: number;
}

export interface AllocationDecision {
  lines: AllocationLine[];
  fullyAllocated: boolean;
  shipCompleteOnly?: boolean;
  decidedAt: string;
}

export interface ShipmentLine {
  lineItemId: string;
  qty: number;
}

export interface ShipmentRecord {
  id: string;
  shippedAt: string;
  lines: ShipmentLine[];
}

export interface PurchaseOrder {
  soNumber: string;
  poNumber: string;
  orderDate: string;
  dueDate: string;
  customerId?: string;
  shipToLocationId?: string;
  billTo: Address;
  shipTo: Address;
  fob: string;
  shipVia: string;
  terms: string;
  rep: string;
  taxRate: number;
  notes: string;
  lineItems: LineItem[];
  status: OrderStatus;
  checkedAt?: string;
  allocation?: AllocationDecision;
  labelPrintedAt?: string;
  pickedAt?: string;
  pendingShipment?: ShipmentLine[];
  pickListPrintedAt?: string;
  packingSlipPrintedAt?: string;
  shipmentHistory?: ShipmentRecord[];
  estimatedShipDate?: string;
  pickPackStatus?: "Partial" | "Complete";
  createdAt: string;
}

export interface ShippingLocation {
  id: string;
  label: string;
  address: Address;
}

export interface Customer {
  id: string;
  name: string;
  accountNumber: string;
  billTo: Address;
  shipToLocations: ShippingLocation[];
  terms: string;
  shipVia: string;
  fob: string;
  rep: string;
  shipCompleteOnly: boolean;
  // When set, product labels printed for this customer show this brand
  // name instead of ours - for customers who private-label our products.
  privateLabelName?: string;
  createdAt: string;
}

export interface Item {
  id: string;
  itemNumber: string;
  description: string;
  um: string;
  rate: number;
  // Physical count on the shelf, and what's currently on order from a
  // supplier to replenish it. Both are maintained directly (edited or
  // imported) since neither can be derived from anything else in the app.
  qtyOnHand: number;
  qtyOnPurchaseOrder: number;
  createdAt: string;
}

export function emptyAddress(): Address {
  return { name: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "", notes: "" };
}

export function emptyShippingLocation(): ShippingLocation {
  return { id: crypto.randomUUID(), label: "", address: emptyAddress() };
}

export function emptyCustomer(): Customer {
  return {
    id: crypto.randomUUID(),
    name: "",
    accountNumber: "",
    billTo: emptyAddress(),
    shipToLocations: [emptyShippingLocation()],
    terms: "",
    shipVia: "",
    fob: "",
    rep: "",
    shipCompleteOnly: false,
    createdAt: new Date().toISOString(),
  };
}

export function emptyItem(): Item {
  return {
    id: crypto.randomUUID(),
    itemNumber: "",
    description: "",
    um: "EA",
    rate: 0,
    qtyOnHand: 0,
    qtyOnPurchaseOrder: 0,
    createdAt: new Date().toISOString(),
  };
}

export function emptyLineItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    item: "",
    description: "",
    um: "EA",
    ordered: 1,
    rate: 0,
  };
}

export function lineAmount(li: LineItem): number {
  return (li.ordered || 0) * (li.rate || 0);
}

export function allocatedQtyFor(order: Pick<PurchaseOrder, "allocation">, lineItemId: string): number {
  return order.allocation?.lines.find((l) => l.lineItemId === lineItemId)?.allocatedQty ?? 0;
}

export function itemLabel(order: Pick<PurchaseOrder, "lineItems">, lineItemId: string): string {
  const li = order.lineItems.find((l) => l.id === lineItemId);
  return li ? li.item : lineItemId;
}

export function shippedQtyFor(order: Pick<PurchaseOrder, "shipmentHistory">, lineItemId: string): number {
  return (order.shipmentHistory ?? []).reduce((sum, rec) => {
    const line = rec.lines.find((l) => l.lineItemId === lineItemId);
    return sum + (line?.qty ?? 0);
  }, 0);
}

// How much of `li` is still owed on the order: what was ordered, less
// whatever has actually shipped so far (allocation and packing are just
// staging steps toward that shipment, so they don't reduce this).
export function remainingToShip(order: Pick<PurchaseOrder, "shipmentHistory">, li: LineItem): number {
  return Math.max(0, li.ordered - shippedQtyFor(order, li.id));
}

// Total quantity of `itemNumber` still owed across every order in
// `orders`. A fully shipped order always contributes 0, so there's no
// need to filter by status - closed orders drop out on their own.
export function qtyOnOpenSalesOrders(
  itemNumber: string,
  orders: Pick<PurchaseOrder, "lineItems" | "shipmentHistory">[]
): number {
  const q = itemNumber.trim().toLowerCase();
  return orders.reduce(
    (sum, o) =>
      sum +
      o.lineItems
        .filter((li) => li.item.trim().toLowerCase() === q)
        .reduce((lineSum, li) => lineSum + remainingToShip(o, li), 0),
    0
  );
}

// What's free to promise on a new order right now: on hand, less what's
// already committed to open sales orders.
export function availableQty(item: Pick<Item, "qtyOnHand">, qtyOnSalesOrder: number): number {
  return item.qtyOnHand - qtyOnSalesOrder;
}

// Confirms a shipment of `lines` (typically the order's pendingShipment) and
// returns the updated order: Shipped once every line's cumulative shipped
// quantity meets what was ordered, otherwise Backordered so any gap surfaces
// in the Back Order Queue for reallocation.
export function confirmShipment(order: PurchaseOrder, lines: ShipmentLine[]): PurchaseOrder {
  const shippedLines = lines.filter((l) => l.qty > 0);
  const shipmentHistory: ShipmentRecord[] = [
    ...(order.shipmentHistory ?? []),
    ...(shippedLines.length > 0
      ? [{ id: crypto.randomUUID(), shippedAt: new Date().toISOString(), lines: shippedLines }]
      : []),
  ];
  const shippedFor = (lineItemId: string) =>
    shipmentHistory.reduce((sum, rec) => {
      const line = rec.lines.find((l) => l.lineItemId === lineItemId);
      return sum + (line?.qty ?? 0);
    }, 0);
  const fullyShipped = order.lineItems.every((li) => shippedFor(li.id) >= li.ordered);
  return {
    ...order,
    status: fullyShipped ? "Shipped" : "Backordered",
    shipmentHistory,
    pendingShipment: [],
  };
}

export function orderSubtotal(order: Pick<PurchaseOrder, "lineItems">): number {
  return order.lineItems.reduce((sum, li) => sum + lineAmount(li), 0);
}

export function orderTax(order: Pick<PurchaseOrder, "lineItems" | "taxRate">): number {
  return orderSubtotal(order) * ((order.taxRate || 0) / 100);
}

export function orderTotal(order: Pick<PurchaseOrder, "lineItems" | "taxRate">): number {
  return orderSubtotal(order) + orderTax(order);
}
