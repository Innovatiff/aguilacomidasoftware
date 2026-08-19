/**
 * The app frame: dark top bar, white scrolling page, dark bottom tab bar.
 *
 * Screens do not build chrome. They call `screen({ title, body, tab })` and the
 * shell keeps the bars, the active tab and the scroll position consistent.
 */

import { h, mount, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { back, currentPath, go } from '../lib/router.js';

let root, topbar, page, tabbar;
let tabs = [];
let activeTab = null;
const badges = new Map();
const scrollMemory = new Map();

/** Called once at boot with the app's tab set. */
export function configureShell({ mount: host, tabs: tabConfig = [] }) {
  root = host;
  tabs = tabConfig;

  topbar = h('header.topbar');
  page = h('main.page', { id: 'page' });
  tabbar = h('nav.tabbar', { 'aria-label': 'Navegación principal' });

  mount(root, topbar, page, tabbar);
  renderTabs();
}

/* --- Tab bar --------------------------------------------------------------- */

function renderTabs() {
  if (!tabs.length) { tabbar.hidden = true; return; }
  const here = currentPath();
  mount(tabbar, tabs.map((tab) => {
    // A screen may name its tab explicitly, which is how detail screens under
    // a different path — an invoice, a client — still light up their section.
    const active = activeTab ? activeTab === tab.id
      : here === tab.path || (tab.path !== '/' && here.startsWith(`${tab.path}/`));
    const count = badges.get(tab.id) || 0;
    return h(`button.tab${active ? '.is-active' : ''}`, {
      type: 'button',
      'aria-current': active ? 'page' : null,
      onclick: () => go(tab.path),
    },
    icon(tab.icon),
    h('span', tab.label),
    count > 0 ? h('span.tab__dot', count > 99 ? '99+' : count) : null);
  }));
}

/** Unread counter on a tab, e.g. `setTabBadge('messages', 3)`. */
export function setTabBadge(id, count) {
  const next = Number(count) || 0;
  if (badges.get(id) === next) return;
  badges.set(id, next);
  renderTabs();
}

export const showTabs = (visible) => { tabbar.hidden = !visible; };

/* --- Screens --------------------------------------------------------------- */

/**
 * @param {object} config
 * @param {string} config.title
 * @param {string} [config.subtitle]
 * @param {string} [config.backTo]   show a back chevron routing here ('' = history back)
 * @param {Node[]} [config.actions]  buttons for the right of the top bar
 * @param {Node}   [config.body]     page content
 * @param {boolean}[config.flush]    remove the tab-bar bottom padding (chat screens)
 * @param {boolean}[config.sunken]   grey page background
 * @param {Node}   [config.sticky]   element pinned under the top bar (search, day strip)
 * @param {Node}   [config.fab]
 * @param {boolean}[config.hideTabs]
 */
export function screen({
  title, subtitle, backTo, actions, body, brand, tab,
  flush = false, sunken = false, sticky, fab, hideTabs = false,
}) {
  activeTab = tab || null;
  // Screens re-render on every data change. Re-rendering the *same* route must
  // leave the reader where they were; only an actual navigation restores the
  // position remembered for the route being entered.
  const here = currentPath();
  const keepScroll = renderedPath === here ? page.scrollTop : (scrollMemory.get(here) || 0);

  mount(topbar,
    backTo != null
      ? h('button.topbar__btn', {
          type: 'button', 'aria-label': 'Regresar',
          onclick: () => (backTo ? go(backTo) : back()),
        }, icon('chevronL'))
      : null,
    brand || h('div.topbar__title',
      h('span.truncate', { style: { display: 'block' } }, title),
      subtitle ? h('span.topbar__sub.truncate', subtitle) : null),
    ...(actions || []));

  const withTabs = !hideTabs && tabs.length > 0;
  page.className = `page${flush ? ' page--flush' : ''}${sunken ? ' page--sunken' : ''}`
    + (withTabs ? ' page--tabs' : '');
  mount(page, sticky || null, body || null);

  document.querySelector('.fab')?.remove();
  if (fab) root.append(fab);

  showTabs(withTabs);
  renderTabs();

  page.scrollTop = keepScroll;
  renderedPath = here;
  document.title = subtitle ? `${title} · ${subtitle}` : title;
  return page;
}

let renderedPath = null;
let lastPath = '/';

/**
 * Called by the router just before a new route renders: banks the scroll
 * position of the route being left, so going back lands where you were.
 */
export function notePath(path) {
  if (page && page.scrollTop > 0) scrollMemory.set(lastPath, page.scrollTop);
  lastPath = path;
}

/** Swap only the page body — used when a listener pushes fresh data. */
export const setBody = (...content) => mount(page, ...content);

/** The scrolling element, for screens that need to pin to the bottom (chat). */
export const pageEl = () => page;

export const topbarButton = (name, { onClick, label } = {}) =>
  h('button.topbar__btn.topbar__btn--end', {
    type: 'button', 'aria-label': label || name, onclick: onClick,
  }, icon(name));

/** Full-screen boot splash, shown while auth resolves. */
export function splash(host = document.getElementById('app')) {
  mount(host, h('div', {
    style: {
      minHeight: '100dvh', display: 'grid', placeItems: 'center',
      background: 'var(--ink-800)',
    },
  }, h('div.stack.stack-4', { style: { alignItems: 'center' } },
    h('div', { style: { color: 'var(--brand-500)' } }, icon('eagle', 'auth-mark')),
    h('div.spinner.spinner--light'))));
  const mark = host.querySelector('svg');
  if (mark) { mark.style.width = '52px'; mark.style.height = '52px'; }
}

export const appRoot = () => root || $('#app');
