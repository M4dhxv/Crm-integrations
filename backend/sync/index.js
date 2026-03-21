/**
 * Sync Engine Orchestrator
 * Routes jobs from the sync_jobs table to the correct API adapter
 * and handles writing to raw.source_objects.
 */
import { runNormalizationPipeline } from '../normalizer/index.js';
import { normalizeRecords } from '../normalizer/index.js';
import * as salesforceAdapter from './adapters/salesforce.js';
import * as hubspotAdapter from './adapters/hubspot.js';
import * as pipedriveAdapter from './adapters/pipedrive.js';
import * as gongAdapter from './adapters/gong.js';

const ADAPTERS = {
  salesforce: salesforceAdapter,
  hubspot: hubspotAdapter,
  pipedrive: pipedriveAdapter,
  gong: gongAdapter,
};

const SUPPORTED_OBJECTS = {
  hubspot: new Set(['contacts', 'companies', 'deals']),
  salesforce: new Set(['contacts', 'leads', 'accounts', 'opportunities']),
  pipedrive: new Set(['persons', 'organizations', 'deals']),
  gong: new Set(['calls']),
};

/**
 * Execute a single sync job
 * @param {Object} job - The job row from sync_jobs
 * @param {Object} supabase - Authenticated supabase client (service role)
 */
