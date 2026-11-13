# SIVEE presencial: instalación y jornada oficial

El alumno abre `/votar`, usa su DNI o la matrícula habilitada para estudiantes extranjeros y accede a la cédula cuando la jornada tiene un horario de votación abierto. No se registran equipos, asignan responsables ni solicitan códigos o aprobaciones de mesa. Funciona desde cualquier dispositivo con el enlace. Conocer un DNI ajeno podría permitir suplantar al estudiante: el sistema comprueba elegibilidad y voto único, no la identidad de quien usa el documento. El colegio debe organizar la supervisión presencial de la jornada.

## Desplegar en Railway

La configuración de este repositorio publica React y Express en **un mismo servicio y dominio**, conectado a PostgreSQL 17. `railway.json` selecciona `infra/Dockerfile`, el arranque y `/api/v1/health/ready`. Usa una réplica: los límites de solicitudes están en memoria. No actives réplicas múltiples sin compartir antes esos límites. Vercel no ejecuta este servidor persistente ni su canal SSE tal cual; para esta versión utiliza Railway para la aplicación completa. No hace falta Vercel.

1. Crea un proyecto Railway y un PostgreSQL **nuevo**, separado de la demostración y de cualquier ensayo. Activa los respaldos del volumen con una retención acordada por el colegio. Mantén la conexión de la API por red privada.
2. Conecta `s2angelo9876-svg/SIVEE-PROYECTO`, rama `main`, al servicio SIVEE. Genera su dominio HTTPS y fija ese origen exacto, sin ruta ni barra final, en `WEB_ORIGIN`. El build no necesita claves ni conexión a la base. El primer arranque puede fallar hasta completar las variables y migraciones siguientes.
3. Introduce las variables de [production.env.example](../infra/production.env.example) en el gestor de secretos de Railway. `SIVEE_ENV=production`, `COOKIE_SECURE=true`, `ALLOW_DEMO_RESET=false`. `TRUST_PROXY_HOPS=1` corresponde al proxy frontal de Railway; verifica la topología si agregas otro proxy. Railway suministra `PORT`. Genera **tres valores distintos** con un generador criptográfico para `DNI_LOOKUP_KEY`, `SESSION_PEPPER` y `CSRF_KEY` (32 bytes aleatorios por clave, representados en hexadecimal). Guarda una copia en la custodia institucional.
4. En el servicio SIVEE agrega `SIVEE_DB_PASSWORD` con un valor nuevo de 32 bytes aleatorios representados en hexadecimal. Genera ese valor localmente con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Configura `DATABASE_URL` con esta referencia, suponiendo que el servicio de base se llama exactamente **Postgres**:

   ```env
   DATABASE_URL=postgresql://sivee_app:${{SIVEE_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
   ```

   No uses el propietario como conexión de la API. El usuario `sivee_app` se crea en el siguiente paso. Si renombraste Postgres, ajusta el nombre en las referencias.
