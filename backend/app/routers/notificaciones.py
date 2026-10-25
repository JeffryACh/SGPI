from fastapi import APIRouter, Depends, Query, HTTPException, status
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


@router.patch("/{id_notificacion}/leer")
def marcar_notificacion_leida(
    id_notificacion: int,
    conn: Connection = Depends(get_conn),
):
    """
    Marca una notificación específica como leída registrando la fecha y hora actual.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE notificaciones
            SET leida = true, fecha_lectura = NOW()
            WHERE id_notificacion = %s
            RETURNING id_notificacion, leida, fecha_lectura
            """,
            (id_notificacion,),
        )
        fila = cur.fetchone()
        if not fila:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Notificación con id {id_notificacion} no encontrada"
            )

    return {"ok": True, "id_notificacion": fila["id_notificacion"], "leida": fila["leida"]}


@router.patch("/leer-todas")
def marcar_todas_notificaciones_leidas(
    id_usuario: int = Query(..., description="ID del usuario propietario de las notificaciones"),
    conn: Connection = Depends(get_conn),
):
    """
    Marca como leídas todas las notificaciones pendientes de un usuario.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE notificaciones
            SET leida = true, fecha_lectura = NOW()
            WHERE id_usuario = %s AND leida = false
            RETURNING id_notificacion
            """,
            (id_usuario,),
        )
        filas = cur.fetchall()

    return {"ok": True, "total_actualizadas": len(filas)}
