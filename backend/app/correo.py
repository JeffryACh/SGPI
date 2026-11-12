"""
========================================================================================
ARCHIVO: backend/app/correo.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Enviar correos institucionales del SGPI ( hoy, las credenciales iniciales de una
    cuenta de investigador creada desde el modal de equipo) mediante SMTP.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Lee la configuración SMTP desde las variables de entorno 'SMTP_HOST',
             'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM' y 'SMTP_TLS'.
    2.2.2. A dónde envía datos:
           - Entrega el mensaje al servidor SMTP configurado (correo saliente).
           - Devuelve a 'app.routers.auth' el resultado del envío para decidir si la
             credencial debe incluirse en la respuesta de la API (modo prototipo).

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Comprueba si existe un servidor SMTP configurado, arma un mensaje de texto con las
    credenciales de acceso de la persona investigadora y lo envía. Si no hay SMTP
    configurado no falla: informa que el envío no fue posible para que el flujo de alta
    siga funcionando en el modo prototipo (la contraseña se devuelve en la respuesta).
=========================================================================================
"""

import os
import smtplib
from email.message import EmailMessage
from typing import Optional

# [Línea clave]: Remitente institucional por defecto cuando el servidor no define 'SMTP_FROM'.
REMITENTE_POR_DEFECTO = "no-reply@tec.ac.cr"


def smtp_configurado() -> bool:
    """
    Indicar si el entorno tiene un servidor SMTP habilitado para el envío de correos.

    parametros:
        (No recibe parámetros)

    return:
        + bool : hay_smtp True si 'SMTP_HOST' está definido; False en caso contrario.
    """
    return bool((os.getenv("SMTP_HOST") or "").strip())


def _configuracion() -> dict[str, str]:
    """
    Reunir la configuración SMTP declarada en las variables de entorno.

    parametros:
        (No recibe parámetros)

    return:
        + dict[str, str] : config Valores 'host', 'port', 'user', 'pass', 'from' y 'tls'.
    """
    return {
        "host": (os.getenv("SMTP_HOST") or "").strip(),
        "port": (os.getenv("SMTP_PORT") or "587").strip(),
        "user": (os.getenv("SMTP_USER") or "").strip(),
        "pass": (os.getenv("SMTP_PASS") or "").strip(),
        "from": (os.getenv("SMTP_FROM") or REMITENTE_POR_DEFECTO).strip(),
        "tls": (os.getenv("SMTP_TLS") or "1").strip(),
    }


def enviar_credenciales_investigador(
    correo: str,
    nombre: str,
    password: str,
    orcid: Optional[str] = None,
) -> tuple[bool, str]:
    """
    Enviar por correo las credenciales iniciales de una cuenta de investigador recién creada.

    Arma un mensaje de texto plano con el correo institucional, la contraseña inicial y el
    ORCID registrado, y lo entrega al servidor SMTP configurado. Si no hay SMTP configurado
    devuelve (False, 'sin_smtp') para que el flujo de prototipo pueda continuar mostrando la
    credencial en pantalla; si el envío falla devuelve (False, 'error') con el detalle.

    parametros:
        - str : correo Correo institucional de la persona investigadora.
        - str : nombre Nombre completo de la persona investigadora.
        - str : password Contraseña inicial generada para la cuenta.
        - Optional[str] : orcid Identificador ORCID registrado en el perfil (opcional).

    return:
        + tuple[bool, str] : resultado Tupla con el indicador de envío y el motivo o detalle.
    """
    config = _configuracion()
    if not config["host"]:
        return False, "sin_smtp"

    destinatario = (correo or "").strip()
    if not destinatario:
        return False, "sin_destinatario"

    mensaje = EmailMessage()
    mensaje["Subject"] = "Acceso al SGPI · Fondos VIE 2027"
    mensaje["From"] = config["from"]
    mensaje["To"] = destinatario
    cuerpo = [
        f"Estimado(a) {nombre or ''},",
        "",
        "Se creó su cuenta de investigador en el SGPI (Fondos VIE 2027).",
        "",
        f"Correo institucional: {destinatario}",
        f"Contraseña inicial: {password}",
    ]
    if orcid:
        cuerpo.append(f"ORCID registrado: {orcid}")
    cuerpo += [
        "",
        "Por seguridad, solicitamos cambiar esta contraseña en su primer ingreso.",
        "",
        "Sistema de Gestión de Propuestas de Investigación (SGPI) · Tecnológico de Costa Rica",
    ]
    mensaje.set_content("\n".join(cuerpo))

    try:
        with smtplib.SMTP(config["host"], int(config["port"]), timeout=10) as servidor:
            if config["tls"] not in ("0", "false", "False", "no"):
                try:
                    servidor.starttls()
                except smtplib.SMTPException:
                    pass  # el servidor no admite STARTTLS y ya expone el puerto seguro
            if config["user"]:
                servidor.login(config["user"], config["pass"])
            servidor.send_message(mensaje)
    except Exception as exc:  # pragma: no cover - depende del servidor SMTP externo
        return False, f"error: {exc}"
    return True, "enviado"
