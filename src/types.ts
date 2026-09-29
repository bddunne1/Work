import { fromCents, lineAmountCents, taxCents } from "./lib/money";
import { localIsoDate } from "./lib/dateUtils";

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
  // Catalog link, resolved by the server on save (read-only on the client).
  itemId?: string | null;
  item: string;
  description: string;
  um: string;
  ordered: number;
  rate: number;
  // The customer's own part number for this item, if different from ours -
  // auto-filled from the customer's part number catalog when set (see
  // CustomerPartMapping), but always editable per line.
  customerPartNumber?: string;
}

export type OrderStatus =
  | "Entered"
  | "Checked"
  | "Allocated"
  | "Backordered"
  | "Pick & Packed"
  | "Shipped"
  | "Cancelled";

// Statuses that are finished - nothing left to pick, ship or hold stock for.
export function isClosedStatus(status: OrderStatus): boolean {
  return status === "Shipped" || status === "Cancelled";
}

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

export interface BolDetails {
  weight: string;
  packageCount: string;
  palletSlip: "Y" | "N";
  handlingUnitQty: string;
  handlingUnitType: string;
  packageQty: string;
  packageType: string;
  hazmat: boolean;
  commodityDescription: string;
  nmfcNumber: string;
  freightClass: string;
  additionalInfo: string;
  generatedAt: string;
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
  // Initials + account id of whoever entered this order - shown as a
  // signature at the bottom of the printed order, and lets its own author
  // edit it later to fix a mistake even without general edit access.
  writtenBy?: string;
  writtenById?: string;
  // The writer's account color at the time this order was entered - colors
  // the "Entered by" signature so each account's mark is visually distinct.
  writtenByColor?: string;
  checkedAt?: string;
  // Initials of the account that marked this order Checked (see
  // ValidationDecision) - stamped at the top of the order for accountability.
  checkedBy?: string;
  // The checker's account color at the time this order was checked - colors
  // the checked stamp.
  checkedByColor?: string;
  allocation?: AllocationDecision;
  // Set by the server when this login may not see prices (B-10): every
  // line's rate and the tax rate are left out, and totals show a dash.
  pricesHidden?: boolean;
  labelPrintedAt?: string;
  pickedAt?: string;
  pendingShipment?: ShipmentLine[];
  pickListPrintedAt?: string;
  packingSlipPrintedAt?: string;
  shipmentHistory?: ShipmentRecord[];
  estimatedShipDate?: string;
  pickPackStatus?: "Partial" | "Complete";
  bol?: BolDetails;
  // Set by Cancel Order (see cancelOrder in orderStore).
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  // Optimistic concurrency - see Customer.version.
  version?: number;
}

export interface ShippingLocation {
  id: string;
  label: string;
  address: Address;
}

export interface CustomerNote {
  id: string;
  text: string;
  createdAt: string;
}

// Maps one of our item numbers to this customer's own part number for it,
// so Order Entry can auto-fill the customer's part # once the item is
// selected on a line.
export interface CustomerPartMapping {
  id: string;
  itemNumber: string;
  customerPartNumber: string;
}

// A customer-specific price override for one of our items, used to
// auto-fill the rate on Order Entry instead of the catalog rate.
export interface CustomerPriceOverride {
  id: string;
  itemNumber: string;
  customerPartNumber?: string;
  description?: string;
  price: number;
  pricePerFt?: number;
  length?: number;
  weight?: number;
}

// Carrier routing / compliance requirements some customers (especially
// larger accounts) require on every shipment - kept separate from the
// day-to-day order fields since it's reference material, not per-order data.
export interface RoutingGuide {
  preferredCarrier?: string;
  routingAccountNumber?: string;
  appointmentRequired?: boolean;
  labelingRequirements?: string;
  notes?: string;
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
  // Invoices for an exempt customer (a reseller with a certificate on file)
  // carry no sales tax whatever the order's rate says.
  taxExempt?: boolean;
  // False once the customer is retired: kept for its history, hidden from
  // the pickers on new orders and returns.
  active?: boolean;
  // When set, product labels printed for this customer show this brand
  // name instead of ours - for customers who private-label our products.
  privateLabelName?: string;
  notes: CustomerNote[];
  partNumberMap?: CustomerPartMapping[];
  priceOverrides?: CustomerPriceOverride[];
  routingGuide?: RoutingGuide;
  createdAt: string;
  // Optimistic concurrency: present on anything fetched from the server,
  // required on save - a save whose version doesn't match the row's
  // current one means someone else saved a change first (see apiClient's
  // ConflictError / isConflictError).
  version?: number;
}

