/** Reusable UI primitives. Everything here is pure: props in, element out. */

import { h, frag, autosize } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { initials } from '../lib/format.js';
import { badgeClass, dotClass } from '../lib/model.js';

/* --- Badges & dots -------------------------------------------------------- */

export function badge(label, tone, iconName) {
  return h(`span.${badgeClass(tone).split(' ').join('.')}`,
    iconName && icon(iconName),
    label);
}

export const statusDot = (tone, pulse = false) =>
  h(`span.${dotClass(tone).split(' ').join('.')}${pulse ? '.dot--pulse' : ''}`);

/* --- Buttons -------------------------------------------------------------- */

export function button(label, { variant = 'primary', size, block, icon: ico, iconEnd,
                                onClick, type = 'button', disabled, className } = {}) {
  const classes = ['btn', `btn--${variant}`];
  if (size) classes.push(`btn--${size}`);
  if (block) classes.push('btn--block');
  if (className) classes.push(className);

  return h(`button.${classes.join('.')}`, {
    type, disabled: !!disabled, onclick: onClick,
  }, ico && icon(ico), label, iconEnd && icon(iconEnd));
}

export function iconButton(name, { onClick, label, variant = 'ghost', className } = {}) {
  return h(`button.btn.btn--${variant}.btn--icon${className ? `.${className}` : ''}`, {
    type: 'button', onclick: onClick, 'aria-label': label || name,
  }, icon(name));
}

/** Puts a button in a permanent "working…" state while its promise runs. */
export function asyncButton(label, { busyLabel = 'Guardando…', onClick, ...rest } = {}) {
  const el = button(label, { ...rest, onClick: run });
  async function run(event) {
    if (el.disabled) return;
    const original = el.replaceChildren.bind(el);
    el.disabled = true;
    original(h('span.spinner.spinner--light'), busyLabel);
    try {
      await onClick?.(event);
    } finally {
      if (el.isConnected) {
        el.disabled = false;
        el.replaceChildren();
        if (rest.icon) el.append(icon(rest.icon));
        el.append(label);
      }
    }
  }
  return el;
}

/* --- Structure ------------------------------------------------------------ */

export function card(children, { className = '', title, action } = {}) {
  return h(`div.card${className ? `.${className.split(' ').join('.')}` : ''}`,
    title && h('div.card__head',
      h('h2.card__title', title),
      action || null),
    children);
}

export const sectionLabel = (text, action) =>
  h('div.section-label', h('span', text), action || null);

/** A tappable row: title, meta line, optional end content, chevron. */
export function itemRow({ title, meta, lead, end, onClick, href, chevron = true, className = '' }) {
  const kids = [
    lead || null,
    h('div.item__main',
      h('div.item__title.truncate', title),
      meta ? h('div.item__meta.truncate', meta) : null),
    end ? h('div.item__end', end) : null,
    chevron ? icon('chevronR', 'rowlink__chev') : null,
  ];
  const cls = `.item.item--tap-target${className ? `.${className.split(' ').join('.')}` : ''}`;
  return href
    ? h(`a${cls}`, { href }, kids)
    : h(`button${cls}`, { type: 'button', onclick: onClick }, kids);
}

export const list = (children, { card: asCard = false } = {}) =>
  h(`div.list${asCard ? '.list--card' : ''}`, children);

export const listHead = (text) => h('div.list-head', text);

/* --- Data display --------------------------------------------------------- */

export function stat({ label, value, foot, tone, onClick }) {
  const modifier = tone ? `.stat--${tone}` : '';
  const body = [
    h('div.stat__label', label),
    h('div.stat__value', value),
    foot ? h('div.stat__foot', foot) : null,
  ];
  return onClick
    ? h(`button.stat${modifier}`, { type: 'button', onclick: onClick, style: { textAlign: 'left', display: 'block', width: '100%' } }, body)
    : h(`div.stat${modifier}`, body);
}

export const statGrid = (tiles, cols = 2) =>
  h(`div.stats${cols === 3 ? '.stats--3' : ''}`, tiles);

export function defRow(key, value, { total = false } = {}) {
  return h('div.dl__row',
    h('span.dl__k', key),
    h(`span.dl__v${total ? '.dl__v--total' : ''}`, value));
}

export const defList = (rows) => h('div.dl', rows);

export function meter(percentValue, { tone, large = false } = {}) {
  return h(`div.meter${large ? '.meter--lg' : ''}`,
    h(`div.meter__fill${tone ? `.meter__fill--${tone}` : ''}`,
      { style: { width: `${Math.max(0, Math.min(100, percentValue))}%` } }));
}

