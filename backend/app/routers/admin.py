"""
=======================================================================================
ARCHIVO: backend/app/routers/admin.py

2.1. OBJETIVO DEL ARCHIVO:
    Implementar el CRUD administrativo de las pantallas 31 (Administración de
    convocatorias) y 32 (Rúbricas y catálogos) del SGPI.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consulta 'convocatorias', 'convocatoria_etapas', 'convocatoria_documentos',
             'rubric_sections', 'rubric_criteria', 'rubric_versions', 'roles',
             'escuelas', 'lineas_investigacion', 'modalidades', 'tipos_hora',
             'rubros_presupuesto', 'niveles_riesgo' y 'criterios_verificacion_vie'.
           - Usa 'app.db.get_conn' para la transacción atómica contra Supabase.
           - Reutiliza la configuración de Supabase Storage de 'convocatorias.py'.
    2.2.2. A dónde envía datos:
           - Escribe y actualiza las tablas maestras y de configuración.
           - Invalida la caché de 'GET /catalogos' para que el frontend vea los cambios.
           - Alimenta las pantallas 31 y 32 para Dirección de Investigación,
             Funcionarios VIE y Administradores del Sistema.

2.3. ¿QUÉ HACE EL ARCHIVO A GRESOSO MODO?:
    Expone el prefijo /admin con el CRUD completo de convocatorias, etapas,
    instrumentos oficiales, rúbricas versionadas y catálogos maestros. Todos los
    endpoints validan que el usuario tenga un rol con facultad administrativa.
=======================================================================================
"""

import os
from datetime import date, datetime
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from psycopg import Connection
from pydantic import BaseModel, Field

from ..db import get_conn
from .catalogos import invalidar_cache_catalogos
from .convocatorias import (
    BUCKET,
    MAX_BYTES,
    MIME_POR_EXTENSION,
    _borrar_de_storage,
    _carpeta_unica,
    _config_storage,
    _nombre_archivo_seguro,
)

# [Línea clave]: Declara el router bajo el prefijo /admin para agrupar la administración institucional.
router = APIRouter(prefix="/admin", tags=["administracion"])

# [Línea clave]: Roles facultados para administrar convocatorias, rúbricas y catálogos.
ROLES_ADMINISTRACION = (
    "Dirección de Investigación",
    "Funcionario VIE",
    "Administrador del Sistema",
)


# =====================================================================
# MODELOS DE ENTRADA Y SALIDA
# =====================================================================


class ConvocatoriaAdminOut(BaseModel):
    """Convocatoria con los conteos de etapas, documentos y propuestas asociadas."""

    id_convocatoria: int
    nombre: str
    descripcion: Optional[str] = None
    fecha_inicio: date
    fecha_cierre: date
    fecha_inicio_ejecucion: date
    activo: bool
    carpeta_storage: Optional[str] = None
    etapas: int = 0
    documentos: int = 0
    propuestas: int = 0


class ConvocatoriaIn(BaseModel):
    """Datos mínimos para registrar una convocatoria."""

    nombre: str = Field(min_length=3)
    descripcion: Optional[str] = None
    fecha_inicio: date
    fecha_cierre: date
    fecha_inicio_ejecucion: date
    activo: bool = True


class ConvocatoriaPatch(BaseModel):
    """Edición parcial de una convocatoria; solo se aplican los campos enviados."""

    nombre: Optional[str] = Field(default=None, min_length=3)
    descripcion: Optional[str] = None
    fecha_inicio: Optional[date] = None
    fecha_cierre: Optional[date] = None
    fecha_inicio_ejecucion: Optional[date] = None
    activo: Optional[bool] = None


class EtapaIn(BaseModel):
    """Etapa del cronograma de una convocatoria."""

    nombre_etapa: str = Field(min_length=2)
    responsable: str = Field(min_length=2)
    fecha_inicio: date
    fecha_fin: date
    orden: int = Field(ge=1)


class EtapaPatch(BaseModel):
    """Edición parcial de una etapa del cronograma."""

    nombre_etapa: Optional[str] = Field(default=None, min_length=2)
    responsable: Optional[str] = Field(default=None, min_length=2)
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    orden: Optional[int] = Field(default=None, ge=1)


class CriterioRubricaOut(BaseModel):
    """Criterio ponderado de una sección de rúbrica."""

    id_criterio_rubrica: int
    id_seccion: int
    nombre_criterio: str
    peso_relativo: float
    es_obligatorio: bool
    orden: int
    version: str = "2027"


class SeccionRubricaAdminOut(BaseModel):
    """Sección de rúbrica con sus criterios anidados."""

    id_seccion: int
    nombre_seccion: str
    peso_porcentual: float
    orden: int
    version: str = "2027"
    criterios: list[CriterioRubricaOut] = []


class VersionRubricaOut(BaseModel):
    """Versión publicada de la rúbrica institucional."""

    id_version: int
    version: str
    descripcion: Optional[str] = None
    fecha_publicacion: date
    activo: bool


class RubricaAdminOut(BaseModel):
    """Rúbrica completa con sus versiones publicadas."""

    version_activa: Optional[str] = None
    versiones: list[VersionRubricaOut] = []
    secciones: list[SeccionRubricaAdminOut] = []
    peso_total: float = 0.0


class SeccionRubricaIn(BaseModel):
    """Sección nueva de rúbrica."""

    nombre_seccion: str = Field(min_length=2)
    peso_porcentual: float = Field(ge=0, le=100)
    orden: int = Field(ge=1)
    version: str = "2027"


class SeccionRubricaPatch(BaseModel):
    """Edición parcial de una sección de rúbrica."""

    nombre_seccion: Optional[str] = Field(default=None, min_length=2)
    peso_porcentual: Optional[float] = Field(default=None, ge=0, le=100)
    orden: Optional[int] = Field(default=None, ge=1)
    version: Optional[str] = None


class CriterioRubricaIn(BaseModel):
    """Criterio nuevo de rúbrica."""

    id_seccion: int
    nombre_criterio: str = Field(min_length=2)
    peso_relativo: float = Field(ge=0, le=100)
    es_obligatorio: bool = False
    orden: int = Field(ge=1)
    version: str = "2027"


class CriterioRubricaPatch(BaseModel):
    """Edición parcial de un criterio de rúbrica."""

    id_seccion: Optional[int] = None
    nombre_criterio: Optional[str] = Field(default=None, min_length=2)
    peso_relativo: Optional[float] = Field(default=None, ge=0, le=100)
    es_obligatorio: Optional[bool] = None
    orden: Optional[int] = Field(default=None, ge=1)
    version: Optional[str] = None


class VersionRubricaIn(BaseModel):
    """Versión nueva de rúbrica, opcionalmente clonada desde otra."""

    version: str = Field(min_length=2)
    descripcion: Optional[str] = None
    fecha_publicacion: Optional[date] = None
    clonar_desde: Optional[str] = None


class VersionRubricaPatch(BaseModel):
    """Edición parcial de una versión de rúbrica."""

    descripcion: Optional[str] = None
    fecha_publicacion: Optional[date] = None
    activo: Optional[bool] = None


class MoverRolIn(BaseModel):
    """Sentido del movimiento de un rol dentro del orden institucional."""

    direccion: Literal["arriba", "abajo"]


# =====================================================================
# VALIDACIÓN DE ROL Y UTILIDADES
# =====================================================================


