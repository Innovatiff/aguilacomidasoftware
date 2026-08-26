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
| **Ranchos** | el lugar: contacto, **ubicaciones** (Casa 1, Bloque Norte…) y el servicio acordado — días, horario, ciclo de cobro |
| **Clientes** | cada persona que come, con su rancho y su **ubicación obligatoria**. Hereda el servicio del rancho; lo suyo es su **plan**: cuántas comidas lleva al día |
| **Precios** | una lista para todo el negocio: lo que cuesta una **quincena completa** en cada plan — 1 comida/día $75, 2 comidas/día $140. Se cambia en Ajustes |
| **Ruta** | agrupada por rancho → ubicación: un toque mueve una ubicación completa, con estado en vivo que cada quien ve en su app |
| **Clientes** | el tablero de trabajo: quién debe, quién va atrasado, quién está activo y quién tiene algo mal. Cobrar, pausar, reactivar y mandar mensaje sin salir de la lista |
| **Restricciones** | lo que cada quien no puede comer — *sin pollo*, *sin espagueti*. Se ven en la lista sin abrir a nadie, y en la ruta junto a su nombre |
| **Cobro** | ciclos de 14 días, **una factura por persona**, pagos y saldos, agrupados por rancho |
| **Caja** | cobrar en la tienda: buscar a la persona, cobrar, y su **recibo con folio** le aparece en su app al momento |
| **Mensajes** | un hilo por cliente, con avisos automáticos de pagos y problemas |

**Por qué el rancho va primero.** Nadie come «en Mucci Farms»: come en Casa 1 de
Mucci Farms, y el chofer entrega por ubicación, no por persona. Por eso no se
puede registrar a nadie sin decir dónde está.

**Por qué se vende la quincena, no la comida.** El precio que se dice en la
puerta es «$140 la quincena», no «$9.50 la comida». Cobrar por comida entregada
obliga a cuadrar cuentas al cerrar el periodo y produce una cifra distinta cada
vez; un precio plano por plan se puede cobrar el primer día, a media quincena o
al final, que es exactamente como paga la gente.

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

### 4. Poner los precios

**Ajustes → Precios por quincena → Cambiar.** Vienen dos planes: 1 comida al día
$75 y 2 comidas al día $140. Cámbialos cuando quieras, o agrega otro plan si
alguien lleva tres comidas.

Cambiar un precio afecta **de aquí en adelante**: las facturas ya emitidas
conservan el precio con el que se emitieron, porque un cobro es un hecho, no una
fórmula que se recalcula.

Si alguien tiene un número de comidas sin plan, Ajustes te lo dice y esa persona
no se puede facturar hasta que exista el precio.

### 5. Registrar un rancho y a su gente

Son tres pasos y siempre en este orden:

1. **Ranchos → Nuevo.** El nombre, el contacto y el servicio: días, horario y
   el inicio del ciclo de cobro. Todo esto se aplica a **todos** los clientes de
   ese rancho. El precio no está aquí: es del plan de cada quien.
2. **Dentro del rancho → Ubicaciones → Agregar.** Casa 1, Bloque Norte,
   Invernadero 3 — como se le diga ahí. Un rancho sin ubicaciones no puede
   recibir gente, y el panel te lo dice.
3. **Dentro de la ubicación → Registrar cliente aquí.** Nombre, su **plan** (de
   la lista de precios) y, si tiene, su correo.

Al guardar, el panel hace dos preguntas, en este orden:

1. **«¿Ya venía pagando?»** — para la gente que llevabas en el cuaderno. Ver
   abajo.
2. **«¿Va a pagar ahora?»** — porque casi siempre la persona está parada ahí
   mismo. Un toque y queda cobrada, con su recibo.

Las dos se saltan con un toque.

### Traer a la gente del cuaderno

Estos clientes llevan años en papel. Pasarlos al sistema no puede significar
capturar una factura por quincena por persona — para doscientas personas es una
semana de trabajo que nadie va a hacer, y los saldos simplemente nunca entrarían.

Por eso el panel pregunta lo único que el cuaderno sí dice: **¿cuándo pagó por
última vez?** De ahí y de su ancla de cobro salen solas las quincenas que
quedaron abiertas y lo que cada una cuesta.

Aparece la lista de esas quincenas, **cada una con su palomita**. Van marcadas
las que ya cerraron; la que está en curso se ofrece pero no se asume. Puedes
desmarcar la que sepas que sí se pagó — un cuaderno no es una base de datos, y
quien lo tiene en la mano sabe cosas que el sistema no: un mes que alguien no
estuvo, una quincena que se pagó en efectivo y nunca se anotó.

