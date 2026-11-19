/**
 * Changes of status the system is only guessing about — asked, one by one.
 *
 * Whether a fortnight was somebody's to pay is read off their record of
 * pauses. For the first change on that record the system has to assume what
 * they were *before* it, and until that was written down with every change it
 * assumed the opposite. Two things made that wrong, and both cost money:
 *
 *   - «Sigue», confirmed on somebody already active, was recorded as a change
 *     to active — so every fortnight before that day read as a pause and was
 *     left out of the bills;
 *   - somebody long in pause, marked «Ya no pide», read as active until that
 *     day — and was offered, or billed, fortnights they never ate.
 *
 * Nothing here can tell which of those happened and which was a real change:
 * the record looks the same. So the people it matters for today are listed
 * — worked out by the scan for unbilled fortnights, with their bills in hand
 * (`doubtOf` in js/data/cycles.js) — with what it is doing to their bills,
 * and the kitchen says how each one was. The answer is written on that change
 * (`setStatusBefore`) and nothing else is touched: no status, no bill.
 *
 * One thing the answer cannot put right by itself. A fortnight skipped as a
 * pause, with a later one paid since, is behind "paid up to" now: it will
 * never come up among the bills to issue. Answering «Ya estaba activo» asks
 * whether to bill it there and then, and only does on a yes.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import { alert, button, card } from './kit.js';
import { setStatusBefore, clearStatusBefore } from '../data/clients.js';
import { issueInvoice } from '../data/invoices.js';
import { statusDoubts } from '../data/store.js';
import { periodWord, periodWordPlural, DEFAULT_GRACE_DAYS } from '../lib/billing.js';
import { formatDay, formatRange, today, addDays } from '../lib/dates.js';
import { moneyFull } from '../lib/format.js';
import { errorText } from '../firebase.js';
import { t } from '../lib/i18n.js';

const STATUS_WORD = { active: 'Activo', paused: 'En pausa', inactive: 'Ya no pide' };

/** "la quincena del 4 – 17 nov" / "las quincenas del 21 oct – 3 nov y 4 – 17 nov" */
function periodsWords(client, periods) {
  const ranges = periods.map((period) => formatRange(period.start, period.end));
  const listed = ranges.length > 1
    ? `${ranges.slice(0, -1).join(', ')} ${t('y')} ${ranges[ranges.length - 1]}`
    : ranges[0];
  return periods.length === 1
    ? t('la {period} del {ranges}', { period: t(periodWord(client)), ranges: listed })
    : t('las {periods} del {ranges}', { periods: t(periodWordPlural(client)), ranges: listed });
}

const periodsOf = (rows) => rows.map((row) => row.period);
const totalOf = (rows) => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

/** What the guess is doing to this person's bills today, as sentences. */
function effects(doubt) {
  const { client } = doubt;
  if (doubt.guess === 'paused') {
    const said = [];
    if (doubt.left.length) {
      said.push(t('El sistema entiende que antes de ese día estaba en pausa, y por eso no le cobra {periods}.', {
        periods: periodsWords(client, periodsOf(doubt.left)),
      }));
    }
    if (doubt.jumped.length) {
      const periods = periodsWords(client, periodsOf(doubt.jumped));
      // Said whole when it is all there is to say, and as an "also" after the
      // sentence above.
      said.push(said.length
        ? t('Por lo mismo tampoco le cobró {periods}. Eso ya no sale solo en las facturas por emitir: después pagó otra y quedó como si estuviera pagado.', { periods })
        : t('El sistema entiende que antes de ese día estaba en pausa, y por eso no le cobró {periods}. Eso ya no sale solo en las facturas por emitir: después pagó otra y quedó como si estuviera pagado.', { periods }));
    }
    return said;
  }
  const parts = [];
  if (doubt.offered.length) {
    parts.push(t('propone cobrarle {periods}', { periods: periodsWords(client, periodsOf(doubt.offered)) }));
  }
  if (doubt.unpaid.length) {
    parts.push(t('le cuenta como deuda {periods}', { periods: periodsWords(client, doubt.unpaid) }));
  }
  return [t('El sistema entiende que antes de ese día estaba activo, y por eso {what}.', {
    what: parts.join(` ${t('y')} `),
  })];
}

