import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import crypto from 'crypto';
import { processSyncJob } from './sync/index.js';
import connectionsRouter from './routes/connections.js';
import normalizationRouter from './routes/normalization.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const BUILD_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'unknown';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const oauthStateStore = new Map();
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_KEY || 'dev-oauth-state-secret';
const DEFAULT_HUBSPOT_OAUTH_SCOPES = [
  'crm.export',
  'crm.import',
  'crm.lists.read',
  'crm.lists.write',
  'crm.objects.appointments.read',
  'crm.objects.appointments.sensitive.read',
  'crm.objects.companies.read',
  'crm.objects.contacts.read',
  'crm.objects.courses.read',
  'crm.objects.custom.read',
  'crm.objects.deals.read',
  'crm.objects.goals.read',
  'crm.objects.invoices.read',
  'crm.objects.leads.read',
  'crm.schemas.custom.read',
  'crm.schemas.deals.read',
];

// Initialize Supabase admin client (service role)
let supabaseAdmin = null;
const hasSupabaseUrl = Boolean(process.env.VITE_SUPABASE_URL);
const hasSupabaseKey = Boolean(process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY);

if (hasSupabaseUrl && hasSupabaseKey) {
  supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  );
} else {
  console.error('[Config] Missing required Supabase env vars (VITE_SUPABASE_URL and/or SUPABASE_SERVICE_KEY/VITE_SUPABASE_ANON_KEY)');
}

