# Checklist de backend — SGPI

**Fecha de inventario:** 2026-10-29 (actualizado 2026-11-03 con la máquina de estados, el rechazo terminal y el cierre del proyecto)  
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
- [x] **Máquina de estados institucional por rol** (`backend/app/estados.py`): transiciones permitidas, estados terminales y validación del rol responsable.
- [x] **Rechazo terminal en todas las etapas evaluadoras** (Vinculación, Comité Técnico, Consejo de Escuela, Dirección de Investigación y CIE).
- [x] **Cierre administrativo del proyecto**: el ciclo institucional completo va de «En formulación» a «Cerrada» («Aprobada por CIE» → «En ejecución» → «Cerrada»).
- [x] **Trámites del expediente**: reenvío tras observaciones, aceptación de la carta, informe de seguimiento y cierre (`backend/app/routers/tramite.py`).
- [x] Registro genérico de evaluaciones para Comité Técnico y CIE.
- [x] Flujo específico del Comité Técnico: bandeja, rúbrica ponderada y dictamen con transición de estado.
- [x] Flujo específico del Consejo de Escuela: bandeja por escuela, aval institucional con persistencia y transición a «Avalada».
- [x] Evaluación preliminar: auditoría normativa local al crear/cambiar estado y Gemini solo en re-evaluación manual.
- [ ] **Parcial:** la autorización por rol existe en los routers de evaluación y en el router administrativo (`/admin`); el resto de endpoints sigue abierto.
- [x] Flujos específicos de Vinculación, Comité Técnico, Consejo, Dirección y CIE implementados con transición de estado persistida.
- [x] Administración de convocatorias, cronogramas, instrumentos oficiales, catálogos y rúbricas versionadas (pantallas 31 y 32).
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
- [ ] **Deuda de seguridad:** `POST /auth/usuarios` (alta de investigadores) es invocable sin credenciales porque la API todavía no tiene sesiones en el servidor. Mitigaciones activas: allowlist de dominios (`DOMINIOS_CORREO_PERMITIDOS`), ORCID válido y único obligatorio, correo único y contraseña generada por el servidor (el cliente nunca la define). En producción debe restringirse al rol administrativo.

### 2.2 Validación y reglas de negocio

- [x] Pydantic valida tipos, longitudes y rangos principales.
- [x] Se valida que los correos del equipo existan y estén activos.
- [x] Alta de investigadores en el directorio (`POST /auth/usuarios`): se validan formato y dominio del correo (allowlist `DOMINIOS_CORREO_PERMITIDOS`), ORCID bajo ISO 7064 MOD 11-2, unicidad del correo y del ORCID, existencia de la escuela y patrones de inyección SQL. El rol `Investigador` se asigna en la misma operación.
- [x] El ORCID de un investigador institucional se persiste en `usuarios.identificacion_orcid` (migración V18) y deja de depender de la memoria del proceso.
- [x] Se valida que los rubros presupuestarios existan.
- [x] Se bloquean bienes duraderos fuera del Año 1.
- [x] Se exige un mínimo de productos académicos según horas del equipo.
- [x] `client_uuid` evita duplicados por reenvío.
- [x] Los estados de las transiciones por rol se resuelven por nombre (`estados.nombre_estado`), porque el orden de los identificadores en la base desplegada difiere del seed V3.
- [x] La propuesta solo pasa a «Avalada» cuando **todas** las escuelas relacionadas con ella (escuela líder + escuelas del equipo investigador) registraron su aval en `council_endorsements`.
- [x] El CIE solo resuelve propuestas en «Dictaminada por Dirección» y transiciona a «Aprobada por CIE», «Con observaciones» o «Rechazada» según el tipo de acuerdo del catálogo `resoluciones_cie`.
- [x] Los estados del CIE también se resuelven por nombre (`estados.nombre_estado`), nunca por identificador fijo.
- [x] **Rechazo terminal en todas las etapas:** «Rechazada» es estado terminal en la máquina de estados; no admite ninguna transición saliente.
- [x] **Dictamen desfavorable de Dirección:** la resolución «No favorable» se traduce a «Rechazada», no a una devolución.
- [ ] **Parcial:** la mayoría de reglas VIE del presupuesto se validan solo en el frontend.
- [ ] Validar en servidor el tope anual de ₡5.000.000.
- [ ] Validar en servidor duración máxima según modalidad.
- [ ] Validar en servidor beca mínima y máximo de horas/meses.
- [ ] Validar en servidor coherencia de fechas del plan y del proyecto.
- [ ] Validar obligatorios de secciones, documentos y declaraciones éticas antes del envío.
- [ ] Validar que el líder pueda crear propuestas y que el equipo no tenga conflictos.
- [x] Máquina de estados permitida por rol definida y validada en servidor (`MAQUINA_ESTADOS` y `ROLES_POR_ETAPA` en `backend/app/estados.py`).
- [x] Transiciones arbitrarias evitadas mediante `PATCH /propuestas/{id}/estado`: la transición no permitida responde `409` y el rol sin facultad también.

### 2.3 Notificaciones

