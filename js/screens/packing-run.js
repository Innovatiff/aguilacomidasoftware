/**
 * Empacar una libreta — one thing on the screen at a time.
 *
 * A farm, then that farm's people one by one, then the next farm. Forward,
 * backward, and nothing else: no list to lose your place in, no form, no
 * decision. The person using this has a plate in one hand.
 *
 * What is on a person's screen is decided by what gets somebody's food wrong:
 *
 *   1. **How many plates**, in the largest type on the screen. It is the one
 *      number that has to be right, and it is read before the name.
 *   2. **What they cannot eat**, next, in red, before anything else about
 *      them. A restriction read after the lid is closed is a restriction that
 *      did not work.
 *   3. **Their name**, big enough to check against the label.
 *   4. **The note the kitchen wrote** — "trabaja de noche, dejar con el
 *      encargado" — last, because it is read once the plate is made.
 *
 * The keyboard moves it too: space, enter or the right arrow go forward, the
 * left arrow goes back. On a counter machine with a cheap mouse that is the
 * difference between a pleasant morning and a long one.
 *
 * Nothing here can change a client. It is a reading screen with two buttons; a
 * packer cannot edit the roster by accident at half past five in the morning.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, lifetime } from '../ui/shell.js';
import { button, emptyState, skeletonRows, dataErrorCard } from '../ui/kit.js';
import { toastBad } from '../ui/overlay.js';
import { go } from '../lib/router.js';
import { store, subscribe, activeClients, isReady, firstError, startStore } from '../data/store.js';
import {
  watchPacking, startRun, finishRun, noteProgress,
  seatedPacker, rememberSlide, recallSlide, forgetSlide,
} from '../data/packing.js';
import { packingSequence, lineOf } from '../lib/packing.js';
import { today, formatDayLong, capitalize } from '../lib/dates.js';
import { plural, number } from '../lib/format.js';
import { errorText } from '../firebase.js';

export function renderPackingRun(context) {
  const life = lifetime();
  const day = today();
  const lineId = context.params.id;
  const packer = seatedPacker();

  let setup = null;
  let failure = null;
  let at = 0;              // which slide
  let plan = null;         // the sequence, rebuilt when the roster changes
  let runId = null;        // the record this morning is being written to
  let opening = false;

  // Nobody at the keyboard: the record would have no name on it, which is the
  // whole reason the number is asked for. Back to the door.
  if (!packer) {
    go('/empaque', { replace: true });
    return () => {};
  }

  const stops = [
    watchPacking((found) => { setup = found; rebuild(); paint(); },
      (error) => { failure = error; paint(); }),
  ];

  /** The order of the morning, and where we are in it. */
  function rebuild() {
    const line = lineOf(setup?.lines, lineId);
    if (!line || !isReady()) { plan = null; return; }

    plan = { line, ...packingSequence({ line, farms: store.farms, clients: activeClients(), day }) };
    // Somebody who closed the browser at plate nineteen comes back to plate
    // nineteen. Clamped, because the roster may have shrunk since.
    if (!runId && !at) at = Math.min(recallSlide(day, lineId), Math.max(0, plan.slides.length - 1));
    if (at > plan.slides.length - 1) at = Math.max(0, plan.slides.length - 1);
    open();
  }

  /**
   * Writes the day's record the first time this libreta is opened.
   *
   * At the start rather than at the end, so the other computer can see who is
   * on which list — and so a morning cut short still leaves evidence somebody
   * began, instead of leaving the manager to work out from nothing why half a
   * farm has no food.
   */
  function open() {
    if (runId || opening || !plan?.people) return;
    opening = true;
    startRun({
      line: plan.line, packer, day,
      people: plan.people, plates: plan.plates, farms: plan.farms.length,
    })
      .then((run) => { if (life.alive()) runId = run.id; })
      .catch((error) => { if (life.alive()) toastBad(errorText(error)); })
      .finally(() => { opening = false; });
  }

  const packedSoFar = () => (plan
    ? plan.slides.slice(0, at + 1).filter((slide) => slide.kind === 'client').length
    : 0);

  function move(step) {
    if (!plan) return;
    const next = Math.max(0, Math.min(at + step, plan.slides.length - 1));
    if (next === at) return;
    at = next;
    rememberSlide(day, lineId, at);
    paint();

    // The record keeps the count, not every step: it is written when a farm
    // starts or ends, and every fifth person in between. Often enough that the
    // other computer can see the morning moving, rare enough not to sit between
    // a hand and the next name.
    const done = packedSoFar();
    if (runId && (plan.slides[at]?.kind !== 'client' || done % 5 === 0)) {
      noteProgress(runId, done).catch(() => { /* the count is not the food */ });
    }
  }

  function finish() {
    forgetSlide(day, lineId);
    const close = runId
      ? finishRun(runId, { packed: plan ? plan.people : 0 })
      : Promise.resolve();
    close.catch((error) => toastBad(errorText(error)))
      .finally(() => go('/empaque'));
  }

  const onKey = (event) => {
    if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') return;
    if ([' ', 'Enter', 'ArrowRight', 'PageDown'].includes(event.key)) { event.preventDefault(); move(1); }
    if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); move(-1); }
  };
  document.addEventListener('keydown', onKey);

  /* --- Drawing --------------------------------------------------------------- */

  function paint() {
    if (!life.alive()) return;
    screen({
      title: plan?.line?.name || 'Empaque',
      subtitle: `${packer.name} · ${capitalize(formatDayLong(day))}`,
      backTo: '/empaque',
      tab: 'home',
      // The tab bar is a way out of a job somebody is halfway through. The
      // chevron is the way out, and it is one place.
      hideTabs: true,
      sunken: true,
      body: h('div.page__inner.pkstage', bodyFor()),
    });
  }

  function bodyFor() {
    const broken = failure || firstError();
    if (broken) return dataErrorCard(broken, { onRetry: () => startStore() });
    if (!setup || !isReady()) return skeletonRows(4);

    if (!lineOf(setup.lines, lineId)) {
      return emptyState({
        icon: 'search',
        title: 'Esa libreta ya no existe',
        text: 'El encargado pudo haberla cambiado. Regresa y escoge otra.',
        action: button('Regresar', { variant: 'primary', size: 'lg', onClick: () => go('/empaque') }),
      });
    }

    if (!plan?.slides.length) {
      return emptyState({
        icon: 'box',
        title: 'Hoy no hay nada que empacar en esta libreta',
        text: 'Ninguno de sus ranchos tiene gente que coma hoy.',
        action: button('Regresar', { variant: 'primary', size: 'lg', onClick: () => go('/empaque') }),
      });
    }

    const slide = plan.slides[at];
    return h('div.pkstage__wrap',
      progress(),
      h('div.pkstage__slide',
        slide.kind === 'farm' ? farmSlide(slide)
          : slide.kind === 'client' ? clientSlide(slide)
            : doneSlide()),
      footer(slide));
  }

  function progress() {
    const people = plan.people || 1;
    const done = packedSoFar();
    return h('div.pkbar',
      h('div.pkbar__track', h('div.pkbar__fill', {
        style: { width: `${Math.round((done / people) * 100)}%` },
      })),
      h('div.pkbar__text',
        h('span', `${number(done)} de ${number(people)}`),
        h('span', plural(plan.farms.length, 'rancho', 'ranchos'))));
  }

  /* --- The three kinds of slide ---------------------------------------------- */

  function farmSlide(slide) {
    return h('div.pkfarm',
      h('div.pkfarm__eyebrow', 'Sigue este rancho'),
      h('h2.pkfarm__name', slide.farm.name),
      h('div.pkfarm__nums',
        h('div.pkfarm__num',
          h('span.pkfarm__n', number(slide.people)),
          h('span.pkfarm__l', slide.people === 1 ? 'persona' : 'personas')),
        h('div.pkfarm__num',
          h('span.pkfarm__n', number(slide.plates)),
          h('span.pkfarm__l', 'comidas'))),
      h('p.pkfarm__hint', 'Dale a Siguiente para ver a la primera persona.'));
  }

  function clientSlide(slide) {
    const { client } = slide;
    const diet = (client.tags || []).filter(Boolean);
    const note = String(client.notes || '').trim();

    return h('div.pkperson',
      h('div.pkperson__where',
        h('span', slide.farm.name),
        slide.place?.name ? h('span.pkperson__dot', '·') : null,
        slide.place?.name ? h('span', slide.place.name) : null),

      // 1. How many. The number the morning turns on.
      h('div.pkperson__plates',
        h('span.pkperson__count', number(slide.plates)),
        h('span.pkperson__word', slide.plates === 1 ? 'comida' : 'comidas')),

      // 2. What they cannot eat, before the name and impossible to scroll past.
      diet.length
        ? h('div.pkdiet',
            h('div.pkdiet__head', icon('alert'), 'No puede comer'),
            h('div.pkdiet__tags', diet.map((tag) => h('span.pkdiet__tag', tag))))
        : null,

      // 3. Who it is for.
      h('h2.pkperson__name', client.name),

      // 4. What the kitchen wrote in the margin.
      note
        ? h('div.pknote',
            h('div.pknote__head', icon('note'), 'Nota'),
            h('p.pknote__text', note))
        : null);
  }

  function doneSlide() {
    return h('div.pkdone',
      h('div.pkdone__ico', icon('check')),
      h('h2.pkdone__title', '¡Libreta terminada!'),
      h('p.pkdone__text',
        `Empacaste ${plural(plan.people, 'persona', 'personas')} `
        + `y ${plural(plan.plates, 'comida', 'comidas')} de `
        + `${plural(plan.farms.length, 'rancho', 'ranchos')}.`),
      h('p.pkdone__who', `Queda registrado a nombre de ${packer.name}.`));
  }

  /* --- The two buttons, always in the same two places ------------------------ */

  function footer(slide) {
    const last = slide.kind === 'done';
    return h('div.pkfoot',
      h('button.pkbtn.pkbtn--back', {
        type: 'button', disabled: at === 0, onclick: () => move(-1),
      }, icon('chevronL'), 'Atrás'),

      last
        ? h('button.pkbtn.pkbtn--done', { type: 'button', onclick: finish },
            icon('check'), 'Terminar')
        : h('button.pkbtn.pkbtn--go', { type: 'button', onclick: () => move(1) },
            'Siguiente', icon('chevronR')));
  }

  rebuild();
  const unsubscribe = subscribe(() => { rebuild(); paint(); });
  return life.ending(unsubscribe, ...stops,
    () => document.removeEventListener('keydown', onKey));
}
