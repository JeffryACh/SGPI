-- =====================================================================
-- PARTE 1: CATÁLOGOS INSTITUCIONALES (Requeridos por FKs)
-- =====================================================================

-- 1. Más escuelas para permitir filtros combinados realistas
INSERT INTO public.escuelas (nombre, siglas) VALUES
  ('Escuela de Computación', 'COMP'),
  ('Escuela de Biología', 'BIOL'),
  ('Escuela de Administración de Empresas', 'ADE');

-- 2. Estados de la convocatoria Fondos VIE
INSERT INTO public.estados (nombre_estado) VALUES
  ('En formulación'),
  ('En revisión de Vinculación'),
  ('En evaluación del Comité Técnico'),
  ('Pendiente de aval del Consejo'),
  ('Avalada'),
  ('Sometida ante VIE'),
  ('Dictaminada por Dirección'),
  ('Aprobada por CIE'),
  ('Con observaciones'),
  ('Rechazada'),
  ('En ejecución'),
  ('Cerrada');

-- 3. Modalidades oficiales
INSERT INTO public.modalidades (nombre_modalidad) VALUES
  ('Actividad de fortalecimiento'),
  ('Investigación básica, aplicada o ambas'),
  ('Desarrollo tecnológico');

-- 4. Líneas de investigación institucionales
INSERT INTO public.lineas_investigacion (nombre_linea) VALUES
  ('Gestión integrada del recurso hídrico'),
  ('Inteligencia Artificial y Ciencia de Datos'),
  ('Biotecnología y Sostenibilidad Ambiental'),
  ('Energías Renovables y Redes Eléctricas'),
  ('Sistemas Embebidos y Robótica');

-- 5. Tipos de hora
INSERT INTO public.tipos_hora (nombre_tipo_hora) VALUES
  ('VIE'), ('VIE-Centros'), ('CONS'), ('REC'), ('DOC'), ('VIESA');

-- 6. Rubros de presupuesto institucional
INSERT INTO public.rubros_presupuesto (nombre_rubro) VALUES
  ('Servicios médicos y de laboratorio'),
  ('Transporte dentro del país'),
  ('Viáticos dentro del país'),
  ('Materiales y suministros'),
  ('Becas estudiante asistente especial'),
  ('Equipo y bienes duraderos');

-- 7. Niveles de riesgo
INSERT INTO public.niveles_riesgo (nombre_nivel) VALUES
  ('Bajo'), ('Medio'), ('Alto'), ('Crítico');

-- 8. Criterios de admisibilidad VIE (checklist)
INSERT INTO public.criterios_verificacion_vie (descripcion_criterio) VALUES
  ('Personal investigador al día con informes y compromisos institucionales (sin morosidad)'),
  ('Coherencia de riesgos identificados y viabilidad de medidas de mitigación'),
  ('Inclusión obligatoria de beca para estudiante asistente especial'),
  ('Declaraciones éticas completas y debidamente justificadas'),
  ('Dictamen emitido por el Centro de Vinculación (obligatorio en DT o con potencial PI)');

-- 9. Resoluciones del CIE
INSERT INTO public.resoluciones_cie (nombre_resolucion) VALUES
  ('Aprobada'), ('Rechazada'), ('Observada');


-- =====================================================================
-- PARTE 2: DATOS SEMILLA (PROPUESTAS REALISTAS Y TABLAS HIJAS)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Propuesta 1 (Caso Principal - En Formulación)
-- SI-2027-014 · Agua Inteligente: monitoreo de cuencas
-- ---------------------------------------------------------------------
INSERT INTO public.propuestas (
  id_usuario_lider, id_escuela, id_modalidad, id_linea_investigacion,
  titulo, resumen, estado_actual, fecha_creacion
) VALUES (
  (SELECT id_usuario FROM public.usuarios WHERE correo = 'laura.mendez@example.com'),
  (SELECT id_escuela FROM public.escuelas WHERE siglas = 'IAMB'),
  (SELECT id_modalidad FROM public.modalidades WHERE nombre_modalidad = 'Desarrollo tecnológico'),
  (SELECT id_linea_investigacion FROM public.lineas_investigacion WHERE nombre_linea = 'Gestión integrada del recurso hídrico'),
  'Agua Inteligente: monitoreo de cuencas',
  'Desarrollo y validación de un sistema de monitoreo que integra mediciones de calidad del agua para apoyar decisiones en dos microcuencas piloto.',
  (SELECT id_estado FROM public.estados WHERE nombre_estado = 'En formulación'),
  '2026-08-21 10:00:00'
);

