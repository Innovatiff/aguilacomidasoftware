# El Águila Cocina — Administración

Panel de la cocina: ranchos, ruta del día, cobro quincenal y mensajería con los
clientes. Diseñado para teléfono, sin paso de compilación — HTML, CSS y
JavaScript con módulos ES nativos.

La app del cliente vive en el repositorio `aguilacomidaapp` y usa el mismo
proyecto de Firebase.

---

## Qué resuelve

El Águila Cocina cocina todos los días y reparte a ranchos que pagan cada dos
semanas. Antes no se llevaba registro de nada. Este panel registra:

| | |
|---|---|
| **Ranchos** | datos de contacto, comidas por día, precio por comida, días de servicio |
| **Ruta** | una entrega por rancho por día, con estado en vivo que el rancho ve en su app |
| **Cobro** | ciclos de 14 días, facturas por periodo, pagos y saldos |
| **Mensajes** | un hilo por rancho, con avisos automáticos de pagos y problemas |

---

## Puesta en marcha

### 1. Requisitos en Firebase

En la [consola de Firebase](https://console.firebase.google.com/project/aguilacocina-24496):

1. **Authentication → Sign-in method →** activa **Correo electrónico/contraseña**.
2. **Firestore Database →** crea la base de datos en modo producción.
3. Publica las reglas e índices de este repositorio:

   ```sh
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules,firestore:indexes
   ```

### 2. La primera cuenta

Entra al panel con tu correo y tu contraseña de **Authentication**. Como el
proyecto todavía no tiene administrador, verás **Instalación nueva** y un botón
para quedarte como el primero. Un toque y estás dentro.

Eso pasa **una sola vez**: a partir de ahí el equipo se maneja desde el panel.

### 3. Agregar a alguien más

**Ajustes → Equipo → Agregar**, escribes su correo, listo. Esa persona entra
con ese correo y el panel se le abre solo.

Si todavía no tiene contraseña, la crea desde **Olvidé mi contraseña** en la
pantalla de entrada, o se la creas tú en **Authentication → Users → Add user**.

**Quitar el acceso** es el mismo lugar: **Ajustes → Equipo → Quitar**. Deja de
entrar de inmediato; su cuenta sigue existiendo y puedes volver a agregarla
cuando quieras.

Si alguien entra con un correo que no está en el equipo, ve **Sin acceso al
panel** — no un error — y la pantalla se convierte en el panel sola en cuanto lo
agregues.

> **Por qué no basta con crear la cuenta en Authentication.** La `apiKey` de
> este proyecto es pública (tiene que serlo, va en el navegador) y la app de los
> ranchos necesita registro abierto por correo. Cualquiera puede crear una
> cuenta de Authentication contra este proyecto con la API pública de Firebase,
> sin pasar por ninguna de las dos apps — así que tener una no demuestra nada.
> Estar en la lista `staff`, que sólo un administrador puede escribir, sí.

### 4. Registrar un rancho

**Ranchos → Nuevo**. El correo que escribas ahí es su acceso: con ese correo el
encargado entra a la app del rancho y ve lo suyo. No hay códigos que compartir.

Para mover o quitar ese acceso, cambia el correo en la ficha del rancho
(**Acceso a la app del rancho → Cambiar correo**). El anterior deja de funcionar
en el momento en que guardas.

### 5. Correr en local

No hay dependencias ni build. Cualquier servidor estático sirve:

```sh
npx http-server . -p 5173 -c-1
# o: python3 -m http.server 5173
```

Abre `http://localhost:5173`. Agrega `localhost` en
**Authentication → Settings → Authorized domains** si el inicio de sesión falla.

> Los módulos ES no funcionan abriendo `index.html` con `file://`. Usa un
> servidor.

### 6. Publicar en Netlify

El sitio se publica solo: Netlify vigila la rama del repositorio y sube cada
push. No hay build — la raíz del repositorio *es* el sitio, y `netlify.toml` ya
trae la configuración.

Al conectar el repositorio en Netlify:

| Campo | Valor |
|---|---|
| Branch to deploy | `claude/el-aguila-cocina-app-yo40te` |
| Build command | *(vacío)* |
| Publish directory | `.` |

**Autoriza el dominio en Firebase.** Sin esto el inicio de sesión falla con
`auth/unauthorized-domain`: consola de Firebase → **Authentication → Settings →
Authorized domains → Add domain**, y agrega el dominio de Netlify
(`tu-sitio.netlify.app` y tu dominio propio si lo tienes).

### 7. Publicar las reglas

**Publicar el sitio no publica las reglas.** Son dos cosas distintas y es la
causa más común de «ya lo arreglé pero sigue igual». Netlify sube la app;
Firestore no se entera.

Las reglas se publican desde la consola, sin instalar nada:

1. Consola de Firebase → **Firestore Database → Reglas**.
2. Pega el contenido de `firestore.rules` y **Publicar**.

**Los índices.** Hacen falta tres, y no se pegan: se crean con un clic. La
primera vez que abras la ficha de un rancho, si falta alguno el panel te muestra
**Crear el índice en Firebase** con el enlace ya armado. Tarda un minuto en
quedar listo y no hay que volver a tocarlo.

Los tres están en `firestore.indexes.json` por si prefieres subirlos de golpe
con `firebase deploy --only firestore:indexes`.

> Sólo hace falta cuando cambian las reglas mismas. Agregar gente al equipo o
> registrar ranchos **no** requiere republicar nada: eso se escribe desde el
> panel.

---

## Cómo está organizado

```
index.html            una sola página; todo lo demás se monta con JavaScript
sw.js                 service worker: cachea el shell para trabajar sin señal
manifest.webmanifest  instalable en el teléfono

css/
  tokens.css          color, tipografía, espacio, sombras
  base.css            reset, barra superior, barra de pestañas, utilidades
  components.css      tarjetas, botones, formularios, hojas, avisos
  screens.css         patrones de pantalla: chat, línea de tiempo, ruta

js/
  app.js              arranque, sesión y rutas
  firebase.js         SDK de Firebase (CDN) y configuración del proyecto
  lib/
    dom.js            constructor de elementos `h()` — 100 líneas, sin framework
    router.js         router por hash
    dates.js          días como "YYYY-MM-DD", formato en español
    billing.js        ciclos quincenales, vencimientos, estados de factura
    format.js         dinero (CAD), números, teléfonos, iniciales
    model.js          estados de entrega, métodos de pago, respuestas rápidas
    icons.js          set de iconos SVG
  data/               una capa por colección de Firestore
    session.js  staff.js  clients.js  deliveries.js  invoices.js  chat.js
    store.js          escuchas compartidas del panel
  ui/                 shell, kit de componentes, hojas, chat
  screens/            una pantalla por archivo
```

### Decisiones que conviene conocer

**Los días son cadenas, no marcas de tiempo.** Una entrega ocurre el *martes*,
no a las 19:00 UTC. Guardar `2026-08-19` elimina los errores de zona horaria
entre el teléfono de la cocina y el del rancho.

**Los ids son deterministas.** Una entrega es `clientId_fecha` y una factura es
`clientId_inicioDePeriodo`. Dos teléfonos marcando la misma parada convergen en
el mismo documento, y volver a facturar un periodo actualiza la factura en vez
de duplicarla.

**El cobro es aritmética, no calendario.** Cada rancho tiene una fecha ancla y
el periodo *i* va de `ancla + 14i` a `ancla + 14i + 13`. Cualquier fecha cae en
exactamente un periodo sin tabla de horarios ni tarea programada.

**Los pagos se registran en transacción.** Dos personas cobrando el mismo rancho
desde dos teléfonos leerían ambas `paid: 0`; la transacción impide que el
segundo registro borre el primero.

**El estado de la factura se calcula al leer.** «Vencido» depende de la fecha de
hoy, así que se deriva en cada render. Lo único que se guarda es `settled`, un
booleano, porque Firestore no puede comparar dos campos en una consulta y es la
única forma de preguntar «¿quién debe?» en una sola lectura.

**Persistencia sin conexión activada.** El chofer marca «entregado» con una
barra de señal en un camino de terracería; la escritura sobrevive hasta que
vuelve la conexión.

---

## Modelo de datos

```
staff/{correo}                   -- quién puede entrar al panel
  email, name, addedByName, addedAt, lastSeenAt

clientEmails/{correo}            -- a qué rancho pertenece ese correo
  clientId, clientName

config/bootstrap                 -- quién fue el primer administrador
  ownerUid, ownerEmail, at       -- se crea una vez y nunca se modifica

users/{uid}                      -- sólo datos personales; no otorga nada
  name, email, phone

clients/{clientId}
  name, contactName, phone, email, address, notes
  mealsPerDay, pricePerMeal
  deliveryDays [0-6]             -- 0 = domingo
  deliveryWindow, graceDays
  cycleAnchor  'YYYY-MM-DD'      -- inicio del ciclo quincenal
  status       'active' | 'paused' | 'inactive'
  email                          -- el acceso del rancho a su app

deliveries/{clientId_YYYY-MM-DD}
  clientId, clientName, date, meals, window, driver, notes
  status  'scheduled' | 'preparing' | 'en_route' | 'delivered' | 'skipped' | 'issue'
  events  [{ status, at, byName }]

invoices/{clientId_YYYY-MM-DD}
  clientId, clientName, periodStart, periodEnd, dueDate
  meals, pricePerMeal, amount, paid, settled
  payments [{ amount, method, date, reference, note, byName, at }]

conversations/{clientId}
  clientName, lastMessage, lastAt, lastSenderRole
  unreadAdmin, unreadClient, adminReadAt, clientReadAt
  members [uid]

conversations/{clientId}/messages/{id}
  text, kind ('text' | 'system'), senderUid, senderName, senderRole, at
```

---

## Seguridad

Las reglas en `firestore.rules` descansan en tres cosas:

- **La identidad es el correo, y las dos listas las escribe el panel.**
  `staff/{correo}` decide quién entra al panel; `clientEmails/{correo}` decide a
  qué rancho pertenece alguien. Ninguna de las dos la puede escribir quien no es
  ya administrador, así que nadie se otorga nada a sí mismo.
- **Un rancho sólo ve lo suyo.** Firestore evalúa las reglas contra cada
  documento que devolvería una consulta, así que una consulta sin
  `where('clientId', '==', <el suyo>)` simplemente falla. No es el código de la
  app el que limita al rancho: es la regla.
- **El dinero es de un solo sentido.** Los ranchos leen `invoices` y
  `deliveries`; sólo la cocina escribe. Un mensaje enviado no se edita ni se
  borra, ni siquiera por un administrador.

### Vincular una cuenta a un rancho

No hay paso de vinculación. Cuando el manager registra el rancho con un correo,
se escribe `clientEmails/{correo} -> clientId`, y las reglas consultan ese
documento cuando esa persona entra. El rancho no reclama nada ni canjea nada:
que la cocina escriba el correo **es** la autorización, y cambiarlo mueve el
acceso con él.

### Probar las reglas

Una regla puede leerse bien y estar mal, así que están probadas contra el
emulador:

```sh
cd tests/rules
npm install      # sólo la primera vez
npm test
```

53 pruebas cubren lo que cada quien puede y no puede hacer: que un rancho no
alcance a otro, que no pueda tocar su propio precio ni sus facturas, que nadie
se agregue solo a `staff` ni reapunte su correo a otro rancho, y que la primera
cuenta se pueda reclamar exactamente una vez. Ver `tests/rules/README.md`.

---

## Operación diaria

1. **Generar la ruta** — desde Inicio o Ruta. Crea una entrega por rancho activo
   que reciba comida ese día. Volver a generarla no pisa el avance.
2. **Avanzar las paradas** — un toque por parada, o el botón masivo del
   encabezado para mover todas las que están en el mismo estado.
3. **Cerrar la quincena** — en Cobranza. Cuenta las comidas realmente entregadas
   del periodo cerrado y emite una factura por rancho, con vista previa antes de
   escribir nada.
4. **Registrar pagos** — desde la factura o la ficha del rancho. El rancho recibe
   un aviso automático en su chat.
