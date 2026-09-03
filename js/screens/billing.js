/**
 * Cobranza — the money worklist.
 *
 * Every person is billed individually — that is how the farms want it, each
 * worker settling their own fortnight — but nobody chases them one by one, so
 * the list is grouped by farm with the farm's total on the header.
 *
 * Closing a fortnight is one button for the whole business. It reads each
 * period once, in a single query, rather than once per person: with a few
 * hundred workers the difference is a few round trips instead of a few hundred.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  card, stat, statGrid, button, badge, avatar, itemRow, list, chips,
  sectionLabel, emptyState, skeletonRows, alert, defList, defRow,
} from '../ui/kit.js';
import { toastOk, toastBad, sheet } from '../ui/overlay.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, moneyStats, debtors, farmById } from '../data/store.js';
import { watchSettled } from '../data/invoices.js';
import { pendingBilling, issueAll, byFarm as billingByFarm } from '../data/cycles.js';
import {
  balanceOf, invoiceStatus, isCharge, invoiceTitle, STATUS_LABEL, STATUS_TONE,
} from '../lib/billing.js';
import { today, humanDelta, daysBetween } from '../lib/dates.js';
import { money, moneyFull, number, plural } from '../lib/format.js';
import { errorText } from '../firebase.js';

export function renderBilling(context) {
  let filter = context.query.filter || 'all';
  let settled = [];

  const stopSettled = watchSettled((rows) => { settled = rows; draw(); }, () => {});

  const draw = () => {
    screen({
      title: 'Cobranza',
      subtitle: `${money(moneyStats().outstanding, { round: true })} por cobrar`,
      backTo: '/clients',
      tab: 'clients',
      actions: [topbarButton('receipt', { label: 'Cerrar periodos', onClick: closeCycle })],
      sunken: true,
      sticky: h('div.searchbar.searchbar--sunken',
        chips(filters(), filter, (value) => { filter = value; draw(); })),
      body: store.loaded.outstanding ? body() : skeletonRows(5),
      fab: h('button.fab', { type: 'button', onclick: () => go('/cobrar') },
        icon('cash'), 'Cobrar'),
    });
  };

  function filters() {
    const rows = store.outstanding;
    return [
      { value: 'all', label: 'Pendientes', count: rows.length },
      { value: 'overdue', label: 'Vencidas', count: rows.filter((r) => invoiceStatus(r, today()) === 'overdue').length },
      { value: 'due', label: 'Por pagar', count: rows.filter((r) => invoiceStatus(r, today()) === 'due').length },
      { value: 'paid', label: 'Pagadas', count: settled.length },
    ];
  }

  function body() {
    const cash = moneyStats();

    return h('div.page__inner.stack.stack-4',
      // The counter is the first thing on the money screen: most of what comes
      // in arrives with somebody standing at the store, not by chasing.
      button('Cobrar en la tienda', {
        variant: 'dark', block: true, icon: 'cash', onClick: () => go('/cobrar'),
      }),

      statGrid([
        stat({
          label: 'Por cobrar', value: money(cash.outstanding, { round: true }),
          foot: `${store.outstanding.length} ${store.outstanding.length === 1 ? 'factura' : 'facturas'}`,
          tone: cash.outstanding > 0 ? 'accent' : 'ok',
        }),
        stat({
          label: 'Vencido', value: money(cash.overdue, { round: true }),
          foot: cash.overdueCount ? `${cash.overdueCount} ${cash.overdueCount === 1 ? 'factura' : 'facturas'}` : 'Ninguna',
          tone: cash.overdue > 0 ? 'bad' : 'ok',
        }),
      ]),

      filter === 'paid' ? settledList() : outstandingList());
  }

  /* --- Lists --------------------------------------------------------------- */

  function outstandingList() {
    const rows = store.outstanding.filter((invoice) => {
      if (filter === 'overdue') return invoiceStatus(invoice, today()) === 'overdue';
      if (filter === 'due') return invoiceStatus(invoice, today()) === 'due';
      return true;
    });

    if (!rows.length) {
      return emptyState({
        icon: 'shield',
        title: filter === 'all' ? 'Nadie debe nada' : 'Nada en este filtro',
        text: filter === 'all'
          ? 'Todas las facturas emitidas están pagadas.'
          : 'Prueba con otro filtro para ver el resto de las facturas.',
      });
    }

    // Grouped by farm, then by person: one farm is one conversation, even
    // though every worker owes their own fortnight.
    const people = debtors().map((group) => ({
      ...group,
      invoices: group.invoices.filter((invoice) => rows.includes(invoice)),
    })).filter((group) => group.invoices.length);

    return h('div.stack.stack-5', byFarm(people).map(farmGroup));
  }

  /** Debtors bucketed by the farm their client belongs to. */
  function byFarm(people) {
    const farms = new Map();

    for (const person of people) {
      const client = store.clients.find((row) => row.id === person.clientId);
      const farmId = client?.farmId || '';
      if (!farms.has(farmId)) {
        farms.set(farmId, {
          farmId,
          farmName: client?.farmName || farmById(farmId)?.name || 'Sin rancho',
          people: [],
          balance: 0,
        });
      }
      const farm = farms.get(farmId);
      farm.people.push({ ...person, locationName: client?.locationName || '' });
      farm.balance += person.balance;
    }

    return [...farms.values()]
      .map((farm) => ({ ...farm, balance: Math.round(farm.balance * 100) / 100 }))
      .sort((a, b) => b.balance - a.balance);
  }

  function farmGroup(farm) {
    return h('div.stack.stack-3',
      h('button.row.row--between', {
        type: 'button',
        style: { width: '100%', padding: '2px 2px 0', textAlign: 'left' },
        onclick: () => farm.farmId && go(`/farms/${farm.farmId}`),
      },
        h('div.row',
          h('span.c-faint', icon('farm')),
          h('div',
            h('div.w-700', farm.farmName),
            h('div.t-xs.c-soft', plural(farm.people.length, 'cliente debe', 'clientes deben')))),
        h('div.row', { style: { gap: '4px' } },
          h('span.w-700', money(farm.balance, { round: true })),
          farm.farmId ? icon('chevronR', 'rowlink__chev') : null)),

      farm.people.map((person) => h('div.stack.stack-2',
        h('div.row.row--between', { style: { padding: '0 2px' } },
          h('div.row',
            avatar(person.clientName, { size: 'sm' }),
            h('div',
              h('div.w-650', person.clientName),
              person.locationName ? h('div.t-xs.c-soft', person.locationName) : null)),
          h('span.w-700', money(person.balance, { round: true }))),
        list(person.invoices.map(invoiceRow), { card: true }))));
  }

  function settledList() {
    if (!settled.length) {
      return emptyState({ icon: 'receipt', title: 'Sin pagos registrados', text: 'Los periodos saldados aparecerán aquí.' });
    }
    return h('div.stack.stack-3',
      sectionLabel('Últimas facturas pagadas'),
      list(settled.map((invoice) => itemRow({
        lead: avatar(invoice.clientName, { size: 'sm' }),
        title: invoice.clientName,
        meta: `${invoiceTitle(invoice)}`
          + `${isCharge(invoice) ? ' · deuda' : ` · ${number(invoice.meals)} comidas`}`
          + `${invoice.farmName ? ` · ${invoice.farmName}` : ''}`,
        end: [
          h('span.w-700', money(invoice.amount, { round: true })),
          badge('Pagado', 'ok'),
        ],
        onClick: () => go(`/invoices/${invoice.id}`),
      })), { card: true }));
  }

  function invoiceRow(invoice) {
    const status = invoiceStatus(invoice, today());
    const balance = balanceOf(invoice);
    const days = humanDelta(daysBetween(today(), invoice.dueDate));

    return itemRow({
      title: invoiceTitle(invoice),
      meta: `${status === 'overdue' ? 'Venció' : 'Vence'} ${days} · ${moneyFull(invoice.amount)}`
        + `${isCharge(invoice) ? ' · deuda agregada' : ''}`,
      end: [
        h('span.w-700', money(balance, { round: true })),
        badge(STATUS_LABEL[status], STATUS_TONE[status]),
      ],
      onClick: () => go(`/invoices/${invoice.id}`),
    });
  }

  /* --- Closing a fortnight -------------------------------------------------- */

  /**
   * Issues every fortnight that has closed without a bill.
   *
   * The same calculation the roster's banner runs — one implementation, so the
   * two can never disagree about who owes what. It skips periods that already
   * have a bill, which is why the number it promises is the number it writes.
   */
  async function closeCycle() {
    let pending;
    try {
      pending = await pendingBilling(store.clients, store.pricing);
    } catch (error) {
      toastBad(errorText(error));
      return;
    }

    if (!pending.rows.length) {
      toastBad('No hay periodos cerrados sin facturar.');
      return;
    }

    const confirmed = await sheet({
      title: 'Cerrar periodos',
      build: (close) => h('div.stack.stack-4',
        alert(`Se emitirán ${plural(pending.rows.length, 'factura', 'facturas')} por `
          + `${moneyFull(pending.total)}, al precio de cada plan.`, 'brand', 'receipt'),
        pending.unpriced.length
          ? alert(`${plural(pending.unpriced.length, 'cliente queda', 'clientes quedan')} fuera por `
            + 'no tener precio en su plan. Revísalo en Ajustes → Precios.', 'warn')
          : null,
        card(defList(billingByFarm(pending.rows).map((farm) => defRow(
          farm.name,
          `${plural(farm.count, 'factura', 'facturas')} · ${money(farm.amount)}`,
        )))),
        h('p.t-xs.c-faint', 'Sólo se factura a los clientes activos, y sólo los periodos que '
          + 'todavía no tienen factura. Cada quien con el suyo: semanal o quincenal.'),
        button('Emitir facturas', { variant: 'primary', block: true, onClick: () => close(true) })),
    });
    if (!confirmed) return;

    try {
      const issued = await issueAll(pending.rows, { uid: session.uid, name: session.displayName });
      toastOk(`${plural(issued, 'factura emitida', 'facturas emitidas')}`);
    } catch (error) {
      toastBad(errorText(error));
    }
  }

  const unsubscribe = subscribe(draw);
  return () => { unsubscribe(); stopSettled(); };
}
