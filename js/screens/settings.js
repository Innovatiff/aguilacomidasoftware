/**
 * Settings — your own account, who else can get in, and what the numbers add
 * up to.
 *
 * The team section is the security surface of the whole product, so it says
 * plainly what an enabled account can see. Nobody signs up for the panel;
 * accounts appear here because someone created them in the Firebase console,
 * or because their access was revoked and is waiting to be restored.
 */

import { h } from '../lib/dom.js';
import { screen } from '../ui/shell.js';
import {
  card, button, badge, avatar, itemRow, list, defList, defRow, sectionLabel,
  alert, emptyState, field, input, statGrid, stat,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm, sheet } from '../ui/overlay.js';
import { session, signOutNow, updateOwnProfile } from '../data/session.js';
import { watchPending, watchStaff, approveStaff, revokeStaff, rejectRequest } from '../data/users.js';
import { store, subscribe, moneyStats } from '../data/store.js';
import { money, number, phone as fmtPhone } from '../lib/format.js';
import { formatStamp } from '../lib/dates.js';
import { toDate, dbMessage } from '../firebase.js';

export function renderSettings() {
  let pending = [];
  let staff = [];

  const stops = [
    watchPending((rows) => { pending = rows; draw(); }, () => {}),
    watchStaff((rows) => { staff = rows; draw(); }, () => {}),
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
        pending.length ? requestsCard() : null,
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
          h('div.t-sm.c-soft', session.user?.email || ''),
          h('div', { style: { marginTop: '6px' } }, badge('Administrador', 'brand', 'shield')))),
      button('Editar mi perfil', { variant: 'ghost', size: 'sm', block: true, icon: 'edit', onClick: editProfile })));
  }

  function requestsCard() {
    return h('div.stack.stack-3',
      sectionLabel(`Cuentas sin acceso · ${pending.length}`),
      alert('Estas cuentas existen pero no pueden entrar al panel. Habilitarlas les da acceso a todos los ranchos, sus datos de contacto, sus entregas y todos los pagos.', 'warn'),
      list(pending.map((person) => itemRow({
        lead: avatar(person.name || person.email),
        title: person.name || 'Sin nombre',
        meta: [person.email, person.phone ? fmtPhone(person.phone) : null].filter(Boolean).join(' · '),
        end: h('div.row', { style: { gap: '6px' } },
          h('button.btn.btn--sm.btn--ok', {
            type: 'button',
            onclick: async (event) => {
              event.stopPropagation();
              if (!await confirm({
                title: `Habilitar a ${person.name || person.email}`,
                message: 'Tendrá acceso completo al panel: todos los ranchos, sus datos de contacto, sus entregas y todos los pagos.',
                confirmLabel: 'Habilitar acceso', icon: 'shield',
              })) return;
              try {
                await approveStaff(person.id, { name: session.displayName });
                toastOk('Acceso habilitado');
              } catch (error) { toastBad(dbMessage(error)); }
            },
          }, 'Habilitar'),
          h('button.btn.btn--sm.btn--ghost', {
            type: 'button',
            onclick: async (event) => {
              event.stopPropagation();
              if (!await confirm({
                title: 'Eliminar perfil',
                message: 'Se borra su perfil del panel. La cuenta de acceso sigue existiendo en Firebase; bórrala también desde la consola si quieres retirarla del todo.',
                confirmLabel: 'Eliminar perfil', tone: 'danger', icon: 'ban',
              })) return;
              try {
                await rejectRequest(person.id);
                toastOk('Perfil eliminado');
              } catch (error) { toastBad(dbMessage(error)); }
            },
          }, 'Eliminar')),
        chevron: false,
      })), { card: true }));
  }

  function teamCard() {
    return h('div.stack.stack-3',
      sectionLabel(`Equipo · ${staff.length}`),
      staff.length
        ? list(staff.map((person) => itemRow({
            lead: avatar(person.name || person.email),
            title: person.name || person.email,
            meta: [
              person.email,
              toDate(person.lastSeenAt) ? `visto ${formatStamp(toDate(person.lastSeenAt))}` : null,
            ].filter(Boolean).join(' · '),
            end: person.id === session.uid
              ? badge('Tú', 'brand')
              : h('button.btn.btn--sm.btn--ghost', {
                  type: 'button',
                  onclick: async (event) => {
                    event.stopPropagation();
                    if (!await confirm({
                      title: `Quitar acceso a ${person.name || person.email}`,
                      message: 'Dejará de poder entrar al panel. Su cuenta se conserva y puedes volver a habilitarla cuando quieras, sin pasar por la consola.',
                      confirmLabel: 'Quitar acceso', tone: 'danger', icon: 'ban',
                    })) return;
                    try {
                      await revokeStaff(person.id);
                      toastOk('Acceso retirado');
                    } catch (error) { toastBad(dbMessage(error)); }
                  },
                }, 'Quitar'),
            chevron: false,
          })), { card: true })
        : emptyState({
            icon: 'users',
            title: 'Sólo tú',
            text: 'Nadie más tiene acceso al panel. Las cuentas nuevas se crean desde la consola de Firebase.',
          }));
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

  async function editProfile() {
    const result = await sheet({
      title: 'Mi perfil',
      build: (close) => {
        let name = session.profile?.name || '';
        let phone = session.profile?.phone || '';
        return h('div.stack.stack-4',
          field({ label: 'Nombre', control: input({ value: name, oninput: (e) => { name = e.target.value; } }) }),
          field({ label: 'Teléfono', control: input({ value: phone, type: 'tel', oninput: (e) => { phone = e.target.value; } }) }),
          field({ label: 'Correo', hint: 'El correo de acceso no se puede cambiar desde aquí.', control: input({ value: session.user?.email || '', disabled: true }) }),
          button('Guardar', { variant: 'primary', block: true, onClick: () => close({ name: name.trim(), phone: phone.trim() }) }));
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
