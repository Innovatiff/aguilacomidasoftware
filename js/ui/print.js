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
 * **A receipt is a record.** Everything printed comes off the receipt document
 * itself, frozen at the moment the money changed hands, so reprinting one from
 * three weeks ago prints what happened three weeks ago.
 */

import { h, mount } from '../lib/dom.js';
import { labelSheet, fitLabel, mountBag } from './label.js';
import { money } from '../lib/format.js';
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
 * What the paper says: who paid, how much, how, and where that leaves them.
 *
 * **Not** which fortnights it covered, and not when they pay next. Both used to
 * be printed, and both were read as promises: a slip saying "cubre 10–23 oct"
 * looks like food paid for in advance, and the kitchen never takes money in
 * advance — every payment is for the fortnight that has already been served.
 * The fortnights stay on the bills, where the kitchen can see them; the client
 * holds proof of the money.
 *
 * @param {object} receipt  the stored receipt document
 * @param {object} options
 * @param {object} options.business  header details from `config/business`
 * @param {boolean} [options.copy]   mark it as a reprint
 * @param {'client'|'store'} [options.forWhom]  which of the two copies this is
 */
export function receiptSheet(receipt, {
  business, copy = false, forWhom = null,
} = {}) {
  const reversal = Number(receipt.amount) < 0;
  const amount = Math.abs(Number(receipt.amount) || 0);
  const method = paymentMethodMeta(receipt.method).label;
  const stamp = toDate(receipt.at);

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
    // Which of the two this is, boxed, directly under the title: the moment
    // that matters is the one where somebody tears off two identical-looking
    // slips and has to hand over the right one without reading either.
    forWhom ? h('div.rcp__for', forWhom === 'store' ? 'PARA LA TIENDA' : 'PARA EL CLIENTE') : null,
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
 * Which paper the next job goes on.
 *
 * `@page` is the only way to tell a browser what size the sheet is, and it
 * cannot be aimed at part of a document — there is no selector for it, so a
 * stylesheet can hold exactly one answer and this app needs two: a 3-inch roll
 * for the counter, a Letter page for the owner's report. So the rule is written
 * at the moment of printing, by whichever printer is running, into a style tag
 * kept for the purpose. It sits after `print.css` in the head, so it wins.
 *
 * `data-paper` on the body is the same decision expressed where CSS *can* see
 * it, for the things that are ordinary rules — the body width, mainly, which on
 * the roll is pinned to 80mm and on a report must be left alone.
 */
const PAPER = {
  receipt: 'size: 80mm auto; margin: 0;',
  report: 'size: Letter; margin: 13mm 12mm 15mm;',
  // A die-cut label, edge to edge. Any margin here and the printer centres a
  // 96mm sticker on a 100mm label, which on a thermal unit means the first
  // line comes out on the gap between two of them.
  label: 'size: 100mm 50mm; margin: 0;',
};

function paper(kind) {
  document.body.dataset.paper = kind;
  let tag = document.getElementById('print-paper');
  if (!tag) {
    tag = h('style', { id: 'print-paper' });
    document.head.append(tag);
  }
  tag.textContent = `@media print { @page { ${PAPER[kind] || PAPER.receipt} } }`;
}

/**
 * Prints a document — the period report, today, and whatever else is a page
 * rather than a slip.
 *
 * Same mechanism as a receipt and deliberately so: no driver, no server, no
 * extension, and the browser's own dialog offers "Guardar como PDF" for free,
 * which is how this one mostly leaves the building.
 */
export function printSheet(node, { paper: kind = 'report' } = {}) {
  paper(kind);
  mount(printRoot(), node);
  requestAnimationFrame(() => window.print());
}

/** Receipts on their way to the printer, so a double tap is one receipt. */
const printing = new Map();

/** How long the store's slip waits after the client's has left the browser. */
const BETWEEN_SLIPS = 1200;

/** How long to wait for a browser that never says its print dialog closed. */
const GIVE_UP = 4000;

/**
 * Prints a payment: two receipts, one after the other — the client's, then the
 * store's — each one **its own print job**.
 *
 * Its own job, not a page of one job, because a page is not where the till's
 * printer cuts. Its driver cuts when a document ends, and skips the blank paper
 * at the bottom of a page, so the two copies sent as two pages came out as one
 * long strip: the store's header straight under the client's "gracias". Two
 * documents are two cuts.
 *
 * The client's comes first: it is the one being handed over, so it is in hand
 * while the store's is still printing. The store's is sent a moment after the
 * first has left the browser (`BETWEEN_SLIPS`) — Chrome with `--kiosk-printing`
 * prints without asking, and asked for a second job while it is still handing
 * over the first, it can drop it. On a machine without that flag each slip
 * opens the print dialog, one after the other: two confirmations for one
 * payment, which is the price of separate paper there.
 *
 * Each carries the whole header — a store copy that only makes sense next to the
 * client's is not a record of anything.
 *
 * @param {number} [options.copies]  2 for a payment, 1 for a printer test
 * @returns {Promise<void>} once the last slip has been sent
 */
export function printReceipt(receipt, options = {}) {
  const { copies = 2, ...sheet } = options;
  const wanted = Math.max(1, Math.min(3, Number(copies) || 1));
  const order = wanted === 1 ? [null] : ['client', 'store'];

  // A second tap while it is still coming out does not print it all again.
  const key = `${receipt.id || receipt.folio || ''}|${order.length}`;
  if (printing.has(key)) return printing.get(key);

  const job = slipBySlip(order.map((forWhom) => () => {
    paper('receipt');
    mount(printRoot(), h('div.rcp__copy', receiptSheet(receipt, { ...sheet, forWhom })));
  })).finally(() => printing.delete(key));
  printing.set(key, job);
  return job;
}

/**
 * Receipt jobs, one at a time, in order.
 *
 * They all print from the same corner of the page, so a payment printed while
 * the one before is between its two slips would put its own receipt there
 * before the other's store copy went out. Each waits for the last.
 */
let slips = Promise.resolve();

function slipBySlip(steps) {
  const run = slips.then(async () => {
    for (let i = 0; i < steps.length; i += 1) {
      if (i) await new Promise((resolve) => { setTimeout(resolve, BETWEEN_SLIPS); });
      steps[i]();
      // A frame, so the layout is done before the dialog freezes the page.
      await new Promise((resolve) => { requestAnimationFrame(resolve); });
      await printOne();
    }
  });
  slips = run.catch(() => {});
  return run;
}

/**
 * Sends what is in the print corner, and resolves once the browser is done
 * with it.
 *
 * Chrome does not come back from `print()` until the job has left its hands —
 * the dialog closed, or with `--kiosk-printing` the pages sent — and fires
 * `afterprint` on the way. A browser that comes back at once says so with
 * `afterprint` when its dialog closes. One that does neither is let go after a
 * few seconds, rather than holding the store's copy forever.
 */
function printOne() {
  return new Promise((resolve) => {
    let waiting = true;
    const done = () => {
      if (!waiting) return;
      waiting = false;
      window.removeEventListener('afterprint', done);
      resolve();
    };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, GIVE_UP);
  });
}

