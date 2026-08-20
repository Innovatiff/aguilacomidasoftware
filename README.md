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

### 2. Crear las cuentas del equipo

**El panel no tiene registro.** Quién puede entrar se decide en una lista
dentro de `firestore.rules`, un archivo que sólo puede cambiar quien despliega
el proyecto. Son dos pasos por persona:

1. **Authentication → Users → Add user**: correo y contraseña.
2. Agrega ese correo a `staffEmails()` en **`firestore.rules`** y publica:

   ```sh
   firebase deploy --only firestore:rules
   ```

   ```
   function staffEmails() {
     return [
       'alanf7178@gmail.com',
       'otra.persona@ejemplo.com',   // <- se agrega aquí
     ];
   }
   ```

3. Esa persona entra con su correo y contraseña. **No hay tercer paso**: el
   panel crea su perfil solo la primera vez que entra.

> **Crea primero la cuenta en Authentication y después agrega el correo a la
> lista.** Un correo listado que nadie ha registrado todavía es un correo que
> alguien más podría registrar.

Si alguien entra con un correo que no está en la lista, ve **Sin acceso al
panel** con el correo exacto que hay que agregar — no un error. La pantalla se
convierte en el panel sola en cuanto lo habilites.

**Por qué no basta con crear la cuenta en Authentication.** La `apiKey` de este
proyecto es pública (tiene que serlo, va en el navegador) y la app de los
ranchos necesita registro abierto por correo. Cualquiera puede crear una cuenta
de Authentication con la API pública de Firebase; tener una no demuestra nada.
Estar en la lista sí.

**Quitar y devolver acceso** se hace dentro de la app: **Ajustes → Equipo →
Quitar**. La cuenta baja a `pending` (no puede leer nada) y aparece en **Ajustes
→ Cuentas sin acceso**, desde donde la vuelves a habilitar sin redesplegar. Para
retirar a alguien de forma definitiva, quítalo también de `staffEmails()` — si
no, volvería a entrar solo.

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

### 4. Publicar en Netlify

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

### 5. Publicar las reglas

**Publicar el sitio no publica las reglas.** Son dos cosas distintas y es la
causa más común de «ya lo arreglé pero sigue igual». Netlify sube la app;
Firestore no se entera.

Las reglas se publican desde la consola, sin instalar nada:

1. Consola de Firebase → **Firestore Database → Reglas**.
2. Pega el contenido de `firestore.rules` y **Publicar**.

Los índices sí conviene subirlos una vez con la CLI (`firebase deploy --only
firestore:indexes`), o crearlos desde el enlace que Firestore muestra en la
consola la primera vez que una consulta los necesita.

> Cada vez que cambies `staffEmails()` hay que volver a pegar las reglas. Es la
> única acción manual que queda en todo el flujo.

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
  role        'admin'    -- equipo; sólo un correo de staffEmails() lo obtiene
            | 'client'   -- rancho; único rol que alguien puede darse solo
            | 'pending'  -- cuenta existente sin acceso (revocada o sin habilitar)
  clientId    string | null      -- sólo para clientes

clients/{clientId}
  name, contactName, phone, email, address, notes
  mealsPerDay, pricePerMeal
  deliveryDays [0-6]             -- 0 = domingo
  deliveryWindow, graceDays
  cycleAnchor  'YYYY-MM-DD'      -- inicio del ciclo quincenal
  status       'active' | 'paused' | 'inactive'
  accessCode                     -- 6 caracteres, para vincular la app
  accessCodeExpiresAt            -- vencimiento del código (30 días)
  linkedUids   [uid]

accessCodes/{CODIGO}
  clientId, clientName           -- se lee de uno en uno, nunca se lista

redemptions/{uid}
  code, at                       -- el código que el encargado está canjeando;
                                    inerte salvo que coincida con el vigente

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

- **El rol vive en el servidor.** El único registro que existe en todo el
  proyecto es el de un rancho creando su perfil `client`, que no ve nada hasta
  canjear un código. Nadie puede escribirse el rol `admin` salvo un correo
  listado en `staffEmails()` dentro de las propias reglas, que es un archivo
  que sólo cambia quien despliega el proyecto.
- **Un rancho sólo ve lo suyo.** Firestore evalúa las reglas contra cada
  documento que devolvería una consulta, así que una consulta sin
  `where('clientId', '==', <el suyo>)` simplemente falla. No es el código de la
  app el que limita al rancho: es la regla.
- **El dinero es de un solo sentido.** Los ranchos leen `invoices` y
  `deliveries`; sólo la cocina escribe. Un mensaje enviado no se edita ni se
  borra, ni siquiera por un administrador.

### Vincular una cuenta a un rancho

Conectar un login a un rancho es una cadena de dos eslabones, y los dos se
verifican en las reglas, no en la app:

1. Para entrar en `clients/{id}.linkedUids` hay que haber dejado el código
   **vigente** del rancho en `redemptions/{uid}`. La regla lo compara contra
   `clients.accessCode`, así que **Generar código nuevo** invalida al instante
   cualquier copia del anterior.
2. Para apuntar `users/{uid}.clientId` a un rancho, ese rancho ya debe listarte
   en `linkedUids`.

Ningún eslabón se puede saltar. Conocer el id de un rancho **no alcanza** para
llegar a sus entregas, facturas o mensajes: hace falta un código vivo.

Los códigos caducan a los 30 días (`CODE_VALID_DAYS` en `js/data/clients.js`).
La ficha del rancho muestra cuándo vence y avisa si ya venció; los ranchos
registrados antes de esta función no caducan hasta que se les genere un código
nuevo.

Todo esto corre en el **plan gratuito**: no hay Cloud Functions ni ningún
servicio extra. La verificación vive en las reglas, que pueden leer otros
documentos durante su evaluación.

### Probar las reglas

Una regla puede leerse bien y estar mal, así que están probadas contra el
emulador:

```sh
cd tests/rules
npm install      # sólo la primera vez
npm test
```

48 pruebas cubren lo que cada rol puede y no puede hacer: el intento de un
extraño de colarse en un rancho ajeno, la rotación y el vencimiento de códigos,
y que sólo un correo de `staffEmails()` pueda quedar como administrador. Ver
`tests/rules/README.md`.

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
