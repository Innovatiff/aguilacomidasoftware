/**
 * La libreta.
 *
 * The paper book this replaced was read in one order and only one: the farm,
 * then a place on that farm, then the people standing there, then the next
 * place, then the next farm. Managers who ran the business that way for years
 * are the people using this screen, so it keeps that order exactly and adds
 * nothing to it — no filters, no tabs, no bulk actions. A search box and the
 * book.
 *
 * Each person is laid out the way the question gets asked at the gate:
 *
 *   1. what they cannot eat        — before anything is handed over
 *   2. who they are, and their week
 *   3. what they have paid, and whether they owe
 *
 * Everything is set large and spaced out. The people reading it are not
 * squinting at a phone in good light; they are checking a name across a counter
 * with their glasses on the other table.
 *
 * Only active clients appear. Somebody paused or gone is not in the book — that
 * is what the roster in Clientes is for.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import { searchInput, emptyState, skeletonRows, dataErrorCard } from '../ui/kit.js';
import { go } from '../lib/router.js';
import { store, subscribe, clientState, receiptsFor, firstError, startStore } from '../data/store.js';
import { matchesSearch } from '../data/clients.js';
import { matchesFarm } from '../data/farms.js';
import { mealsOn, extrasOf } from '../lib/pricing.js';
import { money, plural } from '../lib/format.js';
import { formatDay, WEEKDAYS_SHORT } from '../lib/dates.js';

/** What the payment line says, and how loudly. */
const STANDING = {
  overdue: { label: 'DEBE', tone: 'bad' },
  due: { label: 'DEBE', tone: 'bad' },
  covered: { label: 'PAGADO', tone: 'ok' },
  clear: { label: 'AL CORRIENTE', tone: 'ok' },
};