Al confirmar se emite **una factura por quincena**, marcada como traída del
cuaderno, y el cliente queda «pagado hasta» esa fecha. A partir de ahí se cobra
como cualquier otro: aparece en la lista con su adeudo y se cobra en la caja.

Para alguien ya registrado, el mismo botón está en su ficha
(**Historial de pagos → Traer saldo del cuaderno**), mientras no tenga facturas.

**El correo es opcional.** Es lo que abre su app; muchos trabajadores no tienen
uno el día que los registras y eso no debe frenar el alta. Se agrega después
desde su ficha, en **Acceso a su app**. Cambiarlo mueve el acceso; borrarlo lo
quita. No hay códigos que compartir.

**Cambiar el servicio de un rancho** lo cambia para toda su gente: el panel te
dice a cuántos va a alcanzar antes de guardar. Las facturas ya emitidas no se
tocan.

**Mover a alguien** — de ubicación o de rancho — se hace desde su ficha, en
**Cambiar de ubicación**. Al mover de rancho, sus condiciones pasan a ser las
del rancho nuevo.

Para eliminar una ubicación primero hay que mover a quien esté ahí, y para
eliminar un rancho primero hay que vaciarlo. Es a propósito: borrar en cascada
se llevaría entregas, facturas e historial de gente que sigue trabajando.

### 6. El día a día: la pestaña Clientes

Es la pantalla donde se trabaja. Responde en orden las cuatro preguntas que
realmente se hacen: **quién me debe · quién va atrasado · quién está activo ·
quién tiene algo mal**.

Los filtros de arriba son esas preguntas, con su cuenta al lado: *Vencidos*,
*Deben*, *Falta esta quincena*, *Pagados*, *Activos*, *En pausa*, *Inactivos*,
*Revisar*. Al lado del buscador hay un selector de rancho.

Cada renglón trae sus propias acciones, sin entrar a la ficha:

- El **botón de cobrar** abre la misma hoja de la caja.
- Los **tres puntos** abren: cobrar, ver ficha, mandar mensaje, editar,
  **poner en pausa**, **marcar inactivo** o **reactivar**.

Poner en pausa no pregunta nada — es reversible y pasa seguido, alguien se va
tres semanas. Marcar inactivo sí pregunta: termina la relación, aunque lo que
deba sigue registrado y su historial se conserva.

**Dos cosas pasan solas.** La pantalla no espera a que alguien se acuerde:

1. **Quincenas cerradas sin facturar.** Al abrir Clientes, el panel busca los
   periodos que ya terminaron y nunca se facturaron —hasta cuatro atrás— y los
   ofrece en un aviso: *«3 facturas por emitir»*. Un toque muestra el desglose
   por rancho y otro las emite. Es el dinero que más fácil se pierde: comida ya
   cocinada que nadie cobró porque nadie se acordó de cerrar la quincena.
2. **Recordatorios en bloque.** Si hay gente con pago vencido, aparece
   *«Recordar a todos»*: manda a cada uno un mensaje en su propio chat con su
   saldo y su fecha vencida. Abrir veinte chats para escribir la misma frase es
   la razón por la que los recordatorios dejan de mandarse.

> Como no hay servidor, «solo» quiere decir **en cuanto alguien abre el panel**,
> en un toque — no de madrugada. Es la versión honesta de automático para una
> app sin backend, y aun así convierte una tarea que nadie recuerda en una que
> nadie puede pasar por alto.

**«Pagado hasta».** Cuando alguien paga, el panel le marca hasta qué quincena
quedó cubierto. Por eso la lista puede distinguir entre *«todavía no se le
factura»* y *«ya pagó por adelantado»*, que se ven igual si sólo miras el saldo.

### Lo que no puede comer

En la ficha del cliente, **No puede comer**: escribes *sin pollo* y ya. El campo
ofrece primero las restricciones que la cocina ya usa, así se escriben una vez y
después se eligen — que es lo que evita que *sin pollo* se vuelva *Sin Pollo*,
*no pollo* y *sin pollo.* en un mes, y entonces nadie pueda contarlas.

Se ven en tres lugares, sin abrir a nadie:

- **En la lista de Clientes**, en el renglón de cada quien, con un filtro *Con
  restricciones* y búsqueda por restricción (*«espagueti»* encuentra a quien no
  lo come).
- **En la ruta**, en rojo junto al nombre en cada parada — es la línea que, si
  se pasa por alto, manda un plato que alguien no puede comer.
- **Arriba de la ruta**, contadas para cocinar: *«Hoy sin: sin pollo · 3,
  sin cerdo · 1»*. El cocinero necesita el número **antes** de servir, no
  mientras entrega cajas.

### 7. El historial de pagos

