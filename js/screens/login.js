/**
 * Staff sign-in.
 *
 * There is no sign-up here. Who may run the panel is the `staff` list, written
 * from Ajustes → Equipo by somebody already on it — an admin sees every farm's
 * contact details and every payment, so that stays a deliberate act.
 *
 * The first administrator is the one exception, since there is nobody to add
 * them: on a project where the seat has never been claimed, the account that
 * signs in claims it. That happens once, ever (see `renderNoAccess`).
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { button, field, input, alert, avatar } from '../ui/kit.js';
import { toastOk } from '../ui/overlay.js';
import { signIn, resetPassword, session } from '../data/session.js';
import { isClaimed, claimFirstAdmin } from '../data/staff.js';
import { authMessage, errorText } from '../firebase.js';
import { versionLabel } from '../version.js';
import { t } from '../lib/i18n.js';
import { langSwitch } from '../ui/lang.js';

export function renderAuth(host) {
  let mode = 'signin';   // 'signin' | 'reset'
  let busy = false;
  let error = '';
  let notice = '';
  /** Once auth succeeds the session listener replaces this whole screen, and a
   *  late redraw here would paint the form back over the app. */
  let handedOff = false;

  const draw = () => { if (!handedOff) mount(host, view()); };

  const set = (next) => { mode = next; error = ''; notice = ''; draw(); };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    const values = Object.fromEntries(new FormData(event.target).entries());
    busy = true; error = ''; draw();

    try {
      if (mode === 'signin') {
        await signIn(values.email, values.password);
        handedOff = true;
        return;
      }
      await resetPassword(values.email);
      notice = t('Te enviamos un correo para restablecer tu contraseña.');
      mode = 'signin';
      toastOk(t('Correo enviado'));
    } catch (err) {
      error = authMessage(err);
    }

    busy = false;
    draw();
  }

  function view() {
    const copy = mode === 'signin'
      ? {
          lede: t('Panel de la cocina'),
          sub: t('Clientes, entregas y cobros del día en un solo lugar.'),
          cta: t('Entrar'),
        }
      : {
          lede: t('Recuperar acceso'),
          sub: t('Te enviaremos un enlace para crear una contraseña nueva.'),
          cta: t('Enviar enlace'),
        };

    return h('div.auth',
      hero(copy.lede, copy.sub),
      h('div.auth__body',
        h('form.stack.stack-4', { onsubmit: submit, novalidate: true },
          error ? alert(error, 'bad') : null,
          notice ? alert(notice, 'ok') : null,

          field({
            label: t('Correo'),
            control: input({
              name: 'email', type: 'email', required: true, autocomplete: 'email',
              inputmode: 'email', placeholder: t('tu@correo.com'),
            }),
          }),

          mode === 'signin' ? field({ label: t('Contraseña'), control: passwordInput() }) : null,

          h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit', disabled: busy },
            busy ? h('span.spinner.spinner--light') : null,
            busy ? t('Un momento…') : copy.cta),

          mode === 'signin'
            ? h('button.btn.btn--quiet.btn--block', { type: 'button', onclick: () => set('reset') },
                t('Olvidé mi contraseña'))
            : h('button.btn.btn--quiet.btn--block', { type: 'button', onclick: () => set('signin') },
                t('Volver'))),

        h('p.t-xs.c-faint.center', { style: { marginTop: '20px', lineHeight: '1.5' } },
          t('Las cuentas del equipo las agrega un administrador desde el panel. Si necesitas acceso, pídeselo.')),
        h('p.t-xs.c-faint.center', { style: { marginTop: '8px' } }, versionLabel()),
        // Before anybody has signed in, so the screen can be read from the start.
        h('div.center', { style: { marginTop: '16px' } }, langSwitch())));
  }

  draw();
}

const hero = (lede, sub) => h('div.auth__hero',
  h('div.auth__mark',
    h('span', { style: { color: 'var(--brand-500)' } }, icon('eagle')),
    h('div',
      h('div.auth__name', 'El Águila Cocina'),
      h('div.auth__tag', t('Administración')))),
  h('h1.auth__lede', lede),
  h('p.auth__sub', sub));

/** Password field with a show/hide toggle — typing blind on a phone is worse. */
function passwordInput() {
  const box = input({
    name: 'password', type: 'password', required: true, minlength: 6,
    autocomplete: 'current-password', placeholder: '••••••••',
  });

  const toggle = h('button.input-group__icon', {
    type: 'button', 'aria-label': t('Mostrar contraseña'),
    style: { left: 'auto', right: '12px', pointerEvents: 'auto', background: 'none' },
    onclick: () => {
      const showing = box.type === 'text';
      box.type = showing ? 'password' : 'text';
      mount(toggle, icon(showing ? 'eye' : 'eyeOff'));
      toggle.setAttribute('aria-label', showing ? t('Mostrar contraseña') : t('Ocultar contraseña'));
    },
  }, icon('eye'));

  const wrap = h('div.input-group', box, toggle);
  box.style.paddingLeft = '12px';
  box.style.paddingRight = '42px';
  return wrap;
}

