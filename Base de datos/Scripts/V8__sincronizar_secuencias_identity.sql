-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V8__sincronizar_secuencias_identity.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Sincronizar el valor actual de todas las secuencias IDENTITY de PostgreSQL
--      con respecto al valor máximo existente en cada tabla.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Metadatos de 'information_schema.columns' y función 'pg_get_serial_sequence'.
--      2.2.2. A dónde envía datos / Qué entidades modifica:
--             - Ejecuta setval() sobre las secuencias de las columnas IDENTITY.
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
--      Itera dinámicamente sobre todas las tablas del esquema 'public' que poseen
--      columnas identity y ajusta el próximo valor a MAX(columna) + 1, evitando colisiones
--      de clave duplicada tras inserciones manuales de datos de prueba o migraciones.
-- ============================================================================

-- =====================================================================
-- MIGRACIÓN V8: SINCRONIZACIÓN DE SECUENCIAS IDENTITY
-- Sistema de Gestión de Propuestas de Investigación (SGPI - TEC)
-- =====================================================================
-- Alinea las secuencias de las columnas identity con los identificadores
-- ya cargados, evitando colisiones en nuevas inserciones. Es idempotente
-- y no modifica los datos existentes.

DO $$
DECLARE
  r record;
  max_id bigint;
  last_val bigint;
  is_called boolean;
  seq text;
BEGIN
  -- [Línea clave]: ¿Por qué soy importante? Itera sobre todas las columnas identity de la base de datos. ¿Para qué? Prevenir errores de clave duplicada al insertar registros tras cargas manuales de datos. ¿Dónde me usan? Script de mantenimiento y migración ejecutado en Supabase.
  FOR r IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND is_identity = 'YES'
      AND table_name NOT LIKE 'pg_%'
  LOOP
    seq := pg_get_serial_sequence(
      format('%I.%I', r.table_schema, r.table_name),
      r.column_name
    );
    CONTINUE WHEN seq IS NULL;

    EXECUTE format(
      'SELECT COALESCE(MAX(%I), 0) FROM %I.%I',
      r.column_name, r.table_schema, r.table_name
    ) INTO max_id;

    EXECUTE format('SELECT last_value, is_called FROM %s', seq)
      INTO last_val, is_called;

    IF max_id >= last_val THEN
      PERFORM setval(seq, max_id + 1, false);
    END IF;
  END LOOP;
END $$;
