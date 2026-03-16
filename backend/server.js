import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============================================
// OAUTH REDIRECT HANDLERS
// ============================================

// Salesforce OAuth
app.get('/auth/salesforce', (req, res) => {
  const { userId, connectionId } = req.query;
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const redirectUri = `${process.env.BACKEND_URL}/callback/salesforce`;
  
  if (!clientId) {
    return res.status(400).json({ error: 'Salesforce OAuth not configured' });
  }

  const authUrl = `https://login.salesforce.com/services/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${userId}`;
  res.redirect(authUrl);
});

// Salesforce OAuth Callback
app.get('/callback/salesforce', async (req, res) => {
  const { code, state } = req.query;
  
  try {
    // Exchange code for access token
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

    // Save to Supabase
    const { error } = await supabase
      .from('data_source_connections')
      .update({
        status: 'connected',
        credentials: { access_token, instance_url },
        last_connected_at: new Date().toISOString()
      })
      .eq('user_id', state)
      .eq('provider', 'salesforce');

    if (error) throw error;

    // Redirect back to dashboard
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=success&provider=salesforce`);
  } catch (err) {
    console.error('Salesforce OAuth error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=error&provider=salesforce`);
  }
});

// HubSpot OAuth
app.get('/auth/hubspot', (req, res) => {
  const { userId, connectionId } = req.query;
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const redirectUri = `${process.env.BACKEND_URL}/callback/hubspot`;
  
  if (!clientId) {
    return res.status(400).json({ error: 'HubSpot OAuth not configured' });
  }

  const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=crm.objects.contacts.read%20crm.objects.companies.read&state=${userId}`;
  res.redirect(authUrl);
});

// HubSpot OAuth Callback
app.get('/callback/hubspot', async (req, res) => {
  const { code, state } = req.query;
  
  try {
    // Exchange code for access token
    const tokenRes = await axios.post('https://api.hubapi.com/oauth/v1/token', {
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: `${process.env.BACKEND_URL}/callback/hubspot`,
      code
    });

    const { access_token, refresh_token } = tokenRes.data;

    // Save to Supabase
    const { error } = await supabase
      .from('data_source_connections')
      .update({
        status: 'connected',
        credentials: { access_token, refresh_token },
        last_connected_at: new Date().toISOString()
      })
      .eq('user_id', state)
      .eq('provider', 'hubspot');

    if (error) throw error;

    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=success&provider=hubspot`);
  } catch (err) {
    console.error('HubSpot OAuth error:', err);
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

// Outreach OAuth Callback
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

    await supabase
      .from('data_source_connections')
      .update({
        status: 'connected',
        credentials: { access_token },
        last_connected_at: new Date().toISOString()
      })
      .eq('user_id', state)
      .eq('provider', 'outreach');

    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=success&provider=outreach`);
  } catch (err) {
    console.error('Outreach OAuth error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?status=error&provider=outreach`);
  }
});

// API endpoint to start OAuth flow
app.post('/api/start-oauth', async (req, res) => {
  const { provider, userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  // Return OAuth redirect URL based on provider
  const redirectUrls = {
    salesforce: `/auth/salesforce?userId=${userId}`,
    hubspot: `/auth/hubspot?userId=${userId}`,
    outreach: `/auth/outreach?userId=${userId}`
  };

  if (!redirectUrls[provider]) {
    return res.status(400).json({ error: 'Provider not supported' });
  }

  res.json({ redirectUrl: `${process.env.BACKEND_URL}${redirectUrls[provider]}` });
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});