- [x] `GET /notificaciones/notificaciones?id_usuario=...`.
- [x] Trigger de base de datos notifica cambios de estado al líder.
- [x] Notificación inicial al registrar propuesta.
- [x] Backend para marcar una notificación como leída: `PATCH /notificaciones/{id}/leer`.
- [x] Backend para marcar todas como leídas: `PATCH /notificaciones/leer-todas`.
- [x] **Resuelto:** el frontend ya llama `PATCH /notificaciones/{id}/leer` (antes usaba `POST /notificaciones/marcar-leida`).
- [x] **Resuelto:** el frontend ya llama `PATCH /notificaciones/leer-todas` (antes usaba `POST /notificaciones/marcar-todas-leidas`).
- [x] Alinear rutas o agregar aliases compatibles.
- [x] Verificar que el contador de no leídas se actualice tras marcar.
- [x] El CIE notifica al líder cuando registra la resolución y cuando añade condiciones de aceptación posteriores.
- [x] Destinatarios por rol/instancia según la decisión: Vinculación avisa al Comité solo si el dictamen es favorable y al líder si hay devolución o rechazo; el Comité avisa al Consejo en el dictamen favorable y al líder en devoluciones o rechazos; Dirección avisa según su dictamen; el CIE avisa al líder y a los roles de la etapa a la que se reenvía.
- [x] **Notificación de devolución y de rechazo:** el investigador líder recibe el detalle de las observaciones y el estado resultante («Con observaciones» o «Rechazada»).

### 2.4 Documentos y archivos

- [x] Documentos de convocatoria se suben a Supabase Storage.
- [x] Estructura única de carpetas en el bucket `convocatorias`: `<convocatoria>/documentos/` para los instrumentos oficiales y `<convocatoria>/propuestas/<SI-YYYY-NNN>/` para cada propuesta. Las rutas se construyen en `backend/app/almacenamiento.py` (migración V19 + `backend/scripts/migrar_storage_estructura.py` para reorganizar los archivos físicos).
- [x] Los documentos de propuesta se registran en `proposal_documents` solo cuando tienen archivo real; la creación ya no inserta metadatos falsos.
- [x] Consulta de documentos de convocatoria por convocatoria.
- [x] Los documentos de propuesta se guardan como archivo real en Supabase Storage y metadatos en `proposal_documents`.
- [x] Endpoint de carga real de documentos de propuesta.
- [ ] Endpoint de descarga/URL firmada.
- [x] Endpoint de eliminación de instrumentos oficiales (`DELETE /admin/documentos/{id}` borra la fila y el archivo en Storage).
- [x] Validar tipo MIME, extensión y tamaño en la carga administrativa de instrumentos (`POST /admin/convocatorias/{id}/documentos`).
- [x] Asociar carga a usuario y rol que la realiza (el rol se valida en `_exigir_rol_admin`).
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
- [x] Pruebas manuales del Comité Técnico en `test_endpoints.ps1` (FASE 5): rúbrica, bandeja, 403 sin rol, bloqueo por obligatorio, dictamen favorable, duplicado y expediente.
- [x] Pruebas manuales del Consejo de Escuela en `test_endpoints.ps1` (FASE 6): bandeja por escuela, 403 sin rol, expediente de aval, aval favorable con transición a `Avalada`, aval duplicado, prohibición de avalar personal de otra escuela y **aval parcial con dos escuelas involucradas** (la propuesta sigue en «Pendiente de aval del Consejo» hasta que avalen todas).
- [x] Pruebas manuales de Dirección de Investigación en `test_endpoints.ps1` (FASE 7): bandeja, dashboard, detalle, 403 sin rol, dictamen con transición de «Sometida ante VIE» a «Dictaminada por Dirección» y duplicado rechazado con 409.
- [x] Pruebas manuales de administración institucional en `test_endpoints.ps1` (FASE 8): 403 para rol no administrativo, listado de convocatorias con los tres roles facultados, CRUD de convocatoria y etapas, CRUD de catálogos, bloqueo 409 de registros en uso, orden de roles y CRUD de rúbrica.
- [x] Pruebas manuales del Comité de Ética en Investigación en `test_endpoints.ps1` (FASE 10): login de los dos roles (`CIE` y `Evaluador Comité de Ética (CIE)`), 403 sin rol, bandeja y dashboard del CIE, expediente con el catálogo de acuerdos, resolución con transición de «Dictaminada por Dirección» a «Aprobada por CIE», duplicado y expediente cerrado rechazados con 409, condiciones de aceptación posteriores, condiciones sin acuerdo previo rechazadas con 409 y expediente con `resolucion_cie` persistida.
- [x] Pruebas manuales de la máquina de estados en `test_endpoints.ps1` (FASE 11): devolución con observaciones, rechazo terminal, reenvío a la etapa de origen, transición inválida rechazada con 409, aceptación («Aprobada por CIE» → «En ejecución»), informe de seguimiento y cierre administrativo («En ejecución» → «Cerrada»).
- [ ] Pruebas de notificaciones y lectura.
- [x] Pruebas de autorización: un rol no puede ejecutar acciones de otro (403 en `/admin`, Comité Técnico, Consejo de Escuela, Dirección y CIE).
- [ ] Pruebas de idempotencia y concurrencia.
- [x] Documentar variables de entorno necesarias (`.env.example`, `docker-compose.yml`, `render.yaml`, `AGENTS.md`).
- [ ] Revisar CORS permisivo (`allow_origins=["*"]`) antes de producción.

## 3. Endpoints existentes

