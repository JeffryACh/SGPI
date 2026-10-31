# Checklist de backend — SGPI

**Fecha de inventario:** 2026-10-29  
**Alcance:** backend FastAPI, base de datos PostgreSQL/Supabase y conexión con las 33 pantallas del frontend.  
**Objetivo:** marcar el avance real del backend por rol, pantalla, flujo y brecha transversal.

## Cómo usar este checklist

- `[x]` = implementado, conectado y verificado mínimamente.
- `[ ]` = pendiente.
- `[ ] **Parcial**` = existe una parte, pero falta completar backend o conectar frontend.
- No marcar una pantalla como terminada solo porque la interfaz se vea bien: debe existir endpoint, persistencia, autorización por rol y prueba.
- Las rutas indicadas son las reales registradas por FastAPI.

## 1. Resumen ejecutivo

- [x] Login de usuarios contra `usuarios` y `user_roles`.
- [x] Catálogos institucionales consolidados.
- [x] Consulta de convocatorias, etapas y documentos.
- [x] Carga de documentos de convocatoria a Supabase Storage.
- [x] Dashboard y listados básicos de propuestas.
- [x] Creación atómica de propuesta completa desde el formulario.
- [x] Consulta de expediente completo.
- [x] Cambio genérico de estado con historial y notificación.
- [x] Registro genérico de evaluaciones para Comité Técnico y CIE.
- [x] Evaluación preliminar con Gemini o motor normativo de respaldo.
- [ ] Autorización real por rol en el backend.
- [ ] Flujos específicos de Vinculación, Comité, Consejo, Dirección y CIE.
- [ ] Administración de convocatorias, catálogos y rúbricas.
- [ ] Guardado de borrador en servidor.
- [x] Carga real de documentos de propuesta.
- [ ] Pruebas automatizadas por rol y flujo.

## 2. Brechas transversales

### 2.1 Autenticación y autorización

- [x] `POST /auth/login` valida correo, hash y usuario activo.
- [x] El login devuelve roles del usuario.
- [ ] **Parcial:** el backend no emite token/JWT; la sesión vive solo en el frontend.
- [ ] **Parcial:** los endpoints no exigen autenticación.
- [ ] **Parcial:** los endpoints no validan que el rol del usuario permita la acción.
- [ ] **Parcial:** `guardRoute()` protege pantallas solo en el navegador; puede saltarse llamando la API directamente.
- [ ] Agregar dependencia de autenticación reutilizable para routers.
- [ ] Agregar autorización por rol/instancia responsable.
- [ ] Agregar `GET /auth/me` o validación equivalente de sesión.
- [ ] Definir expiración/renovación de sesión.
- [ ] Registrar cierre de sesión o invalidación de token.
- [ ] **Deuda de seguridad:** migrar de SHA-256 simple a un hash con sal y costo (Argon2/bcrypt/scrypt).

### 2.2 Validación y reglas de negocio

- [x] Pydantic valida tipos, longitudes y rangos principales.
- [x] Se valida que los correos del equipo existan y estén activos.
- [x] Se valida que los rubros presupuestarios existan.
- [x] Se bloquean bienes duraderos fuera del Año 1.
- [x] Se exige un mínimo de productos académicos según horas del equipo.
- [x] `client_uuid` evita duplicados por reenvío.
- [ ] **Parcial:** la mayoría de reglas VIE del presupuesto se validan solo en el frontend.
- [ ] Validar en servidor el tope anual de ₡5.000.000.
- [ ] Validar en servidor duración máxima según modalidad.
- [ ] Validar en servidor beca mínima y máximo de horas/meses.
- [ ] Validar en servidor coherencia de fechas del plan y del proyecto.
- [ ] Validar obligatorios de secciones, documentos y declaraciones éticas antes del envío.
- [ ] Validar que el líder pueda crear propuestas y que el equipo no tenga conflictos.
- [ ] Definir y validar una máquina de estados permitida por rol.
- [ ] Evitar transiciones arbitrarias mediante `PATCH /propuestas/{id}/estado`.

### 2.3 Notificaciones

