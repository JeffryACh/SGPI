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