| Estado | Método | Ruta | Uso actual |
|---|---|---|---|
| OK | POST | `/auth/login` | Conectado a pantalla 01 (retorna `orcid` del perfil del investigador) |
| OK | GET | `/auth/usuarios` | Búsqueda de investigadores institucionales activos con escape seguro `ILIKE` y retorno de ORCID de perfil |
| OK | PATCH | `/auth/usuarios/{id_usuario}/orcid` | Solicitud, validación ISO 7064 MOD 11-2, unicidad y asociación del ORCID al perfil del investigador |
| OK | POST | `/auth/usuarios` | Alta de una persona investigadora en el directorio institucional (`usuarios` + rol `Investigador`), con dominio de correo autorizado, ORCID válido y único, y entrega de la credencial inicial por SMTP o en la respuesta cuando no hay SMTP configurado |
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
| OK | PATCH | `/propuestas/{id_propuesta}/estado` | Cambio genérico de estado validado contra la máquina de estados y el rol (409 si la transición no está permitida) |
| OK | POST | `/propuestas/{id_propuesta}/evaluaciones` | Evaluación genérica |
| OK | GET | `/propuestas/comite/bandeja` | Bandeja filtrada del Comité Técnico |
| OK | GET | `/propuestas/comite/rubrica` | Rúbrica oficial ponderada de la versión activa |
| OK | GET | `/propuestas/comite/{id_propuesta}` | Dictamen y puntajes por criterio |
| OK | POST | `/propuestas/comite/{id_propuesta}` | Registrar dictamen y transición de estado |
| OK | GET | `/propuestas/consejo/bandeja` | Bandeja filtrada por escuela del Consejo de Escuela |
| OK | GET | `/propuestas/consejo/{id_propuesta}` | Escuelas involucradas, avales y acuerdos firmados |
| OK | POST | `/propuestas/consejo/{id_propuesta}` | Registrar aval, devolución o rechazo con transición de estado |
| OK | GET | `/propuestas/direccion/bandeja` | Bandeja de propuestas sometidas ante VIE (Dirección) |
| OK | GET | `/propuestas/direccion/dashboard` | Contadores reales de Dirección (`pendientes`, `determinadas`, `totales_revisadas`) |
| OK | GET | `/propuestas/direccion/{id_propuesta}` | Detalle del expediente para Dirección con verificaciones VIE |
| OK | POST | `/propuestas/direccion/{id_propuesta}` | Registrar dictamen de Dirección y transición de «Sometida ante VIE» a «Dictaminada por Dirección», «Con observaciones» o «Rechazada» |
| OK | GET | `/propuestas/cie/bandeja` | Bandeja del CIE (dictaminadas por Dirección y ya resueltas) |
| OK | GET | `/propuestas/cie/dashboard` | Contadores reales del CIE (`pendientes`, `resueltas`, `totales_revisadas`) |
| OK | GET | `/propuestas/cie/{id_propuesta}` | Expediente para resolver con dictamen de Dirección y catálogo de acuerdos |
| OK | POST | `/propuestas/cie/{id_propuesta}` | Registrar resolución colegiada y transición de «Dictaminada por Dirección» a «Aprobada por CIE», «Con observaciones» o «Rechazada» |
| OK | POST | `/propuestas/cie/{id_propuesta}/condiciones` | Registrar condiciones de aceptación posteriores al acuerdo |
| OK | POST | `/propuestas/{id_propuesta}/observaciones/reenvio` | Reenviar el expediente devuelto a la etapa institucional que lo devolvió |
| OK | POST | `/propuestas/{id_propuesta}/aceptacion` | Registrar la aceptación de la carta y pasar a «En ejecución» |
| OK | POST | `/propuestas/{id_propuesta}/informe` | Registrar el informe de seguimiento del proyecto |
| OK | POST | `/propuestas/{id_propuesta}/cierre` | Cierre administrativo del proyecto (exige informe final) |
| OK | GET | `/admin/catalogos` | Catálogos maestros editables (whitelist de tablas) |
| OK | GET | `/admin/catalogos/{clave}` | Registros de un catálogo maestro editable |
| OK | POST | `/admin/catalogos/{clave}` | Alta de registro en catálogo maestro |
| OK | PATCH | `/admin/catalogos/{clave}/{id_registro}` | Edición de registro en catálogo maestro |
| OK | DELETE | `/admin/catalogos/{clave}/{id_registro}` | Baja de registro (409 si está en uso) |
| OK | PATCH | `/admin/catalogos/roles/{id_rol}/mover` | Reordenar el rol en la ruta operativa |
| OK | GET | `/admin/rubrica` | Rúbrica vigente con secciones, criterios y versiones |
| OK | GET | `/admin/rubrica/versiones` | Historial de versiones publicadas de la rúbrica |
| OK | POST/PATCH/DELETE | `/admin/rubrica/secciones[/{id}]` | CRUD de secciones de rúbrica |
| OK | POST/PATCH/DELETE | `/admin/rubrica/criterios[/{id}]` | CRUD de criterios de rúbrica |
| OK | POST/PATCH/DELETE | `/admin/rubrica/versiones[/{id}]` | Publicar, editar y activar versiones de rúbrica |
| OK | GET/POST/PATCH/DELETE | `/admin/convocatorias[/{id}]` | CRUD de convocatorias |
| OK | GET/POST | `/admin/convocatorias/{id}/etapas` | Cronograma de la convocatoria |
| OK | PATCH/DELETE | `/admin/etapas/{id_etapa}` | Edición y baja de una etapa |
| OK | GET/POST | `/admin/convocatorias/{id}/documentos` | Instrumentos oficiales (listado y subida a Storage) |
| OK | PATCH/DELETE | `/admin/documentos/{id_documento}` | Edición, retiro y borrado de un instrumento |
| OK | GET | `/ia/estado` | Estado del servicio IA |
| OK | GET | `/ia/criterios` | Criterios normativos |
| OK | GET | `/ia/evaluacion-preliminar/{id_propuesta}` | Evaluación IA guardada (null si no existe; no genera) |
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
- [x] **09 · Equipo:** endpoint `GET /auth/usuarios` para buscar usuarios institucionales, autocompletar su ORCID si está registrado en su perfil o solicitarlo y validarlo bajo norma **ISO 7064 MOD 11-2** con unicidad por participante.
- [x] **09 · Equipo:** alta de investigadores en el directorio institucional. La búsqueda sin coincidencias solo muestra un aviso en línea (sin interrumpir); al pulsar **«Guardar participante»** sin haber elegido a nadie, se abre el diálogo «¿Desea agregar al investigador?». Con «Sí» se registra la cuenta real con `POST /auth/usuarios` (nombre, apellidos, correo, escuela y ORCID; nombre y apellidos con máximo 15 caracteres) y se suma al equipo con rol, tipo de hora, dedicación y responsabilidad en el mismo paso. La contraseña inicial la genera el servidor y se entrega por correo SMTP (o en la respuesta, en modo prototipo, cuando no hay SMTP configurado).
- [x] **09 · Equipo:** el formulario de alta abre vacío, los errores se muestran en una ventana superpuesta con botón «Aceptar» y el botón de envío se bloquea con un círculo de carga mientras la petición se procesa.
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
- [x] **20 · Seguimiento:** las acciones pendientes se derivan del estado real: remisión a Vinculación, sometimiento ante VIE, reenvío tras observaciones, presentación de la carta de aceptación e informe de seguimiento.
- [x] **20 · Seguimiento:** reenvío del expediente devuelto con observaciones a la etapa que lo devolvió (`POST /propuestas/{id}/observaciones/reenvio`).
- [x] **20 · Seguimiento:** aceptación de la carta de aceptación (`POST /propuestas/{id}/aceptacion`), que abre la ejecución del proyecto.
- [x] **20 · Seguimiento:** registro del informe de seguimiento (`POST /propuestas/{id}/informe`).
- [x] **22 · Expediente:** la pantalla consume el dossier real del backend (`dossierActual`).
- [x] **22 · Expediente:** pestañas Documentos, Evaluaciones, Resolución e Historial conectadas al dossier real.
- [x] **28 · Historial:** conectado al arreglo `historial` y a `vinculacion_evaluaciones` del dossier.
- [x] **33 · Perfil:** endpoint `PATCH /auth/usuarios/{id_usuario}/orcid` para solicitar, validar (ISO 7064 MOD 11-2) y vincular el ORCID único al perfil del investigador.
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
- [x] **23 · Revisión de Vinculación:** transición controlada de «En revisión de Vinculación» a «En evaluación del Comité Técnico», «Con observaciones» o «Rechazada».
- [x] **23 · Revisión de Vinculación:** la decisión se elige de forma explícita (Favorable / Con observaciones / Rechazada) y las observaciones son obligatorias en las devoluciones y los rechazos.
- [x] **23 · Revisión de Vinculación:** el rechazo es terminal; el expediente no admite nuevas revisiones.
- [x] **23 · Revisión de Vinculación:** notificar al investigador y al Comité.
- [x] **28 · Historial:** mostrar decisión de Vinculación con actor, fecha y documento.
- [x] **29–30 · Consulta histórica:** usar `GET /propuestas` con filtros reales.
- [x] **29–30 · Consulta histórica:** usar `GET /propuestas/{id}` al abrir un resultado.