- [x] `GET /notificaciones/notificaciones?id_usuario=...`.
- [x] Trigger de base de datos notifica cambios de estado al líder.
- [x] Notificación inicial al registrar propuesta.
- [x] Backend para marcar una notificación como leída: `PATCH /notificaciones/{id}/leer`.
- [x] Backend para marcar todas como leídas: `PATCH /notificaciones/leer-todas`.
- [x] **Parcial / bug:** el frontend llama `POST /notificaciones/marcar-leida`.
- [x] **Parcial / bug:** el frontend llama `POST /notificaciones/marcar-todas-leidas`.
- [ ] Alinear rutas o agregar aliases compatibles.
- [ ] Verificar que el contador de no leídas se actualice tras marcar.
- [ ] Definir destinatarios por rol/instancia, no solo al líder.

### 2.4 Documentos y archivos

- [x] Documentos de convocatoria se suben a Supabase Storage.
- [x] Los documentos de propuesta se registran en `proposal_documents` solo cuando tienen archivo real; la creación ya no inserta metadatos falsos.
- [x] Consulta de documentos de convocatoria por convocatoria.
- [x] Los documentos de propuesta se guardan como archivo real en Supabase Storage y metadatos en `proposal_documents`.
- [x] Endpoint de carga real de documentos de propuesta.
- [ ] Endpoint de descarga/URL firmada.
- [ ] Endpoint de eliminación o reemplazo con versionado.
- [ ] Validar tipo MIME, extensión y tamaño.
- [ ] Asociar carga a usuario y rol que la realiza.
- [ ] Definir qué documentos son obligatorios por modalidad y etapa.

### 2.5 Testing y operación

- [x] `GET /health` verifica conectividad con base de datos.
- [x] Existen pruebas manuales de creación de propuesta.
- [ ] **Parcial:** no hay suite automatizada de backend.
- [ ] Pruebas de login por cada rol.
- [ ] Pruebas de creación de propuesta.
- [ ] Pruebas de expediente y documentos.
- [ ] Pruebas de cada transición de estado.
- [ ] Pruebas de cada dictamen por rol.
- [ ] Pruebas de notificaciones y lectura.
- [ ] Pruebas de autorización: un rol no puede ejecutar acciones de otro.
- [ ] Pruebas de idempotencia y concurrencia.
- [x] Documentar variables de entorno necesarias (`.env.example`, `docker-compose.yml`, `render.yaml`, `AGENTS.md`).
- [ ] Revisar CORS permisivo (`allow_origins=["*"]`) antes de producción.

## 3. Endpoints existentes

| Estado | Método | Ruta | Uso actual |
|---|---|---|---|
| OK | POST | `/auth/login` | Conectado a pantalla 01 |
| OK | GET | `/health` | Monitoreo |
| OK | GET | `/catalogos` | Catálogos consolidados |
| OK | GET | `/escuelas/totalescuelas` | Selector de escuela |
| OK | GET | `/modalidades/totalmodalidades` | Selector de modalidad |
| OK | GET | `/lineas_de_investigacion/totalLineas` | Selector de línea |
| OK | GET | `/tipos_hora/totalTiposHora` | Catálogo, también incluido en `/catalogos` |
| OK | GET | `/convocatorias/totalConvocatorias` | Convocatorias |
| OK | GET | `/convocatorias/etapas_convocatorias` | Etapas |
| OK | GET | `/convocatorias/documentos_convocatoria` | Documentos oficiales |
| OK | POST | `/convocatorias/documentos_convocatoria` | Subida de documento oficial |
| OK | GET | `/notificaciones/notificaciones` | Listado de notificaciones |
| OK | PATCH | `/notificaciones/{id_notificacion}/leer` | Marcar una como leída |
| OK | PATCH | `/notificaciones/leer-todas` | Marcar todas como leídas |
| OK | GET | `/propuestas/dashboardpropuestas` | Métricas del dashboard |
| OK | GET | `/propuestas/propuestaMasReciente` | Última propuesta |
| OK | GET | `/propuestas/top3PropuestaMasReciente` | Top 3 recientes |
| OK | GET | `/propuestas` | Búsqueda/listado con filtros |
| OK | GET | `/propuestas/{id_propuesta}` | Expediente completo |
| OK | POST | `/propuestas` | Creación atómica |
| OK | PATCH | `/propuestas/{id_propuesta}/estado` | Cambio genérico de estado |
| OK | POST | `/propuestas/{id_propuesta}/evaluaciones` | Evaluación genérica |
| OK | GET | `/ia/estado` | Estado del servicio IA |
| OK | GET | `/ia/criterios` | Criterios normativos |
| OK | GET | `/ia/evaluacion-preliminar/{id_propuesta}` | Evaluación IA guardada/generada |
| OK | POST | `/ia/evaluar-propuesta/{id_propuesta}` | Regenerar evaluación IA |
| OK | POST | `/ia/evaluar-borrador` | Evaluar borrador en vivo |

