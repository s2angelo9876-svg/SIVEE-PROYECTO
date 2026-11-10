# Guardar y recuperar la configuración de una elección

La copia permite preparar de nuevo una elección desde un punto guardado. Recuperar crea **otra elección en borrador y con cero votos**; la anterior conserva sus votos, sus cambios posteriores y toda su auditoría. No se fusionan resultados entre ambas elecciones.

## Guardar

1. Crea la elección desde **Configuración → Nueva elección**.
2. Guarda sus datos y horarios, importa y revisa el padrón, habilita a los extranjeros con matrícula y registra las listas y sus logos.
3. En **Configuración → Copias de configuración**, pulsa **Guardar copia**, ponle un nombre y confirma. Puedes guardar varios puntos; el listado muestra las últimas 20 copias de la elección seleccionada, con fecha y cantidades.

Solo se incluyen los cambios ya guardados en cada pantalla. El botón se deshabilita si los datos de la elección o sus horarios tienen cambios pendientes. Una copia recién creada con padrón o listas vacíos recuperará esos mismos valores vacíos; revisa el resumen antes de usarla.

La copia contiene:

- Nombre, año, ámbito, reglamento, contacto y opciones de voto blanco/nulo.
- Turnos y sus horarios, y la referencia de autorización institucional guardada.
- Listas, candidaturas, propuestas, colores, logos y su estado activo.
- Registros escolares, documentos cifrados, extranjeros con su matrícula, observaciones y exclusiones, así como el padrón habilitado en ese momento.

No contiene votos, sesiones, códigos de acceso, actas ni solicitudes de cierre/publicación. Los estudiantes que ya votaron en la elección anterior vuelven a estar pendientes de votar en la nueva. Se conservan las exclusiones guardadas y no se reactiva a estudiantes desactivados institucionalmente.

Las cuentas, permisos, nombre y código de la institución y su escudo son compartidos por la instalación; recuperarlos no forma parte de una copia de configuración de elección. Tampoco se importan ni modifican esas identidades al recuperar.

## Recuperar

1. Finaliza el cierre global de las elecciones que estén preparadas, en curso o pausadas. La recuperación no puede desplazar una jornada pendiente de cierre. La elección original y sus votos no se borran.
2. Selecciona la elección que contiene la copia. En **Configuración → Copias de configuración**, pulsa **Recuperar como nueva elección**.
3. Revisa la copia y la fecha, da un nombre inequívoco al nuevo proceso y escribe **CREAR NUEVA ELECCION**. Confirma.
4. El panel seleccionará la elección recuperada. Comprueba el padrón, las matrículas extranjeras, las listas, los logos y los horarios antes de preparar. Las fechas son las guardadas en la copia y pueden necesitar actualización. Verifica también que la autorización institucional corresponda al nuevo proceso.
5. La nueva elección comienza en **BORRADOR**, con turnos **PROGRAMADA** y sin votos. Revisa, prepara y abre manualmente el turno cuando corresponda. El enlace público muestra la elección creada más recientemente; no crees otra elección durante la jornada.

Si se interrumpe la conexión, reintenta desde el mismo diálogo: se conserva el identificador de la operación para evitar duplicados. Una recuperación es atómica: si falla un paso, no queda una elección parcialmente copiada. Cerrar y abrir de nuevo el diálogo inicia otra operación y puede crear otra elección.

Guardar/listar copias requiere permisos de configuración, padrón y listas sobre la elección. Recuperar requiere esos permisos para todas las elecciones de la institución, igual que crear una elección nueva. No amplía permisos de cuentas limitadas a una elección concreta. Se auditan el guardado y la recuperación con identificadores de origen y destino, sin documentos ni preferencias.

## Instalación y Railway

Esta función requiere la migración **202611100001_election_copies**, que añade `election_copies` y `election_copy_recoveries`. No borra ni reinicializa datos existentes. Las copias se guardan cifradas con AES-256-GCM y una clave derivada de `SESSION_PEPPER`; no se imprime ni exporta el contenido desde el panel. Ambas tablas son inmutables para el rol de la API.

1. Conserva un respaldo de PostgreSQL en Railway.
2. En el servicio temporal de operaciones usa el código de esta revisión y selecciona **`/infra/railway.migrate.json`**, con Start Command **`node dist/ops/migrate.js`**, sin healthcheck HTTP y sin reinicios. Mantén las conexiones de operaciones según [Producción](PRODUCCION.md). No uses el inicializador ni pongas la conexión propietaria en la API.
3. Ejecuta esa tarea una vez y comprueba que aplicó `202611100001_election_copies` y los permisos del rol.
4. Despliega la API/web de esta revisión. `/api/v1/health/ready` exige las tablas nuevas; sin migrarlas la nueva revisión no queda lista. Retira o detén el servicio temporal de operaciones.

No se requieren variables nuevas ni rotar claves. Conserva `SESSION_PEPPER` y las claves existentes al actualizar. Las copias están en la misma base de la instalación: no sustituyen al respaldo externo de PostgreSQL de Railway ni permiten recuperar una base perdida por sí solas.

## Verificación

`npm run test:copies` crea una base local aleatoria con datos sintéticos. Comprueba un padrón de 1742 registros y 25 extranjeros, cifrado, inmutabilidad, permisos y alcance institucional, recuperación idempotente/concurrente, copias dañadas, rollback de fallos, conservación de votos/auditorías anteriores y nuevo voto independiente. La prueba `e2e/election-copies.spec.ts` recorre los botones del panel en otra base temporal.
