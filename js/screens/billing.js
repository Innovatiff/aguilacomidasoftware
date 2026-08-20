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
import { watchSettled, issueInvoice } from '../data/invoices.js';
import { billableMealsInRange } from '../data/deliveries.js';
import {
  balanceOf, invoiceStatus, STATUS_LABEL, STATUS_TONE, periodFor, periodByIndex,
} from '../lib/billing.js';
import { formatRange, today, humanDelta, daysBetween } from '../lib/dates.js';
import { money, moneyFull, number, plural } from '../lib/format.js';
import { dbMessage } from '../firebase.js';

export function renderBilling(context) {
  let filter = context.query.filter || 'all';
  let settled = [];

  const stopSettled = watchSettled((rows) => { settled = rows; draw(); }, () => {});

  const draw = () => {
    screen({
      title: 'Cobranza',
      subtitle: `${money(moneyStats().outstanding, { round: true })} por cobrar`,
      tab: 'billing',
      actions: [topbarButton('receipt', { label: 'Cerrar quincena', onClick: closeCycle })],
      sunken: true,
      sticky: h('div.searchbar.searchbar--sunken',
        chips(filters(), filter, (value) => { filter = value; draw(); })),
      body: store.loaded.outstanding ? body() : skeletonRows(5),
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
        meta: `${formatRange(invoice.periodStart, invoice.periodEnd)} · ${number(invoice.meals)} comidas`
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
      title: formatRange(invoice.periodStart, invoice.periodEnd),
      meta: `${status === 'overdue' ? 'Venció' : 'Vence'} ${days} · ${number(invoice.meals)} comidas`,
      end: [
        h('span.w-700', money(balance, { round: true })),
        badge(STATUS_LABEL[status], STATUS_TONE[status]),
      ],
      onClick: () => go(`/invoices/${invoice.id}`),
    });
  }

  /* --- Closing a fortnight -------------------------------------------------- */

  /**
   * Issues the just-closed cycle for everybody, billing the meals actually
   * delivered. Shows the whole run for review before writing anything: a wrong
   * bill costs far more than a second tap.
   *
   * Workers at the same farm share a billing anchor, so the closed periods
   * collapse to a handful of distinct date ranges. Each one is read once and
   * bucketed by client id in memory.
   */
  async function closeCycle() {
    const clients = store.clients.filter((client) => client.status !== 'inactive');
    if (!clients.length) { toastBad('No hay clientes registrados.'); return; }

    let preview;
    try {
      preview = await previewClosedCycle(clients);
    } catch (error) {
      toastBad(dbMessage(error));
      return;
    }

    if (!preview.length) {
      toastBad('No hay entregas del periodo anterior para facturar.');
      return;
    }

    const total = preview.reduce((sum, row) => sum + row.amount, 0);
    const farms = new Map();
    for (const row of preview) {
      const name = row.client.farmName || 'Sin rancho';
      const entry = farms.get(name) || { count: 0, amount: 0 };
      farms.set(name, { count: entry.count + 1, amount: entry.amount + row.amount });
    }

    const confirmed = await sheet({
      title: 'Cerrar quincena',
      build: (close) => h('div.stack.stack-4',
        alert(`Se emitirán ${preview.length} facturas por ${moneyFull(total)}, contando sólo las `
          + 'comidas entregadas.', 'brand', 'receipt'),
        card(defList([...farms.entries()].map(([name, entry]) => defRow(
          name,
          `${plural(entry.count, 'factura', 'facturas')} · ${money(entry.amount)}`,
        )))),
        h('p.t-xs.c-faint', 'Si un periodo ya tenía factura, se actualiza sin borrar los pagos registrados.'),
        button('Emitir facturas', { variant: 'primary', block: true, onClick: () => close(true) })),
    });
    if (!confirmed) return;

    try {
      const author = { uid: session.uid, name: session.displayName };
      for (const row of preview) {
        await issueInvoice(row.client, row.period, row.meals, author);
      }
      toastOk(`${preview.length} ${preview.length === 1 ? 'factura emitida' : 'facturas emitidas'}`);
    } catch (error) {
      toastBad(dbMessage(error));
    }
  }

  /** What closing the fortnight would bill, per client, with delivered meals. */
  async function previewClosedCycle(clients) {
    const day = today();
    const periods = new Map();

    for (const client of clients) {
      const anchor = client.cycleAnchor || day;
      const closed = periodByIndex(anchor, periodFor(anchor, day).index - 1);
      const key = `${closed.start}_${closed.end}`;
      if (!periods.has(key)) periods.set(key, { period: closed, clients: [] });
      periods.get(key).clients.push(client);
    }

    const preview = [];
    for (const { period, clients: group } of periods.values()) {
      const meals = await billableMealsInRange(period.start, period.end);
      for (const client of group) {
        const count = meals.get(client.id) || 0;
        if (count > 0) {
          preview.push({
            client, period, meals: count,
            amount: count * (Number(client.pricePerMeal) || 0),
          });
        }
      }
    }
    return preview.sort((a, b) =>
      String(a.client.farmName).localeCompare(String(b.client.farmName), 'es')
      || String(a.client.name).localeCompare(String(b.client.name), 'es'));
  }

  const unsubscribe = subscribe(draw);
  return () => { unsubscribe(); stopSettled(); };
}
