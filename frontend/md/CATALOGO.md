# Catálogo de Pantallas del SGPI · Convocatoria Fondos VIE 2027

Este catálogo define las **33 pantallas base** del prototipo navegable del SGPI, clasificadas por módulo funcional y asociadas a los endpoints del Backend FastAPI.

---

## Índice General de Pantallas

| ID | Pantalla | Módulo | Rol Principal | Fuente de Datos / API |
| :---: | :--- | :--- | :--- | :--- |
| **01** | Acceso al SGPI | Autenticación | Todos | `POST /auth/login` |
| **02** | Dashboard Principal («Hola, Laura») | Formulación / Resumen | Investigador | `GET /propuestas/dashboardpropuestas`, `/propuestaMasReciente`, `/top3PropuestaMasReciente` |
| **03** | Centro de Notificaciones | Notificaciones | Todos | `GET /notificaciones/notificaciones`, `PATCH /leer`, `PATCH /leer-todas` |
| **04** | Catálogo de Convocatorias | Convocatorias | Todos | `GET /convocatorias/totalConvocatorias` |
| **05** | Detalle Convocatoria Fondos VIE 2027 | Convocatorias | Todos | `GET /convocatorias/etapas_convocatorias`, `/documentos_convocatoria` |
| **06** | Mis Propuestas | Formulación / Gestión | Investigador | `GET /propuestas?id_usuario=X` |
| **07** | Selección de Modalidad | Formulación (Paso 0) | Investigador | `GET /modalidades/totalmodalidades` |
| **08** | Asistente: Datos Generales | Formulación (Paso 1) | Investigador | `GET /escuelas/totalescuelas`, `/lineas_de_investigacion/totalLineas` |
| **09** | Asistente: Equipo Investigador | Formulación (Paso 2) | Investigador | `GET /tipos_hora/totalTiposHora` |
| **10** | Asistente: Descripción y Fundamentación | Formulación (Paso 3) | Investigador | Almacenamiento estructurado |
| **11** | Asistente: Objetivos (General y Específicos)| Formulación (Paso 4) | Investigador | Tabla `proposal_objectives` |
| **12** | Asistente: Metodología y TRL | Formulación (Paso 5) | Investigador | Validación TRL según modalidad |
| **13** | Asistente: Plan de Acción | Formulación (Paso 6) | Investigador | Tabla `action_plans` |
| **14** | Asistente: Gestión de Riesgos | Formulación (Paso 7) | Investigador | Tabla `risks` (vinculada a actividades) |
| **15** | Asistente: Presupuesto Anualizado | Formulación (Paso 8) | Investigador | Tabla `proposal_budget` + topes anuales |
| **16** | Asistente: Información Complementaria | Formulación (Paso 9) | Investigador | Enlace de vinculación y licencias |
| **17** | Asistente: Declaraciones Éticas y Anexos | Formulación (Paso 10)| Investigador | Tabla `proposal_ethics_declarations` |
| **18** | Asistente: Revisión y Pre-envío | Formulación (Paso 11)| Investigador | Resumen pre-validado |
| **19** | Confirmación: Propuesta Enviada | Formulación / Estado | Investigador | `POST /propuestas` (Código `SI-YYYY-NNN`) |
| **20** | Seguimiento de Propuesta | Seguimiento | Investigador | Bitácora `proposal_state_history` |
| **21** | Bandeja de Trabajo de Evaluación | Evaluación | Evaluadores | `GET /propuestas?estado=X` |
| **22** | Expediente Completo de Propuesta | Evaluación | Evaluadores | `GET /propuestas/{id_propuesta}` |
| **23** | Evaluación: Centro de Vinculación | Evaluación (Dictamen) | Vinculación | `POST /propuestas/{id}/evaluaciones` |
| **24** | Evaluación: Comité Técnico | Evaluación (Rúbrica) | Comité Técnico | Rúbrica ponderada 0/6/8/10 + puntaje |
| **25** | Aval del Consejo de Escuela | Evaluación (Aval) | Coordinador Escuela | `PATCH /propuestas/{id}/estado` (Estado Avalada) |
| **26** | Dictamen Dirección de Investigación | Evaluación (VIE) | Dirección / VIE | Checklist de admisibilidad normativa |
| **27** | Resolución del CIE | Evaluación (Resolución) | Miembro CIE | Fallo colegiado (Aprobada/Rechazada/Observada) |
| **28** | Historial y Trazabilidad del Expediente| Auditoría | Todos | `GET /propuestas/{id}` (historial) |
| **29** | Consulta Histórica de Propuestas | Consulta / Búsqueda | Todos | `GET /propuestas` con filtros facetados |
| **30** | Resultados de Consulta Histórica | Consulta / Reporte | Todos | Tabla de resultados con código y monto |
| **31** | Administración de Convocatorias | Administración | Dirección / VIE | Gestión de etapas y fechas límite |
| **32** | Gestión de Rúbricas y Catálogos | Administración | Dirección / VIE | `GET /catalogos` |
| **33** | Perfil de Usuario y Cambio de Rol | Sistema | Todos | Selector de roles y logout |