## 4. Checklist por rol y pantalla

### 4.1 Investigador

Pantallas principales: `02`, `03`, `04`–`20`, `22`, `28`, `33`.

- [x] **01 · Acceso:** login contra backend.
- [x] **02 · Inicio:** métricas, propuesta reciente y top 3 desde backend.
- [x] **03 · Notificaciones:** rutas de marcado de lectura corregidas a `PATCH /notificaciones/{id}/leer` y `PATCH /notificaciones/leer-todas`.
- [x] **04 · Convocatorias:** listado desde backend.
- [ ] **04 · Convocatorias:** filtros/paginación reales; hoy el filtro es local.
- [x] **05 · Fondos VIE 2027:** etapas y documentos desde backend.
- [x] **06 · Mis propuestas:** consume `GET /propuestas?id_usuario=...` en lugar de reutilizar el top 3.
- [ ] **06 · Mis propuestas:** filtros y paginación del lado servidor.
- [x] **07 · Nueva propuesta:** modalidades, escuelas y líneas desde backend.
- [x] **08–16 · Formulario:** los datos se persisten al crear la propuesta.
- [ ] **08–18 · Borrador:** no existe guardado de borrador en servidor; solo `localStorage`.
- [ ] **08–18 · Borrador:** definir endpoint de actualización o descartar formalmente el guardado remoto.
- [x] **09 · Equipo:** integrantes por correo institucional y horas.
- [x] **09 · Equipo:** colaborador externo se persiste al crear.
- [ ] **09 · Equipo:** endpoint para buscar usuarios institucionales y agregarlos sin escribir correo.
- [x] **10 · Descripción:** secciones narrativas persistidas.
- [x] **11 · Objetivos:** objetivos y productos académicos persistidos.
- [x] **12 · Metodología:** secciones persistidas.
- [x] **13 · Plan de acción:** actividades, responsables y meses persistidos.
- [x] **14 · Riesgos:** riesgos, probabilidad, impacto y mitigación persistidos.
- [x] **15 · Presupuesto:** rubros y montos por año persistidos.
- [ ] **15 · Presupuesto:** validaciones completas del lado servidor.
- [x] **16 · Información complementaria:** TRL, potencial PI y secciones persistidas.
- [x] **17 · Documentos:** el borrador permite adjuntar archivos reales (opcionales) y, al confirmar el envío, el frontend crea la propuesta y los sube con `POST /propuestas/{id}/documentos`. Se eliminaron los documentos quemados.
- [x] **18 · Revisión:** envío crea la propuesta completa.
- [x] **19 · Confirmación:** muestra el código devuelto por backend.
- [x] **20 · Seguimiento:** recarga el expediente real por ID y usa el estado de PostgreSQL.
- [x] **20 · Seguimiento:** consume `GET /propuestas/{id}` mediante `cargarDossier()` al entrar.
- [x] **22 · Expediente:** la pantalla consume el dossier real del backend (`dossierActual`).
- [x] **22 · Expediente:** pestañas Documentos, Evaluaciones, Resolución e Historial conectadas al dossier real.
- [x] **28 · Historial:** conectado al arreglo `historial` y a `vinculacion_evaluaciones` del dossier.
- [ ] **33 · Perfil:** no hay endpoint para actualizar datos del usuario.
- [ ] **33 · Perfil:** no hay endpoint para consultar roles/permisos actualizados.

### 4.2 Vinculación

Pantallas principales: `21`, `22`, `23`, `28`, `29`, `30`.

- [x] **21 · Bandeja:** filtrar propuestas asignadas a Vinculación.
- [x] **21 · Bandeja:** usar `GET /propuestas?estado_nombre=...` o endpoint de bandeja por rol.
- [x] **22 · Expediente:** cargar dossier real por ID.
- [x] **23 · Revisión de Vinculación:** persistencia específica implementada.
- [x] **23 · Revisión de Vinculación:** guardar número de oficio de dictamen.
- [x] **23 · Revisión de Vinculación:** guardar potencial PI, tipo de innovación y activo previsto.
- [x] **23 · Revisión de Vinculación:** guardar valoración técnica y reserva.
- [x] **23 · Revisión de Vinculación:** persistir en `vinculacion_evaluations`.
- [x] **23 · Revisión de Vinculación:** asociar dictamen a evaluación base en `evaluations`.
- [x] **23 · Revisión de Vinculación:** adjuntar oficio/documento firmado.
- [x] **23 · Revisión de Vinculación:** transición controlada de estado `2` a `3` o `10`.
- [x] **23 · Revisión de Vinculación:** notificar al investigador y al Comité.
- [x] **28 · Historial:** mostrar decisión de Vinculación con actor, fecha y documento.
- [x] **29–30 · Consulta histórica:** usar `GET /propuestas` con filtros reales.
- [x] **29–30 · Consulta histórica:** usar `GET /propuestas/{id}` al abrir un resultado.

