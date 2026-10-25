"""
========================================================================================
ARCHIVO: backend/app/routers/lineas_de_investigacion.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Proveer el catálogo de líneas de investigación institucionales aprobadas por el
    Consejo de Investigación y Extensión (CIE) del TEC.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta la tabla 'public.lineas_investigacion' en Supabase.
           - Utiliza la conexión activa de 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Envía la lista de líneas temáticas al Frontend para poblar el selector en la
             Pantalla 08 (Asistente de formulación - Datos generales) y el filtro en Pantalla 29 (Histórico).

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Implementa el endpoint GET /lineas_de_investigacion/totalLineas consultando los registros
    de líneas de investigación para garantizar que las propuestas postuladas se clasifiquen
    únicamente dentro de los ejes estratégicos institucionales vigentes.
========================================================================================
"""

from fastapi import APIRouter, Depends
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

# [Línea clave]: Declara el router bajo el prefijo /lineas_de_investigacion para agrupar las rutas temáticas.
router = APIRouter(prefix="/lineas_de_investigacion", tags=["lineas_de_investigacion"])


class lineas_de_investigacion(BaseModel):
    """
    Modelo de respuesta que representa una línea de investigación institucional.

    Serializa el identificador numérico y nombre de la línea temática institucional.

    Se utiliza como response_model en el endpoint GET /lineas_de_investigacion/totalLineas.

    atributos:
        * int : id Identificador único de la línea de investigación (id_linea_investigacion).
        * str : nombre Nombre descriptivo de la línea de investigación (nombre_linea).
    """
    id: int
    nombre: str


@router.get("/totalLineas", response_model=list[lineas_de_investigacion])
def obtener_lineas_de_investigacion(
    conn: Connection = Depends(get_conn),
):
    """
    Consultar todas las líneas de investigación activas en la institución.

    Ejecuta un SELECT sobre la tabla 'lineas_investigacion' en PostgreSQL y devuelve la lista de
    registros serializados según el modelo 'lineas_de_investigacion'.

    parametros:
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[lineas_de_investigacion] : lista_lineas Lista de líneas institucionales para desplegables en UI.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Consulta todas las líneas estratégicas registradas en la base de datos de Supabase.
        cur.execute(
            """
            SELECT id_linea_investigacion, nombre_linea
            FROM lineas_investigacion
            ORDER BY nombre_linea ASC
            """
        )
        filas = cur.fetchall()

    return [
        lineas_de_investigacion(
            id=fila["id_linea_investigacion"],
            nombre=fila["nombre_linea"],
        )
        for fila in filas
    ]
