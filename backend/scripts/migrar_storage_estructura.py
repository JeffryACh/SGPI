"""
========================================================================================
ARCHIVO: backend/scripts/migrar_storage_estructura.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Reorganizar los archivos del bucket 'convocatorias' de Supabase Storage para que
    respeten la estructura institucional vigente:

        <bucket 'convocatorias'>/
        └── <carpeta de la convocatoria>/
            ├── documentos/          -> instrumentos oficiales de la convocatoria
            └── propuestas/
                └── <codigo>/        -> documentos de la propuesta (SI-YYYY-NNN)

    El script mueve a 'documentos/' los archivos que estaban en la raíz de la carpeta
    de la convocatoria, traslada a '<convocatoria>/propuestas/' las carpetas globales
    'propuestas/<codigo>/' de la estructura anterior y crea los archivos marcadores
    ('.keep') que dejan visibles las carpetas vacías en el panel de Supabase.

    No borra nada: las carpetas que no pertenecen a una convocatoria (por ejemplo una
    carpeta de prueba) se dejan intactas.

2.2. CÓMO SE EJECUTA:
        python backend/scripts/migrar_storage_estructura.py            # aplica los cambios
        python backend/scripts/migrar_storage_estructura.py --dry-run  # solo muestra el plan

    Requiere las variables DATABASE_URL, SUPABASE_URL y SUPABASE_SERVICE_KEY (archivo .env
    de la raíz del repositorio).

2.3. SEGURIDAD:
    El script es idempotente: se puede ejecutar varias veces sin duplicar movimientos.
========================================================================================
"""

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# [Línea clave]: El .env vive en la raíz del repositorio, dos niveles por encima de este script.
RAIZ = Path(__file__).resolve().parents[2]
load_dotenv(RAIZ / ".env")

import httpx
import psycopg
from psycopg.rows import dict_row

# [Línea clave]: El bucket institucional donde vive toda la documentación del SGPI.
BUCKET = "convocatorias"
SUBCARPETA_DOCUMENTOS = "documentos"
SUBCARPETA_PROPUESTAS = "propuestas"
ARCHIVO_MARCADOR = ".keep"
# [Línea clave]: El bucket solo admite los MIME de los formatos institucionales (pdf, docx,
# xlsx, pptx); el marcador vacío se registra como PDF para no ser rechazado.
MIME_MARCADOR = "application/pdf"


def config_storage() -> tuple[str, str]:
    """
    Leer la configuración de Supabase Storage desde las variables de entorno.

    return:
        + tuple[str, str] : (url, key) URL base del proyecto y service role key.
    """
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise SystemExit(
            "Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en el archivo .env de la raíz."
        )
    return url, key


def cabeceras(key: str) -> dict[str, str]:
    """Construir las cabeceras de autenticación para la API de Storage."""
    return {"Authorization": f"Bearer {key}", "apikey": key}


def listar_objetos(url: str, key: str, prefijo: str = "", nivel: int = 0) -> list[str]:
    """
    Listar de forma recursiva los objetos (archivos) del bucket.

    En Supabase Storage las carpetas son prefijos implícitos: la API de listado devuelve
    los archivos y las carpetas del prefijo indicado.

    parametros:
        - str : url URL base del proyecto de Supabase.
        - str : key Service role key.
        - str : prefijo Prefijo desde el que se listan los objetos.
        - int : nivel Profundidad actual de la recursión.

    return:
        + list[str] : objetos Rutas completas de los archivos encontrados.
    """
    r = httpx.post(
        f"{url}/storage/v1/object/list/{BUCKET}",
        headers=cabeceras(key),
        json={"prefix": prefijo, "limit": 1000, "offset": 0},
        timeout=60,
    )
    if r.status_code >= 400:
        print(f"  (error al listar '{prefijo}': {r.status_code} {r.text[:120]})")
        return []
    objetos: list[str] = []
    for item in r.json():
        nombre = item.get("name", "")
        # [Línea clave]: La API devuelve los nombres relativos al prefijo consultado, así que
        #                se reconstruye la ruta completa antes de recursar o de reportar.
        completa = f"{prefijo}/{nombre}" if prefijo else nombre
        if item.get("id") is None and nivel < 4:
            objetos.extend(listar_objetos(url, key, completa, nivel + 1))
        else:
            objetos.append(completa)
    return objetos


def mover(url: str, key: str, origen: str, destino: str) -> bool:
    """
    Mover un objeto dentro del bucket.

    La API de movimiento de Supabase rechaza la operación cuando el bucket tiene lista
    de MIME permitidos, así que el traslado se hace descargando el objeto, subiéndolo en
    su nueva ruta con el mismo tipo MIME y borrando el original.

    return:
        + bool : movido True si el objeto quedó en su nueva ruta.
    """
    descarga = httpx.get(
        f"{url}/storage/v1/object/{BUCKET}/{origen}", headers=cabeceras(key), timeout=120
    )
    if descarga.status_code >= 400:
        print(f"  (no se pudo descargar '{origen}': {descarga.status_code} {descarga.text[:120]})")
        return False
    mime = descarga.headers.get("content-type", "application/pdf")
    subida = httpx.post(
        f"{url}/storage/v1/object/{BUCKET}/{destino}",
        headers={**cabeceras(key), "Content-Type": mime, "x-upsert": "true"},
        content=descarga.content,
        timeout=120,
    )
    if subida.status_code >= 400:
        print(f"  (no se pudo subir '{destino}': {subida.status_code} {subida.text[:160]})")
        return False
    borrado = httpx.delete(
        f"{url}/storage/v1/object/{BUCKET}/{origen}", headers=cabeceras(key), timeout=60
    )
    if borrado.status_code >= 400:
        print(f"  (aviso: el original '{origen}' no se pudo borrar: {borrado.status_code})")
    return True


