-- =====================================================================
-- MIGRACIÓN V12: RÚBRICA PONDERADA DEL COMITÉ TÉCNICO
-- Sistema de Gestión de Propuestas de Investigación (SGPI - TEC)
-- =====================================================================
-- Objetivo:
--   1. Cargar en PostgreSQL la rúbrica oficial de evaluación técnica que
--      hoy vive hardcodeada en frontend/js/app.js (criterionGroups).
--   2. Completar la tabla technical_committee_evaluations con la decisión,
--      la justificación de criterios obligatorios y la marca de bloqueo.
--   3. Permitir que POST /propuestas/comite/{id} calcule y valide el
--      puntaje en el servidor sin depender del navegador.
--
-- Escala de niveles: 0 (Deficiente), 6 (Regular), 8 (Bueno), 10 (Excelente).
-- Regla: nota >= 70 y todo criterio obligatorio con nivel >= 8.
--
-- La migración es idempotente: puede ejecutarse más de una vez en el
-- SQL Editor de Supabase sin duplicar secciones, criterios ni columnas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SECCIONES DE LA RÚBRICA (8 secciones, 100% en total)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rubric_sections) THEN
    INSERT INTO public.rubric_sections (nombre_seccion, peso_porcentual, orden)
    VALUES
      ('Equipo',                15, 1),
      ('Fundamentación',        12, 2),
      ('Metodología',           15, 3),
      ('Plan de acción',        13, 4),
      ('Presupuesto',           10, 5),
      ('Riesgos',                8, 6),
      ('Ética y PI',            10, 7),
      ('Pertinencia e impacto', 17, 8);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. CRITERIOS POR SECCIÓN (23 criterios, pesos relativos suman 100)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rubric_criteria) THEN
    INSERT INTO public.rubric_criteria
      (id_seccion, nombre_criterio, peso_relativo, es_obligatorio, orden)
    SELECT
      s.id_seccion,
      v.nombre_criterio,
      v.peso_relativo,
      v.es_obligatorio,
      v.orden
    FROM (VALUES
      -- Equipo (15)
      ('Equipo', 'Composición disciplinaria',             3, false, 1),
      ('Equipo', 'Experiencia',                           3, false, 2),
      ('Equipo', 'Articulación del equipo',               3, false, 3),
      ('Equipo', 'Vinculación externa',                   2, false, 4),
      ('Equipo', 'Trayectoria de coordinación',           2, false, 5),
      ('Equipo', 'Participación estudiantil',             2, true,  6),
      -- Fundamentación (12)
      ('Fundamentación', 'Definición del problema',                4, false, 1),
      ('Fundamentación', 'Coherencia de objetivos',                4, false, 2),
      ('Fundamentación', 'Diagnóstico y vacío de conocimiento',    4, true,  3),
      -- Metodología (15)
      ('Metodología', 'Rigor del desarrollo',             8, true, 1),
      ('Metodología', 'Usuarios y validación',            7, true, 2),
      -- Plan de acción (13)
      ('Plan de acción', 'Claridad de actividades y responsables', 4, true, 1),
      ('Plan de acción', 'Giras y actividades académicas',         4, true, 2),
      ('Plan de acción', 'Trazabilidad y plazos',                  5, true, 3),
      -- Presupuesto (10)
      ('Presupuesto', 'Coherencia y topes',               4, true,  1),
      ('Presupuesto', 'Equipamiento en primer año',       4, true,  2),
      ('Presupuesto', 'Otros fondos',                     2, false, 3),
      -- Riesgos (8)
      ('Riesgos', 'Identificación por actividad',         4, true, 1),
      ('Riesgos', 'Viabilidad de mitigación',             4, true, 2),
      -- Ética y PI (10)
      ('Ética y PI', 'Declaración ética',                 4, true, 1),
      ('Ética y PI', 'Gestión de propiedad intelectual',  6, true, 2),
      -- Pertinencia e impacto (17)
      ('Pertinencia e impacto', 'Contribución e impacto', 10, false, 1),
      ('Pertinencia e impacto', 'Innovación',              7, false, 2)
    ) AS v(seccion, nombre_criterio, peso_relativo, es_obligatorio, orden)
    JOIN public.rubric_sections s ON s.nombre_seccion = v.seccion;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. COLUMNAS DE DECISIÓN EN technical_committee_evaluations
-- ---------------------------------------------------------------------
-- El puntaje ponderado puede tener decimales (ej. 87.5), por lo que se
-- amplía la columna original integer a numeric(5,1).
ALTER TABLE public.technical_committee_evaluations
  ALTER COLUMN puntaje TYPE numeric(5,1) USING puntaje::numeric(5,1);

ALTER TABLE public.technical_committee_evaluations
  ADD COLUMN IF NOT EXISTS decision character varying(20) NOT NULL DEFAULT 'favorable',
  ADD COLUMN IF NOT EXISTS justificacion text,
  ADD COLUMN IF NOT EXISTS tiene_bloqueo_obligatorio boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'technical_committee_evaluations_decision_check'
  ) THEN
    ALTER TABLE public.technical_committee_evaluations
      ADD CONSTRAINT technical_committee_evaluations_decision_check
      CHECK (decision IN ('favorable', 'observaciones', 'rechazo'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. VERIFICACIÓN RÁPIDA (opcional para el administrador)
-- ---------------------------------------------------------------------
-- SELECT s.nombre_seccion, s.peso_porcentual, count(c.id_criterio_rubrica) AS criterios
-- FROM public.rubric_sections s
-- LEFT JOIN public.rubric_criteria c ON c.id_seccion = s.id_seccion
-- GROUP BY s.id_seccion, s.nombre_seccion, s.peso_porcentual, s.orden
-- ORDER BY s.orden;
--
-- SELECT SUM(peso_relativo) AS total_pesos FROM public.rubric_criteria; -- debe dar 100
