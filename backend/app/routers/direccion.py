"""
========================================================================================
ARCHIVO: backend/app/routers/direccion.py

2.1. OBJETIVO DEL ARCHIVO:
    Implementar la bandeja, el dictamen y la trazabilidad de Dirección de Investigación
    dentro del flujo de evaluación de propuestas de la Convocatoria Fondos VIE 2027.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta 'propuestas', 'usuarios', 'escuelas', 'modalidades',
             'lineas_de_investigacion', 'estados', 'evaluations', 'roles',
             'user_roles', 'vie_dictamen_verifications', 'criterios_verificacion_vie',
             'proposal_state_history', 'notificaciones', 'proposal_documents',
             'vinculacion_evaluations', 'evaluations' (para Comit�T�cnico),
             'technical_committee_evaluations', 'council_endorsements'.
           - Usa 'app.db.get_conn' para la transacción atómica contra Supabase.
    2.2.2. A dónde envía datos:
           - Retorna la bandeja de Dirección, el expediente para dictamen y el resultado
             a las pantallas 21, 22, 26 y 28.
           - Crea 'evaluations' con rol Dirección, persiste verificaciones en
             'vie_dictamen_verifications', cambia el estado de la propuesta («Sometida
             ante VIE» → «Dictaminada por Dirección», «Con observaciones» o «Rechazada»),
             actualiza historial y notifica al investigador.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSOMODO?:
    Expone GET /propuestas/direccion/bandeja, GET /propuestas/direccion/{id_propuesta}
    y POST /propuestas/direccion/{id_propuesta}. Valida que la propuesta esté en
    "Sometida ante VIE", registra el dictamen con verificación por criterio y ejecuta
    la transición controlada de estado.
========================================================================================
"""

import os
from datetime import date, datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import Connection
from pydantic import BaseModel, Field

from ..db import get_conn
from ..estados import (
    ESTADO_DICTAMINADA,
    ESTADO_OBSERVACIONES,
    ESTADO_RECHAZADA,
    ESTADO_SOMETIDA_VIE,
    resolver_estado,
)
from .dictamen_vie import parsear_dictamen, serializar_dictamen

# [Línea clave]: Se registra antes que propuestas.router en main.py para que las rutas
# literales /propuestas/direccion/... no sean capturadas por /propuestas/{id_propuesta}.
router = APIRouter(prefix="/propuestas", tags=["direccion"])

ROL_DIRECCION = "Dirección de Investigación"
ROL_COMITE_TECNICO = "Comité Técnico"
ROL_VINCULACION = "Vinculación"
ROL_CONSEJO = "Consejo de Escuela"

# [Línea clave]: Los estados se resuelven por nombre desde 'app.estados' porque el orden de los
# identificadores en la tabla «estados» no coincide con el seed V3 en la base de datos desplegada.
ESTADO_POR_DICTAMEN = {
    "Favorable": ESTADO_DICTAMINADA,
    "Con observaciones": ESTADO_OBSERVACIONES,
    "No favorable": ESTADO_RECHAZADA,
}

BUCKET = "convocatorias"


# =====================================================================
# MODELOS DE ENTRADA Y SALIDA
# =====================================================================


class VerificacionCriterioIn(BaseModel):
    """Verificación de un criterio de VIE por parte de Dirección."""

    id_criterio: int
    cumple: bool = True


class DictamenDireccionIn(BaseModel):
    """Datos del dictamen emitido por Dirección de Investigación."""

    id_usuario_eval: int
    dictamen: Literal["Favorable", "Con observaciones", "No favorable"] = "Favorable"
    fundamentacion: str = Field(min_length=1)
    verificacion_responsabilidades: bool = True
    verificacion_riesgos: bool = True
    verificacion_beca: bool = True
    verificacion_declaraciones: bool = True
    verificacion_documentos: bool = True
    verificacion_criterios: list[VerificacionCriterioIn] = []
    id_documento: Optional[int] = None
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


class CriterioVieOut(BaseModel):
    """Criterio de verificación de VIE."""

    id_criterio: int
    descripcion_criterio: str


class VerificacionOut(BaseModel):
    """Resultado de verificación por criterio."""

    id_criterio: int
    descripcion_criterio: Optional[str] = None
    cumple: bool


