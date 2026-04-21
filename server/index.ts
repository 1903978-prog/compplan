import express, { type Request, type Response, type NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { setupAuth } from "./auth";
import { seedDatabase } from "./seed";
import path from "path";
import fs from "fs";

// ── Minimal .env loader ───────────────────────────────────────────────────────
// Load a .env file at the project root before any other code reads from
// process.env. We avoid `dotenv` to keep the dep tree small — this handles
// `KEY=value`, `KEY="value with spaces"`, `KEY='value'`, blank lines, and
// `#` comments. Silently no-ops if the file is missing (production / Render
// sets env vars directly through the dashboard, so .env is dev-only).
// Existing process.env values (e.g. from the shell) take precedence so
// CI overrides still work.
(function loadDotenv() {
  try {
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      // Strip surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // Best-effort — missing or malformed .env shouldn't prevent server start.
  }
})();

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
    console.log(`Eendigo Op Model running on port ${port}`);
  });
}

main();