/**
 * Asks whether the fortnights nobody was charged for get billed now.
 *
 * @returns {Promise<'bill'|'note'|undefined>} undefined when closed without
 *   choosing — nothing is written then, not even the answer
 */
function askAboutJumped(doubt) {
  const { client } = doubt;
  const said = {
    name: client.name,
    periods: periodsWords(client, periodsOf(doubt.jumped)),
    amount: moneyFull(totalOf(doubt.jumped)),
  };
  return sheet({
    title: t('Lo que quedó sin cobrar'),
    build: (close) => h('div.stack.stack-3',
      h('p.t-base.c-soft', { style: { lineHeight: '1.5' } },
        t('Se anota que {name} ya estaba activo. Además quedó sin cobrar {periods}: {amount}. Si lo facturas ahora, queda como deuda en su cuenta, para cobrarlo como cualquier otra.', said)),
      button(t('Anotar y facturar {amount}', said), {
        variant: 'primary', block: true, icon: 'receipt', onClick: () => close('bill'),
      }),
      button(t('Sólo anotar'), { variant: 'ghost', block: true, onClick: () => close('note') })),
  });
}

/** No internet: an answer is written in one go with what it replaces, and cannot wait in a queue. */
const offline = (error) => error?.code === 'unavailable'
  || (typeof navigator !== 'undefined' && navigator.onLine === false);

/** One at a time: a second press on «Revisar» while it opens is the same press. */
let reviewing = false;

/**
 * @param {object} options
 * @param {object} options.author  { uid, name } — on the bills it may issue
 * @returns {Promise<number>} how many times something was written
 */
