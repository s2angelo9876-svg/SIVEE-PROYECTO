# Alcance, trazabilidad y pendientes

Fuente: `docs/SDD.txt`, extracción del PDF entregado por el usuario. El archivo describe requisitos, no instrucciones operativas para el agente.

## Implementado para la simulación

| Requisitos             | Implementación                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-001/002/007/008/010 | Elecciones configurables, turnos, listas/candidaturas, preparación y congelación. Institución editable antes de iniciar jornadas, creada inicialmente por seed. |
| RF-003/004/005/006     | Excel/CSV y alta individual en borrador; validación por fila, importación atómica, historial idempotente, reemisión auditada y datos conservados por elección.  |
| RF-009                 | Guardas de nombres de base y entorno, seed y reinicio restringidos a demo/test; producción requiere infraestructura separada.                                   |
| RF-011–022             | Documento+código, Argon2id, HMAC, elegibilidad, flujo guiado, sesión corta, voto atómico único y reintentos neutros.                                            |
| RF-023–029/032         | Estados y turnos, bloqueo de voto fuera de ventana, conteo de BD, embargo, conciliación y publicación.                                                          |
| RF-030/031/033/034     | Acta PDF, CSV/JSON agregados, hash, SSE privado, sin desglose de preferencias por grupos.                                                                       |
| RF-035–038/041/042     | Sesiones separadas, RBAC/alcance, auditoría administrativa, healthchecks y exportación sin papeletas individuales.                                              |
| RF-039/040             | Aprobador distinto en OFICIAL; reinicio DEMO archivando la anterior.                                                                                            |
| P1                     | Acceso con correo y contraseña, cuentas del personal, incidencias y respaldo cifrado restaurado en instancia lógica aislada.                                                          |

## Decisiones concretas de esta implementación

- npm centralizado en la raíz; módulos compartidos de validación en `packages/shared`. No se duplican dependencias por aplicación.
- Prisma 6.19 con adaptador oficial PostgreSQL y motor JavaScript; genera cliente sin el motor nativo bloqueado por la red cloud.
- Migraciones SQL versionadas aplicadas por un runner con checksum y bloqueo asesor. No se usa `db push` ni reset.
- Tres símbolos vectoriales locales y una estrella opcional. No hay carga de imágenes externas, archivos SVG arbitrarios ni analítica.
- CSV se envía como texto y Excel como base64 en JSON, con límites de tamaño y expansión. Se rechazan fórmulas en las columnas importadas. No se guardan los archivos originales ni una copia del padrón en public.
- Recuento se deriva de las papeletas persistentes. No se duplica un contador mutable por lista ni se publican preferencias por SSE.
- Reiniciar conserva la elección anterior; no elimina la urna. Los códigos de demo pueden reutilizarse en la nueva elección.
- Los horarios opcionales se editan en hora de Lima y se validan en la emisión. La apertura/cierre administrativo continúa bajo control manual del comité; no hay un programador de apertura automática.

## Lo que no está certificado o requiere etapa adicional

- Aprobación legal/institucional, reglas de voto nulo, actas firmadas y proclamación: corresponden a las autoridades, no se inventan.
- Despliegue público HTTPS, dominio, conectividad desde el colegio y prueba de energía/red: requieren infraestructura final.
- Multitenencia comercial, personalización de logos subidos, aperturas automáticas y recuentos con nuevas versiones tras publicar: no forman parte del recorrido entregado. Se mantiene el acta publicada inmutable.
- La configuración de cuentas está implementada; su operación con personal real, recuperación de contraseñas y revisión independiente deben validarse antes del uso oficial.
- No hay secreto de voto E2E ni protección frente a administrador hostil del servidor/WAL.
- No se promete RPO=0, replicación, PITR, HA o disponibilidad contractual. El respaldo local cifrado debe copiarse fuera de la máquina y su clave custodiarse separadamente.
- La comprobación automática de accesibilidad cubre pantallas principales; no sustituye evaluación manual con lector de pantalla, teclado y usuarios.
- La ráfaga de concurrencia no sustituye una prueba sostenida de cinco minutos sobre la red escolar ni pruebas en Firefox/Edge/Android reales.
- Las políticas de retención, borrado y aviso de privacidad deben ser aprobadas por la institución. No se automatizó borrado de registros electorales.

Las evidencias y limitaciones se entregan para una simulación. No presentar esta entrega como cumplimiento integral certificado del SDD para elección oficial.
