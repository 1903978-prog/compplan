import { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";

const SESSION_COOKIE = "compplan_session";
const SESSION_VALUE = "authenticated";
const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

const isProd = process.env.NODE_ENV === "production";

// In production a missing APP_PASSWORD is a hard fail: do NOT auto-allow.
// In dev (npm run dev with no .env) we allow with a console warning so a
// fresh checkout still boots — but log loudly so the operator notices.
let warnedNoPassword = false;
function passwordMissingAllowedInDev(): boolean {
  if (isProd) return false;
  if (!warnedNoPassword) {
    // eslint-disable-next-line no-console
    console.warn("[auth] APP_PASSWORD not set — auth disabled (DEV only). DO NOT deploy without it.");
    warnedNoPassword = true;
  }
  return true;
}

export function setupAuth(app: import("express").Express) {
  app.use(cookieParser());

  app.post("/api/auth/login", (req: Request, res: Response) => {
    const { password } = req.body as { password?: string };
    const appPassword = process.env.APP_PASSWORD;

    if (!appPassword) {
      // In production: refuse — the operator must set the env var.
      // In dev: pass-through so local boot still works.
      if (isProd) {
        res.status(503).json({ ok: false, message: "Auth not configured (APP_PASSWORD missing)." });
        return;
      }
      passwordMissingAllowedInDev();
      res.json({ ok: true });
      return;
    }

    if (password === appPassword) {
      res.cookie(SESSION_COOKIE, SESSION_VALUE, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: MAX_AGE,
      });
      res.json({ ok: true });
    } else {
      res.status(401).json({ ok: false, message: "Invalid password" });
    }
  });

  app.get("/api/auth/check", (req: Request, res: Response) => {
    const appPassword = process.env.APP_PASSWORD;
    if (!appPassword) {
      if (isProd) {
        res.status(503).json({ authenticated: false, message: "Auth not configured (APP_PASSWORD missing)." });
        return;
      }
      passwordMissingAllowedInDev();
      res.json({ authenticated: true });
      return;
    }
    if (req.cookies?.[SESSION_COOKIE] === SESSION_VALUE) {
      res.json({ authenticated: true });
    } else {
      res.json({ authenticated: false });
    }
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    if (isProd) {
      res.status(503).json({ message: "Auth not configured (APP_PASSWORD missing)." });
      return;
    }
    passwordMissingAllowedInDev();
    next();
    return;
  }
  if (req.cookies?.[SESSION_COOKIE] === SESSION_VALUE) {
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
}
