# Validación del Sistema SGPI · Convocatoria Fondos VIE 2027

Este documento resume las pruebas de validación funcional, interfaz de usuario, endpoints de la API REST, el módulo del **Comité Técnico (Migración V12)** y el motor de **Google Gemini IA (Plan Gratuito: `gemini-3.5-flash` con fallback a `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite`)** ejecutadas y comprobadas con éxito.

---

## 1. Validación Automatizada de Endpoints (Backend API, Supabase, Comité Técnico & Gemini IA)

Se ejecutó la suite de verificación automatizada [`test_endpoints.ps1`](../../test_endpoints.ps1), comprobando **las 6 fases completas de extremo a extremo** contra la base de datos PostgreSQL en Supabase, el servicio de IA (`gemini-3.5-flash`) y la nueva lógica del Comité Técnico:

| N° | Endpoint Probado | Método | Resultado | Verificación Normativa / Técnica |
| :---: | :--- | :---: | :---: | :--- |
| **1** | `/health` | `GET` | `[OK 200]` | Conexión transaccional activa con el pooler de Supabase en AWS `us-west-2:6543`. |
| **2** | `/auth/login` | `POST` | `[OK 200]` | Autenticación institucional (`laura.mendez@example.com` / `demostracion`) con verificación HMAC-SHA256. |
| **3** | `/catalogos` | `GET` | `[OK 200]` | Retorno unificado de escuelas, 3 modalidades oficiales, 6 tipos de hora, rubros y estados. |
| **4** | `/tipos_hora/totalTiposHora` | `GET` | `[OK 200]` | Retorno de tipos oficiales: `VIE`, `VIE-Centros`, `CONS`, `REC`, `DOC`, `VIESA`. |
| **5** | `/escuelas/totalescuelas` | `GET` | `[OK 200]` | Catálogo abierto de escuelas del TEC sin obligatoriedad de usuario asignado. |
| **6** | `/convocatorias/documentos_convocatoria?id_convocatoria=1` | `GET` | `[OK 200]` | Carga de los instrumentos oficiales descargables de Fondos VIE 2027 en Supabase Storage. |
| **7** | `/propuestas/dashboardpropuestas?id_usuario=1` | `GET` | `[OK 200]` | Contadores dinámicos para los estados (`formulacion`, `ejecucion`, `cerradas`). |
| **8** | `/propuestas/top3PropuestaMasReciente?id_usuario=1` | `GET` | `[OK 200]` | Obtención de códigos institucionales `SI-YYYY-NNN` y período calculado `2027–2028`. |
| **9** | `/propuestas` (Listado general) | `GET` | `[OK 200]` | Filtros combinados por escuela, modalidad, línea de investigación y estado. |
| **10**| `/propuestas` (Creación atómica) | `POST` | `[OK 200]` | Inserción multitabla en `propuestas`, `team`, `objetivos`, `productos`, `plan`, `riesgos`, `presupuesto` y `ética`. |
| **11**| `/propuestas/{id_propuesta}` | `GET` | `[OK 200]` | Generación del dossier completo, incluyendo la clave `"evaluacion_ia"`. |
| **12**| `/propuestas/{id_propuesta}/estado` | `PATCH` | `[OK 200]` | Transición de estado con inserción automática en `proposal_state_history` y disparo de IA. |
| **13**| `/propuestas/{id_propuesta}/evaluaciones` | `POST` | `[OK 200]` | Registro genérico de calificaciones oficiales por evaluador. |
| **14**| `/notificaciones/leer-todas?id_usuario=1` | `PATCH` | `[OK 200]` | Actualización masiva de lectura de notificaciones en Supabase. |
| **15**| `/ia/estado` | `GET` | `[OK 200]` | Verificación de `GEMINI_API_KEY`, cuotas del Plan Gratuito y modelo activo (`gemini-3.5-flash`). |
| **16**| `/ia/criterios` | `GET` | `[OK 200]` | Retorno de los criterios oficiales de la Rúbrica VIE 2027 y reglas de los 5 niveles. |
| **17**| `/ia/evaluacion-preliminar/{id}` | `GET` | `[OK 200]` | Consulta y persistencia en Supabase de la evaluación preliminar estructurada en 5 niveles. |
| **18**| `/ia/evaluar-borrador` | `POST` | `[OK 200]` | Evaluación de borrador en vivo simulando el envío a revisión (Pantalla 18). |
| **19**| `/ia/evaluar-propuesta/{id}` | `POST` | `[OK 200]` | Regeneración bajo demanda de la evaluación IA desde la interfaz (Pantalla 24). |
| **20**| `/propuestas/comite/rubrica` | `GET` | `[OK 200]` | Catálogo de secciones y criterios ponderados de la rúbrica oficial V12 (100 puntos totales). |
| **21**| `/auth/login` (Comité Técnico) | `POST` | `[OK 200]` | Autenticación de evaluador técnico (`gabriel.sanchez@example.com` / rol Comité Técnico). |
| **22**| `/propuestas/comite/bandeja` | `GET` | `[OK 200]` | Consulta autorizada de expedientes en estado 3 asignados al Comité Técnico. |
| **23**| `/propuestas/comite/bandeja` | `GET` | `[OK 403]` | **Control de Autorización:** Rechazo esperado `403 Forbidden` al consultar la bandeja con rol no autorizado (Investigador). |
| **24**| `/propuestas/comite/{id}` | `GET` | `[OK 200]` | Consulta de expediente técnico sin dictamen para usuario del Comité. |
| **25**| `/propuestas/comite/{id}` | `POST` | `[OK 409]` | **Regla Bloqueante:** Rechazo esperado `409 Conflict` si algún criterio obligatorio tiene nota insuficiente ($< 8$). |
| **26**| `/propuestas/comite/{id}` | `POST` | `[OK 200]` | Dictamen favorable del Comité: cálculo ponderado (100/100) y transición automática a estado 4 (*Pendiente de aval*). |
| **27**| `/propuestas/comite/{id}` | `GET` | `[OK 200]` | Verificación de persistencia del dictamen y puntajes por criterio en `technical_committee_scores`. |
| **28**| `/propuestas/comite/{id}` | `POST` | `[OK 409]` | **Control de Duplicados:** Rechazo esperado `409 Conflict` si se intenta dictaminar una propuesta ya evaluada. |
| **29**| `/propuestas/{id}` (General) | `GET` | `[OK 200]` | El expediente completo refleja la evaluación y criterios calificados por el Comité Técnico. |
| **30**| `/html/SGPI.html` | `GET` | `[OK 200]` | Disponibilidad y correcto funcionamiento del servidor Frontend SPA en Nginx (`http://localhost:8080`). |

