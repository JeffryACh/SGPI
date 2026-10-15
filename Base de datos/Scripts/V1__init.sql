-- Creación de la base de datos
-- CREATE DATABASE SGPI;

-- ==========================================
-- 1. CATÁLOGOS
-- ==========================================

-- Tabla: Escuelas
CREATE TABLE escuelas (
    id_escuela SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    siglas VARCHAR(10)
);

-- Tabla: Roles
CREATE TABLE roles (
    id_rol SERIAL PRIMARY KEY,
    nombre_rol VARCHAR(50) NOT NULL
);

-- Tabla: States (Estados de la propuesta)
CREATE TABLE estados (
    id_estado SERIAL PRIMARY KEY,
    nombre_estado VARCHAR(30) NOT NULL UNIQUE
);

-- Tabla: Modalities (Modalidades de la convocatoria)
CREATE TABLE modalidades (
    id_modalidad SERIAL PRIMARY KEY,
    nombre_modalidad VARCHAR(50) NOT NULL
);

-- Tabla: ResearchLines (Líneas de investigación)
CREATE TABLE lineas_investigacion (
    id_linea_investigacion SERIAL PRIMARY KEY,
    nombre_linea VARCHAR(100) NOT NULL
);

-- Tabla: HourTypes (Tipos de hora)
CREATE TABLE tipos_hora (
    id_tipo_hora SERIAL PRIMARY KEY,
    nombre_tipo_hora VARCHAR(20) NOT NULL
);

-- Tabla: BudgetCategories (Rubros presupuestarios)
CREATE TABLE rubros_presupuesto (
    id_rubro SERIAL PRIMARY KEY,
    nombre_rubro VARCHAR(50) NOT NULL
);

-- Tabla: RiskLevels (Niveles de riesgo: probabilidad e impacto)
CREATE TABLE niveles_riesgo (
    id_nivel_riesgo SERIAL PRIMARY KEY,
    nombre_nivel VARCHAR(20) NOT NULL
);

-- Tabla: VIECriteria (Criterios de admisibilidad de la VIE)
CREATE TABLE criterios_verificacion_vie (
    id_criterio SERIAL PRIMARY KEY,
    descripcion_criterio VARCHAR(150) NOT NULL
);

-- Tabla: CIEResolutions (Resoluciones del Comité de Ética Institucional)
CREATE TABLE resoluciones_cie (
    id_resolucion SERIAL PRIMARY KEY,
    nombre_resolucion VARCHAR(20) NOT NULL
);

-- ==========================================
-- 2. USUARIOS Y PERMISOS
-- ==========================================

-- Tabla: Users
CREATE TABLE usuarios (
    id_usuario SERIAL PRIMARY KEY,
    id_escuela INTEGER,
    nombre VARCHAR(50) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    correo VARCHAR(100) NOT NULL UNIQUE,
    estado_activo BOOLEAN NOT NULL,
    CONSTRAINT fk_usuarios_escuela FOREIGN KEY (id_escuela) 
        REFERENCES escuelas(id_escuela)
);

-- Tabla: UserRoles (Tabla intermedia)
CREATE TABLE user_roles (
    id_usuario INTEGER NOT NULL,
    id_rol INTEGER NOT NULL,
    PRIMARY KEY (id_usuario, id_rol),
    CONSTRAINT fk_userroles_usuario FOREIGN KEY (id_usuario) 
        REFERENCES usuarios(id_usuario),
    CONSTRAINT fk_userroles_rol FOREIGN KEY (id_rol) 
        REFERENCES roles(id_rol)
);

-- ==========================================
-- 3. NÚCLEO DE PROPUESTAS Y COMPONENTES
-- ==========================================

