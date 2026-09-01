/**
 * Printing a receipt on the counter's thermal printer.
 *
 * The printer is an ordinary Windows printer as far as the browser is
 * concerned, so this needs no driver, no server and no extension: the receipt
 * is built as plain HTML into a hidden corner of the page, `css/print.css`
 * hides everything else on paper, and `window.print()` sends it. That is the
 * whole mechanism, and it is the only one available to a static app with no
 * backend — which is a virtue here rather than a compromise, because it means
 * a receipt prints the same whether the internet is up or not.
 *
 * The layout is 72mm wide in a monospace face, which is what fits on 80mm
 * paper once the printer's own margins are taken off. Everything is set in
 * characters rather than pixels: two columns that align by padding, rules made
 * of dashes, nothing that depends on a font the store's machine may not have.
 *
 * **A receipt is a record.** Almost everything printed comes off the receipt
 * document itself, frozen at the moment the money changed hands, so reprinting
 * one from three weeks ago prints what happened three weeks ago. The only live
 * figure is the next collection day, which is forward-looking information the
 * client is being handed, not a claim about the past — and it is labelled as
 * such.
 */

import { h, mount } from '../lib/dom.js';
import { money } from '../lib/format.js';
import { appliedTitle } from '../lib/billing.js';
import { paymentMethodMeta } from '../lib/model.js';
import { parseDay } from '../lib/dates.js';
import { toDate } from '../firebase.js';

/* --- Building blocks -------------------------------------------------------- */

const line = (text) => h('div.rcp__line', text);
const mid = (text) => h('div.rcp__mid', text);
const rule = () => h('div.rcp__rule');

/** A key on the left and a figure on the right, the way a till prints them. */
const pair = (k, v, className = '') =>
  h(`div.rcp__pair${className}`, h('span', k), h('span.rcp__v', v));

/* --- The receipt ------------------------------------------------------------ */

/**
 * @param {object} receipt  the stored receipt document
 * @param {object} options
 * @param {object} options.business  header details from `config/business`
 * @param {object} [options.client]  live client, only for the next pay day
 * @param {string} [options.nextPay] pre-formatted next collection day
 * @param {boolean} [options.copy]   mark it as a reprint
 */
export function receiptSheet(receipt, { business, nextPay, copy = false } = {}) {
  const reversal = Number(receipt.amount) < 0;
  const amount = Math.abs(Number(receipt.amount) || 0);
  const method = paymentMethodMeta(receipt.method).label;
  const stamp = toDate(receipt.at);
  const covers = receipt.applied || [];

  return h('div.rcp',
    /* Header — the store, as its own till prints it. */
    h('div.rcp__name', business.name),
    business.address ? mid(business.address) : null,
    business.city ? mid(business.city) : null,
    business.phone ? mid(`TEL: ${business.phone}`) : null,
    business.email ? mid(business.email) : null,

    rule(),
    h('div.rcp__title', reversal ? 'CANCELACION DE PAGO' : 'RECIBO DE PAGO'),
    copy ? mid('- COPIA -') : null,
    rule(),

    /* Which receipt this is, and who took it. */
    line(`FOLIO: ${receipt.folio || receipt.id || ''}`),
    line(`FECHA: ${stampDay(receipt.date)}${stamp ? `  ${clock(stamp)}` : ''}`),
    receipt.takenByName ? line(`ATENDIO: ${receipt.takenByName}`) : null,
    receipt.reference ? line(`REF: ${receipt.reference}`) : null,

    rule(),

    /* Who paid. */
    line('CLIENTE'),
    h('div.rcp__who', receipt.clientName || '—'),
    [receipt.farmName, receipt.locationName].filter(Boolean).length
      ? line([receipt.farmName, receipt.locationName].filter(Boolean).join(' - '))
      : null,

    rule(),

    /* What the money went to. A notebook payment settled no fortnight, and
       says so rather than printing an empty list. */
    covers.length
      ? h('div',
          line(reversal ? 'SE REGRESA' : 'CUBRE'),
          covers.map((row) => pair(
            short(appliedTitle(row)),
            money(Math.abs(Number(row.amount) || 0)))))
      : line(receipt.fromNotebook
        ? 'PAGO ANTERIOR AL SISTEMA'
        : 'SIN QUINCENA APLICADA'),

    rule(),

    /* The money itself. */
    pair('FORMA', method.toUpperCase()),
    pair(reversal ? 'SE REGRESA' : 'TOTAL', money(amount), '.rcp__pair--total'),

    rule(),

    /* Where that leaves them. */
    reversal
      ? line(receipt.reversalOfFolio
        ? `CANCELA EL RECIBO ${receipt.reversalOfFolio}`
        : 'CANCELACION DE UN PAGO')
      : (Number(receipt.balanceAfter) || 0) > 0.005
        ? pair('QUEDA DEBIENDO', money(receipt.balanceAfter), '.rcp__pair--total')
        : h('div.rcp__ok', 'QUEDA AL CORRIENTE'),

    !reversal && nextPay ? line(`PROXIMO PAGO: ${nextPay}`) : null,

    rule(),
    mid(business.footer || 'GRACIAS'),
    mid(business.name),
    h('div.rcp__tail', ' '));
}

/**
 * "01 SEP 2026" — short enough for the paper, and unreadable as anything else.
 *
 * The store's own till prints 09-01-2026, which is the first of September to
 * half the world and the ninth of January to the other half. On a receipt
 * somebody may bring back three weeks later to argue about, the month is
 * spelled.
 */
const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
  'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function stampDay(key) {
  const d = parseDay(key);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** 24-hour clock, the way the store's own receipts print it. */
function clock(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Keeps a long fortnight label from wrapping the amount onto its own line. */
const short = (text) => {
  const flat = String(text || '').toUpperCase().replace(/[–—]/g, '-');
  return flat.length > 22 ? `${flat.slice(0, 21)}…` : flat;
};

/* --- Sending it to the printer ---------------------------------------------- */

/**
 * The corner of the document the printer is pointed at.
 *
 * One node, reused: creating a fresh one per print would leave a pile of
 * detached receipts behind on a machine that prints two hundred a fortnight.
 */
function printRoot() {
  let root = document.getElementById('print-root');
  if (!root) {
    root = h('div', { id: 'print-root' });
    document.body.append(root);
  }
  return root;
}

/**
 * Prints one receipt.
 *
 * The browser's print dialog is a modal the operator has to confirm, which on
 * a counter is one click per receipt. Chrome started with `--kiosk-printing`
 * skips it and prints straight to the default printer; that is a shortcut on
 * the store's machine, not something this code can decide.
 */
export function printReceipt(receipt, options = {}) {
  mount(printRoot(), receiptSheet(receipt, options));
  // A frame, so the layout is done before the dialog freezes the page.
  requestAnimationFrame(() => window.print());
}

/** Clears the print area — called after printing so nothing lingers. */
export const clearPrint = () => mount(printRoot());
