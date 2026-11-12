# Bitácora de Cambios y Estructura de la Base de Datos (SGPI)

Este documento registra la evolución del modelo de base de datos relacional para el **Sistema para la Gestión de Propuestas de Investigación (SGPI - TEC)** bajo la normativa de la convocatoria **Fondos VIE 2027**.

---

## 1. Catálogos Base (V1 - Normalización Inicial)

### States (`estados`):
- Catálogo cerrado de los estados posibles de una propuesta (12 estados oficiales de la Convocatoria VIE 2027), evitando texto libre y permitiendo el flujo secuencial de revisión.

### Modalities (`modalidades`):
- Catálogo de las modalidades de la convocatoria Fondos VIE: *Actividad de fortalecimiento*, *Investigación básica, aplicada o ambas*, y *Desarrollo tecnológico*.

### ResearchLines (`lineas_investigacion`):
- Catálogo de líneas de investigación institucionales del TEC, requerido para clasificar propuestas y filtrar el histórico institucional.

### HourTypes (`tipos_hora`):
- Catálogo de los 6 tipos de hora oficiales del TEC (`VIE`, `VIE-Centros`, `CONS`, `REC`, `DOC`, `VIESA`) con que se financia el tiempo de un investigador dentro del equipo.

### BudgetCategories (`rubros_presupuesto`):
- Catálogo de rubros presupuestarios (servicios, viáticos, equipo, materiales, becas estudiante asistente, etc.), usado para desglosar el presupuesto anualizado por rubro.

### RiskLevels (`niveles_riesgo`):
- Catálogo de niveles (*Bajo*, *Medio*, *Alto*, *Crítico*), reutilizado tanto para la probabilidad como para el impacto de un riesgo.

### VIECriteria (`criterios_verificacion_vie`):
- Catálogo de los criterios normativos y de admisibilidad que conforman el dictamen de verificación de la Dirección de Investigación / VIE.

### CIEResolutions (`resoluciones_cie`):
- Catálogo de las resoluciones posibles del Consejo de Investigación y Extensión (*Aprobada*, *Rechazada*, *Con observaciones*).

---

## 2. Entidades Principales y Tablas Hijas

### Proposals (`propuestas`):
- Cabecera del expediente digital de investigación. Centraliza título, resumen, escuela coordinadora, modalidad, línea, líder del proyecto, estado actual, convocatoria y fechas de ejecución.

### ResearchTeam (`research_team`):
- Tabla asociativa entre propuestas y usuarios que registra el equipo investigador completo, con horas asignadas y tipo de hora por persona (`id_tipo_hora`), validando el mínimo de 4 horas semanales por investigador.

### ProposalBudget (`proposal_budget`):
- Desglose del presupuesto de una propuesta por rubro y año de ejecución (`anio`). Permite calcular el monto total derivado con `SUM()` y validar que equipos duraderos se presupuesten solo en el Año 1 (Sección 2.3.9).

### ActionPlans (`action_plans`):
- Cronograma de actividades de la propuesta con fecha de inicio, fecha fin y miembro del equipo responsable, obligatorio por normativa VIE.

### Risks (`risks`):
- Matriz de gestión de riesgos de la propuesta (probabilidad, impacto, medida de mitigación) vinculada directamente a las actividades del plan de acción mediante `id_plan_accion`.

### ProposalStateHistory (`proposal_state_history`):
- Bitácora inmutable de auditoría que registra cada transición de estado (`id_estado_anterior` $\rightarrow$ `id_estado_nuevo`), usuario responsable, marca temporal y observaciones.

### TechnicalCommitteeEvaluations (`technical_committee_evaluations`):
- Detalle de evaluación numérico ($0\text{–}100$) específico del Comité Técnico, alimentado desde la rúbrica ponderada.

### VIEDictamenVerifications (`vie_dictamen_verifications`):
- Detalle del dictamen de admisibilidad de la VIE como checklist booleano por criterio normativo verificado.

### CIEResolutionEvaluations (`cie_resolution_evaluations`):
- Detalle de la resolución formal y colegiada emitida por el CIE.

---

## 3. Extensiones y Migraciones Posteriores (V4 y V5)

### Notificaciones (`notificaciones` - V4):
- Sistema de notificaciones en base de datos para los usuarios del sistema:
  - Campos: `id_notificacion`, `id_usuario`, `id_propuesta`, `tipo` (trámite, convocatoria, seguimiento, sistema), `titulo`, `mensaje`, `fecha_creacion`, `leida`, `fecha_lectura`.
  - Índices optimizados para consulta rápida por usuario y propuestas.

