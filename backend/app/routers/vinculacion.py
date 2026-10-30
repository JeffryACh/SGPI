"""
========================================================================================
ARCHIVO: backend/app/routers/vinculacion.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Implementar la bandeja, el dictamen técnico y los documentos firmados del Centro de
    Vinculación dentro del flujo de evaluación de propuestas VIE 2027.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta 'propuestas', 'evaluations', 'vinculacion_evaluations', 'roles',
             'user_roles', 'usuarios', 'notificaciones' y 'proposal_documents'.
           - Recibe los formularios JSON y multipart de 'frontend/js/app.js'.
           - Usa 'app.db.get_conn' para la transacción y 'SUPABASE_URL' /
             'SUPABASE_SERVICE_KEY' para Storage.
    2.2.2. A dónde envía datos:
           - Retorna la bandeja de Vinculación, el expediente evaluado y las URLs públicas
             de los documentos a las pantallas 21, 22, 23 y 28.
           - Persiste el dictamen en 'evaluations' + 'vinculacion_evaluations', cambia el
             estado de la propuesta y crea notificaciones para el Comité Técnico.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSOMODO?:
    Expone GET /propuestas/bandeja, GET/POST /propuestas/{id}/vinculacion y
    GET/POST /propuestas/{id}/documentos. Mantiene la transición controlada 2 -> 3, 9 o 10.
========================================================================================
"""

import os
import unicodedata
from datetime import datetime
from typing import Literal, Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from psycopg import Connection
from pydantic import BaseModel, Field

from ..db import get_conn

# [Línea clave]: Se registra antes que propuestas.router para que /propuestas/bandeja no
# sea interpretado por la ruta dinámica /propuestas/{id_propuesta}.
router = APIRouter(prefix="/propuestas", tags=["vinculacion"])

ROL_VINCULACION = "Vinculación"
BUCKET = "convocatorias"
MAX_BYTES = 20 * 1024 * 1024
MIME_POR_EXTENSION = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
ESTADO_POR_DECISION = {"favorable": 3, "observaciones": 9, "rechazo": 10}


class VinculacionEvaluacionIn(BaseModel):
    """Datos del dictamen técnico emitido por Vinculación."""

    id_usuario_eval: int
    numero_oficio_dictamen: str = Field(min_length=1)
    potencial_pi_identificado: bool = False
    tipo_innovacion: Optional[str] = None
    activo_previsto: Optional[str] = None
    valoracion_tecnica: str = Field(min_length=1)
    requiere_reserva: bool = False
    observaciones: Optional[str] = ""
    decision: Literal["favorable", "observaciones", "rechazo"] = "favorable"
    id_documento: Optional[int] = None


class VinculacionEvaluacionOut(BaseModel):
    """Dictamen de Vinculación con los datos de la evaluación base."""

    id_evaluacion: int
    id_propuesta: int
    id_usuario_eval: int
    evaluador_nombre: str
    fecha_evaluacion: datetime
    observaciones: Optional[str] = None
    numero_oficio_dictamen: str
    potencial_pi_identificado: bool
    tipo_innovacion: Optional[str] = None
    activo_previsto: Optional[str] = None
    valoracion_tecnica: str
    requiere_reserva: bool


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


class VinculacionDetalleOut(BaseModel):
    """Respuesta consolidada del expediente de Vinculación."""

    id_propuesta: int
    evaluacion: Optional[VinculacionEvaluacionOut] = None
    documentos: list[DocumentoPropuestaOut] = []


class VinculacionResultadoOut(BaseModel):
    """Resultado de registrar un dictamen de Vinculación."""

    ok: bool
    id_evaluacion: int
    id_propuesta: int
    estado_actual: int
    nombre_estado: str
    decision: str
    id_documento: Optional[int] = None
    mensaje: str


def _slugify(texto: str) -> str:
    """Normalizar un texto para usarlo como nombre seguro dentro de Storage."""

    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    t = "".join(c if c.isalnum() else "-" for c in t.lower()).strip("-")
    return t or "documento"


def _nombre_archivo_seguro(nombre: str) -> str:
    """Conservar la extensión y normalizar el nombre del archivo."""

    base, ext = os.path.splitext(nombre or "")
    return f"{_slugify(base)}{ext.lower()}"


def _config_storage() -> tuple[str, str]:
    """Leer la URL y la service key de Supabase Storage."""

    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise HTTPException(500, "Supabase Storage no está configurado en el servidor.")
    return url, key


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


