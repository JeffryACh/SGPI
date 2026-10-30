-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.escuelas (
  id_escuela integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre character varying NOT NULL,
  siglas character varying,
  CONSTRAINT escuelas_pkey PRIMARY KEY (id_escuela)
);
CREATE TABLE public.roles (
  id_rol integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_rol character varying NOT NULL,
  CONSTRAINT roles_pkey PRIMARY KEY (id_rol)
);
CREATE TABLE public.estados (
  id_estado integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_estado character varying NOT NULL UNIQUE,
  CONSTRAINT estados_pkey PRIMARY KEY (id_estado)
);
CREATE TABLE public.modalidades (
  id_modalidad integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_modalidad character varying NOT NULL,
  descripcion character varying,
  duracion_maxima character varying,
  monto_financiamiento numeric,
  activo boolean,
  CONSTRAINT modalidades_pkey PRIMARY KEY (id_modalidad)
);
CREATE TABLE public.lineas_investigacion (
  id_linea_investigacion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_linea character varying NOT NULL,
  CONSTRAINT lineas_investigacion_pkey PRIMARY KEY (id_linea_investigacion)
);
CREATE TABLE public.tipos_hora (
  id_tipo_hora integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_tipo_hora character varying NOT NULL,
  CONSTRAINT tipos_hora_pkey PRIMARY KEY (id_tipo_hora)
);
CREATE TABLE public.rubros_presupuesto (
  id_rubro integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_rubro character varying NOT NULL,
  codigo character varying UNIQUE,
  es_bien_duradero boolean NOT NULL DEFAULT false,
  es_beca boolean NOT NULL DEFAULT false,
  CONSTRAINT rubros_presupuesto_pkey PRIMARY KEY (id_rubro)
);
CREATE TABLE public.niveles_riesgo (
  id_nivel_riesgo integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_nivel character varying NOT NULL,
  CONSTRAINT niveles_riesgo_pkey PRIMARY KEY (id_nivel_riesgo)
);
CREATE TABLE public.criterios_verificacion_vie (
  id_criterio integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  descripcion_criterio character varying NOT NULL,
  CONSTRAINT criterios_verificacion_vie_pkey PRIMARY KEY (id_criterio)
);
CREATE TABLE public.resoluciones_cie (
  id_resolucion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_resolucion character varying NOT NULL,
  CONSTRAINT resoluciones_cie_pkey PRIMARY KEY (id_resolucion)
);
CREATE TABLE public.usuarios (
  id_usuario integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_escuela integer,
  nombre character varying NOT NULL,
  lastname character varying NOT NULL,
  second_lastname character varying NOT NULL,
  correo character varying NOT NULL UNIQUE,
  password_hash character varying NOT NULL,
  estado_activo boolean NOT NULL,
  CONSTRAINT usuarios_pkey PRIMARY KEY (id_usuario),
  CONSTRAINT fk_usuarios_escuela FOREIGN KEY (id_escuela) REFERENCES public.escuelas(id_escuela)
);
CREATE TABLE public.user_roles (
  id_usuario integer NOT NULL,
  id_rol integer NOT NULL,
  CONSTRAINT user_roles_pkey PRIMARY KEY (id_usuario, id_rol),
  CONSTRAINT fk_userroles_usuario FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT fk_userroles_rol FOREIGN KEY (id_rol) REFERENCES public.roles(id_rol)
);
CREATE TABLE public.propuestas (
  id_propuesta integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_usuario_lider integer NOT NULL,
  id_escuela integer NOT NULL,
  id_modalidad integer NOT NULL,
  id_linea_investigacion integer NOT NULL,
  titulo character varying NOT NULL,
  resumen character varying,
  estado_actual integer NOT NULL,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT now(),
  codigo character varying UNIQUE,
  id_convocatoria integer,
  fecha_inicio date,
  fecha_fin date,
  trl_inicial integer CHECK (trl_inicial >= 1 AND trl_inicial <= 9),
  trl_esperado integer CHECK (trl_esperado >= 1 AND trl_esperado <= 9),
  client_uuid uuid UNIQUE,
  palabras_clave character varying,
  resumen_en text,
  palabras_clave_en character varying,
  prioridad_nacional_ods character varying,
  potencial_pi boolean,
  activo_previsto text,
  CONSTRAINT propuestas_pkey PRIMARY KEY (id_propuesta),
  CONSTRAINT fk_propuestas_lider FOREIGN KEY (id_usuario_lider) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT fk_propuestas_escuela FOREIGN KEY (id_escuela) REFERENCES public.escuelas(id_escuela),
  CONSTRAINT fk_propuestas_modalidad FOREIGN KEY (id_modalidad) REFERENCES public.modalidades(id_modalidad),
  CONSTRAINT fk_propuestas_linea FOREIGN KEY (id_linea_investigacion) REFERENCES public.lineas_investigacion(id_linea_investigacion),
  CONSTRAINT fk_propuestas_estado FOREIGN KEY (estado_actual) REFERENCES public.estados(id_estado),
  CONSTRAINT propuestas_id_convocatoria_fkey FOREIGN KEY (id_convocatoria) REFERENCES public.convocatorias(id_convocatoria)
);
CREATE TABLE public.research_team (
  id_propuesta integer NOT NULL,
  id_usuario integer NOT NULL,
  id_tipo_hora integer NOT NULL,
  horas_asignadas integer NOT NULL,
  rol character varying NOT NULL DEFAULT 'Investigador'::character varying,
  CONSTRAINT research_team_pkey PRIMARY KEY (id_propuesta, id_usuario, id_tipo_hora),
  CONSTRAINT fk_team_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta),
  CONSTRAINT fk_team_usuario FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT fk_team_tipohora FOREIGN KEY (id_tipo_hora) REFERENCES public.tipos_hora(id_tipo_hora)
);
CREATE TABLE public.proposal_budget (
  id_propuesta integer NOT NULL,
  id_rubro integer NOT NULL,
  monto numeric NOT NULL,
  anio integer NOT NULL DEFAULT 1 CHECK (anio >= 1 AND anio <= 3),
  justificacion text,
  CONSTRAINT proposal_budget_pkey PRIMARY KEY (id_propuesta, id_rubro, anio),
  CONSTRAINT fk_budget_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta),
  CONSTRAINT fk_budget_rubro FOREIGN KEY (id_rubro) REFERENCES public.rubros_presupuesto(id_rubro)
);
CREATE TABLE public.action_plans (
  id_plan_accion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  descripcion_actividad character varying NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date,
  id_usuario_responsable integer,
  id_objetivo integer,
  resultado_esperado character varying,
  rol_responsable character varying,
  mes_inicio integer,
  mes_fin integer,
  CONSTRAINT action_plans_pkey PRIMARY KEY (id_plan_accion),
  CONSTRAINT fk_action_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta),
  CONSTRAINT fk_action_responsable FOREIGN KEY (id_usuario_responsable) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT action_plans_id_objetivo_fkey FOREIGN KEY (id_objetivo) REFERENCES public.proposal_objectives(id_objetivo)
);
CREATE TABLE public.risks (
  id_riesgo integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  descripcion_riesgo character varying NOT NULL,
  id_nivel_probabilidad integer NOT NULL,
  id_nivel_impacto integer NOT NULL,
  medida_mitigacion character varying,
  id_plan_accion integer,
  id_usuario_responsable integer,
  CONSTRAINT risks_pkey PRIMARY KEY (id_riesgo),
  CONSTRAINT fk_risk_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta),
  CONSTRAINT fk_risk_probabilidad FOREIGN KEY (id_nivel_probabilidad) REFERENCES public.niveles_riesgo(id_nivel_riesgo),
  CONSTRAINT fk_risk_impacto FOREIGN KEY (id_nivel_impacto) REFERENCES public.niveles_riesgo(id_nivel_riesgo),
  CONSTRAINT risks_id_plan_accion_fkey FOREIGN KEY (id_plan_accion) REFERENCES public.action_plans(id_plan_accion),
  CONSTRAINT risks_id_usuario_responsable_fkey FOREIGN KEY (id_usuario_responsable) REFERENCES public.usuarios(id_usuario)
);
CREATE TABLE public.proposal_state_history (
  id_historial integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  id_estado_anterior integer,
  id_estado_nuevo integer NOT NULL,
  id_usuario_responsable integer,
  fecha_cambio timestamp without time zone NOT NULL,
  observaciones character varying,
  CONSTRAINT proposal_state_history_pkey PRIMARY KEY (id_historial),
  CONSTRAINT fk_history_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta),
  CONSTRAINT fk_history_estado_anterior FOREIGN KEY (id_estado_anterior) REFERENCES public.estados(id_estado),
  CONSTRAINT fk_history_estado_nuevo FOREIGN KEY (id_estado_nuevo) REFERENCES public.estados(id_estado),
  CONSTRAINT fk_history_responsable FOREIGN KEY (id_usuario_responsable) REFERENCES public.usuarios(id_usuario)
);
CREATE TABLE public.evaluations (
  id_evaluacion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  id_usuario_eval integer NOT NULL,
  id_rol_evaluador integer NOT NULL,
  fecha_evaluacion timestamp without time zone NOT NULL,
  observaciones character varying,
  CONSTRAINT evaluations_pkey PRIMARY KEY (id_evaluacion),
  CONSTRAINT fk_evaluaciones_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta),
  CONSTRAINT fk_evaluaciones_usuario FOREIGN KEY (id_usuario_eval) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT fk_evaluaciones_rol FOREIGN KEY (id_rol_evaluador) REFERENCES public.roles(id_rol)
);
CREATE TABLE public.technical_committee_evaluations (
  id_evaluacion integer NOT NULL,
  puntaje integer NOT NULL,
  CONSTRAINT technical_committee_evaluations_pkey PRIMARY KEY (id_evaluacion),
  CONSTRAINT fk_tech_evaluacion FOREIGN KEY (id_evaluacion) REFERENCES public.evaluations(id_evaluacion)
);
CREATE TABLE public.vie_dictamen_verifications (
  id_evaluacion integer NOT NULL,
  id_criterio integer NOT NULL,
  cumple boolean NOT NULL,
  CONSTRAINT vie_dictamen_verifications_pkey PRIMARY KEY (id_evaluacion, id_criterio),
  CONSTRAINT fk_viedictamen_evaluacion FOREIGN KEY (id_evaluacion) REFERENCES public.evaluations(id_evaluacion),
  CONSTRAINT fk_viedictamen_criterio FOREIGN KEY (id_criterio) REFERENCES public.criterios_verificacion_vie(id_criterio)
);
CREATE TABLE public.cie_resolution_evaluations (
  id_evaluacion integer NOT NULL,
  id_resolucion integer NOT NULL,
  CONSTRAINT cie_resolution_evaluations_pkey PRIMARY KEY (id_evaluacion),
  CONSTRAINT fk_cie_evaluacion FOREIGN KEY (id_evaluacion) REFERENCES public.evaluations(id_evaluacion),
  CONSTRAINT fk_cie_resolucion FOREIGN KEY (id_resolucion) REFERENCES public.resoluciones_cie(id_resolucion)
);
CREATE TABLE public.notificaciones (
  id_notificacion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_usuario integer NOT NULL,
  id_propuesta integer,
  tipo character varying NOT NULL CHECK (tipo::text = ANY (ARRAY['tramite'::character varying, 'convocatoria'::character varying, 'seguimiento'::character varying, 'sistema'::character varying]::text[])),
  titulo character varying NOT NULL,
  mensaje character varying NOT NULL,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT now(),
  leida boolean NOT NULL DEFAULT false,
  fecha_lectura timestamp without time zone,
  CONSTRAINT notificaciones_pkey PRIMARY KEY (id_notificacion),
  CONSTRAINT fk_notif_usuario FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT fk_notif_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta)
);
CREATE TABLE public.convocatorias (
  id_convocatoria integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre character varying NOT NULL,
  descripcion character varying,
  fecha_inicio date NOT NULL,
  fecha_cierre date NOT NULL,
  fecha_inicio_ejecucion date NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  carpeta_storage character varying,
  CONSTRAINT convocatorias_pkey PRIMARY KEY (id_convocatoria)
);
CREATE TABLE public.convocatoria_etapas (
  id_etapa integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_convocatoria integer NOT NULL,
  nombre_etapa character varying NOT NULL,
  responsable character varying NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  orden integer NOT NULL,
  CONSTRAINT convocatoria_etapas_pkey PRIMARY KEY (id_etapa),
  CONSTRAINT fk_etapa_convocatoria FOREIGN KEY (id_convocatoria) REFERENCES public.convocatorias(id_convocatoria)
);
CREATE TABLE public.proposal_documents (
  id_documento integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  nombre_archivo character varying NOT NULL,
  tipo_documento character varying NOT NULL,
  extension character varying NOT NULL,
  file_path character varying NOT NULL,
  tamano_bytes integer NOT NULL,
  version character varying NOT NULL DEFAULT '1.0'::character varying,
  id_usuario_subio integer NOT NULL,
  fecha_subida timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT proposal_documents_pkey PRIMARY KEY (id_documento),
  CONSTRAINT fk_doc_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta),
  CONSTRAINT fk_doc_usuario FOREIGN KEY (id_usuario_subio) REFERENCES public.usuarios(id_usuario)
);
CREATE TABLE public.proposal_objectives (
  id_objetivo integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  codigo_objetivo character varying NOT NULL,
  descripcion character varying NOT NULL,
  orden integer NOT NULL,
  CONSTRAINT proposal_objectives_pkey PRIMARY KEY (id_objetivo),
  CONSTRAINT fk_obj_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta)
);
CREATE TABLE public.council_endorsements (
  id_aval integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  id_escuela integer NOT NULL,
  tipo_instancia character varying NOT NULL CHECK (tipo_instancia::text = ANY (ARRAY['coordinadora'::character varying, 'participante'::character varying]::text[])),
  numero_sesion character varying NOT NULL,
  articulo character varying NOT NULL,
  fecha_acuerdo date NOT NULL,
  numero_oficio character varying NOT NULL,
  ratifica_calificacion boolean NOT NULL DEFAULT true,
  avala_presupuesto boolean NOT NULL DEFAULT true,
  avala_horas_personal boolean NOT NULL DEFAULT true,
  observaciones character varying,
  id_usuario_registro integer NOT NULL,
  fecha_registro timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT council_endorsements_pkey PRIMARY KEY (id_aval),
  CONSTRAINT fk_aval_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta),
  CONSTRAINT fk_aval_escuela FOREIGN KEY (id_escuela) REFERENCES public.escuelas(id_escuela),
  CONSTRAINT fk_aval_usuario FOREIGN KEY (id_usuario_registro) REFERENCES public.usuarios(id_usuario)
);
CREATE TABLE public.vinculacion_evaluations (
  id_evaluacion integer NOT NULL,
  numero_oficio_dictamen character varying NOT NULL,
  potencial_pi_identificado boolean NOT NULL DEFAULT false,
  tipo_innovacion character varying,
  activo_previsto character varying,
  valoracion_tecnica character varying NOT NULL,
  requiere_reserva boolean NOT NULL DEFAULT false,
  CONSTRAINT vinculacion_evaluations_pkey PRIMARY KEY (id_evaluacion),
  CONSTRAINT fk_vinc_evaluacion FOREIGN KEY (id_evaluacion) REFERENCES public.evaluations(id_evaluacion)
);
CREATE TABLE public.rubric_sections (
  id_seccion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_seccion character varying NOT NULL,
  peso_porcentual numeric NOT NULL,
  orden integer NOT NULL,
  CONSTRAINT rubric_sections_pkey PRIMARY KEY (id_seccion)
);
CREATE TABLE public.rubric_criteria (
  id_criterio_rubrica integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_seccion integer NOT NULL,
  nombre_criterio character varying NOT NULL,
  peso_relativo numeric NOT NULL,
  es_obligatorio boolean NOT NULL DEFAULT false,
  orden integer NOT NULL,
  CONSTRAINT rubric_criteria_pkey PRIMARY KEY (id_criterio_rubrica),
  CONSTRAINT fk_crit_seccion FOREIGN KEY (id_seccion) REFERENCES public.rubric_sections(id_seccion)
);
CREATE TABLE public.technical_committee_scores (
  id_evaluacion integer NOT NULL,
  id_criterio_rubrica integer NOT NULL,
  puntaje integer NOT NULL CHECK (puntaje = ANY (ARRAY[0, 6, 8, 10])),
  justificacion character varying,
  CONSTRAINT technical_committee_scores_pkey PRIMARY KEY (id_evaluacion, id_criterio_rubrica),
  CONSTRAINT fk_score_evaluacion FOREIGN KEY (id_evaluacion) REFERENCES public.evaluations(id_evaluacion),
  CONSTRAINT fk_score_criterio FOREIGN KEY (id_criterio_rubrica) REFERENCES public.rubric_criteria(id_criterio_rubrica)
);
CREATE TABLE public.proposal_ethics_declarations (
  id_etica integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  tipo_aspecto character varying NOT NULL,
  aplica boolean NOT NULL,
  ente_regulatorio character varying,
  estado_tramite character varying,
  numero_permiso character varying,
  justificacion_exencion character varying NOT NULL,
  CONSTRAINT proposal_ethics_declarations_pkey PRIMARY KEY (id_etica),
  CONSTRAINT fk_ethics_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta)
);
CREATE TABLE public.academic_product_commitments (
  id_producto integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  id_objetivo integer,
  tipo_producto character varying NOT NULL,
  categoria character varying NOT NULL,
  descripcion character varying NOT NULL,
  meta_esperada character varying NOT NULL,
  es_obligatorio boolean NOT NULL DEFAULT true,
  cumplido boolean NOT NULL DEFAULT false,
  CONSTRAINT academic_product_commitments_pkey PRIMARY KEY (id_producto),
  CONSTRAINT fk_prod_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta),
  CONSTRAINT fk_prod_objetivo FOREIGN KEY (id_objetivo) REFERENCES public.proposal_objectives(id_objetivo)
);
CREATE TABLE public.external_collaborators (
  id_colaborador integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL,
  nombre_completo character varying NOT NULL,
  identificacion_orcid character varying,
  institucion_empresa character varying NOT NULL,
  rol_desempenado character varying NOT NULL,
  carta_compromiso_adjunta boolean NOT NULL DEFAULT false,
  horas_semana integer,
  responsabilidad text,
  CONSTRAINT external_collaborators_pkey PRIMARY KEY (id_colaborador),
  CONSTRAINT fk_collab_propuesta FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta)
);
CREATE TABLE public.convocatoria_documentos (
  id_documento_conv integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_convocatoria integer NOT NULL,
  nombre_documento character varying NOT NULL,
  nombre_archivo character varying NOT NULL,
  tipo_instrumento character varying NOT NULL,
  extension character varying NOT NULL,
  file_url character varying NOT NULL,
  orden integer NOT NULL DEFAULT 1,
  mime_type character varying,
  tamano_bytes integer,
  version character varying NOT NULL DEFAULT '1.0'::character varying,
  activo boolean NOT NULL DEFAULT true,
  fecha_subida timestamp without time zone NOT NULL DEFAULT now(),
  storage_path character varying,
  CONSTRAINT convocatoria_documentos_pkey PRIMARY KEY (id_documento_conv),
  CONSTRAINT convocatoria_documentos_id_convocatoria_fkey FOREIGN KEY (id_convocatoria) REFERENCES public.convocatorias(id_convocatoria)
);
CREATE TABLE public.ai_preliminary_evaluations (
  id_evaluacion_ia integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_propuesta integer NOT NULL UNIQUE,
  modelo_ia character varying NOT NULL DEFAULT 'gemini-2.5-flash'::character varying,
  modo_generacion character varying NOT NULL DEFAULT 'gemini_online'::character varying,
  puntaje_preliminar numeric NOT NULL DEFAULT 0,
  recomendacion_global character varying NOT NULL,
  tiene_bloqueo_obligatorio boolean NOT NULL DEFAULT false,
  resumen_ejecutivo character varying NOT NULL,
  referencia_vinculacion jsonb NOT NULL DEFAULT '{}'::jsonb,
  referencia_comite_tecnico jsonb NOT NULL DEFAULT '{}'::jsonb,
  referencia_consejo_escuela jsonb NOT NULL DEFAULT '{}'::jsonb,
  referencia_direccion_vie jsonb NOT NULL DEFAULT '{}'::jsonb,
  referencia_cie jsonb NOT NULL DEFAULT '{}'::jsonb,
  fortalezas jsonb NOT NULL DEFAULT '[]'::jsonb,
  alertas_normativas jsonb NOT NULL DEFAULT '[]'::jsonb,
  criterios_sugeridos jsonb NOT NULL DEFAULT '{}'::jsonb,
  fecha_generacion timestamp without time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_preliminary_evaluations_pkey PRIMARY KEY (id_evaluacion_ia),
  CONSTRAINT ai_preliminary_evaluations_id_propuesta_fkey FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta)
);
CREATE TABLE public.proposal_sections (
  id_propuesta integer NOT NULL,
  codigo_seccion character varying NOT NULL,
  contenido text NOT NULL DEFAULT ''::text,
  CONSTRAINT proposal_sections_pkey PRIMARY KEY (id_propuesta, codigo_seccion),
  CONSTRAINT proposal_sections_id_propuesta_fkey FOREIGN KEY (id_propuesta) REFERENCES public.propuestas(id_propuesta)
);