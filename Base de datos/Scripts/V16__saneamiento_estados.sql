-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V16__saneamiento_estados.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Sanear el catálogo institucional de estados y reparar los expedientes
--      cuya etapa actual contradice la última decisión registrada en la bitácora.
--
--      Contexto: durante el desarrollo del flujo institucional, algunos routers
--      resolvían el estado destino por identificador numérico fijo (tomado del
--      orden del seed V3) en lugar de por su nombre oficial. Como el orden de
--      la tabla 'estados' puede diferir entre ambientes, una devolución con
--      observaciones terminaba en «En ejecución» y un rechazo en «Con
--      observaciones». El backend ya no depende de los identificadores
--      (backend/app/estados.py resuelve siempre por nombre); este script deja
--      la base de datos coherente y auditable.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - 'estados': catálogo institucional de los doce estados.
--             - 'propuestas': etapa actual del expediente.
--             - 'proposal_state_history': bitácora con la decisión de cada
--               instancia (Vinculación, Comité Técnico, Consejo de Escuela,
--               Dirección de Investigación y CIE).
--             - 'notificaciones': avisos que el trigger genera al cambiar la etapa.
--      2.2.2. A dónde envía datos:
--             - 'estados': garantiza que existan los doce estados canónicos.
--             - 'proposal_state_history': corrige el destino de las filas
--               erróneas y deja constancia del saneamiento. No se borra ninguna
--               fila de auditoría.
--             - 'propuestas': alinea la etapa actual con la última decisión.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GROSOSO MODO?:
--      1. Garantiza el catálogo de estados por NOMBRE (el identificador no es
--         parte del contrato y por eso el script nunca escribe un número fijo).
--      2. Detecta las filas de bitácora que registran una devolución o un
--         rechazo pero apuntan a un estado que no corresponde a esa decisión.
--      3. Alinea la etapa actual de esos expedientes con la decisión registrada
--         y deja una fila de trazabilidad del saneamiento.
--      4. Muestra los resultados de verificación para que el responsable revise.
--
-- 2.4. CONSUMIDORES:
--      - backend/app/estados.py (máquina de estados y resolución por nombre).
--      - backend/app/routers/{vinculacion,comite,consejo,direccion,cie,tramite}.py.
--      - frontend/js/app.js (resuelve los estados por nombre desde el catálogo).
--
-- 2.5. NOTAS DE EJECUCIÓN:
--      - Es idempotente: puede reejecutarse en el SQL Editor de Supabase.
--      - En una base de datos coherente no modifica nada y solo muestra los
--        resultados de verificación.
-- ============================================================================

-- ---------------------------------------------------------------------
-- 1. CATÁLOGO INSTITUCIONAL DE ESTADOS
-- ---------------------------------------------------------------------
-- [Línea clave]: Los doce estados del ciclo institucional se garantizan por
-- NOMBRE. El identificador no es parte del contrato: el backend lo resuelve
-- siempre por nombre (backend/app/estados.py) porque el orden de la tabla puede
-- variar entre ambientes. Por eso este script nunca escribe un número fijo.

INSERT INTO public.estados (nombre_estado) VALUES
  ('En formulación'),
  ('En revisión de Vinculación'),
  ('En evaluación del Comité Técnico'),
  ('Pendiente de aval del Consejo'),
  ('Avalada'),
  ('Sometida ante VIE'),
  ('Dictaminada por Dirección'),
  ('Aprobada por CIE'),
  ('En ejecución'),
  ('Con observaciones'),
  ('Rechazada'),
  ('Cerrada')
ON CONFLICT (nombre_estado) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. DETECCIÓN DE EXPEDIENTES INCONSISTENTES
-- ---------------------------------------------------------------------
-- [Línea clave]: La bitácora es la fuente de verdad: cada fila guarda la
-- decisión institucional que motivó el cambio de etapa. Se toma la última
-- fila de cada expediente y se compara su estado de destino con la decisión
-- que esa misma fila registra. Solo se marcan los expedientes cuya última
-- decisión fue una devolución («observaciones») o un rechazo («rechazo»).

DROP TABLE IF EXISTS v16_saneamiento;

