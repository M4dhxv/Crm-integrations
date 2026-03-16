-- ============================================
-- CRM Integration Platform — Database Schema
-- Supabase / PostgreSQL
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 1. CONNECTOR REGISTRY (provider metadata)
-- ============================================
CREATE TABLE connector_registry (
  provider          TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  auth_type         TEXT NOT NULL CHECK (auth_type IN ('oauth2', 'api_key', 'basic')),
  supported_objects TEXT[] NOT NULL DEFAULT '{}',
  icon_url          TEXT,
  base_url          TEXT,
  auth_config_schema JSONB,             -- JSON Schema for provider-specific auth fields
  is_enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default providers
INSERT INTO connector_registry (provider, display_name, auth_type, supported_objects, base_url) VALUES
  ('salesforce',  'Salesforce',  'oauth2',  ARRAY['contacts','leads','accounts','opportunities','tasks','events'],  'https://login.salesforce.com'),
  ('hubspot',     'HubSpot',     'oauth2',  ARRAY['contacts','companies','deals','engagements','tasks'],            'https://api.hubapi.com'),
  ('gong',        'Gong',        'api_key', ARRAY['calls','transcripts','users','scorecards'],                       'https://api.gong.io'),
  ('pipedrive',   'Pipedrive',   'api_key', ARRAY['persons','organizations','deals','activities','leads'],           'https://api.pipedrive.com'),
  ('outreach',    'Outreach',    'oauth2',  ARRAY['prospects','accounts','sequences','mailings'],                    'https://api.outreach.io'),
  ('freshsales',  'Freshsales',  'api_key', ARRAY['contacts','accounts','deals','tasks','appointments'],             NULL);


-- ============================================
-- 2. DATA SOURCE CONNECTIONS
-- ============================================
CREATE TABLE data_source_connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id               UUID,
  provider             TEXT NOT NULL REFERENCES connector_registry(provider),
  display_name         TEXT,                           -- User-friendly label
  auth_type            TEXT NOT NULL CHECK (auth_type IN ('oauth2', 'api_key', 'basic')),
  credentials          JSONB NOT NULL DEFAULT '{}',    -- Encrypted or vault reference
  instance_url         TEXT,                           -- e.g. https://myorg.salesforce.com
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'connected', 'error', 'disconnected', 'expired')),
  sync_frequency       TEXT NOT NULL DEFAULT 'hourly'
                       CHECK (sync_frequency IN ('realtime', 'every_15m', 'hourly', 'daily', 'manual')),
  -- Rate limit tracking
  rate_limit_remaining INT,
  rate_limit_reset_at  TIMESTAMPTZ,
  -- Timestamps
  last_connected_at    TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dsc_user ON data_source_connections(user_id);
CREATE INDEX idx_dsc_provider ON data_source_connections(provider);

-- RLS
ALTER TABLE data_source_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own connections"
  ON data_source_connections FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================
-- 3. CONNECTOR OBJECTS (per-object sync config + cursor state)
-- ============================================
CREATE TABLE connector_objects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  object_type     TEXT NOT NULL,
  sync_enabled    BOOLEAN NOT NULL DEFAULT true,
  sync_mode       TEXT NOT NULL DEFAULT 'incremental'
                  CHECK (sync_mode IN ('incremental', 'full_resync')),
  -- Cursor state
  cursor_field    TEXT,
  cursor_value    TEXT,
  page_token      TEXT,
  last_synced_at  TIMESTAMPTZ,
  records_synced  BIGINT NOT NULL DEFAULT 0,
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(connection_id, object_type)
);

CREATE INDEX idx_co_connection ON connector_objects(connection_id);

