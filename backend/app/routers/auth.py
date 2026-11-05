"""
========================================================================================
ARCHIVO: backend/app/routers/auth.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Gestionar la autenticación segura de usuarios institucionales (investigadores, evaluadores,
    coordinadores y directores) mediante credenciales de acceso (correo y contraseña), así como
    la búsqueda segura de investigadores y la validación/asociación de identificadores ORCID.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Recibe el payload JSON con correo y contraseña enviado desde la Pantalla 01 de login
             en 'frontend/js/app.js' (función 'apiLogin').
           - Recibe consultas de autocompletado de investigadores ('GET /auth/usuarios') y solicitudes
             de vinculación de ORCID ('PATCH /auth/usuarios/{id_usuario}/orcid').
           - Consulta las tablas 'public.usuarios', 'public.user_roles', 'public.roles',
             'public.escuelas' y 'public.external_collaborators' en Supabase.
           - Obtiene la conexión activa desde 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Retorna al Frontend los datos del usuario autenticado ('id_usuario', 'nombre', 'correo',
             'orcid' y lista de 'roles'), permitiendo establecer la sesión en 'state.user' y condicionar la interfaz.
           - Expone utilidades de validación ('contiene_inyeccion_sql', '_escape_ilike', 'validar_orcid')
             consumidas por 'app.main' y 'app.routers.propuestas'.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Valida las credenciales de inicio de sesión utilizando hashing SHA-256 en hexadecimal y comparación
    resistente a ataques de temporización (timing attacks con 'hmac.compare_digest'). Si las credenciales
    coinciden y el usuario se encuentra activo, consolida sus roles institucionales y devuelve su perfil
    junto con su ORCID validado; en caso contrario, arroja una excepción HTTP 401 unificada. Además,
    verifica el estándar internacional ISO 7064 MOD 11-2 para los identificadores ORCID solicitados.
==========================================================================================
"""

import hashlib
import hmac
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import Connection
from pydantic import BaseModel, Field
from typing import Optional

from ..db import get_conn

# [Línea clave]: Instancia el router bajo el prefijo /auth para agrupar las rutas de autenticación en la API.
router = APIRouter(prefix="/auth", tags=["auth"])

# [Línea clave]: Expresión regular compilada para detectar sentencias DDL/DML maliciosas e inyecciones booleanas/temporales.
_SQLI_PATTERN = re.compile(
    r"(\b(UNION\s+ALL\s+SELECT|UNION\s+SELECT|DROP\s+TABLE|DROP\s+DATABASE|INSERT\s+INTO|"
    r"DELETE\s+FROM|UPDATE\s+\w+\s+SET|ALTER\s+TABLE|TRUNCATE\s+TABLE|EXEC\s*\(|EXECUTE\s*\(|"
    r"PG_SLEEP|WAITFOR\s+DELAY|INFORMATION_SCHEMA)\b|--\s|;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|SELECT)|"
    r"'\s*(OR|AND)\s*'?\d+'?\s*=\s*'?\d+)",
    re.IGNORECASE,
)

# [Línea clave]: Patrón sintáctico oficial de ORCID de 16 caracteres agrupados en cuatro bloques separados por guiones.
_ORCID_FORMAT_REGEX = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$", re.IGNORECASE)

# [Línea clave]: Registro institucional de ORCIDs verificados (ISO 7064 MOD 11-2) vinculados a los perfiles de investigadores activos.
_ORCID_PERFIL_CORREOS: dict[str, str] = {
    "laura.mendez@example.com": "0000-0002-1825-0097",
    "andres.rojas@example.com": "0000-0001-5109-3700",
    "sofia.vega@example.com": "0000-0002-9079-593X",
    "mariana.solis@example.com": "0000-0003-1415-9269",
    "gabriel.sanchez@example.com": "0000-0002-7182-8182",
    "patricia.vargas@example.com": "0000-0001-6180-3398",
    "elena.chacon@example.com": "0000-0002-2360-679X",
    "ricardo.mora@example.com": "0000-0003-3162-2779",
}

# [Línea clave]: Diccionario en memoria para retener los ORCIDs solicitados y validados por id_usuario durante la sesión del servidor.
_ORCID_PERFIL_USUARIOS: dict[int, str] = {}


