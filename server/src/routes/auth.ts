import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { logAudit } from "../lib/audit.js";
import { requireAuth, signToken, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

// Basic brute-force brake: after MAX_FAILURES wrong passwords for one
// username from one address within WINDOW_MS, refuse further attempts until
// the window passes. In-memory is fine for a single API process.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; first: number }>();

function throttleKey(ip: string | undefined, username: string) {
  return `${ip ?? "?"}|${username.toLowerCase()}`;
}
function isThrottled(key: string): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return f.count >= MAX_FAILURES;
}
function recordFailure(key: string) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  const { username, password } = parsed.data;
  const key = throttleKey(req.ip, username);
  if (isThrottled(key)) {
    res.status(429).json({ error: "Too many failed sign-in attempts. Wait 15 minutes and try again." });
    return;
  }
  const account = await prisma.account.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
  });
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    recordFailure(key);
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  if (!account.active) {
    res.status(401).json({ error: "This account has been deactivated." });
    return;
  }
  failures.delete(key);
  const token = signToken(account.id, account.tokenVersion);
  logAudit({ id: account.id, username: account.username }, "LOGIN", "account", account.id, account.username);
  res.json({
    token,
    account: {
      id: account.id,
      username: account.username,
      role: account.role,
      permissions: account.permissions,
      initials: account.initials,
      color: account.color,
    },
  });
});

router.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ account: req.account });
});

export default router;
