import { Prisma } from "@prisma/client";

// Two transactions that took rows in different orders can deadlock
// (Postgres 40P01); Postgres aborts one, nothing is half-written, and the
// caller simply repeats. Reported by Prisma as P2034, as P2010 from a raw
// query (the code is in meta), or as an unknown error carrying the text.
export function isDeadlock(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") return true;
    const meta = err.meta as { code?: string; message?: string } | undefined;
    return meta?.code === "40P01" || /40P01|deadlock detected/i.test(`${meta?.message ?? ""} ${err.message}`);
  }
  return err instanceof Prisma.PrismaClientUnknownRequestError && /40P01|deadlock detected/i.test(err.message);
}
