-- ---------------------------------------------------------------
-- Dependencias mínimas (usuarios/user_roles las exigen por FK)
-- ---------------------------------------------------------------
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