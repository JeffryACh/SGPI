# SGPI · VIE — Guía de entrega

## Estado real

**Versión local terminada y verificada:** prototipo interactivo de 33 pantallas base, seis roles y estados complementarios. Abre **SGPI.html** en un navegador; funciona sin servidor ni conexión a Internet. `index.html` ofrece la misma aplicación con sus archivos separados. `catalogo.html` contiene el índice actualizado de pantallas.

**Figma pendiente de completar:** el archivo [SGPI · VIE — Prototipo interactivo](https://www.figma.com/design/0WnVqYKmyM2osg7AsEAcUZ) contiene la guía visual, 27 variables, ocho estilos Roboto y componentes de botón/campo. El plan Starter bloqueó nuevas llamadas del conector antes de construir las pantallas. No se presenta ese archivo parcial como prototipo completo.

La carpeta `figma-import` incluye un plugin local empaquetado con capas editables y conexiones nativas. Su JSON y sus destinos se verificaron localmente; **no se ha ejecutado ni validado visualmente en Figma**. Consulta su README para importarlo en Figma Desktop con permiso de edición. Una vez importado, quedan por verificar el renderizado, los overlays y el enlace de presentación/visualización compartida. No se ha modificado el plan ni la configuración de acceso de la cuenta.

## Formato exigido

La consigna recibida exige **Enlace de Edición / Diseño en Figma** y **Enlace de Presentación / Modo Interactivo (Prototype Preview)**. El HTML es un apoyo local; no sustituye esos enlaces.

## Revisión de interfaz para VIE

Se quitaron la marca TEC, los nombres institucionales extensos y repetidos, los pies académicos, las migas redundantes y los avisos de escenario en cada pantalla. Se simplificaron el acceso y el inicio. Las notas auxiliares subieron a 12 px y los encabezados de tabla dejaron de usar mayúsculas diminutas. Las opciones de demostración se agruparon en Mi perfil.

## Qué contiene

- Tres módulos: formulación, evaluación y consulta histórica. Administración de convocatorias/rúbricas/catálogos como soporte de Dirección/VIE.
- Seis roles: investigador, Vinculación, Comité Técnico, Consejo de Escuela, Dirección de Investigación y CIE.
- Formularios editables con conservación de datos en el navegador, menús, selectores, overlays, mensajes, validaciones y confirmaciones.
- Presupuesto calculado por año, rúbrica ponderada 0/6/8/10, bloqueo por obligatorios y productos, filtros de histórico y expediente de consulta.
- Alternativas: campos vacíos, anexo faltante, presupuesto excedido, evaluación no recomendada, devolución, resolución negativa y búsqueda sin resultados.
- `CATALOGO.md` y `catalogo.html`: listado de las 33 pantallas base. Las capturas anteriores no corresponden a la revisión simplificada.
- `REQUISITOS_Y_TRAZABILIDAD.md`: reglas contrastadas con originales y localizadores de las fuentes.
- `VALIDACION.md`: alcance de comprobación y resultados reproducibles.

## Recorridos para presentar

### 1. Formular y enviar a evaluación

1. Abre `SGPI.html` e ingresa con los datos de demostración precargados.
2. Convocatorias → Fondos VIE 2027 → Crear propuesta → Desarrollo tecnológico.
3. Recorre datos, equipo, fundamentación, objetivos, metodología, plan, riesgos, presupuesto, información complementaria y documentos.
4. En presupuesto, edita un monto para superar ₡5 millones en un año: se recalcula el total y se impide continuar. Restablece el valor.
5. En documentos, revisa los anexos. El paquete Figma incluye un estado alternativo con anexo faltante para mostrar la validación.
6. Confirma la revisión y envía. La primera etapa es Vinculación; aún no es sometimiento formal.

### 2. Evaluar y obtener aval

1. Usa el selector de rol del encabezado y entra a Vinculación.
2. Bandeja → expediente → Iniciar revisión → Emitir dictamen → Registrar decisión → Ver próximo actor.
3. En Comité, inspecciona las ocho secciones de la rúbrica. Cambia «Participación estudiantil» a Regular (6): la evaluación deja de recomendar aunque el total supere 70. Restablece Bueno (8).
4. Registra la evaluación y pasa al Consejo. Registra el aval.
5. «Ver próximo actor» vuelve al investigador en estado Avalada. No salta a Dirección.

### 3. Someter, resolver y aceptar

1. Como investigador, en Seguimiento/Avalada pulsa «Someter propuesta».
2. La confirmación representa el 28 de septiembre de 2026 y exige los instrumentos previos. El estado cambia a Sometida.
3. Entra a Dirección para verificar el expediente y emitir dictamen. Después entra a CIE.
4. Registra una resolución Aprobada y vuelve al investigador: aparece la carta de aceptación.
5. Selecciona Rechazada en otro recorrido: no se ofrece aceptación. Las observaciones conservan una ruta de corrección.
6. Mi perfil → Opciones del prototipo → «Ver etapas» permite consultar Aceptada, En ejecución y Cerrada como escenarios complementarios. El cierre es de consulta; los informes son cargas simuladas.

### 4. Consultar antecedentes

1. Desde Mi perfil → Opciones del prototipo → Guía de recorridos → Consulta histórica, entra como Dirección.
2. Busca «Indicadores» y abre el expediente cerrado SI-2024-008.
3. Revisa resumen, documentos, evaluaciones, resolución e historial.
4. Busca una palabra inexistente para mostrar el estado vacío y su recuperación.

## Consistencia documental

El caso principal es **SI-2027-014 · Agua Inteligente: monitoreo de cuencas**, desarrollo tecnológico, enero de 2027 a diciembre de 2028, ₡9.400.000 (₡4.800.000 + ₡4.600.000), 16 horas semanales de investigación. Incluye beca asistente de 10 h/semana, 400 horas anuales a ₡2.400 (40 semanas planificadas, hasta 10 meses), y equipo solo en 2027.

Las fechas son **escenarios**, no información del día actual: formulación 21 ago; Vinculación 27 ago; Comité 10 sep; aval 17 sep; sometimiento 28 sep; Dirección 9 oct; CIE 23 oct; aceptación 3 nov de 2026. El calendario original se conserva.

El prototipo representa una revisión bibliográfica y documentos ficticios; no aporta artículos inventados ni acuerdos/firma digital reales. La calidad académica de la investigación se comprobaría con los documentos reales. El formulario completo de fortalecimiento no estaba entre las fuentes recibidas: se representa su selección y reglas, sin afirmar que fue transcrito íntegramente.

## Tecnología y límites

- Prototipo local real: HTML, CSS y JavaScript estándar; Roboto local; almacenamiento del navegador. No requiere instalar paquetes para abrir `SGPI.html`.
- Diseño real parcial: Figma Design y variables/componentes locales.
- Importador: Figma Plugin API `1.0.0`, manifest y JavaScript local, sin red.
- El stack de implementación del sistema y sus versiones **siguen pendientes de decisión del equipo**. Esta entrega no los presenta como aprobados.
- Acceso, documentos, firmas, decisiones y envíos institucionales son simulados. No se envían datos a sistemas institucionales.
- No se hicieron entrevistas ni pruebas con usuarios reales. La validación fue documental, visual y de navegación automatizada.

## Rúbrica académica

| Criterio | Peso | Evidencia / situación |
|---|---:|---|
| Secuencia lógica | 10% | Formulación → Vinculación condicional → Comité → aval → sometimiento del investigador → Dirección → CIE → aceptación |
| Ortografía | 10% | Etiquetas y mensajes revisados en español |
| Tecnología | 5% | Tecnología real de prototipo documentada; stack futuro no decidido |
| Colores | 10% | Blanco, azul #002855 y rojo #EF3340; superficies mediante opacidad de estos colores |
| Botones | 10% | Acción principal, secundaria, textual; foco visible; controles reutilizados |
| Espacio | 10% | Navegación lateral, jerarquía de títulos, formularios por pasos y paneles de contexto |
| Idioma | 5% | Interfaz en español; campos de contenido en inglés exigidos por el formulario etiquetados en español |
| Módulos | 10% | Formulación, evaluación, histórico y administración de soporte |
| Casos de uso | 10% | Recorridos por seis roles y alternativas de error/decisión |
| Interacción y navegación | 10% | Verificadas en HTML; comprobación del prototipo Figma pendiente por cuota |
| Información coherente | 10% | Caso ficticio único, reglas/plazos contrastados y expediente trazable |

No se declara cumplimiento total de la entrega Figma mientras falten importación, comprobación visual y enlace de presentación accesible.