// ============================================
// MIDDLEWARE
// ============================================

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'ERROR' : 'INFO';
    console.log(
      `[${new Date().toISOString()}] ${level} ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

// In-memory rate limiter (per IP, 100 req/min)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 100;

app.use('/api', (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }
  
  const entry = rateLimitStore.get(ip);
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_LIMIT_WINDOW;
    return next();
  }
  
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res.set('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    });
  }
  
  next();
});

// Periodic cleanup of rate limit store
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(ip);
  }
}, 60_000);

// Periodic cleanup of OAuth state store
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of oauthStateStore) {
    if (now > entry.expiresAt) oauthStateStore.delete(token);
  }
}, 60_000);

// JWT Auth middleware for /api/* routes
async function authMiddleware(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(500).json({
      error: 'Server configuration error: Supabase is not configured',
      missing: {
        VITE_SUPABASE_URL: !process.env.VITE_SUPABASE_URL,
        SUPABASE_SERVICE_KEY_or_VITE_SUPABASE_ANON_KEY: !(process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY),
      }
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user context and a user-scoped Supabase client
    req.userId = user.id;
    req.user = user;
    req.supabaseAdmin = supabaseAdmin;
    req.supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY,
      {
        global: { headers: { Authorization: `Bearer ${token}` } }
      }
    );

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

function createOAuthState(payload) {
  const token = crypto.randomUUID();
  oauthStateStore.set(token, {
    ...payload,
    createdAt: Date.now(),
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });
  return token;
}

function createSignedState(payload) {
  const json = JSON.stringify(payload);
  const body = toBase64Url(Buffer.from(json));
  const sig = toBase64Url(crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(body).digest());
  return `${body}.${sig}`;
}

function parseSignedState(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = toBase64Url(crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(body).digest());
  if (sig !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload?.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getOAuthState(token) {
  if (!token) return null;
  const entry = oauthStateStore.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    oauthStateStore.delete(token);
    return null;
  }
  return entry;
}

function consumeOAuthState(token, expectedProvider) {
  const entry = oauthStateStore.get(token);
  if (!entry) return null;

  oauthStateStore.delete(token);

  if (Date.now() > entry.expiresAt) return null;
  if (expectedProvider && entry.provider !== expectedProvider) return null;

  return entry;
}

async function findConnectionByUserAndProvider(supabaseClient, userId, provider) {
  const { data, error } = await supabaseClient
    .from('data_source_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function upsertConnectionByUserAndProvider({
  supabaseClient,
  userId,
  provider,
  patch,
}) {
  const existing = await findConnectionByUserAndProvider(supabaseClient, userId, provider);

  if (existing) {
    const { data, error } = await supabaseClient
      .from('data_source_connections')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabaseClient
    .from('data_source_connections')
    .insert({
      user_id: userId,
      provider,
      ...patch,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function replaceConnectionObjects({
  supabaseClient,
  connectionId,
  provider,
  objects = [],
}) {
  await supabaseClient
    .from('connector_objects')
    .delete()
    .eq('connection_id', connectionId);

  if (!objects.length) return;

  const rows = objects.map((obj) => ({
    connection_id: connectionId,
    provider,
    object_type: typeof obj === 'string' ? obj : obj.id,
    sync_enabled: true,
  }));

  const { error } = await supabaseClient.from('connector_objects').insert(rows);
  if (error) throw error;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPkcePair() {
  const verifier = toBase64Url(crypto.randomBytes(64));
  const challenge = toBase64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function getBearerToken(authHeader = '') {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

function getHubSpotScopesFromEnvOrDefault() {
  const raw = String(process.env.HUBSPOT_OAUTH_SCOPES || '').trim();
  const parsed = raw
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s.toLowerCase() !== 'delete');

  if (parsed.length > 0) {
    return Array.from(new Set(parsed));
  }

  return DEFAULT_HUBSPOT_OAUTH_SCOPES;
}

async function processPendingSyncJobsOnce(supabaseClient, limit = 5) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const { data: jobs, error } = await supabaseClient
    .from('sync_jobs')
    .select('*')
    .or(`and(status.eq.pending,scheduled_at.is.null),and(status.eq.pending,scheduled_at.lte.${nowIso}),and(status.eq.running,started_at.lt.${oneHourAgo})`)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs || []) {
    processed += 1;
    const ok = await processSyncJob(job, supabaseClient);
    if (ok) succeeded += 1;
    else failed += 1;
  }

  return {
    queuedFound: (jobs || []).length,
    processed,
    succeeded,
    failed,
  };
}


// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', async (req, res) => {
  const checks = { server: 'ok', supabase: 'unknown' };

  if (!supabaseAdmin) {
    checks.supabase = 'error';
    return res.status(503).json({
      status: 'degraded',
      checks,
      config: {
        VITE_SUPABASE_URL: Boolean(process.env.VITE_SUPABASE_URL),
        SUPABASE_SERVICE_KEY_or_VITE_SUPABASE_ANON_KEY: Boolean(process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY),
      },
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  }
  
  try {
    const { error } = await supabaseAdmin.from('connector_registry').select('provider').limit(1);
    checks.supabase = error ? 'error' : 'ok';
  } catch {
    checks.supabase = 'error';
  }

  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Vercel-friendly health alias
app.get('/api/health', async (req, res) => {
  const checks = { server: 'ok', supabase: 'unknown' };

  if (!supabaseAdmin) {
    checks.supabase = 'error';
    return res.status(503).json({
      status: 'degraded',
      checks,
      config: {
        VITE_SUPABASE_URL: Boolean(process.env.VITE_SUPABASE_URL),
        SUPABASE_SERVICE_KEY_or_VITE_SUPABASE_ANON_KEY: Boolean(process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY),
      },
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  }

  try {
    const { error } = await supabaseAdmin.from('connector_registry').select('provider').limit(1);
    checks.supabase = error ? 'error' : 'ok';
  } catch {
    checks.supabase = 'error';
  }

  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    checks,
    build_commit: BUILD_COMMIT,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Debug endpoint to check env vars are loaded
app.get('/api/config-status', (req, res) => {
  const effectiveScopes = getHubSpotScopesFromEnvOrDefault();
  res.json({
    build_commit: BUILD_COMMIT,
    supabase_url: process.env.VITE_SUPABASE_URL ? '✅ loaded' : '❌ missing',
    supabase_anon_key: process.env.VITE_SUPABASE_ANON_KEY ? '✅ loaded' : '❌ missing',
    supabase_service_key: process.env.SUPABASE_SERVICE_KEY ? '✅ loaded' : '❌ missing',
    salesforce_client_id: process.env.SALESFORCE_CLIENT_ID ? '✅ loaded' : '❌ missing',
    salesforce_client_secret: process.env.SALESFORCE_CLIENT_SECRET ? '✅ loaded' : '❌ missing',
    hubspot_client_id: process.env.HUBSPOT_CLIENT_ID ? '✅ loaded' : '❌ missing',
    hubspot_client_secret: process.env.HUBSPOT_CLIENT_SECRET ? '✅ loaded' : '❌ missing',
    hubspot_oauth_scopes_env: process.env.HUBSPOT_OAUTH_SCOPES || '(unset)',
    hubspot_oauth_scopes_effective: effectiveScopes.join(' '),
    hubspot_oauth_scope_count: effectiveScopes.length,
    hubspot_pkce_mode: 'enabled',

    backend_url: process.env.BACKEND_URL || 'auto-detect',
    frontend_url: process.env.FRONTEND_URL || 'auto-detect',
  });
});

// Vercel Cron endpoint to process sync queue (stateless worker)
app.get('/api/cron/sync', async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Supabase is not configured' });
    }

    const configuredSecret = process.env.CRON_SECRET;
    const headerToken = getBearerToken(req.headers.authorization || '');
    const queryToken = typeof req.query.secret === 'string' ? req.query.secret : null;

    // If CRON_SECRET is configured, require it.
    if (configuredSecret && headerToken !== configuredSecret && queryToken !== configuredSecret) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }

    const result = await processPendingSyncJobsOnce(supabaseAdmin, 5);
    return res.json({ ok: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[Cron Sync] Failed:', err);
    return res.status(500).json({ error: err.message || 'Cron sync failed' });
  }
});


// ============================================
// API ROUTES (authenticated)
// ============================================
app.use('/api/connections', authMiddleware, connectionsRouter);
app.use('/api/normalized', authMiddleware, normalizationRouter);

// Start OAuth flow
app.post('/api/start-oauth', authMiddleware, async (req, res) => {
  const { provider, displayName, syncFrequency, objects, instanceUrl } = req.body || {};

  const redirectUrls = {
    salesforce: `/api/auth/salesforce?userId=${req.userId}`,
    hubspot: `/api/auth/hubspot?userId=${req.userId}`
  };

  if (!redirectUrls[provider]) {
    return res.status(400).json({ error: 'Provider not supported for OAuth' });
  }

  try {
    const connection = await upsertConnectionByUserAndProvider({
      supabaseClient: req.supabase,
      userId: req.userId,
      provider,
      patch: {
        display_name: displayName || provider,
        auth_type: 'oauth2',
        sync_frequency: syncFrequency || 'hourly',
        instance_url: instanceUrl || null,
        status: 'pending',
      },
    });

    const objectList = Array.isArray(objects) ? objects : [];
    if (objectList.length > 0) {
      await replaceConnectionObjects({
        supabaseClient: req.supabase,
        connectionId: connection.id,
        provider,
        objects: objectList,
      });
    }
  } catch (err) {
    console.error('Failed to initialize OAuth connection:', err);
    return res.status(400).json({ error: err.message || 'Failed to initialize OAuth connection' });
  }

  // DEMO MODE BYPASS: If no backend URL is set, we bypass real OAuth and simulate connection
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const backendUrl = process.env.BACKEND_URL || dynamicHost;
  if (!process.env.BACKEND_URL) {
    console.log(`[Demo Mode] Mocking ${provider} connection for user ${req.userId}...`);
    
    // Create a mock connection in the database
    await upsertConnectionByUserAndProvider({
      supabaseClient: req.supabase,
      userId: req.userId,
      provider,
      patch: {
        display_name: `${provider} (Demo Configuration)`,
        auth_type: 'oauth2',
        status: 'connected',
        sync_frequency: 'hourly',
        last_connected_at: new Date().toISOString(),
      }
    });

    // Mock successful redirect directly back to frontend
    const frontendUrl = process.env.FRONTEND_URL || dynamicHost;
    return res.json({ redirectUrl: `${frontendUrl}/dashboard.html?status=success&provider=${provider}` });
  }

  let stateToken;
  if (provider === 'hubspot') {
    const { verifier } = createPkcePair();
    stateToken = createSignedState({
      userId: req.userId,
      provider,
      pkceVerifier: verifier,
      exp: Date.now() + OAUTH_STATE_TTL_MS,
    });
  } else {
    stateToken = createOAuthState({ userId: req.userId, provider });
  }

  res.json({ redirectUrl: `${backendUrl}${redirectUrls[provider]}&state=${encodeURIComponent(stateToken)}` });
});

async function validateHubSpotAccessToken(accessToken) {
  if (!accessToken) return;

  try {
    await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
      params: { limit: 1 },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 15000,
    });
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      throw new Error('Invalid HubSpot token or missing scopes. Please generate a valid token with CRM read scopes and try again.');
    }
    throw new Error(`Failed to validate HubSpot token: ${error.message}`);
  }
}

async function handleManualConnectionAuth(req, res, forcedAuthType = null) {
  try {
    const {
      provider,
      apiKey,
      accessKey,
      accessToken,
      refreshToken,
      instanceUrl,
      displayName,
      objects,
      syncFrequency,
      authType,
    } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Provider is required' });
    }

    const hasCredentials = Boolean(apiKey || accessKey || accessToken || refreshToken);
    if (!hasCredentials) {
      return res.status(400).json({ error: 'At least one credential is required' });
    }

    // Validate HubSpot token up-front so we fail fast instead of creating broken connections.
    if (provider === 'hubspot' && accessToken) {
      await validateHubSpotAccessToken(accessToken);
    }

    // Upsert connection with provided credentials
    const connection = await upsertConnectionByUserAndProvider({
      supabaseClient: req.supabase,
      userId: req.userId,
      provider,
      patch: {
        display_name: displayName || provider,
        auth_type: forcedAuthType || authType || (accessToken ? 'oauth2' : 'api_key'),
        sync_frequency: syncFrequency || 'hourly',
        instance_url: instanceUrl || null,
        credentials: {
          apiKey: apiKey || null,
          accessKey: accessKey || null,
          access_token: accessToken || null,
          refresh_token: refreshToken || null,
          instanceUrl: instanceUrl || null
        },
        status: 'connected',
        last_connected_at: new Date().toISOString(),
      }
    });

    // Refresh connector_objects records
    const objectsToCreate = objects || [];
    await replaceConnectionObjects({
      supabaseClient: req.supabase,
      connectionId: connection.id,
      provider,
      objects: objectsToCreate,
    });

    // Trigger immediate sync jobs for all enabled objects
    const jobsToCreate = (objectsToCreate || []).map(obj => ({
      connection_id: connection.id,
      provider,
      object_type: typeof obj === 'string' ? obj : obj.id,
      job_type: 'incremental',
      status: 'pending',
    }));

    if (jobsToCreate.length > 0) {
      const { error: jobError } = await req.supabase
        .from('sync_jobs')
        .insert(jobsToCreate);
      if (jobError) console.error('Error creating sync jobs:', jobError);
    }

    res.status(201).json({ 
      data: connection, 
      message: 'Connection created successfully and sync scheduled',
      syncJobs: jobsToCreate.length 
    });
  } catch (err) {
    console.error('Manual auth error:', err);
    res.status(400).json({ error: err.message });
  }
}

// Manual credential auth endpoint for all providers
app.post('/api/connections/auth-manual', authMiddleware, async (req, res) => {
  await handleManualConnectionAuth(req, res);
});

// Backward-compatible API key endpoint
app.post('/api/connections/auth-key', authMiddleware, async (req, res) => {
  await handleManualConnectionAuth(req, res, 'api_key');
});

// Test data fetch endpoint - verify credentials work
app.post('/api/connections/test-fetch', authMiddleware, async (req, res) => {
  try {
    const { connectionId, objectType } = req.body;

    if (!connectionId || !objectType) {
      return res.status(400).json({ error: 'connectionId and objectType required' });
    }

    // Get connection
    const { data: connection, error: connError } = await req.supabase
      .from('data_source_connections')
      .select('*')
      .eq('id', connectionId)
      .eq('user_id', req.userId)
      .single();

    if (connError || !connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Dynamically import adapter for provider
    let adapter;
    try {
      if (connection.provider === 'salesforce') {
        const mod = await import('./sync/adapters/salesforce.js');
        adapter = mod;
      } else if (connection.provider === 'hubspot') {
        const mod = await import('./sync/adapters/hubspot.js');
        adapter = mod;
      } else {
        return res.status(400).json({ error: `Provider ${connection.provider} adapter not available for testing` });
      }
    } catch (e) {
      return res.status(500).json({ error: `Failed to load adapter: ${e.message}` });
    }

    // Test fetch
    const records = await adapter.fetchData(objectType, connection.credentials, connection.instance_url);

    res.json({
      success: true,
      provider: connection.provider,
      objectType,
      recordsFetched: records.length,
      sampleRecords: records.slice(0, 3),
      message: `Successfully fetched ${records.length} records from ${connection.provider}`
    });
  } catch (err) {
    console.error('Test fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================
// OAUTH REDIRECT HANDLERS (unauthenticated)
// ============================================

// Salesforce OAuth
app.get(['/auth/salesforce', '/api/auth/salesforce'], (req, res) => {
  const { userId, state } = req.query;
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const backendUrl = process.env.BACKEND_URL || dynamicHost;
  const redirectUri = `${backendUrl}/api/callback/salesforce`;
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  
  if (!clientId) {
    console.error('[Salesforce OAuth] SALESFORCE_CLIENT_ID not found in env vars');
    console.error('[Salesforce OAuth] Available env vars:', Object.keys(process.env).filter(k => k.includes('SALESFORCE') || k.includes('salesforce')));
    return res.status(400).json({ 
      error: 'Salesforce OAuth not configured',
      details: 'SALESFORCE_CLIENT_ID environment variable is missing. Check Vercel Environment Variables.',
      hint: 'Visit /api/config-status to see which vars are loaded',
      help: 'Read HOW_TO_ADD_ENV_VARS.md in repo'
    });
  }

  const oauthState = state || userId;
  const authUrl = `https://login.salesforce.com/services/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(oauthState || '')}`;
  res.redirect(authUrl);
});

