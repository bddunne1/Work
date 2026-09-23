import "dotenv/config";
import cors from "cors";
import express from "express";
import accountsRouter from "./routes/accounts.js";
import authRouter from "./routes/auth.js";
import customersRouter from "./routes/customers.js";
import itemsRouter from "./routes/items.js";
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

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