### 4.3 Comité Técnico

Pantallas principales: `02`, `21`, `22`, `24`, `28`.

- [x] **02 · Inicio:** tarjetas de pendientes, dictaminadas y total calculadas desde la bandeja real del Comité.
- [x] **02 · Inicio:** propuesta destacada = última propuesta que ingresó a «En evaluación del Comité Técnico», ordenada por `proposal_state_history`.
- [x] **21 · Bandeja:** filtrar propuestas en evaluación del Comité (`GET /propuestas/comite/bandeja`).
- [x] **21 · Bandeja:** ordenar por fecha de ingreso a «En evaluación del Comité Técnico» (`fecha_ingreso_comite`), no por fecha de creación.
- [ ] **21 · Bandeja:** asignación explícita de evaluadores.
- [x] **22 · Expediente:** cargar dossier real.
- [x] **24 · Evaluación:** endpoint para consultar la rúbrica oficial (`GET /propuestas/comite/rubrica`).
- [x] **24 · Evaluación:** la rúbrica está versionada (`rubric_versions`) y el Comité Técnico evalúa siempre con la versión activa; la versión base sembrada en la base desplegada es la de Desarrollo tecnológico.
- [x] **24 · Evaluación:** endpoint para guardar puntaje por criterio en `technical_committee_scores`.
- [x] **24 · Evaluación:** guardar puntaje total en `technical_committee_evaluations`.
- [x] **24 · Evaluación:** guardar observaciones en `evaluations`.
- [x] **24 · Evaluación:** calcular suma ponderada en servidor.
- [x] **24 · Evaluación:** validar umbral de 70 y criterios obligatorios en servidor.
- [x] **24 · Evaluación:** validar productos académicos comprometidos (`produccion_conforme` obligatorio para recomendar).
- [ ] **Parcial:** se consolidó un único dictamen por propuesta; falta soportar evaluación individual por evaluador y su consolidación.
- [x] **24 · Evaluación:** consolidar resultado del comité (409 si ya existe dictamen).
- [x] **24 · Evaluación:** transición controlada de «En evaluación del Comité Técnico» a «Pendiente de aval del Consejo», «Con observaciones» o «Rechazada».
- [x] **24 · Evaluación:** la decisión se elige de forma explícita (Favorable / Con observaciones / Rechazada) y el rechazo es terminal.
- [x] **24 · Evaluación:** asociar acta/informe del Comité mediante `id_documento` validado contra el expediente.
- [x] **24 · Evaluación:** notificar al Consejo de Escuela cuando el dictamen es favorable.
- [x] **28 · Historial:** mostrar puntajes, criterios y observaciones.

