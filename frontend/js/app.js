"use strict";
/**
 * ============================================================================
 * 2.1. OBJETIVO DEL ARCHIVO:
 * Funcionar como el controlador maestro y motor de SPA (Single Page Application)
 * del Frontend del SGPI (Sistema de Gestión de Propuestas de Investigación),
 * gestionando el ciclo de vida de la aplicación, navegación cliente, autenticación,
 * sincronización con la API REST y renderizado dinámico de las 33 pantallas.
 *
 * 2.2. RELACIONES:
 * 2.2.1. De dónde obtiene datos:
 *   - Del Backend FastAPI (http://localhost:3001) a través de peticiones HTTP:
 *     * /auth/login (credenciales y roles de usuario)
 *     * /propuestas/dashboardpropuestas (conteos de propuestas)
 *     * /propuestas/propuestaMasReciente (última propuesta activa)
 *     * /propuestas/top3PropuestaMasReciente (top 3 propuestas recientes)
 *     * /notificaciones/notificaciones (bandeja de notificaciones)
 *     * /modalidades/totalmodalidades (catálogo de modalidades)
 *     * /escuelas/totalescuelas (catálogo de escuelas)
 *     * /lineas_de_investigacion/totalLineas (catálogo de líneas de investigación)
 *     * /convocatorias/totalConvocatorias y /convocatorias/etapas_convocatorias
 *   - De window.SGPI_CONTENT (content.js) con el catálogo declarativo de pantallas.
 *   - De localStorage del navegador ('sgpi-session' y 'sgpi-demo').
 * 2.2.2. A dónde envía datos:
 *   - Al Backend FastAPI para autenticación (/auth/login) y actualización de estados.
 *   - Al DOM del navegador (inyección en #app, gestión de modales, alertas y breadcrumbs).
 *   - A localStorage para persistir la sesión y estado de demostración.
 *
 * 2.3. A GROSO MODO ¿QUÉ HACE EL ARCHIVO?:
 * Implementa la lógica reactiva integral de la aplicación: valida sesiones,
 * consulta catálogos en paralelo al inicializar, procesa formularios de propuesta
 * por etapas, renderiza vistas según el rol activo (Investigador, Vinculación,
 * Comité Técnico, Consejo de Escuela, Dirección, CIE), controla el historial con
 * URL hash, y maneja accesibilidad, atajos de teclado y modales.
 * ============================================================================
 */

/* =====================================================================
   Autenticación y configuración de API
   ===================================================================== */

// [Línea clave]: ¿Por qué soy importante? Define la URL base de comunicación con la API del Backend soportando entorno local y nube (Vercel -> Render). ¿Para qué? Enrutar todas las solicitudes HTTP fetch hacia localhost:3001 en desarrollo o hacia el servicio de Render en producción. ¿Dónde me usan? En todas las funciones cliente de la API (apiLogin, numsPropuestas, obtenerEvaluacionPreliminarIA, etc.).
const API_URL =
    window.SGPI_API_URL ||
    localStorage.getItem("sgpi-api-url") ||
    (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.protocol === "file:"
      ? "http://localhost:3001"
      : "https://sgpi-backend-api.onrender.com"),
  SESSION_KEY = "sgpi-session";

/**
 * Mapeo de diccionario tipo Enum entre los nombres oficiales de rol y sus claves de estado interno.
 * Asocia cadenas de texto provistas por la base de datos con identificadores en minúsculas usados en el frontend.
 * Se utiliza al deserializar la sesión del usuario y al aplicar permisos o filtros de pantalla.
 * atributos:
 *     * string : Investigador Clave para Investigador proponente ('investigador').
 *     * string : Vinculación Clave para Centro de Vinculación ('vinculacion').
 *     * string : "Comité Técnico" Clave para Comité Técnico Evaluador ('comite').
 *     * string : "Consejo de Escuela" Clave para Consejo de Escuela ('consejo').
 *     * string : "Dirección de Investigación" Clave para Dirección de Investigación ('direccion').
 *     * string : CIE Clave para Consejo de Investigación y Extensión ('cie').
 */
const ROLE_KEYS = {
  Investigador: "investigador",
  Vinculación: "vinculacion",
  "Comité Técnico": "comite",
  "Consejo de Escuela": "consejo",
  "Dirección de Investigación": "direccion",
  CIE: "cie",
};
// La sesión solo recuerda quién ingresó (nunca la contraseña). Sin un token emitido por el backend es estado de interfaz, no seguridad real.
let session = null;
try {
  const s = JSON.parse(localStorage.getItem(SESSION_KEY));
  if (
    s &&
    s.user &&
    Array.isArray(s.user.roles) &&
    s.user.roles.length &&
    ROLE_KEYS[s.user.roles[0]]
  )
    session = s;
} catch {}
/**
 * Persistir o revocar el objeto de sesión de usuario en memoria y en localStorage.
 * Asigna la variable en memoria 'session'; si es no nulo lo serializa en JSON en localStorage,
 * de lo contrario elimina la llave SESSION_KEY del almacenamiento local.
 * parametros:
 *     - Object|null : s Objeto con datos del usuario autenticado o null para cerrar sesión.
 * return:
 *     + void : undefined No retorna valor.
 */
const setSession = (s) => {
  session = s;
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
};

/**
 * Extraer las iniciales mayúsculas de un nombre completo para mostrarlas en avatares visuales.
 * Divide la cadena por espacios en blanco, toma hasta las primeras dos palabras y concatena sus letras iniciales en mayúscula.
 * parametros:
 *     - string : n Nombre de la persona a procesar.
 * return:
 *     + string : iniciales Cadena de hasta dos caracteres en mayúscula (ej. 'LM').
 */
const initials = (n) =>
  String(n)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

/**
 * Clase de excepción personalizada para categorizar errores ocurridos durante el proceso de login.
 * Hereda de Error y asigna un código interno ('network', 'credentials', 'server', 'noroles').
 * Se lanza en apiLogin() y se captura en doLogin() para desplegar mensajes al usuario.
 * atributos:
 *     * string : code Código representativo del tipo de fallo de autenticación.
 */
class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Realizar la petición de inicio de sesión HTTP POST contra el endpoint de autenticación del backend.
 * Envía credenciales JSON a /auth/login. Lanza AuthError ante desconexión de red, credenciales 401 o fallo 500.
 * parametros:
 *     - string : correo Dirección de correo electrónico institucional ingresada.
 *     - string : password Contraseña en texto plano ingresada por el usuario.
 * return:
 *     + Promise<Object> : usuario Datos del usuario autenticado (id_usuario, nombre, correo, roles).
 */
async function apiLogin(correo, password) {
  let res;
  try {
    // [Línea clave]: ¿Por qué soy importante? Petición de validación de identidad. ¿Para qué? Transmitir correo y contraseña al backend FastAPI. ¿Dónde me usan? Dentro del flujo asíncrono de apiLogin().
    res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo, password }),
    });
  } catch {
    throw new AuthError("network");
  }
  if (res.status === 401) throw new AuthError("credentials");
  if (!res.ok) throw new AuthError("server");
  try {
    return await res.json();
  } catch {
    throw new AuthError("server");
  }
}

/**
 * Registrar la propuesta completa en el backend mediante una única transacción.
 * Envía el payload consolidado a POST /propuestas y propaga el mensaje de error del servidor.
 * parametros:
 *     - Object : payload Estructura completa construida por buildProposalPayload().
 * return:
 *     + Promise<Object> : respuesta Resultado con id, código y evaluación preliminar IA.
 */
async function crearPropuestaBackend(payload) {
  let res;
  try {
    res = await fetch(`${API_URL}/propuestas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("No se pudo conectar con el servidor. Verifica que el backend esté disponible.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const detalle = data?.detail;
    throw new Error(
      typeof detalle === "string"
        ? detalle
        : Array.isArray(detalle)
          ? detalle.map((d) => d.msg || JSON.stringify(d)).join(" · ")
          : "El servidor no pudo registrar la propuesta.",
    );
  }
  return data;
}

/**
 * Diccionario de mensajes de error de autenticación amigables para el usuario.
 * Mapea códigos de AuthError a textos explicativos en español.
 * En el bloque catch de doLogin() para alimentar la alerta de error.
 * atributos:
 *     * string : credentials Mensaje de credenciales erróneas.
 *     * string : network Mensaje de servidor inalcanzable.
 *     * string : server Mensaje de error interno en el servidor.
 *     * string : noroles Mensaje de usuario sin roles asignados.
 */
const LOGIN_ERRORS = {
  credentials: "Correo o contraseña incorrectos.",
  network:
    "No se pudo conectar con el servidor. Verifica que el backend esté en ejecución.",
  server: "El servidor no pudo procesar el acceso. Inténtalo de nuevo.",
  noroles:
    "Tu usuario no tiene un rol válido asignado. Contacta a un administrador.",
};

/**
 * Diccionario de cargadores de datos específicos por identificador de pantalla.
 * Vincula el id de pantalla con la función asíncrona que descarga los datos necesarios.
 * En loadScreenData() tras un cambio de hash de URL.
 * atributos:
 *     * Function : "04" Cargador de convocatorias generales.
 *     * Function : "05" Cargador de etapas de convocatoria según la seleccionada.
 */
const SCREEN_LOADERS = {
  "04": obtener_convocatorias,
  "05": () =>
    Promise.all([
      obtenerEtapasConvocatoria(state.viewCall),
      obtenerDocumentosConvocatoria(state.viewCall),
    ]),
  "06": () => cargarMisPropuestas(),
  "20": () => cargarDossier(),
  "21": () => cargarBandejaVinculacion(),
  "22": () => cargarDossier(),
  "23": async () => {
    await cargarDossier();
    await cargarVinculacion();
  },
  "28": () => cargarDossier(),
  "30": () => buscarPropuestas(),
};

/**
 * Cargar datos asíncronos específicos de la pantalla actual activa en la URL.
 * Lee el hash actual de la URL, consulta SCREEN_LOADERS y ejecuta la función de carga si existe; luego re-renderiza.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<void> : undefined Resuelve al completar la carga y el re-renderizado.
 */
async function loadScreenData() {
  const id = location.hash.replace("#", "") || "01";
  const loader = SCREEN_LOADERS[id];
  if (!loader || !session) return;
  await loader();
  if ((location.hash.replace("#", "") || "01") === id) render(); // sigue en la misma pantalla
}

let numspropuestas = null;

/**
 * Obtener del backend el desglose estadístico de propuestas para el dashboard del usuario.
 * Invoca el endpoint GET /propuestas/dashboardpropuestas con el id_usuario en sesión y guarda el resultado en numspropuestas.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Object|null> : numspropuestas Objeto con { total, formulacion, ejecucion, cerradas } o null.
 */
async function numsPropuestas() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    // [Línea clave]: ¿Por qué soy importante? Consulta las métricas globales del investigador. ¿Para qué? Alimentar las 4 tarjetas estadísticas del panel principal. ¿Dónde me usan? En dashboard() y precarga.
    const res = await fetch(`${API_URL}/propuestas/dashboardpropuestas?id_usuario=${idUsuario}`);
    if (res.ok) numspropuestas = await res.json(); // { total, formulacion, ejecucion, cerradas }
  } catch (err) {
    console.warn("numsPropuestas error:", err);
  }
  return numspropuestas;
}

let propuestamasreciente = null;

/**
 * Consultar la propuesta más recientemente actualizada del usuario autenticado.
 * Consume el endpoint GET /propuestas/propuestaMasReciente pasando el id_usuario de la sesión.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Object|null> : propuestamasreciente Objeto con datos básicos de la propuesta o null.
 */
async function propuestaMasReciente() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(`${API_URL}/propuestas/propuestaMasReciente?id_usuario=${idUsuario}`);
    if (res.ok) propuestamasreciente = await res.json(); // { id, titulo } o null
  } catch (err) {
    console.warn("propuestaMasReciente error:", err);
  }
  return propuestamasreciente;
}

let top3propuestasmasrecientes = null;

/**
 * Obtener las 3 propuestas más recientes del usuario para renderizar la tabla rápida del inicio.
 * Pide al backend /propuestas/top3PropuestaMasReciente y transforma los registros al formato de fila de interfaz.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : top3propuestasmasrecientes Lista de las 3 propuestas formateadas.
 */
async function top3PropuestasMasRecientes() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    // [Línea clave]: ¿Por qué soy importante? Obtiene los últimos proyectos en trabajo. ¿Para qué? Desplegar el listado de acceso rápido en el inicio del investigador. ¿Dónde me usan? En dashboard() y projectRows().
    const res = await fetch(`${API_URL}/propuestas/top3PropuestaMasReciente?id_usuario=${idUsuario}`);
    if (res.ok) {
      const data = await res.json();
      top3propuestasmasrecientes = data.map((p) => ({
        id: p.id,
        code: `SI-${p.id}`,
        title: p.title,
        type: p.tipo,
        period: "-",
        status: p.status,
        amount: Number(p.amount) || 0,
      }));
    }
  } catch (err) {
    console.warn("top3PropuestasMasRecientes error:", err);
  }
  return top3propuestasmasrecientes;
}

let notificaciones = null;

/**
 * Descargar la lista completa de notificaciones del usuario autenticado desde el backend.
 * Realiza un GET a /notificaciones/notificaciones?id_usuario=... y almacena los resultados en la variable global.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : notificaciones Lista de notificaciones del usuario.
 */
async function Notificaciones() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(`${API_URL}/notificaciones/notificaciones?id_usuario=${idUsuario}`);
    if (res.ok) notificaciones = await res.json(); // lista de notificaciones
  } catch (err) {
    console.warn("Notificaciones error:", err);
  }
  return notificaciones;
}

/**
 * Marcar una notificación específica como leída en la interfaz y persistirlo en el backend.
 * Actualiza la bandera en el arreglo en memoria y envía una petición asíncrona a la API.
 * parametros:
 *     - number : idNotif Identificador numérico de la notificación.
 * return:
 *     + void : undefined Actualiza estado in-place y dispara notificación al backend.
 */
function marcarLeida(idNotif) {
  const n = (notificaciones ?? []).find((x) => x.id_notificacion === idNotif);
  if (n) n.leida = true;
  fetch(`${API_URL}/notificaciones/${idNotif}/leer`, { method: "PATCH" })
    .catch((e) => console.warn("Error avisando lectura:", e));
}

/**
 * Marcar todas las notificaciones pendientes del usuario como leídas.
 * Muta la propiedad leida a true en todos los elementos de memoria y realiza un PATCH a /notificaciones/leer-todas.
 * parametros:
 *     (ninguno)
 * return:
 *     + void : undefined Actualiza estado en memoria y sincroniza en segundo plano.
 */
function marcarTodasLeidas() {
  (notificaciones ?? []).forEach((n) => (n.leida = true));
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return;
  fetch(`${API_URL}/notificaciones/leer-todas?id_usuario=${idUsuario}`, { method: "PATCH" })
    .catch((e) => console.warn("Error marcando todas leídas:", e));
}

let modalidades = null;

/**
 * Obtener el catálogo institucional de modalidades de investigación activas.
 * Realiza una consulta GET al endpoint /modalidades/totalmodalidades y almacena el resultado.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : modalidades Lista de modalidades disponibles.
 */
async function Modalidades() {
  try {
    const res = await fetch(`${API_URL}/modalidades/totalmodalidades`);
    if (res.ok) modalidades = await res.json();
  } catch (err) {
    console.warn("Modalidades error:", err);
  }
  return modalidades;
}

let escuelas = null;

/**
 * Descargar la lista de escuelas y centros de investigación disponibles para el usuario.
 * Envía una consulta GET a /escuelas/totalescuelas con el id_usuario en sesión.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : escuelas Lista de instancias coordinadoras disponibles.
 */
async function obtener_escuelas() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(`${API_URL}/escuelas/totalescuelas?id_usuario=${idUsuario}`);
    if (res.ok) escuelas = await res.json();
  } catch (err) {
    console.warn("obtener_escuelas error:", err);
  }
  return escuelas;
}

let lineas_investigacion = null;

/**
 * Consultar el catálogo de líneas de investigación institucionales vigentes.
 * Invoca el endpoint GET /lineas_de_investigacion/totalLineas.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : lineas_investigacion Lista de líneas activas.
 */
async function obtener_lineas_investigacion() {
  try {
    const res = await fetch(`${API_URL}/lineas_de_investigacion/totalLineas`);
    if (res.ok) lineas_investigacion = await res.json();
  } catch (err) {
    console.warn("obtener_lineas_investigacion error:", err);
  }
  return lineas_investigacion;
}

let convocatorias = null;
let catalogos = null;

/**
 * Descargar el listado maestro de convocatorias institucionales registradas en el SGPI.
 * Realiza una llamada GET a /convocatorias/totalConvocatorias y actualiza la variable en memoria.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : convocatorias Lista completa de convocatorias.
 */
async function obtener_convocatorias() {
  try {
    const res = await fetch(`${API_URL}/convocatorias/totalConvocatorias`);
    if (res.ok) convocatorias = await res.json();
  } catch (err) {
    console.warn("obtener_convocatorias error:", err);
  }
  return convocatorias;
}

/**
 * Descargar en una sola llamada todos los catálogos institucionales consolidados.
 * Se usa para resolver rubros, tipos de hora, niveles de riesgo y estados con sus IDs reales.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Object|null> : catalogos Catálogos institucionales consolidados.
 */
async function obtenerCatalogos() {
  try {
    const res = await fetch(`${API_URL}/catalogos`);
    if (res.ok) catalogos = await res.json();
  } catch (err) {
    console.warn("obtenerCatalogos error:", err);
  }
  return catalogos;
}

let etapasConvocatoria = null;

/**
 * Obtener el cronograma de etapas y fechas límite de una convocatoria particular.
 * Realiza una petición GET a /convocatorias/etapas_convocatorias filtrando por el id_convocatoria suministrado.
 * parametros:
 *     - number|string : id_convocatoria Identificador único de la convocatoria.
 * return:
 *     + Promise<Array<Object>|null> : etapasConvocatoria Cronograma de etapas de la convocatoria.
 */
async function obtenerEtapasConvocatoria(id_convocatoria) {
  etapasConvocatoria  = null;
  try {
    const res = await fetch(`${API_URL}/convocatorias/etapas_convocatorias?id_convocatoria=${id_convocatoria}`);
    if (res.ok) etapasConvocatoria  = await res.json();
  } catch (err) {
    console.warn("obtenerEtapasConvocatoria error:", err);
  }
  return etapasConvocatoria ;
}

let documentosConvocatoria = null;
async function obtenerDocumentosConvocatoria(id_convocatoria) {
  documentosConvocatoria = null; // null = cargando
  try {
    const res = await fetch(
      `${API_URL}/convocatorias/documentos_convocatoria?id_convocatoria=${id_convocatoria}`,
    );
    documentosConvocatoria = res.ok ? await res.json() : [];
  } catch (err) {
    console.warn("obtenerDocumentosConvocatoria error:", err);
    documentosConvocatoria = [];
  }
  return documentosConvocatoria;
}

let evaluacionPreliminarIA = null;

/**
 * Consultar en el backend la evaluación preliminar generada por la IA de Gemini (Plan Gratuito).
 * Invoca GET /ia/evaluacion-preliminar/{id_propuesta} y almacena el dictamen multi-nivel en evaluacionPreliminarIA.
 * parametros:
 *     - number : idPropuesta Identificador numérico de la propuesta en Supabase (por defecto 1).
 * return:
 *     + Promise<Object|null> : evaluacionPreliminarIA Objeto con la referencia de IA para los 5 niveles evaluadores.
 */
async function obtenerEvaluacionPreliminarIA(idPropuesta = 1) {
  try {
    // [Línea clave]: ¿Por qué soy importante? Descarga el dictamen preliminar de Gemini IA desde el Backend en Render/Local. ¿Para qué? Mostrar a cada nivel evaluador su guía de referencia según criterios VIE 2027. ¿Dónde me usan? En obtenerDatosBackend(), dossier() y evaluation().
    const res = await fetch(`${API_URL}/ia/evaluacion-preliminar/${idPropuesta}`);
    if (res.ok) {
      evaluacionPreliminarIA = await res.json();
    }
  } catch (err) {
    console.warn("obtenerEvaluacionPreliminarIA error:", err);
  }
  return evaluacionPreliminarIA;
}

/**
 * Solicitar al backend la generación o actualización en vivo de la evaluación preliminar con Gemini IA.
 * Envía los parámetros actuales del formulario en memoria a POST /ia/evaluar-borrador para que Gemini
 * analice el presupuesto, horas, objetivos, actividades y riesgos al enviar la propuesta a revisión.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Object|null> : evaluacionPreliminarIA Dictamen preliminar actualizado y persistido en Supabase.
 */
async function generarEvaluacionPreliminarIA() {
  try {
    const tieneEquipoAnio2 = state.budget.some(
      (r) => (r.code.includes("5-01") || r.name.toLowerCase().includes("equipo")) && Number(r.b) > 0,
    );
    const incluyeBeca = state.budget.some(
      (r) => (r.code.includes("6-02") || r.name.toLowerCase().includes("beca")) && Number(r.a) + Number(r.b) >= 960000,
    );
    const equipoActual = proposalTeamMembers();
    const payload = {
      id_propuesta: currentProposalId(),
      codigo: state.created?.code || state.viewProposal || "SI-2027-014",
      titulo: draftValue("08:Título de la propuesta", screenDefault("08", "Título de la propuesta")),
      modalidad: state.mode || "Desarrollo tecnológico",
      escuela: escuelas?.[0]?.nombre || "Instancia coordinadora",
      linea_investigacion: lineas_investigacion?.[0]?.nombre || "Línea institucional",
      resumen: draftValue("08:Resumen", screenDefault("08", "Resumen")),
      horas_totales_semanales: equipoActual.reduce((total, m) => total + Number(m.horas || 0), 0),
      presupuesto_anio_1: totalA(),
      presupuesto_anio_2: totalB(),
      tiene_equipo_anio_2: tieneEquipoAnio2,
      incluye_beca_asistente: incluyeBeca,
      cantidad_objetivos: 3 + (state.extraObjective ? 1 : 0),
      cantidad_actividades: activities.length + (state.extraActivities || []).length,
      cantidad_riesgos: risks.length + (state.extraRisks || []).length,
      cantidad_productos: 3,
      declaraciones_eticas_completas: true,
    };
    // [Línea clave]: ¿Por qué soy importante? Dispara la evaluación online con Gemini al enviar la propuesta a revisión. ¿Para qué? Evaluar con IA los criterios y parámetros VIE 2027 y guardarlos en Supabase. ¿Dónde me usan? En handleAction('send-confirm') y handleAction('refresh-ai-eval').
    const res = await fetch(`${API_URL}/ia/evaluar-borrador`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      evaluacionPreliminarIA = await res.json();
    }
  } catch (err) {
    console.warn("generarEvaluacionPreliminarIA error:", err);
  }
  return evaluacionPreliminarIA;
}

/**
 * Construir la tarjeta HTML de referencia de Evaluación Preliminar con IA adaptada al nivel del evaluador.
 * Muestra el resumen ejecutivo de Gemini, calificación preliminar, fortalezas, alertas normativas y los
 * parámetros específicos que corresponden a la pantalla activa (22, 23, 24, 25, 26 o 27).
 * parametros:
 *     - string : idPantalla Identificador de la pantalla de evaluación o expediente ('22' a '27').
 * return:
 *     + string : panelHtml Marcado HTML con la evaluación preliminar de referencia.
 */
function renderizarPanelReferenciaIA(idPantalla) {
  const ia = evaluacionPreliminarIA || {
    modelo_ia: "gemini-3.5-flash",
    modo_generacion: "gemini_online",
    puntaje_preliminar: scoreResult().sum,
    recomendacion_global: scoreResult().recommended ? "Recomendada" : "Recomendada con observaciones",
    tiene_bloqueo_obligatorio: scoreResult().blocked,
    resumen_ejecutivo:
      "Evaluación preliminar generada conforme a los criterios de la Convocatoria Fondos VIE 2027 (Acuerdo CIE-237-2026). Sirve como insumo técnico no vinculante para las instancias evaluadoras.",
    referencia_vinculacion: {
      potencial_pi: "Alto potencial de protección mediante registro de software de monitoreo ambiental.",
      coherencia_trl: "TRL inicial 4 a TRL meta 6 coherente con validación en dos microcuencas piloto.",
      dictamen_sugerido: "Favorable — Emitir dictamen técnico de PI e instruir resguardo previo a publicación.",
      observacion_clave: "Verificar titularidad institucional TEC antes de divulgación externa.",
    },
    referencia_comite_tecnico: {
      puntaje_sugerido: scoreResult().sum,
      cumple_umbral_70: scoreResult().sum >= 70,
      criterios_obligatorios_conformes: !scoreResult().blocked,
      produccion_comprometida_conforme: true,
      justificacion_rubrica:
        "Diseño metodológico consistente con 4 actividades, 4 riesgos mitigados, beca estudiantil de 10 h/semana y equipamiento en Año 1.",
    },
    referencia_consejo_escuela: {
      viabilidad_horaria: `Conforme: ${totalHorasEquipo()} h/semana totales (cumple mínimo de 8 h/sem del proyecto y >= 4 h/sem por investigador).`,
      pertinencia_escuela: "Alineada con las líneas de investigación de Ingeniería Ambiental e Ingeniería Electrónica.",
      recomendacion_aval: "Otorgar Aval de Consejo de Escuela ratificando horas, presupuesto y calificación técnica.",
      verificacion_presupuestaria: "Monto de ₡9.400.000 dentro del tope anual de ₡5.000.000/año para Desarrollo Tecnológico.",
    },
    referencia_direccion_vie: {
      dictamen_sugerido: "Favorable",
      checklist_verificado: [
        { criterio: "Personal investigador al día con compromisos institucionales", cumple: true },
        { criterio: "Coherencia de riesgos identificados y medidas de mitigación", cumple: true },
        { criterio: "Inclusión obligatoria de beca para estudiante asistente especial", cumple: true },
        { criterio: "Declaraciones éticas completas y justificadas", cumple: true },
        { criterio: "Dictamen emitido por el Centro de Vinculación", cumple: true },
      ],
    },
    referencia_cie: {
      resolucion_sugerida: "Aprobada",
      borrador_acuerdo:
        "Se recomienda al CIE aprobar el proyecto SI-2027-014 con presupuesto de ₡9.400.000 al cumplir la rúbrica técnica y controles normativos VIE 2027.",
    },
    fortalezas: [
      "Trazabilidad completa entre objetivos específicos, plan de acción y matriz de riesgos.",
      "Cumplimiento de la regla presupuestaria Sección 2.3.9 (equipo únicamente en Año 1).",
      "Participación estudiantil incorporada con beca asistente especial de 10 h/semana.",
    ],
    alertas_normativas: ["Sin incumplimientos normativos bloqueantes detectados."],
  };

  let detalleNivel = "";
  if (idPantalla === "23" && ia.referencia_vinculacion) {
    const rv = ia.referencia_vinculacion;
    detalleNivel = definition([
      ["Potencial de PI", esc(rv.potencial_pi)],
      ["Madurez TRL", esc(rv.coherencia_trl)],
      ["Dictamen sugerido", esc(rv.dictamen_sugerido)],
      ["Observación clave", esc(rv.observacion_clave)],
    ]);
  } else if (idPantalla === "24" && ia.referencia_comite_tecnico) {
    const rc = ia.referencia_comite_tecnico;
    detalleNivel = `${definition([
      ["Puntaje IA sugerido", `${Number(ia.puntaje_preliminar).toFixed(1)} / 100`],
      ["Umbral >= 70", rc.cumple_umbral_70 ? "Cumple" : "No cumple"],
      ["Criterios obligatorios", rc.criterios_obligatorios_conformes ? "Todos >= 8 (Bueno/Excelente)" : "Alerta: criterio < 8"],
      ["Cuota de productos", rc.produccion_comprometida_conforme ? "Conforme (Sección 2.4.1)" : "Revisar cuota"],
    ])}<p class="small muted mt">${esc(rc.justificacion_rubrica)}</p><div class="action-row mt">${act("Aplicar puntajes IA como base", "apply-ai-scores", "secondary compact", "check")}${act("Ver desglose IA completo", "modal-ai-detail", "text compact")}</div>`;
  } else if (idPantalla === "25" && ia.referencia_consejo_escuela) {
    const re = ia.referencia_consejo_escuela;
    detalleNivel = definition([
      ["Dedicación horaria", esc(re.viabilidad_horaria)],
      ["Pertinencia", esc(re.pertinencia_escuela)],
      ["Presupuesto", esc(re.verificacion_presupuestaria)],
      ["Sugerencia IA", esc(re.recomendacion_aval)],
    ]);
  } else if (idPantalla === "26" && ia.referencia_direccion_vie) {
    const rd = ia.referencia_direccion_vie;
    const items = (rd.checklist_verificado || [])
      .map((c) => `<li><strong>${c.cumple ? "✓" : "⚠"} ${esc(c.criterio)}</strong></li>`)
      .join("");
    detalleNivel = `<p class="small mb"><strong>Dictamen sugerido a Dirección:</strong> ${esc(rd.dictamen_sugerido)}</p><ul class="small muted" style="padding-left:18px;margin:0">${items}</ul>`;
  } else if (idPantalla === "27" && ia.referencia_cie) {
    const rcie = ia.referencia_cie;
    detalleNivel = `${definition([
      ["Resolución sugerida", esc(rcie.resolucion_sugerida)],
      ["Puntaje técnico previo", `${Number(ia.puntaje_preliminar).toFixed(1)} / 100`],
    ])}<p class="small muted mt"><strong>Borrador motivado de referencia:</strong> ${esc(rcie.borrador_acuerdo)}</p>`;
  } else {
    detalleNivel = `<p class="small muted">${esc(ia.resumen_ejecutivo)}</p><div class="action-row mt">${act("Ver informe IA por nivel", "modal-ai-detail", "secondary compact")}${act("Re-evaluar con Gemini IA", "refresh-ai-eval", "text compact")}</div>`;
  }

  return card(
    "Evaluación preliminar IA (Gemini)",
    `<div class="action-row mb">${badge(ia.recomendacion_global, ia.tiene_bloqueo_obligatorio ? "" : "solid")}${badge(ia.modelo_ia || "gemini-3.5-flash")}</div><p class="micro muted mb">Referencia automática no vinculante generada al enviar la propuesta a revisión (Plan Gratuito Google AI Studio).</p>${detalleNivel}${idPantalla !== "22" && idPantalla !== "24" ? `<div class="action-row mt">${act("Ver informe IA completo", "modal-ai-detail", "text compact")}${act("Actualizar IA", "refresh-ai-eval", "text compact")}</div>` : ""}`,
  );
}

/**
 * Ejecutar la precarga paralela de todos los catálogos y métricas iniciales del sistema.
 * Lanza simultáneamente vía Promise.all las consultas de métricas, convocatorias, escuelas, modalidades e IA.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<void> : undefined Resuelve cuando todas las consultas han retornado.
 */
async function obtenerDatosBackend() {
  await Promise.all([
    numsPropuestas(), 
    propuestaMasReciente(), 
    Notificaciones(), 
    top3PropuestasMasRecientes(), 
    Modalidades(),
    obtener_escuelas(),
    obtener_lineas_investigacion(),
    obtener_convocatorias(),
    obtenerCatalogos(),
    obtenerEvaluacionPreliminarIA(currentProposalId()),
    state.role === "vinculacion" ? cargarBandejaVinculacion() : Promise.resolve(null),
  ]);
}

let bandejaPropuestas = null;
let misPropuestas = null;
let dossierActual = null;
let evaluacionVinculacion = null;
let documentosVinculacion = [];
let historialPropuestas = null;
let vinculacionCargadaId = null;
let archivosBorrador = [];

/**
 * Resolver el identificador de la propuesta que se está consultando en este momento.
 * Prioriza la selección explícita de la bandeja y recurre al borrador o propuesta creada.
 * parametros:
 *     (ninguno)
 * return:
 *     + number : idPropuesta Identificador de la propuesta activa.
 */
function propuestaActivaId() {
  return Number(state.viewProposalId) || currentProposalId();
}

/**
 * Resolver el id de una propuesta ya registrada en PostgreSQL, nunca de un borrador.
 * Permite distinguir si un documento se adjunta al borrador o se sube a un expediente existente.
 * parametros:
 *     (ninguno)
 * return:
 *     + number|null : idPropuesta Identificador real o null si solo hay borrador.
 */
function propuestaRealActiva() {
  return Number(state.viewProposalId) || Number(state.created?.id) || Number(dossierActual?.id_propuesta) || null;
}

/**
 * Limpiar los punteros a propuestas existentes al comenzar un borrador nuevo.
 * Evita que las pantallas del asistente reutilicen el dossier o los documentos de una propuesta anterior.
 * parametros:
 *     (ninguno)
 * return:
 *     + void : undefined Muta el estado y los cachés de expediente in-place.
 */
function iniciarNuevoBorrador() {
  state.created = null;
  state.viewProposalId = null;
  state.viewProposal = null;
  dossierActual = null;
  evaluacionVinculacion = null;
  documentosVinculacion = [];
  vinculacionCargadaId = null;
  archivosBorrador = [];
}

/**
 * Normalizar una propuesta del backend al formato que consumen las tablas y tarjetas del SPA.
 * parametros:
 *     - Object : p Registro retornado por /propuestas o /propuestas/bandeja.
 * return:
 *     + Object : propuesta Registro con code, title, type, period, status, amount y leader.
 */
function mapearPropuestaBackend(p = {}) {
  const id = Number(p.id_propuesta ?? p.id) || null;
  return {
    id,
    code: p.codigo || p.code || (id ? `SI-${id}` : "SI-2027-014"),
    title: p.titulo || p.title || "Propuesta sin título",
    type: p.modalidad || p.nombre_modalidad || p.type || "Desarrollo tecnológico",
    period: p.periodo || p.period || "2027–2028",
    status: p.estado || p.nombre_estado || p.status || "En formulación",
    amount: Number(p.monto_total ?? p.amount ?? 0),
    leader: p.lider_nombre || p.nombre_lider || p.leader || "Investigador",
    school: p.escuela || p.nombre_escuela || p.school || "TEC",
    line: p.linea_investigacion || p.nombre_linea || p.line || "",
  };
}

/**
 * Extraer el mensaje de error devuelto por FastAPI sin perder el detalle de validación.
 * parametros:
 *     - Response : res Respuesta HTTP fallida.
 * return:
 *     + Promise<string> : mensaje Texto legible para el usuario.
 */
async function errorDesdeRespuesta(res) {
  try {
    const data = await res.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg).join(" ");
    if (typeof data.error === "string") return data.error;
  } catch {}
  return `El servidor respondió con código ${res.status}.`;
}

/**
 * Descargar las propuestas del investigador autenticado desde PostgreSQL (Pantalla 06).
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : misPropuestas Propuestas del usuario normalizadas.
 */
async function cargarMisPropuestas() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(`${API_URL}/propuestas?id_usuario=${idUsuario}`);
    if (res.ok) {
      misPropuestas = (await res.json()).map(mapearPropuestaBackend);
    } else {
      misPropuestas = [];
    }
  } catch (err) {
    console.warn("cargarMisPropuestas error:", err);
    misPropuestas = [];
  }
  return misPropuestas;
}

/**
 * Descargar la bandeja de Vinculación desde PostgreSQL y conservar la propuesta activa.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : bandejaPropuestas Propuestas pendientes o dictaminadas.
 */
async function cargarBandejaVinculacion() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(
      `${API_URL}/propuestas/bandeja?rol=${encodeURIComponent("Vinculación")}&id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      const data = await res.json();
      bandejaPropuestas = data.map(mapearPropuestaBackend);
      if (!state.viewProposalId && bandejaPropuestas.length) {
        state.viewProposalId = bandejaPropuestas[0].id;
        state.viewProposal = bandejaPropuestas[0].code;
      }
    } else {
      bandejaPropuestas = [];
    }
  } catch (err) {
    console.warn("cargarBandejaVinculacion error:", err);
    bandejaPropuestas = [];
  }
  return bandejaPropuestas;
}

