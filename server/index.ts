// MUST be first — populates process.env from .env before db.ts (transitively
// imported below) reads DATABASE_URL at module-eval time.
import "./loadEnv";

import express, { type Request, type Response, type NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { setupAuth } from "./auth";
import { seedDatabase } from "./seed";
import { cleanupRetiredEmployeeAssignments } from "./storage";
import path from "path";
import fs from "fs";

const app = express();
app.set("trust proxy", 1);

app.use('/api/proposal-templates', express.json({ limit: '10mb' }));
// Proposals carry generated slide previews (HTML) in their JSON body, which
// routinely pushes bodies well past Express's 100KB default. Raising to 25mb
// matches the templates route and prevents "Save failed" / 413 errors.
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: false }));

// Serve uploaded proposal attachments
const uploadsDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    if (req.path.startsWith("/api")) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    }
  });
  next();
});

// Auth routes (login/check/logout)
setupAuth(app);

async function main() {
  // Seed defaults on startup
  try {
    await seedDatabase();
  } catch (err) {
    console.error("Seed error:", err);
  }

  // Idempotent startup migrations — fire-and-forget with retries. Neon free
  // tier returns "password authentication failed" while compute wakes up;
  // retrying after short delays lets it come online before we give up.
  (async () => {
    const { runMigrations } = await import("./migrations");
    // Neon free tier can take 50+ seconds to wake from suspension.
    // Retry window: 0 → 15s → 45s → 105s → 225s (≈ 4 min total).
    const retryDelays = [0, 15000, 30000, 60000, 120000];
    for (let i = 0; i < retryDelays.length; i++) {
      if (retryDelays[i]) await new Promise<void>(r => setTimeout(r, retryDelays[i]));
      try {
        await runMigrations();
        console.log("[startup] Migrations OK");
        return;
      } catch (err) {
        const nextDelay = retryDelays[i + 1];
        if (nextDelay !== undefined) {
          console.warn(`[startup] Migration attempt ${i + 1} failed, retrying in ${nextDelay / 1000}s: ${(err as Error).message}`);
        } else {
          console.error("[startup] Migration error (all retries exhausted):", err);
        }
      }
    }
  })();

  // Strip retired employees from all proposals (idempotent, runs every boot).
  // Fixes stale assignments from before cascade code was deployed (FIX-1).
  try {
    await cleanupRetiredEmployeeAssignments();
    console.log("[startup] Retired employee proposal assignments cleaned up");
  } catch (err) {
    console.error("[startup] Retired employee cleanup failed:", err);
  }

  const server = await registerRoutes(app);

  // Error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status ?? 500;
    const message = (err as { message?: string }).message ?? "Internal Server Error";
    console.error(err);
    res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(server, app);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "5000");
  server.listen(port, "0.0.0.0", () => {
    console.log(`Eendigo Command Center running on port ${port}`);
  });

  // Trash auto-purge heartbeat. seedDatabase() already purges on boot, but
  // long-running services (no redeploy in 30+ days) would otherwise let
  // expired rows linger. Run every 6h. Cheap query, errors are non-fatal.
  const { purgeExpiredTrash } = await import("./storage");
  const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const n = await purgeExpiredTrash();
      if (n > 0) console.log(`[trash] heartbeat purged ${n} expired item(s)`);
    } catch (e) {
      console.error("[trash] heartbeat purge failed:", e);
    }
  }, PURGE_INTERVAL_MS).unref();

  // CEO Brief daily cron — runs at 05:00 UTC (= 07:00 Europe/Rome in winter CET,
  // 06:00 in summer CEST). node-cron runs in the server process timezone (UTC on
  // Render). The brief will be ready by the time Livio opens his laptop.
  try {
    const cron = await import("node-cron");
    cron.default.schedule("0 5 * * *", async () => {
      console.log("[CEO Brief] Scheduled run starting...");
      try {
        const { runCeoBrief } = await import("./ceoBriefRunner");
        const result = await runCeoBrief({ trigger: "scheduled" });
        console.log(`[CEO Brief] Scheduled run complete — ${result.decisionsCount} decisions`);
      } catch (e) {
        console.error("[CEO Brief] Scheduled run failed:", e);
      }
    }, { timezone: "UTC" });
    console.log("[CEO Brief] Cron job scheduled (05:00 UTC daily)");
  } catch (e) {
    console.error("[CEO Brief] Failed to schedule cron:", e);
  }
}

main();
