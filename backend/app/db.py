"""
========================================================================================
ARCHIVO: backend/app/db.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Centralizar la configuración, inicialización y gestión del pool de conexiones
    hacia la base de datos PostgreSQL alojada en Supabase Cloud.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Del archivo de entorno local '.env' y variables de entorno del sistema (DATABASE_URL).
    2.2.2. A dónde envía datos:
           - Entrega conexiones transaccionales activas (Connection de psycopg 3) a los
             routers de la API (auth, propuestas, notificaciones, catalogos, convocatorias,
             escuelas, modalidades, lineas_de_investigacion, tipos_hora, ia) mediante FastAPI Depends(get_conn).
           - Envía comandos SQL directamente al servidor PostgreSQL en Supabase.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Carga las credenciales de conexión, valida la existencia de la URL de base de datos,
    instancia un ConnectionPool optimizado con factoría de filas como diccionarios (dict_row)
    y prepare_threshold=None (crucial para Supavisor/PgBouncer en modo transacción),
    y expone la función generadora 'get_conn()' que actúa como dependencia transaccional
    (haciendo COMMIT automático si todo finaliza con éxito o ROLLBACK si ocurre un error).
========================================================================================
"""

import os
from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# [Línea clave]: Carga las variables definidas en .env en el entorno de ejecución antes de leer DATABASE_URL.
load_dotenv()

# [Línea clave]: Lee la URI de conexión de Supabase para alimentar el pool de conexiones; indispensable para arrancar.
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "Falta DATABASE_URL. Copia .env.example a .env y completa tus datos de Supabase."
    )


def configure_conn(conn):
    """
    Configurar cada conexión física del pool para deshabilitar prepared statements en el servidor.

    Evita errores 'prepared statement already exists' o 'does not exist' en Supavisor / PgBouncer.

    parametros:
        - Connection : conn Conexión instanciada por psycopg 3.
    """
    conn.prepare_threshold = None


# [Línea clave]: Instancia el pool de conexiones compartidas entre 1 y 10 conexiones simultáneas con formato dict_row y prepare_threshold=None.
pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=10,
    configure=configure_conn,
    kwargs={"row_factory": dict_row, "prepare_threshold": None},
    open=False,
)


def get_conn():
    """
    Proveer una conexión transaccional única por cada solicitud HTTP que ingrese a la API.

    Solicita una conexión al pool administrado mediante un context manager ('with pool.connection()').
    Cede la conexión al endpoint mediante 'yield' para que ejecute sus consultas SQL.
    Al finalizar el bloque del endpoint, el context manager ejecuta automáticamente un COMMIT
    si la solicitud concluyó con éxito, o un ROLLBACK si se levantó alguna excepción.
    Posteriormente retorna la conexión al pool para ser reutilizada.

    parametros:
        (No recibe parámetros directos; se inyecta como dependencia de FastAPI)

    return:
        + Connection : conn Objeto de conexión activa a PostgreSQL entregado al endpoint solicitante para operar la BD.
    """
    # [Línea clave]: Inicia la sesión transaccional asegurando aislamiento ACID y liberación de recursos al finalizar.
    with pool.connection() as conn:
        conn.prepare_threshold = None
        yield conn
