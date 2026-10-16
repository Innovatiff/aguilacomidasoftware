/**
 * Etiqueta especial — the sticker for a bag packed by hand.
 *
 * The libreta makes a bag every four people of a house, and that is most
 * bags. Some are not: two people's food in one bag, or three, because that is
 * how the containers fitted or how the van is going. Here the packer taps who
 * went in, and gets a sticker that says so — the farm, the house, the names,
 * and how many containers that makes.
 *
 * It offers the farm on the screen, with its people as the libreta has them,
 * house by house, so names are tapped and never typed; the person on the
 * screen is marked, and the list opens on them. Nothing is saved anywhere: it
 * is a sticker, not a record.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import { button } from './kit.js';
import { printStickers } from './print.js';
import { plural } from '../lib/format.js';
import { errorText } from '../firebase.js';

/**
 * @param {object} options
 * @param {object} options.farm       the farm on the screen
 * @param {{ place: object, people: { id: string, name: string, plates: number }[] }[]} options.groups
 *   its houses in this part of the libreta, in packing order
 * @param {string} [options.here]     the id of the person on the screen
 * @param {string} options.day        'YYYY-MM-DD'
 * @param {string} options.lineName   which libreta, for the "R1"
 * @returns {Promise<boolean|undefined>} true once a sticker went to the printer
 */
export function specialLabel({
  farm, groups, here, day, lineName, lineId,
}) {
  const everyone = groups.flatMap((group) => group.people.map((one) => ({ ...one, place: group.place })));
  const chosen = new Set();
  const rows = new Map();
  let close = () => {};

  const summary = h('div.spl__sum');
  const go = button('Imprimir etiqueta', {
    variant: 'primary', size: 'lg', block: true, icon: 'printer', disabled: true,
    onClick: () => send(),
  });

  const picked = () => everyone.filter((one) => chosen.has(one.id));

  function refresh() {
    for (const [id, row] of rows) {
      row.classList.toggle('is-on', chosen.has(id));
      row.setAttribute('aria-pressed', chosen.has(id) ? 'true' : 'false');
    }
    const people = picked();
    const plates = people.reduce((sum, one) => sum + (Number(one.plates) || 0), 0);
    summary.textContent = people.length
      ? `Lleva ${plural(people.length, 'persona', 'personas')} · ${plural(plates, 'comida', 'comidas')}`
      : 'Toca a las personas que van en esta bolsa.';
    go.disabled = !people.length;
  }

  function send() {
    const people = picked();
    if (!people.length) return;
    // The houses of the people in it, in the order they come — usually one.
    const placeNames = [...new Set(people
      .map((one) => (one.place?.id ? one.place.name : ''))
      .filter(Boolean))];
    try {
      printStickers({
        special: {
          farmName: farm?.name || '',
          placeNames,
          people: people.map(({ name, plates }) => ({ name, plates })),
          day,
          lineName,
          lineId,
        },
      });
      toastOk('Etiqueta especial impresa');
      close(true);
    } catch (error) {
      toastBad(`No se pudo imprimir la etiqueta: ${errorText(error)}`);
    }
  }

  const person = (one) => {
    const row = h('button.spl__who', {
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => {
        if (chosen.has(one.id)) chosen.delete(one.id); else chosen.add(one.id);
        refresh();
      },
    },
    h('span.spl__check', icon('check')),
    h('span.spl__name', one.name),
    one.plates > 1 ? h('span.spl__x', `${one.plates} comidas`) : null,
    one.id === here ? h('span.spl__here', 'Aquí vas') : null);
    rows.set(one.id, row);
    return row;
  };

  return sheet({
    title: 'Etiqueta especial',
    build: (done) => {
      close = done;
      const body = h('div.spl',
        h('p.spl__lead', 'Para una bolsa que no es de cuatro: toca a quién lleva, y sale una '
          + 'etiqueta con la farma, la ubicación y sus nombres.'),
        h('div.spl__farm', farm?.name || ''),
        groups.map((group) => h('div.spl__group',
          h('div.spl__place', group.place?.id ? group.place.name : 'Sin ubicación'),
          group.people.map(person))));
      refresh();
      // Opens on the person on the screen: in a farm of thirty, the bag being
      // closed is around them, not at the top of the list.
      requestAnimationFrame(() => rows.get(here)?.scrollIntoView({ block: 'center' }));
      return body;
    },
    foot: () => h('div.spl__foot', summary, go),
  });
}
