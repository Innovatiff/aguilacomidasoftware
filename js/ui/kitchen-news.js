/**
 * Avisos and Novedades — what the kitchen has to know, on the kitchen's menu.
 *
 * **Avisos** are things to act on, and they do not go away until somebody
 * does:
 *
 *   - people at a location no libreta packs (red): their food is counted on
 *     the board but nobody packs it until the location is put in a libreta;
 *   - a new location the system put in a libreta by itself, with the rest of
 *     its farm (amber): it is packed, and the kitchen confirms the spot or
 *     moves it;
 *   - the board changed since somebody looked at it (blue): who, and how many
 *     plates more or fewer — the number the cook needs at ten o'clock, not
 *     the one from eight.
 *
 * They show as one strip across the menu, the most urgent first, and open into
 * the full list. **Novedades** is the day's news — who started, who paused,
 * who came back, whose last day it is — and opens from the menu's heading.
 *
 * Both are full-screen like the day's board, over the menu, and close back to
 * it. Nothing here writes on its own: every change is a button somebody
 * presses, through the actions the menu hands in.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { plural } from '../lib/format.js';
import {
  formatDayLong, formatDay, formatTime, capitalize, relativeDay, today as todayKey,
} from '../lib/dates.js';

/* --- What there is to say --------------------------------------------------- */

const placeName = (one) => `${one.farm.name} · ${one.place.name}`;
const names = (people, max = 4) => {
  const shown = people.slice(0, max).map((person) => person.name);
  return people.length > max ? `${shown.join(', ')} y ${people.length - max} más` : shown.join(', ');
};
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * The avisos, most urgent first. Each is `{ tone, key, text }` plus what its
 * card needs.
 *
 * @param {object} found  `{ unplaced, adopted, homeless, change }`
 */
export function avisosFrom(found) {
  if (!found) return [];
  const out = [];
  for (const one of found.unplaced) {
    out.push({
      tone: 'bad', key: `u:${one.key}`, kind: 'unplaced', place: one,
      text: `${placeName(one)} no está en ninguna libreta: `
        + `${plural(one.people.length, 'persona', 'personas')} sin empacar`,
    });
  }
  if (found.homeless.length) {
    out.push({
      tone: 'bad', key: 'homeless', kind: 'homeless', people: found.homeless,
      text: `${plural(found.homeless.length, 'persona', 'personas')} sin farma: no se `
        + `${found.homeless.length === 1 ? 'puede' : 'pueden'} empacar`,
    });
  }
  for (const one of found.adopted) {
    out.push({
      tone: 'warn', key: `a:${one.key}`, kind: 'adopted', place: one,
      text: `Ubicación nueva: ${placeName(one)} se empaca en ${one.line.name}`
        + `${one.after ? `, después de ${one.after.farm.id === one.farm.id ? one.after.place.name : placeName(one.after)}` : ', al principio'}`,
    });
  }
  if (found.change) {
    const c = found.change;
    out.push({
      tone: 'info', key: 'change', kind: 'change', change: c,
      text: `El tablero cambió: ${c.delta === 0 ? 'mismas comidas, otra gente'
        : `${plural(Math.abs(c.delta), 'comida', 'comidas')} ${c.delta > 0 ? 'más' : 'menos'}`} `
        + `desde las ${formatTime(c.at)}${c.by ? ` (lo vio ${c.by})` : ''}`,
    });
  }
  return out;
}

/** The strip across the menu: the first aviso, and how many more. */
export function avisosStrip(avisos, onOpen) {
  if (!avisos.length) return null;
  const [first] = avisos;
  const more = avisos.length - 1;
  return h(`button.posaviso.posaviso--${first.tone}`, { type: 'button', onclick: onOpen },
    icon(first.tone === 'info' ? 'info' : 'alert'),
    h('span.posaviso__text', first.text,
      more ? h('span.posaviso__more', ` · y ${plural(more, 'aviso', 'avisos')} más`) : null),
    h('span.posaviso__go', more ? 'Ver avisos' : 'Ver', icon('chevronR')));
}

/* --- The overlays ------------------------------------------------------------ */

/**
 * A full-screen page over the menu, like the day's board: a bar with Cerrar,
 * and a body that redraws from `content()` whenever `refresh` is called.
 */
