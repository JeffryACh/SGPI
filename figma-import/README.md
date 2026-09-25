# Importar el prototipo SGPI a Figma

Este plugin local convierte las capturas estructuradas del prototipo en capas de texto y superficies editables. Añade componentes de botones, campos y tarjetas, variables de color y conexiones nativas de navegación, apertura de overlays y cierre.

**Estado:** código preparado para el Plugin API estándar. La importación todavía no se ha ejecutado ni validado visualmente en Figma. Una revisión estática o local no sustituye esa comprobación.

El paquete entregado ya contiene **106 vistas y 1.296 enlaces** en `code.js`; no necesita ejecutar la preparación para importarlo. `snapshot.json` conserva los datos para regenerarlo.

## Preparación de los datos

Si `code.js` todavía contiene el marcador `__SGPI_SNAPSHOT_DATA__`, ejecute desde esta carpeta:

```powershell
node build.mjs "snapshot.json"
node --check code.js
```

El build incorpora todo el JSON en `code.js` y conserva `code.template.js` para regenerarlo. La carpeta distribuida debe contener `manifest.json`, `code.js` y `ui.html`. No necesita Node para ejecutar el plugin ya empaquetado dentro de Figma.

## Importación en Figma Desktop

1. Abra [SGPI · VIE — Prototipo interactivo](https://www.figma.com/design/0WnVqYKmyM2osg7AsEAcUZ) en Figma Desktop con permiso de edición. El permiso de visualización por sí solo no permite añadir nodos.
2. En el menú de Figma, busque **Plugins → Development → Import plugin from manifest…** y seleccione `manifest.json` de esta carpeta.
3. Ejecute **SGPI · Importar prototipo editable** desde Plugins → Development.
4. Compruebe la cantidad de pantallas indicada y pulse **Importar prototipo**. Espere el resultado antes de cerrar la ventana.
5. Se abre la página **02 · Prototipo interactivo** y se selecciona el inicio. Pulse **Presentar** para revisar los recorridos.

El identificador del manifiesto es local de desarrollo, no un ID publicado. Si su instalación solicita un ID registrado, cree un plugin de desarrollo vacío con **New plugin…** y copie únicamente el `id` que Figma genere a este manifiesto; luego vuelva a importarlo. No hace falta publicar el plugin.

La ejecución utiliza el Plugin API dentro del editor y no realiza llamadas al conector MCP, por lo que no consume su cuota MCP. Los permisos de edición, disponibilidad de fuentes y límites del archivo de Figma siguen aplicando.

## Qué se importa

- Todas las entradas de `screens`, en una grilla de cuatro columnas; los 33 diseños principales y los escenarios adicionales dependen del JSON suministrado.
- Texto Roboto Regular, Medium y Bold como capas de texto. Cajas, bordes y fondos como vectores, sin rasterizar ni insertar imágenes.
- Componentes locales cuando una caja lleva `tag` de botón, campo o tarjeta; variantes visualmente idénticas comparten maestro. Las variantes distintas mantienen su propio maestro.
- Tres variables principales: azul `#002855`, blanco `#FFFFFF`, rojo `#EF3340`. Los colores coincidentes se vinculan; opacidades y otros colores de entrada se conservan.
- Hotspots editables con acciones `NAVIGATE`, `OVERLAY`, `CLOSE` o `BACK`; destinos comprobados antes de importar y flujo inicial de presentación.

El plugin conserva el contenido previo: una nueva ejecución añade otra composición a la derecha. Si la ejecución falla a mitad, revise el mensaje y deshaga la operación antes de repetir. Los componentes locales quedan al lado derecho de la grilla, en la misma página, sin consumir una página adicional.

## Comprobación después de importar

Revise pantallas largas, saltos de línea, capas agrupadas y menús. La especificación tiene posiciones planas: el plugin conserva esas coordenadas; no reconstruye un sistema responsive ni una jerarquía DOM completa. Los componentes siguen siendo editables y sus instancias pueden separarse si una agrupación requiere ajuste.

Recorra acceso, formulación, evaluación, aval, sometimiento, Dirección, CIE y consulta histórica. Abra y cierre cada overlay. Figma expone la posición y el fondo del overlay como propiedades de solo lectura en el Plugin API: el plugin crea la conexión nativa y conserva la configuración predeterminada del editor; si hace falta, ajuste posición/fondo en la pestaña Prototype. No se promete persistencia de formularios ni conexión a sistemas institucionales.

Fuentes API: [manifiesto](https://developers.figma.com/docs/plugins/manifest/), [reacciones](https://developers.figma.com/docs/plugins/api/properties/nodes-reactions/), [acciones](https://developers.figma.com/docs/plugins/api/Action/), [overlays](https://developers.figma.com/docs/plugins/api/Overlay/).
