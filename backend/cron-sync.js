/**
 * Run-once Sync Processor (Cron-friendly)
 *
 * Designed for scheduled execution environments (Railway Cron):
 * - Starts
 * - Processes a small batch of queued jobs
 * - Exits cleanly
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { processSyncJob } from './sync/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const BATCH_SIZE = Number(process.env.CRON_SYNC_BATCH_SIZE || 3);
const SCRIPT_TIMEOUT_MS = Number(process.env.CRON_SYNC_SCRIPT_TIMEOUT_MS || 8 * 60 * 1000);
const JOB_TIMEOUT_MS = Number(process.env.CRON_SYNC_JOB_TIMEOUT_MS || 90 * 1000);
const DB_OP_MAX_RETRIES = Number(process.env.CRON_SYNC_DB_RETRIES || 3);

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

function log(level, message, meta = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
  let attempt = 0;
  while (attempt < DB_OP_MAX_RETRIES) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      if (attempt >= DB_OP_MAX_RETRIES) throw error;
      const delay = 300 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
      log('warn', `${label} failed, retrying`, { attempt, delay, error: error?.message || String(error) });
      await sleep(delay);
    }
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function fetchPendingJobs(supabase) {
  const nowIso = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('sync_jobs')
    .select('*')
    .or(`and(status.eq.pending,scheduled_at.lte.${nowIso}),and(status.eq.running,started_at.lt.${oneHourAgo})`)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) throw error;
  return data || [];
}

async function markTimedOutJob(supabase, jobId, message) {
  await supabase
    .from('sync_jobs')
    .update({
      status: 'failed',
      error: message,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

async function main() {
  const startedAt = Date.now();
  log('info', 'cron-sync start', { batchSize: BATCH_SIZE, scriptTimeoutMs: SCRIPT_TIMEOUT_MS, jobTimeoutMs: JOB_TIMEOUT_MS });

  if (!supabaseUrl || !supabaseServiceKey) {
    log('error', 'missing Supabase configuration', {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseServiceKey: Boolean(supabaseServiceKey),
    });
    process.exit(1);
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const jobs = await withRetry(() => fetchPendingJobs(supabase), 'fetchPendingJobs');
    log('info', 'jobs fetched', { count: jobs.length });

    for (const job of jobs) {
      if (Date.now() - startedAt > SCRIPT_TIMEOUT_MS) {
        log('warn', 'script timeout budget reached; exiting early', { processed, succeeded, failed });
        break;
      }

      processed += 1;
      log('info', 'job start', { jobId: job.id, provider: job.provider, objectType: job.object_type, attempt: (job.attempts || 0) + 1 });

      try {
        const ok = await withTimeout(processSyncJob(job, supabase), JOB_TIMEOUT_MS, `job ${job.id}`);
        if (ok) {
          succeeded += 1;
          log('info', 'job success', { jobId: job.id });
        } else {
          failed += 1;
          log('warn', 'job failed', { jobId: job.id });
        }
      } catch (error) {
        failed += 1;
        const message = error?.message || String(error);
        log('error', 'job error', { jobId: job.id, error: message });
        await withRetry(() => markTimedOutJob(supabase, job.id, message), 'markTimedOutJob');
      }
    }

    log('info', 'cron-sync finished', {
      processed,
      succeeded,
      failed,
      durationMs: Date.now() - startedAt,
    });
    process.exit(0);
  } catch (error) {
    log('error', 'cron-sync fatal', {
      error: error?.message || String(error),
      durationMs: Date.now() - startedAt,
    });
    process.exit(1);
  }
}

main();
