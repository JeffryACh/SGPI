"""
========================================================================================
ARCHIVO: backend/app/routers/consejo.py

2.1. OBJETIVO DEL ARCHIVO:
    Implementar la bandeja, el aval institucional y la trazabilidad del Consejo de
    Escuela dentro del flujo de evaluación de propuestas de la Convocatoria Fondos VIE 2027.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta 'propuestas', 'research_team', 'usuarios', 'escuelas', 'roles',
             'user_roles', 'council_endorsements', 'evaluations',
             'technical_committee_evaluations', 'proposal_state_history',
             'notificaciones' y 'proposal_documents'.
           - Recibe el formulario JSON de 'frontend/js/app.js' (pantallas 21, 22, 25 y 28).
           - Usa 'app.db.get_conn' para la transacción atómica contra Supabase.
    2.2.2. A dónde envía datos:
           - Retorna la bandeja del Consejo, el expediente de aval y los acuerdos a las
             pantallas 21, 22, 25 y 28.
           - Persiste el aval en 'council_endorsements', cambia el estado de la propuesta
             («Pendiente de aval del Consejo» → «Avalada», «Con observaciones» o
             «Rechazada», resueltos por nombre desde 'estados') y notifica al
             investigador para el sometimiento formal ante VIE.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSOMODO?:
    Expone GET /propuestas/consejo/bandeja, GET /propuestas/consejo/{id_propuesta} y
    POST /propuestas/consejo/{id_propuesta}. Cada escuela involucrada en la propuesta
    (escuela líder y escuelas del equipo investigador) registra su propio aval; la
    propuesta solo avanza a «Avalada» cuando todas las escuelas involucradas avalaron.
========================================================================================
"""

import os
from datetime import date, datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn
from ..estados import (
    ESTADO_AVALADA,
    ESTADO_OBSERVACIONES,
    ESTADO_PENDIENTE_AVAL,
    ESTADO_RECHAZADA,
    resolver_estado,
)

# [Línea clave]: Se registra antes que propuestas.router en main.py para que las rutas
# literales /propuestas/consejo/... no sean capturadas por /propuestas/{id_propuesta}.
router = APIRouter(prefix="/propuestas", tags=["consejo"])

ROL_CONSEJO = "Consejo de Escuela"
ROL_COMITE_TECNICO = "Comité Técnico"
# [Línea clave]: Los estados se resuelven por nombre desde 'app.estados' porque el orden de los
# identificadores en la tabla «estados» no coincide con el seed V3 en la base de datos desplegada.
# El destino de cada decisión vive en la máquina de estados institucional.
ESTADO_POR_DECISION = {
    "observaciones": ESTADO_OBSERVACIONES,
    "rechazo": ESTADO_RECHAZADA,
}
BUCKET = "convocatorias"


# =====================================================================
# MODELOS DE ENTRADA Y SALIDA
# =====================================================================

class AvalConsejoIn(BaseModel):
    """Formulario de aval del Consejo de Escuela enviado desde la pantalla 25."""

    id_usuario_aval: int
    decision: Literal["favorable", "observaciones", "rechazo"] = "favorable"
    tipo_instancia: Optional[Literal["coordinadora", "participante"]] = None
    numero_sesion: Optional[str] = None
    articulo: Optional[str] = None
    fecha_acuerdo: Optional[date] = None
    numero_oficio: Optional[str] = None
    ratifica_calificacion: bool = True
    avala_presupuesto: bool = True
    avala_horas_personal: bool = True
    observaciones: Optional[str] = ""
    id_documento: Optional[int] = None


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


class EscuelaOut(BaseModel):
    """Escuela involucrada en la propuesta y su estado dentro del aval."""

    id_escuela: int
    nombre: str
    siglas: Optional[str] = None
    es_coordinadora: bool = False
    avalada: bool = False
    tipo_instancia: Optional[str] = None


