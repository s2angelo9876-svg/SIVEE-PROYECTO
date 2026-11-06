# Operación y recuperación

## Inicio habitual

Desde la raíz: `npm install` (primera vez), luego `npm run dev` con Docker iniciado. Prepara PostgreSQL automáticamente antes de arrancar API y web, respetando el contexto de Docker. Validar `/api/v1/health/ready`: `status=ready`, `database=connected`. Para una base ya preparada usa `npm run dev:services`. Diagnóstico de Docker Desktop en Windows: [README](../README.md#si-docker-no-conecta-en-windows).

Se conservan dependencias, archivos y volumen de PostgreSQL; los procesos se reinician tras recuperar una máquina. Cada tarea cloud ya está aislada. No crees un worktree salvo petición explícita y no reemplaces el checkout por el remoto vacío.

## Variables

`.env.example` describe el contrato. `setup:demo` genera `.env` con permisos 0600 y claves aleatorias. No sobreescribe valores existentes. `DATABASE_URL` usa `sivee_app`, sin superusuario; `MIGRATION_DATABASE_URL` usa el propietario y solo se usa para migración y operaciones. El proceso API no debe recibir credenciales de migración en un despliegue oficial.

La clave HMAC de DNI no puede rotarse arbitrariamente: las búsquedas dejarían de coincidir. `SESSION_PEPPER` también protege secretos MFA; su rotación requiere un plan. No imprimas el entorno ni subas `.env`, credenciales, tokens o respaldos sin cifrar a Git.

## Estado electoral

BORRADOR → PREPARADA → EN_CURSO/PAUSADA → CERRADA → CONCILIADA → PUBLICADA. Las ventanas se cierran una vez. Los cambios de padrón y listas se permiten en BORRADOR. Solo un turno de la misma elección está abierto a la vez y mañana debe terminar antes de tarde.

La nueva simulación archiva la elección anterior como ANULADA y crea otra con el mismo padrón/códigos y listas. No elimina papeletas. Solo está disponible en la base DEMO y con `ALLOW_DEMO_RESET=true`.

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

## Despliegue oficial pendiente

Usar base separada, cuentas sin fixtures, MFA, secretos seguros, HTTPS y cookies Secure, reglas institucionales documentadas, backups fuera del servidor y ensayo de recuperación/red eléctrica. En el modo oficial se exige `INSTITUTIONAL_APPROVAL_REFERENCE` al preparar; esa variable registra una referencia y no certifica una autorización. La separación de servidores, la custodia de esa referencia y los roles deben validarse fuera de la aplicación.

## Revisión de evidencias

Consulta fecha y resultado de cada JSON en artifacts. Las pruebas de integración son aisladas y se autolimpian; las E2E usan únicamente DEMO. No atribuyas a una versión nueva los resultados de una ejecución antigua.
