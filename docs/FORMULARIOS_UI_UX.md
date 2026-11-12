# Formularios y confirmaciones de SIVEE

## Skill instalada

Se instaló **unslop**, de **Damir Sokolovsky** ([@heydamir](https://x.com/heydamir)), en `.agents/skills/unslop`, siguiendo su instalación de Codex para un proyecto. Fuente: [heydamir/unslop](https://github.com/heydamir/unslop), revisión `97daa3eb365670ea3f87ed85356cbfcee18105a5`, licencia **CC BY 4.0**. Se conservan los archivos originales, la licencia y la atribución en `UPSTREAM.md`.

La skill se aplicó en modo de pulido a los formularios. Sus referencias y scripts son herramientas de desarrollo: `.dockerignore` los excluye del despliegue y ESLint no modifica ni analiza el código de terceros. No se añadieron dependencias, servicios, fuentes externas ni imágenes a la aplicación.

## Auditoría y dirección

La comprobación inicial en Chromium reprodujo una confirmación de 520 px situada en `x=0`, `y=0`, con margen de 0 px en una ventana de 1366×600. El diálogo dependía de los márgenes por defecto del navegador, que el reset CSS eliminaba. Los formularios largos compartían el desplazamiento con el botón de envío y varios formularios situaban sus acciones de manera distinta.

- **Producto:** formularios para administrar la votación escolar.
- **Carácter:** claro, sobrio y predecible.
- **Contexto:** documentos, papeletas y la identidad institucional azul marino, rojo y blanco.
- **Foco:** contenido legible y una única acción principal de confirmación.
- **Detalle común:** cancelar y confirmar permanecen dentro del diálogo, separados del contenido desplazable.

## Pulido aplicado

1. **Espaciado:** cabecera y cuerpo con 24 px de padding en escritorio y 16 px en pantallas estrechas; separación de campos de 20 px y acciones de 12 px.
2. **Color:** se conserva la paleta de SIVEE. El fondo del diálogo permanece blanco, con separadores discretos y confirmación roja.
3. **Iconos:** cierre con el icono de línea X de Lucide, etiqueta accesible y área de 44 px.
4. **Texto:** se conservan los nombres de operaciones y se presenta una acción principal junto a Cancelar.
5. **Tipografía:** etiquetas y explicaciones legibles; controles a 16 px en pantallas estrechas, evitando el zoom automático al editar en navegadores móviles compatibles.
6. **Distribución:** centrado explícito respecto al espacio disponible de la ventana, límites adaptables y cuerpo desplazable entre cabecera y pie. Los campos en columnas se apilan en móvil. Las acciones del panel se agrupan sin desbordar el contenedor.
7. **Detalles:** diálogo con nombre accesible, Escape y retorno de foco al control que lo abrió. Los botones de pie envían el formulario correspondiente mediante su identificador y conservan la validación nativa. Durante un envío se bloquean las acciones repetidas y el cierre accidental.
8. **Contenido visual:** se conservan el escudo y los logos existentes. El alcance es el uso de los formularios, sin sustituir imágenes del proceso electoral.
9. **Movimiento:** se retira el desenfoque del fondo y se mantiene una superficie de confirmación estática, con estados de interacción visibles.

Se aplicó el componente común a preparación/jornada, listas, registro escolar, incidencias, cuentas, copias/recuperación y reemisión de códigos del modo anterior. Las operaciones de voto, permisos, auditoría y reglas de cierre/publicación conservan su comportamiento.

## Comprobaciones

La prueba `e2e/forms.spec.ts` verifica geometría y acciones en 1366×600, 1024×600, 390×844, 320×568 y 640×360; formularios largos con siete candidaturas; confirmaciones con ratón y Escape; retorno de foco; validación nativa y envío del formulario desde el pie; y bloqueo de doble envío/cierre durante una operación pendiente. Se utilizan cuentas, datos y bases temporales sintéticos.

El despliegue requiere actualizar la aplicación; no incorpora migraciones de base de datos ni cambios de variables.

Resultado de esta revisión: build/TypeScript y ESLint correctos; 53 pruebas unitarias; 13 pruebas de navegador aprobadas entre formularios, copias, identidad institucional, recuperación HTTP, padrón/votación, acceso del personal, cierre/publicación y reemisión. Se compararon visualmente la confirmación inicial y la corregida en escritorio y móvil. Las dos pruebas antiguas de presentación que requieren un servidor de demostración en 5173 no se ejecutaron en esta revisión.
