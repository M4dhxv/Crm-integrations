/**
 * Background Worker Daemon
 * Polls the sync_jobs table and executes pending jobs
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { processSyncJob } from './sync/index.js';

dotenv.config();

// Use Service Role key for backend worker (bypasses RLS)
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("CRITICAL: Supabase URL or Service Key missing. Worker cannot start.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const POLL_INTERVAL_MS = 10000; // 10 seconds

let isRunning = false;

async function pollJobs() {
  if (isRunning) return;
  isRunning = true;

  try {
    // Look for pending jobs, or jobs stuck in 'running' for > 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data: jobs, error } = await supabase
      .from('sync_jobs')
      .select('*')
      .or(`status.eq.pending,and(status.eq.running,started_at.lt.${oneHourAgo})`)
      .order('created_at', { ascending: true })
      .limit(5);

    if (error) {
      console.error("[Worker] DB error fetching jobs:", error.message);
      return;
    }

    if (!jobs || jobs.length === 0) {
      // no jobs pending
      return;
    }

    console.log(`[Worker] Found ${jobs.length} pending job(s)`);

    // Process them sequentially for log clarity, but could be P.all
    for (const job of jobs) {
      await processSyncJob(job, supabase);
    }

  } catch (err) {
    console.error("[Worker] Unknown error in polling loop:", err);
  } finally {
    isRunning = false;
  }
}

// Start polling
console.log(`[Worker] Starting Data Sync Engine... (Polling every ${POLL_INTERVAL_MS/1000}s)`);
setInterval(pollJobs, POLL_INTERVAL_MS);

// Initial immediate poll
pollJobs();
