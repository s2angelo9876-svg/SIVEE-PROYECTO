# Evidencias de validación

Entrega verificada: **05/11/2026 18:46 (Lima)**. Datos ficticios, PostgreSQL 17 real. Evidencias machine-readable en `artifacts/`.

## Actualización del padrón y menú · 06/11/2026

Validación en Linux con Node 24, PostgreSQL 17 y Chromium:

- ESLint, TypeScript y compilación aprobados; 33 pruebas unitarias y 41 comprobaciones de integración aprobadas (25 del flujo electoral y 16 nuevas del padrón).
- Cuatro pruebas Playwright aprobadas: jornada completa, pantallas móviles, Excel/alta individual/recuperación y desplazamiento del menú. La prueba del padrón utiliza una base temporal y la API compilada en el puerto 5052.
- Excel con varias hojas, primera hoja vacía, ceros iniciales, filas ocultas, encabezados personalizados y CSV con punto y coma. Fórmulas, fechas, archivos dañados y expansión ZIP excesiva rechazados; los errores conservan la fila original.
- Importación atómica, reintento idempotente tras respuesta perdida, inscripción individual concurrente y conservación de datos históricos entre elecciones.
- Reemisión revoca sesiones y códigos anteriores: comprobadas las carreras con acceso, voto y otra reemisión. No permite incorporar electores después de preparar, ni reemitir a quien ya votó o tiene turno cerrado.
- Menú desplazable hasta mostrar por completo Cerrar sesión, con rueda y teclas Home/End; móvil de 390 × 600 sin desbordamiento horizontal. Axe sin incidencias en la pantalla del padrón comprobada.
- `npm run dev` conserva la instalación y aplica la migración. Respaldo cifrado restaurado y conciliado después de la actualización: 8 elecciones y 8 papeletas ficticias.
- Auditoría npm: cero vulnerabilidades reportadas con el bloqueo actualizado.

Evidencias adicionales: `artifacts/roster-integration-results.json`, `artifacts/screenshots/padron-excel-individual.png`, `menu-escritorio-scroll.png` y `menu-movil-scroll.png`. No se realizó una importación de carga máxima de 5000 electores ni una ejecución local en Windows.

## Actualización de arranque con npm · 06/11/2026

Verificada en Linux con Node 24 y Docker Compose:

- Instalación con `npm install` y `npm ci`; bloqueo npm con binarios opcionales para Windows.
- `npm run dev` prepara PostgreSQL y levanta API y Vite; salud, frontend y acceso del comité comprobados.
- Repetir la preparación conserva `.env`, estados electorales, participaciones y papeletas.
- Un contexto Docker inexistente devuelve un mensaje de diagnóstico y código 1, sin forzar otro daemon ni modificar `.env`.
- El comando rechaza entornos y conexiones de migración ajenos a la demo antes de operar sobre la base.
- ESLint, TypeScript, compilación, 21 pruebas unitarias, 25 comprobaciones de integración y 2 pruebas Playwright aprobadas; Axe sin incidencias en las cuatro pantallas verificadas.
- Auditoría npm: cero vulnerabilidades con el nuevo bloqueo.
- Imagen Docker compilada con `npm ci`: salud, login, frontend y usuario sin privilegios verificados. Respaldo cifrado restaurado y conciliado usando el contexto Docker configurado.

Evidencia del arranque: `artifacts/npm-start-results.json`. Se añadió un job de instalación, generación Prisma, pruebas unitarias y compilación en Windows a GitHub Actions. Esta validación local no ejecutó Windows ni Docker Desktop; el job de Windows debe verificarse en GitHub.

## Validación de la entrega inicial

| Comprobación                            | Resultado observado                                                      |
| --------------------------------------- | ------------------------------------------------------------------------ |
| TypeScript y ESLint                     | Sin errores                                                              |
| Build React y API                       | Completado                                                               |
| Instalación congelada + setup repetible | Completado, sin borrar datos existentes                                  |
| Unitarias                               | 21 aprobadas                                                             |
| Integración                             | 25 comprobaciones aprobadas en base temporal aislada                     |
| Playwright                              | 2 pruebas aprobadas: recorrido completo y 320/390 px                     |
| Panel móvil adicional                   | 390 px sin desbordamiento horizontal                                     |
| Axe WCAG 2 A/AA + 2.1 AA                | 0 incidencias en portada, identificación, login admin y dashboard        |
| Auditoría de dependencias               | 0 avisos info/low/moderate/high/critical en el reporte de esta ejecución |
| Respaldo cifrado + restore aislado      | Restaurado y conciliado: 4 elecciones, 4 papeletas                       |
| Reinicio de API compilada               | Frontend, login y estados persistentes verificados                       |
| Imagen Docker                           | Build, readiness, login, frontend y ejecución sin root verificados       |

## Integridad y concurrencia

- 100 POST simultáneos del mismo elector: exactamente 1 respuesta RECORDED y 99 ALREADY_RECORDED; una papeleta persistente.
- 50 identidades: total correcto sin duplicados. En la última ráfaga: 522 ms totales, p95 512 ms. Incluye un reintento ya confirmado. Es una observación de esta máquina, no una garantía para la red escolar.
- 8 carreras voto/cierre: participantes y papeletas coincidieron en cada caso. Orden de bloqueos resuelve el resultado.
- Fallo forzado en INSERT: rollback de la actualización de participación. El log INTERNAL_ERROR de esa prueba es esperado; no se trata como prueba fallida.
- Conciliación P≠V: publicación bloqueada; test reestableció los fixtures únicamente en la base temporal.
- Restricciones SQL: urna sin columnas de identidad/fecha; UPDATE y DELETE denegados al rol API.
- CSRF, origen externo, permisos verticales, institución ajena, embargo en API/SSE, credencial incompleta, expiración, duplicados CSV, acceso del personal y repetición del seed: aprobados.

## Evidencias para mostrar

`artifacts/screenshots/01-portada.png`, `02-panel-jornada.png`, `03-cedula.png`, `04-constancia.png`, `05-resultados.png`, `06-auditoria.png`, `07-movil-320.png`, `07-movil-390.png`, `08-panel-movil.png`.

Acta ficticia: `artifacts/acta-demostracion.pdf`. Sus cifras corresponden al recorrido de navegador con dos electores; el ensayo de 50 electores figura por separado en integración. No confundir ambos escenarios.

## Límites de la evidencia

No se ejecutó una prueba de cinco minutos sobre la red del colegio, ni una auditoría independiente de seguridad, ni matriz completa de lectores de pantalla y navegadores. Los workflows CI se entregan configurados, pero no se han ejecutado en GitHub. No existe publicación pública/HTTPS confirmada. Estos resultados corresponden a una simulación, no a validación oficial.
