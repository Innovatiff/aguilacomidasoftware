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
import { PAY_WEEKDAYS, isCharge } from './billing.js';
import { WEEKDAYS } from './dates.js';

/** "miércoles o sábado" · "Wednesday or Saturday" — the collection days. */
export const payDaysWords = () =>
  PAY_WEEKDAYS.map((d) => WEEKDAYS[d]).join(` ${t('o')} `);

/** "2 quincenas y 1 deuda" · "2 two-week periods and 1 debt" — what a balance is made of. */
export function owedWords(invoices = []) {
  const charges = invoices.filter(isCharge).length;
  const periods = invoices.length - charges;
  const parts = [];
  if (periods) parts.push(plural(periods, 'quincena', 'quincenas'));
  if (charges) parts.push(plural(charges, 'deuda', 'deudas'));
  return parts.join(` ${t('y')} `) || t('nada');
}
