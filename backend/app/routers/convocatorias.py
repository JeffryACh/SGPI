"""
========================================================================================
ARCHIVO: backend/app/routers/convocatorias.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Gestionar la información de las convocatorias institucionales de la Vicerrectoría
    de Investigación y Extensión (VIE), incluyendo sus cronogramas por etapas y los
    instrumentos oficiales descargables (Disposiciones, Rúbricas, Formularios, Acuerdos).

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta las tablas 'convocatorias', 'convocatoria_etapas' y 'convocatoria_documentos' en Supabase.
           - Cuenta con una constante interna 'DOCUMENTOS_OFICIALES_FALLBACK' con los 9 instrumentos
             oficiales de la Convocatoria Fondos VIE 2027 como mecanismo de alta disponibilidad.
           - Utiliza la conexión activa de 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Envía listas estructuradas hacia el Frontend para poblar las pantallas 04 (Convocatorias),
             05 (Detalle de Convocatoria Fondos VIE 2027) y 31 (Administración de Convocatorias).

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Expone tres endpoints REST principales: '/totalConvocatorias' para listar los períodos de concurso,
    '/etapas_convocatorias' para mostrar las 11 etapas cronológicas del proceso, y
    '/documentos_convocatoria' para proveer los enlaces y metadatos de los instrumentos oficiales.
========================================================================================
"""

from datetime import date, datetime
from typing import Optional, Union

from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

