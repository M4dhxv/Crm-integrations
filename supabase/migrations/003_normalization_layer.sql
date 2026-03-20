-- ============================================
-- CRM Integration Platform — Normalization Layer
-- Adds field mapping, quality scoring, and 
-- platform-wise analytics infrastructure
-- ============================================

-- ============================================
-- 1. FIELD MAPPING REGISTRY
-- Maps raw CRM-specific fields → unified schema
-- ============================================
CREATE TABLE field_mapping_registry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL REFERENCES connector_registry(provider),
  source_object     TEXT NOT NULL,        -- e.g. 'Contact', 'Lead', 'Person'
  target_table      TEXT NOT NULL,        -- e.g. 'crm_contacts', 'crm_companies'
  source_field      TEXT NOT NULL,        -- e.g. 'FirstName', 'firstname', 'first_name'
  target_field      TEXT NOT NULL,        -- unified field, e.g. 'first_name'
  transform_type    TEXT NOT NULL DEFAULT 'direct'
                    CHECK (transform_type IN (
                      'direct',           -- 1:1 copy
                      'lowercase',        -- lowercase string
                      'titlecase',        -- Title Case string
                      'phone_e164',       -- standardize to E.164
                      'email_normalize',  -- lowercase + trim
                      'date_iso',         -- parse to ISO 8601
                      'currency_iso',     -- normalize currency code
                      'json_extract',     -- extract from nested JSON
                      'concat',           -- concatenate multiple fields
                      'custom'            -- custom function reference
                    )),
  transform_config  JSONB DEFAULT '{}',   -- extra params for transform (e.g. json path, concat separator)
  is_required       BOOLEAN NOT NULL DEFAULT false,
  default_value     TEXT,
  priority          INT NOT NULL DEFAULT 0,  -- for ordering when multiple sources map to same target
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(provider, source_object, source_field, target_field)
);

CREATE INDEX idx_fmr_provider ON field_mapping_registry(provider);
CREATE INDEX idx_fmr_target ON field_mapping_registry(target_table, target_field);

-- Seed Salesforce contact mappings
INSERT INTO field_mapping_registry (provider, source_object, target_table, source_field, target_field, transform_type, is_required) VALUES
  ('salesforce', 'Contact', 'crm_contacts', 'Id',          'external_id',    'direct',          true),
  ('salesforce', 'Contact', 'crm_contacts', 'FirstName',   'first_name',     'titlecase',       false),
  ('salesforce', 'Contact', 'crm_contacts', 'LastName',    'last_name',      'titlecase',       true),
  ('salesforce', 'Contact', 'crm_contacts', 'Email',       'email',          'email_normalize', false),
  ('salesforce', 'Contact', 'crm_contacts', 'Phone',       'phone',          'phone_e164',      false),
  ('salesforce', 'Contact', 'crm_contacts', 'MobilePhone', 'mobile_phone',   'phone_e164',      false),
  ('salesforce', 'Contact', 'crm_contacts', 'Title',       'title',          'direct',          false),
  ('salesforce', 'Contact', 'crm_contacts', 'Department',  'department',     'direct',          false),
  ('salesforce', 'Contact', 'crm_contacts', 'LeadSource',  'lead_source',    'direct',          false),
  ('salesforce', 'Account', 'crm_companies', 'Id',         'external_id',    'direct',          true),
  ('salesforce', 'Account', 'crm_companies', 'Name',       'name',           'direct',          true),
  ('salesforce', 'Account', 'crm_companies', 'Website',    'website',        'lowercase',       false),
  ('salesforce', 'Account', 'crm_companies', 'Industry',   'industry',       'direct',          false),
  ('salesforce', 'Account', 'crm_companies', 'Phone',      'phone',          'phone_e164',      false),
  ('salesforce', 'Account', 'crm_companies', 'NumberOfEmployees', 'employee_count', 'direct',    false),
  ('salesforce', 'Account', 'crm_companies', 'AnnualRevenue',    'annual_revenue', 'direct',     false),
  ('salesforce', 'Opportunity', 'crm_deals', 'Id',         'external_id',    'direct',          true),
  ('salesforce', 'Opportunity', 'crm_deals', 'Name',       'name',           'direct',          true),
  ('salesforce', 'Opportunity', 'crm_deals', 'Amount',     'amount',         'direct',          false),
  ('salesforce', 'Opportunity', 'crm_deals', 'StageName',  'stage',          'direct',          false),
  ('salesforce', 'Opportunity', 'crm_deals', 'CloseDate',  'close_date',     'date_iso',        false),
  ('salesforce', 'Opportunity', 'crm_deals', 'Probability','probability',    'direct',          false);

