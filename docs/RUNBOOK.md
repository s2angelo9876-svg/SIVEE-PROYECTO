# Operación y recuperación

Para elecciones presenciales oficiales, usa [Producción: Railway, padrón y mesa](PRODUCCION.md). Los comandos DEMO de este documento se conservan para el entorno de ensayo.

## Inicio habitual

Desde la raíz: `npm install` (primera vez), luego `npm run dev` con Docker iniciado. Prepara PostgreSQL automáticamente antes de arrancar API y web, respetando el contexto de Docker. Validar `/api/v1/health/ready`: `status=ready`, `database=connected`. Para una base ya preparada usa `npm run dev:services`. Diagnóstico de Docker Desktop en Windows: [README](../README.md#si-docker-no-conecta-en-windows).

Se conservan dependencias, archivos y volumen de PostgreSQL; los procesos se reinician tras recuperar una máquina. Cada tarea cloud ya está aislada. No crees un worktree salvo petición explícita y no descartes el trabajo local.

## Variables

`.env.example` describe el contrato. `setup:demo` genera `.env` con permisos 0600 y claves aleatorias. No sobreescribe valores existentes. `DATABASE_URL` usa `sivee_app`, sin superusuario; `MIGRATION_DATABASE_URL` usa el propietario y solo se usa para migración y operaciones. El proceso API no debe recibir credenciales de migración en un despliegue oficial.

La clave HMAC de DNI no puede rotarse arbitrariamente: las búsquedas dejarían de coincidir. La rotación de `SESSION_PEPPER` requiere un plan para las sesiones y los datos históricos. No imprimas el entorno ni subas `.env`, credenciales, tokens o respaldos sin cifrar a Git.

## Estado electoral

BORRADOR → PREPARADA → EN_CURSO/PAUSADA → CERRADA → CONCILIADA → PUBLICADA. Las ventanas se cierran una vez. Los cambios de padrón y listas se permiten en BORRADOR. Solo un turno de la misma elección está abierto a la vez y mañana debe terminar antes de tarde.

La nueva simulación archiva la elección anterior como ANULADA y crea otra con el mismo padrón/códigos y listas. No elimina papeletas. Solo está disponible en la base DEMO y con `ALLOW_DEMO_RESET=true`.

La carga Excel/CSV y el registro individual siguen limitados a BORRADOR. Si una importación pierde su respuesta, consulta el historial de cargas. La reemisión de códigos por lote se limita a BORRADOR; la individual admite una jornada abierta solo para electores pendientes con turno sin cerrar. Revoca códigos y sesiones anteriores sin modificar votos. Procedimiento completo: [gestión del padrón](PADRON.md).

## Respaldo verificado

`npm run backup:verify` usa `pg_dump` consistente, cifra con AES-256-GCM, restaura una copia a una base temporal y compara participaciones y papeletas. El archivo queda en `.data/backups/*.enc`, la clave local en `.data/backup.key` (0600), y la evidencia en `artifacts/backup-results.json`.

Copia el respaldo cifrado a almacenamiento institucional y custodia la clave **por separado**. Mantener ambos solo en esta máquina no protege de la pérdida del servidor. No hay programación automática de respaldo ni PITR/replicación en la demo. La retención la debe decidir la institución.

Nunca restaures sobre la elección activa como primer recurso. Restaura en una base aislada, verifica integridad y recupera únicamente con autorización del Comité y un análisis de los votos posteriores al respaldo.

## Incidentes

- API caída: reinicia el proceso, conserva PostgreSQL y verifica health. No reinicies la simulación.
- BD caída: restablece el contenedor sin eliminar volumen. La API no debe mostrar éxito si el commit no se realizó.
- Red inestable: consulta el estado de participación; no generes votos en memoria ni colas locales offline.
- Diferencias de conciliación: conserva CERRADA, registra incidente y diagnostica. No edites papeletas.
- Padrón incorrecto tras preparar: sigue el procedimiento institucional. No uses SQL informal para habilitar electores.
- Credencial comprometida: el administrador técnico desactiva la cuenta y revoca sus sesiones. No publiques tokens en la incidencia.

## Requisitos del despliegue oficial

Usar base separada, cuentas sin fixtures, correo y contraseña personales, secretos seguros, HTTPS y cookies Secure, reglas institucionales documentadas, backups fuera del servidor y ensayo de recuperación/red eléctrica. En el modo oficial se exige la referencia en **Configuración → Referencia de autorización institucional** de esa elección; se guarda desde el panel y no certifica por sí sola una autorización. La separación de servidores, la custodia de esa referencia y los roles deben validarse fuera de la aplicación.

## Revisión de evidencias

Consulta fecha y resultado de cada JSON en artifacts. Las pruebas de integración son aisladas y se autolimpian; las E2E usan únicamente DEMO. No atribuyas a una versión nueva los resultados de una ejecución antigua.

## Respuestas 429 en el panel o en recursos estáticos

Un 429 significa que un servidor o intermediario limitó las solicitudes. No demuestra por sí solo agotamiento de memoria/CPU ni exige reiniciar la base. En SIVEE los límites de la aplicación protegen los intentos de ingreso del personal y estudiantes; no hay un límite global de la API, CSS o favicon. Si esas rutas también reciben 429, revisar la respuesta y cabeceras del proveedor o de la conexión usada por el navegador.

1. Evitar recargas repetidas y cerrar pestañas duplicadas. Respetar `Retry-After`; si falta, esperar un minuto.
2. Comparar el enlace directo de Railway en un navegador normal con la vista previa. Una respuesta correcta desde otra conexión no identifica por sí sola el origen del 429 que vio el usuario.
3. Si persiste, registrar hora, ruta, estado, texto de respuesta y, si existen, `Retry-After` y `x-railway-request-id`. No incluir cookies, contraseñas ni tokens. Correlacionar con HTTP Logs y métricas de Railway para distinguir aplicación, borde del proveedor y otro intermediario.
4. Si una creación no se confirmó, comprobar la lista de elecciones antes de enviar otra creación. No borrar votos, cuentas ni elecciones para resolver un 429.

El cliente reconoce respuestas 429 de texto/HTML y JSON, muestra la pausa y no repite automáticamente las escrituras. La participación espera a la primera consulta antes de abrir SSE; los fallos usan pausas de 15, 30, 60 y hasta 120 segundos, respetando un `Retry-After` mayor en la consulta. Al salir del panel cancela la reconexión y una elección publicada/anulada no mantiene SSE. Las sesiones vencidas o sin permisos no generan reintentos continuos.

Los assets con hash generados por Vite usan caché pública de un año e `immutable`; el HTML y los datos privados de la API conservan `no-store`. Una nueva compilación cambia los nombres con hash para cargar la revisión correcta. Estas medidas reducen solicitudes evitables; no sustituyen el diagnóstico del proveedor si vuelve a aplicar un límite.
