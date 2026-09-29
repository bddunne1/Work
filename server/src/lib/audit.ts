import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

export interface AuditActor {
  id: string;
  username: string;
}

// Fire-and-forget by design: a logging failure should never block the
// request that triggered it, so callers don't await this on the request path.
export function logAudit(
  actor: AuditActor,
  action: string,
  targetType: string,
  targetId?: string | null,
  targetLabel?: string | null,
  detail?: Record<string, unknown>
): void {
  prisma.auditLog
    .create({
      data: {
        actorId: actor.id,
        actorUsername: actor.username,
        action,
        targetType,
        targetId: targetId ?? null,
        targetLabel: targetLabel ?? null,
        detail: (detail as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    })
    .catch((err) => console.error("Failed to write audit log entry:", err));
}

type Db = Prisma.TransactionClient | typeof prisma;

// The same entry written inside the caller's transaction, so a step that
// rolls back leaves no trace of having happened, and a step that commits
// always has its entry (B-11). Use this from inside $transaction callbacks;
// logAudit above is for the request path after a commit.
export async function auditIn(
  tx: Db,
  actor: AuditActor,
  action: string,
  targetType: string,
  targetId?: string | null,
  targetLabel?: string | null,
  detail?: Record<string, unknown>
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      actorUsername: actor.username,
      action,
      targetType,
      targetId: targetId ?? null,
      targetLabel: targetLabel ?? null,
      detail: (detail as Prisma.InputJsonValue | undefined) ?? undefined,
    },
  });
}

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

// JSON with keys in a fixed order, so two equal objects compare equal
// whichever way they were built.
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

function comparable(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Prisma.Decimal) return Number(v.toString());
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v !== null) return stable(v);
  return v;
}

// Which of `keys` differ between the stored row and the save, as
// { field: { from, to } } - what "who changed the terms on this account"
// needs to answer. Decimals compare as numbers, dates as days.
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[]): FieldChanges {
  const changes: FieldChanges = {};
  for (const key of keys) {
    const was = comparable(before[key]);
    const now = comparable(after[key]);
    if (was !== now) changes[key] = { from: before[key] instanceof Prisma.Decimal ? Number(before[key].toString()) : (before[key] ?? null), to: after[key] ?? null };
  }
  return changes;
}
