# SGPI · VIE — Guía de entrega

## Estado real

**Sistema Full-Stack completamente integrado y verificado:**
1. **Frontend:** Prototipo interactivo de 33 pantallas base, seis roles institucionales y estados complementarios. Servido mediante Nginx en contenedor Docker (`http://localhost:8080`) o de forma autónoma abriendo `SGPI.html`.
2. **Backend API:** Construido en FastAPI 0.143.2 y Python 3.12 (`http://localhost:3001`), con documentación Swagger interactiva en `/docs` y endpoints para autenticación, catálogos unificados, convocatorias, instrumentos descargables, notificaciones, expediente digital y creación atómica de propuestas.
3. **Base de Datos en Supabase:** Instancia en la nube de PostgreSQL 14.17 en AWS `us-west-2` con 36 tablas relacionales, triggers automáticos para generación de códigos institucionales `SI-YYYY-NNN`, auditoría de estados y notificaciones automáticas.
4. **Verificación Automatizada:** Suite de pruebas en [`test_endpoints.ps1`](../../test_endpoints.ps1) con 11 verificaciones funcionales pasando al 100% (código 200 OK).

**Figma:** El archivo [SGPI · VIE — Prototipo interactivo](https://www.figma.com/design/0WnVqYKmyM2osg7AsEAcUZ) contiene la guía visual, 27 variables, ocho estilos Roboto y componentes de botón/campo. La carpeta `figma-import` incluye el plugin local empaquetado para importar las capas editables y conexiones nativas al editor de Figma.

## Formato exigido

La consigna del curso exige **Enlace de Edición / Diseño en Figma**, **Enlace de Presentación / Modo Interactivo (Prototype Preview)** y demostración funcional del flujo completo de software.

## Revisión de interfaz para VIE

Se quitaron la marca TEC, los nombres institucionales extensos y repetidos, los pies académicos, las migas redundantes y los avisos de escenario en cada pantalla. Se simplificaron el acceso y el inicio. Las notas auxiliares subieron a 12 px y los encabezados de tabla dejaron de usar mayúsculas diminutas. Las opciones de demostración se agruparon en Mi perfil.

## Qué contiene

- **Tres módulos principales:** formulación, evaluación multi-instancia y consulta histórica. Administración de convocatorias/rúbricas/catálogos como soporte de Dirección/VIE.
- **Seis roles institucionales:** investigador, Vinculación, Comité Técnico, Consejo de Escuela, Dirección de Investigación y CIE.
- **Formularios dinámicos:** sincronizados con la base de datos de Supabase y persistencia en backend.
- **Presupuesto calculado por año:** rubro de equipo y bienes duraderos restringido al Año 1, rúbrica ponderada 0/6/8/10, bloqueo por obligatorios y productos, filtros de histórico y expediente de consulta.
- **Alternativas y validaciones:** campos vacíos, anexo faltante, presupuesto excedido, evaluación no recomendada, devolución, resolución negativa y búsqueda sin resultados.
- `CATALOGO.md`: listado de las 33 pantallas base vinculadas a endpoints API.
- `REQUISITOS_Y_TRAZABILIDAD.md`: reglas contrastadas con originales y localizadores de las fuentes.
- `VALIDACION.md`: alcance de comprobación y resultados reproducibles con el script `test_endpoints.ps1`.

## Recorridos para presentar

### 1. Formular y enviar a evaluación
1. Abre `http://localhost:8080` (o `SGPI.html`) e ingresa con los datos de demostración precargados (`laura.mendez@example.com` / `demostracion`).
2. Convocatorias → Fondos VIE 2027 → Crear propuesta → Desarrollo tecnológico.
3. Recorre datos generales, equipo (con tipos de hora oficiales `VIE`, `CONS`, `REC`, etc.), fundamentación, objetivos, metodología, plan de acción, riesgos vinculados, presupuesto anualizado, información complementaria y documentos oficiales.
4. En presupuesto, edita un monto para superar ₡5 millones en un año: se recalcula el total y se impide continuar. Restablece el valor.
5. En documentos, revisa los anexos e instrumentos descargables traídos dinámicamente desde el Backend.
6. Confirma la revisión y envía: `POST /propuestas` persiste el expediente atómicamente en Supabase y genera el código institucional `SI-YYYY-NNN`.

### 2. Evaluar y obtener aval
1. Usa el selector de rol del encabezado y entra a Vinculación.
2. Bandeja → expediente → Iniciar revisión → Emitir dictamen → Registrar decisión → Ver próximo actor.
3. En Comité Técnico, inspecciona las secciones de la rúbrica. Cambia «Participación estudiantil» a Regular (6): la evaluación deja de recomendar aunque el total supere 70. Restablece Bueno (8).
4. Registra la evaluación numérica ($0\text{–}100$) y pasa al Consejo de Escuela. Registra el aval.
5. El sistema avanza automáticamente el estado y notifica al investigador.

### 3. Someter, resolver y aceptar
1. Como investigador, en Seguimiento/Avalada pulsa «Someter propuesta».
2. El estado cambia a Sometida y se registra en `proposal_state_history`.
3. Entra a Dirección de Investigación para verificar el expediente con el checklist normativo y emitir dictamen. Después entra a CIE.
4. Registra una resolución Aprobada y vuelve al investigador: aparece la resolución formal y carta de aceptación.

### 4. Consultar antecedentes
1. Desde el menú lateral o Mi perfil, accede al módulo de Consulta Histórica.
2. Filtra por escuelas (COMP, BIOL, ADE, etc.), modalidades o estados.
3. Busca «Monitoreo» o un código como «SI-2027» y abre el expediente cerrado.
4. Revisa resumen, documentos, evaluaciones, resolución e historial auditable.

## Consistencia documental

El caso principal es **SI-2027-014 · Agua Inteligente: monitoreo de cuencas**, desarrollo tecnológico, enero de 2027 a diciembre de 2028, ₡9.400.000 (₡4.800.000 + ₡4.600.000), 16 horas semanales de investigación. Incluye beca asistente de 10 h/semana, 400 horas anuales a ₡2.400 (40 semanas planificadas, hasta 10 meses), y equipo solo en 2027.

## Rúbrica académica

| Criterio | Peso | Evidencia / situación |
|---|---:|---|
| Secuencia lógica | 10% | Formulación → Vinculación condicional → Comité → aval → sometimiento del investigador → Dirección → CIE → aceptación |
| Ortografía | 10% | Etiquetas y mensajes revisados en español |
| Tecnología | 5% | Stack completo: FastAPI + psycopg 3 + Supabase PostgreSQL 14 + Docker Compose + Frontend ES6 |
| Colores | 10% | Blanco, azul #002855 y rojo #EF3340; superficies mediante opacidad institucional |
| Botones | 10% | Acción principal, secundaria, textual; foco visible; controles reutilizados |
| Espacio | 10% | Navegación lateral, jerarquía de títulos, formularios por pasos y paneles de contexto |
| Idioma | 5% | Interfaz en español; campos técnicos con traducción y contexto |
| Módulos | 10% | Formulación, evaluación, histórico y administración de soporte |
| Casos de uso | 10% | Recorridos por seis roles y alternativas de error/decisión |
| Interacción y navegación | 10% | Verificadas en Frontend web y respaldadas en API REST |
| Información coherente | 10% | Caso oficial único, reglas/plazos contrastados con Disposiciones VIE 2027 y expediente trazable |
