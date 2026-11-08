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
  // [Línea clave]: El comité colegiado («CIE») y su evaluador individual son la misma
  // instancia institucional; ambos entran a la misma bandeja y registran resoluciones.
  "Evaluador Comité de Ética (CIE)": "cie",
  // [Línea clave]: Los roles administrativos administran las pantallas 31 y 32 junto a Dirección.
  "Funcionario VIE": "vie",
  "Administrador del Sistema": "administracion",
};
// La sesión solo recuerda quién ingresó (nunca la contraseña). Sin un token emitido por el backend es estado de interfaz, no seguridad real.
let session = null;

/**
 * Diccionario institucional de identificadores ORCID verificados bajo ISO 7064 MOD 11-2 por correo o nombre.
 * Vincula los perfiles de investigadores activos con su ORCID solicitado y validado.
 * Se utiliza en obtenerOrcidDePerfil() para autocompletar el ORCID al seleccionar a un investigador.
 * atributos:
 *     * string : "laura.mendez@example.com" ORCID verificado de Laura Méndez Quesada.
 *     * string : "andres.rojas@example.com" ORCID verificado de Andrés Rojas Calderón.
 *     * string : "sofia.vega@example.com" ORCID verificado de Sofía Vega Araya.
 */
const ORCID_PERFILES_INSTITUCIONALES = {
  "laura.mendez@example.com": "0000-0002-1825-0097",
  "andres.rojas@example.com": "0000-0001-5109-3700",
  "sofia.vega@example.com": "0000-0002-9079-593X",
  "mariana.solis@example.com": "0000-0003-1415-9269",
  "gabriel.sanchez@example.com": "0000-0002-7182-8182",
  "patricia.vargas@example.com": "0000-0001-6180-3398",
  "elena.chacon@example.com": "0000-0002-2360-679X",
  "ricardo.mora@example.com": "0000-0003-3162-2779",
};

/**
 * Formatear mientras el usuario escribe un identificador ORCID al patrón oficial 0000-0000-0000-000X.
 * Filtra caracteres no permitidos (conservando solo dígitos 0-9 y la letra verificadora X en mayúscula),
 * limita la longitud a 16 caracteres útiles y agrupa en bloques de 4 separados por guiones.
 * parametros:
 *     - string : valor Texto digitado por la persona usuaria en un campo de ORCID.
 * return:
 *     + string : orcidFormateado Cadena con guiones intercalados hasta 19 caracteres.
 */
function formatearOrcidInput(valor) {
  // [Línea clave]: ¿Por qué soy importante? Normaliza la entrada del usuario en tiempo real. ¿Para qué? Facilitar la captura del ORCID solicitado sin errores de guiones. ¿Dónde me usan? En los listeners de input de los modales de equipo, colaborador externo y perfil.
  const limpio = String(valor || "")
    .toUpperCase()
    .replace(/[^0-9X]/g, "")
    .slice(0, 16);
  const partes = [];
  for (let i = 0; i < limpio.length; i += 4) {
    partes.push(limpio.slice(i, i + 4));
  }
  return partes.join("-");
}

/**
 * Validar un identificador ORCID comprobando su estructura sintáctica y su dígito verificador ISO 7064 MOD 11-2.
 * Verifica el patrón '0000-0000-0000-000X' y ejecuta el algoritmo matemático oficial ISO/IEC 7064:2003 (MOD 11-2)
 * sobre los primeros 15 dígitos para garantizar que el ORCID solicitado sea auténtico y no inventado.
 * parametros:
 *     - string : valor Cadena con el identificador ORCID a verificar.
 * return:
 *     + boolean : esValido Verdadero si cumple formato y dígito verificador ISO 7064; falso en caso contrario.
 */
function esOrcidValido(valor) {
  const limpio = String(valor || "").trim().toUpperCase();
  // [Línea clave]: ¿Por qué soy importante? Valida el formato estructural de 4 bloques de 4 caracteres. ¿Para qué? Rechazar cadenas mal formadas antes del cálculo modular. ¿Dónde me usan? En team-save, external-add-save y guardado de perfil.
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(limpio)) return false;
  const compacto = limpio.replace(/-/g, "");
  if (compacto.slice(0, 15) === "000000000000000") return false;
  let total = 0;
  for (let i = 0; i < 15; i++) {
    total = (total + Number(compacto[i])) * 2;
  }
  const resto = total % 11;
  const resultado = (12 - resto) % 11;
  const digitoEsperado = resultado === 10 ? "X" : String(resultado);
  return compacto[15] === digitoEsperado;
}

/**
 * Consultar el ORCID validado que se encuentra asociado al perfil de un investigador o colaborador por correo o nombre.
 * Busca en el registro persistido en estado ('state.orcidRegistry'), en el catálogo institucional y en los miembros actuales,
 * devolviendo cadena vacía cuando la persona aún no tiene un ORCID registrado para que le sea solicitado.
 * parametros:
 *     - string : correo Correo electrónico institucional del investigador (opcional).
 *     - string : nombre Nombre completo del investigador o colaborador externo (opcional).
 * return:
 *     + string : orcid Identificador ORCID validado vinculado al perfil o cadena vacía si debe solicitarse.
 */
function obtenerOrcidDePerfil(correo = "", nombre = "") {
  // [Línea clave]: ¿Por qué soy importante? Recupera el ORCID vinculado al perfil del investigador. ¿Para qué? Autocompletar el ORCID al seleccionar su nombre sin generarlo sintéticamente. ¿Dónde me usan? En el buscador de equipo, colaboradores externos y perfil.
  const reg = state?.orcidRegistry || {};
  const c = String(correo || "").trim().toLowerCase();
  const n = String(nombre || "").trim().toLowerCase();
  if (c && reg[`correo:${c}`] && esOrcidValido(reg[`correo:${c}`])) {
    return reg[`correo:${c}`];
  }
  if (n && reg[`nombre:${n}`] && esOrcidValido(reg[`nombre:${n}`])) {
    return reg[`nombre:${n}`];
  }
  if (c && ORCID_PERFILES_INSTITUCIONALES[c]) {
    return ORCID_PERFILES_INSTITUCIONALES[c];
  }
  for (const m of state?.teamMembers || []) {
    if ((c && String(m.correo || "").trim().toLowerCase() === c) || (n && String(m.nombre || "").trim().toLowerCase() === n)) {
      if (esOrcidValido(m.orcid)) return String(m.orcid).trim().toUpperCase();
    }
  }
  for (const ext of state?.externalCollaborators || []) {
    if (n && String(ext.nombre || "").trim().toLowerCase() === n) {
      if (esOrcidValido(ext.orcid)) return String(ext.orcid).trim().toUpperCase();
    }
  }
  return "";
}

/**
 * Vincular y persistir un ORCID previamente validado al perfil de un investigador o colaborador en el estado de la aplicación.
 * Almacena la relación biunívoca por correo y por nombre en 'state.orcidRegistry' para que se autocomplete en futuras selecciones.
 * parametros:
 *     - string : correo Correo electrónico de la persona investigadora.
 *     - string : nombre Nombre completo de la persona investigadora o colaboradora.
 *     - string : orcid Identificador ORCID validado bajo ISO 7064 MOD 11-2.
 * return:
 *     + void : undefined Actualiza el registro de perfiles en memoria.
 */
function registrarOrcidEnPerfil(correo = "", nombre = "", orcid = "") {
  const orc = String(orcid || "").trim().toUpperCase();
  if (!esOrcidValido(orc)) return;
  state.orcidRegistry = state.orcidRegistry || {};
  const c = String(correo || "").trim().toLowerCase();
  const n = String(nombre || "").trim().toLowerCase();
  if (c) state.orcidRegistry[`correo:${c}`] = orc;
  if (n) state.orcidRegistry[`nombre:${n}`] = orc;
}

/**
 * Obtener el conjunto de identificadores ORCID ya asignados a otros participantes en la propuesta y registro activo.
 * Recorre los miembros del equipo investigador, colaboradores externos y perfiles registrados, excluyendo a la persona indicada.
 * parametros:
 *     - string : excluirCorreo Correo de la persona actual a excluir de la colisión.
 *     - string : excluirNombre Nombre de la persona actual a excluir de la colisión.
 * return:
 *     + Set<string> : ocupados Conjunto de cadenas ORCID en uso por otros investigadores.
 */
function obtenerOrcidsOcupados(excluirCorreo = "", excluirNombre = "") {
  // [Línea clave]: ¿Por qué soy importante? Garantiza la unicidad estricta de cada ORCID en el sistema. ¿Para qué? Impedir que dos investigadores o colaboradores compartan el mismo ORCID. ¿Dónde me usan? En team-save, external-add-save y actualización de perfil.
  const ocupados = new Set();
  const correoEx = String(excluirCorreo || "").trim().toLowerCase();
  const nombreEx = String(excluirNombre || "").trim().toLowerCase();
  for (const [correoCat, orcidCat] of Object.entries(ORCID_PERFILES_INSTITUCIONALES)) {
    if (correoEx && correoCat === correoEx) continue;
    ocupados.add(orcidCat.toUpperCase());
  }
  for (const m of state?.teamMembers || []) {
    const c = String(m.correo || "").trim().toLowerCase();
    const n = String(m.nombre || "").trim().toLowerCase();
    if ((correoEx && c === correoEx) || (nombreEx && n === nombreEx)) continue;
    const orc = String(m.orcid || obtenerOrcidDePerfil(m.correo, m.nombre)).trim().toUpperCase();
    if (orc) ocupados.add(orc);
  }
  for (const ext of state?.externalCollaborators || []) {
    const n = String(ext.nombre || "").trim().toLowerCase();
    if (nombreEx && n === nombreEx) continue;
    const orc = String(ext.orcid || "").trim().toUpperCase();
    if (orc) ocupados.add(orc);
  }
  return ocupados;
}

/**
 * Obtener el identificador ORCID validado asociado al perfil del usuario activo en sesión.
 * Consulta el objeto 'session.user.orcid' y el registro de perfiles institucionales por correo o nombre.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : orcidActivo Identificador ORCID validado del usuario en sesión o cadena vacía si no se ha registrado.
 */
function orcidUsuarioActivo() {
  if (!session?.user) return ORCID_PERFILES_INSTITUCIONALES["laura.mendez@example.com"];
  if (esOrcidValido(session.user.orcid)) return session.user.orcid.trim().toUpperCase();
  const desdePerfil = obtenerOrcidDePerfil(session.user.correo, session.user.nombre);
  if (desdePerfil) {
    session.user.orcid = desdePerfil;
    return desdePerfil;
  }
  return "";
}

/**
 * Expresión regular cliente para interceptar patrones de inyección SQL en controles de entrada.
 * Detecta sentencias UNION SELECT, DROP/ALTER/TRUNCATE, comentarios SQL y tautologías booleanas.
 * Se utiliza dentro de contieneInyeccionSQL() para validación inmediata en formularios y buscadores.
 */
const _SQLI_CLIENT_REGEX = /(\b(UNION\s+ALL\s+SELECT|UNION\s+SELECT|DROP\s+TABLE|DROP\s+DATABASE|INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET|ALTER\s+TABLE|TRUNCATE\s+TABLE|EXEC\s*\(|EXECUTE\s*\(|PG_SLEEP|WAITFOR\s+DELAY|INFORMATION_SCHEMA)\b|--\s|;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|SELECT)|'\s*(OR|AND)\s*'?\d+'?\s*=\s*'?\d+)/i;

/**
 * Verificar si un valor de texto escrito en el navegador contiene patrones sospechosos de inyección SQL.
 * Evalúa la cadena contra '_SQLI_CLIENT_REGEX' para bloquear el envío antes de que salga la petición HTTP.
 * parametros:
 *     - any : valor Cadena o valor del campo de formulario a inspeccionar.
 * return:
 *     + boolean : tieneInyeccion Verdadero si se detecta un patrón prohibido; falso si el texto es seguro.
 */
function contieneInyeccionSQL(valor) {
  if (typeof valor !== "string" || !valor) return false;
  // [Línea clave]: ¿Por qué soy importante? Filtro preventivo de seguridad en el cliente. ¿Para qué? Rechazar payloads de inyección SQL en tiempo real en cualquier input o textarea. ¿Dónde me usan? En validate(), listener global 'input' y guardado de modales.
  return _SQLI_CLIENT_REGEX.test(valor);
}

try {
  const s = JSON.parse(localStorage.getItem(SESSION_KEY));
  if (
    s &&
    s.user &&
    Array.isArray(s.user.roles) &&
    s.user.roles.length &&
    ROLE_KEYS[s.user.roles[0]]
  ) {
    if (!esOrcidValido(s.user.orcid)) {
      s.user.orcid = ORCID_PERFILES_INSTITUCIONALES[String(s.user.correo || "").trim().toLowerCase()] || "";
    }
    session = s;
  }
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
  if (s?.user && !esOrcidValido(s.user.orcid)) {
    s.user.orcid = obtenerOrcidDePerfil(s.user.correo, s.user.nombre);
  }
  if (s?.user?.orcid && esOrcidValido(s.user.orcid)) {
    registrarOrcidEnPerfil(s.user.correo, s.user.nombre, s.user.orcid);
  }
  session = s;
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else {
    localStorage.removeItem(SESSION_KEY);
    invalidarCatalogos();
  }
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
  "02": async () => {
    try {
      if (state.role === "vinculacion") return await cargarBandejaVinculacion();
      if (state.role === "comite") return await cargarBandejaComite();
      if (state.role === "consejo") return await cargarBandejaConsejo();
      if (state.role === "direccion") {
        // La bandeja alimenta el expediente y el dictamen; el dashboard alimenta las tarjetas.
        await Promise.all([cargarBandejaDireccion(), cargarDashboardDireccion()]);
        return null;
      }
      if (state.role === "cie") {
        // El CIE tiene su propio tablero de pendientes y resueltas del comité.
        await Promise.all([cargarBandejaCie(), cargarDashboardCie()]);
        return null;
      }
      return null;
    } catch (e) {
      console.warn("SCREEN_LOADERS 02 error:", e);
      return null;
    }
  },
  "04": obtener_convocatorias,
  "05": () =>
    Promise.all([
      obtenerEtapasConvocatoria(state.viewCall),
      obtenerDocumentosConvocatoria(state.viewCall),
    ]),
  "06": () => cargarMisPropuestas(),
  "20": () => cargarDossier(),
  "21": () => {
    if (state.role === "comite") return cargarBandejaComite();
    if (state.role === "consejo") return cargarBandejaConsejo();
    if (state.role === "direccion") return cargarBandejaDireccion();
    if (state.role === "cie") return cargarBandejaCie();
    return cargarBandejaVinculacion();
  },
  "22": () => cargarDossier(),
  "23": async () => {
    await cargarDossier();
    await cargarVinculacion();
  },
  "24": async () => {
    // [Línea clave]: El Comité Técnico abre su expediente con la rúbrica oficial y el
    // dictamen ya registrado; la evaluación preliminar de IA se conserva como referencia.
    if (state.role === "comite") {
      if (!bandejaComite?.length) await cargarBandejaComite();
      await Promise.all([
        cargarDossier(),
        cargarRubricaComite(),
        cargarEvaluacionComite(),
      ]);
    }
    await obtenerEvaluacionPreliminarIA(propuestaActivaId());
  },
  "25": async () => {
    // [Línea clave]: El Consejo de Escuela abre el expediente con las escuelas involucradas,
    // los avales ya registrados y el acuerdo firmado disponible para adjuntar.
    if (state.role === "consejo") {
      if (!bandejaConsejo?.length) await cargarBandejaConsejo();
      await Promise.all([cargarDossier(), cargarAvalConsejo()]);
    }
    await obtenerEvaluacionPreliminarIA(propuestaActivaId());
  },
  "26": async () => {
    if (state.role === "direccion") {
      if (!bandejaDireccion?.length) await cargarBandejaDireccion();
      await Promise.all([cargarDossier(), cargarDictamenDireccion()]);
      return obtenerEvaluacionPreliminarIA(propuestaActivaId());
    }
    return obtenerEvaluacionPreliminarIA(propuestaActivaId());
  },
  "27": async () => {
    // [Línea clave]: El formulario de resolución del CIE consume el expediente real: el
    // dictamen de Dirección, el catálogo institucional de acuerdos y los documentos.
    if (state.role === "cie") {
      if (!bandejaCie?.length) await cargarBandejaCie();
      await Promise.all([cargarDossier(), cargarResolucionCie()]);
      return null;
    }
    return obtenerEvaluacionPreliminarIA(propuestaActivaId());
  },
  "28": () => cargarDossier(),
  "30": () => buscarPropuestas(),
  // [Línea clave]: Las pantallas 31 y 32 consumen el CRUD administrativo real del backend.
  "31": async () => {
    await Promise.all([cargarConvocatoriasAdmin(), cargarCatalogosAdmin()]);
    return null;
  },
  "32": async () => {
    await Promise.all([cargarRubricaAdmin(), cargarCatalogosAdmin()]);
    return null;
  },
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
  try {
    // Se espera el cargador para que la pantalla se pinte con los datos ya cargados.
    // Cada cargador captura sus propios errores, así que un fallo no deja la SPA congelada.
    await loader();
  } catch (err) {
    console.warn("loadScreenData loader error:", err);
  }
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
  // [Línea clave]: El punto de la campana se apaga en cuanto no quedan notificaciones sin leer.
  if ((notificaciones ?? []).length && (notificaciones ?? []).every((x) => x.leida)) {
    state.read = true;
    save();
  }
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
  // [Línea clave]: Al marcar todas se apaga el indicador de la campana y se persiste el estado.
  state.read = true;
  save();
  if (!idUsuario) return;
  fetch(`${API_URL}/notificaciones/leer-todas?id_usuario=${idUsuario}`, { method: "PATCH" })
    .catch((e) => console.warn("Error marcando todas leídas:", e));
}

const CATALOGOS_TTL_MS = 5 * 60 * 1000;
const catalogsLoadedAt = { modalidades: 0, escuelas: 0, lineas: 0, convocatorias: 0, catalogos: 0 };

function catalogoVigente(clave, valor) {
  return Boolean(valor) && Date.now() - (catalogsLoadedAt[clave] || 0) < CATALOGOS_TTL_MS;
}

function marcarCatalogo(clave) {
  catalogsLoadedAt[clave] = Date.now();
}

function invalidarCatalogos() {
  Object.keys(catalogsLoadedAt).forEach((clave) => {
    catalogsLoadedAt[clave] = 0;
  });
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
  if (catalogoVigente("modalidades", modalidades)) return modalidades;
  try {
    const res = await fetch(`${API_URL}/modalidades/totalmodalidades`);
    if (res.ok) {
      modalidades = await res.json();
      marcarCatalogo("modalidades");
    }
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
  if (catalogoVigente("escuelas", escuelas)) return escuelas;
  try {
    const res = await fetch(`${API_URL}/escuelas/totalescuelas?id_usuario=${idUsuario}`);
    if (res.ok) {
      escuelas = await res.json();
      marcarCatalogo("escuelas");
    }
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
  if (catalogoVigente("lineas", lineas_investigacion)) return lineas_investigacion;
  try {
    const res = await fetch(`${API_URL}/lineas_de_investigacion/totalLineas`);
    if (res.ok) {
      lineas_investigacion = await res.json();
      marcarCatalogo("lineas");
    }
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
  if (catalogoVigente("convocatorias", convocatorias)) return convocatorias;
  try {
    const res = await fetch(`${API_URL}/convocatorias/totalConvocatorias`);
    if (res.ok) {
      convocatorias = await res.json();
      marcarCatalogo("convocatorias");
    }
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
  if (catalogoVigente("catalogos", catalogos)) return catalogos;
  try {
    const res = await fetch(`${API_URL}/catalogos`);
    if (res.ok) {
      catalogos = await res.json();
      marcarCatalogo("catalogos");
    }
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
    // [Línea clave]: ¿Por qué soy importante? Descarga el dictamen preliminar ya guardado desde el Backend. ¿Para qué? Mostrar a cada nivel evaluador su guía de referencia sin bloquear la lectura generando IA. ¿Dónde me usan? En dossier() y evaluation().
    const res = await fetch(`${API_URL}/ia/evaluacion-preliminar/${idPropuesta}`);
    evaluacionPreliminarIA = res.ok ? await res.json() : null;
  } catch (err) {
    console.warn("obtenerEvaluacionPreliminarIA error:", err);
    evaluacionPreliminarIA = null;
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
      id_propuesta: propuestaActivaId(),
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
  if (!session?.user) return;
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
  ]);
}

let bandejaPropuestas = null;
let misPropuestas = null;
let dossierActual = null;
let dossierCargadoEn = 0;
let evaluacionVinculacion = null;
let documentosVinculacion = [];
let historialPropuestas = null;
let vinculacionCargadaId = null;
let archivosBorrador = [];
let bandejaComite = null;
let evaluacionComite = null;
let rubricaComite = null;
let comiteCargadoId = null;
let bandejaConsejo = null;
let avalConsejo = null;
let consejoCargadoId = null;
// [Línea clave]: Estado en memoria de la Dirección de Investigación. Si estas variables no se
// declaran, cada asignación lanza ReferenceError porque el archivo usa modo estricto y la
// bandeja y el dashboard quedan vacíos en pantalla.
let bandejaDireccion = [];
let dictamenDireccion = null;
let direccionCargadoId = null;
let dashboardDireccion = null;
// [Línea clave]: Estado en memoria del Comité de Ética en Investigación (pantallas 02, 21, 27 y 28).
let bandejaCie = [];
let resolucionCie = null;
let cieCargadoId = null;
let dashboardCie = null;
// [Línea clave]: Estado en memoria de la administración institucional (pantallas 31 y 32).
let adminConvocatorias = [];
let adminEtapas = [];
let adminDocumentos = [];
let adminRubrica = null;
let adminCatalogosDatos = null;
let adminConvocatoriaId = null;

/**
 * Cronograma oficial de la Convocatoria Fondos VIE 2027.
 * Cada tupla es [etapa, ventana temporal] y se usa en las pantallas 05, 31 y 32.
 * Es el respaldo estático mientras la convocatoria todavía no se administra desde el backend.
 */
const calendarRows = [
  ["Formulación", "28 jul – 21 ago 2026"],
  ["Vinculación", "24 – 28 ago 2026"],
  ["Evaluación técnica", "31 ago – 11 sep 2026"],
  ["Avales de consejos", "14 – 25 sep 2026"],
  ["Sometimiento formal", "28 sep 2026"],
  ["Dictamen de Dirección", "29 sep – 12 oct 2026"],
  ["Resolución CIE", "13 – 23 oct 2026"],
  ["Carta de aceptación", "02 – 06 nov 2026"],
];

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
    fechaIngreso: p.fecha_ingreso_comite || null,
    fechaIngresoConsejo: p.fecha_ingreso_consejo || null,
    fechaIngresoVie: p.fecha_ingreso_vie || null,
    fechaIngresoCie: p.fecha_ingreso_cie || null,
    fechaCreacion: p.fecha_creacion || null,
    miAval: !!p.mi_aval,
    avalesRegistrados: Number(p.avales_registrados || 0),
    escuelasInvolucradas: Number(p.escuelas_involucradas || 0),
    resolucionCie: p.resolucion_cie || null,
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
  return `El sistema respondió con código ${res.status}.`;
}

/**
 * Descargar las propuestas del investigador autenticado del sistema (Pantalla 06).
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
 * Determinar si una propuesta de la bandeja está en estado 2 ("En revisión de Vinculación").
 * Tolera acentos y mayúsculas en el nombre del estado devuelto por el backend.
 * parametros:
 *     - Object : p Propuesta normalizada con la propiedad 'status'.
 * return:
 *     + boolean : pendiente Verdadero si espera el dictamen de Vinculación.
 */
const esPendienteVinculacion = (p) => /revisi[oó]n de vinculaci/i.test((p && p.status) || "");

/**
 * Descargar la bandeja de Vinculación del sistema y conservar la propuesta activa.
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
        // [Línea clave]: Prioriza la propuesta más reciente en revisión de Vinculación; si no hay, usa la primera de la bandeja.
        const objetivo = bandejaPropuestas.find(esPendienteVinculacion) || bandejaPropuestas[0];
        state.viewProposalId = objetivo.id;
        state.viewProposal = objetivo.code;
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
async function cargarDossier(idPropuesta = propuestaActivaId(), forzar = false) {
  if (!idPropuesta) return null;
  const mismoExpediente =
    dossierActual &&
    Number(dossierActual.id_propuesta) === Number(idPropuesta) &&
    Date.now() - dossierCargadoEn < 3000;
  if (mismoExpediente && !forzar) return dossierActual;
  try {
    const res = await fetch(`${API_URL}/propuestas/${idPropuesta}`);
    if (res.ok) {
      dossierActual = await res.json();
      dossierCargadoEn = Date.now();
      evaluacionPreliminarIA = dossierActual.evaluacion_ia || null;
      state.viewProposalId = Number(dossierActual.id_propuesta) || idPropuesta;
      state.viewProposal = dossierActual.codigo || state.viewProposal;
    } else {
      dossierActual = null;
      evaluacionPreliminarIA = null;
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
 * Resolver el identificador de un estado por su nombre oficial usando el catálogo de PostgreSQL.
 * El frontend nunca escribe identificadores de estado a mano: el orden de los identificadores
 * en la tabla «estados» difiere entre ambientes y solo el catálogo declara el nombre válido.
 * parametros:
 *     - string : nombre Nombre oficial del estado, por ejemplo «Con observaciones».
 * return:
 *     + number|null : id Identificador del estado o null si el catálogo no lo contiene.
 */
function idEstadoPorNombre(nombre) {
  const lista = catalogos?.estados || [];
  const fila = lista.find(
    (e) =>
      String(e.nombre_estado || "").trim().toLowerCase() ===
      String(nombre || "").trim().toLowerCase(),
  );
  return fila ? Number(fila.id_estado) : null;
}

/**
 * Cambiar el estado de una propuesta mediante el endpoint genérico de la API.
 * El backend valida la transición contra la máquina de estados institucional y el rol del usuario.
 * parametros:
 *     - number : idPropuesta Identificador de la propuesta.
 *     - string : nombreEstado Nombre oficial del estado destino.
 *     - string : observaciones Justificación de la transición.
 * return:
 *     + Promise<Object> : resultado Respuesta del backend con el nuevo estado.
 */
async function apiCambiarEstado(idPropuesta, nombreEstado, observaciones = "") {
  const idNuevoEstado = idEstadoPorNombre(nombreEstado);
  if (!idNuevoEstado)
    throw new Error(`El estado «${nombreEstado}» no está en el catálogo institucional.`);
  const res = await fetch(`${API_URL}/propuestas/${idPropuesta}/estado`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_nuevo_estado: idNuevoEstado,
      id_usuario_responsable: session?.user?.id_usuario,
      observaciones,
    }),
  });
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

/**
 * Ejecutar un trámite del expediente (reenvío, aceptación, informe o cierre).
 * parametros:
 *     - number : idPropuesta Identificador de la propuesta.
 *     - string : accion Ruta del trámite ('observaciones/reenvio', 'aceptacion', 'informe' o 'cierre').
 *     - Object : payload Datos adicionales del trámite.
 * return:
 *     + Promise<Object> : resultado Respuesta del backend con el estado resultante.
 */
async function apiTramite(idPropuesta, accion, payload = {}) {
  const res = await fetch(`${API_URL}/propuestas/${idPropuesta}/${accion}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_usuario: session?.user?.id_usuario, ...payload }),
  });
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

/**
 * Leer el valor vigente de un campo del formulario o del modal activo.
 * Prioriza el control visible en pantalla (lo que el usuario acaba de escribir) y cae al
 * borrador persistido en 'state.saved' cuando el control ya no existe en el DOM.
 * parametros:
 *     - string : clave Clave estable del campo (atributo data-field).
 *     - string : porDefecto Valor devuelto cuando el campo no tiene contenido.
 * return:
 *     + string : valor Texto recortado del campo o el valor por defecto.
 */
function valorCampo(clave, porDefecto = "") {
  const control = document.querySelector(`[data-field="${clave}"]`);
  if (control)
    return control.type === "checkbox"
      ? control.checked
      : String(control.value || "").trim();
  const guardado = state.saved[clave];
  return guardado === undefined || guardado === null ? porDefecto : String(guardado).trim();
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
 * Subir el oficio firmado de Vinculación a la nube.
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
 * Determinar si una propuesta de la bandeja del Comité Técnico ya fue dictaminada.
 * Tolera acentos y mayúsculas en el nombre del estado devuelto por el backend.
 * parametros:
 *     - Object : p Propuesta normalizada con la propiedad 'status'.
 * return:
 *     + boolean : pendiente Verdadero si espera el dictamen del Comité Técnico.
 */
const esPendienteComite = (p) => /evaluaci[oó]n del comit[eé]/i.test((p && p.status) || "");

/**
 * Descargar la bandeja del Comité Técnico del sistema y conservar la propuesta activa.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : bandejaComite Propuestas asignadas al Comité Técnico.
 */
async function cargarBandejaComite() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(
      `${API_URL}/propuestas/comite/bandeja?rol=${encodeURIComponent("Comité Técnico")}&id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      bandejaComite = (await res.json()).map(mapearPropuestaBackend);
      if (!state.viewProposalId && bandejaComite.length) {
        // [Línea clave]: Prioriza la propuesta pendiente del dictamen; si no hay, usa la primera de la bandeja.
        const objetivo = bandejaComite.find(esPendienteComite) || bandejaComite[0];
        state.viewProposalId = objetivo.id;
        state.viewProposal = objetivo.code;
      }
    } else {
      console.warn("cargarBandejaComite:", await errorDesdeRespuesta(res));
      bandejaComite = [];
    }
  } catch (err) {
    console.warn("cargarBandejaComite error:", err);
    bandejaComite = [];
  }
  return bandejaComite;
}

/**
 * Descargar la rúbrica oficial del Comité Técnico cargada en PostgreSQL.
 * Si la migración V12 no está aplicada, retorna null y la vista usa la rúbrica local de respaldo.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Object|null> : rubricaComite Secciones, criterios y reglas de recomendación.
 */
async function cargarRubricaComite() {
  if (rubricaComite?.secciones?.length) return rubricaComite;
  try {
    const res = await fetch(`${API_URL}/propuestas/comite/rubrica`);
    rubricaComite = res.ok ? await res.json() : null;
  } catch (err) {
    console.warn("cargarRubricaComite error:", err);
    rubricaComite = null;
  }
  return rubricaComite;
}

/**
 * Obtener la rúbrica activa en formato de grupos [sección, [[criterio, peso, obligatorio]]].
 * Usa la rúbrica de PostgreSQL y cae a la matriz local si aún no está disponible.
 * parametros:
 *     (ninguno)
 * return:
 *     + Array : grupos Secciones ponderadas listas para renderizar y calcular.
 */
function gruposRubrica() {
  const secciones = rubricaComite?.secciones || [];
  if (!secciones.length) return criterionGroups;
  return secciones.map((s) => [
    s.nombre_seccion,
    (s.criterios || []).map((c) => [
      c.nombre_criterio,
      Number(c.peso_relativo),
      !!c.es_obligatorio,
    ]),
  ]);
}

/**
 * Indexar los criterios de la rúbrica de PostgreSQL por nombre para construir el payload.
 * parametros:
 *     (ninguno)
 * return:
 *     + Map<string, Object> : mapa Criterio con id_criterio_rubrica, peso y obligatoriedad.
 */
function mapaCriteriosComite() {
  const mapa = new Map();
  (rubricaComite?.secciones || []).forEach((seccion) =>
    (seccion.criterios || []).forEach((criterio) => mapa.set(criterio.nombre_criterio, criterio)),
  );
  return mapa;
}

/**
 * Descargar el dictamen del Comité Técnico, sus puntajes por criterio y los documentos.
 * parametros:
 *     - number : idPropuesta Identificador del expediente; por defecto usa la propuesta activa.
 * return:
 *     + Promise<Object|null> : evaluacionComite Expediente de evaluación del Comité.
 */