// A part number used to make/build this item - e.g. a raw material or
// component, not a customer or vendor part number. Free-form, since this
// app doesn't model a full bill of materials.
export interface ItemComponent {
  id: string;
  partNumber: string;
  description?: string;
}

export interface ItemLink {
  id: string;
  label: string;
  url: string;
}

export interface Item {
  id: string;
  itemNumber: string;
  description: string;
  um: string;
  rate: number;
  // Physical count on the shelf. What's currently on order from a supplier
  // to replenish it is now derived from open vendor purchase orders (see
  // vendorPoStore's recomputeQtyOnPurchaseOrder) rather than maintained by
  // hand, though it's still stored here for fast display.
  qtyOnHand: number;
  qtyOnPurchaseOrder: number;
  // Units held by open orders (allocated or staged for a pick, not yet
  // shipped), maintained by the server in the same transaction as every
  // order step. Available = qtyOnHand - qtyReserved.
  qtyReserved: number;
  preferredVendorId?: string;
  reorderPoint?: number;
  countryOfOrigin?: string;
  // Weight per unit (lbs) - drives order/shipment weight for warehouse
  // capacity tracking (see warehouseCapacity.ts). Optional since not every
  // item needs it tracked.
  weight?: number;
  components?: ItemComponent[];
  // Reference links shown on the item profile - spec sheets, SDS, vendor
  // product pages, etc.
  links?: ItemLink[];
  notes?: string;
  createdAt: string;
  // Optimistic concurrency - see Customer.version.
  version?: number;
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
    notes: [],
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
    qtyReserved: 0,
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
  return fromCents(lineAmountCents(li.ordered || 0, li.rate || 0));
}

export function allocatedQtyFor(order: Pick<PurchaseOrder, "allocation">, lineItemId: string): number {
  return order.allocation?.lines.find((l) => l.lineItemId === lineItemId)?.allocatedQty ?? 0;
}

export function pendingShipmentQtyFor(
  order: Pick<PurchaseOrder, "pendingShipment">,
  lineItemId: string
): number {
  return order.pendingShipment?.find((l) => l.lineItemId === lineItemId)?.qty ?? 0;
}

// What's still reserved against physical stock for this line: whatever's
// allocated but not yet packed, plus whatever's packed but not yet shipped.
// Packing zeroes out the line's allocatedQty as it moves that quantity into
// pendingShipment (see PickPackDetail), and shipping clears pendingShipment
// as it's subtracted straight from qtyOnHand - so the two never overlap.
export function reservedQtyFor(
  order: Pick<PurchaseOrder, "allocation" | "pendingShipment">,
  lineItemId: string
): number {
  return allocatedQtyFor(order, lineItemId) + pendingShipmentQtyFor(order, lineItemId);
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
  orders: Pick<PurchaseOrder, "lineItems" | "shipmentHistory" | "status">[]
): number {
  const q = itemNumber.trim().toLowerCase();
  return orders.reduce(
    (sum, o) =>
      o.status === "Cancelled" ? sum :
      sum +
      o.lineItems
        .filter((li) => li.item.trim().toLowerCase() === q)
        .reduce((lineSum, li) => lineSum + remainingToShip(o, li), 0),
    0
  );
}

// What's free to promise right now: on hand, less what's reserved
// (allocated or packed) against it. Pass item.qtyReserved, or
// reservedElsewhere(...) on a screen that is deciding one order's own hold.
export function availableQty(item: Pick<Item, "qtyOnHand">, qtyReserved: number): number {
  return item.qtyOnHand - qtyReserved;
}

// The statuses in which an order holds stock; in any other its allocation
// JSON is history, not a hold.
const HOLDING_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["Allocated", "Backordered", "Pick & Packed"]);

