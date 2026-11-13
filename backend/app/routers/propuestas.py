"""
========================================================================================
ARCHIVO: backend/app/routers/propuestas.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Centralizar la lógica de negocio, persistencia, trazabilidad, transición de estados y
    evaluaciones de las propuestas de investigación postuladas a la Convocatoria Fondos VIE 2027.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Recibe payloads JSON desde el Frontend en 'frontend/js/app.js' (asistente de formulación
             en pantallas 08 a 18, pantallas de evaluación 23 a 27 y filtros de búsqueda en 29).
           - Consulta y escribe en las tablas de Supabase: 'propuestas', 'research_team',
             'proposal_objectives', 'academic_product_commitments', 'action_plans', 'risks',
             'proposal_budget', 'proposal_ethics_declarations', 'proposal_state_history',
             'evaluations', 'technical_committee_evaluations', 'cie_resolution_evaluations' y 'notificaciones'.
           - Utiliza la conexión activa de 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Retorna métricas cuantitativas al Dashboard (Pantalla 02).
           - Retorna códigos institucionales reales ('SI-YYYY-NNN') y períodos calculados a 'top3Propuestas'.
           - Retorna expedientes completos (dossier) a las vistas de evaluación y consulta histórica.
           - Emite notificaciones y auditorías automáticas mediante triggers y registros de base de datos.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Implementa el núcleo funcional del SGPI:
    - Cálculo resiliente de métricas de formulación, ejecución y cierre (Desajuste #1).
    - Obtención de códigos institucionales y períodos reales sin guiones quemados (Desajuste #4).
    - Creación atómica multitabla de propuestas validando reglas normativas VIE 2027 (bienes duraderos
      únicamente en Año 1 y cuota mínima de productos por horas) (Desajuste #6).
    - Expediente íntegro consolidado (dossier) con todas las subtablas vinculadas.
    - Transición auditable de estados con disparo de historial y alertas.
    - Registro formal de evaluaciones técnicas y resoluciones colegiadas.
========================================================================================
"""

import logging
import math
import os
import re
from contextlib import ExitStack
from datetime import date, datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg import Connection
from pydantic import BaseModel, Field

from ..almacenamiento import BUCKET, url_publica
from ..db import get_conn
from ..estados import (
    ESTADO_FORMULACION,
    ESTADO_VINCULACION,
    nombre_de_estado,
    resolver_estado,
    transicion_permitida,
    usuario_puede_transicionar,
)
from .auth import (
    _escape_ilike,
    contiene_inyeccion_sql,
    obtener_orcid_usuario,
    registrar_orcid_usuario,
    validar_orcid,
)
from .dictamen_vie import parsear_dictamen
from .ia import generar_y_guardar_evaluacion_ia, obtener_evaluacion_ia_guardada

# [Línea clave]: Logger del módulo para registrar incidencias no fatales (por ejemplo, una
#                evaluación preliminar IA que no se puede generar).
logger = logging.getLogger(__name__)

# [Línea clave]: Declara el router bajo el prefijo /propuestas para agrupar las operaciones centrales de expedientes.
router = APIRouter(prefix="/propuestas", tags=["propuestas"])


def _url_publica_documento(file_path: str) -> str:
    """Construir la URL pública de un documento almacenado en Supabase Storage."""

    return url_publica(file_path, BUCKET)


# =====================================================================
# PYDANTIC SCHEMAS (MODELOS DE DATOS)
# =====================================================================

class DashboardPropuestas(BaseModel):
    """
    Modelo de respuesta con los contadores consolidados de propuestas para el dashboard.

    Serializa las métricas cuantitativas agregadas por estado de tramitación para un usuario específico.

    Se utiliza como response_model en el endpoint GET /propuestas/dashboardpropuestas.

    atributos:
        * int : total Conteo total de propuestas asociadas al usuario (como líder o equipo).
        * int : formulacion Cantidad de propuestas en estado 'En formulación' o borrador.
        * int : ejecucion Cantidad de propuestas aprobadas y en fase de ejecución activa.
        * int : cerradas Cantidad de propuestas concluidas o con resolución final.
    """
    total: int
    formulacion: int
    ejecucion: int
    cerradas: int


class propuestaMasReciente(BaseModel):
    """
    Modelo de respuesta que identifica la propuesta activa más reciente en formulación.

    Transporta el ID y título de la última propuesta en borrador para permitir retomar su edición.

    Se utiliza como response_model en el endpoint GET /propuestas/propuestaMasReciente.

    atributos:
        * int : id Identificador único de la propuesta en formulación.
        * str : titulo Nombre o título de la propuesta en borrador.
    """
    id: int
    titulo: str


class Top3PropuestasRecientes(BaseModel):
    """
    Modelo de respuesta para las tarjetas y tablas de propuestas recientes en la interfaz.

    Transporta los metadatos resumidos (código, título, tipo, período, estado y monto total).

    Se utiliza en GET /propuestas/top3PropuestaMasReciente alimentando las pantallas 02, 03 y 30.

    atributos:
        * int : id Identificador numérico de la propuesta.
        * str : code Código institucional generado (formato SI-YYYY-NNN).
        * str : title Título de la propuesta de investigación.
        * str : tipo Nombre de la modalidad de participación.
        * str : period Período de ejecución calculado en años (ej. 2027–2028).
        * str : status Nombre del estado actual en que se encuentra.
        * float : amount Monto total financiado derivado de la suma presupuestaria.
    """
    id: int
    code: str
    title: str
    tipo: str
    period: str
    status: str
    amount: float


class TeamMemberIn(BaseModel):
    """
    Modelo de entrada que representa a un miembro del equipo de investigación en la propuesta.

    Valida la asignación horaria semanal de cada investigador entre 1 y 40 horas, su tipo de financiamiento
    y el identificador ORCID único asociado a su perfil institucional.

    Se utiliza dentro del arreglo 'equipo' de PropuestaCrearIn (Pantalla 09).

    atributos:
        * Optional[int] : id_usuario Identificador del usuario que integrará el equipo investigador.
        * Optional[str] : correo Correo institucional para resolver al usuario en servidor.
        * Optional[str] : orcid Identificador ORCID validado vinculado al perfil del investigador.
        * int : id_tipo_hora Identificador del tipo de hora asignada (VIE, CONS, REC, DOC, etc.).
        * int : horas_asignadas Cantidad de horas semanales dedicadas al proyecto.
    """
    id_usuario: Optional[int] = None
    correo: Optional[str] = Field(default=None, max_length=255)
    orcid: Optional[str] = Field(default=None, max_length=19)
    id_tipo_hora: int
    horas_asignadas: int = Field(ge=1, le=40)


class ObjetivoIn(BaseModel):
    """
    Modelo de entrada para la definición de objetivos de investigación de la propuesta.

    Valida el código nemotécnico (OG para General, OE1..OEn para Específicos), descripción y orden.

    Se utiliza dentro del arreglo 'objetivos' de PropuestaCrearIn (Pantalla 11).

    atributos:
        * str : codigo_objetivo Identificador nemotécnico corto (ej. OG, OE1, OE2).
        * str : descripcion Redacción del objetivo redactado en infinitivo.
        * int : orden Posición ordinal del objetivo en el documento de propuesta.
    """
    codigo_objetivo: str = Field(..., max_length=10, description="Ej: OG, OE1, OE2")
    descripcion: str = Field(..., max_length=1000)
    orden: int = 1


class ProductoAcademicoIn(BaseModel):
    """
    Modelo de entrada para los compromisos de productos académicos o activos de propiedad intelectual.

    Almacena el tipo de producto, descripción, meta verificable y opcionalmente el objetivo al que tributa.

    Se utiliza dentro del arreglo 'productos_academicos' de PropuestaCrearIn (Pantallas 11 y 16).

    atributos:
        * str : tipo_producto Tipo de producto (Artículo Scopus, Libro, Software, Patente, etc.).
        * str : descripcion Descripción detallada del entregable comprometido.
        * str : meta_esperada Indicador de cumplimiento verificable.
        * str : categoria Clasificación (Publicación científica, Activo PI, Transferencia).
        * Optional[int] : id_objetivo Objetivo específico al que se asocia el producto.
        * bool : es_obligatorio Indica si el producto es parte de la cuota normativa obligatoria.
    """
    tipo_producto: str = Field(..., max_length=120)
    descripcion: str = Field(..., max_length=1000)
    meta_esperada: str = Field(..., max_length=500)
    categoria: str = Field(..., max_length=120)
    codigo_objetivo: Optional[str] = Field(default=None, max_length=10)
    id_objetivo: Optional[int] = None
    es_obligatorio: bool = True


class PlanAccionIn(BaseModel):
    """
    Modelo de entrada para las actividades cronológicas del plan de acción del proyecto.

    Valida descripción, rango de fechas de ejecución y miembro del equipo asignado como responsable.

    Se utiliza dentro del arreglo 'plan_accion' de PropuestaCrearIn (Pantalla 13).

    atributos:
        * str : descripcion_actividad Nombre y alcance de la actividad a desarrollar.
        * date : fecha_inicio Fecha en que inicia la actividad.
        * Optional[date] : fecha_fin Fecha programada de culminación de la actividad.
        * Optional[int] : id_usuario_responsable Identificador del investigador a cargo.
        * Optional[int] : id_objetivo Objetivo específico al que tributa la actividad.
        * Optional[str] : resultado_esperado Entregable o resultado verificable.
        * Optional[str] : rol_responsable Rol con el que participa la persona responsable.
        * Optional[int] : mes_inicio Mes ordinal de inicio dentro del proyecto.
        * Optional[int] : mes_fin Mes ordinal de finalización dentro del proyecto.
    """
    descripcion_actividad: str = Field(..., max_length=500)
    fecha_inicio: date
    fecha_fin: Optional[date] = None
    id_usuario_responsable: Optional[int] = None
    correo_responsable: Optional[str] = Field(default=None, max_length=255)
    codigo_objetivo: Optional[str] = Field(default=None, max_length=10)
    id_objetivo: Optional[int] = None
    resultado_esperado: Optional[str] = Field(default=None, max_length=500)
    rol_responsable: Optional[str] = Field(default=None, max_length=100)
    mes_inicio: Optional[int] = Field(default=None, ge=1, le=36)
    mes_fin: Optional[int] = Field(default=None, ge=1, le=36)


