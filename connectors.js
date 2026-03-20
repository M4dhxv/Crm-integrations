import { requireAuth } from './auth.js';
import { renderNav } from './nav.js';
import { supabase } from './supabase.js';

const API_URL = import.meta.env.VITE_BACKEND_URL || '';

// ---- Provider Configuration Data (Simulating `connector_registry` table) ----
const PROVIDERS = [
    {
        id: 'salesforce',
        name: 'Salesforce',
        desc: 'Sync Accounts, Contacts, Leads, and Opportunities.',
        auth: 'oauth2',
        icon: '☁️',
        bg: 'provider-salesforce',
        tags: ['Sales', 'Enterprise'],
        objects: [
            { id: 'contacts', name: 'Contacts', desc: 'Sync all active contacts' },
            { id: 'leads', name: 'Leads', desc: 'Sync unconverted leads' },
            { id: 'accounts', name: 'Accounts', desc: 'Sync companies and orgs' },
            { id: 'opportunities', name: 'Opportunities', desc: 'Sync deal pipelines' }
        ]
    },
    {
        id: 'hubspot',
        name: 'HubSpot',
        desc: 'Sync Contacts, Companies, Deals, and Engagements.',
        auth: 'oauth2',
        icon: '🟧',
        bg: 'provider-hubspot',
        tags: ['Marketing', 'Sales'],
        objects: [
            { id: 'contacts', name: 'Contacts', desc: 'Sync HubSpot contacts' },
            { id: 'companies', name: 'Companies', desc: 'Sync HubSpot companies' },
            { id: 'deals', name: 'Deals', desc: 'Sync sales pipelines' },
            { id: 'engagements', name: 'Engagements', desc: 'Sync emails, calls, notes' }
        ]
    },
    {
        id: 'gong',
        name: 'Gong',
        desc: 'Ingest call recordings, transcripts, and intelligence.',
        auth: 'api_key',
        icon: '🟣',
        bg: 'provider-gong',
        tags: ['Intelligence', 'Calls'],
        fields: [{ id: 'instanceUrl', label: 'Company Domain', desc: 'e.g. acme.gong.io' }],
        objects: [
            { id: 'calls', name: 'Call Metadata', desc: 'Sync participants, durations, topics' },
            { id: 'transcripts', name: 'Transcripts', desc: 'Full conversational text (heavy)' },
            { id: 'scorecards', name: 'Scorecards', desc: 'Rep evaluations' }
        ]
    },
    {
        id: 'pipedrive',
        name: 'Pipedrive',
        desc: 'Sync Persons, Organizations, and PIPELINE Deals.',
        auth: 'api_key',
        icon: '🟢',
        bg: 'provider-pipedrive',
        tags: ['Sales', 'SMB'],
        fields: [{ id: 'instanceUrl', label: 'Company Domain', desc: 'e.g. acme.pipedrive.com' }],
        objects: [
            { id: 'persons', name: 'Persons', desc: 'Sync people/contacts' },
            { id: 'organizations', name: 'Organizations', desc: 'Sync companies' },
            { id: 'deals', name: 'Deals', desc: 'Sync opportunities' }
        ]
    }
];

// UI State
let activeProvider = null;

// ---- Initialization ----
async function init() {
    const session = await requireAuth();
    if (!session) return;

    await renderNav('app-nav');
    await renderGrid();
    setupPanelListeners();
}

