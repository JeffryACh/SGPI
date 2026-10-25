from datetime import date, datetime
from typing import Optional, Union

from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

router = APIRouter(prefix="/convocatorias", tags=["convocatorias"])


class ConvocatoriaOut(BaseModel):
    id_convocatoria: int
    nombre: str
    descripcion: Optional[str] = None
    fecha_inicio: Union[date, datetime, str]
    fecha_cierre: Union[date, datetime, str]
    fecha_inicio_ejecucion: Union[date, datetime, str]
    activo: bool


class ConvocatoriaEtapaOut(BaseModel):
    id_etapa: int
    id_convocatoria: int
    nombre_etapa: str
    responsable: str
    fecha_inicio: Union[date, datetime, str]
    fecha_fin: Union[date, datetime, str]
    orden: int


class ConvocatoriaDocumentoOut(BaseModel):
    id_documento_conv: int
    id_convocatoria: int
    nombre_documento: str
    nombre_archivo: str
    tipo_instrumento: str
    extension: str
    file_url: str
    orden: int


# Documentos oficiales de fallback en caso de que la tabla aún no esté poblada
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
    with conn.cursor() as cur:
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
    with conn.cursor() as cur:
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
    Devuelve los instrumentos y documentos oficiales descargables de la convocatoria.
    Si la tabla convocatoria_documentos existe en la BD la consulta; si no, retorna
    la lista oficial de instrumentos de Fondos VIE 2027 como respaldo.
    """
    try:
        with conn.cursor() as cur:
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
        # En caso de que la tabla aún no exista en el esquema remoto
        pass

    # Fallback seguro con los 9 documentos de Docs Proyecto
    return [
        ConvocatoriaDocumentoOut(**doc)
        for doc in DOCUMENTOS_OFICIALES_FALLBACK
        if doc["id_convocatoria"] == id_convocatoria or id_convocatoria == 1
    ]
