# SIVEE presencial: instalación y jornada oficial

El alumno ingresa solamente su DNI en una cabina activada y accede directamente a la cédula, sin aprobación de mesa ni códigos individuales. El comité registra y activa cada navegador del colegio una vez. Conocer un DNI no permite votar desde un navegador sin activar, pero sí podría permitir suplantar al estudiante desde una cabina habilitada. El acceso con DNI comprueba elegibilidad, no identidad; el colegio debe supervisar físicamente el uso de sus equipos.

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
7. Ingresa con la cuenta inicial. El primer acceso solo permite registrar MFA; configura una aplicación TOTP, confirma su código y entra al panel. En Cuentas del personal crea cuentas nominativas de comité, mesa, observación y administración técnica. Cada una registra su propio MFA. Necesitas al menos **dos cuentas distintas de comité** para aprobar cierre/publicación; no compartas contraseñas.
8. En Configuración crea la elección, introduce el nombre oficial del colegio, reglamento y horarios de Lima, y carga el **escudo original PNG o JPEG**, hasta 600 KB y 2048 × 2048. La web y el PDF usan ese escudo. La paleta es azul marino, rojo y blanco. `INSTITUTIONAL_APPROVAL_REFERENCE` debe contener la referencia del acuerdo real del colegio antes de preparar; el texto de esa variable no reemplaza la aprobación institucional.

Para posteriores versiones, respalda y prueba primero en un entorno separado. Ejecuta **solo** `node dist/ops/migrate.js` en el servicio temporal de operaciones, usando una configuración con ese comando de inicio; después despliega la API. No reutilices `/infra/railway.init.json` sin ajustar su comando, pues también intenta inicializar la institución. No vuelvas a ejecutar el inicializador. Las migraciones tienen checksum: no modifiques SQL ya aplicado. Los secretos de búsqueda/cifrado deben permanecer estables al actualizar.

## Si Railway usa Railpack

`npm run build` genera explícitamente Prisma antes de comprobar TypeScript y compilar. Esto también permite compilar cuando Railpack instaló dependencias antes de copiar `prisma.config.ts`. No dependas del postinstall de `@prisma/client` para encontrar el esquema en `apps/api/prisma`.

Si los registros de operaciones muestran Railpack y `npm run start`, ese servicio está usando el arranque de la API. Selecciona `/infra/railway.init.json` como archivo de configuración en Settings → Config-as-code y despliega nuevamente. Como alternativa, configura en ese servicio el comando de inicio `node dist/ops/initialize-production.js`, sin healthcheck HTTP y con reinicios desactivados. En el servicio SIVEE el arranque sigue siendo `npm start` o `node dist/api/main.js`.

## Preparar el padrón real

El Excel recibido contiene 1742 estudiantes, sin columna de turno. Detectamos 20 documentos vacíos, 5 de longitud diferente de ocho y 2 matrículas EN PROCESO, en filas distintas de los 25 problemas documentales. Estos casos requieren decisión del colegio. No completes documentos ni asignes turnos por suposición.

1. En Padrón electoral carga el archivo original `.xlsx` o un CSV equivalente. Se reconocen ITEM, GRADO, SECCIÓN, NÚMERO DE DOCUMENTO, CÓDIGO DEL ESTUDIANTE, ESTUDIANTE, SEXO, FECHA DE NACIMIENTO, EDAD (AL 31 DE MARZO), ESTADO DE MATRICULA y TIPO DE VACANTE. La plantilla añade TURNO como columna opcional. El reporte de encabezados dobles y códigos en celdas combinadas es compatible. Solo se utiliza la primera hoja visible del reporte; mueve allí el listado si recibes otro archivo con varias hojas.
2. Guarda en borrador y revisa los pendientes. El listado general enmascara documentos; solo un operador autorizado abre el documento completo para corregir. Los documentos del borrador se cifran. Sexo, nacimiento, edad y vacante no se almacenan ni se usan como preguntas de autenticación. El código de matrícula identifica el registro importado, **no es una contraseña**.
3. Solicita a la dirección la distribución de mañana/tarde y asigna explícitamente cada grupo de grado y sección. Resuelve documentos y matrículas con motivo documentado. Para documentos distintos de DNI, el comité debe definir antes la política de elegibilidad: esta versión solo habilita DNI de ocho dígitos. No inventes un DNI para pasar la validación ni excluyas automáticamente a un alumno por tener otro documento.
4. Registrar estudiante permite incorporar un alumno omitido antes de preparar. Si no se conoce su código de matrícula, se genera una referencia interna. Los documentos repetidos bloquean la confirmación; una fila excluida conserva motivo e historial. Dos operadores que editan la misma versión no sobrescriben silenciosamente sus cambios.
5. Confirma el padrón solo después de revisarlo. Esa confirmación fija las inscripciones para esta elección. Mientras siga en BORRADOR puedes añadir nuevos registros; los ya confirmados no se editan por esta pantalla. Ante una respuesta perdida consulta el historial; repetir la misma carga pendiente no duplica el lote. Antes de preparar verifica los totales y las 2–4 listas activas.

