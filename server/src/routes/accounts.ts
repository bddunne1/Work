import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
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
});

const publicFields = {
  id: true,
  username: true,
  role: true,
  permissions: true,
  initials: true,
  color: true,
  createdAt: true,
};

router.use(requireAuth, requireAdmin);

router.get("/", async (_req, res) => {
  const accounts = await prisma.account.findMany({ orderBy: { createdAt: "asc" }, select: publicFields });
  res.json(accounts);
});

router.post("/", async (req, res) => {
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
  res.status(201).json(account);
});

router.put("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  // Never allow demoting or deleting the last remaining admin - that would
  // lock everyone out of Accounts.
  if (data.role === "CUSTOM") {
    const target = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (target?.role === "ADMIN") {
      const adminCount = await prisma.account.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        res.status(400).json({ error: "Can't demote the last admin account" });
        return;
      }
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
        passwordHash: data.password ? await bcrypt.hash(data.password, 10) : undefined,
      },
      select: publicFields,
    })
    .catch(() => null);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(account);
});

router.delete("/:id", async (req, res) => {
  const target = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (target?.role === "ADMIN") {
    const adminCount = await prisma.account.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      res.status(400).json({ error: "Can't delete the last admin account" });
      return;
    }
  }
  await prisma.account.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
});

export default router;