// What `order` itself holds of `itemNumber`: allocated-not-yet-released plus
// released-not-yet-shipped, the same rule the server keeps Item.qtyReserved by.
export function reservedOnOrder(
  itemNumber: string,
  order: Pick<PurchaseOrder, "status" | "lineItems" | "allocation" | "pendingShipment">
): number {
  if (!HOLDING_STATUSES.has(order.status)) return 0;
  const q = itemNumber.trim().toLowerCase();
  return order.lineItems.filter((li) => li.item.trim().toLowerCase() === q).reduce((sum, li) => sum + reservedQtyFor(order, li.id), 0);
}

// What every *other* order holds of `item`: the server's total less this
// order's own hold, so a screen revising this order's allocation nets
// Available against everyone else without counting itself.
export function reservedElsewhere(
  item: Pick<Item, "itemNumber" | "qtyReserved">,
  order: Pick<PurchaseOrder, "status" | "lineItems" | "allocation" | "pendingShipment">
): number {
  return item.qtyReserved - reservedOnOrder(item.itemNumber, order);
}

// Whether an order's allocation/pack can be released back to Checked without
// leaving a physical document (pick list / packing slip) pointing at stock
// that's no longer reserved. Allocated-but-not-yet-packed orders are always
// eligible; a packed order only qualifies while neither document has printed.
export function canUnallocate(
  order: Pick<PurchaseOrder, "status" | "pickListPrintedAt" | "packingSlipPrintedAt">
): boolean {
  if (order.status === "Allocated") return true;
  if (order.status === "Pick & Packed") {
    return !order.pickListPrintedAt && !order.packingSlipPrintedAt;
  }
  return false;
}

// Releases an order's allocation and/or pack entirely, freeing whatever it
// had reserved and sending it back to Checked for a fresh allocation
// decision. Doesn't touch inventory - nothing was ever decremented from
// qtyOnHand at allocation/pack time, only reserved (Item.qtyReserved).
export function unallocateOrder(order: PurchaseOrder): PurchaseOrder {
  return {
    ...order,
    status: "Checked",
    allocation: undefined,
    pendingShipment: [],
    pickedAt: undefined,
    pickPackStatus: undefined,
    pickListPrintedAt: undefined,
    packingSlipPrintedAt: undefined,
  };
}

// Per-unit weight lookup by item # (case/whitespace-insensitive), built once
// from the catalog and passed into the weight helpers below instead of an
// items array, so they don't do an O(n) find per line.
export function weightIndex(items: Pick<Item, "itemNumber" | "weight">[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.itemNumber.trim().toLowerCase(), i.weight ?? 0);
  return map;
}

function weightFor(itemNumber: string, weights: Map<string, number>): number {
  return weights.get(itemNumber.trim().toLowerCase()) ?? 0;
}

// Total weight of everything ordered on this order (every line's full
// ordered qty), regardless of shipping progress.
export function orderWeight(order: Pick<PurchaseOrder, "lineItems">, weights: Map<string, number>): number {
  return order.lineItems.reduce((sum, li) => sum + li.ordered * weightFor(li.item, weights), 0);
}

// Weight of whatever's currently staged in pendingShipment - i.e. physically
// picked/packed and sitting in the warehouse waiting to ship.
export function pendingShipmentWeight(
  order: Pick<PurchaseOrder, "lineItems" | "pendingShipment">,
  weights: Map<string, number>
): number {
  return (order.pendingShipment ?? []).reduce((sum, l) => {
    const li = order.lineItems.find((x) => x.id === l.lineItemId);
    return sum + (li ? l.qty * weightFor(li.item, weights) : 0);
  }, 0);
}

// Weight actually shipped in one shipment record.
export function shipmentRecordWeight(
  order: Pick<PurchaseOrder, "lineItems">,
  record: Pick<ShipmentRecord, "lines">,
  weights: Map<string, number>
): number {
  return record.lines.reduce((sum, l) => {
    const li = order.lineItems.find((x) => x.id === l.lineItemId);
    return sum + (li ? l.qty * weightFor(li.item, weights) : 0);
  }, 0);
}

// Totals in integer cents, the same arithmetic the server uses for the
// invoice, so the order page never shows a total one cent off its invoice.
export function orderSubtotalCents(order: Pick<PurchaseOrder, "lineItems">): number {
  return order.lineItems.reduce((sum, li) => sum + lineAmountCents(li.ordered || 0, li.rate || 0), 0);
}

export function orderSubtotal(order: Pick<PurchaseOrder, "lineItems">): number {
  return fromCents(orderSubtotalCents(order));
}