-- Equipo investigador de Propuesta 1 (Laura y Sofía)
INSERT INTO public.research_team (id_propuesta, id_usuario, id_tipo_hora, horas_asignadas)
VALUES
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Agua Inteligente: monitoreo de cuencas'),
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'laura.mendez@example.com'),
    (SELECT id_tipo_hora FROM public.tipos_hora WHERE nombre_tipo_hora = 'VIE'),
    10
  ),
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Agua Inteligente: monitoreo de cuencas'),
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'sofia.vega@example.com'),
    (SELECT id_tipo_hora FROM public.tipos_hora WHERE nombre_tipo_hora = 'CONS'),
    6
  );

-- Presupuesto de Propuesta 1 (₡9.400.000 desglosado)
INSERT INTO public.proposal_budget (id_propuesta, id_rubro, monto)
VALUES
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Agua Inteligente: monitoreo de cuencas'),
    (SELECT id_rubro FROM public.rubros_presupuesto WHERE nombre_rubro = 'Becas estudiante asistente especial'),
    1920000.00
  ),
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Agua Inteligente: monitoreo de cuencas'),
    (SELECT id_rubro FROM public.rubros_presupuesto WHERE nombre_rubro = 'Equipo y bienes duraderos'),
    4500000.00
  ),
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Agua Inteligente: monitoreo de cuencas'),
    (SELECT id_rubro FROM public.rubros_presupuesto WHERE nombre_rubro = 'Materiales y suministros'),
    2980000.00
  );

-- Plan de acción de Propuesta 1
INSERT INTO public.action_plans (id_propuesta, descripcion_actividad, fecha_inicio, fecha_fin, id_usuario_responsable)
VALUES
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Agua Inteligente: monitoreo de cuencas'),
    'Definición de requerimientos y puntos de muestreo en microcuencas piloto',
    '2027-01-15', '2027-04-30',
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'laura.mendez@example.com')
  ),
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Agua Inteligente: monitoreo de cuencas'),
    'Diseño y calibración de prototipo sensorial en laboratorio',
    '2027-05-01', '2027-10-31',
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'sofia.vega@example.com')
  );

-- Matriz de riesgos de Propuesta 1
INSERT INTO public.risks (id_propuesta, descripcion_riesgo, id_nivel_probabilidad, id_nivel_impacto, medida_mitigacion)
VALUES
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Agua Inteligente: monitoreo de cuencas'),
    'Pérdida o vandalismo de sensores en campo por crecidas repentinas o acceso público',
    (SELECT id_nivel_riesgo FROM public.niveles_riesgo WHERE nombre_nivel = 'Medio'),
    (SELECT id_nivel_riesgo FROM public.niveles_riesgo WHERE nombre_nivel = 'Alto'),
    'Instalación en carcasas de alta protección fijadas a estructuras comunales con monitoreo continuo'
  );

-- Historial inicial de Propuesta 1
INSERT INTO public.proposal_state_history (id_propuesta, id_estado_anterior, id_estado_nuevo, id_usuario_responsable, fecha_cambio, observaciones)
VALUES
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Agua Inteligente: monitoreo de cuencas'),
    NULL,
    (SELECT id_estado FROM public.estados WHERE nombre_estado = 'En formulación'),
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'laura.mendez@example.com'),
    '2026-08-21 10:00:00',
    'Creación del borrador de propuesta en convocatoria Fondos VIE 2027'
  );


-- ---------------------------------------------------------------------
-- Propuesta 2 (Histórica Cerrada / Aprobada)
-- SI-2024-008 · Indicadores de sostenibilidad hídrica
-- ---------------------------------------------------------------------
INSERT INTO public.propuestas (
  id_usuario_lider, id_escuela, id_modalidad, id_linea_investigacion,
  titulo, resumen, estado_actual, fecha_creacion
) VALUES (
  (SELECT id_usuario FROM public.usuarios WHERE correo = 'andres.rojas@example.com'),
  (SELECT id_escuela FROM public.escuelas WHERE siglas = 'IELE'),
  (SELECT id_modalidad FROM public.modalidades WHERE nombre_modalidad = 'Investigación básica, aplicada o ambas'),
  (SELECT id_linea_investigacion FROM public.lineas_investigacion WHERE nombre_linea = 'Gestión integrada del recurso hídrico'),
  'Indicadores de sostenibilidad hídrica',
  'Modelo computacional para la evaluación retrospectiva de estrés hídrico en cuencas urbanas durante períodos secos.',
  (SELECT id_estado FROM public.estados WHERE nombre_estado = 'Cerrada'),
  '2024-02-10 08:30:00'
);

