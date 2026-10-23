/**
 * Programar — leaving a change for its day, one question per screen.
 *
 * The same screens as Acción rápida, because the office already knows them:
 * big buttons, Atrás and Siguiente in the same two places, and a last screen
 * that says in words what will happen before anything is saved.
 *
 *   1. ¿Qué quieres programar?   every kind of change (js/lib/schedule.js)
 *   2. ¿De quién?                when it is about one person
 *   3. what it changes to       one or two screens, depending on the kind
 *   4. ¿Desde qué día?           a calendar
 *   5. ¿Hasta cuándo?            for changes that can end: "Se queda así",
 *                               or a last day, after which it goes back
 *   6. Revisa                   and Programar
 *
 * Nothing changes on the client now. The set is saved, and on its day the
 * first computer open carries it out (js/data/schedule.js).
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { runFlow } from './flow.js';
import {
  posPick, posFind, posMoney, posDays, posCalendar, posSummary, posNote, posField, posText, posLabel,
} from './pos-kit.js';
import { store, billingFor, farmById } from '../data/store.js';
import { scheduleSet, registerFuture } from '../data/schedule.js';
import { emptyClient, tagsInUse } from '../data/clients.js';
import { KINDS, changeWords } from '../lib/schedule.js';
import { PAYMENT_METHODS, paymentMethodMeta, clientStatusMeta } from '../lib/model.js';
import {
  today, addDays, daysBetween, formatDay, formatDayLong, weekdayName, capitalize,
} from '../lib/dates.js';
import { money, plural, fold } from '../lib/format.js';
import { tierFor } from '../lib/pricing.js';
import { kitchenSpelling } from '../lib/diet.js';

const balanceOf = (client) => billingFor(client)?.balance || 0;
const where = (client) => [client?.farmName, client?.locationName].filter(Boolean).join(' · ');

/** "lunes 26 de octubre" */
const dayWords = (day) => `${weekdayName(day)} ${formatDay(day)}`;

/** One-time things happen on a day; changes happen from a day. */
const onTitle = (kind) => (kind === 'start' ? '¿Qué día empieza?'
  : KINDS[kind]?.ends ? '¿Desde qué día?' : '¿Qué día?');

/**
 * @param {object}   options
 * @param {object}   [options.client]  the person, when opened from their file
 * @param {object}   options.author    `{ uid, name }`
 * @param {Function} [options.onClose]
 */