class DictamenDireccionOut(BaseModel):
    """Dictamen registrado por Dirección de Investigación."""

    id_evaluacion: int
    id_propuesta: int
    id_usuario_eval: int
    evaluador_nombre: str
    fecha_evaluacion: datetime
    dictamen: str
    fundamentacion: str
    observaciones: Optional[str] = None
    verificacion_responsabilidades: Optional[bool] = None
    verificacion_riesgos: Optional[bool] = None
    verificacion_beca: Optional[bool] = None
    verificacion_declaraciones: Optional[bool] = None
    verificacion_documentos: Optional[bool] = None
    verificaciones: list[VerificacionOut] = []


class DireccionDetalleOut(BaseModel):
    """Expediente para dictamen de Dirección de Investigación."""

    id_propuesta: int
    codigo: str
    titulo: str
    resumen: Optional[str] = None
    estado_actual: int
    nombre_estado: str
    escuela: str
    escuela_siglas: Optional[str] = None
    modalidad: str
    linea_investigacion: str
    lider_nombre: str
    lider_correo: Optional[str] = None
    monto_total: float
    periodo: str
    puntaje_comite: Optional[float] = None
    dictamen_vinculacion: Optional[dict] = None
    avales_consejo: list[dict] = []
    criterios_vie: list[CriterioVieOut] = []
    dictamen_direccion: Optional[DictamenDireccionOut] = None
    puede_dictaminar: bool = False
    motivo_bloqueo: Optional[str] = None
    documentos: list[DocumentoPropuestaOut] = []


class DireccionResultadoOut(BaseModel):
    """Resultado de registrar el dictamen de Dirección."""

    ok: bool
    id_evaluacion: Optional[int] = None
    id_propuesta: int
    estado_actual: int
    nombre_estado: str
    dictamen: str
    mensaje: str


class DireccionDashboardPropuestaDestacada(BaseModel):
    """Propuesta destacada para el dashboard de Dirección."""

    id_propuesta: int
    codigo: str
    titulo: str
    escuela: str
    escuela_siglas: Optional[str] = None
    modalidad: str
    linea_investigacion: str
    lider_nombre: str
    monto_total: float
    periodo: str
    fecha_ingreso_vie: Optional[datetime] = None
    estado_actual: int
    nombre_estado: str


class DireccionDashboardOut(BaseModel):
    """Métricas del dashboard para Dirección de Investigación."""

    pendientes: int
    determinadas: int
    totales_revisadas: int
    propuesta_destacada: Optional[DireccionDashboardPropuestaDestacada] = None


# =====================================================================
# UTILIDADES INTERNAS
# =====================================================================


def _url_documento(file_path: str) -> str:
    """Construir la URL pública de un documento sin romper lecturas si Storage no está configurado."""

    if not file_path:
        return ""
    if file_path.startswith("http://") or file_path.startswith("https://"):
        return file_path
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not url:
        return file_path
    return f"{url}/storage/v1/object/public/{BUCKET}/{file_path.lstrip('/')}"


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