### 4.4 Consejo de Escuela

Pantallas principales: `02`, `21`, `22`, `25`, `28`.

- [x] **02 · Inicio:** tarjetas de pendientes, dictaminadas y total calculadas desde la bandeja real del Consejo.
- [x] **02 · Inicio:** propuesta destacada = última propuesta que ingresó a «Pendiente de aval del Consejo», ordenada por `proposal_state_history`.
- [x] **21 · Bandeja:** filtrar propuestas pendientes de aval (`GET /propuestas/consejo/bandeja`).
- [x] **21 · Bandeja:** filtrar por la escuela del usuario (escuela líder y escuelas del equipo investigador).
- [x] **25 · Aval:** persistir en `council_endorsements`.
- [x] **25 · Aval:** guardar instancia/escuela que avala.
- [x] **25 · Aval:** guardar tipo de instancia, sesión, artículo y fecha.
- [x] **25 · Aval:** guardar número de oficio.
- [x] **25 · Aval:** guardar ratificación de calificación.
- [x] **25 · Aval:** guardar aval de presupuesto y horas de personal.
- [x] **25 · Aval:** guardar observaciones.
- [x] **25 · Aval:** soportar avales de varias escuelas para una misma propuesta (una fila por escuela).
- [x] **25 · Aval:** validar que cada escuela avale a su propio personal.
- [x] **25 · Aval:** adjuntar acuerdo firmado (documento validado contra el expediente).
- [x] **25 · Aval:** transición controlada a «Avalada» cuando todas las escuelas involucradas avalaron.
- [x] **25 · Aval:** la decisión se elige de forma explícita (Favorable / Con observaciones / Rechazada); en la devolución y el rechazo el estado resultante es «Con observaciones» o «Rechazada», y el rechazo es terminal.
- [x] **25 · Aval:** notificar al investigador para el sometimiento formal.
- [x] **28 · Historial:** mostrar avales y acuerdos.

### 4.5 Dirección de Investigación

Pantallas principales: `02`, `21`, `22`, `26`, `28`, `29`, `30`, `31`, `32`.

- [x] **02 · Inicio:** bandeja de propuestas sometidas ante VIE para Dirección de Investigación.
- [x] **02 · Inicio:** dashboard con contadores reales `pendientes`, `determinadas` y `totales_revisadas` (`GET /propuestas/direccion/dashboard`).
- [x] **02 · Inicio:** propuesta destacada = más reciente ingresada a VIE (por `proposal_state_history`).
- [x] **21 · Bandeja:** filtrar propuestas sometidas ante VIE (`GET /propuestas/direccion/bandeja`).
- [x] **21 · Bandeja:** ordenar por fecha de ingreso a VIE descendente.
- [x] **22 · Expediente:** cargar dossier real con `dictamen_direccion` incluido.
- [x] **26 · Dictamen:** persistir verificaciones en `vie_dictamen_verifications`.
- [x] **26 · Dictamen:** guardar cada criterio y su cumplimiento.
- [x] **26 · Dictamen:** guardar resultado favorable, con observaciones o desfavorable.
- [x] **26 · Dictamen:** guardar fundamentación y fecha.
- [x] **26 · Dictamen:** formulario con checklist de criterios VIE y verificaciones institucionales.
- [x] **26 · Dictamen:** transición controlada de «Sometida ante VIE» a «Dictaminada por Dirección», «Con observaciones» o «Rechazada».
- [x] **26 · Dictamen:** la resolución «No favorable» de Dirección deja el expediente en «Rechazada» (terminal) y la «Con observaciones» devuelve el expediente al líder.
- [x] **26 · Dictamen:** notificar al líder de la propuesta.
- [x] **26 · Dictamen:** resolver los estados por nombre desde `estados` (nada de identificadores fixedos).
- [x] **21 · Bandeja:** pestaña propia «En ejecución» con los proyectos en curso, que Dirección debe cerrar.
- [x] **22 · Expediente:** botón «Cerrar proyecto» para Dirección cuando el expediente está «En ejecución».
- [x] **Cierre del proyecto:** `POST /propuestas/{id}/cierre` exige el informe final y deja el expediente en «Cerrada», estado terminal.
- [x] **28 · Historial:** mostrar verificaciones y dictamen de Dirección.
- [x] **29–30 · Consulta histórica:** el buscador genérico `GET /propuestas` cubre los filtros y el detalle.
- [x] **31 · Administración de convocatorias:** CRUD completo (`POST/PATCH/DELETE /admin/convocatorias`).
- [x] **31 · Administración de convocatorias:** CRUD de etapas (`/admin/convocatorias/{id}/etapas` y `/admin/etapas/{id}`).
- [x] **31 · Administración de convocatorias:** edición de reglas por modalidad (catálogo `modalidades`).
- [x] **31 · Administración de convocatorias:** activar/cerrar convocatoria con el campo `activo`.
- [x] **31 · Administración de convocatorias:** editar/eliminar documentos oficiales (`/admin/documentos/{id}` con borrado del archivo en Storage).
- [x] **32 · Rúbricas y catálogos:** CRUD de líneas, modalidades, escuelas, tipos de hora, rubros y criterios VIE (`/admin/catalogos/{clave}`).
- [x] **32 · Rúbricas y catálogos:** CRUD de secciones/criterios de rúbrica (`/admin/rubrica/secciones` y `/admin/rubrica/criterios`).
- [x] **32 · Rúbricas y catálogos:** endpoint para pesos y órdenes de roles (`roles.orden` y `PATCH /admin/catalogos/roles/{id}/mover`).
- [x] **32 · Rúbricas y catálogos:** endpoint para versionar rúbricas (`rubric_versions`, con clonación y activación de versión).

