/**
 * A receipt, as the kitchen sees it.
 *
 * The same document the client sees in their app, so a dispute at the counter
 * is settled by both people looking at the same folio. It says what was taken,
 * which fortnights it paid for, and what was left owing afterwards — the three
 * things anybody actually asks.
 *
 * Which fortnights is read off the bills holding the money, not off the
 * receipt: a payment that went to a fortnight before it was served is moved to
 * the one it was for (js/data/advance.js), and the receipt — which nobody may
 * rewrite — still names the first.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import {
  card, button, badge, defList, defRow, sectionLabel, list, itemRow, alert, loading,
} from '../ui/kit.js';
import { go } from '../lib/router.js';
import { watchReceipt, watchReversal } from '../data/receipts.js';
import { voidReceipt, spreadHeld, watchClientInvoices } from '../data/invoices.js';
import { printReceipt } from '../ui/print.js';
import { printContext, clientById, store } from '../data/store.js';
import { toastOk, toastBad, confirm } from '../ui/overlay.js';
import { session } from '../data/session.js';
import { errorText } from '../firebase.js';
import { money } from '../lib/format.js';
import { formatStamp, formatDayLong, formatRange } from '../lib/dates.js';
import { appliedTitle, paidFor as paidForBills } from '../lib/billing.js';
import { paymentMethodMeta } from '../lib/model.js';
import { toDate } from '../firebase.js';
import { t, tx, english } from '../lib/i18n.js';

export function renderReceipt(context) {
  const id = context.params.id;
  let receipt = null;
  let cancelled = null;      // the negative receipt written against this one
  let missing = false;
  let bills = null;          // the client's bills, once the receipt says whose
  let spreading = false;

  const stops = [
    watchReceipt(id, (row) => {
      receipt = row;
      missing = !row;
      if (row?.clientId && bills === null) {
        bills = [];
        stops.push(watchClientInvoices(row.clientId, (rows) => { bills = rows; draw(); }, () => {}));
      }
      draw();
    }, () => { missing = true; draw(); }),

    watchReversal(id, (row) => { cancelled = row; draw(); }, () => {}),
  ];

  function draw() {
    if (missing) {
      screen({
        title: t('Recibo'), backTo: '/cobrar', tab: 'clients',
        body: h('div.page__inner', alert(t('Este recibo ya no existe.'), 'bad')),
      });
      return;
    }
    if (!receipt) {
      screen({ title: t('Recibo'), backTo: '/cobrar', tab: 'clients', body: loading() });
      return;
    }

    screen({
      title: receipt.folio || t('Recibo'),
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
          ? t('Pago cancelado')
          : isVoid ? t('Este pago fue cancelado') : t('Pago recibido')),
        h('div.receipt__folio', receipt.folio || '')),

      isVoid
        ? h('div.span-all',
            alert(cancelled.takenByName
              ? t('Se canceló el {day} por {name}. El dinero volvió a quedar pendiente y quedó registrado en {folio}.',
                { day: formatDayLong(cancelled.date), name: cancelled.takenByName, folio: cancelled.folio })
              : t('Se canceló el {day}. El dinero volvió a quedar pendiente y quedó registrado en {folio}.',
                { day: formatDayLong(cancelled.date), folio: cancelled.folio }),
            'bad'))
        : null,

      reversal && receipt.reversalOfFolio
        ? h('div.span-all', alert(t('Cancela el recibo {folio}.', { folio: receipt.reversalOfFolio }), 'info'))
        : null,

      card(defList([
        defRow(t('Cliente'), receipt.clientName),
        defRow(t('Dónde'), [receipt.farmName, receipt.locationName].filter(Boolean).join(' · ') || '—'),
        defRow(t('Forma de pago'), paymentMethodMeta(receipt.method).label),
        receipt.reference ? defRow(t('Referencia'), receipt.reference) : null,
        defRow(t('Fecha'), formatDayLong(receipt.date)),
        defRow(t('Recibió'), receipt.takenByName || '—'),
        defRow(t('Registrado'), formatStamp(toDate(receipt.at)) || '—'),
      ].filter(Boolean))),

      paidFor().length
        ? h('div.stack.stack-3',
            sectionLabel(t('Es por')),
            list(paidFor().map((row) => itemRow({
              lead: h('span.item__ico', icon(row.kind === 'credit' ? 'wallet' : 'receipt')),
              title: rowTitle(row),
              meta: rowMeta(row),
              end: h('span.w-700', money(row.amount)),
              chevron: !!row.invoiceId,
              onClick: () => row.invoiceId && go(`/invoices/${row.invoiceId}`),
            })), { card: true }))
        : null,

      // Once cancelled this is a historical figure, not the client's balance —
      // saying "al corriente" about somebody who owes the money again would be
      // the most misleading line on the page.
      receipt.held && !isVoid
        ? alert(t('Este pago entró entero y quedó a cuenta, sin repartirse en sus quincenas, porque en ese momento no se pudo calcular lo que debía{reason}. El dinero está registrado. Con internet, «Repartir en sus quincenas» lo pone donde va.',
          { reason: heldReason(receipt.heldWhy) }), 'warn')
        : null,

      receipt.held ? null : card(h('div.row.row--between',
        h('div.w-650', isVoid ? t('Saldo que quedó en su momento') : t('Saldo después de este pago')),
        h('div.row', { style: { gap: '8px' } },
          h('span.t-lg.w-700', money(receipt.balanceAfter || 0)),
          isVoid
            ? badge(t('Ya no aplica'), 'muted')
            : (receipt.balanceAfter || 0) > 0.005
              ? badge(t('Debe'), 'warn')
              : badge(t('Al corriente'), 'ok')))),

      receipt.note ? alert(tx(receipt.note), 'info') : null,

      h('div.stack.stack-2',
        // First, because this is what somebody opens an old receipt to do:
        // the client lost their copy, or the till was closed by accident
        // before it printed.
        receipt.held && !isVoid && !reversal
          ? button(spreading ? t('Repartiendo…') : t('Repartir en sus quincenas'), {
              variant: 'primary', block: true, icon: 'refresh', disabled: spreading, onClick: spread,
            })
          : null,
        button(t('Imprimir recibo'), {
          variant: 'dark', block: true, icon: 'receipt',
          onClick: () => printReceipt(receipt, { ...printContext(receipt), copy: true }),
        }),
        button(t('Ver la ficha del cliente'), {
          variant: 'ghost', block: true, icon: 'users',
          onClick: () => go(`/clients/${receipt.clientId}`),
        }),
        button(t('Cobrar a alguien más'), {
          variant: 'primary', block: true, icon: 'cash',
          onClick: () => go('/cobrar'),
        }),

        // The mistake is made here, so the undo lives here too.
        !reversal && !isVoid
          ? button(t('Cancelar este pago'), {
              variant: 'danger-soft', block: true, icon: 'ban', onClick: cancel,
            })
          : null),

      h('p.t-xs.c-faint.center',
        t('Este recibo también está en la app de {name}. No se puede editar ni borrar; una corrección se registra como cancelación.',
          { name: receipt.clientName })));
  }

  /**
   * Undoing a payment taken by mistake.
   *
   * It says what will happen before it happens: how much goes back on the
   * account, which fortnights reopen, and that the client sees the correction
   * too. None of that is reversible-by-accident, so it asks first.
   */
  async function cancel() {
    // Money kept "a cuenta" had no fortnight to reopen.
    const rows = paidFor().filter((row) => row.kind !== 'credit');
    const covered = rows.map(rowTitle).join(', ');
    const said = { amount: money(receipt.amount), name: receipt.clientName, covered };

    const ok = await confirm({
      title: t('Cancelar {folio}', { folio: receipt.folio }),
      message: !covered
        ? t('Se quitan {amount} de la cuenta de {name} y su saldo vuelve a subir. El recibo no se borra: queda registrado junto con su cancelación, y el cliente ve las dos cosas en su app.', said)
        : rows.length > 1
          ? t('Se quitan {amount} de la cuenta de {name} y {covered} vuelven a quedar pendiente. El recibo no se borra: queda registrado junto con su cancelación, y el cliente ve las dos cosas en su app.', said)
          : t('Se quitan {amount} de la cuenta de {name} y {covered} vuelve a quedar pendiente. El recibo no se borra: queda registrado junto con su cancelación, y el cliente ve las dos cosas en su app.', said),
      confirmLabel: t('Sí, cancelar el pago'),
      cancelLabel: t('No, dejarlo así'),
      tone: 'danger',
      icon: 'ban',
    });
    if (!ok) return;

    try {
      const counter = await voidReceipt(receipt, { uid: session.uid, name: session.displayName });
      toastOk(t('Pago cancelado · {folio}', { folio: counter.folio }));
    } catch (error) {
      toastBad(errorText(error));
    }
  }

  /** A payment kept whole, put on the fortnights it was for — see `spreadHeld`. */
  async function spread() {
    if (spreading) return;
    const client = clientById(receipt.clientId);
    if (!client) { toastBad(t('Todavía no carga la lista de clientes. Intenta en un momento.')); return; }
    const ok = await confirm({
      title: t('Repartir en sus quincenas'),
      message: t('Los {amount} de {folio} se ponen en lo que {name} debía el {day}. Este recibo queda cancelado y sale uno nuevo, del mismo día, que dice qué pagó. El total del día no cambia.', {
        amount: money(receipt.amount), folio: receipt.folio, name: receipt.clientName, day: formatDayLong(receipt.date),
      }),
      confirmLabel: t('Repartir'),
      icon: 'refresh',
    });
    if (!ok) return;
    spreading = true;
    draw();
    try {
      const fresh = await spreadHeld(receipt, client, store.pricing,
        { uid: session.uid, name: session.displayName });
      toastOk(fresh.held
        ? t('Sigue sin poderse repartir · {folio}', { folio: fresh.folio })
        : t('Repartido · {folio}', { folio: fresh.folio }));
      go(`/receipts/${fresh.id}`);
    } catch (error) {
      spreading = false;
      draw();
      toastBad(errorText(error));
    }
  }

  /** What one line of "Es por" is: a debt, a fortnight, or money kept on account. */
  function rowMeta(row) {
    if (row.kind === 'charge') return t('Deuda agregada');
    if (row.kind === 'credit') return t('Sin quincena todavía: quedó a cuenta');
    if (row.moved) return t('Periodo de comida · se movió aquí, a la quincena que pagó');
    if (row.early || row.ahead) return t('Periodo de comida · a cuenta, antes de que terminara');
    return t('Periodo de comida');
  }

  /** Where this payment sits now — see `paidFor` in js/lib/billing.js. */
  function paidFor() {
    return paidForBills(receipt, bills || []);
  }

  return () => stops.forEach((stop) => stop?.());
}

/** Why a payment was kept whole, in words: " (sin internet)", or nothing. */
function heldReason(why) {
  const code = String(why || '');
  if (/unavailable|offline/i.test(code)) return ` (${t('sin internet')})`;
  if (/resource-exhausted|quota/i.test(code)) return ` (${t('la base de datos llegó a su límite del día')})`;
  return '';
}

/**
 * One line of "Es por", in the screen's language. The title a receipt stored
 * is Spanish, so in English a fortnight is named again from its own dates; a
 * debt keeps its reason.
 */
function rowTitle(row) {
  if (english() && row.kind !== 'charge' && row.kind !== 'credit' && row.periodStart && row.periodEnd) {
    return formatRange(row.periodStart, row.periodEnd);
  }
  return tx(appliedTitle(row));
}