-- Tabla: Proposals
CREATE TABLE propuestas (
    id_propuesta SERIAL PRIMARY KEY,
    id_usuario_lider INTEGER NOT NULL,
    id_escuela INTEGER NOT NULL,
    id_modalidad INTEGER NOT NULL,
    id_linea_investigacion INTEGER NOT NULL,
    titulo VARCHAR(250) NOT NULL,
    resumen TEXT,
    estado_actual INTEGER NOT NULL,
    fecha_creacion TIMESTAMP NOT NULL,
    CONSTRAINT fk_propuestas_lider FOREIGN KEY (id_usuario_lider) 
        REFERENCES usuarios(id_usuario),
    CONSTRAINT fk_propuestas_escuela FOREIGN KEY (id_escuela) 
        REFERENCES escuelas(id_escuela),
    CONSTRAINT fk_propuestas_modalidad FOREIGN KEY (id_modalidad) 
        REFERENCES modalidades(id_modalidad),
    CONSTRAINT fk_propuestas_linea FOREIGN KEY (id_linea_investigacion) 
        REFERENCES lineas_investigacion(id_linea_investigacion),
    CONSTRAINT fk_propuestas_estado FOREIGN KEY (estado_actual) 
        REFERENCES estados(id_estado)
);

-- Tabla: ResearchTeam (Equipo de investigación)
CREATE TABLE research_team (
    id_propuesta INTEGER NOT NULL,
    id_usuario INTEGER NOT NULL,
    id_tipo_hora INTEGER NOT NULL,
    horas_asignadas INTEGER NOT NULL,
    PRIMARY KEY (id_propuesta, id_usuario, id_tipo_hora),
    CONSTRAINT fk_team_propuesta FOREIGN KEY (id_propuesta) 
        REFERENCES propuestas(id_propuesta),
    CONSTRAINT fk_team_usuario FOREIGN KEY (id_usuario) 
        REFERENCES usuarios(id_usuario),
    CONSTRAINT fk_team_tipohora FOREIGN KEY (id_tipo_hora) 
        REFERENCES tipos_hora(id_tipo_hora)
);

-- Tabla: ProposalBudget (Desglose presupuestario)
CREATE TABLE proposal_budget (
    id_propuesta INTEGER NOT NULL,
    id_rubro INTEGER NOT NULL,
    monto DECIMAL(12,2) NOT NULL,
    PRIMARY KEY (id_propuesta, id_rubro),
    CONSTRAINT fk_budget_propuesta FOREIGN KEY (id_propuesta) 
        REFERENCES propuestas(id_propuesta),
    CONSTRAINT fk_budget_rubro FOREIGN KEY (id_rubro) 
        REFERENCES rubros_presupuesto(id_rubro)
);

-- Tabla: ActionPlans (Plan de acción)
CREATE TABLE action_plans (
    id_plan_accion SERIAL PRIMARY KEY,
    id_propuesta INTEGER NOT NULL,
    descripcion_actividad TEXT NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE,
    id_usuario_responsable INTEGER,
    CONSTRAINT fk_action_propuesta FOREIGN KEY (id_propuesta) 
        REFERENCES propuestas(id_propuesta),
    CONSTRAINT fk_action_responsable FOREIGN KEY (id_usuario_responsable) 
        REFERENCES usuarios(id_usuario)
);

-- Tabla: Risks (Gestión de riesgos)
CREATE TABLE risks (
    id_riesgo SERIAL PRIMARY KEY,
    id_propuesta INTEGER NOT NULL,
    descripcion_riesgo TEXT NOT NULL,
    id_nivel_probabilidad INTEGER NOT NULL,
    id_nivel_impacto INTEGER NOT NULL,
    medida_mitigacion TEXT,
    CONSTRAINT fk_risk_propuesta FOREIGN KEY (id_propuesta) 
        REFERENCES propuestas(id_propuesta),
    CONSTRAINT fk_risk_probabilidad FOREIGN KEY (id_nivel_probabilidad) 
        REFERENCES niveles_riesgo(id_nivel_riesgo),
    CONSTRAINT fk_risk_impacto FOREIGN KEY (id_nivel_impacto) 
        REFERENCES niveles_riesgo(id_nivel_riesgo)
);

