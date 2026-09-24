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
import { store, subscribe, activeClients, isReady, firstError, startStore } from '../data/store.js';
import {
  watchPacking, watchPackers, watchPackRuns, seatedPacker, sitDown,
} from '../data/packing.js';
import { packingSequence, packerByPin, unassignedFarms } from '../lib/packing.js';
import { today, formatDayLong, formatTime, capitalize } from '../lib/dates.js';
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
      actions: [topbarButton('settings', {
        label: 'Configurar el empaque', onClick: () => go('/empaque/ajustes'),
      })],
      body: h(`div.page__inner.pk.stack.stack-5${asking ? '.pk--asking' : ''}`, content),
    });
  }

  function bodyFor() {
    const broken = failure || firstError();
    if (broken) return dataErrorCard(broken, { onRetry: () => startStore() });
    if (!setup || !packers || !isReady()) return skeletonRows(4);
    if (!packers.length) return noPackers();
    return packer ? pickLine() : askPin();
  }

  /* --- Nobody has been set up yet ---------------------------------------- */

  function noPackers() {
    return emptyState({
      icon: 'users',
      title: 'Todavía no hay nadie dado de alta',
      text: 'El encargado tiene que agregar a quién empaca, y su número, antes de '
        + 'poder usar esta pantalla.',
      action: button('Configurar el empaque', {
        variant: 'primary', size: 'lg', icon: 'settings', onClick: () => go('/empaque/ajustes'),
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
      typed = (typed + digit).slice(0, longest);
      paintDots();
      // It tries as soon as it could be somebody's number. Nobody should have
      // to reach for a tick they cannot see the point of.
      if (typed.length >= 4) tryIt();
    };

    const rub = () => { wrong = false; typed = typed.slice(0, -1); paintDots(); };

    function tryIt() {
      const found = packerByPin(packers, typed);
      if (found) {
        packer = { id: found.id, name: found.name };
        sitDown(packer);
        typed = '';
        // In the kitchen the number is the way in to the whole machine, and
        // what follows it is the menu. In the panel this screen was opened to
        // pack, and the next question is which libreta.
        if (kitchen()) { go('/rapido'); return; }
        paint();
        return;
      }
      // Still short of the longest number anybody has: they may not have
      // finished. Once it is that long and still matches nobody, it is wrong,
      // and it is cleared so the next attempt starts from nothing rather than
      // being glued onto this one.
      if (typed.length >= longest) { wrong = true; typed = ''; paint(); }
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
        key('←', rub, '.pk__key--rub')));
  }

  /* --- Which libreta ------------------------------------------------------- */

  function pickLine() {
    const roster = activeClients();
    const orphans = unassignedFarms(setup.lines, store.farms);

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

      orphans.length
        ? alert(`${plural(orphans.length, 'rancho no está', 'ranchos no están')} en ninguna libreta: `
          + `${orphans.map((farm) => farm.name).join(', ')}. Su comida no se va a empacar `
          + 'hasta que el encargado los agregue.', 'warn', 'alert')
        : null,

      runs.length ? doneToday() : null);
  }

  function lineCard(line, roster) {
    const plan = packingSequence({ line, farms: store.farms, clients: roster, day });
    const run = runs.find((row) => row.lineId === line.id);
    const mine = run && run.packerId === packer.id;
    const state = !run ? 'libre' : (run.done ? 'lista' : 'empezada');

    const farmNames = plan.farms.map((entry) => entry.farm.name);

    return h(`button.pkline.pkline--${state}`, {
      type: 'button',
      disabled: !plan.people,
      onclick: () => go(`/empaque/${line.id}`),
    },
      h('div.pkline__head',
        h('div.pkline__name', line.name),
        run
          ? h(`span.pkline__badge${run.done ? '.is-done' : ''}`,
              run.done ? 'Terminada' : 'Empezada')
          : null),

      h('div.pkline__farms', farmNames.length
        ? farmNames.join(' · ')
        : 'Sin ranchos asignados'),

      h('div.pkline__nums',
        h('div.pkline__num',
          h('span.pkline__n', number(plan.people)),
          h('span.pkline__l', plan.people === 1 ? 'persona' : 'personas')),
        h('div.pkline__num',
          h('span.pkline__n', number(plan.plates)),
          h('span.pkline__l', 'comidas')),
        h('div.pkline__num',
          h('span.pkline__n', number(plan.farms.length)),
          h('span.pkline__l', plan.farms.length === 1 ? 'rancho' : 'ranchos'))),

      h('div.pkline__foot',
        run
          ? h('span', run.done
            ? `La terminó ${names(run)}`
              + `${run.finishedAt ? ` a las ${formatTime(run.finishedAt)}` : ''}`
            : `${mine ? 'La empezaste tú' : `La está empacando ${names(run)}`}`
              + `${run.packed ? ` · va en ${run.packed} de ${run.people}` : ''}`)
          : h('span', plan.people ? 'Nadie la ha tocado hoy' : 'No hay nada que empacar'),
        plan.people ? h('span.pkline__go', icon('chevronR')) : null));
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
              + ` · va en ${number(run.packed || 0)} de ${number(run.people)}`)))))); 
  }

  const unsubscribe = subscribe(paint);
  return life.ending(unsubscribe, ...stops);
}

/** Who worked a libreta — both, when a morning changed hands. */
function names(run) {
  const all = (run?.packerNames || [run?.packerName]).filter(Boolean);
  if (!all.length) return 'alguien';
  if (all.length === 1) return all[0];
  return `${all.slice(0, -1).join(', ')} y ${all[all.length - 1]}`;
}
