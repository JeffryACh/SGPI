from fastapi import APIRouter, Depends
from psycopg import Connection
from pydantic import BaseModel
from typing import Optional, Any

from ..db import get_conn

router = APIRouter(prefix="/catalogos", tags=["catalogos"])


class CatalogosResponse(BaseModel):
    escuelas: list[dict[str, Any]]
    modalidades: list[dict[str, Any]]
    lineas_investigacion: list[dict[str, Any]]
    tipos_hora: list[dict[str, Any]]
    rubros_presupuesto: list[dict[str, Any]]
    niveles_riesgo: list[dict[str, Any]]
    estados: list[dict[str, Any]]


@router.get("", response_model=CatalogosResponse)
def obtener_todos_catalogos(
    conn: Connection = Depends(get_conn),
):
    """
    Retorna todos los catálogos institucionales unificados en una sola llamada
    para inicializar formularios de creación, edición y filtros de búsqueda.
    """
    with conn.cursor() as cur:
        # 1. Escuelas
        cur.execute("SELECT id_escuela, nombre, siglas FROM escuelas ORDER BY nombre ASC")
        escuelas = cur.fetchall()

        # 2. Modalidades activas
        cur.execute("""
            SELECT id_modalidad, nombre_modalidad,
                   COALESCE(descripcion, '') AS descripcion,
                   COALESCE(duracion_maxima, 'Hasta 2 años') AS duracion_maxima,
                   COALESCE(monto_financiamiento, 0) AS monto_financiamiento
            FROM modalidades
            WHERE COALESCE(activo, true) = true
            ORDER BY id_modalidad ASC
        """)
        modalidades = cur.fetchall()

        # 3. Líneas de investigación
        cur.execute("SELECT id_linea_investigacion, nombre_linea FROM lineas_investigacion ORDER BY nombre_linea ASC")
        lineas = cur.fetchall()

        # 4. Tipos de hora
        cur.execute("SELECT id_tipo_hora, nombre_tipo_hora FROM tipos_hora ORDER BY id_tipo_hora ASC")
        tipos_hora = cur.fetchall()

        # 5. Rubros de presupuesto
        cur.execute("SELECT id_rubro, nombre_rubro FROM rubros_presupuesto ORDER BY id_rubro ASC")
        rubros = cur.fetchall()

        # 6. Niveles de riesgo
        cur.execute("SELECT id_nivel_riesgo, nombre_nivel FROM niveles_riesgo ORDER BY id_nivel_riesgo ASC")
        niveles = cur.fetchall()

        # 7. Estados de la convocatoria
        cur.execute("SELECT id_estado, nombre_estado FROM estados ORDER BY id_estado ASC")
        estados = cur.fetchall()

    return CatalogosResponse(
        escuelas=escuelas,
        modalidades=modalidades,
        lineas_investigacion=lineas,
        tipos_hora=tipos_hora,
        rubros_presupuesto=rubros,
        niveles_riesgo=niveles,
        estados=estados,
    )