CREATE TEMP TABLE v16_saneamiento (
  id_propuesta           integer PRIMARY KEY,
  id_historial           integer,
  id_usuario_responsable integer,
  estado_correcto        integer,
  nombre_estado_correcto text
);

WITH ultima AS (
  SELECT DISTINCT ON (h.id_propuesta)
         h.id_propuesta,
         h.id_historial,
         h.id_usuario_responsable,
         h.id_estado_nuevo,
         h.observaciones
  FROM public.proposal_state_history h
  ORDER BY h.id_propuesta, h.fecha_cambio DESC, h.id_historial DESC
)
INSERT INTO v16_saneamiento
  (id_propuesta, id_historial, id_usuario_responsable, estado_correcto, nombre_estado_correcto)
SELECT u.id_propuesta,
       u.id_historial,
       u.id_usuario_responsable,
       e_destino.id_estado,
       e_destino.nombre_estado
FROM ultima u
JOIN public.estados e_actual
  ON e_actual.id_estado = u.id_estado_nuevo
JOIN public.estados e_destino
  ON e_destino.nombre_estado = CASE
       -- Vinculación, Comité Técnico y Consejo de Escuela.
       WHEN u.observaciones ~* 'Decisi[oó]n:\s*observaciones' THEN 'Con observaciones'
       WHEN u.observaciones ~* 'Decisi[oó]n:\s*rechazo'      THEN 'Rechazada'
       -- Dirección de Investigación.
       WHEN u.observaciones ~* 'Resoluci[oó]n:\s*Con observaciones' THEN 'Con observaciones'
       WHEN u.observaciones ~* 'Resoluci[oó]n:\s*No favorable'      THEN 'Rechazada'
       -- Comité de Ética en Investigación (catálogo «resoluciones_cie»).
       WHEN u.observaciones ~* 'Acuerdo:\s*Aprobado condicionado a enmiendas menores'
         THEN 'Con observaciones'
       WHEN u.observaciones ~* 'Acuerdo:\s*Rechazado por conflicto bio[ée]tico no subsanable'
         THEN 'Rechazada'
     END
WHERE e_actual.nombre_estado <> e_destino.nombre_estado;

-- ---------------------------------------------------------------------
-- 3. CORRECCIÓN DE LA BITÁCORA (no se elimina ninguna fila)
-- ---------------------------------------------------------------------
-- [Línea clave]: La fila errónea se corrige en lugar de borrarse: la auditoría
-- se conserva y se añade la nota que explica el cambio, de modo que el
-- expediente siga permitiendo reconstruir qué ocurrió y cuándo se reparó.

UPDATE public.proposal_state_history h
SET id_estado_nuevo = s.estado_correcto,
    observaciones = h.observaciones ||
      ' [Saneamiento V16: el destino registrado era «' ||
      (SELECT e.nombre_estado FROM public.estados e WHERE e.id_estado = h.id_estado_nuevo) ||
      '» y se corrige a «' || s.nombre_estado_correcto ||
      '», que es el estado que corresponde a la decisión institucional registrada.]'
FROM v16_saneamiento s
WHERE h.id_historial = s.id_historial
  AND h.id_estado_nuevo IS DISTINCT FROM s.estado_correcto;

-- ---------------------------------------------------------------------
-- 4. ALINEACIÓN DE LA ETAPA ACTUAL DEL EXPEDIENTE
-- ---------------------------------------------------------------------
-- [Línea clave]: El trigger de PostgreSQL registra la transición y notifica al
-- investigador líder; la fila que genera el trigger se completa en el paso 5.

UPDATE public.propuestas p
SET estado_actual = s.estado_correcto
FROM v16_saneamiento s
WHERE p.id_propuesta = s.id_propuesta
  AND p.estado_actual IS DISTINCT FROM s.estado_correcto;

-- ---------------------------------------------------------------------
-- 5. TRAZABILIDAD DEL SANEAMIENTO
-- ---------------------------------------------------------------------
-- [Línea clave]: La transición registrada por el trigger se completa con el
-- detalle del saneamiento y con el responsable institucional que tomó la
-- decisión original, de modo que la bitácora explique el salto.

