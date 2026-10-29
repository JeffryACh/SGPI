# 🧠 Archivo de Contexto, System Prompt y Contrato JSON para Google Gemini API
### Sistema para la Gestión de Propuestas de Investigación (SGPI — Fondos VIE 2027)

**Propósito:** Este documento contiene las referencias de ingeniería de prompts (*System Instruction*), el esquema JSON estricto (`responseMimeType: "application/json"`) y un ejemplo real de respuesta generada para el expediente principal del proyecto (`SI-2027-014 · Agua Inteligente: monitoreo de cuencas`).

---

## 1. Configuración de la Petición HTTP hacia Google Gemini API (Free Tier)

- **Endpoint Oficial REST (Google AI Studio Free Tier):**
  ```text
  POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}
  ```
- **Modelos Gratuitos Soportados en Orden de Prioridad:**
  1. `gemini-2.5-flash` *(Modelo primario recomendado: equilibra razonamiento normativo profundo y baja latencia)*.
  2. `gemini-2.5-flash-lite` *(Primer fallback gratuito de alta cuota: hasta 1.000 peticiones diarias gratis)*.
  3. `gemini-2.0-flash` *(Segundo fallback gratuito)*.
- **Parámetros de Generación (`generationConfig`):**
  ```json
  {
    "temperature": 0.2,
    "responseMimeType": "application/json"
  }
  ```
  *(Se utiliza `temperature: 0.2` para asegurar consistencia evaluativa, determinismo en las calificaciones `0 / 6 / 8 / 10` y apego estricto a las Disposiciones VIE 2027).*

---

## 2. Plantilla del Prompt de Sistema Inyectado a Gemini

```text
Eres el Asistente Experto de Evaluación Preliminar de la Vicerrectoría de Investigación y Extensión (VIE)
del Instituto Tecnológico de Costa Rica (TEC) para la Convocatoria Fondos VIE 2027 (Acuerdo CIE-237-2026).

Tu objetivo es analizar la propuesta enviada a revisión y generar una EVALUACIÓN PRELIMINAR DE REFERENCIA
(no vinculante) que sirva de guía técnica a los 5 niveles de evaluadores del sistema SGPI:
1. Centro de Vinculación (Pantalla 23): Propiedad intelectual (PI), TRL 4-7 y resguardo previo a divulgación.
2. Comité Técnico (Pantalla 24): Calificación en escala estricta 0 (Deficiente), 6 (Regular), 8 (Bueno) o 10 (Excelente)
   para los 19 criterios de la rúbrica oficial. Recuerda que si un criterio obligatorio tiene 0 o 6, bloquea la recomendación.
3. Consejo de Escuela (Pantalla 25): Pertinencia académica, dedicación horaria semanal y respaldo presupuestario.
4. Dirección de Investigación VIE (Pantalla 26): Verificación de los 5 puntos del checklist de admisibilidad.
5. Consejo de Investigación y Extensión CIE (Pantalla 27): Valoración estratégica y borrador motivado de resolución.

DATOS DEL EXPEDIENTE ENVIADO A REVISIÓN:
{EXPEDIENTE_JSON}

PRE-AUDITORÍA NORMATIVA CUANTITATIVA (FONDOS VIE 2027):
{AUDITORIA_CUANTITATIVA_JSON}

Responde ÚNICAMENTE con un objeto JSON válido que contenga exactamente las siguientes llaves:
- "resumen_ejecutivo"
- "criterios_sugeridos"
- "referencia_vinculacion"
- "referencia_comite_tecnico"
- "referencia_consejo_escuela"
- "referencia_direccion_vie"
- "referencia_cie"
- "fortalezas"
- "alertas_normativas"
```

---

## 3. Ejemplo Completo de Salida JSON (Expediente `SI-2027-014`)