-- Tabla: ProposalStateHistory (Historial de estados de una propuesta)
CREATE TABLE proposal_state_history (
    id_historial SERIAL PRIMARY KEY,
    id_propuesta INTEGER NOT NULL,
    id_estado_anterior INTEGER,
    id_estado_nuevo INTEGER NOT NULL,
    id_usuario_responsable INTEGER,
    fecha_cambio TIMESTAMP NOT NULL,
    observaciones TEXT,
    CONSTRAINT fk_history_propuesta FOREIGN KEY (id_propuesta) 
        REFERENCES propuestas(id_propuesta),
    CONSTRAINT fk_history_estado_anterior FOREIGN KEY (id_estado_anterior) 
        REFERENCES estados(id_estado),
    CONSTRAINT fk_history_estado_nuevo FOREIGN KEY (id_estado_nuevo) 
        REFERENCES estados(id_estado),
    CONSTRAINT fk_history_responsable FOREIGN KEY (id_usuario_responsable) 
        REFERENCES usuarios(id_usuario)
);

-- ==========================================
-- 4. EVALUACIONES Y DICTÁMENES
-- ==========================================

-- Tabla: Evaluations (Base común de evaluaciones)
CREATE TABLE evaluations (
    id_evaluacion SERIAL PRIMARY KEY,
    id_propuesta INTEGER NOT NULL,
    id_usuario_eval INTEGER NOT NULL,
    id_rol_evaluador INTEGER NOT NULL,
    fecha_evaluacion TIMESTAMP NOT NULL,
    observaciones TEXT,
    CONSTRAINT fk_evaluaciones_propuesta FOREIGN KEY (id_propuesta) 
        REFERENCES propuestas(id_propuesta),
    CONSTRAINT fk_evaluaciones_usuario FOREIGN KEY (id_usuario_eval) 
        REFERENCES usuarios(id_usuario),
    CONSTRAINT fk_evaluaciones_rol FOREIGN KEY (id_rol_evaluador) 
        REFERENCES roles(id_rol)
);

-- Tabla: TechnicalCommitteeEvaluations (Detalle comité técnico: rúbrica numérica)
CREATE TABLE technical_committee_evaluations (
    id_evaluacion INTEGER PRIMARY KEY,
    puntaje INTEGER NOT NULL,
    CONSTRAINT fk_tech_evaluacion FOREIGN KEY (id_evaluacion) 
        REFERENCES evaluations(id_evaluacion)
);

-- Tabla: VIEDictamenVerifications (Detalle dictamen de admisibilidad VIE: criterios booleanos)
CREATE TABLE vie_dictamen_verifications (
    id_evaluacion INTEGER NOT NULL,
    id_criterio INTEGER NOT NULL,
    cumple BOOLEAN NOT NULL,
    PRIMARY KEY (id_evaluacion, id_criterio),
    CONSTRAINT fk_viedictamen_evaluacion FOREIGN KEY (id_evaluacion) 
        REFERENCES evaluations(id_evaluacion),
    CONSTRAINT fk_viedictamen_criterio FOREIGN KEY (id_criterio) 
        REFERENCES criterios_verificacion_vie(id_criterio)
);

-- Tabla: CIEResolutionEvaluations (Detalle Comité de Ética Institucional: resolución categórica)
CREATE TABLE cie_resolution_evaluations (
    id_evaluacion INTEGER PRIMARY KEY,
    id_resolucion INTEGER NOT NULL,
    CONSTRAINT fk_cie_evaluacion FOREIGN KEY (id_evaluacion) 
        REFERENCES evaluations(id_evaluacion),
    CONSTRAINT fk_cie_resolucion FOREIGN KEY (id_resolucion) 
        REFERENCES resoluciones_cie(id_resolucion)
);