import { requireAuth } from './auth.js';
import { renderNav } from './nav.js';
import { supabase } from './supabase.js';
const API_URL = import.meta.env.VITE_BACKEND_URL || '';

// ---- Provider static data ----
const PROVIDERS = {
  salesforce: { name: 'Salesforce', icon: '☁️', bg: 'provider-salesforce', color: '#0070d2' },
  hubspot:    { name: 'HubSpot',    icon: '🟧', bg: 'provider-hubspot',    color: '#ff5c35' },
  gong:       { name: 'Gong',       icon: '🟣', bg: 'provider-gong',       color: '#7c3aed' },
  pipedrive:  { name: 'Pipedrive',  icon: '🟢', bg: 'provider-pipedrive',  color: '#017737' },

};

// ---- Init ----
async function init() {
  const session = await requireAuth();
  if (!session) return;

  await renderNav('app-nav');
  const data = await loadRealData();
  renderStats(data.stats);
  renderPlatformGrid(data.platforms);
  renderCoverageGrid(data.platforms);
  renderRunsLog(data.runs);
}

// ---- Render Overview Stats ----
function renderStats(stats) {
  const container = document.getElementById('norm-stats');

  const scoreColor = stats.avgQualityScore >= 80 ? 'text-success'
    : stats.avgQualityScore >= 50 ? 'text-warning' : 'text-danger';

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Records Processed</div>
      <div class="stat-value">${stats.totalRecordsProcessed.toLocaleString()}</div>
      <div class="stat-change text-secondary">${stats.totalRecordsNormalized.toLocaleString()} normalized</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg Quality Score</div>
      <div class="stat-value ${scoreColor}">${stats.avgQualityScore}<span class="norm-score-unit">/100</span></div>
      <div class="stat-change stat-change-positive">Across all platforms</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Normalization Runs</div>
      <div class="stat-value">${stats.totalRuns}</div>
      <div class="stat-change text-secondary">Last: ${stats.lastRunTime}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Unresolved Issues</div>
      <div class="stat-value ${stats.unresolvedErrors > 0 ? 'text-warning' : 'text-success'}">${stats.unresolvedErrors}</div>
      <div class="stat-change text-secondary">Transform errors</div>
    </div>
  `;
}

// ---- Render Platform Analysis Cards ----
function renderPlatformGrid(platforms) {
  const container = document.getElementById('platform-grid');

  if (platforms.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <h3 class="empty-state-title">No platforms to analyze</h3>
        <p class="empty-state-text">Connect your first CRM to see platform-wise data analysis.</p>
        <a href="/connectors.html" class="btn btn-primary">Connect a Provider</a>
      </div>
    `;
    return;
  }

  container.innerHTML = platforms.map(p => {
    const info = PROVIDERS[p.provider] || { name: p.provider, icon: '📦', bg: 'bg-secondary' };
    const scoreColor = p.avgQualityScore >= 80 ? 'var(--success)'
      : p.avgQualityScore >= 50 ? 'var(--warning)' : 'var(--danger)';
    const scorePercent = p.avgQualityScore;
    const circumference = 2 * Math.PI * 38;
    const offset = circumference - (scorePercent / 100) * circumference;

    return `
      <div class="norm-platform-card">
        <div class="norm-platform-header">
          <div class="provider-icon provider-icon-sm ${info.bg}">${info.icon}</div>
          <div class="norm-platform-info">
            <div class="norm-platform-name">${info.name}</div>
            <div class="norm-platform-sub">${p.displayName || 'Connected'}</div>
          </div>
          <div class="norm-quality-gauge">
            <svg viewBox="0 0 88 88" class="norm-gauge-svg">
              <circle cx="44" cy="44" r="38" fill="none" stroke="var(--border-subtle)" stroke-width="5"/>
              <circle cx="44" cy="44" r="38" fill="none" stroke="${scoreColor}" stroke-width="5"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                stroke-linecap="round" transform="rotate(-90 44 44)"
                class="norm-gauge-ring"/>
            </svg>
            <div class="norm-gauge-value">${scorePercent}</div>
          </div>
        </div>

        <div class="norm-platform-metrics">
          <div class="norm-metric">
            <span class="norm-metric-value">${p.totalContacts.toLocaleString()}</span>
            <span class="norm-metric-label">Contacts</span>
          </div>
          <div class="norm-metric">
            <span class="norm-metric-value">${p.totalCompanies.toLocaleString()}</span>
            <span class="norm-metric-label">Companies</span>
          </div>
          <div class="norm-metric">
            <span class="norm-metric-value">${p.totalDeals.toLocaleString()}</span>
            <span class="norm-metric-label">Deals</span>
          </div>
          <div class="norm-metric">
            <span class="norm-metric-value">${p.totalMappedFields}</span>
            <span class="norm-metric-label">Fields</span>
          </div>
        </div>

        <div class="norm-quality-bars">
          <div class="norm-quality-row">
            <span class="norm-quality-label">High quality</span>
            <div class="norm-bar-track">
              <div class="norm-bar-fill norm-bar-success" style="width: ${p.qualityDistribution.highPct}%"></div>
            </div>
            <span class="norm-quality-pct">${p.qualityDistribution.highPct}%</span>
          </div>
          <div class="norm-quality-row">
            <span class="norm-quality-label">Medium</span>
            <div class="norm-bar-track">
              <div class="norm-bar-fill norm-bar-warning" style="width: ${p.qualityDistribution.medPct}%"></div>
            </div>
            <span class="norm-quality-pct">${p.qualityDistribution.medPct}%</span>
          </div>
          <div class="norm-quality-row">
            <span class="norm-quality-label">Low quality</span>
            <div class="norm-bar-track">
              <div class="norm-bar-fill norm-bar-danger" style="width: ${p.qualityDistribution.lowPct}%"></div>
            </div>
            <span class="norm-quality-pct">${p.qualityDistribution.lowPct}%</span>
          </div>
        </div>

        <div class="norm-platform-footer">
          <span class="badge ${p.unresolvedErrors > 0 ? 'badge-degraded' : 'badge-healthy'}">${p.unresolvedErrors > 0 ? p.unresolvedErrors + ' issues' : 'Clean'}</span>
          <button class="btn btn-secondary btn-sm" onclick="alert('Running normalization for ${info.name}...')">Normalize</button>
        </div>
      </div>
    `;
  }).join('');
}

