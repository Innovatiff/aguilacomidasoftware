/**
 * Register / edit a farm.
 *
 * The service terms live here, not on the worker: one serving week, one
 * delivery window, one billing anchor for everybody who eats at this place.
 * That is how the agreement is actually made — with the farm, once.
 *
 * What a fortnight *costs* is not here: it is one price list for the whole
 * business (Ajustes → Precios), charged by plan. A farm decides when food
 * arrives, not what it costs.
 *
 * Because these numbers are already copied onto every worker registered here,
 * saving a change fans them back out. The form says so before it happens.
 */

import { h, mount } from '../lib/dom.js';
import { screen } from '../ui/shell.js';
import {
  card, field, input, textarea, select, button, alert, sectionLabel, loading,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm } from '../ui/overlay.js';
import { go, back } from '../lib/router.js';
import { session } from '../data/session.js';
import {
  createFarm, updateFarm, getFarm, emptyFarm, deleteFarm, setFarmStatus, TERM_FIELDS,
} from '../data/farms.js';
import { farmById, clientsOfFarm } from '../data/store.js';
import {
  periodFor, PAY_EVERY, servingDays, payDayOnOrAfter, payDaysInWords, periodWord,
} from '../lib/billing.js';
import { WEEKDAYS_SHORT, today, formatRange } from '../lib/dates.js';
import { plural } from '../lib/format.js';
import { dbMessage } from '../firebase.js';