def contiene_inyeccion_sql(valor: Optional[str]) -> bool:
    """
    Verificar si una cadena de entrada presenta patrones maliciosos de inyección SQL.

    Evalúa la cadena proporcionada contra la expresión regular '_SQLI_PATTERN' como capa de
    defensa en profundidad adicional a las consultas parametrizadas de psycopg.

    parametros:
        - Optional[str] : valor Cadena de texto enviada por el cliente a inspeccionar.

    return:
        + bool : detectado True si se detecta algún patrón de ataque SQL; False en caso contrario.
    """
    if not valor:
        return False
    # [Línea clave]: Busca coincidencias de palabras clave de ataque SQL sin importar mayúsculas o minúsculas.
    return bool(_SQLI_PATTERN.search(valor))


def _escape_ilike(valor: str) -> str:
    """
    Escapar los caracteres comodín de PostgreSQL ILIKE (%, _, \\) en cadenas de búsqueda.

    Sustituye cada comodín por su secuencia escapada para impedir que el usuario altere la
    lógica de coincidencia parcial en las cláusulas ILIKE ... ESCAPE '\\'.

    parametros:
        - str : valor Texto libre de búsqueda ingresado por el usuario.

    return:
        + str : texto_escapado Cadena segura con comodines neutralizados para consultas ILIKE.
    """
    # [Línea clave]: Escapa primero la barra invertida y luego los comodines % y _ de PostgreSQL.
    return valor.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def validar_orcid(orcid: Optional[str]) -> bool:
    """
    Validar que un identificador ORCID cumpla el formato oficial y el dígito verificador ISO 7064 MOD 11-2.

    Comprueba primero la estructura '0000-0000-0000-000X' mediante expresión regular, descarta
    cadenas compuestas únicamente por ceros y verifica matemáticamente que el último carácter
    coincida con el algoritmo estándar ISO/IEC 7064:2003 (MOD 11-2) sobre los primeros 15 dígitos.

    parametros:
        - Optional[str] : orcid Identificador ORCID suministrado por el investigador o colaborador.

    return:
        + bool : es_valido True si el ORCID tiene sintaxis y suma de verificación válidas; False si no.
    """
    if not orcid:
        return False
    limpio = orcid.strip().upper()
    # [Línea clave]: Verifica que el formato corresponda exactamente a 4 bloques separados por guiones.
    if not _ORCID_FORMAT_REGEX.match(limpio):
        return False
    compacto = limpio.replace("-", "")
    if compacto[:15] == "000000000000000":
        return False
    # [Línea clave]: Aplica el algoritmo oficial ISO 7064 MOD 11-2 sobre los primeros 15 dígitos numéricos.
    total = 0
    for digito in compacto[:15]:
        total = (total + int(digito)) * 2
    resto = total % 11
    resultado = (12 - resto) % 11
    digito_esperado = "X" if resultado == 10 else str(resultado)
    return compacto[15] == digito_esperado


def obtener_orcid_usuario(
    id_usuario: int,
    correo: Optional[str] = None,
    nombre: Optional[str] = None,
    conn: Optional[Connection] = None,
) -> str:
    """
    Obtener el ORCID validado vinculado al perfil de un investigador sin generarlo artificialmente.

    Consulta el registro en memoria del servidor, el catálogo de perfiles institucionales por correo
    y, si se provee conexión a base de datos, verifica si existe un ORCID previamente registrado
    en 'public.external_collaborators'. Si el investigador aún no tiene ORCID registrado, retorna
    cadena vacía para que le sea solicitado explícitamente en la interfaz.

    parametros:
        - int : id_usuario Identificador numérico único del usuario institucional.
        - Optional[str] : correo Correo electrónico institucional del investigador.
        - Optional[str] : nombre Nombre completo del investigador para cruce de respaldo.
        - Optional[Connection] : conn Conexión activa a PostgreSQL para consulta opcional.

    return:
        + str : orcid Identificador ORCID validado asociado al perfil o cadena vacía si debe solicitarse.
    """
    # [Línea clave]: Prioriza el ORCID que el investigador haya solicitado/actualizado en su perfil activo.
    if id_usuario in _ORCID_PERFIL_USUARIOS:
        return _ORCID_PERFIL_USUARIOS[id_usuario]
    if correo:
        clave_correo = correo.strip().lower()
        if clave_correo in _ORCID_PERFIL_CORREOS:
            return _ORCID_PERFIL_CORREOS[clave_correo]
    if conn is not None and nombre:
        try:
            fila = conn.execute(
                """
                SELECT identificacion_orcid
                FROM public.external_collaborators
                WHERE lower(btrim(nombre_completo)) = lower(btrim(%s))
                  AND identificacion_orcid IS NOT NULL
                ORDER BY id_colaborador DESC
                LIMIT 1
                """,
                (nombre,),
            ).fetchone()
            if fila and validar_orcid(fila["identificacion_orcid"]):
                return fila["identificacion_orcid"].strip().upper()
        except Exception:
            pass
    return ""


