export interface Address {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
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
  | "Validation"
  | "Inventory Allocation"
  | "Pick & Pack"
  | "Fulfillment"
  | "Shipped";

export interface PurchaseOrder {
  soNumber: string;
  poNumber: string;
  orderDate: string;
  dueDate: string;
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
  createdAt: string;
}

export function emptyAddress(): Address {
  return { name: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "" };
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

export function orderSubtotal(order: Pick<PurchaseOrder, "lineItems">): number {
  return order.lineItems.reduce((sum, li) => sum + lineAmount(li), 0);
}

export function orderTax(order: Pick<PurchaseOrder, "lineItems" | "taxRate">): number {
  return orderSubtotal(order) * ((order.taxRate || 0) / 100);
}

export function orderTotal(order: Pick<PurchaseOrder, "lineItems" | "taxRate">): number {
  return orderSubtotal(order) + orderTax(order);
}
