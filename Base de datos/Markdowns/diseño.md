- Motor de base de datos: PostgreSQL 18
- Nombre de la base de datos: SGPI
- Contexto: Sistema para la Gestión de Propuestas de Investigación (SGPI) — digitaliza el ciclo de vida completo de las iniciativas de investigación del TEC bajo la convocatoria de Fondos VIE, desde la formulación de la propuesta hasta su evaluación, resolución, ejecución y cierre, con trazabilidad completa del expediente.

# Tables

## Catálogos

### Schools
Almacena las diferentes escuelas y departamentos del Instituto Tecnológico.

- id_escuela:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico de la escuela

- nombre:
    - tipo: varchar(100)
    - nullable: no
    - descripcion: nombre oficial completo de la escuela

- siglas:
    - tipo: varchar(10)
    - nullable: si
    - descripcion: acronimo representativo

### Roles
Catálogo de roles institucionales.

- id_rol:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico del rol

- nombre_rol:
    - tipo: varchar(50)
    - nullable: no
    - descripcion: nombre descriptivo del rol

### States
Catálogo cerrado de los estados posibles de una propuesta en su flujo de vida.

- id_estado:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico del estado

- nombre_estado:
    - tipo: varchar(30)
    - nullable: no
    - unique: si
    - descripcion: nombre normalizado del estado

### Modalities
Catálogo de modalidades de la convocatoria Fondos VIE.

- id_modalidad:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico de la modalidad

- nombre_modalidad:
    - tipo: varchar(50)
    - nullable: no
    - descripcion: nombre de la modalidad de la convocatoria

### ResearchLines
Catálogo de líneas de investigación institucionales.

- id_linea_investigacion:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico de la linea de investigacion

- nombre_linea:
    - tipo: varchar(100)
    - nullable: no
    - descripcion: nombre de la linea de investigacion

### HourTypes
Catálogo de tipos de hora con que se financia el tiempo asignado a un investigador dentro del equipo.

- id_tipo_hora:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico del tipo de hora

- nombre_tipo_hora:
    - tipo: varchar(20)
    - nullable: no
    - descripcion: codigo o nombre del tipo de hora

### BudgetCategories
Catálogo de rubros presupuestarios institucionales (viáticos, equipo, materiales, servicios, etc.), usado para desglosar el presupuesto de una propuesta.

- id_rubro:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico del rubro presupuestario

- nombre_rubro:
    - tipo: varchar(50)
    - nullable: no
    - descripcion: nombre del rubro presupuestario

### RiskLevels
Catálogo de niveles reutilizado tanto para la probabilidad como para el impacto de un riesgo.

- id_nivel_riesgo:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico del nivel

- nombre_nivel:
    - tipo: varchar(20)
    - nullable: no
    - descripcion: nombre del nivel

### VIECriteria
Catálogo de los criterios booleanos que conforman el dictamen de admisibilidad de la VIE.

- id_criterio:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico del criterio

- descripcion_criterio:
    - tipo: varchar(150)
    - nullable: no
    - descripcion: texto del criterio de verificacion evaluado

### CIEResolutions
Catálogo de las resoluciones posibles del Comité de Ética Institucional.

- id_resolucion:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico de la resolucion

- nombre_resolucion:
    - tipo: varchar(20)
    - nullable: no
    - descripcion: nombre de la resolucion (aprobada, rechazada, observada)

### Users
Registra a investigadores y personal administrativo.

- id_usuario:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico del usuario

- id_escuela:
    - tipo: integer
    - fk: si (referencia a escuelas.id_escuela)
    - nullable: si
    - descripcion: referencia a la escuela base del usuario

- nombre:
    - tipo: varchar(50)
    - nullable: no
    - descripcion: nombre de pila

- apellidos:
    - tipo: varchar(100)
    - nullable: no
    - descripcion: apellidos completos

- correo:
    - tipo: varchar(100)
    - nullable: no
    - unique: si
    - descripcion: correo electronico institucional

- estado_activo:
    - tipo: boolean
    - nullable: no
    - descripcion: indica si el usuario tiene acceso al sistema

### UserRoles
Tabla intermedia para la relación de múltiples usuarios con múltiples roles.

