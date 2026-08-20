/**
 * Staff sign-in.
 *
 * There is no sign-up here, on purpose. An administrator sees every farm's
 * contact details, every delivery and every payment, so those accounts are
 * created deliberately in the Firebase console — an Auth user plus a
 * `users/{uid}` document with `role: 'admin'` — and never by anyone filling in
 * a form. The security rules enforce the same thing: no caller can write
 * themselves that role.
 *
 * See the README for the three-step setup.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { button, field, input, alert, avatar } from '../ui/kit.js';
import { toastOk } from '../ui/overlay.js';
import { signIn, resetPassword } from '../data/session.js';
import { authMessage } from '../firebase.js';

export function renderAuth(host) {
  let mode = 'signin';   // 'signin' | 'reset'
  let busy = false;
  let error = '';
  let notice = '';
  /** Once auth succeeds the session listener replaces this whole screen, and a
   *  late redraw here would paint the form back over the app. */
  let handedOff = false;

  const draw = () => { if (!handedOff) mount(host, view()); };

  function set(next) {
    mode = next; error = ''; notice = ''; draw();
  }

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
      notice = 'Te enviamos un correo para restablecer tu contraseña.';
      mode = 'signin';
      toastOk('Correo enviado');
    } catch (err) {
      error = authMessage(err);
    }

    busy = false;
    draw();
  }

  function view() {
    const copy = mode === 'signin'
      ? {
          lede: 'Panel de la cocina',
          sub: 'Clientes, entregas y cobros del día en un solo lugar.',
          cta: 'Entrar',
        }
      : {
          lede: 'Recuperar acceso',
          sub: 'Te enviaremos un enlace para crear una contraseña nueva.',
          cta: 'Enviar enlace',
        };

    return h('div.auth',
      h('div.auth__hero',
        h('div.auth__mark',
          h('span', { style: { color: 'var(--brand-500)' } }, icon('eagle')),
          h('div',
            h('div.auth__name', 'El Águila Cocina'),
            h('div.auth__tag', 'Administración'))),
        h('h1.auth__lede', copy.lede),
        h('p.auth__sub', copy.sub)),

      h('div.auth__body',
        h('form.stack.stack-4', { onsubmit: submit, novalidate: true },
          error ? alert(error, 'bad') : null,
          notice ? alert(notice, 'ok') : null,

          field({
            label: 'Correo',
            control: input({
              name: 'email', type: 'email', required: true, autocomplete: 'email',
              inputmode: 'email', placeholder: 'tu@correo.com',
            }),
          }),

          mode === 'signin' ? field({
            label: 'Contraseña',
            control: passwordInput(),
          }) : null,

          h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit', disabled: busy },
            busy ? h('span.spinner.spinner--light') : null,
            busy ? 'Un momento…' : copy.cta),

          mode === 'signin'
            ? h('button.btn.btn--quiet.btn--block', { type: 'button', onclick: () => set('reset') },
                'Olvidé mi contraseña')
            : h('button.btn.btn--quiet.btn--block', { type: 'button', onclick: () => set('signin') },
                'Volver')),

        h('p.t-xs.c-faint.center', { style: { marginTop: '20px', lineHeight: '1.5' } },
          'Las cuentas del equipo las crea el administrador. '
          + 'Si necesitas acceso, pídeselo.')));
  }

  draw();
}

/** Password field with a show/hide toggle — typing blind on a phone is worse. */
function passwordInput() {
  const box = input({
    name: 'password', type: 'password', required: true, minlength: 6,
    autocomplete: 'current-password', placeholder: '••••••••',
  });

  const toggle = h('button.input-group__icon', {
    type: 'button', 'aria-label': 'Mostrar contraseña',
    style: { left: 'auto', right: '12px', pointerEvents: 'auto', background: 'none' },
    onclick: () => {
      const showing = box.type === 'text';
      box.type = showing ? 'password' : 'text';
      mount(toggle, icon(showing ? 'eye' : 'eyeOff'));
      toggle.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
    },
  }, icon('eye'));

  const wrap = h('div.input-group', box, toggle);
  box.style.paddingLeft = '12px';
  box.style.paddingRight = '42px';
  return wrap;
}

/**
 * Shown when the credentials were right but the account is not an
 * administrator — its `users/{uid}` document is missing, carries another role,
 * or its access was revoked.
 *
 * The profile is watched live, so the moment an administrator grants access
 * this screen turns into the panel without anyone reloading anything.
 */
export function renderNoAccess(host, { name, email, error, onRetry, onSignOut }) {
  const refused = error?.code === 'permission-denied';

  mount(host, h('div.auth',
    h('div.auth__hero',
      h('div.auth__mark',
        h('span', { style: { color: 'var(--brand-500)' } }, icon('eagle')),
        h('div',
          h('div.auth__name', 'El Águila Cocina'),
          h('div.auth__tag', 'Administración'))),
      h('h1.auth__lede', 'Sin acceso al panel'),
      h('p.auth__sub',
        'Entraste correctamente, pero esta cuenta todavía no está habilitada '
        + 'para ver la información de los clientes.')),

    h('div.auth__body.stack.stack-4',
      h('div.card',
        h('div.row',
          avatar(name || email || '?'),
          h('div.grow',
            h('div.w-650', name || 'Tu cuenta'),
            h('div.t-sm.c-soft', email || '')))),

      // Say exactly which wall we hit. "Nothing happened" is the hardest
      // failure to act on, and the causes need different fixes.
      refused
        ? alert('Las reglas publicadas en Firestore no incluyen este correo en '
          + 'staffEmails(). Vuelve a pegar el contenido completo de '
          + 'firestore.rules en la consola y publícalas.', 'bad')
        : error
          ? alert(`No se pudo configurar la cuenta: ${error.message || error.code || error}`, 'bad')
          : null,

      h('div.card',
        h('div.stack.stack-3',
          h('div.row',
            h('span', { style: { color: 'var(--brand-500)' } }, icon('shield')),
            h('div.w-650', 'Cómo se habilita')),
          h('p.t-sm.c-soft', { style: { lineHeight: '1.5' } },
            'Si ya hay un administrador, te da acceso desde Ajustes → Cuentas '
            + 'sin acceso. Si todavía no hay ninguno, este correo tiene que estar '
            + 'en la lista del equipo, dentro de las reglas publicadas en '
            + 'Firestore → Reglas:'),
          h('div', {
            style: {
              padding: '10px 12px', borderRadius: 'var(--r-md)',
              background: 'var(--ink-800)', color: '#fff',
              fontFamily: 'var(--font-num)', fontSize: 'var(--fs-xs)',
              lineHeight: '1.6', overflowX: 'auto', whiteSpace: 'pre',
            },
          }, `function staffEmails() {\n  return [\n    '${email || 'tu@correo.com'}',\n  ];\n}`),
          h('p.t-xs.c-faint',
            'Pega el archivo firestore.rules completo en la consola y publícalo. '
            + 'Después toca «Reintentar».'))),

      onRetry
        ? button('Reintentar', { variant: 'primary', block: true, icon: 'refresh', onClick: onRetry })
        : null,

      alert('Esta pantalla se actualiza sola en cuanto te habiliten. '
        + 'Puedes cerrar la aplicación mientras tanto.', 'info'),

      button('Cerrar sesión', { variant: 'ghost', block: true, icon: 'logout', onClick: onSignOut }))));
}
