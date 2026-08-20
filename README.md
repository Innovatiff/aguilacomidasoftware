# El Águila Cocina — Administración

Panel de la cocina: ranchos, sus clientes, ruta del día, cobro quincenal y
mensajería. Diseñado para teléfono, sin paso de compilación — HTML, CSS y
JavaScript con módulos ES nativos.

La app del cliente vive en el repositorio `aguilacomidaapp` y usa el mismo
proyecto de Firebase.

---

## Qué resuelve

El Águila Cocina cocina todos los días y reparte en ranchos donde la gente paga
cada dos semanas. Antes no se llevaba registro de nada. Este panel registra:

| | |
|---|---|
| **Ranchos** | el lugar: contacto, **ubicaciones** (Casa 1, Bloque Norte…) y las condiciones acordadas — precio por comida, días de servicio, ciclo de cobro |
| **Clientes** | cada persona que come, con su rancho y su **ubicación obligatoria**. Hereda las condiciones del rancho; lo suyo es cuántas comidas lleva |
| **Ruta** | agrupada por rancho → ubicación: un toque mueve una ubicación completa, con estado en vivo que cada quien ve en su app |
| **Cobro** | ciclos de 14 días, **una factura por persona**, pagos y saldos, agrupados por rancho para cobrar |
| **Mensajes** | un hilo por cliente, con avisos automáticos de pagos y problemas |

**Por qué el rancho va primero.** Nadie come «en Mucci Farms»: come en Casa 1 de
Mucci Farms, y el chofer entrega por ubicación, no por persona. Por eso no se
puede registrar a nadie sin decir dónde está — y por eso el precio se acuerda
una vez con el rancho, no doscientas veces con su gente.

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

### 4. Registrar un rancho y a su gente

Son tres pasos y siempre en este orden:

1. **Ranchos → Nuevo.** El nombre, el contacto y las condiciones: precio por
   comida, días de servicio, horario y el inicio del ciclo de cobro. Todo esto
   se aplica a **todos** los clientes de ese rancho.
2. **Dentro del rancho → Ubicaciones → Agregar.** Casa 1, Bloque Norte,
   Invernadero 3 — como se le diga ahí. Un rancho sin ubicaciones no puede
   recibir gente, y el panel te lo dice.
3. **Dentro de la ubicación → Registrar cliente aquí.** Nombre, cuántas comidas
   lleva al día y, si tiene, su correo.

**El correo es opcional.** Es lo que abre su app; muchos trabajadores no tienen
uno el día que los registras y eso no debe frenar el alta. Se agrega después
desde su ficha, en **Acceso a su app**. Cambiarlo mueve el acceso; borrarlo lo
quita. No hay códigos que compartir.

**Cambiar el precio de un rancho** lo cambia para toda su gente: el panel te dice
a cuántos va a alcanzar antes de guardar. Las facturas ya emitidas no se tocan.

**Mover a alguien** — de ubicación o de rancho — se hace desde su ficha, en
**Cambiar de ubicación**. Al mover de rancho, sus condiciones pasan a ser las
del rancho nuevo.

Para eliminar una ubicación primero hay que mover a quien esté ahí, y para
eliminar un rancho primero hay que vaciarlo. Es a propósito: borrar en cascada
se llevaría entregas, facturas e historial de gente que sigue trabajando.

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
primera vez que abras la ficha de un cliente, si falta alguno el panel te muestra
**Crear el índice en Firebase** con el enlace ya armado. Tarda un minuto en
quedar listo y no hay que volver a tocarlo.

Los tres están en `firestore.indexes.json` por si prefieres subirlos de golpe
con `firebase deploy --only firestore:indexes`.

> Sólo hace falta cuando cambian las reglas mismas. Agregar gente al equipo,
> registrar ranchos o dar de alta clientes **no** requiere republicar nada: eso
> se escribe desde el panel.

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
    session.js  staff.js  farms.js  clients.js  deliveries.js
    invoices.js  chat.js
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

clientEmails/{correo}            -- a qué cliente pertenece ese correo
  clientId, clientName

config/bootstrap                 -- quién fue el primer administrador
  ownerUid, ownerEmail, at       -- se crea una vez y nunca se modifica

users/{uid}                      -- sólo datos personales; no otorga nada
  name, email, phone

farms/{farmId}                   -- el lugar y lo acordado con él
  name, contactName, phone, address, notes
  status       'active' | 'paused' | 'inactive'
  locations    [{ id, name }]    -- Casa 1, Bloque Norte, Invernadero 3
  pricePerMeal, deliveryWindow, graceDays
  deliveryDays [0-6]             -- 0 = domingo
  cycleAnchor  'YYYY-MM-DD'      -- inicio del ciclo quincenal
  defaultMealsPerDay             -- valor inicial al registrar a alguien

