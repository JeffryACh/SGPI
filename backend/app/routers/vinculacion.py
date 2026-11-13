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
    GET/POST /propuestas/{id}/documentos. Mantiene la transición controlada («En revisión
    de Vinculación» → «En evaluación del Comité Técnico», «Con observaciones» o
    «Rechazada»), con los estados resueltos por nombre.
========================================================================================
"""

import os
from datetime import datetime
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from psycopg import Connection
from pydantic import BaseModel, Field

from ..almacenamiento import (
    BUCKET,
    SUBCARPETA_PROPUESTAS,
    asegurar_marcador,
    borrar_archivo,
    config_storage,
    nombre_archivo_seguro,
    resolver_carpeta_convocatoria,
    ruta_documento_propuesta,
    subir_archivo,
    url_publica,
)
from ..db import get_conn
from ..estados import (
    ESTADO_COMITE,
    ESTADO_OBSERVACIONES,
    ESTADO_RECHAZADA,
    ESTADO_VINCULACION,
    resolver_estado,
)

# [Línea clave]: ¿Por qué soy importante? Declara el router antes de propuestas.py. ¿Para qué? Evitar que /propuestas/bandeja sea interpretado como /propuestas/{id_propuesta}. ¿Dónde me usan? En backend/app/main.py al registrar los routers.
router = APIRouter(prefix="/propuestas", tags=["vinculacion"])

ROL_VINCULACION = "Vinculación"
ROL_COMITE = "Comité Técnico"
MAX_BYTES = 20 * 1024 * 1024
MIME_POR_EXTENSION = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
# [Línea clave]: Los estados se resuelven por nombre desde 'app.estados' porque el orden de los
# identificadores en la tabla «estados» de la base desplegada no coincide con el seed V3.
# El destino de cada decisión vive en la máquina de estados institucional.
ESTADO_POR_DECISION = {
    "favorable": ESTADO_COMITE,
    "observaciones": ESTADO_OBSERVACIONES,
    "rechazo": ESTADO_RECHAZADA,
}


class VinculacionEvaluacionIn(BaseModel):
    """
    Datos de entrada para el registro del dictamen técnico emitido por el Centro de Vinculación.

    Valida la captura del número de oficio, identificación de propiedad intelectual, tipo de
    innovación, valoración técnica y la decisión institucional sobre la propuesta.

    Se utiliza como cuerpo de la petición POST /propuestas/{id_propuesta}/vinculacion desde la pantalla 23.

    atributos:
        * int : id_usuario_eval Identificador del usuario evaluador con rol Vinculación.
        * str : numero_oficio_dictamen Número de oficio formal asignado al dictamen (ej. CV-2027-042).
        * bool : potencial_pi_identificado Indica si la propuesta presenta potencial de activos de PI.
        * Optional[str] : tipo_innovacion Clasificación del tipo de innovación si aplica (producto, proceso, servicio).
        * Optional[str] : activo_previsto Tipo de activo de propiedad intelectual proyectado (software, patente, etc.).
        * str : valoracion_tecnica Justificación y valoración técnica desarrollada por Vinculación.
        * bool : requiere_reserva Indica si los resultados requieren acuerdo de confidencialidad o reserva.
        * Optional[str] : observaciones Observaciones o condiciones adicionales para la ejecución.
        * Literal["favorable", "observaciones", "rechazo"] : decision Decisión adoptada ('favorable', 'observaciones' o 'rechazo').
        * Optional[int] : id_documento Identificador opcional del oficio firmado en formato PDF adjunto.
    """

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
    """
    Datos del dictamen técnico de Vinculación asociado a la evaluación institucional de una propuesta.

    Estructura la información del dictamen técnico emitido por el Centro de Vinculación,
    incluyendo el evaluador, oficio, valoración, identificación de PI y reserva.

    Se utiliza en la propiedad 'evaluacion' de VinculacionDetalleOut para alimentar la vista del expediente.

    atributos:
        * int : id_evaluacion Identificador único de la evaluación en la tabla 'evaluations'.
        * int : id_propuesta Identificador de la propuesta dictaminada.
        * int : id_usuario_eval Identificador del usuario con rol Vinculación que dictaminó.
        * str : evaluador_nombre Nombre completo del funcionario de Vinculación evaluador.
        * datetime : fecha_evaluacion Fecha y hora de emisión del dictamen técnico.
        * Optional[str] : observaciones Observaciones generales registradas en la evaluación.
        * str : numero_oficio_dictamen Número formal de oficio institucional asignado al dictamen.
        * bool : potencial_pi_identificado Bandera que indica si se identificó potencial de PI.
        * Optional[str] : tipo_innovacion Clasificación de la innovación identificada.
        * Optional[str] : activo_previsto Nombre o tipo del activo de propiedad intelectual proyectado.
        * str : valoracion_tecnica Texto descriptivo con la valoración técnica de vinculación.
        * bool : requiere_reserva Marca de necesidad de reserva o confidencialidad de resultados.
    """

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
    """
    Metadatos y enlaces de acceso a un documento digital adjunto al expediente de la propuesta.

    Permite descargar oficios, anexos o acuerdos almacenados en Supabase Storage o URLs remotas.

    Se utiliza en la lista 'documentos' del expediente para consulta de Vinculación.

    atributos:
        * int : id_documento Clave primaria del documento en 'proposal_documents'.
        * int : id_propuesta Identificador de la propuesta asociada.
        * str : nombre_archivo Nombre del archivo adjunto con su extensión.
        * str : tipo_documento Clasificación documental (Dictamen de Vinculación, Oficio, etc.).
        * str : extension Extensión de archivo normalizada (pdf, docx, etc.).
        * str : file_path Ruta interna del archivo dentro del bucket de Storage.
        * str : file_url URL pública firmada o directa para visualización en el navegador.
        * int : tamano_bytes Tamaño físico del archivo en bytes.
        * str : version Versión del documento en el historial.
        * int : id_usuario_subio Identificador del usuario que cargó el archivo.
        * datetime : fecha_subida Marca de tiempo en que se almacenó el archivo.
    """

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
    """
    Respuesta consolidada del expediente de Vinculación para una propuesta específica.

    Reúne el dictamen técnico vigente y la colección de documentos y oficios adjuntos.

    Se utiliza como response_model en el endpoint GET /propuestas/{id_propuesta}/vinculacion.

    atributos:
        * int : id_propuesta Identificador único de la propuesta consultada.
        * Optional[VinculacionEvaluacionOut] : evaluacion Último dictamen técnico emitido por Vinculación (o null).
        * list[DocumentoPropuestaOut] : documentos Lista de oficios y documentos vinculados a la propuesta.
    """

    id_propuesta: int
    evaluacion: Optional[VinculacionEvaluacionOut] = None
    documentos: list[DocumentoPropuestaOut] = []


class VinculacionResultadoOut(BaseModel):
    """
    Resultado de la persistencia del dictamen emitido por el Centro de Vinculación.

    Confirma el registro transaccional en la base de datos y la transición de estado resultante.

    Se utiliza como response_model en el endpoint POST /propuestas/{id_propuesta}/vinculacion.

    atributos:
        * bool : ok Bandera de confirmación de registro exitoso.
        * int : id_evaluacion Identificador de la evaluación registrada en 'evaluations'.
        * int : id_propuesta Identificador de la propuesta calificada.
        * int : estado_actual Nuevo identificador del estado tras la transición.
        * str : nombre_estado Denominación legible del nuevo estado institucional.
        * str : decision Decisión adoptada ('favorable', 'observaciones' o 'rechazo').
        * Optional[int] : id_documento Identificador del oficio de respaldo adjunto en Storage.
        * str : mensaje Mensaje descriptivo del resultado de la operación.
    """

    ok: bool
    id_evaluacion: int
    id_propuesta: int
    estado_actual: int
    nombre_estado: str
    decision: str
    id_documento: Optional[int] = None
    mensaje: str


def _url_documento(file_path: str) -> str:
    """
    Construir la URL pública accesible para un archivo almacenado en Supabase Storage.

    Delega en 'app.almacenamiento' para que todos los routers compartan la misma regla
    de construcción de enlaces hacia el bucket institucional.

    parametros:
        - str : file_path Ruta relativa del archivo en el bucket.

    return:
        + str : url URL completa de acceso al documento.
    """

    return url_publica(file_path, BUCKET)


def _obtener_rol_vinculacion(cur, id_usuario: int) -> int:
    """
    Validar que el usuario especificado exista, esté activo y cuente con el rol Vinculación.

    Verifica la asignación en 'user_roles' y 'roles', arrojando HTTP 403 si el usuario
    no tiene autorización.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_usuario Identificador del usuario a validar.

    return:
        + int : id_rol Identificador del rol Vinculación verificado.
    """

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
    """
    Listar los documentos adjuntos a una propuesta con sus metadatos y enlaces de acceso.

    Consulta la tabla 'proposal_documents' ordenando por fecha de subida descendente.

    parametros:
        - Cursor : cur Cursor activo de PostgreSQL.
        - int : id_propuesta Identificador único de la propuesta.

    return:
        + list[DocumentoPropuestaOut] : documentos Lista de documentos vinculados a la propuesta.
    """

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
    """
    Listar las propuestas asignadas a la bandeja de revisión del Centro de Vinculación.

    Valida la autorización del usuario con rol 'Vinculación', consulta las propuestas en estado 2
    (En revisión de Vinculación) o que ya cuentan con dictamen de Vinculación, calculando montos
    y ordenando por fecha de creación descendente.

    parametros:
        - int : id_usuario Identificador del usuario autenticado que solicita la bandeja.
        - str : rol Nombre del rol institucional declarado por el cliente.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool.

    return:
        + list[dict] : bandeja Lista de expedientes de propuestas asignadas a Vinculación.
    """

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
            WHERE p.estado_actual = (
                      SELECT id_estado FROM estados WHERE nombre_estado = %s
                  )
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
            (ESTADO_VINCULACION, ROL_VINCULACION),
        )
        filas = cur.fetchall()

    return filas


@router.get("/{id_propuesta}/vinculacion", response_model=VinculacionDetalleOut)
def obtener_vinculacion_propuesta(
    id_propuesta: int,
    id_usuario: int = Query(..., description="Usuario autenticado con rol Vinculación"),
    conn: Connection = Depends(get_conn),
):
    """
    Consultar el expediente de Vinculación de una propuesta con su último dictamen y documentos.

    Verifica los permisos del evaluador y obtiene el dictamen emitido por Vinculación junto con
    los documentos y oficios filtrados.

    parametros:
        - int : id_propuesta Identificador de la propuesta consultada.
        - int : id_usuario Identificador del usuario consultante con rol Vinculación.
        - Connection : conn Conexión a la base de datos inyectada por FastAPI.

    return:
        + VinculacionDetalleOut : expediente Expediente con el dictamen de Vinculación y anexos.
    """

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
    """
    Registrar el dictamen técnico del Centro de Vinculación y ejecutar la transición de estado.

    Bloquea la propuesta de manera concurrente, valida permisos, persiste la evaluación en
    'evaluations' y 'vinculacion_evaluations', actualiza el estado (3 si es favorable, 9 si tiene observaciones,
    o 10 si es rechazo), actualiza el historial y notifica al Comité Técnico.

    parametros:
        - int : id_propuesta Identificador único de la propuesta dictaminada.
        - VinculacionEvaluacionIn : payload Formulario con el dictamen técnico y decisión.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + VinculacionResultadoOut : resultado Objeto de confirmación con el id de evaluación y el nuevo estado.
    """

    with conn.cursor() as cur:
        id_rol = _obtener_rol_vinculacion(cur, payload.id_usuario_eval)
        estado_vinculacion = resolver_estado(cur, ESTADO_VINCULACION)
        estado_nuevo = resolver_estado(cur, ESTADO_POR_DECISION[payload.decision])

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
        if propuesta["estado_actual"] != estado_vinculacion:
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
                VALUES (%s, %s, %s, %s, NOW(), %s)
                """,
                (id_propuesta, estado_vinculacion, estado_nuevo, payload.id_usuario_eval, detalle_historial),
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
        if payload.decision != "favorable" and payload.observaciones:
            mensaje_notificacion += f" Observaciones: {payload.observaciones.strip()}"

        # [Línea clave]: El destinatario del aviso depende de la decisión: solo un dictamen
        # favorable remite el expediente al Comité Técnico. Una devolución o un rechazo
        # notifican al investigador líder, que es quien debe actuar sobre el expediente.
        if payload.decision == "favorable":
            destinatarios_notificacion = []
            cur.execute(
                """
                SELECT DISTINCT u.id_usuario
                FROM usuarios u
                JOIN user_roles ur ON ur.id_usuario = u.id_usuario
                JOIN roles r ON r.id_rol = ur.id_rol
                WHERE r.nombre_rol = %s AND u.estado_activo
                """,
                (ROL_COMITE,),
            )
            destinatarios_notificacion = [fila["id_usuario"] for fila in cur.fetchall()]
        else:
            destinatarios_notificacion = [propuesta["id_usuario_lider"]]

        for destinatario in destinatarios_notificacion:
            cur.execute(
                """
                INSERT INTO notificaciones
                    (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida)
                VALUES (%s, %s, 'tramite', %s, %s, NOW(), false)
                """,
                (destinatario, id_propuesta, titulo_notificacion, mensaje_notificacion),
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
    """
    Listar los documentos y anexos registrados para una propuesta específica.

    Lee los registros de la tabla 'proposal_documents' y retorna la lista de metadatos con URLs públicas.

    parametros:
        - int : id_propuesta Identificador único de la propuesta.
        - Connection : conn Conexión a la base de datos.

    return:
        + list[DocumentoPropuestaOut] : documentos Lista de documentos adjuntos a la propuesta.
    """

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
    """
    Subir un documento o dictamen en PDF a Supabase Storage y registrar sus metadatos en la base de datos.

    Valida la extensión y el tamaño del archivo, lo carga mediante HTTP en el bucket 'convocatorias'
    de Supabase Storage y registra la fila correspondiente en 'proposal_documents'.

    El archivo se guarda dentro de la carpeta de su convocatoria:
    <convocatoria>/propuestas/<codigo>/<archivo>. La carpeta de la propuesta se crea
    automáticamente con la primera subida.

    parametros:
        - int : id_propuesta Identificador de la propuesta a la que se adjunta el documento.
        - UploadFile : archivo Archivo binario cargado en la petición multipart.
        - int : id_usuario Identificador del usuario que sube el archivo.
        - str : tipo_documento Clasificación del documento (por defecto 'Dictamen de Vinculación').
        - str : version Versión del documento (ej. '1.0').
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + DocumentoPropuestaOut : documento Metadatos del documento creado con su URL pública.
    """

    nombre_archivo = nombre_archivo_seguro(archivo.filename or "")
    extension = os.path.splitext(nombre_archivo)[1].lstrip(".")
    mime = MIME_POR_EXTENSION.get(extension)
    if not mime:
        raise HTTPException(400, "Formato no permitido. Usa PDF, DOCX, XLSX o PPTX.")

    contenido = archivo.file.read(MAX_BYTES + 1)
    if not contenido:
        raise HTTPException(400, "El archivo está vacío.")
    if len(contenido) > MAX_BYTES:
        raise HTTPException(413, f"El archivo supera el máximo de {MAX_BYTES // 1048576} MB.")

    url, key = config_storage()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(p.codigo, 'SI-' || p.id_propuesta) AS codigo,
                   p.id_convocatoria
            FROM propuestas p
            WHERE p.id_propuesta = %s
            """,
            (id_propuesta,),
        )
        propuesta = cur.fetchone()
        if not propuesta:
            raise HTTPException(404, "Propuesta no encontrada.")
        if not propuesta["id_convocatoria"]:
            raise HTTPException(
                400,
                "La propuesta no está asociada a una convocatoria, por lo que no se puede "
                "reservar su carpeta de documentos.",
            )

        cur.execute(
            "SELECT 1 FROM usuarios WHERE id_usuario = %s AND estado_activo",
            (id_usuario,),
        )
        if not cur.fetchone():
            raise HTTPException(403, "El usuario que adjunta el documento no está activo.")

        # [Línea clave]: La carpeta de la propuesta cuelga de su convocatoria, de modo que todo
        #                lo que pertenece a la convocatoria queda junto en el bucket.
        carpeta_convocatoria = resolver_carpeta_convocatoria(cur, propuesta["id_convocatoria"])
        # [Línea clave]: Un sufijo único permite conservar versiones del mismo nombre
        # sin que Supabase Storage rechace la carga por archivo duplicado.
        storage_path = ruta_documento_propuesta(
            carpeta_convocatoria,
            propuesta["codigo"],
            f"{uuid4().hex[:8]}-{nombre_archivo}",
        )
        file_url = f"{url}/storage/v1/object/public/{BUCKET}/{storage_path}"

        estado, detalle = subir_archivo(url, key, storage_path, contenido, mime)
        if estado == 0:
            conn.rollback()
            raise HTTPException(502, "No se pudo contactar a Supabase Storage.")

        if estado >= 400:
            conn.rollback()
            if "Duplicate" in detalle or estado == 409:
                raise HTTPException(409, f"Ya existe un archivo llamado '{nombre_archivo}'.")
            raise HTTPException(502, f"Storage rechazó el archivo: {detalle}")

        # [Línea clave]: El marcador deja visible la carpeta 'propuestas' de la convocatoria
        # aunque todavía no tenga archivos.
        asegurar_marcador(url, key, carpeta_convocatoria, SUBCARPETA_PROPUESTAS)

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
            borrar_archivo(url, key, storage_path)
            raise HTTPException(500, "No se pudo registrar el documento en la base de datos.")

    return DocumentoPropuestaOut(**{**documento, "file_url": file_url})
