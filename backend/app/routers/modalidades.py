from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel
from datetime import datetime

from ..db import get_conn

router = APIRouter(prefix="/modalidades", tags=["modalidades"])

class modalidad(BaseModel):
    id: int
    titulo: str
    descripcion: str
    duracion: str
    monto: float
    activo: bool

@router.get("/totalmodalidades", response_model=list[modalidad])
def obtener_dashboard_propuestas(
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            select * from modalidades
            where modalidades.activo = true
            """,
        )
        filas = cur.fetchall()

    return [
        modalidad(
            id=fila["id_modalidad"],
            titulo=fila["nombre_modalidad"],
            descripcion=fila["descripcion"],
            duracion=fila["duracion_maxima"],
            monto=fila["monto_financiamiento"],
            activo=fila["activo"]
        )
        for fila in filas
    ]