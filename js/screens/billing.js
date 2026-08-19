/**
 * Cobranza — the money worklist.
 *
 * Sorted by deadline, not by name: the point of the screen is to answer "who do
 * I chase today". Closing a fortnight for every farm at once is one button,
 * because that is how the business actually bills — all farms on the same day.
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
import { store, subscribe, moneyStats, debtors } from '../data/store.js';
import { watchSettled, issueInvoice } from '../data/invoices.js';
import { billableMeals } from '../data/deliveries.js';
import {
  balanceOf, invoiceStatus, STATUS_LABEL, STATUS_TONE, periodFor, periodByIndex,
} from '../lib/billing.js';
import { formatRange, today, humanDelta, daysBetween } from '../lib/dates.js';
import { money, moneyFull, number } from '../lib/format.js';
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

    // Grouped by farm so a manager chasing one client sees the whole picture.
    const groups = debtors().map((group) => ({
      ...group,
      invoices: group.invoices.filter((invoice) => rows.includes(invoice)),
    })).filter((group) => group.invoices.length);

    return h('div.stack.stack-4',
      groups.map((group) => h('div.stack.stack-2',
        h('button.row.row--between', {
          type: 'button',
          style: { width: '100%', padding: '2px 2px 0', textAlign: 'left' },
          onclick: () => go(`/clients/${group.clientId}`),
        },
          h('div.row',
            avatar(group.clientName, { size: 'sm' }),
            h('div.w-650', group.clientName)),
          h('div.row', { style: { gap: '4px' } },
            h('span.w-700', money(group.balance, { round: true })),
            icon('chevronR', 'rowlink__chev'))),
        list(group.invoices.map(invoiceRow), { card: true }))));
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
        meta: `${formatRange(invoice.periodStart, invoice.periodEnd)} · ${number(invoice.meals)} comidas`,
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
   * Issues the just-closed cycle for every active farm, billing the meals that
   * were actually delivered. Shows the whole run for review before writing
   * anything: a wrong bill costs far more than a second tap.
   */
  async function closeCycle() {
    const clients = store.clients.filter((client) => client.status !== 'inactive');
    if (!clients.length) { toastBad('No hay ranchos registrados.'); return; }

    const preview = [];
    for (const client of clients) {
      const anchor = client.cycleAnchor || today();
      const current = periodFor(anchor, today());
      const closed = periodByIndex(anchor, current.index - 1);
      const meals = await billableMeals(client.id, closed);
      if (meals > 0) {
        preview.push({ client, period: closed, meals, amount: meals * (Number(client.pricePerMeal) || 0) });
      }
    }

    if (!preview.length) {
      toastBad('No hay entregas del periodo anterior para facturar.');
      return;
    }

    const total = preview.reduce((sum, row) => sum + row.amount, 0);

    const go_ahead = await sheet({
      title: 'Cerrar quincena',
      build: (close) => h('div.stack.stack-4',
        alert(`Se emitirán ${preview.length} facturas por ${moneyFull(total)}, contando sólo las comidas entregadas.`, 'brand', 'receipt'),
        card(defList(preview.map((row) => defRow(
          row.client.name,
          `${number(row.meals)} × ${money(row.client.pricePerMeal)} = ${money(row.amount)}`,
        )))),
        h('p.t-xs.c-faint', 'Si un periodo ya tenía factura, se actualiza sin borrar los pagos registrados.'),
        button('Emitir facturas', { variant: 'primary', block: true, onClick: () => close(true) })),
    });
    if (!go_ahead) return;

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

  const unsubscribe = subscribe(draw);
  return () => { unsubscribe(); stopSettled(); };
}
