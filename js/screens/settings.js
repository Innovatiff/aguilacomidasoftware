/**
 * Settings — the price list, your own account, and who else can get in.
 *
 * Prices come first because they are the setting anybody actually comes here to
 * change, and because they are the one number the whole business runs on: a
 * fortnight costs what this screen says it costs.
 *
 * The team section is the security surface of the whole product. Adding an
 * address here grants every farm's contact details, every delivery and every
 * payment, so the screen says that plainly rather than making it sound like an
 * invitation.
 */

import { h, mount } from '../lib/dom.js';
import { screen } from '../ui/shell.js';
import { icon } from '../lib/icons.js';
import {
  card, button, badge, avatar, itemRow, list, defList, defRow, sectionLabel,
  alert, emptyState, field, input, moneyInput, statGrid, stat,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm, sheet } from '../ui/overlay.js';
import { session, signOutNow, updateOwnProfile } from '../data/session.js';
import { watchStaff, addStaff, removeStaff, isValidEmail, normalizeEmail } from '../data/staff.js';
import { savePricing } from '../data/pricing.js';
import { saveBusiness, DEFAULT_BUSINESS } from '../data/business.js';
import { printReceipt } from '../ui/print.js';
import { store, subscribe, activeClients, moneyStats, unpriced } from '../data/store.js';
import { money, number, plural } from '../lib/format.js';
import { formatStamp, today } from '../lib/dates.js';
import { PAY_EVERY, payEveryOf } from '../lib/billing.js';
import { errorText, toDate } from '../firebase.js';

