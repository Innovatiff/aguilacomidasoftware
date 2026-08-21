/**
 * A receipt, as the kitchen sees it.
 *
 * The same document the client sees in their app, so a dispute at the counter
 * is settled by both people looking at the same folio. It says what was taken,
 * which fortnights it covered, and what was left owing afterwards — the three
 * things anybody actually asks.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import {
  card, button, badge, defList, defRow, sectionLabel, list, itemRow, alert, loading,
} from '../ui/kit.js';
import { go } from '../lib/router.js';
import { watchReceipt } from '../data/receipts.js';
import { money } from '../lib/format.js';
import { formatRange, formatStamp, formatDayLong } from '../lib/dates.js';
import { paymentMethodMeta } from '../lib/model.js';
import { toDate } from '../firebase.js';

export function renderReceipt(context) {
  const id = context.params.id;
  let receipt = null;
  let missing = false;

  const stop = watchReceipt(id, (row) => {
    receipt = row;
    missing = !row;
    draw();
  }, () => { missing = true; draw(); });

  function draw() {
    if (missing) {
      screen({
        title: 'Recibo', backTo: '/cobrar', tab: 'billing',
        body: h('div.page__inner', alert('Este recibo ya no existe.', 'bad')),
      });
      return;
    }
    if (!receipt) {
      screen({ title: 'Recibo', backTo: '/cobrar', tab: 'billing', body: loading() });
      return;
    }

    screen({
      title: receipt.folio || 'Recibo',
      subtitle: receipt.clientName,
      backTo: '/cobrar',
      tab: 'billing',
      sunken: true,
      body: body(),
    });
  }

  function body() {
    const reversal = Number(receipt.amount) < 0;

    return h('div.page__inner.stack.stack-4',
      h('div.receipt',
        h('div.receipt__mark', icon(reversal ? 'refresh' : 'check')),
        h('div.receipt__amount', money(Math.abs(receipt.amount))),
        h('div.receipt__what', reversal ? 'Pago cancelado' : 'Pago recibido'),
        h('div.receipt__folio', receipt.folio || '')),

      card(defList([
        defRow('Cliente', receipt.clientName),
        defRow('Dónde', [receipt.farmName, receipt.locationName].filter(Boolean).join(' · ') || '—'),
        defRow('Forma de pago', paymentMethodMeta(receipt.method).label),
        receipt.reference ? defRow('Referencia', receipt.reference) : null,
        defRow('Fecha', formatDayLong(receipt.date)),
        defRow('Recibió', receipt.takenByName || '—'),
        defRow('Registrado', formatStamp(toDate(receipt.at)) || '—'),
      ].filter(Boolean))),

      h('div.stack.stack-3',
        sectionLabel('Qué cubre'),
        list((receipt.applied || []).map((row) => itemRow({
          lead: h('span.item__ico', icon('receipt')),
          title: formatRange(row.periodStart, row.periodEnd),
          meta: 'Quincena',
          end: h('span.w-700', money(row.amount)),
          onClick: () => go(`/invoices/${row.invoiceId}`),
        })), { card: true })),

      card(h('div.row.row--between',
        h('div.w-650', 'Saldo después de este pago'),
        h('div.row', { style: { gap: '8px' } },
          h('span.t-lg.w-700', money(receipt.balanceAfter || 0)),
          (receipt.balanceAfter || 0) > 0.005
            ? badge('Debe', 'warn')
            : badge('Al corriente', 'ok')))),

      receipt.note ? alert(receipt.note, 'info') : null,

      h('div.stack.stack-2',
        button('Ver la ficha del cliente', {
          variant: 'ghost', block: true, icon: 'users',
          onClick: () => go(`/clients/${receipt.clientId}`),
        }),
        button('Cobrar a alguien más', {
          variant: 'primary', block: true, icon: 'cash',
          onClick: () => go('/cobrar'),
        })),

      h('p.t-xs.c-faint.center',
        `Este recibo también está en la app de ${receipt.clientName}. `
        + 'No se puede editar ni borrar; una corrección se registra como cancelación.'));
  }

  return () => stop?.();
}