export async function processSyncJob(job, supabase) {
  const { id, connection_id, provider, object_type, job_type } = job;
  const startedAt = Date.now();
  const currentAttempt = (job.attempts || 0) + 1;
  const maxAttempts = job.max_attempts || 3;
  let connection = null;
  let adapter = null;
  let records = [];
  console.log(`[Sync] Starting job ${id} | ${provider} -> ${object_type}`);

  try {
    // 1. Mark job as running
    await supabase
      .from('sync_jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        attempts: currentAttempt,
      })
      .eq('id', id);

    // 2. Fetch connection details/credentials
    const { data: fetchedConnection, error: connError } = await supabase
      .from('data_source_connections')
      .select('user_id, credentials, instance_url')
      .eq('id', connection_id)
      .single();

    if (connError || !fetchedConnection) {
      throw new Error(`Connection ${connection_id} not found: ${connError?.message}`);
    }
    connection = fetchedConnection;

    // 3. Select adapter
    adapter = ADAPTERS[provider];
    if (!adapter) {
      throw new Error(`Integration for provider '${provider}' is not implemented yet.`);
    }

    const providerSupported = SUPPORTED_OBJECTS[provider];
    if (providerSupported && !providerSupported.has(object_type)) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'cancelled',
          error: `Skipped unsupported object type: ${object_type}`,
          completed_at: new Date().toISOString(),
        })
        .eq('id', id);

      console.warn(`[Sync] Job ${id} | CANCELLED unsupported object ${object_type}`);
      return true;
    }

    // 4. Fetch raw data from CRM API
    records = await adapter.fetchData(object_type, connection.credentials, connection.instance_url);
    console.log(`[Sync] Job ${id} | Pulled ${records.length} records from ${provider}`);

    // Persist refreshed credentials (if adapter updated token)
    await supabase
      .from('data_source_connections')
      .update({ credentials: connection.credentials || {} })
      .eq('id', connection_id);

    // 5. Upsert into raw.source_objects
    let rawWriteAvailable = true;
    if (records.length > 0) {
      const rawInserts = records.map(record => ({
        connection_id,
        provider,
        object_type,
        external_id: adapter.getExternalId(record),
        payload: record,
      }));

      try {
        // Because source_objects can be large, insert in chunks
        const CHUNK_SIZE = 500;
        for (let i = 0; i < rawInserts.length; i += CHUNK_SIZE) {
          const chunk = rawInserts.slice(i, i + CHUNK_SIZE);
          const { error: insertError } = await supabase
            .schema('raw')
            .from('source_objects')
            .insert(chunk);
          
          if (insertError) throw insertError;
        }
      } catch (rawErr) {
        if (isRawSchemaUnavailableError(rawErr)) {
          rawWriteAvailable = false;
          console.warn(`[Sync] Job ${id} | Raw schema unavailable, continuing with direct normalization`);
        } else {
          throw rawErr;
        }
      }
    }

    // 5.5 Update connector object sync stats
    await supabase
      .from('connector_objects')
      .update({
        last_synced_at: new Date().toISOString(),
        records_synced: (job.records_fetched || 0) + records.length,
      })
      .eq('connection_id', connection_id)
      .eq('object_type', object_type);

    // 6. Mark job completed
    await supabase
      .from('sync_jobs')
      .update({
        status: 'completed',
        records_fetched: records.length,
        records_upserted: records.length,
        completed_at: new Date().toISOString(),
        error: null,
      })
      .eq('id', id);

    // 7. Trigger Normalization Pipeline
    // If raw schema is unavailable in PostgREST, normalize directly from fetched records.
    console.log(`[Sync] Job ${id} | Triggering Normalization for ${provider}...`);
    if (rawWriteAvailable) {
      await runNormalizationPipeline(supabase, connection_id, provider, { userId: connection.user_id });
    } else {
      await normalizeObjectBatchDirectly(
        supabase,
        connection_id,
        provider,
        object_type,
        records,
        { userId: connection.user_id }
      );
    }

    console.log(`[Sync] Job ${id} | Done in ${Date.now() - startedAt}ms.`);
    return true;

  } catch (error) {
    console.error(`[Sync] Job ${id} | FAILED:`, error.message);

    if (isRawSchemaUnavailableError(error) && connection && adapter) {
      try {
        await normalizeObjectBatchDirectly(
          supabase,
          connection_id,
          provider,
          object_type,
          records,
          { userId: connection.user_id }
        );

        await supabase
          .from('sync_jobs')
          .update({
            status: 'completed',
            records_fetched: records.length,
            records_upserted: records.length,
            completed_at: new Date().toISOString(),
            error: null,
          })
          .eq('id', id);

        console.warn(`[Sync] Job ${id} | Completed via fallback after raw schema error.`);
        return true;
      } catch (fallbackError) {
        console.error(`[Sync] Job ${id} | Fallback failed:`, fallbackError.message);
      }
    }

    if (/Unsupported .* object type/i.test(String(error?.message || ''))) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'cancelled',
          error: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', id);
      console.warn(`[Sync] Job ${id} | CANCELLED unsupported object ${object_type}`);
      return true;
    }

    const retryable = error?.retryable === true;
    const canRetry = retryable && currentAttempt < maxAttempts;
    const nextRunAt = new Date(Date.now() + Math.min(60_000 * Math.pow(2, currentAttempt - 1), 10 * 60_000)).toISOString();
    
    // Mark failed or requeue with backoff
    if (canRetry) {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'pending',
          error: error.message,
          scheduled_at: nextRunAt,
        })
        .eq('id', id);
      console.warn(`[Sync] Job ${id} scheduled for retry at ${nextRunAt} (attempt ${currentAttempt}/${maxAttempts})`);
    } else {
      await supabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          error: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', id);
    }

    return false;
  }
}

function isRawSchemaUnavailableError(error) {
  const msg = String(error?.message || '');
  return msg.includes('Invalid schema: raw') || msg.includes("public.raw.source_objects");
}

function prepareRecordForUpsert(record) {
  if (!record || !record.external_id) return null;

  const clean = {};
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('_')) continue;
    clean[key] = value;
  }

  return clean;
}

async function normalizeObjectBatchDirectly(supabase, connectionId, provider, objectType, records, meta) {
  const rawLikeRecords = (records || []).map(record => ({
    external_id: record?.id,
    payload: record,
  }));

  const result = await normalizeRecords(
    supabase,
    connectionId,
    provider,
    objectType,
    rawLikeRecords,
    meta,
  );

  if (result.normalized.length > 0) {
    const rowsToUpsert = result.normalized
      .map(prepareRecordForUpsert)
      .filter(Boolean);

    if (rowsToUpsert.length === 0) return;

    const { error: upsertError } = await supabase
      .from(result.targetTable)
      .upsert(
        rowsToUpsert,
        { onConflict: 'connection_id,provider,external_id' }
      );
    if (upsertError) throw upsertError;
  }

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
