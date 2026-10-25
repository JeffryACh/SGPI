"""
========================================================================================
ARCHIVO: backend/app/routers/tipos_hora.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Proveer el catálogo de tipos de hora institucionales del TEC normados por las Disposiciones
    Fondos VIE 2027 (Sección 1.2): VIE, VIE-Centros, CONS, REC, DOC y VIESA.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta la tabla 'public.tipos_hora' en Supabase.
           - Utiliza la conexión activa de 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Envía la lista de tipos de hora al Frontend para poblar el selector de asignación
             horaria del equipo investigador en la Pantalla 09 ('teamForm').

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Implementa el endpoint GET /tipos_hora/totalTiposHora consultando la base de datos para que
    el usuario investigador pueda asignar el tipo de carga horaria adecuado para cada miembro
    del equipo, permitiendo validar la regla de horas mínimas y procedencia del tiempo docente.
========================================================================================
"""

from fastapi import APIRouter, Depends
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn

# [Línea clave]: Declara el router bajo el prefijo /tipos_hora para agrupar las rutas de horas institucionales.
router = APIRouter(prefix="/tipos_hora", tags=["tipos_hora"])


class TipoHoraOut(BaseModel):
    """
    Modelo de respuesta que representa un tipo de hora de financiamiento de investigación.

    Serializa el identificador numérico y el nombre/sigla del tipo de hora institucional.

    Se utiliza como response_model en el endpoint GET /tipos_hora/totalTiposHora.

    atributos:
        * int : id Identificador único del tipo de hora (id_tipo_hora).
        * str : nombre Nombre o sigla institucional del tipo de hora (VIE, CONS, REC, DOC, etc.).
    """
    id: int
    nombre: str


@router.get("/totalTiposHora", response_model=list[TipoHoraOut])
def obtener_tipos_hora(
    conn: Connection = Depends(get_conn),
):
    """
    Obtener todos los tipos de hora institucionales reconocidos por la VIE.

    Ejecuta un SELECT sobre la tabla 'tipos_hora' ordenando por 'id_tipo_hora' ascendente
    y mapea cada registro hacia una instancia de TipoHoraOut.

    parametros:
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[TipoHoraOut] : lista_tipos_hora Lista de tipos de hora para alimentar el formulario de equipo.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Consulta los tipos de hora oficiales ordenados por identificador ascendente.
        cur.execute(
            """
            SELECT id_tipo_hora, nombre_tipo_hora
            FROM tipos_hora
            ORDER BY id_tipo_hora ASC
            """
        )
        filas = cur.fetchall()

    return [
        TipoHoraOut(
            id=fila["id_tipo_hora"],
            nombre=fila["nombre_tipo_hora"],
        )
        for fila in filas
    ]