En la ficha de cada cliente, **Historial de pagos**: todo lo que ha pagado, con
folio, fecha, forma de pago y qué quincenas cubrió cada pago. Arriba, el total y
**cuándo pagó por última vez** — que es la pregunta que más se hace y que antes
sólo se podía contestar abriendo factura por factura.

Es distinto de la lista de facturas de arriba a propósito: una factura dice lo
que se debía, un recibo dice lo que se entregó y cuándo.

### 8. Cobrar en la tienda

**Cobros → Cobrar** (o el botón *Cobrar* en Inicio). Escribe el nombre, tócalo,
confirma el monto. El panel ya trae puesto lo que debe; si está al corriente,
trae puesta una quincena por adelantado, y hay botones para *saldo*, *una
quincena* o *saldo + quincena*.

Antes de cobrar, el panel dice en palabras qué va a cubrir el dinero — «Cubre
18 – 31 jul ($140.00)» — para que no haya sorpresas con la persona enfrente.

Se puede pagar **antes, durante o después** de la quincena. Si paga una quincena
que todavía no se factura, se emite en ese momento y queda saldada.

Al terminar sale el **recibo con folio** (`R-260821-WPUF`), y ese mismo recibo
aparece en la app de la persona en segundos, junto con un aviso en su chat.

En la pantalla de Cobrar, abajo, está lo **cobrado hoy** con todos los recibos
del día: es lo que se necesita para cerrar la caja en la noche.

**Un cobro mal hecho no se borra.** Se cancela desde la factura, y eso escribe un
segundo recibo en negativo. Los dos quedan visibles, para los dos lados.

### 9. Correr en local

No hay dependencias ni build. Cualquier servidor estático sirve:

```sh
npx http-server . -p 5173 -c-1
# o: python3 -m http.server 5173
```

Abre `http://localhost:5173`. Agrega `localhost` en
**Authentication → Settings → Authorized domains** si el inicio de sesión falla.

> Los módulos ES no funcionan abriendo `index.html` con `file://`. Usa un
> servidor.

### 10. Publicar en Netlify

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

### 11. Publicar las reglas

**Publicar el sitio no publica las reglas.** Son dos cosas distintas y es la
causa más común de «ya lo arreglé pero sigue igual». Netlify sube la app;
Firestore no se entera.

Las reglas se publican desde la consola, sin instalar nada:

1. Consola de Firebase → **Firestore Database → Reglas**.
2. Pega el contenido de `firestore.rules` y **Publicar**.

**Los índices.** Hacen falta cuatro, y no se pegan: se crean con un clic. La
primera vez que abras la ficha de un cliente o su lista de recibos, si falta
alguno el panel te muestra **Crear el índice en Firebase** con el enlace ya
armado. Tarda un minuto en quedar listo y no hay que volver a tocarlo.

Los cuatro están en `firestore.indexes.json` por si prefieres subirlos de golpe
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
    session.js  staff.js  pricing.js  farms.js  clients.js
    deliveries.js  invoices.js  receipts.js  chat.js
    cycles.js         quincenas cerradas sin facturar y saldos del cuaderno
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

**La quincena tiene precio antes de existir.** Como el precio es plano por plan,
lo que cuesta un periodo se sabe el día que abre. Eso es lo que permite cobrar
por adelantado: la factura se emite en el momento del pago y queda saldada.

**Un pago puede cubrir varias quincenas.** El dinero se aplica hacia adelante en
el tiempo — primero lo vencido, luego lo que sigue — y todo eso queda en un solo
recibo que dice qué cubrió. Ocurre dentro de una transacción, porque el efectivo
ya está en el cajón cuando el código corre: o se aplica completo o no se aplica.

**Los pagos se registran en transacción.** Dos personas cobrando al mismo cliente
desde dos aparatos leerían ambas `paid: 0`; la transacción impide que el segundo
registro borre el primero.

**Los recibos no se editan ni se borran.** Nunca, ni por un administrador. Un
cobro equivocado se cancela desde la factura y eso escribe un segundo recibo en
negativo, como se corrige un libro de caja. Los dos quedan a la vista de las dos
partes; hacer desaparecer el primero sería la única versión imposible de
verificar después.

**El estado de cada cliente se deriva una sola vez.** Antes cada pantalla
volvía a calcularlo — una preguntaba «¿debe?», otra «¿está vencido?», una
tercera contaba a la misma gente para un filtro. `clientState()` lo resuelve
una vez, así que el renglón, su etiqueta, el filtro y la cuenta de ese filtro
no pueden contradecirse.

