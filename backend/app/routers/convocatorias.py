"""
========================================================================================
ARCHIVO: backend/app/routers/convocatorias.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Gestionar la información de las convocatorias institucionales de la Vicerrectoría
    de Investigación y Extensión (VIE), incluyendo sus cronogramas por etapas y los
    instrumentos oficiales (Disposiciones, Rúbricas, Formularios, Acuerdos) almacenados
    en Supabase Storage.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta las tablas 'convocatorias', 'convocatoria_etapas' y 'convocatoria_documentos'
             en Supabase mediante la conexión de 'app.db.get_conn'.
           - Los archivos físicos viven en el bucket 'convocatorias' de Supabase Storage, organizados
             en una carpeta por convocatoria: <convocatoria>/documentos/<archivo>. La estructura
             completa y las reglas de nombres se definien en 'app.almacenamiento'.
    2.2.2. A dónde envía datos:
           - Envía listas estructuradas hacia el Frontend para poblar las pantallas 04 (Convocatorias),
             05 (Detalle de Convocatoria) y 31 (Administración de Convocatorias).
           - Sube los archivos recibidos a Supabase Storage y registra sus metadatos en la base de datos.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Expone cuatro endpoints REST: GET '/totalConvocatorias' (períodos de concurso),
    GET '/etapas_convocatorias' (cronograma por etapas), GET '/documentos_convocatoria'
    (instrumentos oficiales con su URL pública) y POST '/documentos_convocatoria' (subida de un
    instrumento a Storage + registro en la tabla).

2.4. CONFIGURACIÓN REQUERIDA:
    Variables de entorno del backend: SUPABASE_URL y SUPABASE_SERVICE_KEY (service role, solo servidor).
    Dependencias: python-multipart (necesaria para recibir archivos con Form/UploadFile).
    Las rutas de Storage y la configuración del bucket se resuelven en 'app.almacenamiento'.
========================================================================================
"""

import os
from datetime import date, datetime
from typing import Optional, Union

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from psycopg import Connection
from pydantic import BaseModel

from ..almacenamiento import (
    BUCKET,
    SUBCARPETA_DOCUMENTOS,
    asegurar_marcador,
    borrar_archivo,
    config_storage,
    nombre_archivo_seguro,
    resolver_carpeta_convocatoria,
    ruta_documento_convocatoria,
    subir_archivo,
)
from ..db import get_conn

# [Línea clave]: Declara el router bajo el prefijo /convocatorias para agrupar las rutas de concursos institucionales.
router = APIRouter(prefix="/convocatorias", tags=["convocatorias"])

# Tamaño máximo por archivo (debe coincidir con el límite configurado en el bucket).
MAX_BYTES = 20 * 1024 * 1024

# [Línea clave]: Formatos permitidos. El MIME se deduce de la extensión (no del navegador) para que
# coincida siempre con los 'Allowed MIME types' del bucket.
MIME_POR_EXTENSION = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


# ----------------------------------------------------------------------------------------
# Modelos de respuesta
# ----------------------------------------------------------------------------------------


class ConvocatoriaOut(BaseModel):
    """
    Modelo de respuesta que describe los metadatos y vigencia de una convocatoria.

    Serializa las columnas de la tabla 'convocatorias' soportando fechas en formato date, datetime o cadena.

    Se utiliza como response_model en el endpoint GET /convocatorias/totalConvocatorias.

    atributos:
        * int : id_convocatoria Identificador único de la convocatoria en la base de datos.
        * str : nombre Nombre descriptivo oficial de la convocatoria (ej. Fondos VIE 2027).
        * Optional[str] : descripcion Justificación y marco legal de la convocatoria.
        * Union[date, datetime, str] : fecha_inicio Fecha en que inicia la recepción de propuestas.
        * Union[date, datetime, str] : fecha_cierre Fecha límite fatal de sometimiento.
        * Union[date, datetime, str] : fecha_inicio_ejecucion Fecha programada de inicio presupuestario.
        * bool : activo Indica si la convocatoria se encuentra vigente para postulación.
    """
    id_convocatoria: int
    nombre: str
    descripcion: Optional[str] = None
    fecha_inicio: Union[date, datetime, str]
    fecha_cierre: Union[date, datetime, str]
    fecha_inicio_ejecucion: Union[date, datetime, str]
    activo: bool