### 4.3 Comité Técnico

Pantallas principales: `21`, `22`, `24`, `28`.

- [ ] **21 · Bandeja:** filtrar propuestas en evaluación del Comité.
- [ ] **21 · Bandeja:** asignación explícita de evaluadores.
- [ ] **22 · Expediente:** cargar dossier real.
- [ ] **24 · Evaluación:** endpoint para consultar rúbrica por modalidad.
- [ ] **24 · Evaluación:** endpoint para guardar puntaje por criterio en `technical_committee_scores`.
- [ ] **24 · Evaluación:** guardar puntaje total en `technical_committee_evaluations`.
- [ ] **24 · Evaluación:** guardar observaciones en `evaluations`.
- [ ] **24 · Evaluación:** calcular suma ponderada en servidor.
- [ ] **24 · Evaluación:** validar umbral de 70 y criterios obligatorios en servidor.
- [ ] **24 · Evaluación:** validar productos académicos comprometidos.
- [ ] **24 · Evaluación:** registrar evaluación individual por evaluador.
- [ ] **24 · Evaluación:** consolidar resultado del comité cuando corresponda.
- [ ] **24 · Evaluación:** transición controlada de estado `3` a `4` o `10`.
- [ ] **24 · Evaluación:** adjuntar acta/informe del Comité.
- [ ] **28 · Historial:** mostrar puntajes, criterios y observaciones.

### 4.4 Consejo de Escuela

Pantallas principales: `21`, `22`, `25`, `28`.

- [ ] **21 · Bandeja:** filtrar propuestas pendientes de aval.
- [ ] **25 · Aval:** persistir en `council_endorsements`.
- [ ] **25 · Aval:** guardar instancia/escuela que avala.
- [ ] **25 · Aval:** guardar tipo de instancia, sesión, artículo y fecha.
- [ ] **25 · Aval:** guardar número de oficio.
- [ ] **25 · Aval:** guardar ratificación de calificación.
- [ ] **25 · Aval:** guardar aval de presupuesto y horas de personal.
- [ ] **25 · Aval:** guardar observaciones.
- [ ] **25 · Aval:** soportar avales de varias escuelas para una misma propuesta.
- [ ] **25 · Aval:** validar que cada escuela avale a su propio personal.
- [ ] **25 · Aval:** adjuntar acuerdo firmado.
- [ ] **25 · Aval:** transición controlada a `5 · Avalada`.
- [ ] **25 · Aval:** notificar al investigador para el sometimiento formal.
- [ ] **28 · Historial:** mostrar avales y acuerdos.

### 4.5 Dirección de Investigación

Pantallas principales: `21`, `22`, `26`, `28`, `29`, `30`, `31`, `32`.

- [ ] **21 · Bandeja:** filtrar propuestas sometidas ante VIE.
- [ ] **22 · Expediente:** cargar dossier real.
- [ ] **26 · Dictamen:** persistir verificaciones en `vie_dictamen_verifications`.
- [ ] **26 · Dictamen:** guardar cada criterio y su cumplimiento.
- [ ] **26 · Dictamen:** guardar resultado favorable, con observaciones o desfavorable.
- [ ] **26 · Dictamen:** guardar fundamentación y fecha.
- [ ] **26 · Dictamen:** adjuntar dictamen firmado.
- [ ] **26 · Dictamen:** transición controlada de `6` a `7` o `10`.
- [ ] **26 · Dictamen:** notificar al CIE y al investigador.
- [ ] **28 · Historial:** mostrar verificaciones y dictamen.
- [ ] **29–30 · Consulta histórica:** filtros y detalle reales.
- [ ] **31 · Administración de convocatorias:** no hay CRUD de convocatorias.
- [ ] **31 · Administración de convocatorias:** no hay CRUD de etapas.
- [ ] **31 · Administración de convocatorias:** no hay edición de reglas por modalidad.
- [ ] **31 · Administración de convocatorias:** falta activar/cerrar convocatoria.
- [ ] **31 · Administración de convocatorias:** falta editar/eliminar documentos oficiales.
- [ ] **32 · Rúbricas y catálogos:** no hay CRUD de líneas, modalidades, escuelas ni rubros.
- [ ] **32 · Rúbricas y catálogos:** no hay CRUD de secciones/criterios de rúbrica.
- [ ] **32 · Rúbricas y catálogos:** no hay endpoint para pesos y órdenes de roles.
- [ ] **32 · Rúbricas y catálogos:** no hay endpoint para versionar rúbricas.