5. Crea temporalmente un servicio **operaciones**, conectado al mismo repositorio y rama `main`. En **Settings → Config-as-code → Railway Config File**, selecciona `/infra/railway.init.json`, manteniendo la raíz del servicio en la raíz del repositorio. Este archivo configura la ejecución de una sola vez, sin healthcheck HTTP ni reinicios. El comando definido por el archivo de configuración tiene prioridad sobre el comando del panel; por eso operaciones usa su propio archivo en lugar del `railway.json` de la API.

   En Variables de operaciones pega [railway.init.env.example](../infra/railway.init.env.example) mediante Raw Editor, omitiendo los comentarios. Las referencias toman las claves existentes de **SIVEE-PROYECTO** y la URL del propietario de **Postgres**. Si los servicios tienen otros nombres, ajusta las referencias. Completa `INSTITUTION_CODE`, `INSTITUTION_NAME`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME` e `INITIAL_ADMIN_PASSWORD` (mínimo 16 caracteres). Despliega operaciones después de guardar toda su configuración. El archivo ejecuta:

   ```sh
   node dist/ops/initialize-production.js
   ```

   El programa de inicialización ejecuta migración e inicializador en orden, sin depender de que Railway interprete `&&` mediante una shell. Se detiene si falla un paso. La migración crea `sivee_app` si no existe y asigna sus permisos mínimos; no cambia su contraseña si ya existe. El inicializador crea la institución y una primera cuenta con permisos de comité y administrador técnico. Rechaza una base ya inicializada. No crea alumnos, listas, elecciones ni claves conocidas. No ejecutes `setup:demo` ni `seed:demo` en producción. Al finalizar correctamente se imprime «Instalación creada sin estudiantes ni elecciones de ejemplo». Operaciones es una tarea que termina, no un servidor web: no generes un dominio para ella.
6. Comprueba que operaciones termina correctamente. Retira `INITIAL_ADMIN_PASSWORD` y detén/elimina el servicio temporal. **El servicio API no debe recibir `MIGRATION_DATABASE_URL` ni variables INITIAL_ADMIN/RECOVERY**. Despliega o reinicia SIVEE y comprueba `/api/v1/health/ready` (`database: connected`, `mode: production`). `/api/v1/site` debe indicar `OFICIAL`. Al acceder a `/admin/login` no deben aparecer credenciales de demostración.
7. Ingresa con la cuenta inicial. Accede al panel con correo y contraseña, sin código de autenticador. En Cuentas del personal crea cuentas nominativas de comité, observación y administración técnica según las funciones necesarias. Cada una usa su correo y contraseña personal. No se necesita una cuenta de mesa para habilitar votantes. Temporalmente, una sola cuenta de comité puede solicitar y aprobar el cierre global y la publicación oficial después de conciliar; no compartas contraseñas. Véase [Cierre temporal](CIERRE_TEMPORAL_UNA_CUENTA.md).
8. En Configuración crea la elección, introduce el nombre oficial del colegio, reglamento y horarios de Lima, y carga el **escudo original PNG o JPEG**, hasta 600 KB y 2048 × 2048. La web y el PDF usan ese escudo. La paleta es azul marino, rojo y blanco. En **Configuración → Referencia de autorización institucional**, registra el número y fecha del acta, oficio o acuerdo real y pulsa **Guardar configuración** antes de preparar una elección oficial. La referencia se guarda por elección y sus cambios quedan auditados; no sustituye la autorización real del colegio. No necesitas configurar una variable en Railway ni reiniciar el servicio para cambiarla.

Para posteriores versiones, respalda y prueba primero en un entorno separado. Ejecuta **solo** `node dist/ops/migrate.js` en el servicio temporal de operaciones, usando una configuración con ese comando de inicio; después despliega la API. No reutilices `/infra/railway.init.json` sin ajustar su comando, pues también intenta inicializar la institución. No vuelvas a ejecutar el inicializador. Las migraciones tienen checksum: no modifiques SQL ya aplicado. Los secretos de búsqueda/cifrado deben permanecer estables al actualizar.

## Referencia institucional desde Configuración

La referencia de autorización se configura dentro de cada elección, mientras está en BORRADOR. Puede quedar vacía durante la organización; para preparar una elección oficial debe tener al menos seis caracteres y corresponder al documento real del colegio. Se modifica con permiso `elections:write`, se conserva al recargar y queda bloqueada al preparar, como el resto de la configuración.

Este cambio no requiere una nueva migración: usa el registro existente de referencias de aprobación y la auditoría. Cada modificación registra quién la hizo y los valores anterior/nuevo. No se copia entre elecciones ni se toma de la variable antigua `INSTITUTIONAL_APPROVAL_REFERENCE`; si existe en Railway, ya no se utiliza. No cambia las aprobaciones separadas del cierre ni de la publicación de resultados.

## Preparar la elección real después de las pruebas

Conserva el ensayo y crea una elección nueva con cero votos desde **Configuración → Nueva elección**. Debes volver a importar el padrón, habilitar los extranjeros por matrícula y registrar las listas y logos; esta acción no copia automáticamente los datos. Sigue la [guía para preparar el viernes después del ensayo](PREPARAR_ELECCION_TRAS_ENSAYO.md) antes de preparar o abrir la jornada real.

## Si Railway usa Railpack

`npm run build` genera explícitamente Prisma antes de comprobar TypeScript y compilar. Esto también permite compilar cuando Railpack instaló dependencias antes de copiar `prisma.config.ts`. No dependas del postinstall de `@prisma/client` para encontrar el esquema en `apps/api/prisma`.

Si los registros de operaciones muestran Railpack y `npm run start`, ese servicio está usando el arranque de la API. Selecciona `/infra/railway.init.json` como archivo de configuración en Settings → Config-as-code y despliega nuevamente. Como alternativa, configura en ese servicio el comando de inicio `node dist/ops/initialize-production.js`, sin healthcheck HTTP y con reinicios desactivados. En el servicio SIVEE el arranque sigue siendo `npm start` o `node dist/api/main.js`.

## Preparar el padrón real

El Excel recibido contiene 1742 estudiantes. Según la nomenclatura proporcionada y la confirmación de 3.º Gabriel García Márquez en tarde, se clasifican **935 de mañana y 807 de tarde**, sin secciones sin clasificar. La imagen es la nomenclatura de 2025; Gabriel García Márquez es una sección adicional del Excel, confirmada por el usuario.

1. En Padrón electoral selecciona el `.xlsx` o CSV institucional. Revisa si deseas la vista previa paginada de 50 en 50 y pulsa **Importar padrón**. No existe Guardar en borrador ni una segunda confirmación por alumno o por lote.
2. Todos los registros quedan en el listado. Los DNI válidos y únicos se inscriben automáticamente para votar, incluyendo las matrículas EN PROCESO del archivo; ya no se pide aprobación individual. Los datos se cifran y los documentos completos solo se muestran al abrir una corrección autorizada.
3. El archivo concreto tiene 20 documentos vacíos y 5 distintos de un DNI de ocho dígitos: inicialmente se habilitan **1717**. El colegio ha identificado a esos **25** como extranjeros y ha elegido el código de matrícula existente para su acceso. Tras aplicar la migración y habilitarlos con la acción descrita abajo, los **1742** pueden participar sin inventar DNI ni generar códigos nuevos. Un documento faltante no implica por sí mismo que el alumno sea extranjero; la clasificación es explícita y auditada.
4. La separación automática usa grado y sección: 1.º A–G mañana/H–M tarde; 2.º A–F mañana/G–L tarde; 3.º a 5.º A–F mañana/G–K tarde. 3.º Gabriel García Márquez también corresponde a tarde. El filtro del listado permite ver ambos grupos o los no clasificados. Una sección desconocida no se asigna por suposición ni impide votar.
5. Registrar estudiante permite incorporar individualmente un alumno omitido antes de preparar, sin confirmación posterior. Los datos ya habilitados conservan la protección de su inscripción; las filas con documento no utilizable se pueden corregir con motivo auditado y control de versión.
6. Las cargas de versiones anteriores se sincronizan automáticamente al abrir el padrón o preparar la elección, sin volver a importar el Excel. No se modifica una elección preparada o en curso. La importación y la sincronización son idempotentes y quedan auditadas. Las identidades de otras elecciones conservan sus inscripciones históricas.

El código de matrícula identifica el registro importado, **no es una contraseña**. Sexo, nacimiento, edad y vacante se reconocen como columnas del reporte pero no se almacenan ni se usan como preguntas de autenticación.

No subas el Excel real, capturas de alumnos ni exportaciones del padrón al repositorio. Limita los operadores autorizados y acuerda la retención de borradores, auditorías y respaldos.

## Logos de las listas

En Listas participantes, Nueva lista y Editar lista permiten subir un logo PNG o JPG de hasta 5 MB, con vista previa. La web lo ajusta a un máximo de 256 píxeles en su lado mayor, conservando proporciones y transparencia, para mantener ligera la cédula. El logo se guarda en PostgreSQL y aparece en administración, cédula, confirmación y resultados. No se borra al redesplegar Railway. Las listas anteriores conservan su símbolo hasta que se editen y se suba una imagen. Los cambios de listas siguen permitidos únicamente en BORRADOR.

Este cambio utiliza el campo existente de símbolo y no requiere migración de base ni reinicializar cuentas. Se aplica desplegando la nueva versión del servicio SIVEE-PROYECTO.

## Votación directa con DNI

1. Importa el padrón, registra las listas y prepara la elección. Ya no se exige crear cabinas ni asignar responsables.
2. Abre manualmente el turno correspondiente desde Jornada electoral. Mañana debe cerrarse antes de abrir tarde; los horarios también limitan la votación.
3. Abre el enlace `/votar` en las laptops o dispositivos de los estudiantes, sin iniciar una cuenta administrativa en esos equipos. No hay enlaces de activación ni autorización de hardware.
4. El alumno ingresa su propio DNI. Se comprueba que esté activo, inscrito, pendiente de votar y dentro de un horario abierto de la jornada, sin comprobar su turno individual. Revisa sus datos, elige y confirma su voto privado.
5. La sesión dura cinco minutos. Si vence, vuelve a ingresar el DNI. Un nuevo acceso para el mismo estudiante sustituye su sesión anterior, sin crear una segunda participación. Un doble envío del voto produce una sola papeleta.
6. Tras votar se limpia la sesión del alumno. Para el siguiente alumno vuelve al inicio. No se puede iniciar otra votación con un DNI que ya participó.

Los horarios de mañana y tarde controlan la apertura general: cualquier DNI habilitado puede votar en cualquiera de ellos. Los turnos del padrón se clasifican automáticamente como referencia, pero no bloquean acceso, cédula ni emisión del voto.

El voto directo se aplica a las elecciones existentes. El soporte de estudiantes extranjeros sí requiere la migración aditiva indicada a continuación. Se conserva el valor interno `DESK` para compatibilidad con elecciones existentes. Las cabinas, responsables y admisiones anteriores quedan como historial y ya no condicionan el acceso. Si había una sesión antigua abierta, recarga la página e ingresa de nuevo el DNI. Los marcadores `/admin/mesa` y `/cabina/activar` redirigen a Jornada electoral y `/votar`, respectivamente.

## Estudiantes extranjeros: matrícula existente

Los 25 registros indicados por el colegio tienen códigos de matrícula únicos de 14 dígitos en el Excel. El acceso es **individual**, seleccionando «Extranjero · código de matrícula» e ingresando ese código; la palabra «extranjero» sola no identifica a una persona ni permite votar. No se emiten códigos de acceso nuevos, no se inventa un DNI y no se guarda una nacionalidad específica.

### Actualizar Railway sin reinicializar

1. En el servicio temporal **operaciones**, conectado a este repositorio y rama `main`, selecciona **Settings → Config-as-code → Railway Config File → `/infra/railway.migrate.json`**. Mantén la raíz del repositorio como raíz del servicio. Ese archivo ejecuta únicamente `node dist/ops/migrate.js`, sin reinicios ni healthcheck HTTP.
2. Configura las dos referencias de [railway.migrate.env.example](../infra/railway.migrate.env.example): `DATABASE_URL` del servicio SIVEE y `MIGRATION_DATABASE_URL` del propietario de Postgres. Deben apuntar a la misma base y host. No necesita variables INITIAL_ADMIN ni RECOVERY; no vuelvas a usar `railway.init.json` ni el inicializador.
3. Despliega operaciones y comprueba «Migración aplicada: 202611090001_foreign_students» y finalización correcta. La migración solo añade `isForeign=false` a `school_drafts`; conserva alumnos, cuentas, votos y datos existentes. Repetir la migración es seguro por su registro de checksums.
4. Despliega SIVEE-PROYECTO con la misma versión y recarga con Ctrl+Shift+R. Si la API se actualizó automáticamente antes, aplica primero la migración y vuelve a desplegarla; el padrón necesita la columna nueva.
5. En Padrón electoral pulsa **Habilitar 25 como extranjeros con matrícula**. La operación usa los registros ya importados, exige permiso de padrón y queda auditada. Puedes deshabilitar/eliminar el servicio temporal de operaciones tras completarla.

La acción admite BORRADOR, PREPARADA, EN_CURSO y PAUSADA, únicamente para registros existentes sin DNI válido y todavía sin inscripción. No permite modificar votantes ya habilitados ni añadir filas nuevas después de preparar. Las llamadas repetidas no crean inscripciones adicionales; tras cerrar la elección se rechaza la habilitación. Al clasificar durante la jornada aumenta el total de habilitados y queda registrada la modificación.

Las matrículas se consultan con un hash de búsqueda separado del espacio de DNI. El alumno extranjero mantiene una sola identidad de votación, con la misma caducidad de sesión, pausas, horarios y bloqueo de voto duplicado. Solo los registros marcados explícitamente como extranjeros pueden usar este acceso; una matrícula de un estudiante nacional no lo habilita. Para un alta individual de extranjero antes de preparar, utiliza su matrícula existente y marca la opción correspondiente; no se genera una matrícula nueva.

## Incidentes y recuperación

| Caso | Procedimiento |
| --- | --- |
| DNI ajeno, datos discrepantes o sospecha de suplantación | Pedir al estudiante que salga antes del voto, pausar el turno si es necesario, registrar incidencia y aplicar la comprobación presencial institucional. Si ya votó, escalar al comité sin borrar ni reasignar su papeleta. Nunca colocar el DNI completo o la preferencia en el motivo. |
| Alumno omitido antes de preparar | Alta individual, revisión de datos y confirmación. |
| Omisión después de preparar o jornada abierta | No hay alta tardía automática. Registrar incidencia y elevar al comité conforme al reglamento; no editar SQL ni abrir otra elección para eludir controles. |
| El sistema dice que ya participó | Comprobar participación e incidencia. No permitir un segundo voto ni borrar papeletas. La app no puede atribuir una papeleta secreta a una persona. |
| Se corta la red al confirmar | Conservar la pantalla, reintentar o consultar participación. La transacción es atómica; no contar un éxito sin confirmación del servidor. No hay votos offline. |
| Respuestas 429, incluso en CSS/favicon | Esperar `Retry-After` o un minuto, evitar recargas repetidas y probar el enlace directo. Revisar la respuesta y las métricas del proveedor; no asumir saturación ni borrar elecciones. Véase [Runbook](RUNBOOK.md#respuestas-429-en-el-panel-o-en-recursos-estáticos). |
| Navegador congelado o sesión vencida | Recargar o abrir otro navegador e ingresar nuevamente el DNI. El nuevo acceso revoca la sesión anterior. Si ya se confirmó el voto, no permite iniciar otra votación. |
| Corte eléctrico o Internet prolongado | Pausar la jornada, preservar equipos/base y aplicar contingencia aprobada (con UPS/conectividad de respaldo o acta de suspensión). No mezclar papel y sistema sin un procedimiento de conciliación. |
| Error en turno/horario | Pausar, documentar y revisar estado; una ventana cerrada no se reabre mediante la UI. |
| Pérdida de contraseña administrativa | Responsable técnico verifica al titular y usa el comando de recuperación abajo. |
| Totales no concilian | Mantener elección cerrada, conservar evidencia y diagnosticar. No publicar ni alterar papeletas. |

Recuperar una cuenta requiere acceso al entorno de operaciones con las mismas claves de la instalación. Añade temporalmente `RECOVERY_EMAIL`, `RECOVERY_PASSWORD` (mínimo 16 caracteres) y `RECOVERY_REASON` (mínimo 15 caracteres), y ejecuta `node dist/ops/recover-account.js`. Revoca todas las sesiones, permite ingresar con la nueva contraseña sin autenticador y deja auditoría. Retira la contraseña temporal del servicio y entrégala al titular por canal privado. No existe un restablecimiento público por conocer el correo.

Para diagnosticar primero, sin restablecer la cuenta, conserva `INITIAL_ADMIN_EMAIL` y `INITIAL_ADMIN_PASSWORD` con el correo y la contraseña que quieres comprobar y ejecuta `node dist/ops/check-admin-access.js`. En Railway puedes seleccionar `/infra/railway.check-access.json`; si tienes un Start Command manual, actualízalo también al comando de comprobación. La salida informa `adminCount`, `institutionCount`, `accountFound`, `accountActive`, `passwordMatches`; no imprime correo, contraseña ni hash. No modifica cuentas, sesiones ni auditoría. Un resultado falso no revela por sí solo si operaciones está conectado a la misma base que la API: comprueba también las referencias de conexión de ambos servicios.

En Railway, el servicio temporal operaciones puede seleccionar `/infra/railway.recover.json` en Settings → Config-as-code → Railway Config File. Si usa Railpack con un comando manual, cambia su Start Command a `node dist/ops/recover-account.js`, sin healthcheck HTTP y con reinicios Never. Despliega una sola vez con las variables RECOVERY completas. El correo debe ser el de una cuenta ya creada; cambiar `INITIAL_ADMIN_EMAIL` o `INITIAL_ADMIN_PASSWORD` después de inicializar no modifica esa cuenta. La recuperación correcta imprime «Cuenta recuperada y sesiones revocadas». Luego ingresa con la nueva contraseña, elimina el servicio temporal con sus contraseñas de inicialización/recuperación. No vuelvas a ejecutar el inicializador para intentar cambiar una contraseña.

## Respaldos y ensayo de salida

Activa y verifica los respaldos de PostgreSQL en Railway **antes** de cargar datos reales; el repositorio no puede activar esa función en tu cuenta. Programa la frecuencia/retención según el objetivo de recuperación que acuerde el colegio. Conserva además una copia cifrada fuera del proyecto y una copia separada de `DNI_LOOKUP_KEY`, `SESSION_PEPPER` y `CSRF_KEY`. Sin las claves correctas no se recuperan búsquedas y documentos cifrados. No rotes `DNI_LOOKUP_KEY` ni `SESSION_PEPPER` durante una elección: requieren un procedimiento de migración de datos/secretos.

Ensaya restauración en **otro PostgreSQL/proyecto**, usando el respaldo administrado del proveedor; nunca sobre la elección activa. Conecta una API aislada con las mismas claves y el dominio de ensayo, confirma migraciones, acceso del personal, padrón, totales y conciliación. Revoca las sesiones restauradas antes de exponer esa copia. No mantengas dos instalaciones capaces de aceptar votos de la misma elección. Si se perdieron votos posteriores al respaldo, el comité debe resolver la contingencia documentada: restaurar una copia antigua no permite reconstruir esas preferencias.

La prueba local `npm run backup:verify` cifra un dump y restaura una base temporal del entorno de demostración; **no configura ni verifica tus respaldos de Railway**. El ensayo real con la red, equipos, responsables y alimentación del colegio, y la restauración en tu cuenta, siguen siendo requisitos de salida. Que las pruebas automáticas pasen no certifica por sí solo una elección oficial.

## Validación reproducible

Desde una instalación de desarrollo con `.env` de prueba, Node 22.12–24 y PostgreSQL local:

```sh
npm ci
npm run db:generate
npm run build
npm run lint
npm run test:unit
npm run test:integration
npm run test:production
npm run test:e2e -- e2e/official.spec.ts e2e/roster.spec.ts
```

Las pruebas de integración/navegador crean y eliminan únicamente sus bases temporales con nombres aleatorios. Usan datos sintéticos; ninguna prueba necesita el Excel real. La prueba oficial importa 1742 registros con el formato del colegio y comprueba acceso, concurrencia, cancelación, expiración y acceso con correo y contraseña. `test:production` prueba los comandos compilados sobre una base vacía. `npm run dev` sigue disponible para ensayos locales con Docker Desktop y datos ficticios; ese comando no es el arranque del servicio publicado.

Validación ejecutada el 7 de noviembre de 2026 (UTC): compilación, TypeScript y ESLint; 37 pruebas unitarias; 53 comprobaciones de integración (25 generales, 16 del padrón anterior y 12 presenciales); instalación/recuperación oficial en base vacía; 3 pruebas de navegador, incluyendo revisión Axe sin infracciones en padrón y cédula; compilación/arranque Docker y restauración local cifrada. Se leyó también el Excel original para confirmar sus 1742 filas y pendientes, sin importarlo a una base ni incorporarlo al repositorio. No se ha desplegado en una cuenta Railway ni ensayado en la red del colegio. Las dos pruebas de presentación antiguas que archivan la demo no se repitieron en esta entrega.

Actualización del 10 de noviembre de 2026: el acceso del personal usa únicamente correo y contraseña para cuentas nuevas y existentes, aunque hayan activado TOTP. No ejecutes el inicializador ni la recuperación para aplicar este cambio: basta desplegar esta revisión de la API y la web juntas. No requiere migraciones nuevas ni cambios de variables; conserva votos, cuentas, permisos y auditorías. Las columnas del autenticador y el propósito histórico de sesión se mantienen por compatibilidad, sin restringir el acceso. El cierre global y la publicación oficial permiten temporalmente solicitar y aprobar con la misma cuenta autorizada; la conciliación y la verificación del acta siguen siendo obligatorias. Véase [Cierre temporal](CIERRE_TEMPORAL_UNA_CUENTA.md).

Validación histórica de la retirada del autenticador, anterior al cierre temporal con una cuenta: build, TypeScript y ESLint; 44 pruebas unitarias; 63 comprobaciones de integración (27 generales, 16 de padrón y 20 oficiales); instalación y recuperación con los comandos compilados; 2 pruebas de navegador del flujo oficial. Se verificaron cuentas con y sin autenticador histórico, sesiones antiguas de activación, rutas TOTP retiradas, permisos, auditoría y rechazo de autoaprobación de cierre/publicación. Todo usó bases locales aisladas con datos sintéticos, sin modificar producción.

Validación histórica del cierre temporal con una cuenta, anterior a extender la excepción a publicación: build, TypeScript y ESLint; 27 comprobaciones de integración; una prueba de navegador del cierre oficial pendiente con la misma cuenta. Se comprobaron permisos, auditoría de la excepción, rechazo de aprobaciones inexistentes o repetidas, reserva de resultados hasta publicar y publicación oficial con dos cuentas. Se usaron únicamente bases locales aisladas y datos sintéticos.

La excepción temporal se amplió a la publicación por indicación del usuario. La misma cuenta autorizada puede solicitar y aprobar tanto el cierre como la publicación; se mantiene la conciliación, los permisos y la integridad del acta. Validación de la ampliación: build, TypeScript, ESLint, 28 comprobaciones de integración y una prueba de navegador de cierre → conciliación → publicación con la misma cuenta, incluida la aprobación de una publicación pendiente tras recargar. La frase «Reanuda el cierre de 2 accesos» restaurará la exigencia de dos cuentas en ambos pasos. No requiere migraciones ni cambios de variables.

Las copias de configuración del panel requieren la migración `202611100001_election_copies` **antes de desplegar** la nueva API/web. Ejecuta solo `node dist/ops/migrate.js` desde el servicio de operaciones con `/infra/railway.migrate.json`; no reinicialices la instalación. Guarda la copia cuando estén listos el padrón y las listas. Recuperar crea una elección nueva sin votos y conserva la anterior; véase [Copias de configuración](COPIAS_CONFIGURACION.md).

Validación de las copias de configuración: build, TypeScript y ESLint; 44 pruebas unitarias y 75 comprobaciones de integración (28 generales, 16 de padrón, 20 oficiales y 11 de copias); comandos compilados de instalación/recuperación oficial; cuatro pruebas de navegador (copias con horarios pendientes, padrón/votación, acceso del personal y cierre/publicación). Todo se ejecutó en bases locales temporales con datos sintéticos. No se aplicó la migración ni se recuperó ninguna elección de producción desde este entorno.

La mejora de respuestas 429 añade pausas de reconexión, detiene SSE en elecciones publicadas/anuladas y cachea los assets con hash, conservando `no-store` para HTML/API privada. Validación: build, TypeScript, ESLint, 53 pruebas unitarias (incluidas 9 de HTTP/reconexión), 5 pruebas de navegador y comandos compilados de producción con comprobación de caché. Los 429 se simularon en bases temporales; no se generó carga de prueba en producción ni se identificó desde aquí el intermediario responsable de la captura. No requiere migraciones nuevas.

Al crear una elección después del ensayo, el colegio compartido se reutiliza. El panel conserva nombre/código si ya existen elecciones iniciadas o finalizadas y permite guardar los datos y horarios propios del nuevo borrador. Un guardado de la institución con valores idénticos devuelve 200 sin modificar datos ni añadir una auditoría de cambio; un cambio real del colegio mantiene el bloqueo histórico. No requiere migraciones nuevas.

Validación de la corrección de identidad institucional: build, TypeScript y ESLint; 10 comprobaciones de integración, incluidas solicitudes idénticas concurrentes y todos los estados protegidos; dos pruebas de navegador (creación tras ensayo publicado con guardado de configuración/horarios y recuperación de copias). Se mantuvieron los votos y la auditoría del ensayo sintético. No se modificó ninguna institución de producción desde este entorno.

El pulido de formularios centra los diálogos, mantiene sus acciones visibles y conserva la validación de formularios con controles de doble envío. Validación: build/TypeScript, ESLint, 53 pruebas unitarias y 13 de navegador, usando bases temporales y datos sintéticos. No requiere migraciones ni variables nuevas. La skill de desarrollo unslop está instalada en `.agents/skills/unslop` y queda excluida de la imagen de la aplicación; véase [Formularios y confirmaciones](FORMULARIOS_UI_UX.md).

## Observador de solo lectura

El observador solo accede a Vista general y a Resultados y actas; este último apartado se habilita al cerrar todos los turnos y muestra cifras/descargas después de la publicación autorizada. El cambio alcanza cuentas existentes sin migrar ni modificar datos. Requiere desplegar la nueva versión en Railway. Véase [Acceso del observador](OBSERVADOR.md).
