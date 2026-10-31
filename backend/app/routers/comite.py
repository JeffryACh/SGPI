"""
========================================================================================
ARCHIVO: backend/app/routers/comite.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Implementar la bandeja, la rúbrica ponderada y el dictamen del Comité Técnico dentro
    del flujo de evaluación de propuestas de la Convocatoria Fondos VIE 2027.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta 'propuestas', 'evaluations', 'technical_committee_evaluations',
             'technical_committee_scores', 'rubric_sections', 'rubric_criteria',
             'roles', 'user_roles', 'usuarios', 'notificaciones' y 'proposal_documents'.
           - Recibe el formulario JSON de 'frontend/js/app.js' (pantallas 21, 22 y 24).
           - Usa 'app.db.get_conn' para la transacción atómica contra Supabase.
    2.2.2. A dónde envía datos:
           - Retorna la bandeja del Comité, la rúbrica y el expediente evaluado a las
             pantallas 21, 22 y 24.
           - Persiste el puntaje ponderado en 'evaluations' + 'technical_committee_evaluations',
             el detalle por criterio en 'technical_committee_scores', cambia el estado de la
             propuesta y notifica al Consejo de Escuela cuando la recomendación es favorable.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSOMODO?:
    Expone GET /propuestas/comite/bandeja, GET /propuestas/comite/rubrica,
    GET /propuestas/comite/{id_propuesta} y POST /propuestas/comite/{id_propuesta}.
    El servidor calcula y valida el puntaje (Σ peso × nivel / 10), exige el umbral de 70 y
    que todo criterio obligatorio tenga nivel Bueno (8) o Excelente (10), y ejecuta la
    transición controlada 3 -> 4 (aval del Consejo), 9 (observaciones) o 10 (rechazo).
========================================================================================
"""

import os
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import Connection
from pydantic import BaseModel, Field

from ..db import get_conn

# [Línea clave]: Se registra antes que propuestas.router en main.py para que las rutas
# literales /propuestas/comite/... no sean capturadas por /propuestas/{id_propuesta}.
router = APIRouter(prefix="/propuestas", tags=["comite"])

ROL_COMITE = "Comité Técnico"
ROL_CONSEJO = "Consejo de Escuela"
ESTADO_EN_EVALUACION_COMITE = 3
ESTADOS_POR_DECISION = {"favorable": 4, "observaciones": 9, "rechazo": 10}
NIVELES_VALIDOS = (0, 6, 8, 10)
PUNTAJE_MINIMO = 70
NIVEL_OBLIGATORIO_MINIMO = 8
BUCKET = "convocatorias"


# =====================================================================
# MODELOS DE ENTRADA Y SALIDA
# =====================================================================

class PuntajeCriterioIn(BaseModel):
    """Nivel asignado a un criterio de la rúbrica por el Comité Técnico."""

    id_criterio_rubrica: int
    puntaje: int = Field(ge=0, le=10)
    justificacion: Optional[str] = None


class ComiteEvaluacionIn(BaseModel):
    """Formulario de evaluación técnica enviado desde la pantalla 24."""

    id_usuario_eval: int
    puntajes: list[PuntajeCriterioIn] = Field(min_length=1)
    justificacion: str = Field(min_length=1)
    observaciones: Optional[str] = ""
    produccion_conforme: bool = True
    decision: Literal["favorable", "observaciones", "rechazo"] = "favorable"
    id_documento: Optional[int] = None


class CriterioRubricaOut(BaseModel):
    """Criterio de la rúbrica con su peso y obligatoriedad."""

    id_criterio_rubrica: int
    nombre_criterio: str
    peso_relativo: float
    es_obligatorio: bool
    orden: int


class SeccionRubricaOut(BaseModel):
    """Sección temática de la rúbrica con sus criterios."""

    id_seccion: int
    nombre_seccion: str
    peso_porcentual: float
    orden: int
    criterios: list[CriterioRubricaOut] = []


class RubricaOut(BaseModel):
    """Rúbrica completa del Comité Técnico y sus reglas de recomendación."""

    secciones: list[SeccionRubricaOut] = []
    total_peso: float
    total_criterios: int
    niveles_validos: list[int] = list(NIVELES_VALIDOS)
    puntaje_minimo: int = PUNTAJE_MINIMO
    nivel_obligatorio_minimo: int = NIVEL_OBLIGATORIO_MINIMO


