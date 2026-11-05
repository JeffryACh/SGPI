# Integración Dinámica del Frontend (`app.js`) con el Backend (FastAPI / Supabase / Gemini IA)

Este documento detalla la arquitectura de integración del Frontend SPA con la API REST del SGPI, incluyendo la conmutación de entornos (Local vs. Producción en Vercel/Render), el consumo de endpoints contra **PostgreSQL en Supabase** y el motor de **Evaluación Preliminar con Google Gemini IA (Plan Gratuito: `gemini-3.5-flash` con fallback a `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite`)**.

---

## 1. Conmutación Dinámica de Entornos (`API_URL`)

El cliente HTTP en [`frontend/js/app.js`](file:///C:/Proyecto-Diseño/SGPI/frontend/js/app.js) detecta automáticamente el entorno de ejecución para evitar URLs quemadas o configuraciones manuales:

```javascript
// Detección automática: Vercel (Producción) vs. Docker Local (Desarrollo)
const RENDER_BACKEND_URL = "https://sgpi-backend-api.onrender.com";
const LOCAL_BACKEND_URL = "http://localhost:3001";

const isProduction = typeof window !== "undefined" && 
  (window.location.hostname.includes("vercel.app") || 
   window.location.hostname.includes("onrender.com") ||
   window.location.protocol === "https:");

const API_URL = (typeof window !== "undefined" && window.SGPI_API_URL)
  ? window.SGPI_API_URL
  : (isProduction ? RENDER_BACKEND_URL : LOCAL_BACKEND_URL);
```

---

## 2. Endpoints de la API Consumidos por la Interfaz

| Pantalla | Endpoint Backend | Método | Propósito en el Frontend |
| :--- | :--- | :---: | :--- |
| **01 (Acceso)** | `/auth/login` | `POST` | Autenticación institucional por correo y contraseña contra `usuarios` (hash SHA-256 + HMAC) y retorno del `orcid` asociado al perfil del investigador. |
| **09 / 33 (Equipo y Perfil)** | `/auth/usuarios` | `GET` | Búsqueda de investigadores institucionales activos con escape seguro de comodines `ILIKE` y retorno de su ORCID registrado. |
| **09 / 33 (ORCID Perfil)** | `/auth/usuarios/{id_usuario}/orcid` | `PATCH` | Solicitud, validación ISO 7064 MOD 11-2, unicidad y vinculación del ORCID al perfil institucional del investigador. |
| **02 (Dashboard)** | `/propuestas/dashboardpropuestas?id_usuario=X` | `GET` | Indicadores numéricos reales: total, formulación, ejecución y cerradas. |
| **02 (Dashboard)** | `/propuestas/propuestaMasReciente?id_usuario=X` | `GET` | Tarjeta principal para continuar la propuesta activa en formulación. |
| **02 / 03 / 30** | `/propuestas/top3PropuestaMasReciente?id_usuario=X` | `GET` | Listado de propuestas recientes con código real (`SI-YYYY-NNN`) y período calculado. |
| **03 (Notificaciones)**| `/notificaciones/notificaciones?id_usuario=X` | `GET` | Listado de notificaciones del usuario autenticado en Supabase. |
| **03 (Notificaciones)**| `/notificaciones/{id}/leer` | `PATCH` | Marca una notificación individual como leída. |
| **03 (Notificaciones)**| `/notificaciones/leer-todas?id_usuario=X` | `PATCH` | Marca todas las notificaciones pendientes del usuario como leídas. |
| **04 (Convocatorias)** | `/convocatorias/totalConvocatorias` | `GET` | Listado de convocatorias institucionales registradas. |
| **05 (Detalle Conv.)** | `/convocatorias/etapas_convocatorias?id_convocatoria=X` | `GET` | Las 11 etapas cronológicas oficiales de la convocatoria VIE. |
| **05 (Detalle Conv.)** | `/convocatorias/documentos_convocatoria?id_convocatoria=X` | `GET` | Los 9 instrumentos oficiales descargables de la convocatoria. |
| **07 (Nueva Propuesta)**| `/modalidades/totalmodalidades` | `GET` | Catálogo de modalidades oficiales con topes y descripciones. |
| **08 (Datos Generales)**| `/escuelas/totalescuelas` | `GET` | Catálogo de todas las escuelas del TEC (COMP, BIOL, ADE, etc.). |
| **08 (Líneas Inv.)**  | `/lineas_de_investigacion/totalLineas` | `GET` | Catálogo de líneas de investigación institucionales. |
| **09 (Equipo Inv.)**   | `/tipos_hora/totalTiposHora` | `GET` | Catálogo de los 6 tipos de hora oficiales (`VIE`, `VIE-Centros`, `CONS`, `REC`, `DOC`, `VIESA`). |
| **18 (Envío Propuesta)**| `/propuestas` | `POST` | Creación atómica multitabla de la propuesta completa en Supabase. |
| **18 $\rightarrow$ 19 (Envío IA)** | `/ia/evaluar-borrador` | `POST` | Disparo automático de la evaluación preliminar con Google Gemini Free Tier al pulsar *"Enviar a revisión"*. |
| **20–27 (Evaluación)** | `/propuestas/{id}/estado` | `PATCH` | Cambio de estado de la propuesta ante avales, dictámenes o resoluciones. |
| **22 (Expediente)**    | `/propuestas/{id}` | `GET` | Obtiene el dossier completo de la propuesta, incluyendo el objeto `"evaluacion_ia"`. |
| **22–27 (Panel IA)**   | `/ia/evaluacion-preliminar/{id_propuesta}` | `GET` | Obtiene la evaluación preliminar estructurada en 5 niveles persistida en Supabase. |
| **24 (Rúbrica IA)**    | `/ia/evaluar-propuesta/{id_propuesta}` | `POST` | Regenera bajo demanda la evaluación de Gemini para la propuesta. |
| **24 (Catálogo IA)**   | `/ia/criterios` | `GET` | Obtiene los 19 criterios y pesos oficiales de la rúbrica Fondos VIE 2027. |
| **Diagnóstico**        | `/ia/estado` | `GET` | Diagnóstico de conexión con Google AI Studio, cuotas y modelo activo. |
| **21 (Bandeja Comité)** | `/propuestas/comite/bandeja?rol=...&id_usuario=X` | `GET` | Bandeja de expedientes en estado 3 asignados al Comité Técnico con autorización por rol. |
| **24 (Rúbrica Oficial)**| `/propuestas/comite/rubrica` | `GET` | Catálogo de las 8 secciones y 23 criterios ponderados de la rúbrica oficial (V12). |
| **24 (Expediente Comité)**| `/propuestas/comite/{id}?id_usuario=X` | `GET` | Consulta del expediente técnico y último dictamen emitido por el Comité. |
| **24 (Dictamen Comité)**| `/propuestas/comite/{id}` | `POST` | Emisión del dictamen formal del Comité Técnico (favorable, observaciones, rechazo) con cálculo ponderado y control de obligatorios. |
| **24–27 (Dictamen)**   | `/propuestas/{id}/evaluaciones` | `POST` | Registro genérico de evaluaciones para otras instancias o resoluciones del CIE. |
| **29 (Histórico)**     | `/propuestas` | `GET` | Buscador facetado con filtros combinados por escuela, modalidad y estado. |

---

## 3. Componentes de UI de Inteligencia Artificial en el Frontend

### A. Flujo de Activación al Enviar Propuesta (Pantalla 18 $\rightarrow$ 19)
Al hacer clic en el botón de confirmación (`send-confirm`) de la Pantalla 18:
1. El frontend recolecta los datos formulados en el formulario de 11 pasos.
2. Invoca concurrentemente la creación en backend y la función [`generarEvaluacionPreliminarIA(payload)`](file:///C:/Proyecto-Diseño/SGPI/frontend/js/app.js#L168-L216).
3. Muestra en la Pantalla 19 el código institucional asignado (`SI-YYYY-NNN`) junto con una insignia con el **Puntaje Preliminar sugerido por la IA**.

### B. Tarjeta de Referencia IA en Pantalla 22 (Expediente Digital)
- Muestra el dictamen global (*Recomendada / Requiere ajustes / Bloqueada por criterio obligatorio*).
- Presenta el puntaje ponderado sobre 100%, fortalezas identificadas y alertas normativas de Fondos VIE 2027.
- Proporciona un botón para abrir el modal [`modal-ai-detail`](file:///C:/Proyecto-Diseño/SGPI/frontend/js/app.js#L425-L448) con el desglose completo de los 19 criterios y dictámenes.

### C. Tarjeta Adaptada por Instancia Evaluadora (Pantallas 23 a 27)
La función [`renderizarPanelReferenciaIA(idPantalla)`](file:///C:/Proyecto-Diseño/SGPI/frontend/js/app.js#L254-L424) inyecta una tarjeta específica según el rol que esté evaluando:
- **Pantalla 23 (Centro de Vinculación):** Muestra el potencial de protección de propiedad intelectual, coherencia con TRL 4–7 y advertencias sobre publicación previa a registro.
- **Pantalla 24 (Comité Técnico):** Muestra el puntaje sobre 100%, advertencias de criterios obligatorios y ofrece el botón interactivo **«Aplicar puntajes IA como base»**, que pre-selecciona automáticamente los valores (`0 / 6 / 8 / 10`) en los 19 campos de la rúbrica para que el evaluador pueda afinarlos rápidamente.
- **Pantalla 25 (Consejo de Escuela):** Evalúa la viabilidad horaria del cuerpo docente y la pertinencia temática con los programas de la Escuela.
- **Pantalla 26 (Dirección de Investigación VIE):** Despliega el checklist normativo automatizado de los 5 puntos de admisibilidad de la VIE.
- **Pantalla 27 (Consejo de Investigación y Extensión - CIE):** Presenta un borrador motivado de acuerdo colegiado listo para ser considerado en la sesión.

---

## 4. Variables de Estado Global en el Frontend

```javascript
// URL base de la API REST
const API_URL = ...;

// Cache de catálogos y datos sincronizados con el Backend
let numspropuestas = null;
let top3propuestasmasrecientes = null;
let notificaciones = null;
let modalidades = null;
let escuelas = null;
let lineasInvestigacion = null;
let convocatorias = null;
let etapasConvocatoria = null;
let documentosConvocatoria = null;

// Cache de evaluación preliminar IA para la propuesta activa
let evaluacionIAPerfil = null;
let criteriosOficialesIA = null;
```

---

## 5. Controles de Seguridad, Límites de Caracteres, Listas Cerradas y Validación ORCID (ISO 7064 MOD 11-2)

1. **Límites de Caracteres (`obtenerLimiteCaracteres`)**:
   - Todo campo de texto (`<input>` y `<textarea>`) incorpora el atributo `maxlength` correspondiente a las columnas de PostgreSQL y reglas institucionales VIE 2027 (ej. ORCID `19`, códigos/oficios `30`, correos `120`, nombres `120`, títulos `300`, resúmenes `2500`, secciones extensas `4000`) y trunca entradas excedentes en tiempo real.
2. **Protección contra Inyección SQL (`contieneInyeccionSQL` y `sql_injection_guard`)**:
   - En el cliente (`frontend/js/app.js`), la función `contieneInyeccionSQL(valor)` inspecciona todos los campos antes de guardar o enviar formularios.
   - En el servidor (`backend/app/main.py` y `backend/app/routers/auth.py`), el middleware HTTP `sql_injection_guard` analiza parámetros de consulta y cuerpos JSON rechazando patrones maliciosos con `400 Bad Request`, además del uso estricto de consultas parametrizadas (`%s`) en `psycopg` y escape de comodines en `ILIKE` (`_escape_ilike`).
3. **Listas Desplegables (`<select>`) para Dominios Acotados**:
   - Los campos con valores limitados utilizan selectores cerrados alimentados por catálogos oficiales: escuelas/instancias, modalidades, líneas de investigación, tipos de hora (`VIE`, `VIE-Centros`, `CONS`, `REC`, `DOC`, `VIESA`), niveles de probabilidad/impacto, responsables del equipo (`proposalTeamMembers()`) y tipos de colaboración externa.
4. **Solicitud, Validación ISO 7064 MOD 11-2, Autocompletado y Unicidad del ORCID**:
   - Los códigos ORCID **no se autogeneran**: se solicitan al investigador y se validan sintácticamente (`0000-0000-0000-000X`) y matemáticamente mediante el dígito verificador oficial **ISO 7064 MOD 11-2** tanto en frontend (`esOrcidValido`) como en backend (`validar_orcid`).
   - Cada ORCID está vinculado al perfil del investigador (`ORCID_PERFILES_INSTITUCIONALES` / `state.orcidRegistry` y `PATCH /auth/usuarios/{id}/orcid`). Al seleccionar un investigador que ya posee ORCID registrado en su perfil, el campo se autocompleta; si no posee uno registrado o es colaborador externo, el sistema lo solicita obligatoriamente y verifica que sea único entre todos los participantes.