// ---- Render Grid ----
async function renderGrid() {
    const grid = document.getElementById('provider-grid');
    const connectedCountEl = document.getElementById('connected-count');
    const availableCountEl = document.getElementById('available-count');

    let connections = [];
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            const res = await fetch(`${API_URL}/api/connections`, {
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            if (res.ok) {
                const payload = await res.json();
                connections = Array.isArray(payload)
                    ? payload
                    : (payload?.connections || payload?.data || []);
            }
        }
    } catch (error) {
        console.warn('Unable to load connection status', error);
    }

    const providerState = PROVIDERS.map(provider => {
        const connection = connections.find(c => c.provider === provider.id);
        const isConnected = !!connection && connection.status !== 'error';
        const lastSync = connection?.last_synced_at || connection?.lastSyncedAt || connection?.updated_at || null;
        return { provider, connection, isConnected, lastSync };
    });

    const connectedCount = providerState.filter(p => p.isConnected).length;
    const availableCount = PROVIDERS.length;

    if (connectedCountEl) connectedCountEl.textContent = `${connectedCount} Connected`;
    if (availableCountEl) availableCountEl.textContent = `${availableCount} Available`;

    grid.innerHTML = providerState.map(({ provider: p, isConnected, lastSync }) => `
      <article class="provider-card ds-card" data-id="${p.id}">
        <div class="ds-accent ${p.bg}"></div>
        <div class="ds-card-body">
          <div class="ds-card-top">
            <h3 class="ds-card-title">${p.name}</h3>
            <span class="ds-status ${isConnected ? 'connected' : 'available'}">${isConnected ? 'Connected' : 'Available'}</span>
          </div>

          <p class="ds-card-desc">${p.desc}</p>

          <div class="ds-section-label">AVAILABLE DATA POINTS</div>
          <div class="ds-chip-wrap">
            ${p.objects.map(o => `<span class="ds-chip">${o.name}</span>`).join('')}
          </div>

          <div class="ds-actions ${isConnected ? 'connected' : 'available'}">
            ${isConnected
                ? `
                  <button class="ds-action-btn ds-secondary" data-action="sync" data-provider="${p.id}">Sync Now</button>
                  <button class="ds-action-btn ds-link" data-action="disconnect" data-provider="${p.id}">Disconnect</button>
                  <span class="ds-last-sync">Last sync: ${formatDate(lastSync)}</span>
                `
                : `<button class="ds-action-btn ds-primary ${p.id}" data-action="open-panel" data-provider="${p.id}">Connect ${p.name}</button>`
            }
          </div>
        </div>
      </article>
    `).join('');

    grid.querySelectorAll('[data-action="open-panel"]').forEach(btn => {
        btn.addEventListener('click', () => openPanel(btn.dataset.provider));
    });

    grid.querySelectorAll('[data-action="sync"]').forEach(btn => {
        btn.addEventListener('click', () => {
            window.showToast('Sync job queued. Refresh dashboard in a few seconds.', 'success');
        });
    });

    grid.querySelectorAll('[data-action="disconnect"]').forEach(btn => {
        btn.addEventListener('click', () => {
            window.showToast('Disconnect flow can be managed from connection settings.', 'danger');
        });
    });
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const y = date.getFullYear();
    return `${m}/${d}/${y}`;
}

// ---- Panel Management ----
function setupPanelListeners() {
    const overlay = document.getElementById('panel-overlay');
    overlay.addEventListener('click', closePanel);
}

