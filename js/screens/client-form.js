/**
 * Register / edit a client — one of the people who eat at a farm.
 *
 * Two fields decide everything and neither can be skipped: the farm they work
 * at and the location inside it where the food is left. The serving days, the
 * delivery window and the billing cycle belong to the farm and are shown here
 * read-only.
 *
 * What is genuinely theirs is how many meals they take — which is also the
 * plan they are billed on, so the fortnight's price appears the moment it is
 * chosen — their phone, and the email they use to open the app. That last one
 * is optional: most workers do not have one on the day they are registered, and
 * a roster that cannot be built is worse than one where some people cannot log
 * in yet.
 */

import { h, mount } from '../lib/dom.js';
import { screen } from '../ui/shell.js';
import {
  card, field, input, textarea, select, button, alert, sectionLabel, loading,
  defList, defRow, emptyState,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm } from '../ui/overlay.js';
import { go, back } from '../lib/router.js';
import { session } from '../data/session.js';
import {
  createClient, updateClient, getClient, emptyClient, deleteClient, setClientStatus,
  isValidEmail, termsOf,
} from '../data/clients.js';
import { ensureConversation } from '../data/chat.js';
import { store, farmById, clientsOfFarm } from '../data/store.js';
import { openChargeSheet } from '../ui/charge-sheet.js';
import { projectPeriod, periodFor } from '../lib/billing.js';
import { priceFor, tierFor } from '../lib/pricing.js';
import { today, formatRange, formatDayLong } from '../lib/dates.js';
import { money, plural } from '../lib/format.js';
import { dbMessage } from '../firebase.js';

