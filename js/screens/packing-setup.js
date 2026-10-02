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
  skeletonRows, dataErrorCard, emptyState, list, itemRow, badge, switchRow, avatar,
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
    const mine = placesOf(setup.lines, line.id, store.farms, store.clients);
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
      // The other libreta keeps exactly what it had. Nothing on this sheet can
      // take from it — that is the whole point of the lock.
      const theirs = every
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