### 4.6 CIE

Pantallas principales: `02`, `21`, `22`, `27`, `28`, `29`, `30`.

- [x] **02 · Inicio:** dashboard con contadores reales `pendientes`, `resueltas` y `totales_revisadas` (`GET /propuestas/cie/dashboard`).
- [x] **02 · Inicio:** propuesta destacada = más reciente dictaminada por Dirección (por `proposal_state_history`).
- [x] **21 · Bandeja:** filtrar propuestas con dictamen de Dirección (`GET /propuestas/cie/bandeja`).
- [x] **21 · Bandeja:** ordenar por fecha de ingreso al estado «Dictaminada por Dirección» descendente.
- [x] **22 · Expediente:** cargar dossier real con `resolucion_cie` incluido.
- [x] **27 · Resolución:** persistir resolución aprobada/rechazada/observada (`cie_resolution_evaluations` + `evaluations`).
- [x] **27 · Resolución:** guardar sesión, artículo y fecha.
- [x] **27 · Resolución:** guardar fundamentación y condiciones.
- [x] **27 · Resolución:** adjuntar acuerdo firmado (`id_documento` en `proposal_documents`).
- [x] **27 · Resolución:** transición controlada de «Dictaminada por Dirección» a «Aprobada por CIE», «Con observaciones» o «Rechazada».
- [x] **27 · Resolución:** el rechazo por conflicto bioético no subsanable es terminal y el acuerdo condicionado a enmiendas menores devuelve el expediente al líder.
- [x] **27 · Resolución:** notificar al investigador.
- [x] **27 · Resolución:** registrar condiciones de aceptación posteriores.
- [x] **27 · Resolución:** el tipo de acuerdo se toma del catálogo `resoluciones_cie` (cuatro tipos vigentes).
- [x] **27 · Resolución:** aceptar los dos roles del comité (`CIE` y `Evaluador Comité de Ética (CIE)`), comparados por nombre.
- [x] **27 · Resolución:** resolver los estados por nombre desde `estados` (nada de identificadores fijos).
- [x] **28 · Historial:** mostrar resolución y condiciones.
- [x] **29–30 · Consulta histórica:** filtros y detalle reales.

### 4.7 Administración y cuenta

- [x] **31 · Convocatorias:** CRUD completo (`/admin/convocatorias`), accesible para Dirección, Funcionarios VIE y Administración del Sistema.
- [x] **31 · Convocatorias:** asociar documentos y cronograma (`/admin/convocatorias/{id}/etapas` y `/admin/convocatorias/{id}/documentos`).
- [x] **32 · Catálogos:** CRUD y activación/inactivación (`/admin/catalogos/{clave}` con whitelist de tablas y control de referencias).
- [x] **32 · Rúbricas:** CRUD de secciones, criterios, pesos y versiones (`/admin/rubrica/*` y tabla `rubric_versions`).
- [x] **32 · Roles:** consulta y orden de roles (`GET /admin/catalogos` y `PATCH /admin/catalogos/roles/{id}/mover`).
- [ ] **33 · Perfil:** consulta de datos propios.
- [ ] **33 · Perfil:** actualización de datos permitidos.
- [ ] **33 · Perfil:** cambio de contraseña.
- [ ] **33 · Perfil:** visualización de roles/permisos reales.
- [ ] **Transversal:** endpoint de usuarios para equipos y administración.
- [ ] **Transversal:** bitácora de accesos y acciones administrativas.

## 5. Tablas que ya existen pero no tienen uso completo

