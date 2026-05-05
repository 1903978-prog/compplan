-- ============================================================
-- KM Agent System — Rollback Migration
-- Removes all KM-specific data and tables.
-- Does NOT remove agent_type / knowledge_base_path columns
-- (PostgreSQL pre-v15 ALTER TABLE DROP COLUMN requires care;
--  the columns default safely to 'aios_classic' / NULL).
-- ============================================================

-- 1. Remove KM agent rows
DELETE FROM agents WHERE agent_type IN ('km_specialist', 'km_router');

-- 2. Drop KM tables (cascade removes km_outputs via FK)
DROP TABLE IF EXISTS km_outputs;
DROP TABLE IF EXISTS km_sessions;

-- 3. Optionally remove columns (PostgreSQL 15+):
-- ALTER TABLE agents DROP COLUMN IF EXISTS agent_type;
-- ALTER TABLE agents DROP COLUMN IF EXISTS knowledge_base_path;
