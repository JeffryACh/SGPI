-- ============================================================================
-- ARCHIVO: Base de datos/Scripts/V10__prueba_creacion_de_una_propuesta.sql
-- ============================================================================
-- 2.1. OBJETIVO DEL ARCHIVO:
--      Proveer un script SQL de verificación integral para auditar el expediente
--      completo de una propuesta recién formulada desde la interfaz.
--
-- 2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
--      2.2.1. De dónde obtiene datos:
--             - Consulta 'propuestas', 'research_team', 'proposal_objectives',
--               'academic_product_commitments', 'action_plans', 'risks', 'proposal_budget',
--               'proposal_ethics_declarations', 'proposal_sections', 'proposal_documents',
--               'external_collaborators', 'proposal_state_history', 'notificaciones' y 'ai_preliminary_evaluations'.
--      2.2.2. A dónde envía datos / Qué entidades modifica:
--             - No modifica datos (script de solo lectura para diagnóstico y verificación).
--
-- 2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
--      Ejecuta una consulta agregada con CTEs sobre la propuesta más reciente,
--      verificando los conteos esperados en las 14 tablas hijas y el resultado
--      de la evaluación preliminar generada por la IA de Google Gemini.
-- ============================================================================

-- =====================================================================
-- V10: VERIFICACIÓN DE LA CREACIÓN DE UNA PROPUESTA
-- Sistema de Gestión de Propuestas de Investigación (SGPI - TEC)
-- =====================================================================
-- Script de solo lectura para ejecutar en el SQL Editor de Supabase
-- después de crear una propuesta desde la interfaz.
--
-- Consulta la propuesta más reciente y muestra:
--   - Cabecera y catálogos relacionados.
--   - Conteos de todas las tablas hijas.
--   - Totales de presupuesto por año.
--   - Detalle JSON de equipo, objetivos, productos, plan, riesgos,
--     presupuesto, ética, secciones, documentos, colaboradores,
--     historial y notificaciones.
--   - Resultado de la evaluación preliminar IA.
--
-- Valores esperados para el recorrido por defecto:
--   estado_actual = 2
--   equipo_count = 3
--   objetivos_count = 4
--   productos_count = 3
--   plan_count = 4
--   riesgos_count = 4
--   presupuesto_count = 7
--   presupuesto_total = 9400000
--   presupuesto_anio_1 = 4800000
--   presupuesto_anio_2 = 4600000
--   eticas_count = 4
--   secciones_count = 14
--   documentos_count = 4
--   colaboradores_count = 1 (solo si se agregó uno)
--   historial_count = 1
--   notificaciones_count = 1
--
-- Para consultar una propuesta específica, reemplazar el CTE "ultima" por:
--   SELECT id_propuesta
--   FROM public.propuestas
--   WHERE codigo = 'SI-2027-015'
-- =====================================================================

