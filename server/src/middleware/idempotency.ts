import type { NextFunction, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import type { AuthedRequest } from "./auth.js";

// Idempotent creates (R4-16). A client that sends `Idempotency-Key` on a
// create request gets exactly one record for that key: the first request
// claims the key (a unique row), runs, and stores its status and body; a
// repeat with the same key and account replays that answer. A repeat that
// arrives while the first is still running gets a 409 rather than a
// duplicate. Keys are per account and per scope (orders, POs, returns).
//
// Failures are not remembered: a 5xx (or a crash, which leaves the claim
// stale) frees the key so the client can try again, while a 4xx is
// replayed - the same bad input gets the same answer.

const STALE_CLAIM_MS = 60_000;
const KEEP_MS = 24 * 60 * 60 * 1000;

export function idempotent(scope: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header("Idempotency-Key")?.trim();
    if (!key) {
      next();
      return;
    }
    if (key.length > 200) {
      res.status(400).json({ error: "Idempotency-Key is too long (200 characters at most)." });
      return;
    }
    const accountId = req.account!.id;
    const where = { scope_key_accountId: { scope, key, accountId } };
    const claimed = await claim(scope, key, accountId);
    if (!claimed) {
      const row = await prisma.idempotencyKey.findUnique({ where });
      if (row && row.status === 0 && Date.now() - row.createdAt.getTime() < STALE_CLAIM_MS) {
        res.status(409).json({ error: "That request is still being processed - wait a moment and reload before trying again.", conflict: true });
        return;
      }
      if (row && row.status !== 0) {
        res.status(row.status).json(row.body);
        return;
      }
      // A stale claim (the first request died mid-way): take it over.
      await prisma.idempotencyKey.deleteMany({ where: { scope, key, accountId } });
      if (!(await claim(scope, key, accountId))) {
        res.status(409).json({ error: "That request is still being processed - wait a moment and reload before trying again.", conflict: true });
        return;
      }
    }
    // The answer is recorded before it is sent, so a repeat that arrives the
    // instant the first response leaves already finds it.
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const status = res.statusCode;
      const remember = status < 500
        ? prisma.idempotencyKey.update({ where, data: { status, body: body as Prisma.InputJsonValue } })
        : prisma.idempotencyKey.deleteMany({ where: { scope, key, accountId } });
      remember
        .catch((err) => console.error("idempotency: could not record the response", err))
        .finally(() => originalJson(body));
      return res;
    }) as Response["json"];
    next();
  };
}

async function claim(scope: string, key: string, accountId: string): Promise<boolean> {
  try {
    await prisma.idempotencyKey.create({ data: { scope, key, accountId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
  // Keys older than a day have done their job; prune a few on each claim so
  // the table never needs a separate sweeper.
  await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } }).catch(() => undefined);
  return true;
}