UPDATE public.proposal_state_history h
SET id_usuario_responsable = COALESCE(s.id_usuario_responsable, h.id_usuario_responsable),
    observaciones = 'Saneamiento V16: el expediente registra una decisión de «' ||
      s.nombre_estado_correcto ||
      '» pero había quedado en un estado que no le correspondía. Se restituye la etapa correcta sin eliminar la auditoría anterior.'
FROM v16_saneamiento s
WHERE h.id_propuesta = s.id_propuesta
  AND h.id_estado_nuevo = s.estado_correcto
  AND h.observaciones = 'Transición automática registrada por el sistema';

-- ---------------------------------------------------------------------
-- 6. VERIFICACIÓN
-- ---------------------------------------------------------------------
-- 6.1. Catálogo institucional vigente.
SELECT e.id_estado,
       e.nombre_estado,
       CASE e.nombre_estado
         WHEN 'En formulación'                  THEN '1 · Formulación'
         WHEN 'En revisión de Vinculación'      THEN '2 · Vinculación'
         WHEN 'En evaluación del Comité Técnico' THEN '3 · Comité Técnico'
         WHEN 'Pendiente de aval del Consejo'    THEN '4 · Consejo de Escuela'
         WHEN 'Avalada'                          THEN '5 · Avalada'
         WHEN 'Sometida ante VIE'                THEN '6 · Sometimiento formal'
         WHEN 'Dictaminada por Dirección'        THEN '7 · Dirección de Investigación'
         WHEN 'Aprobada por CIE'                 THEN '8 · Comité de Ética'
         WHEN 'En ejecución'                     THEN '9 · Ejecución'
         WHEN 'Con observaciones'                THEN '10 · Devolución'
         WHEN 'Rechazada'                        THEN '11 · Rechazo terminal'
         WHEN 'Cerrada'                          THEN '12 · Cierre administrativo'
       END AS etapa_institucional
FROM public.estados e
ORDER BY e.id_estado;

-- 6.2. Expedientes reparados por este script.
SELECT s.id_propuesta,
       p.codigo,
       p.titulo,
       s.nombre_estado_correcto AS etapa_corregida,
       s.id_usuario_responsable AS responsable_de_la_decision
FROM v16_saneamiento s
JOIN public.propuestas p ON p.id_propuesta = s.id_propuesta
ORDER BY s.id_propuesta;

-- 6.3. Expedientes cuya etapa actual no coincide con la última decisión de la
--      bitácora. El resultado esperado es cero filas.
WITH ultima AS (
  SELECT DISTINCT ON (h.id_propuesta)
         h.id_propuesta,
         h.id_estado_nuevo,
         h.observaciones
  FROM public.proposal_state_history h
  ORDER BY h.id_propuesta, h.fecha_cambio DESC, h.id_historial DESC
)
SELECT p.id_propuesta,
       p.codigo,
       e_actual.nombre_estado AS etapa_actual,
       e_historial.nombre_estado AS etapa_de_la_bitacora,
       left(u.observaciones, 80) AS ultima_decision
FROM public.propuestas p
JOIN ultima u ON u.id_propuesta = p.id_propuesta
JOIN public.estados e_actual ON e_actual.id_estado = p.estado_actual
JOIN public.estados e_historial ON e_historial.id_estado = u.id_estado_nuevo
WHERE p.estado_actual IS DISTINCT FROM u.id_estado_nuevo;

-- 6.4. Bitácora completa de los expedientes reparados.
SELECT h.id_historial,
       h.id_propuesta,
       ea.nombre_estado AS etapa_anterior,
       en.nombre_estado AS etapa_nueva,
       h.id_usuario_responsable,
       h.fecha_cambio,
       left(h.observaciones, 120) AS observaciones
FROM public.proposal_state_history h
LEFT JOIN public.estados ea ON ea.id_estado = h.id_estado_anterior
JOIN public.estados en ON en.id_estado = h.id_estado_nuevo
WHERE h.id_propuesta IN (SELECT id_propuesta FROM v16_saneamiento)
ORDER BY h.id_propuesta, h.fecha_cambio, h.id_historial;

DROP TABLE IF EXISTS v16_saneamiento;
