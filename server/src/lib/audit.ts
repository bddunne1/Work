import type { Prisma } from "@prisma/client";
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
