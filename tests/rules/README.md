# Pruebas de las reglas de seguridad

Las reglas de `firestore.rules` son lo único que separa a un rancho de los
pagos de otro rancho. Una regla puede *leerse* bien y estar mal, así que aquí
se prueban contra el emulador de Firestore — gratis, sin tocar el proyecto real.

## Correrlas

Requiere Java 11+ (el emulador de Firestore corre en la JVM).

```sh
cd tests/rules
npm install      # sólo la primera vez
npm test
```

El comando levanta el emulador, corre las pruebas y lo apaga. Sale con código
distinto de cero si alguna regla no se comporta como debe.

## Qué cubren

- **Anónimos** no leen nada.
- **Administradores** leen y escriben todo.
- **Un rancho** lee lo suyo y sólo lo suyo: no puede listar entregas, facturas
  ni ranchos, ni leer los de otro.
- **Un rancho no puede escribir dinero**: ni saldar su factura, ni cambiar su
  precio por comida, ni marcar su propia entrega como entregada.
- **Nadie se auto-promueve** a administrador.
- **Los mensajes son un registro**: no se editan ni se borran, y nadie publica
  a nombre de otro.
- **La cadena de vinculación**: un extraño que conozca el id de un rancho no
  puede unirse ni apuntar su perfil hacia él; quien tiene un código vigente sí.
- **Rotación y vencimiento**: generar un código nuevo invalida el anterior al
  instante, y un código vencido ya no sirve.

## Notas

- Las dependencias de esta carpeta son sólo para pruebas. Las aplicaciones no
  tienen dependencias ni paso de compilación.
- El proyecto `demo-aguila` es ficticio: el emulador nunca se conecta a
  `aguilacocina-24496`.
