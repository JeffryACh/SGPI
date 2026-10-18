from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import Connection
from pydantic import BaseModel, Field

from ..db import get_conn

router = APIRouter(prefix="/propuestas", tags=["propuestas"])


# =====================================================================
# Modelos Pydantic de Entrada (Schemas)
# =====================================================================

class MiembroEquipoIn(BaseModel):
    id_usuario: int
    id_tipo_hora: int
    horas_asignadas: int = Field(ge=1, le=40)


class RubroPresupuestoIn(BaseModel):
    id_rubro: int
    monto: float = Field(ge=0)


class ActividadPlanIn(BaseModel):
    descripcion_actividad: str
    fecha_inicio: date
    fecha_fin: Optional[date] = None
    id_usuario_responsable: Optional[int] = None


class RiesgoIn(BaseModel):
    descripcion_riesgo: str
    id_nivel_probabilidad: int
    id_nivel_impacto: int
    medida_mitigacion: Optional[str] = None


class PropuestaCrearIn(BaseModel):
    id_usuario_lider: int
    id_escuela: int
    id_modalidad: int
    id_linea_investigacion: int
    titulo: str = Field(min_length=5, max_length=250)
    resumen: Optional[str] = None
    equipo: Optional[list[MiembroEquipoIn]] = None
    presupuesto: Optional[list[RubroPresupuestoIn]] = None
    plan_accion: Optional[list[ActividadPlanIn]] = None
    riesgos: Optional[list[RiesgoIn]] = None


class CambioEstadoIn(BaseModel):
    id_estado_nuevo: int
    id_usuario_responsable: int
    observaciones: Optional[str] = None


class CriterioVerificacionIn(BaseModel):
    id_criterio: int
    cumple: bool


class EvaluacionIn(BaseModel):
    id_usuario_eval: int
    id_rol_evaluador: int
    observaciones: Optional[str] = None
    puntaje: Optional[int] = Field(default=None, ge=0, le=100) # Para Comité Técnico
    id_resolucion: Optional[int] = None                        # Para CIE
    verificaciones: Optional[list[CriterioVerificacionIn]] = None # Para Dirección VIE


# =====================================================================
# Endpoints
# =====================================================================

@router.get("")
def listar_propuestas(
    id_escuela: Optional[int] = Query(default=None, description="Filtrar por escuela"),
    id_usuario_lider: Optional[int] = Query(default=None, description="Filtrar por persona investigadora líder"),
    id_modalidad: Optional[int] = Query(default=None, description="Filtrar por modalidad"),
    id_linea_investigacion: Optional[int] = Query(default=None, description="Filtrar por línea de investigación"),
    id_estado: Optional[int] = Query(default=None, description="Filtrar por estado actual"),
    q: Optional[str] = Query(default=None, description="Búsqueda por texto en título o resumen"),
    conn: Connection = Depends(get_conn),
):
    """
    Listado y búsqueda de propuestas con filtros combinados (Consulta Histórica y Mis Propuestas).
    Retorna la información consolidada con nombres institucionales y el monto total presupuestado.
    """
    query = """
        SELECT 
            p.id_propuesta,
            p.titulo,
            p.resumen,
            p.fecha_creacion,
            p.id_usuario_lider,
            u.nombre || ' ' || u.lastname || ' ' || u.second_lastname AS nombre_lider,
            u.correo AS correo_lider,
            p.id_escuela,
            e.nombre AS nombre_escuela,
            e.siglas AS siglas_escuela,
            p.id_modalidad,
            m.nombre_modalidad,
            p.id_linea_investigacion,
            li.nombre_linea,
            p.estado_actual AS id_estado,
            est.nombre_estado,
            COALESCE(SUM(pb.monto), 0) AS monto_total
        FROM public.propuestas p
        JOIN public.usuarios u ON u.id_usuario = p.id_usuario_lider
        JOIN public.escuelas e ON e.id_escuela = p.id_escuela
        JOIN public.modalidades m ON m.id_modalidad = p.id_modalidad
        JOIN public.lineas_investigacion li ON li.id_linea_investigacion = p.id_linea_investigacion
        JOIN public.estados est ON est.id_estado = p.estado_actual
        LEFT JOIN public.proposal_budget pb ON pb.id_propuesta = p.id_propuesta
        WHERE 1=1
    """
    params = []

    if id_escuela:
        query += " AND p.id_escuela = %s"
        params.append(id_escuela)
    if id_usuario_lider:
        query += " AND p.id_usuario_lider = %s"
        params.append(id_usuario_lider)
    if id_modalidad:
        query += " AND p.id_modalidad = %s"
        params.append(id_modalidad)
    if id_linea_investigacion:
        query += " AND p.id_linea_investigacion = %s"
        params.append(id_linea_investigacion)
    if id_estado:
        query += " AND p.estado_actual = %s"
        params.append(id_estado)
    if q and q.strip():
        query += " AND (p.titulo ILIKE %s OR p.resumen ILIKE %s)"
        like_str = f"%{q.strip()}%"
        params.extend([like_str, like_str])

    query += """
        GROUP BY p.id_propuesta, u.id_usuario, e.id_escuela, m.id_modalidad, li.id_linea_investigacion, est.id_estado
        ORDER BY p.id_propuesta DESC
    """

    filas = conn.execute(query, tuple(params)).fetchall()
    return filas