-- Seed HubSpot contact mappings
INSERT INTO field_mapping_registry (provider, source_object, target_table, source_field, target_field, transform_type, is_required) VALUES
  ('hubspot', 'contacts', 'crm_contacts', 'vid',                          'external_id',    'direct',          true),
  ('hubspot', 'contacts', 'crm_contacts', 'properties.firstname.value',   'first_name',     'titlecase',       false),
  ('hubspot', 'contacts', 'crm_contacts', 'properties.lastname.value',    'last_name',      'titlecase',       true),
  ('hubspot', 'contacts', 'crm_contacts', 'properties.email.value',       'email',          'email_normalize', false),
  ('hubspot', 'contacts', 'crm_contacts', 'properties.phone.value',       'phone',          'phone_e164',      false),
  ('hubspot', 'contacts', 'crm_contacts', 'properties.jobtitle.value',    'title',          'direct',          false),
  ('hubspot', 'contacts', 'crm_contacts', 'properties.company.value',     'company_name',   'direct',          false),
  ('hubspot', 'contacts', 'crm_contacts', 'properties.lifecyclestage.value', 'lifecycle_stage', 'lowercase',   false),
  ('hubspot', 'companies', 'crm_companies', 'companyId',                   'external_id',    'direct',         true),
  ('hubspot', 'companies', 'crm_companies', 'properties.name.value',       'name',           'direct',         true),
  ('hubspot', 'companies', 'crm_companies', 'properties.domain.value',     'domain',         'lowercase',      false),
  ('hubspot', 'companies', 'crm_companies', 'properties.industry.value',   'industry',       'direct',         false),
  ('hubspot', 'companies', 'crm_companies', 'properties.phone.value',      'phone',          'phone_e164',     false),
  ('hubspot', 'companies', 'crm_companies', 'properties.website.value',    'website',        'lowercase',      false),
  ('hubspot', 'deals', 'crm_deals', 'dealId',                             'external_id',    'direct',          true),
  ('hubspot', 'deals', 'crm_deals', 'properties.dealname.value',          'name',           'direct',          true),
  ('hubspot', 'deals', 'crm_deals', 'properties.amount.value',            'amount',         'direct',          false),
  ('hubspot', 'deals', 'crm_deals', 'properties.dealstage.value',         'stage',          'direct',          false),
  ('hubspot', 'deals', 'crm_deals', 'properties.closedate.value',         'close_date',     'date_iso',        false);

-- Seed Pipedrive mappings
INSERT INTO field_mapping_registry (provider, source_object, target_table, source_field, target_field, transform_type, is_required) VALUES
  ('pipedrive', 'persons',       'crm_contacts',  'id',            'external_id',  'direct',          true),
  ('pipedrive', 'persons',       'crm_contacts',  'first_name',    'first_name',   'titlecase',       false),
  ('pipedrive', 'persons',       'crm_contacts',  'last_name',     'last_name',    'titlecase',       true),
  ('pipedrive', 'persons',       'crm_contacts',  'email[0].value','email',        'email_normalize', false),
  ('pipedrive', 'persons',       'crm_contacts',  'phone[0].value','phone',        'phone_e164',      false),
  ('pipedrive', 'organizations', 'crm_companies', 'id',            'external_id',  'direct',          true),
  ('pipedrive', 'organizations', 'crm_companies', 'name',          'name',         'direct',          true),
  ('pipedrive', 'deals',         'crm_deals',     'id',            'external_id',  'direct',          true),
  ('pipedrive', 'deals',         'crm_deals',     'title',         'name',         'direct',          true),
  ('pipedrive', 'deals',         'crm_deals',     'value',         'amount',       'direct',          false),
  ('pipedrive', 'deals',         'crm_deals',     'stage_id',      'stage',        'direct',          false),
  ('pipedrive', 'deals',         'crm_deals',     'currency',      'currency',     'currency_iso',    false);

-- Seed Gong mappings
INSERT INTO field_mapping_registry (provider, source_object, target_table, source_field, target_field, transform_type, is_required) VALUES
  ('gong', 'calls', 'crm_call_recordings', 'id',             'external_call_id', 'direct',    true),
  ('gong', 'calls', 'crm_call_recordings', 'title',          'title',            'direct',    false),
  ('gong', 'calls', 'crm_call_recordings', 'started',        'call_date',        'date_iso',  false),
  ('gong', 'calls', 'crm_call_recordings', 'duration',       'duration_seconds', 'direct',    false),
  ('gong', 'calls', 'crm_call_recordings', 'direction',      'direction',        'lowercase', false),
  ('gong', 'calls', 'crm_call_recordings', 'media.url',      'recording_url',    'direct',    false),
  ('gong', 'calls', 'crm_call_recordings', 'parties',        'participants',     'direct',    false),
  ('gong', 'calls', 'crm_call_recordings', 'content.topics', 'topics',           'direct',    false);

