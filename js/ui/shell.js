/**
 * The app frame: dark top bar, white scrolling page, dark tab bar.
 *
 * Screens do not build chrome. They call `screen({ title, body, tab })` and the
 * shell keeps the bars, the active tab and the scroll position consistent.
 *
 * The same three elements serve both layouts. On a phone the tab bar is pinned
 * across the bottom; from 900px CSS moves it to the left as a rail and gives
 * the page the whole window. Nothing here changes between the two — the
 * `app--shell` class simply tells the stylesheet that the frame is mounted, so
 * the sign-in screen (which has no frame) can be laid out differently.
 *
 * **The chrome is patched, never rebuilt.** Screens call `screen()` on every
 * data change — a client's file redraws five times while its listeners answer —
 * and a browser only fires `click` when the press and the release land on the
 * same element. Replacing the back chevron between the two swallows the click,
 * which is a back button that does nothing until it is pressed twice. So the
 * bars keep their nodes as long as their shape is the same, and only their
 * text, state and handlers are swapped.
 */

import { h, mount, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { back, currentPath, go } from '../lib/router.js';

let root, topbar, page, tabbar;
let tabs = [];
let activeTab = null;
const badges = new Map();
const scrollMemory = new Map();

/**
 * A button that outlives its handler.
 *
 * The listener is attached once and calls through a slot, so a redraw can hand
 * the button a fresh closure — one that sees this draw's data — without taking
 * the node out of the document under somebody's finger.
 */
function liveButton(spec, props, ...children) {
  const el = h(spec, { ...props, onclick: null }, ...children);
  el.__onClick = props?.onclick || null;
  el.addEventListener('click', (event) => el.__onClick?.(event));
  return el;
}

/** Points an existing live button at a new handler. */
const relive = (el, handler) => { if (el) el.__onClick = handler || null; };

/** Shown at the top of the rail; the phone layout has no room for it. */
let brandName = { name: 'El Águila', sub: 'Cocina' };

/** Shown at the top of the rail; the phone layout has no room for it. */

/** Called once at boot with the app's tab set. */
export function configureShell({ mount: host, tabs: tabConfig = [], brand } = {}) {
  root = host;
  tabs = tabConfig;
  brandName = brand || brandName;

  topbar = h('header.topbar');
  page = h('main.page', { id: 'page' });
  tabbar = h('nav.tabbar', { 'aria-label': 'Navegación principal' });

  // These are all caches over the nodes above, and the nodes above are new.
  // Signing out and back in builds a fresh frame; keeping what the last one
  // looked like would have `screen()` patch a top bar that no longer exists.
  topbarShape = null;
  fabKey = null;
  tabNodes.clear();
  cameFrom.clear();
  lastPath = '/';

  root.classList.add('app--shell');
  mount(root, topbar, page, tabbar);
  renderTabs();
}

/** Drops the frame — the sign-in and no-access screens stand on their own. */
export function clearShell(host) {
  host.classList.remove('app--shell');
  host.replaceChildren();
}


/* --- Tab bar --------------------------------------------------------------- */

/** The tab buttons, by tab id — built once and kept for the life of the app. */
const tabNodes = new Map();

function renderTabs() {
  if (!tabs.length) { tabbar.hidden = true; return; }

  if (!tabNodes.size) {
    for (const config of tabs) {
      tabNodes.set(config.id, h('button.tab', {
        type: 'button',
        onclick: () => go(config.path),
      },
      icon(config.icon),
      h('span', config.label),
      h('span.tab__dot', { hidden: true })));
    }

    mount(tabbar,
      // Only visible once the tab bar is a rail: on a phone the top bar already
      // says where you are, and 60px of bottom bar has no room to spare.
      h('div.tabbar__brand',
        icon('eagle'),
        h('div.tabbar__name.truncate',
          brandName.name,
          h('span', brandName.sub))),
      tabs.map((config) => tabNodes.get(config.id)));
  }

  const here = currentPath();
  for (const config of tabs) {
    // A screen may name its tab explicitly, which is how detail screens under
    // a different path — an invoice, a client — still light up their section.
    const active = activeTab ? activeTab === config.id
      : here === config.path || (config.path !== '/' && here.startsWith(`${config.path}/`));
    const count = badges.get(config.id) || 0;
    const node = tabNodes.get(config.id);

    node.classList.toggle('is-active', active);
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');

    const dot = node.querySelector('.tab__dot');
    dot.hidden = count <= 0;
    dot.textContent = count > 99 ? '99+' : String(count);
  }
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

  paintTopbar({ title, subtitle, backTo, actions, brand });

  const withTabs = !hideTabs && tabs.length > 0;
  page.className = `page${flush ? ' page--flush' : ''}${sunken ? ' page--sunken' : ''}`
    + (withTabs ? ' page--tabs' : '');
  mount(page, sticky || null, body || null);

  paintFab(fab);

  showTabs(withTabs);
  renderTabs();

  page.scrollTop = keepScroll;
  renderedPath = here;
  document.title = subtitle ? `${title} · ${subtitle}` : title;
  return page;
}

/**
 * The top bar, patched in place whenever its shape has not changed.
 *
 * "Shape" is what the nodes are, not what they say: whether there is a back
 * chevron, whether the title is a brand block, and which action buttons sit on
 * the right. A redraw that only brings a name — 'Cliente' turning into 'Sofía
 * Márquez' — writes text into the nodes that are already there. Only a genuinely
 * different bar is rebuilt, and then nobody is mid-press on a button that is
 * about to be replaced anyway.
 */
let topbarShape = null;

/**
 * What the chevron does: back the way they came, or the screen's own fallback.
 *
 * Resolved at click time rather than at draw time, because a screen redraws
 * long after it was reached and the answer must not be frozen from whichever
 * draw happened to build the button.
 */
const backHandler = (backTo) => () => {
  const from = origin(currentPath());
  if (from) go(from);
  else if (backTo) go(backTo);
  else back();
};

function paintTopbar({ title, subtitle, backTo, actions, brand }) {
  const list = (actions || []).filter(Boolean);
  // An action is reusable only if it came from `topbarButton`, which stamps
  // what it is. Anything else is a node this file knows nothing about.
  const reusable = list.every((node) => node.dataset?.action);
  const shape = [
    backTo == null ? 'none' : 'back',
    brand ? 'brand' : 'title',
    subtitle ? 'sub' : 'nosub',
    ...list.map((node) => node.dataset?.action || 'opaque'),
  ].join('|');

  if (topbarShape === shape && reusable && !brand) {
    relive(topbar.querySelector('.topbar__btn:not(.topbar__btn--end)'), backHandler(backTo));
    const head = topbar.querySelector('.topbar__title');
    head.firstChild.textContent = title || '';
    if (subtitle) head.lastChild.textContent = subtitle;

    const live = topbar.querySelectorAll('.topbar__btn--end');
    list.forEach((node, i) => relive(live[i], node.__onClick));
    return;
  }

  mount(topbar,
    backTo != null
      ? liveButton('button.topbar__btn', {
          type: 'button', 'aria-label': 'Regresar',
          onclick: backHandler(backTo),
        }, icon('chevronL'))
      : null,
    brand || h('div.topbar__title',
      h('span.truncate', { style: { display: 'block' } }, title),
      subtitle ? h('span.topbar__sub.truncate', subtitle) : null),
    ...list);

  topbarShape = brand ? null : shape;
}

/**
 * The floating action button, kept while the same screen asks for the same one.
 *
 * Every one of them is a plain `go(...)`, so keeping the node across a redraw
 * cannot leave a stale closure behind — and removing it mid-press is the same
 * swallowed click as the chevron.
 */
let fabKey = null;

function paintFab(fab) {
  const mounted = document.querySelector('.fab');
  const key = fab ? `${currentPath()}|${fab.textContent}` : null;

  if (mounted && fabKey === key) return;
  mounted?.remove();
  if (fab) root.append(fab);
  fabKey = key;
}

let renderedPath = null;
let lastPath = '/';

/**
 * Where each screen was reached from, so the chevron goes back the way the
 * reader came rather than to one fixed parent.
 *
 * A client's file sits under a rancho, so its chevron pointed at the rancho —
 * but staff reach it from the roster nine times out of ten, and landing on the
 * rancho means pressing back a second time to get to the list they were
 * working through. `backTo` stays as the fallback for a screen opened cold: a
 * reload, a bookmark, a link out of a message.
 */
const cameFrom = new Map();

/**
 * The way back from `here`, or null to use the screen's own fallback.
 *
 * A screen underneath this one is never the way back — coming out of a client's
 * edit form must not send the chevron into the edit form again.
 */
function origin(here) {
  const from = cameFrom.get(here);
  if (!from || from === here || from.startsWith(`${here}/`)) return null;
  return from;
}

/**
 * Called by the router just before a new route renders: banks the scroll
 * position of the route being left, so going back lands where you were, and
 * remembers which screen led here.
 */
export function notePath(path) {
  if (page && page.scrollTop > 0) scrollMemory.set(lastPath, page.scrollTop);

  // Coming back up out of a screen's own form does not rewrite where the
  // screen was reached from: somebody who opened a client from the roster,
  // edited them and saved still wants the chevron to return to the roster.
  const up = lastPath.startsWith(`${path}/`);
  if (path !== lastPath && !up) cameFrom.set(path, lastPath);

  lastPath = path;
}

/** Swap only the page body — used when a listener pushes fresh data. */
export const setBody = (...content) => mount(page, ...content);

/** The scrolling element, for screens that need to pin to the bottom (chat). */
export const pageEl = () => page;

export const topbarButton = (name, { onClick, label } = {}) =>
  liveButton('button.topbar__btn.topbar__btn--end', {
    type: 'button',
    'aria-label': label || name,
    // What this button is, so a redraw can tell "the same bar as before" from
    // "a different bar" without comparing DOM.
    dataset: { action: `${name}:${label || ''}` },
    onclick: onClick,
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
