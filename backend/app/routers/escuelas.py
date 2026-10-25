from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel
from typing import Optional

from ..db import get_conn

router = APIRouter(prefix="/escuelas", tags=["escuelas"])

class escuelas(BaseModel):
    id: int
    nombre: str
    siglas: Optional[str] = None

@router.get("/totalescuelas", response_model=list[escuelas])
def obtener_escuelas(
    id_usuario: Optional[int] = Query(default=None, description="ID opcional del usuario para filtrar su escuela"),
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        # Si se envía id_usuario, intentar obtener la escuela de ese usuario
        if id_usuario is not None:
            cur.execute(
                """
                SELECT e.id_escuela, e.nombre, e.siglas
                FROM escuelas e
                JOIN usuarios u ON u.id_escuela = e.id_escuela
                WHERE u.id_usuario = %s
                """,
                (id_usuario,),
            )
            filas = cur.fetchall()
            # Si el usuario tiene una escuela asociada, devolverla
            if filas:
                return [
                    escuelas(
                        id=fila["id_escuela"],
                        nombre=fila["nombre"],
                        siglas=fila.get("siglas"),
                    )
                    for fila in filas
                ]

        # Si no se pasó id_usuario o el usuario no tiene escuela (p. ej. funcionarios administrativos),
        # devolver todas las escuelas para permitir filtros históricos y selección abierta
        cur.execute(
            """
            SELECT id_escuela, nombre, siglas
            FROM escuelas
            ORDER BY nombre ASC
            """
        )
        filas = cur.fetchall()

    return [
        escuelas(
            id=fila["id_escuela"],
            nombre=fila["nombre"],
            siglas=fila.get("siglas"),
        )
        for fila in filas
    ]
