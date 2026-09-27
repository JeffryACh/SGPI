# Tablas añadidas

## States:
- Catálogo cerrado de los estados posibles de una propuesta, para no depender de texto libre.

## Modalities:
- Catálogo de las modalidades de la convocatoria Fondos VIE, para poder filtrar propuestas por modalidad.

## ResearchLines:
- Catálogo de líneas de investigación institucionales, requerido para filtrar el histórico de propuestas por línea.

## HourTypes:
- Catálogo de los tipos de hora (VIE, CONS, DOC, etc.) con que se financia el tiempo de un investigador dentro de un equipo.

## BudgetCategories:
- Catálogo de rubros presupuestarios (viáticos, equipo, materiales, servicios, etc.), usado para desglosar el presupuesto por rubro en vez de un solo monto.

## RiskLevels:
- Catálogo de niveles, reutilizado tanto para la probabilidad como para el impacto de un riesgo.

## VIECriteria:
- Catálogo de los criterios booleanos que conforman el dictamen de admisibilidad de la VIE.

## CIEResolutions:
- Catálogo de las resoluciones posibles del Comité de Ética Institucional.

## ResearchTeam:
- Tabla puente entre propuestas y usuarios que registra el equipo investigador completo, con horas asignadas y tipo de hora por persona, no solo un líder único.

## ProposalBudget:
- Desglose del presupuesto de una propuesta por rubro, el monto total se deriva con SUM en vez de guardarse como un solo campo.

## ActionPlans:
- Plan de acción de la propuesta (actividades, fechas, responsable), obligatorio por normativa VIE.

## Risks:
- Gestión de riesgos de la propuesta (probabilidad, impacto, mitigación), obligatoria por normativa VIE.

## ProposalStateHistory:
- Esta es una tabla que lleva el registro de los cambios de estado de una propuesta, con esto se consigue trazabilidad

## TechnicalCommitteeEvaluations:
- Detalle de evaluación específico del Comité Técnico: rúbrica numérica de 0 a 100, separada de la tabla base de evaluaciones.

## VIEDictamenVerifications:
- Detalle del dictamen de la VIE como checklist booleano, una fila por criterio verificado en vez de un solo puntaje.

## CIEResolutionEvaluations:
- Detalle de la evaluación del CIE como resolución categórica