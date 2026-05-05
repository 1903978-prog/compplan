-- ============================================================
-- KM Agent System — Forward Migration
-- Run once against the live database.
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Extend agents table with KM columns
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_type          TEXT NOT NULL DEFAULT 'aios_classic';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS knowledge_base_path TEXT;

-- 2. KM query sessions (one row per user question)
CREATE TABLE IF NOT EXISTS km_sessions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_query    TEXT         NOT NULL,
  router_output JSONB,                                          -- { agents_to_call: [], reasoning: "" }
  status        TEXT         NOT NULL DEFAULT 'pending',        -- pending | running | completed | failed
  final_answer  TEXT,
  total_sources JSONB        DEFAULT '[]',
  error         TEXT,
  created_at    TEXT         NOT NULL,
  completed_at  TEXT
);

-- 3. KM specialist outputs (one row per agent per session)
CREATE TABLE IF NOT EXISTS km_outputs (
  id           SERIAL       PRIMARY KEY,
  session_id   UUID         NOT NULL REFERENCES km_sessions(id) ON DELETE CASCADE,
  agent_name   TEXT         NOT NULL,
  answer       TEXT,
  sources      JSONB        DEFAULT '[]',
  confidence   TEXT,                                            -- high | medium | low
  raw_response TEXT,
  created_at   TEXT         NOT NULL
);

CREATE INDEX IF NOT EXISTS km_outputs_session_idx ON km_outputs(session_id);

-- 4. Insert 16 KM agents (skip if already present by name)
INSERT INTO agents (name, mission, status, agent_type, knowledge_base_path, created_at, updated_at)
SELECT name, mission, 'active', agent_type, knowledge_base_path, NOW()::TEXT, NOW()::TEXT
FROM (VALUES
  ('diagnostic-agent',       'Diagnostic & Due Diligence specialist. Methodology, frameworks, commercial DD, and past project references.', 'km_specialist', '01. By topic/01. Diagnostic & DD/'),
  ('strategy-gtm-agent',     'Strategy & GTM specialist. Strategic planning, marketing, distributor management, and past projects.',         'km_specialist', '01. By topic/02. Strategy & Marketing/'),
  ('sfe-agent',              'Sales Force Effectiveness specialist. SFE diagnostic, account planning, forecasting, CRM, coaching, KPIs.',   'km_specialist', '01. By topic/03. SFE & Sales Effectiveness/'),
  ('hunting-capdb-agent',    'CAPDB & Hunting specialist. Account plans, segmentation, cross-sell, calibration workshops.',                  'km_specialist', '01. By topic/04. CAPDB & Hunting/'),
  ('pricing-agent',          'Pricing specialist. Pricing strategy, GTN, distribution, diagnostics, tenders, past projects.',               'km_specialist', '01. By topic/05. Pricing/'),
  ('incentives-agent',       'Incentives & OKR specialist. Incentive plan design, OKR frameworks, performance mechanics.',                  'km_specialist', '01. By topic/06. Incentives/'),
  ('org-governance-agent',   'Organization & Governance specialist. Org design, RACI, job descriptions, assessment, coaching, comms.',      'km_specialist', '01. By topic/07. Organization & Governance/'),
  ('transformation-agent',   'Transformation & Change specialist. Change management, PMI, transformation methodology.',                     'km_specialist', '01. By topic/08. Transformation & Change/'),
  ('digital-ai-agent',       'Digital & AI specialist. AI strategy, digital strategy, advanced analytics, multichannel, past projects.',    'km_specialist', '01. By topic/09. AI Digital Analytics/'),
  ('war-room-agent',         'War Room specialist. War room methodology, execution discipline, past project references.',                    'km_specialist', '01. By topic/10. War rooms/'),
  ('operations-agent',       'Operations specialist. Operational processes and operational excellence frameworks.',                          'km_specialist', '01. By topic/11. Operations/'),
  ('pmo-agent',              'PMO & Action Plans specialist. PMO templates, action plans, email templates, project management.',            'km_specialist', '01. By topic/12. PMO & Action plans/'),
  ('project-closeout-agent', 'Project Closeout specialist. Closeout methodology, end-of-project action plans, lessons learned.',           'km_specialist', '01. By topic/13. Project closeout/'),
  ('comex-playbooks-agent',  'COMEX Playbooks specialist. General playbooks and engagement-specific playbooks (Sandoz, Syngenta, PIF).',   'km_specialist', '01. By topic/14. Comex playbooks/'),
  ('misc-agent',             'Miscellaneous KM specialist. Catch-all for topics not covered by dedicated specialist agents.',              'km_specialist', '01. By topic/15. Misc/'),
  ('km-router-agent',        'KM Router. Receives any user question and routes to the 1-3 most relevant KM specialist agents.',           'km_router',     NULL)
) AS t(name, mission, agent_type, knowledge_base_path)
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE agents.name = t.name);
