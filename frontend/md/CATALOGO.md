# Catálogo de Pantallas del SGPI · Convocatoria Fondos VIE 2027

Este catálogo define las **33 pantallas base** del prototipo interactivo del SGPI, clasificadas por módulo funcional y asociadas a los endpoints del Backend FastAPI en Render, la base de datos en Supabase y el motor de **Google Gemini IA (Plan Gratuito)**.

---

## Índice General de Pantallas

| ID | Pantalla | Módulo | Rol Principal | Fuente de Datos / API y Soporte IA |
| :---: | :--- | :--- | :--- | :--- |
| **01** | Acceso al SGPI | Autenticación | Todos | `POST /auth/login` (Autenticación contra Supabase) |
| **02** | Dashboard Principal («Hola, Laura») | Formulación / Resumen | Investigador | `GET /propuestas/dashboardpropuestas`, `/propuestaMasReciente`, `/top3PropuestaMasReciente` |
| **03** | Centro de Notificaciones | Notificaciones | Todos | `GET /notificaciones/notificaciones`, `PATCH /leer`, `PATCH /leer-todas` |
| **04** | Catálogo de Convocatorias | Convocatorias | Todos | `GET /convocatorias/totalConvocatorias` |
| **05** | Detalle Convocatoria Fondos VIE 2027 | Convocatorias | Todos | `GET /convocatorias/etapas_convocatorias`, `/documentos_convocatoria` (9 instrumentos) |
| **06** | Mis Propuestas | Formulación / Gestión | Investigador | `GET /propuestas?id_usuario=X` |
| **07** | Selección de Modalidad | Formulación (Paso 0) | Investigador | `GET /modalidades/totalmodalidades` (Topes anuales de financiamiento) |
| **08** | Asistente: Datos Generales | Formulación (Paso 1) | Investigador | `GET /escuelas/totalescuelas`, `/lineas_de_investigacion/totalLineas` |
| **09** | Asistente: Equipo Investigador | Formulación (Paso 2) | Investigador | `GET /tipos_hora/totalTiposHora` (Validación $\ge 4\text{ h/sem}$ por persona) |
| **10** | Asistente: Descripción y Fundamentación | Formulación (Paso 3) | Investigador | Almacenamiento estructurado (Problema, justificación y estado del arte) |
| **11** | Asistente: Objetivos (General y Específicos)| Formulación (Paso 4) | Investigador | Tabla `proposal_objectives` |
| **12** | Asistente: Metodología y TRL | Formulación (Paso 5) | Investigador | Validación de nivel de madurez tecnológica (TRL 4 a 7 en DT) |
| **13** | Asistente: Plan de Acción | Formulación (Paso 6) | Investigador | Tabla `action_plans` (Cronograma mensualizado 1–36 meses) |
| **14** | Asistente: Gestión de Riesgos | Formulación (Paso 7) | Investigador | Tabla `risks` (Riesgos ligados directamente a actividades del plan) |
| **15** | Asistente: Presupuesto Anualizado | Formulación (Paso 8) | Investigador | Tabla `proposal_budget` + Validación Sección 2.3.9 (Equipo en Año 1) |
| **16** | Asistente: Información Complementaria | Formulación (Paso 9) | Investigador | Vinculación externa, socios y compromisos de propiedad intelectual |
| **17** | Asistente: Declaraciones Éticas y Anexos | Formulación (Paso 10)| Investigador | Tabla `proposal_ethics_declarations` (4 ejes bioéticos) |
| **18** | Asistente: Revisión y Pre-envío | Formulación (Paso 11)| Investigador | Resumen pre-validado + `POST /ia/evaluar-borrador` al confirmar envío |
| **19** | Confirmación: Propuesta Enviada | Formulación / Estado | Investigador | `POST /propuestas` (Código `SI-YYYY-NNN`) + Insignia de Puntaje Preliminar IA |
| **20** | Seguimiento de Propuesta | Seguimiento | Investigador | Bitácora inmutable `proposal_state_history` |
| **21** | Bandeja de Trabajo de Evaluación | Evaluación | Evaluadores | `GET /propuestas?estado=X` |
| **22** | Expediente Completo de Propuesta | Evaluación | Evaluadores | `GET /propuestas/{id_propuesta}` + Tarjeta y Modal de Evaluación Preliminar IA |
| **23** | Evaluación: Centro de Vinculación | Evaluación (Dictamen) | Vinculación | `GET /ia/evaluacion-preliminar/{id}` (Panel IA: PI y TRL) + `POST /propuestas/{id}/evaluaciones` |
| **24** | Evaluación: Comité Técnico | Evaluación (Rúbrica) | Comité Técnico | Rúbrica 0/6/8/10 + Panel IA con botón **«Aplicar puntajes IA como base»** |
| **25** | Aval del Consejo de Escuela | Evaluación (Aval) | Coordinador Escuela | Panel IA de pertinencia y viabilidad horaria + `PATCH /propuestas/{id}/estado` |
| **26** | Dictamen Dirección de Investigación | Evaluación (VIE) | Dirección / VIE | Panel IA con checklist automatizado de los 5 puntos normativos VIE |
| **27** | Resolución del CIE | Evaluación (Resolución) | Miembro CIE | Panel IA con borrador motivado de acuerdo + Fallo colegiado |
| **28** | Historial y Trazabilidad del Expediente| Auditoría | Todos | `GET /propuestas/{id}` (historial de transiciones con fecha y usuario) |
| **29** | Consulta Histórica de Propuestas | Consulta / Búsqueda | Todos | `GET /propuestas` con filtros facetados (escuela, modalidad, línea, estado) |
| **30** | Resultados de Consulta Histórica | Consulta / Reporte | Todos | Tabla de resultados con código `SI-YYYY-NNN`, modalidad, escuela y monto |
| **31** | Administración de Convocatorias | Administración | Dirección / VIE | Gestión de etapas y cronograma oficial de la VIE |
| **32** | Gestión de Rúbricas y Catálogos | Administración | Dirección / VIE | `GET /catalogos` y `GET /ia/criterios` |
| **33** | Perfil de Usuario y Cambio de Rol | Sistema | Todos | Selector interactivo de roles institucionales y logout |

---

## Resumen de Interacciones Clave con la IA de Google Gemini

1. **Pre-evaluación al enviar propuesta (18 $\rightarrow$ 19):** Al pulsar *«Confirmar y enviar propuesta»*, el sistema invoca de forma asíncrona la API de Gemini (Plan Gratuito: `gemini-3.5-flash` con fallback a `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite`), calcula el puntaje ponderado preliminar y persiste el dictamen en Supabase.
2. **Asistencia interactiva en el Comité Técnico (24):** El evaluador puede consultar la justificación sugerida para cada uno de los 19 criterios y hacer clic en **«Aplicar puntajes IA como base»** para pre-poblar los selectores sin necesidad de transcripción manual.
3. **Checklist automatizado para la VIE (26):** Pre-audita de forma determinista la ausencia de compras de equipo en Año 2 (Sección 2.3.9), la cuota de productos académicos (Sección 2.4.1) y la inclusión de becas para asistentes.
