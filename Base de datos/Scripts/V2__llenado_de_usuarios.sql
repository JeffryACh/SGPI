-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V2__llenado_de_usuarios.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Sembrar los usuarios iniciales, roles institucionales y asignaciones
--      rol-usuario para pruebas, verificación y demostración del SGPI.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Especificación de roles institucionales y perfiles piloto de prueba.
--      2.2.2. A dónde envía datos / Qué entidades modifica:
--             - Inserta registros en las tablas maestras 'roles', 'escuelas',
--               'usuarios' y 'user_roles'.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
--      Inserta los 6 roles de la convocatoria, 2 escuelas piloto y 8 usuarios con
--      contraseña predeterminada sha256('demostracion') cubriendo todos los niveles
--      evaluadores (Investigador, Vinculación, Comité Técnico, Consejo, Dirección, CIE).
-- ============================================================================

-- ---------------------------------------------------------------
-- Dependencias mínimas (usuarios/user_roles las exigen por FK)
-- ---------------------------------------------------------------
-- [Línea clave]: ¿Por qué soy importante? Inserta los 6 roles oficiales del SGPI. ¿Para qué? Permitir el control de acceso basado en roles (RBAC). ¿Dónde me usan? En routers auth.py, vinculacion.py, comite.py y en frontend.
INSERT INTO public.roles (nombre_rol) VALUES
  ('Investigador'),
  ('Vinculación'),
  ('Comité Técnico'),
  ('Consejo de Escuela'),
  ('Dirección de Investigación'),
  ('CIE');

INSERT INTO public.escuelas (nombre, siglas) VALUES
  ('Escuela de Ingeniería Ambiental',  'IAMB'),
  ('Escuela de Ingeniería Electrónica', 'IELE');

-- ---------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------
INSERT INTO public.usuarios
  (id_escuela, nombre, lastname, second_lastname, correo, password_hash, estado_activo)
VALUES
  -- Investigadores
  ((SELECT id_escuela FROM public.escuelas WHERE siglas = 'IAMB'),
   -- [Línea clave]: ¿Por qué soy importante? Crea a Laura Méndez como Investigadora líder. ¿Para qué? Servir como usuaria principal de demostración para el recorrido de formulación. ¿Dónde me usan? En login institucional y creación de propuestas.
   'Laura',   'Méndez',   'Quesada',  'laura.mendez@example.com',
   encode(sha256('demostracion'::bytea), 'hex'), true),

  ((SELECT id_escuela FROM public.escuelas WHERE siglas = 'IELE'),
   'Andrés',  'Rojas',    'Calderón', 'andres.rojas@example.com',
   encode(sha256('demostracion'::bytea), 'hex'), true),

  ((SELECT id_escuela FROM public.escuelas WHERE siglas = 'IAMB'),
   'Sofía',   'Vega',     'Araya',    'sofia.vega@example.com',
   encode(sha256('demostracion'::bytea), 'hex'), true),

  -- Personal administrativo / evaluadores (sin escuela)
  (NULL,
   'Mariana', 'Solís',    'Jiménez',  'mariana.solis@example.com',
   encode(sha256('demostracion'::bytea), 'hex'), true),

  (NULL,
   'Gabriel', 'Sánchez',  'Mora',     'gabriel.sanchez@example.com',
   encode(sha256('demostracion'::bytea), 'hex'), true),

  ((SELECT id_escuela FROM public.escuelas WHERE siglas = 'IAMB'),
   'Patricia','Vargas',   'Solano',   'patricia.vargas@example.com',
   encode(sha256('demostracion'::bytea), 'hex'), true),

  (NULL,
   'Elena',   'Chacón',   'Brenes',   'elena.chacon@example.com',
   encode(sha256('demostracion'::bytea), 'hex'), true),

  (NULL,
   'Ricardo', 'Mora',     'Villalobos','ricardo.mora@example.com',
   encode(sha256('demostracion'::bytea), 'hex'), true),

  -- Usuario inactivo, para probar que el login lo rechaza
  ((SELECT id_escuela FROM public.escuelas WHERE siglas = 'IELE'),
   'Usuario', 'Inactivo', 'Prueba',   'inactivo@example.com',
   encode(sha256('demostracion'::bytea), 'hex'), false);

-- ---------------------------------------------------------------
-- Roles de cada usuario
-- ---------------------------------------------------------------
INSERT INTO public.user_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol
FROM (VALUES
  ('laura.mendez@example.com',     'Investigador'),
  ('andres.rojas@example.com',     'Investigador'),
  ('sofia.vega@example.com',       'Investigador'),
  ('mariana.solis@example.com',    'Vinculación'),
  ('gabriel.sanchez@example.com',  'Comité Técnico'),
  ('patricia.vargas@example.com',  'Consejo de Escuela'),
  ('elena.chacon@example.com',     'Dirección de Investigación'),
  ('ricardo.mora@example.com',     'CIE'),
  ('inactivo@example.com',         'Investigador')
) AS m(correo, nombre_rol)
JOIN public.usuarios u ON u.correo = m.correo
JOIN public.roles    r ON r.nombre_rol = m.nombre_rol;