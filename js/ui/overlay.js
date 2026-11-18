/** Transient UI: toasts, bottom sheets, confirmation dialogs. */

import { h, mount } from '../lib/dom.js';
import { errorText } from '../firebase.js';
import { icon } from '../lib/icons.js';
import { button } from './kit.js';
import { t } from '../lib/i18n.js';

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
 * How long a closed sheet stays in the page, unseen, catching stray clicks:
 * as long as Windows still counts two clicks as one double click.
 */
const CLOSING_MS = 500;

/** True while a sheet is open — not one that is on its way out. */
export const sheetOpen = () => !!document.querySelector('.scrim:not(.scrim--closing)');

/** Closes whatever is open, at once: the session ended, the screens are gone. */
export function closeSheets() {
  for (const scrim of document.querySelectorAll('.scrim')) scrim.remove();
}

/**
 * Opens a bottom sheet. `build(close)` returns the body; the returned promise
 * resolves with whatever `close(value)` was called with (undefined if dismissed).
 *
 * `close.hold(true)` keeps the sheet from being dismissed — the X, Escape, a
 * tap outside — while it is in the middle of writing something. A payment
 * that says «Cobrando…» is already on its way: a sheet closed over it told
 * its caller "nothing was taken", and the same person could be charged again
 * before the first receipt landed. `close.hold(false)` lets go, for a write
 * that failed and can be tried again.
 */
export function sheet({ title, build, foot, dismissible = true, wide = false }) {
  return new Promise((resolve) => {
    let settled = false;
    let held = false;

    const close = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onLeave);
      scrim.classList.add('scrim--closing');
      scrim.style.animation = 'fade 160ms var(--ease) reverse forwards';
      panel.style.animation = 'rise 180ms var(--ease) reverse forwards';
      // Gone from sight in 160ms, and from the page a little after: the second
      // half of a double click on a button that closes the sheet used to land
      // on whatever was underneath it — in the kitchen, on Siguiente.
      setTimeout(() => scrim.remove(), CLOSING_MS);
      resolve(value);
    };
    close.hold = (on = true) => { held = !!on; };

    const dismiss = () => { if (dismissible && !held) close(undefined); };

    // Only the sheet on top answers Escape. Every open sheet hears the key,
    // and they all used to close: cancelling a confirmation took the form
    // underneath with it, and what had been typed there.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const open = [...document.querySelectorAll('.scrim:not(.scrim--closing)')];
      if (open[open.length - 1] === scrim) dismiss();
    };

    /*
     * A sheet is appended to the document, not to the page, so it survives a
     * route change: leaving by the browser's back button — or by a button
     * inside the sheet that navigates — would otherwise leave it floating over
     * whatever came next.
     */
    const onLeave = () => close(undefined);

    // `wide` is for the rare sheet that is a workspace rather than a question —
    // putting forty locations in order wants the whole screen, not 560px of it.
    const panel = h(`div.sheet${wide ? '.sheet--wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || t('Diálogo') },
      h('div.sheet__grip'),
      title ? h('div.sheet__head',
        h('h2.sheet__title', title),
        dismissible ? h('button.btn.btn--quiet.btn--icon',
          { type: 'button', 'aria-label': t('Cerrar'), onclick: dismiss }, icon('x')) : null,
      ) : null,
      h('div.sheet__body', build(close)),
      foot ? h('div.sheet__foot', foot(close)) : null);

    const scrim = h('div.scrim', {
      onclick: (e) => { if (e.target === scrim) dismiss(); },
    }, panel);

    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onLeave);
    document.body.append(scrim);

    // Focus the first real control so keyboards and screen readers land inside.
    queueMicrotask(() => {
      const first = panel.querySelector(`input, textarea, select, button:not([aria-label="${t('Cerrar')}"])`);
      first?.focus({ preventScroll: true });
    });
  });
}

/** Yes/no confirmation. Resolves true only when the action is confirmed. */
export function confirm({
  title, message, confirmLabel = t('Confirmar'), cancelLabel = t('Cancelar'),
  tone = 'primary', icon: ico,
}) {
  return sheet({
    title,
    build: () => h('div.stack.stack-3',
      ico ? h('div.empty__icon', { style: { margin: '0 auto' } }, icon(ico)) : null,
      h('p.t-base.c-soft.center', { style: { lineHeight: '1.5' } }, message)),
    foot: (close) => h('div.stack.stack-2',
      button(confirmLabel, { variant: tone, block: true, onClick: () => close(true) }),
      button(cancelLabel, { variant: 'ghost', block: true, onClick: () => close(false) })),
  }).then((value) => value === true);
}

/**
 * A sheet wrapping a form. `fields(close)` returns the controls; on submit the
 * sheet hands the collected FormData values to `onSubmit` and closes on success.
 */
export function formSheet({ title, fields, submitLabel = t('Guardar'), onSubmit }) {
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
          mount(submit, h('span.spinner.spinner--light'), t('Guardando…'));
          close.hold(true);
          try {
            const result = await onSubmit(values);
            if (result !== false) close(result ?? values);
          } catch (error) {
            toastBad(errorText(error));
          } finally {
            close.hold(false);
            if (submit.isConnected) { submit.disabled = false; mount(submit, label); }
          }
        },
      }, body, h('button.btn.btn--primary.btn--block', { type: 'submit' }, submitLabel));
      return form;
    },
  });
}
