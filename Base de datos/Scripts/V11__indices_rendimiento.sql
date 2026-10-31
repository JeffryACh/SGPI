-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V11__indices_rendimiento.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Crear índices B-tree optimizados sobre columnas de filtrado frecuente,
--      ordenamiento cronológico y claves foráneas en Supabase PostgreSQL.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Patrones de consulta del Backend FastAPI y navegación de la SPA.
--      2.2.2. A dónde envía datos / Qué entidades modifica:
--             - Crea índices en 'propuestas', 'research_team', 'action_plans',
--               'risks', 'proposal_state_history', 'evaluations', 'notificaciones', etc.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
--      Crea índices idempotentes (CREATE INDEX IF NOT EXISTS) para acelerar el
--      dashboard del investigador, la bandeja de Vinculación, el historial de estados
--      y la consulta de expedientes completos, asegurando latencias bajas.
-- ============================================================================

-- =====================================================================
-- MIGRACIÓN V11: ÍNDICES DE RENDIMIENTO PARA CONSULTAS FRECUENTES
-- Sistema de Gestión de Propuestas de Investigación (SGPI - TEC)
-- =====================================================================
-- Script idempotente para ejecutar en el SQL Editor de Supabase.
-- Cubre los accesos usados por el dashboard, la bandeja de Vinculación,
-- el expediente completo, el historial, las notificaciones y los
-- catálogos de convocatoria. Todas las claves primarias ya existen;
-- aquí solo se agregan los índices de columnas de filtro y orden.
--
-- Nota: las búsquedas con ILIKE '%texto%' sobre títulos o códigos no
-- se benefician de un índice B-tree. Para eso haría falta la extensión
-- pg_trgm, que se deja fuera de esta migración.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Propuestas: dashboard, listados, filtros y orden cronológico
-- ---------------------------------------------------------------------
-- [Línea clave]: ¿Por qué soy importante? Índice compuesto (id_usuario_lider, fecha_creacion DESC). ¿Para qué? Acelerar el dashboard de propuestas del investigador y consultas de top 3 recientes. ¿Dónde me usan? En backend/app/routers/propuestas.py.
CREATE INDEX IF NOT EXISTS idx_propuestas_lider_fecha
  ON public.propuestas (id_usuario_lider, fecha_creacion DESC);

-- [Línea clave]: ¿Por qué soy importante? Índice compuesto (estado_actual, fecha_creacion DESC). ¿Para qué? Optimizar la carga de bandejas de evaluadores y conteos por estado. ¿Dónde me usan? En vinculacion.py, comite.py y filtros de la SPA.
CREATE INDEX IF NOT EXISTS idx_propuestas_estado_fecha
  ON public.propuestas (estado_actual, fecha_creacion DESC);

CREATE INDEX IF NOT EXISTS idx_propuestas_fecha
  ON public.propuestas (fecha_creacion DESC);

CREATE INDEX IF NOT EXISTS idx_propuestas_escuela
  ON public.propuestas (id_escuela);

CREATE INDEX IF NOT EXISTS idx_propuestas_modalidad
  ON public.propuestas (id_modalidad);

CREATE INDEX IF NOT EXISTS idx_propuestas_linea
  ON public.propuestas (id_linea_investigacion);

CREATE INDEX IF NOT EXISTS idx_propuestas_convocatoria
  ON public.propuestas (id_convocatoria)
  WHERE id_convocatoria IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Equipo investigador: pertenencia del usuario a propuestas
--    (la PK ya cubre la búsqueda por id_propuesta)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_research_team_usuario
  ON public.research_team (id_usuario, id_propuesta);

-- ---------------------------------------------------------------------
-- 3. Tablas hijas del expediente: acceso por id_propuesta
--    (proposal_budget y proposal_sections ya tienen PK que inicia
--     por id_propuesta, por lo que no requieren índice adicional)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_proposal_objectives_propuesta
  ON public.proposal_objectives (id_propuesta, orden);

CREATE INDEX IF NOT EXISTS idx_product_commitments_propuesta
  ON public.academic_product_commitments (id_propuesta);

CREATE INDEX IF NOT EXISTS idx_action_plans_propuesta
  ON public.action_plans (id_propuesta, fecha_inicio);

CREATE INDEX IF NOT EXISTS idx_risks_propuesta
  ON public.risks (id_propuesta);

CREATE INDEX IF NOT EXISTS idx_ethics_propuesta
  ON public.proposal_ethics_declarations (id_propuesta);

CREATE INDEX IF NOT EXISTS idx_external_collaborators_propuesta
  ON public.external_collaborators (id_propuesta);

CREATE INDEX IF NOT EXISTS idx_council_endorsements_propuesta
  ON public.council_endorsements (id_propuesta);

-- ---------------------------------------------------------------------
-- 4. Documentos, historial y evaluaciones: expediente y trazabilidad
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_proposal_documents_propuesta
  ON public.proposal_documents (id_propuesta, fecha_subida DESC);

CREATE INDEX IF NOT EXISTS idx_state_history_propuesta
  ON public.proposal_state_history (id_propuesta, fecha_cambio DESC);

CREATE INDEX IF NOT EXISTS idx_evaluations_propuesta
  ON public.evaluations (id_propuesta, fecha_evaluacion DESC);

-- ---------------------------------------------------------------------
-- 5. Notificaciones: historial por usuario y marcado masivo de lectura
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_fecha
  ON public.notificaciones (id_usuario, fecha_creacion DESC);

CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_no_leidas
  ON public.notificaciones (id_usuario)
  WHERE leida = false;

-- ---------------------------------------------------------------------
-- 6. Convocatorias: etapas y documentos oficiales de la pantalla 05
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_convocatoria_etapas_convocatoria
  ON public.convocatoria_etapas (id_convocatoria, orden);

CREATE INDEX IF NOT EXISTS idx_convocatoria_documentos_convocatoria
  ON public.convocatoria_documentos (id_convocatoria, activo, orden);

-- ---------------------------------------------------------------------
-- 7. Usuarios: login y resolución de responsables por correo
--    La consulta usa lower(btrim(correo)) para tolerar espacios y mayúsculas.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_usuarios_correo_lower_trim
  ON public.usuarios (lower(btrim(correo)));

-- ---------------------------------------------------------------------
-- 8. Estadísticas: refresca el planificador tras crear los índices
-- ---------------------------------------------------------------------
ANALYZE public.propuestas;
ANALYZE public.research_team;
ANALYZE public.proposal_objectives;
ANALYZE public.academic_product_commitments;
ANALYZE public.action_plans;
ANALYZE public.risks;
ANALYZE public.proposal_ethics_declarations;
ANALYZE public.external_collaborators;
ANALYZE public.council_endorsements;
ANALYZE public.proposal_documents;
ANALYZE public.proposal_state_history;
ANALYZE public.evaluations;
ANALYZE public.notificaciones;
ANALYZE public.convocatoria_etapas;
ANALYZE public.convocatoria_documentos;
ANALYZE public.usuarios;