export function renderNotebook() {
  let term = '';

  const draw = () => {
    const failure = firstError();

    screen({
      title: 'Libreta',
      subtitle: `${plural(active().length, 'cliente activo', 'clientes activos')}`,
      tab: 'notebook',
      sunken: true,
      sticky: h('div.searchbar',
        searchInput({
          placeholder: 'Buscar cliente, rancho o ubicación…',
          value: term,
          onInput: (value) => { term = value; redraw(); },
        })),
      body: failure
        ? h('div.page__inner', dataErrorCard(failure.error, { onRetry: () => startStore() }))
        : store.loaded.clients && store.loaded.farms ? pages() : skeletonRows(6),
    });
  };

  /** Redraws only the book, so typing never steals focus from the box. */
  function redraw() {
    const host = document.getElementById('notebook');
    if (!host) return draw();
    host.replaceWith(pages());
  }

  const active = () => store.clients.filter((client) => client.status === 'active');

  /* --- The book --------------------------------------------------------- */

  /**
   * Farm, then location, then people — the order the paper book was kept in.
   *
   * A farm or a location whose name matches the search keeps all of its people;
   * otherwise only the people who match are shown, and anything left empty
   * disappears. Searching a farm should give you that farm's page, not a
   * filtered fragment of it.
   */
  function pages() {
    const people = active();
    const books = [];

    for (const farm of store.farms) {
      const farmMatches = matchesFarm(farm, term);
      const roster = people.filter((client) => client.farmId === farm.id);
      const places = [];

      for (const place of farm.locations || []) {
        const here = roster.filter((client) => client.locationId === place.id);
        const shown = (farmMatches || matchesText(place.name))
          ? here
          : here.filter((client) => matchesSearch(client, term));
        if (shown.length) places.push({ place, clients: shown.sort(byName) });
      }

      // Anybody whose location was removed still has to appear somewhere, or
      // they quietly vanish from the only complete list of the business.
      const known = new Set((farm.locations || []).map((place) => place.id));
      const adrift = roster
        .filter((client) => !known.has(client.locationId))
        .filter((client) => farmMatches || matchesSearch(client, term));
      if (adrift.length) {
        places.push({ place: { id: '', name: 'Sin ubicación' }, clients: adrift.sort(byName), orphan: true });
      }

      if (places.length) books.push({ farm, places });
    }

    if (!books.length) return h('div', { id: 'notebook' }, empty());

    return h('div.book', { id: 'notebook' }, books.map(farmPage));
  }

  const matchesText = (text) => matchesFarm({ name: text }, term);
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'es');

  function farmPage({ farm, places }) {
    const count = places.reduce((sum, entry) => sum + entry.clients.length, 0);

    return h('section.book__farm',
      h('header.book__farmhead',
        h('h2.book__farmname', farm.name),
        h('div.book__farmmeta', plural(count, 'cliente', 'clientes'))),
      places.map(locationBlock));
  }

  function locationBlock({ place, clients, orphan }) {
    return h('section.book__place',
      h('header.book__placehead',
        h('span.book__pin', icon('pin')),
        h('h3.book__placename', place.name),
        h('span.book__placecount', plural(clients.length, 'cliente', 'clientes')),
        orphan ? h('span.book__warn', 'Revisar') : null),
      h('div.book__people', clients.map(personCard)));
  }

  /* --- One person ------------------------------------------------------- */

  function personCard(client) {
    const row = clientState(client);
    const standing = STANDING[row.state] || STANDING.clear;
    const payments = receiptsFor(client.id).filter((one) => Number(one.amount) > 0);

    return h('button.person', {
      type: 'button',
      onclick: () => go(`/clients/${client.id}`),
    },
    // 1. What they cannot eat, above their own name: it is the thing that has
    //    to be known before a plate is handed over.
    (client.tags || []).length
      ? h('div.person__diet',
          (client.tags || []).map((tag) => h('span.person__tag', icon('ban'), tag)))
      : null,

    // 2. Who they are, and the week they eat.
    h('div.person__top',
      h('div.person__name', client.name),
      h('div.person__week',
        weekLine(client),
        extrasLine(client))),

    // 3. What they have paid, and where that leaves them.
    h('div.person__money',
      h('div.person__pays',
        h('span.person__payslabel', 'Pagos'),
        payments.length
          ? h('span.person__payslist',
              payments.slice(0, 3).map((one) => h('span.person__pay',
                h('b', money(one.amount, { round: true })),
                ' ', formatDay(one.date))))
          : h('span.person__none', 'Sin pagos registrados')),

      h(`div.person__standing.is-${standing.tone}`,
        h('span.person__word', standing.label),
        h('span.person__amount', row.owed > 0
          ? money(row.owed)
          : row.paidThrough
            ? `hasta ${formatDay(row.paidThrough)}`
            : ''))));
  }

  /** "Lun Mar Mié Jue Vie Sáb · 2 al día" — the week, spelled out. */
  function weekLine(client) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const days = order.filter((weekday) => mealsOn(client, weekday) > 0);

    return h('div.person__days',
      days.length
        ? days.map((weekday) => h('span.person__day', WEEKDAYS_SHORT[weekday]))
        : h('span.person__none', 'Sin días'),
      h('span.person__per', `${plural(client.mealsPerDay, 'comida', 'comidas')} al día`));
  }

  function extrasLine(client) {
    const extras = extrasOf(client);
    if (!extras.length) return null;

    return h('div.person__extras',
      extras.map((entry) => h('span.person__extra',
        `+${entry.count} el ${WEEKDAYS_SHORT[entry.weekday]}`)));
  }

  function empty() {
    if (term) {
      return emptyState({
        icon: 'search',
        title: 'Sin resultados',
        text: `Nada coincide con “${term}”.`,
      });
    }
    return emptyState({
      icon: 'clipboard',
      title: 'La libreta está vacía',
      text: 'Aquí aparecen los clientes activos, ordenados por rancho y ubicación.',
    });
  }

  return subscribe(draw);
}