class PuntajeCriterioOut(BaseModel):
    """Puntaje registrado para un criterio de la rúbrica."""

    id_criterio_rubrica: int
    nombre_seccion: str
    nombre_criterio: str
    peso_relativo: float
    es_obligatorio: bool
    puntaje: int
    justificacion: Optional[str] = None


class EvaluacionComiteOut(BaseModel):
    """Dictamen consolidado del Comité Técnico."""

    id_evaluacion: int
    id_propuesta: int
    id_usuario_eval: int
    evaluador_nombre: str
    fecha_evaluacion: datetime
    observaciones: Optional[str] = None
    puntaje: float
    decision: Optional[str] = "favorable"
    justificacion: Optional[str] = None
    tiene_bloqueo_obligatorio: bool = False


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


class ComiteDetalleOut(BaseModel):
    """Expediente de evaluación del Comité Técnico."""

    id_propuesta: int
    codigo: str
    titulo: str
    estado_actual: int
    nombre_estado: str
    evaluacion: Optional[EvaluacionComiteOut] = None
    puntajes: list[PuntajeCriterioOut] = []
    puntaje_total: Optional[float] = None
    tiene_bloqueo_obligatorio: bool = False
    documentos: list[DocumentoPropuestaOut] = []


class ComiteResultadoOut(BaseModel):
    """Resultado de registrar el dictamen del Comité Técnico."""

    ok: bool
    id_evaluacion: int
    id_propuesta: int
    estado_actual: int
    nombre_estado: str
    decision: str
    puntaje: float
    tiene_bloqueo_obligatorio: bool
    id_documento: Optional[int] = None
    mensaje: str


# =====================================================================
# UTILIDADES INTERNAS
# =====================================================================

def _columnas_tabla(cur, nombre_tabla: str) -> set[str]:
    """Leer las columnas existentes de una tabla del esquema público."""

    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (nombre_tabla,),
    )
    return {fila["column_name"] for fila in cur.fetchall()}


def _exigir_migracion_v12(cur) -> set[str]:
    """Validar que la migración V12 esté aplicada antes de escribir el dictamen."""

    columnas = _columnas_tabla(cur, "technical_committee_evaluations")
    requeridas = {"decision", "justificacion", "tiene_bloqueo_obligatorio"}
    if not requeridas.issubset(columnas):
        raise HTTPException(
            503,
            "Falta aplicar la migración V12 (rúbrica y decisión del Comité Técnico) "
            "en el SQL Editor de Supabase.",
        )
    return columnas


