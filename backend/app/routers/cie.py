"""
========================================================================================
ARCHIVO: backend/app/routers/cie.py

2.1. OBJETIVO DEL ARCHIVO:
    Implementar la bandeja, el detalle y la resolución del Comité de Ética en
    Investigación (CIE) dentro del flujo institucional de la Convocatoria Fondos VIE 2027.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta 'propuestas', 'usuarios', 'escuelas', 'modalidades',
             'lineas_investigacion', 'estados', 'evaluations', 'roles', 'user_roles',
             'resoluciones_cie', 'cie_resolution_evaluations', 'proposal_state_history',
             'notificaciones', 'proposal_documents', 'vie_dictamen_verificaciones'.
           - Usa 'app.db.get_conn' para la transacción atómica contra Supabase.
    2.2.2. A dónde envía datos:
           - Retorna la bandeja del CIE, el expediente para resolver y el resultado
             a las pantallas 02, 21, 22, 27 y 28.
           - Crea 'evaluations' con rol CIE, persiste el acuerdo en
             'cie_resolution_evaluations', cambia el estado de la propuesta
             («Dictaminada por Dirección» → «Aprobada por CIE», «Con observaciones» o
             «Rechazada»), actualiza el historial y notifica al investigador.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSOMODO?:
    Expone GET /propuestas/cie/bandeja, GET /propuestas/cie/dashboard,
    GET /propuestas/cie/{id_propuesta}, POST /propuestas/cie/{id_propuesta} y
    POST /propuestas/cie/{id_propuesta}/condiciones. Valida que la propuesta esté en
    "Dictaminada por Dirección", registra la resolución con su acuerdo vinsculado y
    ejecuta la transición controlada de estado.
========================================================================================
"""

import os
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import Connection
from pydantic import BaseModel, Field

from ..almacenamiento import BUCKET, url_publica
from ..db import get_conn
from ..estados import (
    ESTADO_APROBADA_CIE,
    ESTADO_DICTAMINADA,
    ESTADO_OBSERVACIONES,
    ESTADO_RECHAZADA,
    resolver_estado,
)
from .dictamen_vie import parsear_dictamen

# [Línea clave]: Se registra antes que propuestas.router en main.py para que las rutas
# literales /propuestas/cie/... no sean capturadas por /propuestas/{id_propuesta}.
router = APIRouter(prefix="/propuestas", tags=["cie"])

# [Línea clave]: El CIE tiene dos roles institucionales en la base: el comité colegiado
# («CIE») y el evaluador individual («Evaluador Comité de Ética (CIE)»). Ambos pueden
# resolver, igual que ocurre con Comité Técnico y su evaluador.
ROL_CIE = "CIE"
ROL_EVALUADOR_CIE = "Evaluador Comité de Ética (CIE)"
ROLES_CIE = (ROL_CIE, ROL_EVALUADOR_CIE)
ROL_DIRECCION = "Dirección de Investigación"
ROL_COMITE_TECNICO = "Comité Técnico"

# [Línea clave]: Los estados se resuelven por nombre desde 'app.estados' porque el orden de los
# identificadores en la tabla «estados» no coincide con el seed V3 en la base de datos desplegada.

# [Línea clave]: Traducción del catálogo institucional «resoluciones_cie» al estado destino
# de la propuesta. La excepción ética (4) aprueba el proyecto porque no requiere revisión.
ESTADO_POR_RESOLUCION = {
    1: ESTADO_APROBADA_CIE,
    2: ESTADO_OBSERVACIONES,
    3: ESTADO_RECHAZADA,
    4: ESTADO_APROBADA_CIE,
}

# [Línea clave]: BUCKET y url_publica se importan de 'app.almacenamiento' (bucket único institucional).


# =====================================================================
# MODELOS DE ENTRADA Y SALIDA
# =====================================================================


class ResolucionCieIn(BaseModel):
    """Datos del acuerdo emitido por el Comité de Ética en Investigación."""

    id_usuario_eval: int
    id_resolucion: int
    numero_sesion: str = Field(min_length=1)
    articulo: str = Field(min_length=1)
    fecha_resolucion: date
    fundamentacion: str = Field(min_length=1)
    condiciones: Optional[str] = ""
    id_documento: Optional[int] = None
    observaciones: Optional[str] = ""


class CondicionesCieIn(BaseModel):
    """Condiciones de aceptación registradas después de la resolución."""

    id_usuario_eval: int
    condiciones: str = Field(min_length=1)
    observaciones: Optional[str] = ""


