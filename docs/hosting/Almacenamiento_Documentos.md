# Almacenamiento de documentos (Supabase Storage)

Guía de la distribución de archivos del SGPI en Supabase Storage, de las reglas de nombres
y de los pasos para reorganizar o recuperar documentos.

---

## 1. Estructura

Todo vive en un único bucket público llamado `convocatorias`. Dentro, cada convocatoria es
la raíz de sus documentos y de sus propuestas:

```
convocatorias/                     ← bucket
└── fondos-vie-2027/               ← carpeta de la convocatoria
    ├── .keep                      ← marcador (deja visible la carpeta en el panel)
    ├── documentos/                ← instrumentos oficiales de la convocatoria
    │   ├── .keep
    │   ├── Bases_Convocatoria_VIE_2027.pdf
    │   └── Guia_Formulacion_VIE_2027.pdf
    └── propuestas/                ← documentos de las propuestas de esta convocatoria
        ├── .keep
        └── SI-2027-014/           ← una carpeta por propuesta (código institucional)
            └── 10a490a6-informe-final.pdf
```

Reglas de la estructura:

| Elemento | Dónde vive | Quién lo define |
| :--- | :--- | :--- |
| Carpeta de la convocatoria | `convocatorias.carpeta_storage` (relativa a la raíz del bucket) | El backend al crear la convocatoria (`carpeta_unica`) |
| Instrumentos oficiales | `<convocatoria>/documentos/` | `POST /convocatorias/documentos_convocatoria` y `POST /admin/convocatorias/{id}/documentos` |
| Documentos de una propuesta | `<convocatoria>/propuestas/<código>/` | `POST /propuestas/{id}/documentos` |
| Carpeta de una propuesta | El código institucional `SI-YYYY-NNN` que asigna el trigger `fn_asignar_codigo_propuesta` | Base de datos (V9) |

La carpeta `propuestas/` **se crea sola** con la primera subida de una propuesta: en Supabase
Storage las carpetas son prefijos implícitos. Para que se vea en el panel aunque esté vacía,
el backend deja un archivo marcador `.keep` (0 bytes) en `documentos/` y en `propuestas/`.

---

## 2. Dónde está la lógica

- `backend/app/almacenamiento.py`: módulo único con el bucket, las subcarpetas, la
  normalización de nombres, la construcción de rutas y las operaciones de Storage
  (subir, borrar, mover y crear el marcador). Ningún router arma rutas a mano.
- `backend/app/routers/convocatorias.py`: subida de instrumentos oficiales.
- `backend/app/routers/admin.py`: publicación de instrumentos oficiales (pantalla 31).
- `backend/app/routers/vinculacion.py`: subida de documentos y dictámenes de cada propuesta.
- `backend/app/routers/propuestas.py`, `comite.py`, `cie.py`, `consejo.py`, `direccion.py`:
  construyen la URL pública de descarga a partir de la ruta guardada en la base de datos.

Restricciones del bucket: solo admite los MIME institucionales (`application/pdf`, `docx`,
`xlsx` y `pptx`) y un máximo de 20 MB por archivo. El endpoint de movimiento de Supabase
rechaza las operaciones cuando el bucket tiene lista de MIME, así que el script de
reorganización traslada cada archivo descargándolo y volviéndolo a subir.

---

## 3. Reorganizar los archivos físicos

```bash
# Simulación: muestra qué movería sin tocar nada
python backend/scripts/migrar_storage_estructura.py --dry-run

# Aplicación: mueve los archivos y crea los marcadores
python backend/scripts/migrar_storage_estructura.py
```

El script es idempotente y **no borra nada**: deja intactas las carpetas que no pertenecen a
una convocatoria (por ejemplo una carpeta de prueba). Requiere `DATABASE_URL`, `SUPABASE_URL`
y `SUPABASE_SERVICE_KEY` en el `.env` de la raíz del repositorio.

Antes de ejecutarlo hay que tener aplicada la migración
`Base de datos/Scripts/V19__estructura_carpetas_storage.sql` (sección 10 de
`Base de datos/Cambios.md`), porque el script toma de la base de datos el nombre de la
carpeta de cada convocatoria.

---

## 4. Subir archivos desde el panel de Supabase

Si se arrastra un archivo manualmente a una carpeta, hay que hacerlo en la ruta que
corresponda a la estructura (`<convocatoria>/documentos/` para instrumentos y
`<convocatoria>/propuestas/<código>/` para una propuesta) y después registrar sus metadatos
en la base de datos, porque la aplicación solo conoce los archivos que registró ella:

- `convocatoria_documentos`: `id_convocatoria`, `nombre_documento`, `nombre_archivo`,
  `tipo_instrumento`, `extension`, `storage_path`, `file_url`, `orden`, `version`.
- `proposal_documents`: `id_propuesta`, `nombre_archivo`, `tipo_documento`, `extension`,
  `file_path`, `tamano_bytes`, `version`, `id_usuario_subio`.

La alternativa recomendada es subir los archivos desde la aplicación (pantallas 05, 21–23 y
31), que ya deja el registro y la ruta correctos.

---

## 5. Comprobaciones

```bash
# Health del backend
curl http://localhost:3001/health

# Listado de los instrumentos de la convocatoria
curl "http://localhost:3001/convocatorias/documentos_convocatoria?id_convocatoria=1"
```

Verificación recomendada tras cualquier cambio en las rutas:

1. Subir un instrumento desde `POST /convocatorias/documentos_convocatoria` y confirmar que
   aparece en `<convocatoria>/documentos/`.
2. Subir un documento desde `POST /propuestas/{id}/documentos` y confirmar que aparece en
   `<convocatoria>/propuestas/<código>/`.
3. Descargar el enlace público devuelto: debe responder 200.
