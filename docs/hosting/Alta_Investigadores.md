# 👥 Alta de investigadores en el directorio institucional (SGPI)

**Proyecto:** Sistema para la Gestión de Propuestas de Investigación (SGPI — Convocatoria Fondos VIE 2027)
**Institución:** Instituto Tecnológico de Costa Rica (TEC)
**Alcance:** alta de una persona investigadora que todavía no tiene cuenta en el SGPI, desde el modal de equipo de la **Pantalla 09**.

---

## 📌 1. Visión general del flujo

Hasta ahora, el buscador de equipo (`GET /auth/usuarios`) solo devolvía personas que ya existían en la tabla `usuarios`. Cuando la persona no aparecía, el frontend mostraba «Usuario no encontrado en el directorio institucional» o «Selecciona un investigador de la lista de búsqueda», lo que bloqueaba el armado del equipo.

Con este flujo:

1. La persona escribe un nombre o correo en el buscador del modal de equipo. Si la búsqueda no devuelve resultados, el buscador muestra **solo un aviso discreto en línea** («Sin coincidencias en el directorio institucional. Si la persona no tiene cuenta, pulsa *Guardar participante* para registrarla»), **sin abrir ningún panel**: es habitual teclear mal y el sistema no debe interrumpir mientras se escribe.
2. Al pulsar **«Guardar participante»** sin haber elegido a nadie del buscador, se abre el diálogo **«¿Desea agregar al investigador?»** con botones **No, cancelar** y **Sí, agregarlo**.
   - **No** cierra el diálogo y no modifica nada.
   - **Sí** abre el formulario de alta.
3. El formulario registra, en un solo paso: **nombre, apellidos, correo institucional, escuela/instancia, ORCID, rol en la propuesta, tipo de hora, dedicación (horas) y responsabilidad**.
4. Al guardar, el frontend llama `POST /auth/usuarios`:
   - el backend crea la cuenta real en `public.usuarios`,
   - le asigna el rol `Investigador` en `public.user_roles`,
   - registra y persiste el ORCID en `public.usuarios.identificacion_orcid` (migración **V18**),
   - genera la contraseña inicial y la entrega por correo (SMTP) o en la respuesta cuando no hay SMTP configurado.
5. La persona queda **sumada al equipo** de la propuesta con los datos de rol, tipo de hora, dedicación y responsabilidad elegidos.

Si la búsqueda **sí** encontró coincidencias y la persona no eligió ninguna, el sistema no ofrece el alta: muestra el aviso «Selecciona un investigador de la lista de búsqueda», porque la cuenta ya existe en el directorio.

> La IA **no** interviene en este flujo: los campos del formulario de alta están excluidos del autocompletado por IA (prefijo `modal:new-user-` en `AI_CAMPOS_SIN_IA`).

---

## 🧩 2. Componentes involucrados

| Componente | Archivo | Responsabilidad |
| :--- | :--- | :--- |
| Frontend (SPA) | `frontend/js/app.js` | Diálogo de confirmación, formulario de alta, llamada a la API y alta en el equipo |
| Backend (API) | `backend/app/routers/auth.py` | Endpoint `POST /auth/usuarios`, allowlist de dominios, generación de contraseña y persistencia del ORCID |
| Backend (correo) | `backend/app/correo.py` | Envío SMTP de las credenciales iniciales |
| Base de datos | `Base de datos/Scripts/V18__orcid_en_usuarios.sql` | Columna `usuarios.identificacion_orcid` + índice único parcial |

---

## 🛠️ 3. Requisito previo: migración V18

El ORCID de un investigador institucional se conservaba solo en memoria del proceso. La migración **V18** agrega la columna que lo persiste:

```sql
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS identificacion_orcid character varying;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_identificacion_orcid
  ON public.usuarios (identificacion_orcid)
  WHERE identificacion_orcid IS NOT NULL;
```

Pasos:

1. Abrir el **SQL Editor de Supabase** y ejecutar el script completo.
2. **Reiniciar el backend.** `backend/app/routers/auth.py` cachea la comprobación de la columna (`_ORCID_PERSISTENTE_DISPONIBLE`) al iniciar el proceso; sin reiniciar, el ORCID se sigue guardando solo en memoria.
3. Verificar:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'usuarios'
  AND column_name = 'identificacion_orcid';

