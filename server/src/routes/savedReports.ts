import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../lib/conflictError.js";
import { legacyToSpec } from "../lib/reports/legacy.js";
import { reportSpecSchema } from "../lib/reports/spec.js";
import { requireAuth, requirePermission, type AuthedAccount, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

// Memorized reports: a spec under a name, owned by whoever memorized it,
// shared with everyone or private, optionally in a group.
//   GET    /api/saved-reports            own + shared
//   POST   /api/saved-reports            { name, spec, shared?, groupName? }
//   PUT    /api/saved-reports/:id        owner or admin
//   DELETE /api/saved-reports/:id        owner or admin
//   GET    /api/saved-reports/groups     group names the account can see
const router = Router();

router.use(requireAuth);

// Rows memorized on the previous Reports page saved a data source key,
// filters and columns; they get a spec here, once, from the legacy
// translation. Runs at start-up and again before any list, so a row added
// by an older server mid-deploy still opens.
export async function backfillLegacySpecs(): Promise<number> {
  const rows = await prisma.savedReport.findMany({ where: { spec: { equals: Prisma.DbNull } } });
  let n = 0;
  for (const r of rows) {
    if (!r.dataSourceKey) continue;
    const spec = legacyToSpec({ dataSourceKey: r.dataSourceKey, filters: (r.filters as Record<string, string>) ?? {}, columns: (r.columns as string[]) ?? [] });
    await prisma.savedReport.update({ where: { id: r.id }, data: { spec } });
    n++;
  }
  return n;
}

const canManage = (account: AuthedAccount, row: { ownerId: string | null }) => account.role === "ADMIN" || row.ownerId === account.id || row.ownerId === null;

async function listFor(account: AuthedAccount) {
  await backfillLegacySpecs();
  const rows = await prisma.savedReport.findMany({ where: { OR: [{ shared: true }, { ownerId: account.id }] }, orderBy: [{ groupName: "asc" }, { name: "asc" }] });
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length ? await prisma.account.findMany({ where: { id: { in: ownerIds } }, select: { id: true, username: true } }) : [];
  const byId = new Map(owners.map((o) => [o.id, o.username]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    spec: r.spec,
    shared: r.shared,
    groupName: r.groupName,
    ownerId: r.ownerId,
    ownerName: r.ownerId ? (byId.get(r.ownerId) ?? null) : null,
    mine: r.ownerId === account.id,
    canEdit: canManage(account, r),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

router.get("/", requirePermission("reports", "view"), async (req: AuthedRequest, res) => {
  res.json(await listFor(req.account!));
});

router.get("/groups", requirePermission("reports", "view"), async (req: AuthedRequest, res) => {
  const rows = await prisma.savedReport.findMany({ where: { groupName: { not: null }, OR: [{ shared: true }, { ownerId: req.account!.id }] }, select: { groupName: true }, distinct: ["groupName"], orderBy: { groupName: "asc" } });
  res.json(rows.map((r) => r.groupName).filter((g): g is string => Boolean(g)));
});

const name = z.string().trim().min(1, "Give the report a name").max(120);
const groupName = z.string().trim().max(80).transform((g) => g || null);
const createSchema = z.object({ name, spec: reportSpecSchema, shared: z.boolean().default(true), groupName: groupName.nullish() });
const updateSchema = z.object({ name: name.optional(), spec: reportSpecSchema.optional(), shared: z.boolean().optional(), groupName: groupName.nullish() });

router.post("/", requirePermission("reports", "edit"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const { name: n, spec, shared, groupName: g } = parsed.data;
  const row = await prisma.savedReport.create({ data: { name: n, spec, shared, groupName: g ?? null, ownerId: req.account!.id } });
  res.status(201).json((await listFor(req.account!)).find((r) => r.id === row.id));
});

router.put("/:id", requirePermission("reports", "edit"), async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const row = await prisma.savedReport.findUnique({ where: { id: req.params.id } });
  if (!row) throw new HttpError(404, "Memorized report not found");
  if (!canManage(req.account!, row)) throw new HttpError(403, "Only the person who memorized this report, or an admin, can change it.");
  const { name: n, spec, shared, groupName: g } = parsed.data;
  await prisma.savedReport.update({
    where: { id: row.id },
    data: {
      ...(n !== undefined ? { name: n } : {}),
      ...(spec !== undefined ? { spec } : {}),
      ...(shared !== undefined ? { shared } : {}),
      ...(g !== undefined ? { groupName: g } : {}),
    },
  });
  res.json((await listFor(req.account!)).find((r) => r.id === row.id));
});

router.delete("/:id", requirePermission("reports", "edit"), async (req: AuthedRequest, res) => {
  const row = await prisma.savedReport.findUnique({ where: { id: req.params.id } });
  if (!row) {
    res.status(204).end();
    return;
  }
  if (!canManage(req.account!, row)) throw new HttpError(403, "Only the person who memorized this report, or an admin, can delete it.");
  await prisma.savedReport.delete({ where: { id: row.id } });
  res.status(204).end();
});

export default router;
