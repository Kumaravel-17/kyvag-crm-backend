# Kyvag CRM backend

Express + PostgreSQL (through Prisma) API for the Kyvag CRM frontend.

```bash
cp .env.example .env  # then set DATABASE_URL to your Postgres database
npm install           # also generates the Prisma client
npm run db:deploy     # creates the tables
npm run seed          # dev account kumaravel@kyvag.com; password Kyvag@2026 (override with SEED_PASSWORD)
# npm run seed:demo   # optional: also ~580 sample leads, to try the dashboard and lists
npm run dev
```

## Database

- The schema is in `prisma/schema.prisma`; migrations are in `prisma/migrations`.
- Changing the schema: edit it, then `npm run db:migrate -- --name what-changed`. That writes a migration, applies it to your database and regenerates the client.
- On a server: `npm run db:deploy` applies any new migrations and never resets data.
- `npm run db:studio` opens a browser view of the data.
- Times are stored in UTC; the dashboard counts days in `TIME_ZONE` (default `Asia/Kolkata`).

## Auth

- Email and password only, one device at a time: signing in ends the account's session on any other device. There is no public sign-up.
- Sessions use an `HttpOnly`, `SameSite=Lax` cookie (`kyvag_session`). The frontend forwards `/api/*` here (rewrites in its `next.config.ts`), so the cookie belongs to the frontend's own domain. Set `TRUST_PROXY` so rate limits see real client IPs.
- "Keep me signed in" (`remember: true`) gives a rolling 30-day cookie. Without it, the cookie lasts until the browser closes and the server ends the session after 12 idle hours.
- Passwords are hashed with scrypt. Five wrong passwords lock the account for 15 minutes. Endpoints that check secrets are also rate-limited per IP.
- Emails (password reset links) are printed to the terminal in development. Connect an email provider in `src/mailer.ts` before production.

Errors are returned as `{ error: string, details?: { field, message }[] }`.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | `{ email, password, remember? }` | Returns `{ user }` |
| POST | `/api/auth/logout` | | |
| GET | `/api/auth/me` | | `{ user }`, or 401 if not signed in |
| PATCH | `/api/auth/me` | `{ name?, title?, phone?, email?, currentPassword? }` | `currentPassword` is required when changing email |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` | Signs out other devices |
| POST | `/api/auth/forgot-password` | `{ email }` | Gives the same answer whether or not the account exists |
| GET | `/api/auth/reset-password?token=` | | Checks a reset link: `{ email, name }` |
| POST | `/api/auth/reset-password` | `{ token, newPassword }` | Sets a password from a reset link |

Roles: `admin`, `manager`, `rep`. Use `requireAuth` / `requireRole(...)` from `src/auth/middleware.ts` to protect new routes.