app.get(['/callback/salesforce', '/api/callback/salesforce'], async (req, res) => {
  const { code, state } = req.query;
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const frontendUrl = process.env.FRONTEND_URL || dynamicHost || 'http://localhost:5173';
  
  try {
    const backendUrl = process.env.BACKEND_URL || dynamicHost;
    const oauthState = consumeOAuthState(String(state || ''), 'salesforce');
    const userId = oauthState?.userId || (isUuid(state) ? state : null);

    if (!userId || !code) {
      return res.redirect(`${frontendUrl}/dashboard.html?status=error&provider=salesforce`);
    }
    
    const tokenRes = await axios.post('https://login.salesforce.com/services/oauth2/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.SALESFORCE_CLIENT_ID,
        client_secret: process.env.SALESFORCE_CLIENT_SECRET,
        redirect_uri: `${backendUrl}/api/callback/salesforce`,
        code
      }
    });

    const { access_token, instance_url } = tokenRes.data;
    await upsertConnectionByUserAndProvider({
      supabaseClient: supabaseAdmin,
      userId,
      provider: 'salesforce',
      patch: {
        display_name: 'salesforce',
        auth_type: 'oauth2',
        status: 'connected',
        credentials: { access_token, instance_url },
        instance_url,
        last_connected_at: new Date().toISOString(),
      }
    });

    console.log(`[${new Date().toISOString()}] INFO OAuth completed for salesforce (user: ${userId})`);
    res.redirect(`${frontendUrl}/dashboard.html?status=success&provider=salesforce`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR Salesforce OAuth:`, err.message);
    res.redirect(`${frontendUrl}/dashboard.html?status=error&provider=salesforce`);
  }
});

// HubSpot OAuth
app.get(['/auth/hubspot', '/api/auth/hubspot'], (req, res) => {
  const { userId, state } = req.query;
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const backendUrl = process.env.BACKEND_URL || dynamicHost;
  const redirectUri = `${backendUrl}/api/callback/hubspot`;
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const hubspotScopes = getHubSpotScopesFromEnvOrDefault().join(' ');
  
  if (!clientId) {
    return res.status(400).json({ error: 'HubSpot OAuth not configured' });
  }

  const oauthState = state || userId;
  const signedState = parseSignedState(String(oauthState || ''));
  const verifier = signedState?.pkceVerifier;
  const challenge = verifier
    ? toBase64Url(crypto.createHash('sha256').update(verifier).digest())
    : createPkcePair().challenge;

  const scopeQuery = `&scope=${encodeURIComponent(hubspotScopes)}`;
  const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}${scopeQuery}&state=${encodeURIComponent(oauthState || '')}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`;
  res.redirect(authUrl);
});

