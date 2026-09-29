import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma.js";

const JWT_SECRET: string =
  process.env.JWT_SECRET ??
  (() => {
    throw new Error("JWT_SECRET is not set");
  })();

// Sessions used to last 30 days, which on a shared warehouse PC meant a
// month of someone else's access. A working day plus a margin; the client
// also signs out after a period of inactivity (see authContext.tsx).
const TOKEN_TTL = (process.env.TOKEN_TTL ?? "10h") as jwt.SignOptions["expiresIn"];

export type AccessLevel = "view" | "edit";

export interface AuthedAccount {
  id: string;
  username: string;
  role: "ADMIN" | "CUSTOM";
  permissions: Record<string, AccessLevel> | null;
  initials: string;
  color: string;
  mustChangePassword: boolean;
}

export interface AuthedRequest extends Request {
  account?: AuthedAccount;
}

export function signToken(accountId: string, tokenVersion: number): string {
  return jwt.sign({ sub: accountId, tv: tokenVersion }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// The only routes an account that still has to change its password may use.
const PASSWORD_CHANGE_ALLOWLIST = new Set(["/api/auth/me", "/api/auth/change-password", "/api/auth/logout"]);

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  let payload: { sub: string; tv?: number };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { sub: string; tv?: number };
  } catch {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const account = await prisma.account.findUnique({ where: { id: payload.sub } });
  // A token version mismatch means this token was issued before the most
  // recent Force Logout / password change - treat it exactly like an invalid
  // token. Older tokens signed before this field existed carry no `tv` claim;
  // those are honored once (tokenVersion starts at 0).
  if (!account || !account.active || (payload.tv ?? 0) !== account.tokenVersion) {
    res.status(401).json({ error: account && !account.active ? "This account has been deactivated." : "Not authenticated" });
    return;
  }
  if (account.mustChangePassword && !PASSWORD_CHANGE_ALLOWLIST.has(req.originalUrl.split("?")[0])) {
    res.status(403).json({ error: "You need to choose a new password before continuing.", code: "PASSWORD_CHANGE_REQUIRED" });
    return;
  }
  req.account = {
    id: account.id,
    username: account.username,
    role: account.role,
    permissions: (account.permissions as Record<string, AccessLevel> | null) ?? null,
    initials: account.initials,
    color: account.color,
    mustChangePassword: account.mustChangePassword,
  };
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.account?.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function hasPermission(account: AuthedAccount, pageKey: string, level: AccessLevel): boolean {
  if (account.role === "ADMIN") return true;
  const access = account.permissions?.[pageKey];
  return level === "view" ? access === "view" || access === "edit" : access === "edit";
}

// Mirrors the frontend's getAccessLevel (src/lib/permissions.ts): admin
// always passes; a custom account needs at least `level` access on the
// given page key.
export function requirePermission(pageKey: string, level: AccessLevel) {
  return requireAnyPermission([pageKey], level);
}

// Passes if the account has `level` on ANY of `pageKeys` - for endpoints
// that several pages legitimately drive (e.g. every order-workflow stage
// saves the same sales order record).
export function requireAnyPermission(pageKeys: string[], level: AccessLevel) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const account = req.account;
    if (!account) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!pageKeys.some((key) => hasPermission(account, key, level))) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    next();
  };
}
