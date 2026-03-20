import { requireAuth } from './auth.js';
import { renderNav } from './nav.js';
import { supabase } from './supabase.js';

// ---- Provider static data ----
const PROVIDERS = {
  salesforce: { name: 'Salesforce', icon: '☁️', bg: 'provider-salesforce', color: '#0070d2' },
  hubspot:    { name: 'HubSpot',    icon: '🟧', bg: 'provider-hubspot',    color: '#ff5c35' },
  gong:       { name: 'Gong',       icon: '🟣', bg: 'provider-gong',       color: '#7c3aed' },
  pipedrive:  { name: 'Pipedrive',  icon: '🟢', bg: 'provider-pipedrive',  color: '#017737' },
  outreach:   { name: 'Outreach',   icon: '🟣', bg: 'provider-outreach',   color: '#5952cc' },
  freshsales: { name: 'Freshsales', icon: '🟠', bg: 'provider-freshsales', color: '#f36f21' },
};

// ---- Init ----
async function init() {
  const session = await requireAuth();
  if (!session) return;

  await renderNav('app-nav');
  const data = await loadMockData();
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

// ---- MOCK DATA ----
async function loadMockData() {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        stats: {
          totalRecordsProcessed: 18420,
          totalRecordsNormalized: 17854,
          avgQualityScore: 78,
          totalRuns: 14,
          lastRunTime: '23 mins ago',
          unresolvedErrors: 12,
        },
        platforms: [
          {
            provider: 'salesforce',
            displayName: 'Production Org',
            avgQualityScore: 87,
            totalContacts: 8450,
            totalCompanies: 1240,
            totalDeals: 210,
            totalMappedFields: 22,
            qualityDistribution: { highPct: 72, medPct: 21, lowPct: 7 },
            fieldCoverage: {
              email: 0.94, phone: 0.68, first_name: 0.99, last_name: 1.0,
              title: 0.55, company_name: 0.82, department: 0.41,
              lead_source: 0.73, lifecycle_stage: 0.60,
            },
            unresolvedErrors: 3,
          },
          {
            provider: 'hubspot',
            displayName: 'Marketing Portal',
            avgQualityScore: 72,
            totalContacts: 5800,
            totalCompanies: 890,
            totalDeals: 174,
            totalMappedFields: 19,
            qualityDistribution: { highPct: 58, medPct: 30, lowPct: 12 },
            fieldCoverage: {
              email: 0.91, phone: 0.52, first_name: 0.96, last_name: 0.98,
              title: 0.38, company_name: 0.71, department: 0.22,
              lead_source: 0.65, lifecycle_stage: 0.88,
            },
            unresolvedErrors: 7,
          },
          {
            provider: 'pipedrive',
            displayName: 'Sales Team CRM',
            avgQualityScore: 64,
            totalContacts: 2100,
            totalCompanies: 450,
            totalDeals: 89,
            totalMappedFields: 12,
            qualityDistribution: { highPct: 41, medPct: 38, lowPct: 21 },
            fieldCoverage: {
              email: 0.85, phone: 0.44, first_name: 0.92, last_name: 0.95,
              title: 0.21, company_name: 0.60, department: 0.10,
              lead_source: 0.30, lifecycle_stage: null,
            },
            unresolvedErrors: 2,
          },
          {
            provider: 'gong',
            displayName: 'Call Intelligence',
            avgQualityScore: 91,
            totalContacts: 0,
            totalCompanies: 0,
            totalDeals: 0,
            totalMappedFields: 8,
            qualityDistribution: { highPct: 88, medPct: 9, lowPct: 3 },
            fieldCoverage: {
              email: null, phone: null, first_name: null, last_name: null,
              title: null, company_name: null, department: null,
              lead_source: null, lifecycle_stage: null,
            },
            unresolvedErrors: 0,
          }
        ],
        runs: [
          { provider: 'salesforce', status: 'completed', recordsProcessed: 8450, recordsNormalized: 8312, recordsErrored: 3, avgQualityScore: 87, timeAgo: '23 mins ago', duration: '4.2s' },
          { provider: 'hubspot', status: 'completed', recordsProcessed: 5800, recordsNormalized: 5614, recordsErrored: 7, avgQualityScore: 72, timeAgo: '23 mins ago', duration: '3.8s' },
          { provider: 'pipedrive', status: 'partial', recordsProcessed: 2100, recordsNormalized: 1988, recordsErrored: 2, avgQualityScore: 64, timeAgo: '1 hour ago', duration: '2.1s' },
          { provider: 'gong', status: 'completed', recordsProcessed: 340, recordsNormalized: 340, recordsErrored: 0, avgQualityScore: 91, timeAgo: '2 hours ago', duration: '0.8s' },
          { provider: 'salesforce', status: 'completed', recordsProcessed: 8200, recordsNormalized: 8100, recordsErrored: 1, avgQualityScore: 85, timeAgo: '1 day ago', duration: '4.0s' },
          { provider: 'hubspot', status: 'failed', recordsProcessed: 5800, recordsNormalized: 0, recordsErrored: 5800, avgQualityScore: 0, timeAgo: '2 days ago', duration: '0.3s' },
        ]
      });
    }, 700);
  });
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