-- Seed Outreach mappings
INSERT INTO field_mapping_registry (provider, source_object, target_table, source_field, target_field, transform_type, is_required) VALUES
  ('outreach', 'prospects', 'crm_contacts', 'id',               'external_id',  'direct',          true),
  ('outreach', 'prospects', 'crm_contacts', 'attributes.firstName', 'first_name', 'titlecase',     false),
  ('outreach', 'prospects', 'crm_contacts', 'attributes.lastName',  'last_name',  'titlecase',     true),
  ('outreach', 'prospects', 'crm_contacts', 'attributes.emails[0]', 'email',      'email_normalize', false),
  ('outreach', 'prospects', 'crm_contacts', 'attributes.title',     'title',      'direct',        false);

-- Seed Freshsales mappings
INSERT INTO field_mapping_registry (provider, source_object, target_table, source_field, target_field, transform_type, is_required) VALUES
  ('freshsales', 'contacts', 'crm_contacts',  'id',           'external_id',  'direct',          true),
  ('freshsales', 'contacts', 'crm_contacts',  'first_name',   'first_name',   'titlecase',       false),
  ('freshsales', 'contacts', 'crm_contacts',  'last_name',    'last_name',    'titlecase',       true),
  ('freshsales', 'contacts', 'crm_contacts',  'email',        'email',        'email_normalize', false),
  ('freshsales', 'contacts', 'crm_contacts',  'mobile_number','phone',        'phone_e164',      false),
  ('freshsales', 'contacts', 'crm_contacts',  'job_title',    'title',        'direct',          false),
  ('freshsales', 'accounts', 'crm_companies', 'id',           'external_id',  'direct',          true),
  ('freshsales', 'accounts', 'crm_companies', 'name',         'name',         'direct',          true),
  ('freshsales', 'accounts', 'crm_companies', 'website',      'website',      'lowercase',       false),
  ('freshsales', 'deals',    'crm_deals',     'id',           'external_id',  'direct',          true),
  ('freshsales', 'deals',    'crm_deals',     'name',         'name',         'direct',          true),
  ('freshsales', 'deals',    'crm_deals',     'amount',       'amount',       'direct',          false),
  ('freshsales', 'deals',    'crm_deals',     'deal_stage_id','stage',        'direct',          false);


-- ============================================
-- 2. NORMALIZATION RULES
-- Configurable transformation rules per object
-- ============================================
CREATE TABLE normalization_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name        TEXT NOT NULL UNIQUE,
  description      TEXT,
  target_table     TEXT NOT NULL,        -- which CRM table this applies to
  target_field     TEXT NOT NULL,        -- which field to validate/transform
  rule_type        TEXT NOT NULL CHECK (rule_type IN (
    'format_validation',   -- regex / pattern check
    'required_check',      -- field must be non-null
    'deduplication',       -- cross-record uniqueness
    'range_check',         -- numeric / date range
    'enum_check',          -- allowed values list
    'standardization'      -- apply transform function
  )),
  rule_config      JSONB NOT NULL DEFAULT '{}',
  severity         TEXT NOT NULL DEFAULT 'warning'
                   CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed standard normalization rules
INSERT INTO normalization_rules (rule_name, description, target_table, target_field, rule_type, rule_config, severity) VALUES
  ('email_format',        'Email must match RFC-5322 pattern',          'crm_contacts',   'email',       'format_validation', '{"pattern": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"}', 'error'),
  ('email_required',      'Contact should have an email',              'crm_contacts',   'email',       'required_check',    '{}', 'warning'),
  ('phone_format',        'Phone should be E.164 format',             'crm_contacts',   'phone',       'format_validation', '{"pattern": "^\\+[1-9]\\d{1,14}$"}', 'warning'),
  ('last_name_required',  'Contact must have a last name',            'crm_contacts',   'last_name',   'required_check',    '{}', 'error'),
  ('deal_amount_range',   'Deal amount must be positive',             'crm_deals',      'amount',      'range_check',       '{"min": 0}', 'warning'),
  ('deal_stage_enum',     'Deal stage must be a recognized value',    'crm_deals',      'stage',       'enum_check',        '{"values": ["prospecting","qualification","proposal","negotiation","closed_won","closed_lost"]}', 'info'),
  ('company_name_req',    'Company must have a name',                 'crm_companies',  'name',        'required_check',    '{}', 'error'),
  ('email_dedup',         'Emails should be unique across contacts',  'crm_contacts',   'email',       'deduplication',     '{}', 'warning'),
  ('company_domain_std',  'Domain should be lowercase no protocol',   'crm_companies',  'domain',      'standardization',   '{"transform": "strip_protocol_lowercase"}', 'info');


