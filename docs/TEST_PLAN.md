# Evidencias de validación

Entrega verificada: **05/11/2026 18:46 (Lima)**. Datos ficticios, PostgreSQL 17 real. Evidencias machine-readable en `artifacts/`.

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
- CSRF, origen externo, permisos verticales, institución ajena, embargo en API/SSE, credencial incompleta, expiración, duplicados CSV, MFA y repetición del seed: aprobados.

## Evidencias para mostrar

`artifacts/screenshots/01-portada.png`, `02-panel-jornada.png`, `03-cedula.png`, `04-constancia.png`, `05-resultados.png`, `06-auditoria.png`, `07-movil-320.png`, `07-movil-390.png`, `08-panel-movil.png`.

Acta ficticia: `artifacts/acta-demostracion.pdf`. Sus cifras corresponden al recorrido de navegador con dos electores; el ensayo de 50 electores figura por separado en integración. No confundir ambos escenarios.

## Límites de la evidencia

No se ejecutó una prueba de cinco minutos sobre la red del colegio, ni una auditoría independiente de seguridad, ni matriz completa de lectores de pantalla y navegadores. Los workflows CI se entregan configurados, pero no se han ejecutado en GitHub. No existe publicación pública/HTTPS confirmada. Estos resultados corresponden a una simulación, no a validación oficial.
