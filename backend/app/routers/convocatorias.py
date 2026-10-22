from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel
from datetime import datetime

from ..db import get_conn

router = APIRouter(prefix="/convocatorias", tags=["convocatorias"])

class convocatorias(BaseModel):
    id_convocatoria : int
    nombre : str
    descripcion : str
    fecha_inicio : datetime
    fecha_cierre : datetime
    fecha_inicio_ejecucion : datetime
    activo : bool

class convocatorias_etapas(BaseModel):
    id_etapa: int
    id_convocatoria: int
    nombre_etapa: str
    responsable: str
    fecha_inicio: datetime
    fecha_fin: datetime
    orden: int

@router.get("/totalConvocatorias", response_model=list[convocatorias])
def obtener_convocatorias(
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            select * from convocatorias
            """,
        )
        filas = cur.fetchall()

    return [
        convocatorias(
            id_convocatoria=fila["id_convocatoria"],
            nombre=fila["nombre"],
            descripcion=fila["descripcion"],
            fecha_inicio=fila["fecha_inicio"],
            fecha_cierre=fila["fecha_cierre"],
            fecha_inicio_ejecucion=fila["fecha_inicio_ejecucion"],
            activo=fila["activo"]
        )
        for fila in filas
    ]

@router.get("/etapas_convocatorias", response_model=list[convocatorias_etapas])
def obtener_etapas_por_convocatoria(
    id_convocatoria: int,
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            select * from convocatoria_etapas
            where id_convocatoria = %s
            order by orden asc
            """,
            (id_convocatoria,),
        )
        filas = cur.fetchall()

    return [
        convocatorias_etapas(
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