@router.get("/{id_propuesta}")
def obtener_expediente(id_propuesta: int, conn: Connection = Depends(get_conn)):
    """
    Obtiene el expediente digital completo de una propuesta:
    Cabecera, Equipo, Presupuesto, Plan de Acción, Riesgos, Historial de Estados y Evaluaciones.
    """
    propuesta = conn.execute(
        """
        SELECT 
            p.id_propuesta,
            p.titulo,
            p.resumen,
            p.fecha_creacion,
            p.id_usuario_lider,
            u.nombre || ' ' || u.lastname || ' ' || u.second_lastname AS nombre_lider,
            u.correo AS correo_lider,
            p.id_escuela,
            e.nombre AS nombre_escuela,
            e.siglas AS siglas_escuela,
            p.id_modalidad,
            m.nombre_modalidad,
            p.id_linea_investigacion,
            li.nombre_linea,
            p.estado_actual AS id_estado,
            est.nombre_estado
        FROM public.propuestas p
        JOIN public.usuarios u ON u.id_usuario = p.id_usuario_lider
        JOIN public.escuelas e ON e.id_escuela = p.id_escuela
        JOIN public.modalidades m ON m.id_modalidad = p.id_modalidad
        JOIN public.lineas_investigacion li ON li.id_linea_investigacion = p.id_linea_investigacion
        JOIN public.estados est ON est.id_estado = p.estado_actual
        WHERE p.id_propuesta = %s
        """,
        (id_propuesta,),
    ).fetchone()

    if not propuesta:
        raise HTTPException(status_code=404, detail="Propuesta no encontrada")

    equipo = conn.execute(
        """
        SELECT 
            rt.id_usuario,
            u.nombre || ' ' || u.lastname || ' ' || u.second_lastname AS nombre_completo,
            u.correo,
            e.siglas AS siglas_escuela,
            rt.id_tipo_hora,
            th.nombre_tipo_hora,
            rt.horas_asignadas
        FROM public.research_team rt
        JOIN public.usuarios u ON u.id_usuario = rt.id_usuario
        LEFT JOIN public.escuelas e ON e.id_escuela = u.id_escuela
        JOIN public.tipos_hora th ON th.id_tipo_hora = rt.id_tipo_hora
        WHERE rt.id_propuesta = %s
        ORDER BY rt.horas_asignadas DESC
        """,
        (id_propuesta,),
    ).fetchall()

    presupuesto = conn.execute(
        """
        SELECT 
            pb.id_rubro,
            rp.nombre_rubro,
            pb.monto
        FROM public.proposal_budget pb
        JOIN public.rubros_presupuesto rp ON rp.id_rubro = pb.id_rubro
        WHERE pb.id_propuesta = %s
        ORDER BY pb.monto DESC
        """,
        (id_propuesta,),
    ).fetchall()

    plan_accion = conn.execute(
        """
        SELECT 
            ap.id_plan_accion,
            ap.descripcion_actividad,
            ap.fecha_inicio,
            ap.fecha_fin,
            ap.id_usuario_responsable,
            u.nombre || ' ' || u.lastname AS responsable
        FROM public.action_plans ap
        LEFT JOIN public.usuarios u ON u.id_usuario = ap.id_usuario_responsable
        WHERE ap.id_propuesta = %s
        ORDER BY ap.fecha_inicio ASC
        """,
        (id_propuesta,),
    ).fetchall()

    riesgos = conn.execute(
        """
        SELECT 
            r.id_riesgo,
            r.descripcion_riesgo,
            np.nombre_nivel AS nivel_probabilidad,
            ni.nombre_nivel AS nivel_impacto,
            r.medida_mitigacion
        FROM public.risks r
        JOIN public.niveles_riesgo np ON np.id_nivel_riesgo = r.id_nivel_probabilidad
        JOIN public.niveles_riesgo ni ON ni.id_nivel_riesgo = r.id_nivel_impacto
        WHERE r.id_propuesta = %s
        """,
        (id_propuesta,),
    ).fetchall()

    historial = conn.execute(
        """
        SELECT 
            h.id_historial,
            ea.nombre_estado AS estado_anterior,
            en.nombre_estado AS estado_nuevo,
            u.nombre || ' ' || u.lastname AS responsable,
            h.fecha_cambio,
            h.observaciones
        FROM public.proposal_state_history h
        LEFT JOIN public.estados ea ON ea.id_estado = h.id_estado_anterior
        JOIN public.estados en ON en.id_estado = h.id_estado_nuevo
        LEFT JOIN public.usuarios u ON u.id_usuario = h.id_usuario_responsable
        WHERE h.id_propuesta = %s
        ORDER BY h.fecha_cambio ASC
        """,
        (id_propuesta,),
    ).fetchall()

    evaluaciones = conn.execute(
        """
        SELECT 
            ev.id_evaluacion,
            ev.fecha_evaluacion,
            ev.observaciones,
            r.nombre_rol AS rol_evaluador,
            u.nombre || ' ' || u.lastname AS evaluador,
            tce.puntaje,
            rcie.nombre_resolucion AS resolucion_cie
        FROM public.evaluations ev
        JOIN public.roles r ON r.id_rol = ev.id_rol_evaluador
        JOIN public.usuarios u ON u.id_usuario = ev.id_usuario_eval
        LEFT JOIN public.technical_committee_evaluations tce ON tce.id_evaluacion = ev.id_evaluacion
        LEFT JOIN public.cie_resolution_evaluations cre ON cre.id_evaluacion = ev.id_evaluacion
        LEFT JOIN public.resoluciones_cie rcie ON rcie.id_resolucion = cre.id_resolucion
        WHERE ev.id_propuesta = %s
        ORDER BY ev.fecha_evaluacion ASC
        """,
        (id_propuesta,),
    ).fetchall()

    return {
        **propuesta,
        "equipo": equipo,
        "presupuesto": presupuesto,
        "monto_total": sum(float(item["monto"]) for item in presupuesto),
        "plan_accion": plan_accion,
        "riesgos": riesgos,
        "historial": historial,
        "evaluaciones": evaluaciones,
    }


