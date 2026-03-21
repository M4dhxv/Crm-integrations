import { requireAuth } from './auth.js';
import { renderNav } from './nav.js';
import { supabase } from './supabase.js';

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

    const { data: contacts, error } = await supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, email, phone, company_name, lifecycle_stage, provider, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('Failed to load contacts:', error);
      renderEmpty(container);
      return;
    }

    if (!contacts || contacts.length === 0) {
      renderEmpty(container);
      return;
    }

    const providers = new Set(contacts.map(c => String(c.provider || '').toLowerCase()).filter(Boolean));
    renderContacts(container, contacts, providers);
    bindSearch(contacts);
  } catch (error) {
    console.error('Contacts page error:', error);
    renderEmpty(container);
  }
}

function renderContacts(container, contacts, providers) {
  container.innerHTML = `
    <div class="contacts-summary-grid">
      <div class="stat-card">
        <div class="stat-label">Total Contacts</div>
        <div class="stat-value">${contacts.length.toLocaleString()}</div>
        <div class="stat-change text-secondary">Latest synced contacts</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Connected Providers</div>
        <div class="stat-value">${providers.size}</div>
        <div class="stat-change text-secondary">${Array.from(providers).map(formatProvider).join(', ') || '—'}</div>
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
          <tbody id="contacts-table-body">
            ${contacts.map(renderContactRow).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function bindSearch(allContacts) {
  const input = document.getElementById('contacts-search');
  const tbody = document.getElementById('contacts-table-body');
  if (!input || !tbody) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const filtered = !q
      ? allContacts
      : allContacts.filter(c => {
          const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
          const email = String(c.email || '').toLowerCase();
          const company = String(c.company_name || '').toLowerCase();
          const provider = String(c.provider || '').toLowerCase();
          return name.includes(q) || email.includes(q) || company.includes(q) || provider.includes(q);
        });

    tbody.innerHTML = filtered.length
      ? filtered.map(renderContactRow).join('')
      : `<tr><td colspan="6" class="contacts-empty-row">No matching contacts found.</td></tr>`;
  });
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
