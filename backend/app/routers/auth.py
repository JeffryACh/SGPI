import hashlib
import hmac

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection
from pydantic import BaseModel, Field

from ..db import get_conn

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    correo: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=255)


class UsuarioOut(BaseModel):
    id_usuario: int
    nombre: str
    correo: str
    roles: list[str]


_DUMMY_HASH = hashlib.sha256(b"sin-usuario").hexdigest()


def hash_password(password: str) -> str:
    """SHA-256 en hexadecimal. Debe coincidir con el V2 (sha256 + hex)."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


@router.post("/login", response_model=UsuarioOut)
def login(datos: LoginIn, conn: Connection = Depends(get_conn)):
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
        WHERE lower(u.correo) = lower(%s)
        GROUP BY u.id_usuario
        """,
        (datos.correo.strip(),),
    ).fetchone()

    hash_guardado = fila["password_hash"] if fila else _DUMMY_HASH
    coincide = hmac.compare_digest(hash_password(datos.password), hash_guardado)

    # Mismo error para correo inexistente, contraseña incorrecta o usuario inactivo.
    if not (fila and coincide and fila["estado_activo"]):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")

    return UsuarioOut(
        id_usuario=fila["id_usuario"],
        nombre=f'{fila["nombre"]} {fila["lastname"]} {fila["second_lastname"]}',
        correo=fila["correo"],
        roles=fila["roles"],
    )