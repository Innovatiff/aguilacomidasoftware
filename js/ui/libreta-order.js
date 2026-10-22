/**
 * The order a libreta is packed in — the sheet the manager uses in Empaque →
 * Configurar, and the kitchen in Organizar libreta. Location by location.
 *
 * The kitchen packs in the order the van is loaded, and the van goes house
 * by house, not farm by farm — so the list here is of locations, and two
 * houses of the same farm can be anywhere in it. Where the order leaves a
 * farm and comes back to it later, the packing screen says so and the bag
 * label follows: one bag per stretch.
 *
 * A libreta can have forty locations, and the first version of this sheet —
 * one long list to drag things around in — made finding each one the job.
 * So it is built for finding:
 *
 *   - **A search box** over both columns: "casa 4", "morsea", "mucci casa".
 *     Enter adds the one location that matches.
 *   - **"Por acomodar"**, the locations not in the order yet, grouped under
 *     their farm. Tapping one puts it at the end of the order, so the whole
 *     order can be built by tapping the route in sequence — "Empezar de
 *     cero" empties the order for exactly that.
 *   - **The number on each row is a button.** Type where it goes — 3 — and
 *     it goes there, from wherever it was. Drag and the arrows are still
 *     there for moving one a place or two.
 *
 * Nothing is saved until Guardar. Anything left in "Por acomodar" goes at
 * the end, in the paper book's order — it is never left out of the libreta.
 *
 * The kitchen's version (`takeFree`) also offers the locations no libreta
 * has — a new farm's houses, one somebody took out — marked *Nueva*. Tapping
 * one puts it in this libreta at the end of the order; left on the shelf it
 * stays in none.
 *
 * A new location this libreta is already packing because it packs the rest of
 * its farm (see `adoptingLine`) is in the order where it is packed, marked
 * *Nueva* too; saving writes it in for good. `bring` opens the sheet with one
 * location ready: taken into the order if it was on the shelf, and lit up
 * where it is.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { button, input } from './kit.js';
import { sheet } from './overlay.js';
import { sortable } from './sortable.js';
import { plural } from '../lib/format.js';
import { allPlaces, orderedPlaces, freePlaces } from '../lib/packing.js';

/**
 * @param {object}   options
 * @param {object[]} options.lines    both libretas, as stored
 * @param {object}   options.line     the one being put in order
 * @param {object[]} options.farms
 * @param {object[]} options.clients  everybody, to say how many live at each place
 * @param {boolean}  [options.takeFree]  offer the locations no libreta has
 * @param {string}   [options.bring]  a location to open with, ready and lit
 * @param {string}   [options.title]
 * @returns {Promise<{ order: string[], added: string[] } | null>} the keys in
 *   order — every one of its own, the shelf's at the end — and which of them
 *   were free; null when nothing was saved
 */
