# 🌐 Guía Completa de Opciones de Hosting y Despliegue — SGPI (Fondos VIE 2027)

**Proyecto:** Prototipo de Sistema para la Gestión de Propuestas de Investigación (SGPI — Fondos VIE 2027)  
**Institución:** Instituto Tecnológico de Costa Rica (TEC) · Escuela de Ingeniería en Computación · Curso: Diseño de Software  
**Contexto Académico:** Etapa 4 — Prototipo Funcional (35% de la rúbrica de evaluación: *"Sistema desplegado y operando sin errores. El flujo de los tres módulos es demostrable de principio a fin. Base de datos poblada con datos realistas para probar filtros históricos"*).

---

## 📑 Tabla de Contenidos

1. [Arquitectura del Proyecto SGPI y Aspectos a Desplegar](#-1-arquitectura-del-proyecto-sgpi-y-aspectos-a-desplegar)
2. [Preparación Previa del Código del Proyecto para Producción](#-2-preparación-previa-del-código-del-proyecto-para-producción)
3. [Aspecto A: Hosting del Frontend Estático / SPA (`frontend/`)](#-3-aspecto-a-hosting-del-frontend-estático--spa-frontend)
   - [Opción A1: Vercel](#opción-a1-vercel)
   - [Opción A2: Netlify](#opción-a2-netlify)
   - [Opción A3: Cloudflare Pages](#opción-a3-cloudflare-pages)
   - [Opción A4: GitHub Pages](#opción-a4-github-pages)
4. [Aspecto B: Hosting del Backend API REST en FastAPI (`backend/`)](#-4-aspecto-b-hosting-del-backend-api-rest-en-fastapi-backend)
   - [Opción B1: Render (Web Services)](#opción-b1-render-web-services)
   - [Opción B2: Railway](#opción-b2-railway)
   - [Opción B3: Fly.io](#opción-b3-flyio)
   - [Opción B4: Google Cloud Run](#opción-b4-google-cloud-run)
5. [Aspecto C: Hosting de Base de Datos Relacional PostgreSQL (`Base de datos/`)](#-5-aspecto-c-hosting-de-base-de-datos-relacional-postgresql-base-de-datos)
   - [Opción C1: Supabase Cloud (PostgreSQL + Supavisor Pooler)](#opción-c1-supabase-cloud-postgresql--supavisor-pooler)
   - [Opción C2: Neon (Serverless PostgreSQL)](#opción-c2-neon-serverless-postgresql)
   - [Opción C3: Railway PostgreSQL / Render Managed PostgreSQL](#opción-c3-railway-postgresql--render-managed-postgresql)
6. [Aspecto D: Hosting Full-Stack Unificado con Docker Compose / IaaS (`docker-compose.yml`)](#-6-aspecto-d-hosting-full-stack-unificado-con-docker-compose--iaas-docker-composeyml)
   - [Opción D1: Microsoft Azure (Azure for Students — VM o App Service Multi-Container)](#opción-d1-microsoft-azure-azure-for-students--vm-o-app-service-multi-container)
   - [Opción D2: DigitalOcean (Droplet con Docker Compose)](#opción-d2-digitalocean-droplet-con-docker-compose)
   - [Opción D3: Oracle Cloud Infrastructure (OCI Always Free ARM Ampere VM)](#opción-d3-oracle-cloud-infrastructure-oci-always-free-arm-ampere-vm)
7. [Aspecto E: Hosting de Documentos e Instrumentos Oficiales VIE 2027 (`Docs Proyecto/`)](#-7-aspecto-e-hosting-de-documentos-e-instrumentos-oficiales-vie-2027-docs-proyecto)
   - [Opción E1: Supabase Storage (Buckets S3 con Políticas RLS)](#opción-e1-supabase-storage-buckets-s3-con-políticas-rls)
   - [Opción E2: Cloudflare R2 (Object Storage sin Costo de Egreso)](#opción-e2-cloudflare-r2-object-storage-sin-costo-de-egreso)
   - [Opción E3: Amazon S3 (AWS Simple Storage Service)](#opción-e3-amazon-s3-aws-simple-storage-service)
8. [Verificación Post-Despliegue con `test_endpoints.ps1`](#-8-verificación-post-despliegue-con-test_endpointsps1)
9. [Combinaciones Recomendadas para la Entrega Final (Etapa 4)](#-9-combinaciones-recomendadas-para-la-entrega-final-etapa-4)

---

## 🏛️ 1. Arquitectura del Proyecto SGPI y Aspectos a Desplegar

A partir de la estructura real del repositorio en `c:\Proyecto-Diseño\SGPI` y los documentos normativos de la **Convocatoria Fondos VIE 2027** (`1-Disposiciones Convocatoria Fondos VIE 2027.pdf`, `CIE-237-2026`, plantillas y rúbricas), el sistema se compone de **cinco aspectos de infraestructura**:

```mermaid
flowchart LR
    subgraph CLIENTE["1. Aspecto A: Frontend SPA"]
        FE["HTML5 + CSS3 + ES6 Vanilla\n(frontend/html/SGPI.html\nfrontend/js/app.js)"]
    end

    subgraph SERVIDOR["2. Aspecto B: Backend API REST"]
        BE["FastAPI 0.143.2 + Uvicorn\nPython 3.12 + psycopg_pool\n(backend/Dockerfile · 9 Routers)"]
    end

    subgraph DATOS["3. Aspecto C: Base de Datos"]
        DB[("PostgreSQL (36 Tablas)\nScripts V1 a V5\nTriggers SI-YYYY-NNN + RLS")]
    end

    subgraph DOCS["5. Aspecto E: Almacenamiento"]
        ST["9 Instrumentos Oficiales VIE 2027\n(.pdf, .docx, .xlsx) + Anexos"]
    end

    subgraph ORQUESTACION["4. Aspecto D: Orquestación Full-Stack"]
        DC["docker-compose.yml\n(Nginx + FastAPI + Postgres + Flyway)"]
    end

    FE <==>|"HTTPS / JSON REST"| BE
    BE <==>|"TCP / Pooler 6543 o 5432"| DB
    BE <-->|"URLs Descarga"| ST
    DC -.->|"Empaqueta"| FE & BE & DB
```

| Aspecto | Carpeta / Archivos en `c:\Proyecto-Diseño\SGPI` | Tecnología Base | Requerimiento de Hosting |
| :--- | :--- | :--- | :--- |
| **A. Frontend Web (SPA)** | `frontend/html/SGPI.html`, `catalogo.html`, `frontend/css/*`, `frontend/js/*`, `assets/Roboto-Regular.ttf` | HTML5, CSS3, JavaScript ES6 Vanilla, Nginx (`frontend/nginx.conf`) | Servidor HTTP estático con soporte HTTPS, redirección a `/html/SGPI.html` y cabeceras sin caché agresiva (`no-store`). |
| **B. Backend API REST** | `backend/Dockerfile`, `backend/requirements.txt`, `backend/app/main.py`, `db.py`, `routers/*.py` (9 routers) | Python 3.12, FastAPI `0.143.2`, Uvicorn `0.54.0`, `psycopg[binary,pool]==3.3.6` | Entorno de ejecución Python o contenedor Docker con soporte para variables de entorno (`DATABASE_URL`, `PORT`) y conexiones TCP salientes hacia PostgreSQL. |
| **C. Base de Datos Relacional** | `Base de datos/Scripts/V1__init.sql` hasta `V5__triggers_funciones_politicas.sql` | PostgreSQL 14–18, extensión `pgcrypto`, funciones PL/pgSQL, triggers y secuencias | Instancia PostgreSQL administrada en la nube con soporte para triggers, funciones PL/pgSQL, `ConnectionPool` y datos semilla (*seed data*) de las 3 etapas del flujo. |
| **D. Infraestructura Full-Stack (Docker)** | `docker-compose.yml`, `.env`, `MDS - cambios/yml anterior.md` | Docker Engine + Docker Compose (`sgpi-backend`, `sgpi-frontend`, `sgpi-db`, `sgpi-flyway`) | Máquina virtual (VPS) o PaaS multicontenedor capaz de levantar toda la topología de contenedores con un solo comando. |
| **E. Almacenamiento de Instrumentos VIE** | `Docs Proyecto/` (9 adjuntos oficiales de la convocatoria VIE 2027) y tabla `convocatoria_documentos` | Archivos binarios `.pdf`, `.docx`, `.xlsx` servidos vía URLs en `/convocatorias/documentos_convocatoria` | Almacenamiento de objetos (Buckets) o CDN público para descarga directa de formularios, rúbricas, plantillas de presupuesto y oficios. |

---

## 🔧 2. Preparación Previa del Código del Proyecto para Producción

Antes de subir el proyecto a cualquier servicio de hosting en la nube, es indispensable realizar **3 ajustes puntuales** en los archivos de `c:\Proyecto-Diseño\SGPI` para que el entorno no dependa de `localhost`:

### Ajuste 1: Apuntar `API_URL` en el Frontend hacia la URL pública del Backend
En [`frontend/js/app.js`](./frontend/js/app.js) (línea 43), actualmente está definido:
```javascript
const API_URL = "http://localhost:3001",
  SESSION_KEY = "sgpi-session";
```
**Cambio recomendado para soportar tanto local como producción automáticamente:**
```javascript
const API_URL =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://TU-BACKEND-PRODUCCION.onrender.com", // <-- Reemplazar con la URL HTTPS del Backend elegido
  SESSION_KEY = "sgpi-session";
```

### Ajuste 2: Permitir puerto dinámico `$PORT` en `backend/Dockerfile`
Muchos proveedores PaaS (Render, Railway, Fly.io, Cloud Run) inyectan una variable de entorno `$PORT` dinámica. En [`backend/Dockerfile`](./backend/Dockerfile) (líneas 7–8), actualiza el comando de arranque para que use `${PORT:-3000}`:
```dockerfile
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 3000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3000}"]
```

### Ajuste 3: Verificar `CORSMiddleware` en `backend/app/main.py`
En [`backend/app/main.py`](./backend/app/main.py) (línea 79), el middleware ya tiene `allow_origins=["*"]`, lo cual permite que el Frontend alojado en cualquier dominio (`*.vercel.app`, `*.netlify.app`, `*.pages.dev`) consuma la API sin bloqueos de CORS durante la evaluación académica. Si se desea restringir en producción:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "https://sgpi-vie-tec.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 🖥️ 3. Aspecto A: Hosting del Frontend Estático / SPA (`frontend/`)

El directorio `frontend/` carece de un paso complejo de compilación (*no requiere Webpack/Vite para ejecutarse*), ya que utiliza HTML5, CSS3 y JavaScript ES6 nativo modularizado en `SGPI.html`, `content.js`, `app.js`, `ethics.js` y `notifications.js`. Sin embargo, requiere acceso a la fuente tipográfica en `/assets/Roboto-Regular.ttf` y que la raíz `/` cargue o redirija a `/html/SGPI.html`.

---

### Opción A1: Vercel

#### 🛠️Dónde y cómo configurarlo paso a paso
1. **Preparar archivo de enrutamiento (`vercel.json`) en la raíz `c:\Proyecto-Diseño\SGPI\vercel.json`:**
   Como `SGPI.html` está dentro de `frontend/html/SGPI.html` y carga `../assets/Roboto-Regular.ttf`, crea un archivo `vercel.json` en la raíz del repositorio:
   ```json
   {
     "rewrites": [
       { "source": "/", "destination": "/frontend/html/SGPI.html" },
       { "source": "/html/(.*)", "destination": "/frontend/html/$1" },
       { "source": "/css/(.*)", "destination": "/frontend/css/$1" },
       { "source": "/js/(.*)", "destination": "/frontend/js/$1" },
       { "source": "/assets/(.*)", "destination": "/assets/$1" }
     ],
     "headers": [
       {
         "source": "/(.*)",
         "headers": [
           { "key": "Cache-Control", "value": "no-store" }
         ]
       }
     ]
   }
   ```
2. **Subir el repositorio a GitHub:**
   ```powershell
   cd "c:\Proyecto-Diseño\SGPI"
   git add .
   git commit -m "chore: preparar configuracion de despliegue"
   git push origin main
   ```
3. **Crear cuenta y proyecto en Vercel:**
   - Ingresa a [https://vercel.com](https://vercel.com) e inicia sesión con tu cuenta de **GitHub**.
   - Haz clic en **"Add New..." → "Project"** e importa el repositorio `SGPI`.
4. **Configurar parámetros de construcción (Build Settings):**
   - **Framework Preset:** `Other` (Estático).
   - **Root Directory:** `./` (dejar en la raíz para que incluya tanto `frontend/` como `assets/`).
   - **Build Command:** *(Dejar vacío / Desactivado)*.
   - **Output Directory:** `.` (directorio raíz).
5. **Desplegar y verificar:**
   - Haz clic en **"Deploy"**. En menos de 20 segundos obtendrás un dominio como `https://sgpi-vie.vercel.app`.
   - Verifica tanto la aplicación principal (`https://sgpi-vie.vercel.app/html/SGPI.html`) como el catálogo de las 33 pantallas (`https://sgpi-vie.vercel.app/html/catalogo.html`).

#### 📊 Análisis Comparativo (Opción A1: Vercel)
1. **Ventajas frente a las demás de su área:**
   - **Entornos de vista previa (*Preview Deployments*) automáticos por rama/PR:** Cada integrante del grupo de 4 personas puede subir cambios a una rama y obtener una URL única instantánea para validar las 33 pantallas antes de mezclar a `main`.
   - **Configuración declarativa de `rewrites` y `headers` en `vercel.json`:** Permite replicar exactamente el comportamiento de `frontend/nginx.conf` (`Cache-Control: no-store` y resolución de `/assets/Roboto-Regular.ttf` que está un nivel arriba de `frontend/`) sin mover archivos de carpeta.
   - **Red Edge global de baja latencia:** Tiempos de respuesta iniciales inferiores a 50 ms en Costa Rica gracias a nodos CDN cercanos.
2. **Similitudes a una o varias de su área:**
   - Al igual que **Netlify** y **Cloudflare Pages**, se integra de forma nativa con GitHub mediante *webhooks* (CI/CD automático en cada `git push`), aprovisiona certificados SSL/TLS (HTTPS) gratuitos con Let's Encrypt automáticamente y ofrece un plan gratuito (*Hobby*) suficiente para prototipos académicos.
3. **Desventajas frente a las demás de su área:**
   - Su plan gratuito (*Hobby*) prohíbe el uso comercial y tiene límites estrictos de ancho de banda (100 GB/mes), mientras que **Cloudflare Pages** ofrece ancho de banda ilimitado gratuito.
   - Si el repositorio es propiedad de una **Organización de GitHub** privada del equipo en lugar de una cuenta personal, Vercel exige pasar al plan *Pro* de pago para desplegar desde la organización (a diferencia de **GitHub Pages** o **Cloudflare Pages**).

---

### Opción A2: Netlify

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Crear archivo de configuración `netlify.toml` en `c:\Proyecto-Diseño\SGPI\netlify.toml`:**
   ```toml
   [build]
     publish = "."

   [[redirects]]
     from = "/"
     to = "/frontend/html/SGPI.html"
     status = 302

   [[redirects]]
     from = "/html/*"
     to = "/frontend/html/:splat"
     status = 200

   [[redirects]]
     from = "/css/*"
     to = "/frontend/css/:splat"
     status = 200

   [[redirects]]
     from = "/js/*"
     to = "/frontend/js/:splat"
     status = 200

   [[headers]]
     for = "/*"
     [headers.values]
       Cache-Control = "no-store"
   ```
2. **Despliegue vía Git o Drag & Drop en [https://app.netlify.com](https://app.netlify.com):**
   - **Método A (Continuo por Git):** Haz clic en **"Add new site" → "Import an existing project"** → selecciona **GitHub** → elige el repositorio `SGPI` y pulsa **"Deploy site"**.
   - **Método B (Despliegue instantáneo con Netlify CLI sin usar Git):**
     ```powershell
     cd "c:\Proyecto-Diseño\SGPI"
     npx netlify-cli deploy --prod --dir="."
     ```
3. **Personalizar subdominio:**
   - Ve a **Site configuration → Domain management** y cambia el nombre aleatorio a `sgpi-fondos-vie-2027.netlify.app`.

#### 📊 Análisis Comparativo (Opción A2: Netlify)
1. **Ventajas frente a las demás de su área:**
   - **Soporte de despliegue manual por *Drag & Drop* o CLI directo:** Si en el momento de la demostración ante la clase ocurre algún inconveniente con GitHub, permite arrastrar la carpeta del proyecto directamente al navegador en `app.netlify.com/drop` y tener el sitio en línea en 10 segundos.
   - **Reglas de redirección y *Proxy Rewrites* hacia el Backend:** En `netlify.toml` se puede agregar una regla `from = "/api/*" to = "https://tu-backend.onrender.com/:splat" status = 200`, eliminando por completo los problemas de CORS al servir Frontend y API bajo el mismo dominio.
   - **Colaboración en repositorios de organizaciones gratuitas:** Menos restrictivo que Vercel cuando se trabaja en repositorios grupales de estudiantes.
2. **Similitudes a una o varias de su área:**
   - Comparte con **Vercel** y **Cloudflare Pages** el modelo JAMstack de distribución en CDN, certificados HTTPS automáticos, reversión instantánea (*1-click rollback*) a versiones anteriores del despliegue y configuración mediante un archivo de texto en la raíz del proyecto (`netlify.toml` análogo a `vercel.json`).
3. **Desventajas frente a las demás de su área:**
   - Su límite de ancho de banda y minutos de construcción en la capa gratuita (100 GB/mes y 300 minutos) es inferior al ancho de banda ilimitado de **Cloudflare Pages**.
   - La propagación de invalidación de caché tras un despliegue nuevo puede tardar algunos segundos más que en la red Anycast de Cloudflare.

---

### Opción A3: Cloudflare Pages

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Preparar estructura o archivo `_redirects`:**
   - Si deseas publicar directamente la carpeta `frontend/`, copia `assets/Roboto-Regular.ttf` dentro de `frontend/assets/Roboto-Regular.ttf` y crea el archivo `frontend/_redirects` con el contenido:
     ```text
     / /html/SGPI.html 302
     ```
2. **Vincular en el panel de Cloudflare:**
   - Ingresa a [https://dash.cloudflare.com](https://dash.cloudflare.com) → en el menú lateral selecciona **Workers & Pages** → pestaña **Pages** → **"Connect to Git"**.
   - Selecciona el repositorio `SGPI` en GitHub.
3. **Configurar el proyecto:**
   - **Project name:** `sgpi-vie-tec`
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** *(Vacío)*
   - **Build output directory:** `frontend`
4. **Guardar y desplegar:**
   - Haz clic en **"Save and Deploy"**. El sistema quedará publicado en `https://sgpi-vie-tec.pages.dev/html/SGPI.html`.

#### 📊 Análisis Comparativo (Opción A3: Cloudflare Pages)
1. **Ventajas frente a las demás de su área:**
   - **Ancho de banda y solicitudes estáticas 100% ilimitadas en el plan gratuito:** No importa cuántas veces se recarguen `SGPI.html`, `app.js` (más de 3.500 líneas) o las fuentes durante las pruebas del equipo y la defensa, nunca habrá cobros ni suspensión por tráfico.
   - **La red CDN más rápida y cercana en Latinoamérica (San José, Costa Rica):** Cloudflare cuenta con un punto de presencia (PoP) local directo en Costa Rica, ofreciendo la menor latencia posible desde el campus del TEC en Cartago.
   - **Despliegues de vista previa ilimitados y asientos de equipo gratuitos:** Los 4 integrantes del grupo pueden acceder al panel de Cloudflare sin costo por usuario.
2. **Similitudes a una o varias de su área:**
   - Funciona bajo el mismo flujo GitOps que **Vercel** y **Netlify** (cada commit genera un despliegue inmutable con su propia URL hash), incluye SSL/TLS gratuito y soporta cabeceras personalizadas mediante un archivo `_headers`.
3. **Desventajas frente a las demás de su área:**
   - El sistema de archivos de configuración (`_redirects` y `_headers`) es más rígido y menos expresivo que el JSON completo de **Vercel** (`vercel.json`) o el TOML de **Netlify** (`netlify.toml`).
   - Exige que todos los activos servidos estén estrictamente dentro del `Build output directory` (`frontend/`), por lo que requiere copiar o mover `assets/Roboto-Regular.ttf` dentro de `frontend/assets/`.

---

### Opción A4: GitHub Pages

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Agregar un `index.html` de redirección en la raíz `c:\Proyecto-Diseño\SGPI\index.html`:**
   ```html
   <!DOCTYPE html>
   <html lang="es">
   <head>
     <meta charset="utf-8" />
     <meta http-equiv="refresh" content="0; url=./frontend/html/SGPI.html" />
     <title>Redirigiendo a SGPI · VIE 2027</title>
   </head>
   <body>
     <p>Redirigiendo a <a href="./frontend/html/SGPI.html">SGPI · Fondos VIE 2027</a>...</p>
   </body>
   </html>
   ```
2. **Activar GitHub Pages en el repositorio:**
   - Abre el repositorio en GitHub → pestaña **Settings** → sección **Pages** (en el menú izquierdo).
   - En **Build and deployment → Source**, selecciona **Deploy from a branch**.
   - En **Branch**, elige `main` y la carpeta `/ (root)` → haz clic en **Save**.
3. **Acceder al sistema:**
   - Tras 1 minuto, GitHub publicará el sitio en `https://<tu-usuario>.github.io/<nombre-repo>/frontend/html/SGPI.html`.

#### 📊 Análisis Comparativo (Opción A4: GitHub Pages)
1. **Ventajas frente a las demás de su área:**
   - **Cero cuentas externas adicionales:** Como el entregable de la Etapa 4 exige alojar el código fuente en un repositorio Git, el hosting se activa con 3 clics dentro de la misma plataforma sin registrarse en servicios de terceros.
   - **Resolución natural de rutas relativas del proyecto:** Al publicar desde la raíz `/ (root)`, la ruta `../../assets/Roboto-Regular.ttf` referenciada por `frontend/css/branding.css` funciona de inmediato sin tocar ningún archivo ni crear reglas de `rewrites`.
   - **Beneficio GitHub Student Developer Pack (Correo `@estudiantec.cr`):** Con la cuenta institucional del TEC obtienes GitHub Pro gratis, permitiendo usar GitHub Pages incluso en repositorios privados.
2. **Similitudes a una o varias de su área:**
   - Al igual que **Vercel**, **Netlify** y **Cloudflare Pages**, sirve contenido estático por HTTPS mediante una CDN (Fastly) de forma gratuita y se actualiza automáticamente al hacer `git push` a la rama principal.
3. **Desventajas frente a las demás de su área:**
   - **No permite configurar cabeceras HTTP personalizadas** (como `Cache-Control: no-store` que sí está en `frontend/nginx.conf`), por lo que el navegador podría cachear versiones antiguas de `app.js` durante cambios rápidos si no se hace *Hard Refresh* (`Ctrl + F5`).
   - **No genera URLs de vista previa (*Preview Deployments*) por cada rama o Pull Request**, a diferencia de Vercel, Netlify y Cloudflare Pages.

---

## ⚙️ 4. Aspecto B: Hosting del Backend API REST en FastAPI (`backend/`)

El Backend de SGPI (`backend/app/main.py`) es una API asíncrona/síncrona en **Python 3.12 + FastAPI 0.143.2 + Uvicorn** que utiliza `psycopg_pool.ConnectionPool` (`backend/app/db.py`) para mantener un pool de entre 1 y 10 conexiones persistentes hacia PostgreSQL. Por ello, **requiere un servicio que soporte procesos de larga duración o contenedores Docker** (y no funciones serverless efímeras puras donde el `lifespan` del pool se destruye en cada petición).

---

### Opción B1: Render (Web Services)

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Ingresar a Render y conectar GitHub:**
   - Crea una cuenta en [https://render.com](https://render.com) vinculando tu cuenta de GitHub.
   - En el Dashboard, haz clic en **"New +" → "Web Service"** y selecciona el repositorio `SGPI`.
2. **Configurar los ajustes del servicio:**
   - **Name:** `sgpi-backend-api`
   - **Region:** `Oregon (US West)` *(Fundamental: elige `US West` porque la base de datos actual de Supabase del proyecto está en `aws-0-us-west-2`, minimizando la latencia entre API y BD a < 5 ms).*
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** `Docker` (usará automáticamente `backend/Dockerfile`) o bien `Python 3` con:
     - **Build Command:** `pip install -r requirements.txt`
     - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** `Free` (o `Starter` durante el día de la defensa si se desea evitar el *cold start*).
3. **Configurar Variables de Entorno (Environment Variables):**
   - En la sección **Environment Variables**, haz clic en **"Add Environment Variable"**:
     - **Key:** `DATABASE_URL`
     - **Value:** `postgresql://postgres.pxlrplbyggoywqbcgjdu:[TU_PASSWORD]@aws-0-us-west-2.pooler.supabase.com:6543/postgres`
4. **Configurar Health Check y Desplegar:**
   - En **Advanced → Health Check Path**, escribe `/health` (Render invocará el endpoint `@app.get("/health")` de `main.py` que ejecuta `SELECT 1` contra PostgreSQL).
   - Haz clic en **"Create Web Service"**. Una vez finalizado, tendrás la URL `https://sgpi-backend-api.onrender.com` y su Swagger en `https://sgpi-backend-api.onrender.com/docs`.

#### 📊 Análisis Comparativo (Opción B1: Render)
1. **Ventajas frente a las demás de su área:**
   - **Ubicación geográfica idéntica a la BD actual del proyecto (`US West - Oregon`):** La instancia actual de Supabase de SGPI reside en `us-west-2` (Oregon). Desplegar el Backend en la región `Oregon` de Render hace que las transacciones complejas (como `POST /propuestas` que inserta en múltiples tablas en cascada) se ejecuten casi instantáneamente.
   - **Soporte nativo de `/health` check integrado y despliegues sin tiempo de inactividad (*Zero-Downtime Deploys*):** Verifica automáticamente `GET /health` antes de redirigir el tráfico a una versión nueva.
   - **Capa gratuita real sin requerir tarjeta de crédito** para servicios web en Python/Docker.
2. **Similitudes a una o varias de su área:**
   - Al igual que **Railway** y **Google Cloud Run**, construye automáticamente el contenedor a partir de `backend/Dockerfile` en cada `git push`, inyecta secretos mediante variables de entorno (`DATABASE_URL`) y expone automáticamente un certificado HTTPS público.
3. **Desventajas frente a las demás de su área:**
   - **Suspensión por inactividad (*Spin down*) en el plan gratuito:** Tras 15 minutos sin recibir peticiones HTTP, el contenedor gratuito entra en reposo y la primera petición tarda entre 30 y 50 segundos en despertar (aunque se puede evitar abriendo `/health` 2 minutos antes de la exposición en clase o usando un monitor gratuito como *UptimeRobot*).

---

### Opción B2: Railway

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Crear proyecto en Railway:**
   - Ingresa a [https://railway.app](https://railway.app) con tu cuenta de GitHub.
   - Haz clic en **"New Project" → "Deploy from GitHub repo"** y elige el repositorio `SGPI`.
2. **Definir el directorio raíz del servicio Backend:**
   - Haz clic sobre la tarjeta del servicio creado → pestaña **Settings** → sección **Source → Root Directory** y escribe `/backend`.
   - Railway detectará automáticamente el archivo `backend/Dockerfile`.
3. **Configurar Variables de Entorno:**
   - Ve a la pestaña **Variables** → haz clic en **"New Variable"**:
     - `DATABASE_URL`: `postgresql://postgres.pxlrplbyggoywqbcgjdu:[TU_PASSWORD]@aws-0-us-west-2.pooler.supabase.com:6543/postgres`
     - `PORT`: `3000`
4. **Generar el dominio público HTTPS:**
   - Ve a la pestaña **Settings → Networking → Public Networking** y haz clic en **"Generate Domain"** (indicando el puerto `3000`).
   - Obtendrás una URL como `https://sgpi-backend-production.up.railway.app`.

#### 📊 Análisis Comparativo (Opción B2: Railway)
1. **Ventajas frente a las demás de su área:**
   - **Sin *Cold Starts* (el contenedor permanece encendido 24/7):** A diferencia del plan gratuito de Render o Cloud Run, Railway mantiene el contenedor de FastAPI y el `ConnectionPool` de `db.py` siempre calientes, garantizando respuestas inmediatas en `< 100 ms` durante toda la presentación.
   - **Lienzo visual de arquitectura y logs en tiempo real:** Su interfaz muestra en un grafo interactivo el contenedor del Backend, su consumo de RAM/CPU y permite acoplar una base de datos PostgreSQL o el servicio Frontend en el mismo lienzo.
   - **Velocidad de construcción (*Build*) superior:** Compila la imagen `python:3.12-slim` con `requirements.txt` en menos de 25 segundos.
2. **Similitudes a una o varias de su área:**
   - Comparte con **Render** y **Fly.io** la detección nativa de `Dockerfile`, inyección de variables de entorno, despliegues automáticos desde ramas de GitHub y monitoreo de salud.
3. **Desventajas frente a las demás de su área:**
   - **Modelo de créditos limitados (\$5 USD de prueba inicial):** En lugar de una capa gratuita perpetua por servicio, consume créditos por uso de RAM/CPU; una vez agotados los \$5 de prueba (aproximadamente tras 1 mes de ejecución continua), requiere pasar al plan *Hobby* (\$5/mes).

---

### Opción B3: Fly.io

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Instalar `flyctl` en Windows PowerShell:**
   ```powershell
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   fly auth login
   ```
2. **Inicializar la configuración en la carpeta `backend/`:**
   ```powershell
   cd "c:\Proyecto-Diseño\SGPI\backend"
   fly launch --no-deploy
   ```
   - Durante el asistente, selecciona:
     - **App Name:** `sgpi-vie-backend`
     - **Region:** `sjc` (San Jose, California / US West) o `mia` (Miami).
     - **Would you like to set up a Postgresql database now?:** `No` (si ya usas Supabase).
3. **Verificar el archivo `backend/fly.toml` generado:**
   ```toml
   app = "sgpi-vie-backend"
   primary_region = "sjc"

   [build]
     dockerfile = "Dockerfile"

   [http_service]
     internal_port = 3000
     force_https = true
     auto_stop_machines = "suspend"
     auto_start_machines = true
     min_machines_running = 1

     [[http_service.checks]]
       grace_period = "10s"
       interval = "30s"
       method = "GET"
       path = "/health"
       timeout = "5s"
   ```
4. **Inyectar el secreto `DATABASE_URL` y desplegar:**
   ```powershell
   fly secrets set DATABASE_URL="postgresql://postgres.pxlrplbyggoywqbcgjdu:[TU_PASSWORD]@aws-0-us-west-2.pooler.supabase.com:6543/postgres"
   fly deploy
   ```
   - El Backend quedará disponible en `https://sgpi-vie-backend.fly.dev`.

#### 📊 Análisis Comparativo (Opción B3: Fly.io)
1. **Ventajas frente a las demás de su área:**
   - **Micro-VMs Firecracker con suspensión en memoria (`suspend`) ultrarrápida:** A diferencia de los contenedores que se apagan por completo, Fly.io congela el estado de la máquina virtual en RAM y la reanuda en ~200 milisegundos, o permite fijar `min_machines_running = 1`.
   - **Control total por línea de comandos (`flyctl`) y túneles WireGuard:** Permite abrir una consola SSH directa dentro del contenedor (`fly ssh console`) para depurar problemas con `psycopg` o variables de entorno.
2. **Similitudes a una o varias de su área:**
   - Al igual que **Render**, **Railway** y **Google Cloud Run**, ejecuta el `backend/Dockerfile` sin cambios en el código Python de FastAPI y balancea el tráfico HTTPS hacia el puerto interno `3000`.
3. **Desventajas frente a las demás de su área:**
   - **Mayor curva de aprendizaje (basado en CLI):** A diferencia de Render o Railway que se configuran 100% desde el navegador web, Fly.io requiere instalar `flyctl` en la terminal y administrar el archivo `fly.toml`.
   - Solicita registrar un método de pago para validar la cuenta antes de permitir crear máquinas.

---

### Opción B4: Google Cloud Run

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Asegurar que `backend/Dockerfile` escuche en `${PORT:-3000}`** (como se indicó en la Sección 2).
2. **Autenticarse e inicializar Google Cloud CLI (`gcloud`):**
   ```powershell
   cd "c:\Proyecto-Diseño\SGPI\backend"
   gcloud auth login
   gcloud config set project TU_ID_DE_PROYECTO_GCP
   ```
3. **Desplegar directamente desde el código fuente (`Dockerfile`):**
   ```powershell
   gcloud run deploy sgpi-backend `
     --source . `
     --region us-west1 `
     --allow-unauthenticated `
     --port 3000 `
     --min-instances 0 `
     --max-instances 3 `
     --set-env-vars "DATABASE_URL=postgresql://postgres.pxlrplbyggoywqbcgjdu:[TU_PASSWORD]@aws-0-us-west-2.pooler.supabase.com:6543/postgres"
   ```
4. **Obtener la URL de producción:**
   - Al finalizar el comando, Cloud Run devolverá una URL del tipo `https://sgpi-backend-xxxxx-uw.a.run.app`.

#### 📊 Análisis Comparativo (Opción B4: Google Cloud Run)
1. **Ventajas frente a las demás de su área:**
   - **Capa gratuita perpetua empresarial muy generosa (2 millones de peticiones al mes gratis):** Además de los \$300 USD en créditos iniciales de Google Cloud, su nivel gratuito mensual permanente cubre de sobra cualquier carga académica o institucional.
   - **Escalado automático de 0 a $N$ instancias por concurrencia:** Si toda la clase entra simultáneamente al sistema durante la demostración, Cloud Run escala horizontalmente en segundos sin caerse.
2. **Similitudes a una o varias de su área:**
   - Empaqueta y ejecuta contenedores estándar OCI a partir del mismo `backend/Dockerfile` igual que **Render**, **Railway** y **Fly.io**, y permite elegir la región `us-west1` (Oregon) cercana a Supabase.
3. **Desventajas frente a las demás de su área:**
   - **Ciclo de vida del `ConnectionPool` en contenedores efímeros:** Cuando escala a cero (`--min-instances 0`), el pool de `backend/app/db.py` se cierra y se vuelve a abrir en el siguiente arranque; por ello, **es obligatorio usar el puerto `6543` (Transaction Pooler / Supavisor)** en `DATABASE_URL` y no el puerto `5432` directo para no agotar las conexiones de PostgreSQL.

---

## 🗄️ 5. Aspecto C: Hosting de Base de Datos Relacional PostgreSQL (`Base de datos/`)

La base de datos de SGPI es el corazón de las **Etapas 3 y 4**: consta del esquema DDL relacional, usuarios con hashes SHA-256 (`pgcrypto`), catálogos normativos VIE 2027, datos semilla históricos y **triggers en PL/pgSQL** (`V5__triggers_funciones_politicas.sql`) que generan automáticamente los códigos `SI-YYYY-NNN`, insertan la bitácora en `proposal_state_history` y disparan notificaciones automáticas.

---

### Opción C1: Supabase Cloud (PostgreSQL + Supavisor Pooler)

> 💡 **Nota:** Esta es la opción **actualmente configurada y probada en el proyecto** (`pxlrplbyggoywqbcgjdu` en AWS `us-west-2`). A continuación se documenta el procedimiento completo desde cero para recrearla o replicarla en cualquier cuenta.

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Crear proyecto en Supabase:**
   - Ingresa a [https://supabase.com/dashboard](https://supabase.com/dashboard) y haz clic en **"New project"**.
   - **Name:** `SGPI-VIE-2027`
   - **Database Password:** Define una contraseña segura y guárdala.
   - **Region:** `West US (Oregon)` (`us-west-2`).
2. **Ejecutar los 5 scripts de migración en orden estricto:**
   - En el menú izquierdo de Supabase, abre **SQL Editor** → **"New query"**.
   - Abre desde `c:\Proyecto-Diseño\SGPI\Base de datos\Scripts\` y ejecuta uno por uno en este orden:
     1. [`V1__init.sql`](./Base%20de%20datos/Scripts/V1__init.sql): Crea la estructura de tablas relacionales, llaves primarias, foráneas y restricciones `CHECK`.
     2. [`V2__llenado_de_usuarios.sql`](./Base%20de%20datos/Scripts/V2__llenado_de_usuarios.sql): Siembra los 6 roles oficiales (`Investigador`, `Vinculación`, `Comité Técnico`, `Consejo de Escuela`, `Dirección de Investigación`, `CIE`), escuelas y usuarios con contraseña `demostracion`.
     3. [`V3__catalogos_y_seed_data.sql`](./Base%20de%20datos/Scripts/V3__catalogos_y_seed_data.sql): Siembra las modalidades, líneas de investigación, tipos de hora (`VIE`, `CONS`, `REC`, `DOC`, etc.), convocatoria Fondos VIE 2027, los 9 documentos oficiales y las propuestas históricas semilla.
     4. [`V4__seed_notificaciones.sql`](./Base%20de%20datos/Scripts/V4__seed_notificaciones.sql): Siembra las notificaciones iniciales por usuario.
     5. [`V5__triggers_funciones_politicas.sql`](./Base%20de%20datos/Scripts/V5__triggers_funciones_politicas.sql): Crea las funciones PL/pgSQL, triggers de autogeneración de código `SI-YYYY-NNN`, auditoría automática de estados y políticas RLS.
3. **Sincronizar las secuencias `SERIAL` tras la carga de datos semilla:**
   - Ejecuta en el **SQL Editor** de Supabase la siguiente sentencia para evitar colisiones de llaves primarias (`UniqueViolation`) al insertar nuevas propuestas desde `POST /propuestas`:
     ```sql
     SELECT setval(pg_get_serial_sequence('propuestas', 'id_propuesta'), COALESCE(MAX(id_propuesta), 1)) FROM propuestas;
     SELECT setval(pg_get_serial_sequence('proposal_objectives', 'id_objetivo'), COALESCE(MAX(id_objetivo), 1)) FROM proposal_objectives;
     SELECT setval(pg_get_serial_sequence('research_team', 'id_equipo'), COALESCE(MAX(id_equipo), 1)) FROM research_team;
     SELECT setval(pg_get_serial_sequence('action_plans', 'id_actividad'), COALESCE(MAX(id_actividad), 1)) FROM action_plans;
     SELECT setval(pg_get_serial_sequence('risks', 'id_riesgo'), COALESCE(MAX(id_riesgo), 1)) FROM risks;
     SELECT setval(pg_get_serial_sequence('proposal_budget', 'id_presupuesto'), COALESCE(MAX(id_presupuesto), 1)) FROM proposal_budget;
     SELECT setval(pg_get_serial_sequence('notificaciones', 'id_notificacion'), COALESCE(MAX(id_notificacion), 1)) FROM notificaciones;
     ```
4. **Obtener la cadena `DATABASE_URL` compatible con IPv4 (Supavisor Pooler):**
   - Haz clic en el botón **"Connect"** en la barra superior de Supabase → pestaña **Connection String** → **Transaction Pooler / Session Pooler** (puerto `6543` o `5432` del pooler IPv4):
     ```ini
     DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-us-west-2.pooler.supabase.com:6543/postgres
     ```
   - Coloca esta URL en `c:\Proyecto-Diseño\SGPI\.env` y en las variables de entorno del Backend.

#### 📊 Análisis Comparativo (Opción C1: Supabase Cloud)
1. **Ventajas frente a las demás de su área:**
   - **Ecosistema Todo-en-Uno (PostgreSQL + Pooler IPv4 + SQL Editor + Visor de Esquema + Storage):** Incluye un visualizador gráfico de esquemas (*Database → Schema Visualizer*) ideal para mostrar el MER en vivo durante la defensa de las Etapas 3 y 4, además de soporte nativo para RLS (`V5__triggers_funciones_politicas.sql`) y Buckets de archivos.
   - **Pooler Supavisor IPv4 incluido sin costo:** Como muchos proveedores de Backend gratuitos (Render, GitHub Actions, Docker local) no tienen conectividad IPv6 saliente, el pooler `*.pooler.supabase.com:6543` resuelve la conexión en IPv4 de forma transparente para `psycopg_pool`.
2. **Similitudes a una o varias de su área:**
   - Al igual que **Neon** y **Railway PostgreSQL**, provee una instancia real de PostgreSQL (no una emulación) que soporta el 100% de las extensiones (`pgcrypto`), triggers y funciones PL/pgSQL usadas por SGPI.
3. **Desventajas frente a las demás de su área:**
   - **Pausa automática tras 7 días de inactividad total en el plan gratuito:** Si el proyecto no recibe ninguna consulta durante una semana, Supabase pausa la instancia y hay que pulsar *"Restore project"* en el dashboard (tarda ~2 minutos en reanudarse), mientras que en planes de pago o **Neon** el despertar es automático en milisegundos.

---

### Opción C2: Neon (Serverless PostgreSQL)

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Crear cuenta y base de datos en Neon:**
   - Ingresa a [https://neon.tech](https://neon.tech) e inicia sesión con GitHub.
   - Crea un proyecto llamado `sgpi-vie-db`, selecciona **PostgreSQL 17/18** y la región **AWS US West 2 (Oregon)**.
2. **Migrar automáticamente el esquema y datos con Flyway (`docker-compose`) o SQL Editor:**
   - En el Dashboard de Neon, copia la **Connection string** (con opción *Pooled connection* activada):
     ```text
     postgresql://neondb_owner:[PASSWORD]@ep-xxxx-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require
     ```
   - Puedes pegar los scripts `V1` a `V5` en el **SQL Editor** de Neon, o bien ejecutar el contenedor oficial de **Flyway 11** desde tu terminal en `c:\Proyecto-Diseño\SGPI` apuntando a Neon:
     ```powershell
     docker run --rm `
       -v "${PWD}/Base de datos/Scripts:/flyway/sql:ro" `
       flyway/flyway:11 `
       -url="jdbc:postgresql://ep-xxxx.us-west-2.aws.neon.tech:5432/neondb?sslmode=require" `
       -user="neondb_owner" `
       -password="TU_PASSWORD" `
       migrate
     ```
3. **Configurar `DATABASE_URL` en el Backend:**
   - Asigna la cadena de conexión en `.env` y en tu servicio de Backend (Render/Railway/Fly.io).

#### 📊 Análisis Comparativo (Opción C2: Neon)
1. **Ventajas frente a las demás de su área:**
   - **No requiere restauración manual tras días de inactividad (*Auto-Resume* instantáneo):** A diferencia de Supabase que pausa el proyecto tras 7 días y exige entrar al panel web para reactivarlo, Neon suspende el cómputo cuando no se usa y **despierta automáticamente en ~300 ms** apenas llega la primera petición HTTP al Backend (`GET /health` o `POST /auth/login`).
   - **Ramificación de Base de Datos (*Database Branching* estilo Git):** Permite crear una rama copia exacta de la base de datos (`branch: demo-defensa`) con un clic. Si durante un ensayo el equipo modifica o borra propuestas, se puede restablecer la rama al estado limpio de los datos semilla en 1 segundo.
   - **Soporta PostgreSQL 17 y 18 de forma nativa**, coincidiendo con la versión definida en el `docker-compose.yml` original del proyecto.
2. **Similitudes a una o varias de su área:**
   - Comparte con **Supabase** el uso de un pooler de conexiones integrado (PgBouncer), editor SQL en el navegador, conexión cifrada por TLS (`sslmode=require`) y compatibilidad total con `psycopg 3`.
3. **Desventajas frente a las demás de su área:**
   - Se enfoca exclusivamente en PostgreSQL y autenticación básica; no incluye almacenamiento de archivos (Buckets S3) integrado en la misma plataforma como sí lo hace **Supabase Storage**.
   - El almacenamiento gratuito está limitado a 0.5 GB por cuenta (aunque los 5 scripts de SGPI ocupan menos de 15 MB, por lo que sobra espacio).

---

### Opción C3: Railway PostgreSQL / Render Managed PostgreSQL

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Aprovisionar PostgreSQL junto al Backend:**
   - **En Railway:** Dentro del mismo proyecto donde desplegaste el Backend (Opción B2), haz clic en **"+ New" → "Database" → "Add PostgreSQL"**.
   - **En Render:** Haz clic en **"New +" → "PostgreSQL"**, elige la misma región `Oregon (US West)` que el Backend y selecciona el plan gratuito.
2. **Vincular `DATABASE_URL` por red privada interna:**
   - En Railway, en las variables del servicio Backend, asigna `DATABASE_URL=${{Postgres.DATABASE_PRIVATE_URL}}`.
   - En Render, copia la **Internal Database URL** y pégala en la variable `DATABASE_URL` del Web Service.
3. **Poblar los scripts `V1` a `V5` usando la URL pública externa:**
   - Copia la **External Database URL** del panel y ejecuta `psql` o Flyway desde `c:\Proyecto-Diseño\SGPI`:
     ```powershell
     docker run --rm `
       -v "${PWD}/Base de datos/Scripts:/flyway/sql:ro" `
       flyway/flyway:11 `
       -url="jdbc:postgresql://HOST_EXTERNO:PUERTO/railway" `
       -user="postgres" `
       -password="PASSWORD" `
       migrate
     ```

#### 📊 Análisis Comparativo (Opción C3: Railway / Render PostgreSQL)
1. **Ventajas frente a las demás de su área:**
   - **Comunicación por red privada interna (Latencia $< 1\text{ ms}$ y cero costo de ancho de banda):** Al residir en el mismo centro de datos y red virtual privada (VPC) que el contenedor FastAPI, las consultas SQL no salen a Internet público.
   - **Gestión centralizada en un único panel:** Tanto los logs del Backend como las métricas de la base de datos se administran en una sola cuenta.
2. **Similitudes a una o varias de su área:**
   - Al igual que **Supabase** y **Neon**, entrega una instancia PostgreSQL estándar compatible con el driver `psycopg[binary,pool]` de `backend/requirements.txt`.
3. **Desventajas frente a las demás de su área:**
   - **Expiración de 30 días en el plan gratuito de Render PostgreSQL:** Las bases de datos gratuitas de Render se eliminan a los 30 días de creadas si no se actualizan a un plan de pago (mientras que **Supabase** y **Neon** no caducan).
   - Carecen de un editor SQL tan rico y de las herramientas visuales de diagramación e inspección de tablas que ofrece el Dashboard de **Supabase**.

---

## 🐳 6. Aspecto D: Hosting Full-Stack Unificado con Docker Compose / IaaS (`docker-compose.yml`)

Dado que `c:\Proyecto-Diseño\SGPI` ya cuenta con un archivo [`docker-compose.yml`](./docker-compose.yml) (y su variante completa con PostgreSQL 18 + Flyway 11 en [`MDS - cambios/yml anterior.md`](./MDS%20-%20cambios/yml%20anterior.md)), otra estrategia sumamente sólida es desplegar **todo el proyecto junto en una Máquina Virtual (VPS) en la nube** usando exactamente la misma arquitectura de contenedores probada en local.

---

### Opción D1: Microsoft Azure (Azure for Students — VM o App Service Multi-Container)

> 🎓 **Contexto TEC:** Todos los estudiantes del Instituto Tecnológico de Costa Rica con correo institucional `@estudiantec.cr` tienen acceso gratuito a **Azure for Students**, que otorga **\$100 USD en créditos renovables sin requerir tarjeta de crédito**, además de máquinas virtuales gratuitas (*B1s / B2pts v2*).

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Activar beneficio estudiantil ITCR:**
   - Ingresa a [https://azure.microsoft.com/es-es/free/students/](https://azure.microsoft.com/es-es/free/students/) e inicia sesión con tu cuenta `@estudiantec.cr`.
2. **Crear una Máquina Virtual Ubuntu 24.04 LTS en Azure Portal:**
   - Ve a **Máquinas virtuales → Crear → Máquina virtual de Azure**.
   - **Nombre:** `vm-sgpi-tec` · **Región:** `West US 2` · **Imagen:** `Ubuntu Server 24.04 LTS`.
   - **Tamaño:** `Standard_B2s` (2 vCPU, 4 GB RAM — cubierto por los \$100 de crédito).
   - **Puertos de entrada públicos:** Marca `SSH (22)`, `HTTP (80)`, `HTTPS (443)` y en **Redes → Reglas de puerto de entrada** agrega el puerto `3001` y `8080`.
3. **Conectarse por SSH e instalar Docker y Docker Compose:**
   ```bash
   ssh azureuser@<IP_PUBLICA_VM>
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
   sudo usermod -aG docker $USER
   newgrp docker
   ```
4. **Clonar el repositorio `SGPI`, configurar `.env` y levantar los contenedores:**
   ```bash
   git clone https://github.com/<tu-usuario>/SGPI.git
   cd SGPI
   cp .env.example .env
   nano .env # Colocar DATABASE_URL de Supabase (o usar el compose completo con Postgres + Flyway)
   ```
   - En `frontend/js/app.js`, actualiza `API_URL` para usar el hostname dinámico del servidor:
     ```javascript
     const API_URL = `http://${window.location.hostname}:3001`;
     ```
   - Levanta toda la plataforma en segundo plano:
     ```bash
     docker compose up -d --build
     ```
5. **Acceder al sistema desplegado:**
   - Frontend: `http://<IP_PUBLICA_VM>:8080/html/SGPI.html`
   - Backend API / Swagger: `http://<IP_PUBLICA_VM>:3001/docs`

#### 📊 Análisis Comparativo (Opción D1: Microsoft Azure for Students)
1. **Ventajas frente a las demás de su área:**
   - **100% Gratuito y sin tarjeta de crédito gracias al convenio institucional `@estudiantec.cr`:** Permite usar infraestructura de nivel empresarial con \$100 USD de saldo sin que ningún miembro del equipo tenga que ingresar datos bancarios.
   - **Fidelidad 1:1 con el entorno local de desarrollo:** Ejecuta exactamente el mismo `docker-compose.yml` (`sgpi-frontend` con Nginx + `sgpi-backend` con FastAPI, e incluso `sgpi-db` + `sgpi-flyway` si se desea independencia total), garantizando que si funciona en local, funciona idéntico en la nube.
2. **Similitudes a una o varias de su área:**
   - Es equivalente en arquitectura a **DigitalOcean Droplets** y **Oracle Cloud Compute VMs**: provee una máquina Linux completa con IP pública estática donde Docker Compose orquesta los contenedores del proyecto.
3. **Desventajas frente a las demás de su área:**
   - **Administración manual del servidor (IaaS):** A diferencia de plataformas PaaS (Vercel + Render), requiere conectarse por SSH para hacer `git pull && docker compose up -d --build` (o configurar un GitHub Action) y configurar un proxy inverso como Caddy o Certbot si se desea HTTPS con dominio propio.

---

### Opción D2: DigitalOcean (Droplet con Docker Compose)

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Activar créditos del GitHub Student Developer Pack (\$200 USD en DigitalOcean):**
   - Con tu cuenta `@estudiantec.cr` en [https://education.github.com/pack](https://education.github.com/pack), reclama el cupón de **\$200 USD por 1 año en DigitalOcean**.
2. **Crear un Droplet con la imagen preinstalada de Docker:**
   - En el panel de DigitalOcean, haz clic en **"Create" → "Droplets"**.
   - **Region:** `San Francisco` (US West).
   - **Choose an image → Marketplace:** Busca y selecciona **Docker on Ubuntu 24.04** (ya trae Docker Engine y Docker Compose listos).
   - **Size:** Basic Droplet (2 GB RAM / 1 vCPU — \$12/mes descontados de los \$200 gratuitos).
3. **Desplegar el proyecto por SSH con Caddy para HTTPS automático:**
   ```bash
   ssh root@<IP_DROPLET>
   git clone https://github.com/<tu-usuario>/SGPI.git /opt/sgpi
   cd /opt/sgpi
   # Configurar .env con DATABASE_URL
   docker compose up -d --build
   ```
   - *(Opcional)* Para tener HTTPS sin comprar dominio usando `sslip.io`, levanta Caddy apuntando `<IP_DROPLET>.sslip.io` hacia `localhost:8080` y `api.<IP_DROPLET>.sslip.io` hacia `localhost:3001`.

#### 📊 Análisis Comparativo (Opción D2: DigitalOcean)
1. **Ventajas frente a las demás de su área:**
   - **Simplicidad extrema e imagen *1-Click Docker* en el Marketplace:** El servidor arranca en 40 segundos con Docker y Docker Compose preconfigurados, reduciendo a la mitad los pasos de instalación respecto a Azure u Oracle Cloud.
   - **También cuenta con *DigitalOcean App Platform* (PaaS):** Si no se desea administrar Linux por SSH, permite conectar el repositorio GitHub y desplegar el `Dockerfile` del Backend y el sitio estático del Frontend desde una interfaz web muy intuitiva usando los mismos \$200 de crédito estudiantil.
2. **Similitudes a una o varias de su área:**
   - Comparte con **Azure VM** y **Oracle Cloud VM** el control total sobre puertos (`8080`, `3001`, `5433`), volúmenes persistentes (`sgpi_pgdata`) y ausencia total de límites de tiempo de ejecución (*sin timeouts ni cold starts*).
3. **Desventajas frente a las demás de su área:**
   - Para activar la cuenta de DigitalOcean (incluso con el cupón de GitHub Education) solicita verificar una tarjeta de débito/crédito o PayPal, mientras que **Azure for Students** solo requiere el correo `@estudiantec.cr`.

---

### Opción D3: Oracle Cloud Infrastructure (OCI Always Free ARM Ampere VM)

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Crear cuenta en Oracle Cloud Free Tier ([https://www.oracle.com/cloud/free/](https://www.oracle.com/cloud/free/)):**
   - Selecciona región `US West (Phoenix)` o `US West (San Jose)`.
2. **Crear instancia Compute `VM.Standard.A1.Flex` (Always Free):**
   - **Imagen:** Ubuntu 24.04.
   - **Shape:** Ampere ARM (`VM.Standard.A1.Flex`) con **hasta 4 OCPUs y 24 GB de RAM 100% gratis de por vida**.
3. **Abrir puertos en la VCN (Security List) y en el firewall de Ubuntu:**
   - En la consola OCI (**Networking → Virtual Cloud Networks → Security Lists**), agrega reglas de ingreso TCP para los puertos `80`, `443`, `3001` y `8080`.
   - En la terminal SSH de la máquina virtual:
     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --match multiport --dports 80,443,3001,8080 -j ACCEPT
     sudo netfilter-persistent save
     ```
4. **Ejecutar el stack completo (incluyendo PostgreSQL 18 + Flyway 11 local o Supabase):**
   ```bash
   git clone https://github.com/<tu-usuario>/SGPI.git
   cd SGPI
   docker compose up -d --build
   ```

#### 📊 Análisis Comparativo (Opción D3: Oracle Cloud Always Free)
1. **Ventajas frente a las demás de su área:**
   - **Potencia de hardware insuperable y gratuita para siempre (4 CPUs y 24 GB de RAM):** Es lo suficientemente potente para correr simultáneamente `sgpi-db` (PostgreSQL 18), `sgpi-flyway` (Flyway 11), `sgpi-backend` (FastAPI) y `sgpi-frontend` (Nginx) con sobrada memoria RAM y sin fecha de vencimiento.
2. **Similitudes a una o varias de su área:**
   - Opera como un servidor IaaS Linux con Docker Compose igual que **Azure VM** y **DigitalOcean Droplets**.
3. **Desventajas frente a las demás de su área:**
   - **Registro estricto y configuración de red de doble capa:** El formulario de registro de Oracle suele rechazar tarjetas prepago, y abrir puertos requiere tanto configurar la *Security List* en el panel web como modificar `iptables` dentro de Ubuntu.

---

## 📦 7. Aspecto E: Hosting de Documentos e Instrumentos Oficiales VIE 2027 (`Docs Proyecto/`)

Según el correo oficial de la convocatoria (`VIE-CP-074-2026` adjunto en el PDF) y el endpoint `GET /convocatorias/documentos_convocatoria?id_convocatoria=1` de [`backend/app/routers/convocatorias.py`](./backend/app/routers/convocatorias.py), el sistema pone a disposición de las personas investigadoras los **9 instrumentos oficiales descargables**:
1. `CIE-237-2026 S.E. 24-2026_art 1_Aprobacion de disposiciones e instrumentos...pdf`
2. `1-Disposiciones Convocatoria Fondos VIE 2027.pdf`
3. `2-Rúbricas_Investigación_2027__Fondos_VIE.xlsx`
4. `3- Formulario Actividad Fortalecimiento Fondos VIE 2027.docx`
5. `4- Formulario Proyecto Investigacion Fondos VIE 2027.docx`
6. `5- Plan de Acción y Gestión del Riesgo Fondos VIE 2027.xlsx`
7. `6- Plantilla Presupuesto Convocatoria Fondos VIE 2027.xlsx`
8. `7- Formato de acuerdo instancia coordinadora Fondos VIE 2027.docx`
9. `8- Formato de acuerdo instancia participante Fondos VIE 2027.docx`

Para que estos documentos y los anexos de las propuestas se descarguen realmente desde la nube, existen tres opciones principales de almacenamiento de objetos:

---

### Opción E1: Supabase Storage (Buckets S3 con Políticas RLS)

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Crear un Bucket público en el mismo proyecto de Supabase:**
   - En el Dashboard de Supabase → menú **Storage** → haz clic en **"New bucket"**.
   - **Name of bucket:** `instrumentos-vie-2027`
   - Activa el interruptor **"Public bucket"** y haz clic en **"Save"**.
2. **Subir los 9 archivos desde `Docs Proyecto`:**
   - Entra al bucket `instrumentos-vie-2027` → haz clic en **"Upload files"** y selecciona los 9 documentos (`.pdf`, `.docx`, `.xlsx`) de tu carpeta `Docs Proyecto`.
3. **Actualizar las URLs reales en la tabla `convocatoria_documentos`:**
   - Haz clic en **"Get URL"** para cada archivo subido (tendrán el formato `https://pxlrplbyggoywqbcgjdu.supabase.co/storage/v1/object/public/instrumentos-vie-2027/...`) y actualiza la columna `url_plantilla` en la tabla `convocatoria_documentos` desde el **SQL Editor**:
     ```sql
     UPDATE convocatoria_documentos
     SET url_plantilla = 'https://pxlrplbyggoywqbcgjdu.supabase.co/storage/v1/object/public/instrumentos-vie-2027/1-Disposiciones_Convocatoria_Fondos_VIE_2027.pdf'
     WHERE nombre ILIKE '%Disposiciones%';
     ```

#### 📊 Análisis Comparativo (Opción E1: Supabase Storage)
1. **Ventajas frente a las demás de su área:**
   - **Integración nativa con la Base de Datos actual y con las políticas RLS de `V5`:** No requiere crear otra cuenta ni gestionar credenciales externas; convive en el mismo proyecto `pxlrplbyggoywqbcgjdu` donde ya están las 36 tablas de SGPI.
   - **1 GB de almacenamiento gratuito con CDN integrada:** Los 9 archivos de la convocatoria Fondos VIE 2027 suman apenas **~1.2 MB en total** (`360K + 340K + 106K + 49K + 87K + 36K + 34K + 140K + 133K`), es decir, menos del 0.15% de la cuota gratuita.
2. **Similitudes a una o varias de su área:**
   - Expone una API compatible con el protocolo estándar **S3** igual que **Cloudflare R2** y **Amazon S3**, y permite generar URLs públicas permanentes o URLs firmadas temporales (*Signed URLs*).
3. **Desventajas frente a las demás de su área:**
   - Tiene un límite de tamaño por archivo individual de 50 MB en el plan gratuito y 2 GB de ancho de banda de salida mensual, mientras que **Cloudflare R2** ofrece salida (egreso) 100% gratuita e ilimitada.

---

### Opción E2: Cloudflare R2 (Object Storage sin Costo de Egreso)

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Crear un Bucket R2 en Cloudflare:**
   - En [https://dash.cloudflare.com](https://dash.cloudflare.com) → menú **R2 Object Storage** → **"Create bucket"** con el nombre `sgpi-documentos-vie`.
2. **Subir los 9 instrumentos de `Docs Proyecto`:**
   - Arrastra y suelta los 9 archivos `.pdf`, `.docx` y `.xlsx` en la interfaz del bucket.
3. **Habilitar acceso público (`r2.dev` o subdominio):**
   - Ve a la pestaña **Settings** del bucket → sección **Public access → R2.dev subdomain** → haz clic en **"Allow Access"**.
   - Usa la URL base generada (`https://pub-xxxx.r2.dev/<nombre-archivo>`) en la columna `url_plantilla` de `convocatoria_documentos`.

#### 📊 Análisis Comparativo (Opción E2: Cloudflare R2)
1. **Ventajas frente a las demás de su área:**
   - **Cero costo de transferencia saliente (*Zero Egress Fees*) y 10 GB gratis/mes:** A diferencia de AWS S3 o Supabase Storage, Cloudflare nunca cobra por el tráfico de descarga de los documentos PDF/Excel/Word.
2. **Similitudes a una o varias de su área:**
   - Compatible con el SDK de AWS S3 (`boto3` en Python) al igual que **Amazon S3** y **Supabase Storage**.
3. **Desventajas frente a las demás de su área:**
   - No está acoplado a las tablas de usuarios y roles de PostgreSQL como **Supabase Storage**, por lo que las reglas de permisos por rol deben validarse en el Backend FastAPI antes de entregar enlaces privados.

---

### Opción E3: Amazon S3 (AWS Simple Storage Service)

#### 🛠️ Dónde y cómo configurarlo paso a paso
1. **Crear un Bucket S3 en AWS Console (`us-west-2`):**
   - Ingresa a la consola de AWS → servicio **S3** → **"Create bucket"** con el nombre `sgpi-tec-fondos-vie-2027` en la región `US West (Oregon) us-west-2`.
2. **Configurar política de lectura pública para los instrumentos de convocatoria:**
   - Desmarca *"Block all public access"* únicamente para el prefijo `/instrumentos/*` y añade una *Bucket Policy* con `s3:GetObject` para `"Principal": "*"`.
3. **Subir los 9 documentos oficiales:**
   - Sube los archivos dentro de la carpeta `/instrumentos/` y registra sus URLs `https://sgpi-tec-fondos-vie-2027.s3.us-west-2.amazonaws.com/instrumentos/...` en `convocatoria_documentos`.

#### 📊 Análisis Comparativo (Opción E3: Amazon S3)
1. **Ventajas frente a las demás de su área:**
   - **Estándar de la industria con durabilidad del 99.999999999% (11 nueves):** Máxima madurez empresarial, versionado de objetos nativo (útil si el investigador sube una nueva versión de un anexo subsanado) y ciclo de vida auditable.
2. **Similitudes a una o varias de su área:**
   - Define el protocolo S3 sobre el cual están construidos tanto **Supabase Storage** como **Cloudflare R2**.
3. **Desventajas frente a las demás de su área:**
   - **Configuración de permisos IAM y Bucket Policies más compleja** que el interruptor de un solo clic de Supabase Storage, además de cobrar por transferencia de salida una vez superada la capa gratuita de 12 meses de AWS.

---

## 🧪 8. Verificación Post-Despliegue con `test_endpoints.ps1`

Una vez desplegado el Backend y la Base de Datos en cualquiera de las opciones anteriores, puedes verificar el **100% de operatividad en la nube** utilizando la suite automatizada [`test_endpoints.ps1`](./test_endpoints.ps1) incluida en la raíz del proyecto:

1. Abre [`test_endpoints.ps1`](./test_endpoints.ps1) y cambia la variable `$baseUrl` en las primeras líneas hacia tu URL de producción:
   ```powershell
   # Cambiar de http://localhost:3001 a la URL pública de tu Backend:
   $baseUrl = "https://sgpi-backend-api.onrender.com"
   ```
2. Ejecuta en PowerShell:
   ```powershell
   cd "c:\Proyecto-Diseño\SGPI"
   .\test_endpoints.ps1
   ```
3. **Resultado esperado para cumplir el 100% de la rúbrica de la Etapa 4 (20 pruebas en 5 fases):**
   - **Fase 1 (Infraestructura y Catálogos):**
     - `[GET] /health` $\rightarrow$ `[OK 200]`
     - `[GET] /catalogos` $\rightarrow$ `[OK 200]`
     - `[GET] /tipos_hora/totalTiposHora` $\rightarrow$ `[OK 200]`
     - `[GET] /escuelas/totalescuelas` $\rightarrow$ `[OK 200]`
     - `[GET] /modalidades/totalmodalidades` $\rightarrow$ `[OK 200]`
     - `[GET] /lineas_de_investigacion/totalLineas` $\rightarrow$ `[OK 200]`
   - **Fase 2 (Autenticación y Convocatorias):**
     - `[POST] /auth/login` $\rightarrow$ `[OK 200]`
     - `[GET] /convocatorias/totalConvocatorias` $\rightarrow$ `[OK 200]`
     - `[GET] /convocatorias/etapas_convocatorias?id_convocatoria=1` $\rightarrow$ `[OK 200]`
     - `[GET] /convocatorias/documentos_convocatoria?id_convocatoria=1` $\rightarrow$ `[OK 200]` *(9 instrumentos oficiales encontrados)*
   - **Fase 3 (Dashboard, Formulación y Transiciones):**
     - `[GET] /propuestas/dashboardpropuestas?id_usuario=1` $\rightarrow$ `[OK 200]`
     - `[GET] /propuestas/top3PropuestaMasReciente?id_usuario=1` $\rightarrow$ `[OK 200]`
     - `[GET] /propuestas` $\rightarrow$ `[OK 200]`
     - `[POST] /propuestas` $\rightarrow$ `[OK 201]` *(Creación atómica con código `SI-YYYY-NNN`)*
     - `[GET] /propuestas/{id}` $\rightarrow$ `[OK 200]`
     - `[PATCH] /propuestas/{id}/estado` $\rightarrow$ `[OK 200]`
     - `[PATCH] /notificaciones/leer-todas?id_usuario=1` $\rightarrow$ `[OK 200]`
   - **Fase 4 y 5 (Motor de Evaluación Preliminar con Google Gemini IA Free Tier: `gemini-3.5-flash`):**
     - `[GET] /ia/estado` $\rightarrow$ `[OK 200]`
     - `[GET] /ia/criterios` $\rightarrow$ `[OK 200]`
     - `[POST] /ia/evaluar-borrador` $\rightarrow$ `[OK 200]`
     - `[GET] /ia/evaluacion-preliminar/{id}` $\rightarrow$ `[OK 200]`
     - `[POST] /ia/evaluar-propuesta/{id}` $\rightarrow$ `[OK 200]`

---

## 🏆 9. Combinaciones Recomendadas para la Entrega Final (Etapa 4)

De acuerdo con los criterios de la **Rúbrica de Evaluación (Etapa 4: 35%)** del documento del curso, se sugieren las siguientes **3 arquitecturas de despliegue combinadas**:

| Perfil de Despliegue | Frontend (`frontend/`) | Backend (`backend/`) | Base de Datos (`Base de datos/`) | Documentos (`Docs Proyecto/`) | ¿Por qué elegir esta combinación? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **🥇 Recomendada 1: Cloud Nativa Sin Costo y Baja Latencia** | **Vercel** o **Cloudflare Pages** | **Render** (Región `Oregon`) o **Railway** | **Supabase Cloud** (`us-west-2` — *Ya configurada*) | **Supabase Storage** | Aprovecha la base de datos de Supabase que ya está poblada y funcionando en el proyecto, despliega el Frontend en CDN global y aloja el Backend en la misma zona geográfica (`US West`) con despliegue continuo desde GitHub. |
| **🥈 Recomendada 2: Convenio Estudiantil TEC (`@estudiantec.cr`)** | **Azure VM (Docker Compose: Nginx)** | **Azure VM (Docker Compose: FastAPI)** | **Supabase Cloud** o **PostgreSQL 18 en Docker + Flyway 11** | **Supabase Storage** | Usa un único comando `docker compose up -d --build` en una máquina virtual financiada por los \$100 USD gratuitos de *Azure for Students*, sin depender de límites de tiempo de inactividad de servicios gratuitos. |
| **🥉 Recomendada 3: Serverless & Auto-Resume Instantáneo** | **Netlify** | **Fly.io** o **Google Cloud Run** | **Neon Serverless Postgres** (con ramas de BD) | **Cloudflare R2** | Ideal si se deja el proyecto publicado por meses como portafolio: ningún servicio se pausa permanentemente tras 7 días de inactividad y las ramas de Neon permiten restaurar el estado inicial de la demostración en 1 segundo. |
