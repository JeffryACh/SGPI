-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V15__cie_resoluciones.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Dar soporte persistente a la resolución del Comité de Ética en Investigación
--      (CIE) de las pantallas 27 y 28: la tabla 'cie_resolution_evaluations' solo
--      guardaba el tipo de resolución y no tenía dónde registrar el acuerdo tomado.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Tabla 'cie_resolution_evaluations' (enlace evaluación → resolución) y el
--               catálogo 'resoluciones_cie' con los cuatro tipos de resolución vigentes.
--      2.2.2. A dónde envía datos:
--             - Agrega a 'cie_resolution_evaluations' los datos del acuerdo: sesión,
--               artículo, fecha, fundamentación, condiciones de aceptación, el acuerdo
--               firmado en Storage y el usuario responsable del registro.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GRESOSO MODO?:
--      Agrega de forma idempotente las columnas faltantes de la resolución del CIE y
--      el índice que permite localizar la resolución vigente de cada propuesta.
--
-- 2.4. CONSUMIDORES:
--      - backend/app/routers/cie.py (bandeja, detalle y registro de la resolución).
--      - backend/app/routers/propuestas.py (expone 'resolucion_cie' en el expediente).
-- ============================================================================

-- ---------------------------------------------------------------------
-- 1. DATOS DEL ACUERDO DEL CIE
-- ---------------------------------------------------------------------
-- [Línea clave]: ¿Por qué soy importante? La resolución del CIE es un acto colegiado
-- formal: sesión, artículo, fecha, fundamentación y condiciones. ¿Para qué? Guardar
-- esa evidencia en PostgreSQL en vez de dejarla solo en el navegador. ¿Dónde me usan?
-- En backend/app/routers/cie.py.

ALTER TABLE public.cie_resolution_evaluations
  ADD COLUMN IF NOT EXISTS numero_sesion      character varying,
  ADD COLUMN IF NOT EXISTS articulo           character varying,
  ADD COLUMN IF NOT EXISTS fecha_resolucion   date,
  ADD COLUMN IF NOT EXISTS fundamentacion      text,
  ADD COLUMN IF NOT EXISTS condiciones        text,
  ADD COLUMN IF NOT EXISTS id_documento       integer REFERENCES public.proposal_documents(id_documento),
  ADD COLUMN IF NOT EXISTS id_usuario_registro integer REFERENCES public.usuarios(id_usuario),
  ADD COLUMN IF NOT EXISTS fecha_registro     timestamp with time zone DEFAULT now();

-- [Línea clave]: Un índice por propuesta permite listar el historial de resoluciones
-- (acuerdo inicial y condiciones posteriores) sin recorrer toda la tabla.
CREATE INDEX IF NOT EXISTS idx_cie_resolution_evaluations_propuesta
  ON public.cie_resolution_evaluations (id_evaluacion);

-- ---------------------------------------------------------------------
-- 2. CATÁLOGO DE RESOLUCIONES DEL CIE
-- ---------------------------------------------------------------------
-- [Línea clave]: Siembra idempotente de los tipos de resolución institucional para
-- que el formulario de la pantalla 27 nunca quede sin opciones válidas.
INSERT INTO public.resoluciones_cie (id_resolucion, nombre_resolucion)
VALUES
  (1, 'Aprobado sin observaciones'),
  (2, 'Aprobado condicionado a enmiendas menores'),
  (3, 'Rechazado por conflicto bioético no subsanable'),
  (4, 'No aplica revisión ética (Exento)')
ON CONFLICT (id_resolucion) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. VERIFICACIÓN RÁPIDA (opcional para el administrador)
-- ---------------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'cie_resolution_evaluations' ORDER BY ordinal_position;
-- SELECT * FROM public.resoluciones_cie ORDER BY id_resolucion;