class DocumentoPropuestaOut(BaseModel):
    """Metadatos de un documento adjunto a una propuesta."""

    id_documento: int
    id_propuesta: int
    nombre_archivo: str
    tipo_documento: str
    extension: str
    file_path: str
    file_url: str
    tamano_bytes: int
    version: str
    id_usuario_subio: int
    fecha_subida: datetime


class TipoResolucionOut(BaseModel):
    """Tipo de resolución disponible en el catálogo institucional."""

    id_resolucion: int
    nombre_resolucion: str


class ResolucionCieOut(BaseModel):
    """Resolución registrada por el CIE con los datos de su acuerdo."""

    id_evaluacion: int
    id_propuesta: int
    id_resolucion: int
    nombre_resolucion: str
    numero_sesion: str
    articulo: str
    fecha_resolucion: date
    fundamentacion: str
    condiciones: Optional[str] = None
    id_documento: Optional[int] = None
    evaluador_nombre: str
    fecha_evaluacion: datetime
    fecha_registro: Optional[datetime] = None
    observaciones: Optional[str] = None


class DictamenDireccionResumenOut(BaseModel):
    """Dictamen de Dirección que precede a la resolución del CIE."""

    id_evaluacion: int
    dictamen: Optional[str] = None
    fundamentacion: Optional[str] = None
    fecha_evaluacion: datetime
    evaluador_nombre: str


class CieDetalleOut(BaseModel):
    """Expediente para resolver una propuesta ante el CIE."""

    id_propuesta: int
    codigo: str
    titulo: str
    resumen: Optional[str] = None
    estado: str
    id_estado: int
    escuela: Optional[str] = None
    escuela_siglas: Optional[str] = None
    modalidad: Optional[str] = None
    linea_investigacion: Optional[str] = None
    lider_nombre: Optional[str] = None
    lider_correo: Optional[str] = None
    periodo: Optional[str] = None
    monto_total: float = 0
    fecha_ingreso_cie: Optional[datetime] = None
    documentos: list[DocumentoPropuestaOut] = []
    dictamen_direccion: Optional[DictamenDireccionResumenOut] = None
    resolucion_cie: Optional[ResolucionCieOut] = None
    tipos_resolucion: list[TipoResolucionOut] = []
    puede_resolver: bool = False
    motivo_bloqueo: Optional[str] = None


class CieDashboardPropuestaDestacada(BaseModel):
    """Propuesta destacada del dashboard del CIE."""

    id_propuesta: int
    codigo: str
    titulo: str
    escuela: Optional[str] = None
    escuela_siglas: Optional[str] = None
    modalidad: Optional[str] = None
    linea_investigacion: Optional[str] = None
    lider_nombre: Optional[str] = None
    monto_total: float = 0
    periodo: Optional[str] = None
    fecha_ingreso_cie: Optional[datetime] = None
    estado_actual: int
    nombre_estado: str


class CieDashboardOut(BaseModel):
    """Métricas del dashboard del CIE."""

    pendientes: int = 0
    resueltas: int = 0
    totales_revisadas: int = 0
    propuesta_destacada: Optional[CieDashboardPropuestaDestacada] = None


class CieResultadoOut(BaseModel):
    """Resultado de registrar la resolución o sus condiciones."""

    ok: bool
    id_evaluacion: Optional[int] = None
    id_propuesta: int
    estado_actual: Optional[int] = None
    nombre_estado: Optional[str] = None
    resolucion: Optional[str] = None
    mensaje: str


# =====================================================================
# UTILIDADES INTERNAS
# =====================================================================


def _url_documento(file_path: str) -> str:
    """Construir la URL pública de un documento sin romper lecturas si Storage no está configurado."""

    return url_publica(file_path, BUCKET)


def _documentos_propuesta(cur, id_propuesta: int) -> list[DocumentoPropuestaOut]:
    """Listar los documentos de una propuesta con su URL pública."""

    cur.execute(
        """
        SELECT id_documento, id_propuesta, nombre_archivo, tipo_documento, extension,
               file_path, tamano_bytes, version, id_usuario_subio, fecha_subida
        FROM proposal_documents
        WHERE id_propuesta = %s
        ORDER BY fecha_subida DESC, id_documento DESC
        """,
        (id_propuesta,),
    )
    return [
        DocumentoPropuestaOut(**{**fila, "file_url": _url_documento(fila["file_path"])})
        for fila in cur.fetchall()
    ]


