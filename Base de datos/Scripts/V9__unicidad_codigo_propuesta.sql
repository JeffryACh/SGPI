-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V9__unicidad_codigo_propuesta.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Implementar la generación segura y concurrente del código institucional de
--      propuesta mediante un bloqueo consultivo transaccional (advisory lock).
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Año de 'convocatorias' o fecha de creación, y correlativo máximo de 'propuestas'.
--      2.2.2. A dónde envía datos / Qué entidades modifica:
--             - Reemplaza la función fn_asignar_codigo_propuesta y su trigger en 'propuestas'.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
--      Adquiere un bloqueo 'pg_advisory_xact_lock' por año antes de calcular el consecutivo,
--      garantizando códigos consecutivos 'SI-YYYY-NNN' libres de colisiones entre inserciones concurrentes.
-- ============================================================================

-- =====================================================================
-- MIGRACIÓN V9: GENERACIÓN SEGURA DEL CÓDIGO DE PROPUESTA
-- Sistema de Gestión de Propuestas de Investigación (SGPI - TEC)
-- =====================================================================
-- Elimina el trigger duplicado y reemplaza la generación basada en el ID
-- por un consecutivo por año protegido con un lock transaccional.

DROP TRIGGER IF EXISTS trigger_generate_proposal_code ON public.propuestas;
DROP FUNCTION IF EXISTS public.trg_generate_proposal_code();

CREATE OR REPLACE FUNCTION public.fn_asignar_codigo_propuesta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_anio text;
  v_consecutivo integer;
BEGIN
  IF NEW.codigo IS NULL OR btrim(NEW.codigo) = '' THEN
    SELECT to_char(COALESCE(c.fecha_inicio_ejecucion, NEW.fecha_creacion, clock_timestamp()), 'YYYY')
      INTO v_anio
      FROM public.convocatorias c
      WHERE c.id_convocatoria = NEW.id_convocatoria;

    v_anio := COALESCE(v_anio, to_char(COALESCE(NEW.fecha_creacion, clock_timestamp()), 'YYYY'));

    -- [Línea clave]: ¿Por qué soy importante? Adquiere un lock consultivo transaccional pg_advisory_xact_lock. ¿Para qué? Evitar que dos transacciones concurrentes generen el mismo código correlativo de propuesta. ¿Dónde me usan? Dentro de la función fn_asignar_codigo_propuesta() antes de calcular el consecutivo.
    PERFORM pg_advisory_xact_lock(hashtext('sgpi_codigo_propuesta_' || v_anio));

    SELECT COALESCE(MAX(SUBSTRING(codigo FROM '^SI-[0-9]{4}-([0-9]+)$')::integer), 0) + 1
      INTO v_consecutivo
      FROM public.propuestas
      WHERE codigo LIKE 'SI-' || v_anio || '-%';

    NEW.codigo := 'SI-' || v_anio || '-' || lpad(v_consecutivo::text, 3, '0');
  END IF;

  RETURN NEW;
END;
$$;