@router.post("", status_code=201)
def crear_propuesta(datos: PropuestaCrearIn, conn: Connection = Depends(get_conn)):
    """
    Crea una nueva propuesta con su equipo, presupuesto, plan de acción y riesgos.
    Registra de forma transaccional la propuesta y su primer evento en proposal_state_history.
    """
    # 1. Obtener ID del estado inicial "En formulación"
    estado_fila = conn.execute(
        "SELECT id_estado FROM public.estados WHERE nombre_estado = 'En formulación'"
    ).fetchone()
    id_estado_inicial = estado_fila["id_estado"] if estado_fila else 1

    # 2. Insertar propuesta principal
    res = conn.execute(
        """
        INSERT INTO public.propuestas (
            id_usuario_lider, id_escuela, id_modalidad, id_linea_investigacion,
            titulo, resumen, estado_actual, fecha_creacion
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        RETURNING id_propuesta
        """,
        (
            datos.id_usuario_lider,
            datos.id_escuela,
            datos.id_modalidad,
            datos.id_linea_investigacion,
            datos.titulo.strip(),
            datos.resumen.strip() if datos.resumen else None,
            id_estado_inicial,
        ),
    ).fetchone()
    id_propuesta = res["id_propuesta"]

    # 3. Trazabilidad: Historial inicial
    conn.execute(
        """
        INSERT INTO public.proposal_state_history (
            id_propuesta, id_estado_anterior, id_estado_nuevo,
            id_usuario_responsable, fecha_cambio, observaciones
        ) VALUES (%s, NULL, %s, %s, NOW(), 'Creación del borrador de propuesta')
        """,
        (id_propuesta, id_estado_inicial, datos.id_usuario_lider),
    )

    # 4. Insertar equipo investigador
    if datos.equipo:
        for m in datos.equipo:
            conn.execute(
                """
                INSERT INTO public.research_team (id_propuesta, id_usuario, id_tipo_hora, horas_asignadas)
                VALUES (%s, %s, %s, %s)
                """,
                (id_propuesta, m.id_usuario, m.id_tipo_hora, m.horas_asignadas),
            )

    # 5. Insertar presupuesto
    if datos.presupuesto:
        for p in datos.presupuesto:
            conn.execute(
                """
                INSERT INTO public.proposal_budget (id_propuesta, id_rubro, monto)
                VALUES (%s, %s, %s)
                """,
                (id_propuesta, p.id_rubro, p.monto),
            )

    # 6. Insertar plan de acción
    if datos.plan_accion:
        for a in datos.plan_accion:
            conn.execute(
                """
                INSERT INTO public.action_plans (
                    id_propuesta, descripcion_actividad, fecha_inicio, fecha_fin, id_usuario_responsable
                ) VALUES (%s, %s, %s, %s, %s)
                """,
                (id_propuesta, a.descripcion_actividad, a.fecha_inicio, a.fecha_fin, a.id_usuario_responsable),
            )

    # 7. Insertar riesgos
    if datos.riesgos:
        for r in datos.riesgos:
            conn.execute(
                """
                INSERT INTO public.risks (
                    id_propuesta, descripcion_riesgo, id_nivel_probabilidad, id_nivel_impacto, medida_mitigacion
                ) VALUES (%s, %s, %s, %s, %s)
                """,
                (id_propuesta, r.descripcion_riesgo, r.id_nivel_probabilidad, r.id_nivel_impacto, r.medida_mitigacion),
            )

    return {
        "id_propuesta": id_propuesta,
        "mensaje": "Propuesta registrada exitosamente con trazabilidad inicial",
    }


