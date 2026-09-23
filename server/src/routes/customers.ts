import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
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
  price: z.number(),
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
  privateLabelName: z.string().optional(),
  routingGuide: routingGuideSchema,
  shipToLocations: z.array(shipToLocationSchema).default([]),
  notes: z.array(noteSchema).default([]),
  partNumberMap: z.array(partMappingSchema).default([]),
  priceOverrides: z.array(priceOverrideSchema).default([]),
});

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
      routingGuide: data.routingGuide ?? undefined,
      shipToLocations: { create: data.shipToLocations.map((l) => ({ label: l.label, address: l.address })) },
      notes: { create: data.notes.map((n) => ({ text: n.text })) },
      partNumberMap: {
        create: data.partNumberMap.map((m) => ({
          itemNumber: m.itemNumber,
          customerPartNumber: m.customerPartNumber,
        })),
      },
      priceOverrides: {
        create: data.priceOverrides.map((p) => ({ itemNumber: p.itemNumber, price: p.price })),
      },
    },
    include,
  });
  res.status(201).json(customer);
});

router.put("/:id", requirePermission("customers", "edit"), async (req, res) => {
  const parsed = customerSchema.safeParse(req.body);
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

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id },
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
        routingGuide: data.routingGuide ?? undefined,
      },
    });

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
      price: p.price,
    }));
  });

  const updated = await prisma.customer.findUnique({ where: { id }, include });
  res.json(updated);
});

router.delete("/:id", requirePermission("customers", "edit"), async (req, res) => {
  await prisma.customer.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
});

export default router;
