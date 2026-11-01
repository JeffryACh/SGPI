"""
========================================================================================
ARCHIVO: backend/app/routers/dictamen_vie.py

2.1. OBJETIVO DEL ARCHIVO:
    Centralizar la serialización del dictamen de Dirección de Investigación.

    La base de datos no tiene una tabla propia para el dictamen de VIE: la evidencia
    del dictamen vive repartida entre «evaluations» (fila con el rol «Dirección de
    Investigación») y «vie_dictamen_verifications» (cumplimiento por criterio VIE).
    Como «evaluations.observaciones» es la única columna de texto libre disponible,
    el dictamen, la fundamentación, las observaciones y las verificaciones
    institucionales se guardan ahí con un marcador y un documento JSON.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Consume los modelos de entrada y salida del router «direccion».
    2.2.2. A dónde envía datos:
           - Expone «serializar_dictamen» y «parsear_dictamen» para que los routers
             «direccion» y «propuestas» lean y escriban el mismo formato.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Convierte el dictamen a texto estructurado y lo recovers de forma tolerante,
    de modo que las observaciones libres escritas antes de esta implementación
    sigan siendo legibles sin romper el expediente.
========================================================================================
"""

import json
from typing import Optional

# [Línea clave]: Marcador que permite distinguir el formato estructurado del dictamen
# de las observaciones libres escritas antes de esta implementación.
MARCADOR_DICTAMEN = "SGPI_DICTAMEN_V1"

# [Línea clave]: Claves internas de las verificaciones institucionales del dictamen.
CLAVES_VERIFICACIONES = (
    "responsabilidades",
    "riesgos",
    "beca",
    "declaraciones",
    "documentos",
)


def serializar_dictamen(
    dictamen: str,
    fundamentacion: str,
    observaciones: Optional[str],
    verificaciones_institucionales: dict,
) -> str:
    """Serializar el dictamen de Dirección dentro de «evaluations.observaciones»."""

    documento = {
        "version": 1,
        "dictamen": dictamen,
        "fundamentacion": (fundamentacion or "").strip(),
        "observaciones": (observaciones or "").strip(),
        "verificaciones_institucionales": {
            clave: bool(verificaciones_institucionales.get(clave)) for clave in CLAVES_VERIFICACIONES
        },
    }
    return f"{MARCADOR_DICTAMEN}:{json.dumps(documento, ensure_ascii=False)}"


def parsear_dictamen(texto: Optional[str]) -> dict:
    """Recuperar dictamen, fundamentación y verificaciones desde «evaluations.observaciones».

    Tolera las observaciones libres de evaluations anteriores a esta implementación:
    en ese caso se devuelven valores por defecto y el texto original como observaciones.
    """

    vacio = {
        "dictamen": "Favorable",
        "fundamentacion": "",
        "observaciones": (texto or "").strip(),
        "verificaciones_institucionales": {},
    }
    if not texto or not texto.startswith(f"{MARCADOR_DICTAMEN}:"):
        return vacio

    try:
        documento = json.loads(texto.split(":", 1)[1])
    except (ValueError, TypeError):
        return vacio

    if not isinstance(documento, dict):
        return vacio

    verificaciones = documento.get("verificaciones_institucionales")
    if not isinstance(verificaciones, dict):
        verificaciones = {}

    return {
        "dictamen": documento.get("dictamen") or "Favorable",
        "fundamentacion": documento.get("fundamentacion") or "",
        "observaciones": documento.get("observaciones") or "",
        "verificaciones_institucionales": verificaciones,
    }
