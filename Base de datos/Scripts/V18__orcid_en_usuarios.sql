-- =========================================================================================
-- V18 · PERSISTENCIA DEL ORCID EN EL PERFIL INSTITUCIONAL
-- =========================================================================================
-- Fecha: 2026-11-12
-- Motivo: hasta la V17 el ORCID de un investigador institucional se conservaba solo en
--          memoria del servidor (diccionarios _ORCID_PERFIL_* de backend/app/routers/auth.py),
--          por lo que se perdía en cada reinicio del backend y no era posible registrar el
--          ORCID de una cuenta recién creada desde el modal de equipo (Pantalla 09).
-- Alcance: cambio aditivo e idempotente. No modifica ni elimina datos existentes.
-- =========================================================================================

-- [Línea clave]: Agrega la columna que almacena el ORCID validado de cada perfil institucional.
--                Es nullable porque las cuentas históricas todavía no tienen ORCID registrado.
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS identificacion_orcid character varying;

-- [Línea clave]: Índice único parcial que garantiza la unicidad del ORCID entre investigadores
--                activos del directorio (solo aplica a las filas que ya tienen ORCID).
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_identificacion_orcid
  ON public.usuarios (identificacion_orcid)
  WHERE identificacion_orcid IS NOT NULL;

-- -----------------------------------------------------------------------------------------
-- Verificación
-- -----------------------------------------------------------------------------------------
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'usuarios'
-- ORDER BY ordinal_position;
--
-- SELECT id_usuario, correo, identificacion_orcid
-- FROM public.usuarios
-- WHERE identificacion_orcid IS NOT NULL;
--
-- Notas para el despliegue:
--   1. Ejecutar este script en el Supabase SQL Editor (aplicación manual, sin Flyway).
--   2. Reiniciar el backend después de aplicarlo: 'backend/app/routers/auth.py' cachea la
--      verificación de la columna al iniciar el proceso.
--   3. Los usuarios existentes conservan su ORCID en el catálogo en memoria; el endpoint
--      'PATCH /auth/usuarios/{id_usuario}/orcid' persiste el valor en la nueva columna.
-- =========================================================================================
