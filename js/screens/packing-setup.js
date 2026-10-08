/**
 * Configuring the empaque — the manager's side of it.
 *
 * Three things get set here and they are set rarely: which locations belong to
 * which libreta, the order each libreta is packed in, and who is allowed to
 * pack with what number. Unlike the
 * packing screen itself this is an ordinary panel screen, because the person
 * using it is sitting down with the roster in front of them.
 *
 * **The unit is the location, not the farm.** A farm can be houses spread over
 * kilometres, and the kitchen splits them between the two people by where they
 * are, not by whose name is on the gate — so Casa 1 and Casa 4 of the same farm
 * can be in different libretas. Assigning a whole farm at once is still one
 * press; it is a shortcut over the locations rather than a different kind of
 * thing.
 *
 * The one thing it works hard at is the thing that goes wrong: a house added in
 * March that nobody puts on a list, whose people are then quietly not packed
 * for. Every location with people in it is on this screen whether or not it has
 * been assigned, the unassigned ones are counted at the top, and a location can
 * only be in one libreta — picking it for the second takes it out of the first,
 * rather than letting somebody pack the same food twice.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import {
  card, button, asyncButton, input, field, sectionLabel, alert,
  skeletonRows, dataErrorCard, emptyState, list, itemRow, badge, switchRow, avatar,
} from '../ui/kit.js';
import { sheet, confirm, toastOk, toastBad } from '../ui/overlay.js';
import { sortable } from '../ui/sortable.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, isReady } from '../data/store.js';
import {
  watchPacking, savePacking, setAutoPrint, watchPackers, savePacker, removePacker,
} from '../data/packing.js';
import {
  lineOfPlace, allPlaces, orderedPlaces, unassignedPlaces, duplicatePins,
  ABILITIES, abilitiesOf, abilitiesInWords,
} from '../lib/packing.js';
import { lifetime } from '../ui/shell.js';
import { plural } from '../lib/format.js';
import { errorText } from '../firebase.js';
import { kitchen } from '../lib/mode.js';

export function renderPackingSetup() {
  /*
   * Not on the kitchen computer.
   *
   * This is where users are created and given their permissions. Open on the
   * machine those users sit at, it would let any of them give themselves
   * every permission there is — the whole setup would be decoration. The
   * manager does it from the panel, which is the only place it is reachable.
   */
  if (kitchen()) {
    screen({
      title: 'Configurar el empaque',
      backTo: '/rapido',
      body: h('div.page__inner', emptyState({
        icon: 'lock',
        title: 'Esto se configura desde el panel',
        text: 'Las libretas, los usuarios y lo que puede hacer cada uno los cambia el '
          + 'encargado desde el panel de administración, no desde esta computadora.',
        action: button('Volver al menú', {
          variant: 'primary', size: 'lg', icon: 'chevronL', onClick: () => go('/rapido'),
        }),
      })),
    });
    return () => {};
  }

  const life = lifetime();
  let setup = null;
  let packers = null;
  let failure = null;

  const stops = [
    watchPacking((found) => { setup = found; paint(); }, (error) => { failure = error; paint(); }),
    watchPackers((found) => { packers = found; paint(); }, (error) => { failure = error; paint(); }),
  ];

  const author = () => ({ name: session.displayName || session.email || '' });

  function paint() {
    if (!life.alive()) return;
    screen({
      title: 'Configurar el empaque',
      subtitle: 'Las libretas, los usuarios y lo que puede hacer cada uno',
      backTo: '/empaque',
      tab: 'packing',
      sunken: true,
      body: h('div.page__inner.rbig.stack.stack-5', bodyFor()),
    });
  }

  function bodyFor() {
    if (failure) return dataErrorCard(failure, { onRetry: () => go('/empaque/ajustes') });
    if (!setup || !packers || !isReady()) return skeletonRows(5);

    const orphans = unassignedPlaces(setup.lines, store.farms, store.clients);
    const clashes = duplicatePins(packers);

    return h('div.stack.stack-5',
      orphans.length
        ? alert(`${plural(orphans.length, 'ubicación no está', 'ubicaciones no están')} en `
          + 'ninguna libreta. Su comida no se va a empacar: '
          + `${orphans.map((one) => `${one.farm.name} · ${one.place.name}`).join(', ')}.`,
        'warn', 'alert')
        : null,

      clashes.length
        ? alert(`Hay ${plural(clashes.length, 'número repetido', 'números repetidos')}. `
          + 'Dos personas con el mismo número hacen que el nombre en la lista sea '
          + 'una moneda al aire.', 'bad', 'alert')
        : null,

      h('div.stack.stack-3',
        sectionLabel('Las etiquetas'),
        printCard()),

      h('div.stack.stack-3',
        sectionLabel('Las libretas'),
        h('p.rnote', 'Cada ubicación va en una sola libreta, y las de una misma farma pueden '
          + 'repartirse entre las dos. Para mover una, primero quítala de la libreta donde '
          + 'está y después escógela en la otra.'),
        setup.lines.map(lineCard)),

      h('div.stack.stack-3',
        sectionLabel(`Usuarios · ${packers.length}`, h('button.btn.btn--soft.btn--sm', {
          type: 'button', onclick: () => editPacker(null),
        }, icon('userPlus'), 'Nuevo usuario')),
        h('p.rnote', 'Cada persona entra a la computadora de la cocina con su PIN, y ve '
          + 'solo los botones que tiene permitidos.'),
        packers.length ? packerList() : emptyState({
          icon: 'users',
          title: 'Todavía no hay usuarios',
          text: 'Crea uno por persona: su nombre, un PIN de cuatro dígitos y lo que '
            + 'puede hacer. Con eso ya entra a la computadora de la cocina.',
          action: button('Nuevo usuario', {
            variant: 'primary', icon: 'userPlus', onClick: () => editPacker(null),
          }),
        })));
  }

  /* --- Whether the labels print by themselves --------------------------------- */

  /**
   * The switch, and the one thing nobody can guess from the screen.
   *
   * A browser cannot print without asking — that is the point of the dialog —
   * unless Chrome was started with `--kiosk-printing`, which makes it send
   * everything straight to the default printer with nothing to confirm. So the
   * card says so. Without that flag this setting turns forty containers into
   * forty dialogs, and somebody will turn it off and never say why.
   */
  function printCard() {
    const on = setup.autoPrint !== false;
    return card(h('div.stack.stack-3',
      h('div.row.row--between',
        h('div',
          h('div.w-700', 'Imprimir las etiquetas solas'),
          h('div.t-sm.c-soft', on
            ? 'Al llegar a cada farma sale la etiqueta de su bolsa, con todos los nombres, '
              + 'y al pasar a cada persona sale la suya, sin tocar nada.'
            : 'Apagado: nadie imprime nada durante el empaque.')),
        h('button.btn.btn--soft', {
          type: 'button',
          onclick: async () => {
            try {
              await setAutoPrint(!on, author());
              toastOk(on ? 'Ya no se imprimen solas' : 'Ahora se imprimen solas');
            } catch (error) { toastBad(errorText(error)); }
          },
        }, on ? 'Apagar' : 'Encender')),

      on
        ? alert('Para que salga sin preguntar nada, Chrome tiene que abrirse con '
          + '--kiosk-printing y la impresora de etiquetas tiene que ser la '
          + 'predeterminada de esa computadora. Sin eso, cada etiqueta abre un '
          + 'cuadro de diálogo.', 'info', 'printer')
        : null));
  }

  /* --- One libreta ----------------------------------------------------------- */

  function lineCard(line) {
    // In the order the libreta is packed, because that is the other thing
    // this card is for.
    const mine = orderedPlaces(setup.lines, line.id, store.farms, store.clients);
    const farms = new Set(mine.map((one) => one.farm.id));
    const people = mine.reduce((sum, one) => sum + peopleAt(one), 0);

    return card(h('div.stack.stack-3',
      h('div.row.row--between',
        h('div',
          h('div.rmenu__t', line.name),
          h('div.rmenu__s', mine.length
            ? `${plural(farms.size, 'farma', 'farmas')} · `
              + `${plural(mine.length, 'ubicación', 'ubicaciones')} · `
              + `${plural(people, 'cliente', 'clientes')}`
            : 'Sin ubicaciones')),
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button', onclick: () => renameLine(line),
        }, icon('edit'), 'Nombre')),

      mine.length
        // Farm and place together on the chip. "Casa 1" on its own says
        // nothing on a screen where three farms have a Casa 1. Numbered,
        // because the order they are in is the order they are packed in.
        ? h('div.pkchips', mine.map((one, at) =>
          h('span.pkchip', h('b.pkchip__n', String(at + 1)), `${one.farm.name} · ${one.place.name}`)))
        : h('p.t-sm.c-soft', 'Todavía no le has puesto ubicaciones.'),

      h('div.pkline-actions',
        button('Escoger sus ubicaciones', {
          variant: 'soft', block: true, icon: 'pin', onClick: () => pickPlaces(line),
        }),
        // Only worth offering once there is something to put in order.
        mine.length > 1
          ? button('Orden de empaque', {
            variant: 'soft', block: true, icon: 'sort', onClick: () => orderPlaces(line),
          })
          : null)));
  }

  /** How many people are packed from one location today and every other day. */
  function peopleAt(entry) {
    const known = new Set((entry.farm.locations || []).map((place) => place.id));
    return store.clients.filter((client) => {
      if (client.farmId !== entry.farm.id) return false;
      return entry.place.id
        ? client.locationId === entry.place.id
        : !known.has(client.locationId);
    }).length;
  }

  async function renameLine(line) {
    const box = input({ value: line.name, maxlength: 30 });
    const name = await sheet({
      title: 'Nombre de la libreta',
      build: (close) => h('div.stack.stack-4',
        field({ label: 'Cómo se llama', control: box }),
        button('Guardar', {
          variant: 'primary', size: 'lg', block: true, onClick: () => close(box.value),
        })),
    });
    if (name == null) return;

    const next = setup.lines.map((row) => (row.id === line.id ? { ...row, name } : row));
    try {
      await savePacking(next, author());
      toastOk('Listo');
    } catch (error) { toastBad(errorText(error)); }
  }

  /**
   * Which locations this libreta packs.
   *
   * Every location in the kitchen is on this sheet, grouped under its farm and
   * with the other libreta's marked — so the choice is made against the whole
   * roster rather than against a filtered half of it, and taking one is
   * visibly taking it from somewhere.
   *
   * Each farm keeps a "todo el rancho" press, because most farms do go to one
   * libreta whole and nobody should tap eight houses to say so. It is a
   * shortcut over the rows, not a different setting: what gets saved is always
   * the list of locations, which is the only thing the morning reads.
   *
   * The empty locations are here too, greyed. A house with nobody in it today
   * has somebody in it next month, and leaving it off this screen is how it
   * gets forgotten then.
   */
  async function pickPlaces(line) {
    const every = allPlaces(store.farms, store.clients);
    // What this libreta owns right now, with any whole-farm assignment from
    // the old shape already written out as its locations — in the order it is
    // packed, so saving the picks does not reshuffle the morning. A location
    // picked here for the first time goes after the ones it already had.
    const chosen = new Set(
      orderedPlaces(setup.lines, line.id, store.farms, store.clients).map((one) => one.key),
    );

    /*
     * A location the other libreta already has cannot be taken from here.
     *
     * It used to be one press: tap it in the second libreta and it left the
     * first. That is fast and it is also how somebody moves a house without
     * noticing they moved it — the other libreta shrinks on a screen nobody is
     * looking at. So taking is now two deliberate acts: unmark it where it is,
     * save, then come here and mark it. In between it sits in no libreta and
     * the warning at the top of the setup screen says so, which is exactly the
     * state somebody halfway through a change should be able to see.
     */
    const heldElsewhere = (one) => {
      const other = lineOfPlace(setup.lines, one.farm.id, one.place.id);
      return other && other.id !== line.id ? other : null;
    };

    const rows = h('div.stack.stack-4');

    const paintRows = () => rows.replaceChildren(...store.farms.map((farm) => {
      const here = every.filter((one) => one.farm.id === farm.id);
      if (!here.length) return null;

      const locked = here.filter((one) => heldElsewhere(one));
      const free = here.filter((one) => !heldElsewhere(one));
      const mine = free.filter((one) => chosen.has(one.key)).length;
      const allFree = free.length > 0 && mine === free.length;

      return h('div.pkgroup',
        h('div.pkgroup__head',
          h('div.grow',
            h('div.pkgroup__name', farm.name),
            h('div.pkgroup__meta', [
              mine === here.length ? 'Toda la farma'
                : mine ? `${mine} de ${here.length}`
                  : 'Ninguna',
              locked.length ? `${locked.length} en ${heldElsewhere(locked[0]).name}` : null,
            ].filter(Boolean).join(' · '))),

          // Nothing to press when the whole farm belongs to the other one.
          free.length
            ? h('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              onclick: () => {
                // All or nothing, whichever it is not already — and only over
                // what this libreta is allowed to touch.
                for (const one of free) {
                  if (allFree) chosen.delete(one.key); else chosen.add(one.key);
                }
                paintRows();
              },
            }, allFree ? 'Quitar todo' : 'Toda la farma')
            : null),

        h('div.stack.stack-2', here.map((one) => {
          const other = heldElsewhere(one);
          const on = chosen.has(one.key);
          const count = peopleAt(one);

          return h(`button.pkpick${on ? '.is-on' : ''}${other ? '.pkpick--locked' : ''}`, {
            type: 'button',
            onclick: () => {
              // Still a button, and it still answers. A row that does nothing
              // when a thumb lands on it reads as a broken screen; this one
              // says what to do instead.
              if (other) {
                toastBad(`${one.place.name} está en ${other.name}. `
                  + 'Quítala de ahí primero y luego escógela aquí.');
                return;
              }
              if (on) chosen.delete(one.key); else chosen.add(one.key);
              paintRows();
            },
          },
          h('span.pkpick__box', other ? icon('lock') : (on ? icon('check') : null)),
          h('span.grow',
            h('span.pkpick__name', one.place.name),
            h('span.pkpick__meta',
              (count ? plural(count, 'cliente', 'clientes') : 'Sin clientes')
              + (other ? ` · está en ${other.name}` : ''))),
          other ? badge(other.name, 'muted') : null);
        })));
    }).filter(Boolean));
    paintRows();

    const done = await sheet({
      title: `Ubicaciones de ${line.name}`,
      build: (close) => h('div.stack.stack-4',
        h('p.t-sm.c-soft', 'Toca las ubicaciones que van en esta libreta. Las de una misma '
          + 'farma pueden repartirse entre las dos. Lo que ya tiene la otra sale con '
          + 'candado: para traerlo, quítalo de allá primero.'),
        rows,
        button('Guardar', {
          variant: 'primary', size: 'lg', block: true, onClick: () => close(true),
        })),
    });
    if (!done) return;

    /*
     * The save writes both libretas out in full, and empties `farmIds`.
     *
     * Taking a location for this libreta takes it out of the other one — two
     * lists that both contain Casa 1 is two people packing the same food. And
     * because what the other libreta owns is worked out here from what the
     * screen was showing, the first save after any edit turns the old
     * whole-farm shape into the explicit locations it always meant. From then
     * on the stored setup says exactly what the manager saw.
     */
    // Belt and braces: whatever the rows did, a location the other libreta
    // holds is never written into this one. The rule lives in the saved data,
    // not only in what the screen let somebody press.
    const mine = [...chosen].filter((key) => {
      const one = every.find((entry) => entry.key === key);
      if (!one) return false;
      const other = lineOfPlace(setup.lines, one.farm.id, one.place.id);
      return !other || other.id === line.id;
    });

    const next = setup.lines.map((row) => {
      if (row.id === line.id) return { ...row, farmIds: [], placeIds: mine };
      // The other libreta keeps exactly what it had, in the order it had it.
      // Nothing on this sheet can take from it — that is the whole point of
      // the lock.
      const theirs = orderedPlaces(setup.lines, row.id, store.farms, store.clients)
        .map((one) => one.key);
      return { ...row, farmIds: [], placeIds: theirs };
    });

    try {
      await savePacking(next, author());
      toastOk('Libreta guardada');
    } catch (error) { toastBad(errorText(error)); }
  }

  /**
   * The order this libreta is packed in, location by location.
   *
   * The kitchen packs in the order the van is loaded, and the van goes house
   * by house, not farm by farm — so the list here is of locations, and two
   * houses of the same farm can be anywhere in it. Where the order leaves a
   * farm and comes back to it later, the packing screen says so and the bag
   * label follows: one bag per stretch.
   *
   * A libreta can have forty locations, and the first version of this sheet —
   * one long list to drag things around in — made finding each one the job.
   * So it is built for finding:
   *
   *   - **A search box** over both columns: "casa 4", "morsea", "mucci casa".
   *     Enter adds the one location that matches.
   *   - **"Por acomodar"**, the locations not in the order yet, grouped under
   *     their farm. Tapping one puts it at the end of the order, so the whole
   *     order can be built by tapping the route in sequence — "Empezar de
   *     cero" empties the order for exactly that.
   *   - **The number on each row is a button.** Type where it goes — 3 — and
   *     it goes there, from wherever it was. Drag and the arrows are still
   *     there for moving one a place or two.
   *
   * Nothing is saved until Guardar. Anything left in "Por acomodar" goes at
   * the end, in the paper book's order — it is never left out of the libreta.
   */
  async function orderPlaces(line) {
    const members = orderedPlaces(setup.lines, line.id, store.farms, store.clients);
    // The paper book's order: the same libreta with no order of its own.
    const book = () => orderedPlaces(
      setup.lines.map((row) => (row.id === line.id ? { ...row, order: [] } : row)),
      line.id, store.farms, store.clients);
    const byKey = new Map(members.map((one) => [one.key, one]));
    // Where each location sits among all of them: farm by name, then the
    // farm's own list — the order "Por acomodar" is read in.
    const shelf = allPlaces(store.farms, store.clients).map((one) => one.key).filter((key) => byKey.has(key));

    let order = members.slice();
    let query = [];
    let editing = null;   // the row whose number is being typed
    let focus = null;     // where the cursor goes back to after a redraw
    let fresh = null;     // the row that just arrived, lit up for a moment

    const fold = (text) => String(text || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    const matches = (one) => !query.length
      || query.every((word) => fold(`${one.place.name} ${one.farm.name}`).includes(word));
    const placed = () => new Set(order.map((one) => one.key));
    const waiting = () => {
      const taken = placed();
      return shelf.filter((key) => !taken.has(key)).map((key) => byKey.get(key));
    };

    /* What the buttons do. Each one redraws. */
    const add = (key) => {
      if (placed().has(key) || !byKey.has(key)) return;
      order = [...order, byKey.get(key)];
      fresh = key;
    };
    const remove = (key) => { order = order.filter((one) => one.key !== key); };
    const moveTo = (key, number) => {
      const at = order.findIndex((one) => one.key === key);
      if (at === -1) return;
      const to = Math.max(0, Math.min(order.length - 1, number - 1));
      const next = order.slice();
      const [one] = next.splice(at, 1);
      next.splice(to, 0, one);
      order = next;
      if (to !== at) fresh = key;
    };
    const step = (key, by) => {
      const at = order.findIndex((one) => one.key === key);
      if (at === -1 || at + by < 0 || at + by >= order.length) return;
      moveTo(key, at + by + 1);
      fresh = null;
      focus = { key, part: by < 0 ? 'up' : 'down' };
    };

    /* --- What is on the sheet ---------------------------------------------- */

    const search = input({
      type: 'search',
      placeholder: 'Buscar ubicación o farma',
      autocomplete: 'off',
      'aria-label': 'Buscar ubicación o farma',
      oninput: () => { query = fold(search.value).split(/\s+/).filter(Boolean); paint(); },
      onkeydown: (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        // Enter adds the location the search points at — only when it points
        // at exactly one, so a half-typed word never adds the wrong house.
        const found = waiting().filter(matches);
        if (found.length !== 1) return;
        add(found[0].key);
        search.value = '';
        query = [];
        paint();
      },
    });
    search.classList.add('pkord__search');

    const list = h('ol.pkorder');
    const shelfBox = h('div.pkpool');
    const placedCount = h('span.pkord__count');
    const waitingCount = h('span.pkord__count');
    const leftover = h('p.pkord__left');

    function numberBox(one, at) {
      const box = h('input.pkorder__num', {
        type: 'number', min: 1, max: order.length, value: at + 1, inputmode: 'numeric',
        'aria-label': `Número nuevo para ${one.place.name}`,
      });
      const done = (apply) => {
        if (editing !== one.key) return;
        editing = null;
        const number = parseInt(box.value, 10);
        if (apply && number >= 1) moveTo(one.key, number);
        focus = { key: one.key, part: 'number' };
        paint();
      };
      box.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); done(true); }
        // Escape cancels the number, not the whole sheet.
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done(false); }
      });
      box.addEventListener('blur', () => done(true));
      queueMicrotask(() => { box.focus(); box.select(); });
      return box;
    }

    function row(one) {
      const at = order.indexOf(one);
      const count = peopleAt(one);
      // While searching only some rows show, and the rows around one on the
      // screen are not the ones around it in the order: dragging or stepping
      // would mean something different from what it looks like. The number
      // and the ✕ mean the same thing either way, so they stay.
      const whole = !query.length;
      return h(`li.pkorder__row${fresh === one.key ? '.is-new' : ''}`, { dataset: { key: one.key } },
        whole
          ? h('button.pkorder__grip', {
            type: 'button',
            'data-grip': '',
            title: 'Arrastrar para mover',
            'aria-label': `Mover ${one.place.name} de ${one.farm.name}. `
              + 'Usa las flechas del teclado para subirla o bajarla.',
          }, icon('grip'))
          : null,
        editing === one.key
          ? numberBox(one, at)
          : h('button.pkorder__n', {
            type: 'button',
            'data-part': 'number',
            title: 'Toca para mandarla a otro número',
            'aria-label': `Número ${at + 1}. Toca para mandarla a otro número.`,
            onclick: () => { editing = one.key; paint(); },
          }, String(at + 1)),
        h('span.pkorder__text',
          h('span.pkorder__place', one.place.name),
          h('span.pkorder__farm', `${one.farm.name} · `
            + `${count ? plural(count, 'cliente', 'clientes') : 'sin clientes'}`)),
        whole
          ? [
            h('button.pkorder__step', {
              type: 'button', disabled: at === 0, 'data-part': 'up',
              'aria-label': `Subir ${one.place.name}`,
              onclick: () => { step(one.key, -1); paint(); },
            }, icon('chevronU')),
            h('button.pkorder__step', {
              type: 'button', disabled: at === order.length - 1, 'data-part': 'down',
              'aria-label': `Bajar ${one.place.name}`,
              onclick: () => { step(one.key, 1); paint(); },
            }, icon('chevronD')),
          ]
          : null,
        h('button.pkorder__out', {
          type: 'button',
          'data-part': 'out',
          title: 'Quitar del orden',
          'aria-label': `Quitar ${one.place.name} del orden`,
          onclick: () => { remove(one.key); paint(); },
        }, icon('x')));
    }

    function shelfFor(entries) {
      const farms = new Map();
      for (const one of entries) {
        if (!farms.has(one.farm.id)) farms.set(one.farm.id, { farm: one.farm, items: [] });
        farms.get(one.farm.id).items.push(one);
      }
      return [...farms.values()].map(({ farm, items }) => h('div.pkpool__farm',
        h('div.pkpool__name', farm.name),
        h('div.pkpool__items', items.map((one) => {
          const count = peopleAt(one);
          return h('button.pkpool__item', {
            type: 'button',
            dataset: { key: one.key },
            title: 'Ponerla al final del orden',
            onclick: () => { add(one.key); paint(); },
          },
          icon('plus'),
          h('span.pkpool__place', one.place.name),
          // How many people live there, with the people icon so a bare number
          // is not left to guess at; nothing at all for an empty house.
          count
            ? h('span.pkpool__meta', { title: plural(count, 'cliente', 'clientes') },
              icon('users'), String(count))
            : null);
        }))));
    }

    function paint() {
      const shown = order.filter(matches);
      placedCount.textContent = String(order.length);
      list.classList.toggle('is-filtered', query.length > 0);
      mount(list, shown.length
        ? shown.map(row)
        : h('li.pkord__empty', order.length
          ? 'Ninguna del orden coincide con la búsqueda.'
          : 'Todavía no hay ninguna. Toca las de «Por acomodar» en el orden en que se empacan.'));

      const rest = waiting();
      const restShown = rest.filter(matches);
      waitingCount.textContent = String(rest.length);
      mount(shelfBox, restShown.length
        ? shelfFor(restShown)
        : h('p.pkord__empty', rest.length
          ? 'Ninguna por acomodar coincide con la búsqueda.'
          : 'Todas están en el orden.'));

      leftover.textContent = rest.length
        ? `${plural(rest.length, 'ubicación sin acomodar se va', 'ubicaciones sin acomodar se van')} `
          + 'al final, en el orden de siempre.'
        : '';
      leftover.hidden = !rest.length;

      // The row that just arrived is shown, lit for a moment, so whoever
      // tapped it sees where it went in a list longer than the screen.
      if (fresh) {
        const lit = [...list.children].find((el) => el.dataset.key === fresh);
        lit?.scrollIntoView({ block: 'nearest' });
        fresh = null;
      }
      if (focus) {
        const at = [...list.children].find((el) => el.dataset.key === focus.key);
        const target = at?.querySelector(`[data-part="${focus.part}"]:not(:disabled)`)
          || at?.querySelector('[data-grip]') || at?.querySelector('[data-part="number"]');
        target?.focus({ preventScroll: false });
        focus = null;
      }
    }

    sortable(list, {
      onChange: (keys, moved) => {
        order = keys.map((key) => byKey.get(key)).filter(Boolean);
        focus = { key: moved, part: 'grip' };
        paint();
      },
    });
    paint();

    const saved = await sheet({
      title: `Orden de ${line.name}`,
      wide: true,
      build: () => h('div.pkord',
        h('p.pkord__intro', 'Así se empaca esta libreta, de arriba abajo, ubicación por '
          + 'ubicación. Nada se guarda hasta «Guardar orden».'),
        h('div.pkord__tools',
          search,
          h('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            title: 'Pasar todas a «Por acomodar» para armar el orden tocándolas',
            onclick: () => { order = []; editing = null; paint(); search.focus(); },
          }, icon('refresh'), 'Empezar de cero'),
          h('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            onclick: () => { order = book(); editing = null; paint(); },
          }, icon('farm'), 'Ordenar por farma')),
        h('div.pkord__cols',
          h('section.pkord__col', { 'aria-label': 'El orden' },
            h('div.pkord__head',
              h('span.pkord__title', 'El orden'), placedCount),
            h('p.pkord__hint', 'Toca el número para mandarla a otro lugar, o arrástrala '
              + 'de la manija. ✕ la regresa a «Por acomodar».'),
            list),
          h('section.pkord__col.pkord__col--shelf', { 'aria-label': 'Por acomodar' },
            h('div.pkord__head',
              h('span.pkord__title', 'Por acomodar'), waitingCount),
            h('p.pkord__hint', 'Tócalas en el orden en que se empacan: cada una se va al '
              + 'final del orden.'),
            shelfBox))),
      foot: (close) => h('div.pkord__foot',
        leftover,
        button('Guardar orden', {
          variant: 'primary', size: 'lg', block: true, onClick: () => close(true),
        })),
    });
    if (!saved) return;

    // Whatever is still waiting goes at the end, in the book's order — never
    // left out of the libreta.
    const taken = placed();
    const keys = [
      ...order.map((one) => one.key),
      ...book().filter((one) => !taken.has(one.key)).map((one) => one.key),
    ];

    // Only this libreta's order changes. Which locations it has, and anything
    // about the other one, is left exactly as it was.
    const next = setup.lines.map((row) => (row.id === line.id ? { ...row, order: keys } : row));
    try {
      await savePacking(next, author());
      toastOk('Orden guardado');
    } catch (error) { toastBad(errorText(error)); }
  }

  /* --- Who packs -------------------------------------------------------------- */

  /**
   * The users, one row each.
   *
   * The PIN is not printed here. It is not a password, but it is still the
   * thing that puts somebody's name on the morning, and a list that shows every
   * number to whoever is looking over the manager's shoulder is not a list that
   * looks like it was made by people who thought about it. It is one tap away,
   * in the user's own sheet.
   */
  function packerList() {
    return list(packers.map((packer) => {
      const off = packer.active === false;
      return itemRow({
        lead: avatar(packer.name),
        title: packer.name,
        meta: off ? 'Sin acceso' : `PIN •••• · ${abilitiesInWords(packer)}`,
        end: off ? badge('Desactivado', 'muted') : null,
        onClick: () => editPacker(packer),
      });
    }), { card: true });
  }

  /**
   * Creating or editing one user: who they are, their PIN, and what they can
   * do.
   *
   * The permissions are one switch per button on the kitchen's menu, each with
   * a line saying what it opens, so the manager is choosing between things
   * they can picture rather than between names. "Todo" and "Nada" are there
   * because most people get one or the other, and seven switches to say so is
   * seven chances to miss one.
   *
   * A new user starts with everything on. Most people in a kitchen do most of
   * the jobs, and the manager is here to take away the one or two that a
   * person should not have — not to build their day up from nothing.
   */
  async function editPacker(packer) {
    const name = input({
      value: packer?.name || '', placeholder: 'Nombre y apellido', autocomplete: 'off',
    });
    const pin = input({
      value: packer?.pin || '', inputmode: 'numeric', maxlength: 8, autocomplete: 'off',
      placeholder: '4 dígitos', pattern: '[0-9]*',
      // Digits only, as they are typed — a letter in a PIN is a PIN nobody
      // can type on the kitchen's keypad.
      oninput: (event) => { event.target.value = event.target.value.replace(/\D/g, ''); },
    });
    const can = abilitiesOf(packer);
    let active = packer ? packer.active !== false : true;

    const switches = h('div.stack.stack-2');
    const paintSwitches = () => switches.replaceChildren(...ABILITIES.map((one) =>
      switchRow(one.title, {
        checked: can[one.key],
        hint: one.hint,
        onChange: (value) => { can[one.key] = value; },
      })));
    paintSwitches();

    const setAll = (value) => {
      for (const { key } of ABILITIES) can[key] = value;
      paintSwitches();
    };

    const others = packers.filter((one) => one.id !== packer?.id);

    const saved = await sheet({
      title: packer ? 'Editar usuario' : 'Nuevo usuario',
      build: (close) => h('div.stack.stack-5',
        h('div.stack.stack-4',
          field({ label: 'Nombre', control: name }),
          field({
            label: 'PIN',
            hint: 'Con esto entra a la computadora de la cocina. De 4 a 8 números, '
              + 'y cada persona tiene el suyo.',
            control: pin,
          })),

        h('div.stack.stack-3',
          h('div.row.row--between',
            h('div',
              h('div.w-700', 'Qué puede hacer'),
              h('div.t-sm.c-soft', 'Lo que no tenga permitido no le aparece en el menú.')),
            h('div.btn-group',
              button('Todo', { variant: 'ghost', size: 'sm', onClick: () => setAll(true) }),
              button('Nada', { variant: 'ghost', size: 'sm', onClick: () => setAll(false) }))),
          card(switches)),

        card(switchRow('Activo', {
          checked: active,
          onChange: (value) => { active = value; },
          hint: 'Apágalo cuando alguien deje de trabajar aquí. Su PIN deja de servir, '
            + 'y lo que ya empacó queda guardado con su nombre.',
        })),

        asyncButton(packer ? 'Guardar cambios' : 'Crear usuario', {
          variant: 'primary', size: 'lg', block: true,
          onClick: async () => {
            try {
              await savePacker({
                id: packer?.id, name: name.value, pin: pin.value, active, can,
              }, author(), others);
              close(true);
            } catch (error) { toastBad(errorText(error)); }
          },
        }),

        packer
          ? button('Eliminar usuario', {
            variant: 'danger-soft', block: true, icon: 'ban',
            onClick: async () => {
              const sure = await confirm({
                title: `¿Eliminar a ${packer.name}?`,
                message: 'Su PIN deja de servir. Las mañanas que ya empacó siguen guardadas '
                  + 'con su nombre. Si solo va a dejar de venir un tiempo, mejor desactívalo.',
                confirmLabel: 'Eliminar', tone: 'danger', icon: 'alert',
              });
              if (!sure) return;
              try { await removePacker(packer.id); close(true); }
              catch (error) { toastBad(errorText(error)); }
            },
          })
          : null),
    });
    if (saved) toastOk(packer ? 'Usuario actualizado' : 'Usuario creado');
  }

  const unsubscribe = subscribe(paint);
  return life.ending(unsubscribe, ...stops);
}
