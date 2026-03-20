import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import connectionsRouter from './routes/connections.js';
import normalizationRouter from './routes/normalization.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Supabase admin client (service role)
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

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

// JWT Auth middleware for /api/* routes
async function authMiddleware(req, res, next) {
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


// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', async (req, res) => {
  const checks = { server: 'ok', supabase: 'unknown' };
  
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


// ============================================
// API ROUTES (authenticated)
// ============================================
app.use('/api/connections', authMiddleware, connectionsRouter);
app.use('/api/normalized', authMiddleware, normalizationRouter);

// Start OAuth flow
app.post('/api/start-oauth', authMiddleware, async (req, res) => {
  const { provider } = req.body;

  const redirectUrls = {
    salesforce: `/api/auth/salesforce?userId=${req.userId}`,
    hubspot: `/api/auth/hubspot?userId=${req.userId}`,
    outreach: `/api/auth/outreach?userId=${req.userId}`
  };

  if (!redirectUrls[provider]) {
    return res.status(400).json({ error: 'Provider not supported for OAuth' });
  }

  // DEMO MODE BYPASS: If no backend URL is set, we bypass real OAuth and simulate connection
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const backendUrl = process.env.BACKEND_URL || dynamicHost;
  if (!backendUrl) {
    console.log(`[Demo Mode] Mocking ${provider} connection for user ${req.userId}...`);
    
    // Create a mock connection in the database
    await req.supabase.from('data_source_connections').upsert({
      user_id: req.userId,
      provider: provider,
      display_name: `${provider} (Demo Configuration)`,
      auth_type: 'oauth2',
      status: 'connected',
      health_status: 'healthy',
      sync_frequency: 'hourly',
      contact_count: Math.floor(Math.random() * 5000),
      deal_count: Math.floor(Math.random() * 300)
    }, { onConflict: 'user_id,provider' });

    // Mock successful redirect directly back to frontend
    const frontendUrl = process.env.FRONTEND_URL || dynamicHost;
    return res.json({ redirectUrl: `${frontendUrl}/dashboard.html?status=success&provider=${provider}` });
  }

  res.json({ redirectUrl: `${backendUrl}${redirectUrls[provider]}` });
});

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

    // Upsert connection with provided credentials
    const { data: connection, error: connError } = await req.supabase
      .from('data_source_connections')
      .upsert({
        user_id: req.userId,
        provider,
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
      }, { onConflict: 'user_id,provider' })
      .select()
      .single();

    if (connError) throw connError;

    // Refresh connector_objects records
    const objectsToCreate = objects || [];
    await req.supabase
      .from('connector_objects')
      .delete()
      .eq('connection_id', connection.id);

    if (objectsToCreate.length > 0) {
      const { error: objError } = await req.supabase
        .from('connector_objects')
        .insert(
          objectsToCreate.map(obj => (
            typeof obj === 'string' ? 
              { connection_id: connection.id, provider, object_type: obj, sync_enabled: true } :
              { connection_id: connection.id, provider, object_type: obj.id, sync_enabled: true }
          ))
        );
      if (objError) throw objError;
    }

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
  const { userId } = req.query;
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const backendUrl = process.env.BACKEND_URL || dynamicHost;
  const redirectUri = `${backendUrl}/api/callback/salesforce`;
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  
  if (!clientId) {
    return res.status(400).json({ error: 'Salesforce OAuth not configured' });
  }

  const authUrl = `https://login.salesforce.com/services/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${userId}`;
  res.redirect(authUrl);
});

app.get(['/callback/salesforce', '/api/callback/salesforce'], async (req, res) => {
  const { code, state } = req.query;
  
  try {
    const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    const backendUrl = process.env.BACKEND_URL || dynamicHost;
    
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

    await supabaseAdmin
      .from('data_source_connections')
      .update({
        status: 'connected',
        credentials: { access_token, instance_url },
        last_connected_at: new Date().toISOString()
      })
      .eq('user_id', state)
      .eq('provider', 'salesforce');

    console.log(`[${new Date().toISOString()}] INFO OAuth completed for salesforce (user: ${state})`);
    const frontendUrl = process.env.FRONTEND_URL || dynamicHost;
    res.redirect(`${frontendUrl}/dashboard.html?status=success&provider=salesforce`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR Salesforce OAuth:`, err.message);
    const frontendUrl = process.env.FRONTEND_URL || dynamicHost || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/dashboard.html?status=error&provider=salesforce`);
  }
});

