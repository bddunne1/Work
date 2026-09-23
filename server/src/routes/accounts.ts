import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { logAudit } from "../lib/audit.js";
import { requireAdmin, requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

function deriveInitials(username: string): string {
  const parts = username.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (username.trim().slice(0, 2) || "??").toUpperCase();
}

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #4c6ef5");

const createSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  role: z.enum(["ADMIN", "CUSTOM"]),
  permissions: z.record(z.enum(["view", "edit"])).optional(),
  initials: z.string().optional(),
  color: hexColor.optional(),
});

const updateSchema = z.object({
  role: z.enum(["ADMIN", "CUSTOM"]).optional(),
  permissions: z.record(z.enum(["view", "edit"])).optional(),
  initials: z.string().optional(),
  color: hexColor.optional(),
  password: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

const publicFields = {
  id: true,
  username: true,
  role: true,
  permissions: true,
  initials: true,
  color: true,
  active: true,
  createdAt: true,
};

router.use(requireAuth, requireAdmin);

// True if demoting/deactivating/deleting `target` would leave zero active
// admins - the one action this API always refuses, since it would lock
// everyone out of Accounts with no way back in.
async function wouldRemoveLastActiveAdmin(
  target: { role: "ADMIN" | "CUSTOM"; active: boolean },
  excludeId: string
): Promise<boolean> {
  if (target.role !== "ADMIN" || !target.active) return false;
  const otherActiveAdmins = await prisma.account.count({
    where: { role: "ADMIN", active: true, id: { not: excludeId } },
  });
  return otherActiveAdmins === 0;
}

router.get("/", async (_req, res) => {
  const accounts = await prisma.account.findMany({ orderBy: { createdAt: "asc" }, select: publicFields });
  res.json(accounts);
});

router.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const existing = await prisma.account.findFirst({
    where: { username: { equals: data.username, mode: "insensitive" } },
  });
  if (existing) {
    res.status(409).json({ error: "That username is already taken" });
    return;
  }
  const passwordHash = await bcrypt.hash(data.password, 10);
  const account = await prisma.account.create({
    data: {
      username: data.username,
      passwordHash,
      role: data.role,
      permissions: data.role === "CUSTOM" ? (data.permissions ?? {}) : undefined,
      initials: (data.initials?.trim() || deriveInitials(data.username)).toUpperCase(),
      color: data.color,
    },
    select: publicFields,
  });
  logAudit(req.account!, "ACCOUNT_CREATED", "account", account.id, account.username, { role: account.role });
  res.status(201).json(account);
});

router.put("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const target = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!target) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const demoting = data.role === "CUSTOM" && target.role === "ADMIN";
  const deactivating = data.active === false && target.active;
  if (demoting || deactivating) {
    if (await wouldRemoveLastActiveAdmin(target, target.id)) {
      res.status(400).json({
        error: demoting ? "Can't demote the last active admin account" : "Can't deactivate the last active admin account",
      });
      return;
    }
  }

  const account = await prisma.account
    .update({
      where: { id: req.params.id },
      data: {
        role: data.role,
        permissions:
          data.role === "CUSTOM"
            ? (data.permissions ?? {})
            : data.role === "ADMIN"
              ? Prisma.JsonNull
              : undefined,
        initials: data.initials ? data.initials.toUpperCase() : undefined,
        color: data.color,
        active: data.active,
        passwordHash: data.password ? await bcrypt.hash(data.password, 10) : undefined,
      },
      select: publicFields,
    })
    .catch(() => null);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  if (data.password) {
    logAudit(req.account!, "PASSWORD_RESET", "account", account.id, account.username);
  }
  if (data.active !== undefined && data.active !== target.active) {
    logAudit(req.account!, data.active ? "ACCOUNT_REACTIVATED" : "ACCOUNT_DEACTIVATED", "account", account.id, account.username);
  }
  const otherChanges: Record<string, unknown> = {};
  if (data.role && data.role !== target.role) otherChanges.role = { from: target.role, to: data.role };
  if (data.initials && data.initials.toUpperCase() !== target.initials) otherChanges.initials = { from: target.initials, to: data.initials.toUpperCase() };
  if (data.color && data.color !== target.color) otherChanges.color = { from: target.color, to: data.color };
  if (data.permissions && JSON.stringify(data.permissions) !== JSON.stringify(target.permissions ?? {})) {
    otherChanges.permissions = data.permissions;
  }
  if (Object.keys(otherChanges).length > 0) {
    logAudit(req.account!, "ACCOUNT_UPDATED", "account", account.id, account.username, otherChanges);
  }

  res.json(account);
});

router.post("/:id/force-logout", async (req: AuthedRequest, res) => {
  const account = await prisma.account
    .update({
      where: { id: req.params.id },
      data: { tokenVersion: { increment: 1 } },
      select: publicFields,
    })
    .catch(() => null);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  logAudit(req.account!, "FORCE_LOGOUT", "account", account.id, account.username);
  res.json(account);
});

router.delete("/:id", async (req: AuthedRequest, res) => {
  const target = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!target) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (await wouldRemoveLastActiveAdmin(target, target.id)) {
    res.status(400).json({ error: "Can't delete the last active admin account" });
    return;
  }
  await prisma.account.delete({ where: { id: req.params.id } }).catch(() => null);
  logAudit(req.account!, "ACCOUNT_DELETED", "account", target.id, target.username);
  res.status(204).end();
});

export default router;
