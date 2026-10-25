import "dotenv/config";

const env = process.env;
const isProd = env.NODE_ENV === "production";

const corsOrigins = (env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((o) => o.trim()).filter(Boolean);

// A number means "trust this many proxy hops"; any other value is passed to Express as-is
const trustProxy = env.TRUST_PROXY ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY)) : false;

export const config = {
  isProd,
  port: Number(env.PORT ?? 4000),
  corsOrigins,
  // Where links in emails (password reset) point to
  appUrl: env.APP_URL ?? corsOrigins[0],
  databasePath: env.DATABASE_PATH ?? "data/kyvag.db",
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : isProd,
  trustProxy,
  // Where "today" and "this month" start for the dashboard, whatever time zone the server runs in
  timeZone: env.TIME_ZONE ?? "Asia/Kolkata",
};
