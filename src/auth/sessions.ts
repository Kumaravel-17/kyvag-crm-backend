import type { CookieOptions, Request, Response } from "express";
import { config } from "../config.js";
import { prisma, type Session, type User } from "../db.js";
import { hashToken, newToken } from "./crypto.js";

export const SESSION_COOKIE = "kyvag_session";

const HOUR = 60 * 60_000;
// "Keep me signed in" gives a rolling 30-day cookie; otherwise the cookie ends with the browser and the server drops it after 12 idle hours
const ttl = (persistent: boolean) => (persistent ? 30 * 24 * HOUR : 12 * HOUR);
// Avoids a database write on every request just to bump the expiry
const TOUCH_EVERY = 60_000;

const cookieBase: CookieOptions = { httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/" };

function setCookie(res: Response, token: string, persistent: boolean) {
  res.cookie(SESSION_COOKIE, token, persistent ? { ...cookieBase, maxAge: ttl(true) } : cookieBase);
}

export const clearSessionCookie = (res: Response) => res.clearCookie(SESSION_COOKIE, cookieBase);

export async function startSession(req: Request, res: Response, userId: string, persistent: boolean) {
  const token = newToken();
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      persistent,
      expiresAt: new Date(Date.now() + ttl(persistent)),
      ip: req.ip ?? null,
      userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  setCookie(res, token, persistent);
}

/** Resolves the session cookie to a live session and its user, sliding the expiry forward */
export async function resumeSession(req: Request, res: Response): Promise<{ session: Session; user: User } | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) return null;

  const found = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!found) return null;
  const { user, ...session } = found;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now || user.disabled) {
    await endSession(session.id);
    return null;
  }

  if (now - session.lastSeenAt.getTime() > TOUCH_EVERY) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + ttl(session.persistent)) } });
    if (session.persistent) setCookie(res, token, true);
  }
  return { session, user };
}

export const endSession = (id: string) => prisma.session.deleteMany({ where: { id } });

/** Signs the user out everywhere, optionally keeping the session making the request */
export const endUserSessions = (userId: string, exceptId?: string) =>
  prisma.session.deleteMany({ where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) } });