@router.patch("/{id_propuesta}/estado")
def cambiar_estado(
    id_propuesta: int,
    cambio: CambioEstadoIn,
    conn: Connection = Depends(get_conn),
):
    """
    Avanza o retrocede el estado institucional de una propuesta en el flujo Fondos VIE.
    Actualiza la cabecera e inserta un registro auditable en proposal_state_history.
    """
    actual = conn.execute(
        "SELECT estado_actual FROM public.propuestas WHERE id_propuesta = %s",
        (id_propuesta,),
    ).fetchone()

    if not actual:
        raise HTTPException(status_code=404, detail="Propuesta no encontrada")

    id_estado_anterior = actual["estado_actual"]

    # Actualizar estado actual
    conn.execute(
        "UPDATE public.propuestas SET estado_actual = %s WHERE id_propuesta = %s",
        (cambio.id_estado_nuevo, id_propuesta),
    )

    # Insertar en bitácora histórica
    conn.execute(
        """
        INSERT INTO public.proposal_state_history (
            id_propuesta, id_estado_anterior, id_estado_nuevo,
            id_usuario_responsable, fecha_cambio, observaciones
        ) VALUES (%s, %s, %s, %s, NOW(), %s)
        """,
        (
            id_propuesta,
            id_estado_anterior,
            cambio.id_estado_nuevo,
            cambio.id_usuario_responsable,
            cambio.observaciones,
        ),
    )

    return {
        "id_propuesta": id_propuesta,
        "id_estado_anterior": id_estado_anterior,
        "id_estado_nuevo": cambio.id_estado_nuevo,
        "mensaje": "Estado de la propuesta actualizado correctamente",
    }


@router.post("/{id_propuesta}/evaluaciones", status_code=201)
def registrar_evaluacion(
    id_propuesta: int,
    evaluacion: EvaluacionIn,
    conn: Connection = Depends(get_conn),
):
    """
    Registra una evaluación multi-instancia:
    - Base en evaluations (id_propuesta, id_usuario_eval, id_rol_evaluador, observaciones).
    - Si es Comité Técnico: Guarda puntaje numérico en technical_committee_evaluations.
    - Si es CIE: Guarda resolución (Aprobada/Rechazada/Observada) en cie_resolution_evaluations.
    - Si es Dirección VIE: Guarda checklist en vie_dictamen_verifications.
    """
    # 1. Insertar evaluación base
    res = conn.execute(
        """
        INSERT INTO public.evaluations (
            id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones
        ) VALUES (%s, %s, %s, NOW(), %s)
        RETURNING id_evaluacion
        """,
        (
            id_propuesta,
            evaluacion.id_usuario_eval,
            evaluacion.id_rol_evaluador,
            evaluacion.observaciones,
        ),
    ).fetchone()
    id_evaluacion = res["id_evaluacion"]

    # 2. Especialización: Comité Técnico (puntaje 0-100)
    if evaluacion.puntaje is not None:
        conn.execute(
            """
            INSERT INTO public.technical_committee_evaluations (id_evaluacion, puntaje)
            VALUES (%s, %s)
            """,
            (id_evaluacion, evaluacion.puntaje),
        )

    # 3. Especialización: CIE (Resolución categórica)
    if evaluacion.id_resolucion is not None:
        conn.execute(
            """
            INSERT INTO public.cie_resolution_evaluations (id_evaluacion, id_resolucion)
            VALUES (%s, %s)
            """,
            (id_evaluacion, evaluacion.id_resolucion),
        )

    # 4. Especialización: Dirección VIE (Checklist de verificación)
    if evaluacion.verificaciones:
        for v in evaluacion.verificaciones:
            conn.execute(
                """
                INSERT INTO public.vie_dictamen_verifications (id_evaluacion, id_criterio, cumple)
                VALUES (%s, %s, %s)
                """,
                (id_evaluacion, v.id_criterio, v.cumple),
            )

    return {
        "id_evaluacion": id_evaluacion,
        "id_propuesta": id_propuesta,
        "mensaje": "Evaluación registrada exitosamente",
    }

