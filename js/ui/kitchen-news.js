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
import { t } from '../lib/i18n.js';
import {
  formatDayLong, formatDay, formatTime, capitalize, relativeDay, today as todayKey,
} from '../lib/dates.js';

/* --- What there is to say --------------------------------------------------- */

const placeName = (one) => `${one.farm.name} · ${one.place.name}`;
const names = (people, max = 4) => {
  const shown = people.slice(0, max).map((person) => person.name);
  return people.length > max
    ? t('{names} y {count} más', { names: shown.join(', '), count: people.length - max })
    : shown.join(', ');
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
      text: t('{place} no está en ninguna libreta: {people} sin empacar', {
        place: placeName(one), people: plural(one.people.length, 'persona', 'personas'),
      }),
    });
  }
  if (found.homeless.length) {
    const who = plural(found.homeless.length, 'persona', 'personas');
    out.push({
      tone: 'bad', key: 'homeless', kind: 'homeless', people: found.homeless,
      text: found.homeless.length === 1
        ? t('{people} sin farma: no se puede empacar', { people: who })
        : t('{people} sin farma: no se pueden empacar', { people: who }),
    });
  }
  for (const one of found.adopted) {
    out.push({
      tone: 'warn', key: `a:${one.key}`, kind: 'adopted', place: one,
      text: one.after
        ? t('Ubicación nueva: {place} se empaca en {line}, después de {after}', {
          place: placeName(one), line: one.line.name,
          after: one.after.farm.id === one.farm.id ? one.after.place.name : placeName(one.after),
        })
        : t('Ubicación nueva: {place} se empaca en {line}, al principio', {
          place: placeName(one), line: one.line.name,
        }),
    });
  }
  if (found.change) {
    const c = found.change;
    const meals = plural(Math.abs(c.delta), 'comida', 'comidas');
    const what = c.delta === 0 ? t('mismas comidas, otra gente')
      : c.delta > 0 ? t('{meals} más', { meals }) : t('{meals} menos', { meals });
    const time = formatTime(c.at);
    out.push({
      tone: 'info', key: 'change', kind: 'change', change: c,
      text: c.by
        ? t('El tablero cambió: {what} desde las {time} (lo vio {name})', { what, time, name: c.by })
        : t('El tablero cambió: {what} desde las {time}', { what, time }),
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
      more ? h('span.posaviso__more', t(' · y {alerts} más', { alerts: plural(more, 'aviso', 'avisos') })) : null),
    h('span.posaviso__go', more ? t('Ver avisos') : t('Ver'), icon('chevronR')));
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
      h('button.pos__exit', { type: 'button', onclick: () => close() }, icon('x'), h('span', t('Cerrar'))),
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
    title: t('Avisos'),
    content: () => {
      const avisos = read();
      if (!avisos.length) {
        return [
          h('h2.pos__q', t('Todo en orden')),
          h('p.pos__hint', t('Todas las personas que comen están en una libreta, y el tablero no ha cambiado desde que alguien lo vio.')),
        ];
      }
      return [
        h('h2.pos__q', plural(avisos.length, 'aviso', 'avisos')),
        h('p.pos__hint', t('Los rojos son gente que nadie va a empacar: van primero.')),
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
        h('p.knews__text', t('No está en ninguna libreta, así que nadie la empaca: {names}. Su comida sí está contada en el tablero, en «Sin libreta».', {
          names: names(one.people),
        })),
        canArrange
          ? h('div.knews__actions', lines.map((line) => h('button.posbtn.posbtn--go.knews__btn', {
            type: 'button', onclick: run(() => actions.place(line.id, one.key)),
          }, icon('plus'), h('span', t('Acomodar en {line}', { line: line.name })))))
          : h('p.knews__ask', t('Pídele a quien organiza la libreta que la acomode, desde Organizar libreta.')));
    }

    if (aviso.kind === 'homeless') {
      return h(`div.${tone}`,
        h('div.knews__title', icon('alert'), t('Sin farma')),
        h('p.knews__text', aviso.people.length === 1
          ? t('{names}: no tiene farma, así que ninguna libreta los puede empacar. Que la oficina les ponga su farma y su ubicación en su ficha.', { names: names(aviso.people, 8) })
          : t('{names}: no tienen farma, así que ninguna libreta los puede empacar. Que la oficina les ponga su farma y su ubicación en su ficha.', { names: names(aviso.people, 8) })));
    }

    if (aviso.kind === 'adopted') {
      const one = aviso.place;
      const after = one.after
        ? (one.after.farm.id === one.farm.id ? one.after.place.name : placeName(one.after))
        : null;
      const said = { line: one.line.name, farm: one.farm.name, after, names: names(one.people) };
      return h(`div.${tone}`,
        h('div.knews__title', icon('pin'), `${placeName(one)}`, h('span.knews__tag', t('Nueva'))),
        h('p.knews__text', after
          ? t('Nadie la había puesto en una libreta, así que se empaca en {line} con el resto de {farm}, después de {after}: {names}.', said)
          : t('Nadie la había puesto en una libreta, así que se empaca en {line} con el resto de {farm}, al principio: {names}.', said)),
        canArrange
          ? h('div.knews__actions',
            h('button.posbtn.posbtn--done.knews__btn', {
              type: 'button', onclick: run(() => actions.confirm(one.line.id, one.key)),
            }, icon('check'), h('span', t('Está bien ahí'))),
            h('button.posbtn.knews__btn', {
              type: 'button', onclick: run(() => actions.move(one.line.id, one.key)),
            }, icon('sort'), h('span', t('Cambiar de lugar'))))
          : h('p.knews__ask', t('Ya se empaca. Si va en otro lugar, pídele a quien organiza la libreta que la acomode.')));
    }

    // The board changed.
    const c = aviso.change;
    const row = (one, sign) => h('li.knews__who',
      h(`b.knews__n.knews__n--${sign > 0 ? 'up' : 'down'}`, signed(sign * one.plates)),
      h('span', one.name || t('Sin nombre')),
      sign > 0 && one.was ? h('span.knews__soft', t('(tenía {was})', { was: one.was })) : null,
      sign < 0 && one.now ? h('span.knews__soft', t('(ahora {now})', { now: one.now })) : null);
    return h(`div.${tone}`,
      h('div.knews__title', icon('clipboard'), t('El tablero cambió')),
      h('p.knews__text', t('Cuando {name} lo vio a las {time} eran {was}; ahora son {now} ({delta}).', {
        name: c.by || t('alguien'), time: formatTime(c.at),
        was: plural(c.was, 'comida', 'comidas'), now: plural(c.plates, 'comida', 'comidas'),
        delta: signed(c.delta),
      })),
      h('ul.knews__whos', c.more.map((one) => row(one, 1)), c.less.map((one) => row(one, -1))),
      h('div.knews__actions',
        h('button.posbtn.posbtn--go.knews__btn', { type: 'button', onclick: () => actions.board() },
          icon('clipboard'), h('span', t('Ver el tablero')))));
  }

  return view;
}