export function orderTax(order: Pick<PurchaseOrder, "lineItems" | "taxRate">): number {
  return fromCents(taxCents(orderSubtotalCents(order), order.taxRate || 0));
}

export function orderTotal(order: Pick<PurchaseOrder, "lineItems" | "taxRate">): number {
  const subtotal = orderSubtotalCents(order);
  return fromCents(subtotal + taxCents(subtotal, order.taxRate || 0));
}

// The order total as a list shows it, or a dash for a login that may not
// see prices.
export function orderTotalLabel(order: Pick<PurchaseOrder, "lineItems" | "taxRate" | "pricesHidden">): string {
  return order.pricesHidden ? "—" : `$${orderTotal(order).toFixed(2)}`;
}

// Shared search-box matcher: S.O. #, P.O. #, or customer name, case-insensitive.
export function matchesOrderQuery(
  order: Pick<PurchaseOrder, "soNumber" | "poNumber" | "billTo">,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    order.soNumber.toLowerCase().includes(q) ||
    order.poNumber.toLowerCase().includes(q) ||
    order.billTo.name.toLowerCase().includes(q)
  );
}

// --- Vendors & outbound purchase orders (what we buy from suppliers - not
// to be confused with PurchaseOrder above, which despite its name is the
// SALES order we create from a customer's PO) ---

export interface Vendor {
  id: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: Address;
  createdAt: string;
  // Optimistic concurrency - see Customer.version.
  version?: number;
}

export function emptyVendor(): Vendor {
  return {
    id: crypto.randomUUID(),
    name: "",
    contactName: "",
    phone: "",
    email: "",
    address: emptyAddress(),
    createdAt: new Date().toISOString(),
  };
}

export type VendorPoStatus = "Open" | "Partially Received" | "Received" | "Closed";

export interface VendorPoLine {
  id: string;
  itemNumber: string;
  description: string;
  orderedQty: number;
  receivedQty: number;
  cost: number;
}

export function emptyVendorPoLine(): VendorPoLine {
  return { id: crypto.randomUUID(), itemNumber: "", description: "", orderedQty: 1, receivedQty: 0, cost: 0 };
}

export interface VendorReceivingLine {
  lineId: string;
  qty: number;
}

export interface VendorReceivingRecord {
  id: string;
  receivedAt: string;
  lines: VendorReceivingLine[];
}

export interface VendorPurchaseOrder {
  poNumber: string;
  vendorId: string;
  vendorName: string;
  orderDate: string;
  expectedDate?: string;
  lines: VendorPoLine[];
  status: VendorPoStatus;
  notes: string;
  receivingHistory?: VendorReceivingRecord[];
  createdAt: string;
  // Optimistic concurrency - see Customer.version.
  version?: number;
}

export function vendorPoLineOutstanding(line: Pick<VendorPoLine, "orderedQty" | "receivedQty">): number {
  return Math.max(0, line.orderedQty - line.receivedQty);
}

export function vendorPoOutstandingTotal(po: Pick<VendorPurchaseOrder, "lines">): number {
  return po.lines.reduce((sum, l) => sum + vendorPoLineOutstanding(l), 0);
}

export function vendorPoCostTotal(po: Pick<VendorPurchaseOrder, "lines">): number {
  return po.lines.reduce((sum, l) => sum + l.orderedQty * l.cost, 0);
}

// Shared search-box matcher for vendor POs: PO #, vendor name.
export function matchesVendorPoQuery(po: Pick<VendorPurchaseOrder, "poNumber" | "vendorName">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return po.poNumber.toLowerCase().includes(q) || po.vendorName.toLowerCase().includes(q);
}

// --- Returns / Return Authorization (RA) -----------------------------------
// Foundation for the return process: a customer-facing Return Authorization
// document, generated the same way a BOL or PO is. Kept deliberately simple
// (a single status) - richer workflow (received/credited stages) can build
// on this once the basics are in use.

export type ReturnStatus = "Issued" | "Received" | "Closed";

export interface ReturnLine {
  id: string;
  itemNumber: string;
  description: string;
  um: string;
  qty: number;
  rate: number;
  reason: string;
  // Whether units go back on the shelf when the return is received
  // (false = damaged / scrap).
  restock?: boolean;
}

