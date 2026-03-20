import { requireAuth } from './auth.js';
import { renderNav } from './nav.js';
import { supabase } from './supabase.js';

const API_URL = import.meta.env.VITE_BACKEND_URL || '';

// Provider static data for UI
const PROVIDERS = {
    salesforce: { name: 'Salesforce', iconClass: 'provider-salesforce', icon: '☁️' },
    hubspot: { name: 'HubSpot', iconClass: 'provider-hubspot', icon: '🟧' },
    gong: { name: 'Gong', iconClass: 'provider-gong', icon: '🟣' },
    pipedrive: { name: 'Pipedrive', iconClass: 'provider-pipedrive', icon: '🟢' },

};

async function init() {
    const session = await requireAuth();
    if (!session) return;

    await renderNav('app-nav');
    await loadDashboardData();
}

async function loadDashboardData() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            showToast('Please log in to view dashboard', 'error');
            return;
        }

        // Load real data from backend
        const token = session.access_token;
        
        // Fetch connections
        const connRes = await fetch(`${API_URL}/api/connections`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!connRes.ok) {
            // Graceful fallback if backend is down
            console.warn('Connections API error:', connRes.status);
            renderStats({ connections: [], totalContacts: 0, totalDeals: 0, avgQualityScore: 0 });
            renderEmptyState();
            return;
        }

        const connData = await connRes.json();
        const connections = connData.data || [];

        // If no connections, show empty state
        if (!connections || connections.length === 0) {
            renderStats({ connections: [], totalContacts: 0, totalDeals: 0, avgQualityScore: 0 });
            renderEmptyState();
            return;
        }

        // Fetch stats
        const statsRes = await fetch(`${API_URL}/api/normalized/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const statsData = statsRes.ok ? await statsRes.json() : { avgQualityScore: 0 };

        let totalContacts = 0;
        let totalDeals = 0;
        connections.forEach(c => {
            totalContacts += (c.contact_count || 0);
            totalDeals += (c.deal_count || 0);
        });

        const mockData = {
            totalContacts: totalContacts,
            totalDeals: totalDeals,
            avgQualityScore: statsData.avgQualityScore || 0,
            connections: connections
        };

        renderStats(mockData);
        renderSourceList(mockData.connections);

    } catch (error) {
        console.error('Error loading dashboard:', error);
        renderStats({ connections: [], totalContacts: 0, totalDeals: 0, avgQualityScore: 0 });
        renderEmptyState();
    }
}

function renderEmptyState() {
    const container = document.getElementById('source-list');
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔌</div>
        <h3 class="empty-state-title">No CRM connections yet</h3>
        <p class="empty-state-text">Connect your first CRM to start syncing data into your unified dashboard.</p>
        <a href="/connectors.html" class="btn btn-primary">Connect a CRM</a>
      </div>
    `;
}

