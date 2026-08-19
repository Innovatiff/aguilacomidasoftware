/**
 * Hash router.
 *
 * Hash routing rather than the History API so the apps can be served from any
 * static host — including opening index.html straight off a phone — without a
 * rewrite rule. Routes are declared as "/clients/:id"; the matched params are
 * handed to the screen.
 */

const routes = [];
let notFound = null;
let current = null;      // { path, route, params, teardown }
let onChange = null;

/** register('/clients/:id', renderClient) */
export function register(pattern, render, meta = {}) {
  const keys = [];
  const source = pattern
    .replace(/\/$/, '')
    .replace(/:([A-Za-z0-9_]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; });
  routes.push({ pattern, meta, render, keys, regex: new RegExp(`^${source || '/'}$`) });
}

export const setNotFound = (render) => { notFound = render; };
export const onNavigate = (fn) => { onChange = fn; };

export function path() {
  const raw = location.hash.slice(1) || '/';
  return raw.split('?')[0].replace(/\/$/, '') || '/';
}

/** Query string after the route, e.g. "#/clients?filter=due". */
export function queryParams() {
  const [, search = ''] = (location.hash.slice(1) || '').split('?');
  return Object.fromEntries(new URLSearchParams(search));
}

export function go(to, { replace = false } = {}) {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (location.hash === target) return resolve();
  if (replace) location.replace(target);
  else location.hash = target;
}

export const back = (fallback = '/') => {
  if (history.length > 1) history.back();
  else go(fallback, { replace: true });
};

function match(target) {
  for (const route of routes) {
    const found = route.regex.exec(target);
    if (found) {
      const params = {};
      route.keys.forEach((key, i) => { params[key] = decodeURIComponent(found[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

/**
 * Renders the route for the current hash. Screens may return a teardown
 * function; it runs before the next screen mounts, which is how Firestore
 * listeners get detached.
 */
export async function resolve() {
  const target = path();
  const found = match(target);

  if (current?.teardown) {
    try { current.teardown(); } catch { /* a failed teardown must not block navigation */ }
  }

  const context = { path: target, params: found?.params || {}, query: queryParams() };
  current = { path: target, route: found?.route || null, params: context.params, teardown: null };

  onChange?.(context, found?.route?.meta || {});

  const render = found ? found.route.render : notFound;
  if (!render) return;

  const teardown = await render(context);
  // Only keep the teardown if we are still on the same route: an await here can
  // outlive its own navigation when the user taps quickly.
  if (current.path === target) current.teardown = typeof teardown === 'function' ? teardown : null;
  else if (typeof teardown === 'function') teardown();
}

export function start() {
  window.addEventListener('hashchange', resolve);
  return resolve();
}

/** The route currently on screen, for highlighting the active tab. */
export const currentPath = () => current?.path || path();