| Tabla | Estado de uso | Falta |
|---|---|---|
| `convocatorias` | Uso completo | Mantener al versionar las convocatorias |
| `convocatoria_etapas` | Uso completo | Ninguno |
| `convocatoria_documentos` | Uso completo | Mantener el versionado de instrumentos |
| `vinculacion_evaluations` | Uso completo | Mantener al versionar el dictamen |
| `council_endorsements` | Uso completo | Falta relacionar el acuerdo firmado (`id_documento`) con el aval |
| `rubric_sections` | Uso completo | Mantener la coherencia con la versión activa |
| `rubric_criteria` | Uso completo | Mantener la coherencia con la versión activa |
| `rubric_versions` | Uso completo | Mantener una sola versión activa |
| `roles` | Uso completo | Mantener el `orden` de la ruta operativa |
| `technical_committee_scores` | Uso completo | Mantener la integridad al versionar rúbricas |
| `vie_dictamen_verifications` | Uso completo | Verificación de criterios de Dirección (rol Dirección) |
| `technical_committee_evaluations` | Uso completo | `decision`, `justificacion`, `tiene_bloqueo_obligatorio` y `puntaje numeric(5,1)` (V12) |
| `cie_resolution_evaluations` | Uso completo | Datos del acuerdo Ampliados en V15: `numero_sesion`, `articulo`, `fecha_resolucion`, `fundamentacion`, `condiciones`, `id_documento`, `id_usuario_registro`, `fecha_registro` |
| `resoluciones_cie` | Uso completo | Catálogo de los cuatro tipos de acuerdo; la siembra idempotente está en V15 |
| `ai_preliminary_evaluations` | Uso completo | Mantener y versionar si cambia el modelo |
| `proposal_documents` | Uso completo | Archivo real en Storage + metadatos; sin filas falsas de borrador |
| `notificaciones` | Uso completo | Rutas `PATCH` alineadas (una y todas) |

## 6. Backlog propuesto de endpoints

> Estos endpoints son una propuesta de cierre. Ajustar nombres si se decide otra convención.

### 6.1 Autenticación y usuarios

- [ ] `GET /auth/me`
- [ ] `POST /auth/logout`
- [x] `GET /usuarios?q=...` para búsqueda de equipo → cubierto por `GET /auth/usuarios` (búsqueda de investigadores institucionales activos con ORCID de perfil).
- [x] `POST /usuarios` para alta de investigador en el directorio → cubierto por `POST /auth/usuarios` (rol `Investigador`, dominio autorizado, ORCID válido y único, credencial inicial por SMTP).
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
- [x] `GET /propuestas/comite/bandeja`.
- [x] `GET /propuestas/comite/rubrica`.
- [x] `GET /propuestas/comite/{id_propuesta}`.
- [x] `POST /propuestas/comite/{id_propuesta}`.
- [x] `GET /propuestas/consejo/bandeja`.
- [x] `GET /propuestas/consejo/{id_propuesta}`.
- [x] `POST /propuestas/consejo/{id_propuesta}`.
- [ ] `POST /propuestas/{id}/consejo`.
- [ ] `GET /propuestas/{id}/consejo`.
- [x] `POST /propuestas/direccion/{id_propuesta}` (registrar dictamen de Dirección).
- [x] `GET /propuestas/direccion/{id_propuesta}` (detalle con verificaciones VIE).
- [x] `POST /propuestas/cie/{id_propuesta}` (registrar resolución colegiada del CIE).
- [x] `GET /propuestas/cie/{id_propuesta}` (detalle con dictamen de Dirección y catálogo de acuerdos).
- [x] `POST /propuestas/cie/{id_propuesta}/condiciones` (condiciones de aceptación posteriores).
- [x] `GET /propuestas/cie/bandeja` y `GET /propuestas/cie/dashboard`.
- [x] `POST /propuestas/{id}/observaciones/reenvio` (reenvío a la etapa que devolvió el expediente).
- [x] `POST /propuestas/{id}/aceptacion` (aceptación de la carta y pase a ejecución).
- [x] `POST /propuestas/{id}/informe` (informe de seguimiento del proyecto).
- [x] `POST /propuestas/{id}/cierre` (cierre administrativo con informe final obligatorio).

### 6.5 Administración

- [x] `GET/POST/PATCH/DELETE /admin/convocatorias`.
- [x] `GET/POST /admin/convocatorias/{id}/etapas` y `PATCH/DELETE /admin/etapas/{id_etapa}`.
- [x] `GET/POST/PATCH/DELETE /admin/convocatorias/{id}/documentos` y `PATCH/DELETE /admin/documentos/{id_documento}`.
- [x] `GET/POST/PATCH/DELETE /admin/rubrica/versiones` (versionado de rúbricas).
- [x] `GET/POST/PATCH/DELETE /admin/rubrica/secciones` y `/admin/rubrica/criterios`.
- [x] CRUD de catálogos maestros (`/admin/catalogos/{clave}` con whitelist de tablas).
- [x] `PATCH /admin/catalogos/roles/{id_rol}/mover` (orden de la ruta operativa).

## 7. Pruebas mínimas para marcar “backend completo”