### 4.6 CIE

Pantallas principales: `21`, `22`, `27`, `28`, `29`, `30`.

- [ ] **21 · Bandeja:** filtrar propuestas con dictamen de Dirección.
- [ ] **22 · Expediente:** cargar dossier real.
- [ ] **27 · Resolución:** persistir resolución aprobada/rechazada/observada.
- [ ] **27 · Resolución:** guardar sesión, artículo y fecha.
- [ ] **27 · Resolución:** guardar fundamentación y condiciones.
- [ ] **27 · Resolución:** adjuntar acuerdo firmado.
- [ ] **27 · Resolución:** transición controlada de `7` a `8`, `10` o `11`.
- [ ] **27 · Resolución:** notificar al investigador.
- [ ] **27 · Resolución:** registrar condiciones de aceptación posteriores.
- [ ] **28 · Historial:** mostrar resolución y condiciones.
- [ ] **29–30 · Consulta histórica:** filtros y detalle reales.

### 4.7 Administración y cuenta

- [ ] **31 · Convocatorias:** CRUD completo.
- [ ] **31 · Convocatorias:** asociar documentos y cronograma.
- [ ] **32 · Catálogos:** CRUD y activación/inactivación.
- [ ] **32 · Rúbricas:** CRUD de secciones, criterios, pesos y versiones.
- [ ] **32 · Roles:** consulta y orden de roles.
- [ ] **33 · Perfil:** consulta de datos propios.
- [ ] **33 · Perfil:** actualización de datos permitidos.
- [ ] **33 · Perfil:** cambio de contraseña.
- [ ] **33 · Perfil:** visualización de roles/permisos reales.
- [ ] **Transversal:** endpoint de usuarios para equipos y administración.
- [ ] **Transversal:** bitácora de accesos y acciones administrativas.

## 5. Tablas que ya existen pero no tienen uso completo

| Tabla | Estado de uso | Falta |
|---|---|---|
| `convocatorias` | Lectura | CRUD administrativo |
| `convocatoria_etapas` | Lectura | CRUD administrativo |
| `convocatoria_documentos` | Lectura y subida | Edición, reemplazo, borrado |
| `vinculacion_evaluations` | Sin uso | Endpoint/persistencia de pantalla 23 |
| `council_endorsements` | Sin uso | Endpoint/persistencia de pantalla 25 |
| `rubric_sections` | Sin uso | Endpoint de rúbrica |
| `rubric_criteria` | Sin uso | Endpoint de criterios |
| `technical_committee_scores` | Sin uso | Puntaje por criterio del Comité |
| `vie_dictamen_verifications` | Sin uso | Verificación de criterios de Dirección |
| `technical_committee_evaluations` | Uso parcial | Solo puntaje total desde endpoint genérico |
| `cie_resolution_evaluations` | Uso parcial | Solo `id_resolucion`; faltan datos del acuerdo |
| `ai_preliminary_evaluations` | Uso completo | Mantener y versionar si cambia el modelo |
| `proposal_documents` | Uso completo | Archivo real en Storage + metadatos; sin filas falsas de borrador |
| `notificaciones` | Uso completo | Rutas `PATCH` alineadas (una y todas) |

## 6. Backlog propuesto de endpoints

> Estos endpoints son una propuesta de cierre. Ajustar nombres si se decide otra convención.

### 6.1 Autenticación y usuarios

- [ ] `GET /auth/me`
- [ ] `POST /auth/logout`
- [ ] `GET /usuarios?q=...` para búsqueda de equipo.
- [ ] `GET /usuarios/{id}`.
- [ ] `PATCH /usuarios/{id}` para perfil.
- [ ] `PATCH /usuarios/{id}/password`.
- [ ] `GET /roles`.

### 6.2 Propuestas y borradores

