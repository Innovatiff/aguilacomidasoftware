/** Reusable UI primitives. Everything here is pure: props in, element out. */

import { h, frag, autosize } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { initials, money } from '../lib/format.js';
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

/**
 * The same field, without the `<label>`.
 *
 * A label re-dispatches a click anywhere inside it to its own control, so a
 * control that contains buttons of its own — a tag editor, a picker — has its
 * buttons swallowed: the click lands on the text input instead and the
 * handler never runs. This is that case, and only that case; everything with a
 * single input should keep the real label.
 */
export function fieldGroup({ label, hint, error, control }) {
  return h('div.field',
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

/* --- The fortnight's arithmetic --------------------------------------------- */

/**
 * The rows that explain a fortnight's price.
 *
 * The same breakdown wherever the number appears — the form, the client's file,
 * the bill — because "why is mine $152.50 and his is $140?" is asked at the
 * counter, and an answer that changes depending on which screen you are looking
 * at is not an answer.
 *
 * Accepts either a live charge from `fortnightCharge` or an issued invoice,
 * which carries the same fields frozen at the moment it was written.
 */
export function chargeRows(charge, priced = true) {
  const days = Number(charge?.days ?? charge?.plannedDays) || 0;
  const meals = Number(charge?.meals ?? charge?.plannedMeals) || 0;
  const perDay = Number(charge?.perDay ?? charge?.mealsPerDay) || 0;
  const base = Number(charge?.base ?? charge?.planPrice) || 0;
  const adjustment = Number(charge?.adjustment) || 0;
  const extras = charge?.extras || [];
  const rate = Number(charge?.mealPrice) || 0;

  const rows = [
    defRow('Plan', `${perDay} ${perDay === 1 ? 'comida' : 'comidas'} al día`),
    defRow('Días de servicio', `${days} en la quincena`),
    defRow('Comidas de la quincena', String(meals)),
  ];

  if (extras.length) {
    rows.push(defRow('Comidas extra',
      extras.map((entry) => `${WEEKDAY_SHORT[entry.weekday]} +${entry.count}`).join(' · ')));
  }

  if (priced) {
    rows.push(defRow('Precio del plan', money(base)));
    if (Math.abs(adjustment) > 0.005) {
      const sign = adjustment > 0 ? '+' : '−';
      const count = Math.abs(Number(charge?.difference) || 0);
      rows.push(defRow(
        adjustment > 0 ? 'Comidas de más' : 'Comidas de menos',
        `${sign}${money(Math.abs(adjustment))}`
        + (rate ? `  (${count} × ${money(rate)})` : '')));
    }
  }

  return rows;
}

const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/* --- Food restrictions ------------------------------------------------------ */

/**
 * What somebody cannot eat, as chips.
 *
 * Warm-toned on purpose and the same everywhere — the roster, the run sheet,
 * the client's file — because this is the one thing on screen that, missed,
 * sends the wrong plate to somebody who cannot eat it. `max` keeps a dense row
 * from being taken over by a person with six restrictions; the rest are
 * counted, never dropped silently.
 */
export function tagList(tags, { max = 0, className = '' } = {}) {
  const all = tags || [];
  if (!all.length) return null;

  const shown = max > 0 ? all.slice(0, max) : all;
  const rest = all.length - shown.length;

  return h(`div.tags${className ? `.${className.split(' ').join('.')}` : ''}`,
    shown.map((tag) => h('span.tag', icon('ban'), tag)),
    rest > 0 ? h('span.tag.tag--more', `+${rest}`) : null);
}

/* --- Data failures ---------------------------------------------------------- */

/**
 * Explains why a listener failed, in terms of the thing to go and fix.
 *
 * Firestore's own message is kept verbatim underneath the plain-language part,
 * because for a missing index it contains a console link that creates the index
 * in one click — by far the fastest route out, and worth surfacing rather than
 * paraphrasing away.
 */
export function dataErrorCard(error, { onRetry } = {}) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  const link = (message.match(/https:\/\/console\.firebase\.google\.com\S+/) || [])[0]
    ?.replace(/[.,)\]]+$/, '');

  const explanation = {
    'failed-precondition': 'Firestore necesita un índice para esta consulta. Créalo con el enlace de abajo; tarda un minuto en quedar listo.',
    'permission-denied': 'Las reglas publicadas en Firestore no permiten esta consulta. Vuelve a pegar firestore.rules completo en la consola y publícalas.',
    unavailable: 'Sin conexión con Firestore. Revisa tu internet.',
    unauthenticated: 'La sesión caducó. Cierra sesión y vuelve a entrar.',
  }[code] || 'Firestore rechazó una consulta.';

  return h('div.card', { style: { borderColor: 'var(--bad-500)', borderLeftWidth: '4px' } },
    h('div.stack.stack-3',
      h('div.row',
        h('span', { style: { color: 'var(--bad-500)' } }, icon('alert')),
        h('div.w-650', 'No se pudieron cargar los datos')),

      h('p.t-sm.c-soft', { style: { lineHeight: '1.5' } }, explanation),

      link
        ? h('a.btn.btn--primary.btn--block', { href: link, target: '_blank', rel: 'noopener' },
            icon('shield'), 'Crear el índice en Firebase')
        : null,

      onRetry ? button('Reintentar', { variant: 'ghost', block: true, icon: 'refresh', onClick: onRetry }) : null,

      h('details',
        h('summary.t-xs.c-faint', { style: { cursor: 'pointer' } }, 'Detalle técnico'),
        h('p.t-xs.c-faint', {
          style: { marginTop: '8px', lineHeight: '1.5', wordBreak: 'break-word', userSelect: 'text' },
        }, `${code}${code ? ': ' : ''}${message}`))));
}
