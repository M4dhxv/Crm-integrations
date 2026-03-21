/**
 * Field Maps — Per-platform field mapping definitions
 * Maps raw CRM API field paths to the unified CRM schema
 */

// ---- SALESFORCE ----
export const SALESFORCE_MAPS = {
  contacts: {
    sourceObject: 'Contact',
    targetTable: 'crm_contacts',
    fields: {
      Id:              { target: 'external_id',   transform: 'direct',          required: true },
      FirstName:       { target: 'first_name',    transform: 'titlecase' },
      LastName:        { target: 'last_name',     transform: 'titlecase',       required: true },
      Email:           { target: 'email',         transform: 'email_normalize' },
      Phone:           { target: 'phone',         transform: 'phone_e164' },
      MobilePhone:     { target: 'mobile_phone',  transform: 'phone_e164' },
      Title:           { target: 'title',         transform: 'direct' },
      Department:      { target: 'department',    transform: 'direct' },
      LeadSource:      { target: 'lead_source',   transform: 'direct' },
      AccountId:       { target: '_company_ref',  transform: 'direct' },  // resolved after mapping
      OwnerId:         { target: '_owner_ref',    transform: 'direct' },
    }
  },
  leads: {
    sourceObject: 'Lead',
    targetTable: 'crm_contacts',
    fields: {
      Id:              { target: 'external_id',   transform: 'direct',          required: true },
      FirstName:       { target: 'first_name',    transform: 'titlecase' },
      LastName:        { target: 'last_name',     transform: 'titlecase',       required: true },
      Email:           { target: 'email',         transform: 'email_normalize' },
      Phone:           { target: 'phone',         transform: 'phone_e164' },
      Company:         { target: 'company_name',  transform: 'direct' },
      Title:           { target: 'title',         transform: 'direct' },
      LeadSource:      { target: 'lead_source',   transform: 'direct' },
      Status:          { target: 'lead_status',   transform: 'lowercase' },
    }
  },
  accounts: {
    sourceObject: 'Account',
    targetTable: 'crm_companies',
    fields: {
      Id:                  { target: 'external_id',    transform: 'direct',    required: true },
      Name:                { target: 'name',           transform: 'direct',    required: true },
      Website:             { target: 'website',        transform: 'lowercase' },
      Industry:            { target: 'industry',       transform: 'direct' },
      Phone:               { target: 'phone',          transform: 'phone_e164' },
      NumberOfEmployees:   { target: 'employee_count', transform: 'direct' },
      AnnualRevenue:       { target: 'annual_revenue', transform: 'direct' },
      BillingStreet:       { target: 'address.street', transform: 'direct' },
      BillingCity:         { target: 'address.city',   transform: 'direct' },
      BillingState:        { target: 'address.state',  transform: 'direct' },
      BillingPostalCode:   { target: 'address.zip',    transform: 'direct' },
      BillingCountry:      { target: 'address.country',transform: 'direct' },
    }
  },
  opportunities: {
    sourceObject: 'Opportunity',
    targetTable: 'crm_deals',
    fields: {
      Id:           { target: 'external_id',  transform: 'direct',    required: true },
      Name:         { target: 'name',         transform: 'direct',    required: true },
      Amount:       { target: 'amount',       transform: 'direct' },
      StageName:    { target: 'stage',        transform: 'direct' },
      CloseDate:    { target: 'close_date',   transform: 'date_iso' },
      Probability:  { target: 'probability',  transform: 'direct' },
      Type:         { target: 'deal_type',    transform: 'direct' },
      LeadSource:   { target: 'lead_source',  transform: 'direct' },
      CurrencyIsoCode: { target: 'currency',  transform: 'currency_iso' },
    }
  }
};

// ---- HUBSPOT ----
export const HUBSPOT_MAPS = {
  contacts: {
    sourceObject: 'contacts',
    targetTable: 'crm_contacts',
    fields: {
      id:              { target: 'external_id',    transform: 'direct',          required: true },
      'firstname':     { target: 'first_name',     transform: 'titlecase',       path: 'properties.firstname.value' },
      'lastname':      { target: 'last_name',      transform: 'titlecase',       required: true, path: 'properties.lastname.value' },
      'email':         { target: 'email',          transform: 'email_normalize', path: 'properties.email.value' },
      'phone':         { target: 'phone',          transform: 'phone_e164',      path: 'properties.phone.value' },
      'jobtitle':      { target: 'title',          transform: 'direct',          path: 'properties.jobtitle.value' },
      'company':       { target: 'company_name',   transform: 'direct',          path: 'properties.company.value' },
      'lifecyclestage':{ target: 'lifecycle_stage', transform: 'lowercase',      path: 'properties.lifecyclestage.value' },
    }
  },
  companies: {
    sourceObject: 'companies',
    targetTable: 'crm_companies',
    fields: {
      id:         { target: 'external_id',    transform: 'direct',    required: true },
      'name':     { target: 'name',           transform: 'direct',    required: true, path: 'properties.name.value' },
      'domain':   { target: 'domain',         transform: 'lowercase', path: 'properties.domain.value' },
      'industry': { target: 'industry',       transform: 'direct',    path: 'properties.industry.value' },
      'phone':    { target: 'phone',          transform: 'phone_e164', path: 'properties.phone.value' },
      'website':  { target: 'website',        transform: 'lowercase', path: 'properties.website.value' },
    }
  },
  deals: {
    sourceObject: 'deals',
    targetTable: 'crm_deals',
    fields: {
      id:           { target: 'external_id', transform: 'direct',   required: true },
      'dealname':   { target: 'name',        transform: 'direct',   required: true, path: 'properties.dealname.value' },
      'amount':     { target: 'amount',      transform: 'direct',   path: 'properties.amount.value' },
      'dealstage':  { target: 'stage',       transform: 'direct',   path: 'properties.dealstage.value' },
      'closedate':  { target: 'close_date',  transform: 'date_iso', path: 'properties.closedate.value' },
      'pipeline':   { target: 'pipeline',    transform: 'direct',   path: 'properties.pipeline.value' },
    }
  }
};