class RiesgoIn(BaseModel):
    """
    Modelo de entrada para la matriz de gestión y mitigación de riesgos de la propuesta.

    Captura la descripción del riesgo, niveles de severidad y su medida de mitigación asociada.

    Se utiliza dentro del arreglo 'riesgos' de PropuestaCrearIn (Pantalla 14).

    atributos:
        * str : descripcion_riesgo Evento adverso potencial que podría afectar el proyecto.
        * int : id_nivel_probabilidad Nivel de probabilidad de ocurrencia (Bajo, Medio, Alto).
        * int : id_nivel_impacto Nivel de impacto en caso de materialización.
        * Optional[str] : medida_mitigacion Plan de contingencia o acción preventiva.
        * Optional[int] : id_plan_accion Actividad del plan de acción vinculada al riesgo.
        * Optional[int] : id_usuario_responsable Persona encargada de monitorear el riesgo.
        * Optional[str] : correo_responsable Correo institucional para resolver al responsable.
    """
    descripcion_riesgo: str = Field(..., max_length=500)
    id_nivel_probabilidad: int
    id_nivel_impacto: int
    medida_mitigacion: Optional[str] = Field(default=None, max_length=1000)
    id_plan_accion: Optional[int] = None
    id_usuario_responsable: Optional[int] = None
    correo_responsable: Optional[str] = Field(default=None, max_length=255)


class PresupuestoItemIn(BaseModel):
    """
    Modelo de entrada para el desglose financiero presupuestario por rubro y año.

    Valida que los montos sean no negativos y que el año de ejecución esté en el rango 1 a 3.

    Se utiliza dentro del arreglo 'presupuesto' de PropuestaCrearIn (Pantalla 15).

    atributos:
        * int : id_rubro Identificador del rubro presupuestario institucional.
        * float : monto Monto solicitado para ese rubro en colones costarricenses (CRC).
        * int : anio Año de ejecución presupuestaria al que corresponde el gasto (1, 2 o 3).
        * Optional[str] : justificacion Detalle o criterio de elegibilidad del gasto.
    """
    id_rubro: int
    monto: float = Field(ge=0)
    anio: int = Field(default=1, ge=1, le=3)
    justificacion: Optional[str] = Field(default="", max_length=1000)


class DeclaracionEticaIn(BaseModel):
    """
    Modelo de entrada para las declaraciones de aspectos bioéticos y de bioseguridad.

    Captura si la propuesta involucra seres humanos, animales o biodiversidad y el trámite regulatorio.

    Se utiliza dentro del arreglo 'declaraciones_eticas' de PropuestaCrearIn (Pantalla 17).

    atributos:
        * str : tipo_aspecto Aspecto evaluado (Seres humanos, Fauna silvestre, Genética, etc.).
        * bool : aplica Bandera que indica si el proyecto requiere permiso de este tipo.
        * Optional[str] : justificacion_exencion Justificación técnica si no requiere trámite.
        * Optional[str] : ente_regulatorio Entidad externa ante la que se tramita (CONIS, MINAE).
        * Optional[str] : numero_permiso Número oficial de oficio o resolución de permiso.
        * Optional[str] : estado_tramite Estado actual de la gestión (Aprobado, En trámite).
    """
    tipo_aspecto: str = Field(..., max_length=120)
    aplica: bool
    justificacion_exencion: Optional[str] = Field(default="", max_length=1500)
    ente_regulatorio: Optional[str] = Field(default=None, max_length=150)
    numero_permiso: Optional[str] = Field(default=None, max_length=100)
    estado_tramite: Optional[str] = Field(default=None, max_length=100)


class ColaboradorExternoIn(BaseModel):
    """
    Modelo de entrada para colaboradores externos que no poseen cuenta institucional.

    Se persiste en 'external_collaborators' y complementa al equipo registrado por correo.

    atributos:
        * str : nombre_completo Nombre de la persona colaboradora.
        * str : institucion Universidad, empresa o centro de investigación de procedencia.
        * str : rol Proyecto o función dentro de la propuesta.
        * Optional[str] : correo Correo de contacto del colaborador.
        * Optional[str] : orcid Identificador ORCID si está disponible.
        * Optional[int] : horas_asignadas Dedicación semanal declarada.
        * Optional[str] : responsabilidad Alcance o entregable bajo su responsabilidad.
    """
    nombre_completo: str = Field(..., min_length=3, max_length=150)
    institucion: str = Field(..., min_length=2, max_length=200)
    rol: str = Field(..., min_length=2, max_length=100)
    correo: Optional[str] = Field(default=None, max_length=255)
    orcid: Optional[str] = Field(default=None, max_length=19)
    horas_asignadas: Optional[int] = Field(default=None, ge=1, le=40)
    responsabilidad: Optional[str] = Field(default=None, max_length=500)


class SeccionPropuestaIn(BaseModel):
    """
    Modelo de entrada para secciones narrativas extensas de la propuesta.

    Se utiliza para persistir texto que no tiene una columna dedicada en 'propuestas'.

    atributos:
        * str : codigo_seccion Identificador estable de la sección (problema, metodologia, etc.).
        * str : titulo Título visible de la sección.
        * str : contenido Texto completo de la sección.
        * int : orden Posición de la sección en el expediente.
    """
    codigo_seccion: str = Field(..., min_length=1, max_length=80)
    titulo: str = Field(..., min_length=1, max_length=200)
    contenido: str = Field(..., max_length=8000)
    orden: int = 1


class DocumentoPropuestaIn(BaseModel):
    """
    Modelo de entrada para los metadatos de documentos adjuntos a la propuesta.

    Solo se registran documentos con archivo real en Storage; los metadatos sin archivo se ignoran.

    atributos:
        * str : nombre_archivo Nombre original o etiqueta del documento.
        * str : tipo_documento Categoría del instrumento.
        * Optional[str] : extension Extensión del archivo.
        * Optional[str] : file_path Ruta lógica o marcador de posición.
        * Optional[int] : tamano_bytes Tamaño declarado en bytes.
        * Optional[str] : mime_type Tipo MIME declarado.
    """
    nombre_archivo: str = Field(..., min_length=1, max_length=255)
    tipo_documento: str = Field(default="Documento de propuesta", max_length=100)
    extension: Optional[str] = Field(default=None, max_length=20)
    file_path: Optional[str] = Field(default=None, max_length=500)
    tamano_bytes: Optional[int] = Field(default=0, ge=0)
    mime_type: Optional[str] = Field(default=None, max_length=120)


class PropuestaCrearIn(BaseModel):
    """
    Modelo de entrada consolidado (Request Body) para la creación atómica de una propuesta completa.

    Recibe la totalidad de los datos estructurados en las pantallas 08 a 18 del asistente
    de formulación para ser insertados en una sola transacción en Supabase.

    Se utiliza como cuerpo de petición en el endpoint POST /propuestas.

    atributos:
        * int : id_usuario_lider Investigador proponente y responsable principal.
        * int : id_escuela Escuela o centro de investigación coordinador.
        * int : id_modalidad Modalidad de financiamiento seleccionada.
        * int : id_linea_investigacion Línea institucional vinculada.
        * str : titulo Título oficial del proyecto de investigación.
        * Optional[str] : resumen Resumen ejecutivo del proyecto.
        * Optional[int] : id_convocatoria Convocatoria a la que se postula (por defecto 1 = Fondos VIE 2027).
        * Optional[date] : fecha_inicio Fecha prevista de inicio de actividades.
        * Optional[date] : fecha_fin Fecha prevista de finalización.
        * Optional[str] : estado_inicial_nombre Etapa inicial por su nombre oficial en «estados» (por ejemplo «En revisión de Vinculación»). Es la forma recomendada.
        * Optional[int] : estado_inicial Identificador de la etapa inicial. Se conserva por compatibilidad con clientes antiguos, pero el identificador no es parte del contrato: el orden de «estados» difiere entre ambientes.
        * Optional[str] : client_uuid Identificador idempotente generado por el navegador.
        * Optional[str] : palabras_clave Palabras clave de la propuesta.
        * Optional[str] : resumen_en Resumen en inglés.
        * Optional[str] : prioridad_nacional_ods Prioridad nacional u ODS vinculado.
        * Optional[int] : trl_inicial Nivel de madurez tecnológica de partida (1–9).
        * Optional[int] : trl_esperado Nivel de madurez tecnológica esperado (1–9).
        * Optional[bool] : potencial_pi Indica si existe potencial de propiedad intelectual.
        * Optional[str] : activo_previsto Activo de propiedad intelectual comprometido.
        * list[TeamMemberIn] : equipo Miembros del equipo de investigación y horas asignadas.
        * list[ColaboradorExternoIn] : colaboradores_externos Personas sin cuenta institucional.
        * list[SeccionPropuestaIn] : secciones Secciones narrativas extensas.
        * list[DocumentoPropuestaIn] : documentos Metadatos de documentos adjuntos.
        * list[ObjetivoIn] : objetivos Objetivos generales y específicos formulados.
        * list[ProductoAcademicoIn] : productos_academicos Entregables comprometidos.
        * list[PlanAccionIn] : plan_accion Cronograma de actividades planificadas.
        * list[RiesgoIn] : riesgos Matriz de riesgos y mitigaciones.
        * list[PresupuestoItemIn] : presupuesto Desglose presupuestario por rubro y año.
        * list[DeclaracionEticaIn] : declaraciones_eticas Aspectos bioéticos declarados.
    """
    id_usuario_lider: int
    id_escuela: int
    id_modalidad: int
    id_linea_investigacion: int
    titulo: str = Field(..., min_length=5, max_length=300)
    resumen: Optional[str] = Field(default="", max_length=3000)
    id_convocatoria: Optional[int] = 1
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    estado_inicial: Optional[int] = None
    estado_inicial_nombre: Optional[str] = Field(default=None, max_length=120)
    client_uuid: Optional[UUID] = None
    palabras_clave: Optional[str] = Field(default=None, max_length=300)
    resumen_en: Optional[str] = Field(default=None, max_length=3000)
    palabras_clave_en: Optional[str] = Field(default=None, max_length=300)
    prioridad_nacional_ods: Optional[str] = Field(default=None, max_length=200)
    trl_inicial: Optional[int] = Field(default=None, ge=1, le=9)
    trl_esperado: Optional[int] = Field(default=None, ge=1, le=9)
    potencial_pi: Optional[bool] = None
    activo_previsto: Optional[str] = Field(default=None, max_length=250)
    equipo: list[TeamMemberIn] = []
    colaboradores_externos: list[ColaboradorExternoIn] = []
    secciones: list[SeccionPropuestaIn] = []
    documentos: list[DocumentoPropuestaIn] = []
    objetivos: list[ObjetivoIn] = []
    productos_academicos: list[ProductoAcademicoIn] = []
    plan_accion: list[PlanAccionIn] = []
    riesgos: list[RiesgoIn] = []
    presupuesto: list[PresupuestoItemIn] = []
    declaraciones_eticas: list[DeclaracionEticaIn] = []


