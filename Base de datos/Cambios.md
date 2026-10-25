# Bitácora de Cambios y Estructura de la Base de Datos (SGPI)

Este documento registra la evolución del modelo de base de datos relacional para el **Sistema para la Gestión de Propuestas de Investigación (SGPI - TEC)** bajo la normativa de la convocatoria **Fondos VIE 2027**.

---

## 1. Catálogos Base (V1 - Normalización Inicial)

### States (`estados`):
- Catálogo cerrado de los estados posibles de una propuesta (12 estados oficiales de la Convocatoria VIE 2027), evitando texto libre y permitiendo el flujo secuencial de revisión.

### Modalities (`modalidades`):
- Catálogo de las modalidades de la convocatoria Fondos VIE: *Actividad de fortalecimiento*, *Investigación básica, aplicada o ambas*, y *Desarrollo tecnológico*.

### ResearchLines (`lineas_investigacion`):
- Catálogo de líneas de investigación institucionales del TEC, requerido para clasificar propuestas y filtrar el histórico institucional.

### HourTypes (`tipos_hora`):
- Catálogo de los 6 tipos de hora oficiales del TEC (`VIE`, `VIE-Centros`, `CONS`, `REC`, `DOC`, `VIESA`) con que se financia el tiempo de un investigador dentro del equipo.

### BudgetCategories (`rubros_presupuesto`):
- Catálogo de rubros presupuestarios (servicios, viáticos, equipo, materiales, becas estudiante asistente, etc.), usado para desglosar el presupuesto anualizado por rubro.

### RiskLevels (`niveles_riesgo`):
- Catálogo de niveles (*Bajo*, *Medio*, *Alto*, *Crítico*), reutilizado tanto para la probabilidad como para el impacto de un riesgo.

### VIECriteria (`criterios_verificacion_vie`):
- Catálogo de los criterios normativos y de admisibilidad que conforman el dictamen de verificación de la Dirección de Investigación / VIE.

### CIEResolutions (`resoluciones_cie`):
- Catálogo de las resoluciones posibles del Consejo de Investigación y Extensión (*Aprobada*, *Rechazada*, *Con observaciones*).

---

## 2. Entidades Principales y Tablas Hijas

### Proposals (`propuestas`):
- Cabecera del expediente digital de investigación. Centraliza título, resumen, escuela coordinadora, modalidad, línea, líder del proyecto, estado actual, convocatoria y fechas de ejecución.

### ResearchTeam (`research_team`):
- Tabla asociativa entre propuestas y usuarios que registra el equipo investigador completo, con horas asignadas y tipo de hora por persona (`id_tipo_hora`), validando el mínimo de 4 horas semanales por investigador.

### ProposalBudget (`proposal_budget`):
- Desglose del presupuesto de una propuesta por rubro y año de ejecución (`anio`). Permite calcular el monto total derivado con `SUM()` y validar que equipos duraderos se presupuesten solo en el Año 1.

### ActionPlans (`action_plans`):
- Cronograma de actividades de la propuesta con fecha de inicio, fecha fin y miembro del equipo responsable, obligatorio por normativa VIE.

### Risks (`risks`):
- Matriz de gestión de riesgos de la propuesta (probabilidad, impacto, medida de mitigación) vinculada directamente a las actividades del plan de acción mediante `id_plan_accion`.

### ProposalStateHistory (`proposal_state_history`):
- Bitácora inmutable de auditoría que registra cada transición de estado (`id_estado_anterior` $\rightarrow$ `id_estado_nuevo`), usuario responsable, marca temporal y observaciones.

### TechnicalCommitteeEvaluations (`technical_committee_evaluations`):
- Detalle de evaluación numérico ($0\text{–}100$) específico del Comité Técnico, alimentado desde la rúbrica ponderada.

### VIEDictamenVerifications (`vie_dictamen_verifications`):
- Detalle del dictamen de admisibilidad de la VIE como checklist booleano por criterio normativo verificado.

### CIEResolutionEvaluations (`cie_resolution_evaluations`):
- Detalle de la resolución formal y colegiada emitida por el CIE.

---

## 3. Extensiones y Migraciones Posteriores (V4 y V5)

### Notificaciones (`notificaciones` - V4):
- Sistema de notificaciones en base de datos para los usuarios del sistema:
  - Campos: `id_notificacion`, `id_usuario`, `id_propuesta`, `tipo` (trámite, convocatoria, seguimiento, sistema), `titulo`, `mensaje`, `fecha_creacion`, `leida`, `fecha_lectura`.
  - Índices optimizados para consulta rápida por usuario y propuestas.

### Convocatorias y Documentos Institucionales (`convocatorias`, `convocatoria_etapas`, `convocatoria_documentos` - V5):
- Digitalización de la Convocatoria Fondos VIE 2027:
  - `convocatorias`: Períodos de apertura, cierre e inicio de ejecución.
  - `convocatoria_etapas`: Las 11 etapas cronológicas oficiales de la convocatoria.
  - `convocatoria_documentos`: Repositorio con los 9 instrumentos oficiales descargables (Disposiciones, Rúbricas, Formularios, Plantillas de Presupuesto, Acuerdos de Consejo).

### Triggers y Funciones Automáticas en PostgreSQL (V5):
1. **`trg_generate_proposal_code()`**: Trigger `BEFORE INSERT` en `propuestas` que genera automáticamente el código institucional único con formato `SI-YYYY-NNN` (por ejemplo: `SI-2027-014`).
2. **`trg_log_proposal_state_change()`**: Trigger `AFTER UPDATE OF estado_actual` en `propuestas` que inserta automáticamente la traza de auditoría en `proposal_state_history`.
3. **`trg_notify_proposal_state_change()`**: Trigger `AFTER UPDATE OF estado_actual` en `propuestas` que inserta automáticamente una notificación dirigida al investigador líder informando el cambio de estado.

---

## 4. Infraestructura en la Nube (Supabase)

- **Instancia:** PostgreSQL 14.17 alojada en AWS región `us-west-2` (Oregon).
- **Project Ref:** `pxlrplbyggoywqbcgjdu`.
- **Pooler:** Supavisor IPv4 en `aws-0-us-west-2.pooler.supabase.com:6543`.
- **Total de tablas activas:** 36 tablas relacionales con integridad referencial y Row Level Security (RLS).
