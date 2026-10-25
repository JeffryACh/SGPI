"""
========================================================================================
ARCHIVO: backend/app/routers/notificaciones.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Gestionar el ciclo de vida de las notificaciones dirigidas a los usuarios del SGPI,
    permitiendo su consulta cronológica y la persistencia de lectura (individual o masiva) en base de datos.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta y actualiza la tabla 'public.notificaciones' en Supabase (alimentada además
             por el trigger automático 'trg_notify_proposal_state_change' ante cambios de estado).
           - Recibe el parámetro 'id_usuario' o 'id_notificacion' desde las llamadas fetch en 'frontend/js/app.js'.
           - Utiliza la conexión activa de 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Retorna listas de notificaciones formateadas para alimentar la campana de alertas
             del encabezado y el panel central en la Pantalla 03 (Notificaciones).

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Expone endpoints para listar las notificaciones ordenadas por fecha descendente ('/notificaciones'),
    marcar una notificación individual como leída con marca temporal actual ('/{id}/leer'), y
    marcar todas las notificaciones pendientes de un usuario en un solo lote ('/leer-todas').
========================================================================================
"""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

# [Línea clave]: Declara el router bajo el prefijo /notificaciones para agrupar las rutas de alertas del sistema.
router = APIRouter(prefix="/notificaciones", tags=["notificaciones"])


class Notificacion(BaseModel):
    """
    Modelo de respuesta que representa una notificación institucional dirigida a un usuario.

    Serializa el identificador, propuesta asociada, categoría, título, mensaje, marca temporal
    de creación y estado de lectura con su fecha de visualización.

    Se utiliza como response_model en el endpoint GET /notificaciones/notificaciones.

    atributos:
        * int : id_notificacion Identificador único de la notificación en la base de datos.
        * Optional[int] : id_propuesta Identificador opcional de la propuesta vinculada al evento.
        * str : tipo Categoría de la notificación (tramite, convocatoria, seguimiento, sistema).
        * str : titulo Encabezado breve para despliegue en la lista de notificaciones.
        * str : mensaje Cuerpo descriptivo detallado del evento notificado.
        * datetime : fecha_creacion Marca temporal en que fue generada la notificación.
        * bool : leida Bandera booleana que indica si el usuario ya visualizó la notificación.
        * Optional[datetime] : fecha_lectura Momento exacto en que la notificación fue marcada como leída.
    """
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
    """
    Obtener el historial cronológico de notificaciones de un usuario específico.

    Ejecuta un SELECT sobre la tabla 'notificaciones' filtrando por 'id_usuario' y ordenando
    por 'fecha_creacion' de forma descendente (más recientes primero).

    parametros:
        - int : id_usuario Identificador del usuario propietario de las notificaciones.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[Notificacion] : lista_notif Lista de objetos Notificacion para renderizar en la Pantalla 03.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Consulta las notificaciones del usuario ordenadas de más reciente a más antigua.
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
    Marcar una notificación específica como leída registrando la marca de tiempo actual.

    Ejecuta un UPDATE sobre la tabla 'notificaciones' estableciendo 'leida = true' y
    'fecha_lectura = NOW()' para el identificador suministrado. Si no existe, lanza un HTTP 404.

    parametros:
        - int : id_notificacion Identificador único de la notificación a actualizar.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + dict : resultado Diccionario {"ok": True, "id_notificacion": X, "leida": True}.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Actualiza el estado de lectura y estampa la hora exacta del servidor en PostgreSQL.
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
    Marcar en lote todas las notificaciones pendientes de un usuario como leídas.

    Ejecuta un UPDATE masivo en 'notificaciones' para todas las filas donde 'id_usuario = %s'
    y 'leida = false', asignando 'leida = true' y 'fecha_lectura = NOW()'.

    parametros:
        - int : id_usuario Identificador del usuario cuyas notificaciones se actualizarán.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + dict : resultado Diccionario con bandera de éxito y la cantidad total de notificaciones actualizadas.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Realiza la actualización masiva de lectura para limpiar el contador de no leídas en el Frontend.
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
