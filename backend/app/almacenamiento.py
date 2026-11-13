"""
========================================================================================
ARCHIVO: backend/app/almacenamiento.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Centralizar la estructura de carpetas y las rutas de los archivos guardados en
    Supabase Storage, para que todo el SGPI use una única distribución:

        <bucket 'convocatorias'>/
        └── <carpeta de la convocatoria>/           -> 'convocatorias.carpeta_storage'
            ├── documentos/                          -> instrumentos oficiales de la convocatoria
            └── propuestas/
                └── <codigo de la propuesta>/         -> 'SI-YYYY-NNN'
                    └── <archivo>

    La carpeta de la convocatoria es la raíz de sus documentos y de sus propuestas:
    así, todo lo que pertenece a una convocatoria queda junto y ninguna propuesta queda
    en una carpeta global suelta.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Lee 'convocatorias.carpeta_storage' (carpeta asignada a cada convocatoria).
           - Lee las variables de entorno SUPABASE_URL y SUPABASE_SERVICE_KEY.
    2.2.2. A quién sirve:
           - 'app.routers.convocatorias' sube los instrumentos oficiales de la convocatoria.
           - 'app.routers.admin' publica instrumentos oficiales desde la pantalla 31.
           - 'app.routers.vinculacion' sube los documentos y dictámenes de cada propuesta.
           - 'app.routers.propuestas', 'app.routers.comite', 'app.routers.cie',
             'app.routers.consejo' y 'app.routers.direccion' construyen las URLs públicas
             de descarga a partir de la ruta guardada en la base de datos.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSOMODO?:
    Normaliza nombres de archivo y de carpeta, arma las rutas de la estructura anterior,
    resuelve (y persiste) la carpeta de cada convocatoria, construye las URLs públicas y
    ofrece las operaciones de mantenimiento sobre Storage (subir, borrar, mover y crear
    el archivo marcador que deja visible una carpeta todavía vacía).
========================================================================================
"""

import os
import re
import unicodedata

import httpx
from fastapi import HTTPException

# [Línea clave]: Bucket único de Supabase Storage donde vive toda la documentación institucional.
BUCKET = "convocatorias"

# [Línea clave]: Subcarpetas obligatorias dentro de la carpeta de cada convocatoria.
SUBCARPETA_DOCUMENTOS = "documentos"
SUBCARPETA_PROPUESTAS = "propuestas"

# [Línea clave]: Archivo vacío que deja visible en el panel de Supabase una carpeta que aún no tiene archivos.
ARCHIVO_MARCADOR = ".keep"

# [Línea clave]: El bucket institucional solo admite los MIME de los formatos institucionales
# (pdf, docx, xlsx, pptx). El marcador se registra como PDF vacío para no ser rechazado.
MIME_MARCADOR = "application/pdf"


# ----------------------------------------------------------------------------------------
# Normalización de nombres
# ----------------------------------------------------------------------------------------


def slugify(texto: str, por_defecto: str = "sin-nombre") -> str:
    """
    Normalizar un texto para usarlo como nombre de objeto o de carpeta en Supabase Storage.

    Elimina tildes y caracteres diacríticos, pasa a minúsculas y reemplaza cualquier
    secuencia no alfanumérica por un guion.

    parametros:
        - str : texto Texto original (título de convocatoria o nombre de archivo).
        - str : por_defecto Valor devuelto cuando el texto queda vacío.

    return:
        + str : slug Texto normalizado y seguro para rutas de almacenamiento.
    """
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9]+", "-", t.lower()).strip("-")
    return t or por_defecto


def nombre_archivo_seguro(nombre: str) -> str:
    """
    Normalizar el nombre de un archivo conservando su extensión.

    Convierte la base del nombre a formato slug y conserva la extensión en minúsculas.

    parametros:
        - str : nombre Nombre original del archivo subido (ej. 'Formulario Final.DOCX').

    return:
        + str : nombre_seguro Nombre en formato slug (ej. 'formulario-final.docx').
    """
    base, ext = os.path.splitext(nombre or "")
    return f"{slugify(base, 'documento')}{ext.lower()}"


def sanear_codigo(codigo: str) -> str:
    """
    Normalizar el código de una propuesta para usarlo como nombre de carpeta.

    Conserva las mayúsculas del código institucional (por ejemplo 'SI-2027-014') y
    elimina cualquier carácter que no sea válido en una ruta de Storage.

    parametros:
        - str : codigo Código institucional de la propuesta.

    return:
        + str : codigo_seguro Código normalizado ('propuesta' si queda vacío).
    """
    limpio = re.sub(r"[^A-Za-z0-9._-]+", "-", (codigo or "").strip()).strip("-")
    return limpio or "propuesta"


