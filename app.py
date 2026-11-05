"""
2.1. OBJETIVO DEL ARCHIVO
Servir como módulo de integración directa con el SDK oficial de Supabase (`supabase-py`) mediante una aplicación ligera de verificación en Flask que carga las variables de entorno `SUPABASE_URL` y `SUPABASE_KEY` desde `.env`.

2.2. RELACIONES CON OTRAS PARTES DEL SISTEMA
2.2.1. De dónde obtiene datos:
- Variables de entorno cargadas desde `.env`: `SUPABASE_URL` y `SUPABASE_KEY` mediante `python-dotenv`.
- API REST de Supabase (`https://pxlrplbyggoywqbcgjdu.supabase.co`) a través de `create_client`.

2.2.2. A dónde envía datos:
- Respuesta HTML renderizada en la ruta raíz `/` al cliente HTTP o navegador.

2.3. ¿QUÉ HACE EL ARCHIVO A GROSO MODO?
Inicializa las variables de entorno con `load_dotenv()`, instancia la aplicación Flask y el cliente tipado `Client` de Supabase, y expone la ruta `/` que consulta registros de la tabla `todos` en Supabase y retorna el listado en formato HTML.
"""

import os
from flask import Flask
from supabase import create_client, Client
from dotenv import load_dotenv

# [Línea clave]: ¿Por qué soy importante? Cargo las variables definidas en el archivo `.env` al entorno del proceso. ¿Para qué? Para que `os.environ.get("SUPABASE_URL")` y `os.environ.get("SUPABASE_KEY")` estén disponibles sin quemar credenciales en el código. ¿Dónde me usan? Al iniciar este módulo antes de llamar a `create_client`.
load_dotenv()

# [Línea clave]: Instancia la aplicación web Flask para pruebas e integración directa con el cliente de Supabase.
app = Flask(__name__)

# [Línea clave]: ¿Por qué soy importante? Creo el cliente oficial de Supabase autenticado con la llave publicable del proyecto `pxlrplbyggoywqbcgjdu`. ¿Para qué? Para realizar consultas sobre las tablas expuestas por PostgREST en Supabase Cloud. ¿Dónde me usan? En la función de vista `index()`.
supabase: Client = create_client(
    os.environ.get("SUPABASE_URL"),
    os.environ.get("SUPABASE_KEY")
)


@app.route('/')
def index():
    """
    Consulta todos los registros de la tabla `todos` en Supabase y construye una lista HTML simple.

    parametros:
    Ninguno.

    return:
    + str : html
        Cadena HTML con el encabezado `<h1>Todos</h1>` y la lista `<ul>` de elementos recuperados desde Supabase.
    """
    # [Línea clave]: Ejecuta un `SELECT *` sobre la tabla `todos` empleando el cliente oficial de Supabase.
    response = supabase.table('todos').select("*").execute()
    todos = response.data

    html = '<h1>Todos</h1><ul>'
    for todo in todos:
        html += f'<li>{todo["name"]}</li>'
    html += '</ul>'

    return html


if __name__ == '__main__':
    # [Línea clave]: Inicia el servidor de desarrollo de Flask en modo depuración cuando se ejecuta directamente.
    app.run(debug=True)
