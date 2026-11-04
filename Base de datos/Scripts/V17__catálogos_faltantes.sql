-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V17__catálogos_faltantes.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Crear las tablas catálogo que faltan en la base de datos y que actualmente
--      están hardcodeadas en el frontend. Estas tablas permitirán que los
--      administradores gestionen los valores desde la pantalla 32 y que el
--      frontend los consuma dinámicamente vía GET /catalogos.
--
-- 2.2. TABLAS A CREAR:
--      1. tipo_instrumento      - Para documentos de convocatoria (pantalla 31)
--      2. estado_convocatoria   - Para filtrar convocatorias (pantalla 04/05)
--      3. tipo_documento_propuesta - Para documentos de propuesta (pantalla 17)
--      4. tipo_informe          - Para informes de seguimiento (pantalla 20)
--      5. tipo_actividad_riesgo - Para matriz de riesgos (pantalla 14)
--      6. nivel_trl             - Para TRL 1-9 (pantalla 16)
--      7. rol_colaborador       - Para colaboradores externos (pantalla 09)
--
-- 2.3. RELACIONES CON OTROS MÓDULOS:
--      - Backend: Se agregarán a CATALOGOS_EDITABLES en admin.py
--      - Frontend: Se consumirán vía GET /catalogos en selects dinámicos
-- ============================================================================

-- ============================================================================
-- 1. TIPO DE INSTRUMENTO (Documentos de convocatoria)
-- ============================================================================
-- [Línea clave]: ¿Por qué soy importante? Clasifica los instrumentos oficiales
-- de la convocatoria. Actualmente hardcodeado en admin (línea 2191).
-- ¿Para qué? Permitir al administrador crear/editar tipos de instrumento.
-- ¿Dónde me usan? En pantalla 31 (admin) y carga de documentos.
CREATE TABLE public.tipo_instrumento (
  id_tipo_instrumento integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_tipo_instrumento character varying NOT NULL,
  descripcion character varying,
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT tipo_instrumento_pkey PRIMARY KEY (id_tipo_instrumento),
  CONSTRAINT tipo_instrumento_nombre_unique UNIQUE (nombre_tipo_instrumento)
);

-- Siembra idempotente con los valores actuales del frontend
INSERT INTO public.tipo_instrumento (nombre_tipo_instrumento, descripcion, orden, activo) VALUES
  ('Disposiciones', 'Disposiciones legales y normativas de la convocatoria', 1, true),
  ('Rúbrica', 'Rúbrica de evaluación técnica', 2, true),
  ('Formulario', 'Formulario oficial de postulación', 3, true),
  ('Plantilla', 'Plantilla de documentos anexos', 4, true),
  ('Otro', 'Otros instrumentos no clasificados', 5, true)
ON CONFLICT (nombre_tipo_instrumento) DO NOTHING;

-- ============================================================================
-- 2. ESTADO DE CONVOCATORIA
-- ============================================================================
-- [Línea clave]: ¿Por qué soy importante? Permite filtrar convocatorias por estado.
-- Actualmente hardcodeado en frontend (línea 3665).
-- ¿Para qué? Filtrar convocatorias activas/cerradas/en formulación.
-- ¿Dónde me usan? Pantalla 04/05 (Convocatorias).
CREATE TABLE public.estado_convocatoria (
  id_estado_convocatoria integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_estado character varying NOT NULL,
  descripcion character varying,
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT estado_convocatoria_pkey PRIMARY KEY (id_estado_convocatoria),
  CONSTRAINT estado_convocatoria_nombre_unique UNIQUE (nombre_estado)
);

INSERT INTO public.estado_convocatoria (nombre_estado, descripcion, orden, activo) VALUES
  ('Abiertas para formulación', 'Convocatoria recibiendo propuestas', 1, true),
  ('En evaluación', 'Convocatoria en proceso de evaluación', 2, true),
  ('Cerradas', 'Convocatoria finalizada', 3, true),
  ('Todas', 'Ver todas las convocatorias sin filtro', 0, true)
ON CONFLICT (nombre_estado) DO NOTHING;

