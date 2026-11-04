"""
========================================================================================
ARCHIVO: backend/app/estados.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Centralizar el catálogo institucional de estados de una propuesta y la máquina de
    estados que governa las transiciones del ciclo de trámite (Convocatoria Fondos VIE 2027).

    Este módulo existe para impedir el error que apareció en las primeras fases del
    proyecto: los routers resolvían los estados por identificador numérico fijo
    (9 = Con observaciones, 10 = Rechazada) copiando el orden del seed V3, mientras que
    la base de datos desplegada usa otro orden (9 = En ejecución, 10 = Con observaciones,
    11 = Rechazada). Consecuencia: una devolución con observaciones terminaba en
    «En ejecución» y un rechazo terminaba en «Con observaciones».

    Regla del proyecto: el código NUNCA usa identificadores de estado; siempre nombres.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Lee la tabla 'estados' de PostgreSQL para resolver el identificador de un
             estado por su nombre oficial y viceversa.
           - Lee 'usuarios', 'user_roles' y 'roles' para resolver los roles de un usuario.
           - Lee 'proposal_state_history' para determinar la etapa que devolvió un expediente.
    2.2.2. A quién sirve:
           - 'app.routers.vinculacion', 'app.routers.comite', 'app.routers.consejo',
             'app.routers.direccion', 'app.routers.cie', 'app.routers.tramite' y
             'app.routers.propuestas' resuelven los estados y validan transiciones con
             este módulo.
           - 'app.routers.catalogos' expone el catálogo 'estados' en GET /catalogos, que
             es la fuente que usa el frontend (idEstadoPorNombre) para resolver nombres.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSOMODO?:
    Declara los nombres canónicos de los doce estados, define qué estados puede
    alcanzarse desde cada etapa (máquina de estados), indica qué roles son dueños de
    cada etapa y ofrece utilidades para resolver nombres, validar transiciones y
    detectar la etapa de origen de una devolución con observaciones.
========================================================================================
"""

from typing import Optional

from fastapi import HTTPException

# =====================================================================
# CATÁLOGO CANÓNICO DE ESTADOS (nombres oficiales de la Convocatoria VIE 2027)
# =====================================================================

ESTADO_FORMULACION = "En formulación"
ESTADO_VINCULACION = "En revisión de Vinculación"
ESTADO_COMITE = "En evaluación del Comité Técnico"
ESTADO_PENDIENTE_AVAL = "Pendiente de aval del Consejo"
ESTADO_AVALADA = "Avalada"
ESTADO_SOMETIDA_VIE = "Sometida ante VIE"
ESTADO_DICTAMINADA = "Dictaminada por Dirección"
ESTADO_APROBADA_CIE = "Aprobada por CIE"
ESTADO_OBSERVACIONES = "Con observaciones"
ESTADO_RECHAZADA = "Rechazada"
ESTADO_EJECUCION = "En ejecución"
ESTADO_CERRADA = "Cerrada"

#: Orden institucional de las etapas, usado por la bitácora y por el frontend.
ORDEN_ESTADOS = (
    ESTADO_FORMULACION,
    ESTADO_VINCULACION,
    ESTADO_COMITE,
    ESTADO_PENDIENTE_AVAL,
    ESTADO_AVALADA,
    ESTADO_SOMETIDA_VIE,
    ESTADO_DICTAMINADA,
    ESTADO_APROBADA_CIE,
    ESTADO_EJECUCION,
    ESTADO_OBSERVACIONES,
    ESTADO_RECHAZADA,
    ESTADO_CERRADA,
)

# =====================================================================
# MÁQUINA DE ESTADOS
# =====================================================================

#: Estados terminales: no admiten ninguna transición saliente.
ESTADOS_TERMINALES = (ESTADO_RECHAZADA, ESTADO_CERRADA)

#: Transiciones permitidas del flujo institucional. La clave es la etapa actual y el
#: valor el conjunto de etapas alcanzables desde ella.
MAQUINA_ESTADOS: dict[str, frozenset[str]] = {
    ESTADO_FORMULACION: frozenset({ESTADO_VINCULACION}),
    ESTADO_VINCULACION: frozenset({ESTADO_COMITE, ESTADO_OBSERVACIONES, ESTADO_RECHAZADA}),
    ESTADO_COMITE: frozenset({ESTADO_PENDIENTE_AVAL, ESTADO_OBSERVACIONES, ESTADO_RECHAZADA}),
    ESTADO_PENDIENTE_AVAL: frozenset({ESTADO_AVALADA, ESTADO_OBSERVACIONES, ESTADO_RECHAZADA}),
    ESTADO_AVALADA: frozenset({ESTADO_SOMETIDA_VIE}),
    ESTADO_SOMETIDA_VIE: frozenset({ESTADO_DICTAMINADA, ESTADO_OBSERVACIONES, ESTADO_RECHAZADA}),
    ESTADO_DICTAMINADA: frozenset({ESTADO_APROBADA_CIE, ESTADO_OBSERVACIONES, ESTADO_RECHAZADA}),
    # El investigador reenvía el expediente a la etapa que lo devolvió.
    ESTADO_OBSERVACIONES: frozenset(
        {ESTADO_VINCULACION, ESTADO_COMITE, ESTADO_PENDIENTE_AVAL, ESTADO_SOMETIDA_VIE}
    ),
    # El investigador acepta la carta y la propuesta pasa a ejecución.
    ESTADO_APROBADA_CIE: frozenset({ESTADO_EJECUCION}),
    # Dirección de Investigación dictamina el cierre del proyecto.
    ESTADO_EJECUCION: frozenset({ESTADO_CERRADA}),
    ESTADO_RECHAZADA: frozenset(),
    ESTADO_CERRADA: frozenset(),
}