- id_usuario:
    - tipo: integer
    - pk: si
    - fk: si (referencia a usuarios.id_usuario)
    - nullable: no
    - descripcion: referencia al usuario

- id_rol:
    - tipo: integer
    - pk: si
    - fk: si (referencia a roles.id_rol)
    - nullable: no
    - descripcion: referencia al rol asignado

### Proposals
El núcleo del módulo de formulación e histórico.

- id_propuesta:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico de la propuesta

- id_usuario_lider:
    - tipo: integer
    - fk: si (referencia a usuarios.id_usuario)
    - nullable: no
    - descripcion: identificador del investigador principal creador

- id_escuela:
    - tipo: integer
    - fk: si (referencia a escuelas.id_escuela)
    - nullable: no
    - descripcion: escuela bajo la cual se presenta la propuesta (no necesariamente la misma escuela del lider)

- id_modalidad:
    - tipo: integer
    - fk: si (referencia a modalidades.id_modalidad)
    - nullable: no
    - descripcion: modalidad de la convocatoria bajo la que se presenta

- id_linea_investigacion:
    - tipo: integer
    - fk: si (referencia a lineas_investigacion.id_linea_investigacion)
    - nullable: no
    - descripcion: linea de investigacion institucional a la que pertenece

- titulo:
    - tipo: varchar(250)
    - nullable: no
    - descripcion: titulo oficial de la investigacion

- resumen:
    - tipo: text
    - nullable: si
    - descripcion: resumen general del proyecto

- estado_actual:
    - tipo: integer
    - fk: si (referencia a estados.id_estado)
    - nullable: no
    - descripcion: estado actual de la propuesta en el flujo de evaluacion

- fecha_creacion:
    - tipo: timestamp
    - nullable: no
    - descripcion: fecha de inicio de redaccion

### ResearchTeam
Equipo de investigadores asociado a una propuesta, con las horas y el tipo de hora asignadas a cada persona.

- id_propuesta:
    - tipo: integer
    - pk: si
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: no
    - descripcion: propuesta a la que pertenece la asignacion

- id_usuario:
    - tipo: integer
    - pk: si
    - fk: si (referencia a usuarios.id_usuario)
    - nullable: no
    - descripcion: investigador asignado

- id_tipo_hora:
    - tipo: integer
    - pk: si
    - fk: si (referencia a tipos_hora.id_tipo_hora)
    - nullable: no
    - descripcion: tipo de hora bajo la cual se financia esta asignacion

- horas_asignadas:
    - tipo: integer
    - nullable: no
    - descripcion: cantidad de horas asignadas a este investigador bajo este tipo de hora

Nota: PK compuesta (id_propuesta, id_usuario, id_tipo_hora) porque un mismo investigador puede tener horas, de más de un tipo dentro de la misma propuesta.

### ProposalBudget
Desglose del presupuesto solicitado por rubro.

- id_propuesta:
    - tipo: integer
    - pk: si
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: no
    - descripcion: propuesta a la que pertenece este rubro

- id_rubro:
    - tipo: integer
    - pk: si
    - fk: si (referencia a rubros_presupuesto.id_rubro)
    - nullable: no
    - descripcion: rubro presupuestario

- monto:
    - tipo: decimal(12,2)
    - nullable: no
    - descripcion: monto solicitado para este rubro, anualizado en colones

### ActionPlans
Plan de acción de la propuesta, obligatorio por normativa VIE.

- id_plan_accion:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico de la actividad del plan de accion

- id_propuesta:
    - tipo: integer
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: no
    - descripcion: propuesta a la que pertenece esta actividad

- descripcion_actividad:
    - tipo: text
    - nullable: no
    - descripcion: descripcion de la actividad planificada

- fecha_inicio:
    - tipo: date
    - nullable: no
    - descripcion: fecha estimada de inicio de la actividad

- fecha_fin:
    - tipo: date
    - nullable: si
    - descripcion: fecha estimada de finalizacion de la actividad

- id_usuario_responsable:
    - tipo: integer
    - fk: si (referencia a usuarios.id_usuario)
    - nullable: si
    - descripcion: investigador responsable de ejecutar la actividad

### Risks
Gestión de riesgos de la propuesta, obligatoria por normativa VIE.

- id_riesgo:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico del riesgo

- id_propuesta:
    - tipo: integer
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: no
    - descripcion: propuesta a la que pertenece este riesgo

