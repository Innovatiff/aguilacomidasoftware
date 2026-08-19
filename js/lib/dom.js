/**
 * A very small DOM builder.
 *
 * There is no framework here on purpose: the whole product is a handful of
 * screens that each render once and then patch a few nodes, so a 60-line
 * hyperscript helper does the job with no build step and no runtime to ship.
 *
 *   h('div.card', { onclick: fn }, 'Hola')
 *   h('ul.list', items.map(renderItem))
 */

const SELECTOR = /([.#][^.#[]+)/g;

/**
 * @param {string} spec  tag + optional .classes and #id, e.g. "button.btn.btn--primary"
 * @param {object|Array|string|Node} [props]  attributes/handlers, or children
 * @param {...(Array|string|Node|null|false|undefined)} children
 */
export function h(spec, props, ...children) {
  const [, tag = 'div'] = /^([a-z0-9-]*)/i.exec(spec) || [];
  const el = document.createElement(tag || 'div');

  for (const token of spec.slice((tag || '').length).match(SELECTOR) || []) {
    if (token[0] === '.') el.classList.add(token.slice(1));
    else el.id = token.slice(1);
  }

  if (isChild(props)) {
    children.unshift(props);
  } else if (props) {
    applyProps(el, props);
  }

  append(el, children);
  return el;
}

function isChild(value) {
  return value == null
    || typeof value === 'string'
    || typeof value === 'number'
    || Array.isArray(value)
    || value instanceof Node;
}

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;

    if (key === 'class' || key === 'className') {
      el.className = [el.className, value].filter(Boolean).join(' ');
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in el && key !== 'list' && typeof value !== 'object') {
      // Properties (value, checked, disabled, textContent…) beat attributes:
      // they stay in sync when the element is re-rendered.
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === true || child === '') continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

/** Document fragment from a list of children. */
export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** Replaces everything inside `host` with `content`. */
export function mount(host, ...content) {
  host.replaceChildren();
  append(host, content);
  return host;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/** Builds an inline SVG from a raw markup string (see icons.js). */
export function svg(markup) {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup.trim();
  return wrap.firstElementChild;
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escapes text destined for an innerHTML string. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Trailing-edge debounce — used by the search fields. */
export function debounce(fn, wait = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Grows a textarea with its content, up to its CSS max-height. */
export function autosize(textarea) {
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener('input', resize);
  queueMicrotask(resize);
  return resize;
}
