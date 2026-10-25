import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { authenticate, checkOrigin } from "./auth/middleware.js";
import { config } from "./config.js";
import { ensureDefaultStages, prisma, purgeExpired } from "./db.js";
import { errorHandler } from "./http.js";
import { apiRoutes } from "./routes/index.js";

const app = express();

app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");
// credentials: true lets the frontend send the session cookie (fetch with credentials: "include")
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(checkOrigin);
app.use(authenticate);

app.use("/api", apiRoutes);

app.use(errorHandler);

// Expired sessions and reset links are refused anyway; this just keeps the tables small
const purge = () => purgeExpired().catch((e) => console.error("Cleanup of expired sessions failed:", e));

await ensureDefaultStages();
purge();
setInterval(purge, 60 * 60_000).unref();

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

// Lets in-flight requests finish and closes the database pool when the process manager stops the app
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => prisma.$disconnect().finally(() => process.exit(0))));
}