No subas el Excel real, capturas de alumnos ni exportaciones del padrón al repositorio. Limita los operadores autorizados y acuerda la retención de borradores, auditorías y respaldos.

## Logos de las listas

En Listas participantes, Nueva lista y Editar lista permiten subir un logo PNG o JPG de hasta 5 MB, con vista previa. La web lo ajusta a un máximo de 256 píxeles en su lado mayor, conservando proporciones y transparencia, para mantener ligera la cédula. El logo se guarda en PostgreSQL y aparece en administración, cédula, confirmación y resultados. No se borra al redesplegar Railway. Las listas anteriores conservan su símbolo hasta que se editen y se suba una imagen. Los cambios de listas siguen permitidos únicamente en BORRADOR.

Este cambio utiliza el campo existente de símbolo y no requiere migración de base ni reinicializar cuentas. Se aplica desplegando la nueva versión del servicio SIVEE-PROYECTO.

## Equipos, mesa y votación

- Crea las cabinas desde Mesa y cabinas y asigna cada una a una cuenta de mesa. El comité puede supervisar todas; la mesa puede cancelar sesiones en sus cabinas. No aprueba cada votante.
- Genera el enlace de activación y ábrelo **solo en el navegador del equipo del colegio**. Dura diez minutos y funciona una vez. No lo entregues al alumno ni lo publiques. El fragmento se borra de la barra de direcciones. La sesión de cabina usa una cookie protegida; no acredita hardware físico, por lo que se requiere navegador/perfil supervisado, sin extensiones no autorizadas, sincronización ni acceso del alumno a herramientas de desarrollo. La cookie vence a las 24 horas; reactiva antes de otra jornada.
- Configura la estación de mesa separada de las cabinas; los alumnos no deben tener la sesión administrativa en su equipo. Usa modo kiosco y supervisión del colegio. Desactiva o reasigna una cabina ante pérdida o sospecha: se revocan su navegador y autorizaciones. Reactivar en otro navegador revoca el anterior.
- Activa al menos una cabina, prepara la elección y abre manualmente el turno correspondiente. Mañana debe cerrarse antes de abrir tarde. Los horarios también limitan la votación.
- El alumno escribe su propio DNI. Si está habilitado, no ha votado y su turno está abierto, la cédula se abre automáticamente y permite revisar sus datos. El responsable no vuelve a escribir el DNI ni pulsa una aprobación. Esta modalidad elimina la comprobación de identidad por software; la supervisión presencial debe impedir que se utilicen documentos ajenos.
- La sesión dura cinco minutos desde el ingreso del DNI y sirve solo para ese alumno, elección y cabina. Cancelar, expirar, desactivar o cambiar el navegador impide reutilizarla. Un estudiante no puede mantener sesiones simultáneas en dos cabinas.
- Al actualizar, una solicitud pendiente `WAITING` del flujo anterior se cancela desde la cabina y se vuelve a ingresar el DNI; no requiere migrar la base ni ejecutar operaciones.
- El alumno revisa sus datos y emite su voto privado. Un doble envío produce una sola participación/papeleta. La constancia no revela la elección; la mesa no recibe la preferencia. Tras votar se limpia la sesión del alumno. Para el siguiente alumno vuelve al inicio.

## Incidentes y recuperación

| Caso | Procedimiento |
| --- | --- |
| DNI ajeno, datos discrepantes o sospecha de suplantación | Cancelar la sesión antes del voto, registrar incidencia y aplicar la comprobación presencial institucional. Si ya votó, escalar al comité sin borrar ni reasignar su papeleta. Nunca colocar el DNI completo o la preferencia en el motivo. |
| Alumno omitido antes de preparar | Alta individual, revisión del documento/turno y confirmación. |
| Omisión después de preparar o jornada abierta | No hay alta tardía automática. Registrar incidencia y elevar al comité conforme al reglamento; no editar SQL ni abrir otra elección para eludir controles. |
| El sistema dice que ya participó | Comprobar participación e incidencia. No permitir un segundo voto ni borrar papeletas. La app no puede atribuir una papeleta secreta a una persona. |
| Se corta la red al confirmar | Conservar la pantalla, reintentar o consultar participación. La transacción es atómica; no contar un éxito sin confirmación del servidor. No hay votos offline. |
| Cabina congelada o autorización vencida | Mesa cancela la autorización y, si sigue pendiente de votar, verifica otra vez; puede activar otra cabina. |
| Corte eléctrico o Internet prolongado | Pausar la jornada, preservar equipos/base y aplicar contingencia aprobada (con UPS/conectividad de respaldo o acta de suspensión). No mezclar papel y sistema sin un procedimiento de conciliación. |
| Error en turno/horario | Pausar, documentar y revisar estado; una ventana cerrada no se reabre mediante la UI. |
| Pérdida de MFA/contraseña administrativa | Responsable técnico verifica al titular y usa el comando de recuperación abajo. |
| Totales no concilian | Mantener elección cerrada, conservar evidencia y diagnosticar. No publicar ni alterar papeletas. |