INSERT INTO public.research_team (id_propuesta, id_usuario, id_tipo_hora, horas_asignadas)
VALUES (
  (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Indicadores de sostenibilidad hídrica'),
  (SELECT id_usuario FROM public.usuarios WHERE correo = 'andres.rojas@example.com'),
  (SELECT id_tipo_hora FROM public.tipos_hora WHERE nombre_tipo_hora = 'VIE'),
  8
);

INSERT INTO public.proposal_budget (id_propuesta, id_rubro, monto)
VALUES (
  (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Indicadores de sostenibilidad hídrica'),
  (SELECT id_rubro FROM public.rubros_presupuesto WHERE nombre_rubro = 'Servicios médicos y de laboratorio'),
  3800000.00
);


-- ---------------------------------------------------------------------
-- Propuesta 3 (En Ejecución / Aprobada por CIE)
-- SI-2025-019 · Optimización de rutas de transporte mediante algoritmos genéticos
-- ---------------------------------------------------------------------
INSERT INTO public.propuestas (
  id_usuario_lider, id_escuela, id_modalidad, id_linea_investigacion,
  titulo, resumen, estado_actual, fecha_creacion
) VALUES (
  (SELECT id_usuario FROM public.usuarios WHERE correo = 'andres.rojas@example.com'),
  (SELECT id_escuela FROM public.escuelas WHERE siglas = 'COMP'),
  (SELECT id_modalidad FROM public.modalidades WHERE nombre_modalidad = 'Investigación básica, aplicada o ambas'),
  (SELECT id_linea_investigacion FROM public.lineas_investigacion WHERE nombre_linea = 'Inteligencia Artificial y Ciencia de Datos'),
  'Optimización de rutas de transporte mediante algoritmos genéticos',
  'Desarrollo de heurísticas evolutivas aplicadas a la reducción de emisiones en flotas de distribución urbana.',
  (SELECT id_estado FROM public.estados WHERE nombre_estado = 'En ejecución'),
  '2025-03-01 09:15:00'
);


-- ---------------------------------------------------------------------
-- Propuesta 4 (Rechazada)
-- SI-2026-033 · Monitoreo biológico no invasivo de fauna silvestre
-- ---------------------------------------------------------------------
INSERT INTO public.propuestas (
  id_usuario_lider, id_escuela, id_modalidad, id_linea_investigacion,
  titulo, resumen, estado_actual, fecha_creacion
) VALUES (
  (SELECT id_usuario FROM public.usuarios WHERE correo = 'sofia.vega@example.com'),
  (SELECT id_escuela FROM public.escuelas WHERE siglas = 'BIOL'),
  (SELECT id_modalidad FROM public.modalidades WHERE nombre_modalidad = 'Actividad de fortalecimiento'),
  (SELECT id_linea_investigacion FROM public.lineas_investigacion WHERE nombre_linea = 'Biotecnología y Sostenibilidad Ambiental'),
  'Monitoreo biológico no invasivo de fauna silvestre',
  'Instalación de cámaras trampa y bioacústica para el inventario de mamíferos en corredores biológicos.',
  (SELECT id_estado FROM public.estados WHERE nombre_estado = 'Rechazada'),
  '2026-04-12 14:00:00'
);

-- ---------------------------------------------------------------------
-- Equipo y Presupuesto para Propuestas 3 y 4
-- ---------------------------------------------------------------------
INSERT INTO public.research_team (id_propuesta, id_usuario, id_tipo_hora, horas_asignadas)
VALUES
  -- Propuesta 3 (COMP)
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Optimización de rutas de transporte mediante algoritmos genéticos'),
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'andres.rojas@example.com'),
    (SELECT id_tipo_hora FROM public.tipos_hora WHERE nombre_tipo_hora = 'VIE'),
    12
  ),
  -- Propuesta 4 (BIOL)
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Monitoreo biológico no invasivo de fauna silvestre'),
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'sofia.vega@example.com'),
    (SELECT id_tipo_hora FROM public.tipos_hora WHERE nombre_tipo_hora = 'CONS'),
    6
  );

INSERT INTO public.proposal_budget (id_propuesta, id_rubro, monto)
VALUES
  -- Presupuesto Propuesta 3 (₡4.000.000)
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Optimización de rutas de transporte mediante algoritmos genéticos'),
    (SELECT id_rubro FROM public.rubros_presupuesto WHERE nombre_rubro = 'Equipo y bienes duraderos'),
    2500000.00
  ),
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Optimización de rutas de transporte mediante algoritmos genéticos'),
    (SELECT id_rubro FROM public.rubros_presupuesto WHERE nombre_rubro = 'Becas estudiante asistente especial'),
    1500000.00
  ),
  -- Presupuesto Propuesta 4 (₡1.800.000)
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Monitoreo biológico no invasivo de fauna silvestre'),
    (SELECT id_rubro FROM public.rubros_presupuesto WHERE nombre_rubro = 'Materiales y suministros'),
    1800000.00
  );

