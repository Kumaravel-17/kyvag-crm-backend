import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { authenticate, checkOrigin } from "./auth/middleware.js";
import { config } from "./config.js";
import { purgeExpired } from "./db.js";
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

purgeExpired();
setInterval(purgeExpired, 60 * 60_000).unref();

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