app.get(['/callback/hubspot', '/api/callback/hubspot'], async (req, res) => {
  const { code, state } = req.query;
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const frontendUrl = process.env.FRONTEND_URL || dynamicHost || 'http://localhost:5173';
  
  try {
    const backendUrl = process.env.BACKEND_URL || dynamicHost;
    const signedState = parseSignedState(String(state || ''));
    const oauthState = signedState || consumeOAuthState(String(state || ''), 'hubspot');
    const userId = oauthState?.userId || (isUuid(state) ? state : null);

    if (!userId || !code) {
      return res.redirect(`${frontendUrl}/dashboard.html?status=error&provider=hubspot`);
    }

    const tokenRes = await axios.post('https://api.hubapi.com/oauth/v1/token', {
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: `${backendUrl}/api/callback/hubspot`,
      code,
      ...(oauthState?.pkceVerifier ? { code_verifier: oauthState.pkceVerifier } : {})
    });

    const { access_token, refresh_token } = tokenRes.data;
    await upsertConnectionByUserAndProvider({
      supabaseClient: supabaseAdmin,
      userId,
      provider: 'hubspot',
      patch: {
        display_name: 'hubspot',
        auth_type: 'oauth2',
        status: 'connected',
        credentials: { access_token, refresh_token },
        last_connected_at: new Date().toISOString(),
      }
    });

    console.log(`[${new Date().toISOString()}] INFO OAuth completed for hubspot (user: ${userId})`);
    res.redirect(`${frontendUrl}/dashboard.html?status=success&provider=hubspot`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR HubSpot OAuth:`, err.message);
    res.redirect(`${frontendUrl}/dashboard.html?status=error&provider=hubspot`);
  }
});

// Outreach OAuth
app.get(['/auth/outreach', '/api/auth/outreach'], (req, res) => {
  const { userId, state } = req.query;
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const backendUrl = process.env.BACKEND_URL || dynamicHost;
  const redirectUri = `${backendUrl}/api/callback/outreach`;
  const clientId = process.env.OUTREACH_CLIENT_ID;
  
  if (!clientId) {
    return res.status(400).json({ error: 'Outreach OAuth not configured' });
  }

  const oauthState = state || userId;
  const authUrl = `https://api.outreach.io/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(oauthState || '')}`;
  res.redirect(authUrl);
});

app.get(['/callback/outreach', '/api/callback/outreach'], async (req, res) => {
  const { code, state } = req.query;
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const frontendUrl = process.env.FRONTEND_URL || dynamicHost || 'http://localhost:5173';
  
  try {
    const backendUrl = process.env.BACKEND_URL || dynamicHost;
    const oauthState = consumeOAuthState(String(state || ''), 'outreach');
    const userId = oauthState?.userId || (isUuid(state) ? state : null);

    if (!userId || !code) {
      return res.redirect(`${frontendUrl}/dashboard.html?status=error&provider=outreach`);
    }

    const tokenRes = await axios.post('https://api.outreach.io/oauth/token', {
      grant_type: 'authorization_code',
      client_id: process.env.OUTREACH_CLIENT_ID,
      client_secret: process.env.OUTREACH_CLIENT_SECRET,
      redirect_uri: `${backendUrl}/api/callback/outreach`,
      code
    });

    const { access_token } = tokenRes.data;
    await upsertConnectionByUserAndProvider({
      supabaseClient: supabaseAdmin,
      userId,
      provider: 'outreach',
      patch: {
        display_name: 'outreach',
        auth_type: 'oauth2',
        status: 'connected',
        credentials: { access_token },
        last_connected_at: new Date().toISOString(),
      }
    });

    console.log(`[${new Date().toISOString()}] INFO OAuth completed for outreach (user: ${userId})`);
    res.redirect(`${frontendUrl}/dashboard.html?status=success&provider=outreach`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR Outreach OAuth:`, err.message);
    res.redirect(`${frontendUrl}/dashboard.html?status=error&provider=outreach`);
  }
});


// ============================================
// CENTRALIZED ERROR HANDLER
// ============================================
app.use((err, req, res, _next) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';

  console.error(`[${new Date().toISOString()}] ERROR ${req.method} ${req.path}:`, {
    status: statusCode,
    message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});


// ============================================
// START SERVER
// ============================================
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] ✅ Backend running on port ${PORT}`);
    console.log(`[${new Date().toISOString()}] Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
    console.log(`[${new Date().toISOString()}] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

export default app;
