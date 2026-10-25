"""
========================================================================================
ARCHIVO: backend/app/routers/catalogos.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Proveer un punto de acceso consolidado a todos los catálogos institucionales
    de la convocatoria Fondos VIE 2027 en una sola llamada de red HTTP.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta las tablas maestras de Supabase: 'escuelas', 'modalidades',
             'lineas_investigacion', 'tipos_hora', 'rubros_presupuesto',
             'niveles_riesgo' y 'estados'.
           - Utiliza la conexión activa de 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Envía la estructura agrupada JSON hacia el Frontend (inicializadores de formularios,
             selectores de las pantallas 07, 08, 09, 14, 15 y filtros de búsqueda de la pantalla 29).

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Ejecuta consultas concurrentes a los 7 catálogos institucionales dentro de una sola
    conexión a base de datos y retorna un objeto estructurado 'CatalogosResponse'
    evitando que el frontend deba realizar múltiples llamadas asíncronas separadas.
========================================================================================
"""

from typing import Any
from fastapi import APIRouter, Depends
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

# [Línea clave]: Declara el router bajo el prefijo /catalogos para agrupar las rutas de catálogos generales.
router = APIRouter(prefix="/catalogos", tags=["catalogos"])


class CatalogosResponse(BaseModel):
    """
    Modelo de respuesta que consolida todos los catálogos institucionales del SGPI.

    Serializa las listas de diccionarios obtenidas desde PostgreSQL organizadas por cada entidad maestra.

    Se utiliza como response_model en el endpoint GET /catalogos.

    atributos:
        * list[dict[str, Any]] : escuelas Lista de escuelas del TEC con id, nombre y siglas.
        * list[dict[str, Any]] : modalidades Lista de modalidades activas de la convocatoria VIE.
        * list[dict[str, Any]] : lineas_investigacion Lista de líneas temáticas prioritarias.
        * list[dict[str, Any]] : tipos_hora Lista de los 6 tipos de hora reconocidos por la VIE.
        * list[dict[str, Any]] : rubros_presupuesto Lista de rubros de gasto para formulación presupuestaria.
        * list[dict[str, Any]] : niveles_riesgo Lista de niveles de riesgo (probabilidad e impacto).
        * list[dict[str, Any]] : estados Lista de los 12 estados oficiales de tramitación de propuestas.
    """
    escuelas: list[dict[str, Any]]
    modalidades: list[dict[str, Any]]
    lineas_investigacion: list[dict[str, Any]]
    tipos_hora: list[dict[str, Any]]
    rubros_presupuesto: list[dict[str, Any]]
    niveles_riesgo: list[dict[str, Any]]
    estados: list[dict[str, Any]]


@router.get("", response_model=CatalogosResponse)
def obtener_todos_catalogos(
    conn: Connection = Depends(get_conn),
):
    """
    Obtener todos los catálogos institucionales del SGPI en una única petición HTTP.

    Abre un cursor sobre la conexión suministrada y ejecuta consecutivamente las consultas SELECT
    a las 7 tablas de catálogo, utilizando COALESCE para salvaguardar valores opcionales o nulos.
    Empaqueta los resultados en la estructura CatalogosResponse y los retorna.

    parametros:
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + CatalogosResponse : response Objeto con los 7 catálogos institucionales listos para poblar la interfaz.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Consulta las escuelas ordenadas alfabéticamente para desplegables y filtros.
        cur.execute("SELECT id_escuela, nombre, siglas FROM escuelas ORDER BY nombre ASC")
        escuelas = cur.fetchall()

        # [Línea clave]: Consulta las modalidades activas protegiendo contra valores nulos en montos o descripciones.
        cur.execute("""
            SELECT id_modalidad, nombre_modalidad,
                   COALESCE(descripcion, '') AS descripcion,
                   COALESCE(duracion_maxima, 'Hasta 2 años') AS duracion_maxima,
                   COALESCE(monto_financiamiento, 0) AS monto_financiamiento
            FROM modalidades
            WHERE COALESCE(activo, true) = true
            ORDER BY id_modalidad ASC
        """)
        modalidades = cur.fetchall()

        # [Línea clave]: Consulta las líneas de investigación institucionales para clasificar las propuestas.
        cur.execute("SELECT id_linea_investigacion, nombre_linea FROM lineas_investigacion ORDER BY nombre_linea ASC")
        lineas = cur.fetchall()

        # [Línea clave]: Consulta los 6 tipos de hora oficiales (VIE, CONS, REC, DOC, etc.) para el equipo de investigación.
        cur.execute("SELECT id_tipo_hora, nombre_tipo_hora FROM tipos_hora ORDER BY id_tipo_hora ASC")
        tipos_hora = cur.fetchall()

        # [Línea clave]: Consulta los rubros presupuestarios normados para el desglose financiero del proyecto.
        cur.execute("SELECT id_rubro, nombre_rubro FROM rubros_presupuesto ORDER BY id_rubro ASC")
        rubros = cur.fetchall()

        # [Línea clave]: Consulta los niveles de riesgo aplicables tanto a probabilidad como a impacto.
        cur.execute("SELECT id_nivel_riesgo, nombre_nivel FROM niveles_riesgo ORDER BY id_nivel_riesgo ASC")
        niveles = cur.fetchall()

        # [Línea clave]: Consulta el catálogo de los 12 estados oficiales de la Convocatoria Fondos VIE 2027.
        cur.execute("SELECT id_estado, nombre_estado FROM estados ORDER BY id_estado ASC")
        estados = cur.fetchall()

    # [Línea clave]: Instancia y retorna el modelo Pydantic unificado con todos los catálogos institucionales.
    return CatalogosResponse(
        escuelas=escuelas,
        modalidades=modalidades,
        lineas_investigacion=lineas,
        tipos_hora=tipos_hora,
        rubros_presupuesto=rubros,
        niveles_riesgo=niveles,
        estados=estados,
    )
