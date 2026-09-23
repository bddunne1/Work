import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, signToken, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

const router = Router();

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  const { username, password } = parsed.data;
  const account = await prisma.account.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
  });
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  const token = signToken(account.id);
  res.json({
    token,
    account: {
      id: account.id,
      username: account.username,
      role: account.role,
      permissions: account.permissions,
      initials: account.initials,
    },
  });
});

router.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ account: req.account });
});

export default router;
