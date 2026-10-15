# Validación SGPI

## Validación de la versión anterior

Las doce pruebas siguientes se ejecutaron antes de la simplificación visual. La revisión actual se documenta al final.

## Resultado local

- Las 33 pantallas base se renderizaron a 1440 × 1024 con captura completa del contenido.
- Sin errores JavaScript durante la comprobación de rutas.
- Sin desbordamiento horizontal del documento; sin texto desbordado en títulos, controles, etiquetas o botones comprobados.
- Capturas inspeccionadas de inicio, presupuesto y evaluación; revisión adicional de acceso, formularios y consulta mediante catálogo.
- Prueba a 390 × 844 sin desbordamiento horizontal en inicio.
- Roboto local, blanco/azul/rojo y opacidades; foco visible y overlays cerrables con Escape.
- Archivo autónomo `SGPI.html` preparado con estilos, datos, JavaScript y fuente integrados.

## Doce comprobaciones funcionales superadas

1. El acceso exige correo y contraseña de demostración.
2. Un título obligatorio vacío impide avanzar; completarlo permite continuar.
3. El presupuesto recalcula y bloquea el avance al superar el tope anual; permite continuar al corregirlo.
4. Falta de anexo bloquea envío; restaurarlo y confirmar conduce a Vinculación.
5. Un obligatorio con 6 o productos no conformes impide recomendar aun con total ≥70.
6. El aval vuelve al investigador y exige sometimiento explícito antes de Dirección.
7. La resolución negativa no ofrece aceptación.
8. La resolución favorable permite registrar carta de aceptación.
9. Consulta histórica: búsqueda, sin resultados, limpiar filtros y expediente cerrado correcto.
10. Administración restringida al rol Dirección.
11. Escape cierra el overlay y devuelve el foco.
12. Inicio se adapta al ancho de 390 px.

## Paquete Figma

Se prepararon **106 vistas**: 33 pantallas base y 73 escenarios, variantes de rol, secciones expandidas y overlays. El esquema tiene **1.296 enlaces**; sus destinos existen en el paquete. Son datos de importación comprobados localmente, no nodos ya creados en el archivo remoto.

`code.js` pasó comprobación de sintaxis JavaScript. El importador incluye texto y vectores editables, componentes por firma visual y conexiones nativas. Mantiene las coordenadas de la composición; no convierte automáticamente todo el diseño a auto-layout responsive.

**Pendiente:** ejecutar el plugin con permiso de edición, revisar fuentes/saltos de línea, overlays, scroll y componentes en Figma, recorrer los flujos nativos y confirmar acceso de visualización. El conector no permitió hacerlo por el límite Starter. No se ha validado con usuarios reales.

## Revisión simplificada para VIE — 18 septiembre 2026

33 pantallas y 73 estados exportados desde la interfaz actual. Se revisó visualmente el inicio y se comprobó en navegador que editar un rubro recalcula los montos y bloquea el avance cuando excede el límite. El archivo de Figma fue renombrado SGPI · VIE — Prototipo interactivo. La página del prototipo aún no contiene pantallas: la importación mediante Scripter espera autorización del usuario.