export async function renderFarmForm(context) {
  const farmId = context.params.id;
  const isNew = !farmId || farmId === 'new';

  let model = isNew ? emptyFarm() : farmById(farmId) || await getFarm(farmId);

  if (!model) {
    screen({
      title: 'Rancho', backTo: '/farms', tab: 'farms',
      body: h('div.page__inner', alert('Este rancho ya no existe.', 'bad')),
    });
    return;
  }

  // What the terms were before this edit — the fan-out compares against it.
  const previous = { ...model };
  model = { ...emptyFarm(), ...model };


  let saving = false;
  let errors = {};

  const draw = () => screen({
    title: isNew ? 'Nuevo rancho' : 'Editar rancho',
    subtitle: isNew ? null : model.name,
    backTo: isNew ? '/farms' : `/farms/${farmId}`,
    tab: 'farms',
    body: saving ? loading() : form(),
  });

  function update(patch) {
    Object.assign(model, patch);
    // Only the estimate depends on the changed values; re-rendering the whole
    // form here would blur the field being typed into.
    const preview = document.getElementById('terms-preview');
    if (preview) mount(preview, termsPreview());
  }

  function validate() {
    errors = {};
    if (!model.name?.trim()) errors.name = 'Escribe el nombre del rancho.';
    if (!model.deliveryDays?.length) errors.deliveryDays = 'Elige al menos un día.';
    return Object.keys(errors).length === 0;
  }

  async function save(event) {
    event.preventDefault();
    if (!validate()) { draw(); toastBad('Revisa los campos marcados.'); return; }

    // Changing terms rewrites every worker's copy. Say how many before doing it.
    if (!isNew && termsChanged() && clientsOfFarm(farmId).length) {
      const roster = clientsOfFarm(farmId).length;
      const ok = await confirm({
        title: 'Aplicar a todo el rancho',
        message: `Las nuevas condiciones se copiarán a ${plural(roster, 'cliente', 'clientes')} de ${model.name}. `
          + 'Las facturas ya emitidas no cambian.',
        confirmLabel: 'Guardar y aplicar',
        icon: 'users',
      });
      if (!ok) return;
    }

    saving = true; draw();

    try {
      if (isNew) {
        const { id } = await createFarm(model, { uid: session.uid, name: session.displayName });
        toastOk('Rancho registrado');
        go(`/farms/${id}`, { replace: true });
      } else {
        await updateFarm(farmId, model, previous);
        toastOk('Cambios guardados');
        go(`/farms/${farmId}`, { replace: true });
      }
    } catch (error) {
      saving = false; draw();
      toastBad(error?.message || dbMessage(error));
    }
  }

  const termsChanged = () => TERM_FIELDS.some(
    (key) => JSON.stringify(model[key]) !== JSON.stringify(previous[key]));

  function form() {
    return h('form.page__inner.page__inner--narrow.stack.stack-4', { onsubmit: save, novalidate: true },

      sectionLabel('El rancho'),
      card(h('div.stack.stack-4',
        field({
          label: 'Nombre del rancho',
          error: errors.name,
          control: input({
            value: model.name, required: true, placeholder: 'Mucci Farms',
            oninput: (e) => update({ name: e.target.value }),
          }),
        }),
        field({
          label: 'Persona de contacto',
          hint: 'El encargado o supervisor con quien trata la cocina.',
          control: input({
            value: model.contactName, placeholder: 'Nombre del encargado',
            oninput: (e) => update({ contactName: e.target.value }),
          }),
        }),
        field({
          label: 'Teléfono',
          control: input({
            value: model.phone, type: 'tel', inputmode: 'tel', placeholder: '(604) 555-0143',
            oninput: (e) => update({ phone: e.target.value }),
          }),
        }),
        field({
          label: 'Dirección',
          control: textarea({
            value: model.address, rows: 2, placeholder: 'Camino y referencias para llegar',
            oninput: (e) => update({ address: e.target.value }),
          }),
        }),
        field({
          label: 'Notas para el chofer',
          control: textarea({
            value: model.notes, rows: 2, placeholder: 'Entrar por el portón azul, preguntar por…',
            oninput: (e) => update({ notes: e.target.value }),
          }),
        }))),

      sectionLabel('Servicio para todos sus clientes'),
      card(h('div.stack.stack-4',
        field({
          label: 'Comidas por persona',
          hint: 'Valor inicial al registrar a alguien aquí. El precio del periodo sale de '
            + 'ese número, según los planes en Ajustes.',
          control: input({
            value: model.defaultMealsPerDay, type: 'number', inputmode: 'numeric', min: '1', step: '1',
            oninput: (e) => update({ defaultMealsPerDay: Number(e.target.value) }),
          }),
        }),

        field({
          label: 'Días de servicio',
          error: errors.deliveryDays,
          hint: 'Con qué días empieza alguien registrado aquí. Cada cliente puede tener los '
            + 'suyos: hay quien come de lunes a viernes y quien lleva una comida extra el '
            + 'sábado. Cambiar esto no toca a los que ya están.',
          control: weekdayPicker(model.deliveryDays, (days) => update({ deliveryDays: days })),
        }),

        field({
          label: 'Horario de entrega',
          control: input({
            value: model.deliveryWindow, placeholder: '11:00 – 13:00',
            oninput: (e) => update({ deliveryWindow: e.target.value }),
          }),
        }))),

      sectionLabel('Cobro'),
      card(h('div.stack.stack-4',
        field({
          label: 'Cada cuánto pagan, por defecto',
          hint: 'Con qué periodo arranca alguien registrado aquí. Cada cliente puede tener el '
            + 'suyo: en un mismo rancho hay quien paga cada semana y quien paga cada quincena. '
            + 'Cambiar esto no toca a los que ya están.',
          control: select({
            value: String(model.defaultPayEvery ?? PAY_EVERY.FORTNIGHT),
            options: [
              { value: String(PAY_EVERY.FORTNIGHT), label: 'Cada quincena — 14 días' },
              { value: String(PAY_EVERY.WEEK), label: 'Cada semana — 7 días' },
            ],
            onchange: (e) => { update({ defaultPayEvery: Number(e.target.value) }); draw(); },
          }),
        }),
        field({
          label: 'Inicio del ciclo para clientes nuevos',
          hint: `Se cobra en ${payDaysInWords()}. Esto sólo decide desde qué día arranca `
            + 'alguien registrado aquí a partir de ahora: el periodo de cada cliente es suyo y '
            + 'se ajusta en su ficha, con su último pago.',
          control: input({
            value: model.cycleAnchor, type: 'date',
            // Snapped: a cycle that does not start on a collection day would
            // put every new person here on a day the kitchen never collects.
            // Snapping changes the value in the box, so the field has to be
            // redrawn rather than patched in place.
            onchange: (e) => {
              update({ cycleAnchor: payDayOnOrAfter(e.target.value || today()) });
              draw();
            },
          }),
        }),
        field({
          label: 'Días de gracia para pagar',
          hint: 'Días después de cerrar el periodo antes de marcarlo como vencido.',
          control: select({
            value: String(model.graceDays),
            options: [0, 1, 2, 3, 5, 7].map((n) => ({ value: String(n), label: n === 0 ? 'Mismo día' : `${n} días` })),
            onchange: (e) => update({ graceDays: Number(e.target.value) }),
          }),
        }),
        field({
          label: 'Estado',
          control: select({
            value: model.status,
            options: [
              { value: 'active', label: 'Activo — recibe comida' },
              { value: 'paused', label: 'En pausa — sin entregas por ahora' },
              { value: 'inactive', label: 'Inactivo — ya no es cliente' },
            ],
            onchange: (e) => update({ status: e.target.value }),
          }),
        }),
        h('div', { id: 'terms-preview' }, termsPreview()))),

      h('div.stack.stack-2', { style: { marginTop: '8px' } },
        h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' },
          isNew ? 'Registrar rancho' : 'Guardar cambios'),
        button('Cancelar', { variant: 'ghost', block: true, onClick: () => back('/farms') })),

      isNew ? null : dangerZone());
  }

  /** What this farm's week actually looks like — the thing to sanity-check. */
  function termsPreview() {
    const every = Number(model.defaultPayEvery) === PAY_EVERY.WEEK
      ? PAY_EVERY.WEEK : PAY_EVERY.FORTNIGHT;
    const period = periodFor(model.cycleAnchor || today(), today(), every);
    const days = servingDays(period, model.deliveryDays).length;
    const perDay = Number(model.defaultMealsPerDay) || 0;

    if (!days) {
      return alert('Elige los días de servicio para ver cómo queda el periodo.', 'info');
    }
    return alert(
      `Periodo actual ${formatRange(period.start, period.end)}: ${days} días de servicio. `
      + `Una persona con ${plural(perDay, 'comida', 'comidas')} al día recibe `
      + `${days * perDay} comidas en la ${periodWord({ payEvery: every })}.`,
      'brand', 'receipt');
  }

  function dangerZone() {
    const roster = clientsOfFarm(farmId).length;

    return h('div.stack.stack-3', { style: { marginTop: '8px' } },
      sectionLabel('Zona delicada'),
      model.status === 'active'
        ? button('Poner el rancho en pausa', {
            variant: 'ghost', block: true, icon: 'pause',
            onClick: async () => {
              if (!await confirm({
                title: 'Poner en pausa',
                message: 'El rancho deja de aparecer al generar rutas. Sus clientes, facturas e historial se conservan.',
                confirmLabel: 'Poner en pausa', icon: 'pause',
              })) return;
              await setFarmStatus(farmId, 'paused');
              toastOk('Rancho en pausa');
              go(`/farms/${farmId}`);
            },
          })
        : button('Reactivar rancho', {
            variant: 'ok', block: true, icon: 'play',
            onClick: async () => {
              await setFarmStatus(farmId, 'active');
              toastOk('Rancho reactivado');
              go(`/farms/${farmId}`);
            },
          }),
      button('Eliminar rancho', {
        variant: 'danger-soft', block: true, icon: 'ban',
        onClick: async () => {
          if (roster) {
            toastBad(`Primero mueve o elimina sus ${roster} clientes.`);
            return;
          }
          if (!await confirm({
            title: `Eliminar ${model.name}`,
            message: 'Se borra el rancho y sus ubicaciones. Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar definitivamente', tone: 'danger', icon: 'alert',
          })) return;
          try {
            await deleteFarm(farmId);
            toastOk('Rancho eliminado');
            go('/farms', { replace: true });
          } catch (error) {
            toastBad(error?.message || dbMessage(error));
          }
        },
      }));
  }

  draw();
}

/** Weekday toggles — Sunday last, matching how the week is spoken about here. */
function weekdayPicker(selected, onChange) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const chosen = new Set(selected || []);

  return h('div.row.row--wrap', { style: { gap: '6px' } },
    order.map((day) => {
      const node = h(`button.chip${chosen.has(day) ? '.is-active' : ''}`, {
        type: 'button',
        style: { minWidth: '46px', textAlign: 'center', justifyContent: 'center' },
        onclick: () => {
          if (chosen.has(day)) chosen.delete(day); else chosen.add(day);
          node.classList.toggle('is-active', chosen.has(day));
          onChange([...chosen].sort((a, b) => a - b));
        },
      }, WEEKDAYS_SHORT[day]);
      return node;
    }));
}
