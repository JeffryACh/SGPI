"""
========================================================================================
ARCHIVO: backend/app/routers/modalidades.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Proveer el catálogo de modalidades oficiales de la convocatoria Fondos VIE 2027
    (Actividad de fortalecimiento, Investigación básica/aplicada y Desarrollo tecnológico),
    incluyendo sus topes presupuestarios anuales y duraciones máximas.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta la tabla 'public.modalidades' en Supabase.
           - Utiliza la conexión activa de 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Envía la lista de modalidades al Frontend para poblar las tarjetas de selección
             en la Pantalla 07 (Nueva propuesta) y las reglas de validación presupuestaria en Pantalla 15.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Implementa el endpoint GET /modalidades/totalmodalidades filtrando las modalidades activas
    mediante 'COALESCE(activo, true) = true' y aportando valores por defecto seguros para prevenir
    fallos de serialización en caso de columnas nulas (solucionando el Desajuste #2).
========================================================================================
"""

from typing import Optional
from fastapi import APIRouter, Depends
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

# [Línea clave]: Declara el router bajo el prefijo /modalidades para agrupar las rutas de tipos de financiamiento.
router = APIRouter(prefix="/modalidades", tags=["modalidades"])


class ModalidadOut(BaseModel):
    """
    Modelo de respuesta que describe las características normativas de una modalidad de investigación.

    Serializa el identificador, nombre, descripción, duración máxima y monto de financiamiento tope.

    Se utiliza como response_model en el endpoint GET /modalidades/totalmodalidades.

    atributos:
        * int : id Identificador único de la modalidad (id_modalidad).
        * str : titulo Nombre normativo oficial de la modalidad (ej. Desarrollo tecnológico).
        * Optional[str] : descripcion Explicación del alcance de la modalidad.
        * Optional[str] : duracion Plazo máximo permitido por convocatoria (ej. Hasta 3 años).
        * Optional[float] : monto Monto máximo de financiamiento anual permitido.
        * bool : activo Bandera que indica si la modalidad se encuentra abierta para postulación.
    """
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
    """
    Obtener las modalidades activas de la convocatoria Fondos VIE 2027.

    Ejecuta un SELECT sobre la tabla 'modalidades' filtrando por estado activo y retornando
    los campos normativos requeridos para que la interfaz aplique las validaciones condicionales
    (ej. dictamen obligatorio de vinculación para Desarrollo Tecnológico).

    parametros:
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[ModalidadOut] : lista_modalidades Lista de modalidades para renderizar las tarjetas en Pantalla 07.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Consulta únicamente modalidades activas ordenadas por identificador ascendente.
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
