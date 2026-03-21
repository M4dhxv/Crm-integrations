/**
 * Normalization Pipeline Orchestrator
 * Processes raw.source_objects → applies field maps + standardizers → writes to crm_* tables
 * Scores quality and tracks normalization runs
 */

import { getFieldMap, getSupportedObjects, getAllFieldMaps } from './field-maps.js';
import { applyTransform, resolveFieldPath, standardizeAddress } from './standardizers.js';
import { scoreRecord, scorePlatform } from './quality-scorer.js';

/**
 * Process a batch of raw source objects through the normalization pipeline
 * 
 * @param {Object} supabase - Supabase client
 * @param {string} connectionId - The connection UUID
 * @param {string} provider - CRM provider key
 * @param {string} objectType - Object type (contacts, deals, etc.)
 * @param {Array} rawRecords - Array of raw source objects (each with .payload)
 * @param {Object} meta - { userId, orgId }
 * @returns {Object} - { normalized, errors, qualityReport }
 */
export async function normalizeRecords(supabase, connectionId, provider, objectType, rawRecords, meta) {
  const fieldMap = getFieldMap(provider, objectType);
  if (!fieldMap) {
    throw new Error(`No field map found for ${provider}/${objectType}`);
  }

  const normalized = [];
  const errors = [];

  for (const raw of rawRecords) {
    try {
      const payload = raw.payload || raw;
      const record = mapRecord(payload, fieldMap, provider);

      // Add system fields
      record.connection_id = connectionId;
      record.user_id = meta.userId;
      record.org_id = meta.orgId || null;
      record.provider = provider;

      normalized.push(record);
    } catch (err) {
      errors.push({
        sourceObjectId: raw.id || null,
        externalId: raw.external_id || (raw.payload && raw.payload.Id) || null,
        error: err.message,
        raw: raw.payload ? raw.payload : raw,
      });
    }
  }

  // Score quality of normalized records
  const qualityReport = scorePlatform(normalized, fieldMap.targetTable);

  return {
    targetTable: fieldMap.targetTable,
    normalized,
    errors,
    qualityReport,
  };
}

/**
 * Map a single raw record using a field map definition
 */
function mapRecord(payload, fieldMap, provider) {
  const record = {};
  const addressParts = {};

  for (const [sourceField, config] of Object.entries(fieldMap.fields)) {
    // Resolve the value — use custom path if specified, otherwise use the source field key
    let rawValue;
    if (config.path) {
      rawValue = resolveFieldPath(payload, config.path);
    } else {
      rawValue = payload[sourceField];
    }

    // Skip internal reference fields (processed separately)
    if (config.target.startsWith('_')) {
      record[config.target] = rawValue;
      continue;
    }

    // Handle address sub-fields (e.g., "address.street")
    if (config.target.startsWith('address.')) {
      const subField = config.target.split('.')[1];
      addressParts[subField] = rawValue;
      continue;
    }

    // Apply transform
    const transformed = applyTransform(config.transform, rawValue, config.transformConfig || {});

    // Check required fields
    if (config.required && (transformed === null || transformed === undefined || transformed === '')) {
      throw new Error(`Required field "${sourceField}" is missing or invalid for ${provider}`);
    }

    record[config.target] = transformed !== undefined ? transformed : (config.default || null);
  }

  // Assemble address if any parts were found
  if (Object.keys(addressParts).length > 0) {
    record.address = standardizeAddress(addressParts);
  }

  return record;
}

/**
 * Run full normalization pipeline for a connection
 * Creates a normalization_run record, processes all objects, and writes results
 * 
 * @param {Object} supabase - Supabase client
 * @param {string} connectionId
 * @param {string} provider
 * @param {Object} meta - { userId, orgId }
 * @returns {Object} - Run result summary
 */
