import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { logAudit } from "../lib/audit.js";
import { passwordProblem } from "../lib/password.js";
import { requireAuth, signToken, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

const loginSchema = z.object({ username: z.string().min(1).max(200), password: z.string().min(1).max(200) });

// Brute-force brake: after MAX_FAILURES wrong passwords for one username
// from one address within WINDOW_MS, refuse further attempts until the
// window passes. In-memory is fine for a single API process. Behind a
// reverse proxy, index.ts sets `trust proxy` so req.ip is the real client
// (R5-06); expired entries are pruned so the map can't grow without bound.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; first: number }>();
let lastPrune = Date.now();

function throttleKey(ip: string | undefined, username: string) {
  return `${ip ?? "?"}|${username.trim().toLowerCase()}`;
}
function prune(now: number) {
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [k, f] of failures) if (now - f.first > WINDOW_MS) failures.delete(k);
}
function isThrottled(key: string): boolean {
  const now = Date.now();
  prune(now);
  const f = failures.get(key);
  if (!f) return false;
  if (now - f.first > WINDOW_MS) {
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
// Test hook: the suite signs in many times quickly with deliberate failures.
export function resetLoginThrottle(): void {
  failures.clear();
}

// Compared against when the username doesn't exist, so an unknown username
// costs the same time as a wrong password (R5-21).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

function publicAccount(a: {
  id: string; username: string; role: "ADMIN" | "CUSTOM"; permissions: unknown; initials: string; color: string; mustChangePassword: boolean;
}) {
  return {
    id: a.id,
    username: a.username,
    role: a.role,
    permissions: a.permissions,
    initials: a.initials,
    color: a.color,
    mustChangePassword: a.mustChangePassword,
  };
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
    where: { username: { equals: username.trim(), mode: "insensitive" } },
  });
  const ok = await bcrypt.compare(password, account?.passwordHash ?? DUMMY_HASH);
  if (!account || !ok) {
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
  res.json({ token, account: publicAccount(account) });
});

router.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ account: req.account });
});

const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) });

// Self-service password change - the only write an account flagged
// mustChangePassword may perform. Bumps tokenVersion so every other device
// signed in with the old password is logged out, and returns a fresh token
// for this one.
router.post("/change-password", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }
  const account = await prisma.account.findUniqueOrThrow({ where: { id: req.account!.id } });
  if (!(await bcrypt.compare(parsed.data.currentPassword, account.passwordHash))) {
    res.status(400).json({ error: "Current password is incorrect." });
    return;
  }
  const problem = passwordProblem(parsed.data.newPassword, account.username);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  if (await bcrypt.compare(parsed.data.newPassword, account.passwordHash)) {
    res.status(400).json({ error: "Choose a password you haven't used before." });
    return;
  }
  const updated = await prisma.account.update({
    where: { id: account.id },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.newPassword, 10),
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
    },
  });
  logAudit(req.account!, "PASSWORD_CHANGED", "account", account.id, account.username);
  res.json({ token: signToken(updated.id, updated.tokenVersion), account: publicAccount(updated) });
});

export default router;
