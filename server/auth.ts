import { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";

const SESSION_COOKIE = "compplan_session";
const SESSION_VALUE = "authenticated";
const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export function setupAuth(app: import("express").Express) {
  app.use(cookieParser());

  app.post("/api/auth/login", (req: Request, res: Response) => {
    const { password } = req.body as { password?: string };
    const appPassword = process.env.APP_PASSWORD;

    if (!appPassword) {
      res.json({ ok: true });
      return;
    }

    if (password === appPassword) {
      res.cookie(SESSION_COOKIE, SESSION_VALUE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
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
    if (!appPassword || req.cookies?.[SESSION_COOKIE] === SESSION_VALUE) {
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
  if (!appPassword || req.cookies?.[SESSION_COOKIE] === SESSION_VALUE) {
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
}
