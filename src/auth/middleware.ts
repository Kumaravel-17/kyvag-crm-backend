import type { Request, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "../config.js";
import type { Role, SessionRow, UserRow } from "../db.js";
import { HttpError } from "../http.js";
import { clearSessionCookie, resumeSession, SESSION_COOKIE } from "./sessions.js";

declare global {
  namespace Express {
    interface Request {
      auth?: { user: UserRow; session: SessionRow };
    }
  }
}

/** Attaches req.auth when the session cookie is valid; never rejects on its own */
export const authenticate: RequestHandler = (req, res, next) => {
  const auth = resumeSession(req, res);
  if (auth) req.auth = auth;
  else if (req.cookies?.[SESSION_COOKIE]) clearSessionCookie(res);
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, "Sign in to continue.");
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, "Sign in to continue.");
    if (!roles.includes(req.auth.user.role)) throw new HttpError(403, "You don't have access to this.");
    next();
  };

/** For handlers behind requireAuth */
export function authOf(req: Request) {
  if (!req.auth) throw new HttpError(401, "Sign in to continue.");
  return req.auth;
}

// Per-IP limit on endpoints that guess at secrets; the per-account lockout in users.ts covers spread-out attacks
export const guessLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait a few minutes and try again." },
});

const SAFE_METHODS =new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard on top of SameSite=Lax cookies: browsers send Origin on cross-site writes,
 * so a write from any origin other than the frontend is refused.
 */
export const checkOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get("origin");
  if (!SAFE_METHODS.has(req.method) && origin && !config.corsOrigins.includes(origin)) {
    throw new HttpError(403, "Request origin not allowed.");
  }
  next();
};
