/**
 * Register / edit a farm.
 *
 * The commercial terms live here — meals per day, price per meal, the serving
 * weekdays and the billing anchor — because every invoice the software ever
 * produces is derived from them. The form shows the resulting bi-weekly total
 * as it is filled in, so a wrong price is caught before it becomes a bill.
 */

import { h, mount } from '../lib/dom.js';
import { screen } from '../ui/shell.js';
import {
  card, field, input, textarea, select, moneyInput, button, alert, sectionLabel, loading,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm } from '../ui/overlay.js';
import { go, back } from '../lib/router.js';
import { session } from '../data/session.js';
import {
  createClient, updateClient, getClient, emptyClient, deleteClient, setClientStatus,
  isValidEmail,
} from '../data/clients.js';
import { ensureConversation } from '../data/chat.js';
import { store } from '../data/store.js';
import { projectPeriod, periodFor, PERIOD_DAYS } from '../lib/billing.js';
import { WEEKDAYS_SHORT, today, formatRange } from '../lib/dates.js';
import { money } from '../lib/format.js';
import { dbMessage } from '../firebase.js';

export async function renderClientForm(context) {
  const clientId = context.params.id;
  const isNew = !clientId || clientId === 'new';

  let model = isNew
    ? emptyClient()
    : store.clients.find((c) => c.id === clientId) || await getClient(clientId);

  if (!model) {
    screen({ title: 'Rancho', backTo: '/clients', body: alert('Este rancho ya no existe.', 'bad') });
    return;
  }
  model = { ...emptyClient(), ...model };
  // Remembered before editing: updating the email has to retire the previous
  // lookup, or the old address would keep opening the app.
  const original = { email: model.email };

  let saving = false;
  let errors = {};

  const draw = () => screen({
    title: isNew ? 'Nuevo rancho' : 'Editar rancho',
    subtitle: isNew ? null : model.name,
    backTo: isNew ? '/clients' : `/clients/${clientId}`,
    tab: 'clients',
    body: saving ? loading() : form(),
  });

  function update(patch) {
    Object.assign(model, patch);
    // Only the live estimate depends on the changed values; re-rendering the
    // whole form here would blur the field being typed into.
    const preview = document.getElementById('cycle-preview');
    if (preview) mount(preview, cyclePreview());
  }

  function validate() {
    errors = {};
    if (!model.name?.trim()) errors.name = 'Escribe el nombre del rancho.';
    if (!(Number(model.mealsPerDay) > 0)) errors.mealsPerDay = 'Debe ser mayor a cero.';
    if (!(Number(model.pricePerMeal) > 0)) errors.pricePerMeal = 'Escribe el precio por comida.';
    if (!model.deliveryDays?.length) errors.deliveryDays = 'Elige al menos un día.';
    // The email is not a contact detail here: it is how the farm opens its app.
    if (!isValidEmail(model.email)) errors.email = 'Escribe el correo con el que entrará el encargado.';
    return Object.keys(errors).length === 0;
  }

  async function save(event) {
    event.preventDefault();
    if (!validate()) { draw(); toastBad('Revisa los campos marcados.'); return; }

    saving = true; draw();
    const author = { uid: session.uid, name: session.displayName };

    try {
      if (isNew) {
        const { id, email } = await createClient(model, author);
        await ensureConversation({ id, name: model.name });
        toastOk('Rancho registrado');
        go(`/clients/${id}?welcome=${encodeURIComponent(email)}`, { replace: true });
      } else {
        await updateClient(clientId, model, original.email);
        toastOk('Cambios guardados');
        go(`/clients/${clientId}`, { replace: true });
      }
    } catch (error) {
      saving = false; draw();
      toastBad(error?.message || dbMessage(error));
    }
  }

  function form() {
    return h('form.page__inner.stack.stack-4', { onsubmit: save, novalidate: true },

      sectionLabel('Identificación'),
      card(h('div.stack.stack-4',
        field({
          label: 'Nombre del rancho',
          error: errors.name,
          control: input({
            value: model.name, required: true, placeholder: 'Rancho El Sol',
            oninput: (e) => update({ name: e.target.value }),
          }),
        }),
        field({
          label: 'Persona de contacto',
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
          label: 'Correo de acceso',
          hint: 'Con este correo el encargado entra a la app del rancho. Es lo único que necesita.',
          error: errors.email,
          control: input({
            value: model.email, type: 'email', inputmode: 'email', required: true,
            placeholder: 'encargado@rancho.com',
            oninput: (e) => update({ email: e.target.value }),
          }),
        }),
        field({
          label: 'Dirección',
          control: textarea({
            value: model.address, rows: 2, placeholder: 'Camino y referencias para llegar',
            oninput: (e) => update({ address: e.target.value }),
          }),
        }))),

      sectionLabel('Servicio'),
      card(h('div.stack.stack-4',
        h('div.row', { style: { gap: '12px', alignItems: 'flex-start' } },
          h('div.grow', field({
            label: 'Comidas por día',
            error: errors.mealsPerDay,
            control: input({
              value: model.mealsPerDay, type: 'number', inputmode: 'numeric', min: '1', step: '1',
              oninput: (e) => update({ mealsPerDay: Number(e.target.value) }),
            }),
          })),
          h('div.grow', field({
            label: 'Precio por comida',
            error: errors.pricePerMeal,
            control: moneyInput({
              value: model.pricePerMeal,
              oninput: (e) => update({ pricePerMeal: Number(e.target.value) }),
            }),
          }))),

        field({
          label: 'Días de servicio',
          error: errors.deliveryDays,
          hint: 'Los días marcados aparecen en la ruta automáticamente.',
          control: weekdayPicker(model.deliveryDays, (days) => update({ deliveryDays: days })),
        }),

        field({
          label: 'Horario de entrega',
          control: input({
            value: model.deliveryWindow, placeholder: '11:00 – 13:00',
            oninput: (e) => update({ deliveryWindow: e.target.value }),
          }),
        }),

        field({
          label: 'Notas para el chofer',
          control: textarea({
            value: model.notes, rows: 2, placeholder: 'Entrar por el portón azul, preguntar por…',
            oninput: (e) => update({ notes: e.target.value }),
          }),
        }))),

      sectionLabel('Cobro'),
      card(h('div.stack.stack-4',
        field({
          label: 'Inicio del ciclo de cobro',
          hint: `Los periodos de ${PERIOD_DAYS} días se cuentan desde esta fecha.`,
          control: input({
            value: model.cycleAnchor, type: 'date',
            oninput: (e) => update({ cycleAnchor: e.target.value || today() }),
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
        h('div', { id: 'cycle-preview' }, cyclePreview()))),

      h('div.stack.stack-2', { style: { marginTop: '8px' } },
        h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' },
          isNew ? 'Registrar rancho' : 'Guardar cambios'),
        button('Cancelar', { variant: 'ghost', block: true, onClick: () => back('/clients') })),

      isNew ? null : dangerZone());
  }

  function cyclePreview() {
    const period = periodFor(model.cycleAnchor || today(), today());
    const projection = projectPeriod(model, period);
    if (!projection.amount) {
      return alert('Escribe las comidas por día y el precio para ver el estimado del periodo.', 'info');
    }
    return alert(
      `Periodo actual ${formatRange(period.start, period.end)}: ${projection.days} días de servicio, `
      + `${projection.meals} comidas ≈ ${money(projection.amount)}.`,
      'brand', 'receipt');
  }

  function dangerZone() {
    return h('div.stack.stack-3', { style: { marginTop: '8px' } },
      sectionLabel('Zona delicada'),
      model.status === 'active'
        ? button('Poner en pausa', {
            variant: 'ghost', block: true, icon: 'pause',
            onClick: async () => {
              if (!await confirm({
                title: 'Poner en pausa',
                message: 'El rancho dejará de aparecer en las rutas nuevas. Sus facturas y su historial se conservan.',
                confirmLabel: 'Poner en pausa', icon: 'pause',
              })) return;
              await setClientStatus(clientId, 'paused');
              toastOk('Rancho en pausa');
              go(`/clients/${clientId}`);
            },
          })
        : button('Reactivar rancho', {
            variant: 'ok', block: true, icon: 'play',
            onClick: async () => {
              await setClientStatus(clientId, 'active');
              toastOk('Rancho reactivado');
              go(`/clients/${clientId}`);
            },
          }),
      button('Eliminar rancho', {
        variant: 'danger-soft', block: true, icon: 'ban',
        onClick: async () => {
          if (!await confirm({
            title: `Eliminar ${model.name}`,
            message: 'Se borra el rancho y el acceso de su correo a la app. Las entregas y facturas ya registradas no se eliminan. Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar definitivamente', tone: 'danger', icon: 'alert',
          })) return;
          try {
            await deleteClient(clientId, model.email);
            toastOk('Rancho eliminado');
            go('/clients', { replace: true });
          } catch (error) {
            toastBad(dbMessage(error));
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

  const wrap = h('div.row.row--wrap', { style: { gap: '6px' } },
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

  return wrap;
}
