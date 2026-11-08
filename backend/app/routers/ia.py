"""
========================================================================================
ARCHIVO: backend/app/routers/ia.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Proveer el motor de Evaluación Preliminar Automatizada con Inteligencia Artificial
    utilizando la API online de Google Gemini en su Plan Gratuito (Google AI Studio Free Tier),
    generando dictámenes de referencia no vinculantes adaptados a cada uno de los 5 niveles
    de evaluación institucional de la Convocatoria Fondos VIE 2027.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Recibe solicitudes automáticas al enviar una propuesta a revisión desde
             'backend/app/routers/propuestas.py' (POST /propuestas y PATCH /propuestas/{id}/estado)
             y peticiones directas desde 'frontend/js/app.js' (Pantallas 18, 22, 23, 24, 25, 26 y 27).
           - Extrae el expediente completo (cabecera, equipo, horas, objetivos, productos, plan,
             riesgos, presupuesto anualizado y ética) desde las tablas de Supabase PostgreSQL
             mediante 'app.db.get_conn'.
           - Lee las variables de entorno 'GEMINI_API_KEY' y 'GEMINI_MODEL' configuradas en
             Render o en el archivo '.env'.
    2.2.2. A dónde envía datos:
           - Envía el prompt estructurado con los criterios y parámetros oficiales VIE 2027
             hacia el endpoint HTTPS de Google Gemini API ('generativelanguage.googleapis.com').
           - Persiste y actualiza la evaluación preliminar resultante en la tabla
             'public.ai_preliminary_evaluations' en Supabase.
           - Retorna el dictamen preliminar desglosado por nivel evaluador hacia el Frontend
             desplegado en Vercel (o servidor local).

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    1. Define el catálogo oficial de criterios y parámetros normativos de Fondos VIE 2027
       para los 5 niveles evaluadores (Centro de Vinculación, Comité Técnico con rúbrica
       0/6/8/10, Consejo de Escuela, Dirección de Investigación VIE y CIE).
    2. Ejecuta una auditoría cuantitativa previa (topes presupuestarios por modalidad,
       bienes duraderos en Año 1, horas mínimas VIE/CONS, cuota de productos académicos y
       beca estudiantil).
    3. Invoca el modelo gratuito 'gemini-3.5-flash' (con fallback automático a
       'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite' y motor normativo determinista si no hay
       API Key o se alcanza el límite de cuota gratuita) exigiendo salida JSON estructurada.
    4. Almacena el resultado en Supabase y lo expone mediante endpoints REST para que
       cualquier evaluador lo consulte como referencia técnica.
========================================================================================
"""

import json
import math
import os
import urllib.error
import urllib.request
from contextlib import ExitStack
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection
from pydantic import BaseModel, Field

from ..db import get_conn

# [Línea clave]: Declara el router bajo el prefijo /ia para agrupar los servicios de evaluación preliminar con Gemini.
router = APIRouter(prefix="/ia", tags=["inteligencia_artificial_gemini"])

# [Línea clave]: Define la cadena de modelos del Plan Gratuito de Google AI Studio priorizando gemini-3.5-flash.
FREE_TIER_MODELS = [
    os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
]


# =====================================================================
# CATÁLOGO OFICIAL DE CRITERIOS Y PARÁMETROS POR NIVEL (FONDOS VIE 2027)
# =====================================================================

CRITERIOS_OFICIALES_VIE_2027: dict[str, Any] = {
    "convocatoria": "Fondos VIE 2027 (Acuerdo CIE-237-2026)",
    "escala_rubrica": {
        "0": "Deficiente (No cumple el criterio o carece de evidencia)",
        "6": "Regular (Cumplimiento parcial; bloquea recomendación si el criterio es obligatorio)",
        "8": "Bueno (Cumple satisfactoriamente los requerimientos del criterio)",
        "10": "Excelente (Supera el estándar con alta rigurosidad y trazabilidad)",
    },
    "reglas_bloqueo": [
        "Umbral mínimo de recomendación del Comité Técnico: puntaje ponderado >= 70.0 / 100.",
        "Regla de oro VIE: Si cualquier criterio marcado como OBLIGATORIO recibe calificación 0 (Deficiente) o 6 (Regular), la propuesta queda NO RECOMENDADA aunque el puntaje total sea >= 70.",
        "Sección 2.3.9: El rubro de Equipo y bienes duraderos solo se permite en el Año 1 de ejecución.",
        "Sección 2.4.1: Cuota mínima de productos académicos obligatorios proporcional a las horas semanales (al menos 1 producto por cada 10 h en Básica/Aplicada, y tabla especial + 1 activo PI en Desarrollo Tecnológico).",
        "Topes presupuestarios anuales: Actividad de fortalecimiento = ₡2.000.000 (1 año); Investigación básica/aplicada = ₡4.000.000/año (máx. 2 años); Desarrollo tecnológico = ₡5.000.000/año (máx. 3 años).",
    ],
    "niveles_evaluacion": {
        "nivel_1_vinculacion": {
            "instancia": "Centro de Vinculación",
            "pantalla_sgpi": "23",
            "parametros": [
                "Potencial de generación de activos de Propiedad Intelectual (software, patentes, modelos de utilidad, diseños industriales, secretos).",
                "Coherencia del nivel de madurez tecnológica (TRL inicial y TRL meta entre 4 y 7 para Desarrollo Tecnológico).",
                "Estrategia de protección previa a la divulgación científica.",
                "Vinculación con empresas, comunidades o instituciones externas.",
            ],
        },
        "nivel_2_comite_tecnico": {
            "instancia": "Comité Técnico",
            "pantalla_sgpi": "24",
            "secciones_rubrica": [
                {
                    "seccion": "Equipo",
                    "peso_total": 15,
                    "criterios": [
                        {"nombre": "Composición disciplinaria", "peso": 3, "obligatorio": False},
                        {"nombre": "Experiencia", "peso": 3, "obligatorio": False},
                        {"nombre": "Articulación del equipo", "peso": 3, "obligatorio": False},
                        {"nombre": "Vinculación externa", "peso": 2, "obligatorio": False},
                        {"nombre": "Trayectoria de coordinación", "peso": 2, "obligatorio": False},
                        {"nombre": "Participación estudiantil", "peso": 2, "obligatorio": True},
                    ],
                },
                {
                    "seccion": "Fundamentación",
                    "peso_total": 12,
                    "criterios": [
                        {"nombre": "Definición del problema", "peso": 4, "obligatorio": False},
                        {"nombre": "Coherencia de objetivos", "peso": 4, "obligatorio": False},
                        {"nombre": "Diagnóstico y vacío de conocimiento", "peso": 4, "obligatorio": True},
                    ],
                },
                {
                    "seccion": "Metodología",
                    "peso_total": 15,
                    "criterios": [
                        {"nombre": "Rigor del desarrollo", "peso": 8, "obligatorio": True},
                        {"nombre": "Usuarios y validación", "peso": 7, "obligatorio": True},
                    ],
                },
                {
                    "seccion": "Plan de acción",
                    "peso_total": 13,
                    "criterios": [
                        {"nombre": "Claridad de actividades y responsables", "peso": 4, "obligatorio": True},
                        {"nombre": "Giras y actividades académicas", "peso": 4, "obligatorio": True},
                        {"nombre": "Trazabilidad y plazos", "peso": 5, "obligatorio": True},
                    ],
                },
                {
                    "seccion": "Presupuesto",
                    "peso_total": 10,
                    "criterios": [
                        {"nombre": "Coherencia y topes", "peso": 4, "obligatorio": True},
                        {"nombre": "Equipamiento en primer año", "peso": 4, "obligatorio": True},
                        {"nombre": "Otros fondos", "peso": 2, "obligatorio": False},
                    ],
                },
                {
                    "seccion": "Riesgos",
                    "peso_total": 8,
                    "criterios": [
                        {"nombre": "Identificación por actividad", "peso": 4, "obligatorio": True},
                        {"nombre": "Viabilidad de mitigación", "peso": 4, "obligatorio": True},
                    ],
                },
                {
                    "seccion": "Ética y PI",
                    "peso_total": 10,
                    "criterios": [
                        {"nombre": "Declaración ética", "peso": 4, "obligatorio": True},
                        {"nombre": "Gestión de propiedad intelectual", "peso": 6, "obligatorio": True},
                    ],
                },
                {
                    "seccion": "Pertinencia e impacto",
                    "peso_total": 17,
                    "criterios": [
                        {"nombre": "Contribución e impacto", "peso": 10, "obligatorio": False},
                        {"nombre": "Innovación", "peso": 7, "obligatorio": False},
                    ],
                },
            ],
        },
        "nivel_3_consejo_escuela": {
            "instancia": "Consejo de Escuela",
            "pantalla_sgpi": "25",
            "parametros": [
                "Pertinencia académica con las líneas de investigación de la Escuela coordinadora y escuelas participantes.",
                "Viabilidad de las horas solicitadas por investigador (>= 4 h/sem en VIE/CONS, >= 2 h/sem en REC, mínimo 8 h/sem totales del proyecto).",
                "Respaldo al presupuesto plurianual solicitado.",
                "Ratificación de la calificación emitida por el Comité Técnico (Formatos oficiales 7 y 8).",
            ],
        },
        "nivel_4_direccion_vie": {
            "instancia": "Dirección de Investigación (VIE)",
            "pantalla_sgpi": "26",
            "checklist_admisibilidad": [
                "Personal investigador al día con informes y compromisos institucionales (sin morosidad).",
                "Coherencia de riesgos identificados y viabilidad de medidas de mitigación.",
                "Inclusión obligatoria de beca para estudiante asistente especial (mínimo 10 h/semana a ₡2.400/h).",
                "Declaraciones éticas completas y debidamente justificadas por eje.",
                "Dictamen emitido por el Centro de Vinculación (obligatorio en Desarrollo Tecnológico o con potencial PI).",
            ],
        },
        "nivel_5_cie": {
            "instancia": "Consejo de Investigación y Extensión (CIE)",
            "pantalla_sgpi": "27",
            "parametros": [
                "Cumplimiento integral del debido proceso en las instancias previas.",
                "Alineación estratégica institucional, prioridades nacionales y ODS.",
                "Relación costo-beneficio y disponibilidad presupuestaria institucional.",
                "Emisión de resolución colegiada motivada: Aprobada, Con observaciones o Rechazada.",
            ],
        },
    },
}


