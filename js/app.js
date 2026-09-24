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
import { renderNotebook } from './screens/notebook.js';
import { renderFarms } from './screens/farms.js';
import { renderFarmDetail } from './screens/farm-detail.js';
import { renderFarmForm } from './screens/farm-form.js';
import { renderClients } from './screens/clients.js';
import { renderClientForm } from './screens/client-form.js';
import { renderClientDetail } from './screens/client-detail.js';
import { renderBilling } from './screens/billing.js';
import { renderReport, renderReportList } from './screens/report.js';
import { renderPacking } from './screens/packing.js';
import { renderPackingRun } from './screens/packing-run.js';
import { renderPackingSetup } from './screens/packing-setup.js';
import { renderCheckout } from './screens/checkout.js';
import { renderQuick } from './screens/quick.js';
import { renderInvoice } from './screens/invoice.js';
import { renderReceipt } from './screens/receipt.js';
import { renderMessages } from './screens/messages.js';
import { renderChat } from './screens/chat.js';
import { renderSettings } from './screens/settings.js';
import { emptyState, button } from './ui/kit.js';
import { kitchen } from './lib/mode.js';

const TABS = [
  { id: 'home',     path: '/',         label: 'Inicio',   icon: 'home' },
  { id: 'notebook', path: '/libreta',  label: 'Libreta',  icon: 'clipboard' },
  { id: 'farms',    path: '/farms',    label: 'Ranchos',  icon: 'farm' },
  { id: 'clients',  path: '/clients',  label: 'Clientes', icon: 'users' },
  { id: 'messages', path: '/messages', label: 'Mensajes', icon: 'chat' },
  // These two go last, so nothing above them moves. The counter's staff reach
  // for the same four places a hundred times a day and know where they are by
  // position; Reportes and Empaque are opened once, deliberately, by someone
  // who will read the label before pressing it.
  { id: 'reports',  path: '/reportes', label: 'Reportes', icon: 'chart' },
  { id: 'packing',  path: '/empaque',  label: 'Empaque',  icon: 'box' },
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
    // The kitchen computers get no navigation at all. That machine has one
    // job, and a rail offering Clientes, Reportes and Mensajes next to it is
    // both a distraction and a way to end up somewhere nobody meant to go.
    tabs: kitchen() ? [] : TABS,
    brand: { name: 'El Águila', sub: kitchen() ? 'Empaque' : 'Administración' },
  });
  startStore();
  if (!kitchen()) stopBadge = subscribe(() => setTabBadge('messages', unreadCount()));

  // The kitchen's shortcut opens `empaque.html` with no address after it. It
  // is not the panel's home screen that should answer — it is the keypad.
  //
  // `replaceState` rather than setting the hash: assigning to `location.hash`
  // fires `hashchange` a tick later, and the router — which is about to read
  // the address anyway — would draw the screen twice and re-attach its
  // listeners in between.
  if (kitchen() && !location.hash.slice(1)) history.replaceState(null, '', '#/empaque');

  if (!routerStarted) {
    registerRoutes();
    // The full address, not just the path: the chevron has to come back to the
    // roster's filter and the report's period, not to their bare screens.
    onNavigate((context) => notePath(context.path, location.hash.slice(1) || '/'));
    routerStarted = true;
    start();
  } else {
    // Same session, new account: re-render whatever route is on screen.
    start();
  }
}

function registerRoutes() {
  register('/', renderDashboard);
  register('/libreta', renderNotebook);

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
  // What the business did over a span somebody chooses, and can print.
  register('/reportes', renderReport);
  // Each of the report's lists is its own screen, so the back chevron out of
  // one goes to the report rather than out of it.
  register('/reportes/:lista', renderReportList);

  // Empaque: the morning's two lists. "ajustes" is registered before ':id' so
  // it is never read as the name of a libreta.
  register('/empaque', renderPacking);
  register('/empaque/ajustes', renderPackingSetup);
  register('/empaque/:id', renderPackingRun);
  // The counter: find somebody and take their money.
  register('/cobrar', renderCheckout);
  register('/rapido', renderQuick);
  register('/invoices/:id', renderInvoice);
  register('/receipts/:id', renderReceipt);
  register('/messages', renderMessages);
  register('/chat/:id', renderChat);
  register('/settings', renderSettings);

  setNotFound(() => {
    // On a kitchen computer "el inicio" is the keypad, not the panel: that
    // machine has no rail to climb back out with, so a button that lands on
    // the dashboard would leave somebody stuck on a screen they never meant
    // to open.
    const homeHref = kitchen() ? '/empaque' : '/';
    screen({
      title: 'No encontrado',
      body: emptyState({
        icon: 'search',
        title: 'Esta pantalla no existe',
        text: 'El enlace puede estar mal escrito o la pantalla ya no está disponible.',
        action: button(kitchen() ? 'Ir a Empaque' : 'Ir al inicio', {
          onClick: () => go(homeHref),
        }),
      }),
    });
  });
}
