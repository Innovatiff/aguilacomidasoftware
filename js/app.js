/**
 * El Águila Cocina — administration app.
 *
 * Boot order: start the auth listener, then react to it. A signed-out visitor
 * gets the login screen; an address on the `staff` list gets the shell, the
 * shared data listeners and the router. Nothing queries Firestore before that
 * is known, so the security rules are never the first line of defence against
 * a screen that should not have rendered.
 */

import { $ } from './lib/dom.js';
import { configureShell, clearShell, setTabBadge, splash, notePath, screen } from './ui/shell.js';
import { register, setNotFound, start, go, onNavigate } from './lib/router.js';
import { startSession, watchSession, session, signOutNow } from './data/session.js';
import { startStore, stopStore, subscribe, unreadCount } from './data/store.js';
import { renderAuth, renderNoAccess } from './screens/login.js';
import { renderDashboard } from './screens/dashboard.js';
import { renderRoute } from './screens/route.js';
import { renderFarms } from './screens/farms.js';
import { renderFarmDetail } from './screens/farm-detail.js';
import { renderFarmForm } from './screens/farm-form.js';
import { renderClients } from './screens/clients.js';
import { renderClientForm } from './screens/client-form.js';
import { renderClientDetail } from './screens/client-detail.js';
import { renderBilling } from './screens/billing.js';
import { renderCheckout } from './screens/checkout.js';
import { renderInvoice } from './screens/invoice.js';
import { renderReceipt } from './screens/receipt.js';
import { renderMessages } from './screens/messages.js';
import { renderChat } from './screens/chat.js';
import { renderSettings } from './screens/settings.js';
import { emptyState, button } from './ui/kit.js';

const TABS = [
  { id: 'home',     path: '/',         label: 'Inicio',   icon: 'home' },
  { id: 'route',    path: '/route',    label: 'Ruta',     icon: 'route' },
  { id: 'farms',    path: '/farms',    label: 'Ranchos',  icon: 'farm' },
  { id: 'clients',  path: '/clients',  label: 'Clientes', icon: 'users' },
  { id: 'messages', path: '/messages', label: 'Mensajes', icon: 'chat' },
];

const host = $('#app');
let phase = null;          // 'auth' | 'pending' | 'app'
let routerStarted = false;
let stopBadge = null;

splash(host);
startSession();

watchSession(() => {
  if (!session.ready) return;

  if (!session.user) return enter('auth');
  if (session.isAdmin) return enter('app');

  // Signed in, but this address is not on the team. The holding screen decides
  // whether that means "claim the first seat" or "ask to be added".
  return enter('pending');
});

function showNoAccess() {
  clearShell(host);
  renderNoAccess(host, {
    // The profile name, not `displayName` — that falls back to the email
    // address, which reads badly in a greeting.
    name: session.profile?.name || session.staff?.name || '',
    email: session.email || '',
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
    clearShell(host);
    renderAuth(host);
    return;
  }

  if (next === 'pending') {
    showNoAccess();
    return;
  }

  host.replaceChildren();
  configureShell({
    mount: host,
    tabs: TABS,
    brand: { name: 'El Águila', sub: 'Administración' },
  });
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

  // A farm holds the terms and the locations; its people are `clients`.
  register('/farms', renderFarms);
  // Registered before '/farms/:id' so "new" is never read as an id.
  register('/farms/new', renderFarmForm);
  register('/farms/:id', renderFarmDetail);
  register('/farms/:id/edit', renderFarmForm);

  register('/clients', renderClients);
  register('/clients/new', renderClientForm);
  register('/clients/:id', renderClientDetail);
  register('/clients/:id/edit', renderClientForm);
  register('/billing', renderBilling);
  // The counter: find somebody and take their money.
  register('/cobrar', renderCheckout);
  register('/invoices/:id', renderInvoice);
  register('/receipts/:id', renderReceipt);
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