def existe(url: str, key: str, ruta: str) -> bool:
    """Comprobar si un objeto ya existe dentro del bucket."""
    try:
        r = httpx.head(
            f"{url}/storage/v1/object/{BUCKET}/{ruta}",
            headers=cabeceras(key),
            timeout=30,
        )
    except httpx.HTTPError:
        return False
    return r.status_code < 400


def crear_marcador(url: str, key: str, carpeta: str, subcarpeta: str) -> None:
    """Crear el archivo marcador que deja visible una carpeta vacía en el panel."""
    ruta = f"{carpeta}/{subcarpeta}/{ARCHIVO_MARCADOR}"
    if existe(url, key, ruta):
        return
    # [Línea clave]: El bucket solo admite los MIME institucionales, por eso el marcador
    # vacío se registra como PDF.
    r = httpx.post(
        f"{url}/storage/v1/object/{BUCKET}/{ruta}",
        headers={**cabeceras(key), "Content-Type": MIME_MARCADOR, "x-upsert": "true"},
        content=b"",
        timeout=60,
    )
    print(
        f"  marcador {'creado' if r.status_code < 400 else 'no creado'} "
        f"({r.status_code}): {ruta}"
    )


def datos_base() -> tuple[list[str], dict[str, str]]:
    """
    Leer de la base de datos las carpetas de las convocatorias y el código de cada propuesta.

    return:
        + tuple[list[str], dict[str, str]] : carpetas Carpetas de las convocatorias y
          codigos Código de propuesta por código en minúsculas (para resolver rutas antiguas).
    """
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise SystemExit("Falta DATABASE_URL en el archivo .env de la raíz.")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT nombre, carpeta_storage FROM convocatorias "
                "WHERE carpeta_storage IS NOT NULL AND btrim(carpeta_storage) <> ''"
            )
            carpetas = [
                (f["carpeta_storage"] or "").replace("convocatorias/", "").strip("/")
                for f in cur.fetchall()
            ]
            cur.execute("SELECT codigo FROM propuestas WHERE codigo IS NOT NULL")
            codigos = {f["codigo"].lower(): f["codigo"] for f in cur.fetchall()}
    return carpetas, codigos


def main() -> int:
    """Ejecutar la reorganización del bucket."""
    parser = argparse.ArgumentParser(description="Reorganiza el bucket de convocatorias.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Muestra el plan de movimientos sin modificar nada.",
    )
    args = parser.parse_args()

    url, key = config_storage()
    carpetas, codigos = datos_base()
    print("Carpetas de convocatoria registradas:", carpetas)
    print(f"Propuestas con código institucional: {len(codigos)}")

    objetos = listar_objetos(url, key)
    print(f"\nObjetos actuales en el bucket '{BUCKET}': {len(objetos)}")
    for objeto in sorted(objetos):
        print("  ", objeto)

    movimientos: list[tuple[str, str]] = []
    for objeto in objetos:
        partes = objeto.split("/")
        # [Línea clave]: Un archivo suelto en la raíz de la convocatoria pasa a 'documentos/'.
        if len(partes) == 2 and partes[0] in carpetas:
            movimientos.append((objeto, f"{partes[0]}/{SUBCARPETA_DOCUMENTOS}/{partes[1]}"))
            continue
        # [Línea clave]: La carpeta global 'propuestas/<codigo>/' cuelga de su convocatoria.
        if len(partes) >= 3 and partes[0] == SUBCARPETA_PROPUESTAS:
            codigo = codigos.get(partes[1].lower(), partes[1].upper())
            destino = "/".join([carpetas[0], SUBCARPETA_PROPUESTAS, codigo] + partes[2:]) if carpetas else objeto
            movimientos.append((objeto, destino))

    print(f"\nMovimientos previstos: {len(movimientos)}")
    for origen, destino in movimientos:
        print(f"  {origen}  ->  {destino}")

    if args.dry_run:
        print("\nModo simulación: no se modificó nada.")
        return 0

    print("\nAplicando movimientos:")
    for origen, destino in movimientos:
        if mover(url, key, origen, destino):
            print(f"  movido: {origen} -> {destino}")

    print("\nCreando marcadores de carpeta:")
    for carpeta in carpetas:
        crear_marcador(url, key, carpeta, SUBCARPETA_DOCUMENTOS)
        crear_marcador(url, key, carpeta, SUBCARPETA_PROPUESTAS)

    print("\nEstructura final:")
    for objeto in sorted(listar_objetos(url, key)):
        print("  ", objeto)
    return 0


if __name__ == "__main__":
    sys.exit(main())
