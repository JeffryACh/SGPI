-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V7__integracion_formulario_propuestas.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Alinear los catálogos presupuestarios con las reglas institucionales de
--      la Convocatoria VIE 2027 para la formulación integral de propuestas.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Normativa oficial VIE 2027 (bienes duraderos y becas de asistencia especial).
--      2.2.2. A dónde envía datos / Qué entidades modifica:
--             - Actualiza la tabla 'rubros_presupuesto'.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
--      Inserta de forma idempotente el rubro de Becas estudiante asistente especial
--      con bandera es_beca=true y marca los rubros de equipamiento especializado con
--      es_bien_duradero=true para auditar la restricción de compra exclusiva en Año 1.
-- ============================================================================

-- =====================================================================
-- MIGRACIÓN V7: AJUSTES DE CATÁLOGO PARA EL FORMULARIO INTEGRADO
-- Sistema de Gestión de Propuestas de Investigación (SGPI - TEC)
-- =====================================================================
-- Esta migración es idempotente y alinea los rubros presupuestarios con
-- las reglas y los conceptos utilizados por el asistente de propuestas.

-- El rubro de becas es un bien no duradero sujeto a la regla de monto mínimo.
-- [Línea clave]: ¿Por qué soy importante? Garantiza la existencia del rubro de becas con es_beca=true. ¿Para qué? Permitir la auditoría de inclusión de beca estudiantil obligatoria en el backend e IA. ¿Dónde me usan? En backend/app/routers/ia.py y propuestas.py.
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
