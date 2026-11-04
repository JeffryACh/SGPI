"""
========================================================================================
ARCHIVO: backend/app/routers/tramite.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Implementar los trámites que completan el ciclo de vida de una propuesta en la
    Convocatoria Fondos VIE 2027: el reenvío del expediente después de atender
    observaciones, la aceptación de la carta del CIE, el registro de informes de
    ejecución y el cierre administrativo del proyecto.

    Estos trámites no existían en el backend: sin ellos, una propuesta devuelta con
    observaciones quedaba detenida en «Con observaciones» y una propuesta aprobada por
    el CIE nunca avanzaba a «En ejecución» ni «Cerrada».

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta 'propuestas', 'estados', 'usuarios', 'roles', 'user_roles',
             'research_team', 'evaluations', 'proposal_documents', 'proposal_state_history'
             y 'notificaciones'.
           - Usa 'app.estados' para la máquina de estados institucional y 'app.db.get_conn'
             para la transacción atómica contra Supabase.
    2.2.2. A dónde envía datos:
           - Cambia el estado de la propuesta, registra el historial, inserta evaluaciones
             de seguimiento y notifica al actor que debe continuar el trámite.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSOMODO?:
    Expone POST /propuestas/{id}/observaciones/reenvio, POST /propuestas/{id}/aceptacion,
    POST /propuestas/{id}/informe y POST /propuestas/{id}/cierre. Valida que el expediente
    esté en la etapa correcta y que el usuario tenga facultad para actuar, ejecuta la
    transición controlada y deja trazabilidad en la bitácora institucional.
========================================================================================
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection
from pydantic import BaseModel

from ..db import get_conn
from ..estados import (
    ESTADO_APROBADA_CIE,
    ESTADO_CERRADA,
    ESTADO_EJECUCION,
    ESTADO_OBSERVACIONES,
    ROLES_ADMINISTRATIVOS,
    etapa_origen_devolucion,
    resolver_estado,
)

# [Línea clave]: Se registra antes que propuestas.router en main.py para que las rutas
# literales /propuestas/.../observaciones/reenvio no sean capturadas por las rutas
# dinámicas de /propuestas/{id_propuesta}.
router = APIRouter(prefix="/propuestas", tags=["tramite"])

ROL_INVESTIGADOR = "Investigador"
ROL_DIRECCION = "Dirección de Investigación"

#: Etapas institucionales a las que puede regresar un expediente devuelto con observaciones.
ETAPAS_DE_DEVOLUCION = (
    "En revisión de Vinculación",
    "En evaluación del Comité Técnico",
    "Pendiente de aval del Consejo",
    "Sometida ante VIE",
)

#: Roles que deben recibir el aviso cuando el expediente reingresa a una etapa.
ROLES_POR_ETAPA_DEVOLUCION = {
    "En revisión de Vinculación": ("Vinculación", "Gestor de Vinculación"),
    "En evaluación del Comité Técnico": ("Comité Técnico", "Evaluador Comité Técnico"),
    "Pendiente de aval del Consejo": ("Consejo de Escuela",),
    "Sometida ante VIE": ("Dirección de Investigación",),
}


class TramiteIn(BaseModel):
    """
    Datos de entrada comunes para los trámites del expediente (reenvío, aceptación, informe y cierre).

    Se utiliza como cuerpo de petición en los endpoints POST de este router.

    atributos:
        * int : id_usuario Usuario que ejecuta el trámite.
        * Optional[str] : observaciones Detalle o justificación del trámite.
        * Optional[int] : id_documento Documento asociado (carta de aceptación, informe final).
    """

    id_usuario: int
    observaciones: Optional[str] = None
    id_documento: Optional[int] = None


# =====================================================================
# UTILIDADES INTERNAS
# =====================================================================


def _bloquear_propuesta(cur, id_propuesta: int) -> dict:
    """
    Leer y bloquear la fila de una propuesta para operar su trámite de forma concurrente.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_propuesta Identificador de la propuesta.

    return:
        + dict : propuesta Fila con el estado actual, el líder, el título y el código.
    """

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
    return propuesta


def _roles(cur, id_usuario: int) -> list[str]:
    """
    Listar los nombres de rol de un usuario activo.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_usuario Identificador del usuario.

    return:
        + list[str] : roles Nombres de rol asignados al usuario.
    """

    cur.execute(
        """
        SELECT r.nombre_rol
        FROM usuarios u
        JOIN user_roles ur ON ur.id_usuario = u.id_usuario
        JOIN roles r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = %s AND u.estado_activo
        """,
        (id_usuario,),
    )
    return [fila["nombre_rol"] for fila in cur.fetchall()]


def _es_lider_o_administrativo(cur, id_usuario: int, id_usuario_lider: int) -> bool:
    """
    Verificar si el usuario puede actuar en nombre del investigador líder.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_usuario Usuario que ejecuta el trámite.
        - int : id_usuario_lider Líder de la propuesta.

    return:
        + bool : permitido Verdadero si el usuario es el líder o tiene rol administrativo.
    """

    if id_usuario == id_usuario_lider:
        return True
    return any(rol in ROLES_ADMINISTRATIVOS for rol in _roles(cur, id_usuario))


def _registrar_historial(
    cur,
    id_propuesta: int,
    id_estado_anterior: int,
    id_estado_nuevo: int,
    id_usuario: int,
    detalle: str,
) -> None:
    """
    Registrar la transición en la bitácora institucional reutilizando la fila del trigger.

    El trigger de PostgreSQL inserta automáticamente una fila al cambiar 'estado_actual';
    esta función la reutiliza para dejar como responsable al actor real del trámite.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_propuesta Identificador de la propuesta.
        - int : id_estado_anterior Identificador del estado de partida.
        - int : id_estado_nuevo Identificador del estado de llegada.
        - int : id_usuario Usuario responsable del trámite.
        - str : detalle Descripción de la transición.
    """

    cur.execute(
        """
        SELECT id_historial
        FROM proposal_state_history
        WHERE id_propuesta = %s AND id_estado_nuevo = %s
        ORDER BY fecha_cambio DESC, id_historial DESC
        LIMIT 1
        """,
        (id_propuesta, id_estado_nuevo),
    )
    fila = cur.fetchone()
    if fila:
        cur.execute(
            """
            UPDATE proposal_state_history
            SET id_usuario_responsable = %s, observaciones = %s, fecha_cambio = NOW()
            WHERE id_historial = %s
            """,
            (id_usuario, detalle, fila["id_historial"]),
        )
    else:
        cur.execute(
            """
            INSERT INTO proposal_state_history
                (id_propuesta, id_estado_anterior, id_estado_nuevo,
                 id_usuario_responsable, fecha_cambio, observaciones)
            VALUES (%s, %s, %s, %s, NOW(), %s)
            """,
            (id_propuesta, id_estado_anterior, id_estado_nuevo, id_usuario, detalle),
        )


def _notificar(cur, id_usuario: int, id_propuesta: int, titulo: str, mensaje: str) -> None:
    """
    Insertar una notificación de trámite para un destinatario.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_usuario Destinatario del aviso.
        - int : id_propuesta Propuesta relacionada con el aviso.
        - str : titulo Encabezado del aviso.
        - str : mensaje Cuerpo del aviso.
    """

    cur.execute(
        """
        INSERT INTO notificaciones
            (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida)
        VALUES (%s, %s, 'tramite', %s, %s, NOW(), false)
        """,
        (id_usuario, id_propuesta, titulo, mensaje),
    )


def _notificar_rol(cur, roles_destino: tuple[str, ...], id_propuesta: int, titulo: str, mensaje: str) -> None:
    """
    Insertar una notificación de trámite para todos los usuarios activos de uno o varios roles.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - tuple[str, ...] : roles_destino Nombres de rol que deben recibir el aviso.
        - int : id_propuesta Propuesta relacionada con el aviso.
        - str : titulo Encabezado del aviso.
        - str : mensaje Cuerpo del aviso.
    """

    cur.execute(
        """
        SELECT DISTINCT u.id_usuario
        FROM usuarios u
        JOIN user_roles ur ON ur.id_usuario = u.id_usuario
        JOIN roles r ON r.id_rol = ur.id_rol
        WHERE r.nombre_rol = ANY(%s) AND u.estado_activo
        """,
        (list(roles_destino),),
    )
    for destinatario in cur.fetchall():
        _notificar(cur, destinatario["id_usuario"], id_propuesta, titulo, mensaje)


def _validar_documento(cur, id_propuesta: int, id_documento: Optional[int]) -> None:
    """
    Verificar que el documento indicado pertenezca a la propuesta.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_propuesta Identificador de la propuesta.
        - Optional[int] : id_documento Documento a validar (puede ser None).
    """

    if id_documento is None:
        return
    cur.execute(
        "SELECT 1 FROM proposal_documents WHERE id_documento = %s AND id_propuesta = %s",
        (id_documento, id_propuesta),
    )
    if not cur.fetchone():
        raise HTTPException(400, "El documento indicado no pertenece a la propuesta.")


# =====================================================================
# TRÁMITES
# =====================================================================


@router.post("/{id_propuesta}/observaciones/reenvio")
def reenviar_observaciones(
    id_propuesta: int,
    payload: TramiteIn,
    conn: Connection = Depends(get_conn),
):
    """
    Reenviar un expediente devuelto con observaciones a la etapa que lo devolvió.

    El investigador líder atiende las observaciones y devuelve el expediente al órgano
    revisor que lo devolvió (Vinculación, Comité Técnico, Consejo de Escuela o Dirección).
    La etapa de retorno se deduce de la bitácora 'proposal_state_history', por lo que no
    requiere modificar el modelo de datos.

    parametros:
        - int : id_propuesta Identificador de la propuesta.
        - TramiteIn : payload Usuario que reenvía, detalle del ajuste y documento opcional.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : resultado Confirmación con la etapa a la que reingresó el expediente.
    """

    with conn.cursor() as cur:
        propuesta = _bloquear_propuesta(cur, id_propuesta)
        estado_observaciones = resolver_estado(cur, ESTADO_OBSERVACIONES)
        if propuesta["estado_actual"] != estado_observaciones:
            raise HTTPException(
                409,
                "La propuesta no está en «Con observaciones»; no hay nada que reenviar.",
            )

        if not _es_lider_o_administrativo(cur, payload.id_usuario, propuesta["id_usuario_lider"]):
            raise HTTPException(
                403,
                "Solo el investigador líder del proyecto puede reenviar el expediente.",
            )

        _validar_documento(cur, id_propuesta, payload.id_documento)

        etapa_origen = etapa_origen_devolucion(cur, id_propuesta)
        if not etapa_origen or etapa_origen not in ETAPAS_DE_DEVOLUCION:
            raise HTTPException(
                409,
                "No se identificó la etapa institucional que devolvió el expediente.",
            )

        estado_destino = resolver_estado(cur, etapa_origen)
        cur.execute(
            "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s RETURNING estado_actual",
            (estado_destino, id_propuesta),
        )
        estado_actual = cur.fetchone()["estado_actual"]

        detalle = "Reenvío del investigador tras atender las observaciones."
        if payload.observaciones:
            detalle += f" {payload.observaciones.strip()}"
        if payload.id_documento is not None:
            detalle += f" Documento: {payload.id_documento}."
        _registrar_historial(
            cur,
            id_propuesta,
            estado_observaciones,
            estado_destino,
            payload.id_usuario,
            detalle,
        )

        _notificar_rol(
            cur,
            ROLES_POR_ETAPA_DEVOLUCION[etapa_origen],
            id_propuesta,
            "Propuesta reenviada por el investigador",
            f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» fue reenviada a "
            f"«{etapa_origen}» tras atender las observaciones.",
        )

    return {
        "ok": True,
        "id_propuesta": id_propuesta,
        "estado_actual": estado_actual,
        "nombre_estado": etapa_origen,
        "etapa_origen": etapa_origen,
        "mensaje": f"El expediente reingresó a «{etapa_origen}» para su nueva revisión.",
    }


@router.post("/{id_propuesta}/aceptacion")
def registrar_aceptacion(
    id_propuesta: int,
    payload: TramiteIn,
    conn: Connection = Depends(get_conn),
):
    """
    Registrar la aceptación de la carta del CIE e iniciar la ejecución del proyecto.

    Transiciona la propuesta de «Aprobada por CIE» a «En ejecución», deja la carta de
    aceptación en el expediente y avisa a Dirección de Investigación.

    parametros:
        - int : id_propuesta Identificador de la propuesta.
        - TramiteIn : payload Usuario que acepta, detalle y carta de aceptación.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : resultado Confirmación con el nuevo estado de la propuesta.
    """

    with conn.cursor() as cur:
        propuesta = _bloquear_propuesta(cur, id_propuesta)
        estado_aprobada = resolver_estado(cur, ESTADO_APROBADA_CIE)
        if propuesta["estado_actual"] != estado_aprobada:
            raise HTTPException(
                409,
                "La propuesta no está «Aprobada por CIE»; no se puede iniciar la ejecución.",
            )

        if not _es_lider_o_administrativo(cur, payload.id_usuario, propuesta["id_usuario_lider"]):
            raise HTTPException(
                403,
                "Solo el investigador líder del proyecto puede aceptar la carta del CIE.",
            )

        _validar_documento(cur, id_propuesta, payload.id_documento)

        estado_ejecucion = resolver_estado(cur, ESTADO_EJECUCION)
        cur.execute(
            "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s RETURNING estado_actual",
            (estado_ejecucion, id_propuesta),
        )
        estado_actual = cur.fetchone()["estado_actual"]

        detalle = "Carta de aceptación presentada por el investigador."
        if payload.observaciones:
            detalle += f" {payload.observaciones.strip()}"
        if payload.id_documento is not None:
            detalle += f" Documento: {payload.id_documento}."
        _registrar_historial(
            cur,
            id_propuesta,
            estado_aprobada,
            estado_ejecucion,
            payload.id_usuario,
            detalle,
        )

        _notificar_rol(
            cur,
            (ROL_DIRECCION,),
            id_propuesta,
            "Proyecto en ejecución",
            f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» fue aceptada por el "
            "investigador y entró en ejecución.",
        )

    return {
        "ok": True,
        "id_propuesta": id_propuesta,
        "estado_actual": estado_actual,
        "nombre_estado": ESTADO_EJECUCION,
        "mensaje": "La propuesta quedó «En ejecución».",
    }


@router.post("/{id_propuesta}/informe")
def registrar_informe(
    id_propuesta: int,
    payload: TramiteIn,
    conn: Connection = Depends(get_conn),
):
    """
    Registrar un informe de ejecución o seguimiento del proyecto.

    El informe queda en la bitácora de evaluaciones con el rol de investigador y se avisa a
    Dirección de Investigación. La propuesta permanece «En ejecución».

    parametros:
        - int : id_propuesta Identificador de la propuesta.
        - TramiteIn : payload Usuario que reporta, detalle del informe y documento opcional.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : resultado Confirmación del informe registrado.
    """

    with conn.cursor() as cur:
        propuesta = _bloquear_propuesta(cur, id_propuesta)
        estado_ejecucion = resolver_estado(cur, ESTADO_EJECUCION)
        if propuesta["estado_actual"] != estado_ejecucion:
            raise HTTPException(
                409,
                "La propuesta no está «En ejecución»; no se pueden registrar informes.",
            )

        _validar_documento(cur, id_propuesta, payload.id_documento)

        cur.execute(
            """
            SELECT 1
            FROM research_team rt
            WHERE rt.id_propuesta = %s AND rt.id_usuario = %s
            """,
            (id_propuesta, payload.id_usuario),
        )
        es_integrante = cur.fetchone() is not None
        if not es_integrante and not _es_lider_o_administrativo(
            cur, payload.id_usuario, propuesta["id_usuario_lider"]
        ):
            raise HTTPException(
                403,
                "Solo el equipo investigador del proyecto puede registrar informes.",
            )

        cur.execute(
            "SELECT id_rol FROM roles WHERE nombre_rol = %s",
            (ROL_INVESTIGADOR,),
        )
        fila_rol = cur.fetchone()
        if not fila_rol:
            raise HTTPException(500, "El rol Investigador no está configurado en la base de datos.")

        detalle = payload.observaciones or "Informe de ejecución del proyecto."
        if payload.id_documento is not None:
            detalle += f" Documento: {payload.id_documento}."
        cur.execute(
            """
            INSERT INTO evaluations
                (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
            VALUES (%s, %s, %s, NOW(), %s)
            RETURNING id_evaluacion
            """,
            (id_propuesta, payload.id_usuario, fila_rol["id_rol"], detalle),
        )
        id_evaluacion = cur.fetchone()["id_evaluacion"]

        _notificar_rol(
            cur,
            (ROL_DIRECCION,),
            id_propuesta,
            "Informe de ejecución registrado",
            f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» registró un informe "
            f"de ejecución: {detalle.strip()}",
        )

    return {
        "ok": True,
        "id_propuesta": id_propuesta,
        "id_evaluacion": id_evaluacion,
        "estado_actual": propuesta["estado_actual"],
        "nombre_estado": ESTADO_EJECUCION,
        "mensaje": "Informe de ejecución registrado en el expediente.",
    }


@router.post("/{id_propuesta}/cierre")
def cerrar_propuesta(
    id_propuesta: int,
    payload: TramiteIn,
    conn: Connection = Depends(get_conn),
):
    """
    Cerrar administrativamente un proyecto que se encuentra en ejecución.

    Dirección de Investigación dictamina el cierre, exige el informe final como soporte
    documental y deja el expediente en «Cerrada», estado terminal del ciclo.

    parametros:
        - int : id_propuesta Identificador de la propuesta.
        - TramiteIn : payload Usuario que cierra, fundamento e informe final.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : resultado Confirmación del cierre del expediente.
    """

    with conn.cursor() as cur:
        propuesta = _bloquear_propuesta(cur, id_propuesta)
        estado_ejecucion = resolver_estado(cur, ESTADO_EJECUCION)
        if propuesta["estado_actual"] != estado_ejecucion:
            raise HTTPException(
                409,
                "La propuesta no está «En ejecución»; no se puede cerrar el expediente.",
            )

        roles = _roles(cur, payload.id_usuario)
        if not any(rol in ROLES_ADMINISTRATIVOS for rol in roles):
            raise HTTPException(
                403,
                "El cierre del proyecto corresponde a Dirección de Investigación o a un rol administrativo.",
            )

        if payload.id_documento is None:
            raise HTTPException(
                400,
                "Para cerrar el expediente debes registrar el informe final del proyecto.",
            )
        _validar_documento(cur, id_propuesta, payload.id_documento)

        estado_cerrada = resolver_estado(cur, ESTADO_CERRADA)
        cur.execute(
            "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s RETURNING estado_actual",
            (estado_cerrada, id_propuesta),
        )
        estado_actual = cur.fetchone()["estado_actual"]

        detalle = "Cierre administrativo del proyecto."
        if payload.observaciones:
            detalle += f" {payload.observaciones.strip()}"
        detalle += f" Informe final: {payload.id_documento}."
        _registrar_historial(
            cur,
            id_propuesta,
            estado_ejecucion,
            estado_cerrada,
            payload.id_usuario,
            detalle,
        )

        _notificar(
            cur,
            propuesta["id_usuario_lider"],
            id_propuesta,
            "Proyecto cerrado",
            f"La propuesta {propuesta['codigo']} «{propuesta['titulo']}» fue cerrada por "
            "Dirección de Investigación.",
        )

    return {
        "ok": True,
        "id_propuesta": id_propuesta,
        "estado_actual": estado_actual,
        "nombre_estado": ESTADO_CERRADA,
        "mensaje": "El expediente quedó «Cerrada».",
    }
