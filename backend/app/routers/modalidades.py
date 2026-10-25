from typing import Optional
from fastapi import APIRouter, Depends
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

router = APIRouter(prefix="/modalidades", tags=["modalidades"])


class ModalidadOut(BaseModel):
    id: int
    titulo: str
    descripcion: Optional[str] = None
    duracion: Optional[str] = None
    monto: Optional[float] = None
    activo: bool = True


@router.get("/totalmodalidades", response_model=list[ModalidadOut])
def obtener_modalidades(
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        # Consultar modalidades activas (o todas si activo es null)
        cur.execute(
            """
            SELECT id_modalidad, nombre_modalidad, descripcion,
                   duracion_maxima, monto_financiamiento,
                   COALESCE(activo, true) AS activo
            FROM modalidades
            WHERE COALESCE(activo, true) = true
            ORDER BY id_modalidad ASC
            """
        )
        filas = cur.fetchall()

    return [
        ModalidadOut(
            id=fila["id_modalidad"],
            titulo=fila["nombre_modalidad"],
            descripcion=fila.get("descripcion") or "",
            duracion=fila.get("duracion_maxima") or "Hasta 2 años",
            monto=float(fila["monto_financiamiento"]) if fila.get("monto_financiamiento") is not None else 4000000.0,
            activo=bool(fila.get("activo", True)),
        )
        for fila in filas
    ]