ALTER TABLE connector_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their connector objects"
  ON connector_objects FOR ALL
  USING (
    connection_id IN (
      SELECT id FROM data_source_connections WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    connection_id IN (
      SELECT id FROM data_source_connections WHERE user_id = auth.uid()
    )
  );


-- ============================================
-- 4. SYNC JOBS (job queue)
-- ============================================
CREATE TABLE sync_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  object_type       TEXT NOT NULL,
  job_type          TEXT NOT NULL CHECK (job_type IN ('incremental', 'full_resync', 'backfill')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  priority          INT NOT NULL DEFAULT 0,
  attempts          INT NOT NULL DEFAULT 0,
  max_attempts      INT NOT NULL DEFAULT 3,
  records_fetched   INT DEFAULT 0,
  records_upserted  INT DEFAULT 0,
  scheduled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  error             TEXT,
  error_details     JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate running/pending jobs for same connection+object
CREATE UNIQUE INDEX idx_sj_active_unique
  ON sync_jobs(connection_id, object_type)
  WHERE status IN ('pending', 'running');

CREATE INDEX idx_sj_status ON sync_jobs(status, scheduled_at);
CREATE INDEX idx_sj_connection ON sync_jobs(connection_id);

ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their sync jobs"
  ON sync_jobs FOR ALL
  USING (
    connection_id IN (
      SELECT id FROM data_source_connections WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    connection_id IN (
      SELECT id FROM data_source_connections WHERE user_id = auth.uid()
    )
  );


-- ============================================
-- 5. SYNC LOGS (audit trail)
-- ============================================
CREATE TABLE sync_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  job_id          UUID REFERENCES sync_jobs(id),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  org_id          UUID,
  sync_type       TEXT NOT NULL CHECK (sync_type IN ('incremental', 'full_resync', 'backfill')),
  status          TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  records_synced  INT DEFAULT 0,
  errors          JSONB DEFAULT '[]',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sl_connection ON sync_logs(connection_id);
CREATE INDEX idx_sl_user ON sync_logs(user_id);

ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their sync logs"
  ON sync_logs FOR SELECT
  USING (auth.uid() = user_id);


-- ============================================
-- 6. RAW INGESTION LAYER
-- ============================================
CREATE SCHEMA IF NOT EXISTS raw;

CREATE TABLE raw.source_objects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES public.data_source_connections(id),
  provider          TEXT NOT NULL,
  object_type       TEXT NOT NULL,
  external_id       TEXT NOT NULL,
  payload           JSONB NOT NULL,
  operation         TEXT NOT NULL DEFAULT 'upsert'
                    CHECK (operation IN ('insert', 'update', 'delete', 'upsert')),
  cursor_value      TEXT,
  source_updated_at TIMESTAMPTZ,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  batch_id          UUID,
  checksum          TEXT                    -- SHA256 of payload for change detection
);

-- Immutable: append-only table (no UPDATE/DELETE in RLS)
CREATE INDEX idx_rso_lookup ON raw.source_objects(connection_id, object_type, external_id);
CREATE INDEX idx_rso_received ON raw.source_objects(received_at);
CREATE INDEX idx_rso_batch ON raw.source_objects(batch_id) WHERE batch_id IS NOT NULL;


-- ============================================
-- 7. TRANSFORM ERRORS (dead letter queue)
-- ============================================
CREATE TABLE transform_errors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_object_id  UUID REFERENCES raw.source_objects(id),
  connection_id     UUID NOT NULL REFERENCES data_source_connections(id),
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  provider          TEXT NOT NULL,
  object_type       TEXT NOT NULL,
  error_message     TEXT NOT NULL,
  error_detail      JSONB,
  retry_count       INT NOT NULL DEFAULT 0,
  resolved          BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_te_unresolved ON transform_errors(connection_id) WHERE resolved = false;

ALTER TABLE transform_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their transform errors"
  ON transform_errors FOR SELECT
  USING (auth.uid() = user_id);


-- ============================================
-- 8. CRM USERS (owners / reps)
-- ============================================
CREATE TABLE crm_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  org_id          UUID,
  provider        TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  email           TEXT,
  full_name       TEXT,
  role            TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  raw_data        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(connection_id, provider, external_id)
);

ALTER TABLE crm_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their CRM users"
  ON crm_users FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================
-- 9. CRM CONTACTS
-- ============================================
CREATE TABLE crm_contacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id),
  org_id           UUID,
  provider         TEXT NOT NULL,
  external_id      TEXT NOT NULL,
  first_name       TEXT,
  last_name        TEXT,
  email            TEXT,
  phone            TEXT,
  mobile_phone     TEXT,
  title            TEXT,
  department       TEXT,
  company_name     TEXT,
  lifecycle_stage  TEXT,
  lead_source      TEXT,
  lead_status      TEXT,
  owner_id         UUID REFERENCES crm_users(id),
  company_id       UUID, -- FK added after crm_companies created
  address          JSONB,
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  deleted_at       TIMESTAMPTZ,
  raw_data         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(connection_id, provider, external_id)
);