export async function arrangeSheet({
  lines, line, farms, clients, takeFree = false, bring = null, title = '',
}) {
  /** How many people live at one location. */
  const peopleAt = (entry) => {
    const known = new Set((entry.farm.locations || []).map((place) => place.id));
    return clients.filter((client) => {
      if (client.farmId !== entry.farm.id) return false;
      return entry.place.id
        ? client.locationId === entry.place.id
        : !known.has(client.locationId);
    }).length;
  };

  // What it packs, including new locations it took on with their farm.
  const members = orderedPlaces(lines, line.id, farms, clients, { adopt: true });
  const memberKeys = new Set(members.map((one) => one.key));
  // The paper book's order: the same libreta with no order of its own.
  const book = () => orderedPlaces(
    lines.map((row) => (row.id === line.id ? { ...row, order: [] } : row)),
    line.id, farms, clients, { adopt: true });
  // Locations no libreta has — offered to the kitchen, so a new house goes
  // straight into its place in the order instead of waiting for the manager.
  // Not the ones this libreta already packs with their farm: those are in
  // its order.
  const free = takeFree
    ? freePlaces(lines, farms, clients).filter((one) => !memberKeys.has(one.key))
    : [];
  const freeKeys = new Set(free.map((one) => one.key));
  const byKey = new Map([...members, ...free].map((one) => [one.key, one]));
  // Where each location sits among all of them: farm by name, then the
  // farm's own list — the order "Por acomodar" is read in.
  const shelf = allPlaces(farms, clients).map((one) => one.key).filter((key) => byKey.has(key));

  let order = members.slice();
  let query = [];
  let editing = null;   // the row whose number is being typed
  let focus = null;     // where the cursor goes back to after a redraw
  let fresh = null;     // the row that just arrived, lit up for a moment

  // Opened for one location: in the order and lit, wherever it is.
  if (bring && byKey.has(bring)) {
    if (!order.some((one) => one.key === bring)) order = [...order, byKey.get(bring)];
    fresh = bring;
  }

  const fold = (text) => String(text || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const matches = (one) => !query.length
    || query.every((word) => fold(`${one.place.name} ${one.farm.name}`).includes(word));
  const placed = () => new Set(order.map((one) => one.key));
  const waiting = () => {
    const taken = placed();
    return shelf.filter((key) => !taken.has(key)).map((key) => byKey.get(key));
  };

  /* What the buttons do. Each one redraws. */
  const add = (key) => {
    if (placed().has(key) || !byKey.has(key)) return;
    order = [...order, byKey.get(key)];
    fresh = key;
  };
  const remove = (key) => { order = order.filter((one) => one.key !== key); };
  const moveTo = (key, number) => {
    const at = order.findIndex((one) => one.key === key);
    if (at === -1) return;
    const to = Math.max(0, Math.min(order.length - 1, number - 1));
    const next = order.slice();
    const [one] = next.splice(at, 1);
    next.splice(to, 0, one);
    order = next;
    if (to !== at) fresh = key;
  };
  const step = (key, by) => {
    const at = order.findIndex((one) => one.key === key);
    if (at === -1 || at + by < 0 || at + by >= order.length) return;
    moveTo(key, at + by + 1);
    fresh = null;
    focus = { key, part: by < 0 ? 'up' : 'down' };
  };

  /* --- What is on the sheet ---------------------------------------------- */

  const search = input({
    type: 'search',
    placeholder: 'Buscar ubicación o farma',
    autocomplete: 'off',
    'aria-label': 'Buscar ubicación o farma',
    oninput: () => { query = fold(search.value).split(/\s+/).filter(Boolean); paint(); },
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      // Enter adds the location the search points at — only when it points
      // at exactly one, so a half-typed word never adds the wrong house.
      const found = waiting().filter(matches);
      if (found.length !== 1) return;
      add(found[0].key);
      search.value = '';
      query = [];
      paint();
    },
  });
  search.classList.add('pkord__search');

  const list = h('ol.pkorder');
  const shelfBox = h('div.pkpool');
  const placedCount = h('span.pkord__count');
  const waitingCount = h('span.pkord__count');
  const leftover = h('p.pkord__left');

  function numberBox(one, at) {
    const box = h('input.pkorder__num', {
      type: 'number', min: 1, max: order.length, value: at + 1, inputmode: 'numeric',
      'aria-label': `Número nuevo para ${one.place.name}`,
    });
    const done = (apply) => {
      if (editing !== one.key) return;
      editing = null;
      const number = parseInt(box.value, 10);
      if (apply && number >= 1) moveTo(one.key, number);
      focus = { key: one.key, part: 'number' };
      paint();
    };
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); done(true); }
      // Escape cancels the number, not the whole sheet.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done(false); }
    });
    box.addEventListener('blur', () => done(true));
    queueMicrotask(() => { box.focus(); box.select(); });
    return box;
  }

  function row(one) {
    const at = order.indexOf(one);
    const count = peopleAt(one);
    // While searching only some rows show, and the rows around one on the
    // screen are not the ones around it in the order: dragging or stepping
    // would mean something different from what it looks like. The number
    // and the ✕ mean the same thing either way, so they stay.
    const whole = !query.length;
    return h(`li.pkorder__row${fresh === one.key ? '.is-new' : ''}`, { dataset: { key: one.key } },
      whole
        ? h('button.pkorder__grip', {
          type: 'button',
          'data-grip': '',
          title: 'Arrastrar para mover',
          'aria-label': `Mover ${one.place.name} de ${one.farm.name}. `
            + 'Usa las flechas del teclado para subirla o bajarla.',
        }, icon('grip'))
        : null,
      editing === one.key
        ? numberBox(one, at)
        : h('button.pkorder__n', {
          type: 'button',
          'data-part': 'number',
          title: 'Toca para mandarla a otro número',
          'aria-label': `Número ${at + 1}. Toca para mandarla a otro número.`,
          onclick: () => { editing = one.key; paint(); },
        }, String(at + 1)),
      h('span.pkorder__text',
        h('span.pkorder__place', one.place.name,
          one.adopted || freeKeys.has(one.key) ? h('span.pkpool__free', 'Nueva') : null),
        h('span.pkorder__farm', `${one.farm.name} · `
          + `${count ? plural(count, 'cliente', 'clientes') : 'sin clientes'}`)),
      whole
        ? [
          h('button.pkorder__step', {
            type: 'button', disabled: at === 0, 'data-part': 'up',
            'aria-label': `Subir ${one.place.name}`,
            onclick: () => { step(one.key, -1); paint(); },
          }, icon('chevronU')),
          h('button.pkorder__step', {
            type: 'button', disabled: at === order.length - 1, 'data-part': 'down',
            'aria-label': `Bajar ${one.place.name}`,
            onclick: () => { step(one.key, 1); paint(); },
          }, icon('chevronD')),
        ]
        : null,
      h('button.pkorder__out', {
        type: 'button',
        'data-part': 'out',
        title: 'Quitar del orden',
        'aria-label': `Quitar ${one.place.name} del orden`,
        onclick: () => { remove(one.key); paint(); },
      }, icon('x')));
  }

  function shelfFor(entries) {
    const farms = new Map();
    for (const one of entries) {
      if (!farms.has(one.farm.id)) farms.set(one.farm.id, { farm: one.farm, items: [] });
      farms.get(one.farm.id).items.push(one);
    }
    return [...farms.values()].map(({ farm, items }) => h('div.pkpool__farm',
      h('div.pkpool__name', farm.name),
      h('div.pkpool__items', items.map((one) => {
        const count = peopleAt(one);
        return h('button.pkpool__item', {
          type: 'button',
          dataset: { key: one.key },
          title: 'Ponerla al final del orden',
          onclick: () => { add(one.key); paint(); },
        },
        icon('plus'),
        h('span.pkpool__place', one.place.name),
        // Not in any libreta yet: taking it puts it in this one.
        freeKeys.has(one.key) ? h('span.pkpool__free', 'Nueva') : null,
        // How many people live there, with the people icon so a bare number
        // is not left to guess at; nothing at all for an empty house.
        count
          ? h('span.pkpool__meta', { title: plural(count, 'cliente', 'clientes') },
            icon('users'), String(count))
          : null);
      }))));
  }

  function paint() {
    const shown = order.filter(matches);
    placedCount.textContent = String(order.length);
    list.classList.toggle('is-filtered', query.length > 0);
    mount(list, shown.length
      ? shown.map(row)
      : h('li.pkord__empty', order.length
        ? 'Ninguna del orden coincide con la búsqueda.'
        : 'Todavía no hay ninguna. Toca las de «Por acomodar» en el orden en que se empacan.'));

    const rest = waiting();
    const restShown = rest.filter(matches);
    waitingCount.textContent = String(rest.length);
    mount(shelfBox, restShown.length
      ? shelfFor(restShown)
      : h('p.pkord__empty', rest.length
        ? 'Ninguna por acomodar coincide con la búsqueda.'
        : 'Todas están en el orden.'));

    // Its own locations left on the shelf still go in, at the end; new ones
    // left there stay out of every libreta, as they were.
    const ownLeft = rest.filter((one) => !freeKeys.has(one.key)).length;
    const newLeft = rest.length - ownLeft;
    leftover.textContent = [
      ownLeft ? `${plural(ownLeft, 'ubicación sin acomodar se va', 'ubicaciones sin acomodar se van')} `
        + 'al final, en el orden de siempre.' : '',
      newLeft ? `${plural(newLeft, 'nueva se queda', 'nuevas se quedan')} sin libreta.` : '',
    ].filter(Boolean).join(' ');
    leftover.hidden = !rest.length;

    // The row that just arrived is shown, lit for a moment, so whoever
    // tapped it sees where it went in a list longer than the screen.
    if (fresh) {
      const lit = [...list.children].find((el) => el.dataset.key === fresh);
      lit?.scrollIntoView({ block: 'nearest' });
      fresh = null;
    }
    if (focus) {
      const at = [...list.children].find((el) => el.dataset.key === focus.key);
      const target = at?.querySelector(`[data-part="${focus.part}"]:not(:disabled)`)
        || at?.querySelector('[data-grip]') || at?.querySelector('[data-part="number"]');
      target?.focus({ preventScroll: false });
      focus = null;
    }
  }

  sortable(list, {
    onChange: (keys, moved) => {
      order = keys.map((key) => byKey.get(key)).filter(Boolean);
      focus = { key: moved, part: 'grip' };
      paint();
    },
  });
  paint();

  const saved = await sheet({
    title: title || `Orden de ${line.name}`,
    wide: true,
    build: () => h('div.pkord',
      h('p.pkord__intro', 'Así se empaca esta libreta, de arriba abajo, ubicación por '
        + 'ubicación. Nada se guarda hasta «Guardar orden».'
        + (free.length ? ' Las ubicaciones que no están en ninguna libreta salen en «Por '
          + 'acomodar» marcadas Nueva: tócala y entra a esta libreta en ese lugar.' : '')),
      h('div.pkord__tools',
        search,
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          title: 'Pasar todas a «Por acomodar» para armar el orden tocándolas',
          onclick: () => { order = []; editing = null; paint(); search.focus(); },
        }, icon('refresh'), 'Empezar de cero'),
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: () => { order = book(); editing = null; paint(); },
        }, icon('farm'), 'Ordenar por farma')),
      h('div.pkord__cols',
        h('section.pkord__col', { 'aria-label': 'El orden' },
          h('div.pkord__head',
            h('span.pkord__title', 'El orden'), placedCount),
          h('p.pkord__hint', 'Toca el número para mandarla a otro lugar, o arrástrala '
            + 'de la manija. ✕ la regresa a «Por acomodar».'),
          list),
        h('section.pkord__col.pkord__col--shelf', { 'aria-label': 'Por acomodar' },
          h('div.pkord__head',
            h('span.pkord__title', 'Por acomodar'), waitingCount),
          h('p.pkord__hint', 'Tócalas en el orden en que se empacan: cada una se va al '
            + 'final del orden.'),
          shelfBox))),
    foot: (close) => h('div.pkord__foot',
      leftover,
      button('Guardar orden', {
        variant: 'primary', size: 'lg', block: true, onClick: () => close(true),
      })),
  });
  if (!saved) return null;

  // Whatever is still waiting goes at the end, in the book's order — never
  // left out of the libreta.
  const taken = placed();
  const keys = [
    ...order.map((one) => one.key),
    ...book().filter((one) => !taken.has(one.key)).map((one) => one.key),
  ];
  return { order: keys, added: keys.filter((key) => freeKeys.has(key)) };
}
