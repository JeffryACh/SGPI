# Integración Dinámica del Frontend (`app.js`) con el Backend (FastAPI / Supabase)

Este documento detalla la transición del Frontend desde estructuras de datos estáticas en memoria (`localStorage`) hacia el consumo de la API REST oficial (`http://localhost:3001`) conectada a PostgreSQL en Supabase.

---

## 1. Endpoints de la API Consumidos por la Interfaz

| Pantalla | Endpoint Backend | Método | Propósito en el Frontend |
| :--- | :--- | :---: | :--- |
| **01 (Acceso)** | `/auth/login` | `POST` | Autenticación real por correo y contraseña contra la tabla `usuarios`. |
| **02 (Dashboard)** | `/propuestas/dashboardpropuestas?id_usuario=X` | `GET` | Indicadores numéricos reales: total, formulación, ejecución y cerradas. |
| **02 (Dashboard)** | `/propuestas/propuestaMasReciente?id_usuario=X` | `GET` | Tarjeta principal para continuar la propuesta activa en formulación. |
| **02 / 03 / 30** | `/propuestas/top3PropuestaMasReciente?id_usuario=X` | `GET` | Listado de propuestas recientes con código real (`SI-YYYY-NNN`) y período (`2027–2028`). |
| **03 (Notificaciones)**| `/notificaciones/notificaciones?id_usuario=X` | `GET` | Listado de notificaciones del usuario autenticado. |
| **03 (Notificaciones)**| `/notificaciones/{id}/leer` | `PATCH` | Marca una notificación individual como leída en Supabase. |
| **03 (Notificaciones)**| `/notificaciones/leer-todas?id_usuario=X` | `PATCH` | Marca todas las notificaciones pendientes del usuario como leídas. |
| **04 (Convocatorias)** | `/convocatorias/totalConvocatorias` | `GET` | Listado de convocatorias institucionales registradas. |
| **05 (Detalle Conv.)** | `/convocatorias/etapas_convocatorias?id_convocatoria=X` | `GET` | Las 11 etapas cronológicas oficiales de la convocatoria VIE. |
| **05 (Detalle Conv.)** | `/convocatorias/documentos_convocatoria?id_convocatoria=X` | `GET` | Los 9 instrumentos oficiales descargables de la convocatoria. |
| **07 (Nueva Propuesta)**| `/modalidades/totalmodalidades` | `GET` | Catálogo de modalidades oficiales con topes y descripciones. |
| **08 (Datos Generales)**| `/escuelas/totalescuelas` | `GET` | Catálogo abierto de todas las escuelas del TEC (COMP, BIOL, ADE, etc.). |
| **08 (Líneas Inv.)**  | `/lineas_de_investigacion/totalLineas` | `GET` | Catálogo de líneas de investigación institucionales. |
| **09 (Equipo Inv.)**   | `/tipos_hora/totalTiposHora` | `GET` | Catálogo de los 6 tipos de hora oficiales (`VIE`, `CONS`, `REC`, `DOC`, etc.). |
| **18 (Envío Propuesta)**| `/propuestas` | `POST` | Creación atómica multitabla de la propuesta completa en Supabase. |
| **20–27 (Evaluación)** | `/propuestas/{id}/estado` | `PATCH` | Cambio de estado de la propuesta ante avales, dictámenes o resoluciones. |
| **24–27 (Dictamen)**   | `/propuestas/{id}/evaluaciones` | `POST` | Registro de notas del Comité Técnico o resoluciones del CIE. |
| **29 (Histórico)**     | `/propuestas` | `GET` | Buscador facetado con filtros combinados por escuela, modalidad y estado. |

---

## 2. Variables de Estado Global en el Frontend

```javascript
// URL base de la API REST
const API_URL = "http://localhost:3001";

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
```
