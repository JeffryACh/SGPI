import os

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://sgpi:sgpi_dev@localhost:5432/sgpi")

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