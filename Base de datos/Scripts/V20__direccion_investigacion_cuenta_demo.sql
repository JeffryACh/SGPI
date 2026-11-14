-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V20__direccion_investigacion_cuenta_demo.sql
-- 2.1. OBJETIVO:
--      Separar en dos cuentas institucionales distintas las dos funciones que
--      compartía una sola cuenta de demostración: «Funcionario VIE» y
--      «Dirección de Investigación». Elena Chacón conserva únicamente el rol de
--      Funcionario VIE (administración de convocatorias, cronogramas, catálogos y
--      rúbricas) y la función de dictaminar la propuesta pasa a una cuenta nueva
--      con el rol «Dirección de Investigación».
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Tabla 'usuarios' (datos de la cuenta institucional) y 'user_roles'
--               con el catálogo de 'roles'.
--      2.2.2. A dónde envía datos:
--             - Registra la cuenta «Diego Alonso» con la contraseña de demostración
--               usada por el resto de cuentas de prueba y le asigna el rol
--               'Dirección de Investigación'; retira ese rol a 'elena.chacon@example.com'.
--             - La tabla 'notificaciones', 'proposal_state_history' y los
--               expedientes ya registrados NO se modifican: el cambio de titular
--               del rol no altera la trazabilidad de las decisiones existentes.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GRESOSO MODO?:
--      Retira el rol 'Dirección de Investigación' a la cuenta de Elena Chacón,
--      crea de forma idempotente la cuenta 'diego.alonso@example.com' con la
--      contraseña 'demostracion' y le asigna el rol 'Dirección de Investigación'.
-- ============================================================================

-- [Línea clave]: ¿Por qué soy importante? La autorización de las pantallas 26 y del
-- cierre administrativo se valida contra 'user_roles'. ¿Para qué? Que la figura de
-- Dirección de Investigación y la de Funcionario VIE se recorran con cuentas
-- separadas, tal como ocurre en la institución. ¿Dónde me usan?
-- 'backend/app/routers/direccion.py', 'backend/app/routers/admin.py' y el
-- endpoint 'GET /auth/cuentas-demo' que alimenta el botón «Cambiar rol».
DELETE FROM public.user_roles ur
USING public.roles r, public.usuarios u
WHERE ur.id_rol = r.id_rol
  AND ur.id_usuario = u.id_usuario
  AND r.nombre_rol = 'Dirección de Investigación'
  AND u.correo = 'elena.chacon@example.com';

-- [Línea clave]: Crea la cuenta institucional de Dirección de Investigación con la
-- misma huella de contraseña de las demás cuentas de demostración ('demostracion'),
-- sin escuela asignada porque la función es de alcance institucional. La columna
-- 'second_lastname' es NOT NULL en el esquema, así que se deja vacía.
INSERT INTO public.usuarios
  (id_escuela, nombre, lastname, second_lastname, correo, password_hash, estado_activo)
SELECT
  NULL,
  'Diego',
  'Alonso',
  '',
  'diego.alonso@example.com',
  encode(sha256('demostracion'::bytea), 'hex'),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.usuarios WHERE correo = 'diego.alonso@example.com'
);

-- [Línea clave]: Asigna el rol de Dirección de Investigación a la cuenta nueva.
INSERT INTO public.user_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol
FROM public.usuarios u
CROSS JOIN public.roles r
WHERE u.correo = 'diego.alonso@example.com'
  AND r.nombre_rol = 'Dirección de Investigación'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.id_usuario = u.id_usuario AND ur.id_rol = r.id_rol
  );

-- ---------------------------------------------------------------------
-- VERIFICACIÓN RÁPIDA (opcional para el administrador)
-- ---------------------------------------------------------------------
-- SELECT u.correo, r.nombre_rol
-- FROM usuarios u
-- JOIN user_roles ur ON ur.id_usuario = u.id_usuario
-- JOIN roles r ON r.id_rol = ur.id_rol
-- WHERE u.correo IN ('elena.chacon@example.com', 'diego.alonso@example.com')
-- ORDER BY u.correo, r.nombre_rol;