def normalizar_carpeta(carpeta: str) -> str:
    """
    Normalizar la carpeta de una convocatoria para que sea relativa al bucket.

    Elimina el prefijo redundante 'convocatorias/' (el bucket ya tiene ese nombre),
    las barras iniciales y finales y cualquier barra duplicada.

    parametros:
        - str : carpeta Valor guardado en 'convocatorias.carpeta_storage'.

    return:
        + str : carpeta Carpeta relativa a la raíz del bucket ('' si no hay valor).
    """
    valor = (carpeta or "").strip().strip("/")
    while "//" in valor:
        valor = valor.replace("//", "/")
    if valor.lower().startswith(f"{BUCKET}/"):
        valor = valor[len(BUCKET) + 1:]
    return valor.strip("/")


# ----------------------------------------------------------------------------------------
# Operaciones sobre Supabase Storage
# ----------------------------------------------------------------------------------------


def config_storage() -> tuple[str, str]:
    """
    Leer la configuración de Supabase Storage desde las variables de entorno.

    return:
        + tuple[str, str] : (url, key) URL base del proyecto y service role key.

    Lanza HTTPException 500 si falta alguna variable (evita tumbar todo el backend al arrancar).
    """
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise HTTPException(500, "Supabase Storage no está configurado en el servidor.")
    return url, key


def subir_archivo(
    url: str,
    key: str,
    ruta: str,
    contenido: bytes,
    mime: str,
    upsert: bool = False,
) -> tuple[int, str]:
    """
    Subir un archivo a Supabase Storage.

    parametros:
        - str : url URL base del proyecto de Supabase.
        - str : key Service role key con permisos de escritura.
        - str : ruta Ruta del objeto dentro del bucket (carpetas y nombre del archivo).
        - bytes : contenido Binario que se almacena.
        - str : mime Tipo MIME del archivo.
        - bool : upsert Si es True sobrescribe un objeto existente; si es False, Storage
                 rechaza la carga con 409 cuando la ruta ya está ocupada.

    return:
        + tuple[int, str] : (estado, detalle) Código de respuesta de Storage y su texto.
    """
    try:
        r = httpx.post(
            f"{url}/storage/v1/object/{BUCKET}/{ruta}",
            headers={
                "Authorization": f"Bearer {key}",
                "apikey": key,
                "Content-Type": mime,
                "x-upsert": "true" if upsert else "false",
            },
            content=contenido,
            timeout=60,
        )
    except httpx.HTTPError:
        return 0, "No se pudo contactar a Supabase Storage."
    return r.status_code, r.text


def borrar_archivo(url: str, key: str, storage_path: str) -> None:
    """
    Eliminar un archivo de Storage (limpieza si falla el registro en la base de datos).

    Es un intento de mejor esfuerzo: si falla, no propaga el error.

    parametros:
        - str : url URL base del proyecto de Supabase.
        - str : key Service role key con permisos de escritura.
        - str : storage_path Ruta del objeto dentro del bucket.
    """
    try:
        httpx.delete(
            f"{url}/storage/v1/object/{BUCKET}/{storage_path}",
            headers={"Authorization": f"Bearer {key}", "apikey": key},
            timeout=30,
        )
    except httpx.HTTPError:
        pass


def existe_archivo(url: str, key: str, storage_path: str) -> bool:
    """
    Comprobar si un objeto ya existe dentro del bucket.

    parametros:
        - str : url URL base del proyecto de Supabase.
        - str : key Service role key con permisos de lectura.
        - str : storage_path Ruta del objeto dentro del bucket.

    return:
        + bool : existe True si el objeto está almacenado; False en caso contrario.
    """
    try:
        r = httpx.head(
            f"{url}/storage/v1/object/{BUCKET}/{storage_path}",
            headers={"Authorization": f"Bearer {key}", "apikey": key},
            timeout=30,
        )
    except httpx.HTTPError:
        return False
    return r.status_code < 400


def mover_archivo(url: str, key: str, origen: str, destino: str) -> tuple[bool, str]:
    """
    Mover un objeto dentro del bucket (reorganización de la estructura de carpetas).

    parametros:
        - str : url URL base del proyecto de Supabase.
        - str : key Service role key con permisos de escritura.
        - str : origen Ruta actual del objeto dentro del bucket.
        - str : destino Ruta nueva del objeto dentro del bucket.

    return:
        + tuple[bool, str] : (movido, detalle) True si el objeto quedó en su nueva ruta.
    """
    cabeceras = {"Authorization": f"Bearer {key}", "apikey": key}
    cuerpo = {"sourceKey": origen, "destinationKey": destino}
    detalle = ""
    for endpoint in (
        f"{url}/storage/v1/object/move/{BUCKET}",
        f"{url}/storage/v1/object/{BUCKET}/move",
    ):
        try:
            r = httpx.post(endpoint, headers=cabeceras, json=cuerpo, timeout=60)
        except httpx.HTTPError:
            continue
        if r.status_code < 400:
            return True, ""
        detalle = r.text
    return False, detalle


