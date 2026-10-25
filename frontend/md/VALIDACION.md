# Validación del Sistema SGPI · Convocatoria Fondos VIE 2027

Este documento resume las pruebas de validación funcional, interfaz de usuario y endpoints de la API REST ejecutadas y verificadas con éxito.

---

## 1. Validación Automatizada de Endpoints (Backend API & Supabase)

Se ejecutó la suite de verificación automatizada [`test_endpoints.ps1`](../../test_endpoints.ps1), comprobando 11 casos de uso de extremo a extremo contra la base de datos PostgreSQL en Supabase:

| N° | Endpoint Probado | Método | Resultado | Verificación Normativa / Técnica |
| :---: | :--- | :---: | :---: | :--- |
| **1** | `/health` | `GET` | `[OK 200]` | Conexión activa con el pooler de Supabase en AWS `us-west-2:6543`. |
| **2** | `/catalogos` | `GET` | `[OK 200]` | 4 escuelas, 3 modalidades oficiales, 6 tipos de hora, rubros y estados. |
| **3** | `/tipos_hora/totalTiposHora` | `GET` | `[OK 200]` | Retorno de tipos oficiales: `VIE`, `VIE-Centros`, `CONS`, `REC`, `DOC`, `VIESA`. |
| **4** | `/escuelas/totalescuelas` | `GET` | `[OK 200]` | Catálogo abierto de escuelas del TEC sin obligatoriedad de usuario asignado. |
| **5** | `/convocatorias/documentos_convocatoria?id_convocatoria=1` | `GET` | `[OK 200]` | Carga de los 9 instrumentos oficiales descargables de Fondos VIE 2027. |
| **6** | `/propuestas/dashboardpropuestas?id_usuario=1` | `GET` | `[OK 200]` | Contadores resilientes a mayúsculas y estados (`formulacion`, `ejecucion`, `cerradas`). |
| **7** | `/propuestas/top3PropuestaMasReciente?id_usuario=1` | `GET` | `[OK 200]` | Obtención de códigos reales `SI-YYYY-NNN` y período calculado `2027–2028`. |
| **8** | `/propuestas` (Listado general) | `GET` | `[OK 200]` | Filtros combinados por escuela, modalidad, línea de investigación y estado. |
| **9** | `/propuestas` (Creación atómica) | `POST` | `[OK 201]` | Inserción en `propuestas`, `team`, `objetivos`, `productos`, `plan`, `riesgos`, `presupuesto` y `ética`. |
| **10**| `/propuestas/{id_propuesta}` | `GET` | `[OK 200]` | Generación del dossier/expediente completo de la propuesta creada. |
| **11**| `/propuestas/{id_propuesta}/estado` | `PATCH` | `[OK 200]` | Transición de estado con auditoría automática en `proposal_state_history`. |
| **12**| `/notificaciones/leer-todas?id_usuario=1` | `PATCH` | `[OK 200]` | Actualización de fecha y lectura de notificaciones en Supabase. |

---

## 2. Doce Comprobaciones Funcionales de Interfaz (Frontend)

1. **Autenticación:** El acceso valida correo y contraseña (`demostracion`) contra el Backend.
2. **Validación de campos:** Un título obligatorio vacío impide avanzar; completarlo permite continuar.
3. **Presupuesto:** Recalcula dinámicamente y bloquea el avance al superar el tope anual de la modalidad; valida que compras de equipo duradero se hagan en Año 1.
4. **Instrumentos descargables:** La tarjeta de instrumentos en Pantalla 05 carga los 9 documentos oficiales sin estar quemados en el código.
5. **Rúbrica de evaluación:** Un criterio obligatorio con calificación regular (6) o deficiente (0) impide recomendar aunque la suma supere 70 puntos.
6. **Aval de Consejo de Escuela:** El aval vuelve al investigador y exige sometimiento explícito antes de pasar a Dirección.
7. **Resolución CIE:** La resolución negativa no ofrece aceptación; la favorable genera carta formal.
8. **Consulta histórica:** Búsqueda por palabras clave, códigos institucionales (`SI-YYYY-NNN`) y filtros combinados.
9. **Notificaciones:** Registro dinámico ante cada cambio de estado y posibilidad de marcarlas como leídas.
10. **Administración:** Visualización de etapas y cronograma de convocatorias con fechas oficiales de la VIE.
11. **Accesibilidad:** Cierre de modales/overlays con tecla `Escape` y conservación de foco.
12. **Diseño adaptativo:** Compatibilidad responsiva comprobada en resoluciones de escritorio y móviles.