// HubSpot OAuth
app.get(['/auth/hubspot', '/api/auth/hubspot'], (req, res) => {
  const { userId } = req.query;
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const backendUrl = process.env.BACKEND_URL || dynamicHost;
  const redirectUri = `${backendUrl}/api/callback/hubspot`;
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  
  if (!clientId) {
    return res.status(400).json({ error: 'HubSpot OAuth not configured' });
  }

  const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=crm.objects.contacts.read%20crm.objects.companies.read&state=${userId}`;
  res.redirect(authUrl);
});

app.get(['/callback/hubspot', '/api/callback/hubspot'], async (req, res) => {
  const { code, state } = req.query;
  
  try {
    const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    const backendUrl = process.env.BACKEND_URL || dynamicHost;

    const tokenRes = await axios.post('https://api.hubapi.com/oauth/v1/token', {
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: `${backendUrl}/api/callback/hubspot`,
      code
    });

    const { access_token, refresh_token } = tokenRes.data;

    await supabaseAdmin
      .from('data_source_connections')
      .update({
        status: 'connected',
        credentials: { access_token, refresh_token },
        last_connected_at: new Date().toISOString()
      })
      .eq('user_id', state)
      .eq('provider', 'hubspot');

    console.log(`[${new Date().toISOString()}] INFO OAuth completed for hubspot (user: ${state})`);
    const frontendUrl = process.env.FRONTEND_URL || dynamicHost;
    res.redirect(`${frontendUrl}/dashboard.html?status=success&provider=hubspot`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR HubSpot OAuth:`, err.message);
    const frontendUrl = process.env.FRONTEND_URL || dynamicHost || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/dashboard.html?status=error&provider=hubspot`);
  }
});

// Outreach OAuth
app.get(['/auth/outreach', '/api/auth/outreach'], (req, res) => {
  const { userId } = req.query;
  const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  const backendUrl = process.env.BACKEND_URL || dynamicHost;
  const redirectUri = `${backendUrl}/api/callback/outreach`;
  const clientId = process.env.OUTREACH_CLIENT_ID;
  
  if (!clientId) {
    return res.status(400).json({ error: 'Outreach OAuth not configured' });
  }

  const authUrl = `https://api.outreach.io/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${userId}`;
  res.redirect(authUrl);
});

app.get(['/callback/outreach', '/api/callback/outreach'], async (req, res) => {
  const { code, state } = req.query;
  
  try {
    const dynamicHost = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    const backendUrl = process.env.BACKEND_URL || dynamicHost;

    const tokenRes = await axios.post('https://api.outreach.io/oauth/token', {
      grant_type: 'authorization_code',
      client_id: process.env.OUTREACH_CLIENT_ID,
      client_secret: process.env.OUTREACH_CLIENT_SECRET,
      redirect_uri: `${backendUrl}/api/callback/outreach`,
      code
    });

    const { access_token } = tokenRes.data;

    await supabaseAdmin
      .from('data_source_connections')
      .update({
        status: 'connected',
        credentials: { access_token },
        last_connected_at: new Date().toISOString()
      })
      .eq('user_id', state)
      .eq('provider', 'outreach');

    console.log(`[${new Date().toISOString()}] INFO OAuth completed for outreach (user: ${state})`);
    const frontendUrl = process.env.FRONTEND_URL || dynamicHost;
    res.redirect(`${frontendUrl}/dashboard.html?status=success&provider=outreach`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR Outreach OAuth:`, err.message);
    const frontendUrl = process.env.FRONTEND_URL || dynamicHost || 'http://localhost:5173';
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
