// The Express application, separate from the listener in index.ts so the
// test suite can drive it in-process with supertest.
//
// Patches Express to forward a rejected promise from an async route handler
// to the error middleware below, instead of it becoming an unhandled
// rejection that crashes the whole process - must be imported before any
// router is defined. Express 4 doesn't do this on its own.
import "express-async-errors";
import cors from "cors";
import express from "express";
import { Prisma } from "@prisma/client";
import { HttpError } from "./lib/conflictError.js";
import accountsRouter from "./routes/accounts.js";
import analyticsRouter from "./routes/analytics.js";
import auditLogRouter from "./routes/auditLog.js";
import authRouter from "./routes/auth.js";
import countersRouter from "./routes/counters.js";
import customersRouter from "./routes/customers.js";
import dashboardRouter from "./routes/dashboard.js";
import integrationsRouter from "./routes/integrations.js";
import invoicesRouter from "./routes/invoices.js";
import shipmentsRouter from "./routes/shipments.js";
import itemsRouter from "./routes/items.js";
import returnsRouter from "./routes/returns.js";
import salesOrderSearchRouter from "./routes/salesOrderSearch.js";
import salesOrdersRouter from "./routes/salesOrders.js";
import savedReportsRouter from "./routes/savedReports.js";
import settingsRouter from "./routes/settings.js";
import stockMovementsRouter from "./routes/stockMovements.js";
import vendorPurchaseOrdersRouter from "./routes/vendorPurchaseOrders.js";
import vendorsRouter from "./routes/vendors.js";

function isDeadlock(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") return true;
    // A raw query (the item row locks) reports the Postgres code in meta.
    const meta = err.meta as { code?: string; message?: string } | undefined;
    return meta?.code === "40P01" || /40P01|deadlock detected/i.test(`${meta?.message ?? ""} ${err.message}`);
  }
  return err instanceof Prisma.PrismaClientUnknownRequestError && /40P01|deadlock detected/i.test(err.message);
}

export function createApp(): express.Express {
  const app = express();

  // Behind nginx/Caddy every request arrives from 127.0.0.1; without this
  // the sign-in throttle keys every user to the proxy's address (R5-06).
  // TRUST_PROXY=1 trusts one hop; a hostname/CIDR list is passed through.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy && trustProxy !== "0" && trustProxy !== "false") {
    app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  // CORS_ORIGIN restricts browsers to the listed origins (comma separated).
  // Unset keeps the permissive default for local development, where the Vite
  // dev server and the API are on different ports.
  const origins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
  app.use(cors(origins && origins.length > 0 ? { origin: origins } : undefined));
  app.disable("x-powered-by");

  // The default 100 KB limit was hit in simulation by a key account's
  // customer record (300 price overrides + notes): every save of that
  // customer failed with a 500 and it could never be edited again.
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/customers", customersRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api/vendors", vendorsRouter);
  app.use("/api/accounts", accountsRouter);
  app.use("/api/audit-log", auditLogRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/saved-reports", savedReportsRouter);
  app.use("/api/counters", countersRouter);
  app.use("/api/vendor-purchase-orders", vendorPurchaseOrdersRouter);
  app.use("/api/returns", returnsRouter);
  // Must come before the sales-orders router, whose "/:soNumber" would
  // otherwise claim "/search".
  app.use("/api/sales-orders/search", salesOrderSearchRouter);
  app.use("/api/sales-orders", salesOrdersRouter);
  app.use("/api/stock-movements", stockMovementsRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api/shipments", shipmentsRouter);
  app.use("/api/integrations", integrationsRouter);

  // Catches anything a route didn't handle itself (including an async
  // handler's rejected promise, via express-async-errors above) - the whole
  // point is that one request's unexpected error becomes a 500 response
  // instead of taking the process, and everyone else's requests, down with it.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    if ((err as { type?: string })?.type === "entity.too.large") {
      res.status(413).json({ error: "This record is too large to save in one request." });
      return;
    }
    if ((err as { type?: string })?.type === "entity.parse.failed") {
      res.status(400).json({ error: "The request body is not valid JSON." });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
      return;
    }
    // Known database constraint failures are the caller's problem, not a
    // server fault - say what happened instead of a bare 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        res.status(409).json({ error: "That number or name is already in use." });
        return;
      }
      if (err.code === "P2003") {
        const field = String((err.meta as { field_name?: string } | undefined)?.field_name ?? "");
        const message = /customer/i.test(field)
          ? "That customer no longer exists - pick the customer again."
          : /vendor/i.test(field)
            ? "That vendor no longer exists - pick the vendor again."
            : "This record is still referenced by other records (orders, POs or items) and can't be removed.";
        res.status(409).json({ error: message });
        return;
      }
      if (err.code === "P2025") {
        res.status(404).json({ error: "Record not found" });
        return;
      }
    }
    // Two transactions that took item rows in different orders can deadlock
    // (Postgres 40P01); Postgres aborts one, nothing is half-written, and
    // the caller simply repeats. Stock loops now take rows in item-id order,
    // so this is rare - but it is a retry, not a server fault.
    if (isDeadlock(err)) {
      res.status(409).json({ error: "Another change collided with this one - nothing was saved. Try again.", conflict: true, retry: true });
      return;
    }
    console.error("Unhandled request error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
