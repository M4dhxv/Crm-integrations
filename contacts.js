import { requireAuth } from './auth.js';
import { renderNav } from './nav.js';
import { supabase } from './supabase.js';

const PAGE_SIZE = 100;
const state = {
  page: 1,
  total: 0,
  query: '',
};

async function init() {
  const session = await requireAuth();
  if (!session) return;

  await renderNav('app-nav');
  await loadContactsPage();
}

async function loadContactsPage() {
  const container = document.getElementById('contacts-content');
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    renderContactsLayout(container);
    bindSearch();
    await fetchAndRenderPage();
  } catch (error) {
    console.error('Contacts page error:', error);
    renderEmpty(container);
  }
}

function renderContactsLayout(container) {
  container.innerHTML = `
    <div class="contacts-summary-grid">
      <div class="stat-card">
        <div class="stat-label">Total Contacts</div>
        <div class="stat-value" id="contacts-total-count">—</div>
        <div class="stat-change text-secondary">Across all pages</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Rows Per Page</div>
        <div class="stat-value">${PAGE_SIZE.toLocaleString()}</div>
        <div class="stat-change text-secondary">Use Next/Previous to view all records</div>
      </div>
    </div>

    <div class="contacts-list-card mt-md">
      <div class="contacts-list-toolbar">
        <h2 class="text-lg font-bold">Contact List</h2>
        <input id="contacts-search" class="input" type="search" placeholder="Search name, email, company..." />
      </div>

      <div class="contacts-table-wrap">
        <table class="contacts-table" aria-label="Contacts list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Company</th>
              <th>Provider</th>
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody id="contacts-table-body"></tbody>
        </table>
      </div>

      <div class="contacts-pagination mt-md" id="contacts-pagination"></div>
    </div>
  `;
}

function bindSearch() {
  const input = document.getElementById('contacts-search');
  if (!input) return;

  let timer = null;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      state.query = input.value.trim();
      state.page = 1;
      await fetchAndRenderPage();
    }, 250);
  });
}

async function fetchAndRenderPage() {
  const tbody = document.getElementById('contacts-table-body');
  const totalEl = document.getElementById('contacts-total-count');
  const paginationEl = document.getElementById('contacts-pagination');
  if (!tbody || !totalEl || !paginationEl) return;

  const from = (state.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('crm_contacts')
    .select('id, first_name, last_name, email, phone, company_name, provider, updated_at', { count: 'exact' })
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (state.query) {
    const safe = state.query.replace(/,/g, ' ');
    query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.%${safe}%,company_name.ilike.%${safe}%,provider.ilike.%${safe}%`);
  }

  const { data: contacts, error, count } = await query;

  if (error) {
    console.error('Failed to load contacts:', error);
    tbody.innerHTML = `<tr><td colspan="6" class="contacts-empty-row">Failed to load contacts.</td></tr>`;
    return;
  }

  state.total = Number(count || 0);
  totalEl.textContent = state.total.toLocaleString();

  if (!contacts || contacts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="contacts-empty-row">No matching contacts found.</td></tr>`;
  } else {
    tbody.innerHTML = contacts.map(renderContactRow).join('');
  }

  renderPagination(paginationEl, contacts.length);
}

function renderPagination(container, pageCount) {
  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;

  const from = state.total === 0 ? 0 : ((state.page - 1) * PAGE_SIZE) + 1;
  const to = state.total === 0 ? 0 : Math.min(state.page * PAGE_SIZE, state.total);

  container.innerHTML = `
    <div class="flex items-center justify-between gap-md" style="flex-wrap:wrap;">
      <div class="text-sm text-secondary">Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${state.total.toLocaleString()}</div>
      <div class="flex items-center gap-sm">
        <button class="btn btn-secondary btn-sm" id="contacts-prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span class="text-sm text-secondary">Page ${state.page} of ${totalPages}</span>
        <button class="btn btn-secondary btn-sm" id="contacts-next" ${(state.page >= totalPages || pageCount < PAGE_SIZE) ? 'disabled' : ''}>Next</button>
      </div>
    </div>
  `;

  const prev = document.getElementById('contacts-prev');
  const next = document.getElementById('contacts-next');

  if (prev) {
    prev.addEventListener('click', async () => {
      if (state.page <= 1) return;
      state.page -= 1;
      await fetchAndRenderPage();
    });
  }

  if (next) {
    next.addEventListener('click', async () => {
      if (state.page >= totalPages) return;
      state.page += 1;
      await fetchAndRenderPage();
    });
  }
}

function renderContactRow(contact) {
  const firstName = escapeHtml(contact.first_name || '');
  const lastName = escapeHtml(contact.last_name || '');
  const displayName = `${firstName} ${lastName}`.trim() || '—';
  const email = escapeHtml(contact.email || '—');
  const phone = escapeHtml(contact.phone || '—');
  const company = escapeHtml(contact.company_name || '—');
  const provider = escapeHtml(formatProvider(contact.provider));
  const updated = formatDate(contact.updated_at);

  return `
    <tr>
      <td>${displayName}</td>
      <td>${email}</td>
      <td>${phone}</td>
      <td>${company}</td>
      <td><span class="contacts-provider-pill">${provider}</span></td>
      <td>${updated}</td>
    </tr>
  `;
}

function formatProvider(provider) {
  const p = String(provider || '').toLowerCase();
  if (!p) return 'Unknown';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderEmpty(container) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">👥</div>
      <h3 class="empty-state-title">No contacts data</h3>
      <p class="empty-state-text">Connect CRM to add data.</p>
      <a href="/connectors.html" class="btn btn-primary">Connect CRM</a>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', init);