class ConvocatoriaEtapaOut(BaseModel):
    """
    Modelo de respuesta que representa una etapa individual dentro del cronograma de una convocatoria.

    Serializa los registros de 'convocatoria_etapas' ordenados cronológicamente por la columna 'orden'.

    Se utiliza como response_model en el endpoint GET /convocatorias/etapas_convocatorias.

    atributos:
        * int : id_etapa Identificador de la etapa cronológica.
        * int : id_convocatoria Convocatoria a la que pertenece esta etapa.
        * str : nombre_etapa Nombre formal de la etapa (ej. Formulación de propuestas, Aval de Consejo).
        * str : responsable Instancia o rol universitario a cargo de ejecutar o evaluar la etapa.
        * Union[date, datetime, str] : fecha_inicio Fecha de apertura de la fase.
        * Union[date, datetime, str] : fecha_fin Fecha de conclusión de la fase.
        * int : orden Posición secuencial ordinal dentro del proceso de concurso.
    """
    id_etapa: int
    id_convocatoria: int
    nombre_etapa: str
    responsable: str
    fecha_inicio: Union[date, datetime, str]
    fecha_fin: Union[date, datetime, str]
    orden: int


class ConvocatoriaDocumentoOut(BaseModel):
    """
    Modelo de respuesta para los instrumentos y documentos normativos de la convocatoria.

    Expone nombre, archivo, categoría, extensión, URL pública y metadatos de cada instrumento.

    Se utiliza como response_model en GET y POST /convocatorias/documentos_convocatoria.

    atributos:
        * int : id_documento_conv Identificador único del registro de documento.
        * int : id_convocatoria Identificador de la convocatoria asociada.
        * str : nombre_documento Título legible para mostrar en la interfaz de usuario.
        * str : nombre_archivo Nombre físico del archivo en Storage (slug, sin tildes ni espacios).
        * str : tipo_instrumento Categoría (Disposiciones, Rúbrica, Formulario, Plantilla, Formato Aval).
        * str : extension Extensión del archivo (pdf, docx, xlsx, pptx).
        * str : file_url URL pública del archivo en Supabase Storage.
        * int : orden Posición ordinal recomendada para el despliegue en la interfaz.
        * str : version Versión del instrumento (por defecto '1.0').
        * Optional[int] : tamano_bytes Tamaño del archivo en bytes.
        * Optional[str] : mime_type Tipo MIME del archivo.
    """
    id_documento_conv: int
    id_convocatoria: int
    nombre_documento: str
    nombre_archivo: str
    tipo_instrumento: str
    extension: str
    file_url: str
    orden: int
    version: str = "1.0"
    tamano_bytes: Optional[int] = None
    mime_type: Optional[str] = None


# ----------------------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------------------


