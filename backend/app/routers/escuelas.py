"""
========================================================================================
ARCHIVO: backend/app/routers/escuelas.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Proveer el catálogo de escuelas y unidades académicas del Instituto Tecnológico de
    Costa Rica (TEC), soportando tanto la consulta de la escuela propia de un usuario
    como la consulta global para formularios de postulación y filtros facetados de búsqueda.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta la tabla 'public.escuelas' y la relación con 'public.usuarios' en Supabase.
           - Utiliza la conexión activa de 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Envía la lista de escuelas al Frontend para poblar los selectores en las pantallas:
             08 (Datos generales - Instancia coordinadora), 09 (Equipo - Escuelas participantes),
             y 29 (Consulta histórica - Filtro facetado por escuela).

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Implementa el endpoint GET /escuelas/totalescuelas con el parámetro opcional 'id_usuario'.
    Si se suministra 'id_usuario' y el usuario tiene una escuela asociada, retorna esa escuela;
    si no se pasa 'id_usuario' o el usuario es administrativo (sin escuela fija), retorna
    todas las escuelas del TEC ordenadas alfabéticamente (solucionando el Desajuste #5).
========================================================================================
"""

from typing import Optional
from fastapi import APIRouter, Depends, Query
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

# [Línea clave]: Declara el router bajo el prefijo /escuelas para agrupar las rutas de unidades académicas.
router = APIRouter(prefix="/escuelas", tags=["escuelas"])


class escuelas(BaseModel):
    """
    Modelo de respuesta que representa una escuela o unidad académica del TEC.

    Serializa el identificador numérico, nombre oficial y siglas institucionales de la escuela.

    Se utiliza como response_model en el endpoint GET /escuelas/totalescuelas.

    atributos:
        * int : id Identificador único de la escuela en la base de datos (id_escuela).
        * str : nombre Nombre completo oficial de la escuela (ej. Escuela de Computación).
        * Optional[str] : siglas Código o siglas institucionales (ej. COMP, BIOL, ADE).
    """
    id: int
    nombre: str
    siglas: Optional[str] = None


@router.get("/totalescuelas", response_model=list[escuelas])
def obtener_escuelas(
    id_usuario: Optional[int] = Query(default=None, description="ID opcional del usuario para filtrar su escuela"),
    conn: Connection = Depends(get_conn),
):
    """
    Obtener las escuelas del TEC, permitiendo filtrar por usuario o devolver la lista global.

    Si se recibe 'id_usuario', realiza un JOIN entre 'escuelas' y 'usuarios' para obtener la escuela
    asignada al usuario. Si no se pasa 'id_usuario' o el usuario no tiene escuela (id_escuela NULL),
    consulta y retorna todas las escuelas de la universidad ordenadas alfabéticamente por nombre.

    parametros:
        - Optional[int] : id_usuario Identificador opcional del usuario logueado.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[escuelas] : lista_escuelas Lista de objetos 'escuelas' para poblar selectores en la interfaz.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Evalúa si se solicitó filtrar específicamente por el usuario en sesión.
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
            # [Línea clave]: Si el usuario pertenece a una escuela específica, devuelve únicamente su instancia.
            if filas:
                return [
                    escuelas(
                        id=fila["id_escuela"],
                        nombre=fila["nombre"],
                        siglas=fila.get("siglas"),
                    )
                    for fila in filas
                ]

        # [Línea clave]: Resuelve el Desajuste #5: retorna todas las escuelas para permitir filtros históricos y colaboración.
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
