/**
 * HubSpot API Adapter
 */
import axios from 'axios';

const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 800;
const MAX_PAGES = 20;

const HS_OBJECTS = {
  'contacts': 'contacts',
  'companies': 'companies',
  'deals': 'deals'
};

const SUPPORTED_OBJECTS = new Set(Object.keys(HS_OBJECTS));

const HS_PROPERTIES = {
  'contacts': 'firstname,lastname,email,phone,jobtitle,company,lifecyclestage',
  'companies': 'name,domain,industry,phone,website',
  'deals': 'dealname,amount,dealstage,closedate,pipeline'
};

export async function fetchData(objectType, credentials) {
  const hsObject = HS_OBJECTS[objectType];
  if (!SUPPORTED_OBJECTS.has(objectType) || !hsObject) {
    throw createIntegrationError(`Unsupported HubSpot object type: ${objectType}`, { status: 400, retryable: false });
  }

  const accessToken = credentials?.access_token || credentials?.accessToken;
  const properties = HS_PROPERTIES[hsObject] || '';

  // Demo mode: allows proving connect->sync UX without external API dependency.
  // Enable by setting HUBSPOT_DEMO_SYNC=true and using token value: demo or demo_*
  const demoEnabled = String(process.env.HUBSPOT_DEMO_SYNC || '').toLowerCase() === 'true';
  const demoToken = typeof accessToken === 'string' && (accessToken === 'demo' || accessToken.startsWith('demo_'));
  if (demoEnabled && demoToken) {
    return getDemoRecords(objectType);
  }
  
  if (!accessToken) {
    throw createIntegrationError('Missing HubSpot access_token', { status: 401, retryable: false });
  }

  const searchUrl = `${HUBSPOT_API_BASE}/crm/v3/objects/${hsObject}/search`;
  
  try {
    let token = accessToken;
    let allResults = [];
    let after = undefined;
    let page = 0;

    while (page < MAX_PAGES) {
      page += 1;
      const body = {
        limit: 100,
        properties: properties.split(',').filter(Boolean),
        ...(after ? { after } : {})
      };

      const response = await withRetry(async () => {
        try {
          return await axios.post(searchUrl, body, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            timeout: REQUEST_TIMEOUT_MS,
          });
        } catch (error) {
          const status = error?.response?.status;

          // Attempt single refresh on invalid token
          if (status === 401) {
            const refreshed = await refreshAccessToken(credentials);
            if (refreshed) {
              token = refreshed;
              return axios.post(searchUrl, body, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                timeout: REQUEST_TIMEOUT_MS,
              });
            }
          }

          throw error;
        }
      });

      const results = response?.data?.results || [];
      allResults = allResults.concat(results);

      const nextAfter = response?.data?.paging?.next?.after;
      if (!nextAfter) break;
      after = nextAfter;
    }

    // mutate credentials so caller can persist refreshed token
    if (token && token !== accessToken) {
      credentials.access_token = token;
    }

    return allResults.map(record => {
      const mappedRecord = { id: record.id, properties: {} };
      if (record.properties) {
        for (const [k, v] of Object.entries(record.properties)) {
          mappedRecord.properties[k] = { value: v };
        }
      }
      return mappedRecord;
    });

  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error.message;
    console.error('HubSpot API Error:', details);

    const message = `Failed to fetch ${objectType} from HubSpot: ${error.message}`;
    throw createIntegrationError(message, {
      status,
      retryable: isRetryableStatus(status) || error?.code === 'ECONNABORTED' || /timeout|fetch failed/i.test(String(error?.message || '')),
      details,
    });
  }
}

function getDemoRecords(objectType) {
  const now = new Date().toISOString();

  if (objectType === 'contacts') {
    return [
      {
        id: 'demo-hs-contact-1',
        properties: {
          firstname: { value: 'Ava' },
          lastname: { value: 'Sharma' },
          email: { value: 'ava.demo@acme.com' },
          phone: { value: '+14155550101' },
          jobtitle: { value: 'Sales Manager' },
          company: { value: 'Acme Inc' },
          lifecyclestage: { value: 'lead' },
          synced_at: { value: now },
        }
      },
      {
        id: 'demo-hs-contact-2',
        properties: {
          firstname: { value: 'Noah' },
          lastname: { value: 'Patel' },
          email: { value: 'noah.demo@acme.com' },
          phone: { value: '+14155550102' },
          jobtitle: { value: 'RevOps Analyst' },
          company: { value: 'Acme Inc' },
          lifecyclestage: { value: 'opportunity' },
          synced_at: { value: now },
        }
      },
    ];
  }

  if (objectType === 'companies') {
    return [
      {
        id: 'demo-hs-company-1',
        properties: {
          name: { value: 'Acme Inc' },
          domain: { value: 'acme.com' },
          industry: { value: 'Software' },
          phone: { value: '+14155550100' },
          website: { value: 'https://acme.com' },
          synced_at: { value: now },
        }
      }
    ];
  }

  if (objectType === 'deals') {
    return [
      {
        id: 'demo-hs-deal-1',
        properties: {
          dealname: { value: 'Acme Expansion 2026' },
          amount: { value: '25000' },
          dealstage: { value: 'proposal' },
          closedate: { value: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
          pipeline: { value: 'default' },
          synced_at: { value: now },
        }
      }
    ];
  }

  return [];
}

async function refreshAccessToken(credentials) {
  const refreshToken = credentials?.refresh_token || credentials?.refreshToken;
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) return null;

  const payload = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  }).toString();

  const response = await axios.post(`${HUBSPOT_API_BASE}/oauth/v1/token`, payload, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: REQUEST_TIMEOUT_MS,
  });

  const newAccessToken = response?.data?.access_token;
  if (!newAccessToken) return null;
  return newAccessToken;
}

function isRetryableStatus(status) {
  if (!status) return true;
  return status === 429 || status >= 500;
}

async function withRetry(fn) {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      const status = error?.response?.status;
      const retryable = isRetryableStatus(status) || error?.code === 'ECONNABORTED';
      if (!retryable || attempt >= MAX_RETRIES) throw error;

      const retryAfterHeader = Number(error?.response?.headers?.['retry-after'] || 0);
      const retryDelay = retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 300);
      await sleep(retryDelay);
    }
  }
}

function createIntegrationError(message, meta = {}) {
  const err = new Error(message);
  err.status = meta.status;
  err.retryable = Boolean(meta.retryable);
  err.details = meta.details;
  return err;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getExternalId(record) {
  return record.id || record.vid || record.companyId || record.dealId;
}