def asegurar_marcador(url: str, key: str, carpeta: str, subcarpeta: str) -> None:
    """
    Crear el archivo marcador de una subcarpeta para que se vea en el panel de Supabase.

    En Supabase Storage las carpetas son prefijos implícitos: solo aparecen cuando hay
    un objeto dentro. Este archivo vacío (0 bytes) materializa la carpeta desde el inicio.

    parametros:
        - str : url URL base del proyecto de Supabase.
        - str : key Service role key con permisos de escritura.
        - str : carpeta Carpeta de la convocatoria (relativa al bucket).
        - str : subcarpeta Subcarpeta a materializar ('documentos' o 'propuestas').

    return:
        + void : undefined No propaga errores: es una mejora cosmetiche del panel.
    """
    if not carpeta:
        return
    ruta = f"{carpeta}/{subcarpeta}/{ARCHIVO_MARCADOR}"
    if existe_archivo(url, key, ruta):
        return
    subir_archivo(url, key, ruta, b"", MIME_MARCADOR, upsert=True)


# ----------------------------------------------------------------------------------------
# Rutas de la estructura institucional
# ----------------------------------------------------------------------------------------


def carpeta_unica(cur, nombre: str) -> str:
    """
    Calcular una carpeta de Storage única para una convocatoria a partir de su título.

    Si el slug ya está en uso por otra convocatoria, agrega un sufijo numérico (-2, -3, ...).

    parametros:
        - cursor : cur Cursor activo de la transacción.
        - str : nombre Título de la convocatoria.

    return:
        + str : carpeta Nombre de carpeta disponible.
    """
    base = slugify(nombre)
    carpeta, n = base, 2
    while True:
        cur.execute(
            "SELECT 1 FROM convocatorias WHERE carpeta_storage = %s", (carpeta,)
        )
        if not cur.fetchone():
            return carpeta
        carpeta = f"{base}-{n}"
        n += 1


def resolver_carpeta_convocatoria(cur, id_convocatoria: int) -> str:
    """
    Resolver la carpeta de una convocatoria, creándola y persistiéndola si aún no existe.

    El valor guardado siempre es relativo a la raíz del bucket ('convocatorias'), por lo
    que se normaliza aquí el prefijo redundante que dejaron las versiones anteriores.

    parametros:
        - cursor : cur Cursor activo de la transacción.
        - int : id_convocatoria Convocatoria cuya carpeta se resuelve.

    return:
        + str : carpeta Carpeta de la convocatoria dentro del bucket.

    Lanza HTTPException 404 si la convocatoria no existe.
    """
    cur.execute(
        "SELECT nombre, carpeta_storage FROM convocatorias WHERE id_convocatoria = %s",
        (id_convocatoria,),
    )
    conv = cur.fetchone()
    if not conv:
        raise HTTPException(404, "Convocatoria no encontrada.")
    carpeta = normalizar_carpeta(conv["carpeta_storage"])
    if not carpeta:
        carpeta = carpeta_unica(cur, conv["nombre"])
    if carpeta != (conv["carpeta_storage"] or ""):
        cur.execute(
            "UPDATE convocatorias SET carpeta_storage = %s WHERE id_convocatoria = %s",
            (carpeta, id_convocatoria),
        )
    return carpeta


def ruta_documento_convocatoria(carpeta: str, nombre_archivo: str) -> str:
    """
    Construir la ruta de un instrumento oficial de la convocatoria.

    parametros:
        - str : carpeta Carpeta de la convocatoria (relativa al bucket).
        - str : nombre_archivo Nombre normalizado del archivo.

    return:
        + str : ruta Ruta del objeto: '<convocatoria>/documentos/<archivo>'.
    """
    return f"{normalizar_carpeta(carpeta)}/{SUBCARPETA_DOCUMENTOS}/{nombre_archivo}"


def ruta_documento_propuesta(carpeta: str, codigo: str, nombre_archivo: str) -> str:
    """
    Construir la ruta de un documento que pertenece a una propuesta.

    parametros:
        - str : carpeta Carpeta de la convocatoria (relativa al bucket).
        - str : codigo Código institucional de la propuesta (por ejemplo 'SI-2027-014').
        - str : nombre_archivo Nombre normalizado del archivo.

    return:
        + str : ruta Ruta del objeto: '<convocatoria>/propuestas/<codigo>/<archivo>'.
    """
    return (
        f"{normalizar_carpeta(carpeta)}/{SUBCARPETA_PROPUESTAS}"
        f"/{sanear_codigo(codigo)}/{nombre_archivo}"
    )


def url_publica(file_path: str, bucket: str = BUCKET) -> str:
    """
    Construir la URL pública accesible para un archivo almacenado en Supabase Storage.

    Si la ruta ya es una URL absoluta la devuelve tal cual; de lo contrario concatena
    el endpoint de Storage del bucket institucional.

    parametros:
        - str : file_path Ruta relativa del archivo en el bucket.
        - str : bucket Bucket donde vive el archivo (por defecto 'convocatorias').

    return:
        + str : url URL completa de acceso al documento ('' si no hay ruta).
    """
    if not file_path:
        return ""
    if file_path.startswith("http://") or file_path.startswith("https://"):
        return file_path
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not url:
        return file_path
    return f"{url}/storage/v1/object/public/{bucket}/{file_path.lstrip('/')}"
