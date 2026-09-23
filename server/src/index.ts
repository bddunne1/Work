import "dotenv/config";
// Patches Express to forward a rejected promise from an async route handler
// to the error middleware below, instead of it becoming an unhandled
// rejection that crashes the whole process - must be imported before any
// router is defined. Express 4 doesn't do this on its own.
import "express-async-errors";
import cors from "cors";
import express from "express";
import accountsRouter from "./routes/accounts.js";
import auditLogRouter from "./routes/auditLog.js";
import authRouter from "./routes/auth.js";
import customersRouter from "./routes/customers.js";
import itemsRouter from "./routes/items.js";
import savedReportsRouter from "./routes/savedReports.js";
import settingsRouter from "./routes/settings.js";
import vendorsRouter from "./routes/vendors.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/customers", customersRouter);
app.use("/api/items", itemsRouter);
app.use("/api/vendors", vendorsRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/audit-log", auditLogRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/saved-reports", savedReportsRouter);

// Catches anything a route didn't handle itself (including an async
// handler's rejected promise, via express-async-errors above) - the whole
// point is that one request's unexpected error becomes a 500 response
// instead of taking the process, and everyone else's requests, down with it.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled request error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