clients/{clientId}               -- una persona que come
  name, phone, email, notes
  farmId, farmName               -- obligatorio
  locationId, locationName       -- obligatorio
  mealsPerDay                    -- lo único suyo
  status       'active' | 'paused' | 'inactive'
  pricePerMeal, deliveryDays, deliveryWindow, cycleAnchor, graceDays
                                 -- copiados del rancho al escribir

deliveries/{clientId_YYYY-MM-DD}
  clientId, clientName, date, meals, window, driver, notes
  farmId, farmName, locationId, locationName
  status  'scheduled' | 'preparing' | 'en_route' | 'delivered' | 'skipped' | 'issue'
  events  [{ status, at, byName }]

invoices/{clientId_YYYY-MM-DD}
  clientId, clientName, farmId, farmName, locationName
  periodStart, periodEnd, dueDate
  meals, pricePerMeal, amount, paid, settled
  payments [{ amount, method, date, reference, note, byName, at }]

conversations/{clientId}
  clientName, lastMessage, lastAt, lastSenderRole
  unreadAdmin, unreadClient, adminReadAt, clientReadAt
  members [uid]

conversations/{clientId}/messages/{id}
  text, kind ('text' | 'system'), senderUid, senderName, senderRole, at
```

**Las condiciones se copian a propósito.** Un cliente lleva su precio y sus días
encima en vez de consultarlos en su rancho: su app lee un solo documento y lo
tiene todo, y las reglas de seguridad siguen siendo una comparación de id. El
costo es que cambiar las condiciones del rancho tiene que reescribir a su gente
—`applyTermsToClients` lo hace por lotes— y es un costo que se paga rara vez.

**El nombre viaja con el id.** La ruta agrupa cientos de paradas por ubicación
en un teléfono con una barra de señal; hacerlo requeriría leer todas las fichas.
Por eso cada entrega carga `farmName` y `locationName` además de los ids.

---

## Seguridad

Las reglas en `firestore.rules` descansan en tres cosas:

- **La identidad es el correo, y las dos listas las escribe el panel.**
  `staff/{correo}` decide quién entra al panel; `clientEmails/{correo}` decide
  quién es cada quien. Ninguna de las dos la puede escribir quien no es ya
  administrador, así que nadie se otorga nada a sí mismo.
- **Cada quien ve sólo lo suyo.** Firestore evalúa las reglas contra cada
  documento que devolvería una consulta, así que una consulta sin
  `where('clientId', '==', <el suyo>)` simplemente falla. No es el código de la
  app el que limita al cliente: es la regla.
- **Trabajar en el mismo rancho no da acceso a nadie.** Dos personas de Casa 1
  comparten exactamente un documento —el del rancho, que sólo se lee— y nada
  más: ni la ficha, ni la factura, ni el chat del compañero.
- **El dinero es de un solo sentido.** Los clientes leen `invoices` y
  `deliveries`; sólo la cocina escribe. Un mensaje enviado no se edita ni se
  borra, ni siquiera por un administrador.

### Vincular una cuenta a una persona

No hay paso de vinculación. Cuando la cocina registra a alguien con un correo,
se escribe `clientEmails/{correo} -> clientId`, y las reglas consultan ese
documento cuando esa persona entra. El cliente no reclama nada ni canjea nada:
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

71 pruebas cubren lo que cada quien puede y no puede hacer: que un cliente no
alcance a otro —ni siquiera al de su misma ubicación—, que no pueda tocar su
precio, sus facturas ni las condiciones de su rancho, que nadie se agregue solo
a `staff` ni reapunte su correo, y que la primera cuenta se pueda reclamar
exactamente una vez. Ver `tests/rules/README.md`.

---

## Operación diaria

1. **Generar la ruta** — desde Inicio o Ruta. Crea una entrega por cliente activo
   que reciba comida ese día. Volver a generarla no pisa el avance.
2. **Avanzar las paradas** — la ruta viene agrupada por rancho y ubicación: el
   botón del encabezado de una ubicación mueve a toda su gente de un toque, y
   deja en paz lo que ya se entregó o se reportó con problema. Las excepciones se
   avanzan una por una desde su renglón.
3. **Cerrar la quincena** — en Cobranza. Cuenta las comidas realmente entregadas
   del periodo cerrado y emite **una factura por persona**, con vista previa
   —resumida por rancho— antes de escribir nada.
4. **Registrar pagos** — desde la factura o la ficha del cliente. Recibe un aviso
   automático en su chat.

> Buscar a alguien: la lupa en Ranchos busca ranchos *y* personas, y el ícono de
> gente arriba a la derecha abre la lista completa de clientes con un filtro por
> rancho. En la ruta, con más de ocho paradas, aparece su propio buscador.
