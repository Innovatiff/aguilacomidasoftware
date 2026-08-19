/**
 * Staff sign-in.
 *
 * The first administrator is created once from the Firebase console (see
 * README). After that, new staff request access here: signing up creates a
 * `pending` profile with no read access to anything, and an existing admin
 * promotes them from Settings. That keeps "who can see every client and every
 * payment" a decision a human makes, not a shared code someone can pass on.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { button, field, input, alert } from '../ui/kit.js';
import { toastOk } from '../ui/overlay.js';
import { signIn, signUp, resetPassword } from '../data/session.js';
import { authMessage } from '../firebase.js';

export function renderAuth(host) {
  let mode = 'signin';   // 'signin' | 'request' | 'reset'
  let busy = false;
  let error = '';
  let notice = '';
  /** Set once auth succeeds: the session listener replaces this whole screen,
   *  and a late redraw here would paint the login form back over the app. */
  let handedOff = false;

  const draw = () => { if (!handedOff) mount(host, view()); };

  function set(next) {
    mode = next;
    error = '';
    notice = '';
    draw();
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    const form = event.target;
    const values = Object.fromEntries(new FormData(form).entries());
    busy = true; error = ''; draw();

    try {
      if (mode === 'signin') {
        await signIn(values.email, values.password);
        handedOff = true;
        return;
      }
      if (mode === 'request') {
        if (values.password.length < 6) throw { code: 'auth/weak-password' };
        await signUp({
          email: values.email,
          password: values.password,
          name: values.name,
          phone: values.phone,
          role: 'pending',
        });
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
    const copy = {
      signin:  { lede: 'Panel de la cocina', sub: 'Clientes, entregas y cobros del día en un solo lugar.', cta: 'Entrar' },
      request: { lede: 'Solicitar acceso', sub: 'Un administrador aprobará tu cuenta antes de que puedas entrar.', cta: 'Enviar solicitud' },
      reset:   { lede: 'Recuperar acceso', sub: 'Te enviaremos un enlace para crear una contraseña nueva.', cta: 'Enviar enlace' },
    }[mode];

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

          mode === 'request' ? field({
            label: 'Nombre completo',
            control: input({ name: 'name', required: true, autocomplete: 'name', placeholder: 'María López' }),
          }) : null,

          field({
            label: 'Correo',
            control: input({
              name: 'email', type: 'email', required: true, autocomplete: 'email',
              inputmode: 'email', placeholder: 'tu@correo.com',
            }),
          }),

          mode === 'request' ? field({
            label: 'Teléfono',
            hint: 'Opcional, para que la cocina pueda contactarte.',
            control: input({ name: 'phone', type: 'tel', autocomplete: 'tel', placeholder: '(604) 555-0143' }),
          }) : null,

          mode !== 'reset' ? field({
            label: 'Contraseña',
            hint: mode === 'request' ? 'Mínimo 6 caracteres.' : null,
            control: passwordInput(mode),
          }) : null,

          h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit', disabled: busy },
            busy ? h('span.spinner.spinner--light') : null,
            busy ? 'Un momento…' : copy.cta),

          mode === 'signin'
            ? h('button.btn.btn--quiet.btn--block', { type: 'button', onclick: () => set('reset') },
                'Olvidé mi contraseña')
            : null),

        h('div.auth__switch',
          mode === 'signin'
            ? [h('span', '¿Eres nuevo en el equipo? '),
               h('button', { type: 'button', onclick: () => set('request') }, 'Solicitar acceso')]
            : [h('span', '¿Ya tienes cuenta? '),
               h('button', { type: 'button', onclick: () => set('signin') }, 'Iniciar sesión')])));
  }

  draw();
}

/** Password field with a show/hide toggle — typing blind on a phone is worse. */
function passwordInput(mode) {
  const box = input({
    name: 'password', type: 'password', required: true, minlength: 6,
    autocomplete: mode === 'request' ? 'new-password' : 'current-password',
    placeholder: '••••••••',
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

/** Shown to a signed-in account that an admin has not approved yet. */
export function renderPending(host, { name, onSignOut }) {
  mount(host, h('div.auth',
    h('div.auth__hero',
      h('div.auth__mark',
        h('span', { style: { color: 'var(--brand-500)' } }, icon('eagle')),
        h('div',
          h('div.auth__name', 'El Águila Cocina'),
          h('div.auth__tag', 'Administración'))),
      h('h1.auth__lede', 'Cuenta en revisión'),
      h('p.auth__sub', `Gracias ${name || ''}. Un administrador debe aprobar tu acceso antes de que puedas ver la información de los clientes.`)),
    h('div.auth__body.stack.stack-4',
      alert('Te avisaremos en cuanto tu cuenta esté activa. Puedes cerrar la aplicación mientras tanto.', 'info'),
      button('Cerrar sesión', { variant: 'ghost', block: true, icon: 'logout', onClick: onSignOut }))));
}
