/**
 * Empaque — the screen the kitchen opens at six in the morning.
 *
 * Two computers, two people, two lists. This is where each of them says who
 * they are and picks the libreta they are going to pack; the packing itself is
 * `packing-run.js`.
 *
 * It is built for somebody standing at a counter with wet hands, not for a
 * manager at a desk. So: three taps to start, targets the size of a fist, and
 * no screen that asks two questions at once. The one piece of cleverness is
 * that both computers watch the same day's records, so the second person to
 * arrive can see that the first is already halfway through Libreta 1 — which is
 * what stops the same food being packed twice and the other farm not at all.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, lifetime, topbarButton } from '../ui/shell.js';
import { button, emptyState, skeletonRows, alert, dataErrorCard } from '../ui/kit.js';
import { go } from '../lib/router.js';
import { store, subscribe, activeClients, isReady, startStore } from '../data/store.js';
import {
  watchPacking, watchPackers, watchPackRuns, seatedPacker, sitDown, savedSpot,
} from '../data/packing.js';
import {
  packingSequence, packerByPin, longerPinFrom, placementProblems, canDo, spotIndex,
} from '../lib/packing.js';
import { today, formatDayLong, formatTime, capitalize } from '../lib/dates.js';
import { versionLabel } from '../version.js';
import { kitchen } from '../lib/mode.js';
import { plural, number } from '../lib/format.js';

export function renderPacking() {
  const life = lifetime();
  const day = today();

  let setup = null;        // config/packing
  let packers = null;      // who may pack
  let runs = [];           // what has been packed today
  let failure = null;
  let packer = seatedPacker();
  let typed = '';
  let wrong = false;
  let waiting = null;      // a number that is also the start of a longer one

  const stops = [
    watchPacking((found) => { setup = found; paint(); }, (error) => { failure = error; paint(); }),
    watchPackers((found) => { packers = found; paint(); }, (error) => { failure = error; paint(); }),
    watchPackRuns(day, (found) => { runs = found; paint(); }, () => { runs = []; paint(); }),
  ];

  function paint() {
    if (!life.alive()) return;
    const content = bodyFor();
    // The keypad gets the whole screen to itself; everything else is a page.
    const asking = content?.classList?.contains('pk__pin');

    screen({
      title: 'Empaque',
      subtitle: capitalize(formatDayLong(day)),
      tab: 'packing',
      // On a kitchen computer there is no tab bar to get back to the menu
      // with, so the chevron is the way; in the panel the tab already is.
      // Not while it is asking for a number, though — there is nothing behind
      // that screen but itself, and a chevron that comes straight back is a
      // button people press twice before deciding the app is broken.
      backTo: kitchen() && !asking ? '/rapido' : undefined,
      sunken: true,
      // The setup — libretas, users, what each user may do — is the manager's,
      // and it is done from the panel. On the kitchen computer a gear here
      // would let anybody who walks past give themselves every permission.
      actions: kitchen() ? [] : [topbarButton('settings', {
        label: 'Configurar el empaque', onClick: () => go('/empaque/ajustes'),
      })],
      body: h(`div.page__inner.pk.stack.stack-5${asking ? '.pk--asking' : ''}`, content),
    });
  }

  function bodyFor() {
    // Only what packing reads can stop it: the farms and the people. A chat or
    // a bill that failed to load is the office's problem, not the morning's.
    // And not even those, while this computer already has them saved: with no
    // internet, or the day's database allowance spent, it packs from here.
    const broken = failure || store.errors.farms || store.errors.clients || null;
    const usable = !!setup && !!packers?.length && store.farms.length > 0 && store.clients.length > 0;
    if (broken && !usable) return dataErrorCard(broken, { onRetry: () => startStore() });
    if (!setup || !packers || !isReady()) return skeletonRows(4);
    if (!packers.length) return noPackers();
    if (!packer) return askPin();
    return broken
      ? h('div.stack.stack-4',
          alert('Sin conexión con la base de datos. Se empaca con la lista guardada en esta '
            + 'computadora; alguien agregado hace un momento podría no salir.', 'warn'),
          pickLine())
      : pickLine();
  }

  /* --- Nobody has been set up yet ---------------------------------------- */

  function noPackers() {
    return emptyState({
      icon: 'users',
      title: 'Todavía no hay usuarios',
      text: kitchen()
        ? 'El encargado tiene que crear los usuarios desde el panel, cada uno con su PIN, '
          + 'antes de poder entrar aquí.'
        : 'Crea los usuarios —nombre, PIN y lo que puede hacer cada uno— antes de poder '
          + 'usar esta pantalla.',
      action: kitchen() ? null : button('Crear usuarios', {
        variant: 'primary', size: 'lg', icon: 'userPlus', onClick: () => go('/empaque/ajustes'),
      }),
    });
  }

  /* --- Who is at this computer -------------------------------------------- */

  function askPin() {
    const dots = h('div.pk__dots');
    const paintDots = () => mount(dots, Array.from({ length: dotCount() }, (unused, i) =>
      h(`span.pk__dot${i < typed.length ? '.is-on' : ''}`)));

    // How long the longest number in use is. Everything is four digits today,
    // but the point is to know when somebody has finished typing: at that
    // length a number that matches nobody is simply wrong, and saying so at
    // once is the difference between "try again" and a keypad that swallows
    // digits until nothing works.
    const longest = Math.max(4, ...packers.map((one) => String(one.pin || '').length));

    // One dot per digit the number could have.
    function dotCount() {
      return Math.max(4, ...packers.map((one) => String(one.pin || '').length));
    }
    paintDots();

    const press = (digit) => {
      wrong = false;
      clearTimeout(waiting);
      typed = (typed + digit).slice(0, longest);
      paintDots();
      // It tries as soon as it could be somebody's number. Nobody should have
      // to reach for a tick they cannot see the point of.
      if (typed.length >= 4) tryIt();
    };

    const rub = () => { wrong = false; clearTimeout(waiting); typed = typed.slice(0, -1); paintDots(); };

    function tryIt() {
      const found = packerByPin(packers, typed);
      // Somebody's number, and the start of somebody else's longer one — set
      // up before two numbers like that were refused. A moment's pause says
      // it was the short one; another digit, the long one.
      if (found && longerPinFrom(packers, typed)) {
        const now = typed;
        waiting = setTimeout(() => { if (life.alive() && typed === now) enter(found); }, 1200);
        return;
      }
      if (found) { enter(found); return; }
      // Still short of the longest number anybody has: they may not have
      // finished. Once it is that long and still matches nobody, it is wrong,
      // and it is cleared so the next attempt starts from nothing rather than
      // being glued onto this one.
      if (typed.length >= longest) { wrong = true; typed = ''; paint(); }
    }

    function enter(found) {
      packer = { id: found.id, name: found.name };
      sitDown(packer);
      typed = '';
      // In the kitchen the number is the way in to the whole machine, and
      // what follows it is the menu. In the panel this screen was opened to
      // pack, and the next question is which libreta.
      if (kitchen()) { go('/rapido'); return; }
      paint();
    }

    const key = (label, onPress, className = '') =>
      h(`button.pk__key${className}`, { type: 'button', onclick: onPress }, label);

    return h('div.pk__pin',
      h('h2.pk__ask', '¿Quién eres?'),
      h('p.pk__hint', 'Escribe tu número para que tu nombre quede en la lista de hoy.'),
      dots,
      wrong ? alert('Ese número no es de nadie. Inténtalo otra vez.', 'bad', 'alert') : null,
      h('div.pk__pad',
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => key(String(digit), () => press(digit))),
        key('', () => {}, '.is-blank'),
        key('0', () => press(0)),
        key('←', rub, '.pk__key--rub')),
      h('p.pk__ver', versionLabel()));
  }

  /* --- Which libreta ------------------------------------------------------- */

  function pickLine() {
    // Read from the live list, not from when the PIN was typed: switched off,
    // removed, or no longer allowed to pack, and this screen stops offering.
    const record = packers.find((one) => one.id === packer.id);
    if (!record || record.active === false) {
      packer = null;
      sitDown(null);
      return askPin();
    }
    if (!canDo(record, 'pack')) return notAllowed();

    const roster = activeClients();
    const { unplaced, adopted, homeless } = placementProblems({
      lines: setup.lines, farms: store.farms, clients: roster,
    });

    return h('div.stack.stack-5',
      h('div.pk__who',
        h('div',
          h('div.pk__wholabel', 'Estás empacando como'),
          h('div.pk__whoname', packer.name)),
        h('button.btn.btn--ghost', {
          type: 'button',
          onclick: () => { packer = null; sitDown(null); typed = ''; paint(); },
        }, 'No soy yo')),

      h('h2.pk__ask', '¿Cuál libreta vas a empacar?'),

      h('div.pk__lines', setup.lines.map((line) => lineCard(line, roster))),

      unplaced.length
        ? alert(`${plural(unplaced.length, 'ubicación no está', 'ubicaciones no están')} en `
          + 'ninguna libreta: '
          + `${unplaced.map((one) => `${one.farm.name} · ${one.place.name}`).join(', ')}. `
          + 'Nadie va a empacar a su gente hasta que alguien las meta en una libreta, desde '
          + 'Avisos u Organizar libreta en el menú.', 'bad', 'alert')
        : null,
      homeless.length
        ? alert(`${homeless.map((one) => one.name).join(', ')}: sin farma, así que ninguna libreta `
          + 'los puede empacar. Que la oficina les ponga su farma.', 'bad', 'alert')
        : null,
      adopted.length
        ? alert(`${plural(adopted.length, 'ubicación nueva se empaca', 'ubicaciones nuevas se empacan')} `
          + 'con el resto de su farma: '
          + `${adopted.map((one) => `${one.farm.name} · ${one.place.name} en ${one.line.name}`).join(', ')}. `
          + 'Confírmalas o muévelas desde Avisos en el menú.', 'warn', 'pin')
        : null,

      runs.length ? doneToday() : null);
  }

  /** A user who is here, but whose permissions do not include packing. */
  function notAllowed() {
    return emptyState({
      icon: 'lock',
      title: `${packer.name}, no tienes permiso para empacar`,
      text: 'Si te toca empacar hoy, pídele al encargado que te lo active desde el panel.',
      action: kitchen()
        ? button('Volver al menú', {
          variant: 'primary', size: 'lg', icon: 'chevronL', onClick: () => go('/rapido'),
        })
        : button('No soy yo', {
          variant: 'ghost', size: 'lg',
          onClick: () => { packer = null; sitDown(null); typed = ''; paint(); },
        }),
    });
  }

  function lineCard(line, roster) {
    const plan = packingSequence({
      line, lines: setup.lines, farms: store.farms, clients: roster, day,
    });
    const run = runs.find((row) => row.lineId === line.id);
    const mine = run && run.packerId === packer.id;
    const state = !run ? 'libre' : (run.done ? 'lista' : 'empezada');
    // The one the manager gave this person, said on the card.
    const yours = packers.find((one) => one.id === packer.id)?.lineId === line.id;

    // In the order the morning goes. A farm the order comes back to later is
    // named again where it comes back — that is the route, not a repeat.
    const farmNames = plan.farms.map((entry) => entry.farm.name);

    return h(`button.pkline.pkline--${state}`, {
      type: 'button',
      disabled: !plan.people,
      onclick: () => go(`/empaque/${line.id}`),
    },
      h('div.pkline__head',
        h('div.pkline__name', line.name),
        yours ? h('span.pkline__yours', 'Tu libreta') : null,
        run
          ? h(`span.pkline__badge${run.done ? '.is-done' : ''}`,
              run.done ? 'Terminada' : 'Empezada')
          : null),

      h('div.pkline__farms', farmNames.length
        ? farmNames.join(' · ')
        : 'Sin ubicaciones asignadas'),

      h('div.pkline__nums',
        h('div.pkline__num',
          h('span.pkline__n', number(plan.people)),
          h('span.pkline__l', plan.people === 1 ? 'persona' : 'personas')),
        h('div.pkline__num',
          h('span.pkline__n', number(plan.plates)),
          h('span.pkline__l', 'comidas')),
        h('div.pkline__num',
          h('span.pkline__n', number(plan.farmCount)),
          h('span.pkline__l', plan.farmCount === 1 ? 'farma' : 'farmas'))),

      h('div.pkline__foot',
        resumeAt(line, plan, run)
          || (run
            ? h('span', run.done
              ? `La terminó ${names(run)}`
                + `${run.finishedAt ? ` a las ${formatTime(run.finishedAt)}` : ''}`
              : `${mine ? 'La empezaste tú' : `La está empacando ${names(run)}`}`
                + `${run.packed ? ` · va en ${run.packed} de ${run.people}` : ''}`)
            : h('span', plan.people ? 'Nadie la ha tocado hoy' : 'No hay nada que empacar')),
        plan.people ? h('span.pkline__go', icon('chevronR')) : null));
  }

  /**
   * Where opening this libreta will land, when this computer was already in
   * it today: the person, by name, and how far that is. It is what tapping
   * the card does, said before the tap, so nobody expects the first farm and
   * gets person sixty-eight — or the other way round.
   */
  function resumeAt(line, plan, run) {
    // Finished — here or on the other computer — says who finished it.
    const here = run?.done ? null : spotOf(line, plan);
    if (!here) return null;
    const who = here.slide.kind === 'client' ? here.slide.client.name
      : here.slide.kind === 'farm' ? `la farma ${here.slide.farm.name}`
        : 'el final';
    return h('span.pkline__resume', `Sigues en ${who} · ${number(here.done)} de ${number(here.people)}`);
  }

  /**
   * Where this computer will carry on a libreta today — the slide, and how
   * many people that is out of how many — or null when it has not been in it,
   * or finished it. Worked out from the list as it is now, so it is exact;
   * the day's record only counts every few people.
   */
  function spotOf(line, plan = null) {
    const spot = line ? savedSpot(line.id, day) : null;
    if (!spot) return null;
    const sequence = plan || packingSequence({
      line, lines: setup.lines, farms: store.farms, clients: activeClients(), day,
    });
    if (!sequence.slides.length) return null;
    const at = spotIndex(sequence.slides, spot);
    return {
      slide: sequence.slides[at],
      done: sequence.slides.slice(0, at + 1).filter((one) => one.kind === 'client').length,
      people: sequence.people,
    };
  }

  /* --- What has been packed today ------------------------------------------ */

  function doneToday() {
    return h('div.stack.stack-3',
      h('h2.pk__ask.pk__ask--sm', 'Lo de hoy'),
      h('div.pk__runs', runs.map((run) => h('div.pkrun',
        h('span.pkrun__ico', icon(run.done ? 'check' : 'clock')),
        h('div.grow',
          h('div.pkrun__name', `${run.lineName} · ${names(run)}`),
          h('div.pkrun__meta', run.done
            ? `Terminada${run.finishedAt ? ` a las ${formatTime(run.finishedAt)}` : ''}`
              + ` · ${plural(run.people, 'persona', 'personas')}`
            : `Empezada${run.startedAt ? ` a las ${formatTime(run.startedAt)}` : ''}`
              + ` · va en ${progressOf(run)}`)))))); 
  }

  /** "23 de 174": exact where this computer has the place, the record's otherwise. */
  function progressOf(run) {
    const here = spotOf(setup.lines.find((line) => line.id === run.lineId));
    return here
      ? `${number(here.done)} de ${number(here.people)}`
      : `${number(run.packed || 0)} de ${number(run.people)}`;
  }

  // Left open overnight, the menu would offer yesterday's libretas and what
  // was packed yesterday: at midnight it opens again on the new day.
  const unsubscribe = subscribe(() => {
    if (today() !== day) {
      setTimeout(() => { if (life.alive()) go('/empaque', { replace: true }); });
      return;
    }
    paint();
  });
  return life.ending(unsubscribe, ...stops);
}

/** Who worked a libreta — both, when a morning changed hands. */
function names(run) {
  const all = (run?.packerNames || [run?.packerName]).filter(Boolean);
  if (!all.length) return 'alguien';
  if (all.length === 1) return all[0];
  return `${all.slice(0, -1).join(', ')} y ${all[all.length - 1]}`;
}
