from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import pool
from .routers import catalogos, propuestas


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open()
    yield
    pool.close()


app = FastAPI(title="SGPI API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

app.include_router(catalogos.router)
app.include_router(propuestas.router)


@app.get("/health")
def health():
    try:
        with pool.connection() as conn:
            conn.execute("SELECT 1")
        return {"status": "ok"}
    except Exception:
        return JSONResponse({"status": "db_unavailable"}, status_code=503)


# Errores de PostgreSQL más comunes -> respuestas HTTP claras
@app.exception_handler(psycopg.errors.ForeignKeyViolation)
async def fk_error(_: Request, __):
    return JSONResponse({"error": "Referencia inválida (llave foránea)"}, status_code=400)


@app.exception_handler(psycopg.errors.UniqueViolation)
async def unique_error(_: Request, __):
    return JSONResponse({"error": "Registro duplicado"}, status_code=409)


@app.exception_handler(psycopg.errors.NotNullViolation)
async def notnull_error(_: Request, __):
    return JSONResponse({"error": "Falta un campo obligatorio"}, status_code=400)