def _obtener_rol_direccion(cur, id_usuario: int) -> dict:
    """Validar que el usuario exista, esté activo y tenga el rol Dirección de Investigación."""

    cur.execute(
        """
        SELECT u.id_usuario, u.nombre, u.lastname, r.id_rol
        FROM usuarios u
        JOIN user_roles ur ON ur.id_usuario = u.id_usuario
        JOIN roles r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = %s AND u.estado_activo AND r.nombre_rol = %s
        """,
        (id_usuario, ROL_DIRECCION),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(403, "El usuario no tiene el rol Dirección de Investigación.")
    return fila


# [Línea clave]: 'evaluations.observaciones' es la única columna de texto libre disponible para
# persistir el dictamen. El formato estructurado vive en el módulo común 'dictamen_vie'.
def _serializar_dictamen(payload: DictamenDireccionIn) -> str:
    """Serializar el dictamen de Dirección dentro de 'evaluations.observaciones'."""

    return serializar_dictamen(
        payload.dictamen,
        payload.fundamentacion,
        payload.observaciones,
        {
            "responsabilidades": payload.verificacion_responsabilidades,
            "riesgos": payload.verificacion_riesgos,
            "beca": payload.verificacion_beca,
            "declaraciones": payload.verificacion_declaraciones,
            "documentos": payload.verificacion_documentos,
        },
    )


def _parsear_dictamen(texto: Optional[str]) -> dict:
    """Recuperar dictamen, fundamentación y verificaciones desde 'evaluations.observaciones'."""

    return parsear_dictamen(texto)


# =====================================================================
# ENDPOINTS
# =====================================================================


@router.get("/direccion/bandeja", response_model=list[dict])
def obtener_bandeja_direccion(
    id_usuario: int = Query(..., description="Usuario autenticado con rol Dirección de Investigación"),
    rol: str = Query("Dirección de Investigación", description="Rol solicitado por el frontend"),
    conn: Connection = Depends(get_conn),
):
    """Listar propuestas sometidas ante VIE pendientes de dictamen de Dirección."""

    if rol.strip().lower() not in ("dirección de investigación", "direccion de investigacion", "direccion"):
        raise HTTPException(400, "Bandeja no disponible para el rol solicitado.")

    with conn.cursor() as cur:
        _obtener_rol_direccion(cur, id_usuario)
        estado_sometida = resolver_estado(cur, ESTADO_SOMETIDA_VIE)
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
                ingreso.fecha_ingreso_vie,
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
                ) AS puntaje_comite
            FROM propuestas p
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            LEFT JOIN LATERAL (
                SELECT MAX(h.fecha_cambio) AS fecha_ingreso_vie
                FROM proposal_state_history h
                WHERE h.id_propuesta = p.id_propuesta
                  AND h.id_estado_nuevo = %s
            ) ingreso ON TRUE
            WHERE p.estado_actual = %s
               OR EXISTS (
                    SELECT 1
                    FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = %s
               )
            ORDER BY COALESCE(ingreso.fecha_ingreso_vie, p.fecha_creacion) DESC, p.id_propuesta DESC
            """,
            (
                ROL_COMITE_TECNICO,
                estado_sometida,
                estado_sometida,
                ROL_DIRECCION,
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


@router.get("/direccion/dashboard", response_model=DireccionDashboardOut)
def obtener_dashboard_direccion(
    id_usuario: int = Query(..., description="Usuario autenticado con rol Dirección de Investigación"),
    rol: str = Query("Dirección de Investigación", description="Rol solicitado por el frontend"),
    conn: Connection = Depends(get_conn),
):
    """Métricas del dashboard de Dirección: pendientes, determinadas y totales revisadas."""

    if rol.strip().lower() not in ("dirección de investigación", "direccion de investigacion", "direccion"):
        raise HTTPException(400, "Dashboard no disponible para el rol solicitado.")

    with conn.cursor() as cur:
        _obtener_rol_direccion(cur, id_usuario)
        estado_sometida = resolver_estado(cur, ESTADO_SOMETIDA_VIE)
        estado_dictaminada = resolver_estado(cur, ESTADO_DICTAMINADA)

        cur.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE p.estado_actual = %s AND NOT EXISTS (
                    SELECT 1 FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = %s
                )) AS pendientes,
                COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = %s
                )) AS totales_revisadas,
                COUNT(*) FILTER (WHERE p.estado_actual = %s OR EXISTS (
                    SELECT 1 FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = %s
                )) AS determinadas
            FROM propuestas p
            """,
            (
                estado_sometida,
                ROL_DIRECCION,
                ROL_DIRECCION,
                estado_dictaminada,
                ROL_DIRECCION,
            ),
        )
        metricas = cur.fetchone() or {"pendientes": 0, "determinadas": 0, "totales_revisadas": 0}

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
                ingreso.fecha_ingreso_vie,
                p.estado_actual,
                e.nombre_estado
            FROM propuestas p
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            JOIN estados e ON e.id_estado = p.estado_actual
            LEFT JOIN LATERAL (
                SELECT MAX(h.fecha_cambio) AS fecha_ingreso_vie
                FROM proposal_state_history h
                WHERE h.id_propuesta = p.id_propuesta
                  AND h.id_estado_nuevo = %s
            ) ingreso ON TRUE
            WHERE p.estado_actual = %s
              AND NOT EXISTS (
                    SELECT 1 FROM evaluations ev
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = %s
              )
            ORDER BY COALESCE(ingreso.fecha_ingreso_vie, p.fecha_creacion) DESC, p.id_propuesta DESC
            LIMIT 1
            """,
            (estado_sometida, estado_sometida, ROL_DIRECCION),
        )
        destacada = cur.fetchone()

    return DireccionDashboardOut(
        pendientes=int(metricas.get("pendientes") or 0),
        determinadas=int(metricas.get("determinadas") or 0),
        totales_revisadas=int(metricas.get("totales_revisadas") or 0),
        propuesta_destacada=dict(destacada) if destacada else None,
    )


@router.get("/direccion/{id_propuesta}", response_model=DireccionDetalleOut)
def obtener_dictamen_direccion(
    id_propuesta: int,
    id_usuario: int = Query(..., description="Usuario autenticado con rol Dirección de Investigación"),
    conn: Connection = Depends(get_conn),
):
    """Consultar el expediente para el dictamen de Dirección con evidencias institucionales."""

    with conn.cursor() as cur:
        _obtener_rol_direccion(cur, id_usuario)
        estado_sometida = resolver_estado(cur, ESTADO_SOMETIDA_VIE)

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
                   (
                       SELECT tce.puntaje
                       FROM evaluations ev
                       JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = %s
                       JOIN technical_committee_evaluations tce ON tce.id_evaluacion = ev.id_evaluacion
                       WHERE ev.id_propuesta = p.id_propuesta
                       ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
                       LIMIT 1
                   ) AS puntaje_comite
            FROM propuestas p
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            WHERE p.id_propuesta = %s
            """,
            (ROL_COMITE_TECNICO, id_propuesta),
        )
        propuesta = cur.fetchone()
        if not propuesta:
            raise HTTPException(404, "Propuesta no encontrada.")

        cur.execute(
            """
            SELECT cv.id_criterio, cv.descripcion_criterio
            FROM criterios_verificacion_vie cv
            ORDER BY cv.id_criterio
            """
        )
        criterios = [CriterioVieOut(**fila) for fila in cur.fetchall()]

        cur.execute(
            """
            SELECT ev.id_evaluacion, ev.id_usuario_eval,
                   TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS evaluador_nombre,
                   ev.fecha_evaluacion, ev.observaciones
            FROM evaluations ev
            JOIN usuarios u ON u.id_usuario = ev.id_usuario_eval
            JOIN roles r ON r.id_rol = ev.id_rol_evaluador
            WHERE ev.id_propuesta = %s AND r.nombre_rol = %s
            ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
            LIMIT 1
            """,
            (id_propuesta, ROL_DIRECCION),
        )
        dictamen_fila = cur.fetchone()

        cur.execute(
            """
            SELECT vdv.id_criterio, vdv.cumple, cv.descripcion_criterio
            FROM vie_dictamen_verifications vdv
            JOIN evaluations ev ON ev.id_evaluacion = vdv.id_evaluacion
            JOIN roles r ON r.id_rol = ev.id_rol_evaluador
            LEFT JOIN criterios_verificacion_vie cv ON cv.id_criterio = vdv.id_criterio
            WHERE ev.id_propuesta = %s AND r.nombre_rol = %s
            ORDER BY vdv.id_criterio
            """,
            (id_propuesta, ROL_DIRECCION),
        )
        verificaciones = [
            VerificacionOut(id_criterio=f["id_criterio"], descripcion_criterio=f["descripcion_criterio"], cumple=f["cumple"])
            for f in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT ve.id_evaluacion, ve.numero_oficio_dictamen, ve.potencial_pi_identificado,
                   ve.tipo_innovacion, ve.activo_previsto, ve.valoracion_tecnica, ve.requiere_reserva
            FROM vinculacion_evaluations ve
            JOIN evaluations ev ON ev.id_evaluacion = ve.id_evaluacion
            WHERE ev.id_propuesta = %s
            ORDER BY ev.fecha_evaluacion DESC
            LIMIT 1
            """,
            (id_propuesta,),
        )
        vinculacion = cur.fetchone()

        cur.execute(
            """
            SELECT ce.id_aval, ce.id_propuesta, ce.id_escuela,
                   e.nombre AS escuela, e.siglas AS escuela_siglas,
                   ce.tipo_instancia, ce.numero_sesion, ce.articulo, ce.fecha_acuerdo,
                   ce.numero_oficio, ce.ratifica_calificacion, ce.avala_presupuesto,
                   ce.avala_horas_personal, ce.observaciones, ce.id_usuario_registro,
                   TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS registrado_por,
                   ce.fecha_registro
            FROM council_endorsements ce
            JOIN escuelas e ON e.id_escuela = ce.id_escuela
            JOIN usuarios u ON u.id_usuario = ce.id_usuario_registro
            WHERE ce.id_propuesta = %s
            ORDER BY ce.fecha_registro ASC, ce.id_aval ASC
            """,
            (id_propuesta,),
        )
        avales = cur.fetchall()

        documentos = _documentos_propuesta(cur, id_propuesta)

    dictamen_obj = None
    if dictamen_fila:
        datos_dictamen = _parsear_dictamen(dictamen_fila["observaciones"])
        verificaciones_inst = datos_dictamen["verificaciones_institucionales"]
        dictamen_obj = DictamenDireccionOut(
            id_evaluacion=dictamen_fila["id_evaluacion"],
            id_propuesta=id_propuesta,
            id_usuario_eval=dictamen_fila["id_usuario_eval"],
            evaluador_nombre=dictamen_fila["evaluador_nombre"],
            fecha_evaluacion=dictamen_fila["fecha_evaluacion"],
            dictamen=datos_dictamen["dictamen"],
            fundamentacion=datos_dictamen["fundamentacion"],
            observaciones=datos_dictamen["observaciones"] or None,
            verificacion_responsabilidades=verificaciones_inst.get("responsabilidades"),
            verificacion_riesgos=verificaciones_inst.get("riesgos"),
            verificacion_beca=verificaciones_inst.get("beca"),
            verificacion_declaraciones=verificaciones_inst.get("declaraciones"),
            verificacion_documentos=verificaciones_inst.get("documentos"),
            verificaciones=verificaciones,
        )

    puede_dictaminar = False
    motivo_bloqueo = None
    if propuesta["estado_actual"] != estado_sometida:
        motivo_bloqueo = f"La propuesta se encuentra en «{propuesta['nombre_estado']}» y ya no está pendiente de dictamen de Dirección."
    elif dictamen_obj is not None:
        motivo_bloqueo = "Ya existe un dictamen registrado por Dirección de Investigación."
    else:
        puede_dictaminar = True

    return DireccionDetalleOut(
        id_propuesta=propuesta["id_propuesta"],
        codigo=propuesta["codigo"],
        titulo=propuesta["titulo"],
        resumen=propuesta["resumen"],
        estado_actual=propuesta["estado_actual"],
        nombre_estado=propuesta["nombre_estado"],
        escuela=propuesta["escuela"],
        escuela_siglas=propuesta["escuela_siglas"],
        modalidad=propuesta["modalidad"],
        linea_investigacion=propuesta["linea_investigacion"],
        lider_nombre=propuesta["lider_nombre"],
        lider_correo=propuesta["lider_correo"],
        monto_total=float(propuesta["monto_total"]),
        periodo=propuesta["periodo"],
        puntaje_comite=float(propuesta["puntaje_comite"]) if propuesta["puntaje_comite"] else None,
        dictamen_vinculacion=dict(vinculacion) if vinculacion else None,
        avales_consejo=[dict(a) for a in avales],
        criterios_vie=criterios,
        dictamen_direccion=dictamen_obj,
        puede_dictaminar=puede_dictaminar,
        motivo_bloqueo=motivo_bloqueo,
        documentos=documentos,
    )


@router.post("/direccion/{id_propuesta}", response_model=DireccionResultadoOut, status_code=201)
def registrar_dictamen_direccion(
    id_propuesta: int,
    payload: DictamenDireccionIn,
    conn: Connection = Depends(get_conn),
):
    """Registrar el dictamen de Dirección de Investigación y ejecutar la transición controlada de estado."""

    with conn.cursor() as cur:
        direccion = _obtener_rol_direccion(cur, payload.id_usuario_eval)
        id_rol_direccion = direccion["id_rol"]
        estado_sometida = resolver_estado(cur, ESTADO_SOMETIDA_VIE)
        # [Línea clave]: El destino del dictamen se decide por la máquina de estados: «Favorable»
        # entrega el expediente al CIE, «Con observaciones» lo devuelve al investigador y
        # «No favorable» es un rechazo terminal.
        estado_destino = resolver_estado(cur, ESTADO_POR_DICTAMEN[payload.dictamen])

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

        if propuesta["estado_actual"] != estado_sometida:
            raise HTTPException(
                409,
                "La propuesta no está sometida ante VIE; no se puede registrar el dictamen de Dirección.",
            )

        cur.execute(
            """
            SELECT 1
            FROM evaluations ev
            JOIN roles r ON r.id_rol = ev.id_rol_evaluador
            WHERE ev.id_propuesta = %s AND r.nombre_rol = %s
            """,
            (id_propuesta, ROL_DIRECCION),
        )
        if cur.fetchone():
            raise HTTPException(409, "Ya existe un dictamen registrado por Dirección de Investigación.")

        if payload.id_documento is not None:
            cur.execute(
                "SELECT 1 FROM proposal_documents WHERE id_documento = %s AND id_propuesta = %s",
                (payload.id_documento, id_propuesta),
            )
            if not cur.fetchone():
                raise HTTPException(400, "El documento indicado no pertenece a la propuesta.")

        if not payload.fundamentacion.strip():
            raise HTTPException(400, "Debes registrar la fundamentación del dictamen.")

        cur.execute(
            """
            INSERT INTO evaluations (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
            VALUES (%s, %s, %s, NOW(), %s)
            RETURNING id_evaluacion
            """,
            (
                id_propuesta,
                payload.id_usuario_eval,
                id_rol_direccion,
                _serializar_dictamen(payload),
            ),
        )
        id_evaluacion = cur.fetchone()["id_evaluacion"]

        # [Línea clave]: Los criterios verificables son los definidos en 'criterios_verificacion_vie'.
        # Se consultan por identificador para no escribir filas huérfanas ni duplicar verificaciones.
        cur.execute("SELECT id_criterio FROM criterios_verificacion_vie ORDER BY id_criterio")
        criterios_validos = {f["id_criterio"] for f in cur.fetchall()}

        verificaciones_por_criterio = {
            c.id_criterio: bool(c.cumple)
            for c in payload.verificacion_criterios
            if c.id_criterio in criterios_validos
        }
        for id_criterio in criterios_validos:
            verificaciones_por_criterio.setdefault(id_criterio, True)

        for id_criterio, cumple in sorted(verificaciones_por_criterio.items()):
            cur.execute(
                """
                INSERT INTO vie_dictamen_verifications (id_evaluacion, id_criterio, cumple)
                VALUES (%s, %s, %s)
                ON CONFLICT (id_evaluacion, id_criterio) DO UPDATE SET cumple = EXCLUDED.cumple
                """,
                (id_evaluacion, id_criterio, cumple),
            )

        # [Línea clave]: El trigger de PostgreSQL inserta la fila del historial al cambiar
        # el estado; se reutiliza para dejar como responsable al Director(a) de Investigación.
        cur.execute(
            "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s RETURNING estado_actual",
            (estado_destino, id_propuesta),
        )
        estado_actual = cur.fetchone()["estado_actual"]

        detalle_historial = (
            f"Dictamen de Dirección de Investigación. Resolución: {payload.dictamen}. "
            f"{payload.fundamentacion.strip()}"
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

        # [Línea clave]: El aviso al investigador cambia según la resolución: el dictamen
        # favorable remite el expediente al CIE, las observaciones exigen una corrección y
        # el «No favorable» cierra el trámite como rechazo.
        if payload.dictamen == "Favorable":
            titulo_notificacion = "Propuesta dictaminada por Dirección de Investigación"
        elif payload.dictamen == "Con observaciones":
            titulo_notificacion = "Propuesta devuelta con observaciones por Dirección de Investigación"
        else:
            titulo_notificacion = "Propuesta rechazada por Dirección de Investigación"
        mensaje_notificacion = (
            f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» fue dictaminada por "
            f"Dirección de Investigación con resolución: {payload.dictamen}. "
            f"{payload.fundamentacion.strip()}"
        )
        cur.execute(
            """
            INSERT INTO notificaciones
                (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida)
            VALUES (%s, %s, 'tramite', %s, %s, NOW(), false)
            """,
            (
                propuesta["id_usuario_lider"],
                id_propuesta,
                titulo_notificacion,
                mensaje_notificacion,
            ),
        )

    return DireccionResultadoOut(
        ok=True,
        id_evaluacion=id_evaluacion,
        id_propuesta=id_propuesta,
        estado_actual=estado_actual,
        nombre_estado=nombre_estado,
        dictamen=payload.dictamen,
        mensaje=f"Dictamen de Dirección registrado. La propuesta quedó en «{nombre_estado}».",
    )