```json
{
  "id_propuesta": 1,
  "codigo": "SI-2027-014",
  "titulo": "Agua Inteligente: monitoreo de cuencas",
  "modelo_ia": "gemini-2.5-flash",
  "modo_generacion": "gemini_online",
  "es_plan_gratuito": true,
  "caracter": "Referencia preliminar no vinculante para apoyo de instancias evaluadoras",
  "puntaje_preliminar": 85.6,
  "recomendacion_global": "Recomendada",
  "tiene_bloqueo_obligatorio": false,
  "resumen_ejecutivo": "Evaluación preliminar generada para «Agua Inteligente: monitoreo de cuencas» (SI-2027-014) en la modalidad de Desarrollo tecnológico. La propuesta obtiene una calificación técnica preliminar de 85.6/100 con estado 'Recomendada'. Registra 16 h/semana de dedicación del equipo y un presupuesto total de ₡9,400,000. Cumple todos los criterios obligatorios de la rúbrica Fondos VIE 2027.",
  "referencia_vinculacion": {
    "potencial_pi": "Alto potencial de protección mediante registro de software / activo tecnológico.",
    "coherencia_trl": "TRL inicial 4 a TRL meta 6 coherente con validación en entorno relevante (microcuencas piloto).",
    "dictamen_sugerido": "Favorable — Emitir dictamen técnico de PI e instruir resguardo previo a divulgación.",
    "observacion_clave": "Verificar titularidad institucional TEC de los desarrollos de software y protocolos de calibración antes de someter artículos a revistas indexadas."
  },
  "referencia_comite_tecnico": {
    "puntaje_sugerido": 85.6,
    "cumple_umbral_70": true,
    "criterios_obligatorios_conformes": true,
    "produccion_comprometida_conforme": true,
    "justificacion_rubrica": "El diseño metodológico, el plan de 4 actividades y la matriz de 4 riesgos guardan trazabilidad con los objetivos específicos. Para 16 h/semana se exige un mínimo de 2 productos académicos y la propuesta compromete 3 (software + artículo WoS/Scopus + manual técnico)."
  },
  "referencia_consejo_escuela": {
    "viabilidad_horaria": "Conforme: 16 h/semana totales (cumple mínimo de 8 h/sem del proyecto y >= 4 h/sem por investigador).",
    "pertinencia_escuela": "Alineada con las líneas prioritarias de Escuela de Ingeniería Ambiental.",
    "recomendacion_aval": "Otorgar Aval de Consejo de Escuela (Formatos oficiales 7 y 8) ratificando presupuesto y nota técnica.",
    "verificacion_presupuestaria": "Monto total de ₡9,400,000 dentro del techo de la modalidad (₡4,800,000 en 2027 y ₡4,600,000 en 2028)."
  },
  "referencia_direccion_vie": {
    "dictamen_sugerido": "Favorable",
    "checklist_verificado": [
      {
        "criterio": "Personal investigador al día con compromisos institucionales",
        "cumple": true,
        "detalle": "Sin morosidad registrada en el sistema para los miembros del equipo."
      },
      {
        "criterio": "Coherencia de riesgos identificados y medidas de mitigación",
        "cumple": true,
        "detalle": "Se registran 4 riesgos con sus respectivas medidas preventivas."
      },
      {
        "criterio": "Inclusión obligatoria de beca para estudiante asistente especial",
        "cumple": true,
        "detalle": "Partida de beca asistente especial (10 h/semana a ₡2.400/h) verificada en el presupuesto."
      },
      {
        "criterio": "Declaraciones éticas completas y debidamente justificadas",
        "cumple": true,
        "detalle": "Declaraciones bioéticas individuales revisadas por eje normativo."
      },
      {
        "criterio": "Dictamen emitido por el Centro de Vinculación (DT / PI)",
        "cumple": true,
        "detalle": "Requisito verificado en la ruta de tramitación de Desarrollo Tecnológico."
      }
    ]
  },
  "referencia_cie": {
    "resolucion_sugerida": "Aprobada",
    "borrador_acuerdo": "Se recomienda al Consejo de Investigación y Extensión (CIE) emitir resolución APROBADA para el expediente SI-2027-014 («Agua Inteligente: monitoreo de cuencas»), con un presupuesto total de ₡9,400,000, tras alcanzar una calificación técnica de referencia de 85.6/100 y satisfacer los controles normativos de Fondos VIE 2027.",
    "impacto_estrategico": "Alta contribución a la solución de problemas nacionales y transferencia tecnológica institucional."
  },
  "fortalezas": [
    "Alineación metodológica clara con la modalidad de Desarrollo tecnológico y la línea de Gestión integrada del recurso hídrico.",
    "Dedicación horaria equilibrada (16 h/semana) e incorporación de participación estudiantil activa.",
    "Estructuración completa de actividades del plan de acción vinculadas con riesgos y medidas de mitigación.",
    "Cumplimiento de la regla presupuestaria Sección 2.3.9 (equipamiento concentrado en el primer año de ejecución)."
  ],
  "alertas_normativas": [
    "Sin incumplimientos normativos bloqueantes detectados en la revisión preliminar."
  ],
  "criterios_sugeridos": {
    "Composición disciplinaria": 8,
    "Experiencia": 8,
    "Articulación del equipo": 8,
    "Vinculación externa": 8,
    "Trayectoria de coordinación": 8,
    "Participación estudiantil": 10,
    "Definición del problema": 8,
    "Coherencia de objetivos": 8,
    "Diagnóstico y vacío de conocimiento": 8,
    "Rigor del desarrollo": 10,
    "Usuarios y validación": 8,
    "Claridad de actividades y responsables": 8,
    "Giras y actividades académicas": 8,
    "Trazabilidad y plazos": 8,
    "Coherencia y topes": 8,
    "Equipamiento en primer año": 10,
    "Otros fondos": 8,
    "Identificación por actividad": 8,
    "Viabilidad de mitigación": 8,
    "Declaración ética": 8,
    "Gestión de propiedad intelectual": 10,
    "Contribución e impacto": 10,
    "Innovación": 8
  }
}
```
