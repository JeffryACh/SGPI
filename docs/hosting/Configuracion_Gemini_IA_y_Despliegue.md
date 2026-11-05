# 🤖 Configuración e Integración de Google Gemini IA (Plan Gratuito) en SGPI
### Arquitectura de Producción: Frontend en Vercel · Backend en Render · Base de Datos en Supabase

**Proyecto:** Sistema para la Gestión de Propuestas de Investigación (SGPI — Convocatoria Fondos VIE 2027)  
**Institución:** Instituto Tecnológico de Costa Rica (TEC) · Escuela de Ingeniería en Computación · Curso: Diseño de Software  
**Repositorio de Código:** `c:\Proyecto-Diseño\SGPI`  
**Carpeta de Documentación y Contexto:** `c:\Users\jeffr\OneDrive - Estudiantes ITCR\Documentos\Computacion\Semestres\Compu-2026\Semestre 10\Diseño de Software\Proyecto\SGPI`

---

## 📌 1. Visión General y Flujo de Evaluación Preliminar con IA

Cuando una persona investigadora (o grupo de investigación) finaliza la formulación de su propuesta y la **envía para revisión**, el Backend en **Render (FastAPI)** recopila automáticamente todos los componentes del expediente desde **Supabase** (datos generales, equipo, tipos de hora, objetivos, productos comprometidos, plan de acción, matriz de riesgos, presupuesto anualizado y declaraciones éticas) y los analiza mediante la **API Online de Google Gemini en su Plan Gratuito (Google AI Studio Free Tier)**.

El resultado es una **Evaluación Preliminar de Referencia (no vinculante)** almacenada en la tabla `public.ai_preliminary_evaluations` de Supabase, diseñada específicamente para servir como guía técnica a los **5 niveles de evaluación institucional**:

```mermaid
sequenceDiagram
    autonumber
    actor INV as 👩‍🔬 Investigador(a)
    participant VER as 🌐 Frontend (Vercel)\nSGPI.html + app.js
    participant REN as ⚡ Backend (Render)\nFastAPI (propuestas.py + ia.py)
    participant GEM as 🧠 Google Gemini API\n(Plan Gratuito: gemini-3.5-flash)
    participant SUP as 🗄️ Supabase Cloud\nPostgreSQL (ai_preliminary_evaluations)
    actor EVAL as ⚖️ Evaluadores (5 Niveles)\nPantallas 22 a 27

    INV->>VER: 1. Completa propuesta y pulsa "Enviar a revisión" (Pantalla 18 -> 19)
    VER->>REN: 2. POST /propuestas o PATCH /propuestas/{id}/estado (o POST /ia/evaluar-borrador)
    REN->>SUP: 3. Consulta expediente completo + ejecuta pre-auditoría cuantitativa VIE 2027
    REN->>GEM: 4. Envía Prompt Estructurado + Criterios VIE 2027 (responseMimeType: application/json)
    GEM-->>REN: 5. Retorna JSON con puntajes 0/6/8/10 y dictámenes para los 5 niveles
    REN->>SUP: 6. UPSERT en tabla public.ai_preliminary_evaluations
    REN-->>VER: 7. Confirma envío y disponibilidad de Evaluación Preliminar IA
    EVAL->>VER: 8. Abre Expediente (22) o Pantalla de Nivel (23, 24, 25, 26, 27)
    VER->>REN: 9. GET /ia/evaluacion-preliminar/{id_propuesta}
    REN->>SUP: 10. Lee evaluación persistida (sin consumir cuota adicional de Gemini)
    REN-->>VER: 11. Muestra Panel de Referencia IA adaptado al rol del evaluador
```

---

## 🆓 2. Cumplimiento Estricto del Plan Gratuito de Gemini (Google AI Studio)

Para garantizar **costo \$0 absoluto y sin requerir tarjeta de crédito**, la integración utiliza exclusivamente **Google AI Studio (`generativelanguage.googleapis.com`)** y nunca Vertex AI empresarial:

