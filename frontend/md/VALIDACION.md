# Validación del Sistema SGPI · Convocatoria Fondos VIE 2027

Este documento resume las pruebas de validación funcional, interfaz de usuario, endpoints de la API REST y el motor de **Google Gemini IA (Plan Gratuito)** ejecutadas y comprobadas con éxito.

---

## 1. Validación Automatizada de Endpoints (Backend API, Supabase & Gemini IA)

Se ejecutó la suite de verificación automatizada [`test_endpoints.ps1`](../../test_endpoints.ps1), comprobando **15 casos de uso de extremo a extremo** contra la base de datos PostgreSQL en Supabase y el servicio de IA:

| N° | Endpoint Probado | Método | Resultado | Verificación Normativa / Técnica |
| :---: | :--- | :---: | :---: | :--- |
| **1** | `/health` | `GET` | `[OK 200]` | Conexión transaccional activa con el pooler de Supabase en AWS `us-west-2:6543`. |
| **2** | `/catalogos` | `GET` | `[OK 200]` | Retorno unificado de escuelas, 3 modalidades oficiales, 6 tipos de hora, rubros y estados. |
| **3** | `/tipos_hora/totalTiposHora` | `GET` | `[OK 200]` | Retorno de tipos oficiales: `VIE`, `VIE-Centros`, `CONS`, `REC`, `DOC`, `VIESA`. |
| **4** | `/escuelas/totalescuelas` | `GET` | `[OK 200]` | Catálogo abierto de escuelas del TEC sin obligatoriedad de usuario asignado. |
| **5** | `/convocatorias/documentos_convocatoria?id_convocatoria=1` | `GET` | `[OK 200]` | Carga de los 9 instrumentos oficiales descargables de Fondos VIE 2027. |
| **6** | `/propuestas/dashboardpropuestas?id_usuario=1` | `GET` | `[OK 200]` | Contadores dinámicos para los estados (`formulacion`, `ejecucion`, `cerradas`). |
| **7** | `/propuestas/top3PropuestaMasReciente?id_usuario=1` | `GET` | `[OK 200]` | Obtención de códigos institucionales `SI-YYYY-NNN` y período calculado `2027–2028`. |
| **8** | `/propuestas` (Listado general) | `GET` | `[OK 200]` | Filtros combinados por escuela, modalidad, línea de investigación y estado. |
| **9** | `/propuestas` (Creación atómica) | `POST` | `[OK 201]` | Inserción multitabla en `propuestas`, `team`, `objetivos`, `productos`, `plan`, `riesgos`, `presupuesto` y `ética`. |
| **10**| `/propuestas/{id_propuesta}` | `GET` | `[OK 200]` | Generación del dossier completo, incluyendo la clave `"evaluacion_ia"`. |
| **11**| `/propuestas/{id_propuesta}/estado` | `PATCH` | `[OK 200]` | Transición de estado con inserción automática en `proposal_state_history`. |
| **12**| `/notificaciones/leer-todas?id_usuario=1` | `PATCH` | `[OK 200]` | Actualización masiva de lectura de notificaciones en Supabase. |
| **13**| `/ia/estado` | `GET` | `[OK 200]` | Verificación de `GEMINI_API_KEY`, cuotas del Plan Gratuito y modelo activo (`gemini-2.5-flash`). |
| **14**| `/ia/criterios` | `GET` | `[OK 200]` | Retorno de los 19 criterios oficiales de la Rúbrica VIE 2027 y reglas de los 5 niveles. |
| **15**| `/ia/evaluacion-preliminar/{id}` | `GET` | `[OK 200]` | Consulta y generación en Supabase de la evaluación preliminar estructurada en 5 niveles. |

---

## 2. Comprobaciones Funcionales de Interfaz y Lógica de Negocio

1. **Autenticación Institucional:** Valida correo y contraseña contra la tabla `usuarios` en Supabase mediante hash SHA-256 verificado en tiempo constante (`hmac.compare_digest`).
2. **Validación de Formularios de Formulación:** Los campos obligatorios vacíos bloquean el avance; la dedicación horaria exige $\ge 4\text{ h/semana}$ por investigador.
3. **Control Presupuestario en Tiempo Real:** Recalcula dinámicamente y bloquea el avance al superar el tope anual de la modalidad; valida estrictamente que partidas de equipo e instrumentación científica se presupuesten solo en el Año 1 (Sección 2.3.9).
4. **Repositorio de Instrumentos VIE 2027:** La tarjeta de instrumentos en Pantalla 05 carga los 9 documentos oficiales dinámicamente desde el Backend.
5. **Generación Asíncrona de Evaluación IA:** Al confirmar el envío de la propuesta (Pantalla 18 $\rightarrow$ 19), el frontend dispara la evaluación preliminar con Gemini Online y muestra el puntaje sugerido en la pantalla de éxito.
6. **Paneles de Referencia IA Adaptados por Nivel:**
   - **Vinculación (Pantalla 23):** Diagnóstico preliminar de activos de propiedad intelectual y madurez tecnológica (TRL).
   - **Comité Técnico (Pantalla 24):** Desglose de los 19 criterios en escala `0/6/8/10`, advertencia de bloqueo si un obligatorio tiene $< 8$, y botón interactivo **«Aplicar puntajes IA como base»**.
   - **Consejo de Escuela (Pantalla 25):** Auditoría de carga horaria semanal y pertinencia temática.
   - **Dirección de Investigación (Pantalla 26):** Checklist normativo de 5 puntos de admisibilidad de la VIE.
   - **CIE (Pantalla 27):** Borrador de resolución colegiada motivada para acta formal.
7. **Buscador Facetado e Histórico:** Búsqueda por palabras clave, códigos institucionales (`SI-YYYY-NNN`) y filtros combinados.
8. **Centro de Notificaciones:** Notificaciones automáticas ante cambios de estado de las propuestas registradas por triggers en PostgreSQL.
9. **Compatibilidad Multiplataforma y Responsiva:** Funcionamiento verificado en navegadores modernos de escritorio y dispositivos móviles.
10. **Conmutación Transparente de Hosting:** Funciona de forma idéntica en entorno local (`http://localhost:3001`) y desplegado en la nube (**Frontend en Vercel + Backend en Render**).
