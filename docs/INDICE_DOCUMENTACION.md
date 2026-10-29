# 📚 Índice General de Documentación Técnica — SGPI

Bienvenido al repositorio central de documentación técnica, guías de despliegue en la nube, especificaciones normativas de la Convocatoria Fondos VIE 2027 e integración con **Google Gemini IA (Plan Gratuito)** del **Sistema para la Gestión de Propuestas de Investigación (SGPI)** del **Instituto Tecnológico de Costa Rica (TEC)**.

---

## 🗂️ Estructura de Directorios de Documentación (`docs/`)

La documentación se encuentra organizada en dos módulos temáticos para facilitar su navegación y mantenimiento:

```text
docs/
├── INDICE_DOCUMENTACION.md              # Este índice general y mapa de lectura
│
├── hosting/                            # Guías de despliegue e infraestructura en la nube
│   ├── OpcionesDeHosting.md            # Análisis comparativo detallado (5 aspectos, 3+ opciones c/u)
│   └── Configuracion_Gemini_IA_y_Despliegue.md # Despliegue paso a paso en Vercel, Render y Supabase
│
└── ia/                                 # Especificación de IA (Google Gemini Free Tier)
    ├── Criterios_y_Parametros_Evaluacion_IA_VIE2027.md # Rúbrica VIE 2027, 19 criterios y 5 niveles evaluadores
    ├── Contexto_Prompt_y_Esquema_JSON_Gemini.md        # Prompt de sistema, esquema JSON y ejemplos
    └── contexto_sistema_gemini_vie2027.json            # Base de conocimiento estructurada (formato JSON)
```

---

## 🌐 1. Módulo de Hosting y Despliegue en la Nube (`docs/hosting/`)

| Documento | Enfoque y Contenido Clave | Audiencia |
| :--- | :--- | :--- |
| **[`OpcionesDeHosting.md`](./hosting/OpcionesDeHosting.md)** | Análisis comparativo exhaustivo con **Ventajas, Similitudes y Desventajas** de al menos 3 a 4 opciones en 5 aspectos de infraestructura:<br>1. *Aspecto A (Frontend):* Vercel, Netlify, Cloudflare Pages, GitHub Pages.<br>2. *Aspecto B (Backend API):* Render, Railway, Fly.io, Google Cloud Run.<br>3. *Aspecto C (Base de Datos):* Supabase Cloud PostgreSQL, Neon Serverless, Railway/Render DB.<br>4. *Aspecto D (IaaS / Docker):* Azure for Students VM, DigitalOcean Droplet, Oracle Cloud Always Free.<br>5. *Aspecto E (Storage S3):* Supabase Storage, Cloudflare R2, Amazon S3. | Arquitectos de Software / Evaluadores |
| **[`Configuracion_Gemini_IA_y_Despliegue.md`](./hosting/Configuracion_Gemini_IA_y_Despliegue.md)** | Guía paso a paso para la configuración del stack objetivo de producción del SGPI:<br>• Obtención de `GEMINI_API_KEY` gratuita en Google AI Studio (sin tarjeta bancaria).<br>• Despliegue del Backend Docker en **Render** (región `oregon` / `us-west-2`).<br>• Despliegue del Frontend SPA en **Vercel** (`vercel.json`).<br>• Conexión a la base de datos PostgreSQL en **Supabase Cloud** (`pxlrplbyggoywqbcgjdu`).<br>• Diagnóstico y validación post-despliegue con `test_endpoints.ps1`. | Desarrolladores / DevOps |

---

## 🤖 2. Módulo de Inteligencia Artificial — Google Gemini Free Tier (`docs/ia/`)

| Documento | Enfoque y Contenido Clave | Audiencia |
| :--- | :--- | :--- |
| **[`Criterios_y_Parametros_Evaluacion_IA_VIE2027.md`](./ia/Criterios_y_Parametros_Evaluacion_IA_VIE2027.md)** | Especificación normativa completa de la evaluación preliminar generada por Gemini:<br>• Los **8 bloques temáticos y 19 criterios** de la Rúbrica Oficial de Fondos VIE 2027.<br>• Escala discreta cerrada (`0 = Deficiente`, `6 = Regular`, `8 = Bueno`, `10 = Excelente`).<br>• Regla bloqueante: calificación $< 8$ en cualquiera de los **12 criterios obligatorios** impide recomendar la propuesta.<br>• Verificación de reglas cuantitativas duras: topes presupuestarios por modalidad, Sección 2.3.9 (equipo e instrumentación solo en Año 1) y Sección 2.4.1 (cuota de productos académicos según dedicación horaria).<br>• Criterios y parámetros específicos para los **5 niveles de evaluación** (1. Vinculación, 2. Comité Técnico, 3. Consejo de Escuela, 4. Dirección VIE, 5. CIE). | Evaluadores Institucionales / Analistas |
| **[`Contexto_Prompt_y_Esquema_JSON_Gemini.md`](./ia/Contexto_Prompt_y_Esquema_JSON_Gemini.md)** | Detalles técnicos de integración con Google Gemini API:<br>• Configuración REST de Google AI Studio Free Tier (`gemini-2.5-flash` $\rightarrow$ `gemini-2.5-flash-lite` $\rightarrow$ `gemini-2.0-flash`).<br>• *System Prompt* y formato de inyección del expediente estructurado + pre-auditoría matemática.<br>• Contrato JSON de salida (`responseMimeType: "application/json"`).<br>• Ejemplo real de dictamen generado para el expediente demostrativo `SI-2027-014` (*Agua Inteligente: monitoreo de cuencas*). | Ingenieros de Software / Backend |
| **[`contexto_sistema_gemini_vie2027.json`](./ia/contexto_sistema_gemini_vie2027.json)** | Base de conocimiento machine-readable que compila todos los modelos del Free Tier, topes presupuestarios, modalidades, catálogo de rubros, reglas de cálculo y los 19 criterios para automatización de pruebas y consumo programático. | Integración y Pruebas Automatizadas |

---

## 🔗 Enlaces Cruzados con la Documentación del Sistema

Para consultar otros aspectos del SGPI:
- **Vista General y Arquitectura del Sistema:** [`README.md`](../README.md)
- **Frontend y Catálogo de Pantallas:** [`frontend/md/CATALOGO.md`](../frontend/md/CATALOGO.md) y [`frontend/md/app.md`](../frontend/md/app.md)
- **Rutas de Demostración y Validación:** [`frontend/md/GUIA_ENTREGA.md`](../frontend/md/GUIA_ENTREGA.md) y [`frontend/md/VALIDACION.md`](../frontend/md/VALIDACION.md)
- **Trazabilidad Normativa VIE 2027:** [`frontend/md/REQUISITOS_Y_TRAZABILIDAD.md`](../frontend/md/REQUISITOS_Y_TRAZABILIDAD.md)
- **Diccionario de Datos y Modelo Relacional:** [`Base de datos/Markdowns/diseño.md`](../Base%20de%20datos/Markdowns/diseño.md)
- **Bitácora de Migraciones y Cambios en BD:** [`Base de datos/Cambios.md`](../Base%20de%20datos/Cambios.md)

