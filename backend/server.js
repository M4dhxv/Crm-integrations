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


// ============================================
// API ROUTES (authenticated)
// ============================================
app.use('/api/connections', authMiddleware, connectionsRouter);
app.use('/api/normalized', authMiddleware, normalizationRouter);

// Start OAuth flow
app.post('/api/start-oauth', authMiddleware, async (req, res) => {
  const { provider } = req.body;

  const redirectUrls = {
    salesforce: `/auth/salesforce?userId=${req.userId}`,
    hubspot: `/auth/hubspot?userId=${req.userId}`,
    outreach: `/auth/outreach?userId=${req.userId}`
  };

  if (!redirectUrls[provider]) {
    return res.status(400).json({ error: 'Provider not supported for OAuth' });
  }

  // DEMO MODE BYPASS: If no backend URL is set, we bypass real OAuth and simulate connection
  const backendUrl = process.env.BACKEND_URL;
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
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
    return res.json({ redirectUrl: `${frontendUrl}/dashboard.html?status=success&provider=${provider}` });
  }

  res.json({ redirectUrl: `${backendUrl}${redirectUrls[provider]}` });
});


// ============================================
// OAUTH REDIRECT HANDLERS (unauthenticated)
// ============================================

// Salesforce OAuth
app.get('/auth/salesforce', (req, res) => {
  const { userId } = req.query;
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const redirectUri = `${process.env.BACKEND_URL}/callback/salesforce`;
  
  if (!clientId) {
    return res.status(400).json({ error: 'Salesforce OAuth not configured' });
  }

  const authUrl = `https://login.salesforce.com/services/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${userId}`;
  res.redirect(authUrl);
});

app.get('/callback/salesforce', async (req, res) => {
  const { code, state } = req.query;
  
  try {
    const tokenRes = await axios.post('https://login.salesforce.com/services/oauth2/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.SALESFORCE_CLIENT_ID,
        client_secret: process.env.SALESFORCE_CLIENT_SECRET,
        redirect_uri: `${process.env.BACKEND_URL}/callback/salesforce`,
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
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=success&provider=salesforce`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR Salesforce OAuth:`, err.message);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=error&provider=salesforce`);
  }
});

// HubSpot OAuth
app.get('/auth/hubspot', (req, res) => {
  const { userId } = req.query;
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const redirectUri = `${process.env.BACKEND_URL}/callback/hubspot`;
  
  if (!clientId) {
    return res.status(400).json({ error: 'HubSpot OAuth not configured' });
  }

  const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=crm.objects.contacts.read%20crm.objects.companies.read&state=${userId}`;
  res.redirect(authUrl);
});

app.get('/callback/hubspot', async (req, res) => {
  const { code, state } = req.query;
  
  try {
    const tokenRes = await axios.post('https://api.hubapi.com/oauth/v1/token', {
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: `${process.env.BACKEND_URL}/callback/hubspot`,
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
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=success&provider=hubspot`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR HubSpot OAuth:`, err.message);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=error&provider=hubspot`);
  }
});

// Outreach OAuth
app.get('/auth/outreach', (req, res) => {
  const { userId } = req.query;
  const clientId = process.env.OUTREACH_CLIENT_ID;
  const redirectUri = `${process.env.BACKEND_URL}/callback/outreach`;
  
  if (!clientId) {
    return res.status(400).json({ error: 'Outreach OAuth not configured' });
  }

  const authUrl = `https://api.outreach.io/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${userId}`;
  res.redirect(authUrl);
});

app.get('/callback/outreach', async (req, res) => {
  const { code, state } = req.query;
  
  try {
    const tokenRes = await axios.post('https://api.outreach.io/oauth/token', {
      grant_type: 'authorization_code',
      client_id: process.env.OUTREACH_CLIENT_ID,
      client_secret: process.env.OUTREACH_CLIENT_SECRET,
      redirect_uri: `${process.env.BACKEND_URL}/callback/outreach`,
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
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=success&provider=outreach`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ERROR Outreach OAuth:`, err.message);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=error&provider=outreach`);
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