/**
 * Shown when the credentials were right but the address is not on the team.
 *
 * Two very different situations land here, and conflating them is what makes a
 * fresh install feel broken:
 *
 *   - Nobody has claimed the first-administrator seat. There is no one to ask,
 *     so this account takes it. Possible once in the life of the project.
 *   - The team already exists. Then this really is a wait, and the screen says
 *     exactly where the address gets added so the person can ask for it.
 *
 * The staff document is watched live, so being added flips this screen into the
 * panel without anyone reloading anything.
 */
export function renderNoAccess(host, { name, email, onSignOut }) {
  let claimed = null;      // null = still checking
  let busy = false;
  let error = '';
  let handedOff = false;   // claimed, or this screen was left: draw nothing more

  const draw = () => { if (!handedOff) mount(host, view()); };

  // Answered after the screen may already be gone — signed out, or added to
  // the team — and then it must not draw itself back over what came next.
  isClaimed()
    .then((value) => { claimed = value; draw(); })
    .catch(() => { claimed = true; draw(); });

  async function claim() {
    if (busy) return;
    busy = true; error = ''; draw();

    try {
      await claimFirstAdmin(session.user, name);
      handedOff = true;
      toastOk(t('Listo, ya eres administrador'));
      // The staff watcher sees the new document and swaps in the panel.
    } catch (err) {
      busy = false;
      // Somebody claimed the seat between our check and our write.
      claimed = true;
      error = err?.code === 'permission-denied'
        ? t('Alguien más creó la primera cuenta hace un momento. Pídele que te agregue al equipo.')
        : errorText(err);
      draw();
    }
  }

  function view() {
    if (claimed === null) {
      return h('div.auth',
        hero(t('Un momento'), t('Estamos revisando el estado de tu cuenta.')),
        h('div.auth__body', h('div.loading', h('div.spinner.spinner--lg'))));
    }
    return claimed ? waitingView() : founderView();
  }

  const accountCard = () => h('div.card',
    h('div.row',
      avatar(name || email || '?'),
      h('div.grow',
        h('div.w-650', name || t('Tu cuenta')),
        h('div.t-sm.c-soft', email || ''))));

  /* --- Nobody runs the panel yet ------------------------------------------ */

  function founderView() {
    return h('div.auth',
      hero(t('Instalación nueva'),
        t('Todavía no hay ningún administrador. Esta cuenta puede ser la primera.')),
      h('div.auth__body.stack.stack-4',
        error ? alert(error, 'bad') : null,
        accountCard(),

        h('div.card',
          h('p.t-sm.c-soft', { style: { lineHeight: '1.5' } },
            t('Como administrador verás todos los ranchos, sus datos de contacto, sus entregas y todos los pagos. También podrás agregar al resto del equipo desde Ajustes.'))),

        alert(t('Esto sólo se puede hacer una vez. Después, cada persona nueva se agrega desde Ajustes → Equipo.'), 'warn'),

        h('button.btn.btn--primary.btn--block.btn--lg', {
          type: 'button', disabled: busy, onclick: claim,
        },
          busy ? h('span.spinner.spinner--light') : icon('shield'),
          busy ? t('Un momento…') : t('Empezar como administrador')),

        button(t('Cerrar sesión'), { variant: 'quiet', block: true, icon: 'logout', onClick: onSignOut })));
  }

  /* --- The team exists; this address is not on it -------------------------- */

  function waitingView() {
    return h('div.auth',
      hero(t('Sin acceso al panel'),
        t('Entraste correctamente, pero este correo todavía no está en el equipo.')),
      h('div.auth__body.stack.stack-4',
        error ? alert(error, 'bad') : null,
        accountCard(),

        h('div.card',
          h('div.stack.stack-3',
            h('div.row',
              h('span', { style: { color: 'var(--brand-500)' } }, icon('shield')),
              h('div.w-650', t('Cómo se habilita'))),
            h('p.t-sm.c-soft', { style: { lineHeight: '1.5' } },
              t('Pídele a alguien del equipo que abra el panel y agregue este correo en')),
            h('div.t-sm.w-600', { style: { color: 'var(--brand-700)' } },
              t('Ajustes → Equipo → Agregar')),
            h('p.t-sm.c-soft', t('Toma un par de segundos y no hace falta tocar nada más.')))),

        alert(t('Esta pantalla se actualiza sola en cuanto te agreguen. Puedes cerrar la aplicación mientras tanto.'), 'info'),

        button(t('Cerrar sesión'), { variant: 'ghost', block: true, icon: 'logout', onClick: onSignOut })));
  }

  draw();
  return () => { handedOff = true; };
}