export function avatar(name, { size = '', dark = false } = {}) {
  return h(`div.avatar${size ? `.avatar--${size}` : ''}${dark ? '.avatar--dark' : ''}`,
    initials(name));
}

/** A progress ring — used for the payment countdown. */
export function ring({ value, max, top, bottom, tone }) {
  const R = 46, C = 2 * Math.PI * R;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const markup = `
    <svg width="108" height="108" viewBox="0 0 108 108">
      <circle class="ring__track" cx="54" cy="54" r="${R}" fill="none" stroke-width="9"/>
      <circle class="ring__fill${tone ? ` ring__fill--${tone}` : ''}" cx="54" cy="54" r="${R}"
        fill="none" stroke-width="9"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/>
    </svg>`;
  const wrap = h('div.ring', { html: markup });
  wrap.append(h('div.ring__mid', h('div.ring__n', top), h('div.ring__u', bottom)));
  return wrap;
}

/* --- Feedback ------------------------------------------------------------- */

export function alert(text, tone = 'info', iconName) {
  return h(`div.alert.alert--${tone}`,
    icon(iconName || (tone === 'bad' ? 'alert' : tone === 'ok' ? 'check' : 'info')),
    h('span', text));
}

export function emptyState({ icon: ico = 'box', title, text, action }) {
  return h('div.empty',
    h('div.empty__icon', icon(ico)),
    h('div.empty__title', title),
    text ? h('p.empty__text', text) : null,
    action ? h('div', { style: { marginTop: '12px' } }, action) : null);
}

export const spinner = (large = false) => h(`div.spinner${large ? '.spinner--lg' : ''}`);
export const loading = () => h('div.loading', spinner(true));

export function skeletonRows(count = 4) {
  return h('div.stack.stack-3', { style: { padding: '16px' } },
    Array.from({ length: count }, () => h('div.row',
      h('div.skeleton', { style: { width: '42px', height: '42px', borderRadius: '999px' } }),
      h('div.grow.stack.stack-2',
        h('div.skeleton', { style: { width: '60%', height: '13px' } }),
        h('div.skeleton', { style: { width: '38%', height: '11px' } })))));
}

/* --- Form fields ---------------------------------------------------------- */

export function field({ label, hint, error, control, id }) {
  return h('label.field', { for: id },
    label ? h('span.field__label', label) : null,
    control,
    error ? h('span.field__error', error) : hint ? h('span.field__hint', hint) : null);
}

export function input({ value = '', ...rest } = {}) {
  return h('input.input', { value, ...rest });
}

export function textarea({ value = '', grow = false, ...rest } = {}) {
  const el = h('textarea.textarea', { ...rest }, value);
  el.value = value;
  if (grow) autosize(el);
  return el;
}

export function select({ options = [], value, ...rest } = {}) {
  const el = h('select.select', rest,
    options.map((opt) => h('option', { value: opt.value }, opt.label)));
  el.value = value ?? options[0]?.value ?? '';
  return el;
}

export function searchInput({ placeholder = 'Buscar…', onInput, value = '' } = {}) {
  return h('div.input-group',
    h('span.input-group__icon', icon('search')),
    h('input.input', {
      type: 'search', placeholder, value, inputmode: 'search',
      oninput: (e) => onInput?.(e.target.value),
    }));
}

export function moneyInput({ value = '', ...rest } = {}) {
  return h('div.input-prefix',
    h('input.input', {
      type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value, ...rest,
    }));
}

export function switchRow(label, { checked = false, onChange, hint } = {}) {
  const box = h('input', { type: 'checkbox', checked, onchange: (e) => onChange?.(e.target.checked) });
  return h('label.switch',
    h('div.grow',
      h('div.w-600', label),
      hint ? h('div.t-sm.c-soft', hint) : null),
    box,
    h('span.switch__track'));
}

/** Segmented control. `options: [{value,label}]` */
export function segmented(options, active, onPick) {
  return h('div.segmented', { role: 'tablist' },
    options.map((opt) => h(
      `button.segmented__item${opt.value === active ? '.is-active' : ''}`,
      { type: 'button', role: 'tab', 'aria-selected': opt.value === active, onclick: () => onPick(opt.value) },
      opt.label)));
}

/** Scrollable filter chips. `options: [{value,label,count}]` */
export function chips(options, active, onPick) {
  return h('div.chips',
    options.map((opt) => h(
      `button.chip${opt.value === active ? '.is-active' : ''}`,
      { type: 'button', onclick: () => onPick(opt.value) },
      opt.label,
      opt.count != null ? h('span.chip__count', opt.count) : null)));
}

export { frag };
