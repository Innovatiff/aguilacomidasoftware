/**
 * Cobrar — the counter.
 *
 * Somebody is standing at the store with cash in their hand, so this screen is
 * a search box and nothing else above it. Type three letters of a name, tap the
 * row, confirm the amount. Everything that would normally be decided here —
 * which fortnight, how much — is already worked out and shown, because the
 * queue is what makes a slow screen expensive.
 *
 * With the box empty the screen is not blank: it lists whoever owes money,
 * because that is who is most likely to be walking up, and underneath it the
 * day's takings — what has been collected today and by whom, which is what
 * closing the till at night needs.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  searchInput, itemRow, list, avatar, badge, emptyState, card,
  sectionLabel, statGrid, stat, skeletonRows, alert,
} from '../ui/kit.js';
import { openChargeSheet } from '../ui/charge-sheet.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, billingFor, invoicesFor } from '../data/store.js';
import { matchesSearch } from '../data/clients.js';
import { watchReceiptsOn, totalOf } from '../data/receipts.js';
import { priceFor } from '../lib/pricing.js';
import { money, plural } from '../lib/format.js';
import { today, formatDayLong, formatTime } from '../lib/dates.js';
import { paymentMethodMeta } from '../lib/model.js';

export function renderCheckout() {
  let term = '';
  let receipts = [];

  const stops = [
    watchReceiptsOn(today(), (rows) => { receipts = rows; draw(); }, () => {}),
    subscribe(() => draw()),
  ];

  function draw() {
    screen({
      title: 'Cobrar',
      subtitle: formatDayLong(today()),
      tab: 'clients',
      backTo: '/clients',
      actions: [topbarButton('receipt', { label: 'Cobranza', onClick: () => go('/billing') })],
      sunken: true,
      sticky: h('div.searchbar',
        searchInput({
          placeholder: 'Nombre del cliente…',
          value: term,
          onInput: (value) => { term = value; redraw(); },
        })),
      body: store.loaded.clients ? body() : skeletonRows(6),
    });

    // The person is waiting: the cursor belongs in the box.
    queueMicrotask(() => {
      const box = document.querySelector('.searchbar input');
      if (box && document.activeElement !== box) box.focus();
    });
  }

  function redraw() {
    const host = document.getElementById('checkout-body');
    if (!host) return draw();
    host.replaceWith(body());
  }

  function body() {
    return h('div.page__inner.stack.stack-4', { id: 'checkout-body' },
      term ? results() : todayCard());
  }

  /* --- Search -------------------------------------------------------------- */

  function results() {
    const rows = store.clients
      .filter((client) => matchesSearch(client, term))
      .sort(byDebtThenName)
      .slice(0, 25);

    if (!rows.length) {
      return emptyState({
        icon: 'search',
        title: 'Sin resultados',
        text: `Nadie coincide con “${term}”. Prueba con el apellido o el rancho.`,
      });
    }

    return h('div.stack.stack-3',
      sectionLabel(`${plural(rows.length, 'resultado', 'resultados')}`),
      list(rows.map(clientRow), { card: true }));
  }

  function clientRow(client) {
    const billing = billingFor(client);
    const owes = (billing?.balance || 0) > 0;
    const fortnight = priceFor(store.pricing, client.mealsPerDay);

    return itemRow({
      lead: avatar(client.name),
      title: client.name,
      meta: [client.farmName, client.locationName].filter(Boolean).join(' · '),
      end: [
        owes
          ? badge(money(billing.balance, { round: true }), billing.status === 'overdue' ? 'bad' : 'warn')
          : badge('Al corriente', 'ok'),
        h('span.t-xs.c-soft', fortnight
          ? `${money(fortnight)}/quincena`
          : 'sin precio'),
      ],
      onClick: () => charge(client),
    });
  }

  // A declaration, not a const: the receipts listener fires `draw()` the moment
  // it is attached, before a `const` further down this function would exist.
  function byDebtThenName(a, b) {
    const owed = (client) => billingFor(client)?.balance || 0;
    return owed(b) - owed(a) || String(a.name).localeCompare(String(b.name), 'es');
  }

  /* --- The till ------------------------------------------------------------ */

  function todayCard() {
    const taken = totalOf(receipts);
    const owing = store.clients
      .filter((client) => (billingFor(client)?.balance || 0) > 0)
      .sort(byDebtThenName);

    return h('div.stack.stack-4',
      card(h('div.stack.stack-3',
        h('div.row',
          h('span.item__ico', icon('search')),
          h('div.grow',
            h('div.w-650', 'Busca al cliente'),
            h('div.t-sm.c-soft', 'Escribe su nombre arriba para cobrarle.'))))),

      statGrid([
        stat({
          label: 'Cobrado hoy',
          value: money(taken, { round: true }),
          foot: `${plural(receipts.length, 'recibo', 'recibos')}`,
          tone: taken > 0 ? 'ok' : null,
        }),
        stat({
          label: 'Por cobrar',
          value: money(store.outstanding.reduce((sum, invoice) =>
            sum + Math.max(0, (Number(invoice.amount) || 0) - (Number(invoice.paid) || 0)), 0), { round: true }),
          foot: 'En todas las facturas abiertas',
          onClick: () => go('/billing'),
        }),
      ]),

      owing.length
        ? h('div.stack.stack-3',
            sectionLabel(`Con adeudo · ${owing.length}`,
              h('span.t-sm.c-soft', 'Tócalos para cobrar')),
            list(owing.slice(0, 12).map(clientRow), { card: true }))
        : alert('Nadie debe nada ahora mismo.', 'ok'),

      receipts.length
        ? h('div.stack.stack-3',
            sectionLabel('Recibos de hoy'),
            list(receipts.map(receiptRow), { card: true }))
        : alert('Todavía no se ha cobrado nada hoy.', 'info'));
  }

  function receiptRow(receipt) {
    const reversal = Number(receipt.amount) < 0;
    return itemRow({
      lead: avatar(receipt.clientName, { size: 'sm' }),
      title: receipt.clientName,
      meta: [
        receipt.folio,
        paymentMethodMeta(receipt.method).label,
        receipt.at ? formatTime(receipt.at) : null,
        receipt.takenByName,
      ].filter(Boolean).join(' · '),
      end: [
        h(`span.w-700${reversal ? '.c-bad' : ''}`, money(receipt.amount)),
        reversal ? badge('Cancelación', 'bad') : null,
      ].filter(Boolean),
      onClick: () => go(`/receipts/${receipt.id}`),
    });
  }

  /* --- Charging ------------------------------------------------------------ */

  async function charge(client) {
    const receipt = await openChargeSheet({
      client,
      invoices: invoicesFor(client.id),
      tiers: store.pricing,
      author: { uid: session.uid, name: session.displayName },
    });
    if (!receipt) return;
    term = '';
    go(`/receipts/${receipt.id}`);
  }

  return () => stops.forEach((stop) => stop?.());
}
