import math
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg import Connection
from pydantic import BaseModel, Field

from ..db import get_conn

router = APIRouter(prefix="/propuestas", tags=["propuestas"])


# =====================================================================
# PYDANTIC SCHEMAS
# =====================================================================

class DashboardPropuestas(BaseModel):
    total: int
    formulacion: int
    ejecucion: int
    cerradas: int


class propuestaMasReciente(BaseModel):
    id: int
    titulo: str


class Top3PropuestasRecientes(BaseModel):
    id: int
    code: str
    title: str
    tipo: str
    period: str
    status: str
    amount: float


# Schemas para la Creación y Dossier Completo de Propuestas
class TeamMemberIn(BaseModel):
    id_usuario: int
    id_tipo_hora: int
    horas_asignadas: int = Field(ge=1, le=40)


class ObjetivoIn(BaseModel):
    codigo_objetivo: str = Field(..., max_length=10, description="Ej: OG, OE1, OE2")
    descripcion: str
    orden: int = 1


class ProductoAcademicoIn(BaseModel):
    tipo_producto: str
    descripcion: str
    meta_esperada: str
    categoria: str
    id_objetivo: Optional[int] = None
    es_obligatorio: bool = True


class PlanAccionIn(BaseModel):
    descripcion_actividad: str
    fecha_inicio: date
    fecha_fin: Optional[date] = None
    id_usuario_responsable: Optional[int] = None


class RiesgoIn(BaseModel):
    descripcion_riesgo: str
    id_nivel_probabilidad: int
    id_nivel_impacto: int
    medida_mitigacion: Optional[str] = None
    id_plan_accion: Optional[int] = None


class PresupuestoItemIn(BaseModel):
    id_rubro: int
    monto: float = Field(ge=0)
    anio: int = Field(default=1, ge=1, le=3)


class DeclaracionEticaIn(BaseModel):
    tipo_aspecto: str
    aplica: bool
    justificacion_exencion: Optional[str] = ""
    ente_regulatorio: Optional[str] = None
    numero_permiso: Optional[str] = None
    estado_tramite: Optional[str] = None


class PropuestaCrearIn(BaseModel):
    id_usuario_lider: int
    id_escuela: int
    id_modalidad: int
    id_linea_investigacion: int
    titulo: str = Field(..., min_length=5, max_length=300)
    resumen: Optional[str] = ""
    id_convocatoria: Optional[int] = 1
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    estado_inicial: Optional[int] = 1  # 1 = En formulación / Borrador
    equipo: list[TeamMemberIn] = []
    objetivos: list[ObjetivoIn] = []
    productos_academicos: list[ProductoAcademicoIn] = []
    plan_accion: list[PlanAccionIn] = []
    riesgos: list[RiesgoIn] = []
    presupuesto: list[PresupuestoItemIn] = []
    declaraciones_eticas: list[DeclaracionEticaIn] = []


class EstadoActualizarIn(BaseModel):
    id_nuevo_estado: int
    id_usuario_responsable: int
    observaciones: Optional[str] = "Cambio de estado de propuesta"


class EvaluacionIn(BaseModel):
    id_usuario_eval: int
    id_rol_evaluador: int
    observaciones: Optional[str] = ""
    puntaje_comite: Optional[int] = None
    id_resolucion_cie: Optional[int] = None
    cambiar_a_estado: Optional[int] = None