class EstadoActualizarIn(BaseModel):
    """
    Modelo de entrada para ejecutar transiciones de estado en una propuesta.

    Recibe el nuevo estado, usuario ejecutor y observaciones de la decisión institucional.

    Se utiliza como cuerpo de petición en el endpoint PATCH /propuestas/{id_propuesta}/estado.

    atributos:
        * int : id_nuevo_estado Identificador del nuevo estado hacia el que transita la propuesta.
        * int : id_usuario_responsable Funcionario o evaluador que autoriza o registra el cambio.
        * Optional[str] : observaciones Justificación, acuerdo o notas de la transición.
    """
    id_nuevo_estado: int
    id_usuario_responsable: int
    observaciones: Optional[str] = Field(default="Cambio de estado de propuesta", max_length=2000)


class EvaluacionIn(BaseModel):
    """
    Modelo de entrada para registrar evaluaciones, rúbricas o resoluciones sobre una propuesta.

    Soporta puntajes del Comité Técnico y avance condicional de estado. La resolución del CIE no se
    emite por este endpoint: se registra con POST /propuestas/cie/{id_propuesta}, que valida el
    estado «Dictaminada por Dirección» y guarda el acuerdo colegiado completo.

    Se utiliza en el endpoint POST /propuestas/{id_propuesta}/evaluaciones (Pantallas 23 a 27).

    atributos:
        * int : id_usuario_eval Evaluador o funcionario que emite la valoración.
        * int : id_rol_evaluador Rol bajo el cual se realiza la evaluación.
        * Optional[str] : observaciones Comentarios cualitativos o recomendaciones emitidas.
        * Optional[int] : puntaje_comite Calificación numérica (0–100) si evalúa el Comité Técnico.
        * Optional[int] : id_resolucion_cie Obsoleto: el endpoint rechaza con 409 cualquier evaluación
          del CIE; se usa el catálogo «resoluciones_cie» desde el router del CIE.
        * Optional[int] : cambiar_a_estado Estado opcional al que se transita la propuesta automáticamente.
    """
    id_usuario_eval: int
    id_rol_evaluador: int
    observaciones: Optional[str] = Field(default="", max_length=4000)
    puntaje_comite: Optional[int] = Field(default=None, ge=0, le=100)
    id_resolucion_cie: Optional[int] = None
    cambiar_a_estado: Optional[int] = None


_TABLE_COLUMNS_CACHE: dict[str, set[str]] = {}


