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

### 2. Crear el primer administrador

El registro dentro de la app nunca otorga acceso: crea una cuenta `pending` que
no puede leer nada. El primer administrador se crea una sola vez a mano.

1. **Authentication → Users → Add user**: correo y contraseña. Copia el **UID**.
2. **Firestore → Iniciar colección** `users`, con el **UID** como id del documento:

   | Campo | Tipo | Valor |
   |---|---|---|
   | `name` | string | Nombre de la persona |
   | `email` | string | El mismo correo |
   | `role` | string | `admin` |
   | `clientId` | null | *(vacío)* |

3. Entra a la app con ese correo.

A partir de ahí, quien más necesite acceso usa **Solicitar acceso** en la
pantalla de entrada y tú lo apruebas en **Ajustes → Solicitudes de acceso**.

### 3. Correr en local

No hay dependencias ni build. Cualquier servidor estático sirve:

```sh
npx http-server . -p 5173 -c-1
# o: python3 -m http.server 5173
```

Abre `http://localhost:5173`. Agrega `localhost` en
**Authentication → Settings → Authorized domains** si el inicio de sesión falla.

> Los módulos ES no funcionan abriendo `index.html` con `file://`. Usa un
> servidor.

### 4. Publicar

```sh
firebase deploy --only hosting:admin
```

Requiere un sitio de Hosting llamado `aguila-admin` en el proyecto
(**Hosting → Agregar otro sitio**). El sitio `aguila-clientes` es para la app de
los ranchos.

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
    session.js  clients.js  deliveries.js  invoices.js  chat.js  users.js
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
users/{uid}
  name, email, phone
  role        'admin' | 'client' | 'pending'
  clientId    string | null      -- sólo para clientes

clients/{clientId}
  name, contactName, phone, email, address, notes
  mealsPerDay, pricePerMeal
  deliveryDays [0-6]             -- 0 = domingo
  deliveryWindow, graceDays
  cycleAnchor  'YYYY-MM-DD'      -- inicio del ciclo quincenal
  status       'active' | 'paused' | 'inactive'
  accessCode                     -- 6 caracteres, para vincular la app
  linkedUids   [uid]

accessCodes/{CODIGO}
  clientId, clientName           -- se lee de uno en uno, nunca se lista

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

Las reglas en `firestore.rules` parten de dos hechos:

- **El rol vive en el servidor.** Registrarse sólo permite crear un perfil
  `client` o `pending`. Subir a `admin` únicamente lo puede hacer alguien que ya
  es `admin`.
- **Un rancho sólo ve lo suyo.** Firestore evalúa las reglas contra cada
  documento que devolvería una consulta, así que una consulta sin
  `where('clientId', '==', <el suyo>)` simplemente falla.

**Sobre los códigos de acceso.** Para vincular su app, el encargado del rancho
canjea un código de 6 caracteres; con él obtiene el id del rancho y se agrega a
`linkedUids`. La regla permite ese único cambio y nada más, pero se apoya en que
el id del documento no es adivinable: es la credencial. Es una compensación
consciente para no depender de Cloud Functions (plan de pago). Si más adelante
quieres cerrarlo del todo, mueve el canje a una Cloud Function y quita ese
permiso de escritura de las reglas. Mientras tanto, **Generar código nuevo** en
la ficha del rancho invalida el código anterior cuando haga falta.

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
