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
import { watchReceipt, watchReversal } from '../data/receipts.js';
import { voidReceipt } from '../data/invoices.js';
import { printReceipt } from '../ui/print.js';
import { printContext } from '../data/store.js';
import { toastOk, toastBad, confirm } from '../ui/overlay.js';
import { session } from '../data/session.js';
import { errorText } from '../firebase.js';
import { money } from '../lib/format.js';
import { formatStamp, formatDayLong } from '../lib/dates.js';
import { appliedTitle } from '../lib/billing.js';
import { paymentMethodMeta } from '../lib/model.js';
import { toDate } from '../firebase.js';

export function renderReceipt(context) {
  const id = context.params.id;
  let receipt = null;
  let cancelled = null;      // the negative receipt written against this one
  let missing = false;

  const stops = [
    watchReceipt(id, (row) => {
      receipt = row;
      missing = !row;
      draw();
    }, () => { missing = true; draw(); }),

    watchReversal(id, (row) => { cancelled = row; draw(); }, () => {}),
  ];

  function draw() {
    if (missing) {
      screen({
        title: 'Recibo', backTo: '/cobrar', tab: 'clients',
        body: h('div.page__inner', alert('Este recibo ya no existe.', 'bad')),
      });
      return;
    }
    if (!receipt) {
      screen({ title: 'Recibo', backTo: '/cobrar', tab: 'clients', body: loading() });
      return;
    }

    screen({
      title: receipt.folio || 'Recibo',
      subtitle: receipt.clientName,
      backTo: '/cobrar',
      tab: 'clients',
      sunken: true,
      body: body(),
    });
  }

  function body() {
    const reversal = Number(receipt.amount) < 0;
    const isVoid = !!cancelled;

    return h('div.page__inner.page__inner--flow.stack.stack-4',
      h(`div.receipt.span-all${isVoid ? '.is-void' : ''}`,
        h('div.receipt__mark', icon(reversal || isVoid ? 'refresh' : 'check')),
        h('div.receipt__amount', money(Math.abs(receipt.amount))),
        h('div.receipt__what', reversal
          ? 'Pago cancelado'
          : isVoid ? 'Este pago fue cancelado' : 'Pago recibido'),
        h('div.receipt__folio', receipt.folio || '')),

      isVoid
        ? h('div.span-all',
            alert(`Se canceló el ${formatDayLong(cancelled.date)}`
              + `${cancelled.takenByName ? ` por ${cancelled.takenByName}` : ''}. `
              + `El dinero volvió a quedar pendiente y quedó registrado en ${cancelled.folio}.`,
            'bad'))
        : null,

      reversal && receipt.reversalOfFolio
        ? h('div.span-all', alert(`Cancela el recibo ${receipt.reversalOfFolio}.`, 'info'))
        : null,

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
          title: appliedTitle(row),
          meta: row.kind === 'charge' ? 'Deuda agregada' : 'Periodo de comida',
          end: h('span.w-700', money(row.amount)),
          onClick: () => go(`/invoices/${row.invoiceId}`),
        })), { card: true })),

      // Once cancelled this is a historical figure, not the client's balance —
      // saying "al corriente" about somebody who owes the money again would be
      // the most misleading line on the page.
      card(h('div.row.row--between',
        h('div.w-650', isVoid ? 'Saldo que quedó en su momento' : 'Saldo después de este pago'),
        h('div.row', { style: { gap: '8px' } },
          h('span.t-lg.w-700', money(receipt.balanceAfter || 0)),
          isVoid
            ? badge('Ya no aplica', 'muted')
            : (receipt.balanceAfter || 0) > 0.005
              ? badge('Debe', 'warn')
              : badge('Al corriente', 'ok')))),

      receipt.note ? alert(receipt.note, 'info') : null,

      h('div.stack.stack-2',
        // First, because this is what somebody opens an old receipt to do:
        // the client lost their copy, or the till was closed by accident
        // before it printed.
        button('Imprimir recibo', {
          variant: 'dark', block: true, icon: 'receipt',
          onClick: () => printReceipt(receipt, { ...printContext(receipt), copy: true }),
        }),
        button('Ver la ficha del cliente', {
          variant: 'ghost', block: true, icon: 'users',
          onClick: () => go(`/clients/${receipt.clientId}`),
        }),
        button('Cobrar a alguien más', {
          variant: 'primary', block: true, icon: 'cash',
          onClick: () => go('/cobrar'),
        }),

        // The mistake is made here, so the undo lives here too.
        !reversal && !isVoid
          ? button('Cancelar este pago', {
              variant: 'danger-soft', block: true, icon: 'ban', onClick: cancel,
            })
          : null),

      h('p.t-xs.c-faint.center',
        `Este recibo también está en la app de ${receipt.clientName}. `
        + 'No se puede editar ni borrar; una corrección se registra como cancelación.'));
  }

  /**
   * Undoing a payment taken by mistake.
   *
   * It says what will happen before it happens: how much goes back on the
   * account, which fortnights reopen, and that the client sees the correction
   * too. None of that is reversible-by-accident, so it asks first.
   */
  async function cancel() {
    const covered = (receipt.applied || []).map(appliedTitle).join(', ');

    const ok = await confirm({
      title: `Cancelar ${receipt.folio}`,
      message: `Se quitan ${money(receipt.amount)} de la cuenta de ${receipt.clientName} y `
        + `${covered ? `${covered} vuelve${(receipt.applied || []).length > 1 ? 'n' : ''} a quedar pendiente` : 'su saldo vuelve a subir'}. `
        + 'El recibo no se borra: queda registrado junto con su cancelación, y el cliente ve las dos cosas en su app.',
      confirmLabel: 'Sí, cancelar el pago',
      cancelLabel: 'No, dejarlo así',
      tone: 'danger',
      icon: 'ban',
    });
    if (!ok) return;

    try {
      const counter = await voidReceipt(receipt, { uid: session.uid, name: session.displayName });
      toastOk(`Pago cancelado · ${counter.folio}`);
    } catch (error) {
      toastBad(errorText(error));
    }
  }

  return () => stops.forEach((stop) => stop?.());
}
