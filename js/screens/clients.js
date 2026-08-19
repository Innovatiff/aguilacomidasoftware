/**
 * Client list — every farm the kitchen serves, with the two facts staff look
 * for most: is it active today, and does it owe money.
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
import { STATUS_LABEL } from '../lib/billing.js';

export function renderClients(context) {
  let term = '';
  let filter = context.query.filter || 'all';

  const draw = () => {
    const rows = visible();

    screen({
      title: 'Ranchos',
      subtitle: `${store.clients.length} registrados`,
      tab: 'clients',
      sticky: h('div.searchbar',
        searchInput({
          placeholder: 'Buscar rancho, contacto o teléfono…',
          value: term,
          onInput: (value) => { term = value; redraw(); },
        }),
        h('div', { style: { marginTop: '10px' } },
          chips(filters(), filter, (value) => { filter = value; draw(); }))),
      body: store.loaded.clients
        ? (rows.length ? list(rows.map(row), { card: false }) : empty())
        : skeletonRows(6),
      fab: h('button.fab', { type: 'button', onclick: () => go('/clients/new') },
        icon('plus'), 'Nuevo'),
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
      { value: 'active', label: 'Activos', count: store.clients.filter((c) => c.status === 'active').length },
      { value: 'owing', label: 'Con adeudo', count: owing },
      { value: 'paused', label: 'En pausa', count: store.clients.filter((c) => c.status !== 'active').length },
    ];
  }

  function visible() {
    return store.clients
      .filter((client) => matchesSearch(client, term))
      .filter((client) => {
        if (filter === 'active') return client.status === 'active';
        if (filter === 'paused') return client.status !== 'active';
        if (filter === 'owing') return (billingFor(client)?.balance || 0) > 0;
        return true;
      });
  }

  function empty() {
    if (term) {
      return emptyState({
        icon: 'search',
        title: 'Sin resultados',
        text: `Ningún rancho coincide con “${term}”.`,
      });
    }
    if (!store.clients.length) {
      return emptyState({
        icon: 'users',
        title: 'Todavía no hay ranchos',
        text: 'Registra tu primer cliente para empezar a llevar el control de entregas y pagos.',
        action: button('Registrar rancho', { icon: 'userPlus', onClick: () => go('/clients/new') }),
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
    meta: [
      plural(client.mealsPerDay, 'comida/día', 'comidas/día'),
      client.contactName,
    ].filter(Boolean).join(' · '),
    end: [
      owes
        ? badge(money(billing.balance, { round: true }), billing.status === 'overdue' ? 'bad' : 'warn')
        : client.status !== 'active'
          ? badge(status.label, status.tone)
          : stop
            ? badge(deliveryMeta(stop.status).short, deliveryMeta(stop.status).tone)
            : null,
      owes && billing.status === 'overdue'
        ? h('span.t-xs.c-bad.w-600', STATUS_LABEL.overdue)
        : null,
    ].filter(Boolean),
    onClick: () => go(`/clients/${client.id}`),
  });
}
