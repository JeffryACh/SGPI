/**
 * ============================================================================
 * 2.1. OBJETIVO DEL ARCHIVO:
 * Realizar el ajuste cosmético y de normalización textual del encabezado de
 * declaraciones éticas en la interfaz de usuario del SGPI, sin alterar la
 * estructura subyacente ni los campos éticos del formulario.
 *
 * 2.2. RELACIONES:
 * 2.2.1. De dónde obtiene datos:
 *   - Del Document Object Model (DOM) del navegador, inspeccionando elementos
 *     <summary> renderizados en el contenedor interactivo '#app' por app.js.
 * 2.2.2. A dónde envía datos:
 *   - Al propio DOM del navegador, mutando directamente la propiedad textContent
 *     de los elementos correspondientes para actualizar la vista del usuario.
 *
 * 2.3. A GROSO MODO ¿QUÉ HACE EL ARCHIVO?:
 * Ejecuta una sustitución de texto en tiempo real sobre los encabezados de tipo
 * <summary> para cambiar 'Declaraciones éticas individuales' a 'Declaraciones éticas'.
 * Adicionalmente registra un MutationObserver sobre el nodo raíz '#app' para
 * garantizar que los re-renderizados dinámicos de pantalla en la Single Page
 * Application (SPA) mantengan la etiqueta corregida.
 * ============================================================================
 */

/**
 * Normalizar la etiqueta visible de la sección de ética en las pantallas de
 * formulación y revisión de propuestas.
 * Consulta todos los elementos HTML <summary> presentes en el documento,
 * evalúa si su texto tras aplicar trim() coincide exactamente con
 * 'Declaraciones éticas individuales', y en caso afirmativo lo sustituye
 * por 'Declaraciones éticas'.
 * parametros:
 *     (ninguno)
 * return:
 *     + void : undefined No retorna valor; actualiza el nodo DOM in-place.
 */
const renameEthicsHeading = () =>
  document.querySelectorAll("summary").forEach((summary) => {
    // [Línea clave]: ¿Por qué soy importante? Identifico el encabezado objetivo. ¿Para qué? Evitar modificar otros acordeones o resúmenes colapsables. ¿Dónde me usan? Dentro del callback forEach de renameEthicsHeading.
    if (summary.textContent.trim() === "Declaraciones éticas individuales") {
      summary.textContent = "Declaraciones éticas";
    }
  });

// [Línea clave]: ¿Por qué soy importante? Aplica el ajuste en la carga inicial sincrónica. ¿Para qué? Para corregir la etiqueta si el DOM ya estaba previamente construido. ¿Dónde me usan? En el arranque del script ethics.js.
renameEthicsHeading();

// [Línea clave]: ¿Por qué soy importante? Vigila el ciclo de vida reactivo del DOM en la SPA. ¿Para qué? Para reaplicar la normalización textual cada vez que app.js reemplaza nodos hijos dentro de #app. ¿Dónde me usan? En la suscripción reactiva al contenedor principal de la vista.
new MutationObserver(renameEthicsHeading).observe(
  document.getElementById("app"),
  { childList: true, subtree: true }
);