| Parámetro del Plan Gratuito | Configuración Aplicada en SGPI | Beneficio en el Proyecto |
| :--- | :--- | :--- |
| **Plataforma de API Key** | [Google AI Studio](https://aistudio.google.com/apikey) (`Plan Free of Charge`) | No exige tarjeta bancaria ni cuenta de facturación de Google Cloud. |
| **Modelo Principal** | `gemini-3.5-flash` | Modelo multimodal y de razonamiento rápido vigente en la capa gratuita (15 RPM, 1.000.000 TPM, hasta 1.000 RPD gratis). |
| **Cadena de Respaldo Gratuita** | `gemini-3.5-flash-lite` $\rightarrow$ `gemini-3.1-flash-lite` $\rightarrow$ `gemini-flash-lite-latest` | Si en algún minuto se alcanza el límite por minuto de `gemini-3.5-flash`, `backend/app/routers/ia.py` conmuta automáticamente al siguiente modelo gratuito activo. |
| **Caché Persistente en Supabase** | Tabla `public.ai_preliminary_evaluations` | La IA se invoca **una sola vez** cuando la propuesta se envía a revisión. Cuando los 5 evaluadores abren sus pantallas, leen el JSON guardado en Supabase sin gastar peticiones adicionales. |
| **Motor Normativo de Respaldo** | Función `_auditar_reglas_v2027()` en `ia.py` | Si aún no se ha colocado la `GEMINI_API_KEY` o no hay internet, el sistema genera de forma determinista la evaluación preliminar completa para que la demostración académica nunca falle. |

### Paso a paso para obtener la `GEMINI_API_KEY` gratuita:
1. Ingresa a **[https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)** con cualquier cuenta de Google personal.
2. Haz clic en **"Create API key"**.
3. Verifica que en la columna *Plan* aparezca **"Free of charge"** (Plan gratuito).
4. Copia la clave generada (comienza con `AIzaSy...`).

---

## 🛠️ 3. Archivos Configurados en el Proyecto (`c:\Proyecto-Diseño\SGPI`)

Se prepararon y actualizaron los siguientes archivos en el repositorio del proyecto para dejar lista toda la integración:

| Archivo en `c:\Proyecto-Diseño\SGPI` | Qué se configuró |
| :--- | :--- |
| [`Base de datos/Scripts/V6__evaluacion_preliminar_ia.sql`](file:///C:/Proyecto-Diseño/SGPI/Base%20de%20datos/Scripts/V6__evaluacion_preliminar_ia.sql) | Crea la tabla `public.ai_preliminary_evaluations` en Supabase con columnas tipadas y `jsonb` para almacenar el puntaje preliminar, recomendación global y las referencias específicas de los 5 niveles (`referencia_vinculacion`, `referencia_comite_tecnico`, `referencia_consejo_escuela`, `referencia_direccion_vie`, `referencia_cie`), junto con sus políticas RLS. |
| [`backend/app/routers/ia.py`](file:///C:/Proyecto-Diseño/SGPI/backend/app/routers/ia.py) | Nuevo módulo y router FastAPI (`/ia`) que implementa el catálogo normativo VIE 2027, la pre-auditoría matemática, el cliente HTTPS hacia Google Gemini Free Tier, la autoinicialización de la tabla en Supabase y los 5 endpoints REST (`/ia/estado`, `/ia/criterios`, `/ia/evaluacion-preliminar/{id}`, `/ia/evaluar-propuesta/{id}`, `/ia/evaluar-borrador`). |
| [`backend/app/routers/propuestas.py`](file:///C:/Proyecto-Diseño/SGPI/backend/app/routers/propuestas.py) | Conecta automáticamente `generar_y_guardar_evaluacion_ia()` al crear propuestas (`POST /propuestas`) o al cambiar su estado hacia revisión/evaluación (`PATCH /propuestas/{id}/estado`), e inyecta el campo `"evaluacion_ia"` dentro del expediente completo (`GET /propuestas/{id}`). |
| [`backend/app/main.py`](file:///C:/Proyecto-Diseño/SGPI/backend/app/main.py) | Registra `app.include_router(ia.router)` en el servidor FastAPI. |
| [`backend/Dockerfile`](file:///C:/Proyecto-Diseño/SGPI/backend/Dockerfile) | Ajustado para escuchar dinámicamente en `${PORT:-3000}`, requerido por el entorno de contenedores de **Render**. |
| [`render.yaml`](file:///C:/Proyecto-Diseño/SGPI/render.yaml) | Blueprint declarativo para desplegar el Backend en **Render** (región `oregon` junto a Supabase, plan `free`, healthcheck `/health` y variables `DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`). |
| [`vercel.json`](file:///c:/DiseñoDeSoftware/SGPI/vercel.json) | Configuración declarativa para desplegar el Frontend en **Vercel** con `"outputDirectory": "frontend"` y `"buildCommand": ""`, mapeando `/`, `/html/*`, `/css/*`, `/js/*` y `/assets/*` mediante `rewrites` hacia `/html/SGPI.html`. |
| [`frontend/js/app.js`](file:///c:/DiseñoDeSoftware/SGPI/frontend/js/app.js) | Conmutación automática de `API_URL` (entre `localhost:3001` y Render), límites de caracteres (`maxlength`), protección contra inyección SQL (`contieneInyeccionSQL`), validación de ORCID bajo norma ISO 7064 MOD 11-2 (`esOrcidValido`), disparo de la evaluación IA al enviar propuesta a revisión (`send-confirm`), y renderizado del **Panel de Evaluación Preliminar IA** en las pantallas `22` a `27`. |
| [`.env`](file:///c:/DiseñoDeSoftware/SGPI/.env), [`app.py`](file:///c:/DiseñoDeSoftware/SGPI/app.py) y [`docker-compose.yml`](file:///c:/DiseñoDeSoftware/SGPI/docker-compose.yml) | Variables `SUPABASE_URL`, `SUPABASE_KEY`, `GEMINI_API_KEY` y `GEMINI_MODEL=gemini-3.5-flash` configuradas, junto con el cliente SDK oficial `supabase-py` en `app.py`. |

---

## 🚀 4. Guía Paso a Paso de Despliegue: Supabase + Render + Vercel

### Paso 1: Base de Datos en Supabase (Ya activa en `us-west-2`)
1. El backend crea automáticamente la tabla `public.ai_preliminary_evaluations` la primera vez que se invoca cualquier endpoint de `/ia`.
2. Si deseas crearla también desde el panel de Supabase, abre el **SQL Editor** en tu proyecto (`pxlrplbyggoywqbcgjdu`) y ejecuta el contenido de [`Base de datos/Scripts/V6__evaluacion_preliminar_ia.sql`](file:///C:/Proyecto-Diseño/SGPI/Base%20de%20datos/Scripts/V6__evaluacion_preliminar_ia.sql).

### Paso 2: Backend FastAPI en Render
1. Sube los últimos cambios del repositorio a GitHub:
   ```powershell
   cd "c:\Proyecto-Diseño\SGPI"
   git add .
   git commit -m "feat: integrar evaluacion preliminar con Gemini Free Tier y configuracion Render+Vercel"
   git push origin main
   ```
2. Entra a **[https://dashboard.render.com](https://dashboard.render.com)** $\rightarrow$ **"New +" $\rightarrow$ "Web Service"** y conecta tu repositorio `SGPI`.
3. Render detectará el archivo `render.yaml` o puedes ingresar estos valores manualmente:
   - **Name:** `sgpi-backend-api`
   - **Region:** `Oregon (US West)` *(misma región `us-west-2` que tu Supabase)*.
   - **Root Directory:** `backend`
   - **Runtime:** `Docker`
   - **Instance Type:** `Free`
   - **Health Check Path:** `/health`
4. En la sección **Environment Variables** de Render, agrega estas 3 variables:
   - `DATABASE_URL` = `postgresql://postgres.pxlrplbyggoywqbcgjdu:Password,SGPI-012345.@aws-0-us-west-2.pooler.supabase.com:6543/postgres`
   - `GEMINI_API_KEY` = `AIzaSy...` *(tu clave gratuita de Google AI Studio)*
   - `GEMINI_MODEL` = `gemini-3.5-flash`
5. Haz clic en **"Create Web Service"**. Al terminar el build tendrás tu URL pública (por ejemplo, `https://sgpi-backend-api.onrender.com`).
6. Verifica en tu navegador:
   - `https://sgpi-backend-api.onrender.com/health` $\rightarrow$ `{"status": "ok"}`
   - `https://sgpi-backend-api.onrender.com/ia/estado` $\rightarrow$ confirma `"gemini_api_key_configurada": true` y `"plan_gratuito_obligatorio": true`.

### Paso 3: Frontend SPA en Vercel
1. En [`frontend/js/app.js`](file:///C:/Proyecto-Diseño/SGPI/frontend/js/app.js#L43), verifica que la URL de producción en `API_URL` coincida con el subdominio que te asignó Render (por defecto ya apunta a `https://sgpi-backend-api.onrender.com`).
2. Entra a **[https://vercel.com](https://vercel.com)** $\rightarrow$ **"Add New..." $\rightarrow$ "Project"** e importa el repositorio `SGPI`.
3. Deja **Root Directory** en `./` (la raíz del proyecto, donde ya está `vercel.json`) y **Framework Preset** en `Other`.
4. Pulsa **"Deploy"**. Tu aplicación quedará publicada en `https://sgpi-vie.vercel.app`.

---

## 🔌 5. Referencia de Endpoints de IA Disponibles en el Backend

| Método y Ruta | Cuándo se usa | Qué retorna |
| :--- | :--- | :--- |
| `GET /ia/estado` | Diagnóstico de configuración en Render o Docker local. | Estado de `GEMINI_API_KEY`, modelo gratuito activo (`gemini-3.5-flash`) y lista de los 5 niveles cubiertos. |
| `GET /ia/criterios` | Consulta de parámetros normativos. | El catálogo completo de criterios, pesos y reglas de bloqueo de Fondos VIE 2027. |
| `GET /ia/evaluacion-preliminar/{id_propuesta}` | Cuando un evaluador abre el Expediente (Pantalla 22) o su pantalla de revisión (Pantallas 23 a 27). | El dictamen preliminar almacenado en Supabase (si no existe aún, lo genera automáticamente). |
| `POST /ia/evaluar-propuesta/{id_propuesta}` | Automáticamente al cambiar estado a revisión o cuando un evaluador pulsa *«Actualizar IA»*. | Fuerza una nueva evaluación de la propuesta en Supabase con Gemini y actualiza `ai_preliminary_evaluations`. |
| `POST /ia/evaluar-borrador` | Cuando el investigador confirma el envío a revisión en la Pantalla 18 (`send-confirm`). | Evalúa los datos actuales del formulario con Gemini, guarda en Supabase y devuelve la referencia para los 5 niveles. |
