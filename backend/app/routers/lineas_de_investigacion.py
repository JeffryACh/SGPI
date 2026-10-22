from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel
from datetime import datetime

from ..db import get_conn

router = APIRouter(prefix="/lineas_de_investigacion", tags=["lineas_de_investigacion"])

class lineas_de_investigacion(BaseModel):
    id : int
    nombre : str

@router.get("/totalLineas", response_model=list[lineas_de_investigacion])
def obtener_lineas_de_investigacion(
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            select * from lineas_investigacion
            """,
        )
        filas = cur.fetchall()

    return [
        lineas_de_investigacion(
            id=fila["id_linea_investigacion"],
            nombre=fila["nombre_linea"],
        )
        for fila in filas
    ]