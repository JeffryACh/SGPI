-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V13__administracion_rubricas_roles.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Habilitar la administración real de las pantallas 31 y 32 del SGPI:
--      orden persistente de roles institucionales y versionado de rúbricas.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Tabla 'roles' (catálogo de roles) y 'rubric_sections'/'rubric_criteria'
--               (rúbrica ponderada del Comité Técnico).
--      2.2.2. A dónde envía datos:
--             - Agrega 'roles.orden' (orden operativo de los roles), 'version' a las
--               secciones y criterios de rúbrica, y la tabla 'rubric_versions' que
--               registra las versiones publicadas con su estado activo.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GRESOSO MODO?:
--      Agrega de forma idempotente las columnas y la tabla de versionado, y siembra
--      la versión oficial '2027' de la rúbrica como versión activa.
--
-- 2.4. CONSUMIDORES:
--      - backend/app/routers/admin.py (CRUD administrativo de roles y rúbricas).
--      - backend/app/routers/comite.py (filtra la rúbrica por la versión activa).
-- ============================================================================

-- ---------------------------------------------------------------------
-- 1. ORDEN OPERATIVO DE LOS ROLES INSTITUCIONALES
-- ---------------------------------------------------------------------
-- [Línea clave]: ¿Por qué soy importante? El orden de los roles define la ruta operativa
-- del SGPI (proponente, revisiones, aval, dictamen y resolución) y se muestra en la
-- pantalla 32. ¿Para qué? Persistir en PostgreSQL el orden que antes solo vivía en el
-- navegador. ¿Dónde me usan? En backend/app/routers/admin.py.
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS orden integer NOT NULL DEFAULT 0;

-- [Línea clave]: Asigna el orden inicial conservando el identificador del rol.
UPDATE public.roles
   SET orden = id_rol
 WHERE orden = 0;

-- ---------------------------------------------------------------------
-- 2. VERSIONADO DE LA RÚBRICA
-- ---------------------------------------------------------------------
-- [Línea clave]: ¿Por qué soy importante? La rúbrica evoluciona por versión normativa.
-- ¿Para qué? Permitir mantener varias versiones coexistiendo y evaluar siempre con la
-- versión vigente. ¿Dónde me usan? En admin.py y comite.py.
ALTER TABLE public.rubric_sections
  ADD COLUMN IF NOT EXISTS version character varying NOT NULL DEFAULT '2027';

ALTER TABLE public.rubric_criteria
  ADD COLUMN IF NOT EXISTS version character varying NOT NULL DEFAULT '2027';

CREATE TABLE IF NOT EXISTS public.rubric_versions (
  id_version integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  version character varying NOT NULL,
  descripcion character varying,
  fecha_publicacion date NOT NULL DEFAULT CURRENT_DATE,
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT rubric_versions_pkey PRIMARY KEY (id_version),
  CONSTRAINT rubric_versions_version_key UNIQUE (version)
);

-- [Línea clave]: Siembra la versión oficial vigente de la rúbrica del Comité Técnico.
INSERT INTO public.rubric_versions (version, descripcion, fecha_publicacion, activo)
VALUES (
  '2027',
  'Rúbrica ponderada oficial del Comité Técnico (Acuerdo CIE-237-2026)',
  DATE '2026-07-28',
  true
)
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. VERIFICACIÓN RÁPEDA (opcional para el administrador)
-- ---------------------------------------------------------------------
-- SELECT version, descripcion, activo FROM public.rubric_versions ORDER BY id_version;
-- SELECT id_rol, nombre_rol, orden FROM public.roles ORDER BY orden;
-- SELECT version, count(*) FROM public.rubric_sections GROUP BY version;
