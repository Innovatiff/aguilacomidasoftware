/**
 * Acción rápida — one question per screen, Atrás and Siguiente always in the
 * same two places.
 *
 * This is the counter's interface, not the manager's. It runs on the store's
 * point-of-sale PC — an old Windows machine with a bad panel and a mouse —
 * while somebody stands on the other side of the counter waiting. Everything
 * about it follows from that:
 *
 *   - **One decision per slide.** Two inputs at most. A form with nine fields
 *     is a form somebody abandons halfway with a queue behind them.
 *   - **The two buttons never move.** Atrás bottom-left, Siguiente bottom-right,
 *     the same size on every step of every action. Muscle memory is the whole
 *     point; a footer that rearranges itself is a footer nobody trusts.
 *   - **Nothing is written until the last slide.** Every step before the
 *     confirmation is free to go back to, so a wrong tap costs a click rather
 *     than a correction in the ledger.
 *   - **The confirmation restates it in words.** Somebody about to take $150 in
 *     cash reads what it will do before it does it.
 *
 * A step redraws only when it says so. `refresh()` rebuilds the current slide —
 * needed when picking a rancho changes which locations exist — and everything
 * else calls `revalidate()`, which only re-checks whether Siguiente can light
 * up. Rebuilding on every keystroke would take the cursor out of the search box
 * mid-word, which is exactly the bug this shape avoids.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { toastBad } from './overlay.js';
import { today, formatDayLong, capitalize } from '../lib/dates.js';
import { dbMessage } from '../firebase.js';

/**
 * @typedef {object} Step
 * @property {string}   id
 * @property {string}   title    the question, set large
 * @property {string}   [hint]   one line under it
 * @property {Function} build    (state, api) => Node
 * @property {Function} [ready]  (state) => boolean — enables Siguiente
 * @property {string}   [next]   label override for the forward button
 * @property {boolean}  [last]   this is the confirmation; Siguiente commits
 */

/**
 * Runs one action to completion.
 *
 * @param {object} config
 * @param {string} config.title
 * @param {Function} config.steps   (state) => Step[]  — recomputed as state grows
 * @param {object} [config.state]   seed state
 * @param {Function} config.commit  async (state) => result
 * @param {Function} config.done    (state, result) => { what, who, note, extra }
 * @param {Function} config.onExit  called when the operator leaves
 */
