import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Check } from "lucide-react";

// Background-theme keys must match the .theme-* CSS classes in index.css
// AND the init script in client/index.html. Keep these three in sync.
type ThemeKey = "navy" | "white" | "light-grey" | "medium-grey" | "dark-grey";
const STORAGE_KEY = "compplan_bg_theme";

interface ThemeOption {
  key: ThemeKey;
  label: string;
  swatch: string; // CSS background for the preview tile
  isDark: boolean; // whether this theme adds the .dark class
  hint: string;
}

const THEMES: ThemeOption[] = [
  { key: "navy",         label: "Navy (current)", swatch: "#1B2540", isDark: true,  hint: "Dark blue-navy. Original look." },
  { key: "dark-grey",    label: "Dark grey",      swatch: "#383838", isDark: true,  hint: "Neutral dark grey, no blue tint." },
  { key: "medium-grey",  label: "Medium grey",    swatch: "#C7C7C7", isDark: false, hint: "Light page on a softer grey." },
  { key: "light-grey",   label: "Light grey",     swatch: "#EDEDED", isDark: false, hint: "Near-white, low glare." },
  { key: "white",        label: "White",          swatch: "#FFFFFF", isDark: false, hint: "Pure white." },
];

function readActive(): ThemeKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && THEMES.some(t => t.key === v)) return v as ThemeKey;
  } catch { /* ignore */ }
  return "navy";
}

function applyTheme(next: ThemeKey) {
  const html = document.documentElement;
  // Strip every theme-* class first so switching is idempotent.
  for (const t of THEMES) html.classList.remove(`theme-${t.key}`);
  html.classList.add(`theme-${next}`);
  // Toggle .dark for token set (foreground/card/borders/etc.)
  const opt = THEMES.find(t => t.key === next);
  if (opt?.isDark) html.classList.add("dark");
  else html.classList.remove("dark");
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
}

export default function AdminTheme() {
  const [active, setActive] = useState<ThemeKey>(() => readActive());

  // Re-sync if another tab changes it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && THEMES.some(t => t.key === e.newValue)) {
        setActive(e.newValue as ThemeKey);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const choose = (k: ThemeKey) => {
    applyTheme(k);
    setActive(k);
  };

  return (
    <div className="container mx-auto py-6 max-w-3xl">
      <PageHeader
        title="Background Theme"
        description="Page background only. Cards, tables and text colors stay readable on every theme. Stored in this browser (localStorage) — switch per-device."
      />

      <Card className="p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {THEMES.map(t => {
            const isActive = active === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => choose(t.key)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                  isActive
                    ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                    : "border-border hover:bg-muted/40"
                }`}
                aria-pressed={isActive}
              >
                <span
                  className="inline-block w-10 h-10 rounded-md border shrink-0"
                  style={{ background: t.swatch }}
                  aria-hidden
                />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{t.label}</span>
                    {isActive && <Check className="w-4 h-4 text-primary" />}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
          Saved to this browser only — the choice doesn't sync across devices or
          users. To match a colleague's view, set the same option here.
        </p>
      </Card>
    </div>
  );
}