export function openScheduleFlow({ client = null, author, onClose } = {}) {
  const preset = client;

  return runFlow({
    title: 'Programar',
    state: {
      kind: '', client: preset,
      meals: 0, days: null, farmId: '', locationId: '', farmQuery: '',
      add: [], remove: [], phone: undefined, notes: undefined, status: '',
      name: '', places: [], amount: 0, reason: '', method: 'cash', target: null, note: '',
      on: '', ends: '', until: '',
    },
    subject: (s) => (s.client ? { name: s.client.name, where: where(s.client) } : null),
    steps: (s) => {
      const kind = KINDS[s.kind];
      return [
        kindStep(),
        kind?.client && !preset ? whoStep() : null,
        ...(s.kind ? whatSteps(s) : []),
        s.kind ? onStep(s) : null,
        kind?.ends ? endsStep(s) : null,
        kind?.ends && s.ends === 'yes' ? untilStep(s) : null,
        s.kind ? confirmStep() : null,
        // Before a kind is chosen there is nothing to confirm; the list still
        // needs a last step so the footer reads "Siguiente".
        !s.kind ? { id: 'wait', title: '', build: () => h('div') } : null,
      ].filter(Boolean);
    },
    commit: (s) => commit(s, author),
    done: (s) => ({
      what: 'Programado',
      who: `${s.kind === 'start' ? s.name.trim() : s.client?.name || s.name || ''} · `
        + `${capitalize(dayWords(s.on))}`,
      note: 'Lo aplica solo la primera computadora que se abra ese día. Está en el Programador, '
        + 'donde se puede cancelar antes.',
    }),
    onExit: () => onClose?.(),
  });

  /* --- 1. What --------------------------------------------------------------- */

  function kindStep() {
    return {
      id: 'kind',
      title: '¿Qué quieres programar?',
      hint: 'Se aplica solo en el día que escojas. Hasta entonces no cambia nada.',
      ready: (st) => !!st.kind,
      // Compact and five across, so all thirteen fit a 768px screen without
      // scrolling: icon on the left, the name and its line beside it.
      build: (st, api) => h('div.poskinds', posPick({
        columns: 5,
        value: st.kind,
        onPick: (v) => {
          if (st.kind !== v) Object.assign(st, { client: preset, on: '', ends: '', until: '' });
          st.kind = v;
          api.refresh();
        },
        advance: api.next,
        options: Object.entries(KINDS)
          .filter(([, meta]) => !preset || meta.client)
          .map(([value, meta]) => ({ value, label: meta.label, sub: meta.sub, icon: meta.icon })),
      })),
    };
  }

  /* --- 2. Who ---------------------------------------------------------------- */

  function whoStep() {
    return {
      id: 'who',
      title: '¿De quién?',
      ready: (st) => !!st.client,
      build: (st, api) => posFind({
        clients: store.clients,
        value: st.client,
        balanceOf,
        onPick: (picked) => { st.client = picked; api.revalidate(); },
      }),
    };
  }

  /* --- 3. What it changes to ---------------------------------------------- */

  function whatSteps(s) {
    const c = s.client;
    switch (s.kind) {
      case 'meals': return [{
        id: 'meals',
        title: '¿Cuántas comidas al día, desde ese día?',
        ready: (st) => st.meals > 0,
        build: (st, api) => posPick({
          columns: 3,
          value: st.meals,
          onPick: (v) => { st.meals = v; api.revalidate(); },
          advance: api.next,
          options: [1, 2, 3].map((n) => ({
            value: n, label: String(n),
            sub: Number(c?.mealsPerDay) === n ? 'Lo que tiene ahora'
              : `${money(tierFor(store.pricing, n)?.price || 0)} / quincena`,
          })),
        }),
      }];

      case 'days': return [{
        id: 'days',
        title: '¿Qué días come, desde ese día?',
        hint: 'Toca un día para quitarlo o ponerlo.',
        ready: (st) => (st.days ?? c?.deliveryDays ?? []).length > 0,
        build: (st, api) => posDays({
          days: st.days ?? c?.deliveryDays ?? [1, 2, 3, 4, 5, 6],
          onChange: (v) => { st.days = v; api.revalidate(); },
        }),
      }];

      case 'location': return [farmStep('¿A qué farma se cambia?'), placeStep(s, '¿A qué ubicación?')];

      case 'diet': return [dietStep()];

      case 'info': return [{
        id: 'info',
        title: '¿Qué cambia en sus datos?',
        hint: 'Cambia solo lo que escribas distinto.',
        ready: (st) => (st.phone !== undefined && st.phone !== (c?.phone || ''))
          || (st.notes !== undefined && st.notes !== (c?.notes || '')),
        build: (st, api) => h('div.stack.stack-4',
          posField('Teléfono', posText({
            value: st.phone ?? c?.phone ?? '', placeholder: 'Su teléfono', inputmode: 'tel',
            onChange: (v) => { st.phone = v; api.revalidate(); },
          })),
          posField('Notas para la cocina', posText({
            value: st.notes ?? c?.notes ?? '', placeholder: 'Ej. Dejar la comida con el encargado',
            onChange: (v) => { st.notes = v; api.revalidate(); },
          }))),
      }];

      case 'status': return [{
        id: 'status',
        title: '¿Cómo queda desde ese día?',
        hint: c ? `Ahora está ${clientStatusMeta(c.status).label.toLowerCase()}.` : '',
        ready: (st) => !!st.status,
        build: (st, api) => posPick({
          columns: 3,
          value: st.status,
          onPick: (v) => { st.status = v; api.revalidate(); },
          advance: api.next,
          options: [
            { value: 'paused', label: 'En pausa', sub: 'Se va un tiempo', icon: 'pause' },
            { value: 'active', label: 'Activo', sub: 'Vuelve a comer', icon: 'play' },
            { value: 'inactive', label: 'Ya no pide', sub: 'Se da de baja', icon: 'ban' },
          ],
        }),
      }];

      case 'start': return [
        {
          id: 'name',
          title: '¿Cómo se llama?',
          hint: 'Se da de alta hoy, en pausa, y empieza solo el día que escojas.',
          ready: (st) => st.name.trim().length > 1,
          build: (st, api) => posField('Nombre completo', posText({
            value: st.name, placeholder: 'Ej. José Hernández',
            onChange: (v) => { st.name = v; api.revalidate(); },
          })),
        },
        farmStep('¿En qué farma está?'),
        placeStep(s, '¿En qué ubicación?'),
        {
          id: 'meals',
          title: '¿Cuántas comidas al día?',
          ready: (st) => st.meals > 0,
          build: (st, api) => posPick({
            columns: 3,
            value: st.meals,
            onPick: (v) => { st.meals = v; api.revalidate(); },
            advance: api.next,
            options: [1, 2, 3].map((n) => ({
              value: n, label: String(n), sub: `${money(tierFor(store.pricing, n)?.price || 0)} / quincena`,
            })),
          }),
        },
      ];

      case 'farm': return [
        {
          id: 'name',
          title: '¿Cómo se llama la farma?',
          ready: (st) => st.name.trim().length > 1,
          build: (st, api) => posField('Nombre de la farma', posText({
            value: st.name, placeholder: 'Ej. Mucci Farms',
            onChange: (v) => { st.name = v; api.revalidate(); },
          })),
        },
        namesStep({ title: '¿Qué ubicaciones tiene?', label: 'Ubicación', optional: true }),
      ];

      case 'place': return [
        farmStep('¿En qué farma?'),
        namesStep({ title: '¿Qué ubicaciones nuevas?', label: 'Ubicación' }),
      ];

      case 'charge': return [
        moneyStep('¿De cuánto es la deuda?'),
        textStep({ id: 'reason', key: 'reason', title: '¿De qué es?', label: 'Motivo', placeholder: 'Ej. Contenedor que no regresó' }),
      ];

      case 'payment': return [
        moneyStep('¿Cuánto paga ese día?'),
        {
          id: 'method',
          title: '¿Cómo paga?',
          ready: (st) => !!st.method,
          build: (st, api) => posPick({
            columns: 3,
            value: st.method,
            onPick: (v) => { st.method = v; api.revalidate(); },
            advance: api.next,
            options: Object.entries(PAYMENT_METHODS).map(([value, meta]) => ({ value, label: meta.label, icon: meta.icon })),
          }),
        },
      ];

      case 'balance': return [
        {
          id: 'target',
          title: '¿Cuánto debe quedar debiendo ese día?',
          hint: c ? `Hoy debe ${money(balanceOf(c))}.` : '',
          ready: (st) => st.target !== null && st.target >= 0,
          build: (st, api) => posMoney({
            value: st.target ?? '',
            onChange: (v) => { st.target = v; api.revalidate(); },
            quick: [{ label: 'En cero', value: 0 }],
          }),
        },
        textStep({ id: 'note', key: 'note', title: '¿Por qué?', label: 'Motivo', placeholder: 'Ej. Descuento acordado' }),
      ];

      case 'reminder': return [
        textStep({ id: 'note', key: 'note', title: '¿Qué hay que recordar?', label: 'Recordatorio',
          placeholder: 'Ej. Dijo que paga el viernes' }),
        {
          id: 'amount',
          title: '¿De cuánto? (si es de dinero)',
          hint: 'Si no es de dinero, deja 0 y sigue.',
          build: (st, api) => posMoney({
            value: st.amount || '', onChange: (v) => { st.amount = v; api.revalidate(); }, quick: [],
          }),
        },
      ];

      default: return [];
    }
  }

  /** A farm, found by typing — there are sixty of them. */
  function farmStep(title) {
    return {
      id: 'farm',
      title,
      hint: 'Escribe parte del nombre.',
      ready: (st) => !!st.farmId,
      build: (st, api) => {
        const results = h('div');
        const paint = () => {
          const words = fold(st.farmQuery).split(/\s+/).filter(Boolean);
          const found = store.farms
            .filter((farm) => farm.status !== 'inactive')
            .filter((farm) => words.every((word) => fold(farm.name).includes(word)))
            .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
            .slice(0, 8);
          mount(results, found.length
            ? posPick({
              columns: 2,
              value: st.farmId,
              onPick: (v) => { st.farmId = v; st.locationId = ''; api.revalidate(); },
              advance: api.next,
              options: found.map((farm) => ({
                value: farm.id, label: farm.name,
                sub: plural((farm.locations || []).length, 'ubicación', 'ubicaciones'),
              })),
            })
            : posNote('Ninguna farma se llama así.', 'warn'));
        };
        const box = posText({
          value: st.farmQuery, placeholder: 'Ej. Mucci', autocomplete: 'off',
          onChange: (v) => { st.farmQuery = v; paint(); },
        });
        paint();
        return h('div.stack.stack-3', posField('Farma', box), results);
      },
    };
  }

  function placeStep(s, title) {
    const farm = farmById(s.farmId);
    return {
      id: 'place',
      title,
      hint: farm ? `Ubicaciones de ${farm.name}.` : '',
      ready: (st) => !!st.locationId,
      build: (st, api) => ((farm?.locations || []).length
        ? posPick({
          columns: 2,
          value: st.locationId,
          onPick: (v) => { st.locationId = v; api.revalidate(); },
          advance: api.next,
          options: farm.locations.map((one) => ({
            value: one.id, label: one.name,
            sub: s.client?.farmId === farm.id && s.client?.locationId === one.id ? 'Donde está ahora' : '',
          })),
        })
        : posNote('Esa farma no tiene ubicaciones. Prográmale una primero, o agrégala en Ranchos.', 'bad')),
    };
  }

  /** What they cannot eat: tap one to take it off, type to add. */
  function dietStep() {
    return {
      id: 'diet',
      title: '¿Qué cambia en lo que no puede comer?',
      hint: 'Toca uno de los suyos para quitarlo; escribe para agregar.',
      ready: (st) => st.add.length > 0 || st.remove.length > 0,
      build: (st, api) => {
        const now = h('div.posdiet');
        const added = h('div.posdiet');
        const inUse = tagsInUse(store.clients);
        const paint = () => {
          const tags = st.client?.tags || [];
          mount(now, tags.length
            ? tags.map((tag) => {
              const out = st.remove.includes(tag);
              return h(`button.posdiet__tag${out ? '.is-out' : ''}`, {
                type: 'button',
                'aria-pressed': out ? 'true' : 'false',
                onclick: () => {
                  st.remove = out ? st.remove.filter((one) => one !== tag) : [...st.remove, tag];
                  paint(); api.revalidate();
                },
              }, out ? icon('check') : icon('x'), out ? `Ya puede: ${tag}` : tag);
            })
            : h('p.pos__hint', 'Ahora no tiene nada.'));
          mount(added, st.add.map((tag) => h('button.posdiet__tag.is-new', {
            type: 'button',
            onclick: () => { st.add = st.add.filter((one) => one !== tag); paint(); api.revalidate(); },
          }, icon('x'), tag)));
        };
        const box = posText({
          value: '', placeholder: 'Ej. No pasta',
          onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } },
          onChange: () => {},
        });
        function add() {
          const tag = kitchenSpelling(box.value, inUse);
          if (!tag || st.add.includes(tag)) return;
          st.add = [...st.add, tag];
          box.value = '';
          box.focus();
          paint(); api.revalidate();
        }
        paint();
        return h('div',
          posLabel('Lo que tiene ahora'), now,
          h('div.posadd.posdiet__add',
            h('div.grow', posField('Agregar', box)),
            h('button.posbtn.posbtn--add', { type: 'button', onclick: add }, icon('plus'), 'Agregar')),
          added);
      },
    };
  }

  /** A list of names: locations of a farm. */
  function namesStep({ title, label, optional = false }) {
    return {
      id: 'names',
      title,
      hint: 'Escribe una y toca Agregar. Casa 1, Bloque Norte, Invernadero 3…',
      ready: (st) => optional || st.places.length > 0,
      build: (st, api) => {
        const list = h('div.posplaces');
        const box = posText({
          value: '', placeholder: 'Ej. Casa 1',
          onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } },
          onChange: () => {},
        });
        function add() {
          const name = box.value.trim().replace(/\s+/g, ' ');
          if (!name || st.places.some((one) => fold(one) === fold(name))) return;
          st.places = [...st.places, name];
          box.value = '';
          box.focus();
          paint(); api.revalidate();
        }
        const paint = () => mount(list, st.places.map((name, i) => h('div.posplace',
          h('span.posplace__n', String(i + 1)),
          h('span.posplace__name', name),
          h('button.posplace__x', {
            type: 'button', 'aria-label': `Quitar ${name}`,
            onclick: () => { st.places = st.places.filter((one) => one !== name); paint(); api.revalidate(); },
          }, icon('x')))));
        paint();
        return h('div',
          h('div.posadd',
            h('div.grow', posField(label, box)),
            h('button.posbtn.posbtn--add', { type: 'button', onclick: add }, icon('plus'), 'Agregar')),
          list);
      },
    };
  }

  function moneyStep(title) {
    return {
      id: 'amount',
      title,
      ready: (st) => st.amount > 0,
      build: (st, api) => posMoney({
        value: st.amount || '',
        onChange: (v) => { st.amount = v; api.revalidate(); },
        quick: st.client ? [{ label: `Lo que debe hoy: ${money(balanceOf(st.client))}`, value: balanceOf(st.client) }]
          .filter((one) => one.value > 0) : [],
      }),
    };
  }

  function textStep({ id, key, title, label, placeholder }) {
    return {
      id,
      title,
      ready: (st) => String(st[key] || '').trim().length > 1,
      build: (st, api) => posField(label, posText({
        value: st[key], placeholder, onChange: (v) => { st[key] = v; api.revalidate(); },
      })),
    };
  }

  /* --- 4. When ------------------------------------------------------------------ */

  function onStep(s) {
    return {
      id: 'on',
      title: onTitle(s.kind),
      hint: 'Toca el día en el calendario.',
      ready: (st) => !!st.on && st.on >= today(),
      build: (st, api) => posCalendar({
        value: st.on || undefined,
        onTag: 'ese día',
        // A start, not a span: nothing before it is shaded, and the day after
        // it is not "the morning it goes back".
        span: false,
        markAfter: false,
        onPick: (v) => {
          st.on = v;
          if (st.until && st.until < v) st.until = '';
          api.revalidate();
        },
        note: (v) => (v
          ? [capitalize(dayWords(v)), v === today()
            ? 'Es hoy: se aplica en cuanto lo guardes'
            : `En ${plural(daysBetween(today(), v), 'día', 'días')}`]
          : ['Toca un día', 'Hoy o cualquier día que venga']),
      }),
    };
  }

  function endsStep(s) {
    const start = s.kind === 'start';
    return {
      id: 'ends',
      title: start ? '¿Hasta cuándo come?' : '¿Hasta cuándo?',
      ready: (st) => !!st.ends,
      build: (st, api) => posPick({
        columns: 2,
        value: st.ends,
        onPick: (v) => { st.ends = v; if (v === 'no') st.until = ''; api.refresh(); },
        advance: api.next,
        options: [
          { value: 'no', label: start ? 'Sin fecha de fin' : 'Se queda así', sub: start ? 'Come hasta que se le pause' : 'Desde ese día en adelante', icon: 'check' },
          { value: 'yes', label: 'Hasta un día', sub: start ? 'Su último día; al siguiente queda en pausa' : 'Después regresa a como estaba', icon: 'calendar' },
        ],
      }),
    };
  }

  function untilStep(s) {
    const start = s.kind === 'start';
    return {
      id: 'until',
      title: start ? '¿Cuál es su último día?' : '¿Cuál es el último día con el cambio?',
      hint: start ? 'Al día siguiente queda en pausa solo.' : 'Al día siguiente regresa a como estaba.',
      ready: (st) => !!st.until && st.until >= st.on,
      build: (st, api) => posCalendar({
        value: st.until || undefined,
        min: st.on || today(),
        onPick: (v) => { st.until = v; api.revalidate(); },
        afterTag: start ? 'pausa' : 'regresa',
        note: (v) => (v
          ? [`Último día: ${dayWords(v)}`, start
            ? `El ${dayWords(addDays(v, 1))} queda en pausa`
            : `El ${dayWords(addDays(v, 1))} regresa a como estaba`]
          : ['Toca el último día', `Desde el ${dayWords(st.on)}`]),
      }),
    };
  }

  /* --- 5. Say it --------------------------------------------------------------- */

  function confirmStep() {
    return {
      id: 'confirm',
      title: 'Revisa lo que se va a programar',
      last: true,
      next: 'Programar',
      build: (st) => {
        const preview = { kind: st.kind, value: valueOf(st), farmName: farmById(st.farmId)?.name || '' };
        const kindMeta = KINDS[st.kind];
        const rows = [
          ['Qué', kindMeta.label],
          st.kind === 'start'
            ? ['Quién', `${st.name.trim()} · ${[farmById(st.farmId)?.name,
              (farmById(st.farmId)?.locations || []).find((one) => one.id === st.locationId)?.name].filter(Boolean).join(' · ')}`]
            : st.client ? ['Quién', st.client.name] : null,
          st.kind === 'start' ? ['Comidas', `${st.meals} al día`] : ['Cambio', capitalize(changeWords(preview, store.farms))],
          [st.kind === 'start' ? 'Empieza' : kindMeta.ends ? 'Desde' : 'Día', capitalize(formatDayLong(st.on)), { total: true }],
          kindMeta.ends
            ? ['Hasta', st.until
              ? `${capitalize(formatDayLong(st.until))} · el ${dayWords(addDays(st.until, 1))} ${st.kind === 'start' ? 'queda en pausa' : 'regresa'}`
              : 'Se queda así']
            : null,
        ];
        return h('div',
          posSummary(rows),
          st.kind === 'payment'
            ? posNote(`Ese día se registra el pago de ${money(st.amount)} (${paymentMethodMeta(st.method).label}) con su `
              + 'recibo, sin que nadie cobre en el mostrador: úsalo solo para dinero que llega solo, como un '
              + 'descuento de nómina.', 'warn')
            : null,
          st.kind === 'start'
            ? posNote('Se da de alta hoy, en pausa: ya sale en Clientes como «Empieza el '
              + `${formatDay(st.on)}» y la cocina puede acomodar su ubicación. No se empaca ni se cobra antes.`, 'ok')
            : posNote('Lo aplica solo la primera computadora que se abra ese día —la de la oficina o la de la '
              + 'cocina—. Hasta entonces no cambia nada, y se puede cancelar en el Programador.', 'ok'));
      },
    };
  }
}