// ---- Render Field Coverage Grid ----
function renderCoverageGrid(platforms) {
  const container = document.getElementById('coverage-grid');

  if (platforms.length === 0) {
    container.innerHTML = '<p class="text-secondary">No platform data to display.</p>';
    return;
  }

  const allFields = ['email', 'phone', 'first_name', 'last_name', 'title', 'company_name', 'department', 'lead_source', 'lifecycle_stage'];

  let html = `
    <div class="norm-heatmap">
      <div class="norm-heatmap-header">
        <div class="norm-heatmap-label">Field</div>
        ${platforms.map(p => {
          const info = PROVIDERS[p.provider] || { name: p.provider, icon: '📦' };
          return `<div class="norm-heatmap-provider">${info.icon} ${info.name}</div>`;
        }).join('')}
      </div>
      ${allFields.map(field => `
        <div class="norm-heatmap-row">
          <div class="norm-heatmap-field">${formatFieldName(field)}</div>
          ${platforms.map(p => {
            const coverage = p.fieldCoverage[field];
            const pct = coverage !== undefined ? Math.round(coverage * 100) : null;
            const cellClass = pct === null ? 'norm-heat-na'
              : pct >= 80 ? 'norm-heat-high'
              : pct >= 50 ? 'norm-heat-med'
              : 'norm-heat-low';
            return `<div class="norm-heatmap-cell ${cellClass}">${pct !== null ? pct + '%' : '—'}</div>`;
          }).join('')}
        </div>
      `).join('')}
    </div>
  `;

  container.innerHTML = html;
}