-- ============================================================================
-- 3. TIPO DE DOCUMENTO DE PROPUESTA
-- ============================================================================
-- [Línea clave]: ¿Por qué soy importante? Clasifica los documentos que adjunta
-- el investigador en su propuesta. Actualmente hardcodeado (línea 6941).
-- ¿Para qué? Organizar y validar documentos del expediente.
-- ¿Dónde me usan? Pantalla 17 (Documentos).
CREATE TABLE public.tipo_documento_propuesta (
  id_tipo_documento integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_tipo character varying NOT NULL,
  descripcion character varying,
  obligatorio boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT tipo_documento_propuesta_pkey PRIMARY KEY (id_tipo_documento),
  CONSTRAINT tipo_documento_propuesta_nombre_unique UNIQUE (nombre_tipo)
);

INSERT INTO public.tipo_documento_propuesta (nombre_tipo, descripcion, obligatorio, orden, activo) VALUES
  ('Formulario institucional', 'Formulario oficial de la convocatoria', true, 1, true),
  ('Plan de acción y riesgos', 'Plan de actividades y matriz de riesgos', true, 2, true),
  ('Presupuesto 2027–2028', 'Desglose presupuestario plurianual', true, 3, true),
  ('Fundamentación', 'Documento de fundamentación técnica', true, 4, true),
  ('Carta de compromiso', 'Carta de compromiso de colaboradores', false, 5, true),
  ('Otro', 'Otros documentos de apoyo', false, 6, true)
ON CONFLICT (nombre_tipo) DO NOTHING;

-- ============================================================================
-- 4. TIPO DE INFORME
-- ============================================================================
-- [Línea clave]: ¿Por qué soy importante? Clasifica los informes de seguimiento
-- que presenta el investigador durante la ejecución. Hardcodeado (línea 7244).
-- ¿Para qué? Registrar y filtrar informes por tipo.
-- ¿Dónde me usan? Pantalla 20 (Seguimiento) - modal "Informe de seguimiento".
CREATE TABLE public.tipo_informe (
  id_tipo_informe integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_tipo character varying NOT NULL,
  descripcion character varying,
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT tipo_informe_pkey PRIMARY KEY (id_tipo_informe),
  CONSTRAINT tipo_informe_nombre_unique UNIQUE (nombre_tipo)
);

INSERT INTO public.tipo_informe (nombre_tipo, descripcion, orden, activo) VALUES
  ('Informe semestral', 'Informe de avance cada 6 meses', 1, true),
  ('Informe anual', 'Informe de avance anual', 2, true),
  ('Informe final', 'Informe de cierre del proyecto', 3, true)
ON CONFLICT (nombre_tipo) DO NOTHING;

-- ============================================================================
-- 5. TIPO DE ACTIVIDAD DE RIESGO
-- ============================================================================
-- [Línea clave]: ¿Por qué soy importante? Clasifica las actividades en la
-- matriz de riesgos. Actualmente hardcodeado (línea 6798).
-- ¿Para qué? Estandarizar actividades en la matriz de riesgos.
-- ¿Dónde me usan? Pantalla 14 (Gestión de riesgos).
CREATE TABLE public.tipo_actividad_riesgo (
  id_tipo_actividad_riesgo integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_tipo character varying NOT NULL,
  descripcion character varying,
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT tipo_actividad_riesgo_pkey PRIMARY KEY (id_tipo_actividad_riesgo),
  CONSTRAINT tipo_actividad_riesgo_nombre_unique UNIQUE (nombre_tipo)
);

INSERT INTO public.tipo_actividad_riesgo (nombre_tipo, descripcion, orden, activo) VALUES
  ('Definir requerimientos', 'Actividades de análisis y definición de requerimientos', 1, true),
  ('Integrar y calibrar', 'Actividades de integración y calibración de prototipos', 2, true),
  ('Validar en campo', 'Actividades de validación y pruebas en entorno real', 3, true),
  ('Evaluar y documentar', 'Actividades de evaluación final y documentación', 4, true)
ON CONFLICT (nombre_tipo) DO NOTHING;

