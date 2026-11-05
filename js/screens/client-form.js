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
import { go, back, currentPath } from '../lib/router.js';
import { session } from '../data/session.js';
import {
  createClient, updateClient, getClient, emptyClient, deleteClient, setClientStatus,
  isValidEmail, termsOf, cleanTag, normalizeTags, tagsInUse, hasTag, servingSince, lastDayGone,
} from '../data/clients.js';
import { ensureConversation } from '../data/chat.js';
import { store, farmById, clientsOfFarm, whenReady, isReady } from '../data/store.js';
import { openChargeSheet } from '../ui/charge-sheet.js';
import { openOpeningSheet } from '../ui/opening-sheet.js';
import {
  periodOf, payDayAfter, isPayDay, payDayOnOrAfter,
  PAY_EVERY, payEveryOf, periodWord, cadenceWord,
} from '../lib/billing.js';
import { payDaysWords } from '../lib/billing-words.js';
import { chargeFor, tierFor, periodCharge, mealsOn } from '../lib/pricing.js';
import {
  today, addDays, formatRange, formatDayLong, formatDay, weekdayOf, WEEKDAYS, capitalize,
} from '../lib/dates.js';
import { money, plural } from '../lib/format.js';
import { errorText } from '../firebase.js';
import { t } from '../lib/i18n.js';

