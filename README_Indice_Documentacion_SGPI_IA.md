# Índice General de Documentación y Archivos de Contexto — SGPI + Google Gemini IA (Plan Gratuito)

Este directorio centraliza toda la documentación técnica, criterios normativos, prompts de sistema, esquemas JSON y guías de despliegue nube (`Vercel + Render + Supabase + Google Gemini Free Tier`) del **Sistema de Gestión de Propuestas de Investigación (SGPI)** del **Instituto Tecnológico de Costa Rica (ITCR)**.

---

## 1. Archivos de Documentación y Referencia en esta Carpeta

| Archivo | Propósito Principal | Audiencia |
| :--- | :--- | :--- |
| `Configuracion_Gemini_IA_y_Despliegue.md` | Guía paso a paso para obtener la `GEMINI_API_KEY` gratuita en Google AI Studio, configurar variables de entorno y desplegar el proyecto en **Render** (Backend), **Vercel** (Frontend) y **Supabase** (Base de Datos). | Desarrolladores / DevOps |
| `Criterios_y_Parametros_Evaluacion_IA_VIE2027.md` | Especificación normativa completa de los **8 bloques / 19 criterios** de la Convocatoria Fondos VIE 2027, escala discreta (`0, 6, 8, 10`), reglas bloqueantes (Sección 2.3.9 y Sección 2.4.1) y parámetros evaluados para cada uno de los **5 niveles de evaluación**. | Evaluadores VIE / Analistas de Negocio |
| `Contexto_Prompt_y_Esquema_JSON_Gemini.md` | Documentación del *System Prompt*, construcción del *Dossier de Entrada* de la propuesta, contrato de salida en JSON (`responseMimeType: "application/json"`) y algoritmo de auditoría determinista de respaldo (*Fallback*). | Ingenieros de IA / Backend |
| `contexto_sistema_gemini_vie2027.json` | Archivo de referencia estructurado (legible por máquina) con todos los modelos del Free Tier de Gemini, topes presupuestarios por modalidad, niveles de evaluación y los 19 criterios oficiales. | Integración de Sistemas / Testing |

---

## 2. Archivos del Proyecto Técnico Configurados en `C:\Proyecto-Diseño\SGPI`

| Ruta en el Repositorio `SGPI` | Rol en la Integración con Gemini IA y Hosting |
| :--- | :--- |
| `backend/app/routers/ia.py` | Router FastAPI y motor de evaluación preliminar con Google Gemini Free Tier (`gemini-2.5-flash` -> `gemini-2.5-flash-lite` -> `gemini-2.0-flash`) + motor determinista de respaldo normativo VIE 2027. |
| `backend/app/routers/propuestas.py` | Dispara automáticamente `generar_y_guardar_evaluacion_ia()` cuando un investigador o grupo envía una propuesta a revisión (`POST /propuestas` o `PATCH /propuestas/{id}/estado`) e inyecta `"evaluacion_ia"` en el expediente (`GET /propuestas/{id}`). |
| `backend/app/main.py` | Registra el router `/ia` y habilita CORS para los dominios de Vercel y desarrollo local. |
| `Base de datos/Scripts/V6__evaluacion_preliminar_ia.sql` | Script DDL de migración para la tabla `public.ai_preliminary_evaluations` en Supabase con columnas `JSONB` para los 5 niveles de evaluación y políticas RLS. |
| `frontend/js/app.js` | Detecta automáticamente el entorno (`localhost` vs `Vercel`), dispara la evaluación IA al enviar la propuesta (Pantalla 18 -> 19) y renderiza la tarjeta de **Referencia Preliminar IA (Gemini)** en el Expediente (Pantalla 22) y en los **5 paneles evaluadores** (Pantallas 23, 24, 25, 26 y 27). |
| `render.yaml` | Blueprint declarativo para desplegar el Backend Dockerizado en el plan gratuito de **Render** (`us-west-2`), incluyendo `DATABASE_URL`, `GEMINI_API_KEY` y `GEMINI_MODEL`. |
| `vercel.json` | Configuración de enrutamiento estático y cabeceras HTTP para desplegar el Frontend SPA en **Vercel**. |
| `OpcionesDeHosting.md` | Análisis comparativo detallado (Ventajas, Similitudes y Desventajas) de al menos 3 opciones por capa de infraestructura y guía paso a paso de configuración. |
