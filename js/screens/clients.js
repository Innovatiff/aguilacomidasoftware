/**
 * Every client, across every farm.
 *
 * The farms screen is the usual way in — people are found through the place
 * they work. This one exists for the other question: "where is Ramírez?", when
 * nobody remembers which farm he is at. So it is a flat, searchable list, with
 * the farm and location on every row.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import {
  searchInput, chips, itemRow, list, avatar, badge, emptyState, button, skeletonRows,
} from '../ui/kit.js';
import { go } from '../lib/router.js';
import { store, subscribe, billingFor, deliveryFor } from '../data/store.js';
import { matchesSearch } from '../data/clients.js';
import { clientStatusMeta, deliveryMeta } from '../lib/model.js';
import { money, plural } from '../lib/format.js';

export function renderClients(context) {
  let term = '';
  // `?farm=` narrows to one farm, which is how the route screen links here.
  let filter = context.query.farm || context.query.filter || 'all';

  const draw = () => {
    const rows = visible();

    screen({
      title: 'Clientes',
      subtitle: `${store.clients.length} en ${plural(store.farms.length, 'rancho', 'ranchos')}`,
      backTo: '/farms',
      tab: 'clients',
      sticky: h('div.searchbar',
        searchInput({
          placeholder: 'Buscar por nombre, rancho o ubicación…',
          value: term,
          onInput: (value) => { term = value; redraw(); },
        }),
        h('div', { style: { marginTop: '10px' } },
          chips(filters(), filter, (value) => { filter = value; draw(); }))),
      body: store.loaded.clients
        ? (rows.length ? list(rows.map(row), { card: false }) : empty())
        : skeletonRows(6),
      fab: h('button.fab', { type: 'button', onclick: () => go('/clients/new') },
        icon('userPlus'), 'Cliente'),
    });
  };

  /** Re-renders only the list, so typing never steals focus from the search box. */
  function redraw() {
    const host = document.querySelector('.page .list, .page .empty');
    if (!host) return draw();
    const rows = visible();
    host.replaceWith(rows.length ? list(rows.map(row)) : empty());
  }

  function filters() {
    const owing = store.clients.filter((client) => (billingFor(client)?.balance || 0) > 0).length;
    return [
      { value: 'all', label: 'Todos', count: store.clients.length },
      { value: 'owing', label: 'Con adeudo', count: owing },
      { value: 'paused', label: 'En pausa', count: store.clients.filter((c) => c.status !== 'active').length },
      // One chip per farm, so a long roster can be cut down to the farm in hand.
      ...store.farms.map((farm) => ({
        value: farm.id,
        label: farm.name,
        count: store.clients.filter((client) => client.farmId === farm.id).length,
      })),
    ];
  }

  function visible() {
    return store.clients
      .filter((client) => matchesSearch(client, term))
      .filter((client) => {
        if (filter === 'all') return true;
        if (filter === 'owing') return (billingFor(client)?.balance || 0) > 0;
        if (filter === 'paused') return client.status !== 'active';
        return client.farmId === filter;
      });
  }

  function empty() {
    if (term) {
      return emptyState({
        icon: 'search',
        title: 'Sin resultados',
        text: `Ningún cliente coincide con “${term}”.`,
      });
    }
    if (!store.clients.length) {
      return emptyState({
        icon: 'users',
        title: 'Todavía no hay clientes',
        text: store.farms.length
          ? 'Entra a un rancho y registra a su gente ahí.'
          : 'Registra primero un rancho: los clientes viven dentro de uno.',
        action: button(store.farms.length ? 'Registrar cliente' : 'Registrar rancho', {
          icon: 'userPlus',
          onClick: () => go(store.farms.length ? '/clients/new' : '/farms/new'),
        }),
      });
    }
    return emptyState({ icon: 'filter', title: 'Nada en este filtro', text: 'Prueba con otro filtro.' });
  }

  return subscribe(draw);
}

/* --- Row -------------------------------------------------------------------- */

function row(client) {
  const billing = billingFor(client);
  const status = clientStatusMeta(client.status);
  const stop = deliveryFor(client.id);
  const owes = (billing?.balance || 0) > 0;

  return itemRow({
    lead: avatar(client.name),
    title: client.name,
    meta: [client.farmName, client.locationName].filter(Boolean).join(' · ') || 'Sin ubicación',
    end: [
      owes
        ? badge(money(billing.balance, { round: true }), billing.status === 'overdue' ? 'bad' : 'warn')
        : client.status !== 'active'
          ? badge(status.label, status.tone)
          : stop
            ? badge(deliveryMeta(stop.status).short, deliveryMeta(stop.status).tone)
            : null,
      client.locationId ? null : badge('Sin ubicación', 'bad'),
    ].filter(Boolean),
    onClick: () => go(`/clients/${client.id}`),
  });
}