def _exigir_rol_admin(cur, id_usuario: int) -> dict:
    """
    Validar que el usuario exista, esté activo y tenga un rol con facultad administrativa.

    Los roles facultados son Dirección de Investigación, Funcionario VIE y
    Administrador del Sistema. Se usa el nombre del rol (nunca su identificador)
    porque los identificadores difieren entre ambientes.

    parametros:
        - Cursor : cur Cursor de PostgreSQL.
        - int : id_usuario Identificador del usuario que ejecuta la operación.

    return:
        + dict : usuario Fila con 'id_usuario', 'nombre', 'lastname' e 'id_rol'.
    """
    cur.execute(
        """
        SELECT u.id_usuario, u.nombre, u.lastname, r.id_rol, r.nombre_rol
        FROM usuarios u
        JOIN user_roles ur ON ur.id_usuario = u.id_usuario
        JOIN roles r ON r.id_rol = ur.id_rol
        WHERE u.id_usuario = %s
          AND u.estado_activo
          AND r.nombre_rol = ANY(%s)
        LIMIT 1
        """,
        (id_usuario, list(ROLES_ADMINISTRACION)),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(
            403,
            "El usuario no tiene un rol facultado para administrar convocatorias y catálogos.",
        )
    return fila


def _exigir_convocatoria(cur, id_convocatoria: int) -> dict:
    """Verificar que la convocatoria exista y devolver su fila."""

    cur.execute(
        "SELECT * FROM convocatorias WHERE id_convocatoria = %s",
        (id_convocatoria,),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(404, "Convocatoria no encontrada.")
    return fila


# =====================================================================
# CATÁLOGOS MAESTROS EDITABLES
# =====================================================================

# [Línea clave]: ¿Por qué soy importante? Describir qué catálogos son editables desde la
# pantalla 32 y con qué campos. ¿Para qué? Construir el SQL de forma segura sin interpolar
# nombres de tabla o columna recibidos del cliente. ¿Dónde me usan? En los endpoints
# genéricos de /admin/catalogos.
CATALOGOS_EDITABLES: dict[str, dict[str, Any]] = {
    "escuelas": {
        "tabla": "escuelas",
        "id": "id_escuela",
        "orden_sql": "nombre ASC",
        "etiqueta": "escuelas",
        "campos": {
            "nombre": {"tipo": "texto", "obligatorio": True},
            "siglas": {"tipo": "texto", "obligatorio": False},
        },
        "referencias": [
            ("propuestas", "id_escuela", "propuestas registradas"),
            ("usuarios", "id_escuela", "usuarios del TEC"),
            ("council_endorsements", "id_escuela", "avales de consejo"),
        ],
    },
    "lineas": {
        "tabla": "lineas_investigacion",
        "id": "id_linea_investigacion",
        "orden_sql": "nombre_linea ASC",
        "etiqueta": "líneas de investigación",
        "campos": {
            "nombre_linea": {"tipo": "texto", "obligatorio": True},
        },
        "referencias": [
            ("propuestas", "id_linea_investigacion", "propuestas registradas"),
        ],
    },
    "modalidades": {
        "tabla": "modalidades",
        "id": "id_modalidad",
        "orden_sql": "id_modalidad ASC",
        "etiqueta": "modalidades",
        "campos": {
            "nombre_modalidad": {"tipo": "texto", "obligatorio": True},
            "descripcion": {"tipo": "texto", "obligatorio": False},
            "duracion_maxima": {"tipo": "texto", "obligatorio": False},
            "monto_financiamiento": {"tipo": "decimal", "obligatorio": False},
            "activo": {"tipo": "booleano", "obligatorio": False},
        },
        "referencias": [
            ("propuestas", "id_modalidad", "propuestas registradas"),
        ],
    },
    "tipos_hora": {
        "tabla": "tipos_hora",
        "id": "id_tipo_hora",
        "orden_sql": "id_tipo_hora ASC",
        "etiqueta": "tipos de hora",
        "campos": {
            "nombre_tipo_hora": {"tipo": "texto", "obligatorio": True},
        },
        "referencias": [
            ("research_team", "id_tipo_hora", "equipos de investigación"),
        ],
    },
    "rubros": {
        "tabla": "rubros_presupuesto",
        "id": "id_rubro",
        "orden_sql": "id_rubro ASC",
        "etiqueta": "rubros presupuestarios",
        "campos": {
            "nombre_rubro": {"tipo": "texto", "obligatorio": True},
            "codigo": {"tipo": "texto", "obligatorio": False},
            "es_bien_duradero": {"tipo": "booleano", "obligatorio": False},
            "es_beca": {"tipo": "booleano", "obligatorio": False},
        },
        "referencias": [
            ("proposal_budget", "id_rubro", "presupuestos de propuestas"),
        ],
    },
    "roles": {
        "tabla": "roles",
        "id": "id_rol",
        "orden_sql": "orden ASC, id_rol ASC",
        "etiqueta": "roles institucionales",
        "campos": {
            "nombre_rol": {"tipo": "texto", "obligatorio": True},
            "orden": {"tipo": "entero", "obligatorio": False},
        },
        "referencias": [
            ("user_roles", "id_rol", "usuarios con rol asignado"),
            ("evaluations", "id_rol_evaluador", "evaluaciones registradas"),
        ],
    },
    "criterios_vie": {
        "tabla": "criterios_verificacion_vie",
        "id": "id_criterio",
        "orden_sql": "id_criterio ASC",
        "etiqueta": "criterios de verificación VIE",
        "campos": {
            "descripcion_criterio": {"tipo": "texto", "obligatorio": True},
        },
        "referencias": [
            ("vie_dictamen_verifications", "id_criterio", "dictámenes de Dirección"),
        ],
    },
    "niveles_riesgo": {
        "tabla": "niveles_riesgo",
        "id": "id_nivel_riesgo",
        "orden_sql": "id_nivel_riesgo ASC",
        "etiqueta": "niveles de riesgo",
        "campos": {
            "nombre_nivel": {"tipo": "texto", "obligatorio": True},
        },
        "referencias": [
            ("risks", "id_nivel_probabilidad", "riesgos de propuestas"),
            ("risks", "id_nivel_impacto", "riesgos de propuestas"),
        ],
    },
}


def _catalogo(clave: str) -> dict[str, Any]:
    """Resolver la definición de un catálogo editable o responder 404."""

    definicion = CATALOGOS_EDITABLES.get(clave)
    if not definicion:
        raise HTTPException(
            404,
            "Catálogo desconocido. Los catálogos editables son: "
            + ", ".join(sorted(CATALOGOS_EDITABLES)),
        )
    return definicion


def _coercionar(valor: Any, tipo: str, campo: str) -> Any:
    """Convertir el valor recibido por el cliente al tipo de la columna."""

    if valor is None:
        return None
    try:
        if tipo == "texto":
            texto = str(valor).strip()
            return texto or None
        if tipo == "entero":
            return int(valor)
        if tipo == "decimal":
            return float(valor)
        if tipo == "booleano":
            if isinstance(valor, bool):
                return valor
            return str(valor).strip().lower() in ("1", "true", "t", "si", "sí", "verdadero")
    except (TypeError, ValueError):
        raise HTTPException(400, f"El valor de «{campo}» no tiene el formato esperado.")
    return valor


def _preparar_campos(
    definicion: dict[str, Any], datos: dict[str, Any], crear: bool
) -> list[tuple[str, Any]]:
    """Validar el cuerpo del cliente y devolver la lista de columnas y valores a escribir."""

    campos = definicion["campos"]
    desconocidos = [clave for clave in datos if clave not in campos]
    if desconocidos:
        raise HTTPException(
            400,
            "Campos no editables: " + ", ".join(sorted(desconocidos)),
        )

    preparacion: list[tuple[str, Any]] = []
    for columna, regla in campos.items():
        if columna not in datos:
            if crear and regla["obligatorio"]:
                raise HTTPException(400, f"El campo «{columna}» es obligatorio.")
            continue
        valor = _coercionar(datos[columna], regla["tipo"], columna)
        if valor is None and regla["obligatorio"]:
            raise HTTPException(400, f"El campo «{columna}» es obligatorio.")
        preparacion.append((columna, valor))
    return preparacion


def _verificar_referencias(cur, clave: str, id_valor: int) -> None:
    """Impedir el borrado de registros que ya están en uso por otras tablas."""

    for tabla, columna, etiqueta in CATALOGOS_EDITABLES[clave].get("referencias", []):
        cur.execute(
            f"SELECT 1 FROM public.{tabla} WHERE {columna} = %s LIMIT 1",  # noqa: S608
            (id_valor,),
        )
        if cur.fetchone():
            raise HTTPException(
                409,
                f"No se puede eliminar: el registro está en uso por {etiqueta}.",
            )


# =====================================================================
# ENDPOINTS DE CATÁLOGOS MAESTROS (PANTALLA 32)
# =====================================================================


@router.get("/catalogos")
def listar_catalogos_admin(
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Listar todos los catálogos maestros editables con sus registros actuales.

    Devuelve un objeto con una llave por catálogo y, dentro de ella, la lista de filas
    tal como están en PostgreSQL. Es la fuente de datos de la pantalla 32.

    parametros:
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : catalogos Colección de catálogos editables.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        datos: dict[str, list[dict[str, Any]]] = {}
        for clave, definicion in CATALOGOS_EDITABLES.items():
            cur.execute(
                f"SELECT * FROM public.{definicion['tabla']} "  # noqa: S608
                f"ORDER BY {definicion['orden_sql']}"
            )
            datos[clave] = cur.fetchall()
    return datos


@router.get("/catalogos/{clave}")
def obtener_catalogo_admin(
    clave: str,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Listar los registros de un catálogo maestro editable.

    parametros:
        - str : clave Catálogo a consultar ('escuelas', 'modalidades', 'roles', etc.).
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + list[dict] : registros Filas del catálogo solicitado.
    """
    definicion = _catalogo(clave)
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            f"SELECT * FROM public.{definicion['tabla']} "  # noqa: S608
            f"ORDER BY {definicion['orden_sql']}"
        )
        return cur.fetchall()


@router.post("/catalogos/{clave}", status_code=201)
def crear_catalogo(
    clave: str,
    datos: dict[str, Any] = Body(...),
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Registrar un registro nuevo en un catálogo maestro editable.

    parametros:
        - str : clave Catálogo destino ('escuelas', 'modalidades', 'roles', etc.).
        - dict : datos Campos del registro a crear.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : registro Fila creada con su identificador.
    """
    definicion = _catalogo(clave)
    preparacion = _preparar_campos(definicion, datos, crear=True)
    if not preparacion:
        raise HTTPException(400, "No se enviaron campos para crear el registro.")

    columnas = ", ".join(columna for columna, _ in preparacion)
    marcadores = ", ".join(["%s"] * len(preparacion))
    valores = [valor for _, valor in preparacion]

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            f"INSERT INTO public.{definicion['tabla']} ({columnas}) "  # noqa: S608
            f"VALUES ({marcadores}) RETURNING *",
            valores,
        )
        registro = cur.fetchone()
    invalidar_cache_catalogos()
    return registro


@router.patch("/catalogos/{clave}/{id_registro}")
def actualizar_catalogo(
    clave: str,
    id_registro: int,
    datos: dict[str, Any] = Body(...),
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Editar un registro existente de un catálogo maestro.

    Solo se modifican los campos presentes en el cuerpo de la petición.

    parametros:
        - str : clave Catálogo destino.
        - int : id_registro Identificador del registro a editar.
        - dict : datos Campos a modificar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : registro Fila ya actualizada.
    """
    definicion = _catalogo(clave)
    preparacion = _preparar_campos(definicion, datos, crear=False)
    if not preparacion:
        raise HTTPException(400, "No se enviaron campos para actualizar el registro.")

    asignaciones = ", ".join(f"{columna} = %s" for columna, _ in preparacion)
    valores = [valor for _, valor in preparacion]

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            f"UPDATE public.{definicion['tabla']} SET {asignaciones} "  # noqa: S608
            f"WHERE {definicion['id']} = %s RETURNING *",
            valores + [id_registro],
        )
        registro = cur.fetchone()
        if not registro:
            raise HTTPException(404, "El registro no existe.")
    invalidar_cache_catalogos()
    return registro


@router.delete("/catalogos/{clave}/{id_registro}")
def eliminar_catalogo(
    clave: str,
    id_registro: int,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Eliminar un registro de un catálogo maestro cuando no está en uso.

    parametros:
        - str : clave Catálogo destino.
        - int : id_registro Identificador del registro a eliminar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : respuesta Confirmación de la eliminación.
    """
    definicion = _catalogo(clave)
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        _verificar_referencias(cur, clave, id_registro)
        cur.execute(
            f"DELETE FROM public.{definicion['tabla']} WHERE {definicion['id']} = %s "  # noqa: S608
            "RETURNING *",
            (id_registro,),
        )
        registro = cur.fetchone()
        if not registro:
            raise HTTPException(404, "El registro no existe.")
    invalidar_cache_catalogos()
    return {"ok": True, "eliminado": registro}


@router.patch("/catalogos/roles/{id_rol}/mover")
def mover_rol(
    id_rol: int,
    payload: MoverRolIn,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Intercambiar el orden de un rol con su vecino en el catálogo institucional.

    El intercambio se resuelve en el servidor para que el orden guardado en PostgreSQL
    siempre sea consistente con el que muestra la pantalla 32.

    parametros:
        - int : id_rol Identificador del rol que se mueve.
        - MoverRolIn : payload Sentido del movimiento ('arriba' o 'abajo').
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : respuesta Catálogo de roles con el orden actualizado.
    """
    direccion = payload.direccion

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute("SELECT id_rol, orden FROM public.roles WHERE id_rol = %s", (id_rol,))
        actual = cur.fetchone()
        if not actual:
            raise HTTPException(404, "El rol no existe.")

        if direccion == "arriba":
            cur.execute(
                "SELECT id_rol, orden FROM public.roles "
                "WHERE orden < %s ORDER BY orden DESC LIMIT 1",
                (actual["orden"],),
            )
        else:
            cur.execute(
                "SELECT id_rol, orden FROM public.roles "
                "WHERE orden > %s ORDER BY orden ASC LIMIT 1",
                (actual["orden"],),
            )
        vecino = cur.fetchone()
        if not vecino:
            return {"ok": True, "movido": False}

        cur.execute(
            "UPDATE public.roles SET orden = %s WHERE id_rol = %s",
            (vecino["orden"], actual["id_rol"]),
        )
        cur.execute(
            "UPDATE public.roles SET orden = %s WHERE id_rol = %s",
            (actual["orden"], vecino["id_rol"]),
        )
        cur.execute("SELECT * FROM public.roles ORDER BY orden ASC, id_rol ASC")
        roles_ordenados = cur.fetchall()
    invalidar_cache_catalogos()
    return {"ok": True, "movido": True, "roles": roles_ordenados}


# =====================================================================
# RÚBRICAS VERSIONADAS (PANTALLA 32)
# =====================================================================


def _version_rubrica_activa(cur) -> Optional[str]:
    """Devolver la versión de rúbrica marcada como activa, si existe."""

    cur.execute(
        "SELECT version FROM public.rubric_versions WHERE activo ORDER BY id_version DESC LIMIT 1"
    )
    fila = cur.fetchone()
    return fila["version"] if fila else None


def _secciones_rubrica(cur, version: Optional[str]) -> list[SeccionRubricaAdminOut]:
    """Cargar las secciones y criterios de una versión de rúbrica."""

    if version:
        cur.execute(
            """
            SELECT s.id_seccion, s.nombre_seccion, s.peso_porcentual, s.orden, s.version,
                   c.id_criterio_rubrica, c.nombre_criterio, c.peso_relativo,
                   c.es_obligatorio, c.orden AS orden_criterio, c.version AS version_criterio
            FROM rubric_sections s
            LEFT JOIN rubric_criteria c
                   ON c.id_seccion = s.id_seccion AND c.version = s.version
            WHERE s.version = %s
            ORDER BY s.orden ASC, c.orden ASC
            """,
            (version,),
        )
    else:
        cur.execute(
            """
            SELECT s.id_seccion, s.nombre_seccion, s.peso_porcentual, s.orden, s.version,
                   c.id_criterio_rubrica, c.nombre_criterio, c.peso_relativo,
                   c.es_obligatorio, c.orden AS orden_criterio, c.version AS version_criterio
            FROM rubric_sections s
            LEFT JOIN rubric_criteria c ON c.id_seccion = s.id_seccion
            ORDER BY s.orden ASC, c.orden ASC
            """
        )

    secciones: list[SeccionRubricaAdminOut] = []
    indice: dict[int, SeccionRubricaAdminOut] = {}
    for fila in cur.fetchall():
        id_seccion = fila["id_seccion"]
        if id_seccion not in indice:
            indice[id_seccion] = SeccionRubricaAdminOut(
                id_seccion=id_seccion,
                nombre_seccion=fila["nombre_seccion"],
                peso_porcentual=float(fila["peso_porcentual"]),
                orden=fila["orden"],
                version=fila["version"],
                criterios=[],
            )
            secciones.append(indice[id_seccion])
        if fila["id_criterio_rubrica"] is not None:
            indice[id_seccion].criterios.append(
                CriterioRubricaOut(
                    id_criterio_rubrica=fila["id_criterio_rubrica"],
                    id_seccion=id_seccion,
                    nombre_criterio=fila["nombre_criterio"],
                    peso_relativo=float(fila["peso_relativo"]),
                    es_obligatorio=fila["es_obligatorio"],
                    orden=fila["orden_criterio"],
                    version=fila["version_criterio"],
                )
            )
    return secciones


@router.get("/rubrica", response_model=RubricaAdminOut)
def obtener_rubrica_admin(
    version: Optional[str] = Query(default=None, description="Versión a consultar"),
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Consultar la rúbrica oficial con sus secciones, criterios y versiones publicadas.

    Si no se indica versión se devuelve la que está marcada como activa. El peso total
    de secciones y criterios se calcula en el servidor para que la interfaz muestre
    el estado real de la ponderación.

    parametros:
        - Optional[str] : version Versión concreta a consultar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + RubricaAdminOut : rubrica Rúbrica completa con sus versiones.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT id_version, version, descripcion, fecha_publicacion, activo "
            "FROM public.rubric_versions ORDER BY id_version ASC"
        )
        versiones = [VersionRubricaOut(**fila) for fila in cur.fetchall()]
        activa = _version_rubrica_activa(cur)
        secciones = _secciones_rubrica(cur, version or activa)

    return RubricaAdminOut(
        version_activa=activa,
        versiones=versiones,
        secciones=secciones,
        peso_total=round(sum(seccion.peso_porcentual for seccion in secciones), 2),
    )


@router.get("/rubrica/versiones", response_model=list[VersionRubricaOut])
def listar_versiones_rubrica(
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Listar las versiones publicadas de la rúbrica institucional.

    parametros:
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + list[VersionRubricaOut] : versiones Historial de versiones de la rúbrica.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT id_version, version, descripcion, fecha_publicacion, activo "
            "FROM public.rubric_versions ORDER BY id_version ASC"
        )
        return [VersionRubricaOut(**fila) for fila in cur.fetchall()]


@router.post("/rubrica/secciones", response_model=SeccionRubricaAdminOut, status_code=201)
def crear_seccion_rubrica(
    payload: SeccionRubricaIn,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Crear una sección nueva en la rúbrica de una versión.

    parametros:
        - SeccionRubricaIn : payload Datos de la sección a crear.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + SeccionRubricaAdminOut : seccion Sección creada.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            """
            INSERT INTO rubric_sections (nombre_seccion, peso_porcentual, orden, version)
            VALUES (%s, %s, %s, %s)
            RETURNING id_seccion, nombre_seccion, peso_porcentual, orden, version
            """,
            (
                payload.nombre_seccion,
                payload.peso_porcentual,
                payload.orden,
                payload.version,
            ),
        )
        fila = cur.fetchone()
    return SeccionRubricaAdminOut(
        id_seccion=fila["id_seccion"],
        nombre_seccion=fila["nombre_seccion"],
        peso_porcentual=float(fila["peso_porcentual"]),
        orden=fila["orden"],
        version=fila["version"],
        criterios=[],
    )


@router.patch("/rubrica/secciones/{id_seccion}", response_model=SeccionRubricaAdminOut)
def actualizar_seccion_rubrica(
    id_seccion: int,
    payload: SeccionRubricaPatch,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Editar una sección de la rúbrica (nombre, peso, orden o versión).

    parametros:
        - int : id_seccion Identificador de la sección a editar.
        - SeccionRubricaPatch : payload Campos a modificar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + SeccionRubricaAdminOut : seccion Sección actualizada.
    """
    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "No se enviaron campos para actualizar la sección.")

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT id_seccion, version FROM rubric_sections WHERE id_seccion = %s",
            (id_seccion,),
        )
        actual = cur.fetchone()
        if not actual:
            raise HTTPException(404, "La sección no existe.")

        asignaciones = ", ".join(f"{columna} = %s" for columna in campos)
        cur.execute(
            f"UPDATE rubric_sections SET {asignaciones} WHERE id_seccion = %s "  # noqa: S608
            "RETURNING id_seccion, nombre_seccion, peso_porcentual, orden, version",
            list(campos.values()) + [id_seccion],
        )
        fila = cur.fetchone()

        # [Línea clave]: Los criterios heredan la versión de su sección para que la rúbrica
        # evaluada por el Comité Técnico siempre corresponda a una versión coherente.
        if "version" in campos and campos["version"] != actual["version"]:
            cur.execute(
                "UPDATE rubric_criteria SET version = %s WHERE id_seccion = %s",
                (campos["version"], id_seccion),
            )

        cur.execute(
            "SELECT id_criterio_rubrica, id_seccion, nombre_criterio, peso_relativo, "
            "es_obligatorio, orden, version FROM rubric_criteria "
            "WHERE id_seccion = %s ORDER BY orden ASC",
            (id_seccion,),
        )
        criterios = [
            CriterioRubricaOut(
                id_criterio_rubrica=c["id_criterio_rubrica"],
                id_seccion=c["id_seccion"],
                nombre_criterio=c["nombre_criterio"],
                peso_relativo=float(c["peso_relativo"]),
                es_obligatorio=c["es_obligatorio"],
                orden=c["orden"],
                version=c["version"],
            )
            for c in cur.fetchall()
        ]

    return SeccionRubricaAdminOut(
        id_seccion=fila["id_seccion"],
        nombre_seccion=fila["nombre_seccion"],
        peso_porcentual=float(fila["peso_porcentual"]),
        orden=fila["orden"],
        version=fila["version"],
        criterios=criterios,
    )


@router.delete("/rubrica/secciones/{id_seccion}")
def eliminar_seccion_rubrica(
    id_seccion: int,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Eliminar una sección de la rúbrica junto con sus criterios.

    Se bloquea si algún criterio ya fue usado en una evaluación registrada.

    parametros:
        - int : id_seccion Identificador de la sección a eliminar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : respuesta Confirmación de la eliminación.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            """
            SELECT 1 FROM technical_committee_scores tcs
            JOIN rubric_criteria rc ON rc.id_criterio_rubrica = tcs.id_criterio_rubrica
            WHERE rc.id_seccion = %s LIMIT 1
            """,
            (id_seccion,),
        )
        if cur.fetchone():
            raise HTTPException(
                409, "No se puede eliminar: la sección ya fue usada en evaluaciones registradas."
            )
        cur.execute(
            "DELETE FROM rubric_criteria WHERE id_seccion = %s", (id_seccion,)
        )
        cur.execute(
            "DELETE FROM rubric_sections WHERE id_seccion = %s RETURNING id_seccion",
            (id_seccion,),
        )
        if not cur.fetchone():
            raise HTTPException(404, "La sección no existe.")
    return {"ok": True, "id_seccion": id_seccion}


@router.post("/rubrica/criterios", response_model=CriterioRubricaOut, status_code=201)
def crear_criterio_rubrica(
    payload: CriterioRubricaIn,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Crear un criterio ponderado dentro de una sección de la rúbrica.

    parametros:
        - CriterioRubricaIn : payload Datos del criterio a crear.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + CriterioRubricaOut : criterio Criterio creado.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT id_seccion, version FROM rubric_sections WHERE id_seccion = %s",
            (payload.id_seccion,),
        )
        seccion = cur.fetchone()
        if not seccion:
            raise HTTPException(404, "La sección indicada no existe.")
        version = payload.version or seccion["version"]
        cur.execute(
            """
            INSERT INTO rubric_criteria
              (id_seccion, nombre_criterio, peso_relativo, es_obligatorio, orden, version)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id_criterio_rubrica, id_seccion, nombre_criterio, peso_relativo,
                      es_obligatorio, orden, version
            """,
            (
                payload.id_seccion,
                payload.nombre_criterio,
                payload.peso_relativo,
                payload.es_obligatorio,
                payload.orden,
                version,
            ),
        )
        fila = cur.fetchone()
    return CriterioRubricaOut(
        id_criterio_rubrica=fila["id_criterio_rubrica"],
        id_seccion=fila["id_seccion"],
        nombre_criterio=fila["nombre_criterio"],
        peso_relativo=float(fila["peso_relativo"]),
        es_obligatorio=fila["es_obligatorio"],
        orden=fila["orden"],
        version=fila["version"],
    )


@router.patch("/rubrica/criterios/{id_criterio}", response_model=CriterioRubricaOut)
def actualizar_criterio_rubrica(
    id_criterio: int,
    payload: CriterioRubricaPatch,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Editar un criterio de la rúbrica (nombre, peso, obligatoriedad u orden).

    parametros:
        - int : id_criterio Identificador del criterio a editar.
        - CriterioRubricaPatch : payload Campos a modificar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + CriterioRubricaOut : criterio Criterio actualizado.
    """
    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "No se enviaron campos para actualizar el criterio.")

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        if "id_seccion" in campos:
            cur.execute(
                "SELECT 1 FROM rubric_sections WHERE id_seccion = %s", (campos["id_seccion"],)
            )
            if not cur.fetchone():
                raise HTTPException(404, "La sección indicada no existe.")
        asignaciones = ", ".join(f"{columna} = %s" for columna in campos)
        cur.execute(
            f"UPDATE rubric_criteria SET {asignaciones} WHERE id_criterio_rubrica = %s "  # noqa: S608
            "RETURNING id_criterio_rubrica, id_seccion, nombre_criterio, peso_relativo, "
            "es_obligatorio, orden, version",
            list(campos.values()) + [id_criterio],
        )
        fila = cur.fetchone()
        if not fila:
            raise HTTPException(404, "El criterio no existe.")
    return CriterioRubricaOut(
        id_criterio_rubrica=fila["id_criterio_rubrica"],
        id_seccion=fila["id_seccion"],
        nombre_criterio=fila["nombre_criterio"],
        peso_relativo=float(fila["peso_relativo"]),
        es_obligatorio=fila["es_obligatorio"],
        orden=fila["orden"],
        version=fila["version"],
    )


@router.delete("/rubrica/criterios/{id_criterio}")
def eliminar_criterio_rubrica(
    id_criterio: int,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Eliminar un criterio de la rúbrica.

    Se bloquea si el criterio ya fue usado en una evaluación registrada.

    parametros:
        - int : id_criterio Identificador del criterio a eliminar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : respuesta Confirmación de la eliminación.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT 1 FROM technical_committee_scores WHERE id_criterio_rubrica = %s LIMIT 1",
            (id_criterio,),
        )
        if cur.fetchone():
            raise HTTPException(
                409, "No se puede eliminar: el criterio ya fue usado en evaluaciones registradas."
            )
        cur.execute(
            "DELETE FROM rubric_criteria WHERE id_criterio_rubrica = %s RETURNING id_criterio_rubrica",
            (id_criterio,),
        )
        if not cur.fetchone():
            raise HTTPException(404, "El criterio no existe.")
    return {"ok": True, "id_criterio": id_criterio}


@router.post("/rubrica/versiones", response_model=VersionRubricaOut, status_code=201)
def crear_version_rubrica(
    payload: VersionRubricaIn,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Publicar una versión nueva de la rúbrica institucional.

    Si se indica «clonar_desde» se copian las secciones y criterios de esa versión
    para que la nueva quede lista para editarse.

    parametros:
        - VersionRubricaIn : payload Datos de la versión a publicar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + VersionRubricaOut : version Versión publicada.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT 1 FROM rubric_versions WHERE version = %s", (payload.version,)
        )
        if cur.fetchone():
            raise HTTPException(409, f"La versión «{payload.version}» ya existe.")

        cur.execute(
            """
            INSERT INTO rubric_versions (version, descripcion, fecha_publicacion, activo)
            VALUES (%s, %s, COALESCE(%s, CURRENT_DATE), false)
            RETURNING id_version, version, descripcion, fecha_publicacion, activo
            """,
            (payload.version, payload.descripcion, payload.fecha_publicacion),
        )
        nueva = cur.fetchone()

        if payload.clonar_desde:
            cur.execute(
                """
                INSERT INTO rubric_sections (nombre_seccion, peso_porcentual, orden, version)
                SELECT nombre_seccion, peso_porcentual, orden, %s
                FROM rubric_sections WHERE version = %s
                """,
                (payload.version, payload.clonar_desde),
            )
            cur.execute(
                """
                INSERT INTO rubric_criteria
                  (id_seccion, nombre_criterio, peso_relativo, es_obligatorio, orden, version)
                SELECT s2.id_seccion, c.nombre_criterio, c.peso_relativo,
                       c.es_obligatorio, c.orden, %s
                FROM rubric_sections s1
                JOIN rubric_sections s2
                       ON s2.nombre_seccion = s1.nombre_seccion AND s2.version = %s
                JOIN rubric_criteria c ON c.id_seccion = s1.id_seccion AND c.version = s1.version
                WHERE s1.version = %s
                """,
                (payload.version, payload.version, payload.clonar_desde),
            )
    return VersionRubricaOut(**nueva)


@router.patch("/rubrica/versiones/{id_version}", response_model=VersionRubricaOut)
def actualizar_version_rubrica(
    id_version: int,
    payload: VersionRubricaPatch,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Editar una versión publicada y activar o desactivar su uso.

    Al activar una versión se desactiva la anterior para que el Comité Técnico
    siempre evalúe con la rúbrica vigente.

    parametros:
        - int : id_version Identificador de la versión a editar.
        - VersionRubricaPatch : payload Campos a modificar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + VersionRubricaOut : version Versión actualizada.
    """
    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "No se enviaron campos para actualizar la versión.")

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT id_version FROM rubric_versions WHERE id_version = %s", (id_version,)
        )
        if not cur.fetchone():
            raise HTTPException(404, "La versión no existe.")

        if campos.get("activo"):
            cur.execute("UPDATE rubric_versions SET activo = false WHERE id_version <> %s", (id_version,))

        asignaciones = ", ".join(f"{columna} = %s" for columna in campos)
        cur.execute(
            f"UPDATE rubric_versions SET {asignaciones} WHERE id_version = %s "  # noqa: S608
            "RETURNING id_version, version, descripcion, fecha_publicacion, activo",
            list(campos.values()) + [id_version],
        )
        fila = cur.fetchone()
    return VersionRubricaOut(**fila)


@router.delete("/rubrica/versiones/{id_version}")
def eliminar_version_rubrica(
    id_version: int,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Eliminar una versión de rúbrica que todavía no se usó en evaluaciones.

    parametros:
        - int : id_version Identificador de la versión a eliminar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : respuesta Confirmación de la eliminación.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT version, activo FROM rubric_versions WHERE id_version = %s", (id_version,)
        )
        version = cur.fetchone()
        if not version:
            raise HTTPException(404, "La versión no existe.")
        if version["activo"]:
            raise HTTPException(409, "No se puede eliminar la versión activa.")

        cur.execute(
            """
            SELECT 1 FROM technical_committee_scores tcs
            JOIN rubric_criteria rc ON rc.id_criterio_rubrica = tcs.id_criterio_rubrica
            WHERE rc.version = %s LIMIT 1
            """,
            (version["version"],),
        )
        if cur.fetchone():
            raise HTTPException(
                409, "No se puede eliminar: la versión ya fue usada en evaluaciones registradas."
            )

        cur.execute(
            "DELETE FROM rubric_criteria WHERE version = %s", (version["version"],)
        )
        cur.execute(
            "DELETE FROM rubric_sections WHERE version = %s", (version["version"],)
        )
        cur.execute(
            "DELETE FROM rubric_versions WHERE id_version = %s RETURNING id_version",
            (id_version,),
        )
        if not cur.fetchone():
            raise HTTPException(404, "La versión no existe.")
    return {"ok": True, "id_version": id_version}


# =====================================================================
# CONVOCATORIAS (PANTALLA 31)
# =====================================================================


@router.get("/convocatorias", response_model=list[ConvocatoriaAdminOut])
def listar_convocatorias_admin(
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Listar las convocatorias con el conteo de etapas, documentos y propuestas.

    parametros:
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + list[ConvocatoriaAdminOut] : convocatorias Convocatorias registradas.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            """
            SELECT c.*,
                   (SELECT count(*) FROM convocatoria_etapas e
                     WHERE e.id_convocatoria = c.id_convocatoria) AS etapas,
                   (SELECT count(*) FROM convocatoria_documentos d
                     WHERE d.id_convocatoria = c.id_convocatoria AND d.activo) AS documentos,
                   (SELECT count(*) FROM propuestas p
                     WHERE p.id_convocatoria = c.id_convocatoria) AS propuestas
            FROM convocatorias c
            ORDER BY c.id_convocatoria ASC
            """
        )
        filas = cur.fetchall()

    return [
        ConvocatoriaAdminOut(
            id_convocatoria=fila["id_convocatoria"],
            nombre=fila["nombre"],
            descripcion=fila.get("descripcion"),
            fecha_inicio=fila["fecha_inicio"],
            fecha_cierre=fila["fecha_cierre"],
            fecha_inicio_ejecucion=fila["fecha_inicio_ejecucion"],
            activo=fila["activo"],
            carpeta_storage=fila.get("carpeta_storage"),
            etapas=fila["etapas"],
            documentos=fila["documentos"],
            propuestas=fila["propuestas"],
        )
        for fila in filas
    ]


@router.post("/convocatorias", response_model=ConvocatoriaAdminOut, status_code=201)
def crear_convocatoria(
    payload: ConvocatoriaIn,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Registrar una convocatoria con su carpeta de almacenamiento reservada.

    parametros:
        - ConvocatoriaIn : payload Datos de la convocatoria a crear.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + ConvocatoriaAdminOut : convocatoria Convocatoria creada.
    """
    if payload.fecha_cierre < payload.fecha_inicio:
        raise HTTPException(400, "La fecha de cierre no puede ser anterior a la de inicio.")
    if payload.fecha_inicio_ejecucion < payload.fecha_cierre:
        raise HTTPException(
            400, "El inicio de la ejecución no puede ser anterior al cierre de la convocatoria."
        )

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        carpeta = _carpeta_unica(cur, payload.nombre)
        cur.execute(
            """
            INSERT INTO convocatorias
              (nombre, descripcion, fecha_inicio, fecha_cierre, fecha_inicio_ejecucion,
               activo, carpeta_storage)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id_convocatoria, nombre, descripcion, fecha_inicio, fecha_cierre,
                      fecha_inicio_ejecucion, activo, carpeta_storage
            """,
            (
                payload.nombre,
                payload.descripcion,
                payload.fecha_inicio,
                payload.fecha_cierre,
                payload.fecha_inicio_ejecucion,
                payload.activo,
                carpeta,
            ),
        )
        fila = cur.fetchone()

    return ConvocatoriaAdminOut(
        id_convocatoria=fila["id_convocatoria"],
        nombre=fila["nombre"],
        descripcion=fila.get("descripcion"),
        fecha_inicio=fila["fecha_inicio"],
        fecha_cierre=fila["fecha_cierre"],
        fecha_inicio_ejecucion=fila["fecha_inicio_ejecucion"],
        activo=fila["activo"],
        carpeta_storage=fila.get("carpeta_storage"),
        etapas=0,
        documentos=0,
        propuestas=0,
    )


@router.patch("/convocatorias/{id_convocatoria}", response_model=ConvocatoriaAdminOut)
def actualizar_convocatoria(
    id_convocatoria: int,
    payload: ConvocatoriaPatch,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Editar una convocatoria, incluida su apertura o cierre (campo «activo»).

    parametros:
        - int : id_convocatoria Identificador de la convocatoria a editar.
        - ConvocatoriaPatch : payload Campos a modificar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + ConvocatoriaAdminOut : convocatoria Convocatoria actualizada.
    """
    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "No se enviaron campos para actualizar la convocatoria.")

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        actual = _exigir_convocatoria(cur, id_convocatoria)

        inicio = campos.get("fecha_inicio", actual["fecha_inicio"])
        cierre = campos.get("fecha_cierre", actual["fecha_cierre"])
        ejecucion = campos.get("fecha_inicio_ejecucion", actual["fecha_inicio_ejecucion"])
        if cierre < inicio:
            raise HTTPException(400, "La fecha de cierre no puede ser anterior a la de inicio.")
        if ejecucion < cierre:
            raise HTTPException(
                400, "El inicio de la ejecución no puede ser anterior al cierre de la convocatoria."
            )

        asignaciones = ", ".join(f"{columna} = %s" for columna in campos)
        cur.execute(
            f"UPDATE convocatorias SET {asignaciones} WHERE id_convocatoria = %s "  # noqa: S608
            "RETURNING id_convocatoria, nombre, descripcion, fecha_inicio, fecha_cierre, "
            "fecha_inicio_ejecucion, activo, carpeta_storage",
            list(campos.values()) + [id_convocatoria],
        )
        fila = cur.fetchone()

        cur.execute(
            "SELECT (SELECT count(*) FROM convocatoria_etapas e WHERE e.id_convocatoria = %s) AS etapas, "
            "(SELECT count(*) FROM convocatoria_documentos d WHERE d.id_convocatoria = %s AND d.activo) AS documentos, "
            "(SELECT count(*) FROM propuestas p WHERE p.id_convocatoria = %s) AS propuestas",
            (id_convocatoria, id_convocatoria, id_convocatoria),
        )
        conteos = cur.fetchone()

    return ConvocatoriaAdminOut(
        id_convocatoria=fila["id_convocatoria"],
        nombre=fila["nombre"],
        descripcion=fila.get("descripcion"),
        fecha_inicio=fila["fecha_inicio"],
        fecha_cierre=fila["fecha_cierre"],
        fecha_inicio_ejecucion=fila["fecha_inicio_ejecucion"],
        activo=fila["activo"],
        carpeta_storage=fila.get("carpeta_storage"),
        etapas=conteos["etapas"],
        documentos=conteos["documentos"],
        propuestas=conteos["propuestas"],
    )


@router.delete("/convocatorias/{id_convocatoria}")
def eliminar_convocatoria(
    id_convocatoria: int,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Eliminar una convocatoria que no tenga propuestas registradas.

    Al borrarla se retiran también sus etapas y la referencia de sus documentos.
    Los archivos de Storage se conservan como respaldo del histórico institucional.

    parametros:
        - int : id_convocatoria Identificador de la convocatoria a eliminar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : respuesta Confirmación de la eliminación.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        _exigir_convocatoria(cur, id_convocatoria)
        cur.execute(
            "SELECT count(*) AS n FROM propuestas WHERE id_convocatoria = %s",
            (id_convocatoria,),
        )
        if cur.fetchone()["n"]:
            raise HTTPException(
                409,
                "No se puede eliminar: la convocatoria ya tiene propuestas registradas. "
                "Ciérrala con «activo = false» en su lugar.",
            )
        cur.execute(
            "UPDATE convocatoria_documentos SET activo = false WHERE id_convocatoria = %s",
            (id_convocatoria,),
        )
        cur.execute(
            "DELETE FROM convocatoria_etapas WHERE id_convocatoria = %s", (id_convocatoria,)
        )
        cur.execute(
            "DELETE FROM convocatorias WHERE id_convocatoria = %s RETURNING id_convocatoria",
            (id_convocatoria,),
        )
        if not cur.fetchone():
            raise HTTPException(404, "Convocatoria no encontrada.")
    return {"ok": True, "id_convocatoria": id_convocatoria}


# =====================================================================
# ETAPAS DEL CRONOGRAMA (PANTALLA 31)
# =====================================================================


@router.get("/convocatorias/{id_convocatoria}/etapas")
def listar_etapas_admin(
    id_convocatoria: int,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Listar el cronograma de etapas de una convocatoria en orden de secuencia.

    parametros:
        - int : id_convocatoria Identificador de la convocatoria.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + list[dict] : etapas Etapas ordenadas por su campo 'orden'.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        _exigir_convocatoria(cur, id_convocatoria)
        cur.execute(
            """
            SELECT id_etapa, id_convocatoria, nombre_etapa, responsable,
                   fecha_inicio, fecha_fin, orden
            FROM convocatoria_etapas
            WHERE id_convocatoria = %s
            ORDER BY orden ASC, id_etapa ASC
            """,
            (id_convocatoria,),
        )
        return cur.fetchall()


@router.post("/convocatorias/{id_convocatoria}/etapas", status_code=201)
def crear_etapa(
    id_convocatoria: int,
    payload: EtapaIn,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Agregar una etapa al cronograma de una convocatoria.

    Si no se indica el orden, la etapa se coloca al final del cronograma.

    parametros:
        - int : id_convocatoria Identificador de la convocatoria.
        - EtapaIn : payload Datos de la etapa a crear.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : etapa Etapa creada.
    """
    if payload.fecha_fin < payload.fecha_inicio:
        raise HTTPException(400, "La fecha de fin no puede ser anterior a la de inicio.")

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        _exigir_convocatoria(cur, id_convocatoria)
        cur.execute(
            """
            INSERT INTO convocatoria_etapas
              (id_convocatoria, nombre_etapa, responsable, fecha_inicio, fecha_fin, orden)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id_etapa, id_convocatoria, nombre_etapa, responsable,
                      fecha_inicio, fecha_fin, orden
            """,
            (
                id_convocatoria,
                payload.nombre_etapa,
                payload.responsable,
                payload.fecha_inicio,
                payload.fecha_fin,
                payload.orden,
            ),
        )
        return cur.fetchone()


@router.patch("/etapas/{id_etapa}")
def actualizar_etapa(
    id_etapa: int,
    payload: EtapaPatch,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Editar una etapa del cronograma de una convocatoria.

    parametros:
        - int : id_etapa Identificador de la etapa a editar.
        - EtapaPatch : payload Campos a modificar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : etapa Etapa actualizada.
    """
    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "No se enviaron campos para actualizar la etapa.")

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT fecha_inicio, fecha_fin FROM convocatoria_etapas WHERE id_etapa = %s",
            (id_etapa,),
        )
        actual = cur.fetchone()
        if not actual:
            raise HTTPException(404, "La etapa no existe.")

        inicio = campos.get("fecha_inicio", actual["fecha_inicio"])
        fin = campos.get("fecha_fin", actual["fecha_fin"])
        if fin < inicio:
            raise HTTPException(400, "La fecha de fin no puede ser anterior a la de inicio.")

        asignaciones = ", ".join(f"{columna} = %s" for columna in campos)
        cur.execute(
            f"UPDATE convocatoria_etapas SET {asignaciones} WHERE id_etapa = %s "  # noqa: S608
            "RETURNING id_etapa, id_convocatoria, nombre_etapa, responsable, "
            "fecha_inicio, fecha_fin, orden",
            list(campos.values()) + [id_etapa],
        )
        return cur.fetchone()


@router.delete("/etapas/{id_etapa}")
def eliminar_etapa(
    id_etapa: int,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Eliminar una etapa del cronograma de una convocatoria.

    parametros:
        - int : id_etapa Identificador de la etapa a eliminar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : respuesta Confirmación de la eliminación.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "DELETE FROM convocatoria_etapas WHERE id_etapa = %s RETURNING id_etapa",
            (id_etapa,),
        )
        if not cur.fetchone():
            raise HTTPException(404, "La etapa no existe.")
    return {"ok": True, "id_etapa": id_etapa}


# =====================================================================
# INSTRUMENTOS OFICIALES DE LA CONVOCATORIA (PANTALLA 31)
# =====================================================================


class DocumentoAdminOut(BaseModel):
    """Instrumento oficial asociado a una convocatoria."""

    id_documento_conv: int
    id_convocatoria: int
    nombre_documento: str
    nombre_archivo: str
    tipo_instrumento: str
    extension: str
    file_url: str
    storage_path: Optional[str] = None
    orden: int
    version: str
    mime_type: Optional[str] = None
    tamano_bytes: Optional[int] = None
    activo: bool
    fecha_subida: datetime


class DocumentoPatch(BaseModel):
    """Edición parcial de los metadatos de un instrumento oficial."""

    nombre_documento: Optional[str] = Field(default=None, min_length=2)
    tipo_instrumento: Optional[str] = None
    orden: Optional[int] = Field(default=None, ge=1)
    version: Optional[str] = None
    activo: Optional[bool] = None


@router.get("/convocatorias/{id_convocatoria}/documentos")
def listar_documentos_admin(
    id_convocatoria: int,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Listar los instrumentos oficiales de una convocatoria, incluidos los inactivos.

    parametros:
        - int : id_convocatoria Identificador de la convocatoria.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + list[DocumentoAdminOut] : documentos Instrumentos registrados.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        _exigir_convocatoria(cur, id_convocatoria)
        cur.execute(
            """
            SELECT id_documento_conv, id_convocatoria, nombre_documento, nombre_archivo,
                   tipo_instrumento, extension, file_url, storage_path, orden, version,
                   mime_type, tamano_bytes, activo, fecha_subida
            FROM convocatoria_documentos
            WHERE id_convocatoria = %s
            ORDER BY activo DESC, orden ASC, id_documento_conv ASC
            """,
            (id_convocatoria,),
        )
        return [DocumentoAdminOut(**fila) for fila in cur.fetchall()]


@router.post("/convocatorias/{id_convocatoria}/documentos", status_code=201)
def subir_documento_admin(
    id_convocatoria: int,
    nombre_documento: str = Form(...),
    tipo_instrumento: str = Form(...),
    orden: Optional[int] = Form(None),
    version: str = Form("1.0"),
    archivo: UploadFile = File(...),
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Subir un instrumento oficial a Supabase Storage y registrarlo en la convocatoria.

    parametros:
        - int : id_convocatoria Convocatoria destino del instrumento.
        - str : nombre_documento Título legible del instrumento.
        - str : tipo_instrumento Categoría (disposiciones, rúbrica, formulario, plantilla).
        - Optional[int] : orden Posición en la lista; si se omite se agrega al final.
        - str : version Versión del instrumento.
        - UploadFile : archivo Archivo a subir (pdf, docx, xlsx o pptx).
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + DocumentoAdminOut : documento Instrumento registrado.
    """
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
        _exigir_rol_admin(cur, id_usuario)
        convocatoria = _exigir_convocatoria(cur, id_convocatoria)
        carpeta = convocatoria.get("carpeta_storage") or _carpeta_unica(cur, convocatoria["nombre"])
        if not convocatoria.get("carpeta_storage"):
            cur.execute(
                "UPDATE convocatorias SET carpeta_storage = %s WHERE id_convocatoria = %s",
                (carpeta, id_convocatoria),
            )

        if orden is None:
            cur.execute(
                "SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente "
                "FROM convocatoria_documentos WHERE id_convocatoria = %s",
                (id_convocatoria,),
            )
            orden = cur.fetchone()["siguiente"]

        storage_path = f"{carpeta}/{nombre_archivo}"
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
                raise HTTPException(
                    409, f"Ya existe un archivo llamado '{nombre_archivo}' en esta convocatoria."
                )
            raise HTTPException(502, f"Storage rechazó el archivo: {respuesta.text}")

        try:
            cur.execute(
                """
                INSERT INTO convocatoria_documentos
                  (id_convocatoria, nombre_documento, nombre_archivo, tipo_instrumento,
                   extension, storage_path, file_url, orden, mime_type, tamano_bytes, version)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id_documento_conv, id_convocatoria, nombre_documento,
                          nombre_archivo, tipo_instrumento, extension, file_url, storage_path,
                          orden, version, mime_type, tamano_bytes, activo, fecha_subida
                """,
                (
                    id_convocatoria,
                    nombre_documento,
                    nombre_archivo,
                    tipo_instrumento,
                    extension,
                    storage_path,
                    file_url,
                    orden,
                    mime,
                    len(contenido),
                    version,
                ),
            )
            nuevo = cur.fetchone()
            conn.commit()
        except Exception:
            conn.rollback()
            _borrar_de_storage(url, key, storage_path)
            raise HTTPException(500, "No se pudo registrar el documento en la base de datos.")

    return DocumentoAdminOut(**nuevo)


@router.patch("/documentos/{id_documento}", response_model=DocumentoAdminOut)
def actualizar_documento(
    id_documento: int,
    payload: DocumentoPatch,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Editar los metadatos de un instrumento oficial o retirarlo de la convocatoria.

    parametros:
        - int : id_documento Identificador del instrumento a editar.
        - DocumentoPatch : payload Campos a modificar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + DocumentoAdminOut : documento Instrumento actualizado.
    """
    campos = payload.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "No se enviaron campos para actualizar el documento.")

    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        asignaciones = ", ".join(f"{columna} = %s" for columna in campos)
        cur.execute(
            f"UPDATE convocatoria_documentos SET {asignaciones} WHERE id_documento_conv = %s "  # noqa: S608
            "RETURNING id_documento_conv, id_convocatoria, nombre_documento, nombre_archivo, "
            "tipo_instrumento, extension, file_url, storage_path, orden, version, "
            "mime_type, tamano_bytes, activo, fecha_subida",
            list(campos.values()) + [id_documento],
        )
        fila = cur.fetchone()
        if not fila:
            raise HTTPException(404, "El documento no existe.")
    return DocumentoAdminOut(**fila)


@router.delete("/documentos/{id_documento}")
def eliminar_documento(
    id_documento: int,
    id_usuario: int = Query(..., description="ID del usuario administrador"),
    conn: Connection = Depends(get_conn),
):
    """
    Eliminar un instrumento oficial y su archivo en Supabase Storage.

    parametros:
        - int : id_documento Identificador del instrumento a eliminar.
        - int : id_usuario Identificador del usuario administrador.
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + dict : respuesta Confirmación de la eliminación.
    """
    with conn.cursor() as cur:
        _exigir_rol_admin(cur, id_usuario)
        cur.execute(
            "SELECT id_documento_conv, storage_path FROM convocatoria_documentos "
            "WHERE id_documento_conv = %s",
            (id_documento,),
        )
        documento = cur.fetchone()
        if not documento:
            raise HTTPException(404, "El documento no existe.")
        cur.execute(
            "DELETE FROM convocatoria_documentos WHERE id_documento_conv = %s RETURNING id_documento_conv",
            (id_documento,),
        )
        cur.fetchone()

    # [Línea clave]: La fila ya quedó eliminada; el archivo de Storage se borra como limpieza.
    if documento["storage_path"]:
        try:
            url, key = _config_storage()
            _borrar_de_storage(url, key, documento["storage_path"])
        except HTTPException:
            pass
    return {"ok": True, "id_documento": id_documento}
