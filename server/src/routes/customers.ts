import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ConflictError } from "../lib/conflictError.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

const router = Router();

const addressSchema = z.object({
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  notes: z.string().optional(),
});

const shipToLocationSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  address: addressSchema,
});

const noteSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
});

const partMappingSchema = z.object({
  id: z.string().optional(),
  itemNumber: z.string(),
  customerPartNumber: z.string(),
});

const priceOverrideSchema = z.object({
  id: z.string().optional(),
  itemNumber: z.string(),
  customerPartNumber: z.string().default(""),
  description: z.string().default(""),
  price: z.number(),
  pricePerFt: z.number().nullish(),
  length: z.number().nullish(),
  weight: z.number().nullish(),
});

const routingGuideSchema = z
  .object({
    preferredCarrier: z.string().optional(),
    routingAccountNumber: z.string().optional(),
    appointmentRequired: z.boolean().optional(),
    labelingRequirements: z.string().optional(),
    notes: z.string().optional(),
  })
  .nullable()
  .optional();

const customerSchema = z.object({
  name: z.string().min(1),
  accountNumber: z.string().default(""),
  billTo: addressSchema,
  terms: z.string().default(""),
  shipVia: z.string().default(""),
  fob: z.string().default(""),
  rep: z.string().default(""),
  shipCompleteOnly: z.boolean().default(false),
  // .nullish() not .optional(): Prisma hands back `null` for an unset
  // nullable column, and this same object round-trips through PUT on every
  // save - .optional() alone rejects that `null` with a 400.
  privateLabelName: z.string().nullish(),
  routingGuide: routingGuideSchema,
  shipToLocations: z.array(shipToLocationSchema).default([]),
  notes: z.array(noteSchema).default([]),
  partNumberMap: z.array(partMappingSchema).default([]),
  priceOverrides: z.array(priceOverrideSchema).default([]),
});

// Required on PUT (every fetched record has one), absent on POST.
const updateSchema = customerSchema.extend({ version: z.number().int() });

const include = {
  shipToLocations: true,
  notes: { orderBy: { createdAt: "desc" as const } },
  partNumberMap: true,
  priceOverrides: true,
};

router.use(requireAuth);

router.get("/", requirePermission("customers", "view"), async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const customers = await prisma.customer.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { accountNumber: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
    include,
  });
  res.json(customers);
});

router.get("/:id", requirePermission("customers", "view"), async (req, res) => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id }, include });
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
});

router.post("/", requirePermission("customers", "edit"), async (req, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const customer = await prisma.customer.create({
    data: {
      name: data.name,
      accountNumber: data.accountNumber,
      billTo: data.billTo,
      terms: data.terms,
      shipVia: data.shipVia,
      fob: data.fob,
      rep: data.rep,
      shipCompleteOnly: data.shipCompleteOnly,
      privateLabelName: data.privateLabelName,
      routingGuide: data.routingGuide === undefined ? undefined : (data.routingGuide ?? Prisma.JsonNull),
      shipToLocations: { create: data.shipToLocations.map((l) => ({ label: l.label, address: l.address })) },
      notes: { create: data.notes.map((n) => ({ text: n.text })) },
      partNumberMap: {
        create: data.partNumberMap.map((m) => ({
          itemNumber: m.itemNumber,
          customerPartNumber: m.customerPartNumber,
        })),
      },
      priceOverrides: {
        create: data.priceOverrides.map((p) => ({
          itemNumber: p.itemNumber,
          customerPartNumber: p.customerPartNumber,
          description: p.description,
          price: p.price,
          pricePerFt: p.pricePerFt ?? null,
          length: p.length ?? null,
          weight: p.weight ?? null,
        })),
      },
    },
    include,
  });
  res.status(201).json(customer);
});

router.put("/:id", requirePermission("customers", "edit"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const id = req.params.id;

  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.customer.updateMany({
        where: { id, version: data.version },
        data: {
          name: data.name,
          accountNumber: data.accountNumber,
          billTo: data.billTo,
          terms: data.terms,
          shipVia: data.shipVia,
          fob: data.fob,
          rep: data.rep,
          shipCompleteOnly: data.shipCompleteOnly,
          privateLabelName: data.privateLabelName,
          routingGuide: data.routingGuide === undefined ? undefined : (data.routingGuide ?? Prisma.JsonNull),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConflictError();

      await syncChildren(tx.shippingLocation, id, "customerId", data.shipToLocations, (l) => ({
        label: l.label,
        address: l.address,
      }));
      await syncChildren(tx.customerNote, id, "customerId", data.notes, (n) => ({ text: n.text }));
      await syncChildren(tx.customerPartMapping, id, "customerId", data.partNumberMap, (m) => ({
        itemNumber: m.itemNumber,
        customerPartNumber: m.customerPartNumber,
      }));
      await syncChildren(tx.customerPriceOverride, id, "customerId", data.priceOverrides, (p) => ({
        itemNumber: p.itemNumber,
        customerPartNumber: p.customerPartNumber,
        description: p.description,
        price: p.price,
        pricePerFt: p.pricePerFt ?? null,
        length: p.length ?? null,
        weight: p.weight ?? null,
      }));
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }

  const updated = await prisma.customer.findUnique({ where: { id }, include });
  res.json(updated);
});

router.delete("/:id", requirePermission("customers", "edit"), async (req, res) => {
  await prisma.customer.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
});

export default router;
