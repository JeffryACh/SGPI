# 📋 Criterios, Parámetros y Reglas de Evaluación Preliminar con IA (Gemini Free Tier)
### Referencia Técnica por Nivel de Evaluación — Convocatoria Fondos VIE 2027 (TEC)

**Proyecto:** Sistema para la Gestión de Propuestas de Investigación (SGPI)  
**Fuente Normativa:** `1-Disposiciones Convocatoria Fondos VIE 2027.pdf`, `2-Rúbricas_Investigación_2027__Fondos_VIE.xlsx`, `CIE-237-2026`  
**Implementación en Código:** [`backend/app/routers/ia.py`](file:///C:/Proyecto-Diseño/SGPI/backend/app/routers/ia.py) y [`frontend/js/app.js`](file:///C:/Proyecto-Diseño/SGPI/frontend/js/app.js)

---

## 🎯 1. Objetivo de la Evaluación Preliminar con IA

Cuando un investigador o grupo de investigadores envía una propuesta a revisión, el motor de **Google Gemini (`gemini-2.5-flash` — Plan Gratuito)** evalúa de forma transversal todos los componentes del expediente y genera un **Dictamen Preliminar Estructurado en 5 Niveles**.

> [!IMPORTANT]
> **Carácter Referencial No Vinculante:** La evaluación generada por Gemini no sustituye el criterio académico ni emite acuerdos oficiales por sí sola; su propósito es ofrecer a los evaluadores de cada instancia una **línea base objetiva, pre-verificada contra las reglas numéricas de la VIE**, que agiliza la revisión y previene omisiones normativas.

---

## 🔢 2. Parámetros Cuantitativos y Reglas Duras Pre-Auditadas

Antes de enviar el prompt a Gemini Online, el Backend ejecuta la función `_auditar_reglas_v2027()` en [`backend/app/routers/ia.py`](file:///C:/Proyecto-Diseño/SGPI/backend/app/routers/ia.py) para verificar matemáticamente los siguientes parámetros obligatorios:

| Parámetro Normativo | Actividad de Fortalecimiento | Investigación Básica / Aplicada | Desarrollo Tecnológico (DT) |
| :--- | :--- | :--- | :--- |
| **Duración Máxima Inicial** | 12 meses (1 año, sin prórroga) | 24 meses (2 años) | 36 meses (3 años) |
| **Tope Presupuestario Anual** | **₡2.000.000** (total) | **₡4.000.000 / año** | **₡5.000.000 / año** |
| **Dedicación Horaria del Proyecto** | Máx. $8\text{ h/semana}$ (mín. $4\text{ h}$ `VIE`/`VIE-Centros`/`CONS`) | Mín. $8\text{ h/semana}$ `VIE`/`VIE-Centros`/`CONS` | Mín. $8\text{ h/semana}$ `VIE`/`VIE-Centros`/`CONS` |
| **Dedicación Mínima Individual** | $\ge 4\text{ h/semana}$ por investigador | $\ge 4\text{ h/semana}$ ($\ge 2\text{ h}$ si es `REC`) | $\ge 4\text{ h/semana}$ ($\ge 2\text{ h}$ si es `REC`) |
| **Beca Estudiante Asistente** | Opcional según alcance | **Obligatoria:** mín. $10\text{ h/sem}$ a **₡2.400/h** (hasta 10 meses/año) | **Obligatoria:** mín. $10\text{ h/sem}$ a **₡2.400/h** (hasta 10 meses/año) |
| **Equipo y Bienes Duraderos** | Solo Año 1 (Sección 2.3.9) | **Exclusivamente en Año 1** (Sección 2.3.9) | **Exclusivamente en Año 1** (Sección 2.3.9) |
| **Cuota Mínima de Productos** | 1 documento de sistematización + 1 opción §3.6 | $\lceil \text{Horas Totales} / 10 \rceil$ opciones académicas | **1 Activo de PI** + opciones según horas (1–10h: 2; 11–20h: 3; 21–30h: 4) |

---

## 🏛️ 3. Desglose de Criterios y Parámetros por Nivel Evaluador

### Nivel 1: Centro de Vinculación (Pantalla 23 — `referencia_vinculacion`)
* **¿Cuándo interviene?:** Obligatoriamente en todas las propuestas de **Desarrollo Tecnológico** o en aquellas de Investigación Básica/Aplicada que declaren potencial de Propiedad Intelectual (PI).
* **Parámetros que analiza Gemini para este nivel:**
  1. `potencial_pi`: Identificación de activos intangibles protegibles (software, algoritmos, patentes de invención, modelos de utilidad, diseños industriales, secretos empresariales o trazados de circuitos).
  2. `coherencia_trl`: Consistencia entre el **TRL inicial** y el **TRL esperado** (rango normativo DT: TRL 4 a TRL 7) respecto a las actividades de validación en entorno relevante.
  3. `dictamen_sugerido`: Recomendación preliminar (*Favorable*, *Favorable con resguardo de confidencialidad* o *Requiere aclaración de titularidad*).
  4. `observacion_clave`: Advertencias sobre no divulgar resultados en congresos o revistas antes de formalizar el registro de PI con el Centro de Vinculación.

---

### Nivel 2: Comité Técnico (Pantalla 24 — `referencia_comite_tecnico` y `criterios_sugeridos`)
* **¿Cuándo interviene?:** Evalúa la calidad científico-técnica de la propuesta mediante la **Rúbrica Oficial Ponderada (`2-Rúbricas_Investigación_2027__Fondos_VIE.xlsx`)**.
* **Escala cerrada de calificación:**
  * **`0` (Deficiente):** No cumple o carece de información.
  * **`6` (Regular):** Cumplimiento parcial o insuficiente *(bloquea recomendación si el criterio es obligatorio)*.
  * **`8` (Bueno):** Cumple adecuadamente el estándar institucional.
  * **`10` (Excelente):** Cumple de forma sobresaliente, rigurosa y completamente trazable.
* **Los 8 Bloques y 19 Criterios Evaluados por Gemini:**

| Bloque Temático | Peso del Bloque | Criterio Específico | Peso Individual | ¿Es Obligatorio / Bloqueante? |
| :--- | :---: | :--- | :---: | :---: |
| **1. Equipo** | **15%** | Composición disciplinaria | 3% | No |
| | | Experiencia | 3% | No |
| | | Articulación del equipo | 3% | No |
| | | Vinculación externa | 2% | No |
| | | Trayectoria de coordinación | 2% | No |
| | | **Participación estudiantil** | 2% | **Sí (Requiere $\ge 8$)** |
| **2. Fundamentación** | **12%** | Definición del problema | 4% | No |
| | | Coherencia de objetivos | 4% | No |
| | | **Diagnóstico y vacío de conocimiento** | 4% | **Sí (Requiere $\ge 8$)** |
| **3. Metodología** | **15%** | **Rigor del desarrollo** | 8% | **Sí (Requiere $\ge 8$)** |
| | | **Usuarios y validación** | 7% | **Sí (Requiere $\ge 8$)** |
| **4. Plan de acción** | **13%** | **Claridad de actividades y responsables** | 4% | **Sí (Requiere $\ge 8$)** |
| | | **Giras y actividades académicas** | 4% | **Sí (Requiere $\ge 8$)** |
| | | **Trazabilidad y plazos** | 5% | **Sí (Requiere $\ge 8$)** |
| **5. Presupuesto** | **10%** | **Coherencia y topes** | 4% | **Sí (Requiere $\ge 8$)** |
| | | **Equipamiento en primer año** | 4% | **Sí (Requiere $\ge 8$)** |
| | | Otros fondos | 2% | No |
| **6. Riesgos** | **8%** | **Identificación por actividad** | 4% | **Sí (Requiere $\ge 8$)** |
| | | **Viabilidad de mitigación** | 4% | **Sí (Requiere $\ge 8$)** |
| **7. Ética y PI** | **10%** | **Declaración ética** | 4% | **Sí (Requiere $\ge 8$)** |
| | | **Gestión de propiedad intelectual** | 6% | **Sí (Requiere $\ge 8$)** |
| **8. Pertinencia e impacto** | **17%** | Contribución e impacto | 10% | No |
| | | Innovación | 7% | No |
| **TOTAL** | **100%** | **19 Criterios** | **100%** | **12 Obligatorios** |

* **Fórmula de Puntaje Preliminar:**
  $$\text{Puntaje Preliminar} = \sum_{i=1}^{19} \frac{\text{Peso}_i \times \text{Calificación\_IA}_i}{10}$$
* **Interacción en Pantalla 24:** El evaluador del Comité Técnico cuenta con el botón **«Aplicar puntajes IA como base»**, que pre-carga las 19 calificaciones sugeridas por Gemini en los selectores de la rúbrica, permitiéndole ajustarlas libremente antes de emitir su dictamen definitivo.

---

### Nivel 3: Consejo de Escuela (Pantalla 25 — `referencia_consejo_escuela`)
* **¿Cuándo interviene?:** Una vez recomendada por el Comité Técnico, para emitir los acuerdos de aval de la instancia coordinadora (`Formato 7`) y de las instancias participantes (`Formato 8`).
* **Parámetros que analiza Gemini para este nivel:**
  1. `viabilidad_horaria`: Verificación de la carga de horas semanales solicitadas por cada docente de la Escuela (`VIE`, `CONS`, `REC`, `DOC`).
  2. `pertinencia_escuela`: Alineación del tema y objetivos con las áreas académicas de la Escuela.
  3. `verificacion_presupuestaria`: Confirmación del monto plurianual que el Consejo debe ratificar en acta.
  4. `recomendacion_aval`: Síntesis lista para respaldar el artículo de sesión del Consejo de Escuela.

---

### Nivel 4: Dirección de Investigación / VIE (Pantalla 26 — `referencia_direccion_vie`)
* **¿Cuándo interviene?:** Después de que la persona investigadora realiza el **sometimiento formal** de la propuesta avalada (28 de septiembre).
* **Parámetros que analiza Gemini (Checklist Oficial de 5 Puntos de Admisibilidad VIE):**
  1. Personal investigador al día con informes y compromisos institucionales (sin morosidad).
  2. Coherencia de riesgos identificados por actividad y viabilidad de sus medidas de mitigación.
  3. Inclusión obligatoria de beca para estudiante asistente especial ($\ge 10\text{ h/semana}$).
  4. Declaraciones éticas individuales completas y justificadas en los 4 ejes (seres humanos, biodiversidad/recursos genéticos, animales y territorios indígenas).
  5. Presencia del dictamen del Centro de Vinculación cuando aplica por modalidad o PI.

---

### Nivel 5: Consejo de Investigación y Extensión — CIE (Pantalla 27 — `referencia_cie`)
* **¿Cuándo interviene?:** Etapa colegiada superior que emite la resolución final sobre el financiamiento de la propuesta.
* **Parámetros que analiza Gemini para este nivel:**
  1. `resolucion_sugerida`: *Aprobada*, *Con observaciones* o *Rechazada*.
  2. `borrador_acuerdo`: Redacción ejecutiva motivada que resume el código del expediente, título, monto total financiado, puntaje técnico obtenido y cumplimiento del proceso previo, lista para servir de insumo en el acta del CIE.
  3. `impacto_estrategico`: Valoración de la contribución institucional y pertinencia nacional.