def _obtener_rol_vinculacion(cur, id_usuario: int) -> int:
    """Validar que el usuario exista, esté activo y tenga el rol Vinculación."""

    cur.execute(
        """
        SELECT r.id_rol
        FROM usuarios u
        JOIN user_roles ur ON ur.id_usuario = u.id_usuario
        JOIN roles r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = %s AND u.estado_activo AND r.nombre_rol = %s
        """,
        (id_usuario, ROL_VINCULACION),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(403, "El usuario no tiene el rol Vinculación.")
    return fila["id_rol"]


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


@router.get("/bandeja", response_model=list[dict])
def obtener_bandeja_vinculacion(
    id_usuario: int = Query(..., description="Usuario autenticado con rol Vinculación"),
    rol: str = Query("Vinculación", description="Rol solicitado por el frontend"),
    conn: Connection = Depends(get_conn),
):
    """Listar propuestas pendientes o ya dictaminadas por Vinculación."""

    if rol.strip().lower() not in ("vinculación", "vinculacion"):
        raise HTTPException(400, "Bandeja no disponible para el rol solicitado.")

    with conn.cursor() as cur:
        _obtener_rol_vinculacion(cur, id_usuario)
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
                COALESCE(SUM(pb.monto), 0)::float AS monto_total
            FROM propuestas p
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            LEFT JOIN proposal_budget pb ON pb.id_propuesta = p.id_propuesta
            WHERE p.estado_actual = 2
               OR EXISTS (
                    SELECT 1
                    FROM evaluations ev
                    JOIN vinculacion_evaluations ve ON ve.id_evaluacion = ev.id_evaluacion
                    JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                    WHERE ev.id_propuesta = p.id_propuesta AND r.nombre_rol = %s
               )
            GROUP BY p.id_propuesta, p.codigo, p.titulo, p.resumen, m.nombre_modalidad,
                     esc.nombre, esc.siglas, lin.nombre_linea, e.nombre_estado,
                     p.estado_actual, u.nombre, u.correo, p.fecha_inicio, p.fecha_fin,
                     p.fecha_creacion
            ORDER BY p.fecha_creacion DESC, p.id_propuesta DESC
            """,
            (ROL_VINCULACION,),
        )
        filas = cur.fetchall()

    return filas


@router.get("/{id_propuesta}/vinculacion", response_model=VinculacionDetalleOut)
def obtener_vinculacion_propuesta(
    id_propuesta: int,
    id_usuario: int = Query(..., description="Usuario autenticado con rol Vinculación"),
    conn: Connection = Depends(get_conn),
):
    """Consultar el último dictamen de Vinculación y sus documentos firmados."""

    with conn.cursor() as cur:
        _obtener_rol_vinculacion(cur, id_usuario)
        cur.execute(
            """
            SELECT ev.id_evaluacion, ev.id_propuesta, ev.id_usuario_eval,
                   ev.fecha_evaluacion, ev.observaciones,
                   TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS evaluador_nombre,
                   ve.numero_oficio_dictamen, ve.potencial_pi_identificado,
                   ve.tipo_innovacion, ve.activo_previsto, ve.valoracion_tecnica,
                   ve.requiere_reserva
            FROM evaluations ev
            JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = %s
            JOIN vinculacion_evaluations ve ON ve.id_evaluacion = ev.id_evaluacion
            JOIN usuarios u ON u.id_usuario = ev.id_usuario_eval
            WHERE ev.id_propuesta = %s
            ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
            LIMIT 1
            """,
            (ROL_VINCULACION, id_propuesta),
        )
        evaluacion = cur.fetchone()
        documentos = _documentos_propuesta(cur, id_propuesta)

    return VinculacionDetalleOut(
        id_propuesta=id_propuesta,
        evaluacion=VinculacionEvaluacionOut(**evaluacion) if evaluacion else None,
        documentos=[
            d for d in documentos
            if "vincul" in (d.tipo_documento or "").lower()
            or "dictamen" in (d.tipo_documento or "").lower()
        ],
    )


@router.post("/{id_propuesta}/vinculacion", response_model=VinculacionResultadoOut, status_code=201)
def registrar_vinculacion(
    id_propuesta: int,
    payload: VinculacionEvaluacionIn,
    conn: Connection = Depends(get_conn),
):
    """Registrar el dictamen de Vinculación y ejecutar la transición controlada de estado."""

    estado_nuevo = ESTADO_POR_DECISION[payload.decision]
    with conn.cursor() as cur:
        id_rol = _obtener_rol_vinculacion(cur, payload.id_usuario_eval)

        cur.execute(
            """
            SELECT estado_actual, titulo, COALESCE(codigo, 'SI-' || id_propuesta) AS codigo,
                   id_usuario_lider
            FROM propuestas
            WHERE id_propuesta = %s
            FOR UPDATE
            """,
            (id_propuesta,),
        )
        propuesta = cur.fetchone()
        if not propuesta:
            raise HTTPException(404, "Propuesta no encontrada.")
        if propuesta["estado_actual"] != 2:
            raise HTTPException(
                409,
                "La propuesta no está en revisión de Vinculación; no se puede registrar el dictamen.",
            )

        if payload.id_documento is not None:
            cur.execute(
                "SELECT 1 FROM proposal_documents WHERE id_documento = %s AND id_propuesta = %s",
                (payload.id_documento, id_propuesta),
            )
            if not cur.fetchone():
                raise HTTPException(400, "El documento indicado no pertenece a la propuesta.")

        observaciones = payload.observaciones or f"Dictamen de Vinculación {payload.numero_oficio_dictamen}"
        cur.execute(
            """
            INSERT INTO evaluations
                (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
            VALUES (%s, %s, %s, NOW(), %s)
            RETURNING id_evaluacion
            """,
            (id_propuesta, payload.id_usuario_eval, id_rol, observaciones),
        )
        id_evaluacion = cur.fetchone()["id_evaluacion"]

        cur.execute(
            """
            INSERT INTO vinculacion_evaluations
                (id_evaluacion, numero_oficio_dictamen, potencial_pi_identificado,
                 tipo_innovacion, activo_previsto, valoracion_tecnica, requiere_reserva)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                id_evaluacion,
                payload.numero_oficio_dictamen,
                payload.potencial_pi_identificado,
                payload.tipo_innovacion,
                payload.activo_previsto,
                payload.valoracion_tecnica,
                payload.requiere_reserva,
            ),
        )

        cur.execute(
            "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s RETURNING estado_actual",
            (estado_nuevo, id_propuesta),
        )
        estado_actual = cur.fetchone()["estado_actual"]

        detalle_historial = (
            f"Dictamen de Vinculación {payload.numero_oficio_dictamen}. "
            f"Decisión: {payload.decision}."
        )
        if payload.id_documento is not None:
            detalle_historial += f" Documento: {payload.id_documento}."

        # [Línea clave]: El trigger de PostgreSQL ya inserta una fila automática al cambiar
        # el estado. Se reutiliza esa fila para dejar como responsable al evaluador real.
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
                VALUES (%s, 2, %s, %s, NOW(), %s)
                """,
                (id_propuesta, estado_nuevo, payload.id_usuario_eval, detalle_historial),
            )

        cur.execute("SELECT nombre_estado FROM estados WHERE id_estado = %s", (estado_nuevo,))
        nombre_estado = cur.fetchone()["nombre_estado"]

        titulo_notificacion = {
            "favorable": "Propuesta enviada al Comité Técnico",
            "observaciones": "Vinculación devolvió una propuesta con observaciones",
            "rechazo": "Vinculación rechazó una propuesta",
        }[payload.decision]
        mensaje_notificacion = (
            f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» recibió el dictamen "
            f"{payload.numero_oficio_dictamen} con decisión {payload.decision}."
        )

        cur.execute(
            """
            SELECT DISTINCT u.id_usuario
            FROM usuarios u
            JOIN user_roles ur ON ur.id_usuario = u.id_usuario
            JOIN roles r ON r.id_rol = ur.id_rol
            WHERE r.nombre_rol = 'Comité Técnico' AND u.estado_activo
            """,
        )
        for comite in cur.fetchall():
            cur.execute(
                """
                INSERT INTO notificaciones
                    (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida)
                VALUES (%s, %s, 'tramite', %s, %s, NOW(), false)
                """,
                (comite["id_usuario"], id_propuesta, titulo_notificacion, mensaje_notificacion),
            )

    return VinculacionResultadoOut(
        ok=True,
        id_evaluacion=id_evaluacion,
        id_propuesta=id_propuesta,
        estado_actual=estado_actual,
        nombre_estado=nombre_estado,
        decision=payload.decision,
        id_documento=payload.id_documento,
        mensaje="Dictamen de Vinculación registrado exitosamente.",
    )


@router.get("/{id_propuesta}/documentos", response_model=list[DocumentoPropuestaOut])
def listar_documentos_propuesta(
    id_propuesta: int,
    conn: Connection = Depends(get_conn),
):
    """Listar los documentos registrados para una propuesta."""

    with conn.cursor() as cur:
        return _documentos_propuesta(cur, id_propuesta)


@router.post("/{id_propuesta}/documentos", response_model=DocumentoPropuestaOut, status_code=201)
def subir_documento_propuesta(
    id_propuesta: int,
    archivo: UploadFile = File(...),
    id_usuario: int = Form(...),
    tipo_documento: str = Form("Dictamen de Vinculación"),
    version: str = Form("1.0"),
    conn: Connection = Depends(get_conn),
):
    """Subir un documento de propuesta a Supabase Storage y registrar sus metadatos."""

    nombre_archivo = _nombre_archivo_seguro(archivo.filename or "")
    extension = os.path.splitext(nombre_archivo)[1].lstrip(".")
    mime = MIME_POR_EXTENSION.get(extension)
    if not mime:
        raise HTTPException(400, "Formato no permitido. Usa PDF, DOCX, XLSX o PPTX.")

    contenido = archivo.file.read(MAX_BYTES + 1)
    if not contenido:
        raise HTTPException(400, "El archivo está vacío.")
    if len(contenido) > MAX_BYTES:
        raise HTTPException(413, f"El archivo supera el máximo de {MAX_BYTES // 1048576} MB.")

    url, key = _config_storage()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(codigo, 'SI-' || id_propuesta) AS codigo FROM propuestas WHERE id_propuesta = %s",
            (id_propuesta,),
        )
        propuesta = cur.fetchone()
        if not propuesta:
            raise HTTPException(404, "Propuesta no encontrada.")

        cur.execute(
            "SELECT 1 FROM usuarios WHERE id_usuario = %s AND estado_activo",
            (id_usuario,),
        )
        if not cur.fetchone():
            raise HTTPException(403, "El usuario que adjunta el documento no está activo.")

        carpeta = f"propuestas/{_slugify(propuesta['codigo'])}"
        # [Línea clave]: Un sufijo único permite conservar versiones del mismo nombre
        # sin que Supabase Storage rechace la carga por archivo duplicado.
        storage_path = f"{carpeta}/{uuid4().hex[:8]}-{nombre_archivo}"
        file_url = f"{url}/storage/v1/object/public/{BUCKET}/{storage_path}"

        try:
            respuesta = httpx.post(
                f"{url}/storage/v1/object/{BUCKET}/{storage_path}",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": mime,
                    "x-upsert": "false",
                },
                content=contenido,
                timeout=60,
            )
        except httpx.HTTPError:
            conn.rollback()
            raise HTTPException(502, "No se pudo contactar a Supabase Storage.")

        if respuesta.status_code >= 400:
            conn.rollback()
            if "Duplicate" in respuesta.text or respuesta.status_code == 409:
                raise HTTPException(409, f"Ya existe un archivo llamado '{nombre_archivo}'.")
            raise HTTPException(502, f"Storage rechazó el archivo: {respuesta.text}")

        try:
            cur.execute(
                """
                INSERT INTO proposal_documents
                    (id_propuesta, nombre_archivo, tipo_documento, extension, file_path,
                     tamano_bytes, version, id_usuario_subio)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id_documento, id_propuesta, nombre_archivo, tipo_documento,
                          extension, file_path, tamano_bytes, version, id_usuario_subio,
                          fecha_subida
                """,
                (
                    id_propuesta,
                    nombre_archivo,
                    tipo_documento,
                    extension,
                    storage_path,
                    len(contenido),
                    version,
                    id_usuario,
                ),
            )
            documento = cur.fetchone()
            conn.commit()
        except Exception:
            conn.rollback()
            try:
                httpx.delete(
                    f"{url}/storage/v1/object/{BUCKET}/{storage_path}",
                    headers={"Authorization": f"Bearer {key}"},
                    timeout=30,
                )
            except httpx.HTTPError:
                pass
            raise HTTPException(500, "No se pudo registrar el documento en la base de datos.")

    return DocumentoPropuestaOut(**{**documento, "file_url": file_url})