SELECT id_usuario, correo, identificacion_orcid
FROM public.usuarios
WHERE identificacion_orcid IS NOT NULL;
```

> El script es idempotente: se puede reejecutar sin efectos adicionales. Si la migración aún no está aplicada, el endpoint sigue funcionando (el ORCID queda en memoria) y el resto del flujo no se rompe.

---

## ⚙️ 4. Variables de entorno

Se agregaron al `.env.example`, al `docker-compose.yml` y al `render.yaml`:

| Variable | Por defecto | Descripción |
| :--- | :--- | :--- |
| `DOMINIOS_CORREO_PERMITIDOS` | `tec.ac.cr` | Lista de dominios de correo autorizados para el alta, separados por coma. |
| `PASSWORD_DEMO` | *(vacío)* | Contraseña inicial fija de las cuentas nuevas. Vacío = contraseña aleatoria. Solo para demostraciones. |
| `SMTP_HOST` | *(vacío)* | Servidor SMTP. Si queda vacío, no se envía correo y la contraseña se devuelve en la respuesta. |
| `SMTP_PORT` | `587` | Puerto del servidor SMTP. |
| `SMTP_USER` | *(vacío)* | Usuario de autenticación SMTP. |
| `SMTP_PASS` | *(vacío)* | Contraseña del usuario SMTP. |
| `SMTP_FROM` | `no-reply@tec.ac.cr` | Remitente del correo con las credenciales. |
| `SMTP_TLS` | `1` | `1` habilita `STARTTLS`; `0` lo desactiva. |

### 4.1 Modo demostración (Gmail)

Para reproducir el flujo con una cuenta personal:

```dotenv
DOMINIOS_CORREO_PERMITIDOS=tec.ac.cr,gmail.com
PASSWORD_DEMO=demonstracion
```

Con `PASSWORD_DEMO=demonstracion`, la cuenta creada puede iniciar sesión en la Pantalla 01 con la contraseña `demostracion` (igual que las cuentas semilla del script `V2__llenado_de_usuarios.sql`).

### 4.2 Modo producción

```dotenv
DOMINIOS_CORREO_PERMITIDOS=tec.ac.cr
PASSWORD_DEMO=
SMTP_HOST=smtp.tec.ac.cr
SMTP_PORT=587
SMTP_USER=cuenta-del-sgpi
SMTP_PASS=...
SMTP_FROM=no-reply@tec.ac.cr
SMTP_TLS=1
```

En producción se deja `PASSWORD_DEMO` vacío: cada cuenta nueva recibe una contraseña aleatoria distinta (`secrets.token_urlsafe(12)`) que se envía únicamente por correo.

---

## 🔌 5. Endpoint `POST /auth/usuarios`

### 5.1 Solicitud

```http
POST /auth/usuarios
Content-Type: application/json
```

```json
{
  "nombre": "María",
  "lastname": "Solís",
  "second_lastname": "Ramírez",
  "correo": "maria.solis@tec.ac.cr",
  "id_escuela": 3,
  "orcid": "0000-0001-5109-3700"
}
```

| Campo | Tipo | Obligatorio | Reglas |
| :--- | :--- | :--- | :--- |
| `nombre` | string | Sí | 1–120 caracteres, sin patrones de inyección SQL. |
| `lastname` | string | Sí | 1–120 caracteres. |
| `second_lastname` | string | No | 0–120 caracteres; vacío si no se envía. |
| `correo` | string | Sí | Formato válido; el dominio debe estar en `DOMINIOS_CORREO_PERMITIDOS`; es único en el directorio. |
| `id_escuela` | int | No | Debe existir en `public.escuelas`. |
| `orcid` | string | Sí | 19 caracteres, formato `0000-0000-0000-000X`, válido bajo ISO 7064 MOD 11-2 y único en el directorio. |

> **La contraseña nunca viaja en el payload.** El cliente no define credenciales de terceros: el servidor genera la contraseña inicial.

### 5.2 Respuesta `201`

```json
{
  "id_usuario": 42,
  "nombre": "María Solís Ramírez",
  "correo": "maria.solis@tec.ac.cr",
  "orcid": "0000-0001-5109-3700",
  "escuela": "Escuela de Computación",
  "siglas_escuela": "COMP",
  "password_temporal": null,
  "correo_enviado": true,
  "estado_credencial": "enviado"
}
```

- Con SMTP configurado: `correo_enviado = true`, `password_temporal = null` (la credencial solo llega por correo).
- Sin SMTP configurado: `correo_enviado = false`, `estado_credencial = "sin_smtp"` y `password_temporal` trae la contraseña inicial para poder completar el flujo en el prototipo. El frontend la muestra en un aviso emergente.

### 5.3 Errores

| Código | Situación |
| :--- | :--- |
| `400` | Dominio de correo no autorizado, formato de correo inválido, ORCID inválido, escuela inexistente o patrón de inyección SQL detectado. |
| `409` | El correo ya está registrado en el directorio o el ORCID ya está asignado a otra persona. |

### 5.4 Efectos en la base de datos

1. `INSERT` en `public.usuarios` con `estado_activo = true` y el hash SHA-256 de la contraseña inicial.
2. `INSERT` en `public.user_roles` con el rol cuyo `nombre_rol` es `Investigador`.
3. `UPDATE` de `public.usuarios.identificacion_orcid` (migración V18), validado contra el índice único.
4. La persona queda disponible de inmediato para `GET /auth/usuarios` (el buscador filtra por rol `Investigador` y `estado_activo`).
5. El endpoint verifica que el ORCID quedó realmente guardado en `usuarios.identificacion_orcid`; si la escritura falla, responde `500` en lugar de devolver una cuenta cuyo ORCID se perdería al reiniciar el backend.

> El backend también conserva un registro en memoria de los ORCIDs verificados (`_ORCID_PERFIL_USUARIOS` y `_ORCID_PERFIL_CORREOS`). Ese registro se depura contra la base de datos: cuando una cuenta se elimina del directorio, su ORCID queda disponible de nuevo para otra persona.

---

## 🖥️ 6. Comportamiento en el frontend (Pantalla 09)

| Acción | Resultado |
| :--- | :--- |
| Búsqueda sin resultados | Muestra solo un aviso en línea bajo el buscador; **no** abre ningún panel. |
| Búsqueda con resultados | Muestra la lista de investigadores para que se elija uno. |
| «Guardar participante» sin elegir a nadie y sin coincidencias | Abre el diálogo «¿Desea agregar al investigador?». |
| «Guardar participante» sin elegir a nadie pero con coincidencias | Muestra el aviso «Selecciona un investigador de la lista de búsqueda»; no ofrece el alta porque la cuenta ya existe. |
| «No, cancelar» | Cierra el diálogo; no se crea nada. |
| «Sí, agregarlo» | Sustituye el diálogo por el formulario de alta. |
| «Registrar y agregar al equipo» | Valida en el navegador (campos obligatorios, ORCID, Injection SQL), llama `POST /auth/usuarios` y, si la creación es exitosa, agrega al miembro a `state.teamMembers`, cierra el modal y muestra el aviso. |
| Error del backend | El mensaje se muestra dentro del modal (`#new-user-feedback`) con el detalle devuelto por la API; el formulario permanece abierto para corregir. |