/**
 * Prints stickers in one job: a bag's, then a person's — one for each of their
 * containers.
 *
 * One job and not one per sticker. A label printer feeds one label per page,
 * so a job of three pages is three labels in a row; three jobs sent in a
 * second are three requests a browser printing without asking can drop one
 * of. And they come out in the order they go on: the bag first, then the
 * lids.
 *
 * The extra step over a receipt is the measuring: each sticker is mounted,
 * `fitLabel` shrinks its name until it stops wrapping and `fitBag` lays out
 * the bag's list, and only then is the printer asked for. That order is the
 * whole reason `#print-root` is parked off the screen instead of being
 * `display: none` — a subtree with no layout has no width to compare against.
 *
 * On a kitchen machine this runs with nobody pressing anything: Chrome started
 * with `--kiosk-printing` sends it straight to the default printer and shows
 * no dialog. Without that flag every job stops for a confirmation, which is
 * why the whole thing can be turned off in Empaque → Configurar rather than
 * being something the kitchen has to live with.
 *
 * @param {object}   stickers
 * @param {object}   [stickers.bag]     a bag's sticker (see `mountBag` in js/ui/label.js)
 * @param {object[]} [stickers.labels]  people's stickers, in order (see `labelSheet`)
 */
export function printStickers({ bag = null, labels = [] } = {}) {
  paper('label');
  const root = printRoot();
  if (bag) mountBag(root, bag);
  else mount(root);
  // Siblings of the bag's sheet, so `.lbl + .lbl` puts each on its own page.
  for (const spec of labels) {
    const sheet = labelSheet(spec);
    root.append(sheet);
    fitLabel(sheet);
  }
  if (!root.firstElementChild) return;
  requestAnimationFrame(() => window.print());
}

/** Clears the print area — called after printing so nothing lingers. */
export const clearPrint = () => mount(printRoot());