/* --- Novedades ------------------------------------------------------------------ */

const KINDS = {
  nuevo: { word: t('Nuevo'), icon: 'userPlus', tone: 'ok' },
  volvio: { word: t('Volvió'), icon: 'play', tone: 'ok' },
  pausa: { word: t('En pausa'), icon: 'pause', tone: 'warn' },
  termino: { word: t('Terminó'), icon: 'pause', tone: 'warn' },
  baja: { word: t('Ya no pide'), icon: 'ban', tone: 'bad' },
  ultimo: { word: t('Último día'), icon: 'calendar', tone: 'info' },
  empieza: { word: t('Empieza'), icon: 'play', tone: 'ok' },
  programado: { word: t('Programado'), icon: 'clock', tone: 'info' },
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
    title: t('Novedades'),
    content: () => {
      const groups = read();
      const day = todayKey();
      if (!groups.length) {
        return [
          h('h2.pos__q', t('Sin novedades')),
          h('p.pos__hint', t('Nadie nuevo, nadie en pausa y nadie de vuelta en la última semana.')),
        ];
      }
      return [
        h('h2.pos__q', t('Novedades')),
        h('p.pos__hint', t('Quién entró, quién se fue a pausa y quién volvió, de la última semana. Lo de hoy dice cuántas comidas cambia hoy.')),
        groups.map((group) => h('section.knews__day',
          h('h3.knews__dayname', group.day === day
            ? t('Hoy · {day}', { day: formatDay(group.day) })
            : `${relativeDay(group.day, day)} · ${formatDay(group.day)}`),
          h('div.knews__list', group.items.map((item) => newsRow(item, day))))),
      ];
    },
  });
}

function newsRow(item, day) {
  const kind = KINDS[item.kind];
  const client = item.client;
  const where = [client.farmName, client.locationName].filter(Boolean).join(' · ') || t('Sin farma');
  const extra = [];
  if (item.kind === 'termino') extra.push(t('su último día fue el {day}', { day: formatDay(client.endsOn || item.on) }));
  if (item.kind === 'ultimo') {
    extra.push(item.last === day ? t('hoy es su último día: se empaca hoy') : t('mañana es su último día'));
  }
  if (item.kind === 'nuevo' && client.startsOn > day) extra.push(t('empieza el {day}', { day: formatDay(client.startsOn) }));
  else if (item.kind === 'nuevo' || item.kind === 'volvio' || item.kind === 'empieza') {
    extra.push(item.line ? t('se empaca en {line}', { line: item.line }) : t('no está en ninguna libreta'));
  }
  if (item.kind === 'programado') {
    extra.unshift(item.text);
    if (item.until) extra.push(t('hasta el {day}', { day: formatDay(item.until) }));
    if (item.line) extra.push(t('se empaca en {line}', { line: item.line }));
  }
  return h(`div.knews__row.knews__row--${kind.tone}`,
    h('span.knews__badge', icon(kind.icon), kind.word),
    h('span.knews__body',
      h('span.knews__name', client.name),
      h('span.knews__where', [where, ...extra].join(' · '))),
    h('span.knews__side',
      item.plates
        ? h(`b.knews__n.knews__n--${item.plates > 0 ? 'up' : 'down'}`,
          Math.abs(item.plates) === 1
            ? t('{n} comida hoy', { n: signed(item.plates) })
            : t('{n} comidas hoy', { n: signed(item.plates) }))
        : null,
      item.on === day && item.kind !== 'ultimo' && item.at
        ? h('span.knews__time', formatTime(item.at))
        : null),
    item.kind === 'nuevo' && !item.line && !(client.startsOn > day)
      ? h('span.knews__alarm', icon('alert'), t('Sin libreta'))
      : null);
}
