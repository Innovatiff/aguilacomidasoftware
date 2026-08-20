/**
 * Settings — your own account, who else can get in, and what the numbers add
 * up to.
 *
 * The team section is the security surface of the whole product. Adding an
 * address here grants every farm's contact details, every delivery and every
 * payment, so the screen says that plainly rather than making it sound like an
 * invitation.
 */

import { h } from '../lib/dom.js';
import { screen } from '../ui/shell.js';
import {
  card, button, badge, avatar, itemRow, list, defList, defRow, sectionLabel,
  alert, emptyState, field, input, statGrid, stat,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm, sheet } from '../ui/overlay.js';
import { session, signOutNow, updateOwnProfile } from '../data/session.js';
import { watchStaff, addStaff, removeStaff, isValidEmail, normalizeEmail } from '../data/staff.js';
import { store, subscribe, moneyStats } from '../data/store.js';
import { money, number } from '../lib/format.js';
import { formatStamp } from '../lib/dates.js';
import { toDate, dbMessage } from '../firebase.js';

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
      body: h('div.page__inner.stack.stack-4',
        profileCard(),
        teamCard(),
        numbersCard(),
        aboutCard(),
        button('Cerrar sesión', { variant: 'danger-soft', block: true, icon: 'logout', onClick: leave })),
    });
  }

  /* --- Cards --------------------------------------------------------------- */

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
              } catch (error) { toastBad(dbMessage(error)); }
            },
          }, 'Quitar'),
      chevron: false,
    });
  }

  function numbersCard() {
    const cash = moneyStats();
    const active = store.clients.filter((client) => client.status === 'active').length;

    return h('div.stack.stack-3',
      sectionLabel('Resumen'),
      statGrid([
        stat({ label: 'Ranchos activos', value: number(active), foot: `${store.clients.length} en total` }),
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
        defRow('Ciclo de cobro', 'Quincenal (14 días)'),
      ])));
  }

  /* --- Actions -------------------------------------------------------------- */

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
    } catch (error) { toastBad(error?.message || dbMessage(error)); }
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
    } catch (error) { toastBad(dbMessage(error)); }
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