# [Línea clave]: Declara el router bajo el prefijo /convocatorias para agrupar las rutas de concursos institucionales.
router = APIRouter(prefix="/convocatorias", tags=["convocatorias"])


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
        * int : orden Posición secuencial ordinal (1 a 11) dentro del proceso de concurso.
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
    Modelo de respuesta para los instrumentos y documentos normativos descargables de la convocatoria.

    Expone nombre, archivo, categoría, extensión y URL de descarga para cada instrumento oficial.

    Se utiliza como response_model en el endpoint GET /convocatorias/documentos_convocatoria.

    atributos:
        * int : id_documento_conv Identificador único del registro de documento.
        * int : id_convocatoria Identificador de la convocatoria asociada.
        * str : nombre_documento Título legible para mostrar en la interfaz de usuario.
        * str : nombre_archivo Nombre físico del archivo en el sistema de almacenamiento.
        * str : tipo_instrumento Categoría (Disposiciones, Rúbrica, Formulario, Plantilla, Formato Aval).
        * str : extension Extensión del archivo (pdf, docx, xlsx).
        * str : file_url Ruta o URL pública de descarga del archivo.
        * int : orden Posición ordinal recomendada para el despliegue en la interfaz.
    """
    id_documento_conv: int
    id_convocatoria: int
    nombre_documento: str
    nombre_archivo: str
    tipo_instrumento: str
    extension: str
    file_url: str
    orden: int


# [Línea clave]: Fallback estático con los 9 instrumentos oficiales aprobados mediante acuerdo CIE-237-2026.
DOCUMENTOS_OFICIALES_FALLBACK = [
    {
        "id_documento_conv": 1,
        "id_convocatoria": 1,
        "nombre_documento": "Oficio de Aprobación CIE-237-2026",
        "nombre_archivo": "CIE_237_2026_S_E_24_2026_art_1_Aprobacion_de_disposiciones_e_instrumentos.pdf",
        "tipo_instrumento": "Oficio",
        "extension": "pdf",
        "file_url": "/docs/CIE_237_2026.pdf",
        "orden": 1,
    },
    {
        "id_documento_conv": 2,
        "id_convocatoria": 1,
        "nombre_documento": "1. Disposiciones Convocatoria Fondos VIE 2027",
        "nombre_archivo": "1-Disposiciones Convocatoria Fondos VIE 2027.pdf",
        "tipo_instrumento": "Disposiciones",
        "extension": "pdf",
        "file_url": "/docs/1-Disposiciones Convocatoria Fondos VIE 2027.pdf",
        "orden": 2,
    },
    {
        "id_documento_conv": 3,
        "id_convocatoria": 1,
        "nombre_documento": "2. Rúbricas de Investigación 2027",
        "nombre_archivo": "2-Rúbricas_Investigación_2027__Fondos_VIE.xlsx",
        "tipo_instrumento": "Rúbrica",
        "extension": "xlsx",
        "file_url": "/docs/2-Rubricas_Investigacion_2027.xlsx",
        "orden": 3,
    },
    {
        "id_documento_conv": 4,
        "id_convocatoria": 1,
        "nombre_documento": "3. Formulario Actividad de Fortalecimiento 2027",
        "nombre_archivo": "3- Formulario Actividad Fortalecimiento Fondos VIE 2027.docx",
        "tipo_instrumento": "Formulario",
        "extension": "docx",
        "file_url": "/docs/3-Formulario_Fortalecimiento.docx",
        "orden": 4,
    },
    {
        "id_documento_conv": 5,
        "id_convocatoria": 1,
        "nombre_documento": "4. Formulario Proyecto de Investigación 2027",
        "nombre_archivo": "4- Formulario Proyecto Investigacion Fondos VIE 2027.docx",
        "tipo_instrumento": "Formulario",
        "extension": "docx",
        "file_url": "/docs/4-Formulario_Proyecto_Investigacion.docx",
        "orden": 5,
    },
    {
        "id_documento_conv": 6,
        "id_convocatoria": 1,
        "nombre_documento": "5. Plan de Acción y Gestión del Riesgo 2027",
        "nombre_archivo": "5- Plan de Acción y Gestión del Riesgo Fondos VIE 2027.xlsx",
        "tipo_instrumento": "Plantilla",
        "extension": "xlsx",
        "file_url": "/docs/5-Plan_Accion_y_Riesgo.xlsx",
        "orden": 6,
    },
    {
        "id_documento_conv": 7,
        "id_convocatoria": 1,
        "nombre_documento": "6. Plantilla de Presupuesto Convocatoria 2027",
        "nombre_archivo": "6- Plantilla Presupuesto Convocatoria Fondos VIE 2027.xlsx",
        "tipo_instrumento": "Plantilla",
        "extension": "xlsx",
        "file_url": "/docs/6-Plantilla_Presupuesto.xlsx",
        "orden": 7,
    },
    {
        "id_documento_conv": 8,
        "id_convocatoria": 1,
        "nombre_documento": "7. Formato de Acuerdo Instancia Coordinadora",
        "nombre_archivo": "7- Formato de acuerdo instancia coordinadora Fondos VIE 2027.docx",
        "tipo_instrumento": "Formato Aval",
        "extension": "docx",
        "file_url": "/docs/7-Acuerdo_Instancia_Coordinadora.docx",
        "orden": 8,
    },
    {
        "id_documento_conv": 9,
        "id_convocatoria": 1,
        "nombre_documento": "8. Formato de Acuerdo Instancia Participante",
        "nombre_archivo": "8- Formato de acuerdo instancia participante Fondos VIE 2027.docx",
        "tipo_instrumento": "Formato Aval",
        "extension": "docx",
        "file_url": "/docs/8-Acuerdo_Instancia_Participante.docx",
        "orden": 9,
    },
]


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
    por la columna 'orden' para reflejar la secuencia cronológica de 11 etapas.

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
    id_convocatoria: int = Query(1, description="ID de la convocatoria"),
    conn: Connection = Depends(get_conn),
):
    """
    Proveer los instrumentos y documentos normativos oficiales de la convocatoria para su descarga.

    Consulta en primera instancia la tabla 'convocatoria_documentos' en Supabase. Si la tabla aún
    no contiene registros o se encuentra en transición, recurre de forma resiliente a la lista
    DOCUMENTOS_OFICIALES_FALLBACK con los 9 instrumentos normativos aprobados para Fondos VIE 2027.

    parametros:
        - int : id_convocatoria Identificador de la convocatoria (por defecto 1 = Fondos VIE 2027).
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[ConvocatoriaDocumentoOut] : documentos Lista de los instrumentos oficiales con URLs de descarga.
    """
    try:
        with conn.cursor() as cur:
            # [Línea clave]: Intenta consultar los instrumentos oficiales persistidos en la base de datos de Supabase.
            cur.execute(
                """
                SELECT id_documento_conv, id_convocatoria, nombre_documento,
                       nombre_archivo, tipo_instrumento, extension, file_url, orden
                FROM convocatoria_documentos
                WHERE id_convocatoria = %s
                ORDER BY orden ASC
                """,
                (id_convocatoria,),
            )
            filas = cur.fetchall()
            if filas:
                return [ConvocatoriaDocumentoOut(**f) for f in filas]
    except Exception:
        # [Línea clave]: Captura cualquier contingencia para activar el mecanismo de alta disponibilidad por fallback.
        pass

    # [Línea clave]: Retorna los 9 instrumentos oficiales garantizados cumpliendo el Requerimiento 6 de Fondos VIE 2027.
    return [
        ConvocatoriaDocumentoOut(**doc)
        for doc in DOCUMENTOS_OFICIALES_FALLBACK
        if doc["id_convocatoria"] == id_convocatoria or id_convocatoria == 1
    ]