-- [Línea clave]: ¿Por qué soy importante? CTE que selecciona la propuesta más reciente o una específica. ¿Para qué? Focalizar todas las consultas de verificación sobre el mismo expediente. ¿Dónde me usan? Ejecutado en el SQL Editor de Supabase para pruebas de aceptación.
WITH ultima AS (
  SELECT id_propuesta
  FROM public.propuestas
  ORDER BY fecha_creacion DESC NULLS LAST, id_propuesta DESC
  LIMIT 1
)
SELECT
  p.id_propuesta,
  p.codigo,
  p.titulo,
  p.estado_actual,
  est.nombre_estado,
  p.fecha_creacion,
  p.fecha_inicio,
  p.fecha_fin,
  p.client_uuid,
  u.nombre AS lider,
  u.correo AS correo_lider,
  esc.nombre AS escuela,
  mod.nombre_modalidad AS modalidad,
  lin.nombre_linea AS linea_investigacion,
  conv.nombre AS convocatoria,

  (SELECT count(*) FROM public.research_team rt WHERE rt.id_propuesta = p.id_propuesta) AS equipo_count,
  (SELECT count(*) FROM public.proposal_objectives po WHERE po.id_propuesta = p.id_propuesta) AS objetivos_count,
  (SELECT count(*) FROM public.academic_product_commitments apc WHERE apc.id_propuesta = p.id_propuesta) AS productos_count,
  (SELECT count(*) FROM public.action_plans ap WHERE ap.id_propuesta = p.id_propuesta) AS plan_count,
  (SELECT count(*) FROM public.risks r WHERE r.id_propuesta = p.id_propuesta) AS riesgos_count,
  (SELECT count(*) FROM public.proposal_budget pb WHERE pb.id_propuesta = p.id_propuesta) AS presupuesto_count,
  (SELECT COALESCE(sum(pb.monto), 0) FROM public.proposal_budget pb WHERE pb.id_propuesta = p.id_propuesta) AS presupuesto_total,
  (SELECT COALESCE(sum(pb.monto), 0) FROM public.proposal_budget pb WHERE pb.id_propuesta = p.id_propuesta AND pb.anio = 1) AS presupuesto_anio_1,
  (SELECT COALESCE(sum(pb.monto), 0) FROM public.proposal_budget pb WHERE pb.id_propuesta = p.id_propuesta AND pb.anio = 2) AS presupuesto_anio_2,
  (SELECT count(*) FROM public.proposal_ethics_declarations ped WHERE ped.id_propuesta = p.id_propuesta) AS eticas_count,
  (SELECT count(*) FROM public.proposal_sections ps WHERE ps.id_propuesta = p.id_propuesta) AS secciones_count,
  (SELECT count(*) FROM public.proposal_documents pd WHERE pd.id_propuesta = p.id_propuesta) AS documentos_count,
  (SELECT count(*) FROM public.external_collaborators ec WHERE ec.id_propuesta = p.id_propuesta) AS colaboradores_count,
  (SELECT count(*) FROM public.proposal_state_history psh WHERE psh.id_propuesta = p.id_propuesta) AS historial_count,
  (SELECT count(*) FROM public.notificaciones n WHERE n.id_propuesta = p.id_propuesta) AS notificaciones_count,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'usuario', u2.nombre,
      'correo', u2.correo,
      'tipo_hora', th.nombre_tipo_hora,
      'horas', rt.horas_asignadas
    ) ORDER BY u2.nombre)
    FROM public.research_team rt
    JOIN public.usuarios u2 ON u2.id_usuario = rt.id_usuario
    JOIN public.tipos_hora th ON th.id_tipo_hora = rt.id_tipo_hora
    WHERE rt.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS equipo,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'codigo', po.codigo_objetivo,
      'descripcion', po.descripcion,
      'orden', po.orden
    ) ORDER BY po.orden)
    FROM public.proposal_objectives po
    WHERE po.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS objetivos,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'objetivo', po.codigo_objetivo,
      'tipo', apc.tipo_producto,
      'categoria', apc.categoria,
      'descripcion', apc.descripcion,
      'meta', apc.meta_esperada,
      'obligatorio', apc.es_obligatorio
    ) ORDER BY apc.id_producto)
    FROM public.academic_product_commitments apc
    LEFT JOIN public.proposal_objectives po ON po.id_objetivo = apc.id_objetivo
    WHERE apc.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS productos,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'objetivo', po.codigo_objetivo,
      'actividad', ap.descripcion_actividad,
      'resultado', ap.resultado_esperado,
      'responsable', ur.nombre,
      'correo_responsable', ur.correo,
      'rol', ap.rol_responsable,
      'mes_inicio', ap.mes_inicio,
      'mes_fin', ap.mes_fin,
      'fecha_inicio', ap.fecha_inicio,
      'fecha_fin', ap.fecha_fin
    ) ORDER BY ap.fecha_inicio, ap.id_plan_accion)
    FROM public.action_plans ap
    LEFT JOIN public.proposal_objectives po ON po.id_objetivo = ap.id_objetivo
    LEFT JOIN public.usuarios ur ON ur.id_usuario = ap.id_usuario_responsable
    WHERE ap.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS plan_accion,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'riesgo', r.descripcion_riesgo,
      'mitigacion', r.medida_mitigacion,
      'probabilidad', np.nombre_nivel,
      'impacto', ni.nombre_nivel,
      'responsable', ur.nombre
    ) ORDER BY r.id_riesgo)
    FROM public.risks r
    LEFT JOIN public.niveles_riesgo np ON np.id_nivel_riesgo = r.id_nivel_probabilidad
    LEFT JOIN public.niveles_riesgo ni ON ni.id_nivel_riesgo = r.id_nivel_impacto
    LEFT JOIN public.usuarios ur ON ur.id_usuario = r.id_usuario_responsable
    WHERE r.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS riesgos,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'rubro', rp.nombre_rubro,
      'anio', pb.anio,
      'monto', pb.monto,
      'justificacion', pb.justificacion
    ) ORDER BY pb.anio, rp.nombre_rubro)
    FROM public.proposal_budget pb
    JOIN public.rubros_presupuesto rp ON rp.id_rubro = pb.id_rubro
    WHERE pb.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS presupuesto,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'aspecto', ped.tipo_aspecto,
      'aplica', ped.aplica,
      'justificacion', ped.justificacion_exencion
    ) ORDER BY ped.id_etica)
    FROM public.proposal_ethics_declarations ped
    WHERE ped.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS declaraciones_eticas,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'codigo', ps.codigo_seccion,
      'contenido', ps.contenido
    ) ORDER BY ps.codigo_seccion)
    FROM public.proposal_sections ps
    WHERE ps.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS secciones,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'archivo', pd.nombre_archivo,
      'tipo', pd.tipo_documento,
      'extension', pd.extension,
      'ruta', pd.file_path,
      'bytes', pd.tamano_bytes,
      'version', pd.version
    ) ORDER BY pd.id_documento)
    FROM public.proposal_documents pd
    WHERE pd.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS documentos,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'nombre', ec.nombre_completo,
      'institucion', ec.institucion_empresa,
      'rol', ec.rol_desempenado,
      'orcid', ec.identificacion_orcid,
      'horas', ec.horas_semana,
      'responsabilidad', ec.responsabilidad
    ) ORDER BY ec.id_colaborador)
    FROM public.external_collaborators ec
    WHERE ec.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS colaboradores_externos,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'estado_nuevo', ee.nombre_estado,
      'fecha', psh.fecha_cambio,
      'observaciones', psh.observaciones
    ) ORDER BY psh.fecha_cambio)
    FROM public.proposal_state_history psh
    JOIN public.estados ee ON ee.id_estado = psh.id_estado_nuevo
    WHERE psh.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS historial,

  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'titulo', n.titulo,
      'mensaje', n.mensaje,
      'leida', n.leida,
      'fecha', n.fecha_creacion
    ) ORDER BY n.fecha_creacion)
    FROM public.notificaciones n
    WHERE n.id_propuesta = p.id_propuesta
  ), '[]'::jsonb) AS notificaciones,

  ia.puntaje_preliminar,
  ia.recomendacion_global,
  ia.modo_generacion,
  ia.tiene_bloqueo_obligatorio,
  ia.fecha_generacion AS fecha_evaluacion_ia

FROM public.propuestas p
JOIN public.estados est ON est.id_estado = p.estado_actual
JOIN public.usuarios u ON u.id_usuario = p.id_usuario_lider
JOIN public.escuelas esc ON esc.id_escuela = p.id_escuela
JOIN public.modalidades mod ON mod.id_modalidad = p.id_modalidad
JOIN public.lineas_investigacion lin ON lin.id_linea_investigacion = p.id_linea_investigacion
LEFT JOIN public.convocatorias conv ON conv.id_convocatoria = p.id_convocatoria
LEFT JOIN LATERAL (
  SELECT a.puntaje_preliminar, a.recomendacion_global, a.modo_generacion,
         a.tiene_bloqueo_obligatorio, a.fecha_generacion
  FROM public.ai_preliminary_evaluations a
  WHERE a.id_propuesta = p.id_propuesta
  ORDER BY a.fecha_generacion DESC
  LIMIT 1
) ia ON true
WHERE p.id_propuesta = (SELECT id_propuesta FROM ultima);
