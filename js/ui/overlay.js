/** Transient UI: toasts, bottom sheets, confirmation dialogs. */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { button } from './kit.js';

/* --- Toasts --------------------------------------------------------------- */

let toastHost;

function host() {
  if (!toastHost) {
    toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  return toastHost;
}

/** `toast('Guardado')`, `toast('No se pudo guardar', 'bad')` */
export function toast(message, tone = '', ms = 3200) {
  const el = h(`div.toast${tone ? `.toast--${tone}` : ''}`,
    icon(tone === 'bad' ? 'alert' : tone === 'ok' ? 'check' : 'info'),
    h('span', message));
  host().append(el);
  setTimeout(() => {
    el.style.transition = 'opacity 200ms, transform 200ms';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 220);
  }, ms);
  return el;
}

export const toastOk  = (m) => toast(m, 'ok');
export const toastBad = (m) => toast(m, 'bad');

/* --- Bottom sheet --------------------------------------------------------- */

/**
 * Opens a bottom sheet. `build(close)` returns the body; the returned promise
 * resolves with whatever `close(value)` was called with (undefined if dismissed).
 */
export function sheet({ title, build, foot, dismissible = true }) {
  return new Promise((resolve) => {
    let settled = false;

    const close = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      scrim.style.animation = 'fade 160ms var(--ease) reverse';
      panel.style.animation = 'rise 180ms var(--ease) reverse';
      setTimeout(() => scrim.remove(), 160);
      resolve(value);
    };

    const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(undefined); };

    const panel = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Diálogo' },
      h('div.sheet__grip'),
      title ? h('div.sheet__head',
        h('h2.sheet__title', title),
        dismissible ? h('button.btn.btn--quiet.btn--icon',
          { type: 'button', 'aria-label': 'Cerrar', onclick: () => close(undefined) }, icon('x')) : null,
      ) : null,
      h('div.sheet__body', build(close)),
      foot ? h('div.sheet__foot', foot(close)) : null);

    const scrim = h('div.scrim', {
      onclick: (e) => { if (e.target === scrim && dismissible) close(undefined); },
    }, panel);

    document.addEventListener('keydown', onKey);
    document.body.append(scrim);

    // Focus the first real control so keyboards and screen readers land inside.
    queueMicrotask(() => {
      const first = panel.querySelector('input, textarea, select, button:not([aria-label="Cerrar"])');
      first?.focus({ preventScroll: true });
    });
  });
}

/** Yes/no confirmation. Resolves true only when the action is confirmed. */
export function confirm({ title, message, confirmLabel = 'Confirmar', tone = 'primary', icon: ico }) {
  return sheet({
    title,
    build: () => h('div.stack.stack-3',
      ico ? h('div.empty__icon', { style: { margin: '0 auto' } }, icon(ico)) : null,
      h('p.t-base.c-soft.center', { style: { lineHeight: '1.5' } }, message)),
    foot: (close) => h('div.stack.stack-2',
      button(confirmLabel, { variant: tone, block: true, onClick: () => close(true) }),
      button('Cancelar', { variant: 'ghost', block: true, onClick: () => close(false) })),
  }).then((value) => value === true);
}

/**
 * A sheet wrapping a form. `fields(close)` returns the controls; on submit the
 * sheet hands the collected FormData values to `onSubmit` and closes on success.
 */
export function formSheet({ title, fields, submitLabel = 'Guardar', onSubmit }) {
  return sheet({
    title,
    build: (close) => {
      const body = fields(close);
      const form = h('form.stack.stack-4', {
        onsubmit: async (event) => {
          event.preventDefault();
          const submit = form.querySelector('[type="submit"]');
          const values = Object.fromEntries(new FormData(form).entries());
          submit.disabled = true;
          const label = submit.textContent;
          mount(submit, h('span.spinner.spinner--light'), 'Guardando…');
          try {
            const result = await onSubmit(values);
            if (result !== false) close(result ?? values);
          } catch (error) {
            toastBad(error?.uiMessage || 'No se pudo guardar.');
          } finally {
            if (submit.isConnected) { submit.disabled = false; mount(submit, label); }
          }
        },
      }, body, h('button.btn.btn--primary.btn--block', { type: 'submit' }, submitLabel));
      return form;
    },
  });
}
