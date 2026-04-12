import express, { type Request, type Response, type NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { setupAuth } from "./auth";
import { seedDatabase } from "./seed";
import path from "path";
import fs from "fs";

const app = express();
app.set("trust proxy", 1);

app.use('/api/proposal-templates', express.json({ limit: '10mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