-- ============================================================================
-- 6. NIVEL TRL (Technology Readiness Level)
-- ============================================================================
-- [Línea clave]: ¿Por qué soy importante? Estandariza los niveles TRL 1-9
-- según norma ISO/NASA. Actualmente hardcodeado (línea 4587).
-- ¿Para qué? Seleccionar TRL actual y esperado en pantalla 16.
-- ¿Dónde me usan? Pantalla 16 (Información complementaria).
CREATE TABLE public.nivel_trl (
  id_nivel_trl integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nivel integer NOT NULL,
  nombre character varying NOT NULL,
  descripcion character varying,
  activo boolean NOT NULL DEFAULT true,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT nivel_trl_pkey PRIMARY KEY (id_nivel_trl),
  CONSTRAINT nivel_trl_nivel_unique UNIQUE (nivel)
);

INSERT INTO public.nivel_trl (nivel, nombre, descripcion, activo) VALUES
  (1, 'TRL 1 - Principios básicos observados', 'Investigación básica; principios observados y reportados', true),
  (2, 'TRL 2 - Concepto tecnológico formulado', 'Aplicación práctica inventada; investigación aplicada iniciada', true),
  (3, 'TRL 3 - Prueba de concepto experimental', 'Validación analítica y experimental de función/característica crítica', true),
  (4, 'TRL 4 - Validación en laboratorio', 'Componente/sistema validado en entorno de laboratorio', true),
  (5, 'TRL 5 - Validación en entorno relevante', 'Componente/sistema validado en entorno relevante (simulado)', true),
  (6, 'TRL 6 - Demostración en entorno relevante', 'Prototipo demostrado en entorno relevante (espacio/terreno)', true),
  (7, 'TRL 7 - Prototipo en entorno operacional', 'Prototipo cercano al sistema final demostrado en entorno operacional', true),
  (8, 'TRL 8 - Sistema completo y calificado', 'Sistema completo calificado mediante pruebas y demostración', true),
  (9, 'TRL 9 - Sistema probado en operación real', 'Sistema real probado en entorno operacional real (misión real)', true)
ON CONFLICT (nivel) DO NOTHING;

-- ============================================================================
-- 7. ROL DE COLABORADOR EXTERNO
-- ============================================================================
-- [Línea clave]: ¿Por qué soy importante? Define los roles posibles para
-- colaboradores externos en el equipo. Hardcodeado (línea 6740).
-- ¿Para qué? Clasificar la participación externa en el equipo investigador.
-- ¿Dónde me usan? Pantalla 09 (Equipo) - modal "Participante del equipo".
CREATE TABLE public.rol_colaborador (
  id_rol_colaborador integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_rol character varying NOT NULL,
  descripcion character varying,
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT rol_colaborador_pkey PRIMARY KEY (id_rol_colaborador),
  CONSTRAINT rol_colaborador_nombre_unique UNIQUE (nombre_rol)
);

INSERT INTO public.rol_colaborador (nombre_rol, descripcion, orden, activo) VALUES
  ('Colaboración externa', 'Persona externa que colabora sin vínculo institucional formal', 1, true),
  ('Investigador', 'Investigador vinculado a otra institución académica', 2, true),
  ('Asesor técnico', 'Experto que asesora técnicamente al equipo', 3, true),
  ('Estudiante de posgrado', 'Estudiante que realiza tesis/tesina asociada al proyecto', 4, true)
ON CONFLICT (nombre_rol) DO NOTHING;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
-- 1. Listar tablas creadas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'tipo_instrumento',
    'estado_convocatoria',
    'tipo_documento_propuesta',
    'tipo_informe',
    'tipo_actividad_riesgo',
    'nivel_trl',
    'rol_colaborador'
  )
ORDER BY table_name;

-- 2. Contar registros por tabla
SELECT 'tipo_instrumento' AS tabla, count(*) FROM tipo_instrumento
UNION ALL SELECT 'estado_convocatoria', count(*) FROM estado_convocatoria
UNION ALL SELECT 'tipo_documento_propuesta', count(*) FROM tipo_documento_propuesta
UNION ALL SELECT 'tipo_informe', count(*) FROM tipo_informe
UNION ALL SELECT 'tipo_actividad_riesgo', count(*) FROM tipo_actividad_riesgo
UNION ALL SELECT 'nivel_trl', count(*) FROM nivel_trl
UNION ALL SELECT 'rol_colaborador', count(*) FROM rol_colaborador;