def _obtener_rol_comite(cur, id_usuario: int) -> int:
    """Validar que el usuario exista, esté activo y tenga el rol Comité Técnico."""

    cur.execute(
        """
        SELECT r.id_rol
        FROM usuarios u
        JOIN user_roles ur ON ur.id_usuario = u.id_usuario
        JOIN roles r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = %s AND u.estado_activo AND r.nombre_rol = %s
        """,
        (id_usuario, ROL_COMITE),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(403, "El usuario no tiene el rol Comité Técnico.")
    return fila["id_rol"]


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


def _filas_rubrica(cur) -> list[dict]:
    """Consultar los criterios de la rúbrica ordenados por sección."""

    cur.execute(
        """
        SELECT
            s.id_seccion,
            s.nombre_seccion,
            s.peso_porcentual,
            s.orden AS orden_seccion,
            c.id_criterio_rubrica,
            c.nombre_criterio,
            c.peso_relativo,
            c.es_obligatorio,
            c.orden AS orden_criterio
        FROM rubric_sections s
        JOIN rubric_criteria c ON c.id_seccion = s.id_seccion
        ORDER BY s.orden ASC, c.orden ASC
        """
    )
    return cur.fetchall()


def _agrupar_rubrica(filas: list[dict]) -> list[SeccionRubricaOut]:
    """Agrupar los criterios planos en secciones ordenadas."""

    secciones: list[SeccionRubricaOut] = []
    indice: dict[int, SeccionRubricaOut] = {}
    for fila in filas:
        id_seccion = fila["id_seccion"]
        if id_seccion not in indice:
            indice[id_seccion] = SeccionRubricaOut(
                id_seccion=id_seccion,
                nombre_seccion=fila["nombre_seccion"],
                peso_porcentual=float(fila["peso_porcentual"]),
                orden=fila["orden_seccion"],
                criterios=[],
            )
            secciones.append(indice[id_seccion])
        indice[id_seccion].criterios.append(
            CriterioRubricaOut(
                id_criterio_rubrica=fila["id_criterio_rubrica"],
                nombre_criterio=fila["nombre_criterio"],
                peso_relativo=float(fila["peso_relativo"]),
                es_obligatorio=fila["es_obligatorio"],
                orden=fila["orden_criterio"],
            )
        )
    return secciones


def _calcular_puntaje(cur, puntajes: list[PuntajeCriterioIn]) -> tuple[float, bool, dict[int, dict]]:
    """Validar los niveles enviados y calcular el puntaje ponderado en el servidor."""

    filas = _filas_rubrica(cur)
    if not filas:
        raise HTTPException(
            503,
            "La rúbrica del Comité Técnico no está cargada. Aplica la migración V12.",
        )

    criterios = {fila["id_criterio_rubrica"]: fila for fila in filas}
    enviados: dict[int, PuntajeCriterioIn] = {}
    for item in puntajes:
        if item.id_criterio_rubrica not in criterios:
            raise HTTPException(400, f"El criterio {item.id_criterio_rubrica} no pertenece a la rúbrica.")
        if item.id_criterio_rubrica in enviados:
            raise HTTPException(400, f"El criterio {item.id_criterio_rubrica} está repetido.")
        if item.puntaje not in NIVELES_VALIDOS:
            raise HTTPException(400, "Los niveles permitidos son 0, 6, 8 o 10.")
        enviados[item.id_criterio_rubrica] = item

    faltantes = set(criterios) - set(enviados)
    if faltantes:
        raise HTTPException(
            400,
            f"Faltan {len(faltantes)} criterios de la rúbrica por evaluar.",
        )

    total = 0.0
    bloqueo = False
    for id_criterio, fila in criterios.items():
        nivel = enviados[id_criterio].puntaje
        total += float(fila["peso_relativo"]) * nivel / 10
        if fila["es_obligatorio"] and nivel < NIVEL_OBLIGATORIO_MINIMO:
            bloqueo = True

    return round(total + 1e-9, 1), bloqueo, criterios


# =====================================================================
# ENDPOINTS
# =====================================================================

@router.get("/comite/bandeja", response_model=list[dict])
def obtener_bandeja_comite(
    id_usuario: int = Query(..., description="Usuario autenticado con rol Comité Técnico"),
    rol: str = Query("Comité Técnico", description="Rol solicitado por el frontend"),
    conn: Connection = Depends(get_conn),
):
    """Listar propuestas pendientes o ya dictaminadas por el Comité Técnico."""

    if rol.strip().lower() not in ("comité técnico", "comite tecnico"):
        raise HTTPException(400, "Bandeja no disponible para el rol solicitado.")

    with conn.cursor() as cur:
        _obtener_rol_comite(cur, id_usuario)
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
                u.correo AS lider_correo,
                CASE
                    WHEN p.fecha_inicio IS NOT NULL AND p.fecha_fin IS NOT NULL
                    THEN to_char(p.fecha_inicio, 'YYYY') || '–' || to_char(p.fecha_fin, 'YYYY')
                    ELSE '2027–2028'
                END AS periodo,
                p.fecha_creacion,
                ingreso.fecha_ingreso_comite,
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
                EXISTS (
                    SELECT 1
                    FROM evaluations ev2
                    JOIN roles r2 ON r2.id_rol = ev2.id_rol_evaluador AND r2.nombre_rol = %s
                    WHERE ev2.id_propuesta = p.id_propuesta
                ) AS tiene_evaluacion
            FROM propuestas p
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            LEFT JOIN LATERAL (
                SELECT MAX(h.fecha_cambio) AS fecha_ingreso_comite
                FROM proposal_state_history h
                WHERE h.id_propuesta = p.id_propuesta
                  AND h.id_estado_nuevo = %s
            ) ingreso ON TRUE
            WHERE p.estado_actual = %s
               OR EXISTS (
                    SELECT 1
                    FROM evaluations ev3
                    JOIN roles r3 ON r3.id_rol = ev3.id_rol_evaluador AND r3.nombre_rol = %s
                    WHERE ev3.id_propuesta = p.id_propuesta
               )
            ORDER BY COALESCE(ingreso.fecha_ingreso_comite, p.fecha_creacion) DESC,
                     p.id_propuesta DESC
            """,
            (
                ROL_COMITE,
                ROL_COMITE,
                ESTADO_EN_EVALUACION_COMITE,
                ESTADO_EN_EVALUACION_COMITE,
                ROL_COMITE,
            ),
        )
        return cur.fetchall()


@router.get("/comite/rubrica", response_model=RubricaOut)
def obtener_rubrica_comite(conn: Connection = Depends(get_conn)):
    """Entregar la rúbrica oficial del Comité Técnico cargada en PostgreSQL."""

    with conn.cursor() as cur:
        secciones = _agrupar_rubrica(_filas_rubrica(cur))

    if not secciones:
        raise HTTPException(
            503,
            "La rúbrica del Comité Técnico no está cargada. Aplica la migración V12.",
        )

    total_criterios = sum(len(seccion.criterios) for seccion in secciones)
    return RubricaOut(
        secciones=secciones,
        total_peso=round(sum(seccion.peso_porcentual for seccion in secciones), 1),
        total_criterios=total_criterios,
    )


@router.get("/comite/{id_propuesta}", response_model=ComiteDetalleOut)
def obtener_evaluacion_comite(
    id_propuesta: int,
    id_usuario: int = Query(..., description="Usuario autenticado con rol Comité Técnico"),
    conn: Connection = Depends(get_conn),
):
    """Consultar el último dictamen del Comité Técnico y sus puntajes por criterio."""

    with conn.cursor() as cur:
        _obtener_rol_comite(cur, id_usuario)

        cur.execute(
            """
            SELECT p.id_propuesta, COALESCE(p.codigo, 'SI-' || p.id_propuesta) AS codigo,
                   p.titulo, p.estado_actual, e.nombre_estado
            FROM propuestas p
            JOIN estados e ON e.id_estado = p.estado_actual
            WHERE p.id_propuesta = %s
            """,
            (id_propuesta,),
        )
        propuesta = cur.fetchone()
        if not propuesta:
            raise HTTPException(404, "Propuesta no encontrada.")

        columnas = _columnas_tabla(cur, "technical_committee_evaluations")
        decision_expr = "tce.decision" if "decision" in columnas else "NULL::character varying AS decision"
        justificacion_expr = "tce.justificacion" if "justificacion" in columnas else "NULL::text AS justificacion"
        bloqueo_expr = (
            "tce.tiene_bloqueo_obligatorio"
            if "tiene_bloqueo_obligatorio" in columnas
            else "false AS tiene_bloqueo_obligatorio"
        )

        cur.execute(
            f"""
            SELECT ev.id_evaluacion, ev.id_propuesta, ev.id_usuario_eval,
                   ev.fecha_evaluacion, ev.observaciones,
                   TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS evaluador_nombre,
                   tce.puntaje, {decision_expr}, {justificacion_expr}, {bloqueo_expr}
            FROM evaluations ev
            JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = %s
            JOIN technical_committee_evaluations tce ON tce.id_evaluacion = ev.id_evaluacion
            JOIN usuarios u ON u.id_usuario = ev.id_usuario_eval
            WHERE ev.id_propuesta = %s
            ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
            LIMIT 1
            """,
            (ROL_COMITE, id_propuesta),
        )
        evaluacion = cur.fetchone()

        puntajes: list[PuntajeCriterioOut] = []
        if evaluacion:
            cur.execute(
                """
                SELECT tcs.id_criterio_rubrica, s.nombre_seccion, c.nombre_criterio,
                       c.peso_relativo, c.es_obligatorio, tcs.puntaje, tcs.justificacion
                FROM technical_committee_scores tcs
                JOIN rubric_criteria c ON c.id_criterio_rubrica = tcs.id_criterio_rubrica
                JOIN rubric_sections s ON s.id_seccion = c.id_seccion
                WHERE tcs.id_evaluacion = %s
                ORDER BY s.orden ASC, c.orden ASC
                """,
                (evaluacion["id_evaluacion"],),
            )
            puntajes = [
                PuntajeCriterioOut(
                    id_criterio_rubrica=fila["id_criterio_rubrica"],
                    nombre_seccion=fila["nombre_seccion"],
                    nombre_criterio=fila["nombre_criterio"],
                    peso_relativo=float(fila["peso_relativo"]),
                    es_obligatorio=fila["es_obligatorio"],
                    puntaje=fila["puntaje"],
                    justificacion=fila["justificacion"],
                )
                for fila in cur.fetchall()
            ]

        documentos = _documentos_propuesta(cur, id_propuesta)

    evaluacion_out = None
    if evaluacion:
        evaluacion_out = EvaluacionComiteOut(
            id_evaluacion=evaluacion["id_evaluacion"],
            id_propuesta=evaluacion["id_propuesta"],
            id_usuario_eval=evaluacion["id_usuario_eval"],
            evaluador_nombre=evaluacion["evaluador_nombre"],
            fecha_evaluacion=evaluacion["fecha_evaluacion"],
            observaciones=evaluacion["observaciones"],
            puntaje=float(evaluacion["puntaje"]),
            decision=evaluacion["decision"],
            justificacion=evaluacion["justificacion"],
            tiene_bloqueo_obligatorio=bool(evaluacion["tiene_bloqueo_obligatorio"]),
        )

    return ComiteDetalleOut(
        id_propuesta=propuesta["id_propuesta"],
        codigo=propuesta["codigo"],
        titulo=propuesta["titulo"],
        estado_actual=propuesta["estado_actual"],
        nombre_estado=propuesta["nombre_estado"],
        evaluacion=evaluacion_out,
        puntajes=puntajes,
        puntaje_total=float(evaluacion["puntaje"]) if evaluacion else None,
        tiene_bloqueo_obligatorio=bool(evaluacion["tiene_bloqueo_obligatorio"]) if evaluacion else False,
        documentos=documentos,
    )


@router.post("/comite/{id_propuesta}", response_model=ComiteResultadoOut, status_code=201)
def registrar_evaluacion_comite(
    id_propuesta: int,
    payload: ComiteEvaluacionIn,
    conn: Connection = Depends(get_conn),
):
    """Registrar el dictamen del Comité Técnico y ejecutar la transición controlada de estado."""

    estado_nuevo = ESTADOS_POR_DECISION[payload.decision]

    with conn.cursor() as cur:
        id_rol_comite = _obtener_rol_comite(cur, payload.id_usuario_eval)
        _exigir_migracion_v12(cur)

        # [Línea clave]: Bloquea la fila para que dos evaluadores concurrentes no
        # registren dos dictámenes sobre la misma propuesta.
        cur.execute(
            """
            SELECT id_propuesta, estado_actual, titulo,
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
        if propuesta["estado_actual"] != ESTADO_EN_EVALUACION_COMITE:
            raise HTTPException(
                409,
                "La propuesta no está en evaluación del Comité Técnico; no se puede registrar el dictamen.",
            )

        cur.execute(
            """
            SELECT 1
            FROM evaluations ev
            JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = %s
            WHERE ev.id_propuesta = %s
            LIMIT 1
            """,
            (ROL_COMITE, id_propuesta),
        )
        if cur.fetchone():
            raise HTTPException(409, "La propuesta ya tiene una evaluación del Comité Técnico registrada.")

        if payload.id_documento is not None:
            cur.execute(
                "SELECT 1 FROM proposal_documents WHERE id_documento = %s AND id_propuesta = %s",
                (payload.id_documento, id_propuesta),
            )
            if not cur.fetchone():
                raise HTTPException(400, "El documento indicado no pertenece a la propuesta.")

        puntaje, bloqueo, _ = _calcular_puntaje(cur, payload.puntajes)

        if payload.decision == "favorable":
            if not payload.produccion_conforme:
                raise HTTPException(
                    409,
                    "La producción académica comprometida no cumple la condición no sumativa.",
                )
            if bloqueo:
                raise HTTPException(
                    409,
                    "Hay un criterio obligatorio con nivel insuficiente; no se puede recomendar la propuesta.",
                )
            if puntaje < PUNTAJE_MINIMO:
                raise HTTPException(
                    409,
                    f"El puntaje {puntaje}/100 no alcanza el umbral mínimo de {PUNTAJE_MINIMO}.",
                )
        elif not (payload.observaciones or "").strip():
            raise HTTPException(
                400,
                "Debes registrar las observaciones para devolver o rechazar la propuesta.",
            )

        observaciones = (payload.observaciones or "").strip() or (
            f"Evaluación del Comité Técnico. Decisión: {payload.decision}. "
            f"Puntaje: {puntaje}/100."
        )

        cur.execute(
            """
            INSERT INTO evaluations
                (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
            VALUES (%s, %s, %s, NOW(), %s)
            RETURNING id_evaluacion
            """,
            (id_propuesta, payload.id_usuario_eval, id_rol_comite, observaciones),
        )
        id_evaluacion = cur.fetchone()["id_evaluacion"]

        cur.execute(
            """
            INSERT INTO technical_committee_evaluations
                (id_evaluacion, puntaje, decision, justificacion, tiene_bloqueo_obligatorio)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (id_evaluacion, puntaje, payload.decision, payload.justificacion, bloqueo),
        )

        for item in payload.puntajes:
            cur.execute(
                """
                INSERT INTO technical_committee_scores
                    (id_evaluacion, id_criterio_rubrica, puntaje, justificacion)
                VALUES (%s, %s, %s, %s)
                """,
                (
                    id_evaluacion,
                    item.id_criterio_rubrica,
                    item.puntaje,
                    item.justificacion or payload.justificacion,
                ),
            )

        cur.execute(
            "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s RETURNING estado_actual",
            (estado_nuevo, id_propuesta),
        )
        estado_actual = cur.fetchone()["estado_actual"]

        detalle_historial = (
            f"Evaluación del Comité Técnico. Puntaje: {puntaje}/100. "
            f"Decisión: {payload.decision}."
        )
        if bloqueo:
            detalle_historial += " Bloqueo por criterio obligatorio insuficiente."
        if payload.id_documento is not None:
            detalle_historial += f" Documento: {payload.id_documento}."

        # [Línea clave]: El trigger de PostgreSQL inserta la fila del historial al cambiar
        # el estado; se reutiliza para dejar como responsable al evaluador real.
        cur.execute(
            """
            SELECT id_historial
            FROM proposal_state_history
            WHERE id_propuesta = %s AND id_estado_nuevo = %s
            ORDER BY fecha_cambio DESC, id_historial DESC
            LIMIT 1
            """,
            (id_propuesta, estado_nuevo),
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
                    ESTADO_EN_EVALUACION_COMITE,
                    estado_nuevo,
                    payload.id_usuario_eval,
                    detalle_historial,
                ),
            )

        cur.execute("SELECT nombre_estado FROM estados WHERE id_estado = %s", (estado_nuevo,))
        nombre_estado = cur.fetchone()["nombre_estado"]

        if payload.decision == "favorable":
            titulo_notificacion = "Propuesta evaluada favorablemente por el Comité Técnico"
            mensaje_notificacion = (
                f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» obtuvo "
                f"{puntaje}/100 y pasa a aval del Consejo de Escuela."
            )
            cur.execute(
                """
                SELECT DISTINCT u.id_usuario
                FROM usuarios u
                JOIN user_roles ur ON ur.id_usuario = u.id_usuario
                JOIN roles r ON r.id_rol = ur.id_rol
                WHERE r.nombre_rol = %s AND u.estado_activo
                """,
                (ROL_CONSEJO,),
            )
            for destinatario in cur.fetchall():
                cur.execute(
                    """
                    INSERT INTO notificaciones
                        (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida)
                    VALUES (%s, %s, 'tramite', %s, %s, NOW(), false)
                    """,
                    (destinatario["id_usuario"], id_propuesta, titulo_notificacion, mensaje_notificacion),
                )

    return ComiteResultadoOut(
        ok=True,
        id_evaluacion=id_evaluacion,
        id_propuesta=id_propuesta,
        estado_actual=estado_actual,
        nombre_estado=nombre_estado,
        decision=payload.decision,
        puntaje=puntaje,
        tiene_bloqueo_obligatorio=bloqueo,
        id_documento=payload.id_documento,
        mensaje="Evaluación del Comité Técnico registrada exitosamente.",
    )
