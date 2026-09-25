/* SGPI local development plugin. Only the native Figma Plugin API is used. */
/* The build step replaces the quoted marker below with the snapshot JSON. */
const SNAPSHOT = "__SGPI_SNAPSHOT_DATA__";
const PAGE_NAME = "02 · Prototipo interactivo";
const NS = "sgpi-import";
const IMPORT_VERSION = "1.0.0";
const PALETTE = { Azul: "#002855", Blanco: "#FFFFFF", Rojo: "#EF3340" };
const stats = { frames: 0, texts: 0, boxes: 0, components: 0, instances: 0, links: 0, warnings: [] };
const fontNames = {};
const componentCache = new Map();
const variablesByHex = new Map();
let componentShelf;
let componentY = 56;
let busy = false;

function finite(value, fallback) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function rgbHex(rgb) {
  return "#" + [rgb.r, rgb.g, rgb.b].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function parseColor(value) {
  if (typeof value !== "string" || !value.trim() || value === "transparent" || value === "none") return null;
  const s = value.trim().toLowerCase();
  if (s === "white") return { r: 1, g: 1, b: 1, a: 1 };
  if (s === "black") return { r: 0, g: 0, b: 0, a: 1 };
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map(c => c + c).join("");
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const m = s.match(/^rgba?\((.*)\)$/);
  if (m) {
    const c = m[1].replace(/\//g, " ").split(/[ ,]+/).filter(Boolean);
    if (c.length < 3 || c.length > 4) return null;
    const channel = t => clamp(parseFloat(t) / (t.endsWith("%") ? 100 : 255), 0, 1);
    const a = c[3] === undefined ? 1 : clamp(parseFloat(c[3]) / (c[3].endsWith("%") ? 100 : 1), 0, 1);
    const rgb = { r: channel(c[0]), g: channel(c[1]), b: channel(c[2]), a };
    return Object.values(rgb).every(Number.isFinite) ? rgb : null;
  }
  return null;
}
function paint(value) {
  const c = parseColor(value);
  if (!c || c.a === 0) return [];
  let p = { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
  const v = variablesByHex.get(rgbHex(c));
  if (v) p = figma.variables.setBoundVariableForPaint(p, "color", v);
  return [p];
}
function geometry(node, e, origin) {
  node.resize(Math.max(0.01, finite(e.w, 1)), Math.max(0.01, finite(e.h, 1)));
  node.x = finite(e.x, 0) - origin.x;
  node.y = finite(e.y, 0) - origin.y;
  node.opacity = clamp(finite(e.opacity, 1), 0, 1);
}
function styleBox(node, e) {
  node.fills = paint(e.background);
  const strokeWidth = Math.max(0, finite(e.borderWidth, 0));
  node.strokes = strokeWidth > 0 ? paint(e.borderColor) : [];
  node.strokeWeight = strokeWidth;
  node.strokeAlign = "INSIDE";
  node.cornerRadius = clamp(finite(e.borderRadius, 0), 0, Math.min(Math.max(0.01, finite(e.w, 1)), Math.max(0.01, finite(e.h, 1))) / 2);
}
function semanticTag(e) {
  if (e.kind !== "box") return "";
  const tag = String(e.tag || "").toLowerCase();
  if (/\b(button|boton|botón)\b/.test(tag)) return "Botón";
  if (/\b(input|select|textarea|field|campo)\b/.test(tag)) return "Campo";
  if (/\b(card|tarjeta)\b/.test(tag)) return "Tarjeta";
  return "";
}
function contains(a, b) {
  const eps = 0.75;
  return b.x >= a.x - eps && b.y >= a.y - eps && b.x + b.w <= a.x + a.w + eps && b.y + b.h <= a.y + a.h + eps;
}
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function signature(e, children) {
  const fields = ["kind", "w", "h", "text", "fontSize", "fontWeight", "lineHeight", "color", "background", "borderColor", "borderWidth", "borderRadius", "opacity"];
  const clean = item => fields.map(k => item[k] === undefined ? null : item[k]);
  return JSON.stringify([semanticTag(e), clean(e), children.map(c => [c.x - e.x, c.y - e.y, clean(c)])]);
}
function normalizedElements(screen) {
  return screen.elements.map(e => Object.assign({}, e, {
    x: finite(e.x, 0), y: finite(e.y, 0), w: Math.max(0.01, finite(e.w, 1)), h: Math.max(0.01, finite(e.h, 1))
  })).filter(e => e.kind === "text" || e.kind === "box" || e.kind === "svg");
}
async function addElement(parent, e, origin) {
  let n;
  if (e.kind === "svg") {
    n = figma.createNodeFromSvg(String(e.svg));
    parent.appendChild(n);
    geometry(n, e, origin);
    n.name = "Icono vectorial";
    stats.boxes++;
  } else if (e.kind === "text") {
    n = figma.createText();
    parent.appendChild(n);
    const weight = finite(e.fontWeight, e.fontWeight === "bold" ? 700 : 400);
    n.fontName = weight >= 650 ? fontNames.bold : weight >= 500 ? fontNames.medium : fontNames.regular;
    n.fontSize = Math.max(1, finite(e.fontSize, 16));
    const line = finite(e.lineHeight, 0);
    n.lineHeight = line > 0 ? { unit: "PIXELS", value: line } : { unit: "AUTO" };
    n.characters = String(e.text || "");
    n.name = n.characters.replace(/\s+/g, " ").slice(0, 72) || "Texto";
    n.fills = paint(e.color || PALETTE.Azul);
    n.textAutoResize = "NONE";
    geometry(n, e, origin);
    n.textAutoResize = "HEIGHT";
    // Height grows only when the actual loaded font requires another line. The node stays editable.
    if (n.height > e.h + 5) stats.warnings.push("Revisar altura de texto: " + n.name);
    stats.texts++;
  } else {
    n = figma.createRectangle();
    parent.appendChild(n);
    n.name = e.tag ? String(e.tag) : "Superficie";
    geometry(n, e, origin);
    styleBox(n, e);
    stats.boxes++;
  }
  if (e.action) n.setPluginData("sgpi-action", String(e.action));
  if (e.target) n.setPluginData("sgpi-target", String(e.target));
  return n;
}
async function addComponentInstance(parent, base, children) {
  const key = signature(base, children);
  let master = componentCache.get(key);
  if (!master) {
    master = figma.createComponent();
    componentShelf.appendChild(master);
    master.name = "SGPI / " + semanticTag(base) + " / " + String(stats.components + 1).padStart(3, "0");
    master.description = "Componente local editable importado desde la composición SGPI. Los enlaces de navegación se conservan en hotspots de cada pantalla.";
    master.resize(base.w, base.h);
    master.x = 24 + Math.floor(stats.components / 40) * 1500;
    if (stats.components % 40 === 0) componentY = 56;
    master.y = componentY;
    master.fills = [];
    master.clipsContent = false;
    await addElement(master, base, { x: base.x, y: base.y });
    for (const child of children) await addElement(master, child, { x: base.x, y: base.y });
    componentCache.set(key, master);
    componentY += base.h + 24;
    componentShelf.resize(Math.max(componentShelf.width, master.x + base.w + 24), Math.max(componentShelf.height, componentY + 24));
    stats.components++;
  }
  const instance = master.createInstance();
  parent.appendChild(instance);
  instance.name = semanticTag(base) + (children.find(c => c.kind === "text") ? " · " + children.find(c => c.kind === "text").text.slice(0, 44) : "");
  instance.x = base.x;
  instance.y = base.y;
  stats.instances++;
}
async function addScreenContent(frame, screen) {
  const elements = normalizedElements(screen);
  const used = new Set();
  for (let i = 0; i < elements.length; i++) {
    if (used.has(i)) continue;
    const e = elements[i];
    if (!semanticTag(e)) { await addElement(frame, e, { x: 0, y: 0 }); continue; }
    const children = [];
    // Group only a contiguous paint-order region. A partially intersecting sibling stops grouping.
    for (let j = i + 1; j < elements.length; j++) {
      if (used.has(j)) continue;
      const candidate = elements[j];
      if (contains(e, candidate)) { children.push(candidate); used.add(j); }
      else if (overlaps(e, candidate)) break;
      else break;
    }
    await addComponentInstance(frame, e, children);
  }
}
function getLinks(screen) {
  const links = Array.isArray(screen.links) ? screen.links.slice() : [];
  for (const e of screen.elements) {
    if (!e.target && !["close", "cerrar", "back"].includes(String(e.action).toLowerCase())) continue;
    const kind = ["overlay", "close", "back"].includes(e.action) ? e.action : e.action === "cerrar" ? "close" : "navigate";
    const link = { x: e.x, y: e.y, w: e.w, h: e.h, target: e.target, kind };
    if (!links.some(l => l.x === link.x && l.y === link.y && l.w === link.w && l.h === link.h)) links.push(link);
  }
  // Largest first, smallest last: an action inside a clickable card keeps its own hit area.
  return links.sort((a, b) => b.w * b.h - a.w * a.h);
}
function validateSnapshot(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.screens) || !data.screens.length) {
    throw new Error("El archivo code.js aún no contiene las capturas. Ejecute build.mjs antes de importar el plugin.");
  }
  const ids = new Set();
  let elements = 0;
  for (const s of data.screens) {
    if (!s.id || ids.has(String(s.id))) throw new Error("Hay una pantalla sin ID o un ID repetido: " + s.id);
    ids.add(String(s.id));
    if (!(finite(s.width, 0) > 0 && finite(s.height, 0) > 0) || !Array.isArray(s.elements)) throw new Error("Dimensiones o elementos inválidos: " + s.id);
    elements += s.elements.length;
  }
  for (const s of data.screens) for (const l of getLinks(s)) {
    if (!["close", "back"].includes(l.kind) && !ids.has(String(l.target))) throw new Error("Destino inexistente: " + s.id + " → " + l.target);
  }
  return { screens: data.screens.length, elements };
}
async function loadFonts() {
  const available = await figma.listAvailableFontsAsync();
  const roboto = available.filter(f => f.fontName.family === "Roboto").map(f => f.fontName);
  const choose = desired => roboto.find(f => f.style === desired);
  fontNames.regular = choose("Regular");
  fontNames.medium = choose("Medium");
  fontNames.bold = choose("Bold");
  if (!fontNames.regular || !fontNames.medium || !fontNames.bold) throw new Error("Se necesitan Roboto Regular, Medium y Bold disponibles en Figma. Instale o active estas fuentes y vuelva a ejecutar.");
  await Promise.all(Object.values(fontNames).map(font => figma.loadFontAsync(font)));
}
async function prepareVariables() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find(c => c.name === "SGPI · Colores de importación");
  if (!collection) collection = figma.variables.createVariableCollection("SGPI · Colores de importación");
  const vars = await figma.variables.getLocalVariablesAsync("COLOR");
  for (const [name, hex] of Object.entries(PALETTE)) {
    let v = vars.find(v => v.variableCollectionId === collection.id && v.name === name);
    if (!v) v = figma.variables.createVariable(name, collection, "COLOR");
    v.scopes = ["FRAME_FILL", "SHAPE_FILL", "TEXT_FILL", "STROKE_COLOR"];
    v.setVariableCodeSyntax("WEB", "var(--sgpi-" + name.toLowerCase() + ")");
    const c = parseColor(hex);
    v.setValueForMode(collection.defaultModeId, c);
    variablesByHex.set(hex, v);
  }
}
async function importSnapshot() {
  validateSnapshot(SNAPSHOT);
  await loadFonts();
  await prepareVariables();
  let page = figma.root.children.find(p => p.name === PAGE_NAME);
  if (!page) page = figma.createPage();
  page.name = PAGE_NAME;
  await figma.setCurrentPageAsync(page);
  const existingRight = page.children.reduce((x, n) => Math.max(x, n.x + n.width), -160);
  const originX = Math.max(0, existingRight + 160);
  const maxWidth = Math.max.apply(null, SNAPSHOT.screens.map(s => s.width));
  const maxHeight = Math.max.apply(null, SNAPSHOT.screens.map(s => s.height));
  const columns = 4;
  const byId = new Map();
  const runId = Date.now().toString();
  componentShelf = figma.createFrame();
  page.appendChild(componentShelf);
  componentShelf.name = "Componentes reutilizables · " + runId;
  componentShelf.x = originX + columns * (maxWidth + 160);
  componentShelf.y = 0;
  componentShelf.resize(480, 96);
  componentShelf.fills = paint(PALETTE.Blanco);
  componentShelf.clipsContent = false;
  componentShelf.setPluginData(NS, runId);
  for (let i = 0; i < SNAPSHOT.screens.length; i++) {
    const s = SNAPSHOT.screens[i];
    const frame = figma.createFrame();
    page.appendChild(frame);
    frame.name = String(s.id) + " · " + s.title;
    frame.resize(s.width, s.overlay ? s.height : Math.min(s.height, s.viewportHeight || 1024));
    frame.x = originX + (i % columns) * (maxWidth + 160);
    frame.y = Math.floor(i / columns) * (maxHeight + 160);
    frame.fills = paint(PALETTE.Blanco);
    frame.clipsContent = true;
    frame.overflowDirection = "VERTICAL";
    frame.setPluginData(NS, runId);
    frame.setPluginData("sgpi-screen-id", String(s.id));
    frame.setPluginData("sgpi-import-version", IMPORT_VERSION);
    byId.set(String(s.id), frame);
    await addScreenContent(frame, s);
    stats.frames++;
    figma.ui.postMessage({ type: "progress", text: "Construyendo " + (i + 1) + "/" + SNAPSHOT.screens.length + ": " + s.title });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  for (const s of SNAPSHOT.screens) {
    const frame = byId.get(String(s.id));
    for (const l of getLinks(s)) {
      const hotspot = figma.createRectangle();
      frame.appendChild(hotspot);
      hotspot.name = "Interacción · " + l.kind + (l.target ? " → " + l.target : "");
      geometry(hotspot, l, { x: 0, y: 0 });
      // A solid paint at zero opacity keeps a real editable hit area in the prototype.
      hotspot.fills = [{ type: "SOLID", color: { r: 0, g: 40 / 255, b: 85 / 255 }, opacity: 0 }];
      hotspot.strokes = [];
      const action = l.kind === "close" ? { type: "CLOSE" } : l.kind === "back" ? { type: "BACK" } : {
        type: "NODE", destinationId: byId.get(String(l.target)).id,
        navigation: l.kind === "overlay" ? "OVERLAY" : "NAVIGATE", transition: null,
        resetScrollPosition: l.kind !== "overlay"
      };
      await hotspot.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [action] }]);
      stats.links++;
    }
  }
  const start = byId.get(String(SNAPSHOT.startId || SNAPSHOT.screens[0].id));
  page.flowStartingPoints = [...page.flowStartingPoints, { nodeId: start.id, name: "SGPI · Recorrido completo" }];
  page.selection = [start];
  figma.viewport.scrollAndZoomIntoView([start]);
  figma.ui.postMessage({ type: "done", stats, startId: start.id, pageId: page.id });
}

figma.showUI(__html__, { width: 430, height: 390, themeColors: true });
figma.ui.onmessage = async message => {
  if (message.type === "close") { figma.closePlugin(); return; }
  if (message.type === "inspect") {
    try { figma.ui.postMessage({ type: "ready", summary: validateSnapshot(SNAPSHOT) }); }
    catch (error) { figma.ui.postMessage({ type: "error", text: String(error.message || error) }); }
    return;
  }
  if (message.type !== "import" || busy) return;
  busy = true;
  try { await importSnapshot(); }
  catch (error) {
    figma.ui.postMessage({ type: "error", text: String(error.message || error) + " Si se crearon nodos antes del error, puede deshacer la ejecución en Figma." });
  }
  finally { busy = false; }
};
