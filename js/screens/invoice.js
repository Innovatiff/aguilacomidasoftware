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
  balanceOf, invoiceStatus, isCharge, invoiceTitle, periodWord, round2, paymentsOf,
  STATUS_LABEL, STATUS_TONE,
} from '../lib/billing.js';
import {
  formatDayLong, formatDay, today, humanDelta, daysBetween, formatStamp, dayKey, capitalize,
} from '../lib/dates.js';
import { money, moneyFull, number, percent } from '../lib/format.js';
import { paymentMethodMeta } from '../lib/model.js';
import { errorText, toDate } from '../firebase.js';
import { t, tx, inSpanish } from '../lib/i18n.js';

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
        title: t('Factura'),
        backTo: '/billing',
        body: h('div.page__inner', alert(t('Esta factura ya no existe.'), 'bad')),
      });
      return;
    }
    if (!invoice) {
      screen({ title: t('Factura'), backTo: '/billing', body: loading() });
      return;
    }

    const status = invoiceStatus(invoice, today());
    screen({
      title: invoice.clientName || t('Factura'),
      subtitle: tx(invoiceTitle(invoice)),
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
              ? t('Saldo pendiente')
              : isCharge(invoice) ? t('Total de la deuda') : t('Total del periodo')),
            h('div.t-3xl.w-700', { style: { color: balance > 0 ? (status === 'overdue' ? 'var(--bad-600)' : 'var(--ink-900)') : 'var(--ok-600)' } },
              money(balance > 0 ? balance : amount))),
          badge(t(STATUS_LABEL[status]), STATUS_TONE[status])),

        h('div.stack.stack-2',
          meter(percent(paid, amount), { tone: balance <= 0 ? 'ok' : status === 'overdue' ? 'bad' : null }),
          h('div.row.row--between.t-sm.c-soft',
            h('span', t('Pagado {amount}', { amount: money(paid) })),
            h('span', t('de {amount}', { amount: money(amount) })))),

        status === 'overdue'
          ? alert(t('Venció {when} — {day}.', { when: humanDelta(late), day: formatDayLong(invoice.dueDate) }), 'bad')
          : balance > 0
            ? alert(t('Vence {when} — {day}.', { when: humanDelta(late), day: formatDayLong(invoice.dueDate) }),
              late <= 2 ? 'warn' : 'info')
            : alert(invoice.paidAt
              ? t('Saldado el {day}.', { day: formatDay(dayOf(invoice.paidAt)) })
              : t('Saldado.'), 'ok'),

        balance > 0
          ? h('div.stack.stack-2',
              button(t('Cobrar'), {
                variant: 'primary', block: true, icon: 'cash', onClick: charge,
              }),
              button(t('Enviar recordatorio'), {
                variant: 'ghost', block: true, icon: 'chat',
                onClick: sendReminder,
              }))
          : button(t('Ver la ficha del cliente'), {
              variant: 'ghost', block: true, icon: 'users',
              onClick: () => go(`/clients/${invoice.clientId}`),
            }))),

      /* Breakdown */
      sectionLabel(t('Desglose')),
      card(defList([
        defRow(t('Cliente'), invoice.clientName),
        [invoice.farmName, invoice.locationName].filter(Boolean).length
          ? defRow(t('Dónde'), [invoice.farmName, invoice.locationName].filter(Boolean).join(' · '))
          : null,

        // A hand-written debt has no fortnight behind it — no plan, no days, no
        // meals — so it says what it is instead of showing an arithmetic that
        // was never done.
        ...(isCharge(invoice)
          ? [
              defRow(t('Motivo'), invoice.reason || t('Cargo')),
              defRow(t('Fecha'), formatDayLong(invoice.periodStart)),
              defRow(t('Fecha límite de pago'), formatDayLong(invoice.dueDate)),
              defRow(t('Deuda'), moneyFull(amount), { total: true }),
            ]
          : [
              defRow(t('Periodo'), `${formatDay(invoice.periodStart)} – ${formatDay(invoice.periodEnd)}`),

              // Straight off the bill, not recalculated: these are the numbers
              // it was issued with, and they must not move when the price list
              // does.
              ...(invoice.fromNotebook ? [] : chargeRows(invoice)),

              defRow(t('Comidas entregadas'), number(invoice.meals)),
              defRow(t('Fecha límite de pago'), formatDayLong(invoice.dueDate)),
              defRow(capitalize(t(periodWord(invoice))), moneyFull(amount), { total: true }),
            ]),
      ].filter(Boolean))),

      // Every correction this bill has had, oldest first. On the bill itself
      // rather than in a log somewhere: the number somebody is questioning is
      // right here, and so is the reason it moved.
      (invoice.corrections || []).length
        ? h('div.stack.stack-2',
            sectionLabel(t('Correcciones')),
            list((invoice.corrections || []).map(correctionRow), { card: true }))
        : null,

      button(t('Corregir el monto'), {
        variant: 'ghost', block: true, icon: 'edit', onClick: fixAmount,
      }),

      isCharge(invoice)
        ? alert(invoice.issuedByName
          ? t('Esta deuda se agregó a mano ({name}): no la generó un periodo de comida. Se cobra igual que cualquier otra.',
            { name: invoice.issuedByName })
          : t('Esta deuda se agregó a mano: no la generó un periodo de comida. Se cobra igual que cualquier otra.'), 'info')
        : invoice.fromNotebook
          ? alert(t('Esta {period} viene del cuaderno: se registró al pasar al cliente al sistema, no la generó una ruta.',
            { period: t(periodWord(invoice)) }), 'info')
          : null,

      // Only while nothing has been paid against it: after that the mistake is
      // in the payment, and cancelling that is what puts this back.
      isCharge(invoice)
        ? (paid > 0.005
            ? h('p.t-xs.c-faint.center', t('Para quitar esta deuda hay que cancelar primero el pago que se le aplicó.'))
            : button(t('Quitar esta deuda'), {
                variant: 'danger-soft', block: true, icon: 'ban', onClick: removeCharge,
              }))
        : null,

      /* Payments */
      sectionLabel(t('Pagos recibidos')),
      paymentsOf(invoice).length
        ? list(paymentsOf(invoice).map(paymentRow), { card: true })
        : card(h('p.t-sm.c-soft.center', t('Todavía no se ha registrado ningún pago.'))),

      invoice.issuedByName
        ? h('p.t-xs.c-faint.center', t('Emitida por {name}', { name: invoice.issuedByName }))
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
      meta: entry.note || t('Sin motivo'),
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
      title: t('Corregir el monto'),
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
          placeholder: t('Ej. se cobró al plan equivocado'),
          maxlength: 90,
          oninput: (event) => { note = event.target.value; repaint(); },
        });

        function repaint() {
          const value = round2(Number(next) || 0);
          const moved = Math.abs(value - round2(invoice.amount || 0)) > 0.005;
          const tooLow = value < paidHere - 0.005;

          mount(save, icon('edit'), moved ? t('Dejarla en {amount}', { amount: money(value) }) : t('Corregir el monto'));
          save.disabled = busy || !moved || !note.trim() || tooLow || value < 0;

          mount(after, tooLow
            ? t('Ya pagó {amount} de esta cuenta. Para bajarla de ahí hay que cancelar primero el pago.',
              { amount: money(paidHere) })
            : moved
              ? t('Queda debiendo {amount} de esta cuenta.', { amount: money(round2(value - paidHere)) })
              : t('Escribe el monto correcto.'));
        }

        const form = h('form.stack.stack-4', {
          onsubmit: async (event) => {
            event.preventDefault();
            if (busy) return;
            busy = true;
            save.disabled = true;
            mount(save, h('span.spinner.spinner--light'), t('Corrigiendo…'));
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
          defRow(t('Cuenta'), tx(invoiceTitle(invoice))),
          defRow(t('Dice ahora'), moneyFull(invoice.amount)),
          paidHere > 0.005 ? defRow(t('Ya pagado'), money(paidHere)) : null,
        ].filter(Boolean))),

        field({ label: t('Monto correcto'), control: box }),
        field({
          label: t('¿Por qué?'),
          hint: t('Queda guardado en la cuenta, con tu nombre y la fecha.'),
          control: noteBox,
        }),
        after,
        alert(t('No se borra nada: la cuenta guarda lo que decía antes y lo que dice ahora.'),
          'info'),
        save);

        repaint();
        return form;
      },
    });

    if (result) toastOk(t('Monto corregido'));
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
      title: t('Pago de {amount}', { amount: money(payment.amount) }),
      build: (close) => h('div.stack.stack-4',
        card(defList([
          defRow(t('Monto'), money(payment.amount)),
          defRow(t('Forma'), paymentMethodMeta(payment.method).label),
          defRow(t('Fecha'), payment.date ? formatDayLong(payment.date) : '—'),
          payment.reference ? defRow(t('Referencia'), payment.reference) : null,
          payment.byName ? defRow(t('Registró'), payment.byName) : null,
          payment.note ? defRow(t('Nota'), payment.note) : null,
        ].filter(Boolean))),
        payment.receiptId
          ? button(t('Ver el recibo'), {
              variant: 'ghost', block: true, icon: 'receipt',
              onClick: () => { close(); go(`/receipts/${payment.receiptId}`); },
            })
          : null,
        button(t('Cancelar este pago'), {
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
    let receipt = null;
    try {
      receipt = payment.receiptId ? await getReceipt(payment.receiptId) : null;
    } catch (error) {
      // Without its receipt this would cancel a part of the payment and leave
      // the rest: better to say so than to do half.
      toastBad(errorText(error));
      return;
    }
    const spread = (receipt?.applied || []).length > 1;

    const ok = await confirm({
      title: t('Cancelar pago'),
      message: receipt
        ? (spread
            ? t('Se cancela el recibo {folio} completo, de {amount}, que cubría {count} quincenas. Todo lo que pagó vuelve a quedar pendiente. El recibo no se borra: queda junto con su cancelación, y el cliente ve las dos cosas.',
              { folio: receipt.folio, amount: money(receipt.amount), count: receipt.applied.length })
            : t('Se cancela el recibo {folio} completo, de {amount}. Todo lo que pagó vuelve a quedar pendiente. El recibo no se borra: queda junto con su cancelación, y el cliente ve las dos cosas.',
              { folio: receipt.folio, amount: money(receipt.amount) }))
        : t('Se restará {amount} de lo cobrado y la factura volverá a quedar pendiente.',
          { amount: money(payment.amount) }),
      confirmLabel: t('Sí, cancelar el pago'),
      cancelLabel: t('No, dejarlo así'),
      tone: 'danger',
      icon: 'ban',
    });
    if (!ok) return;

    try {
      if (receipt) await voidReceipt(receipt, author());
      else await reversePayment(id, index, author());
      toastOk(t('Pago cancelado'));
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
      title: t('Quitar esta deuda'),
      message: t('Se quita el cargo de {amount} ({reason}) de la cuenta de {name}. Su saldo baja por esa cantidad.', {
        amount: money(doomed.amount), reason: doomed.reason || t('sin motivo'), name: doomed.clientName,
      }),
      confirmLabel: t('Sí, quitarla'),
      cancelLabel: t('No, dejarla'),
      tone: 'danger',
      icon: 'ban',
    });
    if (!ok) return;

    try {
      await voidCharge(doomed);
      toastOk(t('Deuda quitada'));
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
    if (!client) { toastBad(t('No se encontró la ficha de este cliente.')); return; }
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
    const words = () => {
      const what = isCharge(invoice)
        ? t('el cargo “{title}”', { title: invoiceTitle(invoice) })
        : t('el periodo {title}', { title: invoiceTitle(invoice) });
      const said = { what, amount: money(balance), day: formatDay(invoice.dueDate) };
      return late < 0
        ? t('Recordatorio: {what} tiene un saldo de {amount} que venció el {day}. Si ya realizaron el pago, avísennos por aquí.', said)
        : t('Recordatorio: {what} suma {amount} y vence el {day}. Cualquier duda sobre el pago, escríbannos por aquí.', said);
    };
    // Sent in Spanish, to the client's app; shown here in the screen's language.
    const text = inSpanish(words);

    if (!await confirm({
      title: t('Enviar recordatorio'),
      message: words(),
      confirmLabel: t('Enviar mensaje'), icon: 'chat',
    })) return;

    try {
      await postSystemMessage(invoice.clientId, text, {
        meta: { kind: 'payment_reminder', invoiceId: id, balance },
        notify: true,
      });
      toastOk(t('Recordatorio enviado'));
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
