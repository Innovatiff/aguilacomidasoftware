/**
 * Configuring the empaque — the manager's side of it.
 *
 * Two things get set here and they are set rarely: which farms belong to which
 * libreta, and who is allowed to pack with what number. Unlike the packing
 * screen itself this is an ordinary panel screen, because the person using it
 * is sitting down with the roster in front of them.
 *
 * The one thing it works hard at is the thing that goes wrong: a farm
 * registered in March that nobody puts on a list, whose people are then quietly
 * not packed for. Every farm is on this screen whether or not it has been
 * assigned, the unassigned ones are counted at the top, and a farm can only be
 * in one libreta — picking it for the second takes it out of the first, rather
 * than letting somebody pack the same food twice.
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
import { lineOfFarm, unassignedFarms, duplicatePins } from '../lib/packing.js';
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

    const orphans = unassignedFarms(setup.lines, store.farms);
    const clashes = duplicatePins(packers);

    return h('div.stack.stack-5',
      orphans.length
        ? alert(`${plural(orphans.length, 'rancho no está', 'ranchos no están')} en ninguna libreta. `
          + 'Su comida no se va a empacar: '
          + `${orphans.map((farm) => farm.name).join(', ')}.`, 'warn', 'alert')
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
        h('p.rnote', 'Cada rancho va en una sola libreta. Al ponerlo en una, sale de la otra.'),
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
    const mine = store.farms.filter((farm) => line.farmIds.includes(farm.id));
    const people = mine.reduce((sum, farm) =>
      sum + store.clients.filter((client) => client.farmId === farm.id).length, 0);

    return card(h('div.stack.stack-3',
      h('div.row.row--between',
        h('div',
          h('div.rmenu__t', line.name),
          h('div.rmenu__s', mine.length
            ? `${plural(mine.length, 'rancho', 'ranchos')} · ${plural(people, 'cliente', 'clientes')}`
            : 'Sin ranchos')),
        h('button.btn.btn--ghost.btn--sm', {
          type: 'button', onclick: () => renameLine(line),
        }, icon('edit'), 'Nombre')),

      mine.length
        ? h('div.pkchips', mine.map((farm) => h('span.pkchip', farm.name)))
        : h('p.t-sm.c-soft', 'Todavía no le has puesto ranchos.'),

      button('Escoger sus ranchos', {
        variant: 'soft', block: true, icon: 'farm', onClick: () => pickFarms(line),
      })));
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
   * Which farms this libreta packs.
   *
   * Every farm is listed, with the other libreta's ones marked — so the choice
   * is made against the whole roster rather than against a filtered half of it,
   * and taking one is visibly taking it from somewhere.
   */
  async function pickFarms(line) {
    const chosen = new Set(line.farmIds);
    const rows = h('div.stack.stack-2');

    const paintRows = () => rows.replaceChildren(...store.farms.map((farm) => {
      const other = lineOfFarm(setup.lines, farm.id);
      const elsewhere = other && other.id !== line.id;
      const on = chosen.has(farm.id);
      const count = store.clients.filter((client) => client.farmId === farm.id).length;

      return h(`button.pkpick${on ? '.is-on' : ''}`, {
        type: 'button',
        onclick: () => {
          if (on) chosen.delete(farm.id); else chosen.add(farm.id);
          paintRows();
        },
      },
        h('span.pkpick__box', on ? icon('check') : null),
        h('span.grow',
          h('span.pkpick__name', farm.name),
          h('span.pkpick__meta', `${plural(count, 'cliente', 'clientes')}`
            + (elsewhere ? ` · ahora está en ${other.name}` : ''))),
        elsewhere && !on ? badge('En la otra', 'warn') : null);
    }));
    paintRows();

    const done = await sheet({
      title: `Ranchos de ${line.name}`,
      build: (close) => h('div.stack.stack-4',
        h('p.t-sm.c-soft', 'Toca los ranchos que van en esta libreta.'),
        rows,
        button('Guardar', {
          variant: 'primary', size: 'lg', block: true, onClick: () => close(true),
        })),
    });
    if (!done) return;

    // Taking a farm for this libreta takes it out of the other one. Two lists
    // that both contain Mucci Farms is two people packing the same food.
    const next = setup.lines.map((row) => (row.id === line.id
      ? { ...row, farmIds: store.farms.filter((farm) => chosen.has(farm.id)).map((farm) => farm.id) }
      : { ...row, farmIds: row.farmIds.filter((id) => !chosen.has(id)) }));

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