### Convocatorias y Documentos Institucionales (`convocatorias`, `convocatoria_etapas`, `convocatoria_documentos` - V5):
- Digitalización de la Convocatoria Fondos VIE 2027:
  - `convocatorias`: Períodos de apertura, cierre e inicio de ejecución.
  - `convocatoria_etapas`: Las 11 etapas cronológicas oficiales de la convocatoria.
  - `convocatoria_documentos`: Repositorio con los 9 instrumentos oficiales descargables (Disposiciones, Rúbricas, Formularios, Plantillas de Presupuesto, Acuerdos de Consejo).

### Triggers y Funciones Automáticas en PostgreSQL (V5):
1. **`trg_generate_proposal_code()`**: Trigger `BEFORE INSERT` en `propuestas` que genera automáticamente el código institucional único con formato `SI-YYYY-NNN` (por ejemplo: `SI-2027-014`).
2. **`trg_log_proposal_state_change()`**: Trigger `AFTER UPDATE OF estado_actual` en `propuestas` que inserta automáticamente la traza de auditoría en `proposal_state_history`.
3. **`trg_notify_proposal_state_change()`**: Trigger `AFTER UPDATE OF estado_actual` en `propuestas` que inserta automáticamente una notificación dirigida al investigador líder informando el cambio de estado.

---

## 4. Migración V6 — Integración de Evaluación Preliminar IA (Google Gemini Free Tier)

### Script: `Base de datos/Scripts/V6__evaluacion_preliminar_ia.sql`
- **Tabla:** `public.ai_preliminary_evaluations`
- **Propósito:** Almacenar de forma persistente la evaluación preliminar no vinculante generada por **Google Gemini IA (Plan Gratuito: `gemini-3.5-flash`)** cuando una persona investigadora o grupo somete su propuesta a revisión.
- **Estructura y Campos:**
  - `id_evaluacion_ia`: Llave primaria autoincremental (`BIGINT GENERATED ALWAYS AS IDENTITY`).
  - `id_propuesta`: Llave foránea hacia `propuestas(id_propuesta)` con restricción `UNIQUE` y borrado en cascada (`ON DELETE CASCADE`), garantizando una única evaluación activa por propuesta.
  - `modelo_ia`: Identificador del modelo Gemini utilizado (`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-lite-latest`).
  - `modo_generacion`: Trazabilidad del origen (`gemini_online` o `motor_normativo_respaldo`).
  - `puntaje_preliminar`: Calificación cuantitativa $0\text{–}100$ derivada de la rúbrica oficial.
  - `recomendacion_global`: Estado preliminar (*Recomendada*, *No Recomendada*, *Requiere ajustes*).
  - `tiene_bloqueo_obligatorio`: Booleano que se activa si algún criterio obligatorio tiene nota $< 8$.
  - `resumen_ejecutivo`: Síntesis textual del dictamen para lectura rápida de evaluadores.
  - **Columnas JSONB estructuradas por instancia evaluadora:**
    - `referencia_vinculacion`: Análisis de propiedad intelectual (PI), madurez tecnológica (TRL 4 a 7) y resguardo de confidencialidad previo a publicación.
    - `referencia_comite_tecnico`: Desglose cuantitativo, cumplimiento del umbral de 70 puntos y justificación de rúbrica.
    - `referencia_consejo_escuela`: Análisis de viabilidad de dedicación horaria semanal ($\ge 4\text{ h/sem}$ por persona) y pertinencia con líneas de escuela.
    - `referencia_direccion_vie`: Checklist automatizado de los 5 puntos normativos de admisibilidad VIE.
    - `referencia_cie`: Borrador motivado de acuerdo colegiado y valoración de impacto estratégico institucional.
    - `criterios_sugeridos`: Calificación sugerida en escala cerrada `0 / 6 / 8 / 10` para los **19 criterios oficiales** de la convocatoria.
    - `fortalezas` y `alertas_normativas`: Listados de hallazgos positivos e incumplimientos o riesgos detectados.
  - `fecha_generacion`: Timestamp con zona horaria (`TIMESTAMPTZ DEFAULT NOW()`).
- **Seguridad y Políticas RLS:** Habilitación de Row Level Security con políticas de lectura pública y escritura restringida al servicio backend autenticado.
- **Auto-Aprovisionamiento Idempotente:** El backend incluye la rutina `_asegurar_tabla_ia()` que crea la tabla con `CREATE TABLE IF NOT EXISTS` en Supabase al arrancar el servicio si no fue ejecutada manualmente.

---

## 5. Infraestructura en la Nube (Supabase)