#: Roles que pueden actuar sobre cada etapa del flujo.
ROLES_POR_ETAPA: dict[str, tuple[str, ...]] = {
    ESTADO_FORMULACION: ("Investigador",),
    ESTADO_VINCULACION: ("Vinculación", "Gestor de Vinculación"),
    ESTADO_COMITE: ("Comité Técnico", "Evaluador Comité Técnico"),
    ESTADO_PENDIENTE_AVAL: ("Consejo de Escuela",),
    # El investigador líder realiza el sometimiento formal ante la VIE.
    ESTADO_AVALADA: ("Investigador",),
    ESTADO_SOMETIDA_VIE: ("Dirección de Investigación",),
    ESTADO_DICTAMINADA: ("CIE", "Evaluador Comité de Ética (CIE)"),
    ESTADO_OBSERVACIONES: ("Investigador",),
    ESTADO_APROBADA_CIE: ("Investigador",),
    ESTADO_EJECUCION: ("Dirección de Investigación",),
}

#: Roles con facultad institucional sobre el ciclo completo de trámites.
ROLES_ADMINISTRATIVOS = (
    "Dirección de Investigación",
    "Funcionario VIE",
    "Administrador del Sistema",
)


# =====================================================================
# UTILIDADES DE RESOLUCIÓN
# =====================================================================


def resolver_estado(cur, nombre_estado: str) -> int:
    """
    Resolver el identificador de un estado a partir de su nombre oficial.

    Es la única forma admitida por el proyecto para obtener un identificador de estado:
    jamás se escriben números en el código porque el orden de 'estados' difiere entre
    ambientes (ver el comentario de cabecera de este módulo).

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - str : nombre_estado Nombre oficial del estado, por ejemplo «Con observaciones».

    return:
        + int : id_estado Identificador del estado en la tabla 'estados'.
    """

    cur.execute(
        "SELECT id_estado FROM estados WHERE nombre_estado = %s",
        (nombre_estado,),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(
            500,
            f"El estado «{nombre_estado}» no está configurado en la base de datos.",
        )
    return fila["id_estado"]


def nombre_de_estado(cur, id_estado: int) -> Optional[str]:
    """
    Obtener el nombre oficial de un estado a partir de su identificador.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_estado Identificador del estado en la tabla 'estados'.

    return:
        + Optional[str] : nombre Nombre del estado o None si el identificador no existe.
    """

    cur.execute(
        "SELECT nombre_estado FROM estados WHERE id_estado = %s",
        (id_estado,),
    )
    fila = cur.fetchone()
    return fila["nombre_estado"] if fila else None


def transicion_permitida(estado_origen: str, estado_destino: str) -> bool:
    """
    Indicar si la máquina de estados admite pasar de una etapa a otra.

    parametros:
        - str : estado_origen Nombre de la etapa actual de la propuesta.
        - str : estado_destino Nombre de la etapa a la que se quiere mover.

    return:
        + bool : permitida Verdadero si la transición existe en la máquina de estados.
    """

    return estado_destino in MAQUINA_ESTADOS.get(estado_origen, frozenset())


def roles_de_usuario(cur, id_usuario: int) -> list[str]:
    """
    Listar los nombres de rol asignados a un usuario activo.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_usuario Identificador del usuario consultado.

    return:
        + list[str] : roles Lista de nombres de rol (puede estar vacía).
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


def usuario_puede_transicionar(
    cur,
    id_usuario: int,
    id_usuario_lider: int,
    estado_origen: str,
    estado_destino: str,
) -> bool:
    """
    Verificar si un usuario está facultado para ejecutar una transición de estado.

    La transición debe estar admitida por la máquina de estados y el usuario debe ser
    dueño de la etapa actual (rol institucional), el líder de la propuesta cuando la
    etapa corresponde al investigador, o un rol con facultad administrativa.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_usuario Identificador del usuario que ejecuta el cambio.
        - int : id_usuario_lider Identificador del líder de la propuesta.
        - str : estado_origen Nombre de la etapa actual de la propuesta.
        - str : estado_destino Nombre de la etapa destino.

    return:
        + bool : permitido Verdadero si el usuario puede ejecutar la transición.
    """

    if not transicion_permitida(estado_origen, estado_destino):
        return False

    roles = roles_de_usuario(cur, id_usuario)
    if any(rol in ROLES_ADMINISTRATIVOS for rol in roles):
        return True

    responsables = ROLES_POR_ETAPA.get(estado_origen, ())
    if any(rol in responsables for rol in roles):
        return True

    # El investigador actúa sobre su propio expediente en las etapas que le pertenecen.
    return id_usuario == id_usuario_lider and "Investigador" in responsables


def etapa_origen_devolucion(cur, id_propuesta: int) -> Optional[str]:
    """
    Determinar la etapa institucional que devolvió un expediente con observaciones.

    Consulta la última transición registrada hacia «Con observaciones» y devuelve el
    nombre de la etapa desde la que se hizo la devolución. Permite reenviar el
    expediente al mismo órgano revisor sin agregar columnas al modelo de datos.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - int : id_propuesta Identificador de la propuesta.

    return:
        + Optional[str] : etapa Nombre de la etapa que devolvió el expediente o None
          si no existe una devolución registrada.
    """

    cur.execute(
        """
        SELECT e.nombre_estado
        FROM proposal_state_history h
        JOIN estados e ON e.id_estado = h.id_estado_anterior
        WHERE h.id_propuesta = %s
          AND h.id_estado_nuevo = (SELECT id_estado FROM estados WHERE nombre_estado = %s)
        ORDER BY h.id_historial DESC
        LIMIT 1
        """,
        (id_propuesta, ESTADO_OBSERVACIONES),
    )
    fila = cur.fetchone()
    return fila["nombre_estado"] if fila else None
