-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V14__usuario_administrador_sistema.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Habilitar el acceso de la figura «Administrador del Sistema» a las pantallas
--      31 y 32, que junto con Dirección de Investigación y los Funcionarios VIE
--      administran convocatorias, cronogramas, rúbricas y catálogos maestros.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Tabla 'usuarios' y 'user_roles' con el catálogo de 'roles'.
--      2.2.2. A dónde envía datos:
--             - Registra la cuenta institucional de administración del sistema con la
--               contraseña de demostración usada por el resto de usuarios de prueba.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GRESOSO MODO?:
--      Inserta de forma idempotente el usuario «Administración del Sistema» con el
--      rol homónimo, para que la validación por rol del router /admin sea verificable.
-- ============================================================================

-- [Línea clave]: ¿Por qué soy importante? La autorización administrativa exige el rol
-- 'Administrador del Sistema'. ¿Para qué? Comprobar ese camino de acceso en la
-- validación visual. ¿Dónde me usan? En backend/app/routers/admin.py.
INSERT INTO public.usuarios
  (id_escuela, nombre, lastname, second_lastname, correo, password_hash, estado_activo)
SELECT
  NULL,
  'Administración',
  'del Sistema',
  'SGPI',
  'administrador@example.com',
  encode(sha256('demostracion'::bytea), 'hex'),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.usuarios WHERE correo = 'administrador@example.com'
);

-- [Línea clave]: Asigna el rol administrativo al usuario recién creado.
INSERT INTO public.user_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol
FROM public.usuarios u
CROSS JOIN public.roles r
WHERE u.correo = 'administrador@example.com'
  AND r.nombre_rol = 'Administrador del Sistema'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.id_usuario = u.id_usuario AND ur.id_rol = r.id_rol
  );

-- ---------------------------------------------------------------------
-- VERIFICACIÓN RÁPIDA (opcional para el administrador)
-- ---------------------------------------------------------------------
-- SELECT u.id_usuario, u.correo, r.nombre_rol
-- FROM usuarios u JOIN user_roles ur ON ur.id_usuario = u.id_usuario
-- JOIN roles r ON r.id_rol = ur.id_rol
-- WHERE u.correo = 'administrador@example.com';