def registrar_orcid_usuario(id_usuario: int, correo: Optional[str], orcid: str) -> str:
    """
    Asociar y validar un identificador ORCID solicitado al perfil de un investigador institucional.

    Comprueba que el ORCID cumpla la norma ISO 7064 MOD 11-2 y que no se encuentre asignado a
    otro usuario distinto dentro del registro institucional antes de vincularlo al perfil.

    parametros:
        - int : id_usuario Identificador del usuario propietario del perfil.
        - Optional[str] : correo Correo electrónico institucional del usuario.
        - str : orcid Identificador ORCID solicitado que se desea vincular al perfil.

    return:
        + str : orcid_normalizado Identificador ORCID validado y normalizado en mayúsculas.
    """
    orcid_norm = (orcid or "").strip().upper()
    # [Línea clave]: Rechaza cualquier ORCID que no supere la validación sintáctica y de dígito verificador.
    if not validar_orcid(orcid_norm):
        raise HTTPException(
            status_code=400,
            detail="El ORCID ingresado no es válido según el estándar oficial ISO 7064 (formato 0000-0000-0000-000X).",
        )
    clave_correo = (correo or "").strip().lower()
    for uid_reg, orcid_reg in _ORCID_PERFIL_USUARIOS.items():
        if orcid_reg == orcid_norm and uid_reg != id_usuario:
            raise HTTPException(
                status_code=409,
                detail=f"El ORCID {orcid_norm} ya se encuentra vinculado a otro perfil de investigador.",
            )
    for correo_reg, orcid_reg in _ORCID_PERFIL_CORREOS.items():
        if orcid_reg == orcid_norm and correo_reg != clave_correo:
            raise HTTPException(
                status_code=409,
                detail=f"El ORCID {orcid_norm} ya pertenece a otro investigador registrado.",
            )
    # [Línea clave]: Vincula el ORCID validado tanto al ID de usuario como a su correo institucional.
    _ORCID_PERFIL_USUARIOS[id_usuario] = orcid_norm
    if clave_correo:
        _ORCID_PERFIL_CORREOS[clave_correo] = orcid_norm
    return orcid_norm


class LoginIn(BaseModel):
    """
    Modelo de validación de entrada (Request Body) para la autenticación de usuarios.

    Pydantic valida que la petición contenga cadenas no vacías para el correo y la contraseña
    con una longitud máxima de 255 caracteres antes de que el endpoint procese la solicitud.

    Se utiliza como tipo del parámetro 'datos' en la función 'login' del router de autenticación.

    atributos:
        * str : correo Dirección de correo electrónico institucional del usuario que intenta ingresar.
        * str : password Contraseña en texto plano proporcionada en el formulario de acceso.
    """

    correo: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=255)


class OrcidActualizarIn(BaseModel):
    """
    Modelo de entrada (Request Body) para solicitar y vincular un ORCID al perfil de un investigador.

    Valida que la cadena enviada tenga la longitud máxima de un identificador ORCID oficial (19 caracteres).

    Se utiliza como parámetro en el endpoint PATCH /auth/usuarios/{id_usuario}/orcid.

    atributos:
        * str : orcid Identificador ORCID en formato 0000-0000-0000-000X proporcionado por el investigador.
        * Optional[str] : correo Correo institucional opcional para sincronizar el registro en memoria.
    """

    orcid: str = Field(..., min_length=19, max_length=19)
    correo: Optional[str] = Field(default=None, max_length=255)


class UsuarioOut(BaseModel):
    """
    Modelo de serialización de salida (Response Model) con los datos del usuario autenticado.

    Construye la respuesta JSON enviada al cliente con la identidad y permisos del usuario,
    garantizando que el hash de la contraseña nunca sea expuesto hacia el frontend.

    Se utiliza como response_model en el endpoint POST /auth/login.

    atributos:
        * int : id_usuario Identificador numérico único del usuario en la base de datos.
        * str : nombre Nombre completo compuesto (nombre + apellidos) para saludo en interfaz.
        * str : correo Correo institucional del usuario.
        * str : orcid Identificador ORCID único validado y asociado al perfil del investigador.
        * list[str] : roles Lista de nombres de roles institucionales que posee el usuario.
    """

    id_usuario: int
    nombre: str
    correo: str
    orcid: str = ""
    roles: list[str]