---

## 2. Comprobaciones Funcionales de Interfaz y Lógica de Negocio

1. **Autenticación Institucional y Control por Rol:** Valida credenciales contra `usuarios` con hash SHA-256 + HMAC; los endpoints de bandeja y dictamen del Comité Técnico (`/propuestas/comite/*`) rechazan con `403 Forbidden` a usuarios sin el rol correspondiente.
2. **Validación de Formularios, Límites de Caracteres y Listas Cerradas:** Los campos obligatorios vacíos bloquean el avance; cada `<input>` y `<textarea>` aplica `maxlength` acorde a los instrumentos oficiales de `Docs Proyecto` y al esquema relacional; el inicio de sesión permanece libre de contadores visuales para una apariencia limpia, reservándose los contadores interactivos para las secciones de propuestas y convocatorias; los campos de dominio acotado emplean listas `<select>` alimentadas por catálogos oficiales; la dedicación horaria exige $\ge 4\text{ h/semana}$ por investigador.
3. **Protección Multicapa contra Inyección SQL:** Validación preventiva en cliente (`contieneInyeccionSQL`), middleware HTTP en FastAPI (`sql_injection_guard` en `backend/app/main.py`), escape de comodines en búsquedas `ILIKE` (`_escape_ilike`) y consultas parametrizadas (`%s`) en `psycopg`.
4. **Solicitud, Validación ISO 7064 MOD 11-2, Autocompletado y Unicidad del ORCID:** Los códigos ORCID no se generan sintéticamente; se solicitan al investigador, se validan con el algoritmo oficial de dígito verificador **ISO 7064 MOD 11-2** (`esOrcidValido` / `validar_orcid`), se asocian al perfil del investigador para autocompletar al seleccionarlo y se verifica su unicidad entre todos los miembros y colaboradores externos.
5. **Control Presupuestario en Tiempo Real:** Recalcula dinámicamente y bloquea el avance al superar el tope anual de la modalidad; valida estrictamente que partidas de equipo e instrumentación científica se presupuesten solo en el Año 1 (Sección 2.3.9).
6. **Repositorio de Instrumentos VIE 2027:** La tarjeta de instrumentos en Pantalla 05 carga los documentos oficiales dinámicamente desde el Backend y Supabase Storage.
7. **Generación Asíncrona de Evaluación IA:** Al confirmar el envío de la propuesta (Pantalla 18 $\rightarrow$ 19), el frontend dispara la evaluación preliminar con Gemini Online (`gemini-3.5-flash`) y muestra el puntaje sugerido en la pantalla de éxito.
8. **Paneles de Referencia IA Adaptados por Nivel:**
   - **Vinculación (Pantalla 23):** Diagnóstico preliminar de activos de propiedad intelectual y madurez tecnológica (TRL).
   - **Comité Técnico (Pantalla 24):** Rúbrica oficial ponderada V12, advertencia de bloqueo si un obligatorio tiene $< 8$, botón interactivo **«Aplicar puntajes IA como base»**, y transición de estado respaldada en backend.
   - **Consejo de Escuela (Pantalla 25):** Auditoría de carga horaria semanal y pertinencia temática.
   - **Dirección de Investigación (Pantalla 26):** Checklist normativo de 5 puntos de admisibilidad de la VIE.
   - **CIE (Pantalla 27):** Borrador de resolución colegiada motivada para acta formal.
9. **Buscador Facetado e Histórico:** Búsqueda por palabras clave, códigos institucionales (`SI-YYYY-NNN`) y filtros combinados.
10. **Centro de Notificaciones:** Notificaciones automáticas ante cambios de estado de las propuestas registradas por triggers en PostgreSQL y generadas al emitir dictamen favorable.
11. **Compatibilidad Multiplataforma y Responsiva:** Funcionamiento verificado en navegadores modernos de escritorio y dispositivos móviles.
12. **Conmutación Transparente de Hosting:** Funciona de forma idéntica en entorno local (`http://localhost:3001`) y desplegado en la nube (**Frontend en Vercel con `outputDirectory: "frontend"` + Backend en Render + Supabase Cloud**).