**`paidThrough` se guarda porque el saldo no alcanza.** Un saldo en cero
significa dos cosas distintas: «todavía no se le factura la quincena» y «ya la
pagó por adelantado». Distinguirlas leyendo el historial de facturas costaría
una consulta por cliente; un campo lo resuelve en cero.

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

config/pricing                   -- la lista de precios de todo el negocio
  tiers [{ mealsPerDay, price }] -- precio de UNA QUINCENA en cada plan
  updatedAt, updatedByName

farms/{farmId}                   -- el lugar y lo acordado con él
  name, contactName, phone, address, notes
  status       'active' | 'paused' | 'inactive'
  locations    [{ id, name }]    -- Casa 1, Bloque Norte, Invernadero 3
  deliveryWindow, graceDays
  deliveryDays [0-6]             -- 0 = domingo
  cycleAnchor  'YYYY-MM-DD'      -- inicio del ciclo quincenal
  defaultMealsPerDay             -- valor inicial al registrar a alguien

clients/{clientId}               -- una persona que come
  name, phone, email, notes
  tags        ['sin pollo', …]   -- lo que no puede comer
  farmId, farmName               -- obligatorio
  locationId, locationName       -- obligatorio
  mealsPerDay                    -- su plan; de ahí sale su precio
  status       'active' | 'paused' | 'inactive'
  paidThrough  'YYYY-MM-DD'      -- última quincena que dejó saldada
  deliveryDays, deliveryWindow, cycleAnchor, graceDays
                                 -- copiados del rancho al escribir

deliveries/{clientId_YYYY-MM-DD}
  clientId, clientName, date, meals, window, driver, notes
  farmId, farmName, locationId, locationName
  status  'scheduled' | 'preparing' | 'en_route' | 'delivered' | 'skipped' | 'issue'
  events  [{ status, at, byName }]

invoices/{clientId_YYYY-MM-DD}
  clientId, clientName, farmId, farmName, locationName
  periodStart, periodEnd, dueDate
  mealsPerDay                    -- el plan con el que se emitió
  amount                         -- precio plano de la quincena, congelado
  meals                          -- comidas entregadas (informativo)
  fromNotebook                   -- true si viene del cuaderno, no de una ruta
  paid, settled
  payments [{ amount, method, date, reference, note, byName, receiptId, at }]

receipts/{receiptId}             -- se escribe una vez y nunca se toca
  folio        'R-260821-WPUF'
  clientId, clientName, farmId, farmName, locationName
  amount                         -- negativo si es una cancelación
  method, reference, note, date
  applied [{ invoiceId, periodStart, periodEnd, amount }]
  balanceAfter
  reversalOf                     -- folio que cancela, si aplica
  takenByName, takenByUid, at

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
- **El dinero es de un solo sentido.** Los clientes leen `invoices`, `receipts`
  y `deliveries`; sólo la cocina escribe. Un mensaje enviado y un recibo emitido
  no se editan ni se borran, ni siquiera por un administrador.

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

84 pruebas cubren lo que cada quien puede y no puede hacer: que un cliente no
alcance a otro —ni siquiera al de su misma ubicación—, que no pueda tocar sus
facturas, la lista de precios ni las condiciones de su rancho, que nadie se
agregue solo a `staff` ni reapunte su correo, que un recibo no se pueda editar
ni borrar, y que la primera cuenta se pueda reclamar exactamente una vez. Ver
`tests/rules/README.md`.

---

## Operación diaria

1. **Generar la ruta** — desde Inicio o Ruta. Crea una entrega por cliente activo
   que reciba comida ese día. Volver a generarla no pisa el avance.
2. **Avanzar las paradas** — la ruta viene agrupada por rancho y ubicación: el
   botón del encabezado de una ubicación mueve a toda su gente de un toque, y
   deja en paz lo que ya se entregó o se reportó con problema. Las excepciones se
   avanzan una por una desde su renglón.
3. **Cobrar** — en la tienda, todo el día: Clientes → Cobrar, busca, cobra. O
   directamente desde el renglón de la persona. El recibo le llega en su app.
4. **Emitir lo que cerró** — el aviso en Clientes te lo dice solo. Emite **una
   factura por persona** al precio de su plan, para quien haya recibido comida
   en el periodo, con vista previa antes de escribir nada. Lo ya cobrado por
   adelantado no se vuelve a facturar: esa quincena ya tiene su factura saldada.
5. **Cerrar la caja** — al final del día, en Cobrar: lo cobrado hoy y todos sus
   recibos.

> Buscar a alguien: la lupa en Ranchos busca ranchos *y* personas, y el ícono de
> gente arriba a la derecha abre la lista completa de clientes con un filtro por
> rancho. En la ruta, con más de ocho paradas, aparece su propio buscador.
