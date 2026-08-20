/**
 * El Águila Cocina — administration app.
 *
 * Boot order: start the auth listener, then react to it. A signed-out visitor
 * gets the login screen; an approved administrator gets the shell, the shared
 * data listeners and the router. Nothing queries Firestore before a role is
 * known, so the security rules are never the first line of defence against a
 * screen that should not have rendered.
 */

import { $ } from './lib/dom.js';
import { configureShell, setTabBadge, splash, notePath, screen } from './ui/shell.js';
import { register, setNotFound, start, go, onNavigate } from './lib/router.js';
import { startSession, watchSession, session, signOutNow } from './data/session.js';
import { startStore, stopStore, subscribe, unreadCount } from './data/store.js';
import { claimStaffProfile } from './data/users.js';
import { renderAuth, renderNoAccess } from './screens/login.js';
import { renderDashboard } from './screens/dashboard.js';
import { renderRoute } from './screens/route.js';
import { renderClients } from './screens/clients.js';
import { renderClientForm } from './screens/client-form.js';
import { renderClientDetail } from './screens/client-detail.js';
import { renderBilling } from './screens/billing.js';
import { renderInvoice } from './screens/invoice.js';
import { renderMessages } from './screens/messages.js';
import { renderChat } from './screens/chat.js';
import { renderSettings } from './screens/settings.js';
import { emptyState, button } from './ui/kit.js';

const TABS = [
  { id: 'home',     path: '/',         label: 'Inicio',   icon: 'home' },
  { id: 'route',    path: '/route',    label: 'Ruta',     icon: 'route' },
  { id: 'clients',  path: '/clients',  label: 'Ranchos',  icon: 'users' },
  { id: 'billing',  path: '/billing',  label: 'Cobros',   icon: 'wallet' },
  { id: 'messages', path: '/messages', label: 'Mensajes', icon: 'chat' },
];

const host = $('#app');
let phase = null;          // 'auth' | 'pending' | 'app'
let routerStarted = false;
let stopBadge = null;
let provisionedFor = null; // uid we have already tried to set up
let provisionError = null; // why the rules refused, if they did

splash(host);
startSession();

watchSession(() => {
  if (!session.ready) return;

  if (!session.user) return enter('auth');
  if (session.isAdmin) return enter('app');

  // Not an admin — yet. If this address is listed in staffEmails() in the
  // security rules, the write below is permitted and the profile snapshot
  // flips us straight into the panel. If it is not, the rules refuse and the
  // holding screen below explains what to do. Either way the decision is the
  // rules', not this file's.
  provisionStaff();
  return enter('pending');
});

/**
 * Asks the rules to let this account run the panel.
 *
 * A refusal is shown rather than swallowed. "Nothing happened" is the hardest
 * kind of failure to act on, and the two causes here — an address that is not
 * on the list, and rules that were published without the list at all — look
 * identical from the outside unless the app says which it hit.
 */
function provisionStaff({ retry = false } = {}) {
  if (!session.user) return Promise.resolve();
  if (!retry && provisionedFor === session.uid) return Promise.resolve();

  provisionedFor = session.uid;
  provisionError = null;

  return claimStaffProfile(session.user).catch((error) => {
    provisionError = error;
    if (phase === 'pending') showNoAccess();
  });
}

function showNoAccess() {
  host.replaceChildren();
  renderNoAccess(host, {
    // The profile name, not `displayName` — that falls back to the email
    // address, which reads badly in a greeting.
    name: session.profile?.name || '',
    email: session.user?.email || '',
    error: provisionError,
    onRetry: () => provisionStaff({ retry: true }),
    onSignOut: () => signOutNow(),
  });
}

function enter(next) {
  if (phase === next) return;

  // Leaving the app phase: drop every listener before the next account starts.
  if (phase === 'app') {
    stopBadge?.();
    stopBadge = null;
    stopStore();
  }
  phase = next;

  if (next === 'auth') {
    host.replaceChildren();
    renderAuth(host);
    return;
  }

  if (next === 'pending') {
    showNoAccess();
    return;
  }

  host.replaceChildren();
  configureShell({ mount: host, tabs: TABS });
  startStore();
  stopBadge = subscribe(() => setTabBadge('messages', unreadCount()));

  if (!routerStarted) {
    registerRoutes();
    onNavigate((context) => notePath(context.path));
    routerStarted = true;
    start();
  } else {
    // Same session, new account: re-render whatever route is on screen.
    start();
  }
}

function registerRoutes() {
  register('/', renderDashboard);
  register('/route', renderRoute);
  register('/clients', renderClients);
  // Registered before '/clients/:id' so "new" is never read as an id.
  register('/clients/new', renderClientForm);
  register('/clients/:id', renderClientDetail);
  register('/clients/:id/edit', renderClientForm);
  register('/billing', renderBilling);
  register('/invoices/:id', renderInvoice);
  register('/messages', renderMessages);
  register('/chat/:id', renderChat);
  register('/settings', renderSettings);

  setNotFound(() => {
    screen({
      title: 'No encontrado',
      body: emptyState({
        icon: 'search',
        title: 'Esta pantalla no existe',
        text: 'El enlace puede estar mal escrito o la pantalla ya no está disponible.',
        action: button('Ir al inicio', { onClick: () => go('/') }),
      }),
    });
  });
}