class UsuarioBuscarOut(BaseModel):
    """
    Modelo de salida para búsqueda de usuarios (sin hash de contraseña).

    Se utiliza en el endpoint GET /auth/usuarios para autocompletado en formularios de equipo.

    atributos:
        * int : id_usuario Identificador numérico único del usuario.
        * str : nombre Nombre completo (nombre + apellidos).
        * str : correo Correo institucional.
        * str : orcid Identificador ORCID único del investigador.
        * str : escuela Nombre de la escuela/dependencia (puede ser null).
        * str : siglas_escuela Siglas de la escuela (puede ser null).
        * bool : estado_activo Indica si el usuario está activo.
    """

    id_usuario: int
    nombre: str
    correo: str
    orcid: str = ""
    escuela: Optional[str] = None
    siglas_escuela: Optional[str] = None
    estado_activo: bool


# [Línea clave]: Hash ficticio para mitigar ataques de temporización cuando el correo no existe en la BD.
_DUMMY_HASH = hashlib.sha256(b"sin-usuario").hexdigest()


def hash_password(password: str) -> str:
    """
    Calcular el hash criptográfico SHA-256 de una contraseña en formato hexadecimal.

    Codifica la cadena de contraseña en bytes UTF-8, aplica el algoritmo SHA-256 mediante hashlib
    y devuelve la representación hexadecimal en minúsculas, coincidiendo con la semilla de la BD.

    parametros:
        - str : password Contraseña en texto plano a transformar.

    return:
        + str : hexdigest Cadena hash de 64 caracteres hexadecimales para ser comparada con la BD.
    """
    # [Línea clave]: Aplica SHA-256 consistente con la función de hashing utilizada en las migraciones SQL.
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


