"""
========================================================================================
ARCHIVO: backend/app/routers/auth.py
========================================================================================

2.1. OBJETIVO DEL ARCHIVO:
    Gestionar la autenticación segura de usuarios institucionales (investigadores, evaluadores,
    coordinadores y directores) mediante credenciales de acceso (correo y contraseña).

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA:
    2.2.1. De dónde obtiene datos:
           - Recibe el payload JSON con correo y contraseña enviado desde la Pantalla 01 de login
             en 'frontend/js/app.js' (función 'apiLogin').
           - Consulta la tabla 'public.usuarios', 'public.user_roles' y 'public.roles' en Supabase.
           - Obtiene la conexión activa desde 'app.db.get_conn'.
    2.2.2. A dónde envía datos:
           - Retorna al Frontend los datos del usuario autenticado ('id_usuario', 'nombre', 'correo',
             y lista de 'roles'), permitiendo establecer la sesión en 'state.user' y condicionar la interfaz.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?:
    Valida las credenciales de inicio de sesión utilizando hashing SHA-256 en hexadecimal y comparación
    resistente a ataques de temporización (timing attacks con 'hmac.compare_digest'). Si las credenciales
    coinciden y el usuario se encuentra activo, consolida sus roles institucionales y devuelve su perfil;
    en caso contrario, arroja una excepción HTTP 401 unificada.
========================================================================================
"""

import hashlib
import hmac

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection
from pydantic import BaseModel, Field

from ..db import get_conn

# [Línea clave]: Instancia el router bajo el prefijo /auth para agrupar las rutas de autenticación en la API.
router = APIRouter(prefix="/auth", tags=["auth"])


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
        * list[str] : roles Lista de nombres de roles institucionales que posee el usuario.
    """
    id_usuario: int
    nombre: str
    correo: str
    roles: list[str]


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

    # [Línea clave]: Retorna la estructura de usuario formateada para poblar el estado de la aplicación en el Frontend.
    return UsuarioOut(
        id_usuario=fila["id_usuario"],
        nombre=f'{fila["nombre"]} {fila["lastname"]} {fila["second_lastname"]}',
        correo=fila["correo"],
        roles=fila["roles"],
    )