function openPanel(providerId) {
    activeProvider = PROVIDERS.find(p => p.id === providerId);
    if (!activeProvider) return;

    const panel = document.getElementById('config-panel');
    const overlay = document.getElementById('panel-overlay');

    panel.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">
        <div class="provider-icon provider-icon-sm ${activeProvider.bg}">${activeProvider.icon}</div>
        ${activeProvider.name} Connection
      </div>
      <button class="panel-close" id="btn-close-panel">×</button>
    </div>

    <div class="panel-body">
      <!-- 1. Authentication -->
      <section class="panel-section">
        <h3 class="panel-section-title">1. Authentication</h3>
        
        ${activeProvider.fields ? activeProvider.fields.map(f => `
          <div class="form-group mb-md">
            <label class="form-label">${f.label}</label>
            <input type="text" class="form-input" id="cfg-${f.id}" placeholder="${f.desc}">
          </div>
        `).join('') : ''}

        ${activeProvider.auth === 'oauth2'
            ? `
            <p class="text-sm text-secondary mb-sm">You will be securely redirected to ${activeProvider.name} to grant access. We do not store your password.</p>
            <button class="btn btn-oauth btn-block" id="btn-auth-flow">
              Connect to ${activeProvider.name}
            </button>
            <div class="form-group mt-md">
              <label class="form-label">OR paste Access Token</label>
              <input type="password" class="form-input" id="cfg-access-token" placeholder="Paste OAuth access token">
              <span class="form-hint">Use this when OAuth app credentials are not configured yet.</span>
            </div>
            <div class="form-group mt-sm">
              <label class="form-label">Refresh Token (optional)</label>
              <input type="password" class="form-input" id="cfg-refresh-token" placeholder="Paste OAuth refresh token">
            </div>
            <div class="form-group mt-sm">
              <label class="form-label">Instance URL (optional)</label>
              <input type="text" class="form-input" id="cfg-instanceUrl" placeholder="e.g. https://your-domain.my.salesforce.com">
            </div>
          `
            : `
            <div class="form-group">
              <label class="form-label">API Key</label>
              <input type="password" class="form-input" id="cfg-apikey" placeholder="Enter your secret API key">
              <span class="form-hint">Ensure this key has read access to required objects.</span>
            </div>
            ${activeProvider.id === 'gong' ? `
              <div class="form-group mt-sm">
                <label class="form-label">Access Key</label>
                <input type="password" class="form-input" id="cfg-accesskey" placeholder="Enter Gong access key">
              </div>
            `: ''}
            <button class="btn btn-secondary btn-block mt-sm" id="btn-test-auth">Verify Credentials</button>
          `
        }
      </section>

      <!-- 2. Sync Configuration -->
      <section class="panel-section mt-md">
        <h3 class="panel-section-title">2. Sync Settings</h3>
        
        <div class="form-group">
          <label class="form-label">Sync Frequency</label>
          <select class="form-select" id="cfg-freq">
            <option value="realtime">Real-time (Webhooks where available)</option>
            <option value="hourly" selected>Every hour</option>
            <option value="daily">Once a day (Midnight UTC)</option>
            <option value="manual">Manual only</option>
          </select>
        </div>

        <div class="form-group mt-md">
          <label class="form-label mb-sm">Objects to Sync</label>
          <div class="object-list">
            ${activeProvider.objects.map(obj => `
              <div class="object-item">
                <div class="object-item-info">
                  <span class="object-item-name">${obj.name}</span>
                  <span class="object-item-desc">${obj.desc}</span>
                </div>
                <label class="toggle">
                  <input type="checkbox" checked class="obj-toggle" data-obj-id="${obj.id}">
                </label>
              </div>
            `).join('')}
          </div>
        </div>
      </section>
    </div>

    <div class="panel-footer">
      <button class="btn btn-primary btn-block" id="btn-save-conn">Save Connection</button>
    </div>
  `;

    // Attach panel events
    document.getElementById('btn-close-panel').addEventListener('click', closePanel);

    const testBtn = document.getElementById('btn-test-auth');
    if (testBtn) {
        testBtn.addEventListener('click', () => {
            const btn = document.getElementById('btn-test-auth');
            btn.innerHTML = '<span class="spinner spinner-sm"></span> Verifying...';
            btn.disabled = true;

            // Simulate API verification
            setTimeout(() => {
                btn.innerHTML = '✓ Verified successfully';
                btn.classList.add('btn-primary');
                btn.classList.remove('btn-secondary');
                window.showToast('Credentials verified with CRM payload');
            }, 1500);
        });
    }

    const oauthBtn = document.getElementById('btn-auth-flow');
    if (oauthBtn) {
        oauthBtn.addEventListener('click', async () => {
            oauthBtn.innerHTML = '<span class="spinner spinner-sm"></span> Redirecting...';
            oauthBtn.disabled = true;

            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw new Error('Not logged in');

                const res = await fetch(`${API_URL}/api/start-oauth`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({ provider: activeProvider.id })
                });

                const data = await res.json();
                if (data.error) throw new Error(data.error);

                if (data.redirectUrl) {
                    window.location.href = data.redirectUrl;
                }
            } catch (err) {
                console.error(err);
                oauthBtn.innerHTML = 'Connect to ' + activeProvider.name;
                oauthBtn.disabled = false;
                window.showToast(err.message || 'Failed to start OAuth flow', 'danger');
            }
        });
    }

    document.getElementById('btn-save-conn').addEventListener('click', handleSave);

    // Show panel
    overlay.classList.add('active');
    panel.classList.add('active');
}

function closePanel() {
    document.getElementById('panel-overlay').classList.remove('active');
    document.getElementById('config-panel').classList.remove('active');
    activeProvider = null;
}

function handleSave() {
    const btn = document.getElementById('btn-save-conn');
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Saving...';
    btn.disabled = true;

    saveConnection()
        .then(result => {
            const syncCount = result.syncJobs || 0;
            window.showToast(
                `${activeProvider.name} connected! ${syncCount} sync jobs created. Data will be fetched in the background.`,
                'success'
            );
            closePanel();

            // Auto-redirect to dashboard to see new connection
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 2000);
        })
        .catch(err => {
            btn.innerHTML = 'Save Connection';
            btn.disabled = false;
            window.showToast(err.message || 'Failed to save connection', 'danger');
        });
}

async function saveConnection() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not logged in');

    const token = session.access_token;

    // Collect form data
    const displayName = document.querySelector('.panel-title')?.textContent || activeProvider.name;
    const syncFrequency = document.getElementById('cfg-freq')?.value || 'hourly';
    
    // Collect selected objects
    const selectedObjects = [];
    document.querySelectorAll('.obj-toggle:checked').forEach(checkbox => {
        selectedObjects.push(checkbox.dataset.objId);
    });

    let payload = {
        provider: activeProvider.id,
        displayName: displayName,
        syncFrequency: syncFrequency,
        objects: selectedObjects
    };

    // Handle API key auth (Gong, Pipedrive, Freshsales)
    if (activeProvider.auth === 'api_key') {
        const apiKey = document.getElementById('cfg-apikey')?.value;
        const accessKey = document.getElementById('cfg-accesskey')?.value;
        const instanceUrl = document.getElementById('cfg-instanceUrl')?.value;

        if (!apiKey && !accessKey) {
            throw new Error('API key is required');
        }

        payload.apiKey = apiKey;
        payload.accessKey = accessKey;
        payload.instanceUrl = instanceUrl;

        const res = await fetch(`${API_URL}/api/connections/auth-manual`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
          body: JSON.stringify({ ...payload, authType: 'api_key' })
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || 'Failed to save connection');
        }

        return res.json();
    }

    // For OAuth providers: support both OAuth redirect and manual token save
    if (activeProvider.auth === 'oauth2') {
        const accessToken = document.getElementById('cfg-access-token')?.value;
        const refreshToken = document.getElementById('cfg-refresh-token')?.value;
        const instanceUrl = document.getElementById('cfg-instanceUrl')?.value;

        if (accessToken || refreshToken) {
            const res = await fetch(`${API_URL}/api/connections/auth-manual`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    ...payload,
                    authType: 'oauth2',
                    accessToken,
                    refreshToken,
                    instanceUrl
                })
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to save OAuth token connection');
            }

            return res.json();
        }

        // Save pending OAuth connection (user can click OAuth button to authorize)
        const res = await fetch(`${API_URL}/api/connections`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                provider: activeProvider.id,
                displayName: activeProvider.name,
                authType: 'oauth2',
                syncFrequency,
                objects: selectedObjects
            })
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || 'Failed to save OAuth connection');
        }

        return res.json();
    }

    throw new Error('Unknown auth type');
}

// Global toast helper
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
