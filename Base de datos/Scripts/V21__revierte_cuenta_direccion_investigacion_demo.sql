-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V21__revierte_cuenta_direccion_investigacion_demo.sql
-- 2.1. OBJETIVO:
--      Revertir la separación de cuentas que introdujo la migración V20. La
--      cuenta de Elena Chacón recupera los dos roles que tenía antes
--      («Dirección de Investigación» y «Funcionario VIE») y se elimina la
--      cuenta «Diego Alonso» creada por esa migración.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Tabla 'usuarios' (cuenta institucional) y 'user_roles' con el
--               catálogo de 'roles'.
--      2.2.2. A dónde envía datos:
--             - Devuelve el rol 'Dirección de Investigación' a
--               'elena.chacon@example.com' y elimina la cuenta
--               'diego.alonso@example.com'.
--             - La auditoría que esa cuenta dejó durante las pruebas
--               ('evaluations', 'proposal_state_history' y 'notificaciones') se
--               reasigna a la cuenta de Elena Chacón: así ninguna fila queda
--               apuntando a un usuario inexistente y la bitácora conserva un
--               responsable real.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GRESOSO MODO?:
--      Reasigna la auditoría de la cuenta eliminada, borra su asignación de
--      rol y su usuario, y restituye el rol 'Dirección de Investigación' a la
--      cuenta que lo tenía antes de la V20. No modifica el estado de ninguna
--      propuesta ni el contenido de los expedientes.
-- ============================================================================

-- [Línea clave]: ¿Por qué soy importante? 'evaluations', 'proposal_state_history' y
-- 'notificaciones' tienen claves foráneas hacia 'usuarios'. ¿Para qué? Que al
-- eliminar la cuenta de la V20 no queden dictámenes, transiciones ni avisos
-- huérfanos, y que la trazabilidad siga atribuida a la persona que tiene el
-- rol. ¿Dónde me usan? 'backend/app/routers/propuestas.py' (dossier e historial).
UPDATE public.evaluations ev
SET id_usuario_eval = (
        SELECT u_destino.id_usuario
        FROM public.usuarios u_destino
        WHERE u_destino.correo = 'elena.chacon@example.com'
    )
WHERE ev.id_usuario_eval = (
        SELECT u_origen.id_usuario
        FROM public.usuarios u_origen
        WHERE u_origen.correo = 'diego.alonso@example.com'
    );

-- [Línea clave]: La bitácora de estados registra quién ejecutó cada transición.
UPDATE public.proposal_state_history h
SET id_usuario_responsable = (
        SELECT u_destino.id_usuario
        FROM public.usuarios u_destino
        WHERE u_destino.correo = 'elena.chacon@example.com'
    )
WHERE h.id_usuario_responsable = (
        SELECT u_origen.id_usuario
        FROM public.usuarios u_origen
        WHERE u_origen.correo = 'diego.alonso@example.com'
    );

-- [Línea clave]: Los avisos dirigidos a la Dirección de Investigación se
-- reasignan a la cuenta que recupera ese rol.
UPDATE public.notificaciones n
SET id_usuario = (
        SELECT u_destino.id_usuario
        FROM public.usuarios u_destino
        WHERE u_destino.correo = 'elena.chacon@example.com'
    )
WHERE n.id_usuario = (
        SELECT u_origen.id_usuario
        FROM public.usuarios u_origen
        WHERE u_origen.correo = 'diego.alonso@example.com'
    );

-- [Línea clave]: Retira el rol 'Dirección de Investigación' de la cuenta que se
-- va a eliminar.
DELETE FROM public.user_roles ur
USING public.roles r, public.usuarios u
WHERE ur.id_rol = r.id_rol
  AND ur.id_usuario = u.id_usuario
  AND r.nombre_rol = 'Dirección de Investigación'
  AND u.correo = 'diego.alonso@example.com';

-- [Línea clave]: Elimina la cuenta institucional creada por la V20.
DELETE FROM public.usuarios
WHERE correo = 'diego.alonso@example.com';

-- [Línea clave]: Restituye a Elena Chacón el rol 'Dirección de Investigación',
-- de modo que vuelva a tener los mismos dos roles que antes de la V20.
INSERT INTO public.user_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol
FROM public.usuarios u
CROSS JOIN public.roles r
WHERE u.correo = 'elena.chacon@example.com'
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
