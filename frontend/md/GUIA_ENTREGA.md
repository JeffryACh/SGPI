# SGPI · VIE — Guía de Entrega y Demostración

## Estado Real del Sistema

**Sistema Full-Stack completamente integrado, desplegado y verificado:**
1. **Frontend SPA:** Prototipo interactivo de 33 pantallas base, seis roles institucionales y componentes modales. Configurado para despliegue en **Vercel** (`vercel.json`) o localmente mediante Nginx / navegador (`frontend/html/SGPI.html`).
2. **Backend API REST:** Desarrollado en FastAPI 0.143.2 y Python 3.12, configurado para despliegue en **Render** (`render.yaml`) o Docker Compose local (`http://localhost:3001`), con documentación interactiva en `/docs`.
3. **Base de Datos en Supabase Cloud:** Instancia de PostgreSQL 14.17 en AWS `us-west-2` (Oregon) con 37 tablas relacionales (incluyendo `public.ai_preliminary_evaluations`), triggers automáticos para generación de códigos `SI-YYYY-NNN`, trazabilidad inmutable y Row Level Security (RLS).
4. **Motor de IA Google Gemini (Plan Gratuito):** Integración nativa con Google AI Studio Free Tier (`gemini-3.5-flash` con fallback automático a `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-lite-latest` y motor normativo determinista VIE 2027) para generar evaluaciones preliminares estructuradas en 5 niveles.
5. **Verificación Automatizada:** Suite de pruebas en [`test_endpoints.ps1`](../../test_endpoints.ps1) con **27 verificaciones funcionales de extremo a extremo** en 6 fases pasando al 100% (incluyendo el flujo completo de evaluación, rúbrica V12 y dictamen del Comité Técnico).

---

## Recorridos de Demostración para Evaluación Académica

### Recorrido 1: Formulación, Validación Normativa y Envío con Asistencia IA
1. Abre la aplicación (`http://localhost:8080`, `SGPI.html` o la URL de Vercel) e ingresa con las credenciales de demostración (`laura.mendez@example.com` / `demostracion`).
2. Navega a **Convocatorias $\rightarrow$ Fondos VIE 2027 $\rightarrow$ Crear propuesta $\rightarrow$ Desarrollo tecnológico**.
3. Recorre el asistente de 11 pasos: datos generales, equipo (con tipos de hora oficiales `VIE`, `CONS`, `REC`, etc.), fundamentación, objetivos, metodología, plan de acción mensualizado, riesgos vinculados, presupuesto anualizado, información complementaria y declaraciones éticas.
4. En **Presupuesto (Paso 8)**, comprueba la regla de la **Sección 2.3.9**: el sistema valida que bienes duraderos y equipos solo se presupuesten en el Año 1.
5. En **Revisión y Pre-envío (Paso 11 / Pantalla 18)**, haz clic en **«Confirmar y enviar propuesta»**:
   - El sistema invoca `POST /propuestas` para persistir la propuesta atómicamente en Supabase.
   - Dispara concurrentemente la evaluación preliminar con **Google Gemini Free Tier** (`POST /ia/evaluar-borrador`).
   - La **Pantalla 19** muestra el código institucional generado (`SI-YYYY-NNN`) junto con la insignia del **Puntaje Preliminar sugerido por la IA**.

---

### Recorrido 2: Evaluación Multi-Instancia Asistida por IA (Los 5 Niveles)

Usa el selector interactivo de rol institucional en la barra superior o en Mi Perfil para simular las 5 instancias:

1. **Nivel 1: Centro de Vinculación (Pantalla 23)**
   - Abre la propuesta en la bandeja de Vinculación.
   - Observa la tarjeta **«Evaluación Preliminar IA (Gemini)»**: resalta el potencial de registro de software/patente, coherencia del TRL (4 a 6) y emite recomendación sobre resguardo de titularidad antes de divulgar.
   - Registra el dictamen de vinculación.

2. **Nivel 2: Comité Técnico (Pantalla 24)**
   - Ingresa como evaluador del Comité Técnico (ej. Gabriel Sánchez Mora). Accede a la bandeja de expedientes en evaluación (`GET /propuestas/comite/bandeja`).
   - Observa el panel de IA con el puntaje ponderado calculado sobre 100% y la recomendación técnica.
   - Haz clic en el botón **«Aplicar puntajes IA como base»**: los selectores de la rúbrica oficial V12 (8 secciones / 23 criterios) se auto-completan con los valores sugeridos (`0, 6, 8, 10`).
   - Modifica cualquier criterio obligatorio a *Regular - 6*: el servidor rechaza la recomendación con código 409 (regla bloqueante verificada en backend).
   - Al emitir dictamen favorable (`POST /propuestas/comite/{id}`), el backend persiste las notas en `technical_committee_scores` y avanza automáticamente la propuesta al estado 4 (*Pendiente de aval del Consejo*).

3. **Nivel 3: Consejo de Escuela (Pantalla 25)**
   - Como Coordinador de Escuela, revisa la tarjeta de IA: confirma que la dedicación horaria semanal de los docentes es viable y que el proyecto se alinea a los programas del departamento.
   - Registra el acuerdo formal de aval (Formatos oficiales 7 y 8).

4. **Nivel 4: Dirección de Investigación VIE (Pantalla 26)**
   - El investigador realiza el sometimiento formal en Seguimiento (Pantalla 20).
   - En Dirección de Investigación, el panel de IA despliega el **Checklist Automatizado de 5 Puntos de Admisibilidad VIE** (morosidad, riesgos, beca de asistente $\ge 10\text{ h/sem}$, declaraciones éticas y dictamen de vinculación).
   - Emite el dictamen de admisibilidad favorable.

5. **Nivel 5: Consejo de Investigación y Extensión — CIE (Pantalla 27)**
   - En el CIE, revisa el panel de IA que presenta un **Borrador Motivado de Acuerdo de Aprobación** listo para ser incorporado en acta formal.
   - Registra la resolución formal **Aprobada**.
   - Al volver al rol de Investigador, se visualiza la carta formal de aceptación y resolución institucional.

---

### Recorrido 3: Consulta Histórica, Filtros Facetados y Trazabilidad Auditable
1. Desde el menú lateral, accede al módulo de **Consulta Histórica (Pantallas 29 y 30)**.
2. Aplica filtros combinados por escuela (COMP, BIOL, ADE, etc.), modalidad de investigación o estados.
3. Busca expedientes por texto libre o código institucional (`SI-2027` o `SI-2024`).
4. Abre cualquier expediente cerrado para revisar el dossier completo: resumen, equipo, presupuesto ejecutado, evaluaciones históricas y la bitácora inmutable de transiciones de estado (`proposal_state_history`).

---

## Comprobación Automatizada de la API

Para verificar el funcionamiento completo de las 27 pruebas de endpoints (incluyendo la Fase 5 del Comité Técnico) en PowerShell:
```powershell
.\test_endpoints.ps1
```
Todas las pruebas deben responder con estado `[OK 200]` o `[OK 201]`, validando la conectividad con Supabase y la integración con la IA de Google Gemini.
