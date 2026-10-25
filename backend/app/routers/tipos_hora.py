from fastapi import APIRouter, Depends
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

router = APIRouter(prefix="/tipos_hora", tags=["tipos_hora"])


class TipoHoraOut(BaseModel):
    id: int
    nombre: str


@router.get("/totalTiposHora", response_model=list[TipoHoraOut])
def obtener_tipos_hora(
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id_tipo_hora, nombre_tipo_hora
            FROM tipos_hora
            ORDER BY id_tipo_hora ASC
            """
        )
        filas = cur.fetchall()

    return [
        TipoHoraOut(
            id=fila["id_tipo_hora"],
            nombre=fila["nombre_tipo_hora"],
        )
        for fila in filas
    ]