class AvalOut(BaseModel):
    """Aval registrado por una escuela en el expediente."""

    id_aval: int
    id_propuesta: int
    id_escuela: int
    escuela: str
    escuela_siglas: Optional[str] = None
    tipo_instancia: str
    numero_sesion: str
    articulo: str
    fecha_acuerdo: date
    numero_oficio: str
    ratifica_calificacion: bool
    avala_presupuesto: bool
    avala_horas_personal: bool
    observaciones: Optional[str] = None
    id_usuario_registro: int
    registrado_por: str
    fecha_registro: datetime


class ConsejoDetalleOut(BaseModel):
    """Expediente de aval del Consejo de Escuela."""

    id_propuesta: int
    codigo: str
    titulo: str
    resumen: Optional[str] = None
    estado_actual: int
    nombre_estado: str
    escuela_usuario: EscuelaOut
    escuelas_involucradas: list[EscuelaOut] = []
    avales: list[AvalOut] = []
    mi_aval: Optional[AvalOut] = None
    puede_aval: bool = False
    motivo_bloqueo: Optional[str] = None
    puntaje_comite: Optional[float] = None
    documentos: list[DocumentoPropuestaOut] = []


class ConsejoResultadoOut(BaseModel):
    """Resultado de registrar el aval del Consejo de Escuela."""

    ok: bool
    id_aval: Optional[int] = None
    id_propuesta: int
    estado_actual: int
    nombre_estado: str
    decision: str
    avales_pendientes: list[str] = []
    aval_completo: bool = False
    id_documento: Optional[int] = None
    mensaje: str


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