El frontend registra además el ORCID en el perfil local (`registrarOrcidEnPerfil`) para que los autocompletados posteriores de la aplicación lo reconozcan sin volver a consultar.

---

## ✅ 7. Verificación

### 7.1 Con `curl` (backend en `localhost:3001`)

```bash
# Alta de la cuenta de demostración
curl -X POST http://localhost:3001/auth/usuarios \
  -H "Content-Type: application/json" \
  -d '{"nombre":"María","lastname":"Solís","second_lastname":"Ramírez","correo":"lacayopicado2@gmail.com","id_escuela":3,"orcid":"0000-0001-5109-3700"}'

# Inicio de sesión con la contraseña de demostración
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"correo":"lacayopicado2@gmail.com","password":"demostracion"}'

# El ORCID persistido debe aparecer en la búsqueda
curl "http://localhost:3001/auth/usuarios?q=lacayopicado2"
```

Casos a comprobar:

- [x] Alta correcta (`201`) con la cuenta de demostración.
- [x] Inicio de sesión con la contraseña inicial.
- [x] Correo duplicado → `409`.
- [x] ORCID con formato inválido → `400`.
- [x] ORCID ya asignado → `409`.
- [x] Dominio no autorizado → `400`.
- [x] El ORCID persiste después de reiniciar el backend.

