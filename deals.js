import { requireAuth } from './auth.js';
import { renderNav } from './nav.js';
import { supabase } from './supabase.js';

const API_URL = import.meta.env.VITE_BACKEND_URL || '';

async function init() {
  const session = await requireAuth();
  if (!session) return;

  await renderNav('app-nav');
  await loadDealsPage();
}

async function loadDealsPage() {
  const container = document.getElementById('deals-content');
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch(`${API_URL}/api/connections`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });

    if (!res.ok) {
      renderEmpty(container);
      return;
    }

    const payload = await res.json();
    const connections = payload.data || payload.connections || [];
    const totalDeals = connections.reduce((sum, c) => sum + (c.deal_count || 0), 0);

    if (!totalDeals) {
      renderEmpty(container);
      return;
    }

    container.innerHTML = `
      <div class="stat-card" style="max-width:420px;">
        <div class="stat-label">Total Deals</div>
        <div class="stat-value">${totalDeals.toLocaleString()}</div>
        <div class="stat-change text-secondary">Synced from connected CRMs</div>
      </div>
    `;
  } catch (error) {
    console.error('Deals page error:', error);
    renderEmpty(container);
  }
}

function renderEmpty(container) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">💼</div>
      <h3 class="empty-state-title">No deals data</h3>
      <p class="empty-state-text">Connect CRM to add data.</p>
      <a href="/connectors.html" class="btn btn-primary">Connect CRM</a>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', init);