- descripcion_riesgo:
    - tipo: text
    - nullable: no
    - descripcion: descripcion del riesgo identificado

- id_nivel_probabilidad:
    - tipo: integer
    - fk: si (referencia a niveles_riesgo.id_nivel_riesgo)
    - nullable: no
    - descripcion: nivel de probabilidad de ocurrencia del riesgo

- id_nivel_impacto:
    - tipo: integer
    - fk: si (referencia a niveles_riesgo.id_nivel_riesgo)
    - nullable: no
    - descripcion: nivel de impacto del riesgo sobre la propuesta

- medida_mitigacion:
    - tipo: text
    - nullable: si
    - descripcion: accion planteada para mitigar el riesgo

### ProposalStateHistory
Registra cada transición de estado de una propuesta, preservando la trazabilidad completa del expediente.

- id_historial:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico del registro de historial

- id_propuesta:
    - tipo: integer
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: no
    - descripcion: propuesta a la que pertenece esta transicion

- id_estado_anterior:
    - tipo: integer
    - fk: si (referencia a estados.id_estado)
    - nullable: si
    - descripcion: estado previo (nulo si es el registro inicial de creacion)

- id_estado_nuevo:
    - tipo: integer
    - fk: si (referencia a estados.id_estado)
    - nullable: no
    - descripcion: estado al que transiciona la propuesta

- id_usuario_responsable:
    - tipo: integer
    - fk: si (referencia a usuarios.id_usuario)
    - nullable: si
    - descripcion: usuario que ejecuto o disparo el cambio de estado

- fecha_cambio:
    - tipo: timestamp
    - nullable: no
    - descripcion: momento en que ocurrio la transicion

- observaciones:
    - tipo: text
    - nullable: si
    - descripcion: justificacion o comentario asociado al cambio

### Evaluations
Tabla base con los datos comunes a toda evaluación, sin importar quién evalúa. El dato evaluado en sí (rúbrica numérica, checklist booleano o resolución categórica).

- id_evaluacion:
    - tipo: serial
    - pk: si
    - descripcion: identificador unico de la evaluacion

- id_propuesta:
    - tipo: integer
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: no
    - descripcion: propuesta que esta siendo evaluada

- id_usuario_eval:
    - tipo: integer
    - fk: si (referencia a usuarios.id_usuario)
    - nullable: no
    - descripcion: identificador del evaluador asignado

- id_rol_evaluador:
    - tipo: integer
    - fk: si (referencia a roles.id_rol)
    - nullable: no
    - descripcion: rol bajo el cual se realiza la evaluacion

- fecha_evaluacion:
    - tipo: timestamp
    - nullable: no
    - descripcion: fecha de emision del dictamen

- observaciones:
    - tipo: text
    - nullable: si
    - descripcion: retroalimentacion cualitativa general

### TechnicalCommitteeEvaluations
Detalle de la evaluación cuando el evaluador es el Comité Técnico: rúbrica numérica de 0 a 100.

- id_evaluacion:
    - tipo: integer
    - pk: si
    - fk: si (referencia a evaluaciones.id_evaluacion)
    - nullable: no
    - descripcion: evaluacion base a la que pertenece este detalle

- puntaje:
    - tipo: numeric(5,1)
    - nullable: no
    - descripcion: calificacion ponderada oficial calculada a partir de los criterios (0.0 a 100.0)

- decision:
    - tipo: varchar(20)
    - nullable: no
    - default: 'favorable'
    - descripcion: resolucion tecnica del Comite ('favorable', 'observaciones', 'rechazo')

- justificacion:
    - tipo: text
    - nullable: si
    - descripcion: justificacion y sustento tecnico del dictamen emitido

- tiene_bloqueo_obligatorio:
    - tipo: boolean
    - nullable: no
    - default: false
    - descripcion: indica si algun criterio obligatorio obtuvo calificacion insuficiente (< 8)

### RubricSections (`rubric_sections`)
Secciones temáticas en que se divide la rúbrica oficial de evaluación del Comité Técnico.

- id_seccion:
    - tipo: integer
    - pk: si
    - descripcion: identificador unico de la seccion
- nombre_seccion:
    - tipo: varchar
    - nullable: no
    - descripcion: nombre tematico (Equipo, Fundamentacion, Metodologia, Plan de accion, etc.)