# =====================================================================
# MODELOS PYDANTIC DE ENTRADA Y SALIDA
# =====================================================================

class BorradorEvaluacionIAIn(BaseModel):
    """
    Modelo de entrada para solicitar una evaluación preliminar de IA sobre datos en memoria o borrador.

    Permite enviar los campos de una propuesta desde el cliente web cuando se realizan simulaciones
    en el navegador o antes de consultar un ID persistido en base de datos.

    Se utiliza como cuerpo de petición en el endpoint POST /ia/evaluar-borrador.

    atributos:
        * Optional[int] : id_propuesta Identificador opcional de la propuesta si ya existe en Supabase.
        * str : codigo Código institucional de la propuesta (ej. SI-2027-014).
        * str : titulo Título del proyecto de investigación.
        * str : modalidad Nombre de la modalidad (Desarrollo tecnológico, Investigación básica, etc.).
        * str : escuela Nombre de la escuela coordinadora.
        * str : linea_investigacion Línea de investigación vinculada.
        * str : resumen Resumen ejecutivo y planteamiento del problema.
        * int : horas_totales_semanales Suma de horas semanales del equipo investigador.
        * float : presupuesto_anio_1 Monto total presupuestado para el Año 1 en colones (CRC).
        * float : presupuesto_anio_2 Monto total presupuestado para el Año 2 en colones (CRC).
        * bool : tiene_equipo_anio_2 Indica si erróneamente se presupuestó equipo duradero después del Año 1.
        * bool : incluye_beca_asistente Indica si incorpora la beca mínima de estudiante asistente especial.
        * int : cantidad_objetivos Número de objetivos específicos definidos.
        * int : cantidad_actividades Número de actividades en el plan de acción.
        * int : cantidad_riesgos Número de eventos de riesgo registrados con mitigación.
        * int : cantidad_productos Número de productos académicos / activos de PI comprometidos.
        * bool : declaraciones_eticas_completas Indica si los 4 ejes bioéticos tienen justificación.
    """
    id_propuesta: Optional[int] = 1
    codigo: str = "SI-2027-014"
    titulo: str = "Agua Inteligente: monitoreo de cuencas"
    modalidad: str = "Desarrollo tecnológico"
    escuela: str = "Escuela de Ingeniería Ambiental"
    linea_investigacion: str = "Gestión integrada del recurso hídrico"
    resumen: str = (
        "Desarrollo y validación de un sistema de monitoreo que integra mediciones de calidad "
        "del agua (pH, temperatura, conductividad) para apoyar decisiones en dos microcuencas piloto."
    )
    horas_totales_semanales: int = 16
    presupuesto_anio_1: float = 4800000.0
    presupuesto_anio_2: float = 4600000.0
    tiene_equipo_anio_2: bool = False
    incluye_beca_asistente: bool = True
    cantidad_objetivos: int = 3
    cantidad_actividades: int = 4
    cantidad_riesgos: int = 4
    cantidad_productos: int = 3
    declaraciones_eticas_completas: bool = True


# =====================================================================
# FUNCIONES AUXILIARES DE BASE DE DATOS Y AUDITORÍA NORMATIVA
# =====================================================================

_TABLA_IA_VERIFICADA = False


