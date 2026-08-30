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
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import {
  card, field, fieldGroup, input, textarea, select, button, alert, sectionLabel,
  loading, defList, defRow, emptyState, badge, chargeRows,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm } from '../ui/overlay.js';
import { go, back } from '../lib/router.js';
import { session } from '../data/session.js';
import {
  createClient, updateClient, getClient, emptyClient, deleteClient, setClientStatus,
  isValidEmail, termsOf, cleanTag, normalizeTags, tagsInUse, hasTag, servingSince,
} from '../data/clients.js';
import { ensureConversation } from '../data/chat.js';
import { store, farmById, clientsOfFarm } from '../data/store.js';
import { openChargeSheet } from '../ui/charge-sheet.js';
import { openOpeningSheet } from '../ui/opening-sheet.js';
import {
  periodFor, payDayAfter, isPayDay, payDayOnOrAfter, payDaysInWords,
} from '../lib/billing.js';
import { chargeFor, tierFor, fortnightCharge, mealsOn } from '../lib/pricing.js';
import {
  today, addDays, formatRange, formatDayLong, formatDay, weekdayOf, WEEKDAYS, capitalize,
} from '../lib/dates.js';
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
    // Read before the merge: `emptyClient` defaults this to today, and letting
    // that default win would quietly re-date somebody who has been eating here
    // for a year to this morning — and with it, which fortnights they owe.
    const since = servingSince(model);
    model = { ...emptyClient(farmById(model.farmId)), ...model };
    if (since) model.startedOn = since;
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

  /** Says, in words, what the date they picked means for this person. */
  function cycleHint() {
    const day = model.cycleAnchor || payDayOnOrAfter(today());
    const period = periodFor(day, today());
    return `Se cobra en ${payDaysInWords()}. Su quincena corre ahora del `
      + `${formatDay(period.start)} al ${formatDay(period.end)}, `
      + `y paga otra vez el ${capitalize(WEEKDAYS[weekdayOf(payDayAfter(period))])} `
      + `${formatDay(payDayAfter(period))}.`;
  }

  function validate() {
    errors = {};
    if (!model.name?.trim()) errors.name = 'Escribe el nombre de la persona.';
    if (!model.farmId) errors.farmId = 'Elige el rancho.';
    if (!model.locationId) errors.locationId = 'Elige dónde está. Es obligatorio.';
    if (!(Number(model.mealsPerDay) > 0)) errors.mealsPerDay = 'Debe ser mayor a cero.';
    if (model.email && !isValidEmail(model.email)) errors.email = 'Ese correo no es válido.';
    if (model.cycleAnchor && !isPayDay(model.cycleAnchor)) {
      errors.cycleAnchor = `La quincena empieza en ${payDaysInWords()}.`;
    }
    if (model.endsOn && model.cycleAnchor && model.endsOn < model.cycleAnchor) {
      errors.endsOn = 'No puede terminar antes de que empiece su quincena.';
    }
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

        const fresh = { ...model, id };

        // Most of these people were already customers, on paper. Asking now —
        // while their file is open and the notebook is in hand — is the only
        // moment the balance realistically gets carried over.
        if (chargeFor(fresh, store.pricing)) {
          await offerOpeningBalance(fresh, author);

          // And they are usually standing at the counter, so the other
          // question worth asking once is whether they are paying today.
          const receipt = await offerPayment(fresh, author);
          if (receipt) {
            go(`/receipts/${receipt.id}`, { replace: true });
            return;
          }
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
   * "Did they already owe you?" — asked once, right after registering.
   *
   * Skipping it is one tap. Saying yes opens the sheet that turns a date from
   * the notebook into the fortnights it left open.
   */
  async function offerOpeningBalance(client, author) {
    const wants = await confirm({
      title: '¿Ya venía pagando?',
      message: `Si ${client.name} ya era cliente antes del sistema, dinos cuándo pagó por última `
        + 'vez y calculamos lo que quedó debiendo. Si empieza hoy, no hace falta.',
      confirmLabel: 'Traer saldo del cuaderno',
      cancelLabel: 'Empieza hoy',
      icon: 'clipboard',
    });
    if (!wants) return 0;

    return openOpeningSheet({ client, pricing: store.pricing, author });
  }

  /**
   * "They are paying now" — asked once, right after registering.
   *
   * Answering no is the common case and costs one tap; answering yes skips a
   * search, a screen and a scroll while somebody is standing there with cash.
   */
  async function offerPayment(client, author) {
    const price = chargeFor(client, store.pricing);
    const wants = await confirm({
      title: '¿Va a pagar ahora?',
      message: `${client.name} quedó registrado. Su quincena cuesta ${money(price)}. `
        + 'Si está pagando en este momento, cóbrale aquí mismo y se le manda su recibo.',
      confirmLabel: 'Cobrar ahora',
      cancelLabel: 'Después',
      icon: 'cash',
    });
    if (!wants) return null;

    return openChargeSheet({ client, invoices: [], pricing: store.pricing, author });
  }

  /* --- Form ---------------------------------------------------------------- */

  function form() {
    if (!store.farms.length) return noFarms();

    return h('form.page__inner.page__inner--narrow.stack.stack-4', { onsubmit: save, novalidate: true },

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
        // Not `field`: this control has buttons of its own, and a <label>
        // would hand their clicks to the text box instead.
        fieldGroup({
          label: 'No puede comer',
          hint: 'Lo que hay que dejar fuera de su comida. Aparece en la ruta y en la lista '
            + 'de clientes, sin tener que abrir su ficha.',
          control: tagEditor(),
        }),

        field({
          label: 'Notas',
          control: textarea({
            value: model.notes, rows: 2, placeholder: 'Horario distinto, quién recibe, cómo llegar…',
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

        // Not `field`: the week has a stepper on every row, and a <label>
        // would hand their clicks to whatever input it finds first.
        fieldGroup({
          label: 'Su semana',
          error: errors.deliveryDays,
          hint: 'Los días que recibe y cuántas comidas cada día. El precio se ajusta solo.',
          control: weekEditor(),
        }),
        field({
          label: '¿Desde cuándo come aquí?',
          hint: 'Decide desde qué quincena se le cobra. El panel nunca le factura una '
            + 'quincena que cerró antes de esta fecha.',
          control: input({
            type: 'date',
            value: model.startedOn || today(),
            max: today(),
            onchange: (e) => update({ startedOn: e.target.value || today() }),
          }),
        }),
        field({
          label: 'Día de pago',
          error: errors.cycleAnchor,
          hint: cycleHint(),
          control: input({
            type: 'date',
            value: model.cycleAnchor || payDayOnOrAfter(today()),
            // Snapped rather than refused: somebody typing "pagó el 28" means
            // the fortnight that starts on the next collection day, and making
            // them hunt for the right square helps nobody.
            onchange: (e) => updateAndRedraw({
              cycleAnchor: payDayOnOrAfter(e.target.value || today()),
            }),
          }),
        }),
        field({
          label: 'Último día que se le sirve',
          hint: 'Sólo cuando ya se sabe que se va: "pagó y se queda hasta el jueves". '
            + 'Desde el día siguiente deja de aparecer en la libreta y no se le factura. '
            + 'Déjalo vacío si sigue.',
          control: h('div.stack.stack-2',
            input({
              type: 'date',
              value: model.endsOn || '',
              min: today(),
              onchange: (e) => updateAndRedraw({ endsOn: e.target.value || '' }),
            }),
            h('div.row.row--wrap', { style: { gap: '6px' } },
              [['Hoy', 0], ['Mañana', 1], ['En 2 días', 2], ['En 7 días', 7]].map(
                ([label, days]) => button(label, {
                  variant: 'soft', size: 'sm',
                  onClick: () => updateAndRedraw({ endsOn: addDays(today(), days) }),
                })),
              model.endsOn
                ? button('Sin fecha', {
                    variant: 'ghost', size: 'sm',
                    onClick: () => updateAndRedraw({ endsOn: '' }),
                  })
                : null)),
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
   * Restrictions: pick from what the kitchen already uses, or type a new one.
   *
   * The suggestions are the point. Left to a free-text box, "sin pollo" becomes
   * "Sin Pollo", "no pollo" and "sin pollo." within a month, and then nobody
   * can count how many portions to leave chicken out of. Offering the existing
   * spellings first means the common ones stay one thing.
   */
  function tagEditor() {
    const chosen = [...(model.tags || [])];
    const wrap = h('div.stack.stack-2');

    const commit = (next) => {
      model.tags = normalizeTags(next);
      chosen.length = 0;
      chosen.push(...model.tags);
      paint();
    };

    const box = input({
      placeholder: 'sin pollo, sin espagueti…',
      onkeydown: (event) => {
        if (event.key !== 'Enter') return;
        // Enter adds the restriction; it must not submit the whole form.
        event.preventDefault();
        const tag = cleanTag(event.target.value);
        if (!tag) return;
        event.target.value = '';
        commit([...chosen, tag]);
      },
    });

    function paint() {
      // Only offer what this person does not already have.
      const suggestions = tagsInUse(store.clients)
        .filter((entry) => !hasTag({ tags: chosen }, entry.tag))
        .slice(0, 8);

      mount(wrap,
        chosen.length
          ? h('div.tags',
              chosen.map((tag) => h('button.tag.tag--edit', {
                type: 'button',
                'aria-label': `Quitar ${tag}`,
                onclick: () => commit(chosen.filter((one) => one !== tag)),
              }, icon('ban'), tag, icon('x'))))
          : null,

        h('div.row', { style: { gap: '8px' } },
          h('div.grow', box),
          button('Agregar', {
            variant: 'soft', size: 'sm',
            onClick: () => {
              const tag = cleanTag(box.value);
              if (!tag) return;
              box.value = '';
              commit([...chosen, tag]);
            },
          })),

        suggestions.length
          ? h('div.stack.stack-1',
              h('div.t-xs.c-faint', 'Ya se usan en la cocina:'),
              h('div.tags', suggestions.map((entry) => h('button.tag.tag--pick', {
                type: 'button',
                onclick: () => commit([...chosen, entry.tag]),
              }, '+ ', entry.tag))))
          : null);
    }

    paint();
    return wrap;
  }

  /**
   * The week: which days this person is served, and how many plates each day.
   *
   * One row per weekday rather than a row of chips, because there are two
   * decisions per day — served or not, and how many — and a chip can only carry
   * one of them. The stepper adjusts the *extra* above the plan, so the plan
   * stays the thing that sets the price and the extra stays visible as an
   * extra, on the bill and on the run sheet.
   */
  function weekEditor() {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const wrap = h('div.stack.stack-2');

    const paint = () => {
      const serving = new Set((model.deliveryDays || []).map(Number));

      mount(wrap,
        h('div.week', order.map((weekday) => {
          const on = serving.has(weekday);
          const meals = on ? mealsOn(model, weekday) : 0;
          const extra = Number(model.extras?.[String(weekday)]) || 0;

          return h(`div.week__row${on ? '' : '.is-off'}`,
            h('button.week__day', {
              type: 'button',
              'aria-pressed': on,
              onclick: () => toggleDay(weekday, !on),
            },
            h('span.week__mark', on ? icon('check') : null),
            h('span.week__name', capitalize(WEEKDAYS[weekday]))),

            on
              ? h('div.week__count',
                  h('button.step', {
                    type: 'button', 'aria-label': 'Quitar una comida',
                    disabled: extra <= 0,
                    onclick: () => setExtra(weekday, extra - 1),
                  }, '−'),
                  h('span.step__n', plural(meals, 'comida', 'comidas')),
                  h('button.step', {
                    type: 'button', 'aria-label': 'Agregar una comida',
                    onclick: () => setExtra(weekday, extra + 1),
                  }, '+'))
              : h('span.t-sm.c-faint', 'Sin servicio'),

            on && extra > 0 ? badge(`+${extra}`, 'warn') : null);
        })),

        h('p.t-xs.c-faint', 'El plan da las comidas base de cada día; el + agrega comidas '
          + 'extra en ese día de la semana, todas las semanas.'));
    };

    const toggleDay = (weekday, on) => {
      const days = new Set((model.deliveryDays || []).map(Number));
      if (on) days.add(weekday); else days.delete(weekday);

      // An extra on a day nobody is served is not an extra, it is a leftover.
      const extras = { ...(model.extras || {}) };
      if (!on) delete extras[String(weekday)];

      update({ deliveryDays: [...days].sort((a, b) => a - b), extras });
      paint();
    };

    const setExtra = (weekday, count) => {
      const extras = { ...(model.extras || {}) };
      if (count > 0) extras[String(weekday)] = count;
      else delete extras[String(weekday)];
      update({ extras });
      paint();
    };

    paint();
    return wrap;
  }

  /**
   * The plan is picked, not typed: every price the business charges is on the
   * list, so choosing from it makes an unbillable client impossible to create.
   */
  function planPicker() {
    const known = store.pricing.tiers.map((tier) => ({
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

  /** What this person gets, what it costs, and why it costs that. */
  function previewCard() {
    const current = farm();
    if (!current) return alert('Elige el rancho para ver sus condiciones.', 'info');

    const terms = termsOf(current);
    const period = periodFor(terms.cycleAnchor, today());
    const charge = fortnightCharge(model, store.pricing);
    const priced = !!tierFor(store.pricing, model.mealsPerDay);

    return h('div.stack.stack-3',
      alert(`Horario y ciclo de ${current.name}. Para cambiarlos, edita el rancho.`, 'info'),
      card(defList([
        defRow('Horario', terms.deliveryWindow || '—'),
        defRow('Inicio del ciclo', formatDayLong(terms.cycleAnchor)),
        ...chargeRows(charge, priced),
        defRow(`Quincena ${formatRange(period.start, period.end)}`,
          priced ? money(charge.amount) : 'Sin precio', { total: true }),
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
