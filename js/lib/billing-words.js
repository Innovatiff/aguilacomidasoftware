/**
 * The words of js/lib/billing.js, in the screen's language.
 *
 * billing.js is the same file, byte for byte, in the clients' app — which is
 * Spanish only — so its words stay Spanish there and are put into English
 * here. Every Spanish string it hands back is either looked up as it is
 * (`t(periodWord(client))`, `t(STATUS_LABEL[status])`, `tx(invoiceTitle(bill))`)
 * or said again below where it is a sentence.
 */

import { t } from './i18n.js';
import { plural } from './format.js';
import { PAY_WEEKDAYS, PAY_EVERY, isCharge } from './billing.js';
import { WEEKDAYS } from './dates.js';

/** "miércoles o sábado" · "Wednesday or Saturday" — the collection days. */
export const payDaysWords = () =>
  PAY_WEEKDAYS.map((d) => WEEKDAYS[d]).join(` ${t('o')} `);

/** "2 quincenas y 1 deuda" · "2 two-week periods and 1 debt" — what a balance is made of. */
export function owedWords(invoices = []) {
  const charges = invoices.filter(isCharge).length;
  // A week is called a week: somebody who pays every seven days was told
  // they owed "1 quincena" for one.
  const weeks = invoices.filter((invoice) => !isCharge(invoice)
    && Number(invoice.payEvery) === PAY_EVERY.WEEK).length;
  const fortnights = invoices.length - charges - weeks;
  const parts = [];
  if (fortnights) parts.push(plural(fortnights, 'quincena', 'quincenas'));
  if (weeks) parts.push(plural(weeks, 'semana', 'semanas'));
  if (charges) parts.push(plural(charges, 'deuda', 'deudas'));
  if (parts.length > 2) return `${parts.slice(0, -1).join(', ')} ${t('y')} ${parts[parts.length - 1]}`;
  return parts.join(` ${t('y')} `) || t('nada');
}