def _obtener_rol_consejo(cur, id_usuario: int) -> dict:
    """Validar que el usuario exista, esté activo, tenga el rol Consejo de Escuela y una escuela."""

    cur.execute(
        """
        SELECT u.id_usuario, u.id_escuela, e.nombre AS escuela, e.siglas
        FROM usuarios u
        JOIN user_roles ur ON ur.id_usuario = u.id_usuario
        JOIN roles r ON r.id_rol = ur.id_rol
        LEFT JOIN escuelas e ON e.id_escuela = u.id_escuela
        WHERE u.id_usuario = %s AND u.estado_activo AND r.nombre_rol = %s
        """,
        (id_usuario, ROL_CONSEJO),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(403, "El usuario no tiene el rol Consejo de Escuela.")
    if not fila["id_escuela"]:
        raise HTTPException(
            403,
            "El usuario del Consejo de Escuela no tiene una escuela asignada; "
            "no puede avalar expedientes de personal de otra instancia.",
        )
    return fila


def _escuelas_involucradas(cur, id_propuesta: int) -> list[dict]:
    """Listar las escuelas relacionadas con la propuesta: escuela líder y escuelas del equipo."""

    cur.execute(
        """
        SELECT e.id_escuela, e.nombre, e.siglas,
               bool_or(x.es_coordinadora) AS es_coordinadora
        FROM (
            SELECT p.id_escuela AS id_escuela, TRUE AS es_coordinadora
            FROM propuestas p
            WHERE p.id_propuesta = %s
            UNION ALL
            SELECT u.id_escuela, FALSE AS es_coordinadora
            FROM research_team rt
            JOIN usuarios u ON u.id_usuario = rt.id_usuario
            WHERE rt.id_propuesta = %s AND u.id_escuela IS NOT NULL
        ) x
        JOIN escuelas e ON e.id_escuela = x.id_escuela
        GROUP BY e.id_escuela, e.nombre, e.siglas
        ORDER BY e.id_escuela
        """,
        (id_propuesta, id_propuesta),
    )
    return cur.fetchall()


def _avales_propuesta(cur, id_propuesta: int) -> list[AvalOut]:
    """Listar los avales registrados en la propuesta con su escuela y responsable."""

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
    return [AvalOut(**fila) for fila in cur.fetchall()]


def _es_documento_aval(documento: DocumentoPropuestaOut) -> bool:
    """Detectar los acuerdos firmados que respaldan los avales del Consejo de Escuela."""

    texto = f"{documento.tipo_documento or ''} {documento.nombre_archivo or ''}".lower()
    return "aval" in texto or "acuerdo" in texto


# =====================================================================
# ENDPOINTS
# =====================================================================

@router.get("/consejo/bandeja", response_model=list[dict])
def obtener_bandeja_consejo(
    id_usuario: int = Query(..., description="Usuario autenticado con rol Consejo de Escuela"),
    rol: str = Query("Consejo de Escuela", description="Rol solicitado por el frontend"),
    conn: Connection = Depends(get_conn),
):
    """Listar las propuestas pendientes de aval de la escuela del usuario y las ya avaladas."""

    if rol.strip().lower() not in ("consejo de escuela", "consejo"):
        raise HTTPException(400, "Bandeja no disponible para el rol solicitado.")

    with conn.cursor() as cur:
        consejo = _obtener_rol_consejo(cur, id_usuario)
        id_escuela = consejo["id_escuela"]
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
                ingreso.fecha_ingreso_consejo,
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
                esc_inv.total_escuelas AS escuelas_involucradas,
                (
                    SELECT count(*)
                    FROM council_endorsements ce
                    WHERE ce.id_propuesta = p.id_propuesta
                ) AS avales_registrados,
                EXISTS (
                    SELECT 1
                    FROM council_endorsements ce2
                    WHERE ce2.id_propuesta = p.id_propuesta AND ce2.id_escuela = %s
                ) AS mi_aval
            FROM propuestas p
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            LEFT JOIN LATERAL (
                SELECT MAX(h.fecha_cambio) AS fecha_ingreso_consejo
                FROM proposal_state_history h
                WHERE h.id_propuesta = p.id_propuesta
                  AND h.id_estado_nuevo = (
                      SELECT id_estado FROM estados WHERE nombre_estado = %s
                  )
            ) ingreso ON TRUE
            LEFT JOIN LATERAL (
                SELECT count(DISTINCT x.id_escuela) AS total_escuelas
                FROM (
                    SELECT p.id_escuela AS id_escuela
                    UNION
                    SELECT u2.id_escuela
                    FROM research_team rt2
                    JOIN usuarios u2 ON u2.id_usuario = rt2.id_usuario
                    WHERE rt2.id_propuesta = p.id_propuesta AND u2.id_escuela IS NOT NULL
                ) x
            ) esc_inv ON TRUE
            WHERE (
                    p.estado_actual = (
                        SELECT id_estado FROM estados WHERE nombre_estado = %s
                    )
                    AND (
                        p.id_escuela = %s
                        OR EXISTS (
                            SELECT 1
                            FROM research_team rt3
                            JOIN usuarios u3 ON u3.id_usuario = rt3.id_usuario
                            WHERE rt3.id_propuesta = p.id_propuesta AND u3.id_escuela = %s
                        )
                    )
               )
               OR EXISTS (
                    SELECT 1
                    FROM council_endorsements ce3
                    WHERE ce3.id_propuesta = p.id_propuesta AND ce3.id_escuela = %s
               )
            ORDER BY COALESCE(ingreso.fecha_ingreso_consejo, p.fecha_creacion) DESC,
                     p.id_propuesta DESC
            """,
            (
                ROL_COMITE_TECNICO,
                id_escuela,
                ESTADO_PENDIENTE_AVAL,
                ESTADO_PENDIENTE_AVAL,
                id_escuela,
                id_escuela,
                id_escuela,
            ),
        )
        return cur.fetchall()


@router.get("/consejo/{id_propuesta}", response_model=ConsejoDetalleOut)
def obtener_aval_consejo(
    id_propuesta: int,
    id_usuario: int = Query(..., description="Usuario autenticado con rol Consejo de Escuela"),
    conn: Connection = Depends(get_conn),
):
    """Consultar las escuelas involucradas, los avales y los acuerdos de una propuesta."""

    with conn.cursor() as cur:
        consejo = _obtener_rol_consejo(cur, id_usuario)
        id_escuela = consejo["id_escuela"]
        estado_pendiente = resolver_estado(cur, ESTADO_PENDIENTE_AVAL)

        cur.execute(
            """
            SELECT p.id_propuesta, COALESCE(p.codigo, 'SI-' || p.id_propuesta) AS codigo,
                   p.titulo, p.resumen, p.estado_actual, e.nombre_estado,
                   p.id_escuela AS id_escuela_lider,
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
            WHERE p.id_propuesta = %s
            """,
            (ROL_COMITE_TECNICO, id_propuesta),
        )
        propuesta = cur.fetchone()
        if not propuesta:
            raise HTTPException(404, "Propuesta no encontrada.")

        involved = _escuelas_involucradas(cur, id_propuesta)
        avales = _avales_propuesta(cur, id_propuesta)
        documentos = _documentos_propuesta(cur, id_propuesta)

    aval_por_escuela = {aval.id_escuela: aval for aval in avales}
    escuelas: list[EscuelaOut] = []
    for escuela in involved:
        aval = aval_por_escuela.get(escuela["id_escuela"])
        escuelas.append(
            EscuelaOut(
                id_escuela=escuela["id_escuela"],
                nombre=escuela["nombre"],
                siglas=escuela["siglas"],
                es_coordinadora=bool(escuela["es_coordinadora"]),
                avalada=aval is not None,
                tipo_instancia=aval.tipo_instancia if aval else (
                    "coordinadora" if escuela["es_coordinadora"] else "participante"
                ),
            )
        )

    mi_aval = aval_por_escuela.get(id_escuela)
    escuela_en_contrato = any(escuela["id_escuela"] == id_escuela for escuela in involved)

    puede_aval = False
    motivo_bloqueo = None
    if propuesta["estado_actual"] != estado_pendiente:
        motivo_bloqueo = (
            f"La propuesta se encuentra en «{propuesta['nombre_estado']}» y ya no está pendiente de aval."
        )
    elif not escuela_en_contrato:
        motivo_bloqueo = (
            f"La escuela {consejo['siglas'] or consejo['escuela']} no tiene personal "
            "vinculado a esta propuesta; solo puede avalar su propio personal."
        )
    elif mi_aval is not None:
        motivo_bloqueo = (
            f"La escuela {consejo['siglas'] or consejo['escuela']} ya registró su aval "
            "en esta propuesta."
        )
    else:
        puede_aval = True

    return ConsejoDetalleOut(
        id_propuesta=propuesta["id_propuesta"],
        codigo=propuesta["codigo"],
        titulo=propuesta["titulo"],
        resumen=propuesta["resumen"],
        estado_actual=propuesta["estado_actual"],
        nombre_estado=propuesta["nombre_estado"],
        escuela_usuario=EscuelaOut(
            id_escuela=consejo["id_escuela"],
            nombre=consejo["escuela"],
            siglas=consejo["siglas"],
            es_coordinadora=consejo["id_escuela"] == propuesta["id_escuela_lider"],
            avalada=mi_aval is not None,
            tipo_instancia=(
                "coordinadora"
                if consejo["id_escuela"] == propuesta["id_escuela_lider"]
                else "participante"
            ),
        ),
        escuelas_involucradas=escuelas,
        avales=avales,
        mi_aval=mi_aval,
        puede_aval=puede_aval,
        motivo_bloqueo=motivo_bloqueo,
        puntaje_comite=float(propuesta["puntaje_comite"]) if propuesta["puntaje_comite"] else None,
        documentos=[documento for documento in documentos if _es_documento_aval(documento)],
    )


@router.post("/consejo/{id_propuesta}", response_model=ConsejoResultadoOut, status_code=201)
def registrar_aval_consejo(
    id_propuesta: int,
    payload: AvalConsejoIn,
    conn: Connection = Depends(get_conn),
):
    """Registrar el aval del Consejo de Escuela y ejecutar la transición controlada de estado."""

    with conn.cursor() as cur:
        consejo = _obtener_rol_consejo(cur, payload.id_usuario_aval)
        id_escuela = consejo["id_escuela"]
        estado_pendiente = resolver_estado(cur, ESTADO_PENDIENTE_AVAL)

        # [Línea clave]: Bloquea la fila de la propuesta para que dos consejos de la misma
        # escuela no registren avales duplicados de forma concurrente.
        cur.execute(
            """
            SELECT id_propuesta, estado_actual, titulo, id_usuario_lider, id_escuela,
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

        if propuesta["estado_actual"] != estado_pendiente:
            raise HTTPException(
                409,
                "La propuesta no está pendiente de aval del Consejo de Escuela; "
                "no se puede registrar un nuevo aval.",
            )

        involucradas = _escuelas_involucradas(cur, id_propuesta)
        if not any(escuela["id_escuela"] == id_escuela for escuela in involucradas):
            raise HTTPException(
                403,
                f"El Consejo de Escuela de {consejo['siglas'] or consejo['escuela']} "
                "no puede avalar a personal de otra escuela.",
            )

        cur.execute(
            "SELECT id_aval FROM council_endorsements WHERE id_propuesta = %s AND id_escuela = %s",
            (id_propuesta, id_escuela),
        )
        if cur.fetchone():
            raise HTTPException(
                409,
                f"La escuela {consejo['siglas'] or consejo['escuela']} ya registró su aval "
                "en esta propuesta.",
            )

        if payload.id_documento is not None:
            cur.execute(
                "SELECT 1 FROM proposal_documents WHERE id_documento = %s AND id_propuesta = %s",
                (payload.id_documento, id_propuesta),
            )
            if not cur.fetchone():
                raise HTTPException(400, "El documento indicado no pertenece a la propuesta.")

        if payload.decision == "favorable":
            faltantes = [
                nombre
                for nombre, valor in (
                    ("el número de sesión", payload.numero_sesion),
                    ("el artículo del acuerdo", payload.articulo),
                    ("la fecha del acuerdo", payload.fecha_acuerdo),
                    ("el número de oficio", payload.numero_oficio),
                )
                if not valor
            ]
            if faltantes:
                raise HTTPException(
                    400,
                    "Para registrar el aval debes completar " + ", ".join(faltantes) + ".",
                )
            if not (
                payload.ratifica_calificacion
                and payload.avala_presupuesto
                and payload.avala_horas_personal
            ):
                raise HTTPException(
                    409,
                    "El aval requiere ratificar la calificación técnica y avalar el presupuesto "
                    "y las horas del personal.",
                )
        elif not (payload.observaciones or "").strip():
            raise HTTPException(
                400,
                "Debes registrar las observaciones para devolver o rechazar la propuesta.",
            )

        tipo_instancia = (
            "coordinadora" if propuesta["id_escuela"] == id_escuela else "participante"
        )
        id_aval = None
        if payload.decision == "favorable":
            cur.execute(
                """
                INSERT INTO council_endorsements
                    (id_propuesta, id_escuela, tipo_instancia, numero_sesion, articulo,
                     fecha_acuerdo, numero_oficio, ratifica_calificacion, avala_presupuesto,
                     avala_horas_personal, observaciones, id_usuario_registro, fecha_registro)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                RETURNING id_aval
                """,
                (
                    id_propuesta,
                    id_escuela,
                    tipo_instancia,
                    (payload.numero_sesion or "").strip(),
                    (payload.articulo or "").strip(),
                    payload.fecha_acuerdo,
                    (payload.numero_oficio or "").strip(),
                    payload.ratifica_calificacion,
                    payload.avala_presupuesto,
                    payload.avala_horas_personal,
                    (payload.observaciones or "").strip() or None,
                    payload.id_usuario_aval,
                ),
            )
            id_aval = cur.fetchone()["id_aval"]

        # [Línea clave]: La propuesta solo avanza a «Avalada» cuando todas las escuelas
        # relacionadas con ella registraron su aval.
        pendientes = []
        for escuela in involucradas:
            cur.execute(
                """
                SELECT 1 FROM council_endorsements
                WHERE id_propuesta = %s AND id_escuela = %s
                """,
                (id_propuesta, escuela["id_escuela"]),
            )
            if not cur.fetchone():
                pendientes.append(escuela["siglas"] or escuela["nombre"])

        if payload.decision == "favorable":
            estado_nuevo = (
                resolver_estado(cur, ESTADO_AVALADA)
                if not pendientes
                else estado_pendiente
            )
        else:
            estado_nuevo = resolver_estado(cur, ESTADO_POR_DECISION[payload.decision])

        aval_completo = payload.decision == "favorable" and not pendientes
        estado_actual = propuesta["estado_actual"]
        nombre_estado = ""

        if estado_nuevo != estado_actual:
            cur.execute(
                "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s RETURNING estado_actual",
                (estado_nuevo, id_propuesta),
            )
            estado_actual = cur.fetchone()["estado_actual"]

            detalle_historial = (
                f"Aval del Consejo de Escuela ({consejo['siglas'] or consejo['escuela']}). "
                f"Decisión: {payload.decision}."
            )
            if payload.id_documento is not None:
                detalle_historial += f" Documento: {payload.id_documento}."
            if payload.observaciones:
                detalle_historial += f" {payload.observaciones.strip()}"

            # [Línea clave]: El trigger de PostgreSQL inserta la fila del historial al cambiar
            # el estado; se reutiliza para dejar como responsable al miembro del consejo.
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
                    (payload.id_usuario_aval, detalle_historial, fila_historial["id_historial"]),
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
                        estado_nuevo,
                        payload.id_usuario_aval,
                        detalle_historial,
                    ),
                )

            cur.execute(
                "SELECT nombre_estado FROM estados WHERE id_estado = %s",
                (estado_actual,),
            )
            nombre_estado = cur.fetchone()["nombre_estado"]

            if payload.decision == "favorable":
                titulo_notificacion = "Propuesta avalada por el Consejo de Escuela"
                mensaje_notificacion = (
                    f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» fue avalada por "
                    f"{consejo['escuela']}. Corresponde realizar el sometimiento formal ante VIE."
                )
            elif payload.decision == "observaciones":
                titulo_notificacion = "Propuesta devuelta con observaciones por el Consejo de Escuela"
                mensaje_notificacion = (
                    f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» fue devuelta "
                    f"con observaciones: {(payload.observaciones or '').strip()}"
                )
            else:
                titulo_notificacion = "Propuesta rechazada por el Consejo de Escuela"
                mensaje_notificacion = (
                    f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» fue rechazada: "
                    f"{(payload.observaciones or '').strip()}"
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
        else:
            cur.execute(
                "SELECT nombre_estado FROM estados WHERE id_estado = %s",
                (estado_actual,),
            )
            nombre_estado = cur.fetchone()["nombre_estado"]

    if payload.decision == "favorable" and pendientes:
        mensaje = (
            f"Aval de {consejo['siglas'] or consejo['escuela']} registrado. "
            f"Falta el aval de: {', '.join(pendientes)}. "
            "La propuesta permanece pendiente de aval."
        )
    elif payload.decision == "favorable":
        mensaje = (
            f"Aval completo registrado por {consejo['siglas'] or consejo['escuela']}. "
            "La propuesta quedó Avalada y el investigador debe realizar el sometimiento formal."
        )
    elif payload.decision == "observaciones":
        mensaje = "La propuesta fue devuelta con observaciones al investigador."
    else:
        mensaje = "La propuesta fue rechazada por el Consejo de Escuela."

    return ConsejoResultadoOut(
        ok=True,
        id_aval=id_aval,
        id_propuesta=id_propuesta,
        estado_actual=estado_actual,
        nombre_estado=nombre_estado,
        decision=payload.decision,
        avales_pendientes=pendientes,
        aval_completo=aval_completo,
        id_documento=payload.id_documento,
        mensaje=mensaje,
    )