function overlay({ title, content }) {
  let open = true;
  const body = h('div.pos__body');
  const panel = h('div.pos.pos--board', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header.pos__bar',
      h('button.pos__exit', { type: 'button', onclick: () => close() }, icon('x'), h('span', 'Cerrar')),
      h('span.pos__mark', icon('eagle')),
      h('span.pos__title', title),
      h('span.pos__day', capitalize(formatDayLong(todayKey())))),
    body);

  const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
  const onLeave = () => close();
  document.body.append(panel);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onLeave);

  function paint() {
    if (!open) return;
    const kept = body.scrollTop;
    mount(body, h('div.pos__inner.knews', content(close)));
    body.scrollTop = kept;
  }
  function close() {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onLeave);
    panel.remove();
  }
  paint();
  panel.querySelector('.pos__exit').focus({ preventScroll: true });
  return { refresh: paint, close, isOpen: () => open };
}

/**
 * Every aviso, each with what can be done about it.
 *
 * @param {object}   options
 * @param {Function} options.read     () => the avisos as they are now
 * @param {boolean}  options.canArrange  whether whoever is here may organize
 * @param {object[]} options.lines    the libretas, for "Acomodar en …"
 * @param {object}   options.actions  `{ place(lineId, key), confirm(lineId),
 *   move(lineId), board() }` — each may return a promise; the list redraws
 *   when it settles
 * @returns {{ refresh: Function, close: Function }}
 */
export function openAvisos({ read, canArrange, lines, actions }) {
  const run = (job) => async () => {
    try { await job(); } finally { view.refresh(); }
  };

  const view = overlay({
    title: 'Avisos',
    content: () => {
      const avisos = read();
      if (!avisos.length) {
        return [
          h('h2.pos__q', 'Todo en orden'),
          h('p.pos__hint', 'Todas las personas que comen están en una libreta, y el tablero no ha '
            + 'cambiado desde que alguien lo vio.'),
        ];
      }
      return [
        h('h2.pos__q', plural(avisos.length, 'aviso', 'avisos')),
        h('p.pos__hint', 'Los rojos son gente que nadie va a empacar: van primero.'),
        h('div.knews__list', avisos.map((aviso) => card(aviso))),
      ];
    },
  });

  function card(aviso) {
    const tone = `knews__card.knews__card--${aviso.tone}`;

    if (aviso.kind === 'unplaced') {
      const one = aviso.place;
      return h(`div.${tone}`,
        h('div.knews__title', icon('alert'), placeName(one)),
        h('p.knews__text', `No está en ninguna libreta, así que nadie la empaca: `
          + `${names(one.people)}. Su comida sí está contada en el tablero, en «Sin libreta».`),
        canArrange
          ? h('div.knews__actions', lines.map((line) => h('button.posbtn.posbtn--go.knews__btn', {
            type: 'button', onclick: run(() => actions.place(line.id, one.key)),
          }, icon('plus'), h('span', `Acomodar en ${line.name}`))))
          : h('p.knews__ask', 'Pídele a quien organiza la libreta que la acomode, desde Organizar libreta.'));
    }

    if (aviso.kind === 'homeless') {
      return h(`div.${tone}`,
        h('div.knews__title', icon('alert'), 'Sin farma'),
        h('p.knews__text', `${names(aviso.people, 8)}: no ${aviso.people.length === 1 ? 'tiene' : 'tienen'} `
          + 'farma, así que ninguna libreta los puede empacar. Que la oficina les ponga su farma y su '
          + 'ubicación en su ficha.'));
    }

    if (aviso.kind === 'adopted') {
      const one = aviso.place;
      const after = one.after
        ? `después de ${one.after.farm.id === one.farm.id ? one.after.place.name : placeName(one.after)}`
        : 'al principio';
      return h(`div.${tone}`,
        h('div.knews__title', icon('pin'), `${placeName(one)}`, h('span.knews__tag', 'Nueva')),
        h('p.knews__text', `Nadie la había puesto en una libreta, así que se empaca en ${one.line.name} `
          + `con el resto de ${one.farm.name}, ${after}: ${names(one.people)}.`),
        canArrange
          ? h('div.knews__actions',
            h('button.posbtn.posbtn--done.knews__btn', {
              type: 'button', onclick: run(() => actions.confirm(one.line.id, one.key)),
            }, icon('check'), h('span', 'Está bien ahí')),
            h('button.posbtn.knews__btn', {
              type: 'button', onclick: run(() => actions.move(one.line.id, one.key)),
            }, icon('sort'), h('span', 'Cambiar de lugar')))
          : h('p.knews__ask', 'Ya se empaca. Si va en otro lugar, pídele a quien organiza la libreta '
            + 'que la acomode.'));
    }

    // The board changed.
    const c = aviso.change;
    const row = (one, sign) => h('li.knews__who',
      h(`b.knews__n.knews__n--${sign > 0 ? 'up' : 'down'}`, signed(sign * one.plates)),
      h('span', one.name || 'Sin nombre'),
      sign > 0 && one.was ? h('span.knews__soft', `(tenía ${one.was})`) : null,
      sign < 0 && one.now ? h('span.knews__soft', `(ahora ${one.now})`) : null);
    return h(`div.${tone}`,
      h('div.knews__title', icon('clipboard'), 'El tablero cambió'),
      h('p.knews__text', `Cuando ${c.by || 'alguien'} lo vio a las ${formatTime(c.at)} eran `
        + `${plural(c.was, 'comida', 'comidas')}; ahora son ${plural(c.plates, 'comida', 'comidas')} `
        + `(${signed(c.delta)}).`),
      h('ul.knews__whos', c.more.map((one) => row(one, 1)), c.less.map((one) => row(one, -1))),
      h('div.knews__actions',
        h('button.posbtn.posbtn--go.knews__btn', { type: 'button', onclick: () => actions.board() },
          icon('clipboard'), h('span', 'Ver el tablero'))));
  }

  return view;
}