def _obtener_rol_cie(cur, id_usuario: int) -> dict:
    """
    Validar que el usuario exista, esté activo y tenga un rol del CIE.

    Se aceptan el→「CIE» (comité colegiado) y el→「Evaluador Comité de Ética (CIE)»
    (evaluador individual). Los roles se comparan por nombre porque los identificadores
    difieren entre ambientes.
    """

    cur.execute(
        """
        SELECT u.id_usuario, u.nombre, u.lastname, r.id_rol, r.nombre_rol
        FROM usuarios u
        JOIN user_roles ur ON ur.id_usuario = u.id_usuario
        JOIN roles r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = %s AND u.estado_activo AND r.nombre_rol = ANY(%s)
        LIMIT 1
        """,
        (id_usuario, list(ROLES_CIE)),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(
            403,
            "El usuario no tiene un rol del Comité de Ética en Investigación (CIE).",
        )
    return fila


def _nombre_resolucion(cur, id_resolucion: int) -> str:
    """Resolver el nombre institucional de un tipo de resolución del catálogo."""

    cur.execute(
        "SELECT nombre_resolucion FROM resoluciones_cie WHERE id_resolucion = %s",
        (id_resolucion,),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(400, "El tipo de resolución indicado no existe en el catálogo.")
    return fila["nombre_resolucion"]


def _resolucion_cie(cur, id_propuesta: int) -> Optional[ResolucionCieOut]:
    """
    Recuperar la resolución vigente del CIE para una propuesta.

    La resolución es la evaluación del CIE enlazada a «cie_resolution_evaluations».
    Las filas de solo condiciones posteriores no crean un enlace nuevo, por lo que la
    última resolución real siempre es la que se devuelve.
    """

    cur.execute(
        """
        SELECT ev.id_evaluacion, ev.id_propuesta, ev.id_usuario_eval,
               ev.fecha_evaluacion, ev.observaciones,
               TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS evaluador_nombre,
               cre.id_resolucion, res.nombre_resolucion,
               cre.numero_sesion, cre.articulo, cre.fecha_resolucion,
               cre.fundamentacion, cre.condiciones, cre.id_documento,
               cre.fecha_registro
        FROM evaluations ev
        JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = ANY(%s)
        JOIN cie_resolution_evaluations cre ON cre.id_evaluacion = ev.id_evaluacion
        JOIN resoluciones_cie res ON res.id_resolucion = cre.id_resolucion
        JOIN usuarios u ON u.id_usuario = ev.id_usuario_eval
        WHERE ev.id_propuesta = %s
        ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
        LIMIT 1
        """,
        (list(ROLES_CIE), id_propuesta),
    )
    fila = cur.fetchone()
    if not fila:
        return None
    return ResolucionCieOut(
        id_evaluacion=fila["id_evaluacion"],
        id_propuesta=fila["id_propuesta"],
        id_resolucion=fila["id_resolucion"],
        nombre_resolucion=fila["nombre_resolucion"],
        numero_sesion=fila["numero_sesion"] or "",
        articulo=fila["articulo"] or "",
        fecha_resolucion=fila["fecha_resolucion"],
        fundamentacion=fila["fundamentacion"] or "",
        condiciones=fila["condiciones"],
        id_documento=fila["id_documento"],
        evaluador_nombre=fila["evaluador_nombre"],
        fecha_evaluacion=fila["fecha_evaluacion"],
        fecha_registro=fila["fecha_registro"],
        observaciones=fila["observaciones"],
    )


def _dictamen_direccion(cur, id_propuesta: int) -> Optional[DictamenDireccionResumenOut]:
    """Recuperar el dictamen de Dirección que habilita la resolución del CIE."""

    cur.execute(
        """
        SELECT ev.id_evaluacion, ev.fecha_evaluacion, ev.observaciones,
               TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS evaluador_nombre
        FROM evaluations ev
        JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = %s
        JOIN usuarios u ON u.id_usuario = ev.id_usuario_eval
        WHERE ev.id_propuesta = %s
        ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
        LIMIT 1
        """,
        (ROL_DIRECCION, id_propuesta),
    )
    fila = cur.fetchone()
    if not fila:
        return None
    datos = parsear_dictamen(fila["observaciones"])
    return DictamenDireccionResumenOut(
        id_evaluacion=fila["id_evaluacion"],
        dictamen=datos.get("dictamen"),
        fundamentacion=datos.get("fundamentacion"),
        fecha_evaluacion=fila["fecha_evaluacion"],
        evaluador_nombre=fila["evaluador_nombre"],
    )


# =====================================================================
# ENDPOINTS
# =====================================================================


@router.get("/cie/bandeja", response_model=list[dict])
def obtener_bandeja_cie(
    id_usuario: int = Query(..., description="Usuario autenticado con rol CIE"),
    rol: str = Query("CIE", description="Rol solicitado por el frontend"),
    conn: Connection = Depends(get_conn),
):
    """
    Listar las propuestas dictaminadas por Dirección que esperan resolución del CIE.

    Incluye también las ya resueltas para que el expediente conserve la trazabilidad.
    El orden es por la fecha de ingreso al estado «Dictaminada por Dirección», de la más
    reciente a la más antigua.
    """

    if rol.strip().lower() not in ("cie", "comité de ética en investigación", "comite de etica en investigacion"):
        raise HTTPException(400, "Bandeja no disponible para el rol solicitado.")

    with conn.cursor() as cur:
        _obtener_rol_cie(cur, id_usuario)
        estado_dictaminada = resolver_estado(cur, ESTADO_DICTAMINADA)

        cur.execute(
            """
            SELECT
                p.id_propuesta,
                COALESCE(p.codigo, 'SI-' || p.id_propuesta) AS codigo,
                p.titulo,
                p.resumen,
                m.nombre_modalidad AS modalidad,
                esc.nombre AS escuela,
                esc.siglas AS escuela_siglas,
                lin.nombre_linea AS linea_investigacion,
                e.nombre_estado AS estado,
                p.estado_actual AS id_estado,
                u.nombre AS lider_nombre,
                u.lastname AS lider_apellido,
                u.correo AS lider_correo,
                CASE
                    WHEN p.fecha_inicio IS NOT NULL AND p.fecha_fin IS NOT NULL
                    THEN to_char(p.fecha_inicio, 'YYYY') || '–' || to_char(p.fecha_fin, 'YYYY')
                    ELSE '2027–2028'
                END AS periodo,
                p.fecha_creacion,
                ingreso.fecha_ingreso_cie,
                COALESCE(
                    (SELECT SUM(pb.monto) FROM proposal_budget pb WHERE pb.id_propuesta = p.id_propuesta),
                    0
                )::float AS monto_total,
                (
                    SELECT tce.puntaje
                    FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = %s
                    JOIN technical_committee_evaluations tce ON tce.id_evaluacion = ev.id_evaluacion
                    WHERE ev.id_propuesta = p.id_propuesta
                    ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
                    LIMIT 1
                ) AS puntaje_comite,
                (
                    SELECT res.nombre_resolucion
                    FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = ANY(%s)
                    JOIN cie_resolution_evaluations cre ON cre.id_evaluacion = ev.id_evaluacion
                    JOIN resoluciones_cie res ON res.id_resolucion = cre.id_resolucion
                    WHERE ev.id_propuesta = p.id_propuesta
                    ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
                    LIMIT 1
                ) AS resolucion_cie
            FROM propuestas p
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            LEFT JOIN LATERAL (
                SELECT MAX(h.fecha_cambio) AS fecha_ingreso_cie
                FROM proposal_state_history h
                WHERE h.id_propuesta = p.id_propuesta
                  AND h.id_estado_nuevo = %s
            ) ingreso ON TRUE
            WHERE p.estado_actual = %s
               OR EXISTS (
                    SELECT 1
                    FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = ANY(%s)
               )
            ORDER BY COALESCE(ingreso.fecha_ingreso_cie, p.fecha_creacion) DESC, p.id_propuesta DESC
            """,
            (
                ROL_COMITE_TECNICO,
                list(ROLES_CIE),
                estado_dictaminada,
                estado_dictaminada,
                list(ROLES_CIE),
            ),
        )
        filas = cur.fetchall()
        # El frontend trabaja con un único campo de nombre; se normaliza aquí.
        for fila in filas:
            fila["lider_nombre"] = " ".join(
                parte for parte in (fila.get("lider_nombre"), fila.get("lider_apellido")) if parte
            ).strip()
            fila.pop("lider_apellido", None)
        return filas


@router.get("/cie/dashboard", response_model=CieDashboardOut)
def obtener_dashboard_cie(
    id_usuario: int = Query(..., description="Usuario autenticado con rol CIE"),
    rol: str = Query("CIE", description="Rol solicitado por el frontend"),
    conn: Connection = Depends(get_conn),
):
    """Métricas del dashboard del CIE: pendientes, resueltas y totales revisadas."""

    if rol.strip().lower() not in ("cie", "comité de ética en investigación", "comite de etica en investigacion"):
        raise HTTPException(400, "Dashboard no disponible para el rol solicitado.")

    with conn.cursor() as cur:
        _obtener_rol_cie(cur, id_usuario)
        estado_dictaminada = resolver_estado(cur, ESTADO_DICTAMINADA)

        cur.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE p.estado_actual = %s AND NOT EXISTS (
                    SELECT 1 FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = ANY(%s)
                )) AS pendientes,
                COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = ANY(%s)
                )) AS totales_revisadas,
                COUNT(*) FILTER (WHERE p.estado_actual <> %s AND EXISTS (
                    SELECT 1 FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = ANY(%s)
                )) AS resueltas
            FROM propuestas p
            """,
            (
                estado_dictaminada,
                list(ROLES_CIE),
                list(ROLES_CIE),
                estado_dictaminada,
                list(ROLES_CIE),
            ),
        )
        metricas = cur.fetchone() or {"pendientes": 0, "resueltas": 0, "totales_revisadas": 0}

        cur.execute(
            """
            SELECT
                p.id_propuesta,
                COALESCE(p.codigo, 'SI-' || p.id_propuesta) AS codigo,
                p.titulo,
                esc.nombre AS escuela,
                esc.siglas AS escuela_siglas,
                m.nombre_modalidad AS modalidad,
                lin.nombre_linea AS linea_investigacion,
                TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS lider_nombre,
                COALESCE(
                    (SELECT SUM(pb.monto) FROM proposal_budget pb WHERE pb.id_propuesta = p.id_propuesta),
                    0
                )::float AS monto_total,
                CASE
                    WHEN p.fecha_inicio IS NOT NULL AND p.fecha_fin IS NOT NULL
                    THEN to_char(p.fecha_inicio, 'YYYY') || '–' || to_char(p.fecha_fin, 'YYYY')
                    ELSE '2027–2028'
                END AS periodo,
                ingreso.fecha_ingreso_cie,
                p.estado_actual,
                e.nombre_estado
            FROM propuestas p
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            JOIN estados e ON e.id_estado = p.estado_actual
            LEFT JOIN LATERAL (
                SELECT MAX(h.fecha_cambio) AS fecha_ingreso_cie
                FROM proposal_state_history h
                WHERE h.id_propuesta = p.id_propuesta
                  AND h.id_estado_nuevo = %s
            ) ingreso ON TRUE
            WHERE p.estado_actual = %s
              AND NOT EXISTS (
                    SELECT 1 FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = ANY(%s)
              )
            ORDER BY COALESCE(ingreso.fecha_ingreso_cie, p.fecha_creacion) DESC, p.id_propuesta DESC
            LIMIT 1
            """,
            (estado_dictaminada, estado_dictaminada, list(ROLES_CIE)),
        )
        destacada = cur.fetchone()

    return CieDashboardOut(
        pendientes=int(metricas.get("pendientes") or 0),
        resueltas=int(metricas.get("resueltas") or 0),
        totales_revisadas=int(metricas.get("totales_revisadas") or 0),
        propuesta_destacada=dict(destacada) if destacada else None,
    )


@router.get("/cie/{id_propuesta}", response_model=CieDetalleOut)
def obtener_resolucion_cie(
    id_propuesta: int,
    id_usuario: int = Query(..., description="Usuario autenticado con rol CIE"),
    conn: Connection = Depends(get_conn),
):
    """Consultar el expediente de una propuesta para resolverla ante el CIE."""

    with conn.cursor() as cur:
        _obtener_rol_cie(cur, id_usuario)
        estado_dictaminada = resolver_estado(cur, ESTADO_DICTAMINADA)

        cur.execute(
            """
            SELECT p.id_propuesta, COALESCE(p.codigo, 'SI-' || p.id_propuesta) AS codigo,
                   p.titulo, p.resumen, p.estado_actual, e.nombre_estado,
                   esc.nombre AS escuela, esc.siglas AS escuela_siglas,
                   m.nombre_modalidad AS modalidad,
                   lin.nombre_linea AS linea_investigacion,
                   TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS lider_nombre,
                   u.correo AS lider_correo,
                   CASE
                       WHEN p.fecha_inicio IS NOT NULL AND p.fecha_fin IS NOT NULL
                       THEN to_char(p.fecha_inicio, 'YYYY') || '–' || to_char(p.fecha_fin, 'YYYY')
                       ELSE '2027–2028'
                   END AS periodo,
                   COALESCE(
                       (SELECT SUM(pb.monto) FROM proposal_budget pb WHERE pb.id_propuesta = p.id_propuesta),
                       0
                   )::float AS monto_total,
                   ingreso.fecha_ingreso_cie
            FROM propuestas p
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            LEFT JOIN LATERAL (
                SELECT MAX(h.fecha_cambio) AS fecha_ingreso_cie
                FROM proposal_state_history h
                WHERE h.id_propuesta = p.id_propuesta
                  AND h.id_estado_nuevo = %s
            ) ingreso ON TRUE
            WHERE p.id_propuesta = %s
            """,
            (estado_dictaminada, id_propuesta),
        )
        propuesta = cur.fetchone()
        if not propuesta:
            raise HTTPException(404, "Propuesta no encontrada.")

        cur.execute(
            "SELECT id_resolucion, nombre_resolucion FROM resoluciones_cie ORDER BY id_resolucion"
        )
        tipos_resolucion = [TipoResolucionOut(**fila) for fila in cur.fetchall()]

        documentos = _documentos_propuesta(cur, id_propuesta)
        dictamen_direccion = _dictamen_direccion(cur, id_propuesta)
        resolucion = _resolucion_cie(cur, id_propuesta)

    # [Línea clave]: Solo se puede resolver una propuesta que Dirección ya dictaminó y que
    # todavía no tiene resolución del CIE. El mensaje explica el motivo del bloqueo.
    puede_resolver = False
    motivo_bloqueo = None
    if resolucion is not None:
        motivo_bloqueo = "La propuesta ya tiene una resolución del CIE registrada."
    elif propuesta["estado_actual"] != estado_dictaminada:
        motivo_bloqueo = (
            "La propuesta no está en «Dictaminada por Dirección»; el CIE solo resuelve "
            "expedientes con dictamen favorable de esa instancia."
        )
    else:
        puede_resolver = True

    return CieDetalleOut(
        id_propuesta=propuesta["id_propuesta"],
        codigo=propuesta["codigo"],
        titulo=propuesta["titulo"],
        resumen=propuesta["resumen"],
        estado=propuesta["nombre_estado"],
        id_estado=propuesta["estado_actual"],
        escuela=propuesta["escuela"],
        escuela_siglas=propuesta["escuela_siglas"],
        modalidad=propuesta["modalidad"],
        linea_investigacion=propuesta["linea_investigacion"],
        lider_nombre=propuesta["lider_nombre"],
        lider_correo=propuesta["lider_correo"],
        periodo=propuesta["periodo"],
        monto_total=float(propuesta["monto_total"] or 0),
        fecha_ingreso_cie=propuesta["fecha_ingreso_cie"],
        documentos=documentos,
        dictamen_direccion=dictamen_direccion,
        resolucion_cie=resolucion,
        tipos_resolucion=tipos_resolucion,
        puede_resolver=puede_resolver,
        motivo_bloqueo=motivo_bloqueo,
    )


@router.post("/cie/{id_propuesta}", response_model=CieResultadoOut, status_code=201)
def registrar_resolucion_cie(
    id_propuesta: int,
    payload: ResolucionCieIn,
    conn: Connection = Depends(get_conn),
):
    """Registrar la resolución del CIE y ejecutar la transición controlada de estado."""

    with conn.cursor() as cur:
        cie = _obtener_rol_cie(cur, payload.id_usuario_eval)
        id_rol_cie = cie["id_rol"]
        estado_dictaminada = resolver_estado(cur, ESTADO_DICTAMINADA)
        nombre_resolucion = _nombre_resolucion(cur, payload.id_resolucion)
        nombre_estado_destino = ESTADO_POR_RESOLUCION.get(payload.id_resolucion)
        if not nombre_estado_destino:
            raise HTTPException(400, "El tipo de resolución indicado no tiene un estado asociado.")
        estado_destino = resolver_estado(cur, nombre_estado_destino)

        cur.execute(
            """
            SELECT id_propuesta, estado_actual, titulo, id_usuario_lider,
                   COALESCE(codigo, 'SI-' || id_propuesta) AS codigo
            FROM propuestas
            WHERE id_propuesta = %s
            FOR UPDATE
            """,
            (id_propuesta,),
        )
        propuesta = cur.fetchone()
        if not propuesta:
            raise HTTPException(404, "Propuesta no encontrada.")

        if propuesta["estado_actual"] != estado_dictaminada:
            raise HTTPException(
                409,
                "La propuesta no está dictaminada por Dirección de Investigación; "
                "el CIE no puede resolverla en este estado.",
            )

        cur.execute(
            """
            SELECT 1
            FROM evaluations ev
            JOIN roles r ON r.id_rol = ev.id_rol_evaluador
            JOIN cie_resolution_evaluations cre ON cre.id_evaluacion = ev.id_evaluacion
            WHERE ev.id_propuesta = %s AND r.nombre_rol = ANY(%s)
            """,
            (id_propuesta, list(ROLES_CIE)),
        )
        if cur.fetchone():
            raise HTTPException(409, "Ya existe una resolución registrada por el CIE.")

        if payload.id_documento is not None:
            cur.execute(
                "SELECT 1 FROM proposal_documents WHERE id_documento = %s AND id_propuesta = %s",
                (payload.id_documento, id_propuesta),
            )
            if not cur.fetchone():
                raise HTTPException(400, "El documento indicado no pertenece a la propuesta.")

        if not payload.fundamentacion.strip():
            raise HTTPException(400, "Debes registrar la fundamentación de la resolución.")
        if not payload.numero_sesion.strip() or not payload.articulo.strip():
            raise HTTPException(400, "Debes registrar la sesión y el artículo del acuerdo.")

        cur.execute(
            """
            INSERT INTO evaluations (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
            VALUES (%s, %s, %s, NOW(), %s)
            RETURNING id_evaluacion
            """,
            (
                id_propuesta,
                payload.id_usuario_eval,
                id_rol_cie,
                (payload.observaciones or "").strip() or None,
            ),
        )
        id_evaluacion = cur.fetchone()["id_evaluacion"]

        # [Línea clave]: El acuerdo colegiado queda en su propia tabla con sesión, artículo,
        # fecha, fundamentación, condiciones y el documento firmado que lo respalda.
        cur.execute(
            """
            INSERT INTO cie_resolution_evaluations
              (id_evaluacion, id_resolucion, numero_sesion, articulo, fecha_resolucion,
               fundamentacion, condiciones, id_documento, id_usuario_registro, fecha_registro)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            """,
            (
                id_evaluacion,
                payload.id_resolucion,
                payload.numero_sesion.strip(),
                payload.articulo.strip(),
                payload.fecha_resolucion,
                payload.fundamentacion.strip(),
                (payload.condiciones or "").strip() or None,
                payload.id_documento,
                payload.id_usuario_eval,
            ),
        )

        # [Línea clave]: El trigger de PostgreSQL inserta la fila del historial al cambiar
        # el estado; se reutiliza para dejar como responsable al usuario del CIE.
        cur.execute(
            "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s RETURNING estado_actual",
            (estado_destino, id_propuesta),
        )
        estado_actual = cur.fetchone()["estado_actual"]

        detalle_historial = (
            f"Resolución del Comité de Ética en Investigación. Acuerdo: {nombre_resolucion}. "
            f"Sesión {payload.numero_sesion.strip()}, artículo {payload.articulo.strip()}, "
            f"fecha {payload.fecha_resolucion.isoformat()}. {payload.fundamentacion.strip()}"
        )
        if payload.id_documento is not None:
            detalle_historial += f" Documento: {payload.id_documento}."

        cur.execute(
            """
            SELECT id_historial
            FROM proposal_state_history
            WHERE id_propuesta = %s AND id_estado_nuevo = %s
            ORDER BY fecha_cambio DESC, id_historial DESC
            LIMIT 1
            """,
            (id_propuesta, estado_destino),
        )
        fila_historial = cur.fetchone()
        if fila_historial:
            cur.execute(
                """
                UPDATE proposal_state_history
                SET id_usuario_responsable = %s, observaciones = %s, fecha_cambio = NOW()
                WHERE id_historial = %s
                """,
                (payload.id_usuario_eval, detalle_historial, fila_historial["id_historial"]),
            )
        else:
            cur.execute(
                """
                INSERT INTO proposal_state_history
                    (id_propuesta, id_estado_anterior, id_estado_nuevo,
                     id_usuario_responsable, fecha_cambio, observaciones)
                VALUES (%s, %s, %s, %s, NOW(), %s)
                """,
                (
                    id_propuesta,
                    propuesta["estado_actual"],
                    estado_destino,
                    payload.id_usuario_eval,
                    detalle_historial,
                ),
            )

        cur.execute("SELECT nombre_estado FROM estados WHERE id_estado = %s", (estado_actual,))
        nombre_estado = cur.fetchone()["nombre_estado"]

        cur.execute(
            """
            INSERT INTO notificaciones
                (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida)
            VALUES (%s, %s, 'tramite', %s, %s, NOW(), false)
            """,
            (
                propuesta["id_usuario_lider"],
                id_propuesta,
                "Propuesta resuelta por el CIE",
                f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» fue resuelta por el "
                f"Comité de Ética en Investigación con el acuerdo: {nombre_resolucion}.",
            ),
        )

    return CieResultadoOut(
        ok=True,
        id_evaluacion=id_evaluacion,
        id_propuesta=id_propuesta,
        estado_actual=estado_actual,
        nombre_estado=nombre_estado,
        resolucion=nombre_resolucion,
        mensaje=f"Resolución del CIE registrada. La propuesta quedó en «{nombre_estado}».",
    )


@router.post("/cie/{id_propuesta}/condiciones", response_model=CieResultadoOut, status_code=201)
def registrar_condiciones_cie(
    id_propuesta: int,
    payload: CondicionesCieIn,
    conn: Connection = Depends(get_conn),
):
    """
    Registrar condiciones de aceptación posteriores a la resolución del CIE.

    Las condiciones se acumulan en el acuerdo vigente y cada registro queda trazado como
    una evaluación adicional del CIE, sin alterar el estado de la propuesta.
    """

    with conn.cursor() as cur:
        cie = _obtener_rol_cie(cur, payload.id_usuario_eval)
        id_rol_cie = cie["id_rol"]

        cur.execute(
            """
            SELECT id_propuesta, estado_actual, titulo, id_usuario_lider,
                   COALESCE(codigo, 'SI-' || id_propuesta) AS codigo
            FROM propuestas
            WHERE id_propuesta = %s
            FOR UPDATE
            """,
            (id_propuesta,),
        )
        propuesta = cur.fetchone()
        if not propuesta:
            raise HTTPException(404, "Propuesta no encontrada.")

        cur.execute(
            """
            SELECT cre.id_evaluacion, cre.condiciones
            FROM evaluations ev
            JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = ANY(%s)
            JOIN cie_resolution_evaluations cre ON cre.id_evaluacion = ev.id_evaluacion
            WHERE ev.id_propuesta = %s
            ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
            LIMIT 1
            """,
            (list(ROLES_CIE), id_propuesta),
        )
        resolucion = cur.fetchone()
        if not resolucion:
            raise HTTPException(
                409,
                "La propuesta no tiene una resolución del CIE; registra el acuerdo primero.",
            )

        if not payload.condiciones.strip():
            raise HTTPException(400, "Debes registrar el texto de las condiciones.")

        # [Línea clave]: Las condiciones se acumulan con la fecha del día para conservar la
        # cronología de los requerimientos adicionales hechos por el comité.
        condiciones_previas = (resolucion["condiciones"] or "").strip()
        condiciones_nuevas = f"[{date.today().isoformat()}] {payload.condiciones.strip()}"
        condiciones = (
            f"{condiciones_previas}\n\n{condiciones_nuevas}".strip()
            if condiciones_previas
            else condiciones_nuevas
        )
        cur.execute(
            """
            UPDATE cie_resolution_evaluations
            SET condiciones = %s
            WHERE id_evaluacion = %s
            """,
            (condiciones, resolucion["id_evaluacion"]),
        )

        cur.execute(
            """
            INSERT INTO evaluations (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
            VALUES (%s, %s, %s, NOW(), %s)
            RETURNING id_evaluacion
            """,
            (
                id_propuesta,
                payload.id_usuario_eval,
                id_rol_cie,
                f"Condiciones de aceptación posteriores: {payload.condiciones.strip()}",
            ),
        )
        id_evaluacion = cur.fetchone()["id_evaluacion"]

        cur.execute("SELECT nombre_estado FROM estados WHERE id_estado = %s", (propuesta["estado_actual"],))
        nombre_estado = cur.fetchone()["nombre_estado"]

        cur.execute(
            """
            INSERT INTO notificaciones
                (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida)
            VALUES (%s, %s, 'tramite', %s, %s, NOW(), false)
            """,
            (
                propuesta["id_usuario_lider"],
                id_propuesta,
                "Condiciones de aceptación del CIE",
                f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» recibió condiciones "
                "de aceptación adicionales del Comité de Ética en Investigación.",
            ),
        )

    return CieResultadoOut(
        ok=True,
        id_evaluacion=id_evaluacion,
        id_propuesta=id_propuesta,
        estado_actual=propuesta["estado_actual"],
        nombre_estado=nombre_estado,
        resolucion=None,
        mensaje="Condiciones de aceptación registradas.",
    )