/** What the set stores as its change, from the answers. */
function valueOf(st) {
  switch (st.kind) {
    case 'meals': return { mealsPerDay: st.meals };
    case 'days': return { deliveryDays: st.days ?? st.client?.deliveryDays ?? [] };
    case 'location': {
      const farm = farmById(st.farmId);
      const place = (farm?.locations || []).find((one) => one.id === st.locationId);
      return { farmId: st.farmId, locationId: st.locationId, farmName: farm?.name || '', locationName: place?.name || '' };
    }
    case 'diet': return { add: st.add, remove: st.remove };
    case 'info': {
      const out = {};
      if (st.phone !== undefined && st.phone !== (st.client?.phone || '')) out.phone = st.phone.trim();
      if (st.notes !== undefined && st.notes !== (st.client?.notes || '')) out.notes = st.notes.trim();
      return out;
    }
    case 'status': return { status: st.status };
    case 'farm': return { name: st.name.trim(), locations: st.places };
    case 'place': return { names: st.places };
    case 'charge': return { amount: st.amount, reason: st.reason.trim() };
    case 'payment': return { amount: st.amount, method: st.method, note: '' };
    case 'balance': return { target: st.target, note: st.note.trim() };
    case 'reminder': return { amount: st.amount || 0, note: st.note.trim() };
    default: return {};
  }
}

async function commit(st, author) {
  const until = st.ends === 'yes' ? st.until : '';
  if (st.kind === 'start') {
    const farm = farmById(st.farmId);
    return registerFuture({
      data: { ...emptyClient(farm), name: st.name.trim(), locationId: st.locationId, mealsPerDay: st.meals },
      farm, on: st.on, until,
    }, author);
  }
  return scheduleSet({
    kind: st.kind,
    on: st.on,
    until,
    client: st.client,
    farm: st.kind === 'place' ? farmById(st.farmId) : null,
    value: valueOf(st),
  }, author);
}