/* --- Novedades ------------------------------------------------------------------ */

const KINDS = {
  nuevo: { word: 'Nuevo', icon: 'userPlus', tone: 'ok' },
  volvio: { word: 'Volvió', icon: 'play', tone: 'ok' },
  pausa: { word: 'En pausa', icon: 'pause', tone: 'warn' },
  termino: { word: 'Terminó', icon: 'pause', tone: 'warn' },
  baja: { word: 'Ya no pide', icon: 'ban', tone: 'bad' },
  ultimo: { word: 'Último día', icon: 'calendar', tone: 'info' },
};

/**
 * The news, by day: who started, paused, came back, and whose last day is
 * coming — each with what it does to today's plates and where they are packed.
 *
 * @param {object}   options
 * @param {Function} options.read  () => groups from `novedades()`
 */
export function openNovedades({ read }) {
  return overlay({
    title: 'Novedades',
    content: () => {
      const groups = read();
      const day = todayKey();
      if (!groups.length) {
        return [
          h('h2.pos__q', 'Sin novedades'),
          h('p.pos__hint', 'Nadie nuevo, nadie en pausa y nadie de vuelta en la última semana.'),
        ];
      }
      return [
        h('h2.pos__q', 'Novedades'),
        h('p.pos__hint', 'Quién entró, quién se fue a pausa y quién volvió, de la última semana. '
          + 'Lo de hoy dice cuántas comidas cambia hoy.'),
        groups.map((group) => h('section.knews__day',
          h('h3.knews__dayname', group.day === day
            ? `Hoy · ${formatDay(group.day)}`
            : `${relativeDay(group.day, day)} · ${formatDay(group.day)}`),
          h('div.knews__list', group.items.map((item) => newsRow(item, day))))),
      ];
    },
  });
}

function newsRow(item, day) {
  const kind = KINDS[item.kind];
  const client = item.client;
  const where = [client.farmName, client.locationName].filter(Boolean).join(' · ') || 'Sin farma';
  const extra = [];
  if (item.kind === 'termino') extra.push(`su último día fue el ${formatDay(client.endsOn || item.on)}`);
  if (item.kind === 'ultimo') {
    extra.push(item.last === day ? 'hoy es su último día: se empaca hoy' : 'mañana es su último día');
  }
  if (item.kind === 'nuevo' || item.kind === 'volvio') {
    extra.push(item.line ? `se empaca en ${item.line}` : 'no está en ninguna libreta');
  }
  return h(`div.knews__row.knews__row--${kind.tone}`,
    h('span.knews__badge', icon(kind.icon), kind.word),
    h('span.knews__body',
      h('span.knews__name', client.name),
      h('span.knews__where', [where, ...extra].join(' · '))),
    h('span.knews__side',
      item.plates
        ? h(`b.knews__n.knews__n--${item.plates > 0 ? 'up' : 'down'}`,
          `${signed(item.plates)} ${Math.abs(item.plates) === 1 ? 'comida' : 'comidas'} hoy`)
        : null,
      item.on === day && item.kind !== 'ultimo' && item.at
        ? h('span.knews__time', formatTime(item.at))
        : null),
    item.kind === 'nuevo' && !item.line
      ? h('span.knews__alarm', icon('alert'), 'Sin libreta')
      : null);
}