export function emptyReturnLine(): ReturnLine {
  return { id: crypto.randomUUID(), itemNumber: "", description: "", um: "EA", qty: 1, rate: 0, reason: "", restock: true };
}

export interface ReturnAuthorization {
  raNumber: string;
  customerId?: string;
  // The original sales order this return relates to, if any - not required,
  // since a customer can return goods without one on hand.
  soNumber?: string;
  billTo: Address;
  requestDate: string;
  reason: string;
  lines: ReturnLine[];
  status: ReturnStatus;
  notes: string;
  // Initials + account id of whoever wrote this RA - same signature/edit
  // pattern as a sales order's writtenBy.
  writtenBy?: string;
  writtenById?: string;
  writtenByColor?: string;
  // Set when the goods were received back (see receiveReturn).
  receivedAt?: string | null;
  receivedBy?: string | null;
  createdAt: string;
  // Optimistic concurrency - see Customer.version.
  version?: number;
}

export function emptyReturn(raNumber: string): ReturnAuthorization {
  return {
    raNumber,
    billTo: emptyAddress(),
    requestDate: localIsoDate(),
    reason: "",
    lines: [emptyReturnLine()],
    status: "Issued",
    notes: "",
    createdAt: new Date().toISOString(),
  };
}

export function returnTotal(ra: Pick<ReturnAuthorization, "lines">): number {
  return ra.lines.reduce((sum, l) => sum + l.qty * l.rate, 0);
}

// Shared search-box matcher for returns: RA #, original S.O. #, customer name.
export function matchesReturnQuery(ra: Pick<ReturnAuthorization, "raNumber" | "soNumber" | "billTo">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    ra.raNumber.toLowerCase().includes(q) ||
    (ra.soNumber ?? "").toLowerCase().includes(q) ||
    ra.billTo.name.toLowerCase().includes(q)
  );
}

// --- Invoices and credit memos --------------------------------------------
// Raised by the server: an invoice per shipment (inside the ship
// transaction) and a credit memo per received return. This system owns the
// documents; QuickBooks owns the money (receivables, payments, the ledger) -
// `sync` says how far along the push to QuickBooks is.

// A document is a Draft until Accounting reviews and issues it; only an
// issued document has a number and goes to QuickBooks.
export type DocStatus = "DRAFT" | "ISSUED" | "VOID";
export type DocLineKind = "ITEM" | "CHARGE";
// Charge lines a reviewer may add. DEDUCTION is for credit memos (negative).
export const CHARGE_CODES = ["FREIGHT", "HANDLING", "OTHER", "DEDUCTION"] as const;
export type ChargeCode = (typeof CHARGE_CODES)[number];

export interface SyncInfo {
  // NOT_QUEUED | PENDING | PROCESSING | FAILED | DEAD | SYNCED
  status: string;
  externalId: string | null;
  lastError: string | null;
}

export interface InvoiceLine {
  id: string;
  kind: DocLineKind;
  taxable: boolean;
  position?: number;
  salesOrderLineId?: string | null;
  itemId?: string | null;
  item: string;
  description: string;
  um: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface Invoice {
  id: string;
  // Null while a draft.
  invoiceNumber: string | null;
  soNumber: number;
  shipmentRecordId?: string | null;
  customerId?: string | null;
  customerName: string;
  billTo: Address;
  shipTo: Address;
  poNumber: string;
  terms: string;
  rep: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  status: DocStatus;
  approvedAt?: string | null;
  approvedBy?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  notes: string;
  version: number;
  createdAt: string;
  lines: InvoiceLine[];
  sync?: SyncInfo | null;
}

export interface CreditMemoLine {
  id: string;
  kind: DocLineKind;
  taxable: boolean;
  position?: number;
  returnLineId?: string | null;
  invoiceNumber?: string | null;
  itemId?: string | null;
  item: string;
  description: string;
  um: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface CreditMemo {
  id: string;
  creditMemoNumber: string | null;
  raNumber: string;
  customerId?: string | null;
  customerName: string;
  billTo: Address;
  soNumber?: string | null;
  memoDate: string;
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  status: DocStatus;
  approvedAt?: string | null;
  approvedBy?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  reason: string;
  version: number;
  createdAt: string;
  lines: CreditMemoLine[];
  sync?: SyncInfo | null;
}