- **Instancia:** PostgreSQL 14.17 alojada en AWS región `us-west-2` (Oregon).
- **Project Ref:** `pxlrplbyggoywqbcgjdu`.
- **Pooler:** Supavisor IPv4 en `aws-0-us-west-2.pooler.supabase.com:6543`.
- **Total de tablas activas:** 37 tablas relacionales con integridad referencial, triggers automáticos y Row Level Security (RLS).

---

## 6. Migración V11 — Índices de Rendimiento

### Script: `Base de datos/Scripts/V11__indices_rendimiento.sql`
- **Propósito:** Acelerar las consultas más frecuentes del dashboard, la bandeja de Vinculación, el expediente completo, el historial, las notificaciones y los catálogos de convocatoria, sin tocar la estructura de las tablas.
- **Naturaleza:** Script idempotente (`CREATE INDEX IF NOT EXISTS`) y de solo índices; seguro de reejecutar en el SQL Editor de Supabase.
- **Cobertura principal:**
  - `propuestas`: líder + fecha, estado + fecha, fecha de creación, escuela, modalidad, línea y convocatoria.
  - `research_team (id_usuario, id_propuesta)`: pertenencia del usuario a propuestas (la PK ya cubre el acceso por propuesta).
  - Tablas hijas del expediente por `id_propuesta`: objetivos, productos académicos, plan de acción, riesgos, ética, colaboradores y avales de consejo.
  - `proposal_documents`, `proposal_state_history` y `evaluations`: acceso por propuesta ordenado por fecha.
  - `notificaciones`: historial por usuario e índice parcial de no leídas.
  - `convocatoria_etapas` y `convocatoria_documentos`: acceso por convocatoria y orden.
  - `usuarios (lower(btrim(correo)))`: respalda el login y la resolución de responsables por correo, que ahora usan `lower(btrim(...))`.
- **Refresco de estadísticas:** termina con `ANALYZE` sobre las tablas indexadas para que el planificador aproveche los índices de inmediato.
- **Fuera de alcance:** búsquedas `ILIKE '%texto%'` sobre título o código (requerirían la extensión `pg_trgm`).

---

## 7. Migración V12 — Rúbrica y dictamen del Comité Técnico

### Script: `Base de datos/Scripts/V12__rubrica_comite_tecnico.sql`
- **Propósito:** habilitar la rúbrica ponderada oficial y el dictamen consolidado del Comité Técnico, de modo que el servidor calcule la nota, valide los criterios obligatorios y ejecute la transición de estado.
- **Naturaleza:** script idempotente y aditivo; puede reejecutarse en el SQL Editor de Supabase sin duplicar datos ni romper filas existentes.
- **Semilla de la rúbrica (`rubric_sections` y `rubric_criteria`):**
  - 8 secciones y 23 criterios que suman 100 puntos, copiados de la matriz oficial usada por la pantalla 24.
  - Cada criterio conserva `peso_relativo`, `es_obligatorio` y `orden`; las secciones conservan `peso_porcentual` y `orden`.
  - La semilla solo inserta cuando `rubric_sections` y `rubric_criteria` están vacías (`IF NOT EXISTS`), por lo que reejecutar el script no duplica la rúbrica.
- **Cambios en `technical_committee_evaluations`:**
  - `decision character varying(20) NOT NULL DEFAULT 'favorable'` con `CHECK (decision IN ('favorable', 'observaciones', 'rechazo'))`.
  - `justificacion text` para sustentar la recomendación.
  - `tiene_bloqueo_obligatorio boolean NOT NULL DEFAULT false` para dejar constancia del bloqueo por criterio obligatorio insuficiente.
  - `puntaje` pasa de `integer` a `numeric(5,1)` para conservar el decimal del cálculo ponderado.
- **Uso desde el backend:**
  - `GET /propuestas/comite/rubrica` entrega secciones, criterios y reglas (umbral 70, obligatorios ≥ 8).
  - `POST /propuestas/comite/{id_propuesta}` valida los 23 criterios, calcula `Σ peso × nivel / 10`, rechaza un dictamen favorable si hay bloqueo o si la nota es menor a 70, inserta en `evaluations`, `technical_committee_evaluations` y `technical_committee_scores`, cambia el estado y registra el historial.
  - Transiciones (resueltas por **nombre** desde `estados`, nunca por identificador): `favorable → «Pendiente de aval del Consejo»`, `observaciones → «Con observaciones»` y `rechazo → «Rechazada»` (estado terminal).
  - Si el dictamen es favorable, notifica a los usuarios activos con rol `Consejo de Escuela`.
