/**
 * Tablero de hoy — the kitchen's whiteboards, on the kitchen computer.
 *
 * Opened from the kitchen's menu, over it, and closed back to it. Three
 * numbers across the top — how many medias, how many completas, how many
 * comidas in all, each split by libreta — and under them one board per group,
 * the way the two whiteboards on the wall have them: a line for each thing
 * somebody cannot eat, and how many plates of each libreta go without it.
 *
 * **Every number carries its own label.** The first version was a table —
 * "Cerdo  —  1  1" under small grey column heads — and a table asks the reader
 * to look up and across to know what a number means. The whiteboard never did
 * that: it says "Cerdo: Monse 5, Clau 6", the name right beside the number. So
 * each line here reads the same way, as a sentence — "Sin cerdo · Libreta 1: 0
 * · Libreta 2: 1 · Total 1" — a zero is written as 0 rather than left blank,
 * each libreta keeps one colour everywhere on the screen, and tapping a line
 * shows who the people are, so a number can be checked rather than trusted.
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
  // Lines somebody opened to see who is in them. Kept across redraws: the
  // board redraws when a client changes, and a line should not snap shut
  // under the finger that opened it.
  const opened = new Set();

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
          title: 'Medias', note: 'llevan 1 comida',
          big: plural(medias.people.total, 'persona', 'personas'),
          tally: medias.people, lines: board.lines,
        }),
        stat({
          title: 'Completas', note: 'llevan 2 comidas',
          big: plural(completas.people.total, 'persona', 'personas'),
          tally: completas.people, lines: board.lines,
          extra: completas.more
            ? `${completas.more === 1 ? 'Una de ellas lleva' : `${number(completas.more)} de ellas llevan`} `
              + '3 comidas o más.'
            : null,
        }),
        stat({
          title: 'Comidas', note: 'para empacar hoy',
          big: plural(board.plates.total, 'comida', 'comidas'),
          tally: board.plates, lines: board.lines, dark: true,
        })),

      board.kinds.map((kind) => whiteboard(kind, board.lines, opened)),

      h('p.dboard__foot',
        'Cuenta a cada persona que se empaca hoy, en su libreta. Media es quien lleva una '
        + 'comida hoy; completa, quien lleva dos o más. Lo que no pueden comer sale de su '
        + 'ficha: «No puede comer», y lo de sus preferencias que dice «sin».'),
    ];
  }

  return close;
}

/*
 * Each libreta keeps one colour on this screen — the dot beside its name on
 * the cards and on every line — so after the first look the eye goes to its
 * own libreta's numbers without reading the name.
 */
const tone = (lines, id) => `dot--${Math.max(0, lines.findIndex((line) => line.id === id)) + 1}`;

/** "● Libreta 1: 2" — the libreta's name right beside its number. */
function perLine(lines, line, n) {
  return h(`span.dcount${n ? '' : '.is-zero'}`,
    h(`span.dot.${tone(lines, line.id)}`),
    h('span.dcount__name', `${line.name}:`),
    h('b.dcount__n', number(n || 0)));
}

/** One of the three numbers across the top, said in words, split by libreta. */
function stat({ title, note, big, tally, lines, extra, dark = false }) {
  return h(`div.dstat${dark ? '.dstat--dark' : ''}`,
    h('div.dstat__head',
      h('span.dstat__title', title),
      h('span.dstat__note', note)),
    h('div.dstat__n', big),
    h('div.dstat__lines', lines.map((line) => perLine(lines, line, tally.byLine[line.id]))),
    extra ? h('div.dstat__extra', extra) : null);
}

/**
 * One whiteboard: who in the group cannot eat what, a line per thing.
 *
 * Each line is a `<details>`: the line is what you read, and opening it shows
 * the names behind its numbers, libreta by libreta.
 */
function whiteboard(kind, lines, opened) {
  const word = kind.title.toLowerCase();
  const who = kind.id === 'medias' ? 'llevan 1 comida' : 'llevan 2 comidas o más';

  return h(`section.dwb.dwb--${kind.id}`, { 'aria-label': kind.title },
    h('div.dwb__head',
      h('h3.dwb__title', kind.title),
      h('span.dwb__who', `${plural(kind.people.total, 'persona', 'personas')} que ${who}`)),

    !kind.people.total
      ? h('p.dwb__empty', `Hoy no hay ${word}.`)
      : !kind.rows.length
        ? h('p.dwb__empty', `Todas las ${word} pueden comer de todo.`)
        : [
          h('p.dwb__lead', 'Cuántas NO pueden comer',
            h('span.dwb__tip', 'Toca una línea para ver quiénes son')),
          h('div.dwb__lines', kind.rows.map((row) => {
            const key = `${kind.id}:${row.key}`;
            const line = h('details.dline', {
              open: opened.has(key),
              ontoggle: () => { if (line.open) opened.add(key); else opened.delete(key); },
            },
            h('summary.dline__sum',
              h('span.dline__what', h('span.dline__sin', 'Sin '), lowerFirst(row.label)),
              h('span.dline__counts', lines.map((libreta) => perLine(lines, libreta, row.byLine[libreta.id]))),
              h('span.dline__total', h('span', 'Total'), h('b', number(row.total))),
              h('span.dline__more', icon('chevronD'))),
            h('div.dline__who', lines
              .filter((libreta) => (row.names?.[libreta.id] || []).length)
              .map((libreta) => h('div.dline__group',
                h(`span.dot.${tone(lines, libreta.id)}`),
                h('span.dline__groupname', `${libreta.name}:`),
                h('span', row.names[libreta.id].join(', '))))));
            return line;
          })),
        ]);
}

/** "Pollo" → "pollo", for "Sin pollo"; the rest of what was typed is kept. */
function lowerFirst(text) {
  const value = String(text || '');
  return value ? value[0].toLocaleLowerCase('es') + value.slice(1) : value;
}
