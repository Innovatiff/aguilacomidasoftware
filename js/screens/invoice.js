/**
 * A single fortnight's bill: what it costs, what was delivered for it, what
 * came in, and what is still owed — plus the two things staff do from here,
 * take a payment and send a reminder.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import {
  card, button, badge, defList, defRow, sectionLabel, list, itemRow,
  alert, loading, meter, chargeRows, field, input, moneyInput,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm, sheet } from '../ui/overlay.js';
import { openChargeSheet } from '../ui/charge-sheet.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import {
  watchInvoice, reversePayment, voidReceipt, voidCharge, correctAmount,
} from '../data/invoices.js';
import { getReceipt } from '../data/receipts.js';
import { store, clientById, invoicesFor } from '../data/store.js';
import { postSystemMessage } from '../data/chat.js';
import {
  balanceOf, invoiceStatus, isCharge, invoiceTitle, periodWord, round2,
  STATUS_LABEL, STATUS_TONE,
} from '../lib/billing.js';
import {
  formatDayLong, formatDay, today, humanDelta, daysBetween, formatStamp, dayKey, capitalize,
} from '../lib/dates.js';
import { money, moneyFull, number, percent } from '../lib/format.js';
import { paymentMethodMeta } from '../lib/model.js';
import { errorText, toDate } from '../firebase.js';

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
      subtitle: invoiceTitle(invoice),
      backTo: '/billing',
      tab: 'clients',
      sunken: true,
      body: body(status),
    });
  }

  function body(status) {
    const balance = balanceOf(invoice);
    const paid = Number(invoice.paid) || 0;
    const amount = Number(invoice.amount) || 0;
    const late = daysBetween(today(), invoice.dueDate);

    return h('div.page__inner.page__inner--flow.stack.stack-4',

      /* Headline */
      card(h('div.stack.stack-4',
        h('div.row.row--between',
          h('div',
            h('div.t-xs.upper.c-faint.w-700', balance > 0
              ? 'Saldo pendiente'
              : isCharge(invoice) ? 'Total de la deuda' : 'Total del periodo'),
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
              button('Cobrar', {
                variant: 'primary', block: true, icon: 'cash', onClick: charge,
              }),
              button('Enviar recordatorio', {
                variant: 'ghost', block: true, icon: 'chat',
                onClick: sendReminder,
              }))
          : button('Ver la ficha del cliente', {
              variant: 'ghost', block: true, icon: 'users',
              onClick: () => go(`/clients/${invoice.clientId}`),
            }))),

      /* Breakdown */
      sectionLabel('Desglose'),
      card(defList([
        defRow('Cliente', invoice.clientName),
        [invoice.farmName, invoice.locationName].filter(Boolean).length
          ? defRow('Dónde', [invoice.farmName, invoice.locationName].filter(Boolean).join(' · '))
          : null,

        // A hand-written debt has no fortnight behind it — no plan, no days, no
        // meals — so it says what it is instead of showing an arithmetic that
        // was never done.
        ...(isCharge(invoice)
          ? [
              defRow('Motivo', invoice.reason || 'Cargo'),
              defRow('Fecha', formatDayLong(invoice.periodStart)),
              defRow('Fecha límite de pago', formatDayLong(invoice.dueDate)),
              defRow('Deuda', moneyFull(amount), { total: true }),
            ]
          : [
              defRow('Periodo', `${formatDay(invoice.periodStart)} – ${formatDay(invoice.periodEnd)}`),

              // Straight off the bill, not recalculated: these are the numbers
              // it was issued with, and they must not move when the price list
              // does.
              ...(invoice.fromNotebook ? [] : chargeRows(invoice)),

              defRow('Comidas entregadas', number(invoice.meals)),
              defRow('Fecha límite de pago', formatDayLong(invoice.dueDate)),
              defRow(capitalize(periodWord(invoice)), moneyFull(amount), { total: true }),
            ]),
      ].filter(Boolean))),

      // Every correction this bill has had, oldest first. On the bill itself
      // rather than in a log somewhere: the number somebody is questioning is
      // right here, and so is the reason it moved.
      (invoice.corrections || []).length
        ? h('div.stack.stack-2',
            sectionLabel('Correcciones'),
            list((invoice.corrections || []).map(correctionRow), { card: true }))
        : null,

      button('Corregir el monto', {
        variant: 'ghost', block: true, icon: 'edit', onClick: fixAmount,
      }),

      isCharge(invoice)
        ? alert('Esta deuda se agregó a mano'
          + (invoice.issuedByName ? ` (${invoice.issuedByName})` : '')
          + ': no la generó un periodo de comida. Se cobra igual que cualquier otra.', 'info')
        : invoice.fromNotebook
          ? alert(`Esta ${periodWord(invoice)} viene del cuaderno: se registró al pasar al `
            + 'cliente al sistema, no la generó una ruta.', 'info')
          : null,

      // Only while nothing has been paid against it: after that the mistake is
      // in the payment, and cancelling that is what puts this back.
      isCharge(invoice)
        ? (paid > 0.005
            ? h('p.t-xs.c-faint.center', 'Para quitar esta deuda hay que cancelar primero el pago '
              + 'que se le aplicó.')
            : button('Quitar esta deuda', {
                variant: 'danger-soft', block: true, icon: 'ban', onClick: removeCharge,
              }))
        : null,

      /* Payments */
      sectionLabel('Pagos recibidos'),
      (invoice.payments || []).length
        ? list((invoice.payments || []).map(paymentRow), { card: true })
        : card(h('p.t-sm.c-soft.center', 'Todavía no se ha registrado ningún pago.')),

      invoice.issuedByName
        ? h('p.t-xs.c-faint.center', `Emitida por ${invoice.issuedByName}`)
        : null);
  }

  /** One line of the trail: what it was, what it became, and why. */
  function correctionRow(entry) {
    const down = Number(entry.to) < Number(entry.from);
    return itemRow({
      lead: h('div.avatar.avatar--sm', {
        style: down
          ? { background: 'var(--ok-50)', color: 'var(--ok-600)' }
          : { background: 'var(--warn-50)', color: 'var(--warn-600)' },
      }, icon('edit')),
      title: `${money(entry.from)} → ${money(entry.to)}`,
      meta: entry.note || 'Sin motivo',
      end: h('span.t-xs.c-faint',
        [entry.byName, entry.date ? formatDay(entry.date) : null].filter(Boolean).join(' · ')),
      chevron: false,
    });
  }

  /**
   * Changing this bill's amount.
   *
   * The whole point is the note, so the button stays dead until there is one —
   * a correction nobody can explain is worse than the wrong number, because at
   * least the wrong number gets questioned.
   */
  async function fixAmount() {
    const paidHere = round2(invoice.paid || 0);

    const result = await sheet({
      title: 'Corregir el monto',
      build: (close) => {
        let next = String(round2(invoice.amount || 0));
        let note = '';
        let busy = false;

        const save = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' });
        const after = h('div.t-sm.c-soft');

        const box = moneyInput({
          value: round2(invoice.amount || 0),
          autofocus: true,
          oninput: (event) => { next = event.target.value; repaint(); },
        });
        const noteBox = input({
          placeholder: 'Ej. se cobró al plan equivocado',
          maxlength: 90,
          oninput: (event) => { note = event.target.value; repaint(); },
        });

        function repaint() {
          const value = round2(Number(next) || 0);
          const moved = Math.abs(value - round2(invoice.amount || 0)) > 0.005;
          const tooLow = value < paidHere - 0.005;

          mount(save, icon('edit'), moved ? `Dejarla en ${money(value)}` : 'Corregir el monto');
          save.disabled = busy || !moved || !note.trim() || tooLow || value < 0;

          mount(after, tooLow
            ? `Ya pagó ${money(paidHere)} de esta cuenta. Para bajarla de ahí hay que `
              + 'cancelar primero el pago.'
            : moved
              ? `Queda debiendo ${money(round2(value - paidHere))} de esta cuenta.`
              : 'Escribe el monto correcto.');
        }

        const form = h('form.stack.stack-4', {
          onsubmit: async (event) => {
            event.preventDefault();
            if (busy) return;
            busy = true;
            save.disabled = true;
            mount(save, h('span.spinner.spinner--light'), 'Corrigiendo…');
            try {
              await correctAmount(
                { invoice, amount: round2(Number(next) || 0), note: note.trim() },
                { uid: session.uid, name: session.displayName });
              close(true);
            } catch (error) {
              busy = false;
              repaint();
              toastBad(errorText(error));
            }
          },
        },
        card(defList([
          defRow('Cuenta', invoiceTitle(invoice)),
          defRow('Dice ahora', moneyFull(invoice.amount)),
          paidHere > 0.005 ? defRow('Ya pagado', money(paidHere)) : null,
        ].filter(Boolean))),

        field({ label: 'Monto correcto', control: box }),
        field({
          label: '¿Por qué?',
          hint: 'Queda guardado en la cuenta, con tu nombre y la fecha.',
          control: noteBox,
        }),
        after,
        alert('No se borra nada: la cuenta guarda lo que decía antes y lo que dice ahora.',
          'info'),
        save);

        repaint();
        return form;
      },
    });

    if (result) toastOk('Monto corregido');
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
        payment.receiptId
          ? button('Ver el recibo', {
              variant: 'ghost', block: true, icon: 'receipt',
              onClick: () => { close(); go(`/receipts/${payment.receiptId}`); },
            })
          : null,
        button('Cancelar este pago', {
          variant: 'danger-soft', block: true, icon: 'ban',
          onClick: async () => { close(); await cancelPayment(payment, index); },
        })),
    });
  }

  /**
   * Cancelling from the bill.
   *
   * The payment may have covered more than this fortnight — one $280 handed
   * over can settle two — and undoing half of it would leave the client's
   * account wrong and two separate corrections on their app. So this cancels
   * the whole receipt, and says so plainly before doing it.
   */
  async function cancelPayment(payment, index) {
    const receipt = payment.receiptId ? await getReceipt(payment.receiptId) : null;
    const spread = (receipt?.applied || []).length > 1;

    const ok = await confirm({
      title: 'Cancelar pago',
      message: receipt
        ? `Se cancela el recibo ${receipt.folio} completo, de ${money(receipt.amount)}`
          + `${spread ? `, que cubría ${receipt.applied.length} quincenas` : ''}. `
          + 'Todo lo que pagó vuelve a quedar pendiente. El recibo no se borra: queda junto '
          + 'con su cancelación, y el cliente ve las dos cosas.'
        : `Se restará ${money(payment.amount)} de lo cobrado y la factura volverá a quedar `
          + 'pendiente.',
      confirmLabel: 'Sí, cancelar el pago',
      cancelLabel: 'No, dejarlo así',
      tone: 'danger',
      icon: 'ban',
    });
    if (!ok) return;

    try {
      if (receipt) await voidReceipt(receipt, author());
      else await reversePayment(id, index, author());
      toastOk('Pago cancelado');
    } catch (error) { toastBad(errorText(error)); }
  }

  /**
   * Undoing a debt that should not have been written.
   *
   * Nothing was handed to anybody and no receipt exists, so unlike a payment
   * there is nothing to preserve: it is removed outright rather than reversed.
   */
  async function removeCharge() {
    // Held onto now: the moment the document is deleted the listener sets
    // `invoice` to null, and the redirect below would have nowhere to go.
    const doomed = { ...invoice, id };

    const ok = await confirm({
      title: 'Quitar esta deuda',
      message: `Se quita el cargo de ${money(doomed.amount)} `
        + `(${doomed.reason || 'sin motivo'}) de la cuenta de ${doomed.clientName}. `
        + 'Su saldo baja por esa cantidad.',
      confirmLabel: 'Sí, quitarla',
      cancelLabel: 'No, dejarla',
      tone: 'danger',
      icon: 'ban',
    });
    if (!ok) return;

    try {
      await voidCharge(doomed);
      toastOk('Deuda quitada');
      go(`/clients/${doomed.clientId}`);
    } catch (error) { toastBad(errorText(error)); }
  }

  /**
   * Money in, from the bill. The sheet works from the *person*, so a payment
   * bigger than this fortnight rolls onto the next one instead of being
   * refused at the counter.
   */
  async function charge() {
    const client = clientById(invoice.clientId);
    if (!client) { toastBad('No se encontró la ficha de este cliente.'); return; }
    const receipt = await openChargeSheet({
      client,
      invoices: invoicesFor(client.id),
      pricing: store.pricing,
      author: author(),
    });
    if (receipt) go(`/receipts/${receipt.id}`);
  }

  /** A reminder is a message in the client's own thread, not a separate channel. */
  async function sendReminder() {
    const balance = balanceOf(invoice);
    const late = daysBetween(today(), invoice.dueDate);
    const what = isCharge(invoice)
      ? `el cargo “${invoiceTitle(invoice)}”`
      : `el periodo ${invoiceTitle(invoice)}`;
    const text = late < 0
      ? `Recordatorio: ${what} tiene un saldo de ${money(balance)} que venció el ${formatDay(invoice.dueDate)}. Si ya realizaron el pago, avísennos por aquí.`
      : `Recordatorio: ${what} suma ${money(balance)} y vence el ${formatDay(invoice.dueDate)}. Cualquier duda sobre el pago, escríbannos por aquí.`;

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
    } catch (error) { toastBad(errorText(error)); }
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