@router.get("/totalConvocatorias", response_model=list[ConvocatoriaOut])
def obtener_convocatorias(
    conn: Connection = Depends(get_conn),
):
    """
    Obtener la lista completa de convocatorias registradas en la base de datos.

    Ejecuta un SELECT sobre la tabla 'convocatorias' y mapea cada registro hacia ConvocatoriaOut,
    ordenándolas por su identificador.

    parametros:
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[ConvocatoriaOut] : convocatorias Lista de objetos ConvocatoriaOut listos para la Pantalla 04.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Extrae todas las convocatorias históricas y vigentes ordenadas por ID ascendente.
        cur.execute("SELECT * FROM convocatorias ORDER BY id_convocatoria ASC")
        filas = cur.fetchall()

    return [
        ConvocatoriaOut(
            id_convocatoria=fila["id_convocatoria"],
            nombre=fila["nombre"],
            descripcion=fila.get("descripcion"),
            fecha_inicio=fila["fecha_inicio"],
            fecha_cierre=fila["fecha_cierre"],
            fecha_inicio_ejecucion=fila["fecha_inicio_ejecucion"],
            activo=fila["activo"],
        )
        for fila in filas
    ]


@router.get("/etapas_convocatorias", response_model=list[ConvocatoriaEtapaOut])
def obtener_etapas_por_convocatoria(
    id_convocatoria: int = Query(..., description="ID de la convocatoria"),
    conn: Connection = Depends(get_conn),
):
    """
    Consultar el cronograma oficial de etapas de una convocatoria específica.

    Filtra la tabla 'convocatoria_etapas' por el ID de la convocatoria y las retorna ordenadas
    por la columna 'orden' para reflejar la secuencia cronológica del proceso.

    parametros:
        - int : id_convocatoria Identificador de la convocatoria a consultar.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[ConvocatoriaEtapaOut] : etapas Lista de las etapas con fechas y responsables para la Pantalla 05.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Consulta las etapas cronológicas filtradas por convocatoria y ordenadas por secuencia.
        cur.execute(
            """
            SELECT * FROM convocatoria_etapas
            WHERE id_convocatoria = %s
            ORDER BY orden ASC
            """,
            (id_convocatoria,),
        )
        filas = cur.fetchall()

    return [
        ConvocatoriaEtapaOut(
            id_etapa=fila["id_etapa"],
            id_convocatoria=fila["id_convocatoria"],
            nombre_etapa=fila["nombre_etapa"],
            responsable=fila["responsable"],
            fecha_inicio=fila["fecha_inicio"],
            fecha_fin=fila["fecha_fin"],
            orden=fila["orden"],
        )
        for fila in filas
    ]


