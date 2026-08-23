/**
 * Ranchos — the places the kitchen serves.
 *
 * A farm is a container: its people, its locations and its terms. The list
 * answers the two questions asked in front of it — how many mouths are we
 * cooking for there, and does it owe money — and the search reaches through to
 * the people, because staff look for "Peña" far more often than for "Mucci".
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  searchInput, itemRow, list, avatar, badge, emptyState, button, skeletonRows,
  sectionLabel, dataErrorCard,
} from '../ui/kit.js';
import { go } from '../lib/router.js';
import { store, subscribe, farmStats, firstError, startStore } from '../data/store.js';
import { matchesFarm } from '../data/farms.js';
import { matchesSearch } from '../data/clients.js';
import { clientStatusMeta } from '../lib/model.js';
import { money, plural, number } from '../lib/format.js';

export function renderFarms() {
  let term = '';

  const draw = () => {
    const failure = firstError();

    screen({
      title: 'Ranchos',
      subtitle: `${store.farms.length} ${store.farms.length === 1 ? 'rancho' : 'ranchos'} · ${plural(store.clients.length, 'cliente', 'clientes')}`,
      tab: 'farms',
      actions: [topbarButton('users', {
        label: 'Todos los clientes', onClick: () => go('/clients'),
      })],
      sticky: h('div.searchbar',
        searchInput({
          placeholder: 'Buscar rancho o cliente…',
          value: term,
          onInput: (value) => { term = value; redraw(); },
        })),
      body: failure
        ? h('div.page__inner', dataErrorCard(failure.error, { onRetry: () => startStore() }))
        : store.loaded.farms && store.loaded.clients ? results() : skeletonRows(5),
      fab: h('button.fab', { type: 'button', onclick: () => go('/farms/new') },
        icon('plus'), 'Rancho'),
    });
  };

  /** Redraws only the results, so typing never steals focus from the search box. */
  function redraw() {
    const host = document.getElementById('farm-results');
    if (!host) return draw();
    host.replaceWith(results());
  }

  function results() {
    const farms = store.farms.filter((farm) => matchesFarm(farm, term));
    // Only while searching: a farm's people are one tap away otherwise, and
    // listing every worker here would bury the farms.
    const people = term ? store.clients.filter((client) => matchesSearch(client, term)) : [];

    if (!farms.length && !people.length) return h('div', { id: 'farm-results' }, empty());

    return h('div.page__inner.stack.stack-4', { id: 'farm-results' },
      farms.length ? list(farms.map(farmRow), { card: false }) : null,
      people.length
        ? h('div.stack.stack-2',
            sectionLabel(`Clientes · ${people.length}`),
            list(people.slice(0, 12).map(personRow), { card: true }))
        : null);
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
      icon: 'farm',
      title: 'Todavía no hay ranchos',
      text: 'Registra el rancho primero: sus ubicaciones y su gente se agregan dentro.',
      action: button('Registrar rancho', { icon: 'plus', onClick: () => go('/farms/new') }),
    });
  }

  return subscribe(draw);
}

/* --- Rows -------------------------------------------------------------------- */

function farmRow(farm) {
  const stats = farmStats(farm.id);
  const places = (farm.locations || []).length;
  const paused = farm.status !== 'active';

  return itemRow({
    lead: avatar(farm.name),
    title: farm.name,
    meta: [
      plural(stats.active, 'cliente', 'clientes'),
      places ? plural(places, 'ubicación', 'ubicaciones') : 'sin ubicaciones',
    ].join(' · '),
    end: [
      stats.balance > 0 ? badge(money(stats.balance, { round: true }), 'warn') : null,
      paused ? badge(clientStatusMeta(farm.status).label, clientStatusMeta(farm.status).tone) : null,
      !places ? badge('Falta ubicación', 'bad') : null,
      stats.meals ? h('span.t-xs.c-soft', `${number(stats.meals)} comidas/día`) : null,
    ].filter(Boolean),
    onClick: () => go(`/farms/${farm.id}`),
  });
}

function personRow(client) {
  return itemRow({
    lead: avatar(client.name, { size: 'sm' }),
    title: client.name,
    meta: [client.farmName, client.locationName].filter(Boolean).join(' · '),
    onClick: () => go(`/clients/${client.id}`),
  });
}
