# Pruebas de las reglas de seguridad

Las reglas de `firestore.rules` son lo único que separa a un cliente de los
pagos de otro. Una regla puede *leerse* bien y estar mal, así que aquí se
prueban contra el emulador de Firestore — gratis, sin tocar el proyecto real.

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

71 comprobaciones, cada una escrita como «esto debe permitirse» o «esto debe
negarse»:

- **Anónimos** no leen nada.
- **La cocina** lee y escribe todo: ranchos, ubicaciones, clientes, entregas,
  facturas y pagos.
- **Un cliente** lee lo suyo y sólo lo suyo: su ficha, su rancho, sus entregas,
  sus facturas y su chat. No puede listar ninguna colección completa.
- **Dos personas del mismo rancho** comparten el documento del rancho y nada
  más: trabajar en el mismo lugar no da acceso a la ficha, la factura, las
  entregas ni el chat del compañero.
- **Un cliente no escribe dinero ni condiciones**: ni salda su factura, ni
  cambia su precio por comida, ni marca su propia entrega como entregada, ni
  toca el precio o las ubicaciones de su rancho, ni se cambia de rancho.
- **Nadie se auto-promueve**: no puede agregarse a `staff`, ni apuntar su correo
  a otro cliente, ni registrarse un correo nuevo, ni colar un rol en su perfil.
- **La primera cuenta** se reclama exactamente una vez: `config/bootstrap` no se
  puede sobrescribir ni borrar, ni siquiera por un administrador.
- **Los mensajes son un registro**: no se editan ni se borran, y nadie publica
  a nombre de otro.
- **Mayúsculas**: un correo en la lista funciona escrito como sea.

## Notas

- Las dependencias de esta carpeta son sólo para pruebas. Las aplicaciones no
  tienen dependencias ni paso de compilación.
- El proyecto `demo-aguila` es ficticio: el emulador nunca se conecta a
  `aguilacocina-24496`.