### 7.2 Crear una propuesta con la persona recién registrada

El endpoint `POST /propuestas` exige que cada integrante exista en `usuarios`, esté activo y tenga un ORCID válido. Con la cuenta creada desde el modal de equipo, la propuesta se crea sin errores:

```bash
curl -X POST http://localhost:3001/propuestas \
  -H "Content-Type: application/json" \
  -d '{"id_usuario_lider":1,"id_escuela":1,"id_modalidad":3,"id_linea_investigacion":1,"titulo":"Prueba de alta de investigador","resumen":"...","id_convocatoria":1,"fecha_inicio":"2027-01-01","fecha_fin":"2028-12-31","estado_inicial_nombre":"En formulación","equipo":[{"id_usuario":1,"id_tipo_hora":1,"horas_asignadas":12},{"correo":"lacayopicado2@gmail.com","id_tipo_hora":2,"horas_asignadas":4}],"objetivos":[{"codigo_objetivo":"OG","descripcion":"Objetivo general","orden":1}],"productos_academicos":[],"plan_accion":[],"riesgos":[],"presupuesto":[],"declaraciones_eticas":[]}'
```

Comprobaciones:

- [x] La propuesta se crea (`201`) con la persona nueva en `research_team`.
- [x] La fila de `research_team` guarda su `id_usuario`, su correo y el ORCID persistido.
- [x] Ya no se responde `400 «no corresponde a un usuario institucional activo»`.

### 7.3 En el navegador

- [x] Buscar un nombre inexistente en el modal de equipo → solo aparece un aviso en línea, sin panel.
- [x] «Guardar participante» → el diálogo «¿Desea agregar al investigador?» aparece.
- [x] «No» → el modal se cierra.
- [x] «Sí» → aparece el formulario de alta.
- [x] Registrar → la persona aparece en la lista de integrantes de la Pantalla 09 con rol, tipo de hora, horas y responsabilidad.
- [x] Los errores del backend se muestran dentro del modal.
- [x] Ningún campo del formulario de alta dispara la IA.

---

## 🔐 8. Seguridad y pendientes para producción

- [ ] **Restringir `POST /auth/usuarios` al rol administrativo.** La API todavía no emite token/JWT ni valida roles por endpoint, así que el alta es invocable sin credenciales. Mitigaciones activas: allowlist de dominios, ORCID válido y único obligatorio, correo único y contraseña generada por el servidor.
- [ ] **Migrar el hash de SHA-256 simple a Argon2/bcrypt/scrypt** (deuda ya anotada en `MDS - cambios/CHECKLIST_BACKEND.md`).
- [ ] **Cambiar la contraseña en el primer ingreso.** Hoy el correo pide el cambio, pero no existe endpoint de cambio de contraseña (`PATCH /usuarios/{id}/password` sigue en el backlog).
- [ ] **Registrar el alta en la bitácora de auditoría** (`proposal_state_history` no aplica aquí; haría falta un log de administración del directorio).
- [ ] **Revisar la allowlist con periodicidad**: `DOMINIOS_CORREO_PERMITIDOS` debe quedar en `tec.ac.cr` fuera de demostraciones.

---

## 📚 Referencias

- Bitácora de base de datos: `Base de datos/Cambios.md` (sección 9, migración V18).
- Estado real del backend: `MDS - cambios/CHECKLIST_BACKEND.md`.
- Migración: `Base de datos/Scripts/V18__orcid_en_usuarios.sql`.
- Guía de despliegue de la IA: `docs/hosting/Configuracion_Gemini_IA_y_Despliegue.md`.