export function runFlow({ title, steps, state = {}, subject, commit, done, onExit }) {
  const model = { ...state };
  let index = 0;
  let direction = 'next';
  let busy = false;
  let finished = null;

  const stepsNow = () => steps(model);

  /* --- Frame ------------------------------------------------------------- */

  const stepBadge = h('span.pos__step');
  const subjectBar = h('div.pos__subject', { hidden: true });
  const body = h('div.pos__body');

  const backBtn = h('button.posbtn', { type: 'button', onclick: goBack },
    icon('chevronL'), h('span', 'Atrás'));
  // One handler for the forward button, branching on where the flow is. Two
  // handlers on one button is what caused a confirmation to commit twice.
  const nextBtn = h('button.posbtn.posbtn--go', {
    type: 'button',
    onclick: () => (finished ? leave() : goNext()),
  });
  const foot = h('div.pos__foot', backBtn, h('div.pos__next', nextBtn));

  const panel = h('div.pos.pos--flow', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header.pos__bar',
      h('button.pos__exit', { type: 'button', onclick: leave },
        icon('x'), h('span', 'Salir')),
      h('span.pos__mark', icon('eagle')),
      h('span.pos__title', title),
      h('span.pos__day', capitalize(formatDayLong(today()))),
      stepBadge),
    subjectBar,
    body,
    foot);

  const api = { refresh: draw, revalidate, next: goNext, set };

  /** Merge into the model without redrawing — for a field that owns its own DOM. */
  function set(patch) {
    Object.assign(model, patch);
    revalidate();
  }

  /* --- Rendering ---------------------------------------------------------- */

  function draw() {
    const list = stepsNow();
    index = Math.max(0, Math.min(index, list.length - 1));
    const step = list[index];

    stepBadge.textContent = `Paso ${index + 1} de ${list.length}`;
    stepBadge.hidden = false;

    mount(body, h(`div.pos__inner.pos__slide${direction === 'back' ? '.pos__slide--back' : ''}`,
      h('h2.pos__q', step.title),
      step.hint ? h('p.pos__hint', step.hint) : null,
      step.build(model, api)));

    body.scrollTop = 0;
    backBtn.hidden = false;
    // Never dead. On the first step it walks out of the action, which is what
    // somebody who opened the wrong tile is reaching for anyway — and a big
    // striped slab that does nothing is a button people learn to distrust.
    backBtn.disabled = false;
    mount(backBtn, icon('chevronL'), h('span', index === 0 ? 'Cancelar' : 'Atrás'));
    paintSubject();
    revalidate();
    focusFirst();
  }

  /** Who this action is about, kept in view for every step after the pick. */
  function paintSubject() {
    const who = subject?.(model);
    subjectBar.hidden = !who;
    if (!who) return;
    mount(subjectBar,
      h('span.pos__subjectmark', initials(who.name)),
      h('span',
        h('span.pos__subjectname', { style: { display: 'block' } }, who.name),
        who.where ? h('span.pos__subjectwhere', who.where) : null));
  }

  /** The cursor belongs in the first thing worth typing into. */
  function focusFirst() {
    queueMicrotask(() => {
      const first = body.querySelector('input:not([type=hidden]), textarea, select');
      if (first && first.type !== 'date') first.focus({ preventScroll: true });
    });
  }

  function revalidate() {
    const list = stepsNow();
    const step = list[index];
    if (!step) return;
    // Repainted here too: picking somebody should put their name on screen at
    // once, as the receipt that the right person was chosen.
    paintSubject();
    const ok = step.ready ? !!step.ready(model) : true;

    mount(nextBtn,
      step.last ? icon('check') : null,
      h('span', step.next || (step.last ? 'Confirmar' : 'Siguiente')),
      step.last ? null : icon('chevronR'));
    nextBtn.className = `posbtn ${step.last ? 'posbtn--done' : 'posbtn--go'}`;
    nextBtn.disabled = busy || !ok;
  }

  /* --- Moving ------------------------------------------------------------- */

  function goBack() {
    if (busy) return;
    if (finished) { leave(); return; }
    if (index === 0) { leave(); return; }
    direction = 'back';
    index -= 1;
    draw();
  }

  async function goNext() {
    /*
     * `finished` is the guard that matters.
     *
     * The finish screen reuses the same button, and `h()` attaches its handler
     * with addEventListener while a later `onclick =` assignment adds a
     * *second* one rather than replacing the first. Both fired, so one click on
     * "Listo" both left the flow and ran the commit again — a second payment,
     * for the same person, for the same amount, from one press. Nothing after
     * a successful commit may reach the commit again.
     */
    if (busy || finished) return;
    const list = stepsNow();
    const step = list[index];
    if (step.ready && !step.ready(model)) return;

    if (!step.last) {
      direction = 'next';
      index += 1;
      draw();
      return;
    }

    busy = true;
    revalidate();
    mount(nextBtn, h('span.spinner.spinner--light'), h('span', 'Guardando…'));

    try {
      const result = await commit(model);
      finished = done(model, result) || { what: 'Listo' };
      showDone();
    } catch (error) {
      busy = false;
      revalidate();
      toastBad(error?.message || dbMessage(error));
    }
  }

  /* --- The end ------------------------------------------------------------ */

  function showDone() {
    busy = false;
    stepBadge.hidden = true;
    subjectBar.hidden = true;
    mount(body, h('div.pos__inner.pos__slide',
      h('div.posdone',
        h('div.posdone__mark', icon('check')),
        h('div.posdone__what', finished.what),
        finished.who ? h('div.posdone__who', finished.who) : null),
      // Whatever the action wants offered once it is done — printing the
      // receipt, in the only case that has one.
      finished.extra ? h('div.posdone__extra', finished.extra) : null,
      finished.note ? h('div.posnote.posnote--ok', icon('info'), h('div', finished.note)) : null));

    backBtn.hidden = true;
    mount(nextBtn, icon('check'), h('span', 'Listo — hacer otra cosa'));
    nextBtn.className = 'posbtn posbtn--done';
    nextBtn.disabled = false;
    nextBtn.focus({ preventScroll: true });
  }

  function leave() {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', leave);
    panel.remove();
    onExit?.(finished);
  }

  /*
   * A counter keyboard, if there is one, should work: Enter goes forward,
   * Escape steps back. Enter is ignored while the pointer is in a textarea,
   * and never fires the commit by accident — the last step needs a real click
   * or an explicit Enter on the focused button.
   */
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); goBack(); return; }
    if (event.key !== 'Enter') return;
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) return;
    event.preventDefault();
    if (!nextBtn.disabled) goNext();
  }

  document.addEventListener('keydown', onKey);

  /*
   * A flow is appended to the document, not to the page, so it outlives a
   * route change unless it is told not to: leaving with the browser's back
   * button left the counter screen floating over whatever came next, with its
   * keyboard listener still attached. Nothing in it is written before the last
   * step, so walking out is always safe — it just has to actually happen.
   */
  window.addEventListener('hashchange', leave);

  document.body.append(panel);
  draw();

  return { close: leave, el: panel };
}

const initials = (name) => String(name || '?')
  .trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
