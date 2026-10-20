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
 * **The stickers print as the slides come up.** A farm's plates go out four
 * people to a bag, and a bag never holds two houses (`bagsOf`): ten people in
 * one house are three bags, four, four and two. A bag's sticker says where it
 * goes — the farm and the house, nothing else — and a person gets one sticker
 * per container: two for somebody on two comidas, one for somebody on one.
 * The farm's slide prints its first bag's sticker, and every Siguiente after
 * it that lands on a person sends that person's stickers — after their bag's,
 * when they are the first one in it. The container is labelled while the food
 * is going into it, and each bag before its first plate goes in, rather than
 * at the end from a pile. The libreta always starts at the beginning, which
 * is its first farm, so opening it prints that farm's first bag.
 *
 * Going back never prints: that is how somebody checks a name they already
 * packed, and a sticker for every check is a roll of labels gone by Wednesday.
 * Going forward again does, which is how a jammed sticker is replaced. A
 * person's slide also has a button for one more of their stickers, and a
 * slide where a bag's sticker came out has one for the bag. A bag packed by
 * hand — two people's food, or three — gets its sticker from Etiqueta
 * especial, at the top right, where the packer taps who went in it.
 *
 * Printing has two switches. Empaque → Configurar turns it off for the whole
 * kitchen, which is what the morning the printer dies wants. The one at the
 * top right of this screen stops Siguiente printing on this computer, for
 * today: to walk back over people already packed and forward again without a
 * sticker for each — which used to mean pulling the printer's cable out. The
 * buttons that say "imprimir" print either way; pressing one is the decision.
 *
 * **It carries on where it was left.** Going out to the menu and back, or
 * closing the browser, comes back to the same person on this computer — with
 * no stickers, because theirs came out when they first came up — and the next
 * Siguiente prints as usual. Only a libreta opened for the first time that
 * day starts at its first farm and prints its first bag. Terminar forgets the
 * place, so the libreta opened again after it starts from the top.
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
import { button, emptyState, skeletonRows, dataErrorCard, alert } from '../ui/kit.js';
import { toastBad } from '../ui/overlay.js';
import { go } from '../lib/router.js';
import { store, subscribe, activeClients, isReady, startStore } from '../data/store.js';
import {
  watchPacking, watchPackers, startRun, finishRun, noteProgress, seatedPacker,
  printingPaused, pausePrinting, savedSpot, saveSpot, runIdOf,
} from '../data/packing.js';
import { printStickers } from '../ui/print.js';
import { specialLabel } from '../ui/special-label.js';
import {
  packingSequence, lineOf, canDo, bagAt, slideKey, spotIndex,
} from '../lib/packing.js';
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
  let atKey = null;        // and who or what is on it — see `keyOf`
  let plan = null;         // the sequence, rebuilt when the roster changes
  let runId = null;        // the record this morning is being written to
  let opening = false;
  let placed = false;      // put where this computer left it, once
  let resumed = false;     // ...and it had left it somewhere today
  let finished = false;    // Terminar: nothing more to remember
  let bagOnOpen = false;   // the first farm's bag, printed once when it opens
  let paused = printingPaused(day);   // this computer's switch, top right
  let seen = null;         // who has been on the screen this pass, by id

  // Whether this kitchen prints stickers at all (Empaque → Configurar). The
  // switch at the top right only decides whether Siguiente prints them.
  const prints = () => Boolean(setup?.autoPrint);

  // Nobody at the keyboard: the record would have no name on it, which is the
  // whole reason the number is asked for. Back to the door.
  if (!packer) {
    go('/empaque', { replace: true });
    return () => {};
  }

  const stops = [
    watchPacking((found) => { setup = found; rebuild(); paint(); },
      (error) => { failure = error; paint(); }),
    // Permission to pack can be taken away while somebody is halfway through a
    // libreta. They are sent back to where the libretas are offered, which
    // says why; the record of what they already packed stays as it is.
    watchPackers((rows) => {
      if (!rows.length) return;
      const record = rows.find((row) => row.id === packer.id);
      if (!record || record.active === false || !canDo(record, 'pack')) {
        go('/empaque', { replace: true });
      }
    }, () => {}),
  ];

  /** The order of the morning, and where we are in it. */
  function rebuild() {
    const line = lineOf(setup?.lines, lineId);
    if (!line || !isReady()) { plan = null; return; }

    plan = {
      line,
      ...packingSequence({
        line, lines: setup.lines, farms: store.farms, clients: activeClients(), day,
      }),
    };
    // The first time, where this computer left this libreta today, if it did.
    if (!placed) {
      placed = true;
      const spot = savedSpot(lineId, day);
      if (spot) {
        resumed = true;
        at = spot.index;
        atKey = spot.key;
        if (Array.isArray(spot.seen)) seen = new Set(spot.seen);
      }
    }
    // Then the same person, wherever the list now puts them (`spotIndex`):
    // the screen stays on who it was on, not on the number. A list that comes
    // back empty for a moment while the roster reloads moves nothing.
    if (plan.slides.length) {
      at = spotIndex(plan.slides, { key: atKey, index: at });
      atKey = keyOf(at);
      // A place written down before anybody kept count: whoever is before it
      // was packed, as far as anybody can tell.
      if (!seen) seen = new Set(plan.slides.slice(0, at).map(personOf).filter(Boolean));
      see(at);
      remember();
    }
    open();

    // A libreta opened for the first time today opens on its first farm, and
    // arriving there is the same as pressing Siguiente onto it: that farm's
    // bag gets its sticker. Coming back to one already started prints nothing
    // — whoever is on the screen had theirs when they first came up. Once
    // either way: the roster changing later rebuilds the plan, and that is not
    // an arrival.
    if (!bagOnOpen && plan.slides.length) {
      bagOnOpen = true;
      if (!resumed) printFor(at);
    }
  }

  /** Who or what is on a slide of this morning — see `slideKey`. */
  function keyOf(index) {
    return slideKey(plan?.slides, index);
  }

  /**
   * Writes down, on this computer, where this libreta is. Not once it is
   * finished: the list can still change in the moment before the screen
   * closes, and writing the place down again then would bring the next
   * opening back to the end instead of to the top.
   */
  function remember() {
    if (!finished && plan?.slides.length) {
      saveSpot(lineId, day, { key: atKey, index: at, seen: [...(seen || [])] });
    }
  }

  /** The person on a slide, by id; nothing for a farm or the end. */
  function personOf(slide) {
    return slide?.kind === 'client' ? slide.client.id : null;
  }

  function see(index) {
    const id = personOf(plan?.slides[index]);
    if (id && seen) seen.add(id);
  }

  /**
   * People the list now puts behind the place this libreta is at, who were
   * never on the screen: added, or moved here, after the packer went past
   * where they go. Nothing else would ever bring them up — Siguiente only goes
   * forward — so they are said at the top until somebody deals with them.
   */
  function missed() {
    if (!plan || !seen) return [];
    const out = [];
    for (let i = 0; i < at; i += 1) {
      const id = personOf(plan.slides[i]);
      if (id && !seen.has(id)) out.push({ slide: plan.slides[i], index: i });
    }
    return out;
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
    // Known before it is written, so the count and Terminar go to it even
    // while the first write waits on the internet — they queue up behind it.
    runId = runIdOf(day, plan.line.id);
    startRun({
      line: plan.line, packer, day,
      people: plan.people, plates: plan.plates, farms: plan.farmCount,
    })
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
    atKey = keyOf(at);
    see(at);
    remember();
    paint();

    // Forward only. Going back is how somebody checks a name they already
    // packed, and a second sticker coming out of the printer every time they
    // do that is how a roll of labels disappears by Wednesday.
    if (step > 0) printFor(at);

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
   * The stickers for the slide at `index`, if this machine prints them, in one
   * job: a farm's slide prints its first bag's — the farm and the house; a
   * person's prints theirs — one per comida — after their bag's, when they are
   * the first in a bag after the first; the last slide is a summary that goes
   * on nothing.
   *
   * `extra` is the button for one more of a person's stickers; `bagOnly`, the
   * one for their bag's again. `pressed` is any button: those print with the
   * switch off too — somebody pressing "imprimir" has decided — while the
   * stickers that come out by themselves with Siguiente obey it.
   *
   * Wrapped, because a printer that is off or out of paper must not stop the
   * morning — the screen is the job, the stickers are the convenience.
   */
  function printFor(index, {
    extra = false, bagOnly = false, pressed = false, alone = false,
  } = {}) {
    const slide = plan?.slides[index];
    if (!prints() || !slide || (paused && !pressed)) return;
    try {
      const bag = bagAt(plan.slides, index);
      const bagSticker = bag && {
        farmName: bag.farm?.name || '',
        // "Sin ubicación" is the screen's word for a house nobody wrote down,
        // not a place: a bag like that says the farm and stops.
        placeName: bag.place?.id ? bag.place.name : '',
        day,
        lineName: plan.line?.name || '',
        lineId: plan.line?.id || '',
      };

      if (slide.kind === 'farm' || bagOnly) {
        if (bagSticker) printStickers({ bag: bagSticker });
        return;
      }
      if (slide.kind !== 'client') return;

      const label = {
        client: slide.client,
        farmName: slide.farm?.name || '',
        // "Sin ubicación" is the screen's word, not a place — as on the bag.
        placeName: slide.place?.id ? slide.place.name : '',
        day,
        lineName: plan.line?.name || '',
        lineId: plan.line?.id || '',
        // Their place in the libreta: the people up to and including them.
        sequence: plan.slides.slice(0, index + 1).filter((one) => one.kind === 'client').length,
        appUrl: store.business?.appUrl || '',
      };
      const copies = extra ? 1 : Math.max(1, Number(slide.plates) || 1);
      printStickers({
        // The farm's slide already sent the first bag's; each one after it
        // comes out with the first person who goes in it.
        // `alone` is somebody packed out of turn: their own, nothing else.
        bag: !extra && !alone && bag?.starts && bag.number > 1 ? bagSticker : null,
        labels: Array.from({ length: copies }, (unused, i) => ({
          ...label,
          copy: copies > 1 ? { at: i + 1, of: copies } : null,
        })),
      });
    } catch (error) {
      toastBad(`No se pudo imprimir la etiqueta: ${errorText(error)}`);
    }
  }

  /** A small button that prints without moving, and gives the keyboard back. */
  const reprint = (label, options) => h('button.pkreprint', {
    type: 'button',
    onclick: (event) => { event.currentTarget.blur(); printFor(at, { ...options, pressed: true }); },
  }, icon('printer'), label);

  function finish() {
    // Walked to the end: the next time this libreta is opened, it is a new pass.
    finished = true;
    saveSpot(lineId, day, null);
    // Back to the menu at once. The record follows by itself, now or when the
    // internet comes back; waiting on it is a button that does nothing.
    if (runId) {
      finishRun(runId, { packed: plan ? plan.people : 0 }).catch((error) => toastBad(errorText(error)));
    }
    go('/empaque');
  }

  const onKey = (event) => {
    if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') return;
    // A key held down repeats thirty times a second, each one a Siguiente and
    // its stickers; and Ctrl or Alt with an arrow is the browser's, not ours.
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    // A sheet is open over the libreta — Etiqueta especial — and the space bar
    // is choosing people in it, not moving the libreta underneath.
    if (document.querySelector('.scrim')) return;
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
    // Only what packing reads can stop it: the farms and the people. A chat or
    // a bill that failed to load is the office's problem, not the morning's.
    // And not even those, while this computer already has them: with no
    // internet, or the day's database allowance spent, the list saved here is
    // enough to pack from.
    const broken = failure || store.errors.farms || store.errors.clients || null;
    if (broken && !canPackFromHere()) return dataErrorCard(broken, { onRetry: () => startStore() });
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
        text: 'Ninguna de sus ubicaciones tiene gente que coma hoy.',
        action: button('Regresar', { variant: 'primary', size: 'lg', onClick: () => go('/empaque') }),
      });
    }

    const slide = plan.slides[at];
    return h('div.pkstage__wrap',
      broken ? offlineNote() : null,
      progress(),
      missedBanner(),
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
      h('div.pkbar__row',
        // How many people are packed, and nothing else. The number of farms
        // was on this line too; it never changed while anybody was reading it.
        h('div.pkbar__text', `${number(done)} de ${number(people)}`),
        prints()
          ? h('div.pkbar__tools',
              plan.slides[at]?.kind === 'done' ? null : specialButton(),
              printSwitch())
          : null));
  }

  /** Whether this computer already holds what packing needs. */
  function canPackFromHere() {
    return !!setup && store.farms.length > 0 && store.clients.length > 0;
  }

  function offlineNote() {
    return alert('Sin conexión con la base de datos. Se empaca con la lista guardada en esta '
      + 'computadora; alguien agregado hace un momento podría no salir.', 'warn');
  }

  /** Somebody behind the place it is at who was never packed — see `missed`. */
  function missedBanner() {
    const behind = missed();
    if (!behind.length) return null;
    const [{ slide, index }] = behind;
    const where = [slide.farm?.name, slide.place?.id ? slide.place.name : '']
      .filter(Boolean).join(' · ');
    const act = (label, ico, fn) => h('button.pkreprint', {
      type: 'button',
      onclick: (event) => { event.currentTarget.blur(); fn(); },
    }, icon(ico), label);
    return h('div.pkmissed', { role: 'alert' },
      h('div.pkmissed__text',
        h('strong', behind.length > 1
          ? `Faltan ${behind.length} personas que se agregaron antes de donde vas`
          : 'Falta alguien que se agregó antes de donde vas'),
        h('span', `${slide.client.name}${where ? ` · ${where}` : ''}`
          + `${slide.plates > 1 ? ` · ${slide.plates} comidas` : ''}`)),
      h('div.pkmissed__acts',
        prints() ? act('Imprimir sus etiquetas', 'printer',
          () => printFor(index, { pressed: true, alone: true })) : null,
        act('Ya lo empaqué', 'check', () => {
          seen.add(slide.client.id);
          remember();
          paint();
        })));
  }

  /**
   * Etiqueta especial: a bag's sticker with the people the packer taps — for
   * a bag of two or three, not the libreta's four. It offers the farm on the
   * screen, house by house, as far as the next farm.
   */
  function specialButton() {
    return h('button.pkspecial', {
      type: 'button',
      onclick: (event) => {
        event.currentTarget.blur();
        let head = at;
        while (head > 0 && plan.slides[head].kind !== 'farm') head -= 1;
        const groups = [];
        for (let i = head + 1; i < plan.slides.length && plan.slides[i].kind === 'client'; i += 1) {
          const one = plan.slides[i];
          const last = groups[groups.length - 1];
          const person = { id: one.client.id, name: one.client.name, plates: one.plates };
          if (last && (last.place?.id || '') === (one.place?.id || '')) last.people.push(person);
          else groups.push({ place: one.place, people: [person] });
        }
        const slide = plan.slides[at];
        specialLabel({
          farm: plan.slides[head].farm,
          groups,
          here: slide.kind === 'client' ? slide.client.id : null,
          day,
          lineName: plan.line?.name || '',
          lineId: plan.line?.id || '',
        });
      },
    }, icon('note'), 'Etiqueta especial');
  }

  /**
   * Whether Siguiente prints, on this computer, in one click: top right, in
   * the same place on every slide, and away from the two big buttons a wet
   * thumb is aiming for. Off is red, so a pause nobody undid is noticed before
   * a bag goes out with nothing on it. Turning it back on prints nothing by
   * itself; the next Siguiente does. The buttons that say "imprimir" print
   * either way.
   */
  function printSwitch() {
    const on = !paused;
    return h(`button.pkprint${on ? '' : '.is-off'}`, {
      type: 'button',
      role: 'switch',
      'aria-checked': on ? 'true' : 'false',
      onclick: () => {
        paused = on;
        pausePrinting(day, paused);
        // Repainting drops the button and the keyboard with it, so the space
        // bar goes on moving the libreta rather than flipping this again.
        paint();
      },
    },
    icon('printer'),
    h('span.pkprint__text', on ? 'Siguiente imprime' : 'Siguiente no imprime'),
    h('span.pkprint__switch', h('span.pkprint__knob')));
  }

  /* --- The three kinds of slide ---------------------------------------------- */

  function farmSlide(slide) {
    const bag = bagAt(plan.slides, at);
    return h('div.pkfarm',
      h('div.pkfarm__eyebrow', 'Sigue esta farma'),
      h('h2.pkfarm__name', slide.farm.name),
      // Which of its locations come now, in the order they come. The libreta
      // goes location by location, so a farm can come back later in the
      // morning for its other houses; this says which part of it this is.
      (slide.places || []).length
        ? h('div.pkfarm__places', slide.places.map((place) => place.name).join(' · '))
        : null,
      // One line instead of two stacked columns of figures. It is the size of
      // what is coming, read once; the line under the name is enough for that.
      h('div.pkfarm__nums',
        h('span', h('b', number(slide.people)), slide.people === 1 ? ' persona' : ' personas'),
        h('span.pkfarm__dot', '·'),
        h('span', h('b', number(slide.plates)), slide.plates === 1 ? ' comida' : ' comidas'),
        bag?.of > 1 ? h('span.pkfarm__dot', '·') : null,
        bag?.of > 1 ? h('span', h('b', number(bag.of)), ' bolsas') : null),

      // The first bag's sticker came out when this slide did. This is for
      // when it jammed — and for the first farm, which has no slide before it
      // to step back to and come forward from.
      prints()
        ? reprint(bag?.of > 1
          ? 'Volver a imprimir la etiqueta de la bolsa 1'
          : 'Volver a imprimir la etiqueta de la bolsa')
        : null);
  }

  function clientSlide(slide) {
    const { client } = slide;
    const diet = (client.tags || []).filter(Boolean);
    const note = String(client.notes || '').trim();
    const bag = bagAt(plan.slides, at);

    return h('div.pkperson',
      h('div.pkperson__where',
        [slide.farm.name, slide.place?.name].filter(Boolean).join(' · '),
        // Which of the farm's bags their food goes in, when it has more than
        // one: the bag on the counter has the same number on its sticker.
        bag?.of > 1 ? h('span.pkperson__bag', `Bolsa ${bag.number} de ${bag.of}`) : null),

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
      note ? h('p.pknote', note) : null,

      // Their stickers came out when this slide did — one per comida. One
      // more, for a container that needs it; and this bag's again, on the
      // slide where it came out.
      prints()
        ? h('div.pkreprints',
            reprint('Imprimir otra etiqueta', { extra: true }),
            bag?.starts && bag.number > 1
              ? reprint(`Volver a imprimir la etiqueta de la bolsa ${bag.number}`, { bagOnly: true })
              : null)
        : null);
  }

  function doneSlide() {
    return h('div.pkdone',
      h('div.pkdone__ico', icon('check')),
      h('h2.pkdone__title', '¡Libreta terminada!'),
      h('p.pkdone__text',
        `Empacaste ${plural(plan.people, 'persona', 'personas')} `
        + `y ${plural(plan.plates, 'comida', 'comidas')} de `
        + `${plural(plan.farmCount, 'farma', 'farmas')}.`),
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
  const unsubscribe = subscribe(() => {
    // A libreta is one morning's. Still open when the date turns, it goes back
    // to the menu, which opens on the new day.
    if (today() !== day) { setTimeout(() => { if (life.alive()) go('/empaque'); }); return; }
    rebuild();
    paint();
  });
  return life.ending(unsubscribe, ...stops,
    () => document.removeEventListener('keydown', onKey));
}