def _get_table_columns(cur, table_name: str) -> set[str]:
    """
    Inspeccionar dinámicamente las columnas existentes en una tabla de PostgreSQL.

    Consulta 'information_schema.columns' para el esquema público y retorna un conjunto
    con los nombres de columnas presentes, previniendo excepciones de columnas inexistentes.
    El resultado se memoriza por proceso: el esquema cambia solo con migraciones manuales.

    parametros:
        - Cursor : cur Cursor activo de la conexión a PostgreSQL.
        - str : table_name Nombre de la tabla a verificar en information_schema.

    return:
        + set[str] : columnas Conjunto de nombres de columnas en minúsculas presentes en la tabla.
    """
    columnas_cacheadas = _TABLE_COLUMNS_CACHE.get(table_name)
    if columnas_cacheadas is not None:
        return columnas_cacheadas

    # [Línea clave]: Consulta el catálogo del sistema PostgreSQL para verificar la presencia de columnas migratadas.
    cur.execute(
        """
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name,),
    )
    columnas = {row["column_name"] for row in cur.fetchall()}
    _TABLE_COLUMNS_CACHE[table_name] = columnas
    return columnas


# =====================================================================
# ENDPOINTS: DASHBOARD Y CONSULTAS RECIENTES (DESAJUSTES #1 Y #4)
# =====================================================================

@router.get("/dashboardpropuestas", response_model=DashboardPropuestas)
def obtener_dashboard_propuestas(
    id_usuario: int = Query(..., description="ID del usuario a consultar"),
    conn: Connection = Depends(get_conn),
):
    """
    Calcular los contadores estadísticos de propuestas para el dashboard del usuario.

    Ejecuta un conteo condicional con 'FILTER' agrupando por los estados normativos. Aplica
    escapado '%%' y coincidencia flexible con 'ILIKE' para resolver el Desajuste #1 (tolerando
    variaciones como 'Borrador' o 'En formulación' y acentos).

    parametros:
        - int : id_usuario Identificador del usuario consultado.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + DashboardPropuestas : metricas Objeto con los 4 contadores estadísticos para Pantalla 02.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Ejecuta el conteo condicional con escapado %% para evitar errores de placeholder en psycopg 3.
        cur.execute(
            """
            SELECT
                count(DISTINCT p.id_propuesta) AS total,
                count(DISTINCT p.id_propuesta) FILTER (
                    WHERE e.nombre_estado IN ('En formulación', 'Borrador')
                       OR e.nombre_estado ILIKE '%%formulaci%%'
                ) AS formulacion,
                count(DISTINCT p.id_propuesta) FILTER (
                    WHERE e.nombre_estado IN ('En ejecución', 'En Ejecución')
                       OR e.nombre_estado ILIKE '%%ejecuci%%'
                ) AS ejecucion,
                count(DISTINCT p.id_propuesta) FILTER (
                    WHERE e.nombre_estado IN ('Cerrada', 'Rechazada', 'Aprobada por CIE')
                       OR e.nombre_estado ILIKE '%%cerrad%%'
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
    Obtener la propuesta más reciente en formulación para mostrar el botón de continuar edición.

    Filtra las propuestas del usuario en estado de formulación o borrador, ordenadas por fecha de
    creación descendente y limita el resultado a 1 registro.

    parametros:
        - int : id_usuario Identificador del usuario consultado.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + Optional[propuestaMasReciente] : propuesta Objeto con ID y título, o None si no tiene borradores.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Coincidencia flexible de estado para recuperar el borrador activo sin falsos nulos.
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
                OR e.nombre_estado ILIKE '%%formulaci%%'
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
    Listar las propuestas más recientes del usuario mostrando código real y período de ejecución.

    Inspecciona si las columnas 'codigo', 'fecha_inicio' y 'fecha_fin' existen en la BD. Extrae
    el código institucional único y calcula el período formateado 'YYYY–YYYY', sumando los rubros
    de presupuesto para devolver el monto total derivado sin valores quemados '-' (Desajuste #4).

    parametros:
        - int : id_usuario Identificador del usuario consultado.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[Top3PropuestasRecientes] : lista Lista de propuestas para las tarjetas de la Pantalla 02.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Inspecciona las columnas para construir la consulta SQL adaptada al esquema de Supabase.
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

        # [Línea clave]: Agrupa por propuesta y suma los rubros de proposal_budget para obtener el monto total.
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
# ENDPOINTS: LISTADO, EXPEDIENTE Y TRANSACCIONES ATÓMICAS (DESAJUSTE #6)
# =====================================================================

@router.get("", response_model=list[dict[str, Any]])
def listar_propuestas(
    id_usuario: Optional[int] = Query(default=None, description="Filtrar por usuario (lider o equipo)"),
    id_escuela: Optional[int] = Query(default=None, description="Filtrar por escuela"),
    id_modalidad: Optional[int] = Query(default=None, description="Filtrar por modalidad"),
    id_linea: Optional[int] = Query(default=None, description="Filtrar por línea de investigación"),
    id_estado: Optional[int] = Query(default=None, description="Filtrar por ID de estado"),
    estado_nombre: Optional[str] = Query(default=None, max_length=100, description="Filtrar por nombre de estado"),
    q: Optional[str] = Query(default=None, max_length=150, description="Término de búsqueda en título o código"),
    anio_desde: Optional[int] = Query(default=None, ge=2000, le=2100, description="Filtrar desde el año de inicio"),
    anio_hasta: Optional[int] = Query(default=None, ge=2000, le=2100, description="Filtrar hasta el año de inicio"),
    solo_cerradas: bool = Query(default=False, description="Mostrar únicamente propuestas cerradas"),
    conn: Connection = Depends(get_conn),
):
    """
    Buscador general de propuestas con filtros facetados para consulta histórica y bandejas de evaluadores.

    Construye dinámicamente cláusulas WHERE según los parámetros suministrados (escuela, modalidad,
    línea, estado o texto de búsqueda 'q'), ejecutando un JOIN multidimensional optimizado.

    parametros:
        - Optional[int] : id_usuario Filtro opcional por pertenencia a equipo o líder.
        - Optional[int] : id_escuela Filtro por unidad académica.
        - Optional[int] : id_modalidad Filtro por modalidad de financiamiento.
        - Optional[int] : id_linea Filtro por línea de investigación.
        - Optional[int] : id_estado Filtro numérico por ID de estado.
        - Optional[str] : estado_nombre Filtro textual por nombre de estado.
        - Optional[str] : q Cadena de texto libre a buscar en título o código de propuesta.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + list[dict[str, Any]] : propuestas Lista de expedientes resumidos que coinciden con los criterios.
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
            if contiene_inyeccion_sql(estado_nombre):
                raise HTTPException(status_code=400, detail="Filtro de estado inválido.")
            est_clean = _escape_ilike(estado_nombre.strip())
            where_clauses.append("e.nombre_estado ILIKE %s ESCAPE '\\'")
            params.append(f"%{est_clean}%")

        if q:
            if contiene_inyeccion_sql(q):
                raise HTTPException(status_code=400, detail="Término de búsqueda inválido.")
            q_clean = _escape_ilike(q.strip())
            if has_codigo:
                where_clauses.append("(p.titulo ILIKE %s ESCAPE '\\' OR p.codigo ILIKE %s ESCAPE '\\')")
                params.extend([f"%{q_clean}%", f"%{q_clean}%"])
            else:
                where_clauses.append("p.titulo ILIKE %s ESCAPE '\\'")
                params.append(f"%{q_clean}%")

        anio_expr = "EXTRACT(YEAR FROM COALESCE(p.fecha_inicio, p.fecha_creacion))" if has_fechas else "EXTRACT(YEAR FROM p.fecha_creacion)"
        if anio_desde is not None:
            where_clauses.append(f"{anio_expr} >= %s")
            params.append(anio_desde)

        if anio_hasta is not None:
            where_clauses.append(f"{anio_expr} <= %s")
            params.append(anio_hasta)

        if solo_cerradas:
            where_clauses.append("e.nombre_estado IN ('Cerrada', 'Rechazada', 'Aprobada por CIE', 'Resuelta')")

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

        # [Línea clave]: Ejecuta la búsqueda facetada multi-criterio para alimentar las bandejas y el histórico.
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
    Obtener el expediente digital completo (dossier) de una propuesta con todas sus tablas hijas.

    Consulta la cabecera principal y de forma concurrente extrae: equipo investigador, objetivos,
    productos académicos, plan de acción, riesgos, presupuesto anualizado, declaraciones éticas,
    historial de cambios de estado y evaluaciones registradas.

    parametros:
        - int : id_propuesta Identificador único de la propuesta a consultar.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + dict[str, Any] : dossier Estructura JSON completa del expediente para Pantalla 22.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Consulta la cabecera principal de la propuesta y sus datos asociados.
        cols = _get_table_columns(cur, "propuestas")
        has_codigo = "codigo" in cols
        has_fechas = "fecha_inicio" in cols and "fecha_fin" in cols
        code_expr = "COALESCE(p.codigo, 'SI-' || p.id_propuesta)" if has_codigo else "'SI-' || p.id_propuesta"

        budget_cols = _get_table_columns(cur, "proposal_budget")
        anio_col = "pb.anio" if "anio" in budget_cols else "1 AS anio"

        # [Línea clave]: La migración V12 agrega decisión, justificación y bloqueo al dictamen
        # del Comité Técnico. Se detectan para que el expediente siga funcionando sin V12.
        comite_cols = _get_table_columns(cur, "technical_committee_evaluations")
        comite_decision_expr = (
            "tce.decision" if "decision" in comite_cols else "NULL::character varying AS decision"
        )
        comite_justificacion_expr = (
            "tce.justificacion" if "justificacion" in comite_cols else "NULL::text AS justificacion"
        )
        comite_bloqueo_expr = (
            "tce.tiene_bloqueo_obligatorio"
            if "tiene_bloqueo_obligatorio" in comite_cols
            else "false AS tiene_bloqueo_obligatorio"
        )

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

    with ExitStack() as stack:
        prop_cur = stack.enter_context(conn.cursor())
        equipo_cur = stack.enter_context(conn.cursor())
        objetivos_cur = stack.enter_context(conn.cursor())
        productos_cur = stack.enter_context(conn.cursor())
        planes_cur = stack.enter_context(conn.cursor())
        riesgos_cur = stack.enter_context(conn.cursor())
        presupuesto_cur = stack.enter_context(conn.cursor())
        eticas_cur = stack.enter_context(conn.cursor())
        secciones_cur = stack.enter_context(conn.cursor())
        documentos_cur = stack.enter_context(conn.cursor())
        colaboradores_cur = stack.enter_context(conn.cursor())
        historial_cur = stack.enter_context(conn.cursor())
        evaluaciones_cur = stack.enter_context(conn.cursor())
        vinculacion_cur = stack.enter_context(conn.cursor())
        comite_cur = stack.enter_context(conn.cursor())
        consejo_cur = stack.enter_context(conn.cursor())

        # [Línea clave]: Envía las 16 consultas del expediente en un solo pipeline para pagar un único round-trip.
        with conn.pipeline():
            prop_cur.execute(sql_prop, (id_propuesta,))

            # [Línea clave]: Consulta los miembros del equipo investigador con nombres de usuario y tipo de hora.
            equipo_cur.execute(
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

            # [Línea clave]: Consulta los objetivos ordenados por su posición ordinal.
            objetivos_cur.execute(
                """
                SELECT id_objetivo, codigo_objetivo, descripcion, orden
                FROM proposal_objectives
                WHERE id_propuesta = %s
                ORDER BY orden ASC
                """,
                (id_propuesta,),
            )

            # [Línea clave]: Consulta los productos académicos comprometidos y su estado de cumplimiento.
            productos_cur.execute(
                """
                SELECT id_producto, id_objetivo, tipo_producto, descripcion,
                       meta_esperada, categoria, es_obligatorio, cumplido
                FROM academic_product_commitments
                WHERE id_propuesta = %s
                """,
                (id_propuesta,),
            )

            # [Línea clave]: Consulta las actividades del plan de acción ordenadas por fecha de inicio.
            planes_cur.execute(
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

            # [Línea clave]: Consulta los riesgos y sus niveles textuales de probabilidad e impacto.
            riesgos_cur.execute(
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

            # [Línea clave]: Consulta el presupuesto anualizado por rubro.
            presupuesto_cur.execute(
                f"""
                SELECT pb.id_rubro, rp.nombre_rubro, pb.monto, {anio_col}
                FROM proposal_budget pb
                JOIN rubros_presupuesto rp ON rp.id_rubro = pb.id_rubro
                WHERE pb.id_propuesta = %s
                """,
                (id_propuesta,),
            )

            # [Línea clave]: Consulta las declaraciones éticas registradas para la propuesta.
            eticas_cur.execute(
                """
                SELECT id_etica, tipo_aspecto, aplica, justificacion_exencion,
                       ente_regulatorio, numero_permiso, estado_tramite
                FROM proposal_ethics_declarations
                WHERE id_propuesta = %s
                """,
                (id_propuesta,),
            )

            # [Línea clave]: Consulta las secciones narrativas extensas del formulario.
            secciones_cur.execute(
                """
                SELECT codigo_seccion, contenido
                FROM proposal_sections
                WHERE id_propuesta = %s
                ORDER BY codigo_seccion ASC
                """,
                (id_propuesta,),
            )

            # [Línea clave]: Consulta los metadatos de los documentos adjuntos.
            documentos_cur.execute(
                """
                SELECT id_documento, nombre_archivo, tipo_documento, extension,
                       file_path, tamano_bytes, version, fecha_subida
                FROM proposal_documents
                WHERE id_propuesta = %s
                ORDER BY id_documento ASC
                """,
                (id_propuesta,),
            )

            # [Línea clave]: Consulta los colaboradores externos y sus compromisos.
            colaboradores_cur.execute(
                """
                SELECT id_colaborador, nombre_completo, identificacion_orcid,
                       institucion_empresa, rol_desempenado, carta_compromiso_adjunta,
                       horas_semana, responsabilidad
                FROM external_collaborators
                WHERE id_propuesta = %s
                ORDER BY id_colaborador ASC
                """,
                (id_propuesta,),
            )

            # [Línea clave]: Consulta la bitácora inmutable de cambios de estado para trazabilidad.
            historial_cur.execute(
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

            # [Línea clave]: Consulta las evaluaciones registradas por Comité Técnico, Vinculación y CIE.
            evaluaciones_cur.execute(
                f"""
                SELECT ev.id_evaluacion, ev.fecha_evaluacion, ev.observaciones,
                       u.nombre AS evaluador_nombre, r.nombre_rol AS rol_evaluador,
                       tce.puntaje AS puntaje_comite,
                       {comite_decision_expr}, {comite_justificacion_expr}, {comite_bloqueo_expr},
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

            # [Línea clave]: Recupera el detalle por criterio del último dictamen del Comité Técnico
            # para que la pantalla 22 pueda mostrar la rúbrica aplicada y su ponderación.
            comite_cur.execute(
                """
                SELECT ev.id_evaluacion, tcs.id_criterio_rubrica, s.nombre_seccion,
                       c.nombre_criterio, c.peso_relativo, c.es_obligatorio,
                       tcs.puntaje, tcs.justificacion
                FROM technical_committee_scores tcs
                JOIN technical_committee_evaluations tce ON tce.id_evaluacion = tcs.id_evaluacion
                JOIN evaluations ev ON ev.id_evaluacion = tce.id_evaluacion
                JOIN rubric_criteria c ON c.id_criterio_rubrica = tcs.id_criterio_rubrica
                JOIN rubric_sections s ON s.id_seccion = c.id_seccion
                WHERE ev.id_propuesta = %s
                  AND ev.id_evaluacion = (
                      SELECT ev2.id_evaluacion
                      FROM evaluations ev2
                      JOIN roles r2 ON r2.id_rol = ev2.id_rol_evaluador AND r2.nombre_rol = 'Comité Técnico'
                      WHERE ev2.id_propuesta = %s
                      ORDER BY ev2.fecha_evaluacion DESC, ev2.id_evaluacion DESC
                      LIMIT 1
                  )
                ORDER BY s.orden ASC, c.orden ASC
                """,
                (id_propuesta, id_propuesta),
            )

            # [Línea clave]: Recupera el detalle del dictamen técnico emitido por Vinculación.
            vinculacion_cur.execute(
                """
                SELECT ev.id_evaluacion, ev.fecha_evaluacion, ev.observaciones,
                       u.nombre AS evaluador_nombre, ve.numero_oficio_dictamen,
                       ve.potencial_pi_identificado, ve.tipo_innovacion,
                       ve.activo_previsto, ve.valoracion_tecnica, ve.requiere_reserva
                FROM evaluations ev
                JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = 'Vinculación'
                JOIN vinculacion_evaluations ve ON ve.id_evaluacion = ev.id_evaluacion
                JOIN usuarios u ON u.id_usuario = ev.id_usuario_eval
                WHERE ev.id_propuesta = %s
                ORDER BY ev.fecha_evaluacion DESC
                """,
                (id_propuesta,),
            )

            # [Línea clave]: Recupera los avales del Consejo de Escuela con su escuela y
            # responsable para que las pantallas 22 y 28 muestren los acuerdos reales.
            consejo_cur.execute(
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

            # [Línea clave]: Recupera el dictamen de Dirección de Investigación con sus
            # verificaciones por criterio para mostrarlo en las pantallas 22 y 28.
            direccion_cur = stack.enter_context(conn.cursor())
            direccion_cur.execute(
                """
                SELECT ev.id_evaluacion, ev.id_usuario_eval, ev.fecha_evaluacion, ev.observaciones,
                       TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS evaluador_nombre
                FROM evaluations ev
                JOIN usuarios u ON u.id_usuario = ev.id_usuario_eval
                JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = 'Dirección de Investigación'
                WHERE ev.id_propuesta = %s
                ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
                LIMIT 1
                """,
                (id_propuesta,),
            )
            direccion_verif_cur = stack.enter_context(conn.cursor())
            direccion_verif_cur.execute(
                """
                SELECT vdv.id_evaluacion, vdv.id_criterio, vdv.cumple, cv.descripcion_criterio
                FROM vie_dictamen_verifications vdv
                JOIN evaluations ev ON ev.id_evaluacion = vdv.id_evaluacion
                JOIN roles r ON r.id_rol = ev.id_rol_evaluador AND r.nombre_rol = 'Dirección de Investigación'
                LEFT JOIN criterios_verificacion_vie cv ON cv.id_criterio = vdv.id_criterio
                WHERE ev.id_propuesta = %s
                ORDER BY vdv.id_criterio
                """,
                (id_propuesta,),
            )

            # [Línea clave]: Recupera la resolución vigente del Comité de Ética en
            # Investigación con los datos de su acuerdo colegiado para mostrarla en la
            # pantalla 28 (historial de la propuesta).
            cie_cur = stack.enter_context(conn.cursor())
            cie_cur.execute(
                """
                SELECT ev.id_evaluacion, ev.id_propuesta, ev.id_usuario_eval,
                       ev.fecha_evaluacion, ev.observaciones,
                       TRIM(u.nombre || ' ' || COALESCE(u.lastname, '')) AS evaluador_nombre,
                       cre.id_resolucion, res.nombre_resolucion,
                       cre.numero_sesion, cre.articulo, cre.fecha_resolucion,
                       cre.fundamentacion, cre.condiciones, cre.id_documento,
                       cre.fecha_registro
                FROM evaluations ev
                JOIN usuarios u ON u.id_usuario = ev.id_usuario_eval
                JOIN roles r ON r.id_rol = ev.id_rol_evaluador
                     AND r.nombre_rol IN ('CIE', 'Evaluador Comité de Ética (CIE)')
                JOIN cie_resolution_evaluations cre ON cre.id_evaluacion = ev.id_evaluacion
                JOIN resoluciones_cie res ON res.id_resolucion = cre.id_resolucion
                WHERE ev.id_propuesta = %s
                ORDER BY ev.fecha_evaluacion DESC, ev.id_evaluacion DESC
                LIMIT 1
                """,
                (id_propuesta,),
            )

        prop = prop_cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Propuesta no encontrada")

        equipo = [
            # [Línea clave]: El ORCID de cada integrante se toma de su perfil institucional
            #                (columna 'usuarios.identificacion_orcid' de la migración V18).
            #                Si el investigador no lo tiene registrado, queda vacío: nunca se inventa.
            {**dict(m), "orcid": obtener_orcid_usuario(
                id_usuario=m["id_usuario"], correo=m["correo"], conn=conn
            )}
            for m in equipo_cur.fetchall()
        ]
        objetivos = objetivos_cur.fetchall()
        productos = productos_cur.fetchall()
        planes = planes_cur.fetchall()
        riesgos = riesgos_cur.fetchall()
        presupuesto = presupuesto_cur.fetchall()
        eticas = eticas_cur.fetchall()
        secciones = secciones_cur.fetchall()
        documentos = [
            {**documento, "file_url": _url_publica_documento(documento["file_path"])}
            for documento in documentos_cur.fetchall()
        ]
        colaboradores_externos = colaboradores_cur.fetchall()
        historial = historial_cur.fetchall()
        evaluaciones = evaluaciones_cur.fetchall()
        vinculacion_evaluaciones = vinculacion_cur.fetchall()
        comite_evaluacion = comite_cur.fetchall()
        avales_consejo = consejo_cur.fetchall()
        dictamen_direccion_fila = direccion_cur.fetchone()
        dictamen_direccion_verificaciones = direccion_verif_cur.fetchall()
        resolucion_cie_fila = cie_cur.fetchone()

    # [Línea clave]: El dictamen de Dirección se guarda serializado dentro de
    # 'evaluations.observaciones'; se muestra su texto legible en lugar del JSON interno.
    for evaluacion in evaluaciones:
        if evaluacion.get("rol_evaluador") == "Dirección de Investigación":
            datos = parsear_dictamen(evaluacion.get("observaciones"))
            partes = [datos["fundamentacion"], datos["observaciones"]]
            evaluacion["observaciones"] = " · ".join(parte for parte in partes if parte) or None

    # [Línea clave]: Incluye la evaluación preliminar ya guardada, sin generarla en la ruta de lectura.
    evaluacion_ia = None
    try:
        evaluacion_ia = obtener_evaluacion_ia_guardada(id_propuesta, conn, autogenerar=False)
    except Exception:
        pass

    dictamen_direccion = None
    if dictamen_direccion_fila:
        datos_dictamen = parsear_dictamen(dictamen_direccion_fila["observaciones"])
        verificaciones_inst = datos_dictamen["verificaciones_institucionales"]
        dictamen_direccion = {
            **dict(dictamen_direccion_fila),
            "dictamen": datos_dictamen["dictamen"],
            "fundamentacion": datos_dictamen["fundamentacion"],
            "observaciones": datos_dictamen["observaciones"] or None,
            "verificacion_responsabilidades": verificaciones_inst.get("responsabilidades"),
            "verificacion_riesgos": verificaciones_inst.get("riesgos"),
            "verificacion_beca": verificaciones_inst.get("beca"),
            "verificacion_declaraciones": verificaciones_inst.get("declaraciones"),
            "verificacion_documentos": verificaciones_inst.get("documentos"),
            "verificaciones": [
                {
                    "id_criterio": v["id_criterio"],
                    "cumple": v["cumple"],
                    "descripcion_criterio": v["descripcion_criterio"],
                }
                for v in dictamen_direccion_verificaciones
                if v["id_evaluacion"] == dictamen_direccion_fila["id_evaluacion"]
            ],
        }

    # [Línea clave]: La resolución del CIE viaja como bloque propio del expediente: reúne el
    # acuerdo colegiado (tipo, sesión, artículo, fecha, fundamentación y condiciones) con
    # el evaluador responsable del registro.
    resolucion_cie = None
    if resolucion_cie_fila:
        resolucion_cie = {
            **dict(resolucion_cie_fila),
            "numero_sesion": resolucion_cie_fila.get("numero_sesion") or "",
            "articulo": resolucion_cie_fila.get("articulo") or "",
            "fundamentacion": resolucion_cie_fila.get("fundamentacion") or "",
            "condiciones": resolucion_cie_fila.get("condiciones") or None,
        }

    return {
        **prop,
        "equipo": equipo,
        "objetivos": objetivos,
        "productos_academicos": productos,
        "plan_accion": planes,
        "riesgos": riesgos,
        "presupuesto": presupuesto,
        "declaraciones_eticas": eticas,
        "secciones": secciones,
        "documentos": documentos,
        "colaboradores_externos": colaboradores_externos,
        "historial": historial,
        "evaluaciones": evaluaciones,
        "vinculacion_evaluaciones": vinculacion_evaluaciones,
        "comite_evaluacion": comite_evaluacion,
        "avales_consejo": avales_consejo,
        "dictamen_direccion": dictamen_direccion,
        "resolucion_cie": resolucion_cie,
        "evaluacion_ia": evaluacion_ia,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def crear_propuesta(
    payload: PropuestaCrearIn,
    conn: Connection = Depends(get_conn),
):
    """
    Creación atómica de la propuesta y todas sus entidades hijas validando la normativa VIE 2027.

    1. Valida reglas de negocio de la VIE:
       - Restricción de adquisición de bienes duraderos únicamente en el Año 1 (Sección 2.3.9).
       - Proporcionalidad mínima de productos académicos por cuota de horas semanales (Sección 2.4.1).
    2. Inserta la cabecera en 'propuestas' obteniendo el ID autogenerado.
    3. Garantiza la asignación del código institucional único 'SI-YYYY-NNN'.
    4. Inserta concurrentemente en 'research_team', 'proposal_objectives',
       'academic_product_commitments', 'action_plans', 'risks', 'proposal_budget',
       'proposal_ethics_declarations', 'proposal_state_history' y 'notificaciones'.

    parametros:
        - PropuestaCrearIn : payload Estructura completa con todos los componentes del expediente.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + dict : resultado Diccionario con bandera de éxito, mensaje y metadatos de la propuesta creada.
    """
    # -------------------------------------------------------------
    # 1. Validaciones de Negocio Obligatorias (Disposiciones VIE 2027)
    # -------------------------------------------------------------
    with conn.cursor() as cur:
        cols = _get_table_columns(cur, "propuestas")
        has_codigo = "codigo" in cols
        has_convocatoria = "id_convocatoria" in cols
        has_fechas = "fecha_inicio" in cols and "fecha_fin" in cols
        code_expr = "COALESCE(codigo, 'SI-' || id_propuesta::text)" if has_codigo else "'SI-' || id_propuesta::text"

        # Idempotencia: si el navegador reenvía el mismo borrador, devuelve la propuesta ya creada.
        if payload.client_uuid and "client_uuid" in cols:
            cur.execute(
                f"SELECT id_propuesta, {code_expr} AS codigo, titulo, estado_actual FROM propuestas WHERE client_uuid = %s LIMIT 1;",
                (payload.client_uuid,),
            )
            existente = cur.fetchone()
            if existente:
                return {
                    "ok": True,
                    "mensaje": "La propuesta ya había sido registrada; se devuelve el expediente existente.",
                    "propuesta": existente,
                    "duplicada": True,
                    "evaluacion_preliminar_ia": obtener_evaluacion_ia_guardada(id_propuesta=existente["id_propuesta"], conn=conn, autogenerar=False),
                }

        # [Línea clave]: Mapea rubros presupuestarios para verificar la regla de bienes duraderos en Año 1.
        cur.execute("SELECT id_rubro, nombre_rubro, es_bien_duradero FROM rubros_presupuesto")
        rubros_map = {r["id_rubro"]: r for r in cur.fetchall()}

        # Resolver integrantes por correo institucional, evitando IDs enviados por el cliente.
        user_cols = _get_table_columns(cur, "usuarios")
        active_filter = " AND estado_activo IS TRUE" if "estado_activo" in user_cols else ""
        usuarios_por_correo: dict[str, Optional[int]] = {}

        def resolver_usuario_por_correo(correo: Optional[str]) -> Optional[int]:
            if not correo:
                return None
            clave = correo.strip().lower()
            if clave in usuarios_por_correo:
                return usuarios_por_correo[clave]
            cur.execute(
                f"SELECT id_usuario FROM usuarios WHERE lower(trim(correo)) = %s{active_filter} LIMIT 1;",
                (clave,),
            )
            fila = cur.fetchone()
            usuarios_por_correo[clave] = fila["id_usuario"] if fila else None
            return usuarios_por_correo[clave]

        # [Línea clave]: Bloquea patrones de inyección SQL en los textos principales del expediente antes de procesar.
        if contiene_inyeccion_sql(payload.titulo) or contiene_inyeccion_sql(payload.resumen):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El título o resumen contiene patrones de texto no permitidos por seguridad.",
            )

        equipo_resuelto: list[TeamMemberIn] = []
        claves_equipo: set[tuple[int, int]] = set()
        orcids_ocupados: dict[str, str] = {}
        for miembro in payload.equipo:
            id_usuario = miembro.id_usuario
            correo_resuelto = miembro.correo
            if miembro.correo:
                cur.execute(
                    f"SELECT id_usuario, correo FROM usuarios WHERE lower(trim(correo)) = lower(trim(%s)){active_filter} LIMIT 1;",
                    (miembro.correo,),
                )
                usuario = cur.fetchone()
                if not usuario:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"El correo {miembro.correo} no corresponde a un usuario institucional activo.",
                    )
                id_usuario = usuario["id_usuario"]
                correo_resuelto = usuario["correo"]
            elif id_usuario:
                cur.execute("SELECT correo FROM usuarios WHERE id_usuario = %s LIMIT 1;", (id_usuario,))
                fila_u = cur.fetchone()
                if fila_u:
                    correo_resuelto = fila_u["correo"]
            if not id_usuario:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cada integrante del equipo debe incluir id_usuario o correo institucional.",
                )
            # [Línea clave]: Obtiene el ORCID registrado en el perfil del investigador o solicita validar el proporcionado.
            orcid_perfil = obtener_orcid_usuario(id_usuario=id_usuario, correo=correo_resuelto, conn=conn)
            orcid_miembro = (miembro.orcid or orcid_perfil).strip().upper()
            if not orcid_miembro:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Se debe solicitar y registrar un ORCID válido para el investigador ({correo_resuelto or id_usuario}).",
                )
            if not validar_orcid(orcid_miembro):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El ORCID «{miembro.orcid}» no es válido según el estándar oficial ISO 7064 (formato 0000-0000-0000-000X).",
                )
            dueno_orcid = orcids_ocupados.get(orcid_miembro)
            if dueno_orcid and dueno_orcid != f"user:{id_usuario}":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El ORCID {orcid_miembro} ya está asignado a otro investigador. Cada ORCID debe ser único.",
                )
            # [Línea clave]: Vincula el ORCID validado al perfil del investigador para futuros autocompletados.
            registrar_orcid_usuario(id_usuario, correo_resuelto, orcid_miembro, conn=conn)
            orcids_ocupados[orcid_miembro] = f"user:{id_usuario}"
            clave = (id_usuario, miembro.id_tipo_hora)
            if clave in claves_equipo:
                continue
            claves_equipo.add(clave)
            equipo_resuelto.append(
                TeamMemberIn(
                    id_usuario=id_usuario,
                    correo=correo_resuelto,
                    orcid=orcid_miembro,
                    id_tipo_hora=miembro.id_tipo_hora,
                    horas_asignadas=miembro.horas_asignadas,
                )
            )

        for colab in payload.colaboradores_externos:
            orcid_ext = (colab.orcid or "").strip().upper()
            # [Línea clave]: Exige y valida el ORCID solicitado de cada colaborador externo bajo ISO 7064 MOD 11-2.
            if not orcid_ext or not validar_orcid(orcid_ext):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El ORCID «{colab.orcid or ''}» del colaborador externo «{colab.nombre_completo}» no es válido según el estándar ISO 7064.",
                )
            clave_ext = f"ext:{colab.nombre_completo.strip().lower()}"
            dueno_previo = orcids_ocupados.get(orcid_ext)
            if dueno_previo and dueno_previo != clave_ext:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El ORCID {orcid_ext} ya pertenece a otro participante. Cada ORCID debe ser único.",
                )
            orcids_ocupados[orcid_ext] = clave_ext

        # [Línea clave]: Regla 2.3.9: bloquea compras de bienes duraderos en años 2 o 3 con HTTP 400.
        for item in payload.presupuesto:
            rubro = rubros_map.get(item.id_rubro)
            if not rubro:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El rubro presupuestario {item.id_rubro} no existe en el catálogo institucional.",
                )
            nom = (rubro["nombre_rubro"] or "").lower()
            if (rubro.get("es_bien_duradero") or "duradero" in nom or "equipo" in nom) and item.anio > 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La adquisición de equipo y bienes duraderos debe formularse obligatoriamente en el Año 1 (Sección 2.3.9 Disposiciones Fondos VIE 2027).",
                )

        # [Línea clave]: Regla 2.4.1: calcula la proporción de al menos 1 producto por cada 10 horas semanales.
        total_horas = sum(m.horas_asignadas for m in equipo_resuelto)
        min_productos_requeridos = max(1, math.ceil(total_horas / 10)) if total_horas > 0 else 1

        # [Línea clave]: La etapa inicial se resuelve por su NOMBRE oficial en el catálogo
        # 'estados'. El identificador numérico se acepta por compatibilidad con clientes
        # antiguos, pero la fuente de verdad es siempre el nombre: el orden de la tabla
        # 'estados' difiere entre ambientes.
        if payload.estado_inicial_nombre:
            estado_inicial = resolver_estado(cur, payload.estado_inicial_nombre)
            nombre_estado_inicial = payload.estado_inicial_nombre
        elif payload.estado_inicial is not None:
            nombre_estado_inicial = nombre_de_estado(cur, payload.estado_inicial)
            if not nombre_estado_inicial:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El estado inicial indicado no existe en el catálogo institucional.",
                )
            estado_inicial = payload.estado_inicial
        else:
            estado_inicial = resolver_estado(cur, ESTADO_VINCULACION)
            nombre_estado_inicial = ESTADO_VINCULACION

        # [Línea clave]: Regla 2.4.1: la creación directa en una etapa avanzada exige el
        # mínimo de productos académicos comprometidos, igual que en el flujo normal.
        if nombre_estado_inicial != ESTADO_FORMULACION:
            if len(payload.productos_academicos) < min_productos_requeridos:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Para {total_horas} horas totales del equipo se exige un mínimo de {min_productos_requeridos} productos académicos comprometidos (Sección 2.4.1 Disposiciones VIE 2027).",
                )

    # -------------------------------------------------------------
    # 2. Inserción Atómica Multitabla
    # -------------------------------------------------------------
    with conn.cursor() as cur:
        risks_cols = _get_table_columns(cur, "risks")
        budget_cols = _get_table_columns(cur, "proposal_budget")
        has_plan_fk = "id_plan_accion" in risks_cols
        has_risk_user = "id_usuario_responsable" in risks_cols
        has_anio_col = "anio" in budget_cols
        has_budget_just = "justificacion" in budget_cols

        fecha_inicio = payload.fecha_inicio or date(2027, 1, 1)
        fecha_fin = payload.fecha_fin or date(2028, 12, 31)
        # La etapa inicial ya quedó resuelta por nombre en el bloque de validaciones.

        cabecera: dict[str, Any] = {
            "id_usuario_lider": payload.id_usuario_lider,
            "id_escuela": payload.id_escuela,
            "id_modalidad": payload.id_modalidad,
            "id_linea_investigacion": payload.id_linea_investigacion,
            "titulo": payload.titulo,
            "resumen": payload.resumen or "",
            "estado_actual": estado_inicial,
            "fecha_creacion": datetime.now(),
        }
        if has_convocatoria:
            cabecera["id_convocatoria"] = payload.id_convocatoria or 1
        if has_fechas:
            cabecera["fecha_inicio"] = fecha_inicio
            cabecera["fecha_fin"] = fecha_fin
        opcionales = {
            "client_uuid": payload.client_uuid,
            "palabras_clave": payload.palabras_clave,
            "palabras_clave_en": payload.palabras_clave_en,
            "resumen_en": payload.resumen_en,
            "prioridad_nacional_ods": payload.prioridad_nacional_ods,
            "trl_inicial": payload.trl_inicial,
            "trl_esperado": payload.trl_esperado,
            "potencial_pi": payload.potencial_pi,
            "activo_previsto": payload.activo_previsto,
        }
        for columna, valor in opcionales.items():
            if columna in cols and valor is not None:
                cabecera[columna] = valor

        insert_cols = list(cabecera.keys())
        placeholders = ", ".join(["%s"] * len(insert_cols))
        cur.execute(
            f"INSERT INTO propuestas ({', '.join(insert_cols)}) VALUES ({placeholders}) RETURNING id_propuesta;",
            tuple(cabecera.values()),
        )
        id_propuesta = cur.fetchone()["id_propuesta"]

        # [Línea clave]: Asegura la asignación del código institucional en caso de que el trigger no lo asigne.
        if has_codigo:
            cur.execute("SELECT codigo FROM propuestas WHERE id_propuesta = %s;", (id_propuesta,))
            codigo_row = cur.fetchone()
            if not codigo_row or not codigo_row["codigo"]:
                anio_codigo = str(fecha_inicio.year)
                cur.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s));",
                    (f"sgpi_codigo_propuesta_{anio_codigo}",),
                )
                cur.execute(
                    """
                    SELECT COALESCE(MAX(SUBSTRING(codigo FROM '^SI-[0-9]{4}-([0-9]+)$')::integer), 0) + 1 AS consecutivo
                    FROM propuestas
                    WHERE codigo LIKE %s;
                    """,
                    (f"SI-{anio_codigo}-%",),
                )
                consecutivo = cur.fetchone()["consecutivo"]
                cur.execute(
                    "UPDATE propuestas SET codigo = %s WHERE id_propuesta = %s;",
                    (f"SI-{anio_codigo}-{consecutivo:03d}", id_propuesta),
                )

        # 3. Equipo Investigador
        if equipo_resuelto:
            cur.executemany(
                """
                INSERT INTO research_team (id_propuesta, id_usuario, id_tipo_hora, horas_asignadas)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id_propuesta, id_usuario, id_tipo_hora)
                DO UPDATE SET horas_asignadas = EXCLUDED.horas_asignadas;
                """,
                [
                    (id_propuesta, miembro.id_usuario, miembro.id_tipo_hora, miembro.horas_asignadas)
                    for miembro in equipo_resuelto
                ],
            )

        # 4. Objetivos
        objetivo_id_map: dict[str, int] = {}
        for obj in payload.objetivos:
            cur.execute(
                """
                INSERT INTO proposal_objectives (id_propuesta, codigo_objetivo, descripcion, orden)
                VALUES (%s, %s, %s, %s)
                RETURNING id_objetivo;
                """,
                (id_propuesta, obj.codigo_objetivo, obj.descripcion, obj.orden),
            )
            objetivo_id_map[obj.codigo_objetivo] = cur.fetchone()["id_objetivo"]

        # 5. Compromisos de Productos Académicos
        for prod in payload.productos_academicos:
            id_objetivo = objetivo_id_map.get(prod.codigo_objetivo or "") or prod.id_objetivo
            cur.execute(
                """
                INSERT INTO academic_product_commitments (
                    id_propuesta, id_objetivo, tipo_producto, descripcion,
                    meta_esperada, categoria, es_obligatorio, cumplido
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    id_propuesta,
                    id_objetivo,
                    prod.tipo_producto,
                    prod.descripcion,
                    prod.meta_esperada,
                    prod.categoria,
                    prod.es_obligatorio,
                    False,
                ),
            )

        # Precarga los responsables por correo en una sola consulta para evitar un viaje por actividad/riesgo.
        correos_responsables = {
            (correo or "").strip().lower()
            for correo in [
                *[plan.correo_responsable for plan in payload.plan_accion],
                *[riesgo.correo_responsable for riesgo in payload.riesgos],
            ]
            if correo and correo.strip()
        }
        if correos_responsables:
            cur.execute(
                f"SELECT id_usuario, lower(trim(correo)) AS correo FROM usuarios WHERE lower(trim(correo)) = ANY(%s){active_filter};",
                (list(correos_responsables),),
            )
            for fila in cur.fetchall():
                usuarios_por_correo[fila["correo"]] = fila["id_usuario"]
            for correo in correos_responsables:
                usuarios_por_correo.setdefault(correo, None)

        # 6. Plan de Acción
        plan_ids: list[int] = []
        for plan in payload.plan_accion:
            id_objetivo = objetivo_id_map.get(plan.codigo_objetivo or "") or plan.id_objetivo
            id_responsable = plan.id_usuario_responsable or resolver_usuario_por_correo(plan.correo_responsable)
            cur.execute(
                """
                INSERT INTO action_plans (
                    id_propuesta, descripcion_actividad, fecha_inicio, fecha_fin,
                    id_usuario_responsable, id_objetivo, resultado_esperado,
                    rol_responsable, mes_inicio, mes_fin
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id_plan_accion;
                """,
                (
                    id_propuesta,
                    plan.descripcion_actividad,
                    plan.fecha_inicio,
                    plan.fecha_fin,
                    id_responsable,
                    id_objetivo,
                    plan.resultado_esperado,
                    plan.rol_responsable,
                    plan.mes_inicio,
                    plan.mes_fin,
                ),
            )
            plan_ids.append(cur.fetchone()["id_plan_accion"])

        # 7. Matriz de Riesgos (vinculada al primer plan de acción si no se indica uno)
        for indice, riesgo in enumerate(payload.riesgos):
            plan_ref = riesgo.id_plan_accion
            if plan_ref is None and plan_ids:
                plan_ref = plan_ids[min(indice, len(plan_ids) - 1)]
            id_responsable = riesgo.id_usuario_responsable or resolver_usuario_por_correo(riesgo.correo_responsable)
            cur.execute(
                """
                INSERT INTO risks (
                    id_propuesta, descripcion_riesgo, id_nivel_probabilidad,
                    id_nivel_impacto, medida_mitigacion, id_plan_accion, id_usuario_responsable
                ) VALUES (%s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    id_propuesta,
                    riesgo.descripcion_riesgo,
                    riesgo.id_nivel_probabilidad,
                    riesgo.id_nivel_impacto,
                    riesgo.medida_mitigacion,
                    plan_ref if has_plan_fk else None,
                    id_responsable if has_risk_user else None,
                ),
            )

        # 8. Presupuesto Anualizado
        rubros_validos = [b for b in payload.presupuesto if b.monto > 0]
        if rubros_validos:
            if has_anio_col and has_budget_just:
                cur.executemany(
                    """
                    INSERT INTO proposal_budget (id_propuesta, id_rubro, monto, anio, justificacion)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id_propuesta, id_rubro, anio)
                    DO UPDATE SET monto = EXCLUDED.monto, justificacion = EXCLUDED.justificacion;
                    """,
                    [(id_propuesta, b.id_rubro, b.monto, b.anio, b.justificacion) for b in rubros_validos],
                )
            elif has_anio_col:
                cur.executemany(
                    """
                    INSERT INTO proposal_budget (id_propuesta, id_rubro, monto, anio)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (id_propuesta, id_rubro, anio)
                    DO UPDATE SET monto = EXCLUDED.monto;
                    """,
                    [(id_propuesta, b.id_rubro, b.monto, b.anio) for b in rubros_validos],
                )
            else:
                cur.executemany(
                    """
                    INSERT INTO proposal_budget (id_propuesta, id_rubro, monto)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (id_propuesta, id_rubro)
                    DO UPDATE SET monto = EXCLUDED.monto;
                    """,
                    [(id_propuesta, b.id_rubro, b.monto) for b in rubros_validos],
                )

        # 9. Declaraciones Éticas
        if payload.declaraciones_eticas:
            cur.executemany(
                """
                INSERT INTO proposal_ethics_declarations (
                    id_propuesta, tipo_aspecto, aplica, justificacion_exencion,
                    ente_regulatorio, numero_permiso, estado_tramite
                ) VALUES (%s, %s, %s, %s, %s, %s, %s);
                """,
                [
                    (
                        id_propuesta,
                        etica.tipo_aspecto,
                        etica.aplica,
                        etica.justificacion_exencion or "",
                        etica.ente_regulatorio,
                        etica.numero_permiso,
                        etica.estado_tramite,
                    )
                    for etica in payload.declaraciones_eticas
                ],
            )

        # 10. Secciones narrativas extensas
        if payload.secciones and _get_table_columns(cur, "proposal_sections"):
            cur.executemany(
                """
                INSERT INTO proposal_sections (id_propuesta, codigo_seccion, contenido)
                VALUES (%s, %s, %s)
                ON CONFLICT (id_propuesta, codigo_seccion)
                DO UPDATE SET contenido = EXCLUDED.contenido;
                """,
                [(id_propuesta, seccion.codigo_seccion, seccion.contenido) for seccion in payload.secciones],
            )

        # 11. Colaboradores externos
        collab_cols = _get_table_columns(cur, "external_collaborators")
        if collab_cols and payload.colaboradores_externos:
            ejemplo = {
                "id_propuesta": id_propuesta,
                "nombre_completo": None,
                "identificacion_orcid": None,
                "institucion_empresa": None,
                "rol_desempenado": None,
                "carta_compromiso_adjunta": False,
                "horas_semana": None,
                "responsabilidad": None,
            }
            columnas = [k for k in ejemplo if k in collab_cols]
            cur.executemany(
                f"INSERT INTO external_collaborators ({', '.join(columnas)}) VALUES ({', '.join(['%s'] * len(columnas))});",
                [
                    tuple(
                        {
                            "id_propuesta": id_propuesta,
                            "nombre_completo": colaborador.nombre_completo,
                            "identificacion_orcid": colaborador.orcid,
                            "institucion_empresa": colaborador.institucion,
                            "rol_desempenado": colaborador.rol,
                            "carta_compromiso_adjunta": False,
                            "horas_semana": colaborador.horas_asignadas,
                            "responsabilidad": colaborador.responsabilidad,
                        }[columna]
                        for columna in columnas
                    )
                    for colaborador in payload.colaboradores_externos
                ],
            )

        # 12. Documentos reales: la creación no registra metadatos sin archivo.
        # Los archivos se suben después con POST /propuestas/{id}/documentos.
        doc_cols = _get_table_columns(cur, "proposal_documents")
        documentos_validos = [
            documento
            for documento in payload.documentos
            if documento.file_path and (documento.tamano_bytes or 0) > 0
        ]
        if doc_cols and documentos_validos:
            columnas = [
                columna
                for columna in (
                    "id_propuesta",
                    "nombre_archivo",
                    "tipo_documento",
                    "extension",
                    "file_path",
                    "tamano_bytes",
                    "version",
                    "id_usuario_subio",
                )
                if columna in doc_cols
            ]
            filas = []
            for documento in documentos_validos:
                nombre = documento.nombre_archivo
                extension = documento.extension or (nombre.rsplit(".", 1)[-1].lower() if "." in nombre else "pdf")
                fila = {
                    "id_propuesta": id_propuesta,
                    "nombre_archivo": nombre,
                    "tipo_documento": documento.tipo_documento,
                    "extension": extension,
                    "file_path": documento.file_path,
                    "tamano_bytes": documento.tamano_bytes,
                    "version": "1.0",
                    "id_usuario_subio": payload.id_usuario_lider,
                }
                filas.append(tuple(fila[columna] for columna in columnas))
            cur.executemany(
                f"INSERT INTO proposal_documents ({', '.join(columnas)}) VALUES ({', '.join(['%s'] * len(columnas))});",
                filas,
            )

        # 13. Registrar en historial de estados
        cur.execute(
            """
            INSERT INTO proposal_state_history (id_propuesta, id_estado_anterior, id_estado_nuevo, id_usuario_responsable, fecha_cambio, observaciones)
            VALUES (%s, NULL, %s, %s, NOW(), %s);
            """,
            (id_propuesta, estado_inicial, payload.id_usuario_lider, "Creación y envío de la propuesta"),
        )

        # 14. Notificación inicial
        cur.execute(
            """
            INSERT INTO notificaciones (id_usuario, id_propuesta, tipo, titulo, mensaje, fecha_creacion, leida)
            VALUES (%s, %s, 'tramite', 'Propuesta registrada', %s, NOW(), false);
            """,
            (
                payload.id_usuario_lider,
                id_propuesta,
                f"Su propuesta «{payload.titulo}» fue registrada y remitida a revisión de Vinculación.",
            ),
        )

        # [Línea clave]: Consulta y retorna el registro recién creado con su código asignado.
        cur.execute(
            f"SELECT id_propuesta, {code_expr} AS codigo, titulo, estado_actual, fecha_creacion FROM propuestas WHERE id_propuesta = %s",
            (id_propuesta,),
        )
        propuesta_creada = cur.fetchone()

    # La evaluación preliminar es complementaria: se calcula con el motor normativo local para no
    # bloquear la creación esperando a Gemini. La re-evaluación online queda como acción explícita.
    evaluacion_preliminar_ia = None
    try:
        evaluacion_preliminar_ia = generar_y_guardar_evaluacion_ia(id_propuesta, conn, usar_gemini=False)
    except Exception as exc:
        logger.warning("No se pudo generar la evaluación preliminar IA para la propuesta %s: %s", id_propuesta, exc)

    return {
        "ok": True,
        "mensaje": "Propuesta creada exitosamente con todos sus componentes institucionales.",
        "propuesta": propuesta_creada,
        "duplicada": False,
        "evaluacion_preliminar_ia": evaluacion_preliminar_ia,
    }


@router.patch("/{id_propuesta}/estado")
def actualizar_estado_propuesta(
    id_propuesta: int,
    payload: EstadoActualizarIn,
    conn: Connection = Depends(get_conn),
):
    """
    Avanzar o retroceder el estado de tramitación de una propuesta con auditoría y notificación.

    Verifica la existencia de la propuesta, valida que la transición esté admitida por la
    máquina de estados institucional y que el usuario responsable tenga facultad para
    ejecutarla. Después actualiza 'estado_actual' en 'propuestas' y dispara automáticamente
    los triggers de base de datos 'trg_log_proposal_state_change' (auditoría en
    'proposal_state_history') y 'trg_notify_proposal_state_change' (alerta al líder).

    parametros:
        - int : id_propuesta Identificador de la propuesta cuya etapa cambia.
        - EstadoActualizarIn : payload Objeto con el nuevo estado, usuario responsable y observaciones.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + dict : resultado Diccionario con el ID de la propuesta, nuevo estado y nombre del estado.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Obtiene el estado actual de la propuesta antes de actualizar para verificar su existencia.
        cur.execute("SELECT estado_actual, titulo, id_usuario_lider FROM propuestas WHERE id_propuesta = %s", (id_propuesta,))
        actual = cur.fetchone()
        if not actual:
            raise HTTPException(status_code=404, detail="Propuesta no encontrada")

        estado_anterior = actual["estado_actual"]

        # [Línea clave]: La transición se valida por nombre de estado, nunca por su número:
        # el orden de los identificadores de «estados» difiere entre ambientes.
        nombre_origen = nombre_de_estado(cur, estado_anterior)
        nombre_destino = nombre_de_estado(cur, payload.id_nuevo_estado)
        if not nombre_destino:
            raise HTTPException(
                status_code=400,
                detail="El estado indicado no existe en el catálogo institucional.",
            )

        if not transicion_permitida(nombre_origen, nombre_destino):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"La transición «{nombre_origen}» → «{nombre_destino}» no está permitida "
                    "por el flujo institucional de la convocatoria."
                ),
            )

        if not usuario_puede_transicionar(
            cur,
            payload.id_usuario_responsable,
            actual["id_usuario_lider"],
            nombre_origen,
            nombre_destino,
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "El usuario indicado no tiene facultad para ejecutar esta transición "
                    f"desde la etapa «{nombre_origen}»."
                ),
            )

        # [Línea clave]: Ejecuta la actualización de estado que activa los triggers automáticos de PostgreSQL.
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

        # [Línea clave]: Registro de respaldo en la bitácora inmutable de historial de estados.
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

        estado_nombre = {"nombre_estado": nombre_destino}

    nombre_estado_str = estado_nombre["nombre_estado"] if estado_nombre else "Desconocido"

    # [Línea clave]: Al cambiar de estado solo se refresca la auditoría normativa local; Gemini se reserva
    # para la re-evaluación explícita del evaluador.
    evaluacion_preliminar_ia = None
    if any(
        palabra in nombre_estado_str.lower()
        for palabra in ("revisión", "revision", "evaluación", "evaluacion", "sometida", "vinculación", "comité")
    ):
        try:
            evaluacion_preliminar_ia = generar_y_guardar_evaluacion_ia(id_propuesta, conn, usar_gemini=False)
        except Exception:
            pass

    return {
        "ok": True,
        "id_propuesta": actualizado["id_propuesta"],
        "estado_actual": actualizado["estado_actual"],
        "nombre_estado": nombre_estado_str,
        "evaluacion_preliminar_ia": evaluacion_preliminar_ia,
    }


@router.post("/{id_propuesta}/evaluaciones", status_code=status.HTTP_201_CREATED)
def registrar_evaluacion(
    id_propuesta: int,
    payload: EvaluacionIn,
    conn: Connection = Depends(get_conn),
):
    """
    Registrar el dictamen, calificación o resolución emitida por un rol evaluador institucional.

    Inserta el registro base en la tabla 'evaluations'. Si el evaluador es el Comité Técnico y envía
    puntaje, inserta en 'technical_committee_evaluations'. El CIE queda excluido de este endpoint
    genérico: su resolución se emite por 'POST /propuestas/cie/{id_propuesta}', que valida el estado
    «Dictaminada por Dirección» y exige los datos del acuerdo colegiado. Si se suministra
    'cambiar_a_estado', transiciona la propuesta en la misma transacción atómica.

    parametros:
        - int : id_propuesta Identificador de la propuesta evaluada.
        - EvaluacionIn : payload Objeto con evaluador, rol, notas, puntaje opcional y nuevo estado.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + dict : resultado Diccionario con el ID de evaluación generado y nuevo estado de la propuesta.
    """
    with conn.cursor() as cur:
        # [Línea clave]: Valida la existencia de la propuesta a evaluar.
        cur.execute("SELECT id_propuesta, titulo, id_usuario_lider, estado_actual FROM propuestas WHERE id_propuesta = %s", (id_propuesta,))
        prop = cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Propuesta no encontrada")

        # [Línea clave]: El CIE tiene un flujo propio que exige el estado «Dictaminada por Dirección»
        # y el acuerdo colegiado completo. Este endpoint genérico no puede emitir resoluciones del
        # comité porque permitiría saltarse esas garantías y dejar filas sin datos de sesión.
        cur.execute("SELECT nombre_rol FROM roles WHERE id_rol = %s", (payload.id_rol_evaluador,))
        rol_evaluador = cur.fetchone()
        if (rol_evaluador and rol_evaluador["nombre_rol"] in ("CIE", "Evaluador Comité de Ética (CIE)")) or (
            payload.id_resolucion_cie is not None
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "La resolución del Comité de Ética en Investigación se registra con "
                    "POST /propuestas/cie/{id_propuesta}."
                ),
            )

        # [Línea clave]: Inserta la evaluación base en evaluations retornando su id_evaluacion generado.
        cur.execute(
            """
            INSERT INTO evaluations (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
            VALUES (%s, %s, %s, NOW(), %s)
            RETURNING id_evaluacion;
            """,
            (id_propuesta, payload.id_usuario_eval, payload.id_rol_evaluador, payload.observaciones),
        )
        id_eval = cur.fetchone()["id_evaluacion"]

        # [Línea clave]: Registra el puntaje cuantitativo (0-100) si evalúa el Comité Técnico.
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

        # [Línea clave]: Registra la resolución colegiada (Aprobada/Rechazada/Observada) si evalúa el CIE.
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

        # [Línea clave]: Si la evaluación concluye la fase, actualiza automáticamente el estado de la propuesta.
        # La transición se valida contra la máquina de estados y el rol del evaluador: este endpoint
        # genérico no puede ser una puerta trasera para mover el expediente a cualquier etapa.
        nuevo_estado_nombre = None
        if payload.cambiar_a_estado is not None:
            nombre_origen = nombre_de_estado(cur, prop["estado_actual"])
            nombre_destino = nombre_de_estado(cur, payload.cambiar_a_estado)
            if not nombre_destino:
                raise HTTPException(
                    status_code=400,
                    detail="El estado indicado no existe en el catálogo institucional.",
                )
            if not transicion_permitida(nombre_origen, nombre_destino):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"La transición «{nombre_origen}» → «{nombre_destino}» no está permitida "
                        "por el flujo institucional de la convocatoria."
                    ),
                )
            if not usuario_puede_transicionar(
                cur,
                payload.id_usuario_eval,
                prop["id_usuario_lider"],
                nombre_origen,
                nombre_destino,
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "El evaluador indicado no tiene facultad para ejecutar esta transición "
                        f"desde la etapa «{nombre_origen}»."
                    ),
                )
            cur.execute(
                "UPDATE propuestas SET estado_actual = %s WHERE id_propuesta = %s",
                (payload.cambiar_a_estado, id_propuesta),
            )
            nuevo_estado_nombre = nombre_destino

    return {
        "ok": True,
        "id_evaluacion": id_eval,
        "id_propuesta": id_propuesta,
        "nuevo_estado": nuevo_estado_nombre,
        "mensaje": "Evaluación registrada exitosamente.",
    }