export async function runNormalizationPipeline(supabase, connectionId, provider, meta) {
  // Create normalization run record
  const { data: run, error: runError } = await supabase
    .from('normalization_runs')
    .insert({
      connection_id: connectionId,
      user_id: meta.userId,
      provider,
      status: 'running',
    })
    .select()
    .single();

  if (runError) throw runError;

  const objectTypes = getSupportedObjects(provider);
  let totalProcessed = 0;
  let totalNormalized = 0;
  let totalErrored = 0;
  const allFieldCoverage = {};
  const allQualityScores = [];

  try {
    for (const objectType of objectTypes) {
      // Fetch raw records for this object type
      const { data: rawRecords, error: fetchError } = await supabase
        .schema('raw')
        .from('source_objects')
        .select('*')
        .eq('connection_id', connectionId)
        .eq('provider', provider)
        .eq('object_type', objectType)
        .order('received_at', { ascending: false })
        .limit(1000);

      if (fetchError) {
        console.error(`Error fetching raw records for ${objectType}:`, fetchError);
        continue;
      }

      if (!rawRecords || rawRecords.length === 0) continue;

      // Normalize
      const result = await normalizeRecords(
        supabase, connectionId, provider, objectType, rawRecords, meta
      );

      totalProcessed += rawRecords.length;
      totalNormalized += result.normalized.length;
      totalErrored += result.errors.length;

      // Merge field coverage
      Object.assign(allFieldCoverage, result.qualityReport.fieldCoverage);
      allQualityScores.push(...(result.qualityReport.scores || []));

      // Upsert normalized records (if any)
      if (result.normalized.length > 0) {
        const { error: upsertError } = await supabase
          .from(result.targetTable)
          .upsert(
            result.normalized.filter(r => !r._company_ref && !r._owner_ref && r.external_id),
            { onConflict: 'connection_id,provider,external_id' }
          );

        if (upsertError) {
          console.error(`Upsert error for ${result.targetTable}:`, upsertError);
          totalErrored += result.normalized.length;
          totalNormalized -= result.normalized.length;
        }
      }

      // Log transform errors
      if (result.errors.length > 0) {
        await supabase.from('transform_errors').insert(
          result.errors.map(e => ({
            connection_id: connectionId,
            user_id: meta.userId,
            provider,
            object_type: objectType,
            error_message: e.error,
            error_detail: { raw: e.raw },
          }))
        );
      }
    }

    // Compute final avg quality score
    const avgScore = allQualityScores.length > 0
      ? Math.round(allQualityScores.reduce((s, r) => s + r.overallScore, 0) / allQualityScores.length)
      : 0;

    // Update normalization run
    await supabase
      .from('normalization_runs')
      .update({
        status: totalErrored > 0 ? 'partial' : 'completed',
        records_processed: totalProcessed,
        records_normalized: totalNormalized,
        records_errored: totalErrored,
        avg_quality_score: avgScore,
        field_coverage: allFieldCoverage,
        completed_at: new Date().toISOString(),
      })
      .eq('id', run.id);

    return {
      runId: run.id,
      status: totalErrored > 0 ? 'partial' : 'completed',
      totalProcessed,
      totalNormalized,
      totalErrored,
      avgQualityScore: avgScore,
      fieldCoverage: allFieldCoverage,
    };

  } catch (err) {
    // Mark run as failed
    await supabase
      .from('normalization_runs')
      .update({
        status: 'failed',
        records_processed: totalProcessed,
        records_normalized: totalNormalized,
        records_errored: totalErrored,
        error_summary: [{ message: err.message }],
        completed_at: new Date().toISOString(),
      })
      .eq('id', run.id);

    throw err;
  }
}

/**
 * Get platform analysis data for a user across all their connections
 */
export async function getPlatformAnalysis(supabase, userId) {
  // Get all connections for this user
  const { data: connections, error: connError } = await supabase
    .from('data_source_connections')
    .select('id, provider, display_name, status, sync_frequency, created_at')
    .eq('user_id', userId);

  if (connError) throw connError;
  if (!connections || connections.length === 0) return [];

  const analysis = [];

  for (const conn of connections) {
    // Get latest normalization run
    const { data: latestRun } = await supabase
      .from('normalization_runs')
      .select('*')
      .eq('connection_id', conn.id)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    // Get quality score distribution
    const { data: qualityScores } = await supabase
      .from('data_quality_scores')
      .select('overall_score')
      .eq('connection_id', conn.id);

    // Get field map info
    const fieldMaps = getAllFieldMaps(conn.provider);
    const totalFields = Object.values(fieldMaps).reduce(
      (sum, map) => sum + Object.keys(map.fields || {}).length, 0
    );

    // Get unresolved error count
    const { count: errorCount } = await supabase
      .from('transform_errors')
      .select('*', { count: 'exact', head: true })
      .eq('connection_id', conn.id)
      .eq('resolved', false);

    analysis.push({
      connectionId: conn.id,
      provider: conn.provider,
      displayName: conn.display_name,
      status: conn.status,
      syncFrequency: conn.sync_frequency,
      totalMappedFields: totalFields,
      supportedObjects: getSupportedObjects(conn.provider),
      latestRun: latestRun || null,
      qualityDistribution: {
        high: qualityScores?.filter(s => s.overall_score >= 80).length || 0,
        medium: qualityScores?.filter(s => s.overall_score >= 50 && s.overall_score < 80).length || 0,
        low: qualityScores?.filter(s => s.overall_score < 50).length || 0,
      },
      avgQualityScore: latestRun?.avg_quality_score || 0,
      fieldCoverage: latestRun?.field_coverage || {},
      unresolvedErrors: errorCount || 0,
    });
  }

  return analysis;
}
