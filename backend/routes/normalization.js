/**
 * Normalization API Routes
 * Endpoints for normalization stats, platform analysis, and triggering runs
 */

import { Router } from 'express';
import { runNormalizationPipeline, getPlatformAnalysis } from '../normalizer/index.js';
import { getSupportedObjects, getAllFieldMaps } from '../normalizer/field-maps.js';

const router = Router();

// GET /api/normalized/stats — aggregated normalization stats
router.get('/stats', async (req, res, next) => {
  try {
    // Get all connections for user
    const { data: connections } = await req.supabase
      .from('data_source_connections')
      .select('id, provider')
      .eq('user_id', req.userId);

    if (!connections || connections.length === 0) {
      return res.json({
        totalConnections: 0,
        totalRecordsProcessed: 0,
        totalRecordsNormalized: 0,
        avgQualityScore: 0,
        lastNormalizationRun: null,
      });
    }

    const connectionIds = connections.map(c => c.id);

    // Aggregate from normalization_runs
    const { data: runs } = await req.supabase
      .from('normalization_runs')
      .select('*')
      .in('connection_id', connectionIds)
      .order('completed_at', { ascending: false });

    const completedRuns = (runs || []).filter(r => r.status === 'completed' || r.status === 'partial');
    const totalProcessed = completedRuns.reduce((s, r) => s + (r.records_processed || 0), 0);
    const totalNormalized = completedRuns.reduce((s, r) => s + (r.records_normalized || 0), 0);
    const avgScore = completedRuns.length > 0
      ? Math.round(completedRuns.reduce((s, r) => s + (r.avg_quality_score || 0), 0) / completedRuns.length)
      : 0;

    // Unresolved errors
    const { count: errorCount } = await req.supabase
      .from('transform_errors')
      .select('*', { count: 'exact', head: true })
      .in('connection_id', connectionIds)
      .eq('resolved', false);

    res.json({
      totalConnections: connections.length,
      totalRecordsProcessed: totalProcessed,
      totalRecordsNormalized: totalNormalized,
      avgQualityScore: avgScore,
      unresolvedErrors: errorCount || 0,
      totalRuns: completedRuns.length,
      lastNormalizationRun: runs && runs.length > 0 ? runs[0] : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/normalized/platform-analysis — per-platform quality comparison
router.get('/platform-analysis', async (req, res, next) => {
  try {
    const analysis = await getPlatformAnalysis(req.supabase, req.userId);
    res.json({ data: analysis });
  } catch (err) {
    next(err);
  }
});

// GET /api/normalized/runs — list normalization runs
router.get('/runs', async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const { data: connections } = await req.supabase
      .from('data_source_connections')
      .select('id')
      .eq('user_id', req.userId);

    if (!connections || connections.length === 0) {
      return res.json({ data: [], total: 0 });
    }

    const connectionIds = connections.map(c => c.id);

    const { data: runs, error, count } = await req.supabase
      .from('normalization_runs')
      .select('*', { count: 'exact' })
      .in('connection_id', connectionIds)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({ data: runs, total: count });
  } catch (err) {
    next(err);
  }
});

// POST /api/normalized/run — trigger normalization for a specific connection
router.post('/run', async (req, res, next) => {
  try {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: 'connectionId is required' });
    }

    // Verify ownership
    const { data: conn } = await req.supabase
      .from('data_source_connections')
      .select('id, provider')
      .eq('id', connectionId)
      .eq('user_id', req.userId)
      .single();

    if (!conn) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Run pipeline
    const result = await runNormalizationPipeline(
      req.supabase,
      connectionId,
      conn.provider,
      { userId: req.userId }
    );

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/normalized/field-maps/:provider — get field mappings for a provider
router.get('/field-maps/:provider', (req, res) => {
  const { provider } = req.params;
  const maps = getAllFieldMaps(provider);

  if (!maps || Object.keys(maps).length === 0) {
    return res.status(404).json({ error: `No field maps found for ${provider}` });
  }

  const result = {};
  for (const [objectType, map] of Object.entries(maps)) {
    result[objectType] = {
      sourceObject: map.sourceObject,
      targetTable: map.targetTable,
      fieldCount: Object.keys(map.fields).length,
      fields: Object.entries(map.fields).map(([source, config]) => ({
        source,
        target: config.target,
        transform: config.transform,
        required: config.required || false,
      })),
    };
  }

  res.json({ data: result });
});

export default router;
