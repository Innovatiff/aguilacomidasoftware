/**
 * A single fortnight's bill: what was delivered, what it costs, what came in,
 * and what is still owed — plus the two things staff do from here, take a
 * payment and send a reminder.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import {
  card, button, badge, defList, defRow, sectionLabel, list, itemRow,
  alert, loading, meter,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm, sheet } from '../ui/overlay.js';
import { openPaymentSheet } from '../ui/payment-sheet.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { watchInvoice, reversePayment } from '../data/invoices.js';
import { postSystemMessage } from '../data/chat.js';
import { balanceOf, invoiceStatus, STATUS_LABEL, STATUS_TONE } from '../lib/billing.js';
import {
  formatRange, formatDayLong, formatDay, today, humanDelta, daysBetween, formatStamp, dayKey,
} from '../lib/dates.js';
import { money, moneyFull, number, percent } from '../lib/format.js';
import { paymentMethodMeta } from '../lib/model.js';
import { toDate, dbMessage } from '../firebase.js';

export function renderInvoice(context) {
  const id = context.params.id;
  let invoice = null;
  let missing = false;

  const stop = watchInvoice(id, (row) => {
    invoice = row;
    missing = !row;
    draw();
  }, () => { missing = true; draw(); });

  function draw() {
    if (missing) {
      screen({
        title: 'Factura',
        backTo: '/billing',
        body: h('div.page__inner', alert('Esta factura ya no existe.', 'bad')),
      });
      return;
    }
    if (!invoice) {
      screen({ title: 'Factura', backTo: '/billing', body: loading() });
      return;
    }

    const status = invoiceStatus(invoice, today());
    screen({
      title: invoice.clientName || 'Factura',
      subtitle: formatRange(invoice.periodStart, invoice.periodEnd),
      backTo: '/billing',
      tab: 'billing',
      sunken: true,
      body: body(status),
    });
  }

  function body(status) {
    const balance = balanceOf(invoice);
    const paid = Number(invoice.paid) || 0;
    const amount = Number(invoice.amount) || 0;
    const late = daysBetween(today(), invoice.dueDate);

    return h('div.page__inner.stack.stack-4',

      /* Headline */
      card(h('div.stack.stack-4',
        h('div.row.row--between',
          h('div',
            h('div.t-xs.upper.c-faint.w-700', balance > 0 ? 'Saldo pendiente' : 'Total del periodo'),
            h('div.t-3xl.w-700', { style: { color: balance > 0 ? (status === 'overdue' ? 'var(--bad-600)' : 'var(--ink-900)') : 'var(--ok-600)' } },
              money(balance > 0 ? balance : amount))),
          badge(STATUS_LABEL[status], STATUS_TONE[status])),

        h('div.stack.stack-2',
          meter(percent(paid, amount), { tone: balance <= 0 ? 'ok' : status === 'overdue' ? 'bad' : null }),
          h('div.row.row--between.t-sm.c-soft',
            h('span', `Pagado ${money(paid)}`),
            h('span', `de ${money(amount)}`))),

        status === 'overdue'
          ? alert(`Venció ${humanDelta(late)} — ${formatDayLong(invoice.dueDate)}.`, 'bad')
          : balance > 0
            ? alert(`Vence ${humanDelta(late)} — ${formatDayLong(invoice.dueDate)}.`, late <= 2 ? 'warn' : 'info')
            : alert(`Saldado${invoice.paidAt ? ` el ${formatDay(dayOf(invoice.paidAt))}` : ''}.`, 'ok'),

        balance > 0
          ? h('div.stack.stack-2',
              button('Registrar pago', {
                variant: 'primary', block: true, icon: 'wallet',
                onClick: async () => { await openPaymentSheet(invoice, author()); },
              }),
              button('Enviar recordatorio', {
                variant: 'ghost', block: true, icon: 'chat',
                onClick: sendReminder,
              }))
          : button('Ver el rancho', {
              variant: 'ghost', block: true, icon: 'users',
              onClick: () => go(`/clients/${invoice.clientId}`),
            }))),

      /* Breakdown */
      sectionLabel('Desglose'),
      card(defList([
        defRow('Rancho', invoice.clientName),
        defRow('Periodo', `${formatDay(invoice.periodStart)} – ${formatDay(invoice.periodEnd)}`),
        defRow('Comidas entregadas', number(invoice.meals)),
        defRow('Precio por comida', money(invoice.pricePerMeal)),
        defRow('Fecha límite de pago', formatDayLong(invoice.dueDate)),
        defRow('Total', moneyFull(amount), { total: true }),
      ])),

      /* Payments */
      sectionLabel('Pagos recibidos'),
      (invoice.payments || []).length
        ? list((invoice.payments || []).map(paymentRow), { card: true })
        : card(h('p.t-sm.c-soft.center', 'Todavía no se ha registrado ningún pago.')),

      invoice.issuedByName
        ? h('p.t-xs.c-faint.center', `Emitida por ${invoice.issuedByName}`)
        : null);
  }

  function paymentRow(payment, index) {
    const meta = paymentMethodMeta(payment.method);
    return itemRow({
      lead: h('div.avatar.avatar--sm', { style: { background: 'var(--ok-50)', color: 'var(--ok-600)' } }, icon(meta.icon)),
      title: money(payment.amount),
      meta: [meta.label, payment.date ? formatDay(payment.date) : null, payment.reference]
        .filter(Boolean).join(' · '),
      end: h('span.t-xs.c-faint', payment.byName || formatStamp(toDate(payment.at))),
      chevron: false,
      onClick: () => paymentOptions(payment, index),
    });
  }

  async function paymentOptions(payment, index) {
    await sheet({
      title: `Pago de ${money(payment.amount)}`,
      build: (close) => h('div.stack.stack-4',
        card(defList([
          defRow('Monto', money(payment.amount)),
          defRow('Forma', paymentMethodMeta(payment.method).label),
          defRow('Fecha', payment.date ? formatDayLong(payment.date) : '—'),
          payment.reference ? defRow('Referencia', payment.reference) : null,
          payment.byName ? defRow('Registró', payment.byName) : null,
          payment.note ? defRow('Nota', payment.note) : null,
        ].filter(Boolean))),
        button('Eliminar este pago', {
          variant: 'danger-soft', block: true, icon: 'ban',
          onClick: async () => {
            close();
            if (!await confirm({
              title: 'Eliminar pago',
              message: `Se restará ${money(payment.amount)} de lo cobrado y la factura volverá a quedar pendiente.`,
              confirmLabel: 'Eliminar pago', tone: 'danger', icon: 'alert',
            })) return;
            try {
              await reversePayment(id, index);
              toastOk('Pago eliminado');
            } catch (error) { toastBad(error?.message || dbMessage(error)); }
          },
        })),
    });
  }

  /** A reminder is a message in the farm's own thread, not a separate channel. */
  async function sendReminder() {
    const balance = balanceOf(invoice);
    const late = daysBetween(today(), invoice.dueDate);
    const text = late < 0
      ? `Recordatorio: el periodo ${formatRange(invoice.periodStart, invoice.periodEnd)} tiene un saldo de ${money(balance)} que venció el ${formatDay(invoice.dueDate)}. Si ya realizaron el pago, avísennos por aquí.`
      : `Recordatorio: el periodo ${formatRange(invoice.periodStart, invoice.periodEnd)} suma ${money(balance)} y vence el ${formatDay(invoice.dueDate)}. Cualquier duda sobre el pago, escríbannos por aquí.`;

    if (!await confirm({
      title: 'Enviar recordatorio',
      message: text,
      confirmLabel: 'Enviar mensaje', icon: 'chat',
    })) return;

    try {
      await postSystemMessage(invoice.clientId, text, {
        meta: { kind: 'payment_reminder', invoiceId: id, balance },
        notify: true,
      });
      toastOk('Recordatorio enviado');
      go(`/chat/${invoice.clientId}`);
    } catch (error) { toastBad(dbMessage(error)); }
  }

  const author = () => ({ uid: session.uid, name: session.displayName });

  draw();
  return stop;
}

/** Firestore Timestamp -> day key, for "saldado el …". */
const dayOf = (value) => {
  const date = toDate(value);
  return date ? dayKey(date) : today();
};
