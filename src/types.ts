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
  createdAt: string;
}

export interface Item {
  id: string;
  itemNumber: string;
  description: string;
  um: string;
  rate: number;
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

export function hasAnyAllocatedQty(order: Pick<PurchaseOrder, "allocation">): boolean {
  return (order.allocation?.lines ?? []).some((l) => l.allocatedQty > 0);
}

export function shippedQtyFor(order: Pick<PurchaseOrder, "shipmentHistory">, lineItemId: string): number {
  return (order.shipmentHistory ?? []).reduce((sum, rec) => {
    const line = rec.lines.find((l) => l.lineItemId === lineItemId);
    return sum + (line?.qty ?? 0);
  }, 0);
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