async function cargarEvaluacionComite(idPropuesta = propuestaActivaId()) {
  const idUsuario = session?.user?.id_usuario;
  if (!idPropuesta || !idUsuario) return null;
  if (comiteCargadoId !== Number(idPropuesta)) {
    Object.keys(state.saved)
      .filter((clave) => clave.startsWith("comite:"))
      .forEach((clave) => delete state.saved[clave]);
    // [Línea clave]: Al cambiar de expediente se descartan los niveles del anterior para no
    // mezclar rúbricas entre propuestas distintas.
    state.scores = {};
    state.notRecommended = false;
    comiteCargadoId = Number(idPropuesta);
  }
  try {
    const res = await fetch(
      `${API_URL}/propuestas/comite/${idPropuesta}?id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      evaluacionComite = await res.json();
      // [Línea clave]: Refleja en la rúbrica los niveles ya dictaminados para que la
      // pantalla 24 se abra en modo consulta con los valores persistidos.
      (evaluacionComite.puntajes || []).forEach((p) => {
        state.scores[p.nombre_criterio] = Number(p.puntaje);
      });
      if (evaluacionComite.evaluacion?.justificacion) {
        state.saved["comite:justificacion"] = evaluacionComite.evaluacion.justificacion;
      }
      if (evaluacionComite.evaluacion?.observaciones) {
        state.saved["comite:observaciones"] = evaluacionComite.evaluacion.observaciones;
      }
      if (evaluacionComite.evaluacion?.decision) {
        // [Línea clave]: Un dictamen de observaciones o rechazo mantiene la propuesta
        // como no recomendada al reabrir el expediente en modo consulta.
        state.notRecommended = evaluacionComite.evaluacion.decision !== "favorable";
      }
    } else {
      console.warn("cargarEvaluacionComite:", await errorDesdeRespuesta(res));
      evaluacionComite = null;
    }
  } catch (err) {
    console.warn("cargarEvaluacionComite error:", err);
    evaluacionComite = null;
  }
  save();
  return evaluacionComite;
}

/**
 * Registrar el dictamen del Comité Técnico y devolver el nuevo estado de la propuesta.
 * parametros:
 *     - number : idPropuesta Identificador de la propuesta.
 *     - Object : payload Puntajes por criterio, justificación, decisión y documento.
 * return:
 *     + Promise<Object> : resultado Respuesta del backend con estado, puntaje y bloqueo.
 */
async function guardarEvaluacionComite(idPropuesta, payload) {
  const res = await fetch(`${API_URL}/propuestas/comite/${idPropuesta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

/**
 * Construir el payload del dictamen del Comité Técnico desde la rúbrica de la pantalla 24.
 * parametros:
 *     - string : decision Resultado favorable, observaciones o rechazo.
 *     - string : observaciones Detalle de la devolución o rechazo.
 *     - number|null : idDocumento Documento del acta ya registrado en el expediente.
 * return:
 *     + Object : payload Cuerpo JSON esperado por POST /propuestas/comite/{id}.
 */
function payloadEvaluacionComite(decision = "favorable", observaciones = "", idDocumento = null) {
  const mapa = mapaCriteriosComite();
  const puntajes = [];
  for (const [, criterios] of gruposRubrica())
    for (const [nombre] of criterios) {
      const criterio = mapa.get(nombre);
      if (!criterio)
        throw new Error(
          `La rúbrica del sistema no coincide con el criterio «${nombre}». Recarga la pantalla e intenta de nuevo.`,
        );
      puntajes.push({
        id_criterio_rubrica: criterio.id_criterio_rubrica,
        puntaje: Number(scoreValue(nombre)),
      });
    }
  const produccion = document.getElementById("products-ok");
  return {
    id_usuario_eval: session?.user?.id_usuario,
    puntajes,
    justificacion:
      state.saved["comite:justificacion"] ||
      "La propuesta acredita los criterios obligatorios de la rúbrica oficial.",
    observaciones:
      observaciones || "Evaluación técnica registrada por el Comité Técnico.",
    produccion_conforme: produccion ? produccion.checked : !state.notRecommended,
    decision,
    id_documento: idDocumento,
  };
}

/**
 * Determinar si una propuesta de la bandeja del Consejo de Escuela todavía espera aval.
 * Una propuesta con aval ya registrado por la escuela del usuario no cuenta como pendiente.
 * parametros:
 *     - Object : p Propuesta normalizada con las propiedades 'status' y 'miAval'.
 * return:
 *     + boolean : pendiente Verdadero si espera el aval del Consejo de Escuela.
 */
const esPendienteConsejo = (p) =>
  /pendiente de aval del consejo/i.test((p && p.status) || "") && !(p && p.miAval);

/**
 * Determinar si una propuesta de la bandeja de Dirección sigue pendiente de dictamen.
 * Solo las propuestas «Sometida ante VIE» esperan la decisión de Dirección.
 * parametros:
 *     - Object : p Propuesta normalizada con la propiedad 'status'.
 * return:
 *     + boolean : pendiente Verdadero si espera el dictamen de Dirección.
 */
const esPendienteDireccion = (p) => /sometida ante vie/i.test((p && p.status) || "");

/**
 * Determinar si una propuesta de la bandeja del CIE sigue pendiente de resolución.
 * Solo las propuestas «Dictaminada por Dirección» y sin acuerdo registrado esperan al comité.
 * parametros:
 *     - Object : p Propuesta normalizada con las propiedades 'status' y 'resolucionCie'.
 * return:
 *     + boolean : pendiente Verdadero si espera la resolución del Comité de Ética.
 */
const esPendienteCie = (p) =>
  /dictaminada por direcci/i.test((p && p.status) || "") && !(p && p.resolucionCie);

/**
 * Descargar la bandeja del Consejo de Escuela del sistema y conservar la propuesta activa.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : bandejaConsejo Propuestas pendientes de aval de la escuela.
 */
async function cargarBandejaConsejo() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(
      `${API_URL}/propuestas/consejo/bandeja?rol=${encodeURIComponent("Consejo de Escuela")}&id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      bandejaConsejo = (await res.json()).map(mapearPropuestaBackend);
      if (!state.viewProposalId && bandejaConsejo.length) {
        // [Línea clave]: Prioriza la propuesta que espera aval; si no hay, usa la primera de la bandeja.
        const objetivo = bandejaConsejo.find(esPendienteConsejo) || bandejaConsejo[0];
        state.viewProposalId = objetivo.id;
        state.viewProposal = objetivo.code;
      }
    } else {
      console.warn("cargarBandejaConsejo:", await errorDesdeRespuesta(res));
      bandejaConsejo = [];
    }
  } catch (err) {
    console.warn("cargarBandejaConsejo error:", err);
    bandejaConsejo = [];
  }
  return bandejaConsejo;
}

/**
 * Descargar el expediente de aval del Consejo de Escuela con sus escuelas y acuerdos.
 * parametros:
 *     - number : idPropuesta Identificador del expediente; por defecto usa la propuesta activa.
 * return:
 *     + Promise<Object|null> : avalConsejo Detalle del aval y de las escuelas involucradas.
 */
async function cargarAvalConsejo(idPropuesta = propuestaActivaId()) {
  const idUsuario = session?.user?.id_usuario;
  if (!idPropuesta || !idUsuario) return null;
  if (consejoCargadoId !== Number(idPropuesta)) {
    // [Línea clave]: Al cambiar de expediente se descartan los datos del aval anterior
    // para no mezclar acuerdos entre propuestas distintas.
    Object.keys(state.saved)
      .filter((clave) => clave.startsWith("consejo:"))
      .forEach((clave) => delete state.saved[clave]);
    consejoCargadoId = Number(idPropuesta);
  }
  try {
    const res = await fetch(
      `${API_URL}/propuestas/consejo/${idPropuesta}?id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      avalConsejo = await res.json();
      // [Línea clave]: Refleja en el formulario el aval ya registrado para abrir en modo consulta.
      if (avalConsejo?.mi_aval) {
        const aval = avalConsejo.mi_aval;
        state.saved["consejo:sesion"] = aval.numero_sesion || "";
        state.saved["consejo:articulo"] = aval.articulo || "";
        state.saved["consejo:fecha"] = aval.fecha_acuerdo || "";
        state.saved["consejo:oficio"] = aval.numero_oficio || "";
        state.saved["consejo:observaciones"] = aval.observaciones || "";
        state.saved["consejo:ratifica"] = aval.ratifica_calificacion !== false;
        state.saved["consejo:presupuesto"] = aval.avala_presupuesto !== false;
        state.saved["consejo:horas"] = aval.avala_horas_personal !== false;
      }
    } else {
      console.warn("cargarAvalConsejo:", await errorDesdeRespuesta(res));
      avalConsejo = null;
    }
  } catch (err) {
    console.warn("cargarAvalConsejo error:", err);
    avalConsejo = null;
  }
  save();
  return avalConsejo;
}

/**
 * Registrar el aval del Consejo de Escuela y devolver el nuevo estado de la propuesta.
 * parametros:
 *     - number : idPropuesta Identificador de la propuesta.
 *     - Object : payload Datos del acuerdo, decisiones y documento firmado.
 * return:
 *     + Promise<Object> : resultado Respuesta del backend con estado y avales pendientes.
 */
async function guardarAvalConsejo(idPropuesta, payload) {
  const res = await fetch(`${API_URL}/propuestas/consejo/${idPropuesta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

/**
 * Descargar la bandeja de Dirección de Investigación del sistema.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>|null> : bandejaDireccion Propuestas sometidas ante VIE.
 */
async function cargarBandejaDireccion() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(
      `${API_URL}/propuestas/direccion/bandeja?rol=${encodeURIComponent("Dirección de Investigación")}&id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      bandejaDireccion = (await res.json()).map(mapearPropuestaBackend);
      if (!state.viewProposalId && bandejaDireccion.length) {
        const objetivo = bandejaDireccion[0];
        state.viewProposalId = objetivo.id;
        state.viewProposal = objetivo.code;
      }
    } else {
      console.warn("cargarBandejaDireccion:", await errorDesdeRespuesta(res));
      bandejaDireccion = [];
    }
  } catch (err) {
    console.warn("cargarBandejaDireccion error:", err);
    bandejaDireccion = [];
  }
  return bandejaDireccion;
}

/**
 * Cargar el dashboard de Dirección de Investigación.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Object|null> : dashboardDireccion Métricas y propuesta destacada.
 */
async function cargarDashboardDireccion() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) {
    dashboardDireccion = null;
    if ((location.hash.replace("#", "") || "01") === "02" && state.role === "direccion") {
      try {
        render();
      } catch (_) {}
    }
    return null;
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = setTimeout(() => {
    if (controller) controller.abort();
  }, 8000);
  try {
    const res = await fetch(
      `${API_URL}/propuestas/direccion/dashboard?rol=${encodeURIComponent("Dirección de Investigación")}&id_usuario=${idUsuario}`,
      controller ? { signal: controller.signal } : undefined,
    );
    clearTimeout(timeout);
    if (res.ok) {
      try {
        const data = await res.json();
        dashboardDireccion = data || null;
        if (!state.viewProposalId && dashboardDireccion?.propuesta_destacada?.id_propuesta) {
          state.viewProposalId = dashboardDireccion.propuesta_destacada.id_propuesta;
          state.viewProposal = dashboardDireccion.propuesta_destacada.codigo;
        }
      } catch (err) {
        console.warn("cargarDashboardDireccion json error:", err);
        dashboardDireccion = null;
      }
    } else {
      try {
        console.warn("cargarDashboardDireccion:", await errorDesdeRespuesta(res));
      } catch (_) {
        console.warn("cargarDashboardDireccion: respuesta no OK");
      }
      dashboardDireccion = null;
    }
  } catch (err) {
    clearTimeout(timeout);
    console.warn("cargarDashboardDireccion error:", err);
    dashboardDireccion = null;
  }
  if ((location.hash.replace("#", "") || "01") === "02" && state.role === "direccion") {
    try {
      render();
    } catch (_) {}
  }
  return dashboardDireccion;
}

/**
 * Descargar el expediente para dictamen de Dirección de Investigación.
 * parametros:
 *     - number : idPropuesta Identificador de la propuesta.
 * return:
 *     + Promise<Object|null> : dictamenDireccion Expdiente para dictamen.
 */
