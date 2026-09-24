/**
 * Empacar una libreta — one thing on the screen at a time.
 *
 * A farm, then that farm's people one by one, then the next farm. Forward,
 * backward, and nothing else: no list to lose your place in, no form, no
 * decision. The person using this has a plate in one hand.
 *
 * A person's screen is four things down one left edge, and never more:
 *
 *   1. **Where** — the farm and the house, quiet. Within a farm it barely
 *      changes; it is reassurance, not news.
 *   2. **Who, and how many**, on one line. They are read as one thought —
 *      "Rafael Núñez, two meals" — so they are one row rather than two blocks
 *      taking turns at being the biggest thing on the screen. The name is the
 *      larger of the two because it is what goes on the container; the count
 *      is the only orange on the slide, which is how it is found.
 *   3. **What they cannot eat**, when there is anything — red, and the only
 *      thing that interrupts the column. A restriction read after the lid is
 *      closed is a restriction that did not work.
 *   4. **The note the kitchen wrote** — "trabaja de noche, dejar con el
 *      encargado" — last, because it is read once the plate is made.
 *
 * Everything starts at the same left edge on every slide, so the eye lands in
 * the same place forty times in a row instead of hunting for the middle of a
 * name it has not read yet. Nothing is boxed that does not need to be: one
 * card, and inside it two tinted blocks that only appear when they have
 * something to say.
 *
 * **Each person's label prints as they come up.** The libreta always starts at
 * the beginning, the farm slide prints nothing, and every Siguiente that lands
 * on a person sends their sticker to the label printer — so the container is
 * labelled while the food is going into it rather than at the end from a pile.
 * Going back never prints: that is how somebody checks a name they already
 * packed, and a sticker for every check is a roll of labels gone by Wednesday.
 * The whole thing can be switched off in Empaque → Configurar, which is what a
 * machine without a label printer wants — and the morning the printer dies.
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
  watchPacking, startRun, finishRun, noteProgress, seatedPacker,
} from '../data/packing.js';
import { printLabel } from '../ui/print.js';
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
    // Always from the beginning. It used to come back to plate nineteen after
    // a browser was closed, which was right when the screen was only a screen;
    // now every person that goes by prints a label, and resuming halfway means
    // eighteen containers with nothing on them.
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
    paint();

    // Forward only. Going back is how somebody checks a name they already
    // packed, and a second sticker coming out of the printer every time they
    // do that is how a roll of labels disappears by Wednesday.
    if (step > 0) labelFor(plan.slides[at]);

    // The record keeps the count, not every step: it is written when a farm
    // starts or ends, and every fifth person in between. Often enough that the
    // other computer can see the morning moving, rare enough not to sit between
    // a hand and the next name.
    const done = packedSoFar();
    if (runId && (plan.slides[at]?.kind !== 'client' || done % 5 === 0)) {
      noteProgress(runId, done).catch(() => { /* the count is not the food */ });
    }
  }

  /**
   * The sticker for whoever is on screen, if this machine prints them.
   *
   * Only people: a farm slide is a heading and the last slide is a summary,
   * and neither one goes on a container. Wrapped, because a printer that is
   * off or out of paper must not stop the morning — the screen is the job, the
   * label is the convenience.
   */
  function labelFor(slide) {
    if (!setup?.autoPrint || slide?.kind !== 'client') return;
    try {
      printLabel({
        client: slide.client,
        farmName: slide.farm?.name || '',
        placeName: slide.place?.name || '',
        day,
        lineName: plan?.line?.name || '',
        sequence: packedSoFar(),
        appUrl: store.business?.appUrl || '',
      });
    } catch (error) {
      toastBad(`No se pudo imprimir la etiqueta: ${errorText(error)}`);
    }
  }

  function finish() {
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
      tab: 'packing',
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
      // How many people are packed, and nothing else. The number of farms was
      // on this line too; it never changed while anybody was reading it.
      h('div.pkbar__text', `${number(done)} de ${number(people)}`));
  }

  /* --- The three kinds of slide ---------------------------------------------- */

  function farmSlide(slide) {
    return h('div.pkfarm',
      h('div.pkfarm__eyebrow', 'Sigue este rancho'),
      h('h2.pkfarm__name', slide.farm.name),
      // One line instead of two stacked columns of figures. It is the size of
      // what is coming, read once; the line under the name is enough for that.
      h('div.pkfarm__nums',
        h('span', h('b', number(slide.people)), slide.people === 1 ? ' persona' : ' personas'),
        h('span.pkfarm__dot', '·'),
        h('span', h('b', number(slide.plates)), ' comidas')));
  }

  function clientSlide(slide) {
    const { client } = slide;
    const diet = (client.tags || []).filter(Boolean);
    const note = String(client.notes || '').trim();

    return h('div.pkperson',
      h('div.pkperson__where',
        [slide.farm.name, slide.place?.name].filter(Boolean).join(' · ')),

      // Who, and how many, on one line.
      h('div.pkperson__head',
        h('h2.pkperson__name', client.name),
        h('div.pkperson__plates',
          h('span.pkperson__count', number(slide.plates)),
          h('span.pkperson__word', slide.plates === 1 ? 'comida' : 'comidas'))),

      // What they cannot eat. The words themselves usually say it — "sin
      // pollo" — but they are typed by hand, and a tag written "maní" instead
      // of "sin maní" would read as exactly the wrong instruction. So the
      // label stays; it is just the quiet line now, over the loud one.
      diet.length
        ? h('div.pkdiet',
            icon('alert'),
            h('div.pkdiet__body',
              h('span.pkdiet__head', 'No puede comer'),
              h('span.pkdiet__what', diet.join(' · '))))
        : null,

      // What the kitchen wrote in the margin. It does not need a label either;
      // it is the only sentence on the screen.
      note ? h('p.pknote', note) : null);
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