export async function renderClientForm(context) {
  const clientId = context.params.id;
  const isNew = !clientId || clientId === 'new';

  // The farms decide which houses can be picked and what a new person's terms
  // are: opened straight from a link, the form waits for them rather than
  // drawing a farm with no houses.
  if (!isReady()) {
    screen({ title: t('Cliente'), backTo: '/clients', tab: 'clients', body: loading() });
    await whenReady();
  }
  let model = isNew
    ? emptyClient(farmById(context.query.farm))
    : store.clients.find((c) => c.id === clientId) || await getClient(clientId);
  // Somebody tapped away while it loaded: the page they went to is theirs.
  if (currentPath() !== context.path) return;

  if (!model) {
    screen({
      title: t('Cliente'), backTo: '/clients', tab: 'clients',
      body: h('div.page__inner', alert(t('Este cliente ya no existe.'), 'bad')),
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
  // The whole form as it opened, to save only what was changed in it.
  const opened = JSON.parse(JSON.stringify(model));

  let saving = false;
  let errors = {};

  const farm = () => farmById(model.farmId);

  const draw = () => screen({
    title: isNew ? t('Nuevo cliente') : t('Editar cliente'),
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
    const period = periodOf({ ...model, cycleAnchor: day });
    return t('Se cobra en {days}. Su {period} corre ahora del {start} al {end}, y se paga el {weekday} {day}, cuando termine.', {
      days: payDaysWords(),
      period: t(periodWord(model)),
      start: formatDay(period.start),
      end: formatDay(period.end),
      weekday: capitalize(WEEKDAYS[weekdayOf(payDayAfter(period))]),
      day: formatDay(payDayAfter(period)),
    });
  }

  function validate() {
    errors = {};
    if (!model.name?.trim()) errors.name = t('Escribe el nombre de la persona.');
    if (!model.farmId) errors.farmId = t('Elige el rancho.');
    if (!model.locationId) errors.locationId = t('Elige dónde está. Es obligatorio.');
    if (!(Number(model.mealsPerDay) > 0)) errors.mealsPerDay = t('Debe ser mayor a cero.');
    if (model.email && !isValidEmail(model.email)) errors.email = t('Ese correo no es válido.');
    if (model.cycleAnchor && !isPayDay(model.cycleAnchor)) {
      errors.cycleAnchor = t('El periodo empieza en {days}.', { days: payDaysWords() });
    }
    if (model.endsOn && model.cycleAnchor && model.endsOn < model.cycleAnchor) {
      errors.endsOn = t('No puede terminar antes de que empiece su periodo.');
    }
    return Object.keys(errors).length === 0;
  }

  async function save(event) {
    event.preventDefault();
    if (!validate()) { draw(); toastBad(t('Revisa los campos marcados.')); return; }

    saving = true; draw();
    const author = { uid: session.uid, name: session.displayName };

    try {
      if (isNew) {
        const { id, email } = await createClient(model, farm(), author);
        await ensureConversation({ id, name: model.name });
        toastOk(t('Cliente registrado'));

        const fresh = { ...model, id };

        // Most of these people were already customers, on paper. Asking now —
        // while their file is open and the notebook is in hand — is the only
        // moment the balance realistically gets carried over.
        if (chargeFor(fresh, store.pricing)) {
          const carried = await offerOpeningBalance(fresh, author);

          // Somebody brought over with fortnights still owed may be paying
          // them right now, at the counter. Somebody who starts today owes
          // nothing: nothing is paid ahead here, and their first fortnight is
          // paid the day it ends — so they are not asked.
          if (carried > 0) {
            const receipt = await offerPayment(fresh, author);
            if (receipt) {
              go(`/receipts/${receipt.id}`, { replace: true });
              return;
            }
          } else {
            const first = payDayAfter(periodOf(fresh));
            toastOk(t('Paga su primera {period} el {day}, cuando termine.', { period: t(periodWord(fresh)), day: formatDay(first) }));
          }
        }

        go(`/clients/${id}${email ? `?welcome=${encodeURIComponent(email)}` : ''}`, { replace: true });
      } else {
        // Only what was changed here. The whole record would carry back what
        // it said when the form opened — a payment taken meanwhile, today's
        // note from the kitchen — and undo it.
        const changed = new Set(Object.keys(model).filter((key) => !LEFT_ALONE.has(key)
          && JSON.stringify(model[key] ?? null) !== JSON.stringify(opened[key] ?? null)));
        // Extras are counted per day they eat, so the two travel together.
        if (changed.has('deliveryDays') || changed.has('extras')) {
          changed.add('deliveryDays');
          changed.add('extras');
        }
        // Back to active after their last day went by: that day is over, and
        // left in place it would keep them out of the libreta.
        if (changed.has('status') && model.status === 'active' && !changed.has('endsOn')
          && lastDayGone(model)) {
          model.endsOn = '';
          changed.add('endsOn');
        }
        if (changed.size) {
          await updateClient(clientId, Object.fromEntries([...changed].map((key) => [key, model[key]])),
            original.email, farm());
        }
        toastOk(t('Cambios guardados'));
        go(`/clients/${clientId}`, { replace: true });
      }
    } catch (error) {
      saving = false; draw();
      toastBad(errorText(error));
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
      title: t('¿Ya venía pagando?'),
      message: t('Si {name} ya era cliente antes del sistema, dinos cuándo pagó por última vez y calculamos lo que quedó debiendo. Si empieza hoy, no hace falta.',
        { name: client.name }),
      confirmLabel: t('Traer saldo del cuaderno'),
      cancelLabel: t('Empieza hoy'),
      icon: 'clipboard',
    });
    if (!wants) return 0;

    return openOpeningSheet({ client, pricing: store.pricing, author });
  }

  /**
   * "They are paying what they brought over" — asked once, right after the
   * notebook balance is carried in.
   *
   * Answering no is the common case and costs one tap; answering yes skips a
   * search, a screen and a scroll while somebody is standing there with cash.
   */
  async function offerPayment(client, author) {
    const wants = await confirm({
      title: t('¿Va a pagar ahora?'),
      message: t('{name} quedó registrado con lo que debía en el cuaderno. Si lo está pagando en este momento, cóbrale aquí mismo y se le manda su recibo.',
        { name: client.name }),
      confirmLabel: t('Cobrar ahora'),
      cancelLabel: t('Después', { ctx: 'later' }),
      icon: 'cash',
    });
    if (!wants) return null;

    return openChargeSheet({ client, pricing: store.pricing, author });
  }

  /* --- Form ---------------------------------------------------------------- */

  function form() {
    if (!store.farms.length) return noFarms();

    return h('form.page__inner.page__inner--narrow.stack.stack-4', { onsubmit: save, novalidate: true },

      sectionLabel(t('Dónde come')),
      card(h('div.stack.stack-4',
        field({
          label: t('Rancho'),
          error: errors.farmId,
          control: select({
            value: model.farmId,
            options: [
              { value: '', label: t('Elige el rancho…') },
              ...store.farms.map((row) => ({ value: row.id, label: row.name })),
            ],
            // Changing farm invalidates the chosen location: they belong to it.
            onchange: (e) => updateAndRedraw({ farmId: e.target.value, locationId: '' }),
          }),
        }),
        locationField())),

      sectionLabel(t('La persona')),
      card(h('div.stack.stack-4',
        field({
          label: t('Nombre'),
          error: errors.name,
          control: input({
            value: model.name, required: true, placeholder: t('Nombre y apellido'),
            oninput: (e) => update({ name: e.target.value }),
          }),
        }),
        field({
          label: t('Teléfono'),
          control: input({
            value: model.phone, type: 'tel', inputmode: 'tel', placeholder: '(604) 555-0143',
            oninput: (e) => update({ phone: e.target.value }),
          }),
        }),
        field({
          label: t('Correo para la app'),
          hint: t('Opcional. Con este correo entra a su app y ve su entrega y su cuenta. Si todavía no tiene, déjalo vacío.'),
          error: errors.email,
          control: input({
            value: model.email, type: 'email', inputmode: 'email',
            placeholder: t('persona@correo.com'),
            oninput: (e) => update({ email: e.target.value }),
          }),
        }),
        // Not `field`: this control has buttons of its own, and a <label>
        // would hand their clicks to the text box instead.
        fieldGroup({
          label: t('No puede comer'),
          hint: t('Alergias y lo que no puede llevar su comida. Sale en la pantalla de empaque, en rojo, y en la lista de clientes. Nunca se imprime en la etiqueta: eso viaja pegado a una caja.'),
          control: tagEditor(),
        }),

        fieldGroup({
          label: t('Preferencias'),
          hint: t('Lo que pidió, no lo que le hace daño: sin picante, sin cebolla. Esto sí sale impreso en su etiqueta.'),
          control: tagEditor('preferencias', t('sin picante, sin cebolla…'), 'utensils'),
        }),

        field({
          label: t('Notas'),
          control: textarea({
            value: model.notes, rows: 2, placeholder: t('Doble tortilla, quién recibe, cómo llegar…'),
            oninput: (e) => update({ notes: e.target.value }),
          }),
        }))),

      sectionLabel(t('Su servicio')),
      card(h('div.stack.stack-4',
        field({
          label: t('Plan'),
          error: errors.mealsPerDay,
          hint: t('Cuántas comidas lleva al día. De ahí sale lo que paga por {period}.', { period: t(periodWord(model)) }),
          control: planPicker(),
        }),

        // Not `field`: the week has a stepper on every row, and a <label>
        // would hand their clicks to whatever input it finds first.
        fieldGroup({
          label: t('Su semana'),
          error: errors.deliveryDays,
          hint: t('Los días que recibe y cuántas comidas cada día. El precio se ajusta solo.'),
          control: weekEditor(),
        }),
        field({
          label: t('¿Desde cuándo come aquí?'),
          hint: t('Decide desde qué {period} se le cobra. El panel nunca le factura una {period} que cerró antes de esta fecha.',
            { period: t(periodWord(model)) }),
          control: input({
            type: 'date',
            value: model.startedOn || today(),
            max: today(),
            onchange: (e) => update({ startedOn: e.target.value || today() }),
          }),
        }),
        field({
          label: t('¿Cada cuánto paga?'),
          hint: t('Algunos cobran por semana y prefieren pagar por semana. Es la misma comida y el mismo precio por plato — sólo cambia cada cuándo se cobra.'),
          control: select({
            value: String(payEveryOf(model)),
            options: [
              { value: String(PAY_EVERY.FORTNIGHT), label: t('Cada quincena — 14 días') },
              { value: String(PAY_EVERY.WEEK), label: t('Cada semana — 7 días') },
            ],
            onchange: (e) => updateAndRedraw({ payEvery: Number(e.target.value) }),
          }),
        }),
        field({
          label: t('Día de pago'),
          error: errors.cycleAnchor,
          hint: cycleHint(),
          control: input({
            type: 'date',
            value: model.cycleAnchor || payDayOnOrAfter(today()),
            // Snapped rather than refused: somebody typing "pagó el 28" means
            // the fortnight that starts on the next collection day, and making
            // them hunt for the right square helps nobody.
            // Typing it by hand is somebody saying "this is their day", which
            // is the same statement a payment makes. Marked as set either way,
            // so the counter stops offering to move it.
            onchange: (e) => updateAndRedraw({
              cycleAnchor: payDayOnOrAfter(e.target.value || today()),
              cycleSetOn: today(),
            }),
          }),
        }),
        field({
          label: t('Último día que se le sirve'),
          hint: t('Sólo cuando ya se sabe que se va: "pagó y se queda hasta el jueves". Desde el día siguiente deja de aparecer en la libreta y no se le factura. Déjalo vacío si sigue.'),
          control: h('div.stack.stack-2',
            input({
              type: 'date',
              value: model.endsOn || '',
              min: today(),
              onchange: (e) => updateAndRedraw({ endsOn: e.target.value || '' }),
            }),
            h('div.row.row--wrap', { style: { gap: '6px' } },
              [[t('Hoy'), 0], [t('Mañana'), 1], [t('En 2 días'), 2], [t('En 7 días'), 7]].map(
                ([label, days]) => button(label, {
                  variant: 'soft', size: 'sm',
                  onClick: () => updateAndRedraw({ endsOn: addDays(today(), days) }),
                })),
              model.endsOn
                ? button(t('Sin fecha'), {
                    variant: 'ghost', size: 'sm',
                    onClick: () => updateAndRedraw({ endsOn: '' }),
                  })
                : null)),
        }),
        field({
          label: t('Estado'),
          control: select({
            value: model.status,
            options: [
              { value: 'active', label: t('Activo — recibe comida') },
              { value: 'paused', label: t('En pausa — sin entregas por ahora') },
              { value: 'inactive', label: t('Inactivo — ya no come aquí') },
            ],
            onchange: (e) => update({ status: e.target.value }),
          }),
        }),
        h('div', { id: 'client-preview' }, previewCard()))),

      h('div.stack.stack-2', { style: { marginTop: '8px' } },
        h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' },
          isNew ? t('Registrar cliente') : t('Guardar cambios')),
        button(t('Cancelar'), {
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
        label: t('Ubicación'),
        control: select({ value: '', options: [{ value: '', label: t('Elige primero el rancho…') }], disabled: true }),
      });
    }

    const places = current.locations || [];
    if (!places.length) {
      return field({
        label: t('Ubicación'),
        error: errors.locationId,
        control: h('div.stack.stack-3',
          alert(t('{farm} todavía no tiene ubicaciones. Agrega una para poder registrar gente ahí.', { farm: current.name }), 'warn'),
          button(t('Agregar ubicación'), {
            variant: 'ghost', block: true, icon: 'pin',
            onClick: () => go(`/farms/${current.id}`),
          })),
      });
    }

    return field({
      label: t('Ubicación'),
      hint: t('Dónde se le deja la comida. Obligatorio.'),
      error: errors.locationId,
      control: select({
        value: model.locationId,
        options: [
          { value: '', label: t('Elige la ubicación…') },
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
   * One of the two lists: what they cannot eat, or what they asked for.
   *
   * The suggestions are the point. Left to a free-text box, "sin pollo" becomes
   * "Sin Pollo", "no pollo" and "sin pollo." within a month, and then nobody
   * can count how many portions to leave chicken out of. Offering the existing
   * spellings first means the common ones stay one thing — and on the
   * preferences it also keeps four spellings from printing four different
   * looking stickers.
   *
   * @param {'tags'|'preferencias'} listField
   * @param {string} placeholder
   * @param {string} glyph  the icon on a chosen chip
   */
  function tagEditor(listField = 'tags', placeholder = t('sin pollo, sin espagueti…'), glyph = 'ban') {
    const chosen = [...(model[listField] || [])];
    const wrap = h('div.stack.stack-2');

    const commit = (next) => {
      model[listField] = normalizeTags(next);
      chosen.length = 0;
      chosen.push(...model[listField]);
      paint();
    };

    const box = input({
      placeholder,
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
      const suggestions = tagsInUse(store.clients, listField)
        .filter((entry) => !hasTag({ [listField]: chosen }, entry.tag, listField))
        .slice(0, 8);

      mount(wrap,
        chosen.length
          ? h('div.tags',
              chosen.map((tag) => h('button.tag.tag--edit', {
                type: 'button',
                'aria-label': t('Quitar {tag}', { tag }),
                onclick: () => commit(chosen.filter((one) => one !== tag)),
              }, icon(glyph), tag, icon('x'))))
          : null,

        h('div.row', { style: { gap: '8px' } },
          h('div.grow', box),
          button(t('Agregar'), {
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
              h('div.t-xs.c-faint', t('Ya se usan en la cocina:')),
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
                    type: 'button', 'aria-label': t('Quitar una comida'),
                    disabled: extra <= 0,
                    onclick: () => setExtra(weekday, extra - 1),
                  }, '−'),
                  h('span.step__n', plural(meals, 'comida', 'comidas')),
                  h('button.step', {
                    type: 'button', 'aria-label': t('Agregar una comida'),
                    onclick: () => setExtra(weekday, extra + 1),
                  }, '+'))
              : h('span.t-sm.c-faint', t('Sin servicio')),

            on && extra > 0 ? badge(`+${extra}`, 'warn') : null);
        })),

        h('p.t-xs.c-faint', t('El plan da las comidas base de cada día; el + agrega comidas extra en ese día de la semana, todas las semanas.')));
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
    // The list price is a fortnight's; somebody paying weekly pays half of it,
    // twice as often. Quoting the fortnight to a weekly client is how the wrong
    // amount ends up on the counter.
    const known = store.pricing.tiers.map((tier) => ({
      value: String(tier.mealsPerDay),
      label: t('{meals} al día · {price} por {period}', {
        meals: plural(tier.mealsPerDay, 'comida', 'comidas'),
        price: money(periodCharge({ ...model, mealsPerDay: tier.mealsPerDay }, store.pricing).base),
        period: t(periodWord(model)),
      }),
    }));
    const current = String(Number(model.mealsPerDay) || '');
    const offList = current && !known.some((option) => option.value === current);

    return h('div.stack.stack-2',
      select({
        value: current,
        options: [
          { value: '', label: t('Elige el plan…') },
          ...known,
          ...(offList
            ? [{ value: current, label: t('{meals} al día · sin precio', { meals: plural(model.mealsPerDay, 'comida', 'comidas') }) }]
            : []),
        ],
        onchange: (event) => updateAndRedraw({ mealsPerDay: Number(event.target.value) }),
      }),
      offList
        ? alert(t('Ese plan no tiene precio. Agrégalo en Ajustes → Precios o elige otro; mientras tanto no se le puede cobrar.'), 'warn')
        : null);
  }

  /** What this person gets, what it costs, and why it costs that. */
  function previewCard() {
    const current = farm();
    if (!current) return alert(t('Elige el rancho para ver sus condiciones.'), 'info');

    const terms = termsOf(current);
    const period = periodOf({ ...model, cycleAnchor: terms.cycleAnchor });
    const charge = periodCharge(model, store.pricing);
    const priced = !!tierFor(store.pricing, model.mealsPerDay);

    return h('div.stack.stack-3',
      alert(t('Horario y ciclo de {farm}. Para cambiarlos, edita el rancho.', { farm: current.name }), 'info'),
      card(defList([
        defRow(t('Horario'), terms.deliveryWindow || '—'),
        defRow(t('Inicio del ciclo'), formatDayLong(terms.cycleAnchor)),
        ...chargeRows(charge, priced),
        defRow(t('Paga'), capitalize(t(cadenceWord(model)))),
        defRow(`${capitalize(t(periodWord(model)))} ${formatRange(period.start, period.end)}`,
          priced ? money(charge.amount) : t('Sin precio'), { total: true }),
      ])));
  }

  function noFarms() {
    return h('div.page__inner', emptyState({
      icon: 'farm',
      title: t('Primero registra un rancho'),
      text: t('Los clientes viven dentro de un rancho y de una de sus ubicaciones, así que el rancho va primero.'),
      action: button(t('Registrar rancho'), { icon: 'plus', onClick: () => go('/farms/new') }),
    }));
  }

  function dangerZone() {
    return h('div.stack.stack-3', { style: { marginTop: '8px' } },
      sectionLabel(t('Zona delicada')),
      model.status === 'active'
        ? button(t('Poner en pausa'), {
            variant: 'ghost', block: true, icon: 'pause',
            onClick: async () => {
              if (!await confirm({
                title: t('Poner en pausa'),
                message: t('Deja de aparecer en las rutas nuevas. Sus facturas y su historial se conservan.'),
                confirmLabel: t('Poner en pausa'), icon: 'pause',
              })) return;
              try {
                await setClientStatus(clientId, 'paused', model);
                toastOk(t('Cliente en pausa'));
                go(`/clients/${clientId}`);
              } catch (error) { toastBad(errorText(error)); }
            },
          })
        : button(t('Reactivar cliente'), {
            variant: 'ok', block: true, icon: 'play',
            onClick: async () => {
              try {
                await setClientStatus(clientId, 'active', model);
                toastOk(t('Cliente reactivado'));
                go(`/clients/${clientId}`);
              } catch (error) { toastBad(errorText(error)); }
            },
          }),
      button(t('Eliminar cliente'), {
        variant: 'danger-soft', block: true, icon: 'ban',
        onClick: async () => {
          if (!await confirm({
            title: t('Eliminar {name}', { name: model.name }),
            message: t('Se borra la ficha y el acceso de su correo a la app. Sólo se puede con quien no tiene facturas ni pagos: a quien ya tiene historial se le desactiva. Esta acción no se puede deshacer.'),
            confirmLabel: t('Eliminar definitivamente'), tone: 'danger', icon: 'alert',
          })) return;
          try {
            await deleteClient(clientId, model.email);
            toastOk(t('Cliente eliminado'));
            go(model.farmId ? `/farms/${model.farmId}` : '/clients', { replace: true });
          } catch (error) {
            toastBad(errorText(error));
          }
        },
      }));
  }

  draw();
}

/** Never written from this form, whatever it holds. */
const LEFT_ALONE = new Set(['id', 'createdAt', 'updatedAt']);

const clientsAt = (farmId, locationId) =>
  clientsOfFarm(farmId).filter((client) => client.locationId === locationId).length;