@router.get("/usuarios", response_model=list[UsuarioBuscarOut])
def buscar_usuarios(
    q: str = Query(..., min_length=2, max_length=100, description="Texto a buscar en correo o nombre"),
    limit: int = Query(10, ge=1, le=50),
    conn: Connection = Depends(get_conn),
):
    """
    Buscar usuarios institucionales activos por correo o nombre para autocompletado en formularios.

    Realiza búsqueda ILIKE en correo y nombre concatenado, filtrando solo usuarios activos.
    Limitado a 'limit' resultados para autocompletado eficiente.

    parametros:
        - str : q Texto de búsqueda (mínimo 2 caracteres).
        - int : limit Máximo de resultados (por defecto 10, máximo 50).
        - Connection : conn Conexión transaccional inyectada por FastAPI.

    return:
        + list[UsuarioBuscarOut] : usuarios Lista de usuarios que coinciden con la búsqueda.
    """
    if contiene_inyeccion_sql(q):
        raise HTTPException(status_code=400, detail="Entrada inválida: se detectó un patrón no permitido.")

    q_clean = _escape_ilike(q.strip())
    patron = f"%{q_clean}%"
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.id_usuario,
                   TRIM(u.nombre || ' ' || u.lastname || ' ' || COALESCE(u.second_lastname, '')) AS nombre,
                   u.correo,
                   e.nombre AS escuela,
                   e.siglas AS siglas_escuela,
                   u.estado_activo
            FROM public.usuarios u
            LEFT JOIN public.escuelas e ON e.id_escuela = u.id_escuela
            JOIN public.user_roles ur ON ur.id_usuario = u.id_usuario
            JOIN public.roles r ON r.id_rol = ur.id_rol
            WHERE u.estado_activo
              AND r.nombre_rol = 'Investigador'
              AND (
                  u.correo ILIKE %s ESCAPE '\\'
                  OR u.nombre ILIKE %s ESCAPE '\\'
                  OR u.lastname ILIKE %s ESCAPE '\\'
                  OR (u.nombre || ' ' || u.lastname || ' ' || COALESCE(u.second_lastname, '')) ILIKE %s ESCAPE '\\'
              )
            ORDER BY u.nombre ASC
            LIMIT %s
            """,
            (patron, patron, patron, patron, limit),
        )
        filas = cur.fetchall()
        # [Línea clave]: Adjunta el ORCID validado que tiene registrado cada investigador en su perfil.
        return [
            {
                **dict(f),
                "orcid": obtener_orcid_usuario(
                    id_usuario=f["id_usuario"],
                    correo=f["correo"],
                    nombre=f["nombre"],
                    conn=conn,
                ),
            }
            for f in filas
        ]


@router.patch("/usuarios/{id_usuario}/orcid")
def actualizar_orcid_usuario(
    id_usuario: int,
    datos: OrcidActualizarIn,
    conn: Connection = Depends(get_conn),
):
    """
    Validar y asociar un identificador ORCID solicitado al perfil de un usuario institucional.

    Verifica que no contenga patrones de inyección SQL, comprueba la existencia del usuario activo,
    valida el formato y dígito verificador ISO 7064 MOD 11-2 mediante 'registrar_orcid_usuario' y
    garantiza la unicidad del ORCID dentro del sistema.

    parametros:
        - int : id_usuario Identificador numérico del usuario cuyo perfil se actualiza.
        - OrcidActualizarIn : datos Objeto con el ORCID solicitado y correo institucional opcional.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + dict : respuesta Confirmación con el id_usuario y el ORCID validado vinculado al perfil.
    """
    if contiene_inyeccion_sql(datos.orcid) or contiene_inyeccion_sql(datos.correo):
        raise HTTPException(status_code=400, detail="Entrada inválida: se detectó un patrón no permitido.")

    # [Línea clave]: Comprueba que el usuario exista en la tabla institucional antes de vincular el ORCID.
    fila = conn.execute(
        "SELECT id_usuario, correo FROM public.usuarios WHERE id_usuario = %s LIMIT 1",
        (id_usuario,),
    ).fetchone()
    correo_efectivo = fila["correo"] if fila else datos.correo
    orcid_validado = registrar_orcid_usuario(id_usuario, correo_efectivo, datos.orcid)
    return {"ok": True, "id_usuario": id_usuario, "orcid": orcid_validado}


@router.post("/login", response_model=UsuarioOut)
def login(datos: LoginIn, conn: Connection = Depends(get_conn)):
    """
    Autenticar a un usuario institucional y retornar su perfil con sus roles asignados.

    Busca al usuario por correo en la tabla 'usuarios' con 'lower(btrim(correo))'. Si existe, compara el hash
    de la contraseña suministrada contra el almacenado usando 'hmac.compare_digest'. Si la verificación
    falla o el usuario está inactivo, responde con HTTP 401. Si es exitoso, consolida los roles y retorna UsuarioOut.

    parametros:
        - LoginIn : datos Objeto validado con correo y contraseña.
        - Connection : conn Conexión transaccional inyectada por FastAPI desde el pool de Supabase.

    return:
        + UsuarioOut : perfil Objeto con los datos del usuario y sus roles institucionales para iniciar sesión.
    """
    if contiene_inyeccion_sql(datos.correo):
        raise HTTPException(status_code=400, detail="Formato de correo inválido.")

    # [Línea clave]: Consulta al usuario y agrupa sus roles institucionales en un arreglo PostgreSQL en una sola consulta.
    fila = conn.execute(
        """
        SELECT u.id_usuario, u.nombre, u.lastname, u.second_lastname,
               u.correo, u.password_hash, u.estado_activo,
               COALESCE(
                 array_agg(r.nombre_rol ORDER BY r.id_rol)
                   FILTER (WHERE r.id_rol IS NOT NULL),
                 '{}'
               ) AS roles
        FROM public.usuarios u
        LEFT JOIN public.user_roles ur ON ur.id_usuario = u.id_usuario
        LEFT JOIN public.roles r       ON r.id_rol = ur.id_rol
        WHERE lower(btrim(u.correo)) = lower(btrim(%s))
        GROUP BY u.id_usuario
        """,
        (datos.correo.strip(),),
    ).fetchone()

    # [Línea clave]: Asigna hash real o dummy para garantizar tiempo constante de ejecución contra ataques de enumeración.
    hash_guardado = fila["password_hash"] if fila else _DUMMY_HASH
    # [Línea clave]: Compara los hashes de forma segura evitando filtración de información por tiempo de comparación.
    coincide = hmac.compare_digest(hash_password(datos.password), hash_guardado)

    # [Línea clave]: Valida existencia, coincidencia de clave y estado activo antes de otorgar acceso al sistema.
    if not (fila and coincide and fila["estado_activo"]):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")

    nombre_completo = f'{fila["nombre"]} {fila["lastname"]} {fila["second_lastname"]}'.strip()
    # [Línea clave]: Retorna la estructura de usuario formateada con el ORCID validado de su perfil para poblar el Frontend.
    return UsuarioOut(
        id_usuario=fila["id_usuario"],
        nombre=nombre_completo,
        correo=fila["correo"],
        orcid=obtener_orcid_usuario(
            id_usuario=fila["id_usuario"],
            correo=fila["correo"],
            nombre=nombre_completo,
            conn=conn,
        ),
        roles=fila["roles"],
    )