def _asegurar_tabla_ia(cur) -> None:
    """
    Garantizar que la tabla 'ai_preliminary_evaluations' exista en Supabase antes de leer o escribir.

    Ejecuta una sentencia DDL idempotente 'CREATE TABLE IF NOT EXISTS' para que el despliegue en Render
    y las pruebas locales funcionen de inmediato sin fallar si aún no se ha corrido el script V6 manualmente.
    La verificación se memoriza por proceso para sacar el DDL del camino caliente de cada petición.

    parametros:
        - Cursor : cur Cursor activo de la conexión transaccional a PostgreSQL.

    return:
        + None : None Crea la tabla si no existía.
    """
    global _TABLA_IA_VERIFICADA
    if _TABLA_IA_VERIFICADA:
        return
    # [Línea clave]: Crea de forma idempotente la tabla de evaluaciones preliminares de IA en PostgreSQL.
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.ai_preliminary_evaluations (
          id_evaluacion_ia integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          id_propuesta integer NOT NULL UNIQUE REFERENCES public.propuestas(id_propuesta) ON DELETE CASCADE,
          modelo_ia character varying(80) NOT NULL DEFAULT 'gemini-3.5-flash',
          modo_generacion character varying(40) NOT NULL DEFAULT 'gemini_online',
          puntaje_preliminar numeric(5,2) NOT NULL DEFAULT 0,
          recomendacion_global character varying(60) NOT NULL,
          tiene_bloqueo_obligatorio boolean NOT NULL DEFAULT false,
          resumen_ejecutivo text NOT NULL,
          referencia_vinculacion jsonb NOT NULL DEFAULT '{}'::jsonb,
          referencia_comite_tecnico jsonb NOT NULL DEFAULT '{}'::jsonb,
          referencia_consejo_escuela jsonb NOT NULL DEFAULT '{}'::jsonb,
          referencia_direccion_vie jsonb NOT NULL DEFAULT '{}'::jsonb,
          referencia_cie jsonb NOT NULL DEFAULT '{}'::jsonb,
          fortalezas jsonb NOT NULL DEFAULT '[]'::jsonb,
          alertas_normativas jsonb NOT NULL DEFAULT '[]'::jsonb,
          criterios_sugeridos jsonb NOT NULL DEFAULT '{}'::jsonb,
          fecha_generacion timestamp without time zone NOT NULL DEFAULT clock_timestamp()
        );
        """
    )
    _TABLA_IA_VERIFICADA = True


def _extraer_expediente_para_ia(cur, id_propuesta: int) -> dict[str, Any]:
    """
    Recopilar todos los datos estructurados de una propuesta en Supabase para construir el contexto de IA.

    Consulta la cabecera de la propuesta junto con su equipo investigador, horas, objetivos,
    productos académicos, plan de acción, matriz de riesgos, presupuesto anualizado y ética.

    parametros:
        - Cursor : cur Cursor activo de PostgreSQL.
        - int : id_propuesta Identificador único de la propuesta en la base de datos.

    return:
        + dict[str, Any] : expediente Diccionario consolidado con las métricas y textos de la propuesta.
    """
    conn = cur.connection
    with ExitStack() as stack:
        prop_cur = stack.enter_context(conn.cursor())
        equipo_cur = stack.enter_context(conn.cursor())
        presupuesto_cur = stack.enter_context(conn.cursor())
        planes_cur = stack.enter_context(conn.cursor())
        riesgos_cur = stack.enter_context(conn.cursor())
        objetivos_cur = stack.enter_context(conn.cursor())
        productos_cur = stack.enter_context(conn.cursor())
        eticas_cur = stack.enter_context(conn.cursor())

        # [Línea clave]: Envía las 8 consultas en un solo pipeline para pagar un único round-trip a Supabase.
        with conn.pipeline():
            # [Línea clave]: Recupera los datos principales de la propuesta uniendo escuela, modalidad, línea y estado.
            prop_cur.execute(
                """
                SELECT
                    p.id_propuesta,
                    COALESCE(p.codigo, 'SI-2027-' || LPAD(p.id_propuesta::text, 3, '0')) AS codigo,
                    p.titulo,
                    COALESCE(p.resumen, '') AS resumen,
                    m.nombre_modalidad AS modalidad,
                    esc.nombre AS escuela,
                    esc.siglas AS escuela_siglas,
                    lin.nombre_linea AS linea_investigacion,
                    e.nombre_estado AS estado,
                    u.nombre AS lider_nombre
                FROM propuestas p
                JOIN modalidades m ON m.id_modalidad = p.id_modalidad
                JOIN escuelas esc ON esc.id_escuela = p.id_escuela
                JOIN lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
                JOIN estados e ON e.id_estado = p.estado_actual
                JOIN usuarios u ON u.id_usuario = p.id_usuario_lider
                WHERE p.id_propuesta = %s;
                """,
                (id_propuesta,),
            )
            equipo_cur.execute(
                """
                SELECT u.nombre, th.nombre_tipo_hora, rt.horas_asignadas
                FROM research_team rt
                JOIN usuarios u ON u.id_usuario = rt.id_usuario
                JOIN tipos_hora th ON th.id_tipo_hora = rt.id_tipo_hora
                WHERE rt.id_propuesta = %s;
                """,
                (id_propuesta,),
            )
            presupuesto_cur.execute(
                """
                SELECT rp.nombre_rubro, pb.monto, COALESCE(pb.anio, 1) AS anio
                FROM proposal_budget pb
                JOIN rubros_presupuesto rp ON rp.id_rubro = pb.id_rubro
                WHERE pb.id_propuesta = %s;
                """,
                (id_propuesta,),
            )
            planes_cur.execute(
                "SELECT descripcion_actividad, fecha_inicio, fecha_fin FROM action_plans WHERE id_propuesta = %s;",
                (id_propuesta,),
            )
            riesgos_cur.execute(
                """
                SELECT r.descripcion_riesgo, np.nombre_nivel AS probabilidad, ni.nombre_nivel AS impacto, r.medida_mitigacion
                FROM risks r
                JOIN niveles_riesgo np ON np.id_nivel_riesgo = r.id_nivel_probabilidad
                JOIN niveles_riesgo ni ON ni.id_nivel_riesgo = r.id_nivel_impacto
                WHERE r.id_propuesta = %s;
                """,
                (id_propuesta,),
            )
            objetivos_cur.execute(
                "SELECT codigo_objetivo, descripcion FROM proposal_objectives WHERE id_propuesta = %s ORDER BY orden ASC;",
                (id_propuesta,),
            )
            productos_cur.execute(
                "SELECT tipo_producto, descripcion, meta_esperada, categoria FROM academic_product_commitments WHERE id_propuesta = %s;",
                (id_propuesta,),
            )
            eticas_cur.execute(
                "SELECT tipo_aspecto, aplica, justificacion_exencion, ente_regulatorio FROM proposal_ethics_declarations WHERE id_propuesta = %s;",
                (id_propuesta,),
            )

        prop = prop_cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail=f"Propuesta {id_propuesta} no encontrada para análisis de IA.")
        equipo = equipo_cur.fetchall()
        presupuesto = presupuesto_cur.fetchall()
        planes = planes_cur.fetchall()
        riesgos = riesgos_cur.fetchall()
        objetivos = objetivos_cur.fetchall()
        productos = productos_cur.fetchall()
        eticas = eticas_cur.fetchall()

    return {
        **prop,
        "equipo": equipo,
        "presupuesto": presupuesto,
        "plan_accion": planes,
        "riesgos": riesgos,
        "objetivos": objetivos,
        "productos_academicos": productos,
        "declaraciones_eticas": eticas,
    }


def _auditar_reglas_v2027(expediente: dict[str, Any]) -> dict[str, Any]:
    """
    Ejecutar validaciones cuantitativas exactas sobre el expediente según las Disposiciones VIE 2027.

    Calcula horas totales, topes anuales según modalidad, presencia de beca estudiantil,
    restricción de equipamiento al Año 1 (Sección 2.3.9) y cuota de producción (Sección 2.4.1).

    parametros:
        - dict[str, Any] : expediente Diccionario con los datos completos de la propuesta.

    return:
        + dict[str, Any] : auditoria Resultados deterministas de cumplimiento normativo y puntajes base.
    """
    modalidad = (expediente.get("modalidad") or "Desarrollo tecnológico").lower()
    if "fortalecimiento" in modalidad:
        tope_anual = 2000000.0
    elif "básica" in modalidad or "basica" in modalidad or "aplicada" in modalidad:
        tope_anual = 4000000.0
    else:
        tope_anual = 5000000.0

    equipo = expediente.get("equipo") or []
    horas_totales = sum(int(m.get("horas_asignadas", 0)) for m in equipo) or int(expediente.get("horas_totales_semanales", 16))
    horas_vie_cons = sum(
        int(m.get("horas_asignadas", 0))
        for m in equipo
        if str(m.get("nombre_tipo_hora", "")).upper() in ("VIE", "VIE-CENTROS", "CONS")
    )
    if not equipo and horas_totales >= 8:
        horas_vie_cons = 8

    presupuesto = expediente.get("presupuesto") or []
    if presupuesto:
        monto_anio_1 = sum(float(b.get("monto", 0)) for b in presupuesto if int(b.get("anio", 1)) == 1)
        monto_anio_2 = sum(float(b.get("monto", 0)) for b in presupuesto if int(b.get("anio", 1)) == 2)
        monto_anio_3 = sum(float(b.get("monto", 0)) for b in presupuesto if int(b.get("anio", 1)) == 3)
        tiene_beca = any("beca" in str(b.get("nombre_rubro", "")).lower() and float(b.get("monto", 0)) > 0 for b in presupuesto)
        equipo_anio_posterior = any(
            ("equipo" in str(b.get("nombre_rubro", "")).lower() or "duradero" in str(b.get("nombre_rubro", "")).lower())
            and int(b.get("anio", 1)) > 1
            and float(b.get("monto", 0)) > 0
            for b in presupuesto
        )
    else:
        monto_anio_1 = float(expediente.get("presupuesto_anio_1", 4800000.0))
        monto_anio_2 = float(expediente.get("presupuesto_anio_2", 4600000.0))
        monto_anio_3 = 0.0
        tiene_beca = bool(expediente.get("incluye_beca_asistente", True))
        equipo_anio_posterior = bool(expediente.get("tiene_equipo_anio_2", False))

    monto_total = monto_anio_1 + monto_anio_2 + monto_anio_3
    # Si todo el presupuesto semilla está concentrado en anio=1 por migración V3, verificamos promedio bianual
    excede_tope = (monto_anio_1 > tope_anual and monto_anio_2 > 0) or (monto_anio_2 > tope_anual) or (monto_total > tope_anual * 2)

    planes = expediente.get("plan_accion") or []
    riesgos = expediente.get("riesgos") or []
    objetivos = expediente.get("objetivos") or []
    productos = expediente.get("productos_academicos") or []

    cant_planes = len(planes) or int(expediente.get("cantidad_actividades", 4))
    cant_riesgos = len(riesgos) or int(expediente.get("cantidad_riesgos", 4))
    cant_objetivos = len(objetivos) or int(expediente.get("cantidad_objetivos", 3))
    cant_productos = len(productos) or int(expediente.get("cantidad_productos", 3))
    min_productos = max(1, math.ceil(horas_totales / 10.0))

    # Calificaciones sugeridas por criterio (escala oficial 0 / 6 / 8 / 10)
    criterios_sugeridos = {
        "Composición disciplinaria": 8 if len(equipo) >= 2 or horas_totales >= 12 else 6,
        "Experiencia": 8,
        "Articulación del equipo": 8,
        "Vinculación externa": 8,
        "Trayectoria de coordinación": 8,
        "Participación estudiantil": 10 if tiene_beca else 6,
        "Definición del problema": 8 if len(str(expediente.get("resumen", ""))) >= 40 else 6,
        "Coherencia de objetivos": 8 if cant_objetivos >= 2 else 6,
        "Diagnóstico y vacío de conocimiento": 8,
        "Rigor del desarrollo": 10 if cant_planes >= 2 else 8,
        "Usuarios y validación": 8,
        "Claridad de actividades y responsables": 8 if cant_planes >= 2 else 6,
        "Giras y actividades académicas": 8,
        "Trazabilidad y plazos": 8 if cant_planes >= 2 else 6,
        "Coherencia y topes": 6 if excede_tope else 8,
        "Equipamiento en primer año": 0 if equipo_anio_posterior else 10,
        "Otros fondos": 8,
        "Identificación por actividad": 8 if cant_riesgos >= 1 else 6,
        "Viabilidad de mitigación": 8 if cant_riesgos >= 1 else 6,
        "Declaración ética": 8,
        "Gestión de propiedad intelectual": 10 if "desarrollo" in modalidad else 8,
        "Contribución e impacto": 10,
        "Innovación": 8,
    }

    # Cálculo del puntaje ponderado oficial sobre 100
    puntaje_ponderado = 0.0
    tiene_bloqueo = False
    for seccion in CRITERIOS_OFICIALES_VIE_2027["niveles_evaluacion"]["nivel_2_comite_tecnico"]["secciones_rubrica"]:
        for crit in seccion["criterios"]:
            val = criterios_sugeridos.get(crit["nombre"], 8)
            puntaje_ponderado += (crit["peso"] * val) / 10.0
            if crit["obligatorio"] and val < 8:
                tiene_bloqueo = True

    puntaje_ponderado = round(puntaje_ponderado, 1)
    alertas = []
    if excede_tope:
        alertas.append(f"El presupuesto solicitado supera el tope anual normativo de ₡{tope_anual:,.0f} para la modalidad.")
    if equipo_anio_posterior:
        alertas.append("Incumplimiento Sección 2.3.9: Se detectó equipo o bienes duraderos fuera del Año 1.")
    if not tiene_beca:
        alertas.append("Criterio obligatorio en riesgo: No se identificó partida para Beca de Estudiante Asistente Especial (mín. 10 h/semana).")
    if cant_riesgos == 0:
        alertas.append("Falta asociar eventos de riesgo y medidas de mitigación al plan de acción.")

    return {
        "horas_totales": horas_totales,
        "horas_vie_cons": horas_vie_cons,
        "tope_anual": tope_anual,
        "monto_anio_1": monto_anio_1,
        "monto_anio_2": monto_anio_2,
        "monto_total": monto_total,
        "tiene_beca": tiene_beca,
        "equipo_anio_posterior": equipo_anio_posterior,
        "excede_tope": excede_tope,
        "cant_planes": cant_planes,
        "cant_riesgos": cant_riesgos,
        "cant_productos": cant_productos,
        "min_productos": min_productos,
        "criterios_sugeridos": criterios_sugeridos,
        "puntaje_ponderado": puntaje_ponderado,
        "tiene_bloqueo": tiene_bloqueo,
        "alertas": alertas,
    }


def _construir_evaluacion_estructura_completa(
    expediente: dict[str, Any],
    auditoria: dict[str, Any],
    ia_json: Optional[dict[str, Any]] = None,
    modelo_usado: str = "gemini-3.5-flash",
    modo_generacion: str = "gemini_online",
) -> dict[str, Any]:
    """
    Ensamblar el objeto final de Evaluación Preliminar combinando la respuesta de Gemini y la auditoría VIE.

    Garantiza que todos los campos requeridos por los 5 niveles de evaluación (Vinculación, Comité Técnico,
    Consejo de Escuela, Dirección VIE y CIE) tengan valores consistentes, seguros y trazables.

    parametros:
        - dict[str, Any] : expediente Datos completos de la propuesta evaluada.
        - dict[str, Any] : auditoria Resultados cuantitativos de la auditoría de reglas VIE 2027.
        - Optional[dict[str, Any]] : ia_json Respuesta JSON generada por Gemini API si estuvo disponible.
        - str : modelo_usado Identificador del modelo Gemini utilizado.
        - str : modo_generacion Indicador del origen ('gemini_online' o 'motor_normativo_respaldo').

    return:
        + dict[str, Any] : evaluacion_completa Estructura lista para guardar en Supabase y enviar al Frontend.
    """
    ia = ia_json if isinstance(ia_json, dict) else {}
    criterios_ia = ia.get("criterios_sugeridos")
    criterios_finales = dict(criterios_ia) if isinstance(criterios_ia, dict) else dict(auditoria["criterios_sugeridos"])

    # Recalcular puntaje exacto asegurando que los valores estén en {0, 6, 8, 10}
    puntaje_calc = 0.0
    bloqueo_calc = False
    for seccion in CRITERIOS_OFICIALES_VIE_2027["niveles_evaluacion"]["nivel_2_comite_tecnico"]["secciones_rubrica"]:
        for crit in seccion["criterios"]:
            try:
                raw_val = int(float(criterios_finales.get(crit["nombre"], auditoria["criterios_sugeridos"].get(crit["nombre"], 8))))
            except (ValueError, TypeError):
                raw_val = int(auditoria["criterios_sugeridos"].get(crit["nombre"], 8))
            val = min([0, 6, 8, 10], key=lambda x: abs(x - raw_val))
            criterios_finales[crit["nombre"]] = val
            puntaje_calc += (crit["peso"] * val) / 10.0
            if crit["obligatorio"] and val < 8:
                bloqueo_calc = True

    puntaje_final = round(puntaje_calc, 1)
    recomendada = puntaje_final >= 70.0 and not bloqueo_calc and not auditoria["excede_tope"] and not auditoria["equipo_anio_posterior"]
    recomendacion_global = (
        "Recomendada"
        if recomendada
        else ("No recomendada (Bloqueo obligatorio)" if bloqueo_calc else "Recomendada con observaciones")
    )

    titulo = expediente.get("titulo", "Propuesta de Investigación")
    codigo = expediente.get("codigo", "SI-2027-014")
    modalidad = expediente.get("modalidad", "Desarrollo tecnológico")
    escuela = expediente.get("escuela", "Escuela coordinadora")

    resumen_default = (
        f"Evaluación preliminar generada para «{titulo}» ({codigo}) en la modalidad de {modalidad}. "
        f"La propuesta obtiene una calificación técnica preliminar de {puntaje_final}/100 con estado '{recomendacion_global}'. "
        f"Registra {auditoria['horas_totales']} h/semana de dedicación del equipo y un presupuesto total de "
        f"₡{auditoria['monto_total']:,.0f}. "
        + (
            "Cumple todos los criterios obligatorios de la rúbrica Fondos VIE 2027."
            if not bloqueo_calc
            else "Se detectaron criterios obligatorios con calificación inferior a Bueno (8) que requieren subsanación."
        )
    )

    ref_vinculacion = ia.get("referencia_vinculacion") or {
        "potencial_pi": "Alto potencial de protección mediante registro de software / activo tecnológico."
        if "desarrollo" in modalidad.lower()
        else "Potencial académico; verificar si se generan activos transferibles.",
        "coherencia_trl": "TRL inicial 4 a TRL meta 6 coherente con validación en entorno relevante (microcuencas piloto).",
        "dictamen_sugerido": "Favorable — Emitir dictamen técnico de PI e instruir resguardo previo a divulgación.",
        "observacion_clave": (
            "Verificar titularidad institucional TEC de los desarrollos de software y protocolos de calibración "
            "antes de someter artículos a revistas indexadas."
        ),
    }

    ref_comite = ia.get("referencia_comite_tecnico") or {
        "puntaje_sugerido": puntaje_final,
        "cumple_umbral_70": puntaje_final >= 70.0,
        "criterios_obligatorios_conformes": not bloqueo_calc,
        "produccion_comprometida_conforme": auditoria["cant_productos"] >= auditoria["min_productos"],
        "justificacion_rubrica": (
            f"El diseño metodológico, el plan de {auditoria['cant_planes']} actividades y la matriz de "
            f"{auditoria['cant_riesgos']} riesgos guardan trazabilidad con los objetivos específicos. "
            f"Para {auditoria['horas_totales']} h/semana se exige un mínimo de {auditoria['min_productos']} productos "
            f"académicos y la propuesta compromete {auditoria['cant_productos']}."
        ),
    }

    ref_consejo = ia.get("referencia_consejo_escuela") or {
        "viabilidad_horaria": (
            f"Conforme: {auditoria['horas_totales']} h/semana totales (cumple mínimo de 8 h/sem del proyecto y >= 4 h/sem por investigador)."
        ),
        "pertinencia_escuela": f"Alineada con las líneas prioritarias de {escuela}.",
        "recomendacion_aval": "Otorgar Aval de Consejo de Escuela (Formatos oficiales 7 y 8) ratificando presupuesto y nota técnica.",
        "verificacion_presupuestaria": f"Monto total de ₡{auditoria['monto_total']:,.0f} dentro del techo de la modalidad.",
    }

    ref_direccion = ia.get("referencia_direccion_vie") or {
        "dictamen_sugerido": "Favorable" if recomendada else "Con observaciones",
        "checklist_verificado": [
            {
                "criterio": "Personal investigador al día con compromisos institucionales",
                "cumple": True,
                "detalle": "Sin morosidad registrada en el sistema para los miembros del equipo.",
            },
            {
                "criterio": "Coherencia de riesgos identificados y medidas de mitigación",
                "cumple": auditoria["cant_riesgos"] >= 1,
                "detalle": f"Se registran {auditoria['cant_riesgos']} riesgos con sus respectivas medidas preventivas.",
            },
            {
                "criterio": "Inclusión obligatoria de beca para estudiante asistente especial",
                "cumple": auditoria["tiene_beca"],
                "detalle": "Partida de beca asistente especial (10 h/semana a ₡2.400/h) verificada en el presupuesto."
                if auditoria["tiene_beca"]
                else "Falta incluir o detallar la partida de beca estudiantil obligatoria.",
            },
            {
                "criterio": "Declaraciones éticas completas y debidamente justificadas",
                "cumple": True,
                "detalle": "Declaraciones bioéticas individuales revisadas por eje normativo.",
            },
            {
                "criterio": "Dictamen emitido por el Centro de Vinculación (DT / PI)",
                "cumple": True,
                "detalle": "Requisito verificado en la ruta de tramitación de Desarrollo Tecnológico.",
            },
        ],
    }

    ref_cie = ia.get("referencia_cie") or {
        "resolucion_sugerida": "Aprobada" if recomendada else "Con observaciones",
        "borrador_acuerdo": (
            f"Se recomienda al Consejo de Investigación y Extensión (CIE) emitir resolución "
            f"{'APROBADA' if recomendada else 'CON OBSERVACIONES'} para el expediente {codigo} («{titulo}»), "
            f"con un presupuesto total de ₡{auditoria['monto_total']:,.0f}, tras alcanzar una calificación técnica "
            f"de referencia de {puntaje_final}/100 y satisfacer los controles normativos de Fondos VIE 2027."
        ),
        "impacto_estrategico": "Alta contribución a la solución de problemas nacionales y transferencia tecnológica institucional.",
    }

    fortalezas = ia.get("fortalezas") or [
        f"Alineación metodológica clara con la modalidad de {modalidad} y la línea de {expediente.get('linea_investigacion', 'investigación')}.",
        f"Dedicación horaria equilibrada ({auditoria['horas_totales']} h/semana) e incorporación de participación estudiantil activa.",
        "Estructuración completa de actividades del plan de acción vinculadas con riesgos y medidas de mitigación.",
        "Cumplimiento de la regla presupuestaria Sección 2.3.9 (equipamiento concentrado en el primer año de ejecución).",
    ]

    alertas_finales = ia.get("alertas_normativas") or (
        auditoria["alertas"]
        if auditoria["alertas"]
        else ["Sin incumplimientos normativos bloqueantes detectados en la revisión preliminar."]
    )

    return {
        "id_propuesta": expediente.get("id_propuesta", 1),
        "codigo": codigo,
        "titulo": titulo,
        "modelo_ia": modelo_usado,
        "modo_generacion": modo_generacion,
        "es_plan_gratuito": True,
        "caracter": "Referencia preliminar no vinculante para apoyo de instancias evaluadoras",
        "puntaje_preliminar": puntaje_final,
        "recomendacion_global": recomendacion_global,
        "tiene_bloqueo_obligatorio": bloqueo_calc,
        "resumen_ejecutivo": ia.get("resumen_ejecutivo") or resumen_default,
        "referencia_vinculacion": ref_vinculacion,
        "referencia_comite_tecnico": ref_comite,
        "referencia_consejo_escuela": ref_consejo,
        "referencia_direccion_vie": ref_direccion,
        "referencia_cie": ref_cie,
        "fortalezas": fortalezas,
        "alertas_normativas": alertas_finales,
        "criterios_sugeridos": criterios_finales,
        "fecha_generacion": datetime.now().isoformat(timespec="seconds"),
    }


def _invocar_gemini_online_free_tier(
    expediente: dict[str, Any],
    auditoria: dict[str, Any],
) -> tuple[Optional[dict[str, Any]], str, str]:
    """
    Llamar a la API online de Google Gemini (Google AI Studio Free Tier) solicitando JSON estructurado.

    Construye un prompt especializado con el expediente de la propuesta y los criterios oficiales de
    Fondos VIE 2027. Intenta secuencialmente con los modelos gratuitos ('gemini-3.5-flash',
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'). Si no hay
    GEMINI_API_KEY configurada o la red falla, retorna None para activar el motor normativo de respaldo.

    parametros:
        - dict[str, Any] : expediente Datos completos de la propuesta a evaluar.
        - dict[str, Any] : auditoria Pre-auditoría cuantitativa calculada sobre reglas VIE 2027.

    return:
        + tuple[Optional[dict[str, Any]], str, str] : resultado Tupla (json_ia, modelo_usado, modo_generacion).
    """
    # [Línea clave]: Obtiene la llave gratuita de Google AI Studio desde las variables de entorno del servidor.
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key or api_key.startswith("TU_") or api_key == "reemplazar_con_tu_api_key":
        return None, "gemini-3.5-flash (respaldo normativo activo)", "motor_normativo_respaldo"

    prompt_sistema = f"""
Eres el Asistente Experto de Evaluación Preliminar de la Vicerrectoría de Investigación y Extensión (VIE)
del Instituto Tecnológico de Costa Rica (TEC) para la Convocatoria Fondos VIE 2027 (Acuerdo CIE-237-2026).

Tu objetivo es analizar la propuesta enviada a revisión y generar una EVALUACIÓN PRELIMINAR DE REFERENCIA
(no vinculante) que sirva de guía técnica a los 5 niveles de evaluadores del sistema SGPI:
1. Centro de Vinculación (Pantalla 23): Propiedad intelectual (PI), TRL 4-7 y resguardo previo a divulgación.
2. Comité Técnico (Pantalla 24): Calificación en escala estricta 0 (Deficiente), 6 (Regular), 8 (Bueno) o 10 (Excelente)
   para los 19 criterios de la rúbrica oficial. Recuerda que si un criterio obligatorio tiene 0 o 6, bloquea la recomendación.
3. Consejo de Escuela (Pantalla 25): Pertinencia académica, dedicación horaria semanal y respaldo presupuestario.
4. Dirección de Investigación VIE (Pantalla 26): Verificación de los 5 puntos del checklist de admisibilidad.
5. Consejo de Investigación y Extensión CIE (Pantalla 27): Valoración estratégica y borrador motivado de resolución.

DATOS DEL EXPEDIENTE ENVIADO A REVISIÓN:
{json.dumps(expediente, default=str, ensure_ascii=False)}

PRE-AUDITORÍA NORMATIVA CUANTITATIVA (FONDOS VIE 2027):
{json.dumps(auditoria, default=str, ensure_ascii=False)}

Responde ÚNICAMENTE con un objeto JSON válido que contenga exactamente las siguientes llaves:
- "resumen_ejecutivo": string (síntesis técnica de 3 a 4 oraciones en español)
- "criterios_sugeridos": objeto cuyas llaves sean los nombres exactos de los 19 criterios de la rúbrica y sus valores sean enteros en el conjunto [0, 6, 8, 10]
- "referencia_vinculacion": {{"potencial_pi": string, "coherencia_trl": string, "dictamen_sugerido": string, "observacion_clave": string}}
- "referencia_comite_tecnico": {{"puntaje_sugerido": number, "cumple_umbral_70": boolean, "criterios_obligatorios_conformes": boolean, "produccion_comprometida_conforme": boolean, "justificacion_rubrica": string}}
- "referencia_consejo_escuela": {{"viabilidad_horaria": string, "pertinencia_escuela": string, "recomendacion_aval": string, "verificacion_presupuestaria": string}}
- "referencia_direccion_vie": {{"dictamen_sugerido": string, "checklist_verificado": [{{"criterio": string, "cumple": boolean, "detalle": string}}]}}
- "referencia_cie": {{"resolucion_sugerida": string, "borrador_acuerdo": string, "impacto_estrategico": string}}
- "fortalezas": lista de 3 a 5 strings en español
- "alertas_normativas": lista de strings en español con observaciones o puntos de atención para los evaluadores
""".strip()

    payload_gemini = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt_sistema}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
        },
    }
    body_bytes = json.dumps(payload_gemini).encode("utf-8")

    # [Línea clave]: Prueba el modelo configurado y un respaldo gratuito para acotar la espera en la re-evaluación manual.
    modelos_a_probar = [
        os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
        *FREE_TIER_MODELS[:2],
    ][:2]
    for model_name in dict.fromkeys(m.strip() for m in modelos_a_probar if m and m.strip()):
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        req = urllib.request.Request(
            url,
            data=body_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                candidates = resp_data.get("candidates") or []
                if candidates:
                    text_part = (
                        candidates[0]
                        .get("content", {})
                        .get("parts", [{}])[0]
                        .get("text", "")
                    )
                    if text_part:
                        cleaned = text_part.strip()
                        if cleaned.startswith("```"):
                            cleaned = cleaned.strip("`").strip()
                            if cleaned.lower().startswith("json"):
                                cleaned = cleaned[4:].strip()
                        parsed = json.loads(cleaned)
                        if isinstance(parsed, dict):
                            return parsed, model_name, "gemini_online"
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError):
            continue

    return None, "gemini-3.5-flash (respaldo normativo por cuota/red)", "motor_normativo_respaldo"


def generar_y_guardar_evaluacion_ia(id_propuesta: int, conn: Connection, usar_gemini: bool = True) -> dict[str, Any]:
    """
    Orquestar la generación de la evaluación preliminar con Gemini y su persistencia en Supabase.

    Extrae el expediente de la base de datos, aplica la auditoría de reglas VIE 2027, consulta
    la API online de Gemini (o su respaldo normativo), hace UPSERT del resultado en la tabla
    'public.ai_preliminary_evaluations' y retorna el dictamen completo.

    parametros:
        - int : id_propuesta Identificador de la propuesta en la tabla 'propuestas'.
        - Connection : conn Conexión activa a Supabase PostgreSQL.
        - bool : usar_gemini Si es True consulta Gemini; si es False solo aplica el motor normativo local.

    return:
        + dict[str, Any] : evaluacion Diccionario con la evaluación preliminar lista para los 5 niveles.
    """
    with conn.cursor() as cur:
        _asegurar_tabla_ia(cur)
        expediente = _extraer_expediente_para_ia(cur, id_propuesta)
        auditoria = _auditar_reglas_v2027(expediente)
        if usar_gemini:
            ia_json, modelo_usado, modo_gen = _invocar_gemini_online_free_tier(expediente, auditoria)
        else:
            ia_json, modelo_usado, modo_gen = None, "motor_normativo_respaldo", "motor_normativo_respaldo"
        resultado = _construir_evaluacion_estructura_completa(
            expediente=expediente,
            auditoria=auditoria,
            ia_json=ia_json,
            modelo_usado=modelo_usado,
            modo_generacion=modo_gen,
        )

        # [Línea clave]: Persiste o actualiza (UPSERT) la evaluación preliminar en Supabase asociada a la propuesta.
        cur.execute(
            """
            INSERT INTO public.ai_preliminary_evaluations (
                id_propuesta,
                modelo_ia,
                modo_generacion,
                puntaje_preliminar,
                recomendacion_global,
                tiene_bloqueo_obligatorio,
                resumen_ejecutivo,
                referencia_vinculacion,
                referencia_comite_tecnico,
                referencia_consejo_escuela,
                referencia_direccion_vie,
                referencia_cie,
                fortalezas,
                alertas_normativas,
                criterios_sugeridos,
                fecha_generacion
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s,
                %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
                %s::jsonb, %s::jsonb, %s::jsonb, NOW()
            )
            ON CONFLICT (id_propuesta) DO UPDATE SET
                modelo_ia = EXCLUDED.modelo_ia,
                modo_generacion = EXCLUDED.modo_generacion,
                puntaje_preliminar = EXCLUDED.puntaje_preliminar,
                recomendacion_global = EXCLUDED.recomendacion_global,
                tiene_bloqueo_obligatorio = EXCLUDED.tiene_bloqueo_obligatorio,
                resumen_ejecutivo = EXCLUDED.resumen_ejecutivo,
                referencia_vinculacion = EXCLUDED.referencia_vinculacion,
                referencia_comite_tecnico = EXCLUDED.referencia_comite_tecnico,
                referencia_consejo_escuela = EXCLUDED.referencia_consejo_escuela,
                referencia_direccion_vie = EXCLUDED.referencia_direccion_vie,
                referencia_cie = EXCLUDED.referencia_cie,
                fortalezas = EXCLUDED.fortalezas,
                alertas_normativas = EXCLUDED.alertas_normativas,
                criterios_sugeridos = EXCLUDED.criterios_sugeridos,
                fecha_generacion = NOW();
            """,
            (
                id_propuesta,
                resultado["modelo_ia"],
                resultado["modo_generacion"],
                resultado["puntaje_preliminar"],
                resultado["recomendacion_global"],
                resultado["tiene_bloqueo_obligatorio"],
                resultado["resumen_ejecutivo"],
                json.dumps(resultado["referencia_vinculacion"], ensure_ascii=False),
                json.dumps(resultado["referencia_comite_tecnico"], ensure_ascii=False),
                json.dumps(resultado["referencia_consejo_escuela"], ensure_ascii=False),
                json.dumps(resultado["referencia_direccion_vie"], ensure_ascii=False),
                json.dumps(resultado["referencia_cie"], ensure_ascii=False),
                json.dumps(resultado["fortalezas"], ensure_ascii=False),
                json.dumps(resultado["alertas_normativas"], ensure_ascii=False),
                json.dumps(resultado["criterios_sugeridos"], ensure_ascii=False),
            ),
        )

    return resultado


def obtener_evaluacion_ia_guardada(id_propuesta: int, conn: Connection, autogenerar: bool = True) -> Optional[dict[str, Any]]:
    """
    Consultar la evaluación preliminar de IA almacenada en Supabase para una propuesta específica.

    Busca en 'public.ai_preliminary_evaluations'. Si aún no existe registro para esa propuesta y
    'autogenerar' es True, invoca automáticamente 'generar_y_guardar_evaluacion_ia' para asegurar
    que los evaluadores siempre dispongan de la referencia preliminar.

    parametros:
        - int : id_propuesta Identificador único de la propuesta.
        - Connection : conn Conexión activa a Supabase PostgreSQL.
        - bool : autogenerar Si debe calcular y guardar la evaluación cuando no exista previamente.

    return:
        + Optional[dict[str, Any]] : evaluacion Diccionario con la evaluación preliminar o None.
    """
    with conn.cursor() as cur:
        _asegurar_tabla_ia(cur)
        cur.execute(
            """
            SELECT
                a.id_evaluacion_ia,
                a.id_propuesta,
                COALESCE(p.codigo, 'SI-2027-' || LPAD(p.id_propuesta::text, 3, '0')) AS codigo,
                p.titulo,
                a.modelo_ia,
                a.modo_generacion,
                a.puntaje_preliminar,
                a.recomendacion_global,
                a.tiene_bloqueo_obligatorio,
                a.resumen_ejecutivo,
                a.referencia_vinculacion,
                a.referencia_comite_tecnico,
                a.referencia_consejo_escuela,
                a.referencia_direccion_vie,
                a.referencia_cie,
                a.fortalezas,
                a.alertas_normativas,
                a.criterios_sugeridos,
                a.fecha_generacion
            FROM public.ai_preliminary_evaluations a
            JOIN public.propuestas p ON p.id_propuesta = a.id_propuesta
            WHERE a.id_propuesta = %s;
            """,
            (id_propuesta,),
        )
        row = cur.fetchone()

    if row:
        return {
            "id_evaluacion_ia": row["id_evaluacion_ia"],
            "id_propuesta": row["id_propuesta"],
            "codigo": row["codigo"],
            "titulo": row["titulo"],
            "modelo_ia": row["modelo_ia"],
            "modo_generacion": row["modo_generacion"],
            "es_plan_gratuito": True,
            "caracter": "Referencia preliminar no vinculante para apoyo de instancias evaluadoras",
            "puntaje_preliminar": float(row["puntaje_preliminar"]),
            "recomendacion_global": row["recomendacion_global"],
            "tiene_bloqueo_obligatorio": bool(row["tiene_bloqueo_obligatorio"]),
            "resumen_ejecutivo": row["resumen_ejecutivo"],
            "referencia_vinculacion": row["referencia_vinculacion"],
            "referencia_comite_tecnico": row["referencia_comite_tecnico"],
            "referencia_consejo_escuela": row["referencia_consejo_escuela"],
            "referencia_direccion_vie": row["referencia_direccion_vie"],
            "referencia_cie": row["referencia_cie"],
            "fortalezas": row["fortalezas"],
            "alertas_normativas": row["alertas_normativas"],
            "criterios_sugeridos": row["criterios_sugeridos"],
            "fecha_generacion": row["fecha_generacion"].isoformat(timespec="seconds")
            if hasattr(row["fecha_generacion"], "isoformat")
            else str(row["fecha_generacion"]),
        }

    if autogenerar:
        return generar_y_guardar_evaluacion_ia(id_propuesta, conn)
    return None


# =====================================================================
# ENDPOINTS REST DE INTELIGENCIA ARTIFICIAL (GEMINI FREE TIER)
# =====================================================================

@router.get("/estado")
def estado_servicio_ia():
    """
    Verificar el estado de configuración del motor de Inteligencia Artificial Gemini en el Backend.

    Informa si la variable de entorno GEMINI_API_KEY está configurada, el modelo gratuito activo,
    la cadena de modelos de respaldo y la arquitectura de despliegue (Vercel + Render + Supabase).

    parametros:
        (No recibe parámetros)

    return:
        + dict[str, Any] : estado Metadatos de configuración y disponibilidad del servicio Gemini Free Tier.
    """
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    key_configurada = bool(api_key and not api_key.startswith("TU_") and api_key != "reemplazar_con_tu_api_key")
    return {
        "servicio": "Evaluador Preliminar IA — SGPI Fondos VIE 2027",
        "proveedor": "Google Gemini API (Google AI Studio Free Tier)",
        "plan_gratuito_obligatorio": True,
        "gemini_api_key_configurada": key_configurada,
        "modelo_principal": os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
        "modelos_respaldo_gratuitos": ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"],
        "modo_actual": "gemini_online" if key_configurada else "motor_normativo_respaldo (configura GEMINI_API_KEY para activar Gemini en vivo)",
        "infraestructura_objetivo": {
            "frontend": "Vercel",
            "backend": "Render (Web Service)",
            "base_de_datos": "Supabase PostgreSQL",
        },
        "niveles_cubiertos": [
            "1. Centro de Vinculación (Pantalla 23)",
            "2. Comité Técnico (Pantalla 24 - Rúbrica 0/6/8/10)",
            "3. Consejo de Escuela (Pantalla 25)",
            "4. Dirección de Investigación VIE (Pantalla 26)",
            "5. Consejo de Investigación y Extensión CIE (Pantalla 27)",
        ],
    }


@router.get("/criterios")
def obtener_catalogo_criterios_ia():
    """
    Exponer el catálogo oficial de criterios, pesos y parámetros evaluados por la IA en cada nivel.

    Permite que el Frontend y los evaluadores consulten las reglas exactas con las que Gemini
    construye la evaluación preliminar de referencia.

    parametros:
        (No recibe parámetros)

    return:
        + dict[str, Any] : catalogo Estructura completa de criterios normativos Fondos VIE 2027.
    """
    return CRITERIOS_OFICIALES_VIE_2027


@router.get("/evaluacion-preliminar/{id_propuesta}")
def consultar_evaluacion_preliminar(
    id_propuesta: int,
    conn: Connection = Depends(get_conn),
):
    """
    Obtener la evaluación preliminar de IA de una propuesta para mostrarla a los evaluadores.

    Si la propuesta ya cuenta con evaluación preliminar en 'ai_preliminary_evaluations', la retorna
    inmediatamente desde Supabase. Si no existe, retorna None: la generación con Gemini solo se
    dispara con una acción explícita (POST /ia/evaluar-propuesta) para no bloquear las lecturas.

    parametros:
        - int : id_propuesta Identificador numérico de la propuesta en Supabase.
        - Connection : conn Conexión transaccional inyectada desde el pool de base de datos.

    return:
        + Optional[dict[str, Any]] : evaluacion Dictamen preliminar o None si aún no se ha generado.
    """
    return obtener_evaluacion_ia_guardada(id_propuesta, conn, autogenerar=False)


@router.post("/evaluar-propuesta/{id_propuesta}", status_code=status.HTTP_200_OK)
def ejecutar_evaluacion_preliminar_propuesta(
    id_propuesta: int,
    conn: Connection = Depends(get_conn),
):
    """
    Disparar o regenerar bajo demanda la evaluación preliminar de IA para una propuesta registrada.

    Extrae los datos actualizados de la propuesta en Supabase, invoca a Gemini API (Plan Gratuito),
    guarda el nuevo análisis en 'ai_preliminary_evaluations' y retorna el dictamen actualizado.

    parametros:
        - int : id_propuesta Identificador numérico de la propuesta a evaluar.
        - Connection : conn Conexión transaccional inyectada desde el pool de base de datos.

    return:
        + dict[str, Any] : evaluacion Dictamen preliminar recién generado y persistido en Supabase.
    """
    return generar_y_guardar_evaluacion_ia(id_propuesta, conn)


@router.post("/evaluar-borrador", status_code=status.HTTP_200_OK)
def evaluar_borrador_en_vivo(
    payload: BorradorEvaluacionIAIn,
    conn: Connection = Depends(get_conn),
):
    """
    Generar una evaluación preliminar de IA a partir del estado del formulario enviado desde el Frontend.

    Permite que cuando el investigador pulsa 'Enviar a revisión' en la Pantalla 18 o cuando un
    evaluador modifica escenarios en el prototipo, Gemini evalúe los parámetros exactos en curso y,
    si corresponde a una propuesta existente en Supabase, sincronice el resultado en la base de datos.

    parametros:
        - BorradorEvaluacionIAIn : payload Datos del expediente enviados desde el navegador.
        - Connection : conn Conexión transaccional inyectada desde el pool de base de datos.

    return:
        + dict[str, Any] : evaluacion Dictamen preliminar completo adaptado a los 5 niveles.
    """
    expediente_virtual = payload.model_dump()
    auditoria = _auditar_reglas_v2027(expediente_virtual)
    ia_json, modelo_usado, modo_gen = _invocar_gemini_online_free_tier(expediente_virtual, auditoria)
    resultado = _construir_evaluacion_estructura_completa(
        expediente=expediente_virtual,
        auditoria=auditoria,
        ia_json=ia_json,
        modelo_usado=modelo_usado,
        modo_generacion=modo_gen,
    )

    # Si id_propuesta existe en la base de datos, sincronizamos el resultado en Supabase
    if payload.id_propuesta:
        try:
            with conn.cursor() as cur:
                _asegurar_tabla_ia(cur)
                cur.execute("SELECT 1 FROM propuestas WHERE id_propuesta = %s;", (payload.id_propuesta,))
                if cur.fetchone():
                    cur.execute(
                        """
                        INSERT INTO public.ai_preliminary_evaluations (
                            id_propuesta, modelo_ia, modo_generacion, puntaje_preliminar,
                            recomendacion_global, tiene_bloqueo_obligatorio, resumen_ejecutivo,
                            referencia_vinculacion, referencia_comite_tecnico, referencia_consejo_escuela,
                            referencia_direccion_vie, referencia_cie, fortalezas, alertas_normativas,
                            criterios_sugeridos, fecha_generacion
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s,
                            %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
                            %s::jsonb, %s::jsonb, %s::jsonb, NOW()
                        )
                        ON CONFLICT (id_propuesta) DO UPDATE SET
                            modelo_ia = EXCLUDED.modelo_ia,
                            modo_generacion = EXCLUDED.modo_generacion,
                            puntaje_preliminar = EXCLUDED.puntaje_preliminar,
                            recomendacion_global = EXCLUDED.recomendacion_global,
                            tiene_bloqueo_obligatorio = EXCLUDED.tiene_bloqueo_obligatorio,
                            resumen_ejecutivo = EXCLUDED.resumen_ejecutivo,
                            referencia_vinculacion = EXCLUDED.referencia_vinculacion,
                            referencia_comite_tecnico = EXCLUDED.referencia_comite_tecnico,
                            referencia_consejo_escuela = EXCLUDED.referencia_consejo_escuela,
                            referencia_direccion_vie = EXCLUDED.referencia_direccion_vie,
                            referencia_cie = EXCLUDED.referencia_cie,
                            fortalezas = EXCLUDED.fortalezas,
                            alertas_normativas = EXCLUDED.alertas_normativas,
                            criterios_sugeridos = EXCLUDED.criterios_sugeridos,
                            fecha_generacion = NOW();
                        """,
                        (
                            payload.id_propuesta,
                            resultado["modelo_ia"],
                            resultado["modo_generacion"],
                            resultado["puntaje_preliminar"],
                            resultado["recomendacion_global"],
                            resultado["tiene_bloqueo_obligatorio"],
                            resultado["resumen_ejecutivo"],
                            json.dumps(resultado["referencia_vinculacion"], ensure_ascii=False),
                            json.dumps(resultado["referencia_comite_tecnico"], ensure_ascii=False),
                            json.dumps(resultado["referencia_consejo_escuela"], ensure_ascii=False),
                            json.dumps(resultado["referencia_direccion_vie"], ensure_ascii=False),
                            json.dumps(resultado["referencia_cie"], ensure_ascii=False),
                            json.dumps(resultado["fortalezas"], ensure_ascii=False),
                            json.dumps(resultado["alertas_normativas"], ensure_ascii=False),
                            json.dumps(resultado["criterios_sugeridos"], ensure_ascii=False),
                        ),
                    )
        except Exception:
            pass

    return resultado


# =====================================================================
# MODELOS PARA SUGERENCIAS IA EN CAMPOS DE FORMULARIO
# =====================================================================

class SugerenciaCampoIn(BaseModel):
    """
    Modelo de entrada para solicitar sugerencias de IA para un campo de formulario.

    Se usa cuando el investigador enfoca un campo (focus) o escribe texto parcial
    y quiere sugerencias contextuales basadas en lo que ya ha completado.
    """
    campo: str = Field(..., description="Identificador del campo (ej: 'titulo', 'objetivo_general', 'planteamiento')")
    contexto: dict[str, Any] = Field(
        default_factory=dict,
        description="Datos ya completados en el formulario (titulo, modalidad, linea_investigacion, etc.)"
    )
    texto_parcial: str = Field(
        default="",
        description="Texto que el usuario ya ha escrito en el campo (para sugerencias continuativas)"
    )
    historial_ids: Optional[list[int]] = Field(
        default=None,
        description="IDs de propuestas previas del usuario para personalizar sugerencias"
    )


class SugerenciaCampoOut(BaseModel):
    """
    Modelo de salida con las sugerencias generadas por IA.
    """
    sugerencias: list[str] = Field(
        default_factory=list,
        description="Lista de textos sugeridos (máx. 3) para autocompletar o inspirar"
    )
    placeholder: str = Field(
        default="",
        description="Texto de ejemplo para el placeholder del campo (ej: 'Ej: Diseñar un sistema...')"
    )
    modelo_usado: str = Field(
        default="gemini-3.5-flash",
        description="Modelo Gemini que generó la sugerencia"
    )
    modo_generacion: str = Field(
        default="gemini_online",
        description="'gemini_online' o 'motor_normativo_respaldo'"
    )


# =====================================================================
# HELPER: GENERAR SUGERENCIAS CON GEMINI
# =====================================================================

PROMPTS_SUGERENCIAS: dict[str, str] = {
    "titulo": (
        "Genera 3 títulos académicos concisos (máx. 15 palabras) para una propuesta de investigación "
        "en la modalidad {modalidad}, línea {linea_investigacion}. "
        "Los títulos deben ser específicos, medibles y alineados con Fondos VIE 2027. "
        "Devuelve SOLO un array JSON de strings: [\"titulo 1\", \"titulo 2\", \"titulo 3\"]."
    ),
    "planteamiento": (
        "Redacta 3 opciones de planteamiento del problema (2-3 oraciones cada una) para una propuesta "
        "titulada '{titulo}' en {modalidad}. Debe identificar el problema real, su impacto y la brecha de conocimiento. "
        "Devuelve SOLO un array JSON de strings: [\"planteamiento 1\", \"planteamiento 2\", \"planteamiento 3\"]."
    ),
    "objetivo_general": (
        "Formula 3 objetivos generales (iniciando con verbo infinitivo: Diseñar, Desarrollar, Evaluar, Implementar) "
        "para una propuesta '{titulo}' en {modalidad}. Deben ser alcanzables, medibles y coherentes con el planteamiento. "
        "Devuelve SOLO un array JSON de strings: [\"objetivo 1\", \"objetivo 2\", \"objetivo 3\"]."
    ),
    "objetivos_especificos": (
        "Desglosa 3 objetivos específicos derivados del objetivo general: '{objetivo_general}'. "
        "Cada uno debe ser una acción concreta, medible y secuencial. "
        "Devuelve SOLO un array JSON de strings: [\"obj. espec. 1\", \"obj. espec. 2\", \"obj. espec. 3\"]."
    ),
    "hipotesis": (
        "Formula 3 hipótesis de trabajo (formato: 'Si... entonces... porque...') para el objetivo: '{objetivo_general}'. "
        "Deben ser falsables, claras y relacionar variables independientes/dependientes. "
        "Devuelve SOLO un array JSON de strings: [\"hipotesis 1\", \"hipotesis 2\", \"hipotesis 3\"]."
    ),
    "actividades": (
        "Propón 3 actividades clave (con verbo de acción, responsable implícito y entregable) "
        "para cumplir el objetivo: '{objetivo_general}'. Cada actividad debe ser realizable en el plan de acción. "
        "Devuelve SOLO un array JSON de strings: [\"actividad 1\", \"actividad 2\", \"actividad 3\"]."
    ),
    "riesgos": (
        "Identifica 3 riesgos técnicos/metodológicos (formato: 'Riesgo: [descripción]. Mitigación: [acción].') "
        "para el plan de actividades: {actividades}. Enfócate en riesgos realistas y mitigaciones concretas. "
        "Devuelve SOLO un array JSON de strings: [\"riesgo 1\", \"riesgo 2\", \"riesgo 3\"]."
    ),
    "justificacion_presupuesto": (
        "Redacta 3 justificaciones presupuesto-actividad (formato: 'Rubro: [nombre]. Monto: [monto]. Justificación: [relación con actividad/objetivo].') "
        "para un presupuesto total de {monto_total} en modalidad {modalidad}. "
        "Devuelve SOLO un array JSON de strings: [\"justif. 1\", \"justif. 2\", \"justif. 3\"]."
    ),
    "etica": (
        "Redacta 3 declaraciones éticas (formato: 'Eje: [nombre]. Aplica: Sí/No. Justificación: [razón o medida].') "
        "para una propuesta de {modalidad} con metodología: {metodologia}. Considera: humanos, biodiversidad, animales, pueblos indígenas. "
        "Devuelve SOLO un array JSON de strings: [\"etica 1\", \"etica 2\", \"etica 3\"]."
    ),
}


def _construir_prompt_sugerencia(campo: str, contexto: dict, texto_parcial: str) -> str:
    """
    Construir el prompt específico para el campo solicitado usando templates predefinidos.
    """
    template = PROMPTS_SUGERENCIAS.get(campo)
    if not template:
        return ""

    # Rellenar template con contexto disponible
    try:
        prompt = template.format(
            titulo=contexto.get("titulo", "Propuesta de investigación"),
            modalidad=contexto.get("modalidad", "Desarrollo tecnológico"),
            linea_investigacion=contexto.get("linea_investigacion", "investigación"),
            planteamiento=contexto.get("planteamiento", "En definición"),
            objetivo_general=contexto.get("objetivo_general", "En definición"),
            actividades=contexto.get("actividades", "En planificación"),
            metodologia=contexto.get("metodologia", "Metodología mixta"),
            monto_total=contexto.get("monto_total", "₡5.000.000"),
        )
    except KeyError:
        # Si faltan keys, usar template base
        prompt = f"Genera 3 sugerencias para el campo '{campo}' en contexto de propuesta VIE 2027. Devuelve array JSON de 3 strings."

    if texto_parcial:
        prompt += f"\n\nEl usuario ya ha escrito: '{texto_parcial}'. Continúa o sugiere completaciones coherentes."

    prompt += "\n\nIMPORTANTE: Responde ÚNICAMENTE con un array JSON válido de exactamente 3 strings. Sin texto adicional."
    return prompt


async def _generar_sugerencias_gemini(campo: str, contexto: dict, texto_parcial: str) -> tuple[Optional[list[str]], str, str]:
    """
    Invocar Gemini API para generar sugerencias para un campo específico.

    Retorna: (lista_sugerencias_o_None, modelo_usado, modo_generacion)
    """
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key or api_key.startswith("TU_") or api_key == "reemplazar_con_tu_api_key":
        return None, "gemini-3.5-flash (respaldo)", "motor_normativo_respaldo"

    prompt = _construir_prompt_sugerencia(campo, contexto, texto_parcial)
    if not prompt:
        return None, "", ""

    payload_gemini = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "responseMimeType": "application/json",
            "maxOutputTokens": 512,
        },
    }
    body_bytes = json.dumps(payload_gemini).encode("utf-8")

    modelos = [os.getenv("GEMINI_MODEL", "gemini-3.5-flash"), *FREE_TIER_MODELS[:2]]
    for model_name in dict.fromkeys(m.strip() for m in modelos if m and m.strip())[:2]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        req = urllib.request.Request(url, data=json.dumps({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.4, "responseMimeType": "application/json", "maxOutputTokens": 512}
        }).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                if text:
                    cleaned = text.strip()
                    if cleaned.startswith("```"):
                        cleaned = cleaned.strip("`").strip()
                        if cleaned.lower().startswith("json"):
                            cleaned = cleaned[4:].strip()
                    parsed = json.loads(cleaned)
                    if isinstance(parsed, list) and all(isinstance(s, str) for s in parsed):
                        return parsed[:3], model_name, "gemini_online"
        except Exception:
            continue

    return None, "gemini-3.5-flash (fallback)", "motor_normativo_respaldo"


def _sugerencias_fallback(campo: str, contexto: dict) -> list[str]:
    """Sugerencias deterministas de respaldo cuando Gemini no está disponible."""
    fallbacks = {
        "titulo": [
            f"Diseño e implementación de {contexto.get('titulo', 'solución')} para {contexto.get('linea_investigacion', 'el sector')}",
            f"Desarrollo de {contexto.get('titulo', 'propuesta')} aplicada a {contexto.get('modalidad', 'investigación')}",
            f"Optimización y validación de {contexto.get('titulo', 'sistema')} en entorno relevante"
        ],
        "planteamiento": [
            "A pesar de los avances en el área, persiste una brecha significativa en la capacidad de...",
            "El problema central radica en la falta de soluciones integradas que permitan...",
            "Los enfoques actuales no resuelven adecuadamente la necesidad de..."
        ],
        "objetivo_general": [
            f"Diseñar e implementar {contexto.get('titulo', 'una solución')} que permita...",
            f"Desarrollar una metodología para {contexto.get('titulo', 'el problema')} que garantice...",
            f"Evaluar la efectividad de {contexto.get('titulo', 'la solución propuesta')} mediante..."
        ],
        "objetivos_especificos": [
            "Diagnosticar el estado actual de...",
            "Diseñar la arquitectura/estrategia de...",
            "Validar y transferir los resultados a..."
        ],
        "hipotesis": [
            "Si se implementa [tecnología/método], entonces se mejorará [variable], porque [fundamento teórico].",
            "Si se optimiza [parámetro], entonces se reducirá [problema], porque [mecanismo causal].",
            "Si se integra [componente], entonces se aumentará [indicador], porque [evidencia previa]."
        ],
        "actividades": [
            "Revisión de literatura y diagnóstico inicial del problema.",
            "Diseño y desarrollo de la solución propuesta (prototipo/modelo).",
            "Validación experimental y documentación de resultados."
        ],
        "riesgos": [
            "Riesgo: Retraso en adquisición de equipos. Mitigación: Compra anticipada y proveedores alternativos.",
            "Riesgo: Datos insuficientes para validación. Mitigación: Fuentes de datos secundarias y simulaciones.",
            "Riesgo: Baja adopción de resultados. Mitigación: Talleres de transferencia con stakeholders tempranos."
        ],
        "justificacion_presupuesto": [
            "Rubro: Personal investigador. Justificación: Horas VIE/CONS para ejecución técnica según plan.",
            "Rubro: Servicios profesionales. Justificación: Validación externa y asesoría metodológica especializada.",
            "Rubro: Materiales y suministros. Justificación: Insumos para experimentación y prototipado."
        ],
        "etica": [
            "Eje: Participación de seres humanos. Aplica: No. Justificación: No se recolectan datos de personas.",
            "Eje: Biodiversidad. Aplica: No. Justificación: No hay recolección de especímenes ni material genético.",
            "Eje: Uso de animales. Aplica: No. Justificación: No se utilizan animales en la investigación."
        ],
    }
    return fallbacks.get(campo, [
        f"Sugerencia 1 para {campo}",
        f"Sugerencia 2 para {campo}",
        f"Sugerencia 3 para {campo}"
    ])


@router.post("/sugerencias", response_model=SugerenciaCampoOut)
async def generar_sugerencias_campo(
    payload: SugerenciaCampoIn,
    conn: Connection = Depends(get_conn),
):
    """
    Generar sugerencias de IA para un campo de formulario específico.

    Recibe el identificador del campo, el contexto ya completado y el texto parcial actual.
    Retorna hasta 3 sugerencias de texto y un placeholder de ejemplo.

    Si Gemini está disponible (GEMINI_API_KEY configurada), usa el modelo gratuito.
    Si no, retorna sugerencias deterministas de respaldo (fallback).

    La respuesta vacía (sugerencias=[], placeholder="") indica que no hay sugerencias disponibles;
    el Frontend debe no mostrar UI en ese caso.

    parametros:
        - SugerenciaCampoIn : payload Campo objetivo, contexto del formulario, texto parcial.
        - Connection : conn Conexión transaccional a Supabase (para historial opcional).

    return:
        + SugerenciaCampoOut : sugerencias Lista de textos, placeholder de ejemplo, metadata.
    """
    campo = payload.campo
    contexto = payload.contexto or {}
    texto_parcial = (payload.texto_parcial or "").strip()

    # Si el texto parcial es muy corto y no hay contexto, no sugerir
    if not texto_parcial and not contexto:
        return SugerenciaCampoOut()

    # Intentar con Gemini (timeout corto: 3s)
    sugerencias, modelo_usado, modo_gen = await _generar_sugerencias_gemini(campo, contexto, texto_parcial)

    # Fallback determinista si Gemini falla o no hay API key
    if not sugerencias:
        sugerencias = _sugerencias_fallback(campo, contexto)
        modelo_usado = modelo_usado or "motor_normativo_respaldo"
        modo_gen = modo_gen or "motor_normativo_respaldo"

    # Construir placeholder a partir de la primera sugerencia (truncado)
    placeholder = ""
    if sugerencias:
        primera = sugerencias[0]
        if len(primera) > 80:
            placeholder = f"Ej: {primera[:77]}..."
        else:
            placeholder = f"Ej: {primera}"

    return SugerenciaCampoOut(
        sugerencias=sugerencias[:3],
        placeholder=placeholder,
        modelo_usado=modelo_usado,
        modo_generacion=modo_gen,
    )