async function cargarDictamenDireccion(idPropuesta = propuestaActivaId()) {
  const idUsuario = session?.user?.id_usuario;
  if (!idPropuesta || !idUsuario) return null;
  if (direccionCargadoId !== Number(idPropuesta)) {
    Object.keys(state.saved)
      .filter((clave) => clave.startsWith("direccion:"))
      .forEach((clave) => delete state.saved[clave]);
    direccionCargadoId = Number(idPropuesta);
  }
  try {
    const res = await fetch(
      `${API_URL}/propuestas/direccion/${idPropuesta}?id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      dictamenDireccion = await res.json();
    } else {
      console.warn("cargarDictamenDireccion:", await errorDesdeRespuesta(res));
      dictamenDireccion = null;
    }
  } catch (err) {
    console.warn("cargarDictamenDireccion error:", err);
    dictamenDireccion = null;
  }
  return dictamenDireccion;
}

/**
 * Registrar el dictamen de Dirección de Investigación.
 * parametros:
 *     - number : idPropuesta Identificador de la propuesta.
 *     - Object : payload Datos del dictamen.
 * return:
 *     + Promise<Object> : Resultado de registro.
 */
async function guardarDictamenDireccion(idPropuesta, payload) {
  const res = await fetch(`${API_URL}/propuestas/direccion/${idPropuesta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

// =====================================================================
// COMITÉ DE ÉTICA EN INVESTIGACIÓN (CIE)
// =====================================================================

/**
 * Descargar la bandeja del Comité de Ética en Investigación del sistema.
 * parametro:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>> : bandejaCie Propuestas dictaminadas por Dirección.
 */
async function cargarBandejaCie() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) return null;
  try {
    const res = await fetch(
      `${API_URL}/propuestas/cie/bandeja?rol=${encodeURIComponent("CIE")}&id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      bandejaCie = (await res.json()).map(mapearPropuestaBackend);
      if (!state.viewProposalId && bandejaCie.length) {
        const objetivo = bandejaCie[0];
        state.viewProposalId = objetivo.id;
        state.viewProposal = objetivo.code;
      }
    } else {
      console.warn("cargarBandejaCie:", await errorDesdeRespuesta(res));
      bandejaCie = [];
    }
  } catch (err) {
    console.warn("cargarBandejaCie error:", err);
    bandejaCie = [];
  }
  return bandejaCie;
}

/**
 * Cargar el dashboard del Comité de Ética en Investigación.
 * parametro:
 *     (ninguno)
 * return:
 *     + Promise<Object|null> : dashboardCie Métricas y propuesta destacada.
 */
async function cargarDashboardCie() {
  const idUsuario = session?.user?.id_usuario;
  if (!idUsuario) {
    dashboardCie = null;
    return null;
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = setTimeout(() => {
    if (controller) controller.abort();
  }, 8000);
  try {
    const res = await fetch(
      `${API_URL}/propuestas/cie/dashboard?rol=${encodeURIComponent("CIE")}&id_usuario=${idUsuario}`,
      controller ? { signal: controller.signal } : undefined,
    );
    clearTimeout(timeout);
    if (res.ok) {
      try {
        const data = await res.json();
        dashboardCie = data || null;
        if (!state.viewProposalId && dashboardCie?.propuesta_destacada?.id_propuesta) {
          state.viewProposalId = dashboardCie.propuesta_destacada.id_propuesta;
          state.viewProposal = dashboardCie.propuesta_destacada.codigo;
        }
      } catch (err) {
        console.warn("cargarDashboardCie json error:", err);
        dashboardCie = null;
      }
    } else {
      try {
        console.warn("cargarDashboardCie:", await errorDesdeRespuesta(res));
      } catch (_) {
        console.warn("cargarDashboardCie: respuesta no OK");
      }
      dashboardCie = null;
    }
  } catch (err) {
    clearTimeout(timeout);
    console.warn("cargarDashboardCie error:", err);
    dashboardCie = null;
  }
  if ((location.hash.replace("#", "") || "01") === "02" && state.role === "cie") {
    try {
      render();
    } catch (_) {}
  }
  return dashboardCie;
}

/**
 * Descargar el expediente para resolver ante el Comité de Ética en Investigación.
 * parametro:
 *     - number : idPropuesta Identificador de la propuesta.
 * return:
 *     + Promise<Object|null> : resolucionCie Expediente con el catálogo de resoluciones.
 */
async function cargarResolucionCie(idPropuesta = propuestaActivaId()) {
  const idUsuario = session?.user?.id_usuario;
  if (!idPropuesta || !idUsuario) return null;
  if (cieCargadoId !== Number(idPropuesta)) {
    Object.keys(state.saved)
      .filter((clave) => clave.startsWith("cie:"))
      .forEach((clave) => delete state.saved[clave]);
    cieCargadoId = Number(idPropuesta);
  }
  try {
    const res = await fetch(
      `${API_URL}/propuestas/cie/${idPropuesta}?id_usuario=${idUsuario}`,
    );
    if (res.ok) {
      resolucionCie = await res.json();
    } else {
      console.warn("cargarResolucionCie:", await errorDesdeRespuesta(res));
      resolucionCie = null;
    }
  } catch (err) {
    console.warn("cargarResolucionCie error:", err);
    resolucionCie = null;
  }
  return resolucionCie;
}

/**
 * Registrar la resolución del Comité de Ética en Investigación.
 * parametro:
 *     - number : idPropuesta Identificador de la propuesta.
 *     - Object : payload Datos del acuerdo colegiado.
 * return:
 *     + Promise<Object> : Resultado de registro.
 */
async function guardarResolucionCie(idPropuesta, payload) {
  const res = await fetch(`${API_URL}/propuestas/cie/${idPropuesta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

/**
 * Registrar condiciones de aceptación posteriores a la resolución del CIE.
 * parametro:
 *     - number : idPropuesta Identificador de la propuesta.
 *     - Object : payload Condiciones de aceptación.
 * return:
 *     + Promise<Object> : Resultado de registro.
 */
async function guardarCondicionesCie(idPropuesta, payload) {
  const res = await fetch(`${API_URL}/propuestas/cie/${idPropuesta}/condiciones`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

// =====================================================================
// ADMINISTRACIÓN INSTITUCIONAL (PANTALLAS 31 Y 32)
// =====================================================================

/**
 * Obtener el identificador del usuario con facultad administrativa en sesión.
 * parametros:
 *     (ninguno)
 * return:
 *     + number : idUsuario Identificador del usuario autenticado.
 */
const idUsuarioAdmin = () => session?.user?.id_usuario;

/**
 * Ejecutar una petición contra el router administrativo y propagar el error del servidor.
 * parametros:
 *     - string : ruta Ruta relativa dentro de /admin.
 *     - string : metodo Verbo HTTP ('GET', 'POST', 'PATCH', 'DELETE').
 *     - Object|null : cuerpo Cuerpo JSON opcional.
 * return:
 *     + Promise<any> : respuesta Contenido JSON devuelto por el backend.
 */
async function peticionAdmin(ruta, metodo = "GET", cuerpo = null) {
  const separador = ruta.includes("?") ? "&" : "?";
  const url = `${API_URL}/admin${ruta}${separador}id_usuario=${idUsuarioAdmin()}`;
  const opciones = { method: metodo };
  if (cuerpo !== null) {
    opciones.headers = { "Content-Type": "application/json" };
    opciones.body = JSON.stringify(cuerpo);
  }
  const res = await fetch(url, opciones);
  if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
  return res.json();
}

/**
 * Descargar las convocatorias administrables con su cronograma e instrumentos.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>> : adminConvocatorias Convocatorias registradas en PostgreSQL.
 */
async function cargarConvocatoriasAdmin() {
  try {
    const lista = await peticionAdmin("/convocatorias");
    adminConvocatorias = Array.isArray(lista) ? lista : [];
    if (!adminConvocatorias.some((c) => c.id_convocatoria === adminConvocatoriaId)) {
      adminConvocatoriaId = adminConvocatorias[0]?.id_convocatoria ?? null;
    }
    await Promise.all([cargarEtapasAdmin(), cargarDocumentosAdmin()]);
  } catch (err) {
    console.warn("cargarConvocatoriasAdmin error:", err);
    adminConvocatorias = [];
  }
  return adminConvocatorias;
}

/**
 * Descargar el cronograma de la convocatoria seleccionada.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>> : adminEtapas Etapas ordenadas por secuencia.
 */
async function cargarEtapasAdmin() {
  if (!adminConvocatoriaId) {
    adminEtapas = [];
    return adminEtapas;
  }
  try {
    const lista = await peticionAdmin(`/convocatorias/${adminConvocatoriaId}/etapas`);
    adminEtapas = Array.isArray(lista) ? lista : [];
  } catch (err) {
    console.warn("cargarEtapasAdmin error:", err);
    adminEtapas = [];
  }
  return adminEtapas;
}

/**
 * Descargar los instrumentos oficiales de la convocatoria seleccionada.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Array<Object>> : adminDocumentos Instrumentos registrados.
 */
async function cargarDocumentosAdmin() {
  if (!adminConvocatoriaId) {
    adminDocumentos = [];
    return adminDocumentos;
  }
  try {
    const lista = await peticionAdmin(`/convocatorias/${adminConvocatoriaId}/documentos`);
    adminDocumentos = Array.isArray(lista) ? lista : [];
  } catch (err) {
    console.warn("cargarDocumentosAdmin error:", err);
    adminDocumentos = [];
  }
  return adminDocumentos;
}

/**
 * Descargar la rúbrica institucional con sus secciones, criterios y versiones.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Object|null> : adminRubrica Rúbrica vigente en PostgreSQL.
 */
async function cargarRubricaAdmin() {
  try {
    adminRubrica = await peticionAdmin("/rubrica");
  } catch (err) {
    console.warn("cargarRubricaAdmin error:", err);
    adminRubrica = null;
  }
  return adminRubrica;
}

/**
 * Descargar todos los catálogos maestros editables.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<Object|null> : adminCatalogosDatos Catálogos editables.
 */
async function cargarCatalogosAdmin() {
  try {
    adminCatalogosDatos = await peticionAdmin("/catalogos");
  } catch (err) {
    console.warn("cargarCatalogosAdmin error:", err);
    adminCatalogosDatos = null;
  }
  return adminCatalogosDatos;
}

/**
 * Refrescar los catálogos institucionales del frontend tras una edición administrativa.
 * parametros:
 *     (ninguno)
 * return:
 *     + Promise<void> : undefined Resuelve al recargar los catálogos.
 */
async function refrescarCatalogosFront() {
  invalidarCatalogos();
  await Promise.all([obtenerCatalogos(), obtener_convocatorias()]);
}

/**
 * Determinar el límite máximo de caracteres permitido (maxlength) para un campo según las plantillas oficiales de 'Docs Proyecto'.
 * Establece los límites normativos de la Convocatoria Fondos VIE 2027 (Formulario de Proyecto, Plan de Acción y Gestión de Riesgos,
 * Plantilla de Presupuesto, Acuerdos de Consejo e Instrumentos de Convocatoria aprobados mediante acuerdo CIE-237-2026).
 *
 * parametros:
 *     - string : label Etiqueta descriptiva del control visual.
 *     - string : key Clave interna o identificador del campo.
 *     - string : kind Tipo de control ('text', 'textarea', 'email', 'password', 'search', etc.).
 * return:
 *     + number|null : limite Cantidad máxima de caracteres permitidos o null si el control no es textual.
 */
function obtenerLimiteCaracteres(label = "", key = "", kind = "text") {
  if (kind === "select" || kind === "checkbox" || kind === "file" || kind === "date" || kind === "number") return null;
  // [Línea clave]: ¿Por qué soy importante? Asigna topes de longitud alineados con las restricciones documentales de Docs Proyecto y el esquema de base de datos. ¿Para qué? Proteger contra desbordamientos de datos y asegurar consistencia con los formularios oficiales VIE 2027. ¿Dónde me usan? En field() y adminField().
  const ref = `${label} ${key}`.toLowerCase();

  // 1. Identificadores técnicos y credenciales
  if (ref.includes("orcid")) return 19; // Norma ISO 7064 MOD 11-2 (0000-0000-0000-000X)
  if (ref.includes("siglas") || ref.includes("version") || ref.includes("versión")) return 20;
  if (ref.includes("oficio") || ref.includes("sesion") || ref.includes("sesión") || ref.includes("articulo") || ref.includes("artículo") || ref.includes("codigo") || ref.includes("código")) return 50;
  if (ref.includes("correo") || ref.includes("email") || kind === "email") return 255;
  if (ref.includes("password") || ref.includes("contraseña") || kind === "password") return 128;
  if (ref.includes("buscar") || ref.includes("query") || kind === "search") return 150;

  // 2. Metadatos de participantes y convocatorias (Docs Proyecto)
  if (ref.includes("nombre") || ref.includes("persona") || ref.includes("responsable") || ref.includes("investigador") || ref.includes("colaborador")) return 120;
  if (ref.includes("institucion") || ref.includes("institución") || ref.includes("empresa") || ref.includes("dependencia") || ref.includes("escuela")) return 150;
  if (ref.includes("convocatoria") || ref.includes("etapa") || ref.includes("instrumento") || ref.includes("documento")) return 150;

  // 3. Formulario Oficial de Propuesta Fondos VIE 2027 (Docs Proyecto / 4- Formulario...):
  // - Título o Nombre del proyecto (cabecera oficial)
  if (ref.includes("titulo") || ref.includes("título") || ref.includes("nombre del proyecto") || ref.includes("nombre de la propuesta")) return 300;
  // - Palabras clave: 4 a 6 términos descriptores (Docs Proyecto)
  if (ref.includes("palabras clave") || ref.includes("keywords") || ref.includes("descriptores")) return 250;
  // - Resumen y Abstract: [Máximo 500 palabras] (~3500 caracteres)
  if (ref.includes("resumen") || ref.includes("abstract")) return 3500;
  // - Problema de investigación y su importancia: [Máximo una página] (~4000 caracteres)
  if (ref.includes("problema")) return 4000;
  // - Estado del arte y antecedentes: [Máximo dos páginas] con al menos 10 fuentes WoS/Scopus (~8000 caracteres)
  if (ref.includes("estado del arte") || ref.includes("antecedentes")) return 8000;
  // - Objetivos general y específicos
  if (ref.includes("objetivo")) return 800;
  // - Metodología, procedimientos y variables de estudio
  if (ref.includes("metodolog") || ref.includes("diseño metodológico") || ref.includes("procedimiento")) return 6000;
  // - Plan de acción: actividades y resultados esperados (Plantilla Excel Plan de Acción)
  if (ref.includes("actividad") || ref.includes("resultado")) return 300;
  // - Gestión de riesgos y medidas de mitigación (Plantilla Excel Riesgos)
  if (ref.includes("riesgo")) return 300;
  if (ref.includes("mitigaci")) return 600;
  // - Estrategia de divulgación y socialización (Científica, institucional, socialización, medios)
  if (ref.includes("divulgaci") || ref.includes("socializaci") || ref.includes("canales") || ref.includes("medios")) return 1500;
  // - Aspectos éticos y declaración de exención de comités reguladores
  if (ref.includes("etica") || ref.includes("ética") || ref.includes("exencion") || ref.includes("exención")) return 2000;
  // - Hoja de ruta estratégica institucional
  if (ref.includes("hoja de ruta")) return 3000;
  // - Referencias bibliográficas especializadas
  if (ref.includes("referencia")) return 6000;
  // - Justificaciones y responsabilidades
  if (ref.includes("justificaci") || ref.includes("responsabilidad") || ref.includes("tareas")) return 1000;
  // - Criterios de rúbricas y catálogos de convocatoria (Pantallas 31 y 32)
  if (ref.includes("criterio") || ref.includes("rubrica") || ref.includes("rúbrica")) return 1000;
  // - Dictámenes de evaluación, acuerdos y resoluciones colegiadas
  if (ref.includes("fundamentaci") || ref.includes("observacion") || ref.includes("dictamen") || ref.includes("acuerdo") || ref.includes("resolucion") || ref.includes("resolución") || ref.includes("condicion") || ref.includes("condición")) return 2500;

  // Valor predeterminado para áreas de texto y entradas genéricas
  if (kind === "textarea") return 4000;
  return 250;
}

/**
 * Determinar si un campo de formulario debe mostrar el contador visual de caracteres (X/Y caracteres).
 * Se reserva estrictamente para las secciones de formulación de propuestas y administración de convocatorias
 * conforme a los ejemplos y restricciones normativas de los documentos oficiales (carpeta 'Docs Proyecto':
 * Formulario VIE 2027, Disposiciones y Acuerdos CIE-237-2026).
 * Se excluye de manera categórica el formulario de inicio de sesión (Pantalla 01), credenciales, contraseñas,
 * correos electrónicos institucionales, filtros de búsqueda y controles de selección.
 *
 * parametros:
 *     - string : label Etiqueta descriptiva del control visual.
 *     - string : key Clave única interna o identificador de campo (ej. 'login:email', 'modal:orcid', '08:Título').
 *     - string : kind Tipo de control ('text', 'textarea', 'email', 'password', 'search', etc.).
 * return:
 *     + boolean : visible Verdadero si el control debe exhibir el contador de caracteres en la interfaz.
 */
function debeMostrarContadorCaracteres(label = "", key = "", kind = "text") {
  // [Línea clave]: ¿Por qué soy importante? Impide la aparición de contadores visuales en el login o campos simples de acceso. ¿Para qué? Restringir los contadores en tiempo real a las secciones de propuestas y convocatorias donde la normativa oficial de Docs Proyecto impone topes estrictos. ¿Dónde me usan? En field(), adminField() y en el despachador de eventos de input.
  if (!key && !label) return false;
  const k = String(key || "").toLowerCase();
  const lbl = String(label || "").toLowerCase();
  const ref = `${lbl} ${k}`;

  // 1. Exclusión categórica del login y credenciales institucionales
  if (k.startsWith("login:") || current === "01") return false;
  if (
    kind === "password" ||
    kind === "email" ||
    kind === "search" ||
    kind === "select" ||
    kind === "checkbox" ||
    kind === "file" ||
    kind === "date" ||
    kind === "number" ||
    kind === "readonly"
  ) {
    return false;
  }
  if (
    ref.includes("password") ||
    ref.includes("contraseña") ||
    ref.includes("correo") ||
    ref.includes("email") ||
    ref.includes("buscar") ||
    ref.includes("query") ||
    ref.includes("filtro")
  ) {
    return false;
  }

  // 2. Secciones narrativas y de justificación en propuestas y convocatorias (Docs Proyecto):
  if (kind === "textarea") return true;

  // 3. Entradas textuales con topes normativos explícitos de la Convocatoria VIE 2027:
  // - ID ORCID institucional y externo (exactamente 19 caracteres bajo norma ISO 7064)
  if (ref.includes("orcid")) return true;
  // - Resumen y Abstract (máximo 500 palabras)
  if (ref.includes("resumen") || ref.includes("abstract")) return true;
  // - Palabras clave y Keywords (4 a 6 términos descriptores)
  if (ref.includes("palabras clave") || ref.includes("keywords") || ref.includes("descriptores")) return true;
  // - Título o nombre de la propuesta
  if (
    ref.includes("titulo") ||
    ref.includes("título") ||
    ref.includes("nombre del proyecto") ||
    ref.includes("nombre de la propuesta")
  ) {
    return true;
  }
  // - Objetivos general y específicos
  if (ref.includes("objetivo")) return true;
  // - Plan de acción y riesgos (actividades, resultados, riesgos, mitigación)
  if (ref.includes("actividad") || ref.includes("resultado") || ref.includes("riesgo") || ref.includes("mitigaci")) {
    return true;
  }
  // - Convocatorias, etapas, instrumentos oficiales y rúbricas (Pantallas 31 y 32)
  if (
    ref.includes("convocatoria") ||
    ref.includes("etapa") ||
    ref.includes("instrumento") ||
    ref.includes("criterio") ||
    ref.includes("seccion") ||
    ref.includes("sección")
  ) {
    return true;
  }
  // - Datos complementarios y responsabilidades
  if (
    ref.includes("responsabilidad") ||
    ref.includes("oficio") ||
    ref.includes("sesion") ||
    ref.includes("sesión") ||
    ref.includes("articulo") ||
    ref.includes("artículo")
  ) {
    return true;
  }

  return false;
}

/**
 * Formatear el texto descriptivo del contador de caracteres según la sección oficial de Docs Proyecto.
 * Añade indicaciones contextuales como '(máx. 500 palabras)' o '(máx. 1 página)' cuando aplica.
 *
 * parametros:
 *     - number : longitud Longitud actual del texto ingresado.
 *     - number : maxLen Límite máximo permitido.
 *     - string : label Etiqueta del campo.
 *     - string : key Clave del campo.
 * return:
 *     + string : textoContador Cadena para mostrar en la interfaz.
 */
function formatearTextoContador(longitud = 0, maxLen = 0, label = "", key = "") {
  // [Línea clave]: ¿Por qué soy importante? Genera una leyenda de conteo clara y explicativa acorde a Docs Proyecto. ¿Para qué? Orientar a la persona postulante con las restricciones normativas exactas. ¿Dónde me usan? En field(), adminField() y en el evento input.
  const ref = `${label} ${key}`.toLowerCase();
  let aclaracion = "";
  if (ref.includes("resumen") || ref.includes("abstract")) {
    aclaracion = " (máx. 500 palabras)";
  } else if (ref.includes("problema")) {
    aclaracion = " (máx. 1 página)";
  } else if (ref.includes("estado del arte") || ref.includes("antecedentes")) {
    aclaracion = " (máx. 2 páginas)";
  } else if (ref.includes("palabras clave") || ref.includes("keywords")) {
    aclaracion = " (4 a 6 descriptores)";
  } else if (ref.includes("orcid")) {
    aclaracion = " (ISO 7064)";
  }
  return `${longitud}/${maxLen} caracteres${aclaracion}`;
}

/**
 * Construir un campo de formulario administrativo sin persistencia en el navegador.
 * A diferencia de field(), estos controles no se guardan en state.saved porque
 * administran datos maestros del servidor y no borradores de propuestas.
 * parametros:
 *     - string : label Etiqueta visible del control.
 *     - any : value Valor inicial o lista de opciones para select.
 *     - string : kind Tipo de control ('text', 'textarea', 'date', 'number', 'checkbox', 'select').
 *     - string : name Nombre del campo dentro del formulario administrativo.
 *     - boolean : required Si el control es de llenado obligatorio.
 * return:
 *     + string : campoHtml Marcado del control administrativo.
 */
function adminField(label, value = "", kind = "text", name = "", required = false) {
  const id = `adm-${name}`;
  const maxLen = obtenerLimiteCaracteres(label, name, kind);
  const maxAttr = maxLen ? ` maxlength="${maxLen}"` : "";
  const numBounds =
    kind === "number"
      ? name.includes("peso")
        ? ' min="0" max="100"'
        : name.includes("monto")
          ? ' min="0" max="50000000"'
          : ' min="1" max="999"'
      : "";
  const attr = `id="${id}" data-admin-field="${esc(name)}"${required ? " required" : ""}${maxAttr}${numBounds}`;
  let control;
  if (kind === "textarea")
    control = `<textarea ${attr} rows="3">${esc(value)}</textarea>`;
  else if (kind === "checkbox")
    control = `<input type="checkbox" ${attr} ${value ? "checked" : ""}>`;
  else if (kind === "select")
    control = `<select ${attr}>${value
      .map(
        (opcion) =>
          `<option value="${esc(opcion.value)}" ${opcion.selected ? "selected" : ""}>${esc(opcion.label)}</option>`,
      )
      .join("")}</select>`;
  else control = `<input ${attr} type="${["number", "date"].includes(kind) ? kind : "text"}" value="${esc(value)}">`;
  const mostrarContador = debeMostrarContadorCaracteres(label, name, kind);
  const counterHtml =
    mostrarContador && maxLen
      ? `<small class="char-counter micro muted" style="display:block;text-align:right;margin-top:2px">${formatearTextoContador(String(value ?? "").length, maxLen, label, name)}</small>`
      : "";
  return `<div class="field"><label for="${id}">${esc(label)}${required ? ' <span class="required-star">*</span>' : ""}</label>${control}${counterHtml}<span class="error-msg" hidden>Completa este campo para continuar.</span></div>`;
}

/**
 * Leer los valores escritos en un formulario administrativo abierto en un modal.
 * parametros:
 *     (ninguno)
 * return:
 *     + Object : valores Objeto con los campos leídos del formulario.
 */
function adminValues() {
  const valores = {};
  document.querySelectorAll("[data-admin-field]").forEach((control) => {
    valores[control.dataset.adminField] =
      control.type === "checkbox" ? control.checked : String(control.value || "").trim();
  });
  return valores;
}

/**
 * Abrir el formulario de alta o edición de una convocatoria.
 * parametros:
 *     - Object|null : convocatoria Convocatoria a editar; null para crear una nueva.
 * return:
 *     + void : undefined Abre el modal con el formulario.
 */
function modalConvocatoria(convocatoria = null) {
  const c = convocatoria || {};
  modal(
    convocatoria ? "Editar convocatoria" : "Nueva convocatoria",
    `<div class="stack">${adminField("Nombre", c.nombre || "", "text", "nombre", true)}${adminField("Descripción", c.descripcion || "", "textarea", "descripcion")}<div class="field-row">${adminField("Inicio de postulación", c.fecha_inicio || "", "date", "fecha_inicio", true)}${adminField("Cierre de postulación", c.fecha_cierre || "", "date", "fecha_cierre", true)}</div>${adminField("Inicio de la ejecución", c.fecha_inicio_ejecucion || "", "date", "fecha_inicio_ejecucion", true)}${adminField("Convocatoria vigente", c.activo !== false, "checkbox", "activo")}</div>`,
    `${act("Cancelar", "close", "text")}${act(convocatoria ? "Guardar cambios" : "Crear convocatoria", "admin-call-save", "secondary", "check", convocatoria ? `data-id="${convocatoria.id_convocatoria}"` : "")}`,
    false,
    "admin-convocatoria",
  );
}

/**
 * Abrir el formulario de alta o edición de una etapa del cronograma.
 * parametros:
 *     - Object|null : etapa Etapa a editar; null para crear una nueva.
 * return:
 *     + void : undefined Abre el modal con el formulario.
 */
function modalEtapa(etapa = null) {
  const e = etapa || {};
  const respActual = e.responsable || "Investigador proponente";
  const responsablesOpts = [
    "Investigador proponente",
    "Centro de Vinculación",
    "Comité Técnico",
    "Consejo de Escuela",
    "Dirección de Investigación",
    "CIE",
    "Funcionario VIE",
  ].map((r) => ({ value: r, label: r, selected: r === respActual }));
  modal(
    etapa ? "Editar etapa" : "Agregar etapa",
    `<div class="stack">${adminField("Nombre de la etapa", e.nombre_etapa || "", "text", "nombre_etapa", true)}${adminField("Responsable", responsablesOpts, "select", "responsable", true)}<div class="field-row">${adminField("Fecha de inicio", e.fecha_inicio || "", "date", "fecha_inicio", true)}${adminField("Fecha de fin", e.fecha_fin || "", "date", "fecha_fin", true)}</div>${adminField("Orden en el cronograma", e.orden || adminEtapas.length + 1, "number", "orden", true)}</div>`,
    `${act("Cancelar", "close", "text")}${act(etapa ? "Guardar cambios" : "Agregar etapa", "admin-stage-save", "secondary", "check", etapa ? `data-id="${etapa.id_etapa}"` : "")}`,
    false,
    "admin-etapa",
  );
}

/**
 * Abrir el formulario de carga de un instrumento oficial.
 * parametros:
 *     (ninguno)
 * return:
 *     + void : undefined Abre el modal con el formulario.
 */
function modalDocumento() {
  modal(
    "Subir instrumento oficial",
    `<div class="stack">${adminField("Título del instrumento", "", "text", "nombre_documento", true)}${adminField("Tipo de instrumento", [{ value: "disposiciones", label: "Disposiciones" }, { value: "rubrica", label: "Rúbrica" }, { value: "formulario", label: "Formulario" }, { value: "plantilla", label: "Plantilla" }, { value: "otro", label: "Otro" }], "select", "tipo_instrumento")}<div class="field-row">${adminField("Orden", (adminDocumentos[adminDocumentos.length - 1]?.orden ?? 0) + 1, "number", "orden")}${adminField("Versión", "1.0", "text", "version")}</div><div class="field"><label for="adm-archivo">Archivo (PDF, DOCX, XLSX o PPTX)</label><input id="adm-archivo" type="file" accept=".pdf,.docx,.xlsx,.pptx"><span class="help">Máximo 20 MB. Se almacena en la nube.</span></div></div>`,
    `${act("Cancelar", "close", "text")}${act("Subir instrumento", "admin-doc-save", "secondary", "upload")}`,
    false,
    "admin-documento",
  );
}

/**
 * Abrir el formulario de edición de los metadatos de un instrumento oficial.
 * parametros:
 *     - Object : documento Instrumento a editar.
 * return:
 *     + void : undefined Abre el modal con el formulario.
 */
function modalDocumentoEdicion(documento) {
  const tipoActual = (documento.tipo_instrumento || "disposiciones").toLowerCase();
  const tiposOpts = [
    { value: "disposiciones", label: "Disposiciones" },
    { value: "rubrica", label: "Rúbrica" },
    { value: "formulario", label: "Formulario" },
    { value: "plantilla", label: "Plantilla" },
    { value: "otro", label: "Otro" },
  ].map((t) => ({ ...t, selected: t.value === tipoActual }));
  modal(
    "Editar instrumento",
    `<div class="stack">${adminField("Título del instrumento", documento.nombre_documento || "", "text", "nombre_documento", true)}${adminField("Tipo de instrumento", tiposOpts, "select", "tipo_instrumento")}<div class="field-row">${adminField("Orden", documento.orden || 1, "number", "orden")}${adminField("Versión", documento.version || "1.0", "text", "version")}</div>${adminField("Publicado", documento.activo !== false, "checkbox", "activo")}</div>`,
    `${act("Cancelar", "close", "text")}${act("Guardar cambios", "admin-doc-save-edit", "secondary", "check", `data-id="${documento.id_documento_conv}"`)}`,
    false,
    "admin-documento-edicion",
  );
}

/**
 * Describir los campos editables de cada catálogo maestro del backend.
 * parametros:
 *     (ninguno)
 * return:
 *     + Object : definiciones Campos por catálogo con su tipo y etiqueta.
 */
const CAMPOS_CATALOGO_ADMIN = {
  escuelas: {
    idField: "id_escuela",
    campos: [{ name: "nombre", label: "Nombre de la escuela", kind: "text", required: true }, { name: "siglas", label: "Siglas", kind: "text" }],
  },
  lineas: {
    idField: "id_linea_investigacion",
    campos: [{ name: "nombre_linea", label: "Nombre de la línea", kind: "text", required: true }],
  },
  modalidades: {
    idField: "id_modalidad",
    campos: [
      { name: "nombre_modalidad", label: "Nombre de la modalidad", kind: "text", required: true },
      { name: "descripcion", label: "Descripción", kind: "textarea" },
      { name: "duracion_maxima", label: "Duración máxima", kind: "text" },
      { name: "monto_financiamiento", label: "Tope de financiamiento (₡)", kind: "number" },
      { name: "activo", label: "Modalidad activa", kind: "checkbox" },
    ],
  },
  tipos_hora: {
    idField: "id_tipo_hora",
    campos: [{ name: "nombre_tipo_hora", label: "Nombre del tipo de hora", kind: "text", required: true }],
  },
  rubros: {
    idField: "id_rubro",
    campos: [
      { name: "nombre_rubro", label: "Nombre del rubro", kind: "text", required: true },
      { name: "codigo", label: "Código", kind: "text" },
      { name: "es_bien_duradero", label: "Bien duradero", kind: "checkbox" },
      { name: "es_beca", label: "Es beca", kind: "checkbox" },
    ],
  },
  roles: {
    idField: "id_rol",
    campos: [
      { name: "nombre_rol", label: "Nombre del rol", kind: "text", required: true },
      { name: "orden", label: "Orden en la ruta operativa", kind: "number" },
    ],
  },
  criterios_vie: {
    idField: "id_criterio",
    campos: [{ name: "descripcion_criterio", label: "Descripción del criterio", kind: "text", required: true }],
  },
};

/**
 * Abrir el formulario de alta o edición de un registro de catálogo maestro.
 * parametros:
 *     - string : clave Catálogo a administrar.
 *     - Object|null : registro Registro a editar; null para crear uno nuevo.
 * return:
 *     + void : undefined Abre el modal con el formulario.
 */
function modalCatalogo(clave, registro = null) {
  const definicion = CAMPOS_CATALOGO_ADMIN[clave];
  if (!definicion) {
    toast("Ese catálogo no admite edición.");
    return;
  }
  const r = registro || {};
  const cuerpo = definicion.campos
    .map((campo) =>
      adminField(
        campo.label,
        r[campo.name] ?? (campo.kind === "checkbox" ? false : ""),
        campo.kind,
        campo.name,
        campo.required,
      ),
    )
    .join("");
  modal(
    registro ? "Editar registro" : "Agregar registro",
    `<div class="stack">${cuerpo}</div>`,
    `${act("Cancelar", "close", "text")}${act(registro ? "Guardar cambios" : "Agregar", "admin-catalogo-save", "secondary", "check", `data-clave="${clave}" data-id="${registro ? registro[definicion.idField] : ""}"`)}`,
    false,
    "admin-catalogo",
  );
}

/**
 * Abrir el formulario de alta o edición de una sección de la rúbrica.
 * parametros:
 *     - Object|null : seccion Sección a editar; null para crear una nueva.
 * return:
 *     + void : undefined Abre el modal con el formulario.
 */
function modalSeccionRubrica(seccion = null) {
  const s = seccion || {};
  modal(
    seccion ? "Editar sección" : "Nueva sección de rúbrica",
    `<div class="stack">${adminField("Nombre de la sección", s.nombre_seccion || "", "text", "nombre_seccion", true)}${adminField("Peso porcentual", s.peso_porcentual ?? 0, "number", "peso_porcentual", true)}${adminField("Orden", s.orden ?? (adminRubrica?.secciones?.length ?? 0) + 1, "number", "orden", true)}</div>`,
    `${act("Cancelar", "close", "text")}${act(seccion ? "Guardar cambios" : "Crear sección", "admin-rubrica-section-save", "secondary", "check", seccion ? `data-id="${seccion.id_seccion}"` : "")}`,
    false,
    "admin-rubrica-seccion",
  );
}

/**
 * Abrir el formulario de alta o edición de un criterio de rúbrica.
 * parametros:
 *     - Object|null : criterio Criterio a editar.
 *     - number|null : idSeccion Sección destino cuando se crea un criterio nuevo.
 * return:
 *     + void : undefined Abre el modal con el formulario.
 */
function modalCriterioRubrica(criterio = null, idSeccion = null) {
  const c = criterio || {};
  const secciones = (adminRubrica?.secciones ?? []).map((s) => ({
    value: String(s.id_seccion),
    label: s.nombre_seccion,
  }));
  const seccionActual = criterio ? criterio.id_seccion : (idSeccion ?? secciones[0]?.value);
  const opcionesSeccion = secciones.map((opcion) => ({
    ...opcion,
    selected: opcion.value === String(seccionActual),
  }));
  modal(
    criterio ? "Editar criterio" : "Agregar criterio",
    `<div class="stack">${adminField("Sección", opcionesSeccion, "select", "id_seccion", true)}${adminField("Nombre del criterio", c.nombre_criterio || "", "text", "nombre_criterio", true)}${adminField("Peso relativo", c.peso_relativo ?? 0, "number", "peso_relativo", true)}${adminField("Criterio obligatorio", c.es_obligatorio === true, "checkbox", "es_obligatorio")}${adminField("Orden", c.orden ?? 1, "number", "orden", true)}</div>`,
    `${act("Cancelar", "close", "text")}${act(criterio ? "Guardar cambios" : "Agregar criterio", "admin-rubrica-criterion-save", "secondary", "check", criterio ? `data-id="${criterio.id_criterio_rubrica}"` : "")}`,
    false,
    "admin-rubrica-criterio",
  );
}

/**
 * Abrir el formulario de alta o edición de una versión de la rúbrica.
 * parametros:
 *     - Object|null : version Versión a editar; null para publicar una nueva.
 * return:
 *     + void : undefined Abre el modal con el formulario.
 */
function modalVersionRubrica(version = null) {
  const v = version || {};
  const versiones = (adminRubrica?.versiones ?? []).map((x) => ({
    value: x.version,
    label: x.version,
  }));
  modal(
    version ? "Editar versión" : "Publicar versión de rúbrica",
    `<div class="stack">${version ? adminField("Versión", v.version || "", "text", "version", true) : adminField("Versión", "", "text", "version", true)}${adminField("Descripción", v.descripcion || "", "textarea", "descripcion")}${adminField("Fecha de publicación", v.fecha_publicacion || "", "date", "fecha_publicacion")}${version ? adminField("Versión activa", v.activo === true, "checkbox", "activo") : adminField("Clonar desde una versión existente", [{ value: "", label: "No clonar" }, ...versiones], "select", "clonar_desde")}</div>`,
    `${act("Cancelar", "close", "text")}${act(version ? "Guardar cambios" : "Publicar versión", "admin-rubrica-version-save", "secondary", "check", version ? `data-id="${version.id_version}"` : "")}`,
    false,
    "admin-rubrica-version",
  );
}

/**
 * Construir el payload del aval del Consejo de Escuela desde el formulario de la pantalla 25.
 * parametros:
 *     - string : decision Resultado favorable, observaciones o rechazo.
 *     - string : observaciones Detalle de la devolución o del rechazo.
 *     - number|null : idDocumento Acuerdo firmado ya subido al expediente.
 * return:
 *     + Object : payload Cuerpo JSON esperado por POST /propuestas/consejo/{id}.
 */
function payloadAvalConsejo(decision = "favorable", observaciones = "", idDocumento = null) {
  // [Línea clave]: Los valores se leen del formulario visible para respetar lo que el
  // consejo escribió (incluso campos que nunca cambiaron y siguen con su valor por defecto).
  const valor = (clave) => {
    const control = document.querySelector(`[data-field="${clave}"]`);
    if (control)
      return control.type === "checkbox" ? control.checked : String(control.value || "").trim();
    return state.saved[clave] ?? "";
  };
  return {
    id_usuario_aval: session?.user?.id_usuario,
    decision,
    tipo_instancia: avalConsejo?.escuela_usuario?.es_coordinadora
      ? "coordinadora"
      : "participante",
    numero_sesion: valor("consejo:sesion"),
    articulo: valor("consejo:articulo"),
    fecha_acuerdo: valor("consejo:fecha") || null,
    numero_oficio: valor("consejo:oficio"),
    ratifica_calificacion: valor("consejo:ratifica") !== false,
    avala_presupuesto: valor("consejo:presupuesto") !== false,
    avala_horas_personal: valor("consejo:horas") !== false,
    observaciones: observaciones || state.saved["consejo:observaciones"] || "",
    id_documento: idDocumento,
  };
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
  // [Línea clave]: Perfiles facultados para administrar convocatorias, rúbricas y catálogos.
  vie: {
    label: "Funcionario VIE",
    name: "Mauricio Navarro",
    initials: "MN",
    screen: "31",
  },
  administracion: {
    label: "Administración del Sistema",
    name: "Administración del Sistema",
    initials: "AS",
    screen: "31",
  },
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
    "vie",
    "administracion",
  ],
  saved: {},
  teamAdded: false,
  reviewed: false,
  budget: [],
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
 * Retorna '02' para investigador y Dirección (panel con contadores reales), '31'
 * para los roles administrativos (convocatorias y catálogos) y '21'
 * (Bandeja de trabajo) para el resto de roles evaluadores.
 * parametros:
 *     (ninguno)
 * return:
 *     + string : pantallaInicio Identificador de la pantalla de inicio correspondiente.
 */
const homeFor = () =>
  state.role === "investigador" || state.role === "direccion"
    ? "02"
    : state.role === "vie" || state.role === "administracion"
      ? "31"
      : "21";

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
  // [Línea clave]: Las bandejas institucionales no deben reutilizar el expediente seleccionado
  // por otro rol; se limpia el puntero al cambiar a un rol evaluador.
  if (["vinculacion", "comite", "consejo", "direccion", "cie"].includes(key) && rolAnterior !== key)
    state.viewProposalId = null;
  state.viewProposal = state.created?.code || "SI-2027-014";
  state.stage = {
    investigador: state.stage,
    vinculacion: "En revisión de Vinculación",
    comite: "En evaluación técnica",
    consejo: "En evaluación técnica",
    direccion: "Sometida",
    cie: "Dictaminada",
    vie: "Convocatoria vigente",
    administracion: "Convocatoria vigente",
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
 * Comprueba totales anuales <= ₡5M, bienes duraderos solo en año 1, y beca mínima ₡960k.
 * Se resuelve por id_rubro del catálogo, no por posición en el array.
 * parametros:
 *     (ninguno)
 * return:
 *     + boolean : esValido Verdadero si cumple todas las reglas financieras.
 */
const budgetValid = () => {
  // [Línea clave]: El presupuesto siempre tiene todos los rubros del catálogo (iniciados en 0).
  // Validamos solo reglas de negocio: topes, equipo solo año 1, beca mínima.

  const rubros = catalogos?.rubros_presupuesto ?? [];
  const idEquipo = 6;  // "Equipo y bienes duraderos"
  const idBeca = 5;    // "Beca estudiante asistente especial"

  // 1. Totales anuales <= ₡5.000.000
  if (totalA() > 5000000 || totalB() > 5000000) return false;

  // 2. Bienes duraderos (equipo) solo en año 1
  const itemEquipo = state.budget.find((p) => p.id_rubro === idEquipo);
  if (itemEquipo && Number(itemEquipo.b) > 0) return false;

  // 3. Beca estudiante asistente especial: mínimo ₡960.000 por año
  const itemBeca = state.budget.find((p) => p.id_rubro === idBeca);
  if (itemBeca && (Number(itemBeca.a) < 960000 || Number(itemBeca.b) < 960000)) return false;

  return true;
};
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
  placeholder = "",
  defaultValue = undefined,
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
    val =
      state.saved[k] ??
      (defaultValue !== undefined
        ? defaultValue
        : kind === "select"
          ? opts[0]?.value ?? ""
          : value),
    id = "f-" + k.replace(/[^\w]/g, "-"),
    req = required ? "required" : "",
    placeholderAttr = placeholder ? ` placeholder="${esc(placeholder)}"` : "",
    maxLen = obtenerLimiteCaracteres(label, k, kind),
    maxAttr = maxLen ? ` maxlength="${maxLen}"` : "",
    numBounds =
      kind === "number"
        ? /hours|horas|dedicaci/i.test(`${label} ${k}`)
          ? ' min="1" max="40"'
          : /budget|monto/i.test(`${label} ${k}`)
            ? ' min="0" max="50000000"'
            : ' min="0" max="9999"'
        : "",
    attr = `id="${id}" data-field="${esc(k)}" ${req}${placeholderAttr}${maxAttr}${numBounds}`;
  let control;
  if (kind === "textarea")
    control = `<textarea ${attr} rows="3">${esc(val)}</textarea>`;
  else if (kind === "select") {
    control = `<select ${attr}>${opts.map((o) => `<option value="${esc(o.value)}" ${o.value === String(val) || o.label === String(val) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  } else if (kind === "checkbox")
    return `<label class="checkline"><input type="checkbox" ${attr} ${val === true ? "checked" : ""}>${esc(label)}</label>`;
  else if (kind === "file")
    control = `<div class="doc-row"><span class="doc-icon">PDF</span><div class="grow"><strong>${esc(val)}</strong></div>${act("Adjuntar", "upload", "secondary compact", "upload")}</div>`;
  else
    control = `<input ${attr} type="${["email", "number", "password", "date", "search"].includes(kind) ? kind : "text"}" value="${esc(val)}" ${kind === "readonly" ? "readonly" : ""}>`;
  const mostrarContador = debeMostrarContadorCaracteres(label, k, kind);
  const counterHtml =
    mostrarContador && maxLen && kind !== "readonly"
      ? `<small class="char-counter micro muted" style="display:block;text-align:right;margin-top:2px">${formatearTextoContador(String(val ?? "").length, maxLen, label, k)}</small>`
      : "";
  return `<div class="field"><label for="${id}">${esc(label)}${required ? ' <span class="required-star">*</span>' : ""}</label>${control}${counterHtml}${help ? `<span class="help">${esc(help)}</span>` : ""}<span class="error-msg" hidden>Completa este campo para continuar.</span></div>`;
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
    // [Línea clave]: Dirección, Funcionarios VIE y Administración administran las pantallas 31 y 32.
    admin = ["direccion", "vie", "administracion"].includes(state.role),
    // [Línea clave]: Los roles administrativos también consultan el historial institucional.
    historical = admin || state.role === "cie",
    // [Línea clave]: Para los roles administrativos el «Inicio» es la administración de convocatorias.
    inicio = state.role === "vie" || state.role === "administracion" ? "31" : "02";
  const module = (screen(current) || {}).module || "Expediente";
  return `<div class="app"><aside class="sidebar"><div class="brand"><div class="brand-mark">S</div><div><div class="brand-name">SGPI</div><span class="tec-wordmark">Tecnológico de Costa Rica</span></div></div><nav aria-label="Navegación principal"><div class="nav-group">${navItem("Inicio", inicio, "home", current === inicio)}${research ? navItem("Mis propuestas", "06", "folder", +current >= 6 && +current <= 20) : navItem("Bandeja de trabajo", "21", "inbox", +current >= 21 && +current <= 27)}${research ? navItem("Convocatorias", "04", "calendar", current === "04" || current === "05") : ""}${historical ? navItem("Consulta histórica", "29", "search", current === "29" || current === "30") : ""}</div>${admin ? `<div class="nav-title" style="margin-top:28px">SUPERADMINISTRACIÓN</div><div class="nav-group">${navItem("Convocatorias", "31", "calendar", current === "31")}${navItem("Rúbricas y catálogos", "32", "settings", current === "32")}</div>` : ""}</nav><div class="nav-group" style="margin-top:auto">${navItem("Mi perfil", "33", "user", current === "33")}<button class="nav-item has-tooltip" data-action="contact" data-tooltip="Persona de contacto y canales de apoyo." title="Persona de contacto y canales de apoyo.">${icon("info")}Contacto y soporte</button><button class="nav-item has-tooltip" data-action="logout" data-tooltip="${esc(optionHelp["Cerrar sesión"])}" title="${esc(optionHelp["Cerrar sesión"])}">${icon("logout")}Cerrar sesión</button></div></aside><div class="main"><header class="topbar"><div class="topbar-context"><strong>VIE</strong></div><div class="topbar-actions"><button class="icon-btn" data-go="03" aria-label="Notificaciones">${icon("bell")}${!state.read ? '<span class="notif-dot"></span>' : ""}</button><button class="profile-btn" data-action="user-menu" aria-expanded="${userMenuOpen}" aria-haspopup="menu"><span class="avatar">${esc(r.initials)}</span><span class="profile-text"><strong>${esc(r.name)}</strong><br><span class="micro muted">${r.label}</span></span>${icon("down")}</button>${userMenuOpen ? `<div class="user-menu" role="menu"><div class="user-menu-head"><strong>${esc(r.name)}</strong><div class="micro muted">${r.label}</div></div><button role="menuitem" data-go="33">${icon("user")}Mi perfil</button><button role="menuitem" data-action="settings">${icon("settings")}Ajustes y accesibilidad</button><button role="menuitem" data-action="contact">${icon("info")}Contactar soporte</button><button role="menuitem" class="danger" data-action="logout">${icon("logout")}Cerrar sesión</button></div>` : ""}</div></header><main class="content"><div class="page-heading"><div><h1>${esc(title)}</h1>${description ? `<p class="subtitle">${esc(description)}</p>` : ""}</div>${headingActions ? `<div class="action-row">${headingActions}</div>` : ""}</div>${body}</main></div><button class="support-fab" data-action="contact" aria-label="Contactar soporte">${icon("info")}<span>Soporte</span></button></div>`;
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
function tieneValorBorrador(key, fallback = "") {
  return String(draftValue(key, fallback) ?? "").trim() !== "";
}

function problemasPasoPropuesta(id) {
  const faltantes = [];

  const exigir = (key, nombre, fallback = "") => {
    if (!tieneValorBorrador(key, fallback)) faltantes.push(nombre);
  };

  switch (id) {
    case "08":
      exigir("08:Título de la propuesta", "Título de la propuesta");
      exigir(
        "08:Instancia coordinadora",
        "Instancia coordinadora",
        escuelas?.[0]?.id,
      );
      exigir(
        "08:Línea de investigación",
        "Línea de investigación",
        lineas_investigacion?.[0]?.id,
      );
      exigir("08:Fecha de inicio", "Fecha de inicio");
      exigir("08:Fecha de finalización", "Fecha de finalización");
      exigir("08:Resumen", "Resumen");
      exigir("08:Palabras clave", "Palabras clave");
      exigir("08:Resumen en inglés", "Resumen en inglés");
      exigir("08:Palabras clave en inglés", "Palabras clave en inglés");
      break;

    case "09": {
      // No usar proposalTeamMembers() aquí porque crea automáticamente
      // un integrante y podría marcar el paso sin que el usuario lo complete.
      const equipo = state.teamMembers || [];

      if (!equipo.length) {
        faltantes.push("Equipo investigador");
        break;
      }

      if (
        equipo.some(
          (miembro) =>
            Number(miembro.horas) < 1 || Number(miembro.horas) > 40,
        )
      ) {
        faltantes.push("Horas válidas del equipo");
      }

      if (
        equipo.some(
          (miembro) =>
            !esOrcidValido(
              miembro.orcid ||
                obtenerOrcidDePerfil(miembro.correo, miembro.nombre),
            ),
        )
      ) {
        faltantes.push("ORCID válido de cada integrante");
      }

      break;
    }

    case "10":
      exigir("10:Problema e importancia", "Problema e importancia");
      exigir("10:Justificación", "Justificación");
      exigir(
        "10:Estado del arte y vacío identificado",
        "Estado del arte y vacío identificado",
      );
      break;

    case "11":
      exigir("11:Objetivo general", "Objetivo general");
      exigir("11:OE1", "Objetivo específico OE1");
      exigir("11:OE2", "Objetivo específico OE2");
      exigir("11:OE3", "Objetivo específico OE3");
      break;

    case "12":
      exigir(
        "12:Enfoque y diseño metodológico",
        "Enfoque y diseño metodológico",
      );
      exigir(
        "12:Procedimientos y técnicas",
        "Procedimientos y técnicas",
      );
      exigir("12:Usuarios y validación", "Usuarios y validación");
      exigir("12:Análisis de resultados", "Análisis de resultados");
      break;

    case "13":
      if (!(state.extraActivities || []).length) {
        faltantes.push("Al menos una actividad");
      } else if (
        state.extraActivities.some((actividad) =>
          actividad
            .slice(0, 5)
            .some((valor) => !String(valor ?? "").trim()),
        )
      ) {
        faltantes.push("Datos completos de las actividades");
      }
      break;

    case "14":
      if (!(state.extraRisks || []).length) {
        faltantes.push("Al menos un riesgo");
      } else if (
        state.extraRisks.some((riesgo) =>
          riesgo
            .slice(0, 4)
            .some((valor) => !String(valor ?? "").trim()),
        )
      ) {
        faltantes.push("Datos completos de los riesgos");
      }
      break;

    case "15": {
      const partidasUsadas = (state.budget || []).filter(
        (partida) =>
          Number(partida.a) > 0 || Number(partida.b) > 0,
      );

      if (!partidasUsadas.length) {
        faltantes.push("Presupuesto");
      }

      if (partidasUsadas.some((partida) => !partida.id_rubro)) {
        faltantes.push("Rubros presupuestarios");
      }

      if (
        partidasUsadas.some(
          (partida) => !String(partida.detail || "").trim(),
        )
      ) {
        faltantes.push("Justificación de cada gasto");
      }

      if (!budgetValid()) {
        faltantes.push("Reglas del presupuesto");
      }

      break;
    }

    case "16":
      exigir(
        "16:TRL actual",
        "TRL actual",
        PROPOSAL_DEFAULTS["16:TRL actual"],
      );
      exigir(
        "16:TRL esperado",
        "TRL esperado",
        PROPOSAL_DEFAULTS["16:TRL esperado"],
      );
      exigir(
        "16:Potencial de propiedad intelectual",
        "Potencial de propiedad intelectual",
        PROPOSAL_DEFAULTS[
          "16:Potencial de propiedad intelectual"
        ],
      );
      exigir("16:Activo previsto", "Activo previsto");

      for (let i = 0; i < 4; i += 1) {
        exigir(
          `ethics:${i}:applies`,
          `Declaración ética ${i + 1}`,
          PROPOSAL_DEFAULTS[`ethics:${i}:applies`],
        );
        exigir(
          `ethics:${i}:reason`,
          `Justificación ética ${i + 1}`,
        );
      }
      break;

    case "17":
      // Los documentos no impiden enviar, pero el paso solo muestra
      // check cuando se haya adjuntado al menos uno.
      if (!archivosBorrador.length) {
        faltantes.push("Documento adjunto");
      }
      break;

    case "18":
      if (!state.reviewed) {
        faltantes.push("Confirmación de revisión");
      }
      break;
  }

  return faltantes;
}

function pasoPropuestaCompleto(id) {
  if (id === "18") {
    return (
      state.reviewed &&
      steps.slice(0, -1).every(([stepId]) => {
        return (
          stepId === "17" ||
          problemasPasoPropuesta(stepId).length === 0
        );
      })
    );
  }

  return problemasPasoPropuesta(id).length === 0;
}
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
  const idx = steps.findIndex((step) => step[0] === id);

  const stepperHtml = steps
    .map(([stepId, label], index) => {
      const completo = pasoPropuestaCompleto(stepId);
      const activo = index === idx;
      const clase = activo ? "active" : completo ? "done" : "";
      const indicador = completo && !activo ? "✓" : index + 1;

      return `
        <button
          class="step ${clase}"
          data-go="${stepId}"
        >
          <span>${indicador}</span>
          ${label}
        </button>
      `;
    })
    .join("");

  return `
    <div class="form-layout">
      <aside>
        <div class="small" style="margin:0 10px 10px">
          <strong>Tu propuesta</strong>
          <p class="micro muted" style="margin-top:4px">
            Paso ${idx + 1} de 11
          </p>
        </div>

        <div class="progress" style="margin:0 10px 18px">
          <span style="width:${((idx + 1) / 11) * 100}%"></span>
        </div>

        <nav class="stepper" aria-label="Secciones del formulario">
          ${stepperHtml}
        </nav>

        <p class="micro muted" style="margin:20px 10px">
          Puedes guardar y continuar después.<br>
          Los campos con * son obligatorios.
        </p>
      </aside>

      <div>
        <form id="proposal-form" class="card form-card" novalidate>
          <div class="form-title">
            <h2>${esc(screen(id).title)}</h2>
            ${badge("Borrador")}
          </div>

          ${inner}

          <div class="form-footer">
            <div>
              ${
                idx > 0
                  ? btn(
                      "Anterior",
                      steps[idx - 1][0],
                      "text",
                      "back",
                    )
                  : btn("Mis propuestas", "06", "text", "back")
              }
            </div>

            <div class="action-row">
              ${act("Guardar borrador", "save", "secondary")}
              ${
                idx < 10
                  ? act(
                      "Guardar y continuar",
                      "next",
                      "",
                      "arrow",
                      `data-next="${steps[idx + 1][0]}"`,
                    )
                  : act(
                      "Enviar a evaluación",
                      "send",
                      "",
                      "arrow",
                    )
              }
            </div>
          </div>
        </form>

        <div class="saved" style="margin-top:12px">
          ${icon("check")}
          Cambios guardados
        </div>
      </div>
    </div>
  `;
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
  if (state.role !== "investigador") {
    // [Línea clave]: Vinculación y Comité Técnico muestran la propuesta real más reciente
    // que espera su dictamen; el resto de roles conserva el escenario demo.
    const esVinculacion = state.role === "vinculacion";
    const esComite = state.role === "comite";
    const esConsejo = state.role === "consejo";
    const esDireccion = state.role === "direccion";
    const esCie = state.role === "cie";
    if (esCie) {
      // [Línea clave]: El CIE tiene su propio tablero: pendientes de resolución, resueltas
      // por el comité y total revisadas, todo leído del backend.
      try {
        const dash = dashboardCie || {};
        const pendienteCount = Number(dash.pendientes || 0);
        const resueltasCount = Number(dash.resueltas || 0);
        const revisadasCount = Number(dash.totales_revisadas || 0);
        const destacada = dash.propuesta_destacada || null;
        const metricasCie = [
          ["Pendientes de resolución", String(pendienteCount)],
          ["Resueltas por el CIE", String(resueltasCount)],
          ["Totales revisadas", String(revisadasCount)],
        ];
        const fechaLegible = (valor) => {
          if (!valor) return "";
          try {
            return new Date(valor).toLocaleString("es-CR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          } catch {
            return String(valor);
          }
        };
        const filaCie = destacada
          ? [
              `<span class="project-code">${esc(destacada.codigo || "")}</span><strong>${esc(destacada.titulo || "")}</strong><br><span class="small muted">${esc(destacada.escuela_siglas || destacada.escuela || "")} · ${esc(destacada.modalidad || "")}</span>`,
              esc(destacada.nombre_estado || ""),
              destacada.fecha_ingreso_cie
                ? badge(`Ingresó al CIE ${fechaLegible(destacada.fecha_ingreso_cie).replace(", ", " · ")}`)
                : badge("Dictaminada por Dirección"),
              btn(
                "Resolver",
                "27",
                "text",
                "arrow",
                `data-proposal="${esc(destacada.codigo || "")}" data-proposal-id="${destacada.id_propuesta || ""}"`,
              ),
            ]
          : [`<span class="muted">No hay propuestas pendientes de resolución del CIE.</span>`, "", "", ""];
        const heroTituloCie =
          pendienteCount === 0
            ? "No hay propuestas pendientes de resolución"
            : pendienteCount === 1
              ? "Una propuesta espera la resolución del comité"
              : `${pendienteCount} propuestas esperan la resolución del comité`;
        const heroTextoCie = destacada
          ? `Más reciente dictaminada por Dirección: ${esc(destacada.codigo || "")} · ${esc(destacada.titulo || "")}${destacada.fecha_ingreso_cie ? ` · Ingresó el ${fechaLegible(destacada.fecha_ingreso_cie)}.` : "."}`
          : "Consulta la bandeja para revisar los expedientes remitidos al comité.";
        let nombreHolaCie = "CIE";
        try {
          const p = person();
          if (p && p.name) nombreHolaCie = String(p.name).split(" ")[0];
        } catch {}
        return shell(
          `<div class="hero"><div><h2>${heroTituloCie}</h2><p>${heroTextoCie}</p></div>${btn("Abrir bandeja", "21", "", "arrow")}</div><div class="grid three mt">${metricasCie
            .map(
              ([a, b]) =>
                `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
            )
            .join("")}</div><div class="mt card">${table(["Expediente", "Etapa", "Ingreso al CIE", ""], [filaCie])}</div>`,
          `Hola, ${nombreHolaCie}`,
          "",
          "",
        );
      } catch (e) {
        console.warn("dashboard cie render error:", e);
        try {
          cargarDashboardCie().catch(() => null);
        } catch (_) {}
        return shell(
          `<div class="hero"><div><h2>Comité de Ética en Investigación</h2><p>Consulta la bandeja para revisar los expedientes remitidos al comité.</p></div>${btn("Abrir bandeja", "21", "", "arrow")}</div><div class="grid three mt"><div class="card metric"><span class="label">Pendientes de resolución</span><span class="value">0</span></div><div class="card metric"><span class="label">Resueltas por el CIE</span><span class="value">0</span></div><div class="card metric"><span class="label">Totales revisadas</span><span class="value">0</span></div></div>`,
          "Hola, CIE",
          "",
          "",
        );
      }
    }
    if (esDireccion) {
      try {
        const dash = dashboardDireccion || {};
        const pendienteCount = Number(dash.pendientes || 0);
        const determinadaCount = Number(dash.determinadas || 0);
        const revisadasCount = Number(dash.totales_revisadas || 0);
        const destacada = dash.propuesta_destacada || null;
        const metricasDir = [
          ["Pendientes", String(pendienteCount)],
          ["Determinadas", String(determinadaCount)],
          ["Totales revisadas", String(revisadasCount)],
        ];
        const fechaLegible = (valor) => {
          if (!valor) return "";
          try {
            return new Date(valor).toLocaleString("es-CR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          } catch {
            return String(valor);
          }
        };
        const filaDir = destacada
          ? [
              `<span class="project-code">${esc(destacada.codigo || "")}</span><strong>${esc(destacada.titulo || "")}</strong><br><span class="small muted">${esc(destacada.escuela_siglas || destacada.escuela || "")} · ${esc(destacada.modalidad || "")}</span>`,
              esc(destacada.nombre_estado || ""),
              destacada.fecha_ingreso_vie
                ? badge(`Ingresó a VIE ${fechaLegible(destacada.fecha_ingreso_vie).replace(", ", " · ")}`)
                : badge("Sometida ante VIE"),
              btn(
                "Dictaminar",
                "26",
                "text",
                "arrow",
                `data-proposal="${esc(destacada.codigo || "")}" data-proposal-id="${destacada.id_propuesta || ""}"`,
              ),
            ]
          : [`<span class="muted">No hay propuestas pendientes de dictamen de Dirección.</span>`, "", "", ""];
        const heroTituloDir =
          pendienteCount === 0
            ? "No hay propuestas pendientes de dictamen"
            : pendienteCount === 1
              ? "Una propuesta espera tu dictamen"
              : `${pendienteCount} propuestas esperan tu dictamen`;
        const heroTextoDir = destacada
          ? `Más reciente ingresada a VIE: ${esc(destacada.codigo || "")} · ${esc(destacada.titulo || "")}${destacada.fecha_ingreso_vie ? ` · Ingresó el ${fechaLegible(destacada.fecha_ingreso_vie)}.` : "."}`
          : "Consulta la bandeja para revisar las propuestas sometidas ante VIE.";
        let nombreHola = "Dirección";
        try {
          const p = person();
          if (p && p.name) nombreHola = String(p.name).split(" ")[0];
        } catch {}
        return shell(
          `<div class="hero"><div><h2>${heroTituloDir}</h2><p>${heroTextoDir}</p></div>${btn("Abrir bandeja", "21", "", "arrow")}</div><div class="grid three mt">${metricasDir
            .map(
              ([a, b]) =>
                `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
            )
            .join("")}</div><div class="mt card">${table(["Expediente", "Etapa", "Ingreso a VIE", ""], [filaDir])}</div>`,
          `Hola, ${nombreHola}`,
          "",
          "",
        );
      } catch (e) {
        console.warn("dashboard direccion render error:", e);
        try {
          cargarBandejaDireccion().catch(() => null);
        } catch (_) {}
        return shell(
          `<div class="hero"><div><h2>Dirección de Investigación</h2><p>Consulta la bandeja para revisar las propuestas sometidas ante VIE.</p></div>${btn("Abrir bandeja", "21", "", "arrow")}</div><div class="grid three mt"><div class="card metric"><span class="label">Pendientes</span><span class="value">0</span></div><div class="card metric"><span class="label">Determinadas</span><span class="value">0</span></div><div class="card metric"><span class="label">Totales revisadas</span><span class="value">0</span></div></div>`,
          "Hola, Dirección",
          "",
          "",
        );
      }
    }
    const bandeja = esVinculacion
      ? bandejaPropuestas || []
      : esComite
        ? bandejaComite || []
        : esConsejo
          ? bandejaConsejo || []
          : [];
    const pendientes = bandeja.filter(
      esComite ? esPendienteComite : esConsejo ? esPendienteConsejo : esPendienteVinculacion,
    );
    const reciente = pendientes[0] || null;
    const dictaminadas = bandeja.length - pendientes.length;
    const metricas = esVinculacion || esComite || esConsejo
      ? [
          ["Pendientes", String(pendientes.length)],
          ["Dictaminadas", String(dictaminadas)],
          ["Total", String(bandeja.length)],
        ]
      : [
          ["Pendientes", "1"],
          ["En revisión", "0"],
          ["Resueltos", "3"],
        ];
    const fila = esComite
      ? reciente
        ? [
            `<span class="project-code">${esc(reciente.code)}</span><strong>${esc(reciente.title)}</strong>`,
            esc(reciente.status),
            badge("Sin dictamen"),
            btn(
              "Evaluar",
              roles[state.role].screen,
              "text",
              "arrow",
              `data-proposal="${esc(reciente.code)}" data-proposal-id="${reciente.id || ""}"`,
            ),
          ]
        : [`<span class="muted">No hay propuestas pendientes de dictamen.</span>`, "", "", ""]
      : esConsejo
        ? reciente
          ? [
              `<span class="project-code">${esc(reciente.code)}</span><strong>${esc(reciente.title)}</strong>`,
              esc(reciente.status),
              badge("Sin aval"),
              btn(
                "Avalar",
                roles[state.role].screen,
                "text",
                "arrow",
                `data-proposal="${esc(reciente.code)}" data-proposal-id="${reciente.id || ""}"`,
              ),
            ]
          : [`<span class="muted">No hay propuestas pendientes de aval.</span>`, "", "", ""]
      : esVinculacion
        ? reciente
          ? [
              `<span class="project-code">${esc(reciente.code)}</span><strong>${esc(reciente.title)}</strong>`,
              esc(reciente.status),
              badge("Dentro del plazo"),
              btn(
                "Revisar",
                roles[state.role].screen,
                "text",
                "arrow",
                `data-proposal="${esc(reciente.code)}" data-proposal-id="${reciente.id || ""}"`,
              ),
            ]
          : [`<span class="muted">No hay propuestas pendientes de tu dictamen.</span>`, "", "", ""]
        : [
            `<span class="project-code">SI-2027-014</span><strong>Agua Inteligente: monitoreo de cuencas</strong>`,
            roles[state.role].label,
            badge("Dentro del plazo"),
            btn("Revisar", roles[state.role].screen, "text", "arrow"),
          ];
    const heroTitulo = esVinculacion || esComite || esConsejo
      ? reciente
        ? pendientes.length === 1
          ? esComite
            ? "Una propuesta espera tu evaluación"
            : esConsejo
              ? "Una propuesta espera tu aval"
              : "Una propuesta espera tu revisión"
          : `${pendientes.length} propuestas esperan tu ${esComite ? "evaluación" : esConsejo ? "aval" : "revisión"}`
        : esComite
          ? "No tienes propuestas pendientes de evaluación"
          : esConsejo
            ? "No tienes propuestas pendientes de aval"
            : "No tienes propuestas pendientes"
      : "Una propuesta espera tu revisión";
    const fechaLegible = (valor) =>
      valor
        ? new Date(valor).toLocaleString("es-CR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
    const momentoIngreso = esComite
      ? fechaLegible(reciente?.fechaIngreso)
        ? ` Ingresó al Comité el ${fechaLegible(reciente.fechaIngreso)}.`
        : fechaLegible(reciente?.fechaCreacion)
          ? ` Creada el ${fechaLegible(reciente.fechaCreacion)}.`
          : ""
      : esConsejo
        ? fechaLegible(reciente?.fechaIngresoConsejo)
          ? ` Ingresó al Consejo el ${fechaLegible(reciente.fechaIngresoConsejo)}.`
          : fechaLegible(reciente?.fechaCreacion)
            ? ` Creada el ${fechaLegible(reciente.fechaCreacion)}.`
            : ""
        : "";
    const heroTexto =
      (esVinculacion || esComite || esConsejo) && reciente
        ? `Más reciente: ${esc(reciente.code)} · ${esc(reciente.title)}.${momentoIngreso}`
        : `Consulta el expediente completo antes de registrar la decisión de ${roles[state.role].label}.`;
    const cabeceras = esComite
      ? ["Expediente", "Etapa", "Dictamen", ""]
      : esConsejo
        ? ["Expediente", "Etapa", "Aval", ""]
        : ["Expediente", "Etapa", "Prioridad", ""];
    let nombreHolaFallback = roles[state.role]?.label || "";
    try {
      nombreHolaFallback = person().name.split(" ")[0];
    } catch {}
    return shell(
      `<div class="hero"><div><h2>${heroTitulo}</h2><p>${heroTexto}</p></div>${btn("Abrir bandeja", "21", "", "arrow")}</div><div class="grid three mt">${metricas
        .map(
          ([a, b]) =>
            `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
        )
        .join("")}</div><div class="mt card">${table(cabeceras, [fila])}</div>`,
      `Hola, ${nombreHolaFallback}`,
      "",
      "",
    );
  }
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
      `<span>${filtered.length} propuesta${filtered.length === 1 ? "" : "s"} sincronizada${filtered.length === 1 ? "" : "s"} con el sistema</span><span>Página 1 de 1</span>`,
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
  "16:TRL actual": "4",
  "16:TRL esperado": "6",
  "16:Potencial de propiedad intelectual": "Sí",
  "ethics:0:applies": "No",
  "ethics:1:applies": "No",
  "ethics:2:applies": "No",
  "ethics:3:applies": "No",
};
function currentProposalId() {
  return Number(state.created?.id) || 1;
}

function draftValue(key, fallback = "") {
  // [Línea clave]: El valor por defecto ya NO viene de PROPOSAL_DEFAULTS (textos quemados).
  // Solo retorna lo que el usuario haya escrito (state.saved) o el fallback explícito.
  // Los placeholders y textos de ayuda se pasan como parámetros a field().
  const value = state.saved?.[key];
  if (value !== undefined && value !== null) return value;
  return fallback;
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

/**
 * Obtener la lista de miembros del equipo investigador de la propuesta actual con su ORCID validado de perfil.
 * Si el estado aún no tiene miembros registrados, inicializa el arreglo con la persona investigadora autenticada como coordinadora.
 * parametros:
 *     (ninguno)
 * return:
 *     + Array<Object> : equipo Lista de integrantes con id_usuario, nombre, correo, orcid, tipo, horas y rol.
 */
function proposalTeamMembers() {
  // [Línea clave]: ¿Por qué soy importante? Resuelve los integrantes del equipo y sincroniza su ORCID de perfil. ¿Para qué? Mantener consistente la tabla de la Pantalla 09 y el payload de creación. ¿Dónde me usan? En teamForm(), buildProposalPayload() y selectores de responsables.
  if (state.teamMembers && state.teamMembers.length > 0) {
    return state.teamMembers.map((m) => ({
      ...m,
      orcid: m.orcid || obtenerOrcidDePerfil(m.correo, m.nombre),
    }));
  }
  const correo = String(session?.user?.correo ?? "").trim().toLowerCase();
  if (!correo) return [];
  const miembroInicial = {
    id_usuario: session.user.id_usuario,
    nombre: session.user.nombre,
    correo,
    orcid: orcidUsuarioActivo(),
    tipo: "VIE",
    horas: 8,
    rol: "Coordinador/a",
    escuela: escuelas?.[0]?.nombre || "Instancia coordinadora",
  };
  state.teamMembers = [miembroInicial];
  return state.teamMembers;
}

function totalHorasEquipo() {
  return (state.teamMembers || []).reduce((total, persona) => total + Number(persona.horas || 0), 0);
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
  const equipo = state.teamMembers || [];
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

  const todasLasActividades = state.extraActivities || [];
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

  const todosLosRiesgos = state.extraRisks || [];
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
    // [Línea clave]: Usar id_rubro directamente del catálogo, ya no hace falta matching heurístico.
    if (!partida.id_rubro) return [];
    return [
      { id_rubro: partida.id_rubro, monto: Number(partida.a) || 0, anio: 1, justificacion: partida.detail || "" },
      { id_rubro: partida.id_rubro, monto: Number(partida.b) || 0, anio: 2, justificacion: partida.detail || "" },
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

  const equipo = proposalTeamMembers().map((m) => ({
      correo: m.correo,
      orcid: m.orcid || obtenerOrcidDePerfil(m.correo, m.nombre),
      id_tipo_hora: tipoHoraId(m.tipo, m.tipo === "VIE" ? 1 : 4),
      horas_asignadas: m.horas,
    }));

  const colaboradores = (state.externalCollaborators || []).map((c) => ({
    nombre_completo: c.nombre,
    institucion: c.institucion,
    rol: c.rol,
    orcid: c.orcid || obtenerOrcidDePerfil("", c.nombre),
    horas_asignadas: Number(c.horas) || null,
    responsabilidad: c.responsabilidad,
  }));

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
    // [Línea clave]: La etapa inicial viaja por su NOMBRE oficial. El identificador numérico
    // del catálogo «estados» no es parte del contrato y difiere entre ambientes.
    estado_inicial_nombre: "En revisión de Vinculación",
    client_uuid: clientUuid,
    trl_inicial: Number(draftValue("16:TRL actual", "4")),
    trl_esperado: Number(draftValue("16:TRL esperado", "6")),
    potencial_pi: draftValue("16:Potencial de propiedad intelectual", "Sí") === "Sí",
    activo_previsto: draftValue("16:Activo previsto", ""),
    equipo: equipo.map((m) => ({
      correo: m.correo,
      orcid: m.orcid,
      id_tipo_hora: m.id_tipo_hora,
      horas_asignadas: m.horas_asignadas,
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
  // Los documentos continúan siendo opcionales.
  // Las demás secciones usan la misma validación del stepper.
  return steps
    .map(([id]) => id)
    .filter((id) => id !== "17" && id !== "18")
    .flatMap((id) =>
      problemasPasoPropuesta(id).map((text) => ({
        screen: id,
        text,
      })),
    );
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
  // Re-poblar budget desde catálogo (iniciado en 0)
  const rubrosCat = catalogos?.rubros_presupuesto ?? [];
  state.budget = rubrosCat.length
    ? rubrosCat.map(r => ({
        id_rubro: r.id_rubro,
        name: r.nombre_rubro,
        code: String(r.id_rubro),
        a: 0,
        b: 0,
        detail: ""
      }))
    : structuredClone(defaultState.budget);
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
      "",
      "text",
      "Usa un título claro que identifique el propósito de la investigación.",
      true,
      "",
      "Ej.: Agua Inteligente: monitoreo de cuencas"
    )}
    
    <div class="field-row">
      ${field("Instancia coordinadora", escuelasOpts, "select", "", true, "", "Selecciona la escuela líder")}
      ${field("Modalidad", state.mode || "Desarrollo tecnológico", "readonly", "", false, "", "Modalidad seleccionada en pantalla 08")}
    </div>

    ${field(
      "Línea de investigación",
      lineasOpts,
      "select",
      "",
      true,
      "",
      "Selecciona la línea temática"
    )}

    <div class="field-row">
      ${field("Fecha de inicio", "", "date", "", true, "", "2027-01-01")}
      ${field("Fecha de finalización", "", "date", "Duración propuesta: 24 meses.", true, "", "2028-12-31")}
    </div>

    ${field(
      "Resumen",
      "",
      "textarea",
      "Máximo 500 palabras. Describe el objetivo, metodología y resultados esperados.",
      true,
      "",
      "Desarrollo y validación de un sistema de monitoreo que integra mediciones de calidad del agua..."
    )}

    ${field(
      "Palabras clave",
      "",
      "text",
      "Incluye de 4 a 6 palabras clave separadas por punto y coma.",
      true,
      "",
      "Calidad del agua; monitoreo; cuencas; sensores"
    )}

    <details class="accordion">
      <summary>Información adicional del formulario</summary>
      
      ${field(
        "Resumen en inglés",
        "",
        "textarea",
        "Máximo 500 palabras. Traducción del resumen para difusión internacional.",
        true,
        "",
        "Development and validation of a water-quality monitoring system in two pilot watersheds."
      )}
      
      ${field(
        "Palabras clave en inglés",
        "",
        "text",
        "4 a 6 palabras clave en inglés.",
        true,
        "",
        "Water quality; monitoring; watersheds; sensors"
      )}
      
      ${field(
        "Prioridad nacional y ODS",
        [
          "ODS 6 · Agua limpia y saneamiento",
          "ODS 7 · Energía asequible y no contaminante",
          "ODS 9 · Industria, innovación e infraestructura",
          "ODS 11 · Ciudades y comunidades sostenibles",
          "ODS 12 · Producción y consumo responsables",
          "ODS 13 · Acción por el clima",
          "ODS 15 · Vida de ecosistemas terrestres",
          "Salud pública y biotecnología (PNDIP)",
          "Transformación digital e inteligencia artificial",
        ],
        "select",
        "Vincula la propuesta con prioridades país u Objetivos de Desarrollo Sostenible.",
        false,
        "",
        "ODS 6 · Agua limpia y saneamiento"
      )}
      
      ${field(
        "Continuidad y financiamiento previo",
        "",
        "textarea",
        "Indica si es continuación de otro proyecto y financiamiento previo.",
        false,
        "",
        "No corresponde a una continuación; no tiene financiamiento externo."
      )}
      
      ${field(
        "Instrumento jurídico / convenio",
        [
          "No aplica",
          "Carta de intención institucional",
          "Convenio marco vigente",
          "Convenio específico de cooperación",
          "Acuerdo de confidencialidad (NDA)",
          "Contrato de transferencia o cotitularidad",
        ],
        "select",
        "Convenio, carta de intención o instrumento que respalde la colaboración.",
        false,
        "",
        "No aplica"
      )}
      
      ${field(
        "Vinculación con posgrado",
        [
          "No aplica",
          "Tesis de maestría académica / profesional",
          "Tesis de doctorado",
          "Participación de estudiantes de posgrado",
          "Co-dirección de proyecto de graduación",
        ],
        "select",
        "Relación con programas de posgrado (tesis, estudiantes, co-dirección).",
        false,
        "",
        "No aplica"
      )}
      
      ${field(
        "Información sensible",
        "",
        "textarea",
        "Datos que requieren reserva o acuerdo de confidencialidad (PI, datos personales, etc.).",
        false,
        "",
        "Documentación técnica del software, sujeta a valoración de Vinculación."
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
  const colaboradores = state.externalCollaborators || [];
  const totalHoras = equipo.reduce((sum, m) => sum + Number(m.horas || 0), 0);

  return `${notice("Dedicación total: " + totalHoras + " horas semanales", "Cada investigador tiene un ORCID único vinculado a su perfil institucional.")}
<div class="mt">
  <div class="mt">${table(
    ["Persona / instancia", "ORCID", "Rol", "Horas", "Correo", ""],
    equipo.map((m, i) => {
      const esCreador = session && m.correo === session.user.correo;
      const orcidMiembro = m.orcid || obtenerOrcidDePerfil(m.correo, m.nombre) || "Pendiente de solicitar";
      return [
        `<strong>${esc(m.nombre)}</strong>${esCreador ? ' <span class="badge" style="background:var(--blue);color:white;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:8px;">Creador</span>' : ''}<br><span class="micro muted">${esc(m.escuela || m.siglas_escuela || "Institución")}</span>`,
        `<code class="micro">${esc(orcidMiembro)}</code>`,
        esc(m.rol),
        `${esc(m.horas || 0)} h ${esc(m.tipo || "VIE")}`,
        `<span class="micro muted">${esc(m.correo)}</span>`,
        esCreador ? `${act("Editar", "team-edit", "text compact", "edit", 'data-index="' + i + '"')} <span class="micro muted" style="color:var(--muted);">No se puede quitar (creador)</span>` : `${act("Editar", "team-edit", "text compact", "edit", 'data-index="' + i + '"')} ${act("Quitar", "team-remove", "text compact danger", "trash", 'data-index="' + i + '"')}`,
      ];
    }),
  )}</div>
  <div class="action-row mt mb">
    ${act("Agregar miembro al equipo", "team", "secondary", "plus")}
  </div>

  <details class="accordion" open>
    <summary>Colaboradores externos</summary>
    <p class="small muted" style="margin-bottom:12px">Personas externas sin cuenta institucional que colaboran en el proyecto (se solicita y valida el ORCID único de cada persona).</p>
    <div class="mt">${table(
      ["Colaborador / institución", "ORCID", "Rol", "Horas", ""],
      colaboradores.map((c, i) => [
        `<strong>${esc(c.nombre)}</strong><br><span class="micro muted">${esc(c.institucion)}</span>`,
        `<code class="micro">${esc(c.orcid || obtenerOrcidDePerfil("", c.nombre) || "Pendiente")}</code>`,
        esc(c.rol),
        `${esc(c.horas || 0)} h`,
        act("Quitar", "external-remove", "text compact danger", "trash", 'data-index="' + i + '"'),
      ]),
    )}</div>
    <div class="action-row mt mb">
      ${act("Agregar colaborador externo", "external-add", "secondary", "plus")}
    </div></details>`;
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
  return `${field("Problema e importancia", "", "textarea", "Máximo una página. Describe el problema, su alcance y relevancia.", true, "", "La información sobre calidad del agua en las microcuencas piloto se obtiene mediante mediciones aisladas...")}${field("Justificación", "", "textarea", "Explica la contribución, personas beneficiarias y pertinencia institucional.", true, "", "Un sistema de monitoreo continuo y validado permitirá reconocer variaciones en la calidad del agua...")}${field("Estado del arte y vacío identificado", "", "textarea", "Máximo 2 páginas. Incluye al menos 10 referencias primarias WoS/Scopus de los últimos 5 años.", true, "", "Revisión previa documentada: los sistemas comparados presentan limitaciones de continuidad...")}<details class="accordion"><summary>Ver referencias y antecedentes del caso</summary><p>Referencias pendientes de completar en este ejemplo.</p>${field("Antecedentes", "", "textarea", "Antecedentes institucionales, proyectos previos y base documental.", false, "", "El equipo dispone de una prueba de concepto en laboratorio...")}${docPendiente("Fundamentación", "Anexo de referencia · pendiente de adjuntar")}</details>`;
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
  return `${field("Objetivo general", "", "textarea", "Objetivo general del proyecto (OG).", true, "", "Desarrollar y validar un sistema de monitoreo que integra mediciones de calidad del agua...")}<h3 style="margin:22px 0 16px">Objetivos específicos</h3>${screen(
    "11",
  )
    .rows.map((r) =>
      field(
        r.code,
        "",
        "textarea",
        "Cada objetivo se vincula con actividades y resultados.",
        true,
        "",
        r.code === "OE1" ? "Diseñar sensores IoT de bajo costo para medición de pH, temperatura y conductividad" : r.code === "OE2" ? "Integrar calibración comparativa con instrumentos de referencia" : r.code === "OE3" ? "Validar el prototipo en dos microcuencas piloto durante 12 meses" : "Objetivo específico..."
      ),
    )
    .join(
      "",
    )}${state.extraObjective ? field("OE4", state.extraObjective, "textarea", "Objetivo agregado en esta sesión.", true, "", "") : ""}${act("Agregar objetivo", "objective", "secondary", "plus")}`;
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
  return `${field("Enfoque y diseño metodológico", "", "textarea", "Describe enfoque, alcance y diseño del proyecto.", true, "", "Desarrollo experimental en tres fases: definición de requerimientos, integración del prototipo y validación comparativa en campo.")}${field("Procedimientos y técnicas", "", "textarea", "Incluye instrumentos, variables y procedimientos de medición.", true, "", "Se definirán puntos de medición en dos microcuencas; se calibrarán los instrumentos; se compararán registros del prototipo con mediciones de referencia...")}${field("Usuarios y validación", "", "textarea", "Justifica la selección de sitios y cómo se comprobará el desempeño.", true, "", "Personas responsables de la gestión de dos microcuencas piloto. La validación compara mediciones de pH, temperatura y conductividad con instrumentos de referencia...")}${field("Análisis de resultados", "", "textarea", "Describe cómo se evaluarán los resultados.", true, "", "Se evaluarán integridad de registros, concordancia de las mediciones y disponibilidad del sistema durante el período piloto.")}<details class="accordion"><summary>Productos y difusión</summary><p>Productos comprometidos para ${totalHoras} h: software (activo de PI), artículo sometido WoS/Scopus y manual técnico. La validación de PI corresponde a Vinculación.</p></details>`;
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
const activities = [];

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
  const actividades = state.extraActivities || [];
  return `${notice(actividades.length ? `${actividades.length} actividades registradas` : "Sin actividades registradas", "Asocia objetivo, resultado, participante, responsabilidad, riesgo y plazo en meses correlativos.")}<div class="mt">${table(
    ["Objetivo / actividad", "Resultado", "Responsable", "Meses"],
    actividades.map((r) => [
      `<span class="project-code">${r[0]}</span><strong>${r[1]}</strong>`,
      r[2],
      `<strong>${esc(nombreResponsableActual())}</strong><br><span class="micro muted">${esc(responsableDeActividad(r[3]).rol)}</span>`,
      r[4],
    ]),
  )}</div><div class="action-row mt mb">${act("Agregar actividad", "activity", "secondary", "plus")}${btn("Revisar riesgos", "14", "text", "arrow")}</div><h3 class="mb">Cronograma · 24 meses</h3><div class="gantt"><div>Actividad</div>${["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"].map((x) => `<div>${x}</div>`).join("")}${(state.extraActivities || []).map((r, i) => `<div>${r[1]}</div>${Array.from({ length: 8 }, (_, j) => `<div ${j >= i * 2 && j < i * 2 + 2 ? 'class="bar"' : ""}></div>`).join("")}`).join("")}</div><details class="accordion"><summary>Giras e informes de seguimiento</summary><p>Se planifican giras de campo durante meses 13–20, informes semestrales en meses 6, 12, 18 y 24 e informes anuales en meses 12 y 24. La coordinación supervisa su entrega.</p></details>`;
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
  const riesgos = state.extraRisks || [];
  return `${notice(riesgos.length ? `${riesgos.length} riesgos registrados` : "Sin riesgos registrados", "La plantilla exige identificar riesgos, mitigación y responsable para cada actividad.")}<div class="mt">${table(
    ["Actividad / riesgo", "Medida de mitigación", "Responsable"],
    riesgos.map((r) => [
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
  const rubros = catalogos?.rubros_presupuesto ?? [];
  // Asegurar que state.budget tenga todos los rubros del catálogo (inicialización perezosa)
  if (!state.budget.length && rubros.length) {
    state.budget = rubros.map(r => ({
      id_rubro: r.id_rubro,
      name: r.nombre_rubro,
      code: String(r.id_rubro),
      a: 0,
      b: 0,
      detail: ""
    }));
    save();
  }
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
    ["Rubro", "2027", "2028", "Justificación (máx. 500 car.)", ""],
    state.budget.map((r, i) => [
      `<span class="project-code">${r.id_rubro ? `R-${r.id_rubro}` : r.code}</span><strong>${esc(r.name)}</strong>`,
      `<input type="number" min="0" step="1000" value="${r.a}" data-budget-index="${i}" data-budget-field="a" class="budget-input" style="width:140px" aria-label="Monto 2027 para ${esc(r.name)}">`,
      `<input type="number" min="0" step="1000" value="${r.b}" data-budget-index="${i}" data-budget-field="b" class="budget-input" style="width:140px" aria-label="Monto 2028 para ${esc(r.name)}">`,
      `<textarea data-budget-index="${i}" data-budget-field="detail" class="budget-textarea" maxlength="500" style="width:280px;min-height:36px" aria-label="Justificación para ${esc(r.name)}">${esc(r.detail)}</textarea>`,
      ``,
    ]),
  )}</div><div class="action-row mt">${act("Ver reglas de presupuesto", "budget-rules", "text")}</div><details class="accordion"><summary>Justificaciones y otras fuentes</summary>${state.budget.map((r) => `<p><strong>${r.name}.</strong> ${r.detail}</p>`).join("")}${field("Financiamiento externo / contrapartida", "", "textarea", "Indica fuentes externas, contrapartidas o co-financiamiento.", false, "", "Sin aportes externos.")}</details>`;
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
  const trlBase = catalogos?.nivel_trl?.length
    ? catalogos.nivel_trl
    : [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ nivel: n, nombre: `TRL ${n}` }));
  const trlOpts = trlBase.map((t) => ({
    value: String(t.nivel),
    label: t.nombre,
  }));
  return `<h3 class="mb">Madurez tecnológica y propiedad intelectual</h3><div class="field-row">${field("TRL actual", trlOpts, "select", "Rango de referencia DT: 4–7.", true, "", "", "4")}${field("TRL esperado", trlOpts, "select", "Coherente con objetivos y validación.", true, "", "", "6")}</div>${field("Potencial de propiedad intelectual", ["Sí", "No"], "select", "En desarrollo tecnológico el dictamen de Vinculación es obligatorio.", true, "", "", "Sí")}${field("Activo previsto", "", "textarea", "Evitar divulgación previa a la valoración institucional.", true, "", "Software de integración y registro de mediciones ambientales.")}<details class="accordion" open><summary>Declaraciones éticas individuales</summary><p class="small muted" style="margin-top:14px">Cada aspecto se declara y justifica por separado; no se admite una respuesta general.</p><div class="ethics-grid">${ethics.map(([label, reason], i) => `<section class="ethics-item"><h3>${label}</h3>${field("¿Aplica?", ["No", "Sí"], "select", "Selecciona Sí si la actividad requiere revisión o permisos.", true, `ethics:${i}:applies`, "", "No")}${field(`Justificación específica`, "", "textarea", "Indica entidad, estado, mitigación y plazo si corresponde.", true, `ethics:${i}:reason`, reason)}</section>`).join("")}</div></details><details class="accordion"><summary>Producción, difusión y hoja de ruta</summary><p><strong>${totalHoras} h/semana:</strong> software + artículo sometido WoS/Scopus + manual técnico. Se asocian a OE2 y OE3.</p>${field("Difusión y socialización", "", "textarea", "Plan de difusión de resultados (seminarios, publicaciones, transferencia).", false, "", "Sesión institucional y manual para responsables de las microcuencas, después de la revisión de PI.")}${field("Hoja de ruta", "", "textarea", "Hitos para avanzar del TRL actual al esperado.", false, "", "TRL 4 a 6: integrar, calibrar y validar en entorno relevante.")}</details>`;
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
  return `${adjuntos}<div class="action-row mt">${act("Adjuntar documento", "upload", "secondary", "plus")}</div><div class="mt">${pendientes}</div><div class="mt">${notice("Los archivos se envían con la propuesta", "Al confirmar el envío, los documentos adjuntos se incorporan a la propuesta (PDF, DOCX, XLSX o PPTX, máx. 20 MB).")}</div><div class="mt">${notice("Dictámenes y acuerdos se agregan en su etapa", "El dictamen de Vinculación precede al Comité; los avales se requieren para el sometimiento formal. No se exige un documento antes de que pueda ser emitido.")}</div>`;
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
    )}</div><div class="mt">${notice("Próxima etapa: Vinculación", "La propuesta se registrará con estado «En revisión de Vinculación» y se generará la evaluación preliminar.")}</div><label class="checkline mt"><input type="checkbox" id="reviewed" ${state.reviewed ? "checked" : ""}>He revisado la información y los documentos.</label>${!ok ? notice("Aún no puedes enviar", issues.map((i) => i.text).join(" · "), "warning") : ""}`;
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
 * Los nombres coinciden con el catálogo «estados» de PostgreSQL: las etapas de devolución
 * (observaciones y rechazo) también forman parte de la ruta porque el investigador puede
 * corregir el expediente y reenviarlo a la etapa que lo devolvió.
 * atributos:
 *     * string : 0 'En formulación'
 *     * string : 1 'En revisión de Vinculación'
 *     * string : 2 'En evaluación técnica'
 *     * string : 3 'Avalada'
 *     * string : 4 'Sometida'
 *     * string : 5 'Dictaminada'
 *     * string : 6 'Aprobada por CIE'
 *     * string : 7 'En ejecución'
 *     * string : 8 'Con observaciones'
 *     * string : 9 'Rechazada'
 *     * string : 10 'Cerrada'
 */
const stageList = [
  "En formulación",
  "En revisión de Vinculación",
  "En evaluación técnica",
  "Avalada",
  "Sometida",
  "Dictaminada",
  "Aprobada por CIE",
  "En ejecución",
  "Con observaciones",
  "Rechazada",
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
  "Aprobada por CIE": "Aprobada por CIE",
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
  if (stage === "Aprobada por CIE")
    action =
      notice(
        "Resolución favorable del CIE",
        "Presenta la carta de aceptación durante el período del 2 al 6 de noviembre.",
      ) +
      `<div class="mt">${act("Presentar carta de aceptación", "acceptance", "", "upload")}</div>`;
  if (stage === "Con observaciones")
    action =
      notice(
        "Se requieren ajustes",
        "Corrige lo observado y reenvía el expediente a la etapa que te lo devolvió.",
        "warning",
      ) +
      `<div class="mt">${act("Atender observaciones", "attend", "", "edit")}</div>`;
  if (stage === "Rechazada")
    action = notice(
      "Resolución: no aprobada",
      "Consulta el acuerdo motivado en el expediente. La resolución no habilita aceptación ni ejecución.",
      "warning",
    );
  if (stage === "En ejecución")
    action =
      notice(
        "Proyecto en ejecución",
        "Registra informes y productos; el cierre requiere el informe final y la certificación de Dirección.",
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
    `<div class="two-col"><div class="stack">${card(esc(d?.titulo || trackTitle), `<span class="project-code">${esc(trackCode)} · Versión 1.0</span><div class="action-row mt mb">${badge(stateText, "solid")}${badge(d?.nombre_modalidad || state.mode || "Desarrollo tecnológico")}</div>${action}<div class="stat-strip"><div><strong>${money(trackAmount)}</strong><span>Monto solicitado</span></div><div><strong>${esc(periodo)}</strong><span>Período de ejecución</span></div><div><strong>${trackHours} h</strong><span>Dedicación semanal</span></div></div>`)}${card("Documentos de la etapa", documentosEtapa)}</div>${card("Ruta del expediente", `<div class="timeline">${stageList.map((s, i) => `<div class="event ${s === stage ? "current" : ""}"><h3>${i < ix ? "✓ " : ""}${s}</h3><p>${["Investigador", "Vinculación", "Comité Técnico", "Consejos de Escuela", "Investigador → VIE", "Dirección de Investigación", "CIE", "Equipo investigador", "Investigador", "Dirección de Investigación", "Dirección de Investigación"][i]}</p></div>`).join("")}</div>`)}</div>`,
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
  // [Línea clave]: Cada instancia colegiada consume su propia bandeja real de PostgreSQL.
  // El Comité Técnico usa bandejaComite; Vinculación mantiene bandejaPropuestas;
  // Dirección de Investigación usa bandejaDireccion; el CIE usa bandejaCie.
  const list =
    state.role === "vinculacion"
      ? bandejaPropuestas || []
      : state.role === "comite"
        ? bandejaComite || []
        : state.role === "consejo"
          ? bandejaConsejo || []
          : state.role === "direccion"
            ? bandejaDireccion || []
            : state.role === "cie"
              ? bandejaCie || []
              : top3propuestasmasrecientes || [];
  // [Línea clave]: Los estados se comparan por su nombre oficial del catálogo «estados».
  // «En ejecución» ya no está en revisión de Vinculación: el expediente sigue vigente pero
  // Vinculación no debe volver a dictaminarlo.
  const closedStatuses =
    state.role === "vinculacion"
      ? ["En evaluación del Comité Técnico", "Con observaciones", "Rechazada", "Aprobada por CIE", "En ejecución", "Cerrada"]
      : state.role === "comite"
        ? ["Pendiente de aval del Consejo", "Avalada", "Sometida ante VIE", "Dictaminada por Dirección", "Con observaciones", "Rechazada", "Aprobada por CIE", "En ejecución", "Cerrada"]
        : state.role === "consejo"
          ? ["Avalada", "Sometida ante VIE", "Dictaminada por Dirección", "Con observaciones", "Rechazada", "Aprobada por CIE", "En ejecución", "Cerrada"]
          : state.role === "direccion"
            ? ["Dictaminada por Dirección", "Con observaciones", "Rechazada", "Aprobada por CIE", "En ejecución", "Cerrada"]
            : state.role === "cie"
              ? ["Aprobada por CIE", "Con observaciones", "Rechazada", "En ejecución", "Cerrada"]
              : ["Cerrada", "Rechazada", "Aprobada por CIE"];
  const pending =
    state.role === "consejo"
      ? list.filter(esPendienteConsejo)
      : state.role === "direccion"
        ? list.filter(esPendienteDireccion)
        : state.role === "cie"
          ? list.filter(esPendienteCie)
          : list.filter((p) => !closedStatuses.includes(p.status));
  const closed =
    state.role === "consejo"
      ? list.filter((p) => !esPendienteConsejo(p))
      : state.role === "direccion"
        ? list.filter((p) => !esPendienteDireccion(p))
        : state.role === "cie"
          ? list.filter((p) => !esPendienteCie(p))
          : list.filter((p) => closedStatuses.includes(p.status));

  let filtered = activeFilter === "Finalizadas" ? closed : pending;
  if (activeFilter === "En revisión") filtered = pending.filter((p) => p.status.includes("revisión") || p.status.includes("evaluación"));
  // [Línea clave]: El Consejo de Escuela filtra por los avales que su escuela ya registró.
  if (activeFilter === "Avalados") filtered = list.filter((p) => p.miAval);
  // [Línea clave]: Dirección separa los expedientes que ya dictaminó de los que aún espera.
  if (activeFilter === "Determinadas") filtered = closed;
  // [Línea clave]: Dirección también tiene una bandeja propia con los proyectos en ejecución:
  // son los expedientes sobre los que puede dictaminar el cierre administrativo.
  if (activeFilter === "En ejecución")
    filtered = list.filter((p) => p.status === "En ejecución");
  // [Línea clave]: El CIE separa los expedientes ya resueltos por el comité de los pendientes.
  if (activeFilter === "Resueltas") filtered = closed;

  const rows = filtered.map((p) => {
    const puedeEvaluar = state.role === "comite" && !closedStatuses.includes(p.status);
    // [Línea clave]: El Consejo de Escuela solo ofrece registrar aval cuando la propuesta
    // sigue pendiente y su escuela todavía no registró el acuerdo.
    const puedeAvalar = state.role === "consejo" && esPendienteConsejo(p);
    // [Línea clave]: Dirección dictamina las propuestas pendientes y abre el expediente de las demás.
    const puedeDictaminar = state.role === "direccion" && esPendienteDireccion(p);
    // [Línea clave]: El CIE abre el formulario de resolución solo en los expedientes que
    // Dirección ya dictaminó y que el comité todavía no ha resuelto.
    const puedeResolver = state.role === "cie" && esPendienteCie(p);
    // [Línea clave]: Dirección de Investigación dictamina el cierre de los proyectos que
    // ya están en ejecución: es la única etapa que habilita el estado terminal «Cerrada».
    const puedeCerrar = state.role === "direccion" && p.status === "En ejecución";
    const etiquetaBoton = puedeEvaluar
      ? "Evaluar propuesta"
      : puedeAvalar
        ? "Registrar aval"
        : puedeDictaminar
          ? "Dictaminar"
          : puedeResolver
            ? "Resolver"
            : puedeCerrar
              ? "Cerrar proyecto"
              : "Abrir expediente";
    const destino = puedeEvaluar
      ? "24"
      : puedeAvalar
        ? "25"
        : puedeDictaminar
          ? "26"
          : puedeResolver
            ? "27"
            : "22";
    const botonFila = puedeCerrar
      ? act(
          "Cerrar proyecto",
          "close-project",
          "secondary compact",
          "check",
          `data-proposal-id="${p.id || ""}"`,
        )
      : btn(
          etiquetaBoton,
          destino,
          "secondary compact",
          "arrow",
          `data-proposal="${p.code}" data-proposal-id="${p.id || ""}"`,
        );
    return [
      `<span class="project-code">${esc(p.code)}</span><strong>${esc(p.title)}</strong><br><span class="micro muted">${esc(p.leader || "Investigador")} · ${esc(p.school || "TEC")}${p.fechaIngresoVie ? ` · Ingresó a VIE ${esc(String(p.fechaIngresoVie).slice(0, 10))}` : ""}</span>`,
      esc(p.type),
      badge(p.status),
      botonFila,
    ];
  });

  const metricas =
    state.role === "consejo"
      ? [
          ["Pendientes de aval", String(pending.length)],
          ["Avaladas por tu escuela", String(list.filter((p) => p.miAval).length)],
          ["Total en tu bandeja", String(list.length)],
        ]
      : state.role === "direccion"
        ? [
            ["Pendientes de dictamen", String(pending.length)],
            ["Proyectos en ejecución", String(list.filter((p) => p.status === "En ejecución").length)],
            ["Determinadas", String(closed.length)],
          ]
        : state.role === "cie"
          ? [
              ["Pendientes de resolución", String(pending.length)],
              ["Resueltas por el CIE", String(closed.length)],
              ["Total revisadas", String(list.length)],
            ]
          : [
              ["Pendientes de revisión", String(pending.length)],
              ["En evaluación / revisión", String(pending.filter((p) => p.status.includes("revisión") || p.status.includes("evaluación")).length)],
              ["Finalizadas en la convocatoria", String(closed.length)],
            ];

  const pestanasBandeja =
    state.role === "consejo"
      ? ["Pendientes", "Avalados", "Finalizadas"]
      : state.role === "direccion"
        ? ["Pendientes", "En ejecución", "Determinadas"]
        : state.role === "cie"
          ? ["Pendientes", "Resueltas"]
          : ["Pendientes", "En revisión", "Finalizadas"];

  return shell(
    `<div class="grid three mb">${metricas
      .map(
        ([a, b]) =>
          `<div class="card metric"><span class="label">${a}</span><span class="value">${b}</span></div>`,
      )
      .join(
        "",
      )}</div>${tabs(
        pestanasBandeja,
        activeFilter === "Todas" ? "Pendientes" : activeFilter,
        "data-filter",
      )}<div class="card">${table(["Expediente", "Modalidad", "Etapa", ""], rows.length ? rows : [[`<span class="muted">No hay expedientes para este filtro</span>`, "", "", ""]])}</div>`,
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
  // [Línea clave]: ¿Por qué soy importante? Resuelve el expediente activo del sistema o desde el escenario local. ¿Para qué? Mostrar metadatos y decisiones reales de la propuesta seleccionada en la bandeja. ¿Dónde me usan? Al inicio de dossier().
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
  // [Línea clave]: Solo «Cerrada» y «Rechazada» son estados terminales. «Aprobada por CIE»
  // todavía exige la carta de aceptación del investigador, así que el expediente sigue vivo.
  const isClosed = ["Cerrada", "Rechazada"].includes(p.status);

  let body;
  if (dossierTab === "Resumen")
    body = `${definition([
      ["Coordinadora / Líder", esc(p.leader)],
      ["Instancia", esc(p.school)],
      ["Período", esc(p.period)],
      ["Monto solicitado", money(p.amount)],
      ["Modalidad", esc(p.type)],
      ["Línea de investigación", esc(p.line)],
    ])}<div class="mt"><h3>Resumen de la investigación</h3><p class="small muted" style="margin-top:10px">${esc(p.resumen || "Sin resumen registrado.")}</p></div><div class="mt">${notice(isClosed ? "Consulta de expediente cerrado o resuelto" : "Expediente digital sincronizado", isClosed ? "La información se conserva para consulta. No se pueden modificar documentos ni decisiones." : "Propuesta, equipo, plan, presupuesto y decisiones conservan su versión y responsable con trazabilidad completa.")}</div>`;
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
    // [Línea clave]: El resultado del Comité Técnico se lee del expediente real (evaluations +
    // technical_committee_evaluations) y solo cae al texto demostrativo si no hay dictamen.
    const comite = (d?.evaluaciones || []).find((e) => e.rol_evaluador === "Comité Técnico");
    if (comite) {
      const decision =
        {
          favorable: "Recomendada",
          observaciones: "Devuelta con observaciones",
          rechazo: "No recomendada",
        }[comite.decision] || "Registrada";
      filas.push([
        "Comité Técnico",
        esc(
          `${decision} · ${Number(comite.puntaje_comite || 0).toFixed(1)}/100 · ${comite.evaluador_nombre || "Comité Técnico"}${comite.tiene_bloqueo_obligatorio ? " · Bloqueo obligatorio" : ""}`,
        ),
        act("Ver rúbrica", "rubric-summary", "text"),
      ]);
    } else {
      filas.push([
        "Comité Técnico",
        "Sin dictamen registrado",
        act("Ver rúbrica oficial", "rubric-summary", "text"),
      ]);
    }
    // [Línea clave]: El dictamen de Dirección de Investigación se lee del expediente real
    // (dictamen_direccion) con su resolución y el cumplimiento de los criterios VIE.
    const dir = d?.dictamen_direccion;
    if (dir) {
      const criteriosCumplidos = (dir.verificaciones || []).filter((v) => v.cumple).length;
      const totalCriterios = (dir.verificaciones || []).length;
      filas.push([
        "Dirección de Investigación",
        esc(
          `${dir.dictamen || "Registrada"} · ${criteriosCumplidos}/${totalCriterios} criterios VIE · ${dir.evaluador_nombre || "Dirección"}${dir.fundamentacion ? ` · ${dir.fundamentacion}` : ""}`,
        ),
        `<button class="btn text" data-go="28">Ver dictamen</button>`,
      ]);
    } else {
      filas.push([
        "Dirección de Investigación",
        "Sin dictamen registrado",
        act("Ver dictamen", "preview", "text"),
      ]);
    }
    // [Línea clave]: Los avales del Consejo de Escuela se leen del expediente real
    // (council_endorsements) y solo caen al texto demostrativo si no hay acuerdo.
    const avales = d?.avales_consejo || [];
    if (avales.length) {
      avales.forEach((aval) =>
        filas.push([
          "Consejo de Escuela",
          esc(
            `${aval.escuela_siglas || aval.escuela} · ${aval.tipo_instancia === "coordinadora" ? "Coordinadora" : "Participante"} · ${aval.numero_oficio || "sin oficio"}`,
          ),
          `<button class="btn text" data-go="28">Ver acuerdo</button>`,
        ]),
      );
    } else {
      filas.push([
        "Consejo de Escuela",
        "Sin aval registrado",
        act("Ver acuerdo", "preview", "text"),
      ]);
    }
    body = table(["Instancia", "Resultado", "Documento"], filas);
  } else if (dossierTab === "Resolución") {
    const cie = (d?.evaluaciones || []).find((e) => e.rol_evaluador === "CIE");
    const docs = (d?.documentos || []).filter((doc) => /resoluc|acuerdo|cie|cierre/i.test(`${doc.tipo_documento} ${doc.nombre_archivo}`));
    body = `${notice(isClosed ? "Resolución y cierre registrados" : "Decisión del CIE", isClosed ? "Acuerdo favorable y certificación de cierre conservados en el sistema." : cie ? `Resolución registrada: ${cie.observaciones || "sin detalle adicional"}` : "La resolución se agrega cuando el CIE concluye su revisión.")}${docs.length ? docs.map(docPropuesta).join("") : docPendiente("Acuerdo del CIE", "Pendiente de emisión")}${isClosed ? docPendiente("Certificación de cierre", "Pendiente de adjuntar") : ""}`;
  } else {
    body = historyContent(d);
  }

  const accion = historical
    ? `<p class="small muted mb">Este expediente está disponible en modo consulta.</p>${btn("Volver a resultados", "30", "secondary")}`
    : state.role === "investigador"
      ? `<p class="small muted mb">Consulta la etapa y las acciones pendientes de tu propuesta.</p>${btn("Ver seguimiento", "20", "", "arrow")}`
      : // [Línea clave]: Dirección de Investigación tiene la última acción del ciclo: dictaminar
        // el cierre del proyecto cuando el expediente ya está «En ejecución».
        state.role === "direccion" && p.status === "En ejecución"
        ? `<p class="small muted mb">El proyecto está en ejecución. El cierre exige el informe final y deja el expediente en estado terminal «Cerrada».</p>${act("Cerrar proyecto", "close-project", "", "check", `data-proposal-id="${p.id || ""}"`)}`
        : `<p class="small muted mb">Actúas como ${roles[state.role].label}.</p>${btn(
            p.status === "En revisión de Vinculación" ? "Iniciar revisión" : "Consultar dictamen",
            roles[state.role].screen,
            "",
            "arrow",
          )}`;

  return shell(
    `<div class="card card-pad mb"><span class="project-code">${esc(p.code)} · ${esc(p.type)}</span><div class="section-head" style="margin:10px 0 0"><h2 style="font-size:26px">${esc(p.title)}</h2>${badge(p.status, "solid")}</div></div>${tabs(["Resumen", "Documentos", "Evaluaciones", "Resolución", "Historial"], dossierTab)}<div class="two-col">${card("", body)}<div class="stack">${card("Acción disponible", accion)}${renderizarPanelReferenciaIA("22")}${card("Trazabilidad", `<p class="small muted mb">Cada decisión conserva fecha, actor, documento y versión en el sistema.</p>${btn("Ver historial completo", "28", "text", "arrow")}`)}${["direccion", "cie"].includes(state.role) ? notice("Verificación restringida", "Responsabilidades institucionales: al día.") : ""}</div></div>`,
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
  // [Línea clave]: Usa la rúbrica de PostgreSQL cuando está disponible para que la nota
  // previa coincida exactamente con la que valida el servidor; si no, usa la matriz local.
  for (const [g, cs] of gruposRubrica())
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
    const innovacionOpts = [
      "Software / Desarrollo tecnológico",
      "Prototipo funcional / Hardware",
      "Proceso o metodología transferible",
      "Invención patentable / Modelo de utilidad",
      "Secreto industrial / Know-how",
      "Obra protegible por derechos de autor",
    ];
    inner = `${notice(yaDictaminado ? "Dictamen ya registrado" : "Dictamen requerido", yaDictaminado ? `Oficio ${ev.numero_oficio_dictamen || "sin número"}. La propuesta ya fue remitida con la valoración de Vinculación; este formulario queda en modo consulta.` : "Registra el oficio firmado y la valoración técnica de Vinculación antes de remitir al Comité Técnico.")}<div class="mt">${field("Potencial de PI identificado", piOpts, "select", "Indica si el activo puede protegerse o requiere reserva.", true, "vinculacion:potencial_pi", "", "Sí · existe potencial de protección")}${field("Tipo de innovación", innovacionOpts, "select", "Clasificación del activo o resultado esperado.", false, "vinculacion:tipo_innovacion", "Software / Desarrollo tecnológico")}${field("Activo previsto", "", "textarea", "Describe el activo que se resguardará.", true, "vinculacion:activo_previsto", "Software de integración, registro de mediciones y documentación técnica.")}${field("Valoración técnica", "", "textarea", "Justificación y valoración técnica desarrollada por Vinculación.", true, "vinculacion:valoracion", "Se identifica potencial de protección en el software. Documentar autoría y resultados, y coordinar divulgación con Vinculación.")}${field("Oficio del dictamen", "", "text", "Número de oficio emitido por Vinculación.", true, "vinculacion:oficio", "CV-014-2026")}${field("Requiere reserva o resguardo previo", ev.requiere_reserva === true, "checkbox", "Marca si la divulgación debe restringirse antes de proteger el activo.", false, "vinculacion:reserva")}${yaDictaminado ? "" : `<div class="field"><label for="vinculacion-doc">Oficio firmado (PDF, DOCX)</label><input id="vinculacion-doc" type="file" accept=".pdf,.docx"><span class="help">Máximo 20 MB. Se almacena en el expediente de la propuesta.</span></div>`}${documentoVinculacion ? docPropuesta(documentoVinculacion) : yaDictaminado ? "" : notice("Adjunto pendiente", "Puedes registrar el dictamen y adjuntar el oficio firmado en la misma acción.")}</div>`;
  }
  if (id === "24") {
    const sc = scoreResult();
    const grupos = gruposRubrica();
    const detalleComite = evaluacionComite;
    const dictamen = detalleComite?.evaluacion || null;
    const yaDictaminado = !!dictamen?.id_evaluacion;
    const mapa = mapaCriteriosComite();
    const persistidos = new Map(
      (detalleComite?.puntajes || []).map((p) => [p.nombre_criterio, p]),
    );
    const fuente = rubricaComite?.secciones?.length
      ? `Rúbrica del sistema · ${rubricaComite.total_criterios} criterios · ${rubricaComite.total_peso} puntos`
      : "Rúbrica local de respaldo · aplica la migración V12 para persistirla";
    const resumenDictamen = yaDictaminado
      ? notice(
          "Dictamen del Comité Técnico ya registrado",
          `${Number(dictamen.puntaje).toFixed(1)}/100 · ${
            {
              favorable: "Recomendada",
              observaciones: "Devuelta con observaciones",
              rechazo: "No recomendada",
            }[dictamen.decision] || "Registrada"
          } · ${esc(dictamen.evaluador_nombre || "Comité Técnico")} · ${esc(String(dictamen.fecha_evaluacion || "").slice(0, 10))}${dictamen.tiene_bloqueo_obligatorio ? " · Bloqueo por criterio obligatorio insuficiente" : ""}. Este formulario queda en modo consulta.`,
        )
      : "";
    inner = `${notice("Rúbrica oficial · Desarrollo tecnológico", `${fuente}. Deficiente 0 · Regular 6 · Bueno 8 · Excelente 10. Un obligatorio con 0 o 6 impide recomendar, aun con nota ≥70.`)}${resumenDictamen}<div class="mt">${grupos
      .map(
        ([g, cs], i) =>
          `<details class="accordion" ${i < 2 ? "open" : ""}><summary>${esc(g)} <span class="muted small">· ${cs.reduce((a, c) => a + c[1], 0)}%</span></summary>${table(
            ["Criterio", "Peso", "Nivel"],
            cs.map(([n, w, m]) => {
              const criterio = mapa.get(n);
              const valor = Number(persistidos.get(n)?.puntaje ?? scoreValue(n));
              return [
                `<strong>${esc(n)}</strong>${m ? '<br><span class="micro">Obligatorio</span>' : ""}`,
                w + "%",
                `<select data-score="${esc(n)}"${criterio ? ` data-criterion-id="${criterio.id_criterio_rubrica}"` : ""}${yaDictaminado ? " disabled" : ""} aria-label="Nivel: ${esc(n)}" style="padding:8px;border:1px solid var(--line);border-radius:6px">${[
                  [0, "Deficiente"],
                  [6, "Regular"],
                  [8, "Bueno"],
                  [10, "Excelente"],
                ]
                  .map(
                    ([v, l]) =>
                      `<option value="${v}" ${v === valor ? "selected" : ""}>${l} · ${v}</option>`,
                  )
                  .join("")}</select>`,
              ];
            }),
          )}</details>`,
      )
      .join(
        "",
      )}</div><label class="checkline"><input type="checkbox" id="products-ok" ${!state.notRecommended ? "checked" : ""}${yaDictaminado ? " disabled" : ""}>Producción no sumativa conforme: software + artículo WoS/Scopus + manual técnico para ${totalHorasEquipo()} h.</label>${field("Justificación de criterios obligatorios", "", "textarea", "Justifica los criterios obligatorios con referencia a la evidencia.", true, "comite:justificacion", "La propuesta identifica responsables, plazos, beca, riesgos y declaración ética; consta dictamen de Vinculación.")}<div id="score-result" class="notice ${sc.recommended ? "" : "warning"}"><div><strong>${sc.sum.toFixed(1)} / 100 · ${sc.recommended ? "Recomendada" : "No recomendada"}</strong><p>${sc.blocked ? "Hay un criterio obligatorio con nivel insuficiente." : "La recomendación depende de la nota y de los requisitos obligatorios."}</p></div></div>`;
  }
  if (id === "25") {
    // [Línea clave]: El aval del Consejo de Escuela se construye con los datos reales de
    // PostgreSQL: escuelas involucradas, avales previos y acuerdos firmados del expediente.
    const detalle = avalConsejo || {};
    const escuela = detalle.escuela_usuario || {};
    const instancias = detalle.escuelas_involucradas || [];
    const yaAvalado = !!detalle.mi_aval;
    const puedeAvalar = !!detalle.puede_aval;
    const pendientes = instancias.filter((instancia) => !instancia.avalada);
    const hoy = new Date().toISOString().slice(0, 10);
    const tablaInstancias = instancias.length
      ? table(
          ["Escuela", "Instancia", "Aval"],
          instancias.map((instancia) => [
            `${esc(instancia.siglas || "")} · ${esc(instancia.nombre)}`,
            instancia.tipo_instancia === "coordinadora" ? "Coordinadora" : "Participante",
            badge(
              instancia.avalada ? "Aval registrado" : "Pendiente",
              instancia.avalada ? "solid" : "",
            ),
          ]),
        )
      : notice(
          "Escuelas involucradas",
          "No se detectaron escuelas con personal vinculado a la propuesta.",
        );
    const estadoAval = yaAvalado
      ? notice(
          "Aval ya registrado",
          `Tu escuela registró el aval el ${String(detalle.mi_aval.fecha_acuerdo || "").slice(0, 10)} con oficio ${detalle.mi_aval.numero_oficio || "sin número"}. El formulario queda en modo consulta.`,
        )
      : puedeAvalar
        ? ""
        : notice(
            "Aval no disponible",
            detalle.motivo_bloqueo ||
              "La propuesta no está pendiente de aval de tu escuela.",
          );
    const avisoPendientes = pendientes.length
      ? notice(
          "Avales pendientes",
          `Falta el aval de: ${pendientes.map((instancia) => instancia.siglas || instancia.nombre).join(", ")}. La propuesta solo pasa a «Avalada» cuando todas las escuelas relacionadas con ella registren su aval.`,
        )
      : "";
    const resumen = `<div class="mt">${definition([
      ["Instancia que avala", `${escuela.siglas || ""} · ${escuela.nombre || "Consejo de Escuela"}`],
      ["Tipo de instancia", escuela.es_coordinadora ? "Coordinadora" : "Participante"],
      [
        "Puntaje del Comité Técnico",
        detalle.puntaje_comite != null
          ? `${Number(detalle.puntaje_comite).toFixed(1)}/100`
          : "Sin dictamen registrado",
      ],
      [
        "Aval de tu escuela",
        yaAvalado
          ? `Registrado · ${detalle.mi_aval.numero_oficio || "sin oficio"}`
          : "Pendiente",
      ],
    ])}</div>`;
    const documentosAval = (detalle.documentos || []).length
      ? `<div class="mt">${detalle.documentos.map(docPropuesta).join("")}</div>`
      : "";
    const formularioAval = `${field("Número de sesión", "", "text", "Sesión en la que se aprobó el acuerdo.", true, "consejo:sesion")}<div class="field-row">${field("Artículo", "", "text", "Artículo del acuerdo que sustenta el aval.", true, "consejo:articulo")}${field("Fecha del acuerdo", hoy, "date", "", true, "consejo:fecha")}</div>${field("Número de oficio", "", "text", "Oficio emitido por el Consejo de Escuela.", true, "consejo:oficio")}${field("Ratificación de la calificación técnica", true, "checkbox", "El consejo ratifica la evaluación técnica del Comité Técnico.", false, "consejo:ratifica")}${field("Aval de la propuesta y del presupuesto", true, "checkbox", "El consejo avala la propuesta y el monto solicitado.", false, "consejo:presupuesto")}${field("Aval de las horas del personal", true, "checkbox", "El consejo avala la carga horaria del personal de su escuela.", false, "consejo:horas")}${field("Observaciones del acuerdo", "", "textarea", "Detalle del acuerdo o condiciones del aval.", false, "consejo:observaciones")}<div class="field"><label for="consejo-doc">Acuerdo firmado (PDF, DOCX)</label><input id="consejo-doc" type="file" accept=".pdf,.docx"><span class="help">Máximo 20 MB. Se almacena en el expediente de la propuesta.</span></div>`;
    inner = `${notice("El aval no somete automáticamente", "Después del acuerdo, el investigador realiza el sometimiento formal ante VIE.")}${estadoAval}${avisoPendientes}${resumen}${puedeAvalar ? `<div class="mt">${formularioAval}</div>` : ""}<div class="mt">${tablaInstancias}</div>${documentosAval}`;
  }
  if (id === "26") {
    const detalleDir = dictamenDireccion || {};
    const yaDictaminadoDir = !!detalleDir.dictamen_direccion;
    const criterios = detalleDir.criterios_vie || [];
    const bloqueado = detalleDir.puede_dictaminar === false;
    const aviso = yaDictaminadoDir
      ? notice("Dictamen ya registrado por Dirección de Investigación", `Emitido por ${detalleDir.dictamen_direccion.evaluador_nombre || "Dirección"} el ${String(detalleDir.dictamen_direccion.fecha_evaluacion || "").slice(0, 10)} · ${detalleDir.dictamen_direccion.dictamen}.`)
      : bloqueado
        ? notice("Dictamen no disponible", detalleDir.motivo_bloqueo || "La propuesta no está en estado Sometida ante VIE.")
        : notice("Propuesta sometida ante VIE", "La Dirección verifica el expediente antes de emitir el dictamen para el CIE.");
    const checklist = (yaDictaminadoDir ? (detalleDir.dictamen_direccion.verificaciones || []) : criterios).map((c) => {
      const idC = c.id_criterio;
      const desc = c.descripcion_criterio || c.descripcion || "";
      const checked = yaDictaminadoDir ? !!c.cumple : (state.saved[`direccion:criterio:${idC}`] !== false);
      return `<label class="checkline"><input type="checkbox" data-direccion-criterio="${idC}" ${checked ? "checked" : ""} ${yaDictaminadoDir ? "disabled" : ""}>${esc(desc)}</label>`;
    }).join("");
    const resp = yaDictaminadoDir ? (detalleDir.dictamen_direccion.verificacion_responsabilidades !== false) : (state.saved["direccion:resp"] !== false);
    const riesgos = yaDictaminadoDir ? (detalleDir.dictamen_direccion.verificacion_riesgos !== false) : (state.saved["direccion:riesgos"] !== false);
    const beca = yaDictaminadoDir ? (detalleDir.dictamen_direccion.verificacion_beca !== false) : (state.saved["direccion:beca"] !== false);
    const decl = yaDictaminadoDir ? (detalleDir.dictamen_direccion.verificacion_declaraciones !== false) : (state.saved["direccion:decl"] !== false);
    const docs = yaDictaminadoDir ? (detalleDir.dictamen_direccion.verificacion_documentos !== false) : (state.saved["direccion:docs"] !== false);
    inner = `${aviso}<div class="mt"><strong>Verificación por criterios VIE</strong>${checklist}</div><div class="mt"><strong>Verificación institucional</strong><label class="checkline"><input type="checkbox" data-direccion-check="resp" ${resp ? "checked" : ""} ${yaDictaminadoDir ? "disabled" : ""}>Personal investigador al día con informes y compromisos</label><label class="checkline"><input type="checkbox" data-direccion-check="riesgos" ${riesgos ? "checked" : ""} ${yaDictaminadoDir ? "disabled" : ""}>Riesgos identificados y medidas de mitigación coherentes</label><label class="checkline"><input type="checkbox" data-direccion-check="beca" ${beca ? "checked" : ""} ${yaDictaminadoDir ? "disabled" : ""}>Beca obligatoria para estudiante asistente especial (cuando aplica)</label><label class="checkline"><input type="checkbox" data-direccion-check="decl" ${decl ? "checked" : ""} ${yaDictaminadoDir ? "disabled" : ""}>Declaraciones éticas completas y justificadas</label><label class="checkline"><input type="checkbox" data-direccion-check="docs" ${docs ? "checked" : ""} ${yaDictaminadoDir ? "disabled" : ""}>Avales, evaluación y documentos completos</label></div>${field("Dictamen", yaDictaminadoDir ? [detalleDir.dictamen_direccion.dictamen] : ["Favorable", "Con observaciones", "No favorable"], yaDictaminadoDir ? "select" : "select", "", true, "direccion:dictamen", "", "Favorable")}${field("Fundamentación", "", "textarea", "Fundamenta el dictamen con referencia a los criterios VIE y evidencia del expediente.", true, "direccion:fundamentacion", "El expediente incorpora la evaluación del Comité, los avales del Consejo y la documentación requerida. Se verifica el cumplimiento de los criterios VIE.")}${yaDictaminadoDir ? "" : (detalleDir.documentos?.length ? `<div class="mt">${detalleDir.documentos.map(docPropuesta).join("")}</div>` : notice("Documentos del expediente", "Los documentos de la propuesta están disponibles en el expediente."))}`;
  }
  if (id === "27") {
    // [Línea clave]: La resolución del CIE se registra con los datos reales del expediente:
    // el catálogo institucional de acuerdos, el dictamen de Dirección que la habilitó y los
    // documentos del expediente. El backend valida el estado y guarda la trazabilidad.
    const detalleCie = resolucionCie || {};
    const yaResuelto = !!detalleCie.resolucion_cie;
    const puedeResolver = detalleCie.puede_resolver === true && !yaResuelto;
    const tipos = detalleCie.tipos_resolucion || [];
    const dictamenPrevio = detalleCie.dictamen_direccion || null;
    const hoy = new Date().toISOString().slice(0, 10);
    const opcionesResolucion = tipos.length
      ? tipos.map((t) => ({ value: String(t.id_resolucion), label: t.nombre_resolucion }))
      : [{ value: "1", label: "Aprobado sin observaciones" }];
    const bloqueDictamen = dictamenPrevio
      ? `<div class="mt">${definition([
          ["Dictamen de Dirección", dictamenPrevio.dictamen || "Favorable"],
          ["Fundamentación", dictamenPrevio.fundamentacion || "Sin detalle"],
          ["Fecha del dictamen", String(dictamenPrevio.fecha_evaluacion || "").slice(0, 10)],
          ["Responsable", dictamenPrevio.evaluador_nombre || "Dirección de Investigación"],
        ])}</div>`
      : notice(
          "Dictamen de Dirección no visible",
          "El expediente no registra un dictamen de Dirección legible; el backend volverá a validarlo al guardar la resolución.",
        );
    const documentosCie = (detalleCie.documentos || []).length
      ? `<div class="mt">${detalleCie.documentos.map(docPropuesta).join("")}</div>`
      : "";
    const resumenResolucion = yaResuelto
      ? notice(
          "Resolución ya registrada por el CIE",
          `${detalleCie.resolucion_cie.nombre_resolucion} · Sesión ${detalleCie.resolucion_cie.numero_sesion || "s/n"}, artículo ${detalleCie.resolucion_cie.articulo || "s/n"} · ${String(detalleCie.resolucion_cie.fecha_resolucion || "").slice(0, 10)} · ${detalleCie.resolucion_cie.evaluador_nombre || "Comité de Ética"}. El formulario queda en modo consulta.`,
        )
      : "";
    const bloqueCondiciones = yaResuelto
      ? `<div class="mt">${field(
          "Condiciones de aceptación adicionales",
          detalleCie.resolucion_cie.condiciones || "",
          "textarea",
          "Se acumulan al acuerdo vigente sin cambiar el estado de la propuesta.",
          false,
          "cie:condiciones_posteriores",
        )}<div class="action-row mt">${act("Registrar condiciones", "conditions", "secondary", "check", `data-step="27-condiciones"`)}</div></div>`
      : "";
    const formularioCie = puedeResolver
      ? `<div class="mt">${field(
          "Tipo de resolución",
          opcionesResolucion,
          "select",
          "Acuerdo del catálogo institucional del comité.",
          true,
          "cie:id_resolucion",
        )}</div><div class="field-row">${field(
          "Número de sesión",
          "",
          "text",
          "Sesión del comité en la que se aprobó el acuerdo.",
          true,
          "cie:numero_sesion",
        )}${field("Artículo", "", "text", "Artículo del acuerdo que sustenta la resolución.", true, "cie:articulo")}</div><div class="field-row">${field(
          "Fecha de resolución",
          hoy,
          "date",
          "",
          true,
          "cie:fecha_resolucion",
        )}</div>${field(
          "Fundamentación",
          "",
          "textarea",
          "La decisión debe quedar motivada, incluidas las resoluciones negativas.",
          true,
          "cie:fundamentacion",
        )}${field(
          "Condiciones de aceptación",
          "",
          "textarea",
          "Requerimientos que el investigador debe cumplir (opcional).",
          false,
          "cie:condiciones",
        )}${field(
          "Observaciones del acuerdo",
          "",
          "textarea",
          "Detalles adicionales de la sesión (opcional).",
          false,
          "cie:observaciones",
        )}<div class="field"><label for="cie-doc">Acuerdo firmado (PDF, DOCX)</label><input id="cie-doc" type="file" accept=".pdf,.docx"><span class="help">Máximo 20 MB. Se almacena en el expediente de la propuesta.</span></div>`
      : "";
    const avisoBloqueo = !yaResuelto && !puedeResolver
      ? notice(
          "Resolución no disponible",
          detalleCie.motivo_bloqueo ||
            "La propuesta no está dictaminada por Dirección de Investigación; el CIE solo resuelve expedientes con dictamen favorable.",
        )
      : "";
    inner = `${notice(
      "Acuerdo colegiado del Comité de Ética",
      "El CIE solo resuelve propuestas en estado «Dictaminada por Dirección». El acuerdo queda registrado con sesión, artículo, fecha y fundamentación.",
    )}${resumenResolucion}${avisoBloqueo}${bloqueDictamen}${formularioCie}${bloqueCondiciones}${documentosCie}`;
  }
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
  const dictamenExistente =
    (id === "23" && !!evaluacionVinculacion?.id_evaluacion) ||
    (id === "24" && !!evaluacionComite?.evaluacion?.id_evaluacion) ||
    // [Línea clave]: El Consejo de Escuela solo registra aval una vez por escuela; después
    // el expediente queda en modo consulta.
    (id === "25" && (!!avalConsejo?.mi_aval || (!!avalConsejo && !avalConsejo.puede_aval))) ||
    (id === "26" && !!dictamenDireccion?.dictamen_direccion) ||
    // [Línea clave]: El CIE resuelve una sola vez por propuesta; después el expediente queda
    // en modo consulta y solo admite condiciones de aceptación posteriores.
    (id === "27" && !!resolucionCie?.resolucion_cie);
  const puedeDictaminarDireccion = id === "26" ? (dictamenDireccion?.puede_dictaminar === true && !dictamenDireccion?.dictamen_direccion) : true;
  const puedeResolverCie = id === "27" ? (resolucionCie?.puede_resolver === true && !resolucionCie?.resolucion_cie) : true;
  const accionesEvaluacion =
    dictamenExistente || (id === "26" && !puedeDictaminarDireccion) || (id === "27" && !puedeResolverCie)
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
 * Construir la tarjeta con los avales reales del Consejo de Escuela y sus acuerdos.
 * Muestra una fila por escuela involucrada con la sesión, el artículo, el oficio y el alcance del aval.
 * parametros:
 *     - Object|null : d Expediente consolidado.
 * return:
 *     + string : avalesHtml Tarjeta con el detalle de los avales registrados.
 */
function dictamenConsejo(d = null) {
  const avales = d?.avales_consejo || [];
  if (!avales.length)
    return notice(
      "Avales del Consejo de Escuela",
      "El expediente todavía no registra avales del Consejo de Escuela.",
    );
  const fecha = (valor) => (valor ? String(valor).slice(0, 10) : "sin fecha");
  const filas = avales.map((aval) => [
    `${esc(aval.escuela_siglas || "")} · ${esc(aval.escuela)}`,
    esc(aval.tipo_instancia === "coordinadora" ? "Coordinadora" : "Participante"),
    esc(`${aval.numero_sesion || "sin sesión"} · ${aval.articulo || "sin artículo"}`),
    esc(fecha(aval.fecha_acuerdo)),
    esc(aval.numero_oficio || "sin oficio"),
    esc(
      [
        aval.ratifica_calificacion ? "Ratifica calificación" : null,
        aval.avala_presupuesto ? "Avala presupuesto" : null,
        aval.avala_horas_personal ? "Avala horas" : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Sin ratificaciones",
    ),
  ]);
  const detalles = avales
    .map(
      (aval) =>
        `<div class="mt"><strong>${esc(aval.escuela_siglas || aval.escuela)}</strong>${aval.observaciones ? `<p class="small muted">${esc(aval.observaciones)}</p>` : ""}<p class="micro muted">Registrado por ${esc(aval.registrado_por || "Consejo de Escuela")} · ${esc(fecha(aval.fecha_registro))}</p></div>`,
    )
    .join("");
  return `${table(["Escuela", "Instancia", "Sesión y artículo", "Fecha", "Oficio", "Alcance del aval"], filas)}${detalles}`;
}

/**
 * Construir la tarjeta con el dictamen de Dirección de Investigación y sus verificaciones.
 * Lee el dictamen persistido en PostgreSQL (evaluations con rol Dirección + criterios VIE).
 * parametros:
 *     - Object|null : d Expediente consolidado.
 * return:
 *     + string : dictamenHtml Tarjeta con resolución, fundamentación y verificaciones.
 */
function dictamenDireccionResumen(d = null) {
  const dir = d?.dictamen_direccion;
  if (!dir)
    return notice(
      "Dictamen de Dirección pendiente",
      "La propuesta aún no tiene un dictamen de Dirección de Investigación registrado.",
    );
  const criterios = (dir.verificaciones || [])
    .map(
      (v) =>
        `<li>${v.cumple ? "✓" : "✗"} ${esc(v.descripcion_criterio || `Criterio ${v.id_criterio}`)}</li>`,
    )
    .join("");
  const institucionales = [
    ["Personal investigador al día", dir.verificacion_responsabilidades],
    ["Riesgos y mitigación", dir.verificacion_riesgos],
    ["Beca estudiantil", dir.verificacion_beca],
    ["Declaraciones éticas", dir.verificacion_declaraciones],
    ["Avales y documentos", dir.verificacion_documentos],
  ]
    .map(([etiqueta, valor]) => `<li>${valor === false ? "✗" : "✓"} ${esc(etiqueta)}</li>`)
    .join("");
  return `${definition([
    ["Resolución", esc(dir.dictamen || "Registrada")],
    ["Emitido por", esc(dir.evaluador_nombre || "Dirección de Investigación")],
    ["Fecha", esc(String(dir.fecha_evaluacion || "").slice(0, 10))],
    ["Fundamentación", esc(dir.fundamentacion || "Sin fundamentación registrada")],
  ])}${criterios ? `<h3 style="margin:18px 0 8px">Criterios VIE</h3><ul style="margin:0;padding-left:18px">${criterios}</ul>` : ""}${institucionales ? `<h3 style="margin:18px 0 8px">Verificación institucional</h3><ul style="margin:0;padding-left:18px">${institucionales}</ul>` : ""}`;
}

/**
 * Construir la tarjeta con la resolución del Comité de Ética en Investigación.
 * Lee el acuerdo persistido en PostgreSQL (cie_resolution_evaluations + resoluciones_cie).
 * parametros:
 *     - Object|null : d Expediente consolidado.
 * return:
 *     + string : resolucionHtml Tarjeta con el acuerdo colegiado y sus condiciones.
 */
function resolucionCieResumen(d = null) {
  const res = d?.resolucion_cie;
  if (!res)
    return notice(
      "Resolución del CIE pendiente",
      "La propuesta aún no tiene una resolución del Comité de Ética en Investigación registrada.",
    );
  const condiciones = res.condiciones
    ? `<h3 style="margin:18px 0 8px">Condiciones de aceptación</h3><p class="small muted" style="white-space:pre-line">${esc(res.condiciones)}</p>`
    : "";
  const documento = (d?.documentos || []).find(
    (doc) => Number(doc.id_documento) === Number(res.id_documento),
  );
  return `${definition([
    ["Acuerdo", esc(res.nombre_resolucion || "Resolución registrada")],
    ["Sesión", esc(res.numero_sesion || "sin sesión")],
    ["Artículo", esc(res.articulo || "sin artículo")],
    ["Fecha del acuerdo", esc(String(res.fecha_resolucion || "").slice(0, 10))],
    ["Registrado por", esc(res.evaluador_nombre || "Comité de Ética en Investigación")],
    ["Fundamentación", esc(res.fundamentacion || "Sin fundamentación registrada")],
  ])}${condiciones}${documento ? `<div class="mt">${docPropuesta(documento)}</div>` : ""}`;
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
    `${card(`${esc(code)} · Historial de actuaciones`, historyContent(d))}${card("Dictamen de Vinculación", dictamenVinculacion(d))}${card("Avales del Consejo de Escuela", dictamenConsejo(d))}${card("Dictamen de Dirección de Investigación", dictamenDireccionResumen(d))}${card("Resolución del Comité de Ética en Investigación", resolucionCieResumen(d))}`,
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

  const aniosOpts = ["2020", "2021", "2022", "2023", "2024", "2025", "2026", "2027", "2028", "2029", "2030"];

  return shell(
    `<div class="two-col"><form class="card card-pad" id="history-search"><div class="section-head"><h2>Encuentra un expediente</h2>${badge("Consulta institucional")}</div>${field("Código, título o persona investigadora", state.search, "search", "Puedes combinar la búsqueda con filtros institucionales.", false, "history:query")}<div class="field-row">${field("Escuela", escuelasOpts, "select", "", false, "history:school")}${field("Modalidad", modalidadesOpts, "select", "", false, "history:mode")}</div><div class="field-row">${field("Estado", estadosOpts, "select", "", false, "history:status")}${field("Línea de investigación", lineasOpts, "select", "", false, "history:line")}</div><div class="field-row">${field("Desde", aniosOpts, "select", "", false, "history:from", "", "2024")}${field("Hasta", aniosOpts, "select", "", false, "history:to", "", "2028")}</div><div class="form-footer">${act("Limpiar filtros", "clear-search", "text")}${act("Buscar expedientes", "search-history", "", "search")}</div></form><div class="stack">${card("Consulta con trazabilidad", `<div class="list-item">${icon("folder")}<div><h3>Expediente completo</h3><p>Propuesta, recursos, documentos y productos.</p></div></div><div class="list-item">${icon("shield")}<div><h3>Decisiones y evidencia</h3><p>Evaluaciones, avales, dictámenes y resolución.</p></div></div><div class="list-item">${icon("clock")}<div><h3>Historial conservado</h3><p>Fechas, actores y versiones sincronizadas.</p></div></div>`)}</div></div>`,
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
    `<div class="section-head"><span class="result-count">${list.length} expedientes encontrados en el sistema ${q ? "para «" + esc(state.search) + "»" : ""}</span>${btn("Modificar filtros", "29", "secondary", "settings")}</div>${list.length ? `<div class="card">${table(["Expediente", "Período", "Estado", "Monto", ""], projectRows(list), `<span>${list.length} resultado${list.length === 1 ? "" : "s"} del sistema</span><span>Página 1 de 1</span>`)}</div>` : `<div class="card empty">${icon("search")}<h2>No encontramos coincidencias</h2><p>Prueba con una palabra más general o elimina un filtro para ampliar los resultados.</p>${act("Limpiar y volver a buscar", "clear-results", "secondary")}</div>`}`,
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
  const seleccionada =
    adminConvocatorias.find((c) => c.id_convocatoria === adminConvocatoriaId) ??
    adminConvocatorias[0] ??
    null;

  const filasConvocatorias = adminConvocatorias.length
    ? adminConvocatorias.map((c) => [
        `<strong>${esc(c.nombre)}</strong><br><span class="micro muted">${esc(c.descripcion || "Sin descripción")}</span>`,
        `${esc(String(c.fecha_inicio || ""))} → ${esc(String(c.fecha_cierre || ""))}`,
        `${c.etapas} etapas · ${c.documentos} documentos · ${c.propuestas} propuestas`,
        badge(c.activo ? "Vigente" : "Cerrada", c.activo ? "" : "warning"),
        `<div class="row-actions">${act("Administrar", "admin-call-select", "secondary compact", "arrow", `data-id="${c.id_convocatoria}"`)}${act("Editar", "admin-call-edit", "secondary compact", "edit", `data-id="${c.id_convocatoria}"`)}${act("Eliminar", "admin-call-delete", "text compact", "trash", `data-id="${c.id_convocatoria}"`)}</div>`,
      ])
    : [
        [
          `<span class="muted">No hay convocatorias registradas.</span>`,
          "",
          "",
          "",
          "",
        ],
      ];

  const filasEtapas = adminEtapas.length
    ? adminEtapas.map((e) => [
        `<strong>${esc(e.nombre_etapa)}</strong><br><span class="micro muted">${esc(e.responsable)}</span>`,
        `${esc(String(e.fecha_inicio || ""))} → ${esc(String(e.fecha_fin || ""))}`,
        String(e.orden),
        `<div class="row-actions">${act("Editar", "admin-stage-edit", "text compact", "edit", `data-id="${e.id_etapa}"`)}${act("Eliminar", "admin-stage-delete", "text compact", "trash", `data-id="${e.id_etapa}"`)}</div>`,
      ])
    : [[`<span class="muted">Esta convocatoria todavía no tiene etapas.</span>`, "", "", ""]];

  const filasDocumentos = adminDocumentos.length
    ? adminDocumentos.map((d) => [
        `<a href="${esc(d.file_url)}" target="_blank" rel="noopener"><strong>${esc(d.nombre_documento)}</strong></a><br><span class="micro muted">${esc(d.nombre_archivo)} · v${esc(d.version)}</span>`,
        esc(d.tipo_instrumento),
        String(d.orden),
        badge(d.activo ? "Publicado" : "Retirado", d.activo ? "" : "warning"),
        `<div class="row-actions">${act("Editar", "admin-doc-edit", "text compact", "edit", `data-id="${d.id_documento_conv}"`)}${act("Eliminar", "admin-doc-delete", "text compact", "trash", `data-id="${d.id_documento_conv}"`)}</div>`,
      ])
    : [[`<span class="muted">No hay instrumentos oficiales publicados.</span>`, "", "", "", ""]];

  const reglasModalidad = (adminCatalogosDatos?.modalidades ?? []).map((m) => [
    esc(m.nombre_modalidad),
    esc(m.duracion_maxima || "Sin definir"),
    money(Number(m.monto_financiamiento || 0)),
    badge(m.activo === false ? "Inactiva" : "Activa", m.activo === false ? "warning" : ""),
    `<div class="row-actions">${act("Editar", "admin-catalogo-edit", "text compact", "edit", `data-clave="modalidades" data-id="${m.id_modalidad}"`)}</div>`,
  ]);

  return shell(
    `<div class="card mb">${table(
      ["Convocatoria", "Periodo de postulación", "Configuración", "Estado", ""],
      filasConvocatorias,
    )}</div>${
      seleccionada
        ? `<div class="grid two">${card(
            `Cronograma · ${esc(seleccionada.nombre)}`,
            table(["Etapa", "Periodo", "Orden", ""], filasEtapas),
            act("Agregar etapa", "admin-stage-add", "secondary compact", "plus"),
          )}${card(
            "Instrumentos oficiales",
            table(["Instrumento", "Tipo", "Orden", "Estado", ""], filasDocumentos),
            act("Subir instrumento", "admin-doc-upload", "secondary compact", "upload"),
          )}</div><div class="card mt">${card(
            "Reglas por modalidad",
            reglasModalidad.length
              ? table(["Modalidad", "Duración máxima", "Tope", "Estado", ""], reglasModalidad)
              : `<p class="muted">No hay modalidades registradas.</p>`,
            act("Editar modalidades", "admin-catalogo-add", "secondary compact", "plus", 'data-clave="modalidades"'),
          )}</div>`
        : `<div class="card empty">${icon("calendar")}<h2>Sin convocatorias</h2><p>Registra la primera convocatoria para comenzar a configurar su cronograma e instrumentos.</p></div>`
    }`,
    "Administración de convocatorias",
    "Configura instrumentos, plazos y modalidades desde Dirección/VIE.",
    act("Nueva convocatoria", "admin-call-add", "secondary", "plus"),
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
  const pestanas = [
    "Rúbricas",
    "Escuelas",
    "Líneas de investigación",
    "Modalidades",
    "Tipos de hora",
    "Rubros",
    "Roles y permisos",
    "Criterios VIE",
  ];
  const selected = pestanas.includes(activeFilter) ? activeFilter : "Rúbricas";
  const rubrica = adminRubrica || {};

  // [Línea clave]: Cada pestaña muestra el catálogo real descargado del backend.
  const renderCatalogo = (clave, titulo, cabeceras, fila, campos) => {
    const registros = adminCatalogosDatos?.[clave] ?? [];
    const cuerpo = registros.length
      ? registros.map((registro) =>
          fila(registro, campos).concat([
            `<div class="row-actions">${act("Editar", "admin-catalogo-edit", "text compact", "edit", `data-clave="${clave}" data-id="${registro[campos.id]}"`)}${act("Eliminar", "admin-catalogo-delete", "text compact", "trash", `data-clave="${clave}" data-id="${registro[campos.id]}"`)}</div>`,
          ]),
        )
      : [[`<span class="muted">Sin registros en este catálogo.</span>`, ...cabeceras.slice(1).map(() => "")]];
    return `<div class="card">${table(cabeceras, cuerpo)}</div>`;
  };

  const rúbricaHtml = rubrica.secciones?.length
    ? `<div class="section-head"><span class="result-count">${rubrica.secciones.length} secciones · peso total ${rubrica.peso_total}% · versión activa ${esc(rubrica.version_activa || "2027")}</span><div class="row-actions">${act("Nueva sección", "admin-rubrica-section-add", "secondary compact", "plus")}${act("Nueva versión", "admin-rubrica-version-add", "secondary compact", "plus")}</div></div>${table(
        ["Sección", "Peso", "Criterios", "", ""],
        rubrica.secciones.map((s) => [
          `<strong>${esc(s.nombre_seccion)}</strong><br><span class="micro muted">${esc(s.version)}</span>`,
          `${s.peso_porcentual}%`,
          s.criterios.length
            ? s.criterios
                .map(
                  (c) =>
                    `<div><span class="micro">${esc(c.nombre_criterio)} · ${c.peso_relativo}%${c.es_obligatorio ? " · obligatorio" : ""}</span> ${act("Editar", "admin-rubrica-criterion-edit", "text compact", "edit", `data-id="${c.id_criterio_rubrica}"`)}${act("Eliminar", "admin-rubrica-criterion-delete", "text compact", "trash", `data-id="${c.id_criterio_rubrica}"`)}</div>`,
                )
                .join("")
            : `<span class="muted">Sin criterios</span>`,
          `<div class="row-actions">${act("Agregar criterio", "admin-rubrica-criterion-add", "text compact", "plus", `data-id="${s.id_seccion}"`)}${act("Editar", "admin-rubrica-section-edit", "text compact", "edit", `data-id="${s.id_seccion}"`)}${act("Eliminar", "admin-rubrica-section-delete", "text compact", "trash", `data-id="${s.id_seccion}"`)}</div>`,
          "",
        ]),
      )}`
    : `<div class="card empty">${icon("settings")}<h2>Sin rúbrica configurada</h2><p>Crea la primera sección de la rúbrica institucional para que el Comité Técnico pueda evaluar.</p></div>`;

  const versiones = (rubrica.versiones ?? [])
    .map(
      (v) =>
        `<div><span class="micro">${esc(v.version)} · ${esc(v.fecha_publicacion)} · ${v.activo ? "activa" : "inactiva"}</span> ${act("Editar", "admin-rubrica-version-edit", "text compact", "edit", `data-id="${v.id_version}"`)}${act("Eliminar", "admin-rubrica-version-delete", "text compact", "trash", `data-id="${v.id_version}"`)}</div>`,
    )
    .join("");

  const rolesOrden = (adminCatalogosDatos?.roles ?? [])
    .map(
      (r) => `<div class="role-order-row"><strong>${r.orden ?? r.id_rol}</strong><div><strong>${esc(r.nombre_rol)}</strong><div class="micro muted">Rol #${r.id_rol}</div></div><div class="role-order-actions"><button data-action="admin-role-up" data-id="${r.id_rol}" aria-label="Subir ${esc(r.nombre_rol)}">↑</button><button data-action="admin-role-down" data-id="${r.id_rol}" aria-label="Bajar ${esc(r.nombre_rol)}">↓</button>${act("Editar", "admin-catalogo-edit", "text compact", "edit", `data-clave="roles" data-id="${r.id_rol}"`)}${act("Eliminar", "admin-catalogo-delete", "text compact", "trash", `data-clave="roles" data-id="${r.id_rol}"`)}</div></div>`,
    )
    .join("");

  const cuerpoCatalogo =
    selected === "Rúbricas"
      ? `${rúbricaHtml}${versiones ? `<div class="card mt"><h2>Versiones publicadas</h2>${versiones}</div>` : ""}`
      : selected === "Escuelas"
        ? renderCatalogo(
            "escuelas",
            "Escuelas",
            ["Nombre", "Siglas", ""],
            (r) => [esc(r.nombre), esc(r.siglas || "—")],
            { id: "id_escuela" },
          )
        : selected === "Líneas de investigación"
          ? renderCatalogo(
              "lineas",
              "Líneas de investigación",
              ["Nombre", ""],
              (r) => [esc(r.nombre_linea)],
              { id: "id_linea_investigacion" },
            )
          : selected === "Modalidades"
            ? renderCatalogo(
                "modalidades",
                "Modalidades",
                ["Nombre", "Duración", "Tope", "Estado", ""],
                (r) => [
                  esc(r.nombre_modalidad),
                  esc(r.duracion_maxima || "—"),
                  money(Number(r.monto_financiamiento || 0)),
                  badge(r.activo === false ? "Inactiva" : "Activa", r.activo === false ? "warning" : ""),
                ],
                { id: "id_modalidad" },
              )
            : selected === "Tipos de hora"
              ? renderCatalogo(
                  "tipos_hora",
                  "Tipos de hora",
                  ["Nombre", ""],
                  (r) => [esc(r.nombre_tipo_hora)],
                  { id: "id_tipo_hora" },
                )
              : selected === "Rubros"
                ? renderCatalogo(
                    "rubros",
                    "Rubros presupuestarios",
                    ["Nombre", "Código", "Beca", "Duradero", ""],
                    (r) => [
                      esc(r.nombre_rubro),
                      esc(r.codigo || "—"),
                      r.es_beca ? "Sí" : "No",
                      r.es_bien_duradero ? "Sí" : "No",
                    ],
                    { id: "id_rubro" },
                  )
                : selected === "Roles y permisos"
                  ? `<div class="two-col"><section class="card"><div class="card-pad"><h2>Orden de roles</h2><p class="small muted">Este orden define la ruta operativa institucional y se guarda en el sistema.</p></div><div class="role-order">${rolesOrden || `<p class="muted">Sin roles registrados.</p>`}</div></section>${card("Criterio de orden", `<p class="small muted">La administración puede priorizar la ruta operativa: proponente, revisiones, aval, dictamen y resolución.</p>${notice("Cambio reversible", "Usa las flechas para ajustar el orden. Los permisos de cada rol no cambian.")}`)}</div>`
                  : renderCatalogo(
                      "criterios_vie",
                      "Criterios de verificación VIE",
                      ["Criterio", ""],
                      (r) => [esc(r.descripcion_criterio)],
                      { id: "id_criterio" },
                    );

  const clavePestana = {
    "Escuelas": "escuelas",
    "Líneas de investigación": "lineas",
    Modalidades: "modalidades",
    "Tipos de hora": "tipos_hora",
    Rubros: "rubros",
    "Criterios VIE": "criterios_vie",
    "Roles y permisos": "roles",
  }[selected];

  return shell(
    `${tabs(pestanas, selected, "data-filter")}${cuerpoCatalogo}<div class="mt">${notice("Conserva la versión de cada instrumento", "Una propuesta evaluada mantiene la rúbrica aplicada. Los cambios posteriores se registran para nuevas versiones de convocatoria.")}</div>`,
    "Rúbricas, catálogos y roles",
    "Parámetros de soporte administrados por la superadministración de Dirección/VIE.",
    clavePestana
      ? act("Agregar entrada", "admin-catalogo-add", "secondary", "plus", `data-clave="${clavePestana}"`)
      : "",
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
  const orcidActual = orcidUsuarioActivo();
  return shell(
    `<div class="card card-pad" style="max-width:760px"><div class="action-row mb"><span class="avatar" style="width:60px;height:60px;font-size:20px">${esc(p.initials)}</span><div><h2>${esc(p.name)}</h2><span class="small muted">${p.label}</span></div></div>${definition(
      [
        [
          "Correo",
          esc(session ? session.user.correo : "cuenta.demo@example.com"),
        ],
        [
          "ORCID institucional",
          orcidActual ? `<code>${esc(orcidActual)}</code>` : `<span class="muted">Pendiente de solicitar / vincular</span>`,
        ],
        ["Rol activo", p.label],
        ["Tema", state.theme === "dark" ? "Oscuro" : "Claro"],
      ],
    )}<div class="action-row mt">${act("Solicitar / actualizar ORCID", "profile-orcid-modal", "secondary", "edit")}${act("Ajustes y accesibilidad", "settings", "secondary", "settings")}${act("Contactar soporte", "contact", "text", "info")}</div></div><details class="accordion" style="max-width:760px;margin-top:28px"><summary>Opciones del prototipo</summary><div class="action-row mt">${act("Cambiar rol", "roles", "secondary", "user")}${act("Guía de recorridos", "guide", "text")}${act("Ver etapas", "stages", "text")}</div><p class="small muted mt">Los datos, documentos y decisiones son ejemplos para evaluar la interfaz.</p></details>`,
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
  if (["29", "30"].includes(id) && !["direccion", "cie", "vie", "administracion"].includes(state.role))
    return false;
  // [Línea clave]: La administración de convocatorias y catálogos es compartida por Dirección,
  // los Funcionarios VIE y la Administración del Sistema.
  if (["31", "32"].includes(id) && !["direccion", "vie", "administracion"].includes(state.role))
    return false;
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
    `<div class="modal-backdrop"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal="${name}"><header class="modal-head"><h2 id="modal-title">${title}</h2><button data-action="close" aria-label="Cerrar">${icon("close")}</button></header>${body}${actions ? `<div class="actions">${actions}</div>` : ""}</section></div>`;
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
  let sqliDetectado = false;
  $$("input, textarea, select", form).forEach((el) => {
    const val = typeof el.value === "string" ? el.value.trim() : "";
    const tieneSqli = el.type !== "checkbox" && contieneInyeccionSQL(val);
    if (tieneSqli) sqliDetectado = true;
    const reqOk =
      !el.hasAttribute("required") ||
      (el.type === "checkbox"
        ? el.checked
        : val !== "" && (el.type !== "email" || el.validity.valid));
    const ok = reqOk && !tieneSqli;
    const f = el.closest(".field");
    if (f) {
      f.classList.toggle("error", !ok);
      const errNode = $(".error-msg", f);
      if (errNode) {
        errNode.textContent = tieneSqli
          ? "Entrada bloqueada: se detectaron patrones de inyección SQL no permitidos."
          : "Completa este campo para continuar.";
        errNode.hidden = ok;
      }
    }
    if (!ok) valid = false;
  });
  if (!valid) {
    $(
      ".field.error input,.field.error textarea,.field.error select",
      form,
    )?.focus();
    toast(
      sqliDetectado
        ? "Se bloquearon patrones sospechosos de inyección SQL."
        : "Revisa los campos obligatorios indicados.",
    );
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
 * Helper unificado de estados de carga (loading UX).
 * Deshabilita el botón, muestra spinner + texto, ejecuta la promesa y restaura.
 * Previene double-click y da feedback visual inmediato.
 * parametros:
 *     - HTMLElement : botonEl Botón que disparó la acción (se deshabilita y muestra spinner).
 *     - Promise : accionAsync Función async que realiza el trabajo real.
 *     - Object : opts Opciones: { texto: "Procesando…", deshabilitar: true, restaurarHtml: true }.
 * return:
 *     + Promise<any> : resultado Lo que resuelva accionAsync.
 */
async function conCarga(botonEl, accionAsync, { texto = "Procesando…", deshabilitar = true, restaurarHtml = true } = {}) {
  if (!botonEl) return accionAsync();
  const htmlOriginal = botonEl.innerHTML;
  if (deshabilitar) botonEl.disabled = true;
  botonEl.innerHTML = `<span class="spinner"></span>${texto}`;
  try {
    return await accionAsync();
  } finally {
    if (restaurarHtml) botonEl.innerHTML = htmlOriginal;
    if (deshabilitar) botonEl.disabled = false;
  }
}

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

  await conCarga(b, async () => {
    // [Línea clave]: ¿Por qué soy importante? Petición de login contra el backend FastAPI. ¿Para qué? Verificar credenciales en la base de datos Supabase Postgres. ¿Dónde me usan? En el flujo de login en doLogin().
    const user = await apiLogin(correo, password);
    const key =
      user && Array.isArray(user.roles) && user.roles.length
        ? ROLE_KEYS[user.roles[0]]
        : null;
    if (!key) throw new AuthError("noroles");
    setSession({ user });
    applyRole(key);
    save();
    go(homeFor());
    // [Línea clave]: La precarga de catálogos y métricas corre en segundo plano para no retener el login.
    obtenerDatosBackend()
      .then(() => {
        if (!session) return;
        render();
        loadScreenData();
      })
      .catch((e) => console.warn("SGPI: precarga en segundo plano:", e));
  }, { texto: "Ingresando…" }).catch((err) => {
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
  });
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
  try {
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
        `<span class="badge">Sin archivo adjunto</span><h3 style="margin-top:22px">${esc(el.dataset.doc || "Documento del expediente")}</h3>${codigoActivo ? `<p>Expediente ${esc(codigoActivo)}.</p>` : ""}<div class="notice mt">${icon("file")}<div><strong>Archivo no disponible</strong><p>Este documento no tiene un archivo real asociado en el sistema. Adjúntalo desde el expediente para habilitar el visor.</p></div></div>`,
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
    case "profile-orcid-modal": {
      state.saved["modal:profile-orcid"] = orcidUsuarioActivo();
      setTimeout(() => {
        const orcidInput = $('[data-field="modal:profile-orcid"]');
        if (!orcidInput) return;
        orcidInput.addEventListener("input", () => {
          orcidInput.value = formatearOrcidInput(orcidInput.value);
          state.saved["modal:profile-orcid"] = orcidInput.value;
        });
      }, 60);
      modal(
        "Vincular ORCID al perfil del investigador",
        `${notice("Validación oficial ISO 7064 (MOD 11-2)", "El ORCID es solicitado al investigador y validado matemáticamente con su dígito verificador. Cada ORCID es único en el sistema.")}${field("Identificador ORCID", orcidUsuarioActivo(), "text", "Formato obligatorio: 0000-0000-0000-000X.", true, "modal:profile-orcid", "0000-0002-1825-0097")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Validar y vincular ORCID", "profile-orcid-save"),
        false,
        "profile-orcid",
      );
      break;
    }
    case "profile-orcid-save": {
      const nuevoOrcid = ($('[data-field="modal:profile-orcid"]')?.value || "").trim().toUpperCase();
      if (contieneInyeccionSQL(nuevoOrcid)) {
        toast("Entrada bloqueada: se detectaron patrones no permitidos.");
        break;
      }
      if (!esOrcidValido(nuevoOrcid)) {
        toast("ORCID inválido: verifica el formato 0000-0000-0000-000X y su dígito verificador ISO 7064.");
        break;
      }
      const correoActual = session?.user?.correo || "";
      const nombreActual = session?.user?.nombre || "";
      const ocupados = obtenerOrcidsOcupados(correoActual, nombreActual);
      if (ocupados.has(nuevoOrcid)) {
        toast(`El ORCID ${nuevoOrcid} ya está asignado a otro perfil de investigador.`);
        break;
      }
      if (session?.user?.id_usuario) {
        try {
          await fetch(`${API_URL}/auth/usuarios/${session.user.id_usuario}/orcid`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orcid: nuevoOrcid, correo: correoActual }),
          });
        } catch (err) {
          console.warn("profile-orcid-save sync warning:", err);
        }
      }
      registrarOrcidEnPerfil(correoActual, nombreActual, nuevoOrcid);
      if (session?.user) {
        session.user.orcid = nuevoOrcid;
        setSession(session);
      }
      if (Array.isArray(state.teamMembers)) {
        state.teamMembers = state.teamMembers.map((m) =>
          String(m.correo || "").toLowerCase() === String(correoActual).toLowerCase()
            ? { ...m, orcid: nuevoOrcid }
            : m,
        );
      }
      save();
      closeModal();
      render();
      toast("ORCID validado y vinculado a tu perfil de investigador.");
      break;
    }
    case "team": {
      delete state.saved["modal:user-search"];
      delete state.saved["modal:orcid"];
      delete state.saved["modal:hours"];
      delete state.saved["modal:responsibility"];
      state.selectedTeamUser = null;
      const rolesOpts = (catalogos?.rol_colaborador?.length
        ? catalogos.rol_colaborador
        : [
            { nombre_rol: "Investigador/a asociado/a" },
            { nombre_rol: "Coordinador/a" },
            { nombre_rol: "Estudiante asistente" },
            { nombre_rol: "Especialista técnico" },
          ]
      ).map((r) => ({ value: r.nombre_rol, label: r.nombre_rol }));
      const tiposHoraOpts = (catalogos?.tipos_hora?.length
        ? catalogos.tipos_hora.map((t) => ({ value: t.nombre_tipo_hora, label: t.nombre_tipo_hora }))
        : ["VIE", "CONS", "REC", "DOC", "OTRO"].map((t) => ({ value: t, label: t })));

      // Cargar resultados de búsqueda al abrir el modal y autocompletar el ORCID validado del perfil del investigador
      setTimeout(() => {
        const input = $('[data-field="modal:user-search"]');
        const orcidInput = $('[data-field="modal:orcid"]');
        const results = $('#user-search-results');
        if (!input || !results) return;
        if (orcidInput) {
          orcidInput.addEventListener("input", () => {
            orcidInput.value = formatearOrcidInput(orcidInput.value);
            state.saved["modal:orcid"] = orcidInput.value;
          });
        }
        const aplicarUsuarioSeleccionado = (u) => {
          // [Línea clave]: ¿Por qué soy importante? Autocompleta el ORCID desde el perfil del investigador seleccionado. ¿Para qué? Mantener la relación 1 a 1 entre investigador y su ORCID validado o solicitarlo si aún no lo tiene registrado. ¿Dónde me usan? Al elegir un investigador en el modal de equipo.
          const orcidRegistrado = u.orcid || obtenerOrcidDePerfil(u.correo, u.nombre);
          state.selectedTeamUser = {
            id_usuario: Number(u.id_usuario),
            nombre: u.nombre,
            correo: u.correo,
            orcid: orcidRegistrado,
            escuela: u.escuela || "",
            siglas_escuela: u.siglas_escuela || "",
          };
          input.value = state.selectedTeamUser.nombre;
          state.saved["modal:user-search"] = state.selectedTeamUser.nombre;
          if (orcidInput) {
            orcidInput.value = orcidRegistrado;
            orcidInput.readOnly = Boolean(orcidRegistrado);
            state.saved["modal:orcid"] = orcidRegistrado;
            const counter = orcidInput.closest(".field")?.querySelector(".char-counter");
            if (counter) counter.textContent = formatearTextoContador(orcidRegistrado.length, 19, "ORCID", "modal:orcid");
          }
          results.innerHTML = "";
        };
        // Guardar últimos resultados de búsqueda para autocomplete en blur
        let lastSearchResults = [];
        const buscar = async (texto) => {
          const textoLimpio = (texto || "").trim();
          if (!textoLimpio || textoLimpio.length < 2 || contieneInyeccionSQL(textoLimpio)) {
            results.innerHTML = "";
            lastSearchResults = [];
            return;
          }
          try {
            const resp = await fetch(`${API_URL}/auth/usuarios?q=${encodeURIComponent(textoLimpio)}&limit=10`);
            if (!resp.ok) return;
            const usuarios = await resp.json();
            if (usuarios.length === 0) {
              results.innerHTML = `<div class="user-result" style="padding:12px;text-align:center;color:var(--muted);"><span class="micro">Usuario no encontrado en el directorio institucional</span></div>`;
              lastSearchResults = [];
              return;
            }
            // Guardar resultados para uso en blur/enter
            lastSearchResults = usuarios;
            // Siempre mostrar lista - el usuario elige con click, Enter, o blur
            results.innerHTML = usuarios.map((u) => {
              const orc = u.orcid || obtenerOrcidDePerfil(u.correo, u.nombre);
              const isExactMatch = u.is_exact_match === true;
              return `<div class="user-result${isExactMatch ? ' exact-match' : ''}" style="padding:8px;border-bottom:1px solid var(--line);cursor:pointer;" data-id="${u.id_usuario}" data-nombre="${esc(u.nombre)}" data-correo="${esc(u.correo)}" data-orcid="${esc(orc)}" data-escuela="${esc(u.escuela || '')}" data-siglas="${esc(u.siglas_escuela || '')}">
                <strong>${esc(u.nombre)}${isExactMatch ? ' <span class="badge" style="font-size:10px;">coincidencia exacta</span>' : ''}</strong> ${orc ? `<code class="micro">${esc(orc)}</code>` : `<span class="micro muted">(solicitar ORCID)</span>`}<br><span class="micro muted">${esc(u.correo)}${u.escuela ? ` · ${esc(u.escuela)}` : ""}</span>
              </div>`;
            }).join("");
            results.querySelectorAll(".user-result").forEach((elItem) => {
              elItem.addEventListener("click", () => {
                aplicarUsuarioSeleccionado({
                  id_usuario: Number(elItem.dataset.id),
                  nombre: elItem.dataset.nombre,
                  correo: elItem.dataset.correo,
                  orcid: elItem.dataset.orcid,
                  escuela: elItem.dataset.escuela,
                  siglas_escuela: elItem.dataset.siglas,
                });
              });
            });
          } catch (e) {
            console.error(e);
            lastSearchResults = [];
          }
        };
        let timer;
        input.addEventListener("input", (e) => {
          const val = e.target.value;
          if (!val) {
            results.innerHTML = "";
            if (orcidInput) {
              orcidInput.value = "";
              orcidInput.readOnly = false;
              state.saved["modal:orcid"] = "";
            }
            state.selectedTeamUser = null;
          }
          clearTimeout(timer);
          timer = setTimeout(() => buscar(val), 250);
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (lastSearchResults.length > 0) {
              aplicarUsuarioSeleccionado(lastSearchResults[0]);
            }
          }
        });
        input.addEventListener("blur", () => {
          // Autocompletar al hacer click fuera (blur) - selecciona el primer resultado
          // Delay para permitir click en resultado antes de cerrar
          setTimeout(() => {
            if (lastSearchResults.length === 0) return;
            // Preferir coincidencia exacta si existe, sino el primero
            const exactMatch = lastSearchResults.find(u =>
              normalizarTexto(u.nombre) === normalizarTexto(input.value.trim()) ||
              normalizarTexto(u.correo) === normalizarTexto(input.value.trim())
            );
            if (exactMatch) {
              aplicarUsuarioSeleccionado(exactMatch);
            } else {
              aplicarUsuarioSeleccionado(lastSearchResults[0]);
            }
          }, 200);
        });
        input.addEventListener("focus", () => buscar(input.value));
        document.addEventListener("mousedown", (e) => {
          if (!results.contains(e.target) && e.target !== input) results.innerHTML = "";
        });
      }, 100);
      modal(
        "Participante del equipo",
        `${field("Buscar usuario", "", "search", "Busca por nombre o correo institucional (si tiene ORCID en su perfil se autocompleta; si no, solicítalo)...", true, "modal:user-search")}<div id="user-search-results" class="mt" style="max-height:200px;overflow-y:auto;"></div><div class="field-row">${field("Rol", rolesOpts, "select", "", false, "modal:role", "")}${field("Tipo de hora", tiposHoraOpts, "select", "", false, "modal:hour-type", "", "VIE")}</div><div class="field-row">${field("Dedicación", "4", "number", "Horas por semana (1–40).", true, "modal:hours")}${field("ORCID", "", "text", "Se autocompleta con el perfil o se solicita y valida bajo ISO 7064 (0000-0000-0000-000X).", true, "modal:orcid", "0000-0001-5109-3700")}</div>${field("Responsabilidad", "", "textarea", "Funciones técnicas en la propuesta.", false, "modal:responsibility")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar participante", "team-save"),
        false,
        "team",
      );
      break;
    }
    case "team-save": {
      const selectedUser = state.selectedTeamUser;
      if (!selectedUser) {
        toast("Selecciona un investigador de la lista de búsqueda.");
        break;
      }
      const rol = $('[data-field="modal:role"]')?.value || "Investigador/a asociado/a";
      const tipo = $('[data-field="modal:hour-type"]')?.value || "VIE";
      const horas = Math.min(40, Math.max(1, Number($('[data-field="modal:hours"]')?.value) || 4));
      const orcid = ($('[data-field="modal:orcid"]')?.value || selectedUser.orcid || obtenerOrcidDePerfil(selectedUser.correo, selectedUser.nombre)).trim().toUpperCase();
      const responsabilidad = $('[data-field="modal:responsibility"]')?.value || "";

      if (contieneInyeccionSQL(responsabilidad) || contieneInyeccionSQL(orcid)) {
        toast("Se detectó contenido inválido o no permitido.");
        break;
      }
      if (!orcid) {
        toast("Solicita e ingresa el ORCID del investigador para vincularlo a su perfil.");
        break;
      }
      if (!esOrcidValido(orcid)) {
        toast("El ORCID ingresado no es válido según el estándar oficial ISO 7064 (formato 0000-0000-0000-000X).");
        break;
      }

      // Agregar al equipo validando unicidad de usuario y de ORCID
      state.teamMembers = proposalTeamMembers();
      const yaExiste = state.teamMembers.some(
        (m) => m.id_usuario === selectedUser.id_usuario || String(m.correo).toLowerCase() === String(selectedUser.correo).toLowerCase(),
      );
      if (yaExiste) {
        toast("Este investigador ya forma parte del equipo.");
        break;
      }
      const ocupados = obtenerOrcidsOcupados(selectedUser.correo, selectedUser.nombre);
      if (ocupados.has(orcid)) {
        toast(`El ORCID ${orcid} ya está asignado a otra persona. Cada ORCID debe ser único.`);
        break;
      }
      registrarOrcidEnPerfil(selectedUser.correo, selectedUser.nombre, orcid);
      state.teamMembers.push({
        id_usuario: selectedUser.id_usuario,
        nombre: selectedUser.nombre,
        correo: selectedUser.correo,
        escuela: selectedUser.escuela,
        siglas_escuela: selectedUser.siglas_escuela,
        rol,
        horas,
        orcid,
        responsabilidad,
        tipo,
      });
      state.selectedTeamUser = null;
      save();
      closeModal();
      render();
      toast("Miembro agregado al equipo con su ORCID validado.");
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
    case "activity": {
      const miembrosOpts = proposalTeamMembers().map((m) => ({
        value: `${m.nombre} · Ejecuta`,
        label: `${m.nombre} (${m.rol || "Equipo"})`,
      }));
      const periodosOpts = [
        "1 / 3",
        "1 / 6",
        "4 / 6",
        "6 / 1",
        "7 / 6",
        "12 / 1",
        "13 / 6",
        "18 / 1",
        "19 / 6",
        "24 / 1",
      ];
      modal(
        "Agregar actividad",
        `${field("Objetivo específico", ["OE1", "OE2", "OE3", ...(state.extraObjective ? ["OE4"] : [])], "select", "", true, "modal:objective-code")}${field("Actividad", "Entregar informe semestral de avance", "text", "", true, "modal:activity")}${field("Resultado esperado", "Informe semestral registrado", "text", "", true, "modal:result")}<div class="field-row">${field("Responsable", miembrosOpts.length ? miembrosOpts : [nombreResponsableActual()], "select", "Integrante del equipo responsable.", true, "modal:owner")}${field("Mes inicial / duración", periodosOpts, "select", "Mes de inicio / duración en meses.", true, "modal:period", "", "6 / 1")}</div>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar actividad", "save-extra", 'data-kind="activity"'),
        false,
        "activity",
      );
      break;
    }
    case "risk": {
      const miembrosRiesgoOpts = proposalTeamMembers().map((m) => ({
        value: m.nombre,
        label: `${m.nombre} (${m.rol || "Equipo"})`,
      }));
      const nivelesRiesgoOpts = (catalogos?.niveles_riesgo?.length
        ? catalogos.niveles_riesgo.map((n) => ({ value: n.nombre_nivel, label: n.nombre_nivel }))
        : ["Bajo", "Medio", "Alto"].map((n) => ({ value: n, label: n })));
      modal(
        "Agregar riesgo",
        `${field("Actividad", ["Definir requerimientos", "Integrar y calibrar", "Validar en campo", "Evaluar y documentar"], "select", "", true, "modal:riskactivity")}${field("Riesgo", "Indisponibilidad temporal de un sitio piloto.", "textarea", "", true, "modal:risk")}<div class="field-row">${field("Probabilidad", nivelesRiesgoOpts, "select", "", true, "modal:riskprob", "", "Medio")}${field("Impacto", nivelesRiesgoOpts, "select", "", true, "modal:riskimpact", "", "Medio")}</div>${field("Mitigación", "Acordar un sitio alternativo antes del inicio de la validación.", "textarea", "", true, "modal:mitigation")}${field("Responsable", miembrosRiesgoOpts.length ? miembrosRiesgoOpts : [nombreResponsableActual()], "select", "Persona encargada del monitoreo.", true, "modal:riskowner")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar riesgo", "save-extra", 'data-kind="risk"'),
        false,
        "risk",
      );
      break;
    }
    case "save-extra": {
      const kind = el.dataset.kind;
      const controlesModal = $$(".modal input, .modal textarea");
      if (controlesModal.some((c) => contieneInyeccionSQL(c.value))) {
        toast("Entrada rechazada: se detectaron patrones de inyección SQL.");
        break;
      }
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
    case "team-remove": {
      const i = Number(el.dataset.index);
      if (Number.isInteger(i) && i >= 0 && i < (state.teamMembers || []).length) {
        const miembro = state.teamMembers[i];
        // No permitir quitar al creador (usuario logueado)
        if (session && miembro.correo === session.user.correo) {
          toast("No se puede quitar al creador de la propuesta.");
          break;
        }
        state.teamMembers.splice(i, 1);
        save();
        render();
        toast("Miembro quitado del equipo.");
      }
      break;
    }
    case "team-edit": {
      const i = Number(el.dataset.index);
      const listaEquipo = proposalTeamMembers();
      if (!Number.isInteger(i) || i < 0 || i >= listaEquipo.length) break;
      const miembro = listaEquipo[i];
      delete state.saved["modal:edit-role"];
      delete state.saved["modal:edit-hours"];
      delete state.saved["modal:edit-tipo"];
      const rolesEditOpts = (catalogos?.rol_colaborador?.length
        ? catalogos.rol_colaborador
        : [
            { nombre_rol: "Coordinador/a" },
            { nombre_rol: "Investigador/a asociado/a" },
            { nombre_rol: "Estudiante asistente" },
            { nombre_rol: "Especialista técnico" },
          ]
      ).map((r) => ({ value: r.nombre_rol, label: r.nombre_rol }));
      const tiposHoraEditOpts = (catalogos?.tipos_hora?.length
        ? catalogos.tipos_hora.map((t) => ({ value: t.nombre_tipo_hora, label: t.nombre_tipo_hora }))
        : ["VIE", "CONS", "REC", "DOC", "OTRO"].map((t) => ({ value: t, label: t })));
      modal(
        "Editar miembro del equipo",
        `${field("Rol", rolesEditOpts, "select", "", false, "modal:edit-role", "", miembro.rol)}${field("Dedicación (h/sem)", miembro.horas || 4, "number", "Horas por semana (1–40).", true, "modal:edit-hours")}${field("Tipo de hora", tiposHoraEditOpts, "select", "", false, "modal:edit-tipo", "", miembro.tipo)}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar cambios", "team-edit-save", `data-index="${i}"`),
        false,
        "team-edit",
      );
      break;
    }
    case "team-edit-save": {
      const i = Number(el.dataset.index);
      state.teamMembers = proposalTeamMembers();
      if (!Number.isInteger(i) || i < 0 || i >= state.teamMembers.length) break;
      const rol = $('[data-field="modal:edit-role"]')?.value;
      const horas = Math.min(40, Math.max(1, Number($('[data-field="modal:edit-hours"]')?.value) || 4));
      const tipo = $('[data-field="modal:edit-tipo"]')?.value || "VIE";
      state.teamMembers[i] = { ...state.teamMembers[i], rol, horas, tipo };
      save();
      closeModal();
      render();
      toast("Miembro actualizado.");
      break;
    }
    case "external-add": {
      delete state.saved["modal:ext-name"];
      delete state.saved["modal:ext-institution"];
      delete state.saved["modal:ext-hours"];
      delete state.saved["modal:ext-orcid"];
      delete state.saved["modal:ext-responsibility"];
      const extRolesOpts = (catalogos?.rol_colaborador?.length
        ? catalogos.rol_colaborador
        : [
            { nombre_rol: "Colaborador externo" },
            { nombre_rol: "Co-investigador/a externo/a" },
            { nombre_rol: "Asesor/a internacional" },
            { nombre_rol: "Contraparte comunitaria / institucional" },
          ]
      ).map((r) => ({ value: r.nombre_rol, label: r.nombre_rol }));
      setTimeout(() => {
        const nameInput = $('[data-field="modal:ext-name"]');
        const orcidInput = $('[data-field="modal:ext-orcid"]');
        if (!nameInput || !orcidInput) return;
        let orcidEditadoManualmente = false;
        orcidInput.addEventListener("input", () => {
          orcidEditadoManualmente = true;
          orcidInput.value = formatearOrcidInput(orcidInput.value);
          state.saved["modal:ext-orcid"] = orcidInput.value;
        });
        nameInput.addEventListener("input", () => {
          if (orcidEditadoManualmente && orcidInput.value.trim()) return;
          // [Línea clave]: ¿Por qué soy importante? Autocompleta el ORCID únicamente si el colaborador ya tiene uno validado en su perfil. ¿Para qué? Solicitar un ORCID real cuando la persona es nueva en lugar de generarlo sintéticamente. ¿Dónde me usan? En el listener de nombre del modal external-add.
          const registradoEnPerfil = obtenerOrcidDePerfil("", nameInput.value);
          orcidInput.value = registradoEnPerfil;
          state.saved["modal:ext-orcid"] = registradoEnPerfil;
          const counter = orcidInput.closest(".field")?.querySelector(".char-counter");
          if (counter) counter.textContent = formatearTextoContador(registradoEnPerfil.length, 19, "ORCID", "modal:ext-orcid");
        });
      }, 80);
      modal(
        "Agregar colaborador externo",
        `${field("Nombre completo", "", "text", "Si la persona ya tiene perfil con ORCID registrado se autocompleta; de lo contrario solicítalo.", true, "modal:ext-name")}${field("Institución / entidad", "", "text", "", true, "modal:ext-institution")}<div class="field-row">${field("Rol", extRolesOpts, "select", "", false, "modal:ext-role")}${field("Dedicación (h/sem)", "4", "number", "Horas por semana (1–40).", false, "modal:ext-hours")}</div>${field("ORCID", "", "text", "Solicita e ingresa el ORCID del colaborador (validado bajo ISO 7064: 0000-0000-0000-000X).", true, "modal:ext-orcid", "0000-0002-1825-0097")}${field("Responsabilidad / tareas", "", "textarea", "Describe sus tareas en el proyecto.", false, "modal:ext-responsibility")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Guardar colaborador", "external-add-save"),
        false,
        "external-add",
      );
      break;
    }
    case "external-add-save": {
      const nombre = $('[data-field="modal:ext-name"]')?.value?.trim() || "";
      const institucion = $('[data-field="modal:ext-institution"]')?.value?.trim() || "";
      const rol = $('[data-field="modal:ext-role"]')?.value || "Colaborador externo";
      const horas = Math.min(40, Math.max(1, Number($('[data-field="modal:ext-hours"]')?.value) || 4));
      const orcid = ($('[data-field="modal:ext-orcid"]')?.value?.trim() || obtenerOrcidDePerfil("", nombre)).toUpperCase();
      const responsabilidad = $('[data-field="modal:ext-responsibility"]')?.value?.trim() || "";

      if (!nombre || !institucion) {
        toast("Completa el nombre y la institución del colaborador externo.");
        break;
      }
      if ([nombre, institucion, orcid, responsabilidad].some(contieneInyeccionSQL)) {
        toast("Entrada bloqueada: se detectaron patrones de inyección SQL.");
        break;
      }
      if (!orcid) {
        toast("Debes solicitar e ingresar el ORCID del colaborador externo.");
        break;
      }
      if (!esOrcidValido(orcid)) {
        toast("El ORCID ingresado no es válido según el estándar oficial ISO 7064 (formato 0000-0000-0000-000X).");
        break;
      }
      const ocupados = obtenerOrcidsOcupados("", nombre);
      if (ocupados.has(orcid)) {
        toast(`El ORCID ${orcid} ya está registrado en otro participante. Cada ORCID debe ser único.`);
        break;
      }
      state.externalCollaborators = state.externalCollaborators || [];
      if (state.externalCollaborators.some((c) => normalizarTexto(c.nombre) === normalizarTexto(nombre))) {
        toast("Esta persona colaboradora externa ya fue agregada.");
        break;
      }
      registrarOrcidEnPerfil("", nombre, orcid);
      state.externalCollaborators.push({
        nombre,
        institucion,
        rol,
        horas,
        orcid,
        responsabilidad,
      });
      save();
      closeModal();
      render();
      toast("Colaborador externo agregado con su ORCID validado.");
      break;
    }
    case "external-remove": {
      const i = Number(el.dataset.index);
      if (Number.isInteger(i) && i >= 0 && i < (state.externalCollaborators || []).length) {
        state.externalCollaborators.splice(i, 1);
        save();
        render();
        toast("Colaborador externo quitado.");
      }
      break;
    }
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
      await conCarga(el, async () => {
        await subirDocumentoPropuesta(propuestaReal, archivo, tipo);
        closeModal();
        await cargarDossier(propuestaReal, true);
        render();
        toast(`Documento adjunto a ${dossierActual?.codigo || "la propuesta"}.`);
      }, { texto: "Subiendo archivo…" }).catch((err) => {
        toast(err.message || "No se pudo adjuntar el documento.");
      });
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
      await conCarga(el, async () => {
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
        go("19");
        // [Línea clave]: Refresca métricas y catálogos sin retrasar la confirmación del envío.
        obtenerDatosBackend().catch((e) => console.warn("SGPI: precarga tras envío:", e));
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
      }, { texto: "Registrando propuesta…" }).catch((err) => {
        console.error("send-confirm error:", err);
        modal(
          "No se pudo registrar la propuesta",
          notice("Se conservó tu borrador en este navegador", esc(err.message || "Error desconocido al registrar."), "warning"),
          act("Cerrar", "close", "secondary"),
        );
      });
      break;
    }
    case "refresh-ai-eval":
      toast("Consultando a Google Gemini (Free Tier)...");
      await generarEvaluacionPreliminarIA();
      render();
      toast("Evaluación preliminar IA actualizada en el sistema.");
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
        await obtenerEvaluacionPreliminarIA(propuestaActivaId());
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
      if (!evaluacionPreliminarIA) await obtenerEvaluacionPreliminarIA(propuestaActivaId());
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
    case "submit-confirm": {
      const idPropuesta = propuestaActivaId();
      try {
        const resultado = await apiCambiarEstado(
          idPropuesta,
          "Sometida ante VIE",
          "Sometimiento formal de la propuesta ante la VIE.",
        );
        state.stage = resultado.nombre_estado;
        state.viewProposalId = idPropuesta;
        save();
        closeModal();
        await cargarDossier(idPropuesta, true);
        render();
        toast(`Propuesta sometida. Nuevo estado: ${resultado.nombre_estado}.`);
      } catch (err) {
        toast(err.message || "No se pudo someter la propuesta.");
      }
      break;
    }
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
    case "acceptance-confirm": {
      const idPropuesta = propuestaActivaId();
      await conCarga(el, async () => {
        const fileInput = $("#acceptance-doc");
        let idDocumento = null;
        if (fileInput?.files?.length) {
          const subido = await subirDocumentoPropuesta(
            idPropuesta,
            fileInput.files[0],
            "Carta de aceptación",
          );
          idDocumento = subido.id_documento;
        }
        const resultado = await apiTramite(idPropuesta, "aceptacion", {
          observaciones: "Carta de aceptación presentada por el investigador.",
          id_documento: idDocumento,
        });
        state.stage = resultado.nombre_estado;
        state.viewProposalId = idPropuesta;
        save();
        closeModal();
        await cargarDossier(idPropuesta, true);
        render();
        toast(resultado.mensaje || "Carta de aceptación registrada.");
      }, { texto: "Registrando aceptación…" }).catch((err) => {
        toast(err.message || "No se pudo registrar la carta de aceptación.");
      });
      break;
    }
    case "attend":
      modal(
        "Atender observaciones",
        `${notice("Corrección del expediente", "Describe el ajuste realizado. Al reenviar, el expediente regresa a la etapa institucional que lo devolvió.")}<div class="field"><label for="attend-doc">Evidencia de la corrección (PDF, DOCX)</label><input id="attend-doc" type="file" accept=".pdf,.docx"><span class="help">Opcional. Se adjunta al expediente.</span></div>${field("Detalle de la corrección", "", "textarea", "Ejemplo: se amplía la justificación del riesgo de campo y se adjunta el protocolo firmado.", true, "modal:attend")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Reenviar expediente", "attend-confirm"),
        false,
        "attend",
      );
      break;
    case "attend-confirm": {
      const idPropuesta = propuestaActivaId();
      await conCarga(el, async () => {
        const fileInput = $("#attend-doc");
        let idDocumento = null;
        if (fileInput?.files?.length) {
          const subido = await subirDocumentoPropuesta(
            idPropuesta,
            fileInput.files[0],
            "Respuesta a observaciones",
          );
          idDocumento = subido.id_documento;
        }
        const resultado = await apiTramite(idPropuesta, "observaciones/reenvio", {
          observaciones: state.saved["modal:attend"] || "Corrección incorporada.",
          id_documento: idDocumento,
        });
        state.stage = resultado.nombre_estado;
        state.viewProposalId = idPropuesta;
        save();
        closeModal();
        await cargarDossier(idPropuesta, true);
        render();
        toast(resultado.mensaje || "Expediente reenviado.");
      }, { texto: "Reenviando expediente…" }).catch((err) => {
        toast(err.message || "No se pudo reenviar el expediente.");
      });
      break;
    }
    case "report":
      modal(
        "Informe de seguimiento",
        `${field("Tipo", ["Informe semestral", "Informe anual", "Informe final"], "select", "", true, "modal:reporttype")}<div class="field"><label for="report-doc">Informe de resultados (PDF, DOCX)</label><input id="report-doc" type="file" accept=".pdf,.docx"><span class="help">Opcional. Se adjunta al expediente.</span></div>${field("Detalle del informe", "", "textarea", "Ejemplo: se ejecutaron las actividades del primer semestre y se cumplieron los productos previstos.", true, "modal:reportdetail")}<p>El cierre del proyecto requiere el informe final y la certificación de Dirección de Investigación.</p>`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Registrar informe", "report-save"),
      );
      break;
    case "report-save": {
      // [Línea clave]: El informe se registra en el backend: queda en la bitácora de
      // evaluaciones del expediente y notifica a Dirección de Investigación.
      const idPropuesta = propuestaActivaId();
      await conCarga(el, async () => {
        const tipo = valorCampo("modal:reporttype", "Informe de seguimiento");
        const detalle = valorCampo("modal:reportdetail", "");
        const fileInput = $("#report-doc");
        let idDocumento = null;
        if (fileInput?.files?.length) {
          const subido = await subirDocumentoPropuesta(idPropuesta, fileInput.files[0], tipo);
          idDocumento = subido.id_documento;
        }
        const resultado = await apiTramite(idPropuesta, "informe", {
          observaciones: detalle || tipo,
          id_documento: idDocumento,
        });
        state.viewProposalId = idPropuesta;
        save();
        closeModal();
        await cargarDossier(idPropuesta, true);
        render();
        toast(resultado.mensaje || "Informe registrado en el expediente.");
      }, { texto: "Registrando informe…" }).catch((err) => {
        toast(err.message || "No se pudo registrar el informe.");
      });
      break;
    }
    case "close-project": {
      // [Línea clave]: El cierre administrativo lo dictamina Dirección de Investigación:
      // el backend exige el informe final y deja el expediente en estado terminal «Cerrada».
      if (el?.dataset?.proposalId)
        state.viewProposalId = Number(el.dataset.proposalId) || state.viewProposalId;
      modal(
        "Cerrar proyecto",
        `${notice("Cierre administrativo", "El cierre es terminal: el expediente queda en «Cerrada» y se conserva para consulta.")}<div class="field"><label for="close-doc">Informe final (PDF, DOCX)</label><input id="close-doc" type="file" accept=".pdf,.docx"><span class="help">Obligatorio. Es el soporte documental del cierre.</span></div>${field("Fundamento del cierre", "", "textarea", "Ejemplo: se cumplen los productos comprometidos y se entrega el informe final.", true, "modal:close")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn("Cerrar expediente", "close-confirm"),
        false,
        "close-project",
      );
      break;
    }
    case "close-confirm": {
      const idPropuesta = propuestaActivaId();
      await conCarga(el, async () => {
        const fileInput = $("#close-doc");
        if (!fileInput?.files?.length)
          throw new Error("Adjunta el informe final para cerrar el expediente.");
        const subido = await subirDocumentoPropuesta(
          idPropuesta,
          fileInput.files[0],
          "Informe final del proyecto",
        );
        const resultado = await apiTramite(idPropuesta, "cierre", {
          observaciones: valorCampo("modal:close", "Cierre administrativo del proyecto."),
          id_documento: subido.id_documento,
        });
        state.stage = resultado.nombre_estado;
        state.viewProposalId = idPropuesta;
        save();
        closeModal();
        const recargas = [cargarDossier(idPropuesta, true)];
        if (state.role === "direccion") recargas.push(cargarBandejaDireccion());
        await Promise.all(recargas);
        render();
        toast(resultado.mensaje || "Expediente cerrado.");
      }, { texto: "Cerrando expediente…" }).catch((err) => {
        toast(err.message || "No se pudo cerrar el expediente.");
      });
      break;
    }
    case "return":
      modal(
        "Devolver con observaciones",
        `${field("Observaciones para el investigador", "Completar la justificación del riesgo de campo y vincular la medida con el responsable.", "textarea", "Explica el ajuste requerido y la evidencia esperada.", true, "modal:return")}${notice("La devolución permite corregir", "Se conserva la versión revisada y las observaciones. No equivale a una resolución negativa definitiva.")}`,
        act("Cancelar", "close", "secondary") +
          confirmBtn(
            "Registrar devolución",
            "return-confirm",
            ["23", "24", "25"].includes(current) ? `data-step="${current}"` : "",
          ),
        false,
        "return",
      );
      break;
    case "return-confirm": {
      if (el.dataset.step === "26" || current === "26") {
        toast("La devolución se gestiona desde el flujo institucional; usa el formulario de dictamen o coordínalo con el investigador.");
        closeModal();
        break;
      }
      if (el.dataset.step === "27" || current === "27") {
        // [Línea clave]: El CIE no devuelve expedientes: su decisión es un acuerdo colegiado
        // que se registra como «Con observaciones» cuando el tipo de resolución lo indica.
        toast("El CIE registra su decisión como acuerdo colegiado: elige «Aprobado condicionado a enmiendas menores» para dejar observaciones.");
        closeModal();
        break;
      }
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
          await Promise.all([cargarBandejaVinculacion(), cargarDossier(idPropuesta, true), cargarVinculacion(idPropuesta)]);
          go("21");
          toast("Devolución registrada. El investigador podrá atender las observaciones.");
        } catch (err) {
          toast(err.message || "No se pudo registrar la devolución.");
        }
        break;
      }
      if (el.dataset.step === "24" || current === "24") {
        const idPropuesta = propuestaActivaId();
        try {
          const resultado = await guardarEvaluacionComite(
            idPropuesta,
            payloadEvaluacionComite("observaciones", state.saved["modal:return"] || ""),
          );
          state.stage = resultado.nombre_estado;
          state.viewProposalId = idPropuesta;
          save();
          closeModal();
          await Promise.all([
            cargarBandejaComite(),
            cargarDossier(idPropuesta, true),
            cargarEvaluacionComite(idPropuesta),
          ]);
          go("21");
          toast(
            `Devolución registrada (${Number(resultado.puntaje).toFixed(1)}/100). El investigador podrá atender las observaciones.`,
          );
        } catch (err) {
          toast(err.message || "No se pudo registrar la devolución del Comité Técnico.");
        }
        break;
      }
      if (el.dataset.step === "25" || current === "25") {
        const idPropuesta = propuestaActivaId();
        try {
          const resultado = await guardarAvalConsejo(
            idPropuesta,
            payloadAvalConsejo("observaciones", state.saved["modal:return"] || ""),
          );
          state.stage = resultado.nombre_estado;
          state.viewProposalId = idPropuesta;
          save();
          closeModal();
          await Promise.all([
            cargarBandejaConsejo(),
            cargarDossier(idPropuesta, true),
            cargarAvalConsejo(idPropuesta),
          ]);
          go("21");
          toast(
            "Devolución registrada. El investigador podrá atender las observaciones del Consejo de Escuela.",
          );
        } catch (err) {
          toast(err.message || "No se pudo registrar la devolución del Consejo de Escuela.");
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
    case "conditions": {
      // [Línea clave]: Las condiciones posteriores se acumulan al acuerdo vigente del CIE sin
      // cambiar el estado de la propuesta, pero quedan trazadas como evaluación adicional.
      const idPropuesta = propuestaActivaId();
      const condiciones = String(state.saved["cie:condiciones_posteriores"] || "").trim();
      if (!condiciones) {
        toast("Escribe el texto de las condiciones antes de registrarlas.");
        break;
      }
      try {
        const resultado = await guardarCondicionesCie(idPropuesta, {
          id_usuario_eval: session?.user?.id_usuario,
          condiciones,
          observaciones: "",
        });
        state.viewProposalId = idPropuesta;
        save();
        await Promise.all([
          cargarDossier(idPropuesta, true),
          cargarResolucionCie(idPropuesta),
        ]);
        toast(resultado.mensaje || "Condiciones de aceptación registradas.");
      } catch (err) {
        toast(err.message || "No se pudieron registrar las condiciones del CIE.");
      }
      break;
    }
    case "decision":
      // [Línea clave]: ¿Por qué soy importante? Registro de dictamen de evaluadores colegiados. ¿Para qué? Avanzar el expediente en el flujo institucional guardando la evidencia. ¿Dónde me usan? En handleAction bajo la acción 'decision'.
      if (!validate("#evaluation-form")) break;
      {
        const id = el.dataset.step,
          sc = scoreResult(),
          negative = id === "24" && !sc.recommended;
        // [Línea clave]: La decisión se elige de forma explícita en el modal. «Rechazada» es
        // terminal en todas las etapas y «Con observaciones» devuelve el expediente al
        // investigador para que lo corrija y lo reenvíe a la etapa que lo devolvió.
        const admiteDecision = ["23", "24", "25"].includes(id);
        const decisionPorDefecto =
          id === "24" ? (sc.recommended ? "favorable" : "observaciones") : "favorable";
        const opcionesDecision = [
          { value: "favorable", label: "Favorable" },
          { value: "observaciones", label: "Con observaciones" },
          { value: "rechazo", label: "Rechazada" },
        ];
        const selectorDecision = admiteDecision
          ? `<div class="field"><label for="decision-opcion-${id}">Decisión <span class="required-star">*</span></label><select id="decision-opcion-${id}" data-field="decision:${id}:opcion">${opcionesDecision
              .map(
                (opcion) =>
                  `<option value="${opcion.value}" ${opcion.value === decisionPorDefecto ? "selected" : ""}>${opcion.label}</option>`,
              )
              .join("")}</select><span class="help">«Rechazada» es terminal: el expediente no admite nuevas revisiones.</span></div><div class="field"><label for="decision-observaciones-${id}">Observaciones</label><textarea id="decision-observaciones-${id}" data-field="decision:${id}:observaciones" rows="3">${esc(state.saved[`decision:${id}:observaciones`] || "")}</textarea><span class="help">Obligatorio en devoluciones y rechazos: explica al investigador el motivo de la decisión.</span></div>`
          : "";
        modal(
          "Confirmar decisión",
          `<p>${negative ? "La evaluación no recomienda la propuesta por la nota o los requisitos obligatorios." : "Se conservarán los datos y el documento asociados a esta revisión."}</p>${selectorDecision}${
            id === "27"
              ? notice(
                  "Resolución seleccionada",
                  (() => {
                    const elc = document.querySelector('[data-field="cie:id_resolucion"]');
                    const valor = elc ? String(elc.value || "") : String(state.saved["cie:id_resolucion"] || "");
                    const opcion = (resolucionCie?.tipos_resolucion || []).find(
                      (t) => String(t.id_resolucion) === valor,
                    );
                    return opcion ? opcion.nombre_resolucion : "Acuerdo del catálogo institucional";
                  })(),
                )
              : ""
          }${
            id === "23"
              ? notice("Registro en el sistema", "El dictamen cambiará el estado de la propuesta según la decisión seleccionada y notificará a quien debe continuar el trámite.")
              : id === "24"
                ? notice(
                    "Registro en el sistema",
                    `${gruposRubrica().reduce((total, [, cs]) => total + cs.length, 0)} puntajes, la justificación y el resultado ponderado se guardarán en el expediente. El estado seguirá la decisión seleccionada.`,
                  )
                : id === "25"
                  ? notice(
                      "Registro en el sistema",
                      "El acuerdo de aval quedará registrado con la escuela, la sesión y el oficio correspondiente. La propuesta pasará a «Avalada» cuando todas las escuelas involucradas hayan emitido su aval.",
                    )
                  : id === "27"
                    ? notice(
                        "Registro en el sistema",
                        "El acuerdo del CIE quedará registrado con la sesión, el artículo, la fecha, la fundamentación y las condiciones. La propuesta pasará a «Aprobada por CIE», «Con observaciones» o «Rechazada» según el tipo de acuerdo.",
                      )
                    : "<p>Esta acción es una simulación y no emite un acuerdo institucional real.</p>"
          }`,
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
        await conCarga(el, async () => {
          // [Línea clave]: La decisión se toma en el modal de confirmación y no se deduce de
          // la nota: «Rechazada» es terminal y «Con observaciones» devuelve el expediente.
          const decision = valorCampo(`decision:${id}:opcion`, "favorable");
          const observaciones = valorCampo(`decision:${id}:observaciones`, "");
          if (decision !== "favorable" && !observaciones)
            throw new Error("Registra las observaciones de la devolución o del rechazo.");
          const fileInput = $("#vinculacion-doc");
          let idDocumento = null;
          if (fileInput?.files?.length) {
            const subido = await subirDocumentoPropuesta(idPropuesta, fileInput.files[0], "Dictamen de Vinculación");
            idDocumento = subido.id_documento;
          }
          const resultado = await guardarVinculacion(
            idPropuesta,
            payloadVinculacion(decision, observaciones, idDocumento),
          );
          state.stage = resultado.nombre_estado;
          state.viewProposalId = idPropuesta;
          save();
          closeModal();
          await Promise.all([cargarBandejaVinculacion(), cargarDossier(idPropuesta, true), cargarVinculacion(idPropuesta)]);
          modal(
            "Decisión registrada",
            notice(
              "Registro guardado y sincronizado",
              `Nuevo estado: ${resultado.nombre_estado}.${
                resultado.decision === "favorable"
                  ? " Se notificó al Comité Técnico."
                  : " Se notificó al investigador con las observaciones."
              } Se conservó la trazabilidad.`,
            ),
            btn("Volver a la bandeja", "21", "secondary") +
              btn("Ver expediente", "22", "", "arrow"),
            false,
            "decision-saved",
          );
        }, { texto: "Registrando dictamen…" }).catch((err) => {
          toast(err.message || "No se pudo registrar el dictamen de Vinculación.");
        });
        break;
      }
      if (id === "24") {
        const idPropuesta = propuestaActivaId();
        const sc = scoreResult();
        const decision = valorCampo(
          `decision:${id}:opcion`,
          sc.recommended ? "favorable" : "observaciones",
        );
        const observaciones =
          decision === "favorable"
            ? ""
            : valorCampo(`decision:${id}:observaciones`, "") ||
              `Evaluación técnica no recomendada: ${sc.sum.toFixed(1)}/100${sc.blocked ? " con criterio obligatorio con nivel insuficiente" : ""}.`;
        try {
          const resultado = await guardarEvaluacionComite(
            idPropuesta,
            payloadEvaluacionComite(decision, observaciones),
          );
          state.stage = resultado.nombre_estado;
          state.viewProposalId = idPropuesta;
          save();
          closeModal();
          await Promise.all([
            cargarBandejaComite(),
            cargarDossier(idPropuesta, true),
            cargarEvaluacionComite(idPropuesta),
          ]);
          modal(
            "Decisión registrada",
            notice(
              "Registro guardado y sincronizado",
              `Puntaje: ${Number(resultado.puntaje).toFixed(1)}/100. Nuevo estado: ${resultado.nombre_estado}.${
                resultado.decision === "favorable"
                  ? " Se notificó al Consejo de Escuela."
                  : " Se notificó al investigador con las observaciones."
              }`,
            ),
            btn("Volver a la bandeja", "21", "secondary") +
              btn("Ver expediente", "22", "", "arrow"),
            false,
            "decision-saved",
          );
        } catch (err) {
          toast(err.message || "No se pudo registrar la evaluación del Comité Técnico.");
        }
        break;
      }
      if (id === "25") {
        const idPropuesta = propuestaActivaId();
        try {
          const decision = valorCampo(`decision:${id}:opcion`, "favorable");
          const observaciones = valorCampo(`decision:${id}:observaciones`, "");
          if (decision !== "favorable" && !observaciones)
            throw new Error("Registra las observaciones de la devolución o del rechazo.");
          const fileInput = $("#consejo-doc");
          let idDocumento = null;
          if (fileInput?.files?.length) {
            const subido = await subirDocumentoPropuesta(
              idPropuesta,
              fileInput.files[0],
              "Acuerdo de aval del Consejo de Escuela",
            );
            idDocumento = subido.id_documento;
          }
          const resultado = await guardarAvalConsejo(
            idPropuesta,
            payloadAvalConsejo(decision, observaciones, idDocumento),
          );
          state.stage = resultado.nombre_estado;
          state.viewProposalId = idPropuesta;
          save();
          closeModal();
          await Promise.all([
            cargarBandejaConsejo(),
            cargarDossier(idPropuesta, true),
            cargarAvalConsejo(idPropuesta),
          ]);
          modal(
            // [Línea clave]: El encabezado distingue el aval de una devolución o de un
            // rechazo, que no son avales parciales sino resoluciones del Consejo.
            decision === "favorable"
              ? resultado.aval_completo
                ? "Aval registrado"
                : "Aval parcial registrado"
              : decision === "observaciones"
                ? "Devolución registrada"
                : "Rechazo registrado",
            notice(
              "Registro guardado y sincronizado",
              decision === "favorable"
                ? resultado.aval_completo
                  ? `Nuevo estado: ${resultado.nombre_estado}. ${resultado.mensaje}`
                  : resultado.mensaje
                : `Nuevo estado: ${resultado.nombre_estado}. ${resultado.mensaje}`,
            ),
            btn("Volver a la bandeja", "21", "secondary") +
              btn("Ver expediente", "22", "", "arrow"),
            false,
            "decision-saved",
          );
        } catch (err) {
          toast(err.message || "No se pudo registrar el aval del Consejo de Escuela.");
        }
        break;
      }
      if (id === "26") {
        const idPropuesta = propuestaActivaId();
        try {
          const getVal = (k) => {
            const elc = document.querySelector(`[data-field="${k}"]`);
            if (elc) return elc.type === "checkbox" ? elc.checked : String(elc.value || "").trim();
            return state.saved[k];
          };
          const verificacion_criterios = [];
          document.querySelectorAll("[data-direccion-criterio]").forEach((cb) => {
            const idC = Number(cb.getAttribute("data-direccion-criterio"));
            verificacion_criterios.push({ id_criterio: idC, cumple: !!cb.checked });
          });
          const payload = {
            id_usuario_eval: session?.user?.id_usuario,
            dictamen: getVal("direccion:dictamen") || "Favorable",
            fundamentacion: getVal("direccion:fundamentacion") || "",
            verificacion_responsabilidades: document.querySelector('[data-direccion-check="resp"]')?.checked ?? (state.saved["direccion:resp"] !== false),
            verificacion_riesgos: document.querySelector('[data-direccion-check="riesgos"]')?.checked ?? (state.saved["direccion:riesgos"] !== false),
            verificacion_beca: document.querySelector('[data-direccion-check="beca"]')?.checked ?? (state.saved["direccion:beca"] !== false),
            verificacion_declaraciones: document.querySelector('[data-direccion-check="decl"]')?.checked ?? (state.saved["direccion:decl"] !== false),
            verificacion_documentos: document.querySelector('[data-direccion-check="docs"]')?.checked ?? (state.saved["direccion:docs"] !== false),
            verificacion_criterios,
            observaciones: "",
          };
          if (!payload.fundamentacion) throw new Error("Debes registrar la fundamentación del dictamen.");
          const resultado = await guardarDictamenDireccion(idPropuesta, payload);
          state.stage = resultado.nombre_estado;
          state.viewProposalId = idPropuesta;
          save();
          closeModal();
          await Promise.all([
            cargarBandejaDireccion(),
            cargarDossier(idPropuesta, true),
            cargarDictamenDireccion(idPropuesta),
          ]);
          modal(
            "Dictamen registrado",
            notice(
              "Registro guardado y sincronizado",
              `Dictamen: ${resultado.dictamen}. Nuevo estado: ${resultado.nombre_estado}.`,
            ),
            btn("Volver a la bandeja", "21", "secondary") +
              btn("Ver expediente", "22", "", "arrow"),
            false,
            "decision-saved",
          );
        } catch (err) {
          toast(err.message || "No se pudo registrar el dictamen de Dirección.");
        }
        break;
      }
      if (id === "27") {
        // [Línea clave]: El acuerdo del CIE se guarda en el sistema con la evaluación, la
        // tabla «cie_resolution_evaluations» y el documento firmado; el backend ejecuta la
        // transición de estado y notifica al investigador.
        const idPropuesta = propuestaActivaId();
        try {
          const getVal = (k) => {
            const elc = document.querySelector(`[data-field="${k}"]`);
            if (elc) return elc.type === "checkbox" ? elc.checked : String(elc.value || "").trim();
            return state.saved[k] ?? "";
          };
          const payload = {
            id_usuario_eval: session?.user?.id_usuario,
            id_resolucion: Number(getVal("cie:id_resolucion")) || 1,
            numero_sesion: getVal("cie:numero_sesion") || "",
            articulo: getVal("cie:articulo") || "",
            fecha_resolucion: getVal("cie:fecha_resolucion") || "",
            fundamentacion: getVal("cie:fundamentacion") || "",
            condiciones: getVal("cie:condiciones") || "",
            observaciones: getVal("cie:observaciones") || "",
            id_documento: null,
          };
          if (!payload.numero_sesion || !payload.articulo) {
            throw new Error("Debes registrar la sesión y el artículo del acuerdo.");
          }
          if (!payload.fundamentacion) {
            throw new Error("Debes registrar la fundamentación de la resolución.");
          }
          const fileInput = $("#cie-doc");
          if (fileInput?.files?.length) {
            const subido = await subirDocumentoPropuesta(
              idPropuesta,
              fileInput.files[0],
              "Acuerdo del CIE",
            );
            payload.id_documento = subido.id_documento;
          }
          const resultado = await guardarResolucionCie(idPropuesta, payload);
          state.stage = resultado.nombre_estado;
          state.viewProposalId = idPropuesta;
          save();
          closeModal();
          await Promise.all([
            cargarBandejaCie(),
            cargarDashboardCie(),
            cargarDossier(idPropuesta, true),
            cargarResolucionCie(idPropuesta),
          ]);
          modal(
            "Resolución registrada",
            notice(
              "Registro guardado y sincronizado",
              `Acuerdo: ${resultado.resolucion}. Nuevo estado: ${resultado.nombre_estado}. Se notificó al investigador y el acuerdo quedó en el historial del expediente.`,
            ),
            btn("Volver a la bandeja", "21", "secondary") +
              btn("Ver expediente", "22", "", "arrow"),
            false,
            "decision-saved",
          );
        } catch (err) {
          toast(err.message || "No se pudo registrar la resolución del CIE.");
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
              : "Aprobada por CIE",
      }[id];
      save();


      modal(
        "Decisión registrada",
        notice(
          "Registro guardado y sincronizado",
          id === "25"
            ? "El investigador debe realizar el sometimiento formal. No se envió automáticamente a Dirección."
            : `Nuevo estado registrado con trazabilidad completa: ${state.stage}.`,
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
    case "rubric-summary": {
      // [Línea clave]: Si el expediente ya tiene puntajes por criterio, la rúbrica se muestra
      // con los niveles realmente dictaminados y su ponderación; si no, con los pesos oficiales.
      const puntajes = dossierActual?.comite_evaluacion || [];
      const comite = (dossierActual?.evaluaciones || []).find(
        (e) => e.rol_evaluador === "Comité Técnico",
      );
      const cuerpo = puntajes.length
        ? `${table(
            ["Sección", "Criterio", "Peso", "Nivel"],
            puntajes.map((p) => [
              esc(p.nombre_seccion),
              `${esc(p.nombre_criterio)}${p.es_obligatorio ? ' <span class="micro">· Obligatorio</span>' : ""}`,
              Number(p.peso_relativo) + "%",
              `<strong>${Number(p.puntaje)}</strong> · ${
                { 0: "Deficiente", 6: "Regular", 8: "Bueno", 10: "Excelente" }[Number(p.puntaje)] || "—"
              }`,
            ]),
          )}<div class="mt">${notice(
            "Resultado ponderado",
            `${Number(comite?.puntaje_comite || 0).toFixed(1)}/100 · ${
              { favorable: "Recomendada", observaciones: "Devuelta con observaciones", rechazo: "No recomendada" }[comite?.decision] || "Registrada"
            }${comite?.tiene_bloqueo_obligatorio ? " · Bloqueo por criterio obligatorio insuficiente" : ""}.`,
          )}</div>`
        : `${table(
            ["Sección", "Peso"],
            gruposRubrica().map(([g, cs]) => [
              esc(g),
              cs.reduce((a, c) => a + c[1], 0) + "%",
            ]),
          )}<div class="mt">${notice("Regla de recomendación", "Nota ≥70, obligatorios con Bueno/Excelente y productos conformes. Niveles: 0, 6, 8, 10.")}</div>`;
      modal(
        "Rúbrica · Desarrollo tecnológico",
        cuerpo,
        act("Cerrar", "close"),
        true,
        "rubric",
      );
      break;
    }
    // =================================================================
    // ADMINISTRACIÓN INSTITUCIONAL (PANTALLAS 31 Y 32)
    // =================================================================
    case "admin-call-add":
      modalConvocatoria(null);
      break;
    case "admin-call-edit": {
      const convocatoria = adminConvocatorias.find(
        (c) => c.id_convocatoria === Number(el.dataset.id),
      );
      if (convocatoria) modalConvocatoria(convocatoria);
      break;
    }
    case "admin-call-select":
      adminConvocatoriaId = Number(el.dataset.id);
      await Promise.all([cargarEtapasAdmin(), cargarDocumentosAdmin()]);
      render();
      break;
    case "admin-call-delete": {
      const convocatoria = adminConvocatorias.find(
        (c) => c.id_convocatoria === Number(el.dataset.id),
      );
      modal(
        "Eliminar convocatoria",
        `<p>Se eliminará «${esc(convocatoria?.nombre || "la convocatoria")}», su cronograma y la publicación de sus instrumentos. Si ya tiene propuestas registradas el sistema la rechazará.</p>`,
        `${act("Cancelar", "close", "text")}${act("Eliminar", "admin-call-delete-confirm", "secondary", "trash", `data-id="${el.dataset.id}"`)}`,
        false,
        "admin-confirmar",
      );
      break;
    }
    case "admin-call-delete-confirm":
      try {
        await peticionAdmin(`/convocatorias/${el.dataset.id}`, "DELETE");
        closeModal();
        await cargarConvocatoriasAdmin();
        await refrescarCatalogosFront();
        render();
        toast("Convocatoria eliminada.");
      } catch (err) {
        toast(err.message);
      }
      break;
    case "admin-call-save": {
      const valores = adminValues();
      const cuerpo = {
        nombre: valores.nombre,
        descripcion: valores.descripcion || null,
        fecha_inicio: valores.fecha_inicio,
        fecha_cierre: valores.fecha_cierre,
        fecha_inicio_ejecucion: valores.fecha_inicio_ejecucion,
        activo: valores.activo,
      };
      try {
        if (el.dataset.id) {
          await peticionAdmin(`/convocatorias/${el.dataset.id}`, "PATCH", cuerpo);
        } else {
          const nueva = await peticionAdmin("/convocatorias", "POST", cuerpo);
          adminConvocatoriaId = nueva.id_convocatoria;
        }
        closeModal();
        await cargarConvocatoriasAdmin();
        await refrescarCatalogosFront();
        render();
        toast(el.dataset.id ? "Convocatoria actualizada." : "Convocatoria creada.");
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "admin-stage-add":
      modalEtapa(null);
      break;
    case "admin-stage-edit": {
      const etapa = adminEtapas.find((e) => e.id_etapa === Number(el.dataset.id));
      if (etapa) modalEtapa(etapa);
      break;
    }
    case "admin-stage-delete":
      try {
        await peticionAdmin(`/etapas/${el.dataset.id}`, "DELETE");
        await cargarEtapasAdmin();
        render();
        toast("Etapa eliminada.");
      } catch (err) {
        toast(err.message);
      }
      break;
    case "admin-stage-save": {
      const valores = adminValues();
      const cuerpo = {
        nombre_etapa: valores.nombre_etapa,
        responsable: valores.responsable,
        fecha_inicio: valores.fecha_inicio,
        fecha_fin: valores.fecha_fin,
        orden: Number(valores.orden || 1),
      };
      try {
        if (el.dataset.id) {
          await peticionAdmin(`/etapas/${el.dataset.id}`, "PATCH", cuerpo);
        } else {
          await peticionAdmin(
            `/convocatorias/${adminConvocatoriaId}/etapas`,
            "POST",
            cuerpo,
          );
        }
        closeModal();
        await cargarEtapasAdmin();
        render();
        toast(el.dataset.id ? "Etapa actualizada." : "Etapa agregada.");
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "admin-doc-upload":
      modalDocumento();
      break;
    case "admin-doc-edit": {
      const documento = adminDocumentos.find(
        (d) => d.id_documento_conv === Number(el.dataset.id),
      );
      if (documento) modalDocumentoEdicion(documento);
      break;
    }
    case "admin-doc-delete":
      try {
        await peticionAdmin(`/documentos/${el.dataset.id}`, "DELETE");
        await cargarDocumentosAdmin();
        render();
        toast("Instrumento eliminado.");
      } catch (err) {
        toast(err.message);
      }
      break;
    case "admin-doc-save": {
      const valores = adminValues();
      const archivo = document.querySelector("#adm-archivo")?.files?.[0];
      if (!archivo) {
        toast("Selecciona el archivo del instrumento.");
        break;
      }
      // [Línea clave]: El backend exige el actor en el cuerpo multipart. Si la sesión guardada en
      // el navegador está vencida y no trae identificador, se avisa en vez de enviar un 422 sin pistas.
      const idUsuario = idUsuarioAdmin();
      if (!idUsuario) {
        toast("Tu sesión expiró. Cierra sesión e ingresa de nuevo para publicar instrumentos.");
        break;
      }
      const formulario = new FormData();
      formulario.append("nombre_documento", valores.nombre_documento || archivo.name);
      formulario.append("tipo_instrumento", valores.tipo_instrumento || "otro");
      formulario.append("orden", String(valores.orden || 1));
      formulario.append("version", valores.version || "1.0");
      formulario.append("id_usuario", String(idUsuario));
      formulario.append("archivo", archivo);
      try {
        const res = await fetch(`${API_URL}/admin/convocatorias/${adminConvocatoriaId}/documentos`, {
          method: "POST",
          body: formulario,
        });
        if (!res.ok) throw new Error(await errorDesdeRespuesta(res));
        closeModal();
        await cargarDocumentosAdmin();
        render();
        toast("Instrumento publicado.");
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "admin-doc-save-edit": {
      const valores = adminValues();
      try {
        await peticionAdmin(`/documentos/${el.dataset.id}`, "PATCH", {
          nombre_documento: valores.nombre_documento,
          tipo_instrumento: valores.tipo_instrumento,
          orden: Number(valores.orden || 1),
          version: valores.version || "1.0",
          activo: valores.activo,
        });
        closeModal();
        await cargarDocumentosAdmin();
        render();
        toast("Instrumento actualizado.");
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "admin-catalogo-add":
      modalCatalogo(el.dataset.clave);
      break;
    case "admin-catalogo-edit": {
      const clave = el.dataset.clave;
      const registros = adminCatalogosDatos?.[clave] ?? [];
      const definicion = CAMPOS_CATALOGO_ADMIN[clave];
      const registro = registros.find((r) => r[definicion?.idField] === Number(el.dataset.id));
      if (registro) modalCatalogo(clave, registro);
      break;
    }
    case "admin-catalogo-delete": {
      const clave = el.dataset.clave;
      const definicion = CAMPOS_CATALOGO_ADMIN[clave];
      const registros = adminCatalogosDatos?.[clave] ?? [];
      const registro = registros.find((r) => r[definicion?.idField] === Number(el.dataset.id));
      modal(
        "Eliminar registro",
        `<p>Se eliminará «${esc(registro ? Object.values(registro).find((v) => typeof v === "string") : "el registro")}». Si el sistema detecta que está en uso, la eliminación se rechazará.</p>`,
        `${act("Cancelar", "close", "text")}${act("Eliminar", "admin-catalogo-delete-confirm", "secondary", "trash", `data-clave="${clave}" data-id="${el.dataset.id}"`)}`,
        false,
        "admin-confirmar",
      );
      break;
    }
    case "admin-catalogo-delete-confirm":
      try {
        await peticionAdmin(
          `/catalogos/${el.dataset.clave}/${el.dataset.id}`,
          "DELETE",
        );
        closeModal();
        await cargarCatalogosAdmin();
        await refrescarCatalogosFront();
        render();
        toast("Registro eliminado.");
      } catch (err) {
        toast(err.message);
      }
      break;
    case "admin-catalogo-save": {
      const clave = el.dataset.clave;
      const valores = adminValues();
      const cuerpo = {};
      CAMPOS_CATALOGO_ADMIN[clave]?.campos.forEach((campo) => {
        const valor = valores[campo.name];
        if (campo.kind === "checkbox") cuerpo[campo.name] = !!valor;
        else if (campo.kind === "number")
          cuerpo[campo.name] = valor === "" ? null : Number(valor);
        else cuerpo[campo.name] = valor || null;
      });
      try {
        if (el.dataset.id) {
          await peticionAdmin(`/catalogos/${clave}/${el.dataset.id}`, "PATCH", cuerpo);
        } else {
          await peticionAdmin(`/catalogos/${clave}`, "POST", cuerpo);
        }
        closeModal();
        await cargarCatalogosAdmin();
        await refrescarCatalogosFront();
        render();
        toast(el.dataset.id ? "Registro actualizado." : "Registro agregado.");
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "admin-role-up":
    case "admin-role-down": {
      const direccion = action === "admin-role-up" ? "arriba" : "abajo";
      try {
        await peticionAdmin(`/catalogos/roles/${el.dataset.id}/mover`, "PATCH", {
          direccion,
        });
        await cargarCatalogosAdmin();
        await refrescarCatalogosFront();
        render();
        toast("Orden de roles actualizado.");
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "admin-rubrica-section-add":
      modalSeccionRubrica(null);
      break;
    case "admin-rubrica-section-edit": {
      const seccion = (adminRubrica?.secciones ?? []).find(
        (s) => s.id_seccion === Number(el.dataset.id),
      );
      if (seccion) modalSeccionRubrica(seccion);
      break;
    }
    case "admin-rubrica-section-delete":
      try {
        await peticionAdmin(`/rubrica/secciones/${el.dataset.id}`, "DELETE");
        await cargarRubricaAdmin();
        render();
        toast("Sección eliminada.");
      } catch (err) {
        toast(err.message);
      }
      break;
    case "admin-rubrica-section-save": {
      const valores = adminValues();
      const cuerpo = {
        nombre_seccion: valores.nombre_seccion,
        peso_porcentual: Number(valores.peso_porcentual || 0),
        orden: Number(valores.orden || 1),
      };
      try {
        if (el.dataset.id) {
          await peticionAdmin(`/rubrica/secciones/${el.dataset.id}`, "PATCH", cuerpo);
        } else {
          await peticionAdmin("/rubrica/secciones", "POST", {
            ...cuerpo,
            version: adminRubrica?.version_activa || "2027",
          });
        }
        closeModal();
        await cargarRubricaAdmin();
        render();
        toast(el.dataset.id ? "Sección actualizada." : "Sección creada.");
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "admin-rubrica-criterion-add":
      modalCriterioRubrica(null, Number(el.dataset.id));
      break;
    case "admin-rubrica-criterion-edit": {
      const criterio = (adminRubrica?.secciones ?? [])
        .flatMap((s) => s.criterios)
        .find((c) => c.id_criterio_rubrica === Number(el.dataset.id));
      if (criterio) modalCriterioRubrica(criterio);
      break;
    }
    case "admin-rubrica-criterion-delete":
      try {
        await peticionAdmin(`/rubrica/criterios/${el.dataset.id}`, "DELETE");
        await cargarRubricaAdmin();
        render();
        toast("Criterio eliminado.");
      } catch (err) {
        toast(err.message);
      }
      break;
    case "admin-rubrica-criterion-save": {
      const valores = adminValues();
      const cuerpo = {
        nombre_criterio: valores.nombre_criterio,
        peso_relativo: Number(valores.peso_relativo || 0),
        es_obligatorio: !!valores.es_obligatorio,
        orden: Number(valores.orden || 1),
      };
      try {
        if (el.dataset.id) {
          await peticionAdmin(`/rubrica/criterios/${el.dataset.id}`, "PATCH", {
            ...cuerpo,
            id_seccion: Number(valores.id_seccion),
          });
        } else {
          await peticionAdmin("/rubrica/criterios", "POST", {
            ...cuerpo,
            id_seccion: Number(valores.id_seccion),
            version: adminRubrica?.version_activa || "2027",
          });
        }
        closeModal();
        await cargarRubricaAdmin();
        render();
        toast(el.dataset.id ? "Criterio actualizado." : "Criterio agregado.");
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "admin-rubrica-version-add":
      modalVersionRubrica(null);
      break;
    case "admin-rubrica-version-edit": {
      const version = (adminRubrica?.versiones ?? []).find(
        (v) => v.id_version === Number(el.dataset.id),
      );
      if (version) modalVersionRubrica(version);
      break;
    }
    case "admin-rubrica-version-delete":
      try {
        await peticionAdmin(`/rubrica/versiones/${el.dataset.id}`, "DELETE");
        await cargarRubricaAdmin();
        render();
        toast("Versión eliminada.");
      } catch (err) {
        toast(err.message);
      }
      break;
    case "admin-rubrica-version-save": {
      const valores = adminValues();
      try {
        if (el.dataset.id) {
          await peticionAdmin(`/rubrica/versiones/${el.dataset.id}`, "PATCH", {
            descripcion: valores.descripcion || null,
            fecha_publicacion: valores.fecha_publicacion || null,
            activo: !!valores.activo,
          });
        } else {
          await peticionAdmin("/rubrica/versiones", "POST", {
            version: valores.version,
            descripcion: valores.descripcion || null,
            fecha_publicacion: valores.fecha_publicacion || null,
            clonar_desde: valores.clonar_desde || null,
          });
        }
        closeModal();
        await cargarRubricaAdmin();
        render();
        toast(el.dataset.id ? "Versión actualizada." : "Versión publicada.");
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "stages":
      modal(
        "Escenarios de seguimiento",
        '<p>Elige una etapa para demostrar su estado y acciones; no modifica un expediente real.</p><div class="role-grid mt">' +
          stageList
            .map((s) =>
              act(s, "set-stage", "secondary compact", "", `data-stage="${s}"`),
            )
            .join("") +
          "</div>",
        "",
        true,
        "stages",
      );
      break;    case "set-stage":
      state.stage = el.dataset.stage;
      state.role = "investigador";
      save();
      go("20");
      break;
    case "guide":
      modal(
        "Guía de recorridos",
        `<p>Explora las 33 pantallas y los escenarios complementarios.</p><div class="stack mt"><div>${btn("1. Formular una propuesta", "04", "secondary")}</div><div>${act("2. Evaluar por roles", "roles", "secondary")}</div><div>${act("3. Consulta histórica", "history-scenario", "secondary")}</div><div>${act("4. Sometimiento después del aval", "set-stage", "secondary", "", 'data-stage="Avalada"')}</div><div>${act("5. Aceptación después del CIE", "set-stage", "secondary", "", 'data-stage="Aprobada por CIE"')}</div><div>${act("Reiniciar datos de demostración", "reset", "text")}</div></div><p class="micro muted">Los archivos y decisiones son simulados. Usa el selector de rol para cambiar de contexto institucional.</p>`,
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
} catch (err) {
    console.error("handleAction error:", err);
    toast("Error: " + err.message);
    closeModal();
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
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.maxLength && el.maxLength > 0) {
    const counter = el.closest(".field")?.querySelector(".char-counter");
    if (counter) {
      const fieldKey = el.dataset.field || el.dataset.adminField || "";
      const fieldLabel = el.closest(".field")?.querySelector("label")?.textContent || "";
      counter.textContent = formatearTextoContador(String(el.value || "").length, el.maxLength, fieldLabel, fieldKey);
    }
  }
  if (el.dataset.field || el.dataset.adminField) {
    const sqli = el.type !== "checkbox" && contieneInyeccionSQL(el.value);
    const fieldWrap = el.closest(".field");
    const msg = fieldWrap?.querySelector(".error-msg");
    if (sqli) {
      fieldWrap?.classList.add("error");
      if (msg) {
        msg.textContent = "Entrada bloqueada: se detectaron patrones de inyección SQL no permitidos.";
        msg.hidden = false;
      }
      return;
    }
    const priv = el.dataset.field && el.dataset.field.startsWith("login:"); // lo escrito en el login nunca se guarda (ni la contraseña ni el correo)
    if (el.dataset.field && !priv) {
      state.saved[el.dataset.field] =
        el.type === "checkbox" ? el.checked : el.value;
      save();
    }
    fieldWrap?.classList.remove("error");
    if (msg) msg.hidden = true;
    if (priv) {
      const lb = $("#login-error");
      if (lb) lb.innerHTML = "";
    }
  }
  // Manejo de edición inline en tabla de presupuesto
  if (el.dataset.budgetIndex !== undefined && el.dataset.budgetField) {
    const i = Number(el.dataset.budgetIndex);
    const field = el.dataset.budgetField;
    if (Number.isInteger(i) && i >= 0 && i < state.budget.length) {
      let value = el.value;
      if (field === "a" || field === "b") {
        value = Number(value) || 0;
        if (value < 0) value = 0;
      } else if (field === "detail") {
        value = String(value).slice(0, 500);
      }
      state.budget[i][field] = value;
      save();
      // Actualizar totales en la UI sin re-render completo
      const totalAEl = $(".metric:nth-child(1) .value");
      const totalBEl = $(".metric:nth-child(2) .value");
      const totalAllEl = $(".metric:nth-child(3) .value");
      if (totalAEl) totalAEl.textContent = money(totalA());
      if (totalBEl) totalBEl.textContent = money(totalB());
      if (totalAllEl) totalAllEl.textContent = money(totalA() + totalB());
      // Actualizar estado de validación
      const valid = budgetValid();
      const noticeEl = $(".notice");
      if (noticeEl) {
        if (valid) {
          noticeEl.className = "notice";
          noticeEl.innerHTML = `<div><strong>Presupuesto dentro del límite anual</strong><p>Equipo en el primer año y beca estudiantil de 10 h/semana incorporada.</p></div>`;
        } else {
          noticeEl.className = "notice warning";
          noticeEl.innerHTML = `<div><strong>Revisa el presupuesto para continuar</strong><p>El monto supera el tope anual, hay equipo en el segundo año o falta la beca mínima.</p></div>`;
        }
      }
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

// [Línea clave]: ¿Por qué soy importante? Punto de arranque del ciclo de vida del Frontend. ¿Para qué? Renderizar la vista inicial y sincronizar catálogos y datos del sistema asíncronamente. ¿Dónde me usan? Al pie del archivo app.js autoejecutándose como IIFE.
(async function initApp() {
  render();
  if (!session?.user) return;
  try {
    await obtenerDatosBackend();
    render();
    loadScreenData();
  } catch (e) {
    console.warn("SGPI: Error en precarga de datos:", e);
  }
})();
