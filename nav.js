import { getCurrentUser, signOut } from './auth.js';

const NAV_ITEMS = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        href: '/dashboard.html',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    },
    {
        id: 'connectors',
        label: 'Connectors',
        href: '/connectors.html',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>`,
    },
    {
      id: 'contacts',
      label: 'Contacts',
      href: '/contacts.html',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>`,
    },
    {
      id: 'deals',
      label: 'Deals',
      href: '/deals.html',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>`,
    },
    {
        id: 'normalization',
        label: 'Normalization',
        href: '/normalization.html',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-10"/><circle cx="7" cy="16" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="19" cy="6" r="1.5"/></svg>`,
    },
];

function getActivePage() {
    const path = window.location.pathname;
    if (path.includes('normalization')) return 'normalization';
    if (path.includes('connectors')) return 'connectors';
  if (path.includes('contacts')) return 'contacts';
  if (path.includes('deals')) return 'deals';
    return 'dashboard';
}

export async function renderNav(containerId = 'app-nav') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const user = await getCurrentUser();
    const activePage = getActivePage();
    const initials = user?.user_metadata?.full_name
        ? user.user_metadata.full_name.split(' ').map(n => n[0]).join('').toUpperCase()
        : user?.email?.[0]?.toUpperCase() || '?';

    container.innerHTML = `
    <div class="app-sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <div class="sidebar-logo-icon">⚡</div>
          <span>CRM<span class="text-gradient">Hub</span></span>
        </div>
      </div>

      <nav class="sidebar-nav">
        ${NAV_ITEMS.map(item => `
          <a href="${item.href}" class="sidebar-link ${activePage === item.id ? 'active' : ''}" id="nav-${item.id}">
            ${item.icon}
            <span>${item.label}</span>
          </a>
        `).join('')}
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-avatar">${initials}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${user?.user_metadata?.full_name || 'User'}</div>
            <div class="sidebar-user-email">${user?.email || ''}</div>
          </div>
        </div>
        <button class="btn btn-ghost btn-block mt-sm" id="btn-sign-out" style="justify-content: flex-start;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>Sign Out</span>
        </button>
      </div>
    </div>

    <button class="sidebar-toggle" id="sidebar-toggle">☰</button>
  `;

    // Sign out handler
    document.getElementById('btn-sign-out')?.addEventListener('click', async () => {
        await signOut();
    });

    // Mobile sidebar toggle
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('mobile-open');
    });
}
