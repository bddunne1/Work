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

export interface BolDetails {
  weight: string;
  dimensions: string;
  skidCount: string;
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
  labelPrintedAt?: string;
  pickedAt?: string;
  pendingShipment?: ShipmentLine[];
  pickListPrintedAt?: string;
  packingSlipPrintedAt?: string;
  shipmentHistory?: ShipmentRecord[];
  estimatedShipDate?: string;
  pickPackStatus?: "Partial" | "Complete";
  bol?: BolDetails;
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
  price: number;
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
// actually reserved (allocated or packed) against it - see qtyAllocatedOnOrders.
export function availableQty(item: Pick<Item, "qtyOnHand">, qtyReserved: number): number {
  return item.qtyOnHand - qtyReserved;
}

// Total quantity of `itemNumber` currently reserved against physical stock
// across every order in `orders` - allocated-not-yet-packed plus
// packed-not-yet-shipped. Unlike qtyOnOpenSalesOrders (every unit still owed,
// including orders that haven't been allocated yet), this only counts units
// actually committed to inventory, which is what "Available" should net
// against.
export function qtyAllocatedOnOrders(
  itemNumber: string,
  orders: Pick<PurchaseOrder, "lineItems" | "allocation" | "pendingShipment">[]
): number {
  const q = itemNumber.trim().toLowerCase();
  return orders.reduce(
    (sum, o) =>
      sum +
      o.lineItems
        .filter((li) => li.item.trim().toLowerCase() === q)
        .reduce((lineSum, li) => lineSum + reservedQtyFor(o, li.id), 0),
    0
  );
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

// Reverses the single most recent shipment record: restores those lines to
// pendingShipment so the order lands back in Open Picks to be re-confirmed,
// and puts it back to Pick & Packed. A no-op (returns `order` unchanged) if
// there's no shipment to undo. Does not touch inventory - the caller is
// responsible for adding the undone quantities back to qtyOnHand.
export function undoLastShipment(order: PurchaseOrder): PurchaseOrder {
  const history = order.shipmentHistory ?? [];
  if (history.length === 0) return order;
  const last = history[history.length - 1];
  return {
    ...order,
    status: "Pick & Packed",
    shipmentHistory: history.slice(0, -1),
    pendingShipment: last.lines,
  };
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
// qtyOnHand at allocation/pack time, only reserved via qtyAllocatedOnOrders.
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

export function orderSubtotal(order: Pick<PurchaseOrder, "lineItems">): number {
  return order.lineItems.reduce((sum, li) => sum + lineAmount(li), 0);
}

export function orderTax(order: Pick<PurchaseOrder, "lineItems" | "taxRate">): number {
  return orderSubtotal(order) * ((order.taxRate || 0) / 100);
}

export function orderTotal(order: Pick<PurchaseOrder, "lineItems" | "taxRate">): number {
  return orderSubtotal(order) + orderTax(order);
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

// Applies a receipt of `lines` (lineId -> qty received this session) to a
// vendor PO: bumps each line's receivedQty and rolls the PO status up to
// Received once every line is fully received, Partially Received if some
// but not all progress was made, or leaves it Open/unchanged otherwise.
export function receiveVendorPo(po: VendorPurchaseOrder, lines: VendorReceivingLine[]): VendorPurchaseOrder {
  const receivedLines = lines.filter((l) => l.qty > 0);
  if (receivedLines.length === 0) return po;
  const updatedLines = po.lines.map((line) => {
    const receipt = receivedLines.find((l) => l.lineId === line.id);
    return receipt ? { ...line, receivedQty: line.receivedQty + receipt.qty } : line;
  });
  const fullyReceived = updatedLines.every((l) => l.receivedQty >= l.orderedQty);
  const anyReceived = updatedLines.some((l) => l.receivedQty > 0);
  const receivingHistory: VendorReceivingRecord[] = [
    ...(po.receivingHistory ?? []),
    { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), lines: receivedLines },
  ];
  return {
    ...po,
    lines: updatedLines,
    status: fullyReceived ? "Received" : anyReceived ? "Partially Received" : po.status,
    receivingHistory,
  };
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
}

export function emptyReturnLine(): ReturnLine {
  return { id: crypto.randomUUID(), itemNumber: "", description: "", um: "EA", qty: 1, rate: 0, reason: "" };
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
  createdAt: string;
  // Optimistic concurrency - see Customer.version.
  version?: number;
}

export function emptyReturn(raNumber: string): ReturnAuthorization {
  return {
    raNumber,
    billTo: emptyAddress(),
    requestDate: new Date().toISOString().slice(0, 10),
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