/**
 * Descargar el expediente completo de una propuesta y almacenarlo para las pantallas 22, 23 y 28.
 * parametros:
 *     - number : idPropuesta Identificador del expediente; por defecto usa la propuesta activa.
 * return:
 *     + Promise<Object|null> : dossierActual Expediente consolidado con documentos e historial.
 */
async function cargarDossier(idPropuesta = propuestaActivaId()) {
  if (!idPropuesta) return null;
  try {
    const res = await fetch(`${API_URL}/propuestas/${idPropuesta}`);
    if (res.ok) {
      dossierActual = await res.json();
      state.viewProposalId = Number(dossierActual.id_propuesta) || idPropuesta;
      state.viewProposal = dossierActual.codigo || state.viewProposal;
    } else {
      dossierActual = null;
    }
  } catch (err) {
    console.warn("cargarDossier error:", err);
    dossierActual = null;
  }
  return dossierActual;
}

/**
 * Descargar el dictamen de Vinculación y los documentos firmados de una propuesta.
 * parametros:
 *     - number : idPropuesta Identificador del expediente; por defecto usa la propuesta activa.
 * return:
 *     + Promise<Object|null> : evaluacionVinculacion Último dictamen registrado.
 */
async function cargarVinculacion(idPropuesta = propuestaActivaId()) {
  const idUsuario = session?.user?.id_usuario;
  if (!idPropuesta || !idUsuario) return null;
  if (vinculacionCargadaId !== Number(idPropuesta)) {
    Object.keys(state.saved)
      .filter((clave) => clave.startsWith("vinculacion:"))
      .forEach((clave) => delete state.saved[clave]);
    vinculacionCargadaId = Number(idPropuesta);
  }
  try {
    const res = await fetch(
      `${API_URL}/propuestas/${idPropuesta}/vinculacion?id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      const data = await res.json();
      evaluacionVinculacion = data.evaluacion || null;
      documentosVinculacion = data.documentos || [];
    } else {
      evaluacionVinculacion = null;
      documentosVinculacion = [];
    }
  } catch (err) {
    console.warn("cargarVinculacion error:", err);
    evaluacionVinculacion = null;
    documentosVinculacion = [];
  }
  return evaluacionVinculacion;
}

/**
 * Registrar el dictamen de Vinculación y devolver el nuevo estado de la propuesta.
 * parametros:
 *     - number : idPropuesta Identificador de la propuesta.
 *     - Object : payload Datos del dictamen, incluida la decisión y el documento firmado.
 * return:
 *     + Promise<Object> : resultado Respuesta del backend con estado y evaluación creada.
 */
async function guardarVinculacion(idPropuesta, payload) {
  const res = await fetch(`${API_URL}/propuestas/${idPropuesta}/vinculacion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

/**
 * Construir el payload del dictamen de Vinculación desde el formulario de la pantalla 23.
 * parametros:
 *     - string : decision Resultado favorable, observaciones o rechazo.
 *     - string : observaciones Detalle de la devolución o justificación.
 *     - number|null : idDocumento Documento firmado ya subido a Storage.
 * return:
 *     + Object : payload Cuerpo JSON esperado por POST /propuestas/{id}/vinculacion.
 */
function payloadVinculacion(decision = "favorable", observaciones = "", idDocumento = null) {
  return {
    id_usuario_eval: session?.user?.id_usuario,
    numero_oficio_dictamen: state.saved["vinculacion:oficio"] || "CV-014-2026",
    potencial_pi_identificado: (state.saved["vinculacion:potencial_pi"] ?? "true") === "true",
    tipo_innovacion: state.saved["vinculacion:tipo_innovacion"] || null,
    activo_previsto: state.saved["vinculacion:activo_previsto"] || null,
    valoracion_tecnica:
      state.saved["vinculacion:valoracion"] ||
      "Valoración técnica registrada por el Centro de Vinculación.",
    requiere_reserva: !!state.saved["vinculacion:reserva"],
    observaciones: observaciones || "Dictamen registrado por Vinculación.",
    decision,
    id_documento: idDocumento,
  };
}

/**
 * Subir el oficio firmado de Vinculación a Supabase Storage.
 * parametros:
 *     - number : idPropuesta Identificador de la propuesta.
 *     - File : archivo Archivo seleccionado en el formulario.
 *     - string : tipoDocumento Clasificación documental del adjunto.
 * return:
 *     + Promise<Object> : documento Metadatos del documento registrado.
 */
async function subirDocumentoPropuesta(idPropuesta, archivo, tipoDocumento = "Dictamen de Vinculación") {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) throw new Error("No hay un usuario autenticado para adjuntar el documento.");
  if (!archivo) throw new Error("Selecciona el oficio firmado.");
  const form = new FormData();
  form.append("archivo", archivo);
  form.append("id_usuario", String(idUsuario));
  form.append("tipo_documento", tipoDocumento);
  form.append("version", "1.0");
  const res = await fetch(`${API_URL}/propuestas/${idPropuesta}/documentos`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

/**
 * Leer los filtros de la pantalla 29 desde el estado persistido del formulario.
 * parametros:
 *     (ninguno)
 * return:
 *     + Object : filtros Parámetros listos para GET /propuestas.
 */
function filtrosHistorial() {
  const numero = (valor) => {
    if (valor === undefined || valor === null || valor === "") return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  };
  return {
    q: state.saved["history:query"] || "",
    id_escuela: numero(state.saved["history:school"]),
    id_modalidad: numero(state.saved["history:mode"]),
    id_estado: numero(state.saved["history:status"]),
    id_linea: numero(state.saved["history:line"]),
    anio_desde: numero(state.saved["history:from"]),
    anio_hasta: numero(state.saved["history:to"]),
    solo_cerradas: !!state.saved["history:closed"],
  };
}

/**
 * Buscar propuestas con filtros institucionales y guardar el resultado para la pantalla 30.
 * parametros:
 *     - Object : filtros Criterios de búsqueda; por defecto usa los de la pantalla 29.
 * return:
 *     + Promise<Array<Object>|null> : historialPropuestas Resultados normalizados.
 */
async function buscarPropuestas(filtros = filtrosHistorial()) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([clave, valor]) => {
    if (valor === null || valor === undefined || valor === "" || valor === false) return;
    params.set(clave, String(valor));
  });
  try {
    const res = await fetch(`${API_URL}/propuestas?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      historialPropuestas = data.map(mapearPropuestaBackend);
    } else {
      historialPropuestas = [];
    }
  } catch (err) {
    console.warn("buscarPropuestas error:", err);
    historialPropuestas = [];
  }
  return historialPropuestas;
}

/**
 * Helper selector simplificado de elemento individual en el DOM (equivalente a querySelector).
 * Invoca querySelector sobre la raíz especificada (por defecto document).
 * parametros:
 *     - string : s Selector CSS a evaluar.
 *     - Element|Document : r Nodo raíz de búsqueda.
 * return:
 *     + Element|null : elemento Nodo del DOM coincidente o null si no existe.
 */
const $ = (s, r = document) => r.querySelector(s),
  /**
   * Helper selector de múltiples elementos en el DOM como un arreglo nativo de JavaScript.
   * Invoca querySelectorAll y desestructura los resultados dentro de un nuevo Array.
   * parametros:
   *     - string : s Selector CSS a consultar.
   *     - Element|Document : r Nodo raíz de búsqueda.
   * return:
   *     + Array<Element> : elementos Arreglo nativo con los elementos encontrados.
   */
  $$ = (s, r = document) => [...r.querySelectorAll(s)];

/**
 * Escapar caracteres HTML especiales para mitigar vulnerabilidades de inyección de código (XSS).
 * Reemplaza los caracteres ampersand, comillas y signos menor/mayor por sus entidades HTML correspondientes.
 * parametros:
 *     - any : s Valor o cadena a sanear.
 * return:
 *     + string : saneado Cadena de texto sanitizada segura para interpolación en HTML.
 */
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

/**
 * Formatear montos numéricos a moneda oficial costarricense (Colones ₡) sin decimales.
 * Concatena el prefijo ₡ con el valor numérico localizado en es-CR con maximumFractionDigits: 0.
 * parametros:
 *     - number|string : n Cantidad numérica a formatear.
 * return:
 *     + string : monedaFormateada Representación en colones (ej. '₡1.400.000').
 */
const money = (n) =>
  "₡" + Number(n).toLocaleString("es-CR", { maximumFractionDigits: 0 });

/**
 * Diccionario de rutas SVG vectoriales utilizadas como iconos en toda la aplicación.
 * Mapea nombres de iconos a las coordenadas del atributo 'd' de un elemento <path>.
 * Se consume en la función icon(name) para generar el marcado SVG embebido.
 * atributos:
 *     * string : home Coordenadas de icono de inicio.
 *     * string : folder Coordenadas de carpeta.
 *     * string : calendar Coordenadas de calendario.
 *     * string : inbox Coordenadas de bandeja de entrada.
 *     * string : search Coordenadas de lupa de búsqueda.
 *     * string : bell Coordenadas de campana de notificaciones.
 *     * string : user Coordenadas de usuario/perfil.
 *     * string : check Coordenadas de check/confirmación.
 *     * string : file Coordenadas de documento genérico.
 */
const paths = {
  home: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  folder: "M3 6h6l2 2h10v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z",
  calendar: "M4 5h16v16H4ZM8 3v4m8-4v4M4 10h16",
  inbox: "M4 4h16v16H4Zm0 10h5l2 3h2l2-3h5",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  bell: "M18 8a6 6 0 0 0-12 0v6l-2 3h16l-2-3Zm-8 12h4",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-2a8 8 0 0 1 16 0v2",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  back: "M20 12H4m6-6-6 6 6 6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  file: "M5 2h9l5 5v15H5Zm9 0v6h5M8 12h8m-8 4h8",
  upload: "M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6",
  info: "M12 11v6m0-10v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  alert: "M12 3 2 21h20Zm0 6v5m0 3v1",
  close: "m6 6 12 12M6 18 18 6",
  logout: "M9 3H3v18h6m5-15 6 6-6 6m-7-6h13",
  download: "M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4",
  edit: "m15 3 6 6-12 12H3v-6Zm-10 10 6 6",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Zm-5 10 3 3 7-7",
};

/**
 * Construir el elemento HTML <svg> correspondiente al nombre de icono solicitado.
 * Consulta paths[name] y genera un SVG con viewBox '0 0 24 24'. Si no existe, usa el icono de archivo por defecto.
 * parametros:
 *     - string : name Nombre del icono requerido.
 * return:
 *     + string : svgMarkup Marcado HTML del icono vectorial.
 */
const icon = (name) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name] || paths.file}"/></svg>`;

/**
 * Diccionario de configuración de roles institucionales con sus datos demostrativos por defecto.
 * Mapea la clave interna de rol con su etiqueta oficial, nombre por defecto, iniciales y pantalla de inicio.
 * En el selector de roles de demostración y al calcular el menú y permisos en shell() y person().
 * atributos:
 *     * Object : investigador Configuración para Investigador proponente.
 *     * Object : vinculacion Configuración para Centro de Vinculación.
 *     * Object : comite Configuración para Comité Técnico.
 *     * Object : consejo Configuración para Consejo de Escuela.
 *     * Object : direccion Configuración para Dirección de Investigación.
 *     * Object : cie Configuración para Consejo de Investigación y Extensión.
 */
const roles = {
  investigador: {
    label: "Investigador proponente",
    name: "Laura Méndez",
    initials: "LM",
    screen: "02",
  },
  vinculacion: {
    label: "Centro de Vinculación",
    name: "Mariana Solís",
    initials: "MS",
    screen: "23",
  },
  comite: {
    label: "Comité Técnico",
    name: "Gabriel Sánchez",
    initials: "GS",
    screen: "24",
  },
  consejo: {
    label: "Consejo de Escuela",
    name: "Patricia Vargas",
    initials: "PV",
    screen: "25",
  },
  direccion: {
    label: "Dirección de Investigación",
    name: "Elena Chacón",
    initials: "EC",
    screen: "26",
  },
  cie: { label: "CIE", name: "Ricardo Mora", initials: "RM", screen: "27" },
};

/**
 * Estado por defecto de la aplicación frontend con valores iniciales de presupuesto y navegación.
 * Inicializa el rol activo, tema claro/oscuro, rúbricas, estado de formularios y partidas de presupuesto.
 * Como prototipo de clonación para estructurar el objeto global state.
 * atributos:
 *     * string : role Rol institucional activo.
 *     * string : stage Etapa actual de la propuesta en demostración.
 *     * string : theme Tema visual ('light' o 'dark').
 *     * Array<Object> : budget Partidas presupuestarias iniciales.
 */
const defaultState = {
  role: "investigador",
  stage: "En formulación",
  read: false,
  mode: "Desarrollo tecnológico",
  modeId: 3,
  clientUuid: null,
  convocatoriaId: null,
  externalCollaborator: null,
  viewProposalId: null,
  created: null,
  theme: "light",
  largeText: false,
  roleOrder: [
    "investigador",
    "vinculacion",
    "comite",
    "consejo",
    "direccion",
    "cie",
  ],
  saved: {},
  teamAdded: false,
  reviewed: false,
  budget: [
    {
      name: "Equipo de laboratorio",
      code: "5-01-06-01",
      a: 1400000,
      b: 0,
      detail:
        "Sensores y equipo de calibración; compra en primer semestre de 2027.",
    },
    {
      name: "Materiales y suministros",
      code: "2-03-04-01",
      a: 1000000,
      b: 1600000,
      detail: "Componentes eléctricos y consumibles para integración y campo.",
    },
    {
      name: "Servicios de laboratorio",
      code: "1-04-01-01",
      a: 1440000,
      b: 2040000,
      detail: "Análisis de referencia y verificación de mediciones.",
    },
    {
      name: "Beca estudiante asistente especial",
      code: "6-02-02-08",
      a: 960000,
      b: 960000,
      detail:
        "400 horas/año × ₡2.400. Planificación: 10 h/semana durante 40 semanas, hasta 10 meses.",
    },
  ],
  scores: {},
  notRecommended: false,
  search: "",
  historyStatus: "Todos",
  resolution: "Aprobada",
};

// [Línea clave]: ¿Por qué soy importante? Es el almacén de estado reactivo global en el frontend. ¿Para qué? Mantener sincronizados formularios, tema, rol y progreso entre pantallas. ¿Dónde me usan? Leído y mutado en toda la aplicación.
let state = structuredClone(defaultState);
try {
  state = {
    ...state,
    ...JSON.parse(localStorage.getItem("sgpi-demo") || "{}"),
  };
} catch {}
// Versiones anteriores guardaban lo escrito en el login (incluida la contraseña) en localStorage: se descarta.
if (state.saved) {
  delete state.saved["login:email"];
  delete state.saved["login:password"];
}
let current = "01",
  modalName = null,
  previousFocus = null,
  activeFilter = "Todas",
  dossierTab = "Resumen",
  userMenuOpen = false;

/**
 * Guardar el estado interactivo actual en el localStorage del navegador.
 * Serializa la variable global state bajo la clave 'sgpi-demo'.
 * parametros:
 *     (ninguno)
 * return:
 *     + void : undefined No retorna valor.
 */
const save = () => localStorage.setItem("sgpi-demo", JSON.stringify(state));

/**
 * Obtener la definición de metadatos de una pantalla a partir de su identificador.
 * Busca en el arreglo SGPI_CONTENT.screens el objeto cuyo atributo id coincida.
 * parametros:
 *     - string : id Identificador de pantalla de dos caracteres (ej. '08').
 * return:
 *     + Object|undefined : screen Objeto de configuración de pantalla.
 */
const screen = (id) => SGPI_CONTENT.screens.find((s) => s.id === id);

/**
 * Determinar la información de la persona y rol a mostrar en el encabezado de perfil.
 * Si hay sesión real activa y su rol coincide con state.role, usa el nombre del usuario real; de lo contrario usa el rol ficticio de demo.
 * parametros:
 *     (ninguno)
 * return:
 *     + Object : persona Objeto con label, name, e initials.
 */
const person = () => {
  const r = roles[state.role];
  return session && session.user.roles.some((n) => ROLE_KEYS[n] === state.role)
    ? {
        ...r,
        name: session.user.nombre,
        initials: initials(session.user.nombre),
      }
    : r;
};

/**
 * Obtener el identificador de pantalla de inicio asignado al rol activo.
 * Retorna '02' para investigador y '21' (Bandeja de trabajo) para roles evaluadores.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : pantallaInicio Identificador de la pantalla de inicio correspondiente.
 */
const homeFor = () => (state.role === "investigador" ? "02" : "21");

/**
 * Cambiar el rol institucional activo en la demostración y sincronizar la etapa de la propuesta.
 * Asigna state.role con la nueva clave, fija el expediente SI-2027-014 y actualiza la etapa según el rol.
 * parametros:
 *     - string : key Clave del rol a activar ('investigador', 'vinculacion', etc.).
 * return:
 *     + void : undefined Muta el estado in-place.
 */
function applyRole(key) {
  const rolAnterior = state.role;
  state.role = key;
  if (key === "vinculacion" && rolAnterior !== "vinculacion") state.viewProposalId = null;
  state.viewProposal = state.created?.code || "SI-2027-014";
  state.stage = {
    investigador: state.stage,
    vinculacion: "En revisión de Vinculación",
    comite: "En evaluación técnica",
    consejo: "En evaluación técnica",
    direccion: "Sometida",
    cie: "Dictaminada",
  }[key];
}

/**
 * Calcular la suma del presupuesto para el Año 1 (Columna A).
 * Aplica reduce sobre state.budget sumando los valores numéricos del atributo 'a'.
 * parametros:
 *     (ninguno)
 * return:
 *     + number : totalA Suma del presupuesto del Año 1 en colones.
 */
const totalA = () => state.budget.reduce((a, r) => a + Number(r.a), 0),
  /**
   * Calcular la suma del presupuesto para el Año 2 (Columna B).
   * Aplica reduce sobre state.budget sumando los valores numéricos del atributo 'b'.
   * parametros:
   *     (ninguno)
   * return:
   *     + number : totalB Suma del presupuesto del Año 2 en colones.
   */
  totalB = () => state.budget.reduce((a, r) => a + Number(r.b), 0);

/**
 * Validar el cumplimiento de las restricciones presupuestarias oficiales de la convocatoria VIE.
 * Comprueba que el total por año sea <= ₡5.000.000, equipo en año 2 sea 0, y becas cumplan mínimo de ₡960.000.
 * parametros:
 *     (ninguno)
 * return:
 *     + boolean : esValido Verdadero si cumple todas las reglas financieras.
 */
const budgetValid = () =>
  totalA() <= 5000000 &&
  totalB() <= 5000000 &&
  state.budget[0].b === 0 &&
  state.budget[3].a >= 960000 &&
  state.budget[3].b >= 960000;
/**
 * Diccionario de textos de ayuda contextual (tooltips) para acciones y opciones principales de navegación.
 * Asocia etiquetas de botones y enlaces con su descripción funcional accesible.
 * Se consume en tooltipAttrs(), btn(), act() y navItem() para poblar atributos title y data-tooltip.
 * atributos:
 *     * string : Inicio Ayuda para opción de inicio.
 *     * string : "Mis propuestas" Ayuda para listado de propuestas del investigador.
 *     * string : "Bandeja de trabajo" Ayuda para expedientes asignados a roles de evaluación.
 *     * string : Convocatorias Ayuda para catálogo de convocatorias.
 */
const optionHelp = {
  Inicio: "Resumen y tareas pendientes.",
  "Mis propuestas": "Consulta o continúa tus propuestas.",
  "Bandeja de trabajo": "Expedientes asignados a tu rol.",
  Convocatorias: "Fechas, requisitos e instrumentos vigentes.",
  "Consulta histórica": "Busca expedientes y su trazabilidad.",
  "Mi perfil": "Cuenta, rol activo y preferencias.",
  "Cerrar sesión": "Cierra tu sesión en el sistema.",
  "Nueva propuesta": "Crea un borrador para la convocatoria vigente.",
  "Abrir expediente": "Consulta información, documentos y decisiones.",
  "Guardar borrador": "Conserva los cambios en este navegador.",
  "Guardar y continuar": "Valida la sección y avanza al siguiente paso.",
};

/**
 * Generar la cadena de atributos HTML para desplegar tooltips accesibles en elementos interactivos.
 * Verifica si la etiqueta existe en optionHelp y genera 'class="has-tooltip" data-tooltip="..." title="..."'.
 * parametros:
 *     - string : label Texto o etiqueta del control interactivo.
 * return:
 *     + string : attrs Cadena con atributos HTML o vacía si no aplica tooltip.
 */
const tooltipAttrs = (label) =>
  optionHelp[label]
    ? `class="has-tooltip" data-tooltip="${esc(optionHelp[label])}" title="${esc(optionHelp[label])}"`
    : "";

/**
 * Construir el marcado HTML estándar de un botón con enlace de navegación cliente (data-go).
 * Retorna un elemento <button> con clases, destino de navegación, icono SVG y atributos contextuales.
 * parametros:
 *     - string : label Texto visible del botón.
 *     - string|null : target Identificador de pantalla a la que navegar (data-go).
 *     - string : style Clases CSS adicionales (ej. 'text', 'compact', 'secondary').
 *     - string : ic Nombre del icono a renderizar al lado del texto.
 *     - string : attrs Atributos HTML adicionales para el elemento.
 * return:
 *     + string : btnHtml Marcado HTML estructurado del botón.
 */
const btn = (label, target, style = "", ic = "", attrs = "") =>
  `<button class="btn ${style} ${optionHelp[label] ? "has-tooltip" : ""}" ${target ? `data-go="${target}"` : ""} ${optionHelp[label] ? `data-tooltip="${esc(optionHelp[label])}" title="${esc(optionHelp[label])}"` : ""} ${attrs}>${ic ? icon(ic) : ""}${esc(label)}</button>`;

/**
 * Construir el marcado HTML estándar de un botón de acción interactiva (data-action).
 * Invoca el helper btn() asociando un atributo data-action que será despachado por handleAction().
 * parametros:
 *     - string : label Texto visible de la acción.
 *     - string : action Nombre clave del comando o evento (ej. 'save', 'upload', 'roles').
 *     - string : style Clases CSS de estilizado.
 *     - string : ic Nombre del icono a incrustar.
 *     - string : attrs Atributos complementarios.
 * return:
 *     + string : actHtml Botón con data-action generado.
 */
const act = (label, action, style = "", ic = "", attrs = "") =>
  btn(label, null, style, ic, `data-action="${action}" ${attrs}`);

/**
 * Generar un badge indicador o pastilla de estado con punto de color.
 * Retorna un <span> con clase .badge, un punto interno .dot y el texto provisto saneado.
 * parametros:
 *     - string : text Texto de estado a mostrar (ej. 'Borrador', 'Aprobada').
 *     - string : type Modificador CSS opcional de color (ej. 'success', 'warning', 'danger').
 * return:
 *     + string : badgeHtml Marcado del componente visual badge.
 */
const badge = (text, type = "") =>
  `<span class="badge ${type}"><span class="dot"></span>${esc(text)}</span>`;

/**
 * Generar un bloque de aviso contextual informativo o de advertencia (.notice).
 * Construye una tarjeta con icono de alerta o información, título en negrita y párrafo descriptivo.
 * parametros:
 *     - string : title Encabezado del aviso.
 *     - string : body Texto detallado del aviso.
 *     - string : type Variante visual ('info' o 'warning').
 * return:
 *     + string : noticeHtml Marcado HTML de la caja de aviso.
 */
const notice = (title, body, type = "") =>
  `<div class="notice ${type}">${icon(type === "warning" ? "alert" : "info")}<div><strong>${esc(title)}</strong><p>${esc(body)}</p></div></div>`;

/**
 * Construir una tarjeta visual contenedora (.card) con encabezado y acciones opcionales.
 * Envuelve el contenido en un <section class="card card-pad"> con título y botones si aplican.
 * parametros:
 *     - string : title Título de la sección de la tarjeta.
 *     - string : body Contenido interno en HTML de la tarjeta.
 *     - string : action Botones o controles para el encabezado superior derecho.
 * return:
 *     + string : cardHtml Marcado de la tarjeta contenedora.
 */
const card = (title, body, action = "") =>
  `<section class="card card-pad">${title ? `<div class="section-head"><h2>${title}</h2>${action}</div>` : ""}${body}</section>`;

/**
 * Renderizar una tabla HTML accesible a partir de matrices de encabezados y celdas.
 * Genera el contenedor responsive .table-wrap con thead, tbody, filas tr/td y pie opcional.
 * parametros:
 *     - Array<string> : heads Lista de títulos para las columnas en th.
 *     - Array<Array<string>> : rows Matriz bidimensional de celdas para cada fila.
 *     - string : footer Contenido opcional para el pie de la tabla.
 * return:
 *     + string : tableHtml Marcado HTML de la tabla estructurada.
 */
const table = (heads, rows, footer = "") =>
  `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${footer ? `<div class="table-foot">${footer}</div>` : ""}`;

/**
 * Construir una lista de definición accesible (<dl>) para desplegar pares clave-valor de metadatos.
 * Mapea pares [término, descripción] a elementos <dt> y <dd> estructurados.
 * parametros:
 *     - Array<[string, string]> : items Colección de tuplas [etiqueta, valor].
 * return:
 *     + string : defHtml Marcado HTML de la lista de definiciones.
 */
const definition = (items) =>
  `<dl class="definition">${items.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${b}</dd></div>`).join("")}</dl>`;

/**
 * Renderizar una barra de pestañas (tabs) de navegación o filtrado horizontal.
 * Mapea una lista de nombres de pestañas marcando la activa según el valor seleccionado.
 * parametros:
 *     - Array<string> : items Lista de nombres de pestañas.
 *     - string : selected Nombre de la pestaña actualmente activa.
 *     - string : attr Atributo HTML para almacenar el valor ('data-tab' o 'data-filter').
 * return:
 *     + string : tabsHtml Marcado HTML del contenedor de pestañas.
 */
const tabs = (items, selected, attr = "data-tab") =>
  `<div class="tabs">${items.map((t) => `<button class="tab ${t === selected ? "active" : ""}" ${attr}="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;

/**
 * Construir un control de campo de formulario individual con label, input accesible y validación.
 * Evalúa el tipo de campo ('text', 'textarea', 'select', 'checkbox', 'file', 'date', 'password'),
 * resuelve el valor guardado en state.saved si existe, e incrusta el mensaje de error de validación.
 * parametros:
 *     - string : label Etiqueta descriptiva del campo.
 *     - any : value Valor por defecto o arreglo de opciones para selects.
 *     - string : kind Tipo de control ('text', 'textarea', 'select', 'checkbox', 'file', 'date', etc.).
 *     - string : help Texto explicativo inferior de ayuda.
 *     - boolean : required Si el campo es de llenado obligatorio.
 *     - string : key Llave única de almacenamiento en state.saved (opcional).
 * return:
 *     + string : fieldHtml Marcado del control de formulario con contenedor .field.
 */
function field(
  label,
  value = "",
  kind = "text",
  help = "",
  required = false,
  key = "",
) {
  // [Línea clave]: ¿Por qué soy importante? Genera una clave persistente única para el campo. ¿Para qué? Recuperar y almacenar borradores parciales en state.saved. ¿Dónde me usan? En el binding de valores de todos los formularios.
  const k = key || `${current}:${label}`,
    opts =
      kind === "select"
        ? (Array.isArray(value) ? value : [value]).map((v) =>
            v && typeof v === "object"
              ? { value: String(v.value), label: String(v.label ?? v.value) }
              : { value: String(v), label: String(v) },
          )
        : [],
    val = state.saved[k] ?? (kind === "select" ? opts[0]?.value ?? "" : value),
    id = "f-" + k.replace(/[^\w]/g, "-"),
    req = required ? "required" : "",
    attr = `id="${id}" data-field="${esc(k)}" ${req}`;
  let control;
  if (kind === "textarea")
    control = `<textarea ${attr} rows="3">${esc(val)}</textarea>`;
  else if (kind === "select") {
    control = `<select ${attr}>${opts.map((o) => `<option value="${esc(o.value)}" ${o.value === String(val) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  } else if (kind === "checkbox")
    return `<label class="checkline"><input type="checkbox" ${attr} ${val === true ? "checked" : ""}>${esc(label)}</label>`;
  else if (kind === "file")
    control = `<div class="doc-row"><span class="doc-icon">PDF</span><div class="grow"><strong>${esc(val)}</strong></div>${act("Adjuntar", "upload", "secondary compact", "upload")}</div>`;
  else
    control = `<input ${attr} type="${["email", "number", "password", "date", "search"].includes(kind) ? kind : "text"}" value="${esc(val)}" ${kind === "readonly" ? "readonly" : ""}>`;
  return `<div class="field"><label for="${id}">${esc(label)}${required ? ' <span class="required-star">*</span>' : ""}</label>${control}${help ? `<span class="help">${esc(help)}</span>` : ""}<span class="error-msg" hidden>Completa este campo para continuar.</span></div>`;
}

/**
 * Generar todos los campos de formulario definidos en el catálogo de metadatos de una pantalla.
 * Consulta screen(id).fields e invoca field() secuencialmente para cada descriptor de campo.
 * parametros:
 *     - string : id Identificador de pantalla a procesar.
 * return:
 *     + string : fieldsHtml Concatenación de todos los campos renderizados.
 */
function fieldsFor(id) {
  return (screen(id).fields || [])
    .map((f) =>
      field(
        f.label,
        f.value,
        f.kind === "date"
          ? "text"
          : f.kind === "radio"
            ? "select"
            : f.kind === "tags"
              ? "text"
              : f.kind,
        f.help || "",
        f.required,
      ),
    )
    .join("");
}

/**
 * Renderizar un documento esperado que aún no tiene archivo real asociado.
 * Reemplaza las filas decorativas quemadas por un marcador visible de "Pendiente".
 * parametros:
 *     - string : titulo Nombre del documento esperado.
 *     - string : nota Contexto de cuándo se adjunta.
 * return:
 *     + string : placeholderHtml Fila visual sin enlace de descarga.
 */
function docPendiente(titulo, nota = "Pendiente de adjuntar") {
  return `<div class="doc-row"><span class="doc-icon">—</span><div class="grow"><strong>${esc(titulo)}</strong><small>${esc(nota)}</small></div>${badge("Pendiente")}</div>`;
}

/**
 * Renderizar un documento real con su tipo, versión, tamaño y URL pública de descarga.
 * parametros:
 *     - Object : d Documento retornado por el dossier o por Vinculación.
 * return:
 *     + string : documentoHtml Fila visual con enlace al archivo en Storage.
 */
function docPropuesta(d = {}) {
  const nombre = d.nombre_archivo || "Documento de la propuesta";
  const meta = [d.tipo_documento, d.version ? `Versión ${d.version}` : "", formatBytes(d.tamano_bytes)].filter(Boolean).join(" · ");
  const icono = /xlsx/i.test(nombre) ? "XLSX" : /docx/i.test(nombre) ? "DOCX" : "PDF";
  const enlace = d.file_url
    ? `<a class="btn text compact" href="${esc(d.file_url)}" target="_blank" rel="noopener">${icon("file")}Ver</a>`
    : act("Ver", "preview", "text compact", "file", `data-doc="${esc(nombre)}"`);
  return `<div class="doc-row"><span class="doc-icon">${icono}</span><div class="grow"><strong>${esc(nombre)}</strong><small>${esc(meta)}</small></div>${enlace}</div>`;
}

/** Formatear bytes a texto legible (KB / MB). */
function formatBytes(b) {
  if (!b) return "";
  return b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

/**
 * Fila de documento proveniente de la base de datos con enlace real a Storage.
 * Usa la extensión real (PDF / DOCX / XLSX) en la insignia.
 */
function docRemoto(d) {
  const ext = String(d.extension || "pdf").replace(".", "").toUpperCase();
  const meta = [`Versión ${d.version ?? "1.0"}`, formatBytes(d.tamano_bytes)]
    .filter(Boolean)
    .join(" · ");
  return `<div class="doc-row"><span class="doc-icon">${esc(ext)}</span><div class="grow"><strong>${esc(d.nombre_documento)}</strong><small>${esc(meta)}</small></div>${act("Ver", "preview-remote", "text compact", "file", `data-doc-id="${d.id_documento_conv}"`)}</div>`;
}

/** Lista de instrumentos de la convocatoria con estados de carga y vacío. */
function instrumentosConvocatoria() {
  if (documentosConvocatoria === null)
    return `<p class="small muted">Cargando instrumentos…</p>`;
  if (!documentosConvocatoria.length)
    return `<p class="small muted">Esta convocatoria aún no tiene instrumentos publicados.</p>`;
  return documentosConvocatoria.map(docRemoto).join("");
}

/** Contenido del visor según el tipo de archivo. */
function visorHtml(d) {
  const url = d.file_url;
  const ext = String(d.extension || "").toLowerCase().replace(".", "");
  const frame =
    "width:100%;height:70vh;border:0;border-radius:8px;background:#f4f4f4";

  // PDF: lo muestra el visor nativo del navegador
  if (ext === "pdf")
    return `<iframe title="${esc(d.nombre_documento)}" src="${esc(url)}#toolbar=1" style="${frame}"></iframe>`;

  // Word / Excel / PowerPoint: visor embebido de Office Online (requiere URL pública)
  if (["docx", "xlsx", "pptx"].includes(ext))
    return `<iframe title="${esc(d.nombre_documento)}" src="https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}" style="${frame}"></iframe>`;

  // Cualquier otro formato: sin vista previa
  return `<div class="notice">${icon("file")}<div><strong>Sin vista previa</strong><p>Este formato no se puede mostrar aquí. Usa «Descargar».</p></div></div>`;
}

/**
 * Formatear una colección de propuestas para renderizarlas como filas de tabla institucional.
 * Transforma cada propuesta en una tupla con código, título, periodo, badge de estado, monto y botón de acción.
 * parametros:
 *     - Array<Object> : list Lista de propuestas a mostrar (por defecto top3propuestasmasrecientes).
 * return:
 *     + Array<Array<string>> : rows Matriz de celdas apta para el helper table().
 */
function projectRows(list = (top3propuestasmasrecientes ?? [])) {
  return list.map((p, i) => [
    `<span class="project-code">${esc(p.code)}</span><span class="project-name">${esc(p.title)}</span><span class="small muted">${esc(p.type)}</span>`,
    p.period,
    badge(p.code === "SI-2027-014" ? state.stage : p.status),
    money(p.amount),
    btn(
      p.code === "SI-2027-014" &&
        state.stage === "En formulación" &&
        current === "06"
        ? "Continuar"
        : "Ver expediente",
      p.code === "SI-2027-014" &&
        state.stage === "En formulación" &&
        current === "06"
        ? "08"
        : "22",
      "text compact",
      "arrow",
      `data-proposal="${p.code}" data-proposal-id="${p.id || ""}"`,
    ),
  ]);
}

/**
 * Generar un botón de elemento de navegación para la barra lateral del menú principal.
 * Retorna un botón .nav-item con clase .active si coincide con la pantalla actual e icono SVG.
 * parametros:
 *     - string : label Texto visible del enlace del menú.
 *     - string : id Pantalla de destino (data-go).
 *     - string : ic Nombre del icono SVG.
 *     - boolean : active Si el ítem está actualmente seleccionado.
 * return:
 *     + string : navItemHtml Botón de navegación formateado.
 */
function navItem(label, id, ic, active) {
  return `<button class="nav-item ${active ? "active" : ""} ${optionHelp[label] ? "has-tooltip" : ""}" data-go="${id}" ${optionHelp[label] ? `data-tooltip="${esc(optionHelp[label])}" title="${esc(optionHelp[label])}"` : ""}>${icon(ic)}${label}</button>`;
}

/**
 * Proveer el marco estructural maestro (Layout Shell) de la aplicación completa.
 * Genera el contenedor principal con sidebar de navegación institucional según el rol,
 * barra superior con notificaciones y menú de usuario, área principal de contenido y botón flotante de soporte.
 * parametros:
 *     - string : body Contenido específico de la pantalla a desplegar.
 *     - string : title Título principal de la vista en h1.
 *     - string : description Subtítulo o texto descriptivo superior.
 *     - string : headingActions Botones de acción situados al lado derecho del título.
 * return:
 *     + string : shellHtml Estructura completa de página lista para inyección en el DOM.
 */
function shell(body, title, description = "", headingActions = "") {
  // [Línea clave]: ¿Por qué soy importante? Resuelve dinámicamente la identidad y rol visible del usuario. ¿Para qué? Ajustar las opciones del menú lateral a sus facultades (investigador vs evaluador vs superadmin). ¿Dónde me usan? Al armar el layout principal en shell().
  const r = person(),
    research = state.role === "investigador",
    admin = state.role === "direccion",
    historical = admin || state.role === "cie";
  const module = (screen(current) || {}).module || "Expediente";
  return `<div class="app"><aside class="sidebar"><div class="brand"><div class="brand-mark">S</div><div><div class="brand-name">SGPI</div><span class="tec-wordmark">Tecnológico de Costa Rica</span></div></div><nav aria-label="Navegación principal"><div class="nav-group">${navItem("Inicio", "02", "home", current === "02")}${research ? navItem("Mis propuestas", "06", "folder", +current >= 6 && +current <= 20) : navItem("Bandeja de trabajo", "21", "inbox", +current >= 21 && +current <= 27)}${research ? navItem("Convocatorias", "04", "calendar", current === "04" || current === "05") : ""}${historical ? navItem("Consulta histórica", "29", "search", current === "29" || current === "30") : ""}</div>${admin ? `<div class="nav-title" style="margin-top:28px">SUPERADMINISTRACIÓN</div><div class="nav-group">${navItem("Convocatorias", "31", "calendar", current === "31")}${navItem("Rúbricas y catálogos", "32", "settings", current === "32")}</div>` : ""}</nav><div class="nav-group" style="margin-top:auto">${navItem("Mi perfil", "33", "user", current === "33")}<button class="nav-item has-tooltip" data-action="contact" data-tooltip="Persona de contacto y canales de apoyo." title="Persona de contacto y canales de apoyo.">${icon("info")}Contacto y soporte</button><button class="nav-item has-tooltip" data-action="logout" data-tooltip="${esc(optionHelp["Cerrar sesión"])}" title="${esc(optionHelp["Cerrar sesión"])}">${icon("logout")}Cerrar sesión</button></div></aside><div class="main"><header class="topbar"><div class="topbar-context"><strong>VIE</strong></div><div class="topbar-actions"><button class="icon-btn" data-go="03" aria-label="Notificaciones">${icon("bell")}${!state.read ? '<span class="notif-dot"></span>' : ""}</button><button class="profile-btn" data-action="user-menu" aria-expanded="${userMenuOpen}" aria-haspopup="menu"><span class="avatar">${esc(r.initials)}</span><span class="profile-text"><strong>${esc(r.name)}</strong><br><span class="micro muted">${r.label}</span></span>${icon("down")}</button>${userMenuOpen ? `<div class="user-menu" role="menu"><div class="user-menu-head"><strong>${esc(r.name)}</strong><div class="micro muted">${r.label}</div></div><button role="menuitem" data-go="33">${icon("user")}Mi perfil</button><button role="menuitem" data-action="settings">${icon("settings")}Ajustes y accesibilidad</button><button role="menuitem" data-action="contact">${icon("info")}Contactar soporte</button><button role="menuitem" class="danger" data-action="logout">${icon("logout")}Cerrar sesión</button></div>` : ""}</div></header><main class="content"><div class="page-heading"><div><h1>${esc(title)}</h1>${description ? `<p class="subtitle">${esc(description)}</p>` : ""}</div>${headingActions ? `<div class="action-row">${headingActions}</div>` : ""}</div>${body}</main></div><button class="support-fab" data-action="contact" aria-label="Contactar soporte">${icon("info")}<span>Soporte</span></button></div>`;
}

/**
 * Lista de tuplas de los 11 pasos cronológicos del asistente de formulación de propuestas.
 * Define el identificador de pantalla y el nombre de cada etapa del formulario wizard.
 * En formShell() para renderizar el stepper lateral con barra de progreso y botones anterior/siguiente.
 * atributos:
 *     * string : 0 Identificador de pantalla de la sección ('08' a '18').
 *     * string : 1 Título descriptivo de la sección (ej. 'Datos generales', 'Presupuesto').
 */
const steps = [
  ["08", "Datos generales"],
  ["09", "Equipo investigador"],
  ["10", "Fundamentación"],
  ["11", "Objetivos"],
  ["12", "Metodología"],
  ["13", "Plan de acción"],
  ["14", "Gestión de riesgos"],
  ["15", "Presupuesto"],
  ["16", "Información complementaria"],
  ["17", "Documentos"],
  ["18", "Revisión y envío"],
];

/**
 * Proveer el marco estructural común (Wizard Shell) para los formularios de formulación de propuestas.
 * Genera el stepper lateral con la barra de progreso porcentual, contenedor de formulario,
 * encabezado con badge 'Borrador', y pie con botones 'Anterior', 'Guardar borrador' y 'Guardar y continuar'.
 * parametros:
 *     - string : inner Contenido HTML con los campos específicos de la etapa activa.
 *     - string : id Identificador de la pantalla actual en el formulario wizard.
 * return:
 *     + string : formShellHtml Marcado completo del asistente de pasos.
 */
function formShell(inner, id = current) {
  // [Línea clave]: ¿Por qué soy importante? Calcula el índice del paso activo. ¿Para qué? Establecer el ancho de la barra de progreso y habilitar los pasos concluidos en el stepper. ¿Dónde me usan? En la generación del stepper en formShell().
  const idx = steps.findIndex((s) => s[0] === id);
  return `<div class="form-layout"><aside><div class="small" style="margin:0 10px 10px"><strong>Tu propuesta</strong><p class="micro muted" style="margin-top:4px">Paso ${idx + 1} de 11</p></div><div class="progress" style="margin:0 10px 18px"><span style="width:${((idx + 1) / 11) * 100}%"></span></div><nav class="stepper" aria-label="Secciones del formulario">${steps.map(([n, l], i) => `<button class="step ${i === idx ? "active" : i < idx ? "done" : ""}" data-go="${n}"><span>${i < idx ? "✓" : i + 1}</span>${l}</button>`).join("")}</nav><p class="micro muted" style="margin:20px 10px">Puedes guardar y continuar después.<br>Los campos con * son obligatorios.</p></aside><div><form id="proposal-form" class="card form-card" novalidate><div class="form-title"><h2>${esc(screen(id).title)}</h2>${badge("Borrador")}</div>${inner}<div class="form-footer"><div>${idx > 0 ? btn("Anterior", steps[idx - 1][0], "text", "back") : btn("Mis propuestas", "06", "text", "back")}</div><div class="action-row">${act("Guardar borrador", "save", "secondary")}${idx < 10 ? act("Guardar y continuar", "next", "", "arrow", `data-next="${steps[idx + 1][0]}"`) : act("Enviar a evaluación", "send", "", "arrow")}</div></div></form><div class="saved" style="margin-top:12px">${icon("check")}Cambios guardados</div></div></div>`;
}
/**
 * Construir y renderizar el formulario de inicio de sesión de usuario (Pantalla 01).
 * Genera el contenedor central con el logotipo del TEC/VIE, campos para correo y contraseña,
 * área viva para mensajes de error accesibles y enlaces de soporte institucional.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : loginHtml Marcado HTML de la pantalla de autenticación.
 */
function login() {
  return `<main class="login-simple"><div class="login-panel"><div class="brand"><div class="brand-mark">S</div><div><div class="brand-name">SGPI <span class="login-vie">/ VIE</span></div><span class="tec-wordmark">Tecnológico de Costa Rica</span></div></div><h1>Iniciar sesión</h1><p class="muted">Gestión de propuestas de investigación</p><form id="login-form" novalidate>${field("Correo institucional", "", "email", "", true, "login:email")}${field("Contraseña", "", "password", "", true, "login:password")}<div id="login-error" role="alert" aria-live="assertive"></div>${act("Ingresar", "login", "", "arrow")}<div class="login-help">${act("Ayuda para ingresar", "login-help", "text")} · ${act("Ayuda para crear cuenta", "account-help", "text")}</div></form><div class="login-help">${act("Contactar a una persona", "contact", "text", "info")}</div></div><button class="support-fab" data-action="contact" aria-label="Contactar soporte">${icon("info")}<span>Soporte</span></button></main>`;
}

/**
 * Renderizar el panel principal o Dashboard institucional (Pantalla 02) según el rol del usuario.
 * Si el usuario es evaluador/revisor, muestra la bandeja prioritaria y métricas de dictamen.
 * Si es investigador, renderiza métricas conectadas a numspropuestas, la propuesta más reciente,
 * la tabla de proyectos en curso y la fecha límite de sometimiento de convocatorias.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : dashboardHtml Marcado estructurado del panel de inicio.
 */
function dashboard() {
  // [Línea clave]: ¿Por qué soy importante? Bifurcación condicional de interfaz según privilegios de rol. ¿Para qué? Mostrar métricas de evaluación a comités o panel de formulación a investigadores. ¿Dónde me usan? Al inicio de dashboard().
  if (state.role !== "investigador")
    return shell(
      `<div class="hero"><div><h2>Una propuesta espera tu revisión</h2><p>Consulta el expediente completo antes de registrar la decisión de ${roles[state.role].label}.</p></div>${btn("Abrir bandeja", "21", "", "arrow")}</div><div class="grid three mt">${[
        ["Pendientes", "1"],
        ["En revisión", "0"],
        ["Resueltos", "3"],
      ]
        .map(
          ([a, b]) =>
            `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
        )
        .join(
          "",
        )}</div><div class="mt card">${table(["Expediente", "Etapa", "Prioridad", ""], [[`<span class="project-code">SI-2027-014</span><strong>Agua Inteligente: monitoreo de cuencas</strong>`, roles[state.role].label, badge("Dentro del plazo"), btn("Revisar", roles[state.role].screen, "text", "arrow")]])}</div>`,
      `Hola, ${person().name.split(" ")[0]}`,
      "",
      "",
    );
  return shell(
    `<div class="hero"><div><h2> ${propuestamasreciente?.titulo ?? "Empieza una nueva propuesta"} </h2><p>Completa el presupuesto y los documentos para enviar a revisión.</p></div>${btn("Continuar propuesta", "15", "", "arrow")}</div><div class="grid four mt">${[
      ["Mis propuestas", numspropuestas?.total ?? "-", "folder"],
      ["En formulación", numspropuestas?.formulacion ?? "-", "edit"],
      ["En ejecución", numspropuestas?.ejecucion ?? "-", "clock"],
      ["Cerradas", numspropuestas?.cerradas ?? "-", "check"],
    ]
      .map(
        ([a, b, c]) =>
          `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
      )
      .join(
        "",
      )}</div><div class="two-col mt"><section class="card"><div class="card-pad section-head" style="margin-bottom:0"><h2>Mis propuestas recientes</h2>${btn("Ver todas", "06", "text compact")}</div>${table(
      ["Propuesta", "Estado", ""],
      (top3propuestasmasrecientes ?? [])
        .slice(0, 3)
        .map((p) => [
          `<span class="project-code">${p.code}</span><span class="project-name">${p.title}</span>`,
          badge(p.status),
          btn(
            "Abrir",
            p.status === "En formulación" ? "08" : "22",
            "text compact",
            "arrow",
            `data-proposal="${p.code}" data-proposal-id="${p.id || ""}"`,
          ),
        ]),
    )}</section><div class="stack">${card("Próximo vencimiento", `<div class="eyebrow">FONDOS VIE 2027</div><div style="font-size:32px;font-weight:700">28 <span style="font-size:18px;font-weight:400">sep 2026</span></div><p class="small muted" style="margin:8px 0 18px">Sometimiento formal ante VIE. Requiere evaluación y avales previos.</p>${btn("Consultar convocatoria", "05", "text", "arrow")}`)}</div></div>`,
    `Hola, ${person().name.split(" ")[0]}`,
    "",
    btn("Nueva propuesta", "07", "", "plus"),
  );
}

/**
 * Renderizar el centro general de notificaciones y novedades (Pantalla 03).
 * Aplica los filtros por categoría y estado de lectura, genera las filas de tarjetas
 * con fechas formateadas e incrusta el botón de marcado masivo.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : notifHtml Marcado de la pantalla de notificaciones.
 */
function notifications() {
  const all = notificaciones ?? [];
  let items = all;
  if (activeFilter === "Sin leer") items = all.filter((n) => !n.leida);
  else if (activeFilter === "Trámites") items = all.filter((n) => n.tipo === "tramite");
  else if (activeFilter === "Convocatorias") items = all.filter((n) => n.tipo === "convocatoria");

  const fecha = (s) =>
    new Date(s).toLocaleString("es-CR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const destino = (n) => (n.tipo === "convocatoria" ? "05" : n.id_propuesta ? "22" : "03");

  return shell(
    `${tabs(["Todas", "Sin leer", "Trámites", "Convocatorias"], activeFilter, "data-filter")}<div class="card card-pad">${
      items.length
        ? items
            .map(
              (n) =>
                `<div class="list-item"><div class="list-icon">${icon(n.tipo === "convocatoria" ? "calendar" : "file")}</div><div class="grow"><div class="action-row"><h3>${esc(n.titulo)}</h3>${!n.leida ? badge("Sin leer") : ""}</div><p>${esc(n.mensaje)}</p><small class="micro muted">${fecha(n.fecha_creacion)}</small></div>${btn("Ver", destino(n), "text", "arrow", `data-notif="${n.id_notificacion}" ${n.id_propuesta ? `data-proposal="SI-${n.id_propuesta}" data-proposal-id="${n.id_propuesta}"` : ""}`)}</div>`,
            )
            .join("")
        : `<div class="empty">${icon("check")}<h2>${activeFilter === "Sin leer" ? "Estás al día" : "Sin notificaciones"}</h2><p>${activeFilter === "Sin leer" ? "No tienes notificaciones sin leer." : "No hay notificaciones en esta categoría."}</p>${act("Ver todas", "all-notifications", "secondary")}</div>`
    }</div>`,
    "Notificaciones",
    "Novedades y acciones pendientes de tus expedientes.",
    act("Marcar todas como leídas", "read", "secondary", "check"),
  );
}

/**
 * Renderizar la pantalla de búsqueda y listado de convocatorias institucionales (Pantalla 04).
 * Filtra la colección convocatorias por texto y estado activo/cerrado, presentando tarjetas
 * con cronograma, familias de iniciativas y acceso directo a la formulación.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : callsHtml Marcado HTML de la lista de convocatorias.
 */
function calls() {
  const fmt = (d) =>
    new Date(d).toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });
  const q = (state.saved["call:query"] || "").toLowerCase();
  const estado = state.saved["call:status"] || "Abiertas para formulación";

  const list = (convocatorias ?? []).filter(
    (c) =>
      c.nombre.toLowerCase().includes(q) &&
      (estado === "Todas" || (estado === "Cerradas" ? !c.activo : c.activo)),
  );

  const cards = list
    .map(
      (c) =>
        `<section class="card card-pad"><div class="section-head">${badge(c.activo ? "Formulación" : "Cerrada")}</div><h2>${esc(c.nombre)}</h2><p class="small muted" style="margin:12px 0 24px">${esc(c.descripcion)}</p>${definition([
          ["Formulación", `${fmt(c.fecha_inicio)} – ${fmt(c.fecha_cierre)}`],
          ["Inicio de ejecución", fmt(c.fecha_inicio_ejecucion)],
          ["Modalidades", `${(modalidades ?? []).length} familias de iniciativas`],
        ])}<div class="form-footer">${btn("Ver convocatoria", "05", "secondary","",`data-convocatoria="${c.id_convocatoria}"`)}${c.activo ? btn("Crear propuesta", "07", "", "plus") : ""}</div></section>`,
    )
    .join("");

  const empty = `<section class="card empty">${icon("search")}<h2>Sin convocatorias</h2><p>No hay convocatorias para este filtro.</p></section>`;

  return shell(
    `<div class="filters mb">${field("Buscar convocatoria", "", "search", "", false, "call:query")}${field("Estado", ["Abiertas para formulación", "Todas", "Cerradas"], "select", "", false, "call:status")}${act("Buscar", "filter-calls", "secondary", "search")}</div><div class="grid two">${cards || empty}${card("Antes de comenzar", `<div class="timeline"><div class="event"><h3>Revisa los instrumentos vigentes</h3><p>Disposiciones, formulario, plan y presupuesto.</p></div><div class="event"><h3>Define modalidad y equipo</h3><p>Los topes y productos cambian según la iniciativa.</p></div><div class="event"><h3>Programa las revisiones</h3><p>Vinculación, Comité y consejos preceden al sometimiento.</p></div></div>`)}</div>`,
    "Convocatorias",
    "Encuentra los requisitos y las fechas para tu próxima propuesta.",
  );
}

/**
 * Formatear el listado de etapas y plazos de la convocatoria activa para su visualización.
 * Mapea las etapas en etapasConvocatoria a tuplas [nombre, rangoFechas] con formato localizado.
 * parametros:
 *     (ninguno)
 * return:
 *     + Array<[string, string]> : etapasRows Matriz de etapas y fechas formateadas.
 */
function etapasRows() {
  const fmt = (d) => new Date(d).toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });
  return (etapasConvocatoria ?? []).map((e) => [
    e.nombre_etapa,
    e.fecha_fin && e.fecha_fin !== e.fecha_inicio ? `${fmt(e.fecha_inicio)} – ${fmt(e.fecha_fin)}` : fmt(e.fecha_inicio),
  ]);
}

/**
 * Renderizar la vista detallada de una convocatoria (Pantalla 05).
 * Despliega modalidades institucionales, instrumentos normativos descargables,
 * advertencias sobre etapas de evaluación y la línea de tiempo interactiva de fechas.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : detailHtml Marcado estructurado del detalle de la convocatoria.
 */
function callDetail() {
  const conv = (convocatorias ?? []).find((c) => c.id_convocatoria === state.viewCall);
  const inicioEjecucion = conv
  ? new Date(conv.fecha_inicio_ejecucion).toLocaleDateString("es-CR", { month: "long", year: "numeric" })
  : "";
  return shell(
    `<div class="two-col"><div class="stack">${card(
      "Una convocatoria, distintas formas de investigar",
      `<p class="small muted mb">Selecciona la modalidad que corresponde a los resultados esperados. Los límites se verifican por año y por iniciativa.</p>${table(
        ["Modalidad", "Duración inicial", "Tope"],
        (modalidades ?? []).map((m) => [esc(m.titulo), esc(m.duracion), money(m.monto)]),
      )}`,
    )}${card("Instrumentos de la convocatoria", instrumentosConvocatoria())}${notice("No omitas las etapas previas", "Enviar a evaluación y someter ante VIE son acciones distintas. El investigador realiza el sometimiento formal después de obtener los avales.")}</div>${card("Calendario", `<div class="timeline">${etapasRows().map(([a, b], i) => `<div class="event ${i === 0 ? "current" : ""}"><h3>${esc(a)}</h3><p>${esc(b)}</p></div>`).join("")}</div>`)}</div>`,
    conv?.nombre ?? "Convocatoria",
    `Convocatoria de investigación · Inicio de ejecución: ${inicioEjecucion}`,
    btn("Crear propuesta", "07", "", "plus"),
  );
}

/**
 * Renderizar la pantalla de gestión del portafolio personal del investigador (Pantalla 06).
 * Aplica pestañas de filtrado (Todas, En formulación, En ejecución, Cerradas) sobre la lista de propuestas
 * y las despliega en una tabla con estados sincronizados con PostgreSQL.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : proposalsHtml Marcado HTML de la vista Mis Propuestas.
 */
function myProposals() {
  const list = misPropuestas ?? [];
  let filtered = list;
  if (activeFilter === "En formulación") filtered = list.filter((p) => p.status === "En formulación");
  else if (activeFilter === "En ejecución") filtered = list.filter((p) => p.status === "En ejecución");
  else if (activeFilter === "Cerradas") filtered = list.filter((p) => p.status === "Cerrada" || p.status === "Rechazada");

  return shell(
    `${tabs(["Todas", "En formulación", "En ejecución", "Cerradas"], activeFilter, "data-filter")}<div class="card">${table(
      ["Propuesta", "Período", "Estado", "Monto", ""],
      projectRows(filtered),
      `<span>${filtered.length} propuesta${filtered.length === 1 ? "" : "s"} sincronizada${filtered.length === 1 ? "" : "s"} con PostgreSQL</span><span>Página 1 de 1</span>`,
    )}</div>`,
    "Mis propuestas",
    "Organiza tus borradores y consulta el avance de tus investigaciones.",
    btn("Nueva propuesta", "07", "", "plus"),
  );
}

/**
 * Renderizar el selector de modalidad para crear una nueva propuesta (Pantalla 07).
 * Despliega tarjetas de selección tipo radio con las modalidades del catálogo de base de datos
 * junto con guías sobre requisitos, equipo y presupuestos.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : newProposalHtml Marcado HTML del paso inicial de creación.
 */

/* =====================================================================
   Integración del asistente de propuestas con la API
   ===================================================================== */

const PROPOSAL_SCREENS = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18"];
const PROPOSAL_DEFAULTS = {
  "08:Título de la propuesta": "Agua Inteligente: monitoreo de cuencas",
  "08:Resumen": "Desarrollo y validación de un sistema de monitoreo que integra mediciones de calidad del agua para apoyar decisiones en dos microcuencas piloto.",
  "08:Palabras clave": "Calidad del agua; monitoreo; cuencas; sensores",
  "08:Resumen en inglés": "Development and validation of a water-quality monitoring system in two pilot watersheds.",
  "08:Palabras clave en inglés": "Water quality; monitoring; watersheds; sensors",
  "08:Prioridad nacional y ODS": "Gestión del recurso hídrico · ODS 6",
  "08:Continuidad y financiamiento previo": "No corresponde a una continuación; no tiene financiamiento externo.",
  "08:Instrumento jurídico / convenio": "No aplica.",
  "08:Vinculación con posgrado": "No aplica.",
  "08:Información sensible": "Documentación técnica del software, sujeta a valoración de Vinculación.",
  "10:Problema e importancia": "La información sobre calidad del agua en las microcuencas piloto se obtiene mediante mediciones aisladas. Esta discontinuidad limita la identificación oportuna de variaciones y dificulta comparar condiciones entre sitios.",
  "10:Justificación": "Un sistema de monitoreo continuo y validado permitirá reconocer variaciones en la calidad del agua y brindar evidencia útil a las personas responsables de su gestión.",
  "10:Estado del arte y vacío identificado": "Revisión previa documentada: los sistemas comparados presentan limitaciones de continuidad de mediciones e integración de datos en las microcuencas del caso. El prototipo aborda ese vacío mediante calibración comparativa y registro continuo.",
  "10:Antecedentes": "El equipo dispone de una prueba de concepto en laboratorio. La propuesta integra medición, registro y visualización para avanzar hacia su validación en condiciones relevantes.",
  "12:Enfoque y diseño metodológico": "Desarrollo experimental en tres fases: definición de requerimientos, integración del prototipo y validación comparativa en campo.",
  "12:Procedimientos y técnicas": "Se definirán puntos de medición en dos microcuencas; se calibrarán los instrumentos; se compararán registros del prototipo con mediciones de referencia; y se documentarán desempeño y limitaciones.",
  "12:Usuarios y validación": "Personas responsables de la gestión de dos microcuencas piloto. La validación compara mediciones de pH, temperatura y conductividad con instrumentos de referencia; se documentan concordancia, cobertura temporal y limitaciones.",
  "12:Análisis de resultados": "Se evaluarán integridad de registros, concordancia de las mediciones y disponibilidad del sistema durante el período piloto.",
  "16:TRL actual": "4",
  "16:TRL esperado": "6",
  "16:Potencial de propiedad intelectual": "Sí",
  "16:Activo previsto": "Software de integración y registro de mediciones ambientales.",
  "16:Difusión y socialización": "Sesión institucional y manual para responsables de las microcuencas, después de la revisión de PI.",
  "16:Hoja de ruta": "TRL 4 a 6: integrar, calibrar y validar en entorno relevante.",
  "ethics:0:applies": "No",
  "ethics:0:reason": "No se recopilan datos de personas ni se realizan intervenciones con participantes humanos.",
  "ethics:1:applies": "No",
  "ethics:1:reason": "No se recolectan especímenes ni material genético; solo se registran parámetros físico-químicos del agua.",
  "ethics:2:applies": "No",
  "ethics:2:reason": "No se utilizan animales ni se realizan procedimientos sobre fauna.",
  "ethics:3:applies": "No",
  "ethics:3:reason": "Los sitios piloto no se ubican en territorios indígenas; cualquier cambio requerirá consulta y autorización previa.",
};
function currentProposalId() {
  return Number(state.created?.id) || 1;
}

function draftValue(key, fallback = "") {
  const value = state.saved?.[key];
  if (value !== undefined && value !== null) return value;
  return PROPOSAL_DEFAULTS[key] ?? fallback;
}

function screenDefault(id, label, fallback = "") {
  return screen(id)?.fields?.find((field) => field.label === label)?.value ?? fallback;
}

function convocatoriaActivaId() {
  return (convocatorias ?? []).find((c) => c.activo)?.id_convocatoria ?? 1;
}

function nuevoClientUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function normalizarTexto(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tipoHoraId(nombre, fallback) {
  return (
    (catalogos?.tipos_hora ?? []).find(
      (t) => normalizarTexto(t.nombre_tipo_hora) === normalizarTexto(nombre),
    )?.id_tipo_hora ?? fallback
  );
}

function catalogoId(value, lista = [], fallback = 1) {
  const numero = Number(value);
  if (Number.isFinite(numero) && lista.some((item) => Number(item.id) === numero)) return numero;
  const porNombre = lista.find((item) => normalizarTexto(item.nombre) === normalizarTexto(value));
  return Number(porNombre?.id) || Number(lista[0]?.id) || fallback;
}

function rubroParaPartida(partida) {
  const rubros = catalogos?.rubros_presupuesto ?? [];
  const texto = normalizarTexto(`${partida.name} ${partida.code}`);
  const reglas = [
    { claves: ["beca", "asistente"], destino: ["beca"] },
    { claves: ["equipo", "equipamiento"], destino: ["equipamiento"] },
    { claves: ["material", "suministro", "reactivo"], destino: ["material"] },
    { claves: ["servicio", "consultoria"], destino: ["servicio"] },
    { claves: ["viatico", "gira", "campo"], destino: ["viatico", "campo"] },
    { claves: ["publicacion", "difusion", "divulgacion"], destino: ["publicacion", "difusion"] },
    { claves: ["capacitacion", "evento", "taller"], destino: ["capacitacion", "evento"] },
  ];
  for (const regla of reglas) {
    if (!regla.claves.some((clave) => texto.includes(clave))) continue;
    const rubro = rubros.find((r) =>
      regla.destino.some((destino) => normalizarTexto(r.nombre_rubro).includes(destino)),
    );
    if (rubro) return rubro;
  }
  return rubros.find((r) => normalizarTexto(r.nombre_rubro) === normalizarTexto(partida.name)) ?? null;
}

function proposalTeamMembers() {
  const correo = String(session?.user?.correo ?? "").trim().toLowerCase();
  if (!correo) return [];
  return [
    {
      nombre: session.user.nombre,
      correo,
      tipo: "VIE",
      horas: 8,
      rol: "Coordinador/a",
      escuela: escuelas?.[0]?.nombre || "Instancia coordinadora",
    },
  ];
}

function totalHorasEquipo() {
  return proposalTeamMembers().reduce((total, persona) => total + Number(persona.horas || 0), 0);
}

function nombreResponsableActual() {
  return session?.user?.nombre || "Coordinador/a";
}


function fechaIso(value, fallback) {
  const texto = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const partes = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (partes) return `${partes[3]}-${partes[2].padStart(2, "0")}-${partes[1].padStart(2, "0")}`;
  return fallback;
}

function fechaDeMes(fechaInicio, mes, finDeMes = false) {
  const [anio, mesBase] = String(fechaInicio || "2027-01-01")
    .split("-")
    .map(Number);
  const fecha = new Date(Date.UTC(anio, (mesBase || 1) - 1 + (Number(mes) - 1), 1));
  if (finDeMes) {
    fecha.setUTCMonth(fecha.getUTCMonth() + 1);
    fecha.setUTCDate(0);
  }
  return fecha.toISOString().slice(0, 10);
}

function rangoMeses(periodo) {
  const texto = String(periodo ?? "").replace(/[–—]/g, "-");
  if (texto.includes("/")) {
    const [inicio, duracion] = texto.split("/").map((n) => Number(n.trim()));
    return [inicio || 1, (inicio || 1) + (duracion || 1) - 1];
  }
  const [inicio, fin] = texto.split("-").map((n) => Number(n.trim()));
  return [inicio || 1, fin || inicio || 1];
}

function responsableDeActividad(texto) {
  const equipo = proposalTeamMembers();
  const iniciales = String(texto ?? "").split("·")[0].trim();
  const porIniciales = equipo.find((m) => initials(m.nombre) === iniciales);
  const porNombre = equipo.find((m) => normalizarTexto(texto).includes(normalizarTexto(m.nombre)));
  const persona = porIniciales || porNombre || equipo[0];
  const rol = /supervisa/i.test(texto) ? "Supervisa" : /participa/i.test(texto) ? "Participa" : "Ejecuta";
  return { correo: persona?.correo || session?.user?.correo || "", rol };
}

function buildProposalPayload() {
  const fechaInicio = fechaIso(draftValue("08:Fecha de inicio", "2027-01-01"), "2027-01-01");
  const fechaFin = fechaIso(draftValue("08:Fecha de finalización", "2028-12-31"), "2028-12-31");
  const equipo = proposalTeamMembers();
  const objetivos = [
    {
      codigo_objetivo: "OG",
      descripcion: draftValue("11:Objetivo general", screenDefault("11", "Objetivo general")),
      orden: 1,
    },
    ...screen("11").rows.map((row, index) => ({
      codigo_objetivo: row.code,
      descripcion: draftValue(`11:${row.code}`, row.text),
      orden: index + 2,
    })),
  ];
  if (state.extraObjective) {
    objetivos.push({
      codigo_objetivo: "OE4",
      descripcion: draftValue("11:OE4", state.extraObjective),
      orden: objetivos.length + 1,
    });
  }

  const todosLosProductos = [
    {
      codigo_objetivo: "OE2",
      tipo_producto: "Software",
      categoria: "Activo de propiedad intelectual",
      descripcion: "Software de integración, registro y visualización de mediciones ambientales.",
      meta_esperada: "Versión validada y documentada del software.",
      es_obligatorio: true,
    },
    {
      codigo_objetivo: "OE3",
      tipo_producto: "Artículo científico",
      categoria: "Publicación científica",
      descripcion: "Artículo con los resultados de calibración y validación en las microcuencas piloto.",
      meta_esperada: "Manuscrito sometido a una revista WoS/Scopus.",
      es_obligatorio: true,
    },
    {
      codigo_objetivo: "OE3",
      tipo_producto: "Manual técnico",
      categoria: "Transferencia",
      descripcion: "Manual de uso, mantenimiento y condiciones de operación del sistema.",
      meta_esperada: "Manual entregado y socializado con las personas usuarias.",
      es_obligatorio: true,
    },
  ];

  const todasLasActividades = activities.concat(state.extraActivities || []);
  const plan = todasLasActividades.map((actividad, index) => {
    const [mesInicio, mesFin] = rangoMeses(actividad[4]);
    const responsable = responsableDeActividad(actividad[3]);
    return {
      codigo_objetivo: actividad[0],
      descripcion_actividad: actividad[1],
      resultado_esperado: actividad[2],
      correo_responsable: responsable.correo,
      rol_responsable: responsable.rol,
      mes_inicio: mesInicio,
      mes_fin: mesFin,
      fecha_inicio: fechaDeMes(fechaInicio, mesInicio),
      fecha_fin: fechaDeMes(fechaInicio, mesFin, true),
    };
  });

  const todosLosRiesgos = risks.concat(state.extraRisks || []);
  const riesgos = todosLosRiesgos.map((riesgo) => {
    const responsable = responsableDeActividad(riesgo[3]);
    return {
      descripcion_riesgo: riesgo[1],
      medida_mitigacion: riesgo[2],
      correo_responsable: responsable.correo,
      id_nivel_probabilidad: 2,
      id_nivel_impacto: 2,
    };
  });

  const presupuesto = state.budget.flatMap((partida) => {
    const rubro = rubroParaPartida(partida);
    if (!rubro) return [];
    return [
      { id_rubro: rubro.id_rubro, monto: Number(partida.a) || 0, anio: 1, justificacion: partida.detail || "" },
      { id_rubro: rubro.id_rubro, monto: Number(partida.b) || 0, anio: 2, justificacion: partida.detail || "" },
    ].filter((item) => item.monto > 0);
  });

  const secciones = [
    ["problema", "Problema e importancia", draftValue("10:Problema e importancia", screenDefault("10", "Problema de investigación"))],
    ["justificacion", "Justificación", draftValue("10:Justificación", screenDefault("10", "Justificación"))],
    ["estado_arte", "Estado del arte y vacío identificado", draftValue("10:Estado del arte y vacío identificado", "")],
    ["antecedentes", "Antecedentes", draftValue("10:Antecedentes", screenDefault("10", "Antecedentes"))],
    ["metodologia", "Enfoque y diseño metodológico", draftValue("12:Enfoque y diseño metodológico", screenDefault("12", "Diseño metodológico"))],
    ["procedimientos", "Procedimientos y técnicas", draftValue("12:Procedimientos y técnicas", screenDefault("12", "Procedimiento"))],
    ["usuarios_validacion", "Usuarios y validación", draftValue("12:Usuarios y validación", "")],
    ["analisis_resultados", "Análisis de resultados", draftValue("12:Análisis de resultados", screenDefault("12", "Análisis de resultados"))],
    ["continuidad", "Continuidad y financiamiento previo", draftValue("08:Continuidad y financiamiento previo", "")],
    ["instrumento_juridico", "Instrumento jurídico / convenio", draftValue("08:Instrumento jurídico / convenio", "")],
    ["vinculacion_posgrado", "Vinculación con posgrado", draftValue("08:Vinculación con posgrado", "")],
    ["informacion_sensible", "Información sensible", draftValue("08:Información sensible", "")],
    ["difusion", "Difusión y socialización", draftValue("16:Difusión y socialización", "")],
    ["hoja_ruta", "Hoja de ruta", draftValue("16:Hoja de ruta", "")],
  ]
    .filter(([, , contenido]) => String(contenido ?? "").trim())
    .map(([codigo, titulo, contenido], index) => ({
      codigo_seccion: codigo,
      titulo,
      contenido,
      orden: index + 1,
    }));

  const etiquetasEticas = [
    "Participación de seres humanos",
    "Biodiversidad y recursos genéticos",
    "Uso de animales",
    "Territorios o pueblos indígenas",
  ];
  const declaraciones = etiquetasEticas.map((tipo, index) => {
    const aplica = draftValue(`ethics:${index}:applies`, "No") === "Sí";
    return {
      tipo_aspecto: tipo,
      aplica,
      justificacion_exencion: draftValue(`ethics:${index}:reason`, ""),
    };
  });

  const colaboradores = state.externalCollaborator
    ? [
        {
          nombre_completo: state.externalCollaborator.nombre,
          institucion: state.externalCollaborator.institucion,
          rol: state.externalCollaborator.rol,
          orcid: state.externalCollaborator.orcid,
          horas_asignadas: Number(state.externalCollaborator.horas) || null,
          responsabilidad: state.externalCollaborator.responsabilidad,
        },
      ]
    : [];

  const clientUuid = state.clientUuid || nuevoClientUuid();
  state.clientUuid = clientUuid;
  return {
    id_usuario_lider: session?.user?.id_usuario ?? 10,
    id_escuela: catalogoId(draftValue("08:Instancia coordinadora", escuelas?.[0]?.id || 1), escuelas ?? []),
    id_modalidad: Number(state.modeId || 3),
    id_linea_investigacion: catalogoId(draftValue("08:Línea de investigación", lineas_investigacion?.[0]?.id || 1), lineas_investigacion ?? []),
    id_convocatoria: Number(state.convocatoriaId || convocatoriaActivaId()),
    titulo: draftValue("08:Título de la propuesta", screenDefault("08", "Título de la propuesta")),
    resumen: draftValue("08:Resumen", screenDefault("08", "Resumen")),
    palabras_clave: draftValue("08:Palabras clave", ""),
    palabras_clave_en: draftValue("08:Palabras clave en inglés", ""),
    resumen_en: draftValue("08:Resumen en inglés", ""),
    prioridad_nacional_ods: draftValue("08:Prioridad nacional y ODS", ""),
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    estado_inicial: 2,
    client_uuid: clientUuid,
    trl_inicial: Number(draftValue("16:TRL actual", "4")),
    trl_esperado: Number(draftValue("16:TRL esperado", "6")),
    potencial_pi: draftValue("16:Potencial de propiedad intelectual", "Sí") === "Sí",
    activo_previsto: draftValue("16:Activo previsto", ""),
    equipo: equipo.map((m) => ({
      correo: m.correo,
      id_tipo_hora: tipoHoraId(m.tipo, m.tipo === "VIE" ? 1 : 4),
      horas_asignadas: m.horas,
    })),
    colaboradores_externos: colaboradores,
    objetivos,
    productos_academicos: todosLosProductos,
    plan_accion: plan,
    riesgos,
    presupuesto,
    declaraciones_eticas: declaraciones,
    secciones,
    documentos: [],
  };
}

function proposalValidationIssues() {
  const issues = [];
  const obligatorios = [
    ["08:Título de la propuesta", "08", "Título de la propuesta"],
    ["08:Resumen", "08", "Resumen"],
    ["08:Palabras clave", "08", "Palabras clave"],
    ["11:Objetivo general", "11", "Objetivo general"],
    ["10:Problema e importancia", "10", "Problema e importancia"],
    ["10:Justificación", "10", "Justificación"],
    ["12:Enfoque y diseño metodológico", "12", "Enfoque metodológico"],
    ["12:Procedimientos y técnicas", "12", "Procedimientos y técnicas"],
    ["12:Análisis de resultados", "12", "Análisis de resultados"],
  ];
  for (const [key, pantalla, nombre] of obligatorios) {
    if (!String(draftValue(key, screenDefault(pantalla, nombre))).trim())
      issues.push({ screen: pantalla, text: nombre });
  }
  if (!proposalTeamMembers().length) issues.push({ screen: "09", text: "Equipo investigador" });
  if (state.budget.some((p) => (Number(p.a) > 0 || Number(p.b) > 0) && !rubroParaPartida(p)))
    issues.push({ screen: "15", text: "Rubros presupuestarios sin equivalente institucional" });
  if (!budgetValid()) issues.push({ screen: "15", text: "Reglas del presupuesto" });
  return issues;
}

function clearProposalDraft() {
  Object.keys(state.saved || {})
    .filter(
      (key) =>
        PROPOSAL_SCREENS.some((id) => key.startsWith(`${id}:`)) ||
        key.startsWith("ethics:") ||
        key.startsWith("modal:"),
    )
    .forEach((key) => delete state.saved[key]);
  state.budget = structuredClone(defaultState.budget);
  state.teamAdded = false;
  state.extraPerson = null;
  state.extraObjective = null;
  state.extraActivities = [];
  state.extraRisks = [];
  state.externalCollaborator = null;
  state.reviewed = false;
  state.clientUuid = null;
  state.modeId = 3;
  state.mode = "Desarrollo tecnológico";
  archivosBorrador = [];
}

function newProposal() {
  return shell(
    `<div class="two-col"><form class="card card-pad" id="modality-form"><div class="section-head"><h2>Elige la modalidad</h2>${badge("Paso inicial")}</div><div class="stack">${(modalidades ?? [])
      .map(
        (m) =>
          `<label class="radio-card"><input type="radio" name="modality" value="${esc(m.id)}" ${Number(state.modeId || 3) === Number(m.id) ? "checked" : ""}><div><h3>${esc(m.titulo)}</h3><p>${esc(m.descripcion)}</p><p style="margin-top:10px"><strong>${esc(m.duracion)} · ${money(m.monto)}</strong></p></div></label>`,
      )
      .join(
        "",
      )}</div><div class="form-footer">${btn("Cancelar", "06", "text")}${act("Crear borrador", "create-proposal", "", "arrow")}</div></form><div class="stack">${card("Para preparar tu propuesta", `<div class="list-item">${icon("user")}<div><h3>Equipo y dedicación</h3><p>Identifica participantes, responsabilidades y horas.</p></div></div><div class="list-item">${icon("calendar")}<div><h3>Plan y presupuesto</h3><p>Relaciona actividades, riesgos y recursos por año.</p></div></div><div class="list-item">${icon("file")}<div><h3>Instrumentos oficiales</h3><p>Usa la versión correspondiente a Fondos VIE 2027.</p></div></div>`)}${notice("Demostración disponible", "El recorrido completo utiliza desarrollo tecnológico. Las otras modalidades muestran sus reglas y requisitos generales.")}</div></div>`,
    "Nueva propuesta",
    "Comienza un borrador en la convocatoria Fondos VIE 2027.",
  );
}

/**
 * Renderizar el formulario de datos generales y metadatos del proyecto (Pantalla 08).
 * Genera campos para título, escuela coordinadora (poblada de escuelas de la API), modalidad,
 * línea de investigación (de lineas_investigacion), fechas, resumen, palabras clave e información institucional.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : dataFormHtml Marcado HTML interno de la sección de datos generales.
 */
function dataForm() {
  // [Línea clave]: ¿Por qué soy importante? Mapea los catálogos asíncronos de la base de datos a listas de opciones. ¿Para qué? Alimentar los selectores de escuela y línea de investigación del formulario. ¿Dónde me usan? Al construir dataForm().
  const escuelasOpts = (escuelas ?? []).map((e) => ({ value: e.id, label: e.nombre }));
  const lineasOpts = (lineas_investigacion ?? []).map((l) => ({ value: l.id, label: l.nombre }));
  return `
    ${field(
      "Título de la propuesta",
      "Agua Inteligente: monitoreo de cuencas",
      "text",
      "Usa un título claro que identifique el propósito de la investigación.",
      true
    )}
    
    <div class="field-row">
      ${field("Instancia coordinadora", escuelasOpts, "select", "", true)}
      ${field("Modalidad", state.mode || "Desarrollo tecnológico", "readonly")}
    </div>

    ${field(
      "Línea de investigación",
      lineasOpts,
      "select",
      "",
      true
    )}

    <div class="field-row">
      ${field("Fecha de inicio", "2027-01-01", "date", "", true)}
      ${field("Fecha de finalización", "2028-12-31", "date", "Duración propuesta: 24 meses.", true)}
    </div>

    ${field(
      "Resumen",
      screen("08").fields.find((f) => f.label === "Resumen").value,
      "textarea",
      "Máximo 500 palabras.",
      true
    )}

    ${field(
      "Palabras clave",
      "Calidad del agua; monitoreo; cuencas; sensores",
      "text",
      "Incluye de 4 a 6 palabras clave.",
      true
    )}

    <details class="accordion">
      <summary>Información adicional del formulario</summary>
      
      ${field(
        "Resumen en inglés",
        "Development and validation of a water-quality monitoring system in two pilot watersheds.",
        "textarea",
        "Máximo 500 palabras.",
        true
      )}
      
      ${field(
        "Palabras clave en inglés",
        "Water quality; monitoring; watersheds; sensors",
        "text",
        "4 a 6 palabras clave.",
        true
      )}
      
      ${field(
        "Prioridad nacional y ODS",
        "Gestión del recurso hídrico · ODS 6",
        "text"
      )}
      
      ${field(
        "Continuidad y financiamiento previo",
        "No corresponde a una continuación; no tiene financiamiento externo.",
        "textarea"
      )}
      
      ${field(
        "Instrumento jurídico / convenio",
        "No aplica.",
        "text"
      )}
      
      ${field(
        "Vinculación con posgrado",
        "No aplica.",
        "text"
      )}
      
      ${field(
        "Información sensible",
        "Documentación técnica del software, sujeta a valoración de Vinculación.",
        "textarea"
      )}
    </details>
  `;
}

/**
 * Renderizar la sección del equipo investigador y dedicación horaria (Pantalla 09).
 * Despliega la tabla de nombramientos (coordinador, investigadores, horas VIE/REC),
 * botón para agregar participantes, campo de beca estudiantil y acordeón de colaboradores externos.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : teamFormHtml Marcado HTML de la gestión de equipo.
 */
function teamForm() {
  const equipo = proposalTeamMembers();
  const totalHoras = totalHorasEquipo();
  const externo = state.externalCollaborator;
  return `${notice(`Dedicación total: ${totalHoras} horas semanales`, "El equipo se registra mediante correos de usuarios institucionales activos; el backend valida cada cuenta.")}<div class="mt">${table(
    ["Persona / instancia", "Rol", "Horas", "Correo"],
    equipo.map((persona) => [
      `<strong>${esc(persona.nombre)}</strong><br><span class="micro muted">${esc(persona.escuela || "Institución")}</span>`,
      esc(persona.rol),
      `${esc(persona.horas)} h ${esc(persona.tipo)}`,
      `<span class="micro muted">${esc(persona.correo)}</span>`,
    ]),
    externo
      ? `<span>Participación externa: ${esc(externo.nombre)} · ${esc(externo.institucion)} · carta de compromiso.</span>`
      : "<span>Nombramientos: 01 ene 2027 – 31 dic 2028</span>",
  )}</div><div class="action-row mt mb">${act("Agregar participante externo", "team", "secondary", "plus")}</div>${field("Participación estudiantil", "Valeria Campos · 10 h/semana de beca asistente especial; validación de campo y trabajo final de graduación.", "textarea", "₡960.000 por año para 400 horas a ₡2.400/h.", true)}<details class="accordion" ${externo ? "open" : ""}><summary>Colaboración externa y responsabilidades</summary><p>Las personas externas se identifican con institución, ORCID, carta de compromiso y tareas en el plan. La persona titular se registra cuando se emplean horas CONS.</p>${externo ? definition([["Nombre", esc(externo.nombre)], ["Institución", esc(externo.institucion)], ["Rol", esc(externo.rol)], ["Horas", `${esc(externo.horas || "—")} h/semana`], ["Responsabilidad", esc(externo.responsabilidad || "—")]]) : field("Institución externa", "Sin participantes externos en la versión inicial.", "text")}</details>`;
}

/**
 * Renderizar la sección de descripción, justificación y antecedentes (Pantalla 10).
 * Genera campos de texto para el problema de investigación, justificación del impacto,
 * estado del arte con referencias y anexo de fundamentación documental.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : foundationHtml Marcado HTML de fundamentación.
 */
function foundationForm() {
  return `${field("Problema e importancia", screen("10").fields[0].value, "textarea", "Máximo una página.", true)}${field("Justificación", screen("10").fields[1].value, "textarea", "Explica la contribución y las personas beneficiarias.", true)}${field("Estado del arte y vacío identificado", "Revisión previa documentada: los sistemas comparados presentan limitaciones de continuidad de mediciones e integración de datos en las microcuencas del caso. El prototipo aborda ese vacío mediante calibración comparativa y registro continuo.", "textarea", "Máximo 2 páginas. Incluye al menos 10 referencias primarias WoS/Scopus de los últimos 5 años.", true)}<details class="accordion"><summary>Ver referencias y antecedentes del caso</summary><p>Referencias pendientes de completar en este ejemplo.</p>${field("Antecedentes", screen("10").fields[2].value, "textarea")}${docPendiente("Fundamentación", "Anexo de referencia · pendiente de adjuntar")}</details>`;
}

/**
 * Renderizar el formulario de objetivos generales y específicos (Pantalla 11).
 * Construye el área para el objetivo general y genera dinámicamente campos para cada
 * objetivo específico (OE1, OE2, OE3, etc.), permitiendo incorporar objetivos adicionales.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : objFormHtml Marcado HTML de objetivos.
 */
function objectiveForm() {
  return `${field("Objetivo general", screen("11").fields[0].value, "textarea", "", true)}<h3 style="margin:22px 0 16px">Objetivos específicos</h3>${screen(
    "11",
  )
    .rows.map((r) =>
      field(
        r.code,
        r.text,
        "textarea",
        "Cada objetivo se vincula con actividades y resultados.",
        true,
      ),
    )
    .join(
      "",
    )}${state.extraObjective ? field("OE4", state.extraObjective, "textarea", "Objetivo agregado en esta sesión.", true) : ""}${act("Agregar objetivo", "objective", "secondary", "plus")}`;
}

/**
 * Renderizar la sección de diseño metodológico y validación (Pantalla 12).
 * Despliega campos para el enfoque, procedimientos técnicos, usuarios participantes,
 * análisis de resultados y compromisos de productos de PI (software y artículos WoS).
 * parametros:
 *     (ninguno)
 * return:
 *     + string : methodologyHtml Marcado HTML de metodología.
 */
function methodologyForm() {
  const totalHoras = totalHorasEquipo();
  return `${field("Enfoque y diseño metodológico", screen("12").fields[0].value, "textarea", "Describe enfoque, alcance y diseño.", true)}${field("Procedimientos y técnicas", screen("12").fields[1].value, "textarea", "Incluye instrumentos, variables y procedimientos de medición.", true)}${field("Usuarios y validación", "Personas responsables de la gestión de dos microcuencas piloto. La validación compara mediciones de pH, temperatura y conductividad con instrumentos de referencia; se documentan concordancia, cobertura temporal y limitaciones.", "textarea", "Justifica la selección de sitios y cómo se comprobará el desempeño.", true)}${field("Análisis de resultados", screen("12").fields[2].value, "textarea", "", true)}<details class="accordion"><summary>Productos y difusión</summary><p>Productos comprometidos para ${totalHoras} h: software (activo de PI), artículo sometido WoS/Scopus y manual técnico. La validación de PI corresponde a Vinculación.</p></details>`;
}

/**
 * Matriz de actividades iniciales del plan de trabajo con vinculación a objetivos y responsables.
 * Define tuplas [OE, Nombre, Entregable, Responsable, Meses] para cada actividad programada.
 * En planForm() para construir la tabla de actividades y el diagrama Gantt trimestral.
 * atributos:
 *     * Array<string> : 0 Código del objetivo específico (OE1, OE2, OE3).
 *     * string : 1 Descripción de la actividad.
 *     * string : 2 Producto o entregable esperado.
 *     * string : 3 Rol del responsable; el nombre se resuelve desde la sesión.
 *     * string : 4 Rango de meses de ejecución.
 */
const activities = [
  [
    "OE1",
    "Definir requerimientos y sitios",
    "Especificación de requerimientos",
    "Ejecuta",
    "1–6",
  ],
  [
    "OE2",
    "Integrar y calibrar el prototipo",
    "Prototipo integrado",
    "Ejecuta",
    "7–12",
  ],
  [
    "OE2",
    "Validar en dos microcuencas",
    "Datos de validación",
    "Ejecuta",
    "13–20",
  ],
  [
    "OE3",
    "Evaluar desempeño y documentar",
    "Informe y manual técnico",
    "Supervisa",
    "21–24",
  ],
];

/**
 * Renderizar la sección del plan de acción y cronograma de actividades (Pantalla 13).
 * Genera la tabla trazable de actividades con entregables y responsables, botones de adición,
 * y una representación visual de diagrama Gantt dividido en 8 trimestres (T1 a T8).
 * parametros:
 *     (ninguno)
 * return:
 *     + string : planFormHtml Marcado HTML del plan de acción.
 */
function planForm() {
  return `${notice("Cada actividad conserva su trazabilidad", "Asocia objetivo, resultado, participante, responsabilidad, riesgo y plazo en meses correlativos.")}<div class="mt">${table(
    ["Objetivo / actividad", "Resultado", "Responsable", "Meses"],
    activities
      .concat(state.extraActivities || [])
      .map((r) => [
        `<span class="project-code">${r[0]}</span><strong>${r[1]}</strong>`,
        r[2],
        `<strong>${esc(nombreResponsableActual())}</strong><br><span class="micro muted">${esc(responsableDeActividad(r[3]).rol)}</span>`,
        r[4],
      ]),
  )}</div><div class="action-row mt mb">${act("Agregar actividad", "activity", "secondary", "plus")}${btn("Revisar riesgos", "14", "text", "arrow")}</div><h3 class="mb">Cronograma · 24 meses</h3><div class="gantt"><div>Actividad</div>${["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"].map((x) => `<div>${x}</div>`).join("")}${activities.map((r, i) => `<div>${r[1]}</div>${Array.from({ length: 8 }, (_, j) => `<div ${j >= i * 2 && j < i * 2 + 2 ? 'class="bar"' : ""}></div>`).join("")}`).join("")}</div><details class="accordion"><summary>Giras e informes de seguimiento</summary><p>Se planifican giras de campo durante meses 13–20, informes semestrales en meses 6, 12, 18 y 24 e informes anuales en meses 12 y 24. La coordinación supervisa su entrega.</p></details>`;
}

/**
 * Matriz de riesgos previstos asociados a cada actividad principal del proyecto.
 * Define tuplas [Actividad, EventoDeRiesgo, MedidaMitigacion, Responsable].
 * En riskForm() para desplegar la matriz de contingencia obligatoria.
 * atributos:
 *     * string : 0 Nombre de la actividad.
 *     * string : 1 Descripción del riesgo identificado.
 *     * string : 2 Medida de mitigación aplicable.
 *     * string : 3 Nombre del responsable del monitoreo.
 */
const risks = [
  [
    "Definir requerimientos",
    "Acceso limitado a sitios",
    "Acordar accesos y sitios alternos antes de las visitas.",
    "Coordinador/a",
  ],
  [
    "Integrar y calibrar",
    "Retraso de componentes",
    "Verificar disponibilidad y opciones compatibles en el primer semestre.",
    "Coordinador/a",
  ],
  [
    "Validar en campo",
    "Crecidas en microcuencas",
    "Programar ventanas alternas y puntos seguros de medición.",
    "Coordinador/a",
  ],
  [
    "Evaluar y documentar",
    "Pérdida de registros",
    "Respaldar y verificar integridad semanalmente.",
    "Coordinador/a",
  ],
];

/**
 * Renderizar la matriz de gestión de riesgos y mitigación (Pantalla 14).
 * Despliega la tabla con riesgos, medidas de contingencia y responsables por actividad,
 * permitiendo registrar eventos adicionales.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : riskFormHtml Marcado HTML de la matriz de riesgos.
 */
function riskForm() {
  return `${notice("4 actividades · 4 riesgos asociados", "La plantilla exige identificar riesgos, mitigación y responsable para cada actividad.")}<div class="mt">${table(
    ["Actividad / riesgo", "Medida de mitigación", "Responsable"],
    risks
      .concat(state.extraRisks || [])
      .map((r) => [
        `<span class="project-code">${r[0]}</span><strong>${r[1]}</strong>`,
        r[2],
        `<strong>${esc(nombreResponsableActual())}</strong>`,
      ]),
  )}</div><div class="mt">${act("Agregar riesgo", "risk", "secondary", "plus")}</div><details class="accordion"><summary>Revisar consistencia con el plan</summary><p>Las medidas son realizables con los recursos y plazos de la propuesta. Los riesgos se revisarán durante cada informe de seguimiento.</p></details>`;
}

/**
 * Renderizar la sección de formulación presupuestaria plurianual (Pantalla 15).
 * Calcula totales anuales (2027 y 2028), valida techos presupuestarios (tope ₡5M anual y beca mínima),
 * y muestra la tabla interactiva de partidas con desglose y edición de montos.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : budgetFormHtml Marcado HTML del presupuesto.
 */
function budgetForm() {
  // [Línea clave]: ¿Por qué soy importante? Valida en tiempo real los topes de convocatoria VIE. ¿Para qué? Advertir al usuario si el presupuesto excede los ₡5M/año o carece de la beca reglamentaria. ¿Dónde me usan? En la cabecera de budgetForm().
  const valid = budgetValid();
  return `<div class="grid three mb">${[
    ["2027", totalA()],
    ["2028", totalB()],
    ["Total solicitado", totalA() + totalB()],
  ]
    .map(
      ([a, b]) =>
        `<div class="card metric"><span class="label">${a}</span><span class="value" style="font-size:23px">${money(b)}</span><span class="micro muted">${a === "Total solicitado" ? "Fondos VIE · 24 meses" : "Máximo ₡5.000.000 por año"}</span></div>`,
    )
    .join(
      "",
    )}</div>${valid ? notice("Presupuesto dentro del límite anual", "Equipo en el primer año y beca estudiantil de 10 h/semana incorporada.") : notice("Revisa el presupuesto para continuar", "El monto supera el tope anual, hay equipo en el segundo año o falta la beca mínima.", "warning")}<div class="mt">${table(
    ["Objeto de gasto", "2027", "2028", ""],
    state.budget.map((r, i) => {
      const rubro = rubroParaPartida(r);
      return [
        `<span class="project-code">${rubro ? `R-${rubro.id_rubro}` : r.code}</span><strong>${esc(rubro?.nombre_rubro || r.name)}</strong>`,
        money(r.a),
        money(r.b),
        act("Editar", "budget-edit", "text compact", "edit", `data-index="${i}"`),
      ];
    }),
  )}</div><div class="action-row mt">${act("Agregar rubro", "budget-add", "secondary", "plus")}${act("Ver reglas de presupuesto", "budget-rules", "text")}</div><details class="accordion"><summary>Justificaciones y otras fuentes</summary>${state.budget.map((r) => `<p><strong>${r.name}.</strong> ${r.detail}</p>`).join("")}${field("Financiamiento externo / contrapartida", "Sin aportes externos.", "textarea")}</details>`;
}

/**
 * Renderizar la sección de información complementaria, TRL, PI y aspectos bioéticos (Pantalla 16).
 * Genera selectores para nivel TRL actual/esperado, potencial de PI, activo intangible previsto
 * y la cuadrícula de declaraciones éticas desglosadas por eje (humanos, biodiversidad, animales, pueblos indígenas).
 * parametros:
 *     (ninguno)
 * return:
 *     + string : complementaryHtml Marcado HTML de información complementaria y ética.
 */
function complementaryForm() {
  const totalHoras = totalHorasEquipo();
  const ethics = [
    [
      "Participación de seres humanos",
      "No se recopilan datos de personas ni se realizan intervenciones con participantes humanos.",
    ],
    [
      "Biodiversidad y recursos genéticos",
      "No se recolectan especímenes ni material genético; solo se registran parámetros físico-químicos del agua.",
    ],
    [
      "Uso de animales",
      "No se utilizan animales ni se realizan procedimientos sobre fauna.",
    ],
    [
      "Territorios o pueblos indígenas",
      "Los sitios piloto no se ubican en territorios indígenas; cualquier cambio requerirá consulta y autorización previa.",
    ],
  ];
  return `<h3 class="mb">Madurez tecnológica y propiedad intelectual</h3><div class="field-row">${field("TRL actual", ["4", "1", "2", "3", "5", "6", "7", "8", "9"], "select", "Rango de referencia DT: 4–7.", true)}${field("TRL esperado", ["6", "1", "2", "3", "4", "5", "7", "8", "9"], "select", "Coherente con objetivos y validación.", true)}</div>${field("Potencial de propiedad intelectual", ["Sí", "No"], "select", "En desarrollo tecnológico el dictamen de Vinculación es obligatorio.", true)}${field("Activo previsto", "Software de integración y registro de mediciones ambientales.", "textarea", "Evitar divulgación previa a la valoración institucional.", true)}<details class="accordion" open><summary>Declaraciones éticas individuales</summary><p class="small muted" style="margin-top:14px">Cada aspecto se declara y justifica por separado; no se admite una respuesta general.</p><div class="ethics-grid">${ethics.map(([label, reason], i) => `<section class="ethics-item"><h3>${label}</h3>${field("¿Aplica?", ["No", "Sí"], "select", "Selecciona Sí si la actividad requiere revisión o permisos.", true, `ethics:${i}:applies`)}${field(`Justificación específica`, reason, "textarea", "Indica entidad, estado, mitigación y plazo si corresponde.", true, `ethics:${i}:reason`)}</section>`).join("")}</div></details><details class="accordion"><summary>Producción, difusión y hoja de ruta</summary><p><strong>${totalHoras} h/semana:</strong> software + artículo sometido WoS/Scopus + manual técnico. Se asocian a OE2 y OE3.</p>${field("Difusión y socialización", "Sesión institucional y manual para responsables de las microcuencas, después de la revisión de PI.", "textarea")}${field("Hoja de ruta", "TRL 4 a 6: integrar, calibrar y validar en entorno relevante.", "textarea")}</details>`;
}

/**
 * Renderizar la sección de anexos y documentos probatorios adjuntos (Pantalla 17).
 * Despliega la zona de soltar archivos (dropzone) y el listado de documentos institucionales
 * obligatorios adjuntos (formulario oficial, plan, presupuesto, fundamentación).
 * parametros:
 *     (ninguno)
 * return:
 *     + string : docsFormHtml Marcado HTML de gestión documental.
 */
function documentsForm() {
  // [Línea clave]: Los archivos elegidos en el borrador se guardan en memoria y se suben al confirmar el envío.
  const esperados = ["Formulario institucional", "Plan de acción y riesgos", "Presupuesto 2027–2028", "Fundamentación"];
  const adjuntos = archivosBorrador.length
    ? archivosBorrador
        .map((d, i) => {
          const icono = /xlsx/i.test(d.file.name) ? "XLSX" : /docx/i.test(d.file.name) ? "DOCX" : "PDF";
          return `<div class="doc-row"><span class="doc-icon">${icono}</span><div class="grow"><strong>${esc(d.file.name)}</strong><small>${esc(d.tipo)} · ${formatBytes(d.file.size)} · Se sube al confirmar el envío</small></div>${act("Quitar", "remove-draft-doc", "text compact", "", `data-index="${i}"`)}</div>`;
        })
        .join("")
    : notice("Aún no has adjuntado documentos", "Puedes enviar la propuesta sin documentos y adjuntarlos después desde Seguimiento (pantalla 20).");
  const pendientes = esperados
    .filter((tipo) => !archivosBorrador.some((d) => d.tipo === tipo))
    .map((tipo) => docPendiente(tipo, "Opcional"))
    .join("");
  return `${adjuntos}<div class="action-row mt">${act("Adjuntar documento", "upload", "secondary", "plus")}</div><div class="mt">${pendientes}</div><div class="mt">${notice("Los archivos se envían con la propuesta", "Al confirmar el envío se registra la propuesta y se suben estos archivos reales a su expediente (PDF, DOCX, XLSX o PPTX, máximo 20 MB).")}</div><div class="mt">${notice("Dictámenes y acuerdos se agregan en su etapa", "El dictamen de Vinculación precede al Comité; los avales se requieren para el sometimiento formal. No se exige un documento antes de que pueda ser emitido.")}</div>`;
}

/**
 * Renderizar la pantalla de verificación global previa al envío a revisión (Pantalla 18).
 * Realiza un chequeo integral de completitud de secciones (datos, objetivos, plan, presupuesto, documentos),
 * mostrando el estado de cada una y requiriendo confirmación de revisión antes de habilitar el botón de envío.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : reviewFormHtml Marcado HTML del resumen de verificación.
 */
function reviewForm() {
  const issues = proposalValidationIssues();
  const afectadas = new Set(issues.map((i) => i.screen));
  const ok = issues.length === 0;
  const titulo = draftValue("08:Título de la propuesta", screenDefault("08", "Título de la propuesta"));
  const modalidad = (modalidades ?? []).find((m) => Number(m.id) === Number(state.modeId))?.titulo || state.mode;
  const filas = [
    ["Datos y equipo", "08", !afectadas.has("08") && !afectadas.has("09")],
    ["Fundamentación y objetivos", "10", !afectadas.has("10") && !afectadas.has("11")],
    ["Metodología y plan", "12", !afectadas.has("12") && !afectadas.has("13")],
    ["Gestión de riesgos", "14", !afectadas.has("14")],
    ["Presupuesto anual", "15", !afectadas.has("15")],
    ["Ética y propiedad intelectual", "16", !afectadas.has("16")],
    [`Documentos (${archivosBorrador.length} adjunto${archivosBorrador.length === 1 ? "" : "s"}, opcionales)`, "17", true],
  ];
  return `<div class="mb"><span class="project-code">${esc(state.clientUuid ? "Borrador listo para registrar" : "Nueva propuesta")} · ${esc(modalidad || "Modalidad")}</span><h2>${esc(titulo)}</h2><p class="small muted" style="margin-top:8px">${esc(draftValue("08:Fecha de inicio", "2027-01-01"))} – ${esc(draftValue("08:Fecha de finalización", "2028-12-31"))} · ${money(totalA() + totalB())} · Versión 1.0</p></div><div class="review-grid">${filas
    .map(
      ([a, b, c]) =>
        `<div class="review-row"><span class="ok">${c ? "✓" : "!"}</span><span>${a}<br><span class="micro muted">${c ? "Completo" : "Requiere corrección"}</span></span><button data-go="${b}">Revisar</button></div>`,
    )
    .join(
      "",
    )}</div><div class="mt">${notice("Próxima etapa: Vinculación", "La propuesta se registrará con estado «En revisión de Vinculación» y la evaluación preliminar IA se generará en el servidor.")}</div><label class="checkline mt"><input type="checkbox" id="reviewed" ${state.reviewed ? "checked" : ""}>He revisado la información y los documentos.</label>${!ok ? notice("Aún no puedes enviar", issues.map((i) => i.text).join(" · "), "warning") : ""}`;
}

/**
 * Renderizar la pantalla de confirmación tras registrar el envío de la propuesta (Pantalla 19).
 * Despliega un mensaje de éxito con el código de propuesta, instancia revisora actual y fecha de radicación.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : confirmHtml Marcado HTML de confirmación.
 */
function confirmation() {
  const creada = state.created;
  const codigo = creada?.code || "SI-2027-014";
  const titulo = creada?.title || draftValue("08:Título de la propuesta", screenDefault("08", "Título de la propuesta"));
  const fecha = creada?.date
    ? new Date(creada.date).toLocaleDateString("es-CR", { day: "2-digit", month: "long", year: "numeric" })
    : new Date().toLocaleDateString("es-CR", { day: "2-digit", month: "long", year: "numeric" });
  return shell(
    `<div class="card card-pad" style="max-width:850px;margin:auto;padding:42px"><div style="width:56px;height:56px;border-radius:50%;background:var(--soft);display:grid;place-items:center;margin-bottom:22px">${icon("check")}</div><h2 style="font-size:28px">Tu propuesta fue registrada</h2><p class="small muted" style="margin:12px 0 30px">Se guardó la versión 1.0 de <strong>${esc(codigo)}</strong> · ${esc(titulo)}. Podrás consultar cada cambio desde el seguimiento.</p>${definition(
      [
        ["Estado", badge("En revisión de Vinculación")],
        ["Responsable actual", "Centro de Vinculación"],
        ["Registro", esc(fecha)],
        ["Siguiente etapa", "Evaluación del Comité Técnico"],
      ],
    )}<div class="mt">${notice("Este envío no es el sometimiento formal", "Una vez que obtengas la evaluación técnica y los avales, deberás someter la propuesta ante VIE el 28 de septiembre.")}</div><div class="action-row mt">${btn("Ver seguimiento", "20", "", "arrow")}${btn("Mis propuestas", "06", "secondary")}</div></div>`,
    "Confirmación de envío",
    "",
  );
}

/**
 * Lista secuencial de estados que atraviesa un expediente en el SGPI.
 * Define el ordenamiento de etapas desde 'En formulación' hasta 'Cerrada'.
 * En tracking() para calcular la posición en la línea de progreso del expediente.
 * atributos:
 *     * string : 0 'En formulación'
 *     * string : 1 'En revisión de Vinculación'
 *     * string : 2 'En evaluación técnica'
 *     * string : 3 'Avalada'
 *     * string : 4 'Sometida'
 *     * string : 5 'Dictaminada'
 *     * string : 6 'Resuelta'
 *     * string : 7 'Aceptada'
 *     * string : 8 'En ejecución'
 *     * string : 9 'Cerrada'
 */
const stageList = [
  "En formulación",
  "En revisión de Vinculación",
  "En evaluación técnica",
  "Avalada",
  "Sometida",
  "Dictaminada",
  "Resuelta",
  "Aceptada",
  "En ejecución",
  "Cerrada",
];

// [Línea clave]: ¿Por qué soy importante? Traduce los nombres oficiales de estado de PostgreSQL
// a las etapas que usa la línea de tiempo del seguimiento. ¿Para qué? Que la pantalla 20 refleje el
// estado real del expediente. ¿Dónde me usan? En tracking() y en los paneles de estado del frontend.
const ESTADOS_BACKEND_A_ETAPA = {
  "En formulación": "En formulación",
  "En revisión de Vinculación": "En revisión de Vinculación",
  "En evaluación del Comité Técnico": "En evaluación técnica",
  "Pendiente de aval del Consejo": "En evaluación técnica",
  "Avalada": "Avalada",
  "Sometida ante VIE": "Sometida",
  "Dictaminada por Dirección": "Dictaminada",
  "Aprobada por CIE": "Resuelta",
  "Con observaciones": "Con observaciones",
  "Rechazada": "Rechazada",
  "En ejecución": "En ejecución",
  "Cerrada": "Cerrada",
};

function normalizarEstado(nombre) {
  return ESTADOS_BACKEND_A_ETAPA[nombre] || nombre || "En formulación";
}
/**
 * Renderizar la pantalla de seguimiento del ciclo de vida de la propuesta (Pantalla 20).
 * Evalúa el estado del expediente en la máquina de estados stageList, determina la acción pendiente
 * (someter formalmente, adjuntar carta de aceptación, subsanar observaciones, presentar informes),
 * y muestra la línea de tiempo vertical con el actor institucional responsable de cada etapa.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : trackingHtml Marcado HTML de la vista de seguimiento.
 */
function tracking() {
  // [Línea clave]: ¿Por qué soy importante? Consulta el expediente real de la propuesta activa.
  // ¿Para qué? Mostrar la etapa actual, documentos y ruta del proceso según PostgreSQL y no solo el estado local.
  // ¿Dónde me usan? En la pantalla 20 al entrar desde el menú o desde la confirmación de envío.
  const idActivo = propuestaActivaId();
  const d = dossierActual && Number(dossierActual.id_propuesta) === Number(idActivo) ? dossierActual : null;
  const stage = normalizarEstado(d?.nombre_estado || state.stage);
  const ix = stageList.indexOf(stage),
    stateText = stage;
  let action = notice(
    "Tu expediente está en revisión",
    "Recibirás una notificación cuando haya una decisión o se requieran ajustes.",
  );
  if (stage === "Avalada")
    action =
      notice(
        "Tu propuesta ya cuenta con aval",
        "El investigador debe someterla formalmente el 28 sep 2026.",
      ) +
      `<div class="mt">${act("Someter propuesta", "submit", "", "arrow")}</div>`;
  if (stage === "Resuelta")
    action =
      notice(
        "Resolución favorable del CIE",
        "Presenta la carta de aceptación durante el período del 2 al 6 de noviembre.",
      ) +
      `<div class="mt">${act("Presentar carta de aceptación", "acceptance", "", "upload")}</div>`;
  if (stage === "Aceptada")
    action = notice(
      "Carta de aceptación registrada",
      "La ejecución comienza el 1 ene 2027.",
    );
  if (stage === "Con observaciones")
    action =
      notice(
        "Se requieren ajustes",
        "Completa la justificación del riesgo de campo y vuelve a enviar la versión corregida.",
        "warning",
      ) +
      `<div class="mt">${btn("Atender observaciones", "14", "", "edit")}</div>`;
  if (stage === "Rechazada")
    action = notice(
      "Resolución: no aprobada",
      "Consulta el acuerdo motivado del CIE en el expediente. La resolución no habilita aceptación ni ejecución.",
      "warning",
    );
  if (stage === "En ejecución")
    action =
      notice(
        "Proyecto en ejecución",
        "Registra informes y productos; el cierre requiere el informe final y oficio de Vinculación.",
      ) +
      `<div class="mt">${act("Presentar informe", "report", "secondary", "upload")}</div>`;
  if (stage === "Cerrada")
    action = notice(
      "Expediente cerrado",
      "El expediente conserva documentos e historial y está disponible solo para consulta.",
    );
  const creada = state.created || {};
  const trackCode = d?.codigo || creada.code || state.viewProposal || "SI-2027-014";
  const trackTitle = d?.titulo || creada.title || draftValue("08:Título de la propuesta", PROPOSAL_DEFAULTS["08:Título de la propuesta"]);
  const trackAmount = d
    ? (d.presupuesto || []).reduce((total, fila) => total + Number(fila.monto || 0), 0)
    : Number(creada.amount) || totalA() + totalB();
  const trackHours = totalHorasEquipo();
  const periodo = d?.fecha_inicio && d?.fecha_fin
    ? `${String(d.fecha_inicio).slice(0, 4)}–${String(d.fecha_fin).slice(0, 4)}`
    : "2027–2028";
  const documentosEtapa = `${
    (d?.documentos || []).length
      ? d.documentos.map(docPropuesta).join("")
      : docPendiente("Sin documentos registrados", "Usa el botón para adjuntar el primer archivo real.")
  }<div class="action-row mt">${act("Adjuntar documento", "upload", "secondary", "plus")}</div>`;
  return shell(
    `<div class="two-col"><div class="stack">${card(esc(d?.titulo || trackTitle), `<span class="project-code">${esc(trackCode)} · Versión 1.0</span><div class="action-row mt mb">${badge(stateText, "solid")}${badge(d?.nombre_modalidad || state.mode || "Desarrollo tecnológico")}</div>${action}<div class="stat-strip"><div><strong>${money(trackAmount)}</strong><span>Monto solicitado</span></div><div><strong>${esc(periodo)}</strong><span>Período de ejecución</span></div><div><strong>${trackHours} h</strong><span>Dedicación semanal</span></div></div>`)}${card("Documentos de la etapa", documentosEtapa)}</div>${card("Ruta del expediente", `<div class="timeline">${stageList.map((s, i) => `<div class="event ${s === stage ? "current" : ""}"><h3>${i < ix ? "✓ " : ""}${s}</h3><p>${["Investigador", "Vinculación", "Comité Técnico", "Consejos de Escuela", "Investigador → VIE", "Dirección de Investigación", "CIE", "Investigador", "Equipo investigador", "Dirección de Investigación"][i]}</p></div>`).join("")}</div>`)}</div>`,
    "Seguimiento de propuesta",
    "Consulta la etapa actual y la próxima acción que te corresponde.",
    btn("Abrir expediente", "22", "secondary", "folder"),
  );
}

/**
 * Renderizar la bandeja de trabajo para comisiones evaluadoras e instancias de dictamen (Pantalla 21).
 * Despliega tarjetas métricas (Pendientes, En revisión, Finalizadas) y la tabla de expedientes asignados
 * con enlace directo para abrir el expediente completo.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : inboxHtml Marcado HTML de la bandeja de trabajo.
 */
function inbox() {
  const list = state.role === "vinculacion" ? bandejaPropuestas || [] : top3propuestasmasrecientes || [];
  const closedStatuses =
    state.role === "vinculacion"
      ? ["En evaluación del Comité Técnico", "Con observaciones", "Rechazada", "Aprobada por CIE", "Cerrada", "Resuelta"]
      : ["Cerrada", "Rechazada", "Aprobada por CIE", "Resuelta"];
  const pending = list.filter((p) => !closedStatuses.includes(p.status));
  const closed = list.filter((p) => closedStatuses.includes(p.status));

  let filtered = activeFilter === "Finalizadas" ? closed : pending;
  if (activeFilter === "En revisión") filtered = pending.filter((p) => p.status.includes("revisión") || p.status.includes("evaluación"));

  const rows = filtered.map((p) => [
    `<span class="project-code">${esc(p.code)}</span><strong>${esc(p.title)}</strong><br><span class="micro muted">${esc(p.leader || "Investigador")} · ${esc(p.school || "TEC")}</span>`,
    esc(p.type),
    badge(p.status),
    btn("Abrir expediente", "22", "secondary compact", "arrow", `data-proposal="${p.code}" data-proposal-id="${p.id || ""}"`),
  ]);

  return shell(
    `<div class="grid three mb">${[
      ["Pendientes de revisión", String(pending.length)],
      ["En evaluación / revisión", String(pending.filter((p) => p.status.includes("revisión") || p.status.includes("evaluación")).length)],
      ["Finalizadas en la convocatoria", String(closed.length)],
    ]
      .map(
        ([a, b]) =>
          `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
      )
      .join(
        "",
      )}</div>${tabs(["Pendientes", "En revisión", "Finalizadas"], activeFilter === "Todas" ? "Pendientes" : activeFilter, "data-filter")}<div class="card">${table(["Expediente", "Modalidad", "Etapa", ""], rows.length ? rows : [[`<span class="muted">No hay expedientes para este filtro</span>`, "", "", ""]])}</div>`,
    "Bandeja de trabajo",
    "Expedientes asignados a tu instancia en Fondos VIE 2027.",
    "",
  );
}

/**
 * Renderizar la vista integral del expediente digital de una propuesta (Pantalla 22).
 * Despliega pestañas de contenido (Resumen, Documentos, Evaluaciones, Resolución, Historial),
 * garantizando la inmutabilidad si el expediente está cerrado o resuelto y permitiendo
 * el acceso contextual a la pantalla de dictamen correspondiente al rol autenticado.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : dossierHtml Marcado estructurado del expediente digital.
 */
function dossier() {
  // [Línea clave]: ¿Por qué soy importante? Resuelve el expediente activo desde PostgreSQL o desde el escenario local. ¿Para qué? Mostrar metadatos y decisiones reales de la propuesta seleccionada en la bandeja. ¿Dónde me usan? Al inicio de dossier().
  const idActivo = propuestaActivaId();
  const d = dossierActual && Number(dossierActual.id_propuesta) === Number(idActivo) ? dossierActual : null;
  const code = d?.codigo || state.created?.code || state.viewProposal || "SI-2027-014";
  const historical = !d && !state.created && code !== "SI-2027-014";
  const amount = d
    ? (d.presupuesto || []).reduce((total, fila) => total + Number(fila.monto || 0), 0)
    : Number(state.created?.amount) || totalA() + totalB();
  const p = d
    ? {
        id: Number(d.id_propuesta),
        code: d.codigo || code,
        title: d.titulo,
        type: d.nombre_modalidad || state.mode || "Desarrollo tecnológico",
        period: d.fecha_inicio && d.fecha_fin ? `${String(d.fecha_inicio).slice(0, 4)}–${String(d.fecha_fin).slice(0, 4)}` : "2027–2028",
        status: d.nombre_estado || state.stage,
        amount,
        leader: d.nombre_lider || "Investigador",
        school: d.nombre_escuela || d.siglas_escuela || "Instancia coordinadora",
        line: d.nombre_linea || "Línea institucional",
        resumen: d.resumen,
      }
    : (top3propuestasmasrecientes || []).find((x) => x.code === code) || {
        code: code,
        title: state.created?.title || draftValue("08:Título de la propuesta", PROPOSAL_DEFAULTS["08:Título de la propuesta"]),
        type: state.mode || "Desarrollo tecnológico",
        period: "2027–2028",
        status: state.stage,
        amount,
        leader: "Dra. Laura Méndez",
        school: escuelas?.[0]?.nombre || "Instancia coordinadora",
        line: lineas_investigacion?.[0]?.nombre || "Línea institucional",
        resumen: historical ? "Estudio sobre el recurso hídrico con resultados conservados en el expediente." : draftValue("08:Resumen", PROPOSAL_DEFAULTS["08:Resumen"]),
      };
  const isClosed = ["Cerrada", "Rechazada", "Aprobada por CIE", "Resuelta"].includes(p.status);

  let body;
  if (dossierTab === "Resumen")
    body = `${definition([
      ["Coordinadora / Líder", esc(p.leader)],
      ["Instancia", esc(p.school)],
      ["Período", esc(p.period)],
      ["Monto solicitado", money(p.amount)],
      ["Modalidad", esc(p.type)],
      ["Línea de investigación", esc(p.line)],
    ])}<div class="mt"><h3>Resumen de la investigación</h3><p class="small muted" style="margin-top:10px">${esc(p.resumen || "Sin resumen registrado.")}</p></div><div class="mt">${notice(isClosed ? "Consulta de expediente cerrado o resuelto" : "Expediente digital sincronizado con PostgreSQL", isClosed ? "La información se conserva para consulta. No se pueden modificar documentos ni decisiones." : "Propuesta, equipo, plan, presupuesto y decisiones conservan su versión y responsable con trazabilidad en base de datos.")}</div>`;
  else if (dossierTab === "Documentos") {
    const docs = d?.documentos || [];
    body = docs.length
      ? docs.map(docPropuesta).join("")
      : docPendiente("Sin documentos registrados", "Los archivos se adjuntan desde el expediente y quedan vinculados a la propuesta.");
  } else if (dossierTab === "Evaluaciones") {
    const puntajeIA = evaluacionPreliminarIA ? `${Number(evaluacionPreliminarIA.puntaje_preliminar).toFixed(1)}/100 · ${evaluacionPreliminarIA.recomendacion_global}` : "87.8/100 · Recomendada (Preliminar)";
    const vin = d?.vinculacion_evaluaciones || [];
    const filas = [
      ["IA Preliminar (Gemini Free Tier)", puntajeIA, act("Ver dictamen IA", "modal-ai-detail", "text")],
    ];
    if (vin.length) {
      vin.forEach((e) => filas.push([
        "Vinculación",
        esc(`${e.numero_oficio_dictamen} · ${e.potencial_pi_identificado ? "Potencial de PI identificado" : "Sin potencial de PI"}`),
        `<button class="btn text" data-go="28">Ver dictamen</button>`,
      ]));
    } else {
      filas.push(["Vinculación", "Sin dictamen registrado", act("Ver dictamen", "preview", "text")]);
    }
    filas.push(["Comité Técnico", "Recomendada", act("Ver rúbrica", "rubric-summary", "text")]);
    filas.push(["Consejo de Escuela", "Aval otorgado", act("Ver acuerdo", "preview", "text")]);
    body = table(["Instancia", "Resultado", "Documento"], filas);
  } else if (dossierTab === "Resolución") {
    const cie = (d?.evaluaciones || []).find((e) => e.rol_evaluador === "CIE");
    const docs = (d?.documentos || []).filter((doc) => /resoluc|acuerdo|cie|cierre/i.test(`${doc.tipo_documento} ${doc.nombre_archivo}`));
    body = `${notice(isClosed ? "Resolución y cierre registrados" : "Decisión del CIE", isClosed ? "Acuerdo favorable y certificación de cierre conservados en PostgreSQL." : cie ? `Resolución registrada: ${cie.observaciones || "sin detalle adicional"}` : "La resolución se agrega cuando el CIE concluye su revisión.")}${docs.length ? docs.map(docPropuesta).join("") : docPendiente("Acuerdo del CIE", "Pendiente de emisión")}${isClosed ? docPendiente("Certificación de cierre", "Pendiente de adjuntar") : ""}`;
  } else {
    body = historyContent(d);
  }

  const accion = historical
    ? `<p class="small muted mb">Este expediente está disponible en modo consulta.</p>${btn("Volver a resultados", "30", "secondary")}`
    : state.role === "investigador"
      ? `<p class="small muted mb">Consulta la etapa y las acciones pendientes de tu propuesta.</p>${btn("Ver seguimiento", "20", "", "arrow")}`
      : `<p class="small muted mb">Actúas como ${roles[state.role].label}.</p>${btn(
          p.status === "En revisión de Vinculación" ? "Iniciar revisión" : "Consultar dictamen",
          roles[state.role].screen,
          "",
          "arrow",
        )}`;

  return shell(
    `<div class="card card-pad mb"><span class="project-code">${esc(p.code)} · ${esc(p.type)}</span><div class="section-head" style="margin:10px 0 0"><h2 style="font-size:26px">${esc(p.title)}</h2>${badge(p.status, "solid")}</div></div>${tabs(["Resumen", "Documentos", "Evaluaciones", "Resolución", "Historial"], dossierTab)}<div class="two-col">${card("", body)}<div class="stack">${card("Acción disponible", accion)}${renderizarPanelReferenciaIA("22")}${card("Trazabilidad", `<p class="small muted mb">Cada decisión conserva fecha, actor, documento y versión en PostgreSQL.</p>${btn("Ver historial completo", "28", "text", "arrow")}`)}${["direccion", "cie"].includes(state.role) ? notice("Verificación restringida", "Responsabilidades institucionales: al día.") : ""}</div></div>`,
    "Expediente de propuesta",
    "Toda la información y las decisiones en un mismo lugar.",
    btn(
      "Volver",
      state.role === "investigador" ? "06" : "21",
      "secondary",
      "back",
    ),
  );
}

/**
 * Matriz estructurada de criterios de evaluación de la rúbrica oficial de Desarrollo Tecnológico.
 * Agrupa criterios por sección temátiva con su nombre, peso porcentual (peso ponderado)
 * y una bandera booleana indicando si es de carácter eliminatorio/obligatorio.
 * En scoreResult() y evaluation("24") para calcular la calificación ponderada y validar umbrales mínimos.
 * atributos:
 *     * string : 0 Nombre del grupo temático (Equipo, Fundamentación, Metodología, etc.).
 *     * Array<[string, number, boolean]> : 1 Lista de tuplas [nombreCriterio, peso, esObligatorio].
 */
const criterionGroups = [
  [
    "Equipo",
    [
      ["Composición disciplinaria", 3],
      ["Experiencia", 3],
      ["Articulación del equipo", 3],
      ["Vinculación externa", 2],
      ["Trayectoria de coordinación", 2],
      ["Participación estudiantil", 2, true],
    ],
  ],
  [
    "Fundamentación",
    [
      ["Definición del problema", 4],
      ["Coherencia de objetivos", 4],
      ["Diagnóstico y vacío de conocimiento", 4, true],
    ],
  ],
  [
    "Metodología",
    [
      ["Rigor del desarrollo", 8, true],
      ["Usuarios y validación", 7, true],
    ],
  ],
  [
    "Plan de acción",
    [
      ["Claridad de actividades y responsables", 4, true],
      ["Giras y actividades académicas", 4, true],
      ["Trazabilidad y plazos", 5, true],
    ],
  ],
  [
    "Presupuesto",
    [
      ["Coherencia y topes", 4, true],
      ["Equipamiento en primer año", 4, true],
      ["Otros fondos", 2],
    ],
  ],
  [
    "Riesgos",
    [
      ["Identificación por actividad", 4, true],
      ["Viabilidad de mitigación", 4, true],
    ],
  ],
  [
    "Ética y PI",
    [
      ["Declaración ética", 4, true],
      ["Gestión de propiedad intelectual", 6, true],
    ],
  ],
  [
    "Pertinencia e impacto",
    [
      ["Contribución e impacto", 10],
      ["Innovación", 7],
    ],
  ],
];
/**
 * Obtener la calificación asignada a un criterio específico de la rúbrica.
 * Consulta en state.scores[name]; si no existe, asigna 10 a criterios clave o 8 por defecto.
 * parametros:
 *     - string : name Nombre descriptivo del criterio evaluado.
 * return:
 *     + number : puntaje Valor numérico de evaluación (0, 6, 8 o 10).
 */
const scoreValue = (name) =>
  state.scores[name] ??
  (name === "Contribución e impacto" ||
  name === "Rigor del desarrollo" ||
  name === "Gestión de propiedad intelectual"
    ? 10
    : 8);

/**
 * Calcular la nota final ponderada de la evaluación técnica y determinar si es recomendada.
 * Itera los grupos de criterionGroups ponderando cada nota por su peso relativo,
 * y verifica si algún criterio obligatorio obtuvo nota menor a 8 (bloqueo automático).
 * parametros:
 *     (ninguno)
 * return:
 *     + Object : resultado Objeto con { sum: number, recommended: boolean, blocked: boolean }.
 */
function scoreResult() {
  let sum = 0,
    blocked = false;
  for (const [g, cs] of criterionGroups)
    for (const [name, w, mandatory] of cs) {
      const val = Number(scoreValue(name));
      sum += (w * val) / 10;
      // [Línea clave]: ¿Por qué soy importante? Regla de oro de la VIE: criterios obligatorios requieren nivel Bueno (8) o Excelente (10). ¿Para qué? Impedir recomendación si falla un requisito de fondo aunque la nota supere 70. ¿Dónde me usan? En el cálculo de scoreResult().
      if (mandatory && val < 8) blocked = true;
    }
  return {
    sum: Math.round(sum * 10) / 10,
    recommended: sum >= 70 && !blocked && !state.notRecommended,
    blocked,
  };
}

/**
 * Renderizar las pantallas de dictamen y evaluación según la instancia responsable (Pantallas 23 a 27).
 * Genera el formulario respectivo:
 *  - 23: Revisión de Vinculación (dictamen técnico y potencial de PI)
 *  - 24: Comité Técnico (rúbrica con rúbricas ponderadas y validación de obligatorios)
 *  - 25: Consejo de Escuela (acuerdo de aval con sesión y artículo)
 *  - 26: Dirección de Investigación (verificación formal de requisitos previos)
 *  - 27: CIE (resolución oficial aprobada/rechazada y justificación)
 * parametros:
 *     - string : id Identificador de pantalla de evaluación ('23', '24', '25', '26' o '27').
 * return:
 *     + string : evalHtml Marcado HTML de la vista de evaluación.
 */
function evaluation(id) {
  const names = {
    23: "Revisión de Vinculación",
    24: "Evaluación técnica",
    25: "Aval del Consejo de Escuela",
    26: "Dictamen de Dirección",
    27: "Resolución del CIE",
  };
  let inner = "";
  if (id === "23") {
    const ev = evaluacionVinculacion || {};
    const piOpts = [
      { value: "true", label: "Sí · existe potencial de protección" },
      { value: "false", label: "No · sin potencial identificado" },
    ];
    if (ev.potencial_pi_identificado === false) piOpts.reverse();
    const documentoVinculacion = documentosVinculacion[0];
    const yaDictaminado = !!ev.id_evaluacion;
    inner = `${notice(yaDictaminado ? "Dictamen ya registrado" : "Dictamen requerido", yaDictaminado ? `Oficio ${ev.numero_oficio_dictamen || "sin número"}. La propuesta ya fue remitida con la valoración de Vinculación; este formulario queda en modo consulta.` : "Registra el oficio firmado y la valoración técnica de Vinculación antes de remitir al Comité Técnico.")}<div class="mt">${field("Potencial de PI identificado", piOpts, "select", "Indica si el activo puede protegerse o requiere reserva.", true, "vinculacion:potencial_pi")}${field("Tipo de innovación", ev.tipo_innovacion || "Software / Desarrollo tecnológico", "text", "Clasificación del activo o resultado esperado.", false, "vinculacion:tipo_innovacion")}${field("Activo previsto", ev.activo_previsto || "Software de integración, registro de mediciones y documentación técnica.", "textarea", "Describe el activo que se resguardará.", true, "vinculacion:activo_previsto")}${field("Valoración técnica", ev.valoracion_tecnica || "Se identifica potencial de protección en el software. Documentar autoría y resultados, y coordinar divulgación con Vinculación.", "textarea", "", true, "vinculacion:valoracion")}${field("Oficio del dictamen", ev.numero_oficio_dictamen || "CV-014-2026", "text", "Número de oficio emitido por Vinculación.", true, "vinculacion:oficio")}${field("Requiere reserva o resguardo previo", ev.requiere_reserva === true, "checkbox", "Marca si la divulgación debe restringirse antes de proteger el activo.", false, "vinculacion:reserva")}${yaDictaminado ? "" : `<div class="field"><label for="vinculacion-doc">Oficio firmado (PDF, DOCX)</label><input id="vinculacion-doc" type="file" accept=".pdf,.docx"><span class="help">Máximo 20 MB. Se almacena en el expediente de la propuesta.</span></div>`}${documentoVinculacion ? docPropuesta(documentoVinculacion) : yaDictaminado ? "" : notice("Adjunto pendiente", "Puedes registrar el dictamen y adjuntar el oficio firmado en la misma acción.")}</div>`;
  }
  if (id === "24") {
    const sc = scoreResult();
    inner = `${notice("Rúbrica oficial · Desarrollo tecnológico", "Deficiente 0 · Regular 6 · Bueno 8 · Excelente 10. Un obligatorio con 0 o 6 impide recomendar, aun con nota ≥70.")}<div class="mt">${criterionGroups
      .map(
        ([g, cs], i) =>
          `<details class="accordion" ${i < 2 ? "open" : ""}><summary>${g} <span class="muted small">· ${cs.reduce((a, c) => a + c[1], 0)}%</span></summary>${table(
            ["Criterio", "Peso", "Nivel"],
            cs.map(([n, w, m]) => [
              `<strong>${n}</strong>${m ? '<br><span class="micro">Obligatorio</span>' : ""}`,
              w + "%",
              `<select data-score="${esc(n)}" aria-label="Nivel: ${esc(n)}" style="padding:8px;border:1px solid var(--line);border-radius:6px">${[
                [0, "Deficiente"],
                [6, "Regular"],
                [8, "Bueno"],
                [10, "Excelente"],
              ]
                .map(
                  ([v, l]) =>
                    `<option value="${v}" ${v === Number(scoreValue(n)) ? "selected" : ""}>${l} · ${v}</option>`,
                )
                .join("")}</select>`,
            ]),
          )}</details>`,
      )
      .join(
        "",
      )}</div><label class="checkline"><input type="checkbox" id="products-ok" ${!state.notRecommended ? "checked" : ""}>Producción no sumativa conforme: software + artículo WoS/Scopus + manual técnico para ${totalHorasEquipo()} h.</label>${field("Justificación de criterios obligatorios", "La propuesta identifica responsables, plazos, beca, riesgos y declaración ética; consta dictamen de Vinculación.", "textarea", "Justifica los criterios obligatorios con referencia a la evidencia.", true)}<div id="score-result" class="notice ${sc.recommended ? "" : "warning"}"><div><strong>${sc.sum.toFixed(1)} / 100 · ${sc.recommended ? "Recomendada" : "No recomendada"}</strong><p>${sc.blocked ? "Hay un criterio obligatorio con nivel insuficiente." : "La recomendación depende de la nota y de los requisitos obligatorios."}</p></div></div>`;
  }
  if (id === "25")
    inner = `${notice("El aval no somete automáticamente", "Después del acuerdo, el investigador realiza el sometimiento formal ante VIE.")}<div class="mt">${field("Instancia", ["Escuela de Ingeniería Ambiental · Coordinadora", "Escuela de Ingeniería Electrónica · Participante"], "select", "Cada consejo avala a su propio personal.", true)}<div class="field-row">${field("Sesión y artículo", "18-2026 · Artículo 4", "text", "", true)}${field("Fecha del acuerdo", "2026-09-17", "date", "", true)}</div>${field("Oficio", "IA-AVAL-014-2026", "text", "", true)}${["Aval de la propuesta y presupuesto de ₡9.400.000", "Participación y horas del personal de la instancia", "Ratificación de la calificación del Comité Técnico"].map((t) => `<label class="checkline"><input type="checkbox" checked required>${t}</label>`).join("")}${docPendiente("Acuerdo firmado de la coordinadora", "Se adjunta tras el aval")}${docPendiente("Acuerdo firmado de instancia participante", "Se adjunta tras el aval")}</div>`;
  if (id === "26")
    inner = `${notice("Propuesta sometida el 28 sep 2026", "La Dirección verifica el expediente antes de emitir el dictamen para CIE.")}<div class="mt">${["Responsabilidades institucionales al día", "Riesgos por actividad y mitigación coherente", "Participación estudiantil presupuestada", "Declaración ética y permisos verificados", "Documentos, evaluación y acuerdos completos"].map((t) => `<label class="checkline"><input type="checkbox" checked required>${t}</label>`).join("")}</div>${field("Verificación restringida", "Al día", "readonly")}${field("Dictamen", ["Favorable", "Con observaciones", "Desfavorable"], "select", "", true)}${field("Fundamentación", "El expediente incorpora la evaluación, los avales y la documentación requerida. Se remite al CIE para resolución.", "textarea", "09 oct 2026.", true)}${docPendiente("Dictamen de Dirección", "Pendiente de emitir")}`;
  if (id === "27")
    inner = `${notice("Expediente con dictamen de Dirección", "Valora cumplimiento del proceso, responsabilidades, interés estratégico y disponibilidad de recursos.")}<div class="mt">${field("Resolución", ["Aprobada", "Rechazada", "Con observaciones"], "select", "", true, "resolution")}</div><div class="field-row">${field("Sesión y artículo", "23-2026 · Artículo 5", "text", "", true)}${field("Fecha de resolución", "2026-10-23", "date", "", true)}</div>${field("Fundamentación y condiciones", "La iniciativa es pertinente y cuenta con respaldo en el proceso previo. Se aprueba conforme al plan y presupuesto; debe presentarse carta de aceptación.", "textarea", "La decisión debe quedar motivada, incluidas las resoluciones negativas.", true)}${docPendiente("Acuerdo del CIE", "Pendiente de emitir")}`;
  const propActiva =
    dossierActual && Number(dossierActual.id_propuesta) === Number(propuestaActivaId())
      ? dossierActual
      : null;
  const refCode = propActiva?.codigo || state.viewProposal || "SI-2027-014";
  const refTitle = propActiva?.titulo || "Agua Inteligente: monitoreo de cuencas";
  const refLeader = propActiva?.nombre_lider || "Laura Méndez";
  const refSchool = propActiva?.nombre_escuela || "Ingeniería Ambiental";
  const refType = propActiva?.nombre_modalidad || "Desarrollo tecnológico";
  const refAmount = propActiva
    ? (propActiva.presupuesto || []).reduce((total, fila) => total + Number(fila.monto || 0), 0)
    : 9400000;
  const actionLabel = {
    23: "Emitir dictamen",
    24: "Registrar evaluación",
    25: "Registrar aval",
    26: "Emitir dictamen de Dirección",
    27: "Registrar resolución",
  }[id];
  const dictamenExistente = id === "23" && !!evaluacionVinculacion?.id_evaluacion;
  const accionesEvaluacion = dictamenExistente
    ? btn("Volver a la bandeja", "21", "secondary", "back")
    : `${act("Devolver con observaciones", "return", "secondary")}${act(actionLabel, "decision", "", "check", `data-step="${id}"`)}`;
  return shell(
    `<div class="two-col"><form class="card form-card" id="evaluation-form"><div class="form-title"><h2>${names[id]}</h2>${badge(dictamenExistente ? "Registrado" : "Pendiente")}</div>${inner}<div class="form-footer">${accionesEvaluacion}</div></form><div class="stack">${renderizarPanelReferenciaIA(id)}${card(
      "Expediente en revisión",
      `<span class="project-code">${esc(refCode)}</span><h3>${esc(refTitle)}</h3><p class="small muted" style="margin:10px 0 20px">${esc(refLeader)}<br>${esc(refSchool)}</p>${definition(
        [
          ["Modalidad", esc(refType)],
          ["Total", money(refAmount)],
          ["Período", "2027–2028"],
          ["Dedicación", `${totalHorasEquipo()} h/semana`],
        ],
      )}<div class="mt">${btn("Consultar expediente", "22", "secondary", "folder")}</div>`,
    )}${id === "24" ? card("Resultado ponderado", `<div class="score" id="score-number">${scoreResult().sum.toFixed(1)}<small> / 100</small></div><p class="small muted" style="margin:12px 0">Umbral de recomendación: 70.</p><div class="scorebar"><span style="width:${scoreResult().sum}%"></span></div><p class="micro muted" style="margin-top:16px">La producción y los requisitos obligatorios también deben cumplir.</p>`) : card("Trazabilidad", `<p class="small muted mb">La decisión quedará asociada a la persona, la fecha, el documento y la versión revisada.</p>${btn("Consultar historial", "28", "text", "arrow")}`)}</div></div>`,
    names[id],
    "Revisa la evidencia y registra una decisión motivada.",
  );
}
/**
 * Registro cronológico demostrativo de actuaciones y transiciones de estado del expediente.
 * Define tuplas [Fecha, Hito, Actor, Detalle/Oficio].
 * En historyContent() y history() para reconstruir la auditoría de actuaciones.
 * atributos:
 *     * string : 0 Fecha de la actuación.
 *     * string : 1 Título del hito procesal.
 *     * string : 2 Actor institucional responsable.
 *     * string : 3 Detalle del acuerdo o documento.
 */
const events = [
  [
    "21 ago 2026",
    "Envío a Vinculación",
    "Laura Méndez · Investigador",
    "Versión 1.0 registrada.",
  ],
  [
    "27 ago 2026",
    "Dictamen de Vinculación",
    "Mariana Solís · Vinculación",
    "CV-014-2026 · Potencial de software.",
  ],
  [
    "10 sep 2026",
    "Evaluación técnica registrada",
    "Gabriel Sánchez · Comité Técnico",
    "Rúbrica DT · Recomendación favorable.",
  ],
  [
    "17 sep 2026",
    "Avales incorporados",
    "Patricia Vargas · Consejo",
    "Coordinadora y participante · Acuerdos de aval.",
  ],
  [
    "28 sep 2026",
    "Sometimiento formal",
    "Laura Méndez · Investigador",
    "Expediente con evaluación y avales enviado a Dirección.",
  ],
  [
    "09 oct 2026",
    "Dictamen de Dirección",
    "Elena Chacón · Dirección",
    "DI-014-2026 · Favorable.",
  ],
  [
    "23 oct 2026",
    "Resolución CIE",
    "Ricardo Mora · CIE",
    "CIE-014-2026 · Aprobada.",
  ],
  [
    "03 nov 2026",
    "Carta de aceptación",
    "Laura Méndez · Investigador",
    "Carta registrada en el plazo de aceptación.",
  ],
];

/**
 * Construir el marcado visual de la línea de tiempo de auditoría histórica.
 * Mapea la colección events a nodos de timeline con marca temporal, título, actor y resumen.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : timelineHtml Marcado HTML de los hitos del expediente.
 */
function historyContent(d = null) {
  if (d?.historial?.length) {
    const fechaCorta = (valor) => {
      if (!valor) return "";
      const fecha = new Date(valor);
      return Number.isNaN(fecha.getTime())
        ? String(valor).slice(0, 10)
        : fecha.toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });
    };
    return `<div class="timeline">${d.historial
      .map(
        (item) => `<div class="event"><small>${esc(fechaCorta(item.fecha_cambio))}</small><h3>${esc(item.estado_nuevo || "Cambio de estado")}</h3><p>${esc(item.responsable_nombre || "Sistema")}</p><p>${esc(item.observaciones || (item.estado_anterior ? `Estado anterior: ${item.estado_anterior}` : ""))}</p></div>`,
      )
      .join("")}</div>`;
  }
  return `<div class="timeline">${events.map(([d, t, a, b]) => `<div class="event"><small>${d}</small><h3>${t}</h3><p>${a}</p><p>${b}</p></div>`).join("")}</div>`;
}

/**
 * Construir la tarjeta con el dictamen técnico real de Vinculación y sus oficios firmados.
 * parametros:
 *     - Object|null : d Expediente consolidado.
 * return:
 *     + string : dictamenHtml Tarjeta con oficio, valoración y documentos.
 */
function dictamenVinculacion(d = null) {
  const evaluacion = d?.vinculacion_evaluaciones?.[0];
  if (!evaluacion) return notice("Dictamen de Vinculación pendiente", "La propuesta aún no tiene un dictamen técnico registrado.");
  const documentos = (d?.documentos || []).filter((doc) =>
    /vincul|dictamen/i.test(`${doc.tipo_documento} ${doc.nombre_archivo}`),
  );
  return `${definition([
    ["Oficio", esc(evaluacion.numero_oficio_dictamen)],
    ["Evaluador", esc(evaluacion.evaluador_nombre || "Vinculación")],
    ["Potencial de PI", evaluacion.potencial_pi_identificado ? "Identificado" : "No identificado"],
    ["Tipo de innovación", esc(evaluacion.tipo_innovacion || "No indicado")],
    ["Activo previsto", esc(evaluacion.activo_previsto || "No indicado")],
    ["Valoración técnica", esc(evaluacion.valoracion_tecnica || "Sin detalle")],
    ["Reserva", evaluacion.requiere_reserva ? "Requiere resguardo previo" : "No requiere reserva"],
  ])}${documentos.length ? `<div class="mt">${documentos.map(docPropuesta).join("")}</div>` : ""}`;
}

/**
 * Renderizar la pantalla completa de historial y auditoría del expediente (Pantalla 28).
 * Encapsula historyContent() dentro del shell institucional con botón para retornar al expediente.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : historyHtml Marcado HTML de la pantalla de trazabilidad.
 */
function history() {
  const idActivo = propuestaActivaId();
  const d = dossierActual && Number(dossierActual.id_propuesta) === Number(idActivo) ? dossierActual : null;
  const code = d?.codigo || state.viewProposal || "SI-2027-014";
  return shell(
    `${card(`${esc(code)} · Historial de actuaciones`, historyContent(d))}${card("Dictamen de Vinculación", dictamenVinculacion(d))}`,
    "Historial del expediente",
    "Cada cambio conserva su responsable, fecha, versión y evidencia.",
    btn("Volver al expediente", "22", "secondary", "back"),
  );
}

/**
 * Renderizar la pantalla de consulta y búsqueda histórica de propuestas cerradas (Pantalla 29).
 * Construye el formulario con filtros combinados por escuela, modalidad, estado, línea de investigación
 * y rango de años para consultar expedientes concluidos.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : searchHtml Marcado HTML de la pantalla de búsqueda histórica.
 */
function searchHistory() {
  const opciones = (lista, idKey, labelKey, todas) => [
    { value: "", label: todas },
    ...(lista || []).map((item) => ({
      value: item[idKey] ?? item.id,
      label: item[labelKey] || String(item[idKey] ?? item.id),
    })),
  ];
  const escuelasOpts = opciones(escuelas?.length ? escuelas : catalogos?.escuelas, "id_escuela", "nombre", "Todas");
  const modalidadesOpts = opciones(modalidades?.length ? modalidades : catalogos?.modalidades, "id_modalidad", "nombre_modalidad", "Todas");
  const estadosOpts = opciones(catalogos?.estados, "id_estado", "nombre_estado", "Todos");
  const lineasOpts = opciones(lineas_investigacion?.length ? lineas_investigacion : catalogos?.lineas_investigacion, "id_linea_investigacion", "nombre_linea", "Todas");

  return shell(
    `<div class="two-col"><form class="card card-pad" id="history-search"><div class="section-head"><h2>Encuentra un expediente</h2>${badge("Consulta institucional en BD")}</div>${field("Código, título o persona investigadora", state.search, "search", "Puedes combinar la búsqueda con filtros institucionales.", false, "history:query")}<div class="field-row">${field("Escuela", escuelasOpts, "select", "", false, "history:school")}${field("Modalidad", modalidadesOpts, "select", "", false, "history:mode")}</div><div class="field-row">${field("Estado", estadosOpts, "select", "", false, "history:status")}${field("Línea de investigación", lineasOpts, "select", "", false, "history:line")}</div><div class="field-row">${field("Desde", "2024", "number", "", false, "history:from")}${field("Hasta", "2028", "number", "", false, "history:to")}</div>${field("Mostrar únicamente propuestas cerradas", false, "checkbox", "Excluye expedientes todavía en trámite.", false, "history:closed")}<div class="form-footer">${act("Limpiar filtros", "clear-search", "text")}${act("Buscar expedientes", "search-history", "", "search")}</div></form><div class="stack">${card("Consulta con trazabilidad", `<div class="list-item">${icon("folder")}<div><h3>Expediente completo</h3><p>Propuesta, recursos, documentos y productos.</p></div></div><div class="list-item">${icon("shield")}<div><h3>Decisiones y evidencia</h3><p>Evaluaciones, avales, dictámenes y resolución.</p></div></div><div class="list-item">${icon("clock")}<div><h3>Historial conservado</h3><p>Fechas, actores y versiones sincronizadas con PostgreSQL.</p></div></div>`)}</div></div>`,
    "Consulta histórica",
    "Busca iniciativas y recupera la evidencia de su recorrido.",
  );
}

/**
 * Renderizar los resultados de la consulta histórica institucional (Pantalla 30).
 * Despliega la tabla con los expedientes coincidentes recuperados desde la base de datos o el mensaje de sin coincidencias.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : resultsHtml Marcado HTML de la lista de resultados históricos.
 */
function historyResults() {
  const q = (state.search || "").toLowerCase(),
    list = historialPropuestas ?? [];
  return shell(
    `<div class="section-head"><span class="result-count">${list.length} expedientes encontrados en base de datos ${q ? "para «" + esc(state.search) + "»" : ""}</span>${btn("Modificar filtros", "29", "secondary", "settings")}</div>${list.length ? `<div class="card">${table(["Expediente", "Período", "Estado", "Monto", ""], projectRows(list), `<span>${list.length} resultado${list.length === 1 ? "" : "s"} desde PostgreSQL</span><span>Página 1 de 1</span>`)}</div>` : `<div class="card empty">${icon("search")}<h2>No encontramos coincidencias</h2><p>Prueba con una palabra más general o elimina un filtro para ampliar los resultados.</p>${act("Limpiar y volver a buscar", "clear-results", "secondary")}</div>`}`,
    "Resultados de consulta",
    "Abre un expediente para consultar sus documentos y decisiones.",
  );
}

/**
 * Renderizar el módulo de administración de convocatorias para Dirección/VIE (Pantalla 31).
 * Permite a la superadministración gestionar convocatorias, instrumentos, cronogramas y techos presupuestarios por modalidad.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : adminCallsHtml Marcado HTML de administración de convocatorias.
 */
function adminCalls() {
  return shell(
    `<div class="card mb">${table(["Convocatoria", "Ejecución", "Estado", ""], [['<strong>Fondos VIE 2027</strong><br><span class="micro muted">Disposiciones y cronograma vigentes</span>', "Desde 01 ene 2027", badge("Configurada"), act("Editar", "admin-call", "secondary compact", "edit")]])}</div><div class="grid two">${card("Cronograma de la convocatoria", table(["Etapa", "Fecha"], calendarRows), act("Editar", "admin-calendar", "text compact"))}${card(
      "Reglas por modalidad",
      table(
        ["Modalidad", "Duración", "Tope"],
        (modalidades ?? []).map((m) => [esc(m.titulo), esc(m.duracion), money(m.monto)]),
      ),
    )}</div>`,
    "Administración de convocatorias",
    "Configura instrumentos, plazos y modalidades desde Dirección/VIE.",
    act("Nueva convocatoria", "admin-call", "secondary", "plus"),
  );
}

/**
 * Renderizar la administración de catálogos maestros, rúbricas y orden de roles (Pantalla 32).
 * Despliega pestañas para rúbricas evaluativas, escuelas, líneas de investigación,
 * modalidades institucionales y reordenamiento de roles para pruebas de usabilidad.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : adminCatalogsHtml Marcado HTML de soporte y catálogos.
 */
function adminCatalogs() {
  const selected = activeFilter === "Todas" ? "Rúbricas" : activeFilter;
  const roleRows = (state.roleOrder || Object.keys(roles))
    .map(
      (key, i) =>
        `<div class="role-order-row"><strong>${i + 1}</strong><div><strong>${roles[key].label}</strong><div class="micro muted">${roles[key].name}</div></div><div class="role-order-actions"><button data-action="role-up" data-role="${key}" aria-label="Subir ${esc(roles[key].label)}" ${i === 0 ? "disabled" : ""}>↑</button><button data-action="role-down" data-role="${key}" aria-label="Bajar ${esc(roles[key].label)}" ${i === (state.roleOrder || []).length - 1 ? "disabled" : ""}>↓</button></div></div>`,
    )
    .join("");
  return shell(
    `${tabs(["Rúbricas", "Escuelas", "Líneas de investigación", "Modalidades", "Roles y permisos"], selected, "data-filter")}${
      selected === "Rúbricas"
        ? `<div class="grid three">${[
            ["Fortalecimiento", "20 · 15 · 15 · 8 · 10 · 7 · 25"],
            ["Básica y aplicada", "20 · 12 · 15 · 13 · 10 · 8 · 7 · 15"],
            ["Desarrollo tecnológico", "15 · 12 · 15 · 13 · 10 · 8 · 10 · 17"],
          ]
            .map(([a, b]) =>
              card(
                a,
                `${badge("Versión 2027")}<p class="small muted" style="margin:18px 0">Escala 0 / 6 / 8 / 10<br>Umbral 70% + obligatorios</p><p class="micro muted mb">Pesos por sección: ${b}</p>${act("Consultar rúbrica", "rubric-summary", "secondary")}`,
              ),
            )
            .join("")}</div>`
        : selected === "Roles y permisos"
          ? `<div class="two-col"><section class="card"><div class="card-pad"><h2>Orden de roles</h2><p class="small muted">Este orden se usa en el selector de perfiles del prototipo.</p></div><div class="role-order">${roleRows}</div></section>${card("Criterio de orden", `<p class="small muted">La superadministración puede priorizar la ruta operativa: proponente, revisiones, aval, dictamen y resolución.</p>${notice("Cambio reversible", "Usa las flechas para ajustar el orden. Los permisos de cada rol no cambian.")}`)}</div>`
          : `<div class="card">${table(
              ["Nombre", "Estado", ""],
              (selected === "Escuelas"
                ? ["Escuela de Ingeniería Ambiental", "Escuela de Ingeniería Electrónica"]
                : selected === "Modalidades"
                  ? ["Actividad de fortalecimiento", "Investigación básica", "Investigación aplicada", "Desarrollo tecnológico"]
                  : ["Gestión integrada del recurso hídrico", "Tecnologías de monitoreo ambiental"]
              ).map((x) => [
                x,
                badge("Activo"),
                act(
                  "Editar",
                  "catalog-edit",
                  "text compact",
                  "edit",
                  `data-value="${esc(x)}"`,
                ),
              ]),
            )}</div>`
    }<div class="mt">${notice("Conserva la versión de cada instrumento", "Una propuesta evaluada mantiene la rúbrica aplicada. Los cambios posteriores se registran para nuevas versiones de convocatoria.")}</div>`,
    "Rúbricas, catálogos y roles",
    "Parámetros de soporte administrados por la superadministración de Dirección/VIE.",
    selected === "Roles y permisos"
      ? ""
      : act("Agregar entrada", "catalog-edit", "secondary", "plus"),
  );
}
/**
 * Renderizar la pantalla de perfil del usuario y rol activo (Pantalla 33).
 * Despliega los datos de la cuenta activa (nombre, correo institucional, rol vigente y tema seleccionado)
 * con accesos directos para cambiar contraseña, contactar soporte y cambiar rol en demostración.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : profileHtml Marcado HTML de la vista de cuenta y perfil.
 */
function profile() {
  const p = person();
  return shell(
    `<div class="card card-pad" style="max-width:760px"><div class="action-row mb"><span class="avatar" style="width:60px;height:60px;font-size:20px">${esc(p.initials)}</span><div><h2>${esc(p.name)}</h2><span class="small muted">${p.label}</span></div></div>${definition(
      [
        [
          "Correo",
          esc(session ? session.user.correo : "cuenta.demo@example.com"),
        ],
        ["Rol activo", p.label],
        ["Tema", state.theme === "dark" ? "Oscuro" : "Claro"],
      ],
    )}<div class="action-row mt">${act("Ajustes y accesibilidad", "settings", "secondary", "settings")}${act("Contactar soporte", "contact", "text", "info")}</div></div><details class="accordion" style="max-width:760px;margin-top:28px"><summary>Opciones del prototipo</summary><div class="action-row mt">${act("Cambiar rol", "roles", "secondary", "user")}${act("Guía de recorridos", "guide", "text")}${act("Ver etapas", "stages", "text")}</div><p class="small muted mt">Los datos, documentos y decisiones son ejemplos para evaluar la interfaz.</p></details>`,
    "Mi perfil",
  );
}

/**
 * Salvaguardar el acceso a rutas protegidas verificando la compatibilidad con el rol activo.
 * Evalúa el identificador de pantalla contra la tabla de permisos de roles. Retorna false
 * si un usuario intenta navegar a una pantalla para la cual su rol no está facultado.
 * parametros:
 *     - string : id Identificador de pantalla a validar.
 * return:
 *     + boolean : autorizado Verdadero si el rol activo tiene autorización para acceder.
 */
function guardRoute(id) {
  // [Línea clave]: ¿Por qué soy importante? Protección client-side de rutas por perfil de usuario. ¿Para qué? Evitar que un rol acceda a formularios de dictamen que no le competen institucionalmente. ¿Dónde me usan? Evaluado en render() antes de inyectar la vista.
  const roleByScreen = {
    23: "vinculacion",
    24: "comite",
    25: "consejo",
    26: "direccion",
    27: "cie",
  };
  if (roleByScreen[id] && state.role !== roleByScreen[id]) return false;
  if (["29", "30"].includes(id) && !["direccion", "cie"].includes(state.role))
    return false;
  if (["31", "32"].includes(id) && state.role !== "direccion") return false;
  if (+id >= 4 && +id <= 20 && state.role !== "investigador") return false;
  if (id === "21" && state.role === "investigador") return false;
  return true;
}
/**
 * Renderizar reactivamente la pantalla activa en el contenedor raíz #app.
 * Configura atributos de tema y accesibilidad en <html>, obtiene el id del URL hash,
 * valida autorización de sesión con guardRoute(), selecciona la función constructora correspondiente,
 * inyecta el HTML resultante en #app y actualiza el título del documento en el navegador.
 * parametros:
 *     (ninguno)
 * return:
 *     + void : undefined Muta el DOM inyectando el marcado de la pantalla actual.
 */
function render() {
  document.documentElement.dataset.theme = state.theme || "light";
  document.documentElement.classList.toggle("large-text", !!state.largeText);
  // [Línea clave]: ¿Por qué soy importante? Resuelve la pantalla actual del hash en la URL. ¿Para qué? Coordinar el enrutador cliente de la SPA. ¿Dónde me usan? Al inicio de render().
  current = (location.hash.slice(1) || "01").split("?")[0];
  if (!screen(current)) current = "01";
  // Guarda de sesión: sin sesión solo existe el login; con sesión, el login redirige al inicio del rol.
  if (!session && current !== "01") {
    location.hash = "01";
    return;
  }
  if (session && current === "01") {
    go(homeFor());
    return;
  }
  if (!guardRoute(current)) {
    $("#app").innerHTML = shell(
      card(
        "Este recorrido corresponde a otro rol",
        `<p class="small muted mb">Cambia al perfil institucional indicado para explorar sus acciones de demostración.</p>${act("Elegir rol", "roles", "secondary")}`,
      ),
      "Acceso por rol",
      "Las acciones se separan según la arquitectura de información.",
    );
    return;
  }
  const simple = {
    "01": login,
    "02": dashboard,
    "03": notifications,
    "04": calls,
    "05": callDetail,
    "06": myProposals,
    "07": newProposal,
    19: confirmation,
    20: tracking,
    21: inbox,
    22: dossier,
    28: history,
    29: searchHistory,
    30: historyResults,
    31: adminCalls,
    32: adminCatalogs,
    33: profile,
  };
  let html;
  if (simple[current]) html = simple[current]();
  else if (+current >= 8 && +current <= 18) {
    const forms = {
      "08": dataForm,
      "09": teamForm,
      10: foundationForm,
      11: objectiveForm,
      12: methodologyForm,
      13: planForm,
      14: riskForm,
      15: budgetForm,
      16: complementaryForm,
      17: documentsForm,
      18: reviewForm,
    };
    html = shell(
      formShell(forms[current]()),
      "Agua Inteligente",
      "SI-2027-014",
      btn("Salir del formulario", "06", "secondary"),
    );
  } else html = evaluation(current);
  $("#app").innerHTML = html;
  document.title = (screen(current)?.title || "SGPI") + " · SGPI";
  window.scrollTo(0, 0);
}

/**
 * Navegar programáticamente a una pantalla específica de la aplicación.
 * Cierra modales abiertos, repliega menús de usuario, restablece filtros y asigna el nuevo hash en location.
 * parametros:
 *     - string : id Identificador de pantalla a la que se desea navegar (ej. '02', '15').
 * return:
 *     + void : undefined Dispara la navegación y hashchange.
 */
function go(id) {
  closeModal();
  userMenuOpen = false;
  activeFilter = "Todas";
  if (id !== "22") dossierTab = "Resumen";
  if (location.hash === "#" + id) render();
  else location.hash = id;
}

/**
 * Desplegar un mensaje flotante temporal de confirmación (Toast notification).
 * Muestra el elemento #toast con el mensaje provisto durante 4.2 segundos antes de ocultarlo.
 * parametros:
 *     - string : msg Texto de confirmación o alerta a desplegar.
 * return:
 *     + void : undefined Modifica visibilidad del nodo DOM del toast.
 */
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => (el.style.display = "none"), 4200);
}

/**
 * Cerrar cualquier diálogo modal activo y restaurar el foco del teclado.
 * Limpia el contenido de #modal-root, restaura el scroll en el body y enfoca el elemento previo.
 * parametros:
 *     (ninguno)
 * return:
 *     + void : undefined Limpia el contenedor de modales.
 */
function closeModal() {
  const root = $("#modal-root");
  root.innerHTML = "";
  document.body.style.overflow = "";
  modalName = null;
  if (previousFocus?.isConnected) previousFocus.focus();
}

/**
 * Abrir un cuadro de diálogo modal accesible con trampeo de foco.
 * Guarda el foco actual, bloquea el scroll de la página e inyecta la ventana modal en #modal-root.
 * parametros:
 *     - string : title Título principal del diálogo en h2.
 *     - string : body Contenido interno HTML del modal.
 *     - string : actions Botones de acción del pie del modal.
 *     - boolean : wide Si debe aplicarse el modificador visual de mayor anchura.
 *     - string : name Identificador semántico del modal (ej. 'settings', 'roles').
 * return:
 *     + void : undefined Muta el DOM inyectando la estructura del diálogo modal.
 */
function modal(title, body, actions = "", wide = false, name = "dialog") {
  previousFocus = document.activeElement;
  modalName = name;
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop" data-backdrop><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal="${name}"><header class="modal-head"><h2 id="modal-title">${title}</h2><button data-action="close" aria-label="Cerrar">${icon("close")}</button></header>${body}${actions ? `<div class="actions">${actions}</div>` : ""}</section></div>`;
  document.body.style.overflow = "hidden";
  $(".modal button,.modal input,.modal select")?.focus();
}

/**
 * Validar la completitud y validez sintáctica de los campos requeridos en un formulario.
 * Itera todos los elementos con atributo [required], resalta visualmente campos vacíos
 * o inválidos mostrando mensajes de error, enfoca el primer error y lanza un toast.
 * parametros:
 *     - string : formId Selector CSS del formulario a validar (ej. '#login-form').
 * return:
 *     + boolean : esValido Verdadero si todos los campos requeridos cumplen las validaciones.
 */
function validate(formId) {
  const form = $(formId);
  if (!form) return true;
  let valid = true;
  $$("[required]", form).forEach((el) => {
    const ok =
      el.type === "checkbox"
        ? el.checked
        : el.value.trim() !== "" && (el.type !== "email" || el.validity.valid);
    const f = el.closest(".field");
    if (f) {
      f.classList.toggle("error", !ok);
      $(".error-msg", f).hidden = ok;
    }
    if (!ok) valid = false;
  });
  if (!valid) {
    $(
      ".field.error input,.field.error textarea,.field.error select",
      form,
    )?.focus();
    toast("Revisa los campos obligatorios indicados.");
  }
  return valid;
}

/**
 * Desplegar el modal interactivo de selección y cambio de rol institucional en demostración.
 * Genera botones con avatares para cada uno de los 6 roles configurados en la aplicación.
 * parametros:
 *     (ninguno)
 * return:
 *     + void : undefined Abre el modal invocando modal().
 */
function modalRoles() {
  const ordered = (state.roleOrder || Object.keys(roles)).filter(
    (k) => roles[k],
  );
  modal(
    "Cambiar rol",
    `<p class="mb">Selecciona el perfil de trabajo. El orden lo administra Dirección/VIE.</p>${ordered
      .map((k) => {
        const r = roles[k];
        return `<button class="role-option" data-action="set-role" data-role="${k}"><span class="avatar">${r.initials}</span><span style="flex:1"><strong>${r.label}</strong><small>${r.name}</small></span>${icon("arrow")}</button>`;
      })
      .join("")}`,
    "",
    false,
    "roles",
  );
}

/**
 * Helper generador de botones de confirmación con icono check.
 * Invoca act() configurando el icono 'check' y estilo primario.
 * parametros:
 *     - string : label Texto del botón de confirmación.
 *     - string : action Acción a despachar al pulsar.
 *     - string : extra Atributos HTML complementarios.
 * return:
 *     + string : btnHtml Marcado del botón de confirmación.
 */
const confirmBtn = (label, action, extra = "") =>
  act(label, action, "", "check", extra);

/**
 * Procesar la autenticación real del usuario contra el backend y cargar su entorno.
 * Valida el formulario de acceso, envía correo/contraseña a apiLogin(), asigna la sesión en memoria,
 * aplica el rol correspondiente, ejecuta la precarga de datos con obtenerDatosBackend() y navega al inicio.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<void> : undefined Resuelve al completar el flujo de inicio de sesión o mostrar el error.
 */
async function doLogin() {
  const box = $("#login-error");
  if (box) box.innerHTML = "";
  if (!validate("#login-form")) return;
  const emailEl = $('[data-field="login:email"]'),
    pwEl = $('[data-field="login:password"]'),
    b = $('#login-form [data-action="login"]');
  const correo = emailEl.value.trim().toLowerCase(),
    password = pwEl.value;
  b.disabled = true;
  b.lastChild.textContent = "Ingresando…";
  try {
    // [Línea clave]: ¿Por qué soy importante? Petición de login contra el backend FastAPI. ¿Para qué? Verificar credenciales en la base de datos Supabase Postgres. ¿Dónde me usan? En el flujo de login en doLogin().
    const user = await apiLogin(correo, password);
    const key =
      user && Array.isArray(user.roles) && user.roles.length
        ? ROLE_KEYS[user.roles[0]]
        : null;
    if (!key) throw new AuthError("noroles");
    setSession({ user });
    applyRole(key);
    await obtenerDatosBackend()
    save();
    go(homeFor());
  } catch (err) {
    if (box?.isConnected)
      box.innerHTML = notice(
        "No fue posible ingresar",
        LOGIN_ERRORS[err instanceof AuthError ? err.code : "server"],
        "warning",
      );
    if (pwEl?.isConnected) {
      pwEl.value = "";
      pwEl.focus();
    }
    if (b.isConnected) {
      b.disabled = false;
      b.lastChild.textContent = "Ingresar";
    }
  }
}
/**
 * Despachador maestro de acciones interactivas y eventos del usuario en la interfaz.
 * Evalúa mediante una estructura switch el parámetro 'action' disparado por botones [data-action],
 * gestionando el guardado de borradores, apertura/cierre de modales, transiciones de evaluación,
 * creación de propuestas y atajos de accesibilidad.
 * parametros:
 *     - string : action Identificador semántico de la acción a ejecutar.
 *     - HTMLElement : el Elemento del DOM que detonó la acción con sus atributos data-*.
 * return:
 *     + Promise<void> : undefined Resuelve al concluir el manejo del evento.
 */
async function handleAction(action, el) {
  switch (action) {
    case "filter-calls":
      render();
      break;
    case "close":
      closeModal();
      break;
    case "roles":
      userMenuOpen = false;
      modalRoles();
      break;
    case "user-menu":
      userMenuOpen = !userMenuOpen;
      render();
      break;
    case "settings":
      userMenuOpen = false;
      modal(
        "Ajustes y accesibilidad",
        `<div class="setting-row"><div><strong>Modo oscuro</strong><p class="small muted">Reduce el brillo y aumenta el contraste en ambientes con poca luz.</p></div>${act(state.theme === "dark" ? "Desactivar" : "Activar", "toggle-theme", "secondary", "", `aria-pressed="${state.theme === "dark"}"`)}</div><div class="setting-row"><div><strong>Texto ampliado</strong><p class="small muted">Aumenta el tamaño general de lectura.</p></div>${act(state.largeText ? "Restablecer" : "Aumentar", "toggle-text", "secondary", "", `aria-pressed="${state.largeText}"`)}</div>`,
        act("Cerrar", "close"),
        false,
        "settings",
      );
      break;
    case "toggle-theme":
      state.theme = state.theme === "dark" ? "light" : "dark";
      save();
      document.documentElement.dataset.theme = state.theme;
      closeModal();
      render();
      toast(`Modo ${state.theme === "dark" ? "oscuro" : "claro"} activado.`);
      break;
    case "toggle-text":
      state.largeText = !state.largeText;
      save();
      closeModal();
      render();
      toast(
        state.largeText
          ? "Texto ampliado activado."
          : "Tamaño de texto restablecido.",
      );
      break;
    case "contact":
      userMenuOpen = false;
      modal(
        "Contacto y soporte",
        `<div class="action-row mb"><span class="avatar">AS</span><div><strong>Andrea Solano</strong><div class="small muted">Gestora de apoyo SGPI · contacto de demostración</div></div></div>${definition(
          [
            [
              "Correo",
              '<a href="mailto:contacto.sgpi@example.com">contacto.sgpi@example.com</a>',
            ],
            ["Horario", "Lunes a viernes · 8:00 a 16:30"],
            ["Canal", "Mesa de apoyo VIE"],
          ],
        )}<div class="mt">${notice("Dato para la maqueta", "Sustituye este contacto por la persona y el canal institucionales antes de publicar el sistema.")}</div>`,
        act("Cerrar", "close"),
        false,
        "contact",
      );
      break;
    case "logout":
      userMenuOpen = false;
      setSession(null);
      go("01");
      toast("Sesión cerrada.");
      break;
    case "set-role":
      applyRole(el.dataset.role);
      save();
      go(state.role === "investigador" ? "02" : "21");
      break;
    case "login":
      await doLogin();
      break;
    case "login-help":
      modal(
        "Ayuda para iniciar sesión",
        "<p>Usa tu correo institucional y la contraseña asignada a tu cuenta.</p><p>Si olvidaste tus credenciales o tu usuario está inactivo, contacta a la mesa de apoyo indicada en esta pantalla.</p>",
        act("Contactar soporte", "contact", "secondary") +
          act("Entendido", "close"),
      );
      break;
    case "account-help":
      modal(
        "Ayuda para crear una cuenta",
        `<div class="timeline"><div class="event current"><h3>1. Verifica tu vínculo institucional</h3><p>La cuenta debe asociarse a una persona o instancia autorizada.</p></div><div class="event"><h3>2. Solicita acceso</h3><p>Contacta a la mesa de apoyo VIE e indica el rol requerido.</p></div><div class="event"><h3>3. Confirma la activación</h3><p>Recibirás las instrucciones institucionales para el primer ingreso.</p></div></div>${notice("Prototipo sin registro real", "Esta maqueta no crea cuentas ni envía datos.")}`,
        act("Contactar soporte", "contact", "secondary") +
          act("Cerrar", "close"),
        false,
        "account-help",
      );
      break;
    case "role-up":
    case "role-down": {
      const order = [...(state.roleOrder || Object.keys(roles))],
        i = order.indexOf(el.dataset.role),
        j = action === "role-up" ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < order.length) {
        [order[i], order[j]] = [order[j], order[i]];
        state.roleOrder = order;
        save();
        render();
        toast("Orden de roles actualizado.");
      }
      break;
    }
    case "save":
      // [Línea clave]: ¿Por qué soy importante? Persistencia reactiva del borrador. ¿Para qué? Guardar el progreso parcial del formulario sin enviarlo aún a evaluación. ¿Dónde me usan? En handleAction bajo la acción 'save'.
      save();
      toast("Borrador guardado en este navegador.");
      break;
    case "next":
      if (validate("#proposal-form")) {
        if (current === "15" && !budgetValid()) {
          toast("Corrige el presupuesto antes de continuar.");
          break;
        }
        // [Línea clave]: ¿Por qué soy importante? Validación y avance de paso. ¿Para qué? Guardar los datos del paso actual y avanzar a la siguiente sección del wizard de formulación. ¿Dónde me usan? En handleAction bajo la acción 'next'.
        save();
        go(el.dataset.next);
      }
      break;
    case "create-proposal": {
      const modalidadId = Number($("input[name=modality]:checked")?.value) || 3;
      const modalidad = (modalidades ?? []).find((m) => Number(m.id) === modalidadId);
      state.modeId = modalidadId;
      state.mode = modalidad?.titulo || "Desarrollo tecnológico";
      state.clientUuid = state.clientUuid || nuevoClientUuid();
      state.convocatoriaId = convocatoriaActivaId();
      iniciarNuevoBorrador();
      if (state.mode !== "Desarrollo tecnológico") {
        modal(
          "Modalidad seleccionada",
          `<p>${esc(state.mode)}</p>${notice("Alcance de la demostración", state.mode === "Actividad de fortalecimiento" ? "Se dispone de disposiciones y rúbrica, pero no del formulario original de fortalecimiento en los archivos recibidos. El recorrido completo utiliza desarrollo tecnológico." : "El caso de demostración completo utiliza desarrollo tecnológico; básica/aplicada permite hasta 2 años y ₡4 millones por año.")}`,
          act("Volver", "close", "secondary") +
            act("Abrir caso de desarrollo tecnológico", "demo-project"),
        );
      } else {
        state.stage = "En formulación";
        save();
        go("08");
      }
      break;
    }
    case "demo-project":
      state.mode = "Desarrollo tecnológico";
      state.modeId = 3;
      state.clientUuid = state.clientUuid || nuevoClientUuid();
      state.convocatoriaId = convocatoriaActivaId();
      iniciarNuevoBorrador();
      state.stage = "En formulación";
      save();
      go("08");
      break;
    case "read":
      marcarTodasLeidas();
      state.read = true;
      save();
      render();
      toast("Todas las notificaciones están marcadas como leídas.");
      break;
    case "all-notifications":
      activeFilter = "Todas";
      render();
      break;
    case "calendar":
      modal(
        "Calendario · Fondos VIE 2027",
        table(["Etapa", "Fecha"], calendarRows),
        act("Cerrar", "close"),
        true,
        "calendar",
      );
      break;
    case "filter-calls":
      if (
        (state.saved["call:query"] || "").trim() &&
        !/vie|2027|fondo/i.test(state.saved["call:query"])
      )
        toast("No hay coincidencias. Prueba con «VIE» o «2027».");
      else toast("1 convocatoria encontrada: Fondos VIE 2027.");
      break;
    case "preview": {
      const codigoActivo = dossierActual?.codigo || state.viewProposal || "";
      modal(
        "Vista previa de documento",
        `<span class="badge">Sin archivo adjunto</span><h3 style="margin-top:22px">${esc(el.dataset.doc || "Documento del expediente")}</h3>${codigoActivo ? `<p>Expediente ${esc(codigoActivo)}.</p>` : ""}<div class="notice mt">${icon("file")}<div><strong>Archivo no disponible</strong><p>Este documento no tiene un archivo real asociado en Storage. Adjúntalo desde el expediente para habilitar el visor.</p></div></div>`,
        act("Cerrar visor", "close", "secondary"),
        false,
        "document",
      );
      break;
    }
    case "preview-remote": {
      const d = (documentosConvocatoria ?? []).find(
        (x) => x.id_documento_conv === Number(el.dataset.docId),
      );
      if (!d) {
        toast("No se encontró el documento.");
        break;
      }
      modal(
        esc(d.nombre_documento),
        visorHtml(d),
        `<a class="btn secondary" href="${esc(d.file_url)}" target="_blank" rel="noopener" download>Descargar</a>` +
          act("Cerrar visor", "close", "secondary"),
        true, // modal ancho
        "document",
      );
      break;
    }
    case "team":
      modal(
        "Participante del equipo",
        `${field("Nombre completo", "María Arias", "text", "", true, "modal:person")}${field("Institución / instancia", "Entidad colaboradora", "text", "", true, "modal:institution")}<div class="field-row">${field("Rol", ["Colaboración externa", "Investigador"], "select", "", false, "modal:role")}${field("Dedicación", "4", "number", "Horas por semana.", false, "modal:hours")}</div>${field("ORCID", "Pendiente", "text", "Identificador ORCID del participante.", false, "modal:orcid")}${field("Responsabilidad", "Participa en la validación de campo.", "textarea", "Adjuntar carta de compromiso si es externo.", true, "modal:responsibility")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar participante", "team-save"),
        false,
        "team",
      );
      break;
    case "team-save": {
      const nombre = $('[data-field="modal:person"]')?.value?.trim();
      const institucion = $('[data-field="modal:institution"]')?.value?.trim();
      if (!nombre || !institucion) {
        toast("Completa el nombre y la institución del participante.");
        break;
      }
      state.externalCollaborator = {
        nombre,
        institucion,
        rol: $('[data-field="modal:role"]')?.value || "Colaboración externa",
        horas: Number($('[data-field="modal:hours"]')?.value) || null,
        orcid: $('[data-field="modal:orcid"]')?.value || "",
        responsabilidad: $('[data-field="modal:responsibility"]')?.value || "",
      };
      state.teamAdded = true;
      state.extraPerson = nombre;
      save();
      closeModal();
      render();
      toast("Participación externa registrada.");
      break;
    }
    case "objective":
      modal(
        "Agregar objetivo específico",
        field(
          "Objetivo",
          "Documentar la transferencia de resultados a las personas usuarias.",
          "textarea",
          "Se asociará con actividades del plan.",
          true,
          "modal:objective",
        ),
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar objetivo", "save-extra", 'data-kind="objective"'),
      );
      break;
    case "activity":
      modal(
        "Agregar actividad",
        `${field("Objetivo específico", ["OE1", "OE2", "OE3"], "select", "", true, "modal:objective-code")}${field("Actividad", "Entregar informe semestral de avance", "text", "", true, "modal:activity")}${field("Resultado esperado", "Informe semestral registrado", "text", "", true, "modal:result")}<div class="field-row">${field("Responsable", nombreResponsableActual(), "text", "Ejecuta / Supervisa / Participa.", true, "modal:owner")}${field("Mes inicial / duración", "6 / 1", "text", "Meses correlativos.", true, "modal:period")}</div>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar actividad", "save-extra", 'data-kind="activity"'),
        false,
        "activity",
      );
      break;
    case "risk":
      modal(
        "Agregar riesgo",
        `${field("Actividad", ["Definir requerimientos", "Integrar y calibrar", "Validar en campo", "Evaluar y documentar"], "select", "", true, "modal:riskactivity")}${field("Riesgo", "Indisponibilidad temporal de un sitio piloto.", "textarea", "", true, "modal:risk")}${field("Mitigación", "Acordar un sitio alternativo antes del inicio de la validación.", "textarea", "", true, "modal:mitigation")}${field("Responsable", nombreResponsableActual(), "text", "", true, "modal:riskowner")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar riesgo", "save-extra", 'data-kind="risk"'),
        false,
        "risk",
      );
      break;
    case "save-extra": {
      const kind = el.dataset.kind;
      if (kind === "objective")
        state.extraObjective = $('[data-field="modal:objective"]').value;
      if (kind === "activity") {
        const a = [
          $('[data-field="modal:objective-code"]').value,
          $('[data-field="modal:activity"]').value,
          $('[data-field="modal:result"]').value,
          $('[data-field="modal:owner"]').value,
          $('[data-field="modal:period"]').value,
        ];
        state.extraActivities = (state.extraActivities || []).concat([a]);
      }
      if (kind === "risk") {
        const r = [
          $('[data-field="modal:riskactivity"]').value,
          $('[data-field="modal:risk"]').value,
          $('[data-field="modal:mitigation"]').value,
          $('[data-field="modal:riskowner"]').value,
        ];
        state.extraRisks = (state.extraRisks || []).concat([r]);
      }
      save();
      closeModal();
      render();
      toast("Registro guardado e incorporado a la propuesta.");
      break;
    }
    case "budget-edit": {
      const i = Number(el.dataset.index),
        r = state.budget[i];
      for (const k of [
        "modal:budget-a",
        "modal:budget-b",
        "modal:budget-detail",
      ])
        delete state.saved[k];
      modal(
        "Editar rubro",
        `<p class="mb">${r.code} · ${r.name}</p><div class="field-row">${field("Monto 2027", r.a, "number", "En colones.", true, "modal:budget-a")}${field("Monto 2028", r.b, "number", "En colones.", true, "modal:budget-b")}</div>${field("Justificación", r.detail, "textarea", "Relaciona el gasto con el plan.", true, "modal:budget-detail")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar rubro", "budget-save", `data-index="${i}"`),
        false,
        "budget",
      );
      break;
    }
    case "budget-save": {
      const i = Number(el.dataset.index),
        a = Number($('[data-field="modal:budget-a"]').value),
        b = Number($('[data-field="modal:budget-b"]').value);
      if (a < 0 || b < 0) {
        toast("Los montos deben ser iguales o mayores a cero.");
        break;
      }
      state.budget[i] = {
        ...state.budget[i],
        a,
        b,
        detail: $('[data-field="modal:budget-detail"]').value,
      };
      delete state.saved["modal:budget-a"];
      delete state.saved["modal:budget-b"];
      delete state.saved["modal:budget-detail"];
      save();
      closeModal();
      render();
      toast(
        budgetValid()
          ? "Rubro actualizado y totales recalculados."
          : "Rubro guardado. Revisa las validaciones del presupuesto.",
      );
      break;
    }
    case "budget-add":
      modal(
        "Agregar rubro",
        `${field("Objeto de gasto", ["1-05-02-01 · Viáticos dentro del país"], "select", "", true, "modal:new-budget")}${field("Monto 2027", "0", "number", "", true, "modal:new-a")}${field("Monto 2028", "0", "number", "", true, "modal:new-b")}${field("Justificación", "Giras previstas en el plan de acción.", "textarea", "", true, "modal:new-detail")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar rubro", "budget-add-save"),
      );
      break;
    case "budget-add-save":
      state.budget.push({
        name: "Viáticos dentro del país",
        code: "1-05-02-01",
        a: Number($('[data-field="modal:new-a"]').value),
        b: Number($('[data-field="modal:new-b"]').value),
        detail: $('[data-field="modal:new-detail"]').value,
      });
      save();
      closeModal();
      render();
      break;
    case "budget-rules":
      modal(
        "Reglas de presupuesto",
        `<div class="stack">${notice("Tope anual DT: ₡5.000.000", "La propuesta distribuye ₡4.800.000 en 2027 y ₡4.600.000 en 2028.")}${notice("Bienes duraderos y licencias en año 1", "Una excepción requiere justificación aprobada por CIE.")}${notice("Beca obligatoria de al menos 10 h/semana", "Tarifa del instrumento: ₡2.400/h. Máximo 10 meses/año. El caso planifica 400 horas/año.")}${notice("Servicios profesionales externos", "Solo tareas puntuales justificadas, hasta 30% del presupuesto operativo. El transporte institucional no se presupuesta.")}</div>`,
        act("Entendido", "close"),
        false,
        "budget-rules",
      );
      break;
    case "upload": {
      const enBorrador = Number(current) >= 8 && Number(current) <= 18;
      const destino = enBorrador
        ? "Se subirá automáticamente al confirmar el envío."
        : "Se almacena en el expediente de la propuesta.";
      modal(
        "Adjuntar documento",
        `<div class="mt">${field("Tipo de documento", ["Formulario institucional", "Plan de acción y riesgos", "Presupuesto 2027–2028", "Fundamentación", "Carta de compromiso", "Otro"], "select", "", false, "modal:upload:tipo")}<div class="field"><label for="propuesta-doc">Archivo (PDF, DOCX, XLSX o PPTX)</label><input id="propuesta-doc" type="file" accept=".pdf,.docx,.xlsx,.pptx"><span class="help">Máximo 20 MB. ${destino}</span></div></div>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Adjuntar", "upload-save"),
        false,
        "upload",
      );
      break;
    }
    case "upload-save": {
      const archivo = $("#propuesta-doc")?.files?.[0] || null;
      const tipo = $('[data-field="modal:upload:tipo"]')?.value || "Otro";
      if (!archivo) {
        toast("Selecciona un archivo PDF, DOCX, XLSX o PPTX.");
        break;
      }
      if (archivo.size > 20 * 1024 * 1024) {
        toast("El archivo supera el máximo de 20 MB.");
        break;
      }
      if (Number(current) >= 8 && Number(current) <= 18) {
        archivosBorrador.push({ file: archivo, tipo });
        closeModal();
        render();
        toast(`${archivo.name} se adjuntará al confirmar el envío.`);
        break;
      }
      const propuestaReal = propuestaRealActiva();
      if (!propuestaReal) {
        toast("Abre una propuesta registrada para adjuntar el documento.");
        break;
      }
      try {
        await subirDocumentoPropuesta(propuestaReal, archivo, tipo);
        closeModal();
        await cargarDossier(propuestaReal);
        render();
        toast(`Documento adjunto a ${dossierActual?.codigo || "la propuesta"}.`);
      } catch (err) {
        toast(err.message || "No se pudo adjuntar el documento.");
      }
      break;
    }
    case "remove-draft-doc": {
      const i = Number(el.dataset.index);
      if (Number.isInteger(i) && i >= 0 && i < archivosBorrador.length) {
        archivosBorrador.splice(i, 1);
        render();
        toast("Documento quitado del borrador.");
      }
      break;
    }
    case "send": {
      // [Línea clave]: ¿Por qué soy importante? Envío formal a evaluación técnica y Vinculación. ¿Para qué? Validar y registrar la propuesta completa en PostgreSQL. ¿Dónde me usan? En handleAction bajo la acción 'send'.
      const issues = proposalValidationIssues();
      if (issues.length) {
        modal(
          "Corrige la propuesta antes de enviar",
          notice("Hay requisitos incompletos", issues.map((i) => `• ${i.text}`).join("<br>"), "warning"),
          btn("Ir a corregir", issues[0].screen),
        );
        break;
      }
      if (!$("#reviewed")?.checked) {
        toast("Confirma que revisaste la información antes de enviar.");
        $("#reviewed")?.focus();
        break;
      }
      const titulo = draftValue("08:Título de la propuesta", screenDefault("08", "Título de la propuesta"));
      modal(
        "¿Enviar a revisión de Vinculación?",
        `<p>Se registrará la versión 1.0 de <strong>${esc(titulo)}</strong> y quedará disponible para la instancia revisora.</p><div class="mt">${notice("Todavía no es el sometimiento formal", "El sometimiento ante VIE ocurre después de la evaluación técnica y los avales.")}</div>`,
        act("Seguir revisando", "close", "secondary") +
          confirmBtn("Confirmar envío", "send-confirm"),
        false,
        "send",
      );
      break;
    }
    case "send-confirm": {
      try {
        toast("Registrando la propuesta en PostgreSQL...");
        const payload = buildProposalPayload();
        const respuesta = await crearPropuestaBackend(payload);
        const creada = respuesta?.propuesta || {};
        state.created = {
          id: Number(creada.id_propuesta),
          code: creada.codigo || "SI-2027-014",
          title: creada.titulo || payload.titulo,
          amount: totalA() + totalB(),
          date: new Date().toISOString(),
        };
        state.stage = "En revisión de Vinculación";
        state.viewProposal = state.created.code;
        evaluacionPreliminarIA = respuesta?.evaluacion_preliminar_ia || null;
        const idCreada = Number(state.created.id);
        const fallidos = [];
        let subidos = 0;
        if (idCreada) {
          for (const item of archivosBorrador) {
            try {
              await subirDocumentoPropuesta(idCreada, item.file, item.tipo);
              subidos += 1;
            } catch (err) {
              fallidos.push(`${item.file.name}: ${err.message || "error al subir"}`);
            }
          }
        }
        archivosBorrador = [];
        clearProposalDraft();
        save();
        closeModal();
        await obtenerDatosBackend();
        go("19");
        if (fallidos.length) {
          modal(
            "La propuesta se registró, pero faltan documentos",
            notice(
              `${fallidos.length} archivo(s) no se pudieron subir`,
              `${fallidos.map((f) => `• ${esc(f)}`).join("<br>")}<br><br>Puedes adjuntarlos desde Seguimiento (pantalla 20).`,
              "warning",
            ),
            btn("Ir a seguimiento", "20") + act("Cerrar", "close", "secondary"),
          );
        } else if (subidos) {
          toast(`Propuesta ${respuesta?.duplicada ? "ya registrada" : "registrada"} y ${subidos} documento(s) adjuntado(s).`);
        } else if (respuesta?.duplicada) {
          toast("La propuesta ya estaba registrada.");
        } else {
          toast("Propuesta registrada y remitida a Vinculación.");
        }
      } catch (err) {
        console.error("send-confirm error:", err);
        modal(
          "No se pudo registrar la propuesta",
          notice("Se conservó tu borrador en este navegador", esc(err.message || "Error desconocido al registrar."), "warning"),
          act("Cerrar", "close", "secondary"),
        );
      }
      break;
    }
    case "refresh-ai-eval":
      toast("Consultando a Google Gemini (Free Tier)...");
      await generarEvaluacionPreliminarIA();
      render();
      toast("Evaluación preliminar IA actualizada en Supabase.");
      break;
    case "apply-ai-scores":
      if (evaluacionPreliminarIA?.criterios_sugeridos) {
        state.scores = {
          ...state.scores,
          ...evaluacionPreliminarIA.criterios_sugeridos,
        };
        save();
        render();
        toast("Puntajes de referencia IA aplicados a la rúbrica.");
      } else {
        await obtenerEvaluacionPreliminarIA(currentProposalId());
        if (evaluacionPreliminarIA?.criterios_sugeridos) {
          state.scores = {
            ...state.scores,
            ...evaluacionPreliminarIA.criterios_sugeridos,
          };
          save();
          render();
          toast("Puntajes de referencia IA aplicados a la rúbrica.");
        }
      }
      break;
    case "modal-ai-detail": {
      if (!evaluacionPreliminarIA) await obtenerEvaluacionPreliminarIA(currentProposalId());
      const ia = evaluacionPreliminarIA || {};
      const fortalezasHtml = (ia.fortalezas || [])
        .map((f) => `<li>${esc(f)}</li>`)
        .join("");
      const alertasHtml = (ia.alertas_normativas || [])
        .map((a) => `<li>${esc(a)}</li>`)
        .join("");
      modal(
        "Dictamen Preliminar IA · Gemini Free Tier",
        `<div class="action-row mb">${badge(ia.recomendacion_global || "Recomendada", "solid")}${badge(`${Number(ia.puntaje_preliminar ?? 87.8).toFixed(1)} / 100`)}${badge(ia.modelo_ia || "gemini-2.5-flash")}</div><p class="small mb">${esc(ia.resumen_ejecutivo || "Análisis preliminar automático generado al enviar la propuesta a revisión.")}</p>${definition([
          ["1. Vinculación (Pantalla 23)", esc(ia.referencia_vinculacion?.dictamen_sugerido || "Favorable — Potencial de PI en software")],
          ["2. Comité Técnico (Pantalla 24)", esc(ia.referencia_comite_tecnico?.justificacion_rubrica || "Cumple umbral >= 70 y criterios obligatorios")],
          ["3. Consejo de Escuela (Pantalla 25)", esc(ia.referencia_consejo_escuela?.recomendacion_aval || "Avalar horas y presupuesto")],
          ["4. Dirección VIE (Pantalla 26)", esc(`Dictamen sugerido: ${ia.referencia_direccion_vie?.dictamen_sugerido || "Favorable"} (5/5 criterios verificados)`)],
          ["5. Resolución CIE (Pantalla 27)", esc(ia.referencia_cie?.borrador_acuerdo || "Aprobación recomendada")],
        ])}<div class="mt"><strong>Fortalezas identificadas:</strong><ul class="small muted" style="padding-left:18px;margin-top:6px">${fortalezasHtml}</ul></div><div class="mt"><strong>Observaciones y alertas normativas:</strong><ul class="small muted" style="padding-left:18px;margin-top:6px">${alertasHtml}</ul></div><div class="mt">${notice("Carácter referencial no vinculante", "Esta evaluación preliminar es generada por Google Gemini (Plan Gratuito) como insumo técnico para apoyar a los evaluadores de cada nivel institucional.")}</div>`,
        act("Actualizar con Gemini", "refresh-ai-eval", "secondary") + act("Cerrar", "close"),
        true,
        "ai-detail",
      );
      break;
    }
    case "submit":
      modal(
        "Sometimiento formal ante VIE",
        `${notice("Sometimiento: 28 sep 2026", "Comprueba los documentos antes de someter la propuesta.")}<div class="mt">${["Dictamen de Vinculación incorporado", "Evaluación técnica y productos conformes", "Acuerdos coordinador y participante adjuntos", "Versión final y declaración jurada revisadas"].map((t) => `<label class="checkline"><input type="checkbox" checked>${t}</label>`).join("")}</div>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Someter propuesta", "submit-confirm"),
        false,
        "submit",
      );
      break;
    case "submit-confirm":
      state.stage = "Sometida";
      save();
      closeModal();
      render();
      toast("Propuesta sometida. Próxima etapa: Dirección.");
      break;
    case "acceptance":
      modal(
        "Carta de aceptación",
        `${notice("Período: 2–6 nov 2026", "La aceptación sigue a una resolución favorable del CIE.")}${docPendiente("Carta de aceptación", "Se adjunta al presentarla")}<label class="checkline"><input type="checkbox" checked>Acepto las condiciones del acuerdo.</label>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Registrar carta", "acceptance-confirm"),
        false,
        "acceptance",
      );
      break;
    case "acceptance-confirm":
      state.stage = "Aceptada";
      save();
      closeModal();
      render();
      toast("Carta de aceptación registrada en el escenario.");
      break;
    case "report":
      modal(
        "Informe de seguimiento",
        `${field("Tipo", ["Informe semestral", "Informe anual", "Informe final"], "select", "", true, "modal:reporttype")}${docPendiente("Informe de resultados", "Se adjunta al presentar el informe")}<p>El cierre DT requiere productos y oficio final de Vinculación. La certificación corresponde a Dirección.</p>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Registrar informe", "report-save"),
      );
      break;
    case "report-save":
      closeModal();
      toast("Informe registrado en el expediente.");
      break;
    case "return":
      modal(
        "Devolver con observaciones",
        `${field("Observaciones para el investigador", "Completar la justificación del riesgo de campo y vincular la medida con el responsable.", "textarea", "Explica el ajuste requerido y la evidencia esperada.", true, "modal:return")}${notice("La devolución permite corregir", "Se conserva la versión revisada y las observaciones. No equivale a una resolución negativa definitiva.")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Registrar devolución", "return-confirm", current === "23" ? 'data-step="23"' : ""),
        false,
        "return",
      );
      break;
    case "return-confirm": {
      if (el.dataset.step === "23" || current === "23") {
        const idPropuesta = propuestaActivaId();
        try {
          const fileInput = $("#vinculacion-doc");
          let idDocumento = null;
          if (fileInput?.files?.length) {
            const subido = await subirDocumentoPropuesta(idPropuesta, fileInput.files[0], "Dictamen de Vinculación");
            idDocumento = subido.id_documento;
          }
          const resultado = await guardarVinculacion(
            idPropuesta,
            payloadVinculacion("observaciones", state.saved["modal:return"] || "", idDocumento),
          );
          state.stage = resultado.nombre_estado;
          state.viewProposalId = idPropuesta;
          save();
          closeModal();
          await Promise.all([cargarBandejaVinculacion(), cargarDossier(idPropuesta), cargarVinculacion(idPropuesta)]);
          go("21");
          toast("Devolución registrada. El investigador podrá atender las observaciones.");
        } catch (err) {
          toast(err.message || "No se pudo registrar la devolución.");
        }
        break;
      }
      state.stage = "Con observaciones";
      save();
      closeModal();
      go("21");
      toast(
        "Devolución registrada. El investigador podrá atender las observaciones.",
      );
      break;
    }
    case "decision":
      // [Línea clave]: ¿Por qué soy importante? Registro de dictamen de evaluadores colegiados. ¿Para qué? Avanzar el expediente en el flujo institucional guardando la evidencia. ¿Dónde me usan? En handleAction bajo la acción 'decision'.
      if (!validate("#evaluation-form")) break;
      {
        const id = el.dataset.step,
          sc = scoreResult(),
          negative = id === "24" && !sc.recommended;
        modal(
          "Confirmar decisión",
          `<p>${negative ? "La evaluación no recomienda la propuesta por la nota o los requisitos obligatorios." : "Se conservarán los datos y el documento asociados a esta revisión."}</p>${id === "27" ? notice("Resolución seleccionada", state.saved.resolution || "Aprobada") : ""}${id === "23" ? notice("Registro en PostgreSQL", "El dictamen cambiará el estado de la propuesta y notificará al Comité Técnico.") : "<p>Esta acción es una simulación y no emite un acuerdo institucional real.</p>"}`,
          act("Revisar", "close", "secondary") +
            confirmBtn(
              "Registrar decisión",
              "decision-confirm",
              `data-step="${id}"`,
            ),
          false,
          "decision",
        );
      }
      break;
    case "decision-confirm": {
      const id = el.dataset.step;
      if (id === "23") {
        const idPropuesta = propuestaActivaId();
        try {
          const fileInput = $("#vinculacion-doc");
          let idDocumento = null;
          if (fileInput?.files?.length) {
            const subido = await subirDocumentoPropuesta(idPropuesta, fileInput.files[0], "Dictamen de Vinculación");
            idDocumento = subido.id_documento;
          }
          const resultado = await guardarVinculacion(
            idPropuesta,
            payloadVinculacion("favorable", "", idDocumento),
          );
          state.stage = resultado.nombre_estado;
          state.viewProposalId = idPropuesta;
          save();
          closeModal();
          await Promise.all([cargarBandejaVinculacion(), cargarDossier(idPropuesta), cargarVinculacion(idPropuesta)]);
          modal(
            "Decisión registrada",
            notice(
              "Registro guardado y sincronizado con PostgreSQL",
              `Nuevo estado: ${resultado.nombre_estado}. Se notificó al Comité Técnico y se conservó la trazabilidad.`,
            ),
            btn("Volver a la bandeja", "21", "secondary") +
              btn("Ver expediente", "22", "", "arrow"),
            false,
            "decision-saved",
          );
        } catch (err) {
          toast(err.message || "No se pudo registrar el dictamen de Vinculación.");
        }
        break;
      }
      state.stage = {
        23: "En evaluación técnica",
        24: scoreResult().recommended
          ? "En evaluación técnica"
          : "Con observaciones",
        25: "Avalada",
        26:
          state.saved["26:Dictamen"] === "Con observaciones"
            ? "Con observaciones"
            : "Dictaminada",
        27:
          (state.saved.resolution || "Aprobada") === "Rechazada"
            ? "Rechazada"
            : state.saved.resolution === "Con observaciones"
              ? "Con observaciones"
              : "Resuelta",
      }[id];
      save();


      modal(
        "Decisión registrada",
        notice(
          "Registro guardado y sincronizado con PostgreSQL",
          id === "25"
            ? "El investigador debe realizar el sometimiento formal. No se envió automáticamente a Dirección."
            : `Nuevo estado registrado con trazabilidad en base de datos: ${state.stage}.`,
        ),
        btn("Volver a la bandeja", "21", "secondary") +
          act(
            "Ver próximo actor",
            "next-actor",
            "",
            "arrow",
            `data-step="${id}"`,
          ),
        false,
        "decision-saved",
      );
      break;
    }
    case "next-actor": {
      const id = el.dataset.step;
      state.role = {
        23: "comite",
        24: scoreResult().recommended ? "consejo" : "investigador",
        25: "investigador",
        26: "cie",
        27: "investigador",
      }[id];
      save();
      go(state.role === "investigador" ? "20" : "21");
      break;
    }
    case "search-history":
      if (
        Number(state.saved["history:from"] || 2024) >
        Number(state.saved["history:to"] || 2028)
      ) {
        toast("El año inicial debe ser menor o igual al año final.");
        break;
      }
      {
        const q = state.saved["history:query"] || "";
        state.search = q;
        await buscarPropuestas({ ...filtrosHistorial(), q });
        save();
        go("30");
      }
      break;
    case "clear-search":
      Object.keys(state.saved)
        .filter((k) => k.startsWith("history:"))
        .forEach((k) => delete state.saved[k]);
      state.search = "";
      historialPropuestas = null;
      save();
      render();
      break;
    case "clear-results":
      Object.keys(state.saved)
        .filter((k) => k.startsWith("history:"))
        .forEach((k) => delete state.saved[k]);
      state.search = "";
      historialPropuestas = null;
      save();
      go("29");
      break;
    case "admin-call":
      modal(
        "Configurar convocatoria",
        `${field("Nombre", "Fondos VIE 2027", "text", "", true, "modal:call-name")}${field("Inicio de ejecución", "2027-01-01", "date", "", true, "modal:call-start")}${field("Disposiciones", "Versión 2027", "readonly")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar configuración", "admin-save"),
        false,
        "admin-call",
      );
      break;
    case "admin-calendar":
      modal(
        "Cronograma vigente",
        table(["Etapa", "Fecha"], calendarRows),
        act("Cerrar", "close"),
        true,
      );
      break;
    case "catalog-edit":
      modal(
        "Entrada de catálogo",
        `${field("Nombre", el.dataset.value || "Nueva línea de investigación", "text", "", true, "modal:catalog")}${field("Estado", ["Activo", "Inactivo"], "select", "", false, "modal:catalog-status")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar entrada", "admin-save"),
      );
      break;
    case "admin-save":
      save();
      closeModal();
      toast("Configuración guardada.");
      break;
    case "rubric-summary":
      modal(
        "Rúbrica · Desarrollo tecnológico",
        `${table(
          ["Sección", "Peso"],
          criterionGroups.map(([g, cs]) => [
            g,
            cs.reduce((a, c) => a + c[1], 0) + "%",
          ]),
        )}<div class="mt">${notice("Regla de recomendación", "Nota ≥70, obligatorios con Bueno/Excelente y productos conformes. Niveles: 0, 6, 8, 10.")}</div>`,
        act("Cerrar", "close"),
        true,
        "rubric",
      );
      break;
    case "stages":
      modal(
        "Escenarios de seguimiento",
        '<p>Elige una etapa para demostrar su estado y acciones; no modifica un expediente real.</p><div class="role-grid mt">' +
          stageList
            .concat(["Con observaciones", "Rechazada"])
            .map((s) =>
              act(s, "set-stage", "secondary compact", "", `data-stage="${s}"`),
            )
            .join("") +
          "</div>",
        "",
        true,
        "stages",
      );
      break;
    case "set-stage":
      state.stage = el.dataset.stage;
      state.role = "investigador";
      save();
      go("20");
      break;
    case "guide":
      modal(
        "Guía de recorridos",
        `<p>Explora las 33 pantallas y los escenarios complementarios.</p><div class="stack mt"><div>${btn("1. Formular una propuesta", "04", "secondary")}</div><div>${act("2. Evaluar por roles", "roles", "secondary")}</div><div>${act("3. Consulta histórica", "history-scenario", "secondary")}</div><div>${act("4. Sometimiento después del aval", "set-stage", "secondary", "", 'data-stage="Avalada"')}</div><div>${act("5. Aceptación después del CIE", "set-stage", "secondary", "", 'data-stage="Resuelta"')}</div><div>${act("Reiniciar datos de demostración", "reset", "text")}</div></div><p class="micro muted">Los archivos y decisiones son simulados. Usa el selector de rol para cambiar de contexto institucional.</p>`,
        act("Cerrar", "close"),
        false,
        "guide",
      );
      break;
    case "history-scenario":
      state.role = "direccion";
      save();
      go("29");
      break;
    case "reset":
      state = structuredClone(defaultState);
      if (session) applyRole(ROLE_KEYS[session.user.roles[0]]);
      save();
      go(session ? homeFor() : "01");
      toast("Recorrido reiniciado.");
      break;
    default:
      toast("Acción de demostración disponible desde el expediente.");
  }
}
document.addEventListener("click", (e) => {
  const actionEl = e.target.closest("[data-action]");
  if (actionEl) {
    e.preventDefault();
    handleAction(actionEl.dataset.action, actionEl);
    return;
  }
  const nav = e.target.closest("[data-go]");
  if (nav) {
    e.preventDefault();
    if (nav.dataset.proposalId) {
      state.viewProposalId = Number(nav.dataset.proposalId) || null;
    } else if (nav.dataset.proposal) {
      const encontrada = [...(bandejaPropuestas || []), ...(historialPropuestas || []), ...(top3propuestasmasrecientes || [])]
        .find((p) => p.code === nav.dataset.proposal);
      if (encontrada) state.viewProposalId = encontrada.id;
    }
    if (nav.dataset.proposal) {
      state.viewProposal = nav.dataset.proposal;
      save();
    }
    if (nav.dataset.convocatoria) {
      state.viewCall = Number(nav.dataset.convocatoria);
      save();
    }
    if (nav.dataset.notif) {
      marcarLeida(Number(nav.dataset.notif));
    }
    go(nav.dataset.go);
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    dossierTab = tab.dataset.tab;
    render();
    return;
  }
  const filter = e.target.closest("[data-filter]");
  if (filter) {
    activeFilter = filter.dataset.filter;
    render();
    return;
  }
  if (e.target.hasAttribute("data-backdrop")) closeModal();
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.field) {
    const priv = el.dataset.field.startsWith("login:"); // lo escrito en el login nunca se guarda (ni la contraseña ni el correo)
    if (!priv) {
      state.saved[el.dataset.field] =
        el.type === "checkbox" ? el.checked : el.value;
      save();
    }
    el.closest(".field")?.classList.remove("error");
    const msg = el.closest(".field")?.querySelector(".error-msg");
    if (msg) msg.hidden = true;
    if (priv) {
      const lb = $("#login-error");
      if (lb) lb.innerHTML = "";
    }
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "reviewed") {
    state.reviewed = el.checked;
    save();
  }
  if (el.dataset.score) {
    state.scores[el.dataset.score] = Number(el.value);
    save();
    const result = scoreResult();
    const n = $("#score-number");
    if (n) n.innerHTML = result.sum.toFixed(1) + "<small> / 100</small>";
    const b = $(".scorebar span");
    if (b) b.style.width = result.sum + "%";
    const r = $("#score-result");
    if (r) {
      r.className = "notice " + (result.recommended ? "" : "warning");
      r.innerHTML = `<div><strong>${result.sum.toFixed(1)} / 100 · ${result.recommended ? "Recomendada" : "No recomendada"}</strong><p>${result.blocked ? "Hay un criterio obligatorio con nivel insuficiente." : "Se consideran nota, obligatorios y producción."}</p></div>`;
    }
  }
  if (el.id === "products-ok") {
    state.notRecommended = !el.checked;
    save();
    const result = scoreResult();
    $("#score-result").innerHTML =
      `<div><strong>${result.sum.toFixed(1)} / 100 · ${result.recommended ? "Recomendada" : "No recomendada"}</strong><p>La producción no sumativa debe cumplir.</p></div>`;
  }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.id === "login-form") handleAction("login", e.target);
});
// [Línea clave]: ¿Por qué soy importante? Maneja accesibilidad WCAG y trampas de foco. ¿Para qué? Cerrar modales con Escape y ciclar navegación con Tab dentro de diálogos modales. ¿Dónde me usan? En el listener global keydown del documento.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Tab" && modalName) {
    const f = $$(
      'button,input,select,textarea,[tabindex="0"]',
      $(".modal"),
    ).filter((x) => !x.disabled);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f.at(-1).focus();
    } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
      e.preventDefault();
      f[0].focus();
    }
  }
});

// [Línea clave]: ¿Por qué soy importante? Enrutador cliente SPA basado en hash. ¿Para qué? Detectar cambios de ruta en la URL y actualizar la pantalla sin recargar la página. ¿Dónde me usan? En el listener global hashchange de window.
window.addEventListener("hashchange", () => {
  render();
  loadScreenData();
});

// [Línea clave]: ¿Por qué soy importante? Punto de arranque del ciclo de vida del Frontend. ¿Para qué? Renderizar la vista inicial y sincronizar catálogos y datos desde PostgreSQL asíncronamente. ¿Dónde me usan? Al pie del archivo app.js autoejecutándose como IIFE.
(async function initApp() {
  render();
  try {
    await obtenerDatosBackend()
    render();
    loadScreenData();
  } catch (e) {
    console.warn("SGPI: Error en precarga de datos:", e);
  }
})();
