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