@router.get("/documentos_convocatoria", response_model=list[ConvocatoriaDocumentoOut])
def obtener_documentos_convocatoria(
    id_convocatoria: int = Query(..., description="ID de la convocatoria"),
    conn: Connection = Depends(get_conn),
):
    """
    Listar los instrumentos y documentos normativos activos de una convocatoria.

    Lee la tabla 'convocatoria_documentos' (única fuente de verdad). Cada registro incluye la URL
    pública del archivo en Supabase Storage, lista para el visor del frontend. Si la convocatoria no
    tiene documentos devuelve una lista vacía.

    parametros:
        - int : id_convocatoria Identificador de la convocatoria a consultar.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[ConvocatoriaDocumentoOut] : documentos Instrumentos ordenados para la Pantalla 05.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Solo documentos activos; los reemplazados se marcan activo = false en vez de borrarse.
        cur.execute(
            """
            SELECT id_documento_conv, id_convocatoria, nombre_documento,
                   nombre_archivo, tipo_instrumento, extension, file_url, orden,
                   version, tamano_bytes, mime_type
            FROM convocatoria_documentos
            WHERE id_convocatoria = %s AND activo
            ORDER BY orden ASC, id_documento_conv ASC
            """,
            (id_convocatoria,),
        )
        filas = cur.fetchall()

    return [ConvocatoriaDocumentoOut(**f) for f in filas]


@router.post(
    "/documentos_convocatoria",
    response_model=ConvocatoriaDocumentoOut,
    status_code=201,
)
def subir_documento_convocatoria(
    id_convocatoria: int = Form(...),
    nombre_documento: str = Form(...),
    tipo_instrumento: str = Form(...),
    orden: Optional[int] = Form(None),
    version: str = Form("1.0"),
    archivo: UploadFile = File(...),
    conn: Connection = Depends(get_conn),
):
    """
    Subir un instrumento a Supabase Storage y registrarlo en 'convocatoria_documentos'.

    El archivo se guarda en <convocatoria>/documentos/<nombre-archivo-seguro>. Si la convocatoria
    todavía no tiene carpeta asignada, se calcula a partir de su título y se persiste. Si el registro en
    la base de datos falla después de subir el archivo, este se elimina de Storage para no dejar huérfanos.

    parametros:
        - int : id_convocatoria Convocatoria a la que pertenece el documento.
        - str : nombre_documento Título legible para la interfaz.
        - str : tipo_instrumento Categoría (Disposiciones, Rúbrica, Formulario, Plantilla, Formato Aval).
        - Optional[int] : orden Posición en la lista; si se omite se agrega al final.
        - str : version Versión del instrumento (por defecto '1.0').
        - UploadFile : archivo Archivo a subir (pdf, docx, xlsx o pptx, máximo 20 MB).
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + ConvocatoriaDocumentoOut : documento Registro creado, con su URL pública.
    """
    # 1) Validar formato y tamaño antes de tocar Storage
    nombre_archivo = nombre_archivo_seguro(archivo.filename or "")
    extension = os.path.splitext(nombre_archivo)[1].lstrip(".")
    mime = MIME_POR_EXTENSION.get(extension)
    if not mime:
        raise HTTPException(400, "Formato no permitido. Usa PDF, DOCX, XLSX o PPTX.")

    contenido = archivo.file.read(MAX_BYTES + 1)
    if not contenido:
        raise HTTPException(400, "El archivo está vacío.")
    if len(contenido) > MAX_BYTES:
        raise HTTPException(413, f"El archivo supera el máximo de {MAX_BYTES // 1048576} MB.")

    url, key = config_storage()

    with conn.cursor() as cur:
        # 2) Resolver la carpeta de la convocatoria (se asigna una sola vez)
        carpeta = resolver_carpeta_convocatoria(cur, id_convocatoria)

        if orden is None:
            cur.execute(
                "SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente "
                "FROM convocatoria_documentos WHERE id_convocatoria = %s",
                (id_convocatoria,),
            )
            orden = cur.fetchone()["siguiente"]

        # [Línea clave]: Los instrumentos de la convocatoria viven en su subcarpeta 'documentos'.
        storage_path = ruta_documento_convocatoria(carpeta, nombre_archivo)
        file_url = f"{url}/storage/v1/object/public/{BUCKET}/{storage_path}"

        # 3) Subir el archivo (x-upsert=false: nunca pisa un archivo existente)
        estado, detalle = subir_archivo(url, key, storage_path, contenido, mime)
        if estado == 0:
            conn.rollback()
            raise HTTPException(502, "No se pudo contactar a Supabase Storage.")

        if estado >= 400:
            conn.rollback()
            if "Duplicate" in detalle or estado == 409:
                raise HTTPException(
                    409, f"Ya existe un archivo llamado '{nombre_archivo}' en esta convocatoria."
                )
            raise HTTPException(502, f"Storage rechazó el archivo: {detalle}")

        # [Línea clave]: El marcador deja visible la carpeta 'documentos' en el panel de Supabase.
        asegurar_marcador(url, key, carpeta, SUBCARPETA_DOCUMENTOS)

        # 4) Registrar la fila; si falla, se limpia el archivo recién subido
        try:
            cur.execute(
                """
                INSERT INTO convocatoria_documentos
                  (id_convocatoria, nombre_documento, nombre_archivo, tipo_instrumento,
                   extension, storage_path, file_url, orden, mime_type, tamano_bytes, version)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id_documento_conv, id_convocatoria, nombre_documento,
                          nombre_archivo, tipo_instrumento, extension, file_url, orden,
                          version, tamano_bytes, mime_type
                """,
                (
                    id_convocatoria, nombre_documento, nombre_archivo, tipo_instrumento,
                    extension, storage_path, file_url, orden, mime, len(contenido), version,
                ),
            )
            nuevo = cur.fetchone()
            conn.commit()
        except Exception:
            conn.rollback()
            borrar_archivo(url, key, storage_path)
            raise HTTPException(500, "No se pudo registrar el documento en la base de datos.")

    return ConvocatoriaDocumentoOut(**nuevo)