from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from ..db import get_conn

router = APIRouter(prefix="/notificaciones", tags=["notificaciones"])


class Notificacion(BaseModel):
    id_notificacion: int
    id_propuesta: Optional[int] = None
    tipo: str
    titulo: str
    mensaje: str
    fecha_creacion: datetime
    leida: bool
    fecha_lectura: Optional[datetime] = None


@router.get("/notificaciones", response_model=list[Notificacion])
def obtener_notificaciones(
    id_usuario: int = Query(..., description="ID del usuario a consultar"),
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id_notificacion, id_propuesta, tipo, titulo, mensaje,
                   fecha_creacion, leida, fecha_lectura
            FROM notificaciones
            WHERE id_usuario = %s
            ORDER BY fecha_creacion DESC
            """,
            (id_usuario,),
        )
        filas = cur.fetchall()

    return [Notificacion(**f) for f in filas]