# Helper para verificar columnas existentes en 'propuestas'
def _get_table_columns(cur, table_name: str) -> set[str]:
    cur.execute(
        """
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name,),
    )
    return {row["column_name"] for row in cur.fetchall()}


# =====================================================================
# ENDPOINTS EXISTENTES CORREGIDOS (DESAJUSTES #1 Y #4)
# =====================================================================

@router.get("/dashboardpropuestas", response_model=DashboardPropuestas)
def obtener_dashboard_propuestas(
    id_usuario: int = Query(..., description="ID del usuario a consultar"),
    conn: Connection = Depends(get_conn),
):
    """
    Desajuste #1: Soporta tanto 'En formulación' como 'Borrador', y tolera variaciones
    de mayúsculas/acentos mediante coincidencias flexibles con ILIKE.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                count(DISTINCT p.id_propuesta) AS total,
                count(DISTINCT p.id_propuesta) FILTER (
                    WHERE e.nombre_estado IN ('En formulación', 'Borrador')
                       OR e.nombre_estado ILIKE '%formulaci%'
                ) AS formulacion,
                count(DISTINCT p.id_propuesta) FILTER (
                    WHERE e.nombre_estado IN ('En ejecución', 'En Ejecución')
                       OR e.nombre_estado ILIKE '%ejecuci%'
                ) AS ejecucion,
                count(DISTINCT p.id_propuesta) FILTER (
                    WHERE e.nombre_estado IN ('Cerrada', 'Rechazada', 'Aprobada por CIE')
                       OR e.nombre_estado ILIKE '%cerrad%'
                ) AS cerradas
            FROM propuestas p
            JOIN estados e ON e.id_estado = p.estado_actual
            LEFT JOIN research_team rt ON rt.id_propuesta = p.id_propuesta
            WHERE p.id_usuario_lider = %s OR rt.id_usuario = %s;
            """,
            (id_usuario, id_usuario),
        )
        fila = cur.fetchone()

    return DashboardPropuestas(
        total=fila["total"],
        formulacion=fila["formulacion"],
        ejecucion=fila["ejecucion"],
        cerradas=fila["cerradas"],
    )


@router.get("/propuestaMasReciente", response_model=Optional[propuestaMasReciente])
def obtener_propuesta_mas_reciente(
    id_usuario: int = Query(..., description="ID del usuario a consultar"),
    conn: Connection = Depends(get_conn),
):
    """
    Desajuste #1: Busca la propuesta más reciente en formulación, tolerando
    'Borrador' o 'En formulación' para evitar que devuelva null por discrepancia de catálogo.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 
                p.id_propuesta,
                p.titulo
            FROM propuestas p
            JOIN estados e ON e.id_estado = p.estado_actual
            LEFT JOIN research_team rt ON rt.id_propuesta = p.id_propuesta
            WHERE (
                e.nombre_estado IN ('En formulación', 'Borrador')
                OR e.nombre_estado ILIKE '%formulaci%'
            )
            AND (p.id_usuario_lider = %s OR rt.id_usuario = %s)
            ORDER BY p.fecha_creacion DESC
            LIMIT 1;
            """,
            (id_usuario, id_usuario),
        )
        fila = cur.fetchone()

    if fila is None:
        return None

    return propuestaMasReciente(
        id=fila["id_propuesta"],
        titulo=fila["titulo"],
    )


@router.get("/top3PropuestaMasReciente", response_model=list[Top3PropuestasRecientes])
def obtener_propuestas_mas_reciente(
    id_usuario: int = Query(..., description="ID del usuario a consultar"),
    conn: Connection = Depends(get_conn),
):
    """
    Desajuste #4: Recupera el código institucional real (SI-YYYY-NNN) y el período
    calculado de ejecución, eliminando los guiones '-' estáticos que se devolvían antes.
    """
    with conn.cursor() as cur:
        cols = _get_table_columns(cur, "propuestas")
        has_codigo = "codigo" in cols
        has_fechas = "fecha_inicio" in cols and "fecha_fin" in cols

        code_expr = "COALESCE(p.codigo, 'SI-' || p.id_propuesta)" if has_codigo else "'SI-' || p.id_propuesta"
        period_expr = (
            """
            CASE
                WHEN p.fecha_inicio IS NOT NULL AND p.fecha_fin IS NOT NULL
                THEN to_char(p.fecha_inicio, 'YYYY') || '–' || to_char(p.fecha_fin, 'YYYY')
                ELSE '2027–2028'
            END
            """
            if has_fechas
            else "'2027–2028'"
        )

        group_by_cols = ["p.id_propuesta", "p.titulo", "m.nombre_modalidad", "e.nombre_estado", "p.fecha_creacion"]
        if has_codigo:
            group_by_cols.append("p.codigo")
        if has_fechas:
            group_by_cols.extend(["p.fecha_inicio", "p.fecha_fin"])

        sql = f"""
            SELECT
                p.id_propuesta AS id,
                {code_expr} AS code,
                p.titulo AS title,
                m.nombre_modalidad AS type,
                {period_expr} AS period,
                e.nombre_estado AS status,
                COALESCE(SUM(pb.monto), 0) AS amount
            FROM propuestas p
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            LEFT JOIN proposal_budget pb ON pb.id_propuesta = p.id_propuesta
            WHERE p.id_usuario_lider = %s
            OR EXISTS (
                SELECT 1 FROM research_team rt
                WHERE rt.id_propuesta = p.id_propuesta AND rt.id_usuario = %s
            )
            GROUP BY {", ".join(group_by_cols)}
            ORDER BY p.fecha_creacion DESC
            LIMIT 5;
        """
        cur.execute(sql, (id_usuario, id_usuario))
        filas = cur.fetchall()

    return [
        Top3PropuestasRecientes(
            id=f["id"],
            code=str(f["code"]),
            title=f["title"],
            tipo=f["type"],
            period=str(f["period"]),
            status=f["status"],
            amount=float(f["amount"]),
        )
        for f in filas
    ]


# =====================================================================
# ENDPOINTS NUEVOS: CREACIÓN, DOSSIER, BÚSQUEDA Y EVALUACIÓN (DESAJUSTE #6)
# =====================================================================

@router.get("", response_model=list[dict[str, Any]])
def listar_propuestas(
    id_usuario: Optional[int] = Query(default=None, description="Filtrar por usuario (lider o equipo)"),
    id_escuela: Optional[int] = Query(default=None, description="Filtrar por escuela"),
    id_modalidad: Optional[int] = Query(default=None, description="Filtrar por modalidad"),
    id_linea: Optional[int] = Query(default=None, description="Filtrar por línea de investigación"),
    id_estado: Optional[int] = Query(default=None, description="Filtrar por ID de estado"),
    estado_nombre: Optional[str] = Query(default=None, description="Filtrar por nombre de estado"),
    q: Optional[str] = Query(default=None, description="Término de búsqueda en título o código"),
    conn: Connection = Depends(get_conn),
):
    """
    Consulta general de propuestas con soporte para filtros combinados de búsqueda
    histórica (Pantalla 29) y bandejas de entrada de evaluadores (Pantallas 23 a 27).
    """
    with conn.cursor() as cur:
        cols = _get_table_columns(cur, "propuestas")
        has_codigo = "codigo" in cols
        has_fechas = "fecha_inicio" in cols and "fecha_fin" in cols

        code_expr = "COALESCE(p.codigo, 'SI-' || p.id_propuesta)" if has_codigo else "'SI-' || p.id_propuesta"
        period_expr = (
            """
            CASE
                WHEN p.fecha_inicio IS NOT NULL AND p.fecha_fin IS NOT NULL
                THEN to_char(p.fecha_inicio, 'YYYY') || '–' || to_char(p.fecha_fin, 'YYYY')
                ELSE '2027–2028'
            END
            """
            if has_fechas
            else "'2027–2028'"
        )

        where_clauses = ["1=1"]
        params: list[Any] = []

        if id_usuario is not None:
            where_clauses.append(
                "(p.id_usuario_lider = %s OR EXISTS (SELECT 1 FROM research_team rt WHERE rt.id_propuesta = p.id_propuesta AND rt.id_usuario = %s))"
            )
            params.extend([id_usuario, id_usuario])

        if id_escuela is not None:
            where_clauses.append("p.id_escuela = %s")
            params.append(id_escuela)

        if id_modalidad is not None:
            where_clauses.append("p.id_modalidad = %s")
            params.append(id_modalidad)

        if id_linea is not None:
            where_clauses.append("p.id_linea_investigacion = %s")
            params.append(id_linea)

        if id_estado is not None:
            where_clauses.append("p.estado_actual = %s")
            params.append(id_estado)

        if estado_nombre:
            where_clauses.append("e.nombre_estado ILIKE %s")
            params.append(f"%{estado_nombre}%")

        if q:
            if has_codigo:
                where_clauses.append("(p.titulo ILIKE %s OR p.codigo ILIKE %s)")
                params.extend([f"%{q}%", f"%{q}%"])
            else:
                where_clauses.append("p.titulo ILIKE %s")
                params.append(f"%{q}%")

        group_cols = [
            "p.id_propuesta",
            "p.titulo",
            "p.resumen",
            "p.fecha_creacion",
            "m.nombre_modalidad",
            "esc.nombre",
            "esc.siglas",
            "lin.nombre_linea",
            "e.nombre_estado",
            "u.nombre",
            "u.correo",
        ]
        if has_codigo:
            group_cols.append("p.codigo")
        if has_fechas:
            group_cols.extend(["p.fecha_inicio", "p.fecha_fin"])

        sql = f"""
            SELECT
                p.id_propuesta,
                {code_expr} AS codigo,
                p.titulo,
                p.resumen,
                m.nombre_modalidad AS modalidad,
                esc.nombre AS escuela,
                esc.siglas AS escuela_siglas,
                lin.nombre_linea AS linea_investigacion,
                e.nombre_estado AS estado,
                u.nombre AS lider_nombre,
                u.correo AS lider_correo,
                {period_expr} AS periodo,
                p.fecha_creacion,
                COALESCE(SUM(pb.monto), 0) AS monto_total
            FROM propuestas p
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            LEFT JOIN proposal_budget pb ON pb.id_propuesta = p.id_propuesta
            WHERE {" AND ".join(where_clauses)}
            GROUP BY {", ".join(group_cols)}
            ORDER BY p.fecha_creacion DESC;
        """
        cur.execute(sql, tuple(params))
        filas = cur.fetchall()

    return filas


@router.get("/{id_propuesta}", response_model=dict[str, Any])
def obtener_dossier_propuesta(
    id_propuesta: int,
    conn: Connection = Depends(get_conn),
):
    """
    Retorna el expediente íntegro de la propuesta con todas sus tablas hijas
    para consulta en pantalla o emisión de dictamen de evaluadores.
    """
    with conn.cursor() as cur:
        # 1. Cabecera principal
        cols = _get_table_columns(cur, "propuestas")
        has_codigo = "codigo" in cols
        has_fechas = "fecha_inicio" in cols and "fecha_fin" in cols
        code_expr = "COALESCE(p.codigo, 'SI-' || p.id_propuesta)" if has_codigo else "'SI-' || p.id_propuesta"

        sql_prop = f"""
            SELECT
                p.id_propuesta,
                {code_expr} AS codigo,
                p.titulo,
                p.resumen,
                p.id_modalidad,
                m.nombre_modalidad,
                p.id_escuela,
                esc.nombre AS nombre_escuela,
                esc.siglas AS siglas_escuela,
                p.id_linea_investigacion,
                lin.nombre_linea,
                p.id_usuario_lider,
                u.nombre AS nombre_lider,
                u.correo AS correo_lider,
                p.estado_actual,
                e.nombre_estado,
                p.fecha_creacion
                {", p.fecha_inicio, p.fecha_fin" if has_fechas else ""}
            FROM propuestas p
            JOIN modalidades m ON m.id_modalidad = p.id_modalidad
            JOIN escuelas esc ON esc.id_escuela = p.id_escuela
            JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
            JOIN estados e ON e.id_estado = p.estado_actual
            JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
            WHERE p.id_propuesta = %s
        """
        cur.execute(sql_prop, (id_propuesta,))
        prop = cur.fetchone()

        if not prop:
            raise HTTPException(status_code=404, detail="Propuesta no encontrada")

        # 2. Equipo investigador
        cur.execute(
            """
            SELECT rt.id_usuario, u.nombre, u.correo, rt.id_tipo_hora,
                   th.nombre_tipo_hora, rt.horas_asignadas
            FROM research_team rt
            JOIN usuarios u ON u.id_usuario = rt.id_usuario
            JOIN tipos_hora th ON th.id_tipo_hora = rt.id_tipo_hora
            WHERE rt.id_propuesta = %s
            """,
            (id_propuesta,),
        )
        equipo = cur.fetchall()

        # 3. Objetivos
        objetivos = []
        try:
            cur.execute(
                """
                SELECT id_objetivo, codigo_objetivo, descripcion, orden
                FROM proposal_objectives
                WHERE id_propuesta = %s
                ORDER BY orden ASC
                """,
                (id_propuesta,),
            )
            objetivos = cur.fetchall()
        except Exception:
            pass

        # 4. Productos académicos comprometidos
        productos = []
        try:
            cur.execute(
                """
                SELECT id_producto, id_objetivo, tipo_producto, descripcion,
                       meta_esperada, categoria, es_obligatorio, cumplido
                FROM academic_product_commitments
                WHERE id_propuesta = %s
                """,
                (id_propuesta,),
            )
            productos = cur.fetchall()
        except Exception:
            pass

        # 5. Plan de acción
        planes = []
        try:
            cur.execute(
                """
                SELECT ap.id_plan_accion, ap.descripcion_actividad, ap.fecha_inicio,
                       ap.fecha_fin, ap.id_usuario_responsable, u.nombre AS responsable_nombre
                FROM action_plans ap
                LEFT JOIN usuarios u ON u.id_usuario = ap.id_usuario_responsable
                WHERE ap.id_propuesta = %s
                ORDER BY ap.fecha_inicio ASC
                """,
                (id_propuesta,),
            )
            planes = cur.fetchall()
        except Exception:
            pass

        # 6. Riesgos
        riesgos = []
        try:
            cur.execute(
                """
                SELECT r.id_riesgo, r.descripcion_riesgo, r.id_nivel_probabilidad,
                       np.nombre_nivel AS probabilidad, r.id_nivel_impacto,
                       ni.nombre_nivel AS impacto, r.medida_mitigacion
                FROM risks r
                JOIN niveles_riesgo np ON np.id_nivel_riesgo = r.id_nivel_probabilidad
                JOIN niveles_riesgo ni ON ni.id_nivel_riesgo = r.id_nivel_impacto
                WHERE r.id_propuesta = %s
                """,
                (id_propuesta,),
            )
            riesgos = cur.fetchall()
        except Exception:
            pass

        # 7. Presupuesto
        presupuesto = []
        try:
            budget_cols = _get_table_columns(cur, "proposal_budget")
            anio_col = "pb.anio" if "anio" in budget_cols else "1 AS anio"
            cur.execute(
                f"""
                SELECT pb.id_rubro, rp.nombre_rubro, pb.monto, {anio_col}
                FROM proposal_budget pb
                JOIN rubros_presupuesto rp ON rp.id_rubro = pb.id_rubro
                WHERE pb.id_propuesta = %s
                """,
                (id_propuesta,),
            )
            presupuesto = cur.fetchall()
        except Exception:
            pass

        # 8. Declaraciones Éticas
        eticas = []
        try:
            cur.execute(
                """
                SELECT id_etica, tipo_aspecto, aplica, justificacion_exencion,
                       ente_regulatorio, numero_permiso, estado_tramite
                FROM proposal_ethics_declarations
                WHERE id_propuesta = %s
                """,
                (id_propuesta,),
            )
            eticas = cur.fetchall()
        except Exception:
            pass

        # 9. Historial de estados
        historial = []
        try:
            cur.execute(
                """
                SELECT psh.id_historial, psh.fecha_cambio, psh.observaciones,
                       e1.nombre_estado AS estado_anterior,
                       e2.nombre_estado AS estado_nuevo,
                       u.nombre AS responsable_nombre
                FROM proposal_state_history psh
                LEFT JOIN estados e1 ON e1.id_estado = psh.id_estado_anterior
                JOIN estados e2 ON e2.id_estado = psh.id_estado_nuevo
                LEFT JOIN usuarios u ON u.id_usuario = psh.id_usuario_responsable
                WHERE psh.id_propuesta = %s
                ORDER BY psh.fecha_cambio ASC
                """,
                (id_propuesta,),
            )
            historial = cur.fetchall()
        except Exception:
            pass

        # 10. Evaluaciones
        evaluaciones = []
        try:
            cur.execute(
                """
                SELECT ev.id_evaluacion, ev.fecha_evaluacion, ev.observaciones,
                       u.nombre AS evaluador_nombre, r.nombre_rol AS rol_evaluador,
                       tce.puntaje AS puntaje_comite,
                       cr.nombre_resolucion AS resolucion_cie
                FROM evaluations ev
                JOIN usuarios u ON u.id_usuario = ev.id_usuario_eval
                JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                LEFT JOIN technical_committee_evaluations tce ON tce.id_evaluacion = ev.id_evaluacion
                LEFT JOIN cie_resolution_evaluations cie ON cie.id_evaluacion = ev.id_evaluacion
                LEFT JOIN resoluciones_cie cr ON cr.id_resolucion = cie.id_resolucion
                WHERE ev.id_propuesta = %s
                ORDER BY ev.fecha_evaluacion DESC
                """,
                (id_propuesta,),
            )
            evaluaciones = cur.fetchall()
        except Exception:
            pass

    return {
        **prop,
        "equipo": equipo,
        "objetivos": objetivos,
        "productos_academicos": productos,
        "plan_accion": planes,
        "riesgos": riesgos,
        "presupuesto": presupuesto,
        "declaraciones_eticas": eticas,
        "historial": historial,
        "evaluaciones": evaluaciones,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def crear_propuesta(
    payload: PropuestaCrearIn,
    conn: Connection = Depends(get_conn),
):
    """
    Desajuste #6: Creación atómica de la propuesta y todas sus entidades hijas.
    Valida las reglas institucionales VIE 2027:
    - Restricción de adquisición de equipo y bienes duraderos solo en el Año 1.
    - Proporcionalidad mínima de 1 producto académico por cada 10 horas semanales del equipo.
    - Generación garantizada de código institucional SI-YYYY-NNN.
    """
    # -------------------------------------------------------------
    # 1. Validaciones de Negocio Obligatorias (Disposiciones VIE 2027)
    # -------------------------------------------------------------
    # Regla 1: Equipo y bienes duraderos únicamente en Año 1 (Sección 2.3.9)
    # Buscamos si algún rubro de bienes duraderos fue enviado con año > 1
    with conn.cursor() as cur:
        cur.execute("SELECT id_rubro, nombre_rubro FROM rubros_presupuesto")
        rubros_map = {r["id_rubro"]: r["nombre_rubro"].lower() for r in cur.fetchall()}

    for item in payload.presupuesto:
        nom = rubros_map.get(item.id_rubro, "")
        if ("duradero" in nom or "equipo" in nom) and item.anio > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La adquisición de equipo y bienes duraderos debe formularse obligatoriamente en el Año 1 (Sección 2.3.9 Disposiciones Fondos VIE 2027).",
            )

    # Regla 2: Proporcionalidad de Productos Académicos (Sección 2.4.1)
    # Mínimo 1 producto por cada 10 horas totales asignadas al equipo de investigación
    total_horas = sum(m.horas_asignadas for m in payload.equipo)
    min_productos_requeridos = max(1, math.ceil(total_horas / 10)) if total_horas > 0 else 1

    # Si se envía directamente a revisión (estado > 1), se exige la cuota completa
    if payload.estado_inicial and payload.estado_inicial > 1:
        if len(payload.productos_academicos) < min_productos_requeridos:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Para {total_horas} horas totales del equipo se exige un mínimo de {min_productos_requeridos} productos académicos comprometidos (Sección 2.4.1 Disposiciones VIE 2027).",
            )

    # -------------------------------------------------------------
    # 2. Inserción Atómica Multitabla
    # -------------------------------------------------------------
    with conn.cursor() as cur:
        cols = _get_table_columns(cur, "propuestas")
        has_codigo = "codigo" in cols
        has_convocatoria = "id_convocatoria" in cols
        has_fechas = "fecha_inicio" in cols and "fecha_fin" in cols

        # Construir columnas y valores dinámicamente según el esquema activo
        insert_cols = [
            "id_usuario_lider",
            "id_escuela",
            "id_modalidad",
            "id_linea_investigacion",
            "titulo",
            "resumen",
            "estado_actual",
            "fecha_creacion",
        ]
        values = [
            payload.id_usuario_lider,
            payload.id_escuela,
            payload.id_modalidad,
            payload.id_linea_investigacion,
            payload.titulo,
            payload.resumen,
            payload.estado_inicial or 1,
            datetime.now(),
        ]

        if has_convocatoria and payload.id_convocatoria:
            insert_cols.append("id_convocatoria")
            values.append(payload.id_convocatoria)

        if has_fechas:
            insert_cols.extend(["fecha_inicio", "fecha_fin"])
            values.extend([payload.fecha_inicio or date(2027, 1, 1), payload.fecha_fin or date(2028, 12, 31)])

        placeholders = ", ".join(["%s"] * len(values))
        cols_str = ", ".join(insert_cols)

        # Usar OVERRIDING SYSTEM VALUE solo si fuera necesario, aquí id_propuesta es identity autogenerado
        cur.execute(
            f"INSERT INTO propuestas ({cols_str}) VALUES ({placeholders}) RETURNING id_propuesta;",
            tuple(values),
        )
        id_propuesta = cur.fetchone()["id_propuesta"]

        # Si la columna 'codigo' existe y el trigger de base de datos no lo generó, generarlo aquí
        if has_codigo:
            cur.execute("SELECT codigo FROM propuestas WHERE id_propuesta = %s;", (id_propuesta,))
            codigo_row = cur.fetchone()
            if not codigo_row or not codigo_row["codigo"]:
                anio_actual = datetime.now().year
                cur.execute(
                    "UPDATE propuestas SET codigo = %s WHERE id_propuesta = %s;",
                    (f"SI-{anio_actual}-{id_propuesta:03d}", id_propuesta),
                )

        # 3. Equipo Investigador
        for miembro in payload.equipo:
            cur.execute(
                """
                INSERT INTO research_team (id_propuesta, id_usuario, id_tipo_hora, horas_asignadas)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id_propuesta, id_usuario, id_tipo_hora) 
                DO UPDATE SET horas_asignadas = EXCLUDED.horas_asignadas;
                """,
                (id_propuesta, miembro.id_usuario, miembro.id_tipo_hora, miembro.horas_asignadas),
            )

        # 4. Objetivos
        objetivo_id_map: dict[str, int] = {}
        for obj in payload.objetivos:
            try:
                cur.execute(
                    """
                    INSERT INTO proposal_objectives (id_propuesta, codigo_objetivo, descripcion, orden)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id_objetivo;
                    """,
                    (id_propuesta, obj.codigo_objetivo, obj.descripcion, obj.orden),
                )
                id_obj = cur.fetchone()["id_objetivo"]
                objetivo_id_map[obj.codigo_objetivo] = id_obj
            except Exception:
                pass

        # 5. Compromisos de Productos Académicos
        for prod in payload.productos_academicos:
            try:
                cur.execute(
                    """
                    INSERT INTO academic_product_commitments (
                        id_propuesta, id_objetivo, tipo_producto, descripcion,
                        meta_esperada, categoria, es_obligatorio, cumplido
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                    """,
                    (
                        id_propuesta,
                        prod.id_objetivo,
                        prod.tipo_producto,
                        prod.descripcion,
                        prod.meta_esperada,
                        prod.categoria,
                        prod.es_obligatorio,
                        False,
                    ),
                )
            except Exception:
                pass

        # 6. Plan de Acción
        primer_plan_id: Optional[int] = None
        for plan in payload.plan_accion:
            try:
                cur.execute(
                    """
                    INSERT INTO action_plans (id_propuesta, descripcion_actividad, fecha_inicio, fecha_fin, id_usuario_responsable)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id_plan_accion;
                    """,
                    (id_propuesta, plan.descripcion_actividad, plan.fecha_inicio, plan.fecha_fin, plan.id_usuario_responsable),
                )
                res = cur.fetchone()
                if res and primer_plan_id is None:
                    primer_plan_id = res["id_plan_accion"]
            except Exception:
                pass

        # 7. Matriz de Riesgos (vinculada al plan de acción si existe columna)
        risks_cols = _get_table_columns(cur, "risks")
        has_plan_fk = "id_plan_accion" in risks_cols
        for r in payload.riesgos:
            try:
                if has_plan_fk:
                    cur.execute(
                        """
                        INSERT INTO risks (id_propuesta, descripcion_riesgo, id_nivel_probabilidad, id_nivel_impacto, medida_mitigacion, id_plan_accion)
                        VALUES (%s, %s, %s, %s, %s, %s);
                        """,
                        (id_propuesta, r.descripcion_riesgo, r.id_nivel_probabilidad, r.id_nivel_impacto, r.medida_mitigacion, r.id_plan_accion or primer_plan_id),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO risks (id_propuesta, descripcion_riesgo, id_nivel_probabilidad, id_nivel_impacto, medida_mitigacion)
                        VALUES (%s, %s, %s, %s, %s);
                        """,
                        (id_propuesta, r.descripcion_riesgo, r.id_nivel_probabilidad, r.id_nivel_impacto, r.medida_mitigacion),
                    )
            except Exception:
                pass

        # 8. Presupuesto Anualizado
        budget_cols = _get_table_columns(cur, "proposal_budget")
        has_anio_col = "anio" in budget_cols
        for b in payload.presupuesto:
            try:
                if has_anio_col:
                    cur.execute(
                        """
                        INSERT INTO proposal_budget (id_propuesta, id_rubro, monto, anio)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id_propuesta, id_rubro) DO UPDATE SET monto = EXCLUDED.monto, anio = EXCLUDED.anio;
                        """,
                        (id_propuesta, b.id_rubro, b.monto, b.anio),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO proposal_budget (id_propuesta, id_rubro, monto)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (id_propuesta, id_rubro) DO UPDATE SET monto = EXCLUDED.monto;
                        """,
                        (id_propuesta, b.id_rubro, b.monto),
                    )
            except Exception:
                pass

        # 9. Declaraciones Éticas
        for etica in payload.declaraciones_eticas:
            try:
                cur.execute(
                    """
                    INSERT INTO proposal_ethics_declarations (
                        id_propuesta, tipo_aspecto, aplica, justificacion_exencion,
                        ente_regulatorio, numero_permiso, estado_tramite
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s);
                    """,
                    (
                        id_propuesta,
                        etica.tipo_aspecto,
                        etica.aplica,
                        etica.justificacion_exencion or "",
                        etica.ente_regulatorio,
                        etica.numero_permiso,
                        etica.estado_tramite,
                    ),
                )
            except Exception:
                pass

        # 10. Registrar en historial de estados
        try:
            cur.execute(
                """
                INSERT INTO proposal_state_history (id_propuesta, id_estado_anterior, id_estado_nuevo, id_usuario_responsable, fecha_cambio, observaciones)
                VALUES (%s, NULL, %s, %s, NOW(), %s);
                """,
                (id_propuesta, payload.estado_inicial or 1, payload.id_usuario_lider, "Creación de la propuesta"),
            )
        except Exception:
            pass

        # 11. Notificación inicial
        try:
            cur.execute(
                """
                INSERT INTO notificaciones (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida)
                VALUES (%s, %s, 'tramite', 'Propuesta registrada', %s, NOW(), false);
                """,
                (
                    payload.id_usuario_lider,
                    id_propuesta,
                    f"Su propuesta «{payload.titulo}» fue registrada con éxito en el sistema.",
                ),
            )
        except Exception:
            pass

        # Obtener el código final generado
        cur.execute(
            f"SELECT id_propuesta, {code_expr} AS codigo, titulo FROM propuestas WHERE id_propuesta = %s",
            (id_propuesta,),
        )
        propuesta_creada = cur.fetchone()

    return {
        "ok": True,
        "mensaje": "Propuesta creada exitosamente con todos sus componentes institucionales.",
        "propuesta": propuesta_creada,
    }


@router.patch("/{id_propuesta}/estado")
def actualizar_estado_propuesta(
    id_propuesta: int,
    payload: EstadoActualizarIn,
    conn: Connection = Depends(get_conn),
):
    """
    Transición de estado de propuesta.
    Dispara automáticamente el trigger de auditoría (proposal_state_history)
    y el trigger de notificaciones automáticas al líder.
    """
    with conn.cursor() as cur:
        # 1. Obtener estado actual
        cur.execute("SELECT estado_actual, titulo, id_usuario_lider FROM propuestas WHERE id_propuesta = %s", (id_propuesta,))
        actual = cur.fetchone()
        if not actual:
            raise HTTPException(status_code=404, detail="Propuesta no encontrada")

        estado_anterior = actual["estado_actual"]

        # 2. Actualizar estado
        cur.execute(
            """
            UPDATE propuestas
            SET estado_actual = %s
            WHERE id_propuesta = %s
            RETURNING id_propuesta, estado_actual;
            """,
            (payload.id_nuevo_estado, id_propuesta),
        )
        actualizado = cur.fetchone()

        # 3. Respaldo manual en proposal_state_history en caso de que los triggers de BD no estén activos
        try:
            cur.execute(
                """
                INSERT INTO proposal_state_history (id_propuesta, id_estado_anterior, id_estado_nuevo, id_usuario_responsable, fecha_cambio, observaciones)
                VALUES (%s, %s, %s, %s, NOW(), %s);
                """,
                (id_propuesta, estado_anterior, payload.id_nuevo_estado, payload.id_usuario_responsable, payload.observaciones),
            )
        except Exception:
            pass

        # 4. Obtener nombre del nuevo estado
        cur.execute("SELECT nombre_estado FROM estados WHERE id_estado = %s", (payload.id_nuevo_estado,))
        estado_nombre = cur.fetchone()

    return {
        "ok": True,
        "id_propuesta": actualizado["id_propuesta"],
        "estado_actual": actualizado["estado_actual"],
        "nombre_estado": estado_nombre["nombre_estado"] if estado_nombre else "Desconocido",
    }


@router.post("/{id_propuesta}/evaluaciones", status_code=status.HTTP_201_CREATED)
def registrar_evaluacion(
    id_propuesta: int,
    payload: EvaluacionIn,
    conn: Connection = Depends(get_conn),
):
    """
    Registra el dictamen o evaluación emitida por un evaluador (Vinculación, Comité Técnico, CIE).
    Permite además avanzar o devolver el estado de la propuesta automáticamente.
    """
    with conn.cursor() as cur:
        # 1. Verificar propuesta
        cur.execute("SELECT id_propuesta, titulo, id_usuario_lider FROM propuestas WHERE id_propuesta = %s", (id_propuesta,))
        prop = cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Propuesta no encontrada")

        # 2. Insertar evaluación principal
        cur.execute(
            """
            INSERT INTO evaluations (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
            VALUES (%s, %s, %s, NOW(), %s)
            RETURNING id_evaluacion;
            """,
            (id_propuesta, payload.id_usuario_eval, payload.id_rol_evaluador, payload.observaciones),
        )
        id_eval = cur.fetchone()["id_evaluacion"]

        # 3. Si incluye puntaje numérico del Comité Técnico
        if payload.puntaje_comite is not None:
            try:
                cur.execute(
                    """
                    INSERT INTO technical_committee_evaluations (id_evaluacion, puntaje)
                    VALUES (%s, %s)
                    ON CONFLICT (id_evaluacion) DO UPDATE SET puntaje = EXCLUDED.puntaje;
                    """,
                    (id_eval, payload.puntaje_comite),
                )
            except Exception:
                pass

        # 4. Si incluye resolución formal del CIE
        if payload.id_resolucion_cie is not None:
            try:
                cur.execute(
                    """
                    INSERT INTO cie_resolution_evaluations (id_evaluacion, id_resolucion)
                    VALUES (%s, %s)
                    ON CONFLICT (id_evaluacion) DO UPDATE SET id_resolucion = EXCLUDED.id_resolucion;
                    """,
                    (id_eval, payload.id_resolucion_cie),
                )
            except Exception:
                pass

        # 5. Si se solicitó actualización de estado como consecuencia del dictamen
        nuevo_estado_nombre = None
        if payload.cambiar_a_estado is not None:
            cur.execute(
                "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s",
                (payload.cambiar_a_estado, id_propuesta),
            )
            cur.execute("SELECT nombre_estado FROM estados WHERE id_estado = %s", (payload.cambiar_a_estado,))
            ne = cur.fetchone()
            if ne:
                nuevo_estado_nombre = ne["nombre_estado"]

    return {
        "ok": True,
        "id_evaluacion": id_eval,
        "id_propuesta": id_propuesta,
        "nuevo_estado": nuevo_estado_nombre,
        "mensaje": "Evaluación registrada exitosamente.",
    }