CREATE INDEX idx_cc_connection ON crm_contacts(connection_id);
CREATE INDEX idx_cc_email ON crm_contacts(email) WHERE email IS NOT NULL;
CREATE INDEX idx_cc_user ON crm_contacts(user_id);

ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their CRM contacts"
  ON crm_contacts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================
-- 10. CRM COMPANIES (Accounts / Organizations)
-- ============================================
CREATE TABLE crm_companies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id),
  org_id           UUID,
  provider         TEXT NOT NULL,
  external_id      TEXT NOT NULL,
  name             TEXT,
  domain           TEXT,
  industry         TEXT,
  employee_count   INT,
  annual_revenue   NUMERIC,
  phone            TEXT,
  website          TEXT,
  address          JSONB,
  owner_id         UUID REFERENCES crm_users(id),
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  deleted_at       TIMESTAMPTZ,
  raw_data         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(connection_id, provider, external_id)
);

CREATE INDEX idx_cco_connection ON crm_companies(connection_id);
CREATE INDEX idx_cco_domain ON crm_companies(domain) WHERE domain IS NOT NULL;

ALTER TABLE crm_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their CRM companies"
  ON crm_companies FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add FK from contacts to companies
ALTER TABLE crm_contacts
  ADD CONSTRAINT fk_contacts_company
  FOREIGN KEY (company_id) REFERENCES crm_companies(id);


-- ============================================
-- 11. CRM DEALS (Opportunities)
-- ============================================
CREATE TABLE crm_deals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id),
  org_id           UUID,
  provider         TEXT NOT NULL,
  external_id      TEXT NOT NULL,
  name             TEXT,
  amount           NUMERIC,
  currency         TEXT DEFAULT 'USD',
  stage            TEXT,
  pipeline         TEXT,
  close_date       DATE,
  probability      NUMERIC,
  deal_type        TEXT,
  lead_source      TEXT,
  owner_id         UUID REFERENCES crm_users(id),
  contact_id       UUID REFERENCES crm_contacts(id),
  company_id       UUID REFERENCES crm_companies(id),
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  deleted_at       TIMESTAMPTZ,
  raw_data         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(connection_id, provider, external_id)
);

CREATE INDEX idx_cd_connection ON crm_deals(connection_id);
CREATE INDEX idx_cd_stage ON crm_deals(stage) WHERE NOT is_deleted;

ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their CRM deals"
  ON crm_deals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================
-- 12. CRM ACTIVITIES (emails, tasks, notes, meetings)
-- ============================================
CREATE TABLE crm_activities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id),
  org_id           UUID,
  provider         TEXT NOT NULL,
  external_id      TEXT NOT NULL,
  activity_type    TEXT NOT NULL CHECK (activity_type IN ('email', 'call', 'meeting', 'task', 'note', 'other')),
  subject          TEXT,
  body             TEXT,
  due_date         TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  status           TEXT,
  priority         TEXT,
  owner_id         UUID REFERENCES crm_users(id),
  contact_id       UUID REFERENCES crm_contacts(id),
  deal_id          UUID REFERENCES crm_deals(id),
  company_id       UUID REFERENCES crm_companies(id),
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  deleted_at       TIMESTAMPTZ,
  raw_data         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(connection_id, provider, external_id)
);

CREATE INDEX idx_ca_connection ON crm_activities(connection_id);
CREATE INDEX idx_ca_type ON crm_activities(activity_type);

ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their CRM activities"
  ON crm_activities FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================
