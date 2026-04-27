import path from "path";
import fs from "fs";

// Load a .env file at the project root before any other code reads from
// process.env. Kept as a side-effect module so it can be the first import
// in server/index.ts and run before db.ts (which reads DATABASE_URL at
// module-eval time). We avoid `dotenv` to keep the dep tree small — this
// handles `KEY=value`, `KEY="value with spaces"`, `KEY='value'`, blank
// lines, and `#` comments. Silently no-ops if the file is missing
// (production / Render sets env vars directly through the dashboard, so
// .env is dev-only). Existing process.env values (e.g. from the shell)
// take precedence so CI overrides still work.
try {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
} catch {
  // Best-effort — missing or malformed .env shouldn't prevent server start.
}