// ---- Render Pipeline Run History ----
function renderRunsLog(runs) {
  const container = document.getElementById('runs-list');

  if (runs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚡</div>
        <h3 class="empty-state-title">No normalization runs yet</h3>
        <p class="empty-state-text">Run your first normalization to see pipeline history.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Provider</th>
          <th>Status</th>
          <th>Records</th>
          <th>Quality</th>
          <th>Errors</th>
          <th>Time</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${runs.map(run => {
          const info = PROVIDERS[run.provider] || { name: run.provider, icon: '📦', bg: 'bg-secondary' };
          const statusBadge = run.status === 'completed' ? 'badge-healthy'
            : run.status === 'partial' ? 'badge-degraded'
            : run.status === 'running' ? 'badge-syncing badge-dot'
            : 'badge-error';
          const scoreColor = run.avgQualityScore >= 80 ? 'text-success'
            : run.avgQualityScore >= 50 ? 'text-warning' : 'text-danger';

          return `
            <tr>
              <td>
                <div class="flex items-center gap-sm">
                  <div class="provider-icon provider-icon-sm ${info.bg}" style="width:24px;height:24px;font-size:12px">${info.icon}</div>
                  ${info.name}
                </div>
              </td>
              <td><span class="badge ${statusBadge}">${run.status}</span></td>
              <td>${run.recordsProcessed.toLocaleString()} → ${run.recordsNormalized.toLocaleString()}</td>
              <td class="${scoreColor}" style="font-weight:600">${run.avgQualityScore}/100</td>
              <td>${run.recordsErrored > 0 ? `<span class="text-warning">${run.recordsErrored}</span>` : '<span class="text-success">0</span>'}</td>
              <td class="text-secondary">${run.timeAgo}</td>
              <td class="text-secondary">${run.duration}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ---- Helpers ----
function formatFieldName(field) {
  return field.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function loadRealData() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return emptyNormalizationData();

    const headers = { Authorization: `Bearer ${session.access_token}` };

    const [statsRes, platformRes, runsRes, connectionsRes] = await Promise.all([
      fetch(`${API_URL}/api/normalized/stats`, { headers }),
      fetch(`${API_URL}/api/normalized/platform-analysis`, { headers }),
      fetch(`${API_URL}/api/normalized/runs?limit=30&offset=0`, { headers }),
      fetch(`${API_URL}/api/connections`, { headers }),
    ]);

    const statsRaw = statsRes.ok ? await statsRes.json() : {};
    const platformRaw = platformRes.ok ? ((await platformRes.json())?.data || []) : [];
    const runsRaw = runsRes.ok ? ((await runsRes.json())?.data || []) : [];
    const connections = connectionsRes.ok ? ((await connectionsRes.json())?.data || []) : [];

    const connById = new Map(connections.map(c => [c.id, c]));

    const companyCounts = {};
    await Promise.all(connections.map(async (conn) => {
      const { count } = await supabase
        .from('crm_companies')
        .select('*', { count: 'exact', head: true })
        .eq('connection_id', conn.id)
        .eq('is_deleted', false);
      companyCounts[conn.id] = count || 0;
    }));

    const platforms = platformRaw.map((p) => {
      const conn = connById.get(p.connectionId) || {};
      const dist = p.qualityDistribution || {};
      const high = Number(dist.high || 0);
      const medium = Number(dist.medium || 0);
      const low = Number(dist.low || 0);
      const total = high + medium + low;

      return {
        provider: p.provider,
        displayName: p.displayName || conn.display_name || 'Connected',
        avgQualityScore: Number(p.avgQualityScore || 0),
        totalContacts: Number(conn.contact_count || 0),
        totalCompanies: Number(companyCounts[p.connectionId] || 0),
        totalDeals: Number(conn.deal_count || 0),
        totalMappedFields: Number(p.totalMappedFields || 0),
        qualityDistribution: {
          highPct: total > 0 ? Math.round((high / total) * 100) : 0,
          medPct: total > 0 ? Math.round((medium / total) * 100) : 0,
          lowPct: total > 0 ? Math.round((low / total) * 100) : 0,
        },
        fieldCoverage: p.fieldCoverage || {},
        unresolvedErrors: Number(p.unresolvedErrors || 0),
      };
    });

    const runs = runsRaw.map(run => ({
      provider: run.provider,
      status: run.status,
      recordsProcessed: Number(run.records_processed || 0),
      recordsNormalized: Number(run.records_normalized || 0),
      recordsErrored: Number(run.records_errored || 0),
      avgQualityScore: Number(run.avg_quality_score || 0),
      timeAgo: formatTimeAgo(run.completed_at || run.started_at || run.created_at),
      duration: formatDuration(run.started_at, run.completed_at),
    }));

    return {
      stats: {
        totalRecordsProcessed: Number(statsRaw.totalRecordsProcessed || 0),
        totalRecordsNormalized: Number(statsRaw.totalRecordsNormalized || 0),
        avgQualityScore: Number(statsRaw.avgQualityScore || 0),
        totalRuns: Number(statsRaw.totalRuns || 0),
        lastRunTime: formatTimeAgo(statsRaw?.lastNormalizationRun?.completed_at),
        unresolvedErrors: Number(statsRaw.unresolvedErrors || 0),
      },
      platforms,
      runs,
    };
  } catch (error) {
    console.error('Failed to load normalization data:', error);
    return emptyNormalizationData();
  }
}

function emptyNormalizationData() {
  return {
    stats: {
      totalRecordsProcessed: 0,
      totalRecordsNormalized: 0,
      avgQualityScore: 0,
      totalRuns: 0,
      lastRunTime: 'Never',
      unresolvedErrors: 0,
    },
    platforms: [],
    runs: [],
  };
}

function formatTimeAgo(dateValue) {
  if (!dateValue) return 'Never';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return '—';
  const start = new Date(startedAt);
  const end = new Date(completedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
  const seconds = Math.max(0, (end.getTime() - start.getTime()) / 1000);
  return `${seconds.toFixed(1)}s`;
}

// Toast helper
window.showToast = function (message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<div class="toast-message">${message}</div><button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

document.addEventListener('DOMContentLoaded', init);
