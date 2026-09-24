import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ConflictError } from "../lib/conflictError.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

const router = Router();

// App-facing status strings <-> the Prisma enum, same translation approach
// as vendorPurchaseOrders.ts.
const STATUS_IN = { Issued: "ISSUED", Received: "RECEIVED", Closed: "CLOSED" } as const;
const STATUS_OUT: Record<string, string> = { ISSUED: "Issued", RECEIVED: "Received", CLOSED: "Closed" };

const RETURN_COUNTER_KEY = "return";
const RETURN_START = 3001;

const addressSchema = z.object({
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  notes: z.string().optional(),
});

const lineSchema = z.object({
  id: z.string().optional(),
  itemNumber: z.string(),
  description: z.string(),
  um: z.string().default("EA"),
  qty: z.number().int(),
  rate: z.number(),
  reason: z.string().default(""),
});

const createSchema = z.object({
  customerId: z.string().nullish(),
  soNumber: z.string().nullish(),
  billTo: addressSchema,
  requestDate: z.string(),
  reason: z.string().default(""),
  notes: z.string().default(""),
  writtenBy: z.string().nullish(),
  writtenById: z.string().nullish(),
  writtenByColor: z.string().nullish(),
  lines: z.array(lineSchema).default([]),
});

const updateSchema = createSchema.extend({
  status: z.enum(["Issued", "Received", "Closed"]),
  version: z.number().int(),
});

const include = { lines: true };

function mapOut<T extends { status: string }>(ra: T) {
  return { ...ra, status: STATUS_OUT[ra.status] ?? ra.status };
}

router.use(requireAuth);

router.get("/", requirePermission("returns", "view"), async (_req, res) => {
  const returns = await prisma.returnAuthorization.findMany({ orderBy: { createdAt: "desc" }, include });
  res.json(returns.map(mapOut));
});

router.get("/:raNumber", requirePermission("returns", "view"), async (req, res) => {
  const ra = await prisma.returnAuthorization.findUnique({ where: { raNumber: req.params.raNumber }, include });
  if (!ra) {
    res.status(404).json({ error: "Return not found" });
    return;
  }
  res.json(mapOut(ra));
});

// Assigns the RA number itself (atomically, via the shared Counter table)
// rather than trusting one the client precomputed - same reasoning as
// vendor PO numbers (see vendorPurchaseOrders.ts).
router.post("/", requirePermission("returns", "edit"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const ra = await prisma.$transaction(async (tx) => {
    const counter = await tx.counter.upsert({
      where: { key: RETURN_COUNTER_KEY },
      create: { key: RETURN_COUNTER_KEY, value: RETURN_START },
      update: { value: { increment: 1 } },
    });
    return tx.returnAuthorization.create({
      data: {
        raNumber: `RA-${counter.value}`,
        customerId: data.customerId,
        soNumber: data.soNumber,
        billTo: data.billTo,
        requestDate: new Date(data.requestDate),
        reason: data.reason,
        status: "ISSUED",
        notes: data.notes,
        writtenBy: data.writtenBy,
        writtenById: data.writtenById,
        writtenByColor: data.writtenByColor,
        lines: {
          create: data.lines.map((l) => ({
            itemNumber: l.itemNumber,
            description: l.description,
            um: l.um,
            qty: l.qty,
            rate: l.rate,
            reason: l.reason,
          })),
        },
      },
      include,
    });
  });
  res.status(201).json(mapOut(ra));
});

router.put("/:raNumber", requirePermission("returns", "edit"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const raNumber = req.params.raNumber;

  const existing = await prisma.returnAuthorization.findUnique({ where: { raNumber } });
  if (!existing) {
    res.status(404).json({ error: "Return not found" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.returnAuthorization.updateMany({
        where: { raNumber, version: data.version },
        data: {
          customerId: data.customerId,
          soNumber: data.soNumber,
          billTo: data.billTo,
          requestDate: new Date(data.requestDate),
          reason: data.reason,
          status: STATUS_IN[data.status],
          notes: data.notes,
          writtenBy: data.writtenBy,
          writtenById: data.writtenById,
          writtenByColor: data.writtenByColor,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConflictError();
      await syncChildren(tx.returnLine, raNumber, "raNumber", data.lines, (l) => ({
        itemNumber: l.itemNumber,
        description: l.description,
        um: l.um,
        qty: l.qty,
        rate: l.rate,
        reason: l.reason,
      }));
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }

  const updated = await prisma.returnAuthorization.findUnique({ where: { raNumber }, include });
  res.json(mapOut(updated!));
});

export default router;