-- 13. CRM CALL RECORDINGS (Gong-specific)
-- ============================================
CREATE TABLE crm_call_recordings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  org_id            UUID,
  provider          TEXT NOT NULL,
  external_call_id  TEXT NOT NULL,
  title             TEXT,
  call_date         TIMESTAMPTZ,
  duration_seconds  INT,
  direction         TEXT CHECK (direction IN ('inbound', 'outbound', 'conference', NULL)),
  recording_url     TEXT,
  transcript        TEXT,
  participants      JSONB DEFAULT '[]',
  topics            TEXT[] DEFAULT '{}',
  action_items      JSONB DEFAULT '[]',
  key_points        JSONB DEFAULT '[]',
  sentiment_score   NUMERIC,
  talk_ratio        JSONB,               -- { "internal": 0.45, "external": 0.55 }
  owner_id          UUID REFERENCES crm_users(id),
  is_deleted        BOOLEAN NOT NULL DEFAULT false,
  deleted_at        TIMESTAMPTZ,
  raw_data          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(connection_id, provider, external_call_id)
);

CREATE INDEX idx_ccr_connection ON crm_call_recordings(connection_id);
CREATE INDEX idx_ccr_date ON crm_call_recordings(call_date);

ALTER TABLE crm_call_recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their call recordings"
  ON crm_call_recordings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================
-- VIEWS
-- ============================================

-- Connection health (derived from sync_jobs)
CREATE OR REPLACE VIEW connection_health AS
SELECT
  sj.connection_id,
  COUNT(*) FILTER (WHERE sj.status = 'completed' AND sj.completed_at > now() - interval '24 hours') AS successes_24h,
  COUNT(*) FILTER (WHERE sj.status = 'failed' AND sj.completed_at > now() - interval '24 hours') AS failures_24h,
  MAX(sj.completed_at) FILTER (WHERE sj.status = 'completed') AS last_successful_sync,
  CASE
    WHEN COUNT(*) FILTER (WHERE sj.status = 'failed' AND sj.completed_at > now() - interval '24 hours') > 3
      THEN 'critical'
    WHEN COUNT(*) FILTER (WHERE sj.status = 'failed' AND sj.completed_at > now() - interval '24 hours') > 0
      THEN 'degraded'
    WHEN MAX(sj.completed_at) FILTER (WHERE sj.status = 'completed') < now() - interval '24 hours'
      THEN 'stale'
    WHEN MAX(sj.completed_at) FILTER (WHERE sj.status = 'completed') IS NULL
      THEN 'pending'
    ELSE 'healthy'
  END AS health_status
FROM sync_jobs sj
GROUP BY sj.connection_id;

-- Dashboard stats
CREATE OR REPLACE VIEW dashboard_stats AS
SELECT
  dsc.id AS connection_id,
  dsc.provider,
  dsc.display_name,
  dsc.status,
  dsc.sync_frequency,
  dsc.created_at,
  (SELECT COUNT(*) FROM crm_contacts c WHERE c.connection_id = dsc.id AND NOT c.is_deleted) AS contact_count,
  (SELECT COUNT(*) FROM crm_companies c WHERE c.connection_id = dsc.id AND NOT c.is_deleted) AS company_count,
  (SELECT COUNT(*) FROM crm_deals d WHERE d.connection_id = dsc.id AND NOT d.is_deleted) AS deal_count,
  (SELECT COUNT(*) FROM crm_activities a WHERE a.connection_id = dsc.id AND NOT a.is_deleted) AS activity_count,
  (SELECT COUNT(*) FROM crm_call_recordings r WHERE r.connection_id = dsc.id AND NOT r.is_deleted) AS recording_count,
  (SELECT MAX(last_synced_at) FROM connector_objects co WHERE co.connection_id = dsc.id) AS last_sync_at,
  ch.health_status,
  ch.successes_24h,
  ch.failures_24h
FROM data_source_connections dsc
LEFT JOIN connection_health ch ON ch.connection_id = dsc.id
WHERE dsc.user_id = auth.uid();


-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all relevant tables
CREATE TRIGGER trg_dsc_updated BEFORE UPDATE ON data_source_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_co_updated BEFORE UPDATE ON connector_objects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cu_updated BEFORE UPDATE ON crm_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cc_updated BEFORE UPDATE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cco_updated BEFORE UPDATE ON crm_companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cd_updated BEFORE UPDATE ON crm_deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_ca_updated BEFORE UPDATE ON crm_activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_ccr_updated BEFORE UPDATE ON crm_call_recordings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