Recuperar una cuenta requiere acceso al entorno de operaciones con las mismas claves de la instalación. Añade temporalmente `RECOVERY_EMAIL`, `RECOVERY_PASSWORD` (mínimo 16 caracteres) y `RECOVERY_REASON` (mínimo 15 caracteres), y ejecuta `node dist/ops/recover-account.js`. Revoca todas las sesiones, exige registrar MFA otra vez y deja auditoría. Retira la contraseña temporal del servicio y entrégala al titular por canal privado. No existe un restablecimiento público por conocer el correo.

Para diagnosticar primero, sin restablecer la cuenta, conserva `INITIAL_ADMIN_EMAIL` y `INITIAL_ADMIN_PASSWORD` con el correo y la contraseña que quieres comprobar y ejecuta `node dist/ops/check-admin-access.js`. En Railway puedes seleccionar `/infra/railway.check-access.json`; si tienes un Start Command manual, actualízalo también al comando de comprobación. La salida informa `adminCount`, `institutionCount`, `accountFound`, `accountActive`, `passwordMatches` y `mfaEnabled`; no imprime correo, contraseña ni hash. No modifica cuentas, sesiones ni auditoría. Un resultado falso no revela por sí solo si operaciones está conectado a la misma base que la API: comprueba también las referencias de conexión de ambos servicios.

En Railway, el servicio temporal operaciones puede seleccionar `/infra/railway.recover.json` en Settings → Config-as-code → Railway Config File. Si usa Railpack con un comando manual, cambia su Start Command a `node dist/ops/recover-account.js`, sin healthcheck HTTP y con reinicios Never. Despliega una sola vez con las variables RECOVERY completas. El correo debe ser el de una cuenta ya creada; cambiar `INITIAL_ADMIN_EMAIL` o `INITIAL_ADMIN_PASSWORD` después de inicializar no modifica esa cuenta. La recuperación correcta imprime «Cuenta recuperada y sesiones revocadas». Luego ingresa con la nueva contraseña, configura MFA y elimina el servicio temporal con sus contraseñas de inicialización/recuperación. No vuelvas a ejecutar el inicializador para intentar cambiar una contraseña.

## Respaldos y ensayo de salida

Activa y verifica los respaldos de PostgreSQL en Railway **antes** de cargar datos reales; el repositorio no puede activar esa función en tu cuenta. Programa la frecuencia/retención según el objetivo de recuperación que acuerde el colegio. Conserva además una copia cifrada fuera del proyecto y una copia separada de `DNI_LOOKUP_KEY`, `SESSION_PEPPER` y `CSRF_KEY`. Sin las claves correctas no se recuperan búsquedas, documentos cifrados y MFA. No rotes `DNI_LOOKUP_KEY` ni `SESSION_PEPPER` durante una elección: requieren un procedimiento de migración de datos/secretos.

Ensaya restauración en **otro PostgreSQL/proyecto**, usando el respaldo administrado del proveedor; nunca sobre la elección activa. Conecta una API aislada con las mismas claves y el dominio de ensayo, confirma migraciones, MFA, padrón, totales y conciliación. Desactiva las cabinas restauradas y revoca las sesiones antes de exponer esa copia. No mantengas dos instalaciones capaces de aceptar votos de la misma elección. Si se perdieron votos posteriores al respaldo, el comité debe resolver la contingencia documentada: restaurar una copia antigua no permite reconstruir esas preferencias.

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

Las pruebas de integración/navegador crean y eliminan únicamente sus bases temporales con nombres aleatorios. Usan datos sintéticos; ninguna prueba necesita el Excel real. La prueba oficial importa 1742 registros con el formato del colegio y comprueba acceso, concurrencia, cancelación, expiración y MFA. `test:production` prueba los comandos compilados sobre una base vacía. `npm run dev` sigue disponible para ensayos locales con Docker Desktop y datos ficticios; ese comando no es el arranque del servicio publicado.

Validación ejecutada el 7 de noviembre de 2026 (UTC): compilación, TypeScript y ESLint; 37 pruebas unitarias; 53 comprobaciones de integración (25 generales, 16 del padrón anterior y 12 presenciales); instalación/recuperación oficial en base vacía; 3 pruebas de navegador, incluyendo revisión Axe sin infracciones en padrón y cédula; compilación/arranque Docker y restauración local cifrada. Se leyó también el Excel original para confirmar sus 1742 filas y pendientes, sin importarlo a una base ni incorporarlo al repositorio. No se ha desplegado en una cuenta Railway ni ensayado en la red del colegio. Las dos pruebas de presentación antiguas que archivan la demo no se repitieron en esta entrega.