- [ ] Login exitoso y fallido por cada rol.
- [ ] Un usuario inactivo no puede entrar.
- [ ] Sin token/sesión no se puede llamar a endpoints protegidos.
- [ ] Un investigador solo ve y modifica sus propias propuestas.
- [ ] Vinculación no puede actuar como Comité, Consejo, Dirección ni CIE.
- [ ] Comité no puede emitir resolución CIE.
- [x] Consejo solo avala propuestas de su escuela (403 validado en `test_endpoints.ps1`, FASE 6).
- [ ] Dirección no puede resolver CIE.
- [x] CIE no puede modificar un dictamen de Dirección (el router del CIE solo registra resoluciones y condiciones; el dictamen de Dirección es de solo lectura).
- [x] CIE no puede resolver una propuesta que no esté en `7 · Dictaminada por Dirección` (409 validado en `test_endpoints.ps1`, FASE 10).
- [ ] Crear propuesta completa y consultarla por ID.
- [ ] Reenviar el mismo `client_uuid` no duplica.
- [ ] Consultar expediente con todas sus tablas hijas.
- [x] Cada transición de estado deja historial y notificación.
- [x] Un estado no permitido devuelve error (409 validado en `test_endpoints.ps1`, FASE 11).
- [x] Un rol sin facultad sobre la etapa devuelve error (409 validado en `test_endpoints.ps1`, FASE 11).
- [x] El rechazo es terminal en todas las etapas evaluadoras y no admite ninguna transición posterior.
- [x] Cada dictamen queda asociado a usuario, rol, fecha y documento (Comité Técnico, Consejo de Escuela, Dirección y CIE).
- [x] Las notificaciones se listan y se marcan como leídas.
- [x] Los documentos se cargan, listan, descargan y eliminan (instrumentos oficiales de convocatoria, verificados de punta a punta contra Supabase Storage).
- [x] Las carpetas del bucket siguen la estructura institucional (`<convocatoria>/documentos/` y `<convocatoria>/propuestas/<código>/`), verificado con subidas reales de punta a punta.
- [x] Cada transición de estado deja historial y notificación (verificado para el CIE en `test_endpoints.ps1`, FASE 10).
- [ ] La IA responde con Gemini o con el motor de respaldo.
- [ ] El frontend sigue funcionando si la IA falla.

## 8. Orden sugerido de cierre

> Estado a 2026-11-03: los pasos 2 a 9 y el 12 están implementados y verificados; falta el paso 1 (autenticación con token), el 10 (versionado de documentos) y el 11 (pruebas automatizadas y limpieza de datos demo).

1. Autenticación con token y autorización por rol.
2. Corrección de notificaciones. **Hecho.**
3. Conexión real de `GET /propuestas` y `GET /propuestas/{id}` en pantallas 06, 20, 21, 22, 28, 29 y 30. **Hecho.**
4. Persistencia específica de Vinculación. **Hecho.**
5. Rúbrica y evaluación del Comité. **Hecho.**
6. Avales del Consejo. **Hecho.**
7. Verificación y dictamen de Dirección. **Hecho.**
8. Resolución del CIE. **Hecho.**
9. Administración de convocatorias, catálogos y rúbricas. **Hecho.**
10. Carga real de documentos y versionado.
11. Pruebas automatizadas y limpieza de datos demo.
12. Máquina de estados, rechazo terminal y cierre del proyecto. **Hecho.**

## 9. Notas de alcance

- El frontend conserva un selector de roles y datos de demostración; no equivalen a autorización real.
- Los nombres demo restantes en expediente, historial y participación estudiantil están fuera del ajuste B ya realizado.
- La creación de propuestas ya está integrada y probada; las brechas principales están en consulta, evaluación por rol, administración y seguridad.
- Antes de marcar un elemento como terminado, verificar también que el frontend consuma el endpoint correcto.
- Migraciones aplicadas a la base desplegada el 2026-11-01: `V13__administracion_rubricas_roles.sql` (`roles.orden`, `version` en rúbrica, tabla `rubric_versions`) y `V14__usuario_administrador_sistema.sql` (cuenta de demostración con rol «Administrador del Sistema», `administrador@example.com` / `demostracion`).
- Migración aplicada a la base desplegada el 2026-11-02: `V15__cie_resoluciones.sql` (columnas del acuerdo en `cie_resolution_evaluations`, índice por propuesta y siembra idempotente de `resoluciones_cie`).
- Migración **pendiente de aplicación** por el administrador: `V16__saneamiento_estados.sql` (garantía idempotente del catálogo de estados por nombre y reparación de los expedientes cuya etapa contradecía la última decisión de la bitácora). El script es idempotente y no elimina filas de auditoría. Detalle en `Base de datos/Cambios.md`, sección 8.
- **Causa raíz del bug de transiciones:** dos numeraciones del catálogo `estados` (el seed V3 y el orden de la base desplegada). Por eso el identificador del estado **no** es parte del contrato: todo el código resuelve el estado por su nombre oficial (`backend/app/estados.py` en el servidor, `idEstadoPorNombre()` en el frontend).
- **Nota sobre los datos:** la base de datos desplegada fue re-sembrada con los scripts de `Base de datos/Scripts` y quedó con los 9 usuarios y las 4 propuestas del seed (antes había 18 usuarios y 132 propuestas de trabajo). El backend de Render apunta a esa misma base.
- El comité tiene dos roles institucionales: `CIE` (comité colegiado, usuario 17 `ricardo.mora@example.com`) y `Evaluador Comité de Ética (CIE)` (evaluadora 6 `patricia.solano@universidad.edu`). Ambos resuelven expedientes y el frontend los registra con la misma clave `cie`.
- En los endpoints multipart el actor viaja en el cuerpo (`id_usuario` como `Form`), no en la URL: `POST /admin/convocatorias/{id}/documentos` y `POST /propuestas/{id}/documentos`. En el resto del router `/admin` `id_usuario` sigue siendo un parámetro de consulta.
