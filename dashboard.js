import { requireAuth } from './auth.js';
import { renderNav } from './nav.js';
import { supabase } from './supabase.js';

// Provider static data for UI
const PROVIDERS = {
    salesforce: { name: 'Salesforce', iconClass: 'provider-salesforce', icon: '☁️' },
    hubspot: { name: 'HubSpot', iconClass: 'provider-hubspot', icon: '🟧' },
    gong: { name: 'Gong', iconClass: 'provider-gong', icon: '🟣' },
    pipedrive: { name: 'Pipedrive', iconClass: 'provider-pipedrive', icon: '🟢' },
    outreach: { name: 'Outreach', iconClass: 'provider-outreach', icon: '🟣' },
    freshsales: { name: 'Freshsales', iconClass: 'provider-freshsales', icon: '🟠' }
};

async function init() {
    const session = await requireAuth();
    if (!session) return;

    await renderNav('app-nav');
    await loadDashboardData();
}

async function loadDashboardData() {
    try {
        // In a real app we would query the dashboard_stats view:
        // const { data, error } = await supabase.from('dashboard_stats').select('*');

        // For this UI mockup without backend data populated, we'll simulate it:
        const mockData = await simulateSupabaseFetch();

        renderStats(mockData);
        renderSourceList(mockData.connections);

    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Failed to load dashboard data', 'error');
    }
}

function renderStats(data) {
    const container = document.getElementById('dashboard-stats');

    // Calculate system health based on connections
    const hasErrors = data.connections.some(c => c.health_status === 'critical' || c.health_status === 'degraded');
    const healthLabel = data.connections.length === 0 ? 'No Data' : (hasErrors ? 'Degraded' : 'Healthy');
    const healthColorClass = data.connections.length === 0 ? 'text-secondary' : (hasErrors ? 'text-warning' : 'text-success');

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

// ---- MOCK DATA GENERATOR ----
// Simulates the dashboard_stats view query for UI demonstration
async function simulateSupabaseFetch() {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve({
                totalContacts: 14250,
                totalDeals: 384,
                connections: [
                    {
                        id: '1',
                        provider: 'salesforce',
                        display_name: 'Production Org',
                        status: 'connected',
                        sync_frequency: 'hourly',
                        health_status: 'healthy',
                        last_sync_at: '12 mins ago',
                        contact_count: 8450,
                        deal_count: 210
                    },
                    {
                        id: '2',
                        provider: 'hubspot',
                        display_name: 'Marketing Portal',
                        status: 'syncing',
                        sync_frequency: 'realtime',
                        health_status: 'healthy',
                        last_sync_at: 'Just now',
                        contact_count: 5800,
                        deal_count: 174
                    }
                ]
            });
        }, 600);
    });
}

// Start app
document.addEventListener('DOMContentLoaded', init);
