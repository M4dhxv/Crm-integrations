/**
 * Connections API Routes
 * CRUD endpoints for managing CRM data source connections
 */

import { Router } from 'express';
import { processSyncJob } from '../sync/index.js';

const router = Router();

// GET /api/connections — list user's connections with health status
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('data_source_connections')
      .select(`
        id, provider, display_name, auth_type, status, credentials,
        sync_frequency, instance_url, last_connected_at,
        created_at, updated_at
      `)
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Enrich with health info
    const enriched = await Promise.all(data.map(async (conn) => {
      const { data: healthData } = await req.supabase
        .from('connection_health')
        .select('*')
        .eq('connection_id', conn.id)
        .single();

      const { count: contactCount } = await req.supabase
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('connection_id', conn.id)
        .eq('is_deleted', false);

      const { count: dealCount } = await req.supabase
        .from('crm_deals')
        .select('*', { count: 'exact', head: true })
        .eq('connection_id', conn.id)
        .eq('is_deleted', false);

      const creds = conn.credentials || {};
      const hasOAuthToken = Boolean(creds.access_token || creds.accessToken);
      const hasApiKey = Boolean(creds.apiKey || creds.accessKey);
      const hasCredentials = conn.auth_type === 'oauth2'
        ? hasOAuthToken
        : (conn.auth_type === 'api_key' ? hasApiKey : true);

      const { credentials, ...safeConn } = conn;

      return {
        ...safeConn,
        has_credentials: hasCredentials,
        health_status: healthData?.health_status || 'pending',
        contact_count: contactCount || 0,
        deal_count: dealCount || 0,
      };
    }));

    res.json({ data: enriched });
  } catch (err) {
    next(err);
  }
});

// POST /api/connections — create new connection
router.post('/', async (req, res, next) => {
  try {
    const { provider, displayName, authType, syncFrequency, instanceUrl, credentials, objects } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Provider is required' });
    }

    // Verify provider exists in registry
    const { data: registry } = await req.supabase
      .from('connector_registry')
      .select('*')
      .eq('provider', provider)
      .single();

    if (!registry) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    // Insert connection
    const { data: connection, error: connError } = await req.supabase
      .from('data_source_connections')
      .insert({
        user_id: req.userId,
        provider,
        display_name: displayName || registry.display_name,
        auth_type: authType || registry.auth_type,
        sync_frequency: syncFrequency || 'hourly',
        instance_url: instanceUrl || null,
        credentials: credentials || {},
        status: credentials ? 'connected' : 'pending',
        last_connected_at: credentials ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (connError) throw connError;

    // Create connector_objects
    const objectsToCreate = objects || registry.supported_objects;
    if (objectsToCreate && objectsToCreate.length > 0) {
      const objectRows = objectsToCreate.map(obj => ({
        connection_id: connection.id,
        provider,
        object_type: typeof obj === 'string' ? obj : obj.id,
        sync_enabled: typeof obj === 'object' ? obj.enabled !== false : true,
      }));

      await req.supabase.from('connector_objects').insert(objectRows);
    }

    res.status(201).json({ data: connection });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/connections/:id — remove connection
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { error } = await req.supabase
      .from('data_source_connections')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/connections/:id/sync — trigger manual sync
router.post('/:id/sync', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: conn } = await req.supabase
      .from('data_source_connections')
      .select('id, provider, auth_type, credentials')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (!conn) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const creds = conn.credentials || {};
    const hasOAuthToken = Boolean(creds.access_token || creds.accessToken);
    const hasApiKey = Boolean(creds.apiKey || creds.accessKey);

    if ((conn.auth_type === 'oauth2' && !hasOAuthToken) || (conn.auth_type === 'api_key' && !hasApiKey)) {
      return res.status(400).json({ error: 'Connection is missing required credentials. Reconnect or re-save credentials first.' });
    }

    // Get enabled objects
    let { data: objects } = await req.supabase
      .from('connector_objects')
      .select('object_type')
      .eq('connection_id', id)
      .eq('sync_enabled', true);

    // If no connector objects exist, bootstrap from registry defaults
    if (!objects || objects.length === 0) {
      const { data: registry } = await req.supabase
        .from('connector_registry')
        .select('supported_objects')
        .eq('provider', conn.provider)
        .single();

      const fallbackObjects = registry?.supported_objects || [];
      if (fallbackObjects.length > 0) {
        const rows = fallbackObjects.map(objectType => ({
          connection_id: id,
          provider: conn.provider,
          object_type: objectType,
          sync_enabled: true,
        }));

        await req.supabase.from('connector_objects').insert(rows);
        objects = rows.map(r => ({ object_type: r.object_type }));
      }
    }

    // Create sync jobs for each object
    const jobs = (objects || []).map(obj => ({
      connection_id: id,
      provider: conn.provider,
      object_type: obj.object_type,
      job_type: 'incremental',
      status: 'pending',
    }));

    if (jobs.length > 0) {
      const { data: createdJobs, error: jobError } = await req.supabase
        .from('sync_jobs')
        .insert(jobs)
        .select();

      if (jobError) {
        // If jobs are already queued/running (partial unique index), return helpful message
        if (jobError.code === '23505') {
          return res.json({ data: [], message: 'Sync already queued or running for one or more objects' });
        }
        throw jobError;
      }

      // On serverless plans with limited cron jobs, opportunistically process 1 job now.
      let processedNow = 0;
      try {
        if (createdJobs?.length && req.supabaseAdmin) {
          const jobToRun = createdJobs[0];
          const ok = await processSyncJob(jobToRun, req.supabaseAdmin);
          processedNow = ok ? 1 : 0;
        }
      } catch (e) {
        // Non-blocking: jobs remain queued even if immediate processing fails.
        console.error('Inline sync processing failed:', e?.message || e);
      }

      res.json({
        data: createdJobs,
        message: `${jobs.length} sync jobs queued${processedNow ? `, ${processedNow} started immediately` : ''}`,
        processedNow,
      });
    } else {
      res.json({ data: [], message: 'No enabled objects to sync' });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
