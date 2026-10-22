from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel
from datetime import datetime

from ..db import get_conn

router = APIRouter(prefix="/escuelas", tags=["escuelas"])

class escuelas(BaseModel):
    id : int
    nombre : str
    siglas : str

@router.get("/totalescuelas", response_model=list[escuelas])
def obtener_escuelas(
    id_usuario: int = Query(..., description="ID del usuario a consultar"),
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            select e.*
            from escuelas e
            join usuarios u on u.id_escuela = e.id_escuela
            where u.id_usuario = %s
            """,
            (id_usuario,),
        )
        filas = cur.fetchall()

    return [
        escuelas(
            id=fila["id_escuela"],
            nombre=fila["nombre"],
            siglas=fila["siglas"],
        )
        for fila in filas
    ]