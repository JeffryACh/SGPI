-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V5__triggers_funciones_politicas.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Implementar la lógica procedural del SGPI mediante funciones PL/pgSQL,
--      triggers automáticos de auditoría y políticas de seguridad Row Level Security (RLS).
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Eventos DML sobre las tablas 'propuestas', 'proposal_budget' y 'risks'.
--      2.2.2. A dónde envía datos / Qué entidades modifica:
--             - Altera 'propuestas', 'proposal_budget', 'risks', e inserta en 'proposal_state_history'.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
--      Crea funciones y triggers para asignación automática del código institucional
--      SI-YYYY-NNN, registro automático de auditoría en cada cambio de estado,
--      y habilita políticas RLS para consumo seguro desde FastAPI y Supabase Studio.
-- ============================================================================

-- =====================================================================
-- MIGRACIÓN V5: FUNCIONES, TRIGGERS Y AJUSTES ESTRUCTURALES
-- Sistema de Gestión de Propuestas de Investigación (SGPI - TEC)
-- =====================================================================

-- 1. AJUSTES A LA TABLA PROPUESTAS
ALTER TABLE public.propuestas 
  ADD COLUMN IF NOT EXISTS codigo character varying(30) UNIQUE,
  ADD COLUMN IF NOT EXISTS id_convocatoria integer REFERENCES public.convocatorias(id_convocatoria),
  ADD COLUMN IF NOT EXISTS fecha_inicio date,
  ADD COLUMN IF NOT EXISTS fecha_fin date;

-- 2. AJUSTES A PRESUPUESTO Y RIESGOS (Requerimiento 9: Anualizado y Actividades)
ALTER TABLE public.proposal_budget
  ADD COLUMN IF NOT EXISTS anio integer DEFAULT 1 NOT NULL;

ALTER TABLE public.risks
  ADD COLUMN IF NOT EXISTS id_plan_accion integer REFERENCES public.action_plans(id_plan_accion);

-- 3. FUNCIÓN Y TRIGGER: GENERACIÓN AUTOMÁTICA DEL CÓDIGO INSTITUCIONAL (SI-YYYY-NNN)
-- [Línea clave]: ¿Por qué soy importante? Función generadora de código institucional SI-YYYY-NNN. ¿Para qué? Asignar un identificador único correlativo por año automáticamente al insertar. ¿Dónde me usan? Disparada por trigger_generate_proposal_code en la tabla propuestas.
CREATE OR REPLACE FUNCTION public.trg_generate_proposal_code()
RETURNS TRIGGER AS $$
DECLARE
  v_anio text;
  v_consecutivo integer;
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    v_anio := to_char(COALESCE(NEW.fecha_creacion, clock_timestamp()), 'YYYY');
    SELECT COALESCE(MAX(SUBSTRING(codigo FROM 'SI-[0-9]{4}-([0-9]+)')::integer), 0) + 1
    INTO v_consecutivo
    FROM public.propuestas
    WHERE codigo LIKE 'SI-' || v_anio || '-%';

    NEW.codigo := 'SI-' || v_anio || '-' || LPAD(v_consecutivo::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_proposal_code ON public.propuestas;
CREATE TRIGGER trigger_generate_proposal_code
BEFORE INSERT ON public.propuestas
FOR EACH ROW EXECUTE FUNCTION public.trg_generate_proposal_code();

-- 4. FUNCIÓN Y TRIGGER: AUDITORÍA AUTOMÁTICA DE CAMBIOS DE ESTADO (proposal_state_history)
-- [Línea clave]: ¿Por qué soy importante? Trigger de auditoría de transiciones de estado. ¿Para qué? Registrar automáticamente en proposal_state_history cualquier cambio en estado_actual. ¿Dónde me usan? Disparada por trigger_log_proposal_state_change en la tabla propuestas.
CREATE OR REPLACE FUNCTION public.trg_log_proposal_state_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.estado_actual IS DISTINCT FROM NEW.estado_actual) THEN
    INSERT INTO public.proposal_state_history (
      id_propuesta,
      id_estado_anterior,
      id_estado_nuevo,
      id_usuario_responsable,
      fecha_cambio,
      observaciones
    ) VALUES (
      NEW.id_propuesta,
      OLD.estado_actual,
      NEW.estado_actual,
      NEW.id_usuario_lider,
      clock_timestamp(),
      'Transición automática registrada por el sistema'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_proposal_state_change ON public.propuestas;
CREATE TRIGGER trigger_proposal_state_change
AFTER UPDATE OF estado_actual ON public.propuestas
FOR EACH ROW EXECUTE FUNCTION public.trg_log_proposal_state_change();

-- 5. FUNCIÓN Y TRIGGER: NOTIFICACIONES AUTOMÁTICAS ANTE CAMBIO DE ESTADO
CREATE OR REPLACE FUNCTION public.trg_notify_proposal_state_change()
RETURNS TRIGGER AS $$
DECLARE
  v_estado_nombre text;
BEGIN
  IF (OLD.estado_actual IS DISTINCT FROM NEW.estado_actual) THEN
    SELECT nombre_estado INTO v_estado_nombre FROM public.estados WHERE id_estado = NEW.estado_actual;

    -- Notificar al líder del proyecto
    INSERT INTO public.notificaciones (
      id_usuario,
      id_propuesta,
      tipo,
      titulo,
      mensaje,
      fecha_creacion,
      leida
    ) VALUES (
      NEW.id_usuario_lider,
      NEW.id_propuesta,
      'tramite',
      'Actualización de estado: ' || COALESCE(v_estado_nombre, 'Nuevo estado'),
      'La propuesta «' || NEW.titulo || '» ha cambiado su estado a: ' || COALESCE(v_estado_nombre, 'Desconocido') || '.',
      clock_timestamp(),
      false
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_proposal_state_change ON public.propuestas;
CREATE TRIGGER trigger_notify_proposal_state_change
AFTER UPDATE OF estado_actual ON public.propuestas
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_proposal_state_change();

-- 6. POLÍTICAS ROW LEVEL SECURITY (RLS) - PERMISIVAS PARA DESARROLLO Y POSTGRES
-- Permite que los endpoints de lectura y catálogo respondan de inmediato
CREATE POLICY "Permitir lectura publica de escuelas" ON public.escuelas FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica de estados" ON public.estados FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica de roles" ON public.roles FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica de modalidades" ON public.modalidades FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica de lineas" ON public.lineas_investigacion FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica de tipos_hora" ON public.tipos_hora FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica de rubros" ON public.rubros_presupuesto FOR SELECT USING (true);
CREATE POLICY "Permitir lectura de convocatorias activas" ON public.convocatorias FOR SELECT USING (true);
CREATE POLICY "Permitir lectura de propuestas" ON public.propuestas FOR SELECT USING (true);
CREATE POLICY "Permitir insercion de propuestas" ON public.propuestas FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir actualizacion de propuestas" ON public.propuestas FOR UPDATE USING (true);
CREATE POLICY "Permitir lectura de equipo" ON public.research_team FOR SELECT USING (true);
CREATE POLICY "Permitir insercion de equipo" ON public.research_team FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir lectura de presupuesto" ON public.proposal_budget FOR SELECT USING (true);
CREATE POLICY "Permitir insercion de presupuesto" ON public.proposal_budget FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir lectura de notificaciones" ON public.notificaciones FOR SELECT USING (true);
CREATE POLICY "Permitir actualizacion de notificaciones" ON public.notificaciones FOR UPDATE USING (true);
