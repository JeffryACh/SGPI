-- =========================================================================================
-- V19 · ESTRUCTURA DE CARPETAS DE SUPABASE STORAGE
-- =========================================================================================
-- Fecha: 2026-11-12
-- Motivo: la documentación institucional se distribía en dos carpetas sueltas: los
--          instrumentos de la convocatoria quedaban en la raíz de su carpeta y los
--          documentos de las propuestas vivían en una carpeta global 'propuestas/'.
--          Con esta migración la base de datos adopta la nueva estructura, en la que
--          cada convocatoria es la raíz de sus documentos y de sus propuestas:
--
--              <bucket 'convocatorias'>/
--              └── <carpeta de la convocatoria>/
--                  ├── documentos/          -> instrumentos oficiales de la convocatoria
--                  └── propuestas/
--                      └── <codigo>/        -> documentos de la propuesta (SI-YYYY-NNN)
--
-- Alcance: cambio de rutas (idempotente). No elimina filas ni archivos; solo reescribe
--          las rutas guardadas para que coincidan con la estructura del bucket.
-- =========================================================================================

BEGIN;

-- -----------------------------------------------------------------------------------------
-- 1. La carpeta de la convocatoria es relativa a la raíz del bucket
-- -----------------------------------------------------------------------------------------
-- [Línea clave]: El bucket ya se llama 'convocatorias', por lo que el valor guardado con el
--                prefijo completo armaba una ruta duplicada ('convocatorias/convocatorias/...').
--                Aquí se conserva solo el nombre de la carpeta dentro del bucket.
UPDATE public.convocatorias
   SET carpeta_storage = btrim(substring(carpeta_storage FROM length('convocatorias/') + 1))
 WHERE carpeta_storage LIKE 'convocatorias/%';

-- -----------------------------------------------------------------------------------------
-- 2. La convocatoria institucional vigente adopta su carpeta real en Storage
-- -----------------------------------------------------------------------------------------
-- [Línea clave]: 'fondos-vie-2027' es la carpeta que ya existe en el bucket (donde están los
--                archivos subidos desde el panel de Supabase). Se asigna por nombre de
--                convocatoria para no depender de identificadores fijos.
UPDATE public.convocatorias
   SET carpeta_storage = 'fondos-vie-2027'
 WHERE nombre ILIKE 'Fondos VIE 2027%'
   AND (
        carpeta_storage IS NULL
     OR btrim(carpeta_storage) = ''
     OR carpeta_storage IN ('vie-2027', 'convocatorias/vie-2027')
   );

-- -----------------------------------------------------------------------------------------
-- 3. Los instrumentos de la convocatoria pasan a la subcarpeta 'documentos'
-- -----------------------------------------------------------------------------------------
-- [Línea clave]: Solo se reescriben las rutas de una sola carpeta y archivo (por ejemplo
--                'fondos-vie-2027/formulario.pdf'); las que ya incluyen una subcarpeta
--                propia se conservan intactas.
WITH normalizado AS (
    SELECT id_documento_conv,
           storage_path AS ruta_anterior,
           regexp_replace(storage_path, '^([^/]+/)([^/]+)$', '\1documentos/\2') AS ruta_nueva
      FROM public.convocatoria_documentos
     WHERE storage_path IS NOT NULL
       AND storage_path NOT LIKE '%/documentos/%'
       AND storage_path ~ '^[^/]+/[^/]+$'
)
UPDATE public.convocatoria_documentos cd
   SET storage_path = n.ruta_nueva,
       file_url = CASE
                    WHEN cd.file_url IS NULL THEN NULL
                    WHEN cd.file_url LIKE '%' || n.ruta_anterior
                      THEN replace(cd.file_url, n.ruta_anterior, n.ruta_nueva)
                    ELSE cd.file_url
                  END
  FROM normalizado n
 WHERE cd.id_documento_conv = n.id_documento_conv;

-- -----------------------------------------------------------------------------------------
-- 4. Los documentos heredados sin ruta registrada se completan
-- -----------------------------------------------------------------------------------------
-- [Línea clave]: Los documentos heredados del seed que no tienen ruta registrada pero sí
--                apuntan al bucket (por ejemplo 'Bases_Convocatoria_VIE_2027.pdf') se
--                completan con la ruta de la estructura vigente: '<convocatoria>/documentos/'.
WITH pendientes AS (
    SELECT cd.id_documento_conv,
           c.carpeta_storage || '/documentos/' || cd.nombre_archivo AS ruta_nueva
      FROM public.convocatoria_documentos cd
      JOIN public.convocatorias c ON c.id_convocatoria = cd.id_convocatoria
     WHERE cd.storage_path IS NULL
       AND cd.file_url IS NOT NULL
       AND cd.nombre_archivo IS NOT NULL
)
UPDATE public.convocatoria_documentos cd
   SET storage_path = p.ruta_nueva,
       file_url = CASE
                    WHEN cd.file_url ~ '^https?://' THEN regexp_replace(cd.file_url, '[^/]+$', p.ruta_nueva)
                    ELSE cd.file_url
                  END
  FROM pendientes p
 WHERE cd.id_documento_conv = p.id_documento_conv;

-- -----------------------------------------------------------------------------------------
-- 5. Los documentos de cada propuesta cuelgan de la carpeta de su convocatoria
-- -----------------------------------------------------------------------------------------
-- [Línea clave]: La ruta antigua ('propuestas/si-2027-015/archivo.pdf') se reescribe como
--                'fondos-vie-2027/propuestas/SI-2027-015/archivo.pdf'. El código conserva
--                las mayúsculas del código institucional (lo genera el trigger V9).
--                Nota: los archivos de estas filas ya no existen en Storage; lo que se
--                actualiza es la ruta registrada, no el contenido.
UPDATE public.proposal_documents pd
   SET file_path = c.carpeta_storage
                   || '/propuestas/'
                   || COALESCE(NULLIF(btrim(p.codigo), ''), 'SI-' || p.id_propuesta)
                   || '/'
                   || regexp_replace(pd.file_path, '^propuestas/[^/]+/', '')
  FROM public.propuestas p
  JOIN public.convocatorias c ON c.id_convocatoria = p.id_convocatoria
 WHERE pd.id_propuesta = p.id_propuesta
   AND pd.file_path LIKE 'propuestas/%';

COMMIT;

-- -----------------------------------------------------------------------------------------
-- Verificación
-- -----------------------------------------------------------------------------------------
-- SELECT id_convocatoria, nombre, carpeta_storage
-- FROM public.convocatorias
-- ORDER BY id_convocatoria;
--
-- SELECT id_documento_conv, storage_path, file_url
-- FROM public.convocatoria_documentos
-- ORDER BY id_documento_conv;
--
-- SELECT pd.id_documento, pd.file_path
-- FROM public.proposal_documents pd
-- ORDER BY pd.id_documento;
--
-- Notas para el despliegue:
--   1. Ejecutar este script en el Supabase SQL Editor (aplicación manual, sin Flyway).
--   2. Aplicar antes de desplegar el backend nuevo: 'backend/app/almacenamiento.py' normaliza
--      el valor en tiempo de ejecución, pero la base queda coherente solo con esta migración.
--   3. Los archivos físicos se reorganizan con 'backend/scripts/migrar_storage_estructura.py'.
-- =========================================================================================