- **Compatibilidad:** el router responde `503` con un mensaje explícito mientras la migración no esté aplicada, y el expediente general tolera la ausencia de las columnas nuevas.

---

## 8. Migración V16 - Saneamiento y garantía del catálogo de estados

### Script: `Base de datos/Scripts/V16__saneamiento_estados.sql`
- **Propósito:** dejar el catálogo institucional de estados completo y coherente, y reparar los expedientes cuya etapa actual contradice la última decisión registrada en la bitácora.
- **Naturaleza:** script idempotente, sin identificadores fijos y sin borrar filas de auditoría; puede reejecutarse en el SQL Editor de Supabase.
- **Causa raíz que corrige:** durante el desarrollo, algunos routers resolvían el estado destino por identificador numérico fijo (tomado del orden del seed V3) en vez de por su nombre oficial. Como el orden de la tabla `estados` puede diferir entre ambientes, una devolución con observaciones terminaba en «En ejecución» y un rechazo en «Con observaciones».
- **Garantía del catálogo:** inserta los doce estados canónicos con `ON CONFLICT (nombre_estado) DO NOTHING`. El identificador **no** es parte del contrato: el backend (`backend/app/estados.py`) y el frontend (`idEstadoPorNombre`) resuelven siempre por nombre.
- **Detección de inconsistencias:** toma la última fila de `proposal_state_history` de cada expediente y compara su estado de destino con la decisión que esa misma fila registra (`Decisión: observaciones|rechazo`, `Resolución: Con observaciones|No favorable` y los acuerdos del CIE).
- **Reparación (sin eliminar auditoría):**
  - Corrige `proposal_state_history.id_estado_nuevo` de las filas erróneas y añade a `observaciones` la nota `[Saneamiento V16: ...]`.
  - Alinea `propuestas.estado_actual` con la decisión registrada; el trigger `trg_log_proposal_state_change` genera la transición y `trg_notify_proposal_state_change` avisa al investigador líder.
  - Completa esa fila con la explicación del saneamiento y con el responsable institucional de la decisión original.
- **Verificación:** el script termina con cuatro consultas de control: catálogo vigente, expedientes reparados, incoherencias restantes (esperado: cero filas) y bitácora completa de los expedientes reparados.
- **Aplicación:** lo ejecuta el administrador en el SQL Editor de Supabase. En una base de datos coherente no modifica nada y solo muestra los resultados de verificación.

---

## 9. Migración V18 — Persistencia del ORCID en el perfil institucional

### Script: `Base de datos/Scripts/V18__orcid_en_usuarios.sql`
- **Propósito:** guardar en la base de datos el identificador ORCID validado de cada persona investigadora del directorio, de modo que el dato sobreviva a los reinicios del backend y pueda asignarse al mismo crear una cuenta nueva desde el modal de equipo (Pantalla 09).
- **Naturaleza:** script idempotente y aditivo; no modifica, mueve ni elimina filas existentes.
- **Causa raíz que corrige:** hasta la V17 el ORCID de un investigador institucional se conservaba únicamente en los diccionarios en memoria `_ORCID_PERFIL_USUARIOS` y `_ORCID_PERFIL_CORREOS` de `backend/app/routers/auth.py`. Al reiniciar el servidor esa información se perdía y el backend no podía registrar el ORCID de una cuenta recién creada, que el endpoint `POST /propuestas` exige para cada integrante del equipo.
- **Contenido:**
  - `ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS identificacion_orcid character varying;` (columna nullable: las cuentas históricas todavía no tienen ORCID registrado).
  - Índice único parcial `idx_usuarios_identificacion_orcid` sobre `public.usuarios (identificacion_orcid)` con la condición `WHERE identificacion_orcid IS NOT NULL`, que garantiza la unicidad del ORCID entre investigadores y admite varias filas sin ORCID.
- **Compatibilidad:** `backend/app/routers/auth.py` verifica la existencia de la columna contra `information_schema` y cachea el resultado por proceso (`_ORCID_PERSISTENTE_DISPONIBLE`). Si la migración aún no está aplicada, el endpoint sigue funcionando: el ORCID se conserva solo en memoria y `PATCH /auth/usuarios/{id_usuario}/orcid` responde con la validación habitual.
- **Reinicio obligatorio:** después de aplicar el script hay que reiniciar el backend, porque la comprobación de la columna se cachea al iniciar el proceso.
- **Verificación:** consultas de control sobre `information_schema.columns`, `pg_indexes` y las filas de `usuarios` con ORCID registrado.
- **Aplicación:** lo ejecuta el administrador en el SQL Editor de Supabase. Es idempotente: puede reejecutarse sin efectos adicionales.