function renderStats(data) {
    const container = document.getElementById('dashboard-stats');

    // Calculate system health based on connections
    const hasErrors = data.connections.some(c => c.health_status === 'critical' || c.health_status === 'degraded');
    const healthLabel = data.connections.length === 0 ? 'No Data' : (hasErrors ? 'Degraded' : 'Healthy');
    const healthColorClass = data.connections.length === 0 ? 'text-secondary' : (hasErrors ? 'text-warning' : 'text-success');

    // Data quality color
    const qualityScore = data.avgQualityScore || 0;
    const qualityColor = qualityScore >= 80 ? 'text-success' : qualityScore >= 50 ? 'text-warning' : 'text-danger';

    container.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Connections</div>
      <div class="stat-value">${data.connections.length}</div>
      <div class="stat-change text-secondary">Active integrations</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Contacts</div>
      <div class="stat-value">${data.totalContacts.toLocaleString()}</div>
      <div class="stat-change stat-change-positive">Synced across all sources</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Deals</div>
      <div class="stat-value">${data.totalDeals.toLocaleString()}</div>
      <div class="stat-change stat-change-positive">Synced across all sources</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Data Quality</div>
      <div class="stat-value ${qualityColor}">${qualityScore}<span style="font-size:var(--font-size-sm);color:var(--text-tertiary);font-weight:400">/100</span></div>
      <div class="stat-change text-secondary"><a href="/normalization.html" style="font-size:var(--font-size-xs)">View analysis →</a></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">System Health</div>
      <div class="stat-value ${healthColorClass}">${healthLabel}</div>
      <div class="stat-change text-secondary">Based on recent sync jobs</div>
    </div>
  `;
}

function renderSourceList(connections) {
    const container = document.getElementById('source-list');

    if (connections.length === 0) {
        container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔌</div>
        <h3 class="empty-state-title">No CRM connections yet</h3>
        <p class="empty-state-text">Connect your first CRM to start syncing data into your unified dashboard.</p>
        <a href="/connectors.html" class="btn btn-primary">Connect a Provider</a>
      </div>
    `;
        return;
    }

    container.innerHTML = connections.map(conn => {
        const providerInfo = PROVIDERS[conn.provider] || { name: conn.provider, iconClass: 'bg-secondary', icon: '📦' };

        // Determine badge class
        let badgeClass = 'badge-healthy';
        if (conn.status === 'syncing') badgeClass = 'badge-syncing badge-dot';
        else if (conn.health_status === 'degraded') badgeClass = 'badge-degraded';
        else if (conn.health_status === 'critical' || conn.status === 'error') badgeClass = 'badge-error';

        return `
      <div class="source-row">
        <div class="provider-icon provider-icon-sm ${providerInfo.iconClass}">
          ${providerInfo.icon}
        </div>
        
        <div class="source-info">
          <div class="source-name flex items-center gap-sm">
            ${providerInfo.name}
            ${conn.display_name ? `<span class="text-xs text-secondary font-normal">(${conn.display_name})</span>` : ''}
          </div>
          <div class="source-meta">
            <span>Sync: ${conn.sync_frequency}</span>
            <span>•</span>
            <span>Last sync: ${conn.last_sync_at}</span>
            <span>•</span>
            <span>${conn.contact_count.toLocaleString()} contacts</span>
          </div>
        </div>
        
        <div class="source-actions">
          <span class="badge ${badgeClass} mr-md hidden-mobile">
            ${conn.status === 'syncing' ? 'Syncing...' : (conn.health_status || 'Healthy')}
          </span>
          <button class="btn btn-secondary btn-sm" onclick="alert('View details for ${providerInfo.name}')">Details</button>
          <button class="btn btn-secondary btn-icon" title="Sync Now" onclick="alert('Started manual sync for ${providerInfo.name}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          </button>
          <button class="btn btn-secondary btn-icon" title="Disconnect" style="color:var(--danger);border-color:transparent" onclick="disconnectProvider('${conn.id}')">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
          </button>
        </div>
      </div>
    `;
    }).join('');
}

// Simple toast notification helper
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
    <div class="toast-message">${message}</div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 250);
    }, 4000);
}

// ---- Real Data Fetching ----
async function loadData() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return { stats: null, connections: [] };

        const token = session.access_token;
        const connRes = await fetch(`${API_URL}/api/connections`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const connData = await connRes.json();
        const connections = connData.data || [];

        const statsRes = await fetch(`${API_URL}/api/normalized/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const statsData = await statsRes.json();

        let totalContacts = 0;
        let totalDeals = 0;
        connections.forEach(c => {
            totalContacts += (c.contact_count || 0);
            totalDeals += (c.deal_count || 0);
        });

        return {
            totalContacts: totalContacts,
            totalDeals: totalDeals,
            avgQualityScore: statsData.avgQualityScore || 0,
            connections: connections
        };
    } catch (err) {
        console.error("Error loading dashboard data", err);
        return { totalContacts: 0, totalDeals: 0, avgQualityScore: 0, connections: [] };
    }
}

window.disconnectProvider = async function(connId) {
    if (!confirm('Are you sure you want to disconnect this CRM? This will not delete your synchronized data, but will stop future syncs.')) {
        return;
    }
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        
        const btn = event.currentTarget.querySelector('svg');
        if (btn) btn.innerHTML = '<span class="spinner spinner-sm"></span>';

        const res = await fetch(`${API_URL}/api/connections/${connId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        
        if (res.ok) {
            window.showToast('Provider disconnected successfully');
            const data = await loadData();
            renderStats(data);
            renderSourceList(data.connections);
        } else {
            throw new Error('Failed to disconnect');
        }
    } catch (err) {
        window.showToast(err.message, 'danger');
    }
};

// Start app
document.addEventListener('DOMContentLoaded', async () => {
    // Check for success/error query params from OAuth redirect
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get('status');
    const provider = urlParams.get('provider');
    if (status === 'success') {
        setTimeout(() => window.showToast(`Successfully connected to ${provider}!`), 500);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (status === 'error') {
        setTimeout(() => window.showToast(`Failed to connect to ${provider}.`, 'danger'), 500);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    init();
});

