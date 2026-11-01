"""
========================================================================================
ARCHIVO: backend/app/main.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Actuar como punto de entrada (servidor web y orquestador) de la aplicación FastAPI
    para el Sistema de Gestión de Propuestas de Investigación (SGPI).

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Recibe peticiones HTTP (GET, POST, PATCH) provenientes del Frontend (navegador / Nginx en localhost:8080)
             o clientes de pruebas automatizadas como 'test_endpoints.ps1'.
           - Importa el pool de conexiones de 'app.db'.
           - Importa los submódulos de endpoints desde 'app.routers'.
    2.2.2. A dónde envía datos:
           - Enruta las solicitudes entrantes hacia los routers especializados:
             auth, propuestas, vinculacion, notificaciones, modalidades, escuelas,
             lineas_de_investigacion, convocatorias, tipos_hora y catalogos.
           - Retorna respuestas serializadas en formato JSON y códigos de estado HTTP a los clientes web.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Configura la instancia principal de FastAPI, define las políticas de intercambio de recursos de
    origen cruzado (CORS), gestiona el ciclo de vida del servidor (abriendo el pool de base de datos
    al iniciar y cerrándolo al apagar), expone el endpoint '/health' para monitoreo, mapea manejadores
    globales para excepciones comunes de PostgreSQL (FK, Unique, Not Null) y monta todos los routers del sistema.
========================================================================================
"""

from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

