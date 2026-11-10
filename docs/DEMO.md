# Guion de presentación · 6 de noviembre de 2026

Duración sugerida: 8–12 minutos. Usa exclusivamente las cuentas ficticias. Mantén dos ventanas de navegador: una del comité y otra privada para el elector.

## Antes de presentar

1. Abre Docker Desktop (motor Linux); ejecuta `npm install` y `npm run dev` desde la raíz. La preparación de la base es automática.
2. Abre `http://localhost:5173` y el acceso del comité.
3. Inicia sesión con `comite@sivee.demo` / `DemoSivee2026!`.
4. Revisa la elección seleccionada. Si ya tiene votos de ensayos, en **Configuración → Nueva simulación**, escribe `NUEVA SIMULACION`. La anterior se conserva archivada.
5. En **Configuración → Preparar elección**, confirma. En **Jornada electoral**, abre mañana indicando un motivo. Si la elección ya está abierta y sin votos, está lista para empezar.
6. Ten disponibles las capturas y `artifacts/acta-demostracion.pdf` como evidencia de respaldo si falla la conexión.

## Recorrido

| Paso | Acción                                          | Explicación breve                                                 |
| ---- | ----------------------------------------------- | ----------------------------------------------------------------- |
| 1    | Mostrar portada                                 | «Cada estudiante participa con documento y código individual».    |
| 2    | Abrir panel del comité                          | «Se observa participación; no hay resultados por lista».          |
| 3    | Elector `00000001` / `DEMOCODE-001`             | Confirmar la identidad ficticia y entrar a la cédula.             |
| 4    | Seleccionar una lista, revisar y confirmar      | «La confirmación es irreversible y se registra de forma atómica». |
| 5    | Mostrar constancia                              | «No contiene la opción elegida ni un identificador de papeleta».  |
| 6    | Ingresar nuevamente con el mismo elector        | «Reconoce la participación; no habilita un segundo voto».         |
| 7    | Comité: resultados y actas                      | «Los resultados aún están reservados, también en la API».         |
| 8    | Cerrar mañana y abrir tarde                     | Probar `00000026` / `DEMOCODE-026`, eligiendo blanco.             |
| 9    | Opcional: `00000027` / `DEMOCODE-027`           | Elegir nulo para mostrar las tres clases de papeleta.             |
| 10   | Cerrar tarde, solicitar y aprobar cierre global | «Ningún turno cerrado se reabre mediante una acción común».       |
| 11   | Conciliar                                       | Verifica igualdad entre participaciones y papeletas y las sumas.  |
| 12   | Solicitar y aprobar publicación                 | Ahora aparecen resultados autorizados, PDF y CSV.                 |
| 13   | Mostrar auditoría                               | Acciones del comité y exportaciones, sin unir identidad y voto.   |

En DEMO una cuenta del comité puede solicitar y aprobar. Temporalmente, también puede solicitar y aprobar el cierre global oficial; la publicación oficial sigue exigiendo otra autoridad. El técnico no recibe resultados solo por administrar cuentas.

## Demostración con cincuenta participantes

Con API iniciada, ejecuta `npm run demo:scenario`. Crea una nueva simulación y usa el flujo de autenticación y votación para los cincuenta electores. Resultado esperado: **50 = 38 + 7 + 5**, sin abstenciones. No inserta cifras directamente en la base. La elección queda publicada para mostrar el escrutinio. Para volver a ensayar, crea una nueva simulación desde Configuración.

## Preguntas frecuentes

- **¿Puede votar alguien solo con conocer un DNI?** No: necesita el código individual vigente.
- **¿Cómo se evita el doble voto?** Restricción única estudiante/elección y actualización condicional dentro de una transacción PostgreSQL.
- **¿Se sabe quién votó por cada lista?** La aplicación no guarda una relación entre identidad y papeleta. No se promete protección criptográfica frente a un administrador hostil del servidor.
- **¿Qué pasa si se pierde la respuesta?** La consulta de participación reconoce un commit previo; un reintento no agrega otra papeleta.
- **¿Ya sirve para una elección oficial?** La simulación técnica funciona; el uso oficial necesita aprobación institucional y pruebas de infraestructura, privacidad y operación.

El personal ingresa solo con correo y contraseña; no hay configuración de autenticador. El cierre global permite temporalmente solicitar y aprobar con la misma cuenta autorizada; la publicación oficial requiere otra cuenta. Véase [Cierre temporal](CIERRE_TEMPORAL_UNA_CUENTA.md).
