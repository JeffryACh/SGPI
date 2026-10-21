import os

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "Falta DATABASE_URL. Copia .env.example a .env y completa tus datos de Supabase."
    )

pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=10,
    kwargs={"row_factory": dict_row},
    open=False,
)

def get_conn():
    """Dependencia de FastAPI: una conexión por request.
    Hace COMMIT al terminar bien y ROLLBACK si hay una excepción,
    así cada endpoint que escribe es una transacción atómica."""
    with pool.connection() as conn:
        yield conn