-- ============================================
-- 3. DATA QUALITY SCORES
-- Per-record quality assessment
-- ============================================
CREATE TABLE data_quality_scores (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id),
  provider         TEXT NOT NULL,
  target_table     TEXT NOT NULL,
  record_id        UUID NOT NULL,           -- FK to the CRM record
  overall_score    NUMERIC NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  field_scores     JSONB NOT NULL DEFAULT '{}',  -- { "email": 100, "phone": 0, "first_name": 100, ... }
  issues           JSONB NOT NULL DEFAULT '[]',  -- [{ "field": "phone", "rule": "phone_format", "severity": "warning", "message": "..." }]
  issue_count      INT NOT NULL DEFAULT 0,
  scored_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(connection_id, target_table, record_id)
);

CREATE INDEX idx_dqs_connection ON data_quality_scores(connection_id);
CREATE INDEX idx_dqs_score ON data_quality_scores(overall_score);

ALTER TABLE data_quality_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their quality scores"
  ON data_quality_scores FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================
-- 4. NORMALIZATION RUNS (pipeline execution log)
-- ============================================
CREATE TABLE normalization_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES data_source_connections(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  provider          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  records_processed INT NOT NULL DEFAULT 0,
  records_normalized INT NOT NULL DEFAULT 0,
  records_errored   INT NOT NULL DEFAULT 0,
  avg_quality_score NUMERIC,
  field_coverage    JSONB DEFAULT '{}',     -- { "email": 0.92, "phone": 0.78, ... }
  error_summary     JSONB DEFAULT '[]',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nr_connection ON normalization_runs(connection_id);
CREATE INDEX idx_nr_status ON normalization_runs(status);

ALTER TABLE normalization_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their normalization runs"
  ON normalization_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================
-- 5. PLATFORM ANALYTICS VIEW
-- Aggregated normalization metrics per provider
-- ============================================
CREATE OR REPLACE VIEW platform_analytics AS
SELECT
  dsc.provider,
  cr.display_name AS provider_name,
  COUNT(DISTINCT dsc.id) AS connection_count,

  -- Record counts by entity
  (SELECT COUNT(*) FROM crm_contacts c WHERE c.connection_id = dsc.id AND NOT c.is_deleted) AS contact_count,
  (SELECT COUNT(*) FROM crm_companies co WHERE co.connection_id = dsc.id AND NOT co.is_deleted) AS company_count,
  (SELECT COUNT(*) FROM crm_deals d WHERE d.connection_id = dsc.id AND NOT d.is_deleted) AS deal_count,
  (SELECT COUNT(*) FROM crm_activities a WHERE a.connection_id = dsc.id AND NOT a.is_deleted) AS activity_count,

  -- Quality metrics
  (SELECT COALESCE(AVG(dqs.overall_score), 0) FROM data_quality_scores dqs WHERE dqs.connection_id = dsc.id) AS avg_quality_score,
  (SELECT COUNT(*) FROM data_quality_scores dqs WHERE dqs.connection_id = dsc.id AND dqs.overall_score >= 80) AS high_quality_count,
  (SELECT COUNT(*) FROM data_quality_scores dqs WHERE dqs.connection_id = dsc.id AND dqs.overall_score < 50) AS low_quality_count,
  (SELECT COUNT(*) FROM data_quality_scores dqs WHERE dqs.connection_id = dsc.id) AS scored_count,

  -- Field coverage from last normalization run
  (SELECT nr.field_coverage FROM normalization_runs nr WHERE nr.connection_id = dsc.id ORDER BY nr.completed_at DESC NULLS LAST LIMIT 1) AS field_coverage,

  -- Normalization stats
  (SELECT COUNT(*) FROM normalization_runs nr WHERE nr.connection_id = dsc.id AND nr.status = 'completed') AS successful_runs,
  (SELECT COUNT(*) FROM normalization_runs nr WHERE nr.connection_id = dsc.id AND nr.status = 'failed') AS failed_runs,
  (SELECT MAX(nr.completed_at) FROM normalization_runs nr WHERE nr.connection_id = dsc.id AND nr.status = 'completed') AS last_normalization,

  -- Transform errors
  (SELECT COUNT(*) FROM transform_errors te WHERE te.connection_id = dsc.id AND NOT te.resolved) AS unresolved_errors

FROM data_source_connections dsc
JOIN connector_registry cr ON cr.provider = dsc.provider
WHERE dsc.user_id = auth.uid()
GROUP BY dsc.provider, cr.display_name, dsc.id;


-- ============================================
-- 6. TRIGGERS
-- ============================================
CREATE TRIGGER trg_fmr_updated BEFORE UPDATE ON field_mapping_registry
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