export function renderSettings() {
  let team = [];

  const stops = [
    watchStaff((rows) => { team = rows; draw(); }, () => {}),
    subscribe(() => draw()),
  ];

  function draw() {
    screen({
      title: 'Ajustes',
      subtitle: session.displayName,
      tab: 'settings',
      sunken: true,
      body: h('div.page__inner.page__inner--flow.stack.stack-4',
        pricesCard(),
        receiptCard(),
        profileCard(),
        teamCard(),
        numbersCard(),
        aboutCard(),
        button('Cerrar sesión', { variant: 'danger-soft', block: true, icon: 'logout', onClick: leave })),
    });
  }

  /* --- Cards --------------------------------------------------------------- */

  /**
   * The price of a fortnight, by plan.
   *
   * One meal a day is one price, two is another; that is the whole price list.
   * Changing a number here changes what the next fortnight costs everywhere —
   * the counter, the bills issued from now on, what each client's app quotes —
   * and changes nothing about the fortnights already billed.
   */
  function pricesCard() {
    const missing = unpriced();

    return h('div.stack.stack-3',
      sectionLabel('Precios por quincena', h('button.btn.btn--soft.btn--sm', {
        type: 'button', onclick: editPrices,
      }, 'Cambiar')),

      list(store.pricing.tiers.map((tier) => itemRow({
        lead: h('span.item__ico', icon('utensils')),
        title: `${plural(tier.mealsPerDay, 'comida', 'comidas')} al día`,
        meta: `${countOn(tier.mealsPerDay)} con este plan`,
        end: h('span.t-lg.w-700', money(tier.price)),
        chevron: false,
      })), { card: true }),

      card(defList([
        defRow('Semana estándar', `${store.pricing.referenceDays} días de servicio`),
        defRow('Comida extra o de menos', money(store.pricing.extraMealPrice)),
        defRow('Pagan cada semana', `${weeklyCount()} de ${store.clients.length}`),
      ])),

      h('p.t-xs.c-faint',
        `El precio del plan cubre ${store.pricing.referenceDays} días de servicio. Quien come `
        + 'menos días paga menos, y quien lleva comidas extra paga más, a ese precio por comida.'),

      missing.length
        ? alert(`${plural(missing.length, 'cliente', 'clientes')} sin plan: `
          + `${[...new Set(missing.map((client) => client.mealsPerDay))].sort((a, b) => a - b)
            .map((meals) => `${meals} al día`).join(', ')}. `
          + 'Agrega ese precio o cámbiales las comidas por día; mientras tanto no se les puede cobrar.', 'warn')
        : h('p.t-xs.c-faint',
            'Es lo que cuesta una quincena completa. Quien paga cada semana paga la mitad, dos '
            + 'veces: es la misma comida al mismo precio por plato. Las facturas ya emitidas '
            + 'conservan el precio con el que se emitieron.'));
  }

  /**
   * How many people are on the weekly cadence — context for a fortnightly list.
   *
   * A declaration, for the same reason `draw` is one: the listeners above call
   * `draw()` while they are being set up, and a `const` down here would still
   * be in its dead zone when `pricesCard` reaches for it.
   */
  function weeklyCount() {
    return store.clients.filter((client) => payEveryOf(client) === PAY_EVERY.WEEK).length;
  }

  // A declaration, not a const: the listeners fire `draw()` the moment they are
  // set up, which is before a `const` further down this function would exist.
  function countOn(mealsPerDay) {
    return plural(
      store.clients.filter((client) => Number(client.mealsPerDay) === Number(mealsPerDay)).length,
      'cliente', 'clientes');
  }

  /**
   * The heading printed on every receipt.
   *
   * Here rather than in the source because it is the kitchen's information,
   * not the software's: a phone number that changes should be something
   * somebody types on a Tuesday, not a release. The sample print is the point
   * of the card — nobody should have to take a real payment to find out that
   * the address has a typo.
   */
  function receiptCard() {
    const info = store.business || DEFAULT_BUSINESS;

    return h('div.stack.stack-3',
      sectionLabel('Recibo impreso', h('button.btn.btn--soft.btn--sm', {
        type: 'button', onclick: editReceipt,
      }, icon('edit'), 'Editar')),
      card(h('div.stack.stack-3',
        defList([
          defRow('Negocio', info.name),
          info.address ? defRow('Dirección', info.address) : null,
          info.city ? defRow('Ciudad', info.city) : null,
          info.phone ? defRow('Teléfono', info.phone) : null,
          info.email ? defRow('Correo', info.email) : null,
          defRow('Pie', info.footer),
        ].filter(Boolean)),
        h('p.t-xs.c-faint',
          'Es lo que se imprime arriba de cada recibo, en la impresora del mostrador '
          + '(papel de 3 pulgadas).'),
        button('Imprimir una prueba', {
          variant: 'ghost', block: true, size: 'sm', icon: 'receipt', onClick: testPrint,
        }))));
  }

  function editReceipt() {
    const draft = { ...(store.business || DEFAULT_BUSINESS) };
    const set = (key) => (event) => { draft[key] = event.target.value; };

    sheet({
      title: 'Recibo impreso',
      build: (close) => h('form.stack.stack-4', {
        onsubmit: async (event) => {
          event.preventDefault();
          try {
            await saveBusiness(draft, { name: session.displayName });
            toastOk('Recibo actualizado');
            close(true);
          } catch (error) { toastBad(errorText(error)); }
        },
      },
      field({ label: 'Nombre del negocio', control: input({ value: draft.name, oninput: set('name') }) }),
      field({ label: 'Dirección', control: input({ value: draft.address, oninput: set('address') }) }),
      field({ label: 'Ciudad, provincia y código', control: input({ value: draft.city, oninput: set('city') }) }),
      field({ label: 'Teléfono', control: input({ value: draft.phone, oninput: set('phone') }) }),
      field({
        label: 'Correo',
        hint: 'Déjalo vacío si no quieres que salga en el recibo.',
        control: input({ value: draft.email, oninput: set('email') }),
      }),
      field({
        label: 'Pie del recibo',
        hint: 'La línea de despedida. Ej. GRACIAS POR SU PAGO.',
        control: input({ value: draft.footer, oninput: set('footer') }),
      }),
      h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' }, 'Guardar')),
    });
  }

  /**
   * A receipt with made-up numbers, so the paper can be checked for free.
   *
   * One slip, not the pair a real payment prints: this is here to see whether
   * the printer is on and the header is right, and it should not cost twice the
   * paper to find that out.
   */
  function testPrint() {
    printReceipt({
      id: 'prueba',
      folio: 'R-PRUEBA-0000',
      clientName: 'PRUEBA DE IMPRESION',
      farmName: 'Rancho de prueba',
      locationName: 'Casa 1',
      amount: 75,
      method: 'cash',
      date: today(),
      applied: [{ title: 'Quincena de prueba', amount: 75, kind: 'period' }],
      balanceAfter: 0,
      takenByName: session.displayName || '',
      at: new Date(),
    }, { business: store.business || DEFAULT_BUSINESS, copies: 1 });
  }

  function profileCard() {
    return card(h('div.stack.stack-3',
      h('div.row',
        avatar(session.displayName, { size: 'lg' }),
        h('div.grow',
          h('div.t-lg.w-700', session.displayName || 'Sin nombre'),
          h('div.t-sm.c-soft', session.email || ''),
          h('div', { style: { marginTop: '6px' } }, badge('Administrador', 'brand', 'shield')))),
      button('Editar mi perfil', { variant: 'ghost', size: 'sm', block: true, icon: 'edit', onClick: editProfile })));
  }

  function teamCard() {
    return h('div.stack.stack-3',
      sectionLabel(`Equipo · ${team.length}`, h('button.btn.btn--soft.btn--sm', {
        type: 'button', onclick: addMember,
      }, 'Agregar')),

      team.length
        ? list(team.map(memberRow), { card: true })
        : emptyState({ icon: 'users', title: 'Sólo tú', text: 'Nadie más puede entrar al panel.' }),

      h('p.t-xs.c-faint',
        'Quien esté en esta lista ve todos los ranchos, sus datos de contacto, '
        + 'sus entregas y todos los pagos. Basta con que entre con ese correo.'));
  }

  function memberRow(person) {
    const isMe = normalizeEmail(person.email) === session.email;
    const seen = toDate(person.lastSeenAt);

    return itemRow({
      lead: avatar(person.name || person.email),
      title: person.name || person.email,
      meta: [person.email, seen ? `visto ${formatStamp(seen)}` : 'nunca ha entrado']
        .filter(Boolean).join(' · '),
      end: isMe
        ? badge('Tú', 'brand')
        : h('button.btn.btn--sm.btn--ghost', {
            type: 'button',
            onclick: async (event) => {
              event.stopPropagation();
              if (!await confirm({
                title: `Quitar a ${person.name || person.email}`,
                message: 'Dejará de poder entrar al panel de inmediato. Su cuenta de acceso '
                  + 'sigue existiendo; puedes volver a agregar el correo cuando quieras.',
                confirmLabel: 'Quitar del equipo', tone: 'danger', icon: 'ban',
              })) return;
              try {
                await removeStaff(person.email);
                toastOk('Acceso retirado');
              } catch (error) { toastBad(errorText(error)); }
            },
          }, 'Quitar'),
      chevron: false,
    });
  }

  function numbersCard() {
    const cash = moneyStats();
    const active = activeClients().length;

    return h('div.stack.stack-3',
      sectionLabel('Resumen'),
      statGrid([
        stat({ label: 'Clientes activos', value: number(active), foot: `en ${plural(store.farms.length, 'rancho', 'ranchos')}` }),
        stat({ label: 'Por cobrar', value: money(cash.outstanding, { round: true }), foot: `${store.outstanding.length} facturas` }),
      ]));
  }

  // A declaration, not a const: the listeners below fire `draw()` the moment
  // they are set up, which is before a `const` further down would exist.
  function aboutCard() {
    return h('div.stack.stack-3',
      sectionLabel('Acerca de'),
      card(defList([
        defRow('Aplicación', 'El Águila Cocina · Administración'),
        defRow('Versión', '1.0.0'),
        defRow('Moneda', 'CAD'),
        defRow('Ciclo de cobro', 'Semanal o quincenal, por cliente'),
      ])));
  }

  /* --- Actions -------------------------------------------------------------- */

  /**
   * Editing the price list.
   *
   * Rows can be added because plans do change — somebody starts taking three
   * meals a day — but a plan that people are on cannot be removed out from
   * under them, so the sheet says how many are on each before letting it go.
   */
  async function editPrices() {
    const result = await sheet({
      title: 'Precios por quincena',
      build: (close) => {
        const draft = store.pricing.tiers.map((tier) => ({ ...tier }));
        let draftDays = store.pricing.referenceDays;
        let draftRate = store.pricing.extraMealPrice;
        const rows = h('div.stack.stack-3');
        const rate = h('p.t-xs.c-faint');

        // The rate is arithmetic, so show the arithmetic: nobody should have to
        // wonder where $6.25 came from when a client asks at the counter.
        const paintRate = () => {
          const first = draft[0];
          const suggested = first && draftDays
            ? Math.round((first.price / (draftDays * first.mealsPerDay)) * 100) / 100
            : 0;
          mount(rate, suggested
            ? `${money(first.price)} ÷ ${draftDays} días = ${money(suggested)} por comida.`
            : 'Escribe el primer plan para ver el cálculo.');
        };

        const paint = () => mount(rows, draft.map((tier, index) => h('div.card.card--tight',
          h('div.row',
            h('div.grow',
              field({
                label: 'Comidas al día',
                control: input({
                  value: tier.mealsPerDay, type: 'number', inputmode: 'numeric', min: '1', step: '1',
                  oninput: (event) => { draft[index].mealsPerDay = Number(event.target.value); },
                }),
              })),
            h('div.grow',
              field({
                label: 'Precio por quincena',
                control: moneyInput({
                  value: tier.price,
                  oninput: (event) => { draft[index].price = Number(event.target.value); },
                }),
              })),
            h('button.btn.btn--ghost.btn--sm.btn--icon', {
              type: 'button', 'aria-label': 'Quitar plan',
              style: { marginTop: '18px' },
              onclick: () => {
                const onIt = store.clients.filter(
                  (client) => Number(client.mealsPerDay) === Number(draft[index].mealsPerDay)).length;
                if (onIt) {
                  toastBad(`${plural(onIt, 'cliente está', 'clientes están')} en ese plan.`);
                  return;
                }
                draft.splice(index, 1);
                paint();
              },
            }, icon('x'))),
          h('div.t-xs.c-faint', countOn(tier.mealsPerDay) + ' en este plan'))));
        paint();
        paintRate();

        return h('div.stack.stack-4',
          h('p.t-sm.c-soft', 'Lo que cuesta una quincena completa en cada plan. A quien paga '
            + 'cada semana se le cobra la mitad, cada semana. Se aplica a las facturas que se '
            + 'emitan de aquí en adelante.'),
          rows,

          h('div.divider'),

          h('div.row', { style: { gap: '12px', alignItems: 'flex-start' } },
            h('div.grow', field({
              label: 'Días de la semana estándar',
              hint: 'Los días que cubre el precio del plan.',
              control: input({
                value: draftDays, type: 'number', inputmode: 'numeric', min: '1', max: '14', step: '1',
                oninput: (event) => { draftDays = Number(event.target.value); paintRate(); },
              }),
            })),
            h('div.grow', field({
              label: 'Comida extra',
              hint: 'Lo que suma o resta una comida.',
              control: moneyInput({
                value: draftRate,
                oninput: (event) => { draftRate = Number(event.target.value); },
              }),
            }))),
          rate,
          button('Agregar un plan', {
            variant: 'ghost', block: true, icon: 'plus',
            onClick: () => {
              const next = Math.max(0, ...draft.map((tier) => Number(tier.mealsPerDay) || 0)) + 1;
              draft.push({ mealsPerDay: next, price: 0 });
              paint();
            },
          }),
          button('Guardar precios', {
            variant: 'primary', block: true,
            onClick: () => close({ tiers: draft, referenceDays: draftDays, extraMealPrice: draftRate }),
          }));
      },
    });
    if (!result) return;

    try {
      const saved = await savePricing(result, { name: session.displayName });
      toastOk(`${plural(saved.tiers.length, 'plan guardado', 'planes guardados')}`);
    } catch (error) { toastBad(errorText(error)); }
  }

  async function addMember() {
    const result = await sheet({
      title: 'Agregar al equipo',
      build: (close) => {
        let email = '';
        let name = '';
        return h('div.stack.stack-4',
          alert('Tendrá acceso completo: todos los ranchos, sus datos de contacto, '
            + 'sus entregas y todos los pagos.', 'warn'),
          field({
            label: 'Correo',
            hint: 'Con ese correo entra al panel. No necesita nada más.',
            control: input({
              type: 'email', inputmode: 'email', placeholder: 'persona@aguila.ca',
              autofocus: true,
              oninput: (event) => { email = event.target.value; },
            }),
          }),
          field({
            label: 'Nombre',
            control: input({
              placeholder: 'Cómo aparecerá en el equipo',
              oninput: (event) => { name = event.target.value; },
            }),
          }),
          button('Agregar', {
            variant: 'primary', block: true,
            onClick: () => close({ email: email.trim(), name: name.trim() }),
          }));
      },
    });
    if (!result?.email) return;

    if (!isValidEmail(result.email)) {
      toastBad('Ese correo no tiene un formato válido.');
      return;
    }
    if (team.some((person) => normalizeEmail(person.email) === normalizeEmail(result.email))) {
      toastBad('Ese correo ya está en el equipo.');
      return;
    }

    try {
      await addStaff(result.email, result.name, { name: session.displayName });
      toastOk('Agregado al equipo');
    } catch (error) { toastBad(errorText(error)); }
  }

  async function editProfile() {
    const result = await sheet({
      title: 'Mi perfil',
      build: (close) => {
        let name = session.profile?.name || session.staff?.name || '';
        let phone = session.profile?.phone || '';
        return h('div.stack.stack-4',
          field({ label: 'Nombre', control: input({ value: name, oninput: (e) => { name = e.target.value; } }) }),
          field({ label: 'Teléfono', control: input({ value: phone, type: 'tel', oninput: (e) => { phone = e.target.value; } }) }),
          field({
            label: 'Correo',
            hint: 'Es tu correo de acceso y no se puede cambiar desde aquí.',
            control: input({ value: session.email || '', disabled: true }),
          }),
          button('Guardar', {
            variant: 'primary', block: true,
            onClick: () => close({ name: name.trim(), phone: phone.trim() }),
          }));
      },
    });
    if (!result) return;

    try {
      await updateOwnProfile(result);
      toastOk('Perfil actualizado');
    } catch (error) { toastBad(errorText(error)); }
  }

  async function leave() {
    if (!await confirm({
      title: 'Cerrar sesión',
      message: '¿Seguro que quieres salir del panel?',
      confirmLabel: 'Cerrar sesión', tone: 'danger', icon: 'logout',
    })) return;
    await signOutNow();
  }

  draw();
  return () => stops.forEach((stop) => stop?.());
}
