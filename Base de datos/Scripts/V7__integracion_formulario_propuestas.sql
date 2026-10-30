-- =====================================================================
-- MIGRACIÓN V7: AJUSTES DE CATÁLOGO PARA EL FORMULARIO INTEGRADO
-- Sistema de Gestión de Propuestas de Investigación (SGPI - TEC)
-- =====================================================================
-- Esta migración es idempotente y alinea los rubros presupuestarios con
-- las reglas y los conceptos utilizados por el asistente de propuestas.

-- El rubro de becas es un bien no duradero sujeto a la regla de monto mínimo.
INSERT INTO public.rubros_presupuesto (
  nombre_rubro,
  codigo,
  es_bien_duradero,
  es_beca
)
SELECT
  'Becas estudiante asistente especial',
  NULL,
  false,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.rubros_presupuesto
  WHERE lower(trim(nombre_rubro)) = lower(trim('Becas estudiante asistente especial'))
);

-- El equipamiento especializado es un bien duradero y solo puede comprarse en el Año 1.
UPDATE public.rubros_presupuesto
SET es_bien_duradero = true
WHERE lower(nombre_rubro) LIKE '%equip%'
  AND es_bien_duradero IS DISTINCT FROM true;
