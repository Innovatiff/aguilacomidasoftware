/**
 * Configuring the empaque — the manager's side of it.
 *
 * Two things get set here and they are set rarely: which locations belong to
 * which libreta, and who is allowed to pack with what number. Unlike the
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

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import {
  card, button, asyncButton, input, field, sectionLabel, alert,
  skeletonRows, dataErrorCard, emptyState, list, itemRow, badge, switchRow,
} from '../ui/kit.js';
import { sheet, confirm, toastOk, toastBad } from '../ui/overlay.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, isReady } from '../data/store.js';
import {
  watchPacking, savePacking, setAutoPrint, watchPackers, savePacker, removePacker,
} from '../data/packing.js';
import {
  lineOfPlace, allPlaces, placesOf, unassignedPlaces, duplicatePins,
} from '../lib/packing.js';
import { lifetime } from '../ui/shell.js';
import { plural } from '../lib/format.js';
import { errorText } from '../firebase.js';

export function renderPackingSetup() {
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
      subtitle: 'Las libretas y quién las empaca',
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
        h('p.rnote', 'Cada ubicación va en una sola libreta. Las de un mismo rancho pueden '
          + 'repartirse entre las dos: al poner una en esta, sale de la otra.'),
        setup.lines.map(lineCard)),

      h('div.stack.stack-3',
        sectionLabel(`Quién empaca · ${packers.length}`, h('button.btn.btn--soft.btn--sm', {
          type: 'button', onclick: () => editPacker(null),
        }, icon('plus'), 'Agregar')),
        packers.length ? packerList() : emptyState({
          icon: 'users',
          title: 'Nadie dado de alta',
          text: 'Agrega a quién empaca y dale un número de cuatro dígitos. '
            + 'Con ese número su nombre queda en la lista de cada mañana.',
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
          h('div.w-700', 'Imprimir la etiqueta sola'),
          h('div.t-sm.c-soft', on
            ? 'Al pasar a cada persona sale su etiqueta, sin tocar nada.'
            : 'Apagado: nadie imprime nada durante el empaque.')),
        h('button.btn.btn--soft', {
          type: 'button',
          onclick: async () => {
            try {
              await setAutoPrint(!on, author());
              toastOk(on ? 'Ya no se imprime sola' : 'Ahora se imprime sola');
            } catch (error) { toastBad(errorText(error)); }
          },
        }, on ? 'Apagar' : 'Encender')),

      on
        ? alert('Para que salga sin preguntar nada, Chrome tiene que abrirse con '
          + '--kiosk-printing y la impresora de etiquetas tiene que ser la '
          + 'predeterminada de esa computadora. Sin eso, cada persona abre un '
          + 'cuadro de diálogo.', 'info', 'printer')
        : null));
  }

  /* --- One libreta ----------------------------------------------------------- */

  function lineCard(line) {
    const mine = placesOf(setup.lines, line.id, store.farms, store.clients);
    const farms = new Set(mine.map((one) => one.farm.id));
    const people = mine.reduce((sum, one) => sum + peopleAt(one), 0);

    return card(h('div.stack.stack-3',
      h('div.row.row--between',
        h('div',
          h('div.rmenu__t', line.name),
          h('div.rmenu__s', mine.length
            ? `${plural(farms.size, 'rancho', 'ranchos')} · `
              + `${plural(mine.length, 'ubicación', 'ubicaciones')} · `
              + `${plural(people, 'cliente', 'clientes')}`
            : 'Sin ubicaciones')),
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button', onclick: () => renameLine(line),
        }, icon('edit'), 'Nombre')),

      mine.length
        // Farm and place together on the chip. "Casa 1" on its own says
        // nothing on a screen where three farms have a Casa 1.
        ? h('div.pkchips', mine.map((one) =>
          h('span.pkchip', `${one.farm.name} · ${one.place.name}`)))
        : h('p.t-sm.c-soft', 'Todavía no le has puesto ubicaciones.'),

      button('Escoger sus ubicaciones', {
        variant: 'soft', block: true, icon: 'pin', onClick: () => pickPlaces(line),
      })));
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
    // the old shape already written out as its locations.
    const chosen = new Set(
      placesOf(setup.lines, line.id, store.farms, store.clients).map((one) => one.key),
    );
    const rows = h('div.stack.stack-4');

    const paintRows = () => rows.replaceChildren(...store.farms.map((farm) => {
      const here = every.filter((one) => one.farm.id === farm.id);
      if (!here.length) return null;
      const mine = here.filter((one) => chosen.has(one.key)).length;

      return h('div.pkgroup',
        h('div.pkgroup__head',
          h('div.grow',
            h('div.pkgroup__name', farm.name),
            h('div.pkgroup__meta', mine === here.length ? 'Todo el rancho'
              : mine ? `${mine} de ${here.length}`
                : 'Ninguna')),
          h('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            onclick: () => {
              // All or nothing, whichever it is not already.
              const all = mine === here.length;
              for (const one of here) {
                if (all) chosen.delete(one.key); else chosen.add(one.key);
              }
              paintRows();
            },
          }, mine === here.length ? 'Quitar todo' : 'Todo el rancho')),

        h('div.stack.stack-2', here.map((one) => {
          const other = lineOfPlace(setup.lines, one.farm.id, one.place.id);
          const elsewhere = other && other.id !== line.id && !chosen.has(one.key);
          const on = chosen.has(one.key);
          const count = peopleAt(one);

          return h(`button.pkpick${on ? '.is-on' : ''}`, {
            type: 'button',
            onclick: () => {
              if (on) chosen.delete(one.key); else chosen.add(one.key);
              paintRows();
            },
          },
          h('span.pkpick__box', on ? icon('check') : null),
          h('span.grow',
            h('span.pkpick__name', one.place.name),
            h('span.pkpick__meta',
              (count ? plural(count, 'cliente', 'clientes') : 'Sin clientes')
              + (elsewhere ? ` · ahora está en ${other.name}` : ''))),
          elsewhere ? badge('En la otra', 'warn') : null);
        })));
    }).filter(Boolean));
    paintRows();

    const done = await sheet({
      title: `Ubicaciones de ${line.name}`,
      build: (close) => h('div.stack.stack-4',
        h('p.t-sm.c-soft', 'Toca las ubicaciones que van en esta libreta. Las de un mismo '
          + 'rancho pueden repartirse entre las dos.'),
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
    const next = setup.lines.map((row) => {
      if (row.id === line.id) {
        return { ...row, farmIds: [], placeIds: [...chosen] };
      }
      const theirs = every
        .filter((one) => !chosen.has(one.key))
        .filter((one) => lineOfPlace(setup.lines, one.farm.id, one.place.id)?.id === row.id)
        .map((one) => one.key);
      return { ...row, farmIds: [], placeIds: theirs };
    });

    try {
      await savePacking(next, author());
      toastOk('Libreta guardada');
    } catch (error) { toastBad(errorText(error)); }
  }

  /* --- Who packs -------------------------------------------------------------- */

  function packerList() {
    return list(packers.map((packer) => itemRow({
      lead: h('span.pkpin', packer.pin || '····'),
      title: packer.name,
      meta: packer.active === false ? 'Dada de baja' : 'Puede empacar',
      end: packer.active === false ? badge('Inactiva', 'muted') : null,
      onClick: () => editPacker(packer),
    })), { card: true });
  }

  async function editPacker(packer) {
    const name = input({ value: packer?.name || '', placeholder: 'Nombre y apellido' });
    const pin = input({
      value: packer?.pin || '', inputmode: 'numeric', maxlength: 8,
      placeholder: '4 dígitos',
    });
    let active = packer ? packer.active !== false : true;

    const saved = await sheet({
      title: packer ? 'Editar a quien empaca' : 'Agregar a quien empaca',
      build: (close) => h('div.stack.stack-4',
        field({ label: 'Nombre', control: name }),
        field({
          label: 'Su número',
          hint: 'Lo escribe al empezar para que su nombre quede en la lista del día. '
            + 'No es una contraseña: no abre nada que no se pueda abrir sin él.',
          control: pin,
        }),
        switchRow('Puede empacar', {
          checked: active,
          onChange: (value) => { active = value; },
          hint: 'Apágalo cuando alguien deje de trabajar aquí.',
        }),
        asyncButton('Guardar', {
          variant: 'primary', size: 'lg', block: true,
          onClick: async () => {
            try {
              await savePacker({ id: packer?.id, name: name.value, pin: pin.value, active }, author());
              close(true);
            } catch (error) { toastBad(errorText(error)); }
          },
        }),
        packer
          ? button('Quitar de la lista', {
              variant: 'danger-soft', block: true,
              onClick: async () => {
                const sure = await confirm({
                  title: `¿Quitar a ${packer.name}?`,
                  message: 'Las mañanas que ya empacó siguen guardadas con su nombre.',
                  confirmLabel: 'Quitar', tone: 'danger', icon: 'alert',
                });
                if (!sure) return;
                try { await removePacker(packer.id); close(true); }
                catch (error) { toastBad(errorText(error)); }
              },
            })
          : null),
    });
    if (saved) toastOk('Listo');
  }

  const unsubscribe = subscribe(paint);
  return life.ending(unsubscribe, ...stops);
}
