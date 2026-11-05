/**
 * The language switch: Español · English.
 *
 * Each choice is written in its own language, so whoever needs it can read it
 * whichever language the screen is in. Choosing one keeps it on this computer
 * and starts the panel again in it — screens, printed reports, receipts and
 * labels alike (see js/lib/i18n.js).
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { lang, setLang } from '../lib/i18n.js';

/**
 * @param {object} [options]
 * @param {boolean} [options.short]  "ES · EN" instead of "Español · English", for tight corners
 */
export function langSwitch({ short = false } = {}) {
  const now = lang();
  const option = (value, label, abbr, hint) => h(
    `button.langsw__opt${now === value ? '.is-active' : ''}`,
    {
      type: 'button',
      lang: value,
      title: hint,
      'aria-pressed': String(now === value),
      onclick: () => setLang(value),
    },
    short ? abbr : label);

  return h(`div.langsw${short ? '.langsw--short' : ''}`, { role: 'group', 'aria-label': 'Idioma · Language' },
    icon('globe', 'langsw__ico'),
    option('es', 'Español', 'ES', 'Ver el panel en español'),
    option('en', 'English', 'EN', 'Show the panel in English'));
}