# [Línea clave]: Importa el pool de conexiones centralizado para controlar su ciclo de vida al arrancar/apagar el servidor.
from .db import pool
# [Línea clave]: Importa todos los controladores de endpoints del sistema para ser registrados en la aplicación FastAPI.
from .routers import (
    auth,
    propuestas,
    notificaciones,
    modalidades,
    escuelas,
    lineas_de_investigacion,
    convocatorias,
    tipos_hora,
    catalogos,
    ia,
    vinculacion,
    comite,
    consejo,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """
    Administrar el ciclo de vida (startup y shutdown) del servidor FastAPI y los recursos compartidos.

    Abre el pool de conexiones hacia Supabase al recibir la señal de inicio de Uvicorn, cede el control
    a la aplicación mientras está atendiendo solicitudes ('yield'), y cierra el pool de conexiones
    de manera limpia cuando el contenedor o proceso se apaga.

    parametros:
        - FastAPI : _ Instancia de la aplicación FastAPI proporcionada por el contexto del framework.

    return:
        + None : yield Generador asíncrono que mantiene vivo el ciclo de vida del servidor.
    """
    # [Línea clave]: Abre los sockets del pool hacia PostgreSQL en Supabase antes de aceptar la primera petición HTTP.
    pool.open()
    yield
    # [Línea clave]: Cierra ordenadamente todas las conexiones activas al detener el servidor para evitar conexiones huérfanas.
    pool.close()


# [Línea clave]: Inicializa la aplicación FastAPI asociando metadatos y el gestor de ciclo de vida 'lifespan'.
app = FastAPI(title="SGPI API", version="1.0.0", lifespan=lifespan)

# [Línea clave]: Habilita CORS permisivo para que el frontend servido en Nginx (puerto 8080) consuma la API (puerto 3001).
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
# [Línea clave]: Comprime respuestas JSON mayores a 500 bytes para reducir el tiempo de descarga del expediente y catálogos.
app.add_middleware(GZipMiddleware, minimum_size=500)

# [Línea clave]: Monta el router de autenticación para login de usuarios institucionales.
app.include_router(auth.router)
# [Línea clave]: Monta la bandeja y el dictamen de Vinculación antes de la ruta dinámica
# /propuestas/{id_propuesta} para que /propuestas/bandeja resuelva correctamente.
app.include_router(vinculacion.router)
# [Línea clave]: Monta la bandeja, la rúbrica y el dictamen del Comité Técnico antes de las
# rutas dinámicas de propuestas para que /propuestas/comite/... resuelva correctamente.
app.include_router(comite.router)
# [Línea clave]: Monta la bandeja y el aval del Consejo de Escuela antes de las rutas
# dinámicas de propuestas para que /propuestas/consejo/... resuelva correctamente.
app.include_router(consejo.router)
# [Línea clave]: Monta el router de propuestas (dashboard, creación atómica, expediente, cambios de estado y evaluaciones).
app.include_router(propuestas.router)
# [Línea clave]: Monta el router de notificaciones y marcado de lectura en base de datos.
app.include_router(notificaciones.router)
# [Línea clave]: Monta el router de modalidades de la convocatoria Fondos VIE 2027.
app.include_router(modalidades.router)
# [Línea clave]: Monta el router de escuelas del TEC para formularios y filtros históricos.
app.include_router(escuelas.router)
# [Línea clave]: Monta el router de líneas de investigación institucionales.
app.include_router(lineas_de_investigacion.router)
# [Línea clave]: Monta el router de convocatorias, etapas cronológicas e instrumentos oficiales descargables.
app.include_router(convocatorias.router)
# [Línea clave]: Monta el router de tipos de horas oficiales VIE 2027 (VIE, CONS, REC, DOC, etc.).
app.include_router(tipos_hora.router)
# [Línea clave]: Monta el router de catálogos consolidados en una única petición HTTP.
app.include_router(catalogos.router)
# [Línea clave]: Monta el router de Inteligencia Artificial (Gemini Free Tier) para evaluaciones preliminares de referencia.
app.include_router(ia.router)


@app.get("/health")
def health():
    """
    Proveer un punto de comprobación de salud (Health Check) que valide la conectividad en vivo con Supabase.

    Intenta obtener una conexión del pool y ejecutar una consulta trivial 'SELECT 1'. Si tiene éxito
    retorna 200 con status 'ok'. Si la base de datos no responde o la red falla, captura la excepción
    y responde con código HTTP 503 (Service Unavailable) y status 'db_unavailable'.

    parametros:
        (No recibe parámetros)

    return:
        + dict / JSONResponse : response Diccionario {"status": "ok"} o JSONResponse con status 503.
    """
    try:
        # [Línea clave]: Prueba la disponibilidad real de la base de datos en la nube antes de confirmar estado saludable.
        with pool.connection() as conn:
            conn.execute("SELECT 1")
        return {"status": "ok"}
    except Exception:
        # [Línea clave]: Reporta fallo de base de datos con código 503 para que Docker o monitores detecten indisponibilidad.
        return JSONResponse({"status": "db_unavailable"}, status_code=503)


# =====================================================================
# MANEJADORES GLOBALES DE EXCEPCIONES DE POSTGRESQL
# =====================================================================

@app.exception_handler(psycopg.errors.ForeignKeyViolation)
async def fk_error(_: Request, __):
    """
    Interceptar violaciones de llave foránea en PostgreSQL y convertirlas en una respuesta HTTP 400 amigable.

    Captura la excepción ForeignKeyViolation cuando un endpoint intenta relacionar un ID inexistente
    (ej. escuela o modalidad no registrada) y responde con un mensaje claro en formato JSON.

    parametros:
        - Request : _ Objeto de petición entrante de FastAPI.
        - Exception : __ Instancia de la excepción ForeignKeyViolation interceptada.

    return:
        + JSONResponse : response Objeto HTTP 400 con mensaje explicativo de error de referencia.
    """
    return JSONResponse({"error": "Referencia inválida (llave foránea)"}, status_code=400)


@app.exception_handler(psycopg.errors.UniqueViolation)
async def unique_error(_: Request, __):
    """
    Interceptar violaciones de unicidad en PostgreSQL y convertirlas en una respuesta HTTP 409 (Conflict).

    Captura la excepción UniqueViolation cuando un endpoint intenta insertar un registro duplicado
    (ej. código de propuesta repetido o correo duplicado) y responde evitando que el servidor caiga en 500.

    parametros:
        - Request : _ Objeto de petición entrante de FastAPI.
        - Exception : __ Instancia de la excepción UniqueViolation interceptada.

    return:
        + JSONResponse : response Objeto HTTP 409 con mensaje de registro duplicado.
    """
    return JSONResponse({"error": "Registro duplicado"}, status_code=409)


@app.exception_handler(psycopg.errors.NotNullViolation)
async def notnull_error(_: Request, __):
    """
    Interceptar violaciones de campos obligatorios en PostgreSQL y convertirlas en una respuesta HTTP 400.

    Captura la excepción NotNullViolation cuando se omite un valor marcado como NOT NULL en la base de datos
    y devuelve una respuesta estructurada al cliente.

    parametros:
        - Request : _ Objeto de petición entrante de FastAPI.
        - Exception : __ Instancia de la excepción NotNullViolation interceptada.

    return:
        + JSONResponse : response Objeto HTTP 400 indicando la ausencia de un campo obligatorio.
    """
    return JSONResponse({"error": "Falta un campo obligatorio"}, status_code=400)
