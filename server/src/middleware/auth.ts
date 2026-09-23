import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma.js";

const JWT_SECRET: string =
  process.env.JWT_SECRET ??
  (() => {
    throw new Error("JWT_SECRET is not set");
  })();

export type AccessLevel = "view" | "edit";

export interface AuthedAccount {
  id: string;
  username: string;
  role: "ADMIN" | "CUSTOM";
  permissions: Record<string, AccessLevel> | null;
  initials: string;
}

export interface AuthedRequest extends Request {
  account?: AuthedAccount;
}

export function signToken(accountId: string): string {
  return jwt.sign({ sub: accountId }, JWT_SECRET, { expiresIn: "30d" });
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    const account = await prisma.account.findUnique({ where: { id: payload.sub } });
    if (!account) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    req.account = {
      id: account.id,
      username: account.username,
      role: account.role,
      permissions: (account.permissions as Record<string, AccessLevel> | null) ?? null,
      initials: account.initials,
    };
    next();
  } catch {
    res.status(401).json({ error: "Not authenticated" });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.account?.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// Mirrors the frontend's getAccessLevel (src/lib/permissions.ts): admin
// always passes; a custom account needs at least `level` access on the
// given page key.
export function requirePermission(pageKey: string, level: AccessLevel) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const account = req.account;
    if (!account) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (account.role === "ADMIN") {
      next();
      return;
    }
    const access = account.permissions?.[pageKey];
    const ok = level === "view" ? access === "view" || access === "edit" : access === "edit";
    if (!ok) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    next();
  };
}