- [ ] `PATCH /propuestas/{id}` para borrador/edición controlada, si se decide soportar.
- [ ] `GET /propuestas/{id}/historial`, si no se quiere usar el historial del dossier.
- [ ] `GET /propuestas/{id}/evaluaciones`.
- [ ] `GET /propuestas/bandeja?rol=...`.
- [ ] `GET /propuestas?solo_cerradas=true` o filtro equivalente.
- [ ] Paginación estándar (`page`, `page_size`, `total`).

### 6.3 Documentos

- [x] `POST /propuestas/{id}/documentos` con archivo real.
- [x] `GET /propuestas/{id}/documentos`.
- [ ] `DELETE /propuestas/{id}/documentos/{id_documento}`.
- [ ] `GET /propuestas/{id}/documentos/{id_documento}/url`.
- [ ] `PATCH /convocatorias/documentos_convocatoria/{id}`.
- [ ] `DELETE /convocatorias/documentos_convocatoria/{id}`.

### 6.4 Evaluaciones por instancia

- [x] `POST /propuestas/{id}/vinculacion`.
- [x] `GET /propuestas/{id}/vinculacion`.
- [ ] `POST /propuestas/{id}/comite`.
- [ ] `GET /propuestas/{id}/comite`.
- [ ] `POST /propuestas/{id}/consejo`.
- [ ] `GET /propuestas/{id}/consejo`.
- [ ] `POST /propuestas/{id}/direccion`.
- [ ] `GET /propuestas/{id}/direccion`.
- [ ] `POST /propuestas/{id}/cie`.
- [ ] `GET /propuestas/{id}/cie`.

### 6.5 Administración

- [ ] `POST /convocatorias`.
- [ ] `PATCH /convocatorias/{id}`.
- [ ] `POST /convocatorias/{id}/etapas`.
- [ ] `PATCH /convocatorias/{id}/etapas/{id_etapa}`.
- [ ] `GET /rubricas?modalidad=...`.
- [ ] `POST /rubricas`.
- [ ] `PATCH /rubricas/{id}`.
- [ ] CRUD de catálogos maestros.

## 7. Pruebas mínimas para marcar “backend completo”

- [ ] Login exitoso y fallido por cada rol.
- [ ] Un usuario inactivo no puede entrar.
- [ ] Sin token/sesión no se puede llamar a endpoints protegidos.
- [ ] Un investigador solo ve y modifica sus propias propuestas.
- [ ] Vinculación no puede actuar como Comité, Consejo, Dirección ni CIE.
- [ ] Comité no puede emitir resolución CIE.
- [ ] Consejo solo avala propuestas de su escuela.
- [ ] Dirección no puede resolver CIE.
- [ ] CIE no puede modificar un dictamen de Dirección.
- [ ] Crear propuesta completa y consultarla por ID.
- [ ] Reenviar el mismo `client_uuid` no duplica.
- [ ] Consultar expediente con todas sus tablas hijas.
- [ ] Cada transición de estado deja historial y notificación.
- [ ] Un estado no permitido devuelve error.
- [ ] Cada dictamen queda asociado a usuario, rol, fecha y documento.
- [ ] Las notificaciones se listan y se marcan como leídas.
- [ ] Los documentos se cargan, listan, descargan y eliminan.
- [ ] La IA responde con Gemini o con el motor de respaldo.
- [ ] El frontend sigue funcionando si la IA falla.

## 8. Orden sugerido de cierre

1. Autenticación con token y autorización por rol.
2. Corrección de notificaciones.
3. Conexión real de `GET /propuestas` y `GET /propuestas/{id}` en pantallas 06, 20, 21, 22, 28, 29 y 30.
4. Persistencia específica de Vinculación.
5. Rúbrica y evaluación del Comité.
6. Avales del Consejo.
7. Verificación y dictamen de Dirección.
8. Resolución del CIE.
9. Administración de convocatorias, catálogos y rúbricas.
10. Carga real de documentos y versionado.
11. Pruebas automatizadas y limpieza de datos demo.

## 9. Notas de alcance

- El frontend conserva un selector de roles y datos de demostración; no equivalen a autorización real.
- Los nombres demo restantes en expediente, historial y participación estudiantil están fuera del ajuste B ya realizado.
- La creación de propuestas ya está integrada y probada; las brechas principales están en consulta, evaluación por rol, administración y seguridad.
- Antes de marcar un elemento como terminado, verificar también que el frontend consuma el endpoint correcto.
