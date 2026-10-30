import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

// Statuses in which an inbound shipment is still expected: its ETA counts
// as a projected arrival and it can still be marked received.
export const OPEN_INBOUND_STATUSES = ["BOOKED", "IN_TRANSIT", "AT_PORT", "ARRIVED"] as const;

// After a receipt: every open inbound shipment carrying one of `poLineIds`
// whose lines are now all fully received (on the PO) is marked RECEIVED.
// Receiving stays on the PO; this only keeps the shipment list honest.
// Returns the ids of the shipments it closed.
export async function closeReceivedInbound(tx: Tx, poLineIds: string[]): Promise<string[]> {
  if (poLineIds.length === 0) return [];
  const shipments = await tx.inboundShipment.findMany({
    where: { status: { in: [...OPEN_INBOUND_STATUSES] }, lines: { some: { vendorPoLineId: { in: poLineIds } } } },
    select: { id: true, arrivedAt: true, lines: { select: { vendorPoLine: { select: { orderedQty: true, receivedQty: true } } } } },
  });
  const done = shipments.filter((s) => s.lines.length > 0 && s.lines.every((l) => l.vendorPoLine.receivedQty >= l.vendorPoLine.orderedQty));
  const now = new Date();
  for (const s of done) {
    await tx.inboundShipment.update({ where: { id: s.id }, data: { status: "RECEIVED", arrivedAt: s.arrivedAt ?? now, version: { increment: 1 } } });
  }
  return done.map((s) => s.id);
}
