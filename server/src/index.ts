import "dotenv/config";
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
import itemsRouter from "./routes/items.js";
import returnsRouter from "./routes/returns.js";
import salesOrderSearchRouter from "./routes/salesOrderSearch.js";
import salesOrdersRouter from "./routes/salesOrders.js";
import savedReportsRouter from "./routes/savedReports.js";
import settingsRouter from "./routes/settings.js";
import stockMovementsRouter from "./routes/stockMovements.js";
import vendorPurchaseOrdersRouter from "./routes/vendorPurchaseOrders.js";
import vendorsRouter from "./routes/vendors.js";

const app = express();
app.use(cors());
// The default 100 KB limit was hit in simulation by a key account's
// customer record (300 price overrides + notes): every save of that
// customer failed with a 500 and it could never be edited again.
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/customers", customersRouter);
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
      res.status(409).json({ error: "This record is still referenced by other records (orders, POs or items) and can't be removed." });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Record not found" });
      return;
    }
  }
  console.error("Unhandled request error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