-- ---------------------------------------------------------------------
-- Evaluaciones Históricas (Comité Técnico, VIE y CIE)
-- ---------------------------------------------------------------------

-- Evaluación favorable de Propuesta 2 por Comité Técnico (nota 88)
INSERT INTO public.evaluations (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
VALUES (
  (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Indicadores de sostenibilidad hídrica'),
  (SELECT id_usuario FROM public.usuarios WHERE correo = 'gabriel.sanchez@example.com'),
  (SELECT id_rol FROM public.roles WHERE nombre_rol = 'Comité Técnico'),
  '2024-03-15 14:30:00',
  'Propuesta metodológicamente sólida con amplia pertinencia institucional.'
);

INSERT INTO public.technical_committee_evaluations (id_evaluacion, puntaje)
VALUES (
  (SELECT currval(pg_get_serial_sequence('public.evaluations', 'id_evaluacion'))),
  88
);

-- Resolución Aprobada de Propuesta 2 por el CIE
INSERT INTO public.evaluations (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
VALUES (
  (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Indicadores de sostenibilidad hídrica'),
  (SELECT id_usuario FROM public.usuarios WHERE correo = 'ricardo.mora@example.com'),
  (SELECT id_rol FROM public.roles WHERE nombre_rol = 'CIE'),
  '2024-04-20 10:00:00',
  'Aprobada según acuerdo CIE-145-2024. Asignación presupuestaria completa.'
);

INSERT INTO public.cie_resolution_evaluations (id_evaluacion, id_resolucion)
VALUES (
  (SELECT currval(pg_get_serial_sequence('public.evaluations', 'id_evaluacion'))),
  (SELECT id_resolucion FROM public.resoluciones_cie WHERE nombre_resolucion = 'Aprobada')
);

-- Evaluación con rechazo de Propuesta 4 por el CIE
INSERT INTO public.evaluations (id_propuesta, id_usuario_eval, id_rol_evaluador, fecha_evaluacion, observaciones)
VALUES (
  (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Monitoreo biológico no invasivo de fauna silvestre'),
  (SELECT id_usuario FROM public.usuarios WHERE correo = 'ricardo.mora@example.com'),
  (SELECT id_rol FROM public.roles WHERE nombre_rol = 'CIE'),
  '2026-05-18 16:00:00',
  'Rechazada por falta de aval ético de la comisión correspondiente y presupuesto incompleto.'
);

INSERT INTO public.cie_resolution_evaluations (id_evaluacion, id_resolucion)
VALUES (
  (SELECT currval(pg_get_serial_sequence('public.evaluations', 'id_evaluacion'))),
  (SELECT id_resolucion FROM public.resoluciones_cie WHERE nombre_resolucion = 'Rechazada')
);

-- ---------------------------------------------------------------------
-- Historial de Transiciones de Estado para Propuesta 2
-- ---------------------------------------------------------------------
INSERT INTO public.proposal_state_history (id_propuesta, id_estado_anterior, id_estado_nuevo, id_usuario_responsable, fecha_cambio, observaciones)
VALUES
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Indicadores de sostenibilidad hídrica'),
    (SELECT id_estado FROM public.estados WHERE nombre_estado = 'En formulación'),
    (SELECT id_estado FROM public.estados WHERE nombre_estado = 'Avalada'),
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'patricia.vargas@example.com'),
    '2024-03-25 11:00:00',
    'Aval unánime emitido en sesión ordinaria del Consejo de Escuela'
  ),
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Indicadores de sostenibilidad hídrica'),
    (SELECT id_estado FROM public.estados WHERE nombre_estado = 'Avalada'),
    (SELECT id_estado FROM public.estados WHERE nombre_estado = 'Aprobada por CIE'),
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'ricardo.mora@example.com'),
    '2024-04-20 10:00:00',
    'Resolución aprobatoria oficial CIE-145-2024'
  ),
  (
    (SELECT id_propuesta FROM public.propuestas WHERE titulo = 'Indicadores de sostenibilidad hídrica'),
    (SELECT id_estado FROM public.estados WHERE nombre_estado = 'En ejecución'),
    (SELECT id_estado FROM public.estados WHERE nombre_estado = 'Cerrada'),
    (SELECT id_usuario FROM public.usuarios WHERE correo = 'elena.chacon@example.com'),
    '2025-12-15 15:30:00',
    'Finiquito exitoso. Productos académicos entregados y verificados por Dirección VIE'
  );