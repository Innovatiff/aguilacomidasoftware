/**
 * Tablero de hoy — the kitchen's whiteboards, on the kitchen computer.
 *
 * Opened from the kitchen's menu, over it, and closed back to it. Three
 * numbers across the top — how many medias, how many completas, how many
 * comidas in all, each split by libreta — and under them one board per group,
 * the way the two whiteboards on the wall have them: a line for each thing
 * somebody cannot eat, and how many plates of each libreta go without it.
 *
 * Nothing on it is typed in. Every number is counted from the clients each
 * time it is drawn (see js/lib/board.js), and it is drawn again whenever a
 * client changes — so the board on the screen is never a week behind the way
 * the one on the wall gets. It changes nothing; it is for reading.
 *
 * Laid out for the kitchen's screens, 1024 × 768 at the smallest: the three
 * numbers in one row, the two boards side by side, and the page scrolls when a
 * board is longer than the screen rather than shrinking the type.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { posNote } from './pos-kit.js';
import { store, subscribe, activeClients, isReady, firstError } from '../data/store.js';
import { watchPacking } from '../data/packing.js';
import { dayBoard } from '../lib/board.js';
import { today, formatDayLong, capitalize } from '../lib/dates.js';
import { number, plural } from '../lib/format.js';
import { errorText } from '../firebase.js';

export function openDayBoard() {
  const day = today();
  let setup = null;
  let failure = null;
  let open = true;

  const body = h('div.pos__body');
  const exit = h('button.pos__exit', { type: 'button', onclick: () => close() },
    icon('x'), h('span', 'Cerrar'));
  const panel = h('div.pos.pos--board', {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tablero de hoy',
  },
  h('header.pos__bar',
    exit,
    h('span.pos__mark', icon('eagle')),
    h('span.pos__title', 'Tablero de hoy'),
    h('span.pos__day', capitalize(formatDayLong(day)))),
  body);

  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  };
  // Appended to the document rather than the page, so it would outlive a
  // route change — somebody switched off mid-morning is sent back to the
  // keypad, and the board has to go with the menu it was opened from.
  const onLeave = () => close();

  document.body.append(panel);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onLeave);

  const stops = [
    watchPacking((found) => { setup = found; paint(); },
      (error) => { failure = error; paint(); }),
    subscribe(() => paint()),
  ];
  exit.focus({ preventScroll: true });

  function close() {
    if (!open) return;
    open = false;
    stops.forEach((stop) => stop?.());
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onLeave);
    panel.remove();
  }

  function paint() {
    if (!open) return;
    // Kept where it was: the board is redrawn when a client changes, and a
    // redraw should not throw somebody back to the top of a long list.
    const kept = body.scrollTop;
    mount(body, h('div.pos__inner.dboard', content()));
    body.scrollTop = kept;
  }

  function content() {
    const broken = failure || firstError()?.error;
    if (broken) {
      return posNote(`No se pudieron leer los clientes: ${errorText(broken)}`, 'bad');
    }
    if (!setup || !isReady()) return h('p.pos__hint', 'Contando…');

    const board = dayBoard({
      lines: setup.lines, farms: store.farms, clients: activeClients(), day,
    });
    const [medias, completas] = board.kinds;

    return [
      board.outside.length
        ? posNote(`${plural(board.outside.length, 'persona come', 'personas comen')} hoy y no `
          + `${board.outside.length === 1 ? 'está' : 'están'} en ninguna libreta, así que no `
          + `${board.outside.length === 1 ? 'sale' : 'salen'} en estas cuentas: `
          + `${board.outside.map((one) => one.name).join(', ')}. Avísale al encargado.`, 'warn')
        : null,

      h('div.dboard__stats',
        stat({
          title: 'Medias', note: '1 comida', tally: medias.people, lines: board.lines,
        }),
        stat({
          title: 'Completas', note: '2 comidas', tally: completas.people, lines: board.lines,
          extra: completas.more
            ? `${plural(completas.more, 'lleva', 'llevan')} 3 o más`
            : null,
        }),
        stat({
          title: 'Comidas', note: 'en total', tally: board.plates, lines: board.lines, dark: true,
        })),

      h('div.dboard__boards', board.kinds.map((kind) => table(kind, board.lines))),

      h('p.dboard__foot',
        'Cuenta a cada persona que se empaca hoy, en su libreta. Media es quien lleva una '
        + 'comida hoy; completa, quien lleva dos o más. Lo que no pueden comer sale de su '
        + 'ficha: «No puede comer», y lo de sus preferencias que dice «sin».'),
    ];
  }

  return close;
}

/** One of the three numbers across the top, split by libreta. */
function stat({ title, note, tally, lines, extra, dark = false }) {
  return h(`div.dstat${dark ? '.dstat--dark' : ''}`,
    h('div.dstat__head',
      h('span.dstat__title', title),
      h('span.dstat__note', note)),
    h('div.dstat__n', number(tally.total)),
    h('div.dstat__lines', lines.map((line) =>
      h('span', h('b', number(tally.byLine[line.id] || 0)), ` ${line.name}`))),
    extra ? h('div.dstat__extra', extra) : null);
}

/** One whiteboard: a line for each thing somebody in the group cannot eat. */
function table(kind, lines) {
  const word = kind.title.toLowerCase();
  return h('section.dtable', { 'aria-label': kind.title },
    h('div.dtable__head',
      h('h3', kind.title),
      h('span', `${number(kind.people.total)} · lo que no pueden comer`)),

    !kind.people.total
      ? h('p.dtable__empty', `Hoy no hay ${word}.`)
      : !kind.rows.length
        ? h('p.dtable__empty', `Nadie de las ${word} tiene algo que no pueda comer.`)
        : h('table.dtable__grid',
          h('thead', h('tr',
            h('th', { scope: 'col' }, 'Sin'),
            lines.map((line) => h('th.num', { scope: 'col' }, line.name)),
            h('th.num', { scope: 'col' }, 'Total'))),
          h('tbody', kind.rows.map((row) => h('tr',
            h('th', { scope: 'row' }, row.label),
            // A blank, the way the board on the wall has it, but a visible
            // one: an empty cell reads as "forgot to count".
            lines.map((line) => h('td.num', row.byLine[line.id]
              ? number(row.byLine[line.id])
              : h('span.dtable__zero', '—'))),
            h('td.num.dtable__total', number(row.total)))))));
}