export async function renderClientForm(context) {
  const clientId = context.params.id;
  const isNew = !clientId || clientId === 'new';

  let model = isNew
    ? emptyClient(farmById(context.query.farm))
    : store.clients.find((c) => c.id === clientId) || await getClient(clientId);

  if (!model) {
    screen({
      title: 'Cliente', backTo: '/clients', tab: 'clients',
      body: h('div.page__inner', alert('Este cliente ya no existe.', 'bad')),
    });
    return;
  }

  if (isNew) {
    // Arriving from a location's menu pre-selects that location.
    if (context.query.location) model.locationId = context.query.location;
  } else {
    model = { ...emptyClient(farmById(model.farmId)), ...model };
  }

  // Remembered before editing: moving the email has to retire the previous
  // lookup, or the old address would keep opening the app.
  const original = { email: model.email };

  let saving = false;
  let errors = {};

  const farm = () => farmById(model.farmId);

  const draw = () => screen({
    title: isNew ? 'Nuevo cliente' : 'Editar cliente',
    subtitle: isNew ? (farm()?.name || null) : model.name,
    backTo: isNew ? (model.farmId ? `/farms/${model.farmId}` : '/clients') : `/clients/${clientId}`,
    tab: 'clients',
    body: saving ? loading() : form(),
  });

  /** Field edits that do not change the shape of the form. */
  function update(patch) {
    Object.assign(model, patch);
    const preview = document.getElementById('client-preview');
    if (preview) mount(preview, previewCard());
  }

  /** Edits that do — picking a farm changes which locations exist. */
  function updateAndRedraw(patch) {
    Object.assign(model, patch);
    draw();
  }

  function validate() {
    errors = {};
    if (!model.name?.trim()) errors.name = 'Escribe el nombre de la persona.';
    if (!model.farmId) errors.farmId = 'Elige el rancho.';
    if (!model.locationId) errors.locationId = 'Elige dónde está. Es obligatorio.';
    if (!(Number(model.mealsPerDay) > 0)) errors.mealsPerDay = 'Debe ser mayor a cero.';
    if (model.email && !isValidEmail(model.email)) errors.email = 'Ese correo no es válido.';
    return Object.keys(errors).length === 0;
  }

  async function save(event) {
    event.preventDefault();
    if (!validate()) { draw(); toastBad('Revisa los campos marcados.'); return; }

    saving = true; draw();
    const author = { uid: session.uid, name: session.displayName };

    try {
      if (isNew) {
        const { id, email } = await createClient(model, farm(), author);
        await ensureConversation({ id, name: model.name });
        toastOk('Cliente registrado');

        // Most people are registered standing at the counter, and they pay
        // then and there. Offering it here saves finding them again.
        const receipt = priceFor(store.pricing, model.mealsPerDay)
          ? await offerPayment({ ...model, id }, author)
          : null;
        if (receipt) {
          go(`/receipts/${receipt.id}`, { replace: true });
          return;
        }

        go(`/clients/${id}${email ? `?welcome=${encodeURIComponent(email)}` : ''}`, { replace: true });
      } else {
        await updateClient(clientId, model, original.email, farm());
        toastOk('Cambios guardados');
        go(`/clients/${clientId}`, { replace: true });
      }
    } catch (error) {
      saving = false; draw();
      toastBad(error?.message || dbMessage(error));
    }
  }

  /**
   * "They are paying now" — asked once, right after registering.
   *
   * Answering no is the common case and costs one tap; answering yes skips a
   * search, a screen and a scroll while somebody is standing there with cash.
   */
  async function offerPayment(client, author) {
    const price = priceFor(store.pricing, client.mealsPerDay);
    const wants = await confirm({
      title: '¿Va a pagar ahora?',
      message: `${client.name} quedó registrado. Su quincena cuesta ${money(price)}. `
        + 'Si está pagando en este momento, cóbrale aquí mismo y se le manda su recibo.',
      confirmLabel: 'Cobrar ahora',
      cancelLabel: 'Después',
      icon: 'cash',
    });
    if (!wants) return null;

    return openChargeSheet({ client, invoices: [], tiers: store.pricing, author });
  }

  /* --- Form ---------------------------------------------------------------- */

  function form() {
    if (!store.farms.length) return noFarms();

    return h('form.page__inner.stack.stack-4', { onsubmit: save, novalidate: true },

      sectionLabel('Dónde come'),
      card(h('div.stack.stack-4',
        field({
          label: 'Rancho',
          error: errors.farmId,
          control: select({
            value: model.farmId,
            options: [
              { value: '', label: 'Elige el rancho…' },
              ...store.farms.map((row) => ({ value: row.id, label: row.name })),
            ],
            // Changing farm invalidates the chosen location: they belong to it.
            onchange: (e) => updateAndRedraw({ farmId: e.target.value, locationId: '' }),
          }),
        }),
        locationField())),

      sectionLabel('La persona'),
      card(h('div.stack.stack-4',
        field({
          label: 'Nombre',
          error: errors.name,
          control: input({
            value: model.name, required: true, placeholder: 'Nombre y apellido',
            oninput: (e) => update({ name: e.target.value }),
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
          label: 'Correo para la app',
          hint: 'Opcional. Con este correo entra a su app y ve su entrega y su cuenta. '
            + 'Si todavía no tiene, déjalo vacío.',
          error: errors.email,
          control: input({
            value: model.email, type: 'email', inputmode: 'email',
            placeholder: 'persona@correo.com',
            oninput: (e) => update({ email: e.target.value }),
          }),
        }),
        field({
          label: 'Notas',
          control: textarea({
            value: model.notes, rows: 2, placeholder: 'Alergias, horario distinto, quién recibe…',
            oninput: (e) => update({ notes: e.target.value }),
          }),
        }))),

      sectionLabel('Su servicio'),
      card(h('div.stack.stack-4',
        field({
          label: 'Plan',
          error: errors.mealsPerDay,
          hint: 'Cuántas comidas lleva al día. De ahí sale lo que paga por quincena.',
          control: planPicker(),
        }),
        field({
          label: 'Estado',
          control: select({
            value: model.status,
            options: [
              { value: 'active', label: 'Activo — recibe comida' },
              { value: 'paused', label: 'En pausa — sin entregas por ahora' },
              { value: 'inactive', label: 'Inactivo — ya no come aquí' },
            ],
            onchange: (e) => update({ status: e.target.value }),
          }),
        }),
        h('div', { id: 'client-preview' }, previewCard()))),

      h('div.stack.stack-2', { style: { marginTop: '8px' } },
        h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' },
          isNew ? 'Registrar cliente' : 'Guardar cambios'),
        button('Cancelar', {
          variant: 'ghost', block: true,
          onClick: () => back(model.farmId ? `/farms/${model.farmId}` : '/clients'),
        })),

      isNew ? null : dangerZone());
  }

  /**
   * The location picker — the reason this screen exists in this shape.
   *
   * A farm with no locations yet cannot take anybody, so instead of an empty
   * dropdown the field sends you to create one.
   */
  function locationField() {
    const current = farm();

    if (!current) {
      return field({
        label: 'Ubicación',
        control: select({ value: '', options: [{ value: '', label: 'Elige primero el rancho…' }], disabled: true }),
      });
    }

    const places = current.locations || [];
    if (!places.length) {
      return field({
        label: 'Ubicación',
        error: errors.locationId,
        control: h('div.stack.stack-3',
          alert(`${current.name} todavía no tiene ubicaciones. Agrega una para poder registrar `
            + 'gente ahí.', 'warn'),
          button('Agregar ubicación', {
            variant: 'ghost', block: true, icon: 'pin',
            onClick: () => go(`/farms/${current.id}`),
          })),
      });
    }

    return field({
      label: 'Ubicación',
      hint: 'Dónde se le deja la comida. Obligatorio.',
      error: errors.locationId,
      control: select({
        value: model.locationId,
        options: [
          { value: '', label: 'Elige la ubicación…' },
          ...places.map((place) => ({
            value: place.id,
            label: `${place.name} · ${plural(clientsAt(current.id, place.id), 'cliente', 'clientes')}`,
          })),
        ],
        onchange: (e) => update({ locationId: e.target.value }),
      }),
    });
  }

  /**
   * The plan is picked, not typed: every price the business charges is on the
   * list, so choosing from it makes an unbillable client impossible to create.
   */
  function planPicker() {
    const known = store.pricing.map((tier) => ({
      value: String(tier.mealsPerDay),
      label: `${plural(tier.mealsPerDay, 'comida', 'comidas')} al día · ${money(tier.price)} por quincena`,
    }));
    const current = String(Number(model.mealsPerDay) || '');
    const offList = current && !known.some((option) => option.value === current);

    return h('div.stack.stack-2',
      select({
        value: current,
        options: [
          { value: '', label: 'Elige el plan…' },
          ...known,
          ...(offList
            ? [{ value: current, label: `${plural(model.mealsPerDay, 'comida', 'comidas')} al día · sin precio` }]
            : []),
        ],
        onchange: (event) => updateAndRedraw({ mealsPerDay: Number(event.target.value) }),
      }),
      offList
        ? alert('Ese plan no tiene precio. Agrégalo en Ajustes → Precios o elige otro; '
          + 'mientras tanto no se le puede cobrar.', 'warn')
        : null);
  }

  /** What this person gets and what a fortnight of it costs. */
  function previewCard() {
    const current = farm();
    if (!current) return alert('Elige el rancho para ver sus condiciones.', 'info');

    const terms = termsOf(current);
    const period = periodFor(terms.cycleAnchor, today());
    const projection = projectPeriod({ ...terms, mealsPerDay: model.mealsPerDay }, period, store.pricing);
    const priced = !!tierFor(store.pricing, model.mealsPerDay);

    return h('div.stack.stack-3',
      alert(`Servicio de ${current.name}. Para cambiarlo, edita el rancho.`, 'info'),
      card(defList([
        defRow('Días de servicio', `${projection.days} en el periodo`),
        defRow('Horario', terms.deliveryWindow || '—'),
        defRow('Inicio del ciclo', formatDayLong(terms.cycleAnchor)),
        defRow('Comidas en la quincena', String(projection.meals)),
        defRow(`Quincena ${formatRange(period.start, period.end)}`,
          priced ? money(projection.amount) : 'Sin precio', { total: true }),
      ])));
  }

  function noFarms() {
    return h('div.page__inner', emptyState({
      icon: 'farm',
      title: 'Primero registra un rancho',
      text: 'Los clientes viven dentro de un rancho y de una de sus ubicaciones, así que el '
        + 'rancho va primero.',
      action: button('Registrar rancho', { icon: 'plus', onClick: () => go('/farms/new') }),
    }));
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
                message: 'Deja de aparecer en las rutas nuevas. Sus facturas y su historial se conservan.',
                confirmLabel: 'Poner en pausa', icon: 'pause',
              })) return;
              await setClientStatus(clientId, 'paused');
              toastOk('Cliente en pausa');
              go(`/clients/${clientId}`);
            },
          })
        : button('Reactivar cliente', {
            variant: 'ok', block: true, icon: 'play',
            onClick: async () => {
              await setClientStatus(clientId, 'active');
              toastOk('Cliente reactivado');
              go(`/clients/${clientId}`);
            },
          }),
      button('Eliminar cliente', {
        variant: 'danger-soft', block: true, icon: 'ban',
        onClick: async () => {
          if (!await confirm({
            title: `Eliminar ${model.name}`,
            message: 'Se borra la ficha y el acceso de su correo a la app. Las entregas y facturas '
              + 'ya registradas no se eliminan. Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar definitivamente', tone: 'danger', icon: 'alert',
          })) return;
          try {
            await deleteClient(clientId, model.email);
            toastOk('Cliente eliminado');
            go(model.farmId ? `/farms/${model.farmId}` : '/clients', { replace: true });
          } catch (error) {
            toastBad(dbMessage(error));
          }
        },
      }));
  }

  draw();
}

const clientsAt = (farmId, locationId) =>
  clientsOfFarm(farmId).filter((client) => client.locationId === locationId).length;
