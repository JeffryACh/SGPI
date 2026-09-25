import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(process.argv[2] || path.join(here, 'snapshot.json'));
const templatePath = path.join(here, 'code.template.js');
let template;
try { template = await fs.readFile(templatePath, 'utf8'); }
catch { template = await fs.readFile(path.join(here, 'code.js'), 'utf8'); }
const marker = '"__SGPI_SNAPSHOT_DATA__"';
if (template.split(marker).length !== 2) throw new Error('La plantilla debe contener un único marcador de capturas.');
const data = JSON.parse(await fs.readFile(input, 'utf8'));
if (!Array.isArray(data.screens) || data.screens.length < 1) throw new Error('No hay pantallas en el JSON.');
const ids = new Set();
for (const screen of data.screens) {
  if (!screen.id || ids.has(String(screen.id))) throw new Error('ID de pantalla inválido: ' + screen.id);
  if (!(screen.width > 0 && screen.height > 0) || !Array.isArray(screen.elements)) throw new Error('Pantalla inválida: ' + screen.id);
  ids.add(String(screen.id));
}
for (const screen of data.screens) for (const link of screen.links || []) {
  if (!['close', 'back'].includes(link.kind) && !ids.has(String(link.target))) throw new Error('Destino inexistente: ' + screen.id + ' → ' + link.target);
}
await fs.writeFile(templatePath, template);
await fs.writeFile(path.join(here, 'code.js'), template.replace(marker, () => JSON.stringify(data).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')));
console.log('Empaquetadas ' + data.screens.length + ' pantallas y escenarios en code.js. No se ha ejecutado en Figma.');
