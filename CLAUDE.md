# compplan — the Eendigo operating system (AIOS)

CompPlan is the **Eendigo Internal Operating System (AIOS)** — the single place where every kind of Eendigo data is consolidated, analyzed to drive decisions, and increasingly acted on by an agentic layer. Recent work has been rebranded under "AIOS" (e.g. "AIOS Phase 1: public /api/ceo-brief endpoint", "AIOS Dashboard", OrgChart, Cowork integration).

**Live frontier:** the agentic layer. When you read this file, that's almost certainly where Livio is working.

**Audience:** Livio (CEO of Eendigo) — only user. Skip onboarding boilerplate.

**Repo:** https://github.com/1903978-prog/compplan
**Deployed on:** Render.

> Note: there is a separate, much smaller app at `~/.claude/app 1` called **template-tiles**. That one shares some scaffolding heritage but is **not** CompPlan and is not the Eendigo OS — don't confuse the two.

## What CompPlan is for (intent)

Three concentric purposes, ordered by maturity:

1. **Consolidation** — every category of Eendigo data lives here over time. Already implemented: employees, role grid, salary history, days off, hiring candidates, won projects, BD deals, invoice snapshots/changes, pricing settings/cases/proposals, proposals + proposal templates + slide templates, OKRs (objectives, key results), executive log, conflicts, knowledge (topics + files), agents + org agents + agent knowledge + agent proposals, cowork skills, briefs (runs + events), API usage log, and more. Replaces ad-hoc spreadsheets with one source of truth.
2. **Analysis** — structured data powers decisions: pricing, hiring, capacity, forecasting, performance, risk. CEO-brief and OrgChart are early surfaces of this layer.
3. **Agentic execution** — the AIOS layer: agents (per-role, including org-level), proposals from agents, brief runs, executive log, president→CEO request flow, public CEO-brief endpoint that Cowork (Livio's personal cockpit) consumes. Long-arc goal: agents run the business with minimal human input, limited to key decisions. **This is where active work is happening.**

When proposing a change, ask: does this serve consolidation, analysis, or agency? If it's purely cosmetic and doesn't move one of those forward, it's probably not the next step.

## Stack

- **Server:** Node 20+, Express 5, TypeScript (ESM). `tsx` in dev; esbuild bundle in prod.
- **Database:** PostgreSQL via Drizzle ORM. Schema in `shared/schema.ts` — large (~45+ tables across employees, pricing, proposals, hiring, OKRs, agents, knowledge, briefs, cowork, etc.).
- **Client:** React 18, Vite, Wouter, TanStack Query, Tailwind + shadcn/ui, `recharts` (where charts appear).
- **LLM integration:** `@anthropic-ai/sdk` via `server/aiProviders.ts`. Used by `proposalAI.ts`, `proposalBriefs.ts`, brief runs, agent proposals, agent knowledge.
- **Auth:** cookie-based (`cookie-parser`) + bearer where appropriate. Public endpoints (e.g. `/api/ceo-brief`) are explicitly marked.
- **Other server modules:** `hiringSync.ts`, `proposalDeck.ts`, `slideImageExporter.ts`, `readAISeed.ts`, `seedProposals.ts`.

## Repo layout

```
client/             React SPA
server/
  index.ts          Boot
  routes.ts         /api/* endpoints (large)
  storage.ts        Drizzle DB layer
  db.ts             Drizzle client
  auth.ts           Auth middleware
  loadEnv.ts        Env loading
  seed.ts           Idempotent seeds on boot
  seedProposals.ts  Proposal-template seeds
  readAISeed.ts     AI seed loader
  aiProviders.ts    LLM provider wrapper (Anthropic)
  proposalAI.ts     LLM-driven proposal generation
  proposalBriefs.ts Brief generation
  proposalDeck.ts   Slide deck assembly
  slideImageExporter.ts  Slide rendering to images
  hiringSync.ts     Hiring candidate sync
  static.ts         Serves built client in prod
  vite.ts           Vite middleware in dev
shared/schema.ts    Drizzle tables (very large — read before changing)
script/build.ts     Vite + esbuild
scripts/            Standalone scripts (DB ops, migrations, etc.)
docs/               Internal docs
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Express + Vite middleware. |
| `npm run build` | Vite client + esbuild server. |
| `npm start` | Production bundle. |
| `npm run check` | `tsc` type-check. |
| `npm run db:push` | Apply schema. **High blast radius** — many tables, real data. Confirm before running, especially on column drops/renames. |
| `npm run postinstall` | Auto-run on install (check what it does before disabling). |

## Public-vs-private endpoints

Most `/api/*` is gated. **Some endpoints are deliberately public** to serve the Cowork personal cockpit (e.g. `/api/ceo-brief` is public per AIOS Phase 1). Don't gate or ungate endpoints without checking how Cowork consumes them.

## Conventions

- **Schema changes are high-stakes.** This DB holds the company. New tables: fine. Changes to existing columns: surface SQL and confirm.
- **LLM calls cost money and time.** Prefer caching/reuse. New LLM-driven flows propose, then act with approval.
- **Validate at boundaries** with Zod. Trust types internally.
- **The seed/routes/storage split is load-bearing** — respect it. New domain features get their own server module if they're substantial.

## Standing rules — strict

1. **Never remove a function, menu, button, route, endpoint, file, table, column, row, employee, candidate, proposal, deal, OKR, agent, knowledge entry, brief, or any data without explicit permission.** This database is the company's memory. Surface and propose; don't delete. Renaming/restructuring is fine; deleting is not.
2. **Maximum autonomy — default to action, never ask.** Do the work and report results. Do NOT ask for permission, do NOT ask clarifying questions, do NOT say "shall I proceed". If the intent is 80% clear, pick the most reasonable interpretation and go. Only stop if the action is IRREVERSIBLE and HIGH blast-radius (see rule 8).
3. **No external side-effects without a clear yes.** The one exception to rule 2: if the action would send emails, post to Slack, charge money, notify real people, or write to a paid external API — stop and confirm first. Internal app changes, DB writes, and code changes are all fair game without asking.
4. **LLM flows:** new agentic features (AIOS, brief runs, agent proposals) can be built fully and shipped. The "propose before executing" pattern is for Livio's approval inside the app UI (via Approvals page), not for Claude asking Livio in chat.
5. **No Replit.** Don't reintroduce `@replit/*` packages or `REPL_ID`-conditional code.
6. **Secrets:** never log, echo, or write `ANTHROPIC_API_KEY`, `DATABASE_URL`, auth cookies/tokens, or any other env var.
7. **Public endpoints are deliberate.** Don't change auth on `/api/ceo-brief` or any other endpoint Cowork relies on without confirmation.
8. **`npm run db:push` is destructive on column drops/renames.** Pure additions are fine; drops/renames need a yes and a backup plan. New tables and new columns are always safe — just do it.
9. **Ask permission before using the computer.** Before driving the desktop / opening apps / clicking / typing via the computer-use MCP, stop and ask. This is a hard gate — even if a task seems to need it, ask first. (Browser MCP and code/file edits inside this repo are unaffected.)
10. **Org chart layout is TOP-DOWN VERTICAL — each SOLID-LINE child must be below its parent.** Children stack vertically below the parent in an indented-tree (file-explorer) pattern: every node on its own row, indented by depth, with a vertical bracket connector. Direct-reports groups are a vertical column, never a horizontal row. **Exception — dotted-line children are HORIZONTAL.** A node with no solid parent but a dotted (matrix/advisor) parent is placed on the SAME ROW as its dotted boss, offset to the RIGHT, with a dashed connector. This is the only horizontal placement allowed. This is final — do not flip dotted nodes to vertical, do not flip solid nodes to horizontal.
