from fastapi import APIRouter, Depends
from psycopg import Connection

from ..db import get_conn

router = APIRouter(prefix="/catalogos", tags=["catalogos"])


@router.get("")
def obtener_todos_catalogos(conn: Connection = Depends(get_conn)):
    """
    Retorna todos los catálogos institucionales en una sola llamada.
    Ideal para que el frontend hidrate sus selectores y filtros sin hacer múltiples peticiones.
    """
    escuelas = conn.execute(
        "SELECT id_escuela, nombre, siglas FROM public.escuelas ORDER BY nombre"
    ).fetchall()

    modalidades = conn.execute(
        "SELECT id_modalidad, nombre_modalidad FROM public.modalidades ORDER BY id_modalidad"
    ).fetchall()

    lineas = conn.execute(
        "SELECT id_linea_investigacion, nombre_linea FROM public.lineas_investigacion ORDER BY nombre_linea"
    ).fetchall()

    estados = conn.execute(
        "SELECT id_estado, nombre_estado FROM public.estados ORDER BY id_estado"
    ).fetchall()

    tipos_hora = conn.execute(
        "SELECT id_tipo_hora, nombre_tipo_hora FROM public.tipos_hora ORDER BY id_tipo_hora"
    ).fetchall()

    rubros = conn.execute(
        "SELECT id_rubro, nombre_rubro FROM public.rubros_presupuesto ORDER BY id_rubro"
    ).fetchall()

    niveles_riesgo = conn.execute(
        "SELECT id_nivel_riesgo, nombre_nivel FROM public.niveles_riesgo ORDER BY id_nivel_riesgo"
    ).fetchall()

    criterios_vie = conn.execute(
        "SELECT id_criterio, descripcion_criterio FROM public.criterios_verificacion_vie ORDER BY id_criterio"
    ).fetchall()

    resoluciones_cie = conn.execute(
        "SELECT id_resolucion, nombre_resolucion FROM public.resoluciones_cie ORDER BY id_resolucion"
    ).fetchall()

    roles = conn.execute(
        "SELECT id_rol, nombre_rol FROM public.roles ORDER BY id_rol"
    ).fetchall()

    return {
        "escuelas": escuelas,
        "modalidades": modalidades,
        "lineas_investigacion": lineas,
        "estados": estados,
        "tipos_hora": tipos_hora,
        "rubros_presupuesto": rubros,
        "niveles_riesgo": niveles_riesgo,
        "criterios_verificacion_vie": criterios_vie,
        "resoluciones_cie": resoluciones_cie,
        "roles": roles,
    }


@router.get("/escuelas")
def listar_escuelas(conn: Connection = Depends(get_conn)):
    return conn.execute("SELECT id_escuela, nombre, siglas FROM public.escuelas ORDER BY nombre").fetchall()


@router.get("/modalidades")
def listar_modalidades(conn: Connection = Depends(get_conn)):
    return conn.execute("SELECT id_modalidad, nombre_modalidad FROM public.modalidades ORDER BY id_modalidad").fetchall()


@router.get("/lineas-investigacion")
def listar_lineas(conn: Connection = Depends(get_conn)):
    return conn.execute("SELECT id_linea_investigacion, nombre_linea FROM public.lineas_investigacion ORDER BY nombre_linea").fetchall()


@router.get("/estados")
def listar_estados(conn: Connection = Depends(get_conn)):
    return conn.execute("SELECT id_estado, nombre_estado FROM public.estados ORDER BY id_estado").fetchall()

