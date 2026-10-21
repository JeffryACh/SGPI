from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from ..db import get_conn

router = APIRouter(prefix="/propuestas", tags=["propuestas"])


class DashboardPropuestas(BaseModel):
    total: int
    formulacion: int
    ejecucion: int
    cerradas: int

class propuestaMasReciente(BaseModel):
    id: int
    titulo: str

class Top3PropuestasRecientes(BaseModel):
    id: int
    code: str
    title: str
    tipo: str
    period: str
    status: str
    amount: float

@router.get("/dashboardpropuestas", response_model=DashboardPropuestas)
def obtener_dashboard_propuestas(
    id_usuario: int = Query(..., description="ID del usuario a consultar"),
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                count(DISTINCT p.id_propuesta) AS total,
                count(DISTINCT p.id_propuesta) FILTER (WHERE e.nombre_estado = 'En formulación') AS formulacion,
                count(DISTINCT p.id_propuesta) FILTER (WHERE e.nombre_estado = 'En ejecución')   AS ejecucion,
                count(DISTINCT p.id_propuesta) FILTER (WHERE e.nombre_estado = 'Cerrada')        AS cerradas
            FROM propuestas p
            JOIN estados e ON e.id_estado = p.estado_actual
            LEFT JOIN research_team rt ON rt.id_propuesta = p.id_propuesta
            WHERE p.id_usuario_lider = %s OR rt.id_usuario = %s;
            """,
            (id_usuario, id_usuario),
        )
        # Una consulta con count() siempre devuelve una fila (con ceros si no hay datos).
        # Si get_conn usa row_factory=dict_row, cambia fila[0] por fila["total"], etc.
        fila = cur.fetchone()

    return DashboardPropuestas(
        total=fila["total"],
        formulacion=fila["formulacion"],
        ejecucion=fila["ejecucion"],
        cerradas=fila["cerradas"],
    )

@router.get("/propuestaMasReciente", response_model = Optional[propuestaMasReciente])
def obtener_propuesta_mas_reciente(
    id_usuario: int = Query(..., description="ID del usuario a consultar"),
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 
                p.id_propuesta,
                p.titulo
            FROM propuestas p
            JOIN estados e ON e.id_estado = p.estado_actual
            LEFT JOIN research_team rt ON rt.id_propuesta = p.id_propuesta
            WHERE e.nombre_estado = 'En formulación'
            AND (p.id_usuario_lider = %s OR rt.id_usuario = %s)
            ORDER BY p.fecha_creacion DESC
            LIMIT 1;
            """,
            (id_usuario, id_usuario),
        )
        fila = cur.fetchone()
    if fila is None:
        return None
    
    return propuestaMasReciente(
        id=fila["id_propuesta"],
        titulo=fila["titulo"],
    )

@router.get("/top3PropuestaMasReciente", response_model=list[Top3PropuestasRecientes])
def obtener_propuestas_mas_reciente(
    id_usuario: int = Query(..., description="ID del usuario a consultar"),
    conn: Connection = Depends(get_conn),
):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                p.id_propuesta AS id,
                p.titulo AS title,
                m.nombre_modalidad AS type,
                e.nombre_estado AS status,
                COALESCE(SUM(pb.monto), 0) AS amount
            FROM propuestas p
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            LEFT JOIN proposal_budget pb ON pb.id_propuesta = p.id_propuesta
            WHERE p.id_usuario_lider = %s
            OR EXISTS (
                SELECT 1 FROM research_team rt
                WHERE rt.id_propuesta = p.id_propuesta AND rt.id_usuario = %s
            )
            GROUP BY p.id_propuesta, p.titulo, m.nombre_modalidad, e.nombre_estado, p.fecha_creacion
            ORDER BY p.fecha_creacion DESC;
            """,
            (id_usuario, id_usuario),
        )
        filas = cur.fetchall()

    return [
        Top3PropuestasRecientes(
            id=f["id"],
            code = "-",
            title=f["title"],
            tipo=f["type"],
            period = "-",
            status=f["status"],
            amount = f["amount"],
        )
        for f in filas
    ]