- peso_porcentual:
    - tipo: numeric
    - nullable: no
    - descripcion: peso porcentual de la seccion sobre la nota final (suma 100)
- orden:
    - tipo: integer
    - nullable: no
    - descripcion: orden secuencial de visualizacion en la rubrica

### RubricCriteria (`rubric_criteria`)
Criterios individuales evaluados por el Comité Técnico dentro de cada sección.

- id_criterio_rubrica:
    - tipo: integer
    - pk: si
    - descripcion: identificador unico del criterio
- id_seccion:
    - tipo: integer
    - fk: si (referencia a rubric_sections.id_seccion)
    - nullable: no
    - descripcion: seccion tematica a la que pertenece el criterio
- nombre_criterio:
    - tipo: varchar
    - nullable: no
    - descripcion: enunciado del criterio evaluado
- peso_relativo:
    - tipo: numeric
    - nullable: no
    - descripcion: peso relativo individual del criterio
- es_obligatorio:
    - tipo: boolean
    - nullable: no
    - default: false
    - descripcion: indica si el criterio es obligatorio (requiere calificacion >= 8 para dictamen favorable)
- orden:
    - tipo: integer
    - nullable: no
    - descripcion: posicion del criterio dentro de su seccion

### TechnicalCommitteeScores (`technical_committee_scores`)
Calificación asignada por el Comité Técnico a cada criterio específico dentro de una evaluación.

- id_evaluacion:
    - tipo: integer
    - pk: si
    - fk: si (referencia a evaluations.id_evaluacion)
    - nullable: no
    - descripcion: evaluacion a la que corresponde la calificacion
- id_criterio_rubrica:
    - tipo: integer
    - pk: si
    - fk: si (referencia a rubric_criteria.id_criterio_rubrica)
    - nullable: no
    - descripcion: criterio de la rubrica evaluado
- puntaje:
    - tipo: integer
    - nullable: no
    - descripcion: nivel asignado en la escala cerrada institucional (0, 6, 8 o 10)
- justificacion:
    - tipo: varchar
    - nullable: si
    - descripcion: observaciones o justificacion especifica para este criterio

### VIEDictamenVerifications
Detalle del dictamen de admisibilidad de la VIE: una fila por criterio verificado, no una fila por evaluación.

- id_evaluacion:
    - tipo: integer
    - pk: si
    - fk: si (referencia a evaluaciones.id_evaluacion)
    - nullable: no
    - descripcion: evaluacion base a la que pertenece esta verificacion

- id_criterio:
    - tipo: integer
    - pk: si
    - fk: si (referencia a criterios_verificacion_vie.id_criterio)
    - nullable: no
    - descripcion: criterio de verificacion evaluado

- cumple:
    - tipo: boolean
    - nullable: no
    - descripcion: indica si la propuesta cumple con este criterio

### CIEResolutionEvaluations
Detalle de la evaluación cuando el evaluador es el Comité de Ética Institucional: resolución categórica.

- id_evaluacion:
    - tipo: integer
    - pk: si
    - fk: si (referencia a evaluaciones.id_evaluacion)
    - nullable: no
    - descripcion: evaluacion base a la que pertenece este detalle

- id_resolucion:
    - tipo: integer
    - fk: si (referencia a resoluciones_cie.id_resolucion)
    - nullable: no
    - descripcion: resolucion emitida por el CIE


### Notifications
Registro persistente de notificaciones dirigidas a usuarios sobre trámites, convocatorias y actualizaciones de estado de propuestas.

- id_notificacion:
    - tipo: serial (identity)
    - pk: si
    - descripcion: identificador unico de la notificacion
- id_usuario:
    - tipo: integer
    - fk: si (referencia a usuarios.id_usuario)
    - nullable: no
    - descripcion: usuario receptor de la notificacion
- id_propuesta:
    - tipo: integer
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: si
    - descripcion: propuesta vinculada al tramite
- tipo:
    - tipo: varchar(20)
    - nullable: no
    - descripcion: categoria (tramite, convocatoria, seguimiento, sistema)
- titulo:
    - tipo: varchar(150)
    - nullable: no
    - descripcion: encabezado breve de la notificacion
- mensaje:
    - tipo: text
    - nullable: no
    - descripcion: detalle explicativo del evento
- fecha_creacion:
    - tipo: timestamp
    - nullable: no
    - descripcion: momento de generacion de la notificacion
- leida:
    - tipo: boolean
    - nullable: no
    - descripcion: estado de lectura por el usuario
- fecha_lectura:
    - tipo: timestamp
    - nullable: si
    - descripcion: momento en que el usuario marco la notificacion como leida

### Convocatorias
Registro de convocatorias institucionales con plazos oficiales de postulación y ejecución.

- id_convocatoria:
    - tipo: serial (identity)
    - pk: si
    - descripcion: identificador unico de la convocatoria
- nombre:
    - tipo: varchar(200)
    - nullable: no
    - descripcion: nombre oficial de la convocatoria (ej. Fondos VIE 2027)
- descripcion:
    - tipo: text
    - nullable: si
    - descripcion: justificacion y normativa base
- fecha_inicio:
    - tipo: date
    - nullable: no
    - descripcion: fecha de apertura de postulacion
- fecha_cierre:
    - tipo: date
    - nullable: no
    - descripcion: fecha límite de sometimiento
- fecha_inicio_ejecucion:
    - tipo: date
    - nullable: no
    - descripcion: fecha oficial de inicio de actividades aprobadas
- activo:
    - tipo: boolean
    - nullable: no
    - descripcion: bandera de vigencia

### ConvocatoriaEtapas
Las 11 etapas cronológicas oficiales de la convocatoria Fondos VIE 2027.

- id_etapa:
    - tipo: serial (identity)
    - pk: si
- id_convocatoria:
    - tipo: integer
    - fk: si (referencia a convocatorias.id_convocatoria)
    - nullable: no
- nombre_etapa:
    - tipo: varchar(200)
    - nullable: no
- responsable:
    - tipo: varchar(100)
    - nullable: no
- fecha_inicio:
    - tipo: date
    - nullable: no
- fecha_fin:
    - tipo: date
    - nullable: no
- orden:
    - tipo: integer
    - nullable: no

### ConvocatoriaDocumentos
Los 9 instrumentos oficiales descargables de la convocatoria.

- id_documento_conv:
    - tipo: serial (identity)
    - pk: si
- id_convocatoria:
    - tipo: integer
    - fk: si (referencia a convocatorias.id_convocatoria)
    - nullable: no
- nombre_documento:
    - tipo: varchar(250)
    - nullable: no
- nombre_archivo:
    - tipo: varchar(250)
    - nullable: no
- tipo_instrumento:
    - tipo: varchar(80)
    - nullable: no
- extension:
    - tipo: varchar(15)
    - nullable: no
- file_url:
    - tipo: varchar(500)
    - nullable: no
- orden:
    - tipo: integer
    - nullable: no

### ProposalObjectives
Objetivos generales y específicos definidos para la propuesta.

- id_objetivo:
    - tipo: serial (identity)
    - pk: si
- id_propuesta:
    - tipo: integer
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: no
- codigo_objetivo:
    - tipo: varchar(10)
    - nullable: no
    - descripcion: codigo nemotecnico (OG, OE1, OE2, etc.)
- descripcion:
    - tipo: text
    - nullable: no
- orden:
    - tipo: integer
    - nullable: no

### AcademicProductCommitments
Compromisos de productos académicos vinculados a los objetivos y calculados por cuota horaria.

- id_producto:
    - tipo: serial (identity)
    - pk: si
- id_propuesta:
    - tipo: integer
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: no
- id_objetivo:
    - tipo: integer
    - fk: si (referencia a proposal_objectives.id_objetivo)
    - nullable: si
- tipo_producto:
    - tipo: varchar(100)
    - nullable: no
- descripcion:
    - tipo: text
    - nullable: no
- meta_esperada:
    - tipo: varchar(200)
    - nullable: no
- categoria:
    - tipo: varchar(100)
    - nullable: no
- es_obligatorio:
    - tipo: boolean
    - nullable: no
- cumplido:
    - tipo: boolean
    - nullable: no

### ProposalEthicsDeclarations
Declaraciones de aspectos bioéticos y ambientales de la propuesta.

- id_etica:
    - tipo: serial (identity)
    - pk: si
- id_propuesta:
    - tipo: integer
    - fk: si (referencia a propuestas.id_propuesta)
    - nullable: no
- tipo_aspecto:
    - tipo: varchar(100)
    - nullable: no
- aplica:
    - tipo: boolean
    - nullable: no
- justificacion_exencion:
    - tipo: text
    - nullable: si
- ente_regulatorio:
    - tipo: varchar(150)
    - nullable: si
- numero_permiso:
    - tipo: varchar(100)
    - nullable: si
- estado_tramite:
    - tipo: varchar(50)
    - nullable: si


### AIPreliminaryEvaluations (`ai_preliminary_evaluations`)
Almacena el dictamen preliminar no vinculante generado automáticamente por la IA de Google Gemini (Plan Gratuito: `gemini-3.5-flash` con fallback a `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite`) estructurado en 5 niveles para asistir a los evaluadores institucionales de Fondos VIE 2027.

- id_evaluacion_ia:
    - tipo: bigint generated always as identity
    - pk: si
    - descripcion: identificador único de la evaluación de IA
- id_propuesta:
    - tipo: integer
    - fk: si (referencia a propuestas.id_propuesta con ON DELETE CASCADE)
    - unique: si
    - nullable: no
    - descripcion: propuesta evaluada
- modelo_ia:
    - tipo: varchar(100)
    - nullable: no
    - default: 'gemini-3.5-flash'
    - descripcion: modelo de Gemini utilizado (`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-lite-latest`)
- modo_generacion:
    - tipo: varchar(50)
    - nullable: no
    - default: 'gemini_online'
    - descripcion: modo de generación ('gemini_online' o 'motor_normativo_respaldo')
- puntaje_preliminar:
    - tipo: numeric(5, 2)
    - nullable: no
    - default: 0.00
    - descripcion: calificación global sobre 100 calculada según la rúbrica ponderada
- recomendacion_global:
    - tipo: varchar(50)
    - nullable: no
    - default: 'Pendiente'
    - descripcion: recomendación preliminar ('Recomendada', 'No Recomendada', 'Requiere ajustes')
- tiene_bloqueo_obligatorio:
    - tipo: boolean
    - nullable: no
    - default: false
    - descripcion: true si algún criterio obligatorio obtuvo calificación menor a 8 (0 o 6)
- resumen_ejecutivo:
    - tipo: text
    - nullable: si
    - descripcion: síntesis ejecutiva del dictamen preliminar
- referencia_vinculacion:
    - tipo: jsonb
    - nullable: no
    - default: '{}'
    - descripcion: dictamen para Vinculación (potencial de PI, coherencia TRL 4-7, cláusula de confidencialidad)
- referencia_comite_tecnico:
    - tipo: jsonb
    - nullable: no
    - default: '{}'
    - descripcion: dictamen para Comité Técnico (puntaje ponderado, cumplimiento de umbral 70 y justificación de rúbrica)
- referencia_consejo_escuela:
    - tipo: jsonb
    - nullable: no
    - default: '{}'
    - descripcion: dictamen para Consejo de Escuela (viabilidad horaria, pertinencia con programas y presupuesto a avalar)
- referencia_direccion_vie:
    - tipo: jsonb
    - nullable: no
    - default: '{}'
    - descripcion: dictamen para Dirección de Investigación VIE (checklist normativo de 5 puntos de admisibilidad)
- referencia_cie:
    - tipo: jsonb
    - nullable: no
    - default: '{}'
    - descripcion: dictamen para CIE (resolución sugerida, borrador de acuerdo de aprobación e impacto estratégico)
- criterios_sugeridos:
    - tipo: jsonb
    - nullable: no
    - default: '{}'
    - descripcion: desglose de calificaciones 0/6/8/10 para los 19 criterios oficiales de la convocatoria
- fortalezas:
    - tipo: jsonb
    - nullable: no
    - default: '[]'
    - descripcion: lista de fortalezas detectadas en la propuesta
- alertas_normativas:
    - tipo: jsonb
    - nullable: no
    - default: '[]'
    - descripcion: advertencias normativas o bloqueos detectados según las Disposiciones VIE 2027
- fecha_generacion:
    - tipo: timestamptz
    - nullable: no
    - default: now()
    - descripcion: marca temporal de generación o actualización del dictamen