export function openStatusReview({ author } = {}) {
  if (reviewing) return Promise.resolve(0);
  reviewing = true;
  let written = 0;

  return sheet({
    title: t('Cambios de estado por revisar'),
    build: (close) => {
      const host = h('div.stack.stack-4');
      // The list as it was when the sheet opened. A card stays where it is
      // once answered — it only changes what it says — so the next person's
      // buttons never slide under a finger that is pressing twice.
      const doubts = statusDoubts();
      const answers = new Map();      // client id → { was, issued }
      let busy = false;
      // A press right after an answer lands is the tail of the same press.
      let landedAt = 0;
      const tooSoon = () => performance.now() - landedAt < 700;

      async function write(work) {
        busy = true;
        close.hold(true);
        paint();
        try {
          await work();
          written += 1;
        } catch (error) {
          toastBad(offline(error)
            ? t('Sin conexión: esto no se guardó. Inténtalo otra vez cuando vuelva el internet.')
            : errorText(error));
        }
        busy = false;
        close.hold(false);
        landedAt = performance.now();
        paint();
      }

      async function answer(doubt, was) {
        if (busy || tooSoon() || answers.has(doubt.client.id)) return;
        // Fortnights that will not come up by themselves: asked about first,
        // and leaving that question unanswered leaves everything as it was.
        const billing = was === 'active' && doubt.jumped.length ? await askAboutJumped(doubt) : 'note';
        if (!billing || busy) return;

        await write(async () => {
          await setStatusBefore(doubt.client, doubt.entry, was);
          answers.set(doubt.client.id, { was, issued: 0 });
          if (billing === 'bill') {
            // Nobody was ever asked for it: its deadline counts from today,
            // not from a fortnight that ended weeks ago — or it would be born
            // "vencida", and its owner chased for something first heard of now.
            const dueDate = addDays(today(), Math.max(0, doubt.client.graceDays ?? DEFAULT_GRACE_DAYS));
            for (const row of doubt.jumped) {
              const bill = await issueInvoice(row.client, row.period, row.charge, row.meals, author,
                { fromStatusReview: true, dueDate });
              if (!bill.existed) answers.get(doubt.client.id).issued += 1;
            }
          }
          const { issued } = answers.get(doubt.client.id);
          toastOk(issued
            ? t('Anotado: {name} ya estaba activo. Se facturó lo que quedó sin cobrar.', { name: doubt.client.name })
            : was === 'active'
              ? t('Anotado: {name} ya estaba activo antes de ese día.', { name: doubt.client.name })
              : t('Anotado: {name} estaba en pausa antes de ese día.', { name: doubt.client.name }));
        });
      }

      /** Takes an answer back: the question is asked again. */
      async function undo(doubt) {
        const given = answers.get(doubt.client.id);
        if (busy || tooSoon() || !given) return;
        await write(async () => {
          await clearStatusBefore(doubt.client, doubt.entry, given.was);
          answers.delete(doubt.client.id);
        });
      }

      function row(doubt) {
        const { client, entry } = doubt;
        const given = answers.get(client.id);
        const said = {
          day: formatDay(entry.on),
          status: t(STATUS_WORD[entry.status] || entry.status),
        };
        return card(h('div.stack.stack-3',
          h('div.row.row--between',
            h('div', { style: { minWidth: 0 } },
              h('div.w-700', client.name),
              h('div.t-xs.c-soft', [client.farmName, client.locationName].filter(Boolean).join(' · '))),
            // Up here, away from where the two answers were: taking one back
            // is never where a second press lands. Not once a bill has been
            // written — that one is undone on their file, where it shows.
            given && !given.issued
              ? button(t('Deshacer'), {
                  variant: 'ghost', size: 'sm', disabled: busy, onClick: () => undo(doubt),
                })
              : null),

          h('p.t-sm', entry.by
            ? t('El {day}, {by} lo anotó como «{status}».', { ...said, by: entry.by })
            : t('El {day} se anotó como «{status}».', said)),

          given
            ? alert(given.issued
              ? t('Anotado: antes de ese día ya estaba activo. Se facturó lo que quedó sin cobrar; si no tocaba, corrige esa factura en su ficha.')
              : given.was === 'active'
                ? t('Anotado: antes de ese día ya estaba activo.')
                : t('Anotado: antes de ese día estaba en pausa.'), 'ok')
            : [
                effects(doubt).map((line) => h('p.t-sm.c-soft', line)),
                h('p.t-xs.c-faint', client.paidThrough
                  ? t('Lo último que tiene pagado llega al {day}.', { day: formatDay(client.paidThrough) })
                  : t('No tiene pagos registrados en el sistema.')),

                // Bills already written do not go by themselves: said before
                // the answer, so nobody takes «estaba en pausa» for the whole
                // fix.
                doubt.unpaid.length
                  ? alert(t('Si estaba en pausa, las facturas que ya tiene de esos días no se quitan solas: bájalas en su ficha con «Corregir saldo».'), 'warn')
                  : null,

                h('div.t-xs.upper.c-faint.w-700', t('Antes del {day}, ¿cómo estaba?', said)),
                h('div.btn-group',
                  // Neither one stands out: the system does not know which is
                  // true, and a button that looks like the answer gets
                  // pressed as one.
                  button(t('Ya estaba activo'), {
                    variant: 'soft', size: 'sm', icon: 'play',
                    disabled: busy, onClick: () => answer(doubt, 'active'),
                  }),
                  button(t('Estaba en pausa'), {
                    variant: 'soft', size: 'sm', icon: 'pause',
                    disabled: busy, onClick: () => answer(doubt, 'paused'),
                  })),
              ]));
      }

      function paint() {
        mount(host,
          h('p.t-sm.c-soft', t('Para decidir qué quincenas le tocan a cada quien, el sistema lee sus pausas. En estos casos no sabe cómo estaba la persona antes del primer cambio que tiene anotado, y lo que supuso está moviendo sus cobros. Dinos cómo estaba: sólo se anota eso. No se cambia su estado, y ninguna factura se toca sin preguntarte.')),
          doubts.length
            ? h('div.stack.stack-3', doubts.map(row))
            : alert(t('No queda ninguno por revisar.'), 'ok'),
          button(written ? t('Listo') : t('Cerrar'), {
            variant: 'ghost', block: true, disabled: busy, onClick: () => close(written),
          }));
      }

      paint();
      return host;
    },
  }).then((count) => Number(count) || written).finally(() => { reviewing = false; });
}