// ---- PIPEDRIVE ----
export const PIPEDRIVE_MAPS = {
  persons: {
    sourceObject: 'persons',
    targetTable: 'crm_contacts',
    fields: {
      id:          { target: 'external_id',  transform: 'direct',          required: true },
      first_name:  { target: 'first_name',   transform: 'titlecase' },
      last_name:   { target: 'last_name',    transform: 'titlecase',       required: true },
      'email':     { target: 'email',        transform: 'email_normalize', path: 'email[0].value' },
      'phone':     { target: 'phone',        transform: 'phone_e164',      path: 'phone[0].value' },
      org_id:      { target: '_company_ref', transform: 'direct' },
    }
  },
  organizations: {
    sourceObject: 'organizations',
    targetTable: 'crm_companies',
    fields: {
      id:      { target: 'external_id', transform: 'direct', required: true },
      name:    { target: 'name',        transform: 'direct', required: true },
      address: { target: 'address',     transform: 'direct' },
    }
  },
  deals: {
    sourceObject: 'deals',
    targetTable: 'crm_deals',
    fields: {
      id:        { target: 'external_id', transform: 'direct',       required: true },
      title:     { target: 'name',        transform: 'direct',       required: true },
      value:     { target: 'amount',      transform: 'direct' },
      stage_id:  { target: 'stage',       transform: 'direct' },
      currency:  { target: 'currency',    transform: 'currency_iso' },
      status:    { target: '_status',     transform: 'direct' },
    }
  }
};

// ---- GONG ----
export const GONG_MAPS = {
  calls: {
    sourceObject: 'calls',
    targetTable: 'crm_call_recordings',
    fields: {
      id:        { target: 'external_call_id', transform: 'direct',   required: true },
      title:     { target: 'title',            transform: 'direct' },
      started:   { target: 'call_date',        transform: 'date_iso' },
      duration:  { target: 'duration_seconds',  transform: 'direct' },
      direction: { target: 'direction',        transform: 'lowercase' },
      'media':   { target: 'recording_url',    transform: 'direct',   path: 'media.url' },
      parties:   { target: 'participants',     transform: 'direct' },
      'topics':  { target: 'topics',           transform: 'direct',   path: 'content.topics' },
    }
  }
};

// ---- OUTREACH ----
export const OUTREACH_MAPS = {
  prospects: {
    sourceObject: 'prospects',
    targetTable: 'crm_contacts',
    fields: {
      id:             { target: 'external_id', transform: 'direct',          required: true },
      'firstName':    { target: 'first_name',  transform: 'titlecase',       path: 'attributes.firstName' },
      'lastName':     { target: 'last_name',   transform: 'titlecase',       required: true, path: 'attributes.lastName' },
      'emails':       { target: 'email',       transform: 'email_normalize', path: 'attributes.emails[0]' },
      'title':        { target: 'title',       transform: 'direct',          path: 'attributes.title' },
      'company':      { target: 'company_name',transform: 'direct',          path: 'attributes.company' },
    }
  }
};

// ---- FRESHSALES ----
export const FRESHSALES_MAPS = {
  contacts: {
    sourceObject: 'contacts',
    targetTable: 'crm_contacts',
    fields: {
      id:            { target: 'external_id',  transform: 'direct',          required: true },
      first_name:    { target: 'first_name',   transform: 'titlecase' },
      last_name:     { target: 'last_name',    transform: 'titlecase',       required: true },
      email:         { target: 'email',        transform: 'email_normalize' },
      mobile_number: { target: 'phone',        transform: 'phone_e164' },
      job_title:     { target: 'title',        transform: 'direct' },
      department:    { target: 'department',   transform: 'direct' },
    }
  },
  accounts: {
    sourceObject: 'accounts',
    targetTable: 'crm_companies',
    fields: {
      id:       { target: 'external_id', transform: 'direct', required: true },
      name:     { target: 'name',        transform: 'direct', required: true },
      website:  { target: 'website',     transform: 'lowercase' },
      industry: { target: 'industry',    transform: 'direct' },
    }
  },
  deals: {
    sourceObject: 'deals',
    targetTable: 'crm_deals',
    fields: {
      id:            { target: 'external_id', transform: 'direct', required: true },
      name:          { target: 'name',        transform: 'direct', required: true },
      amount:        { target: 'amount',      transform: 'direct' },
      deal_stage_id: { target: 'stage',       transform: 'direct' },
    }
  }
};


// ---- PROVIDER REGISTRY ----
export const PROVIDER_MAPS = {
  salesforce: SALESFORCE_MAPS,
  hubspot:    HUBSPOT_MAPS,
  pipedrive:  PIPEDRIVE_MAPS,
  gong:       GONG_MAPS,
  outreach:   OUTREACH_MAPS,
  freshsales: FRESHSALES_MAPS,
};

/**
 * Get field map for a specific provider + object
 */
export function getFieldMap(provider, objectType) {
  const providerMaps = PROVIDER_MAPS[provider];
  if (!providerMaps) return null;
  return providerMaps[objectType] || null;
}

/**
 * Get all supported objects for a provider
 */
export function getSupportedObjects(provider) {
  const providerMaps = PROVIDER_MAPS[provider];
  if (!providerMaps) return [];
  return Object.keys(providerMaps);
}

/**
 * Get all field maps for a provider (useful for coverage analysis)
 */
export function getAllFieldMaps(provider) {
  return PROVIDER_MAPS[provider] || {};
}
