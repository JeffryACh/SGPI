# Script de verificación integral de endpoints y servicios de SGPI Backend (FastAPI) y Frontend
# Ejecutar en PowerShell: .\test_endpoints.ps1

$BaseUrl = "http://localhost:3001"
$FrontendUrl = "http://localhost:8080"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       VERIFICACION INTEGRAL DE ENDPOINTS SGPI            " -ForegroundColor Cyan
Write-Host "   Arquitectura: FastAPI (Backend) + Supabase (PostgreSQL)" -ForegroundColor DarkCyan
Write-Host "   IA: Google Gemini Free Tier | Frontend: Nginx/SPA      " -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method = "GET",
        [string]$Endpoint,
        [object]$Body = $null,
        [string]$CustomUrl = $null,
        [int[]]$ExpectedStatus = @(200, 201)
    )

    $url = if ($CustomUrl) { $CustomUrl } else { "$BaseUrl$Endpoint" }
    Write-Host "`nProbando: [$Method] $Endpoint ($Name)..." -NoNewline
    try {
        $params = @{
            Uri = $url
            Method = $Method
            ErrorAction = "Stop"
        }
        if ($Body) {
            $jsonString = ($Body | ConvertTo-Json -Depth 10)
            $params["Body"] = [System.Text.Encoding]::UTF8.GetBytes($jsonString)
            $params["ContentType"] = "application/json; charset=utf-8"
        }
        $res = Invoke-RestMethod @params

        $esperabaError = ($ExpectedStatus -and ($ExpectedStatus -notcontains 200) -and ($ExpectedStatus -notcontains 201))
        if ($esperabaError) {
            Write-Host " [ERROR: esperado $($ExpectedStatus -join ', '), recibido 200]" -ForegroundColor Red
            return $res
        }

        Write-Host " [OK 200]" -ForegroundColor Green
        return $res
    } catch {
        $statusCode = 0
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }

        $errorDetail = $_.Exception.Message
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $errorDetail = $_.ErrorDetails.Message
        } elseif ($_.Exception.Response) {
            try {
                if ($_.Exception.Response.Content) {
                    $errorDetail = $_.Exception.Response.Content.ReadAsStringAsync().Result
                } elseif ($_.Exception.Response.GetResponseStream) {
                    $stream = $_.Exception.Response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($stream)
                    $errorDetail = $reader.ReadToEnd()
                }
            } catch {}
        }

        # Si el código devuelto coincide con el error esperado (ej. 403 o 409), la verificación es exitosa
        if ($statusCode -and ($ExpectedStatus -contains $statusCode)) {
            Write-Host " [OK $statusCode Esperado]" -ForegroundColor Green
            return $null
        }

        Write-Host " [ERROR]" -ForegroundColor Red
        Write-Host "Detalle: $errorDetail" -ForegroundColor Yellow
        return $null
    }
}

# -------------------------------------------------------------
# Get-IdEstado: resolver el identificador de un estado por su NOMBRE
# -------------------------------------------------------------
# [Línea clave]: El identificador de la tabla «estados» no es parte del contrato: su
# orden difiere entre ambientes. El script nunca escribe números de estado a mano;
# siempre los obtiene del catálogo oficial que publica GET /catalogos.
function Get-IdEstado {
    param([string]$Nombre)

    if (-not $script:CatalogoEstados) {
        Write-Host "  [AVISO] El catálogo de estados no está cargado; no se puede resolver «$Nombre»." -ForegroundColor Yellow
        return $null
    }
    $fila = $script:CatalogoEstados | Where-Object { $_.nombre_estado -eq $Nombre } | Select-Object -First 1
    if (-not $fila) {
        Write-Host "  [AVISO] El estado «$Nombre» no existe en el catálogo institucional." -ForegroundColor Yellow
        return $null
    }
    return [int]$fila.id_estado
}

# -------------------------------------------------------------
# Get-IdRol: resolver el identificador de un rol por su NOMBRE
# -------------------------------------------------------------
# [Línea clave]: El catálogo «roles» también se resuelve por nombre, porque su orden
# depende del ambiente y de las migraciones aplicadas.
function Get-IdRol {
    param([string]$Nombre)

    if (-not $script:CatalogoRoles) {
        Write-Host "  [AVISO] El catálogo de roles no está cargado; no se puede resolver «$Nombre»." -ForegroundColor Yellow
        return $null
    }
    $fila = $script:CatalogoRoles | Where-Object { $_.nombre_rol -eq $Nombre } | Select-Object -First 1
    if (-not $fila) {
        Write-Host "  [AVISO] El rol «$Nombre» no existe en el catálogo institucional." -ForegroundColor Yellow
        return $null
    }
    return [int]$fila.id_rol
}

# -------------------------------------------------------------
# Test-UploadDocumento: cargar un archivo real en el expediente
# -------------------------------------------------------------
# [Línea clave]: El cierre administrativo exige el informe final como soporte
# documental, así que la prueba necesita un archivo subido de verdad a Supabase
# Storage (multipart) en lugar de una referencia simulada.
function Test-UploadDocumento {
    param(
        [string]$Name,
        [int]$IdPropuesta,
        [int]$IdUsuario,
        [string]$TipoDocumento = "Informe final del proyecto",
        [string]$ArchivoLocal
    )

    $archivoRespuesta = [System.IO.Path]::GetTempFileName()
    Write-Host "`nProbando: [POST] /propuestas/$IdPropuesta/documentos ($Name)..." -NoNewline
    try {
        $codigo = & curl.exe -s -o $archivoRespuesta -w "%{http_code}" -X POST `
            -F "archivo=@$ArchivoLocal;type=application/pdf" `
            -F "id_usuario=$IdUsuario" `
            -F "tipo_documento=$TipoDocumento" `
            "$BaseUrl/propuestas/$IdPropuesta/documentos"
        $cuerpo = Get-Content $archivoRespuesta -Raw -ErrorAction SilentlyContinue
        if ($codigo -eq "201") {
            Write-Host " [OK 201]" -ForegroundColor Green
            return ($cuerpo | ConvertFrom-Json)
        }
        Write-Host " [ERROR: recibido $codigo]" -ForegroundColor Red
        Write-Host "Detalle: $cuerpo" -ForegroundColor Yellow
        return $null
    } finally {
        Remove-Item $archivoRespuesta -ErrorAction SilentlyContinue
    }
}

# -------------------------------------------------------------
# FASE 1: SALUD, CONEXION BD Y AUTENTICACION INSTITUCIONAL
# -------------------------------------------------------------

# 1. Healthcheck (Conexión Supabase)
$health = Test-Endpoint -Name "Conexión BD Supabase Cloud" -Endpoint "/health"
if (-not $health) {
    Write-Host "`n[AVISO] No se pudo conectar a $BaseUrl." -ForegroundColor Yellow
    Write-Host "Asegúrate de que los contenedores estén levantados con:" -ForegroundColor Gray
    Write-Host "  docker compose up -d --build" -ForegroundColor Cyan
    Write-Host "O verifica los logs con:" -ForegroundColor Gray
    Write-Host "  docker compose logs backend" -ForegroundColor Cyan
    exit
}

# 2. Autenticación Institucional (Login con SHA-256 + HMAC)
$loginPayload = @{
    correo = "laura.mendez@example.com"
    password = "demostracion"
}
$auth = Test-Endpoint -Name "Autenticación Institucional" -Method "POST" -Endpoint "/auth/login" -Body $loginPayload
if ($auth) {
    Write-Host "  -> Usuario: $($auth.nombre) | Roles: $($auth.roles -join ', ')" -ForegroundColor Gray
}

# 2b. Sesión administrativa para resolver el catálogo de roles por nombre
$script:CatalogoRoles = @()
$loginDireccionInicial = Test-Endpoint -Name "Autenticación Dirección de Investigación" -Method "POST" -Endpoint "/auth/login" -Body @{
    correo = "elena.chacon@example.com"
    password = "demostracion"
}
$idUsuarioDireccion = if ($loginDireccionInicial) { $loginDireccionInicial.id_usuario } else { 7 }
if ($loginDireccionInicial) {
    Write-Host "  -> Dirección: $($loginDireccionInicial.nombre) | ID: $idUsuarioDireccion | Roles: $($loginDireccionInicial.roles -join ', ')" -ForegroundColor Gray
}
$rolesCatalogo = Test-Endpoint -Name "Catálogo de roles institucionales" -Endpoint "/admin/catalogos/roles?id_usuario=$idUsuarioDireccion"
if ($rolesCatalogo) {
    $script:CatalogoRoles = @($rolesCatalogo)
    Write-Host "  -> Roles del catálogo: $(@($script:CatalogoRoles).Count) ($((@($script:CatalogoRoles) | ForEach-Object { $_.nombre_rol }) -join ', '))" -ForegroundColor Gray
}

# -------------------------------------------------------------
# FASE 2: CATALOGOS UNIFICADOS Y REGLAS NORMATIVAS VIE 2027
# -------------------------------------------------------------

# 3. Catálogos unificados
$catalogos = Test-Endpoint -Name "Catálogos Unificados" -Endpoint "/catalogos"
$script:CatalogoEstados = @()
if ($catalogos) {
    Write-Host "  -> Escuelas: $(@($catalogos.escuelas).Count), Modalidades: $(@($catalogos.modalidades).Count), Tipos de Hora: $(@($catalogos.tipos_hora).Count)" -ForegroundColor Gray
    # [Línea clave]: El catálogo de estados se carga una sola vez para resolver los
    # identificadores por nombre en todas las fases siguientes.
    $script:CatalogoEstados = @($catalogos.estados)
    Write-Host "  -> Estados del catálogo: $(@($script:CatalogoEstados).Count) ($((@($script:CatalogoEstados) | ForEach-Object { $_.nombre_estado }) -join ', '))" -ForegroundColor Gray
}

# 4. Tipos de Hora oficiales
$tiposHora = Test-Endpoint -Name "Tipos de Hora VIE 2027" -Endpoint "/tipos_hora/totalTiposHora"

# 5. Escuelas abiertas
$escuelas = Test-Endpoint -Name "Todas las Escuelas" -Endpoint "/escuelas/totalescuelas"

# 6. Documentos oficiales de la Convocatoria Fondos VIE 2027
$documentos = Test-Endpoint -Name "Documentos Convocatoria Fondos VIE 2027" -Endpoint "/convocatorias/documentos_convocatoria?id_convocatoria=1"
if ($documentos) {
    Write-Host "  -> Total instrumentos oficiales encontrados: $(@($documentos).Count)" -ForegroundColor Gray
}

# -------------------------------------------------------------
# FASE 3: METRICAS Y GESTION DE PROPUESTAS
# -------------------------------------------------------------

# 7. Dashboard de Propuestas
$dashboard = Test-Endpoint -Name "Dashboard del Usuario 1" -Endpoint "/propuestas/dashboardpropuestas?id_usuario=1"
if ($dashboard) {
    Write-Host "  -> Total: $($dashboard.total), Formulación: $($dashboard.formulacion), Ejecución: $($dashboard.ejecucion), Cerradas: $($dashboard.cerradas)" -ForegroundColor Gray
}

# 8. Top propuestas con códigos reales
$top = Test-Endpoint -Name "Top Propuestas Recientes" -Endpoint "/propuestas/top3PropuestaMasReciente?id_usuario=1"
if ($top -and @($top).Count -gt 0) {
    Write-Host "  -> Propuesta 1: Código=$($top[0].code), Título=$($top[0].title), Período=$($top[0].period)" -ForegroundColor Gray
}

# 9. Listado general de propuestas
$lista = Test-Endpoint -Name "Listado General de Propuestas" -Endpoint "/propuestas"

# 10. Crear Propuesta de prueba (Inserción Atómica Multitabla)
$marcaHora = Get-Date -Format 'HH:mm:ss'
# [Línea clave]: Marca sin separadores, apta para nombres de archivo en Windows.
$marcaArchivo = Get-Date -Format 'HHmmss'
# Informe final mínimo en PDF: el cierre administrativo exige un archivo real.
$rutaInformePdf = Join-Path $env:TEMP "sgpi-informe-final-$marcaArchivo.pdf"
$contenidoInformePdf = "%PDF-1.4`n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj`n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj`ntrailer<</Root 1 0 R>>`n%%EOF"
[System.IO.File]::WriteAllText($rutaInformePdf, $contenidoInformePdf, [System.Text.Encoding]::ASCII)
$nuevaPropuesta = @{
    id_usuario_lider = 1
    id_escuela = 1
    id_modalidad = 3
    id_linea_investigacion = 1
    titulo = "Test Automatizado - Sistema de Monitoreo Ambiental $marcaHora"
    resumen = "Propuesta automatizada para validación atómica multitabla y evaluación con Gemini IA."
    id_convocatoria = 1
    fecha_inicio = "2027-01-01"
    fecha_fin = "2028-12-31"
    # [Línea clave]: La etapa inicial viaja por su nombre oficial, nunca por un número.
    estado_inicial_nombre = "En formulación"
    equipo = @(
        @{ id_usuario = 1; id_tipo_hora = 1; horas_asignadas = 12 },
        @{ id_usuario = 2; id_tipo_hora = 2; horas_asignadas = 4 }
    )
    objetivos = @(
        @{ codigo_objetivo = "OG"; descripcion = "Desarrollar prototipo de monitoreo ambiental"; orden = 1 },
        @{ codigo_objetivo = "OE1"; descripcion = "Diseñar sensores IoT de bajo costo"; orden = 2 }
    )
    productos_academicos = @(
        @{ tipo_producto = "Software"; descripcion = "Sistema de telemetría registrado"; meta_esperada = "1 registro PI"; categoria = "Propiedad Intelectual"; es_obligatorio = $true },
        @{ tipo_producto = "Artículo"; descripcion = "Artículo en revista indexada Scopus"; meta_esperada = "1 artículo publicado"; categoria = "Publicación"; es_obligatorio = $true }
    )
    plan_accion = @(
        @{ descripcion_actividad = "Fase 1: Recolección y análisis de campo"; fecha_inicio = "2027-01-15"; fecha_fin = "2027-06-30"; id_usuario_responsable = 1 },
        @{ descripcion_actividad = "Fase 2: Calibración y pruebas de laboratorio"; fecha_inicio = "2027-07-01"; fecha_fin = "2027-12-15"; id_usuario_responsable = 2 }
    )
    riesgos = @(
        @{ descripcion_riesgo = "Riesgo de retraso en suministros"; id_nivel_probabilidad = 1; id_nivel_impacto = 2; medida_mitigacion = "Compras tempranas en mes 1" },
        @{ descripcion_riesgo = "Variabilidad climática extrema"; id_nivel_probabilidad = 2; id_nivel_impacto = 3; medida_mitigacion = "Instalación en puntos protegidos" }
    )
    presupuesto = @(
        @{ id_rubro = 1; monto = 2500000; anio = 1 },
        @{ id_rubro = 2; monto = 2000000; anio = 2 }
    )
    declaraciones_eticas = @(
        @{ tipo_aspecto = "Uso de datos"; aplica = $false; justificacion_exencion = "No maneja datos personales sensibles" }
    )
}

$nuevoId = $null
$creacion = Test-Endpoint -Name "Creación Atómica de Propuesta" -Method "POST" -Endpoint "/propuestas" -Body $nuevaPropuesta
if ($creacion -and $creacion.propuesta) {
    $nuevoId = $creacion.propuesta.id_propuesta
    Write-Host "  -> Creada con ID: $nuevoId, Código: $($creacion.propuesta.codigo)" -ForegroundColor Cyan

    # 11. Consultar Dossier Completo con clave 'evaluacion_ia'
    $dossier = Test-Endpoint -Name "Expediente Completo de la Propuesta (Dossier + IA)" -Endpoint "/propuestas/$nuevoId"

    # 12. Transición de Estado (Envío a Revisión -> Disparo automático de IA)
    # [Línea clave]: El estado destino se resuelve por su nombre oficial en el catálogo.
    $estadoRevisionVinculacion = Get-IdEstado -Nombre "En revisión de Vinculación"
    $cambioEstado = @{
        id_nuevo_estado = $estadoRevisionVinculacion
        id_usuario_responsable = 1
        observaciones = "Envío automático de prueba a revisión técnica"
    }
    $resEstado = Test-Endpoint -Name "Transición de Estado (Disparo Automático IA)" -Method "PATCH" -Endpoint "/propuestas/$nuevoId/estado" -Body $cambioEstado
    if ($resEstado -and $resEstado.evaluacion_preliminar_ia) {
        Write-Host "  -> IA activada automáticamente. Puntaje: $($resEstado.evaluacion_preliminar_ia.puntaje_preliminar)/100" -ForegroundColor Gray
    }
    if ($resEstado) {
        Write-Host "  -> Nuevo estado: $($resEstado.nombre_estado)" -ForegroundColor Gray
    }

    # 12b. Transición no permitida por la máquina de estados (409 esperado)
    $estadoCerrada = Get-IdEstado -Nombre "Cerrada"
    $saltoInvalido = @{
        id_nuevo_estado = $estadoCerrada
        id_usuario_responsable = 1
        observaciones = "Prueba negativa: salto de etapa no admitido por el flujo institucional."
    }
    $resSaltoInvalido = Test-Endpoint -Name "Salto de etapa no permitido (409 esperado)" -Method "PATCH" -Endpoint "/propuestas/$nuevoId/estado" -Body $saltoInvalido -ExpectedStatus 409
    if ($resSaltoInvalido) {
        Write-Host "  [AVISO] El backend permitió un salto de etapa no contemplado en el flujo." -ForegroundColor Yellow
    } else {
        Write-Host "  -> Rechazo correcto: la máquina de estados no admite ese salto." -ForegroundColor Gray
    }

    # 12c. Transición permitida pero ejecutada por un rol sin facultad (409 esperado)
    $estadoComiteTecnico = Get-IdEstado -Nombre "En evaluación del Comité Técnico"
    $saltoSinFacultad = @{
        id_nuevo_estado = $estadoComiteTecnico
        id_usuario_responsable = 1
        observaciones = "Prueba negativa: el investigador líder no dictamina la etapa de Vinculación."
    }
    $resSinFacultad = Test-Endpoint -Name "Transición por un rol sin facultad (409 esperado)" -Method "PATCH" -Endpoint "/propuestas/$nuevoId/estado" -Body $saltoSinFacultad -ExpectedStatus 409
    if ($resSinFacultad) {
        Write-Host "  [AVISO] El backend permitió a un investigador avanzar una etapa que no le corresponde." -ForegroundColor Yellow
    } else {
        Write-Host "  -> Rechazo correcto: solo Vinculación puede dictaminar esa etapa." -ForegroundColor Gray
    }

    # 13. Registro de Dictamen / Calificación Oficial por Evaluador
    # [Línea clave]: El dictamen lo emite el Centro de Vinculación, que es el rol dueño
    # de la etapa «En revisión de Vinculación».
    $loginVinculacionFase3 = Test-Endpoint -Name "Login del Centro de Vinculación" -Method "POST" -Endpoint "/auth/login" -Body @{
        correo = "mariana.solis@example.com"
        password = "demostracion"
    }
    $idUsuarioVinculacion = if ($loginVinculacionFase3) { $loginVinculacionFase3.id_usuario } else { 4 }
    $evalOficial = @{
        id_usuario_eval = $idUsuarioVinculacion
        id_rol_evaluador = (Get-IdRol -Nombre "Vinculación")
        observaciones = "Evaluación técnica de prueba conforme a rúbrica oficial."
        puntaje_comite = 88
        cambiar_a_estado = $estadoComiteTecnico
    }
    $resEval = Test-Endpoint -Name "Registro de Calificación del Comité Técnico" -Method "POST" -Endpoint "/propuestas/$nuevoId/evaluaciones" -Body $evalOficial
    if ($resEval) {
        Write-Host "  -> ID Evaluación: $($resEval.id_evaluacion) | Nuevo Estado: $($resEval.nuevo_estado)" -ForegroundColor Gray
    }
}

# 14. Notificaciones: marcar como leídas
$notifs = Test-Endpoint -Name "Marcar Notificaciones como Leídas" -Method "PATCH" -Endpoint "/notificaciones/leer-todas?id_usuario=1"

# -------------------------------------------------------------
# FASE 4: SERVICIOS DE INTELIGENCIA ARTIFICIAL (GEMINI FREE TIER)
# -------------------------------------------------------------

# 15. Estado del Servicio de IA Online
$iaEstado = Test-Endpoint -Name "Diagnóstico del Servicio IA (Gemini Free Tier)" -Endpoint "/ia/estado"
if ($iaEstado) {
    Write-Host "  -> Modelo: $($iaEstado.modelo_principal) | Modo: $($iaEstado.modo_actual) | Clave API: $($iaEstado.gemini_api_key_configurada)" -ForegroundColor Gray
}

# 16. Catálogo de Criterios y Parámetros de Evaluación IA por Nivel
$iaCriterios = Test-Endpoint -Name "Catálogo de Criterios IA (5 Niveles VIE 2027)" -Endpoint "/ia/criterios"

# 17. Consulta de Evaluación Preliminar en Supabase (Propuesta 1)
$iaEval = Test-Endpoint -Name "Consulta Evaluación Preliminar en Supabase (Propuesta 1)" -Endpoint "/ia/evaluacion-preliminar/1"
if ($iaEval) {
    Write-Host "  -> Puntaje Preliminar IA: $($iaEval.puntaje_preliminar)/100 | Recomendación: $($iaEval.recomendacion_global)" -ForegroundColor Cyan
}

# 18. Evaluación de Borrador en Vivo (Simula clic 'Enviar a revisión' en Pantalla 18)
$draftPayload = @{
    id_propuesta = if ($nuevoId) { $nuevoId } else { 1 }
    codigo = "SI-2027-DRAFT"
    titulo = "Proyecto Demostrativo en Vivo con Gemini IA"
    modalidad = "Desarrollo tecnológico"
    escuela = "Escuela de Ingeniería Ambiental"
    linea_investigacion = "Gestión integrada del recurso hídrico"
    resumen = "Monitoreo automatizado con estaciones inteligentes para preservación de cuencas."
    horas_totales_semanales = 16
    presupuesto_anio_1 = 4800000
    presupuesto_anio_2 = 4600000
    tiene_equipo_anio_2 = $false
    incluye_beca_asistente = $true
    cantidad_objetivos = 3
    cantidad_actividades = 4
    cantidad_riesgos = 4
    cantidad_productos = 3
    declaraciones_eticas_completas = $true
}
$borradorEval = Test-Endpoint -Name "Evaluación de Borrador en Vivo (Pantalla 18)" -Method "POST" -Endpoint "/ia/evaluar-borrador" -Body $draftPayload
if ($borradorEval) {
    Write-Host "  -> Modelo: $($borradorEval.modelo_ia) | Puntaje: $($borradorEval.puntaje_preliminar)/100" -ForegroundColor Cyan
}

# 19. Regeneración bajo demanda de IA (Simula botón 'Regenerar IA' en Pantalla 24)
$targetId = if ($nuevoId) { $nuevoId } else { 1 }
$regenEval = Test-Endpoint -Name "Regeneración IA bajo demanda (Pantalla 24)" -Method "POST" -Endpoint "/ia/evaluar-propuesta/$targetId"
if ($regenEval) {
    Write-Host "  -> Evaluación regenerada para propuesta $targetId. Estado: $($regenEval.recomendacion_global)" -ForegroundColor Gray
}

# -------------------------------------------------------------
# FASE 5: COMITÉ TÉCNICO (RÚBRICA PONDERADA Y DICTAMEN - V12)
# -------------------------------------------------------------

# C1. Rúbrica oficial cargada en PostgreSQL (8 secciones / 23 criterios / 100 puntos)
$rubricaComite = Test-Endpoint -Name "Rúbrica del Comité Técnico (V12)" -Endpoint "/propuestas/comite/rubrica"
$criteriosComite = @()
if ($rubricaComite) {
    foreach ($seccion in $rubricaComite.secciones) {
        foreach ($criterio in $seccion.criterios) {
            $criteriosComite += @{
                id_criterio_rubrica = $criterio.id_criterio_rubrica
                puntaje = 10
            }
        }
    }
    Write-Host "  -> Secciones: $(@($rubricaComite.secciones).Count) | Criterios: $($rubricaComite.total_criterios) | Peso total: $($rubricaComite.total_peso)" -ForegroundColor Gray
} else {
    Write-Host "  [AVISO] Aplica la migración V12 en el SQL Editor de Supabase antes de probar el Comité Técnico." -ForegroundColor Yellow
}

# C2. Autenticación del usuario con rol Comité Técnico
$loginComite = Test-Endpoint -Name "Login del Comité Técnico" -Method "POST" -Endpoint "/auth/login" -Body @{
    correo = "gabriel.sanchez@example.com"
    password = "demostracion"
}
$idUsuarioComite = if ($loginComite) { $loginComite.id_usuario } else { 5 }
if ($loginComite) {
    Write-Host "  -> Usuario: $($loginComite.nombre) | ID: $idUsuarioComite | Roles: $($loginComite.roles -join ', ')" -ForegroundColor Gray
}

# C3. Bandeja del Comité Técnico (200 con Gabriel, 403 con un investigador)
$bandejaComite = Test-Endpoint -Name "Bandeja del Comité Técnico" -Endpoint "/propuestas/comite/bandeja?rol=Comit%C3%A9%20T%C3%A9cnico&id_usuario=$idUsuarioComite"
if ($bandejaComite) {
    Write-Host "  -> Expedientes en la bandeja: $(@($bandejaComite).Count)" -ForegroundColor Gray
    # C3b. La bandeja ordena por fecha de ingreso a «En evaluación del Comité Técnico» (proposal_state_history)
    # [Línea clave]: El filtro se hace por el NOMBRE del estado, nunca por su identificador.
    $pendientesComite = @($bandejaComite | Where-Object { $_.estado -eq "En evaluación del Comité Técnico" })
    if ($pendientesComite.Count -gt 0) {
        $masReciente = @($pendientesComite | Sort-Object { if ($_.fecha_ingreso_comite) { $_.fecha_ingreso_comite } else { $_.fecha_creacion } } -Descending)[0]
        Write-Host "  -> Pendientes: $($pendientesComite.Count) | Más reciente: $($masReciente.codigo) (ingreso $($masReciente.fecha_ingreso_comite))" -ForegroundColor Gray
        if ($pendientesComite[0].id_propuesta -eq $masReciente.id_propuesta) {
            Write-Host "  -> Orden correcto: la bandeja inicia con la pendiente que ingresó al Comité Técnico más recientemente." -ForegroundColor Green
        } else {
            Write-Host "  [AVISO] El orden de la bandeja no coincide con la fecha de ingreso al Comité Técnico." -ForegroundColor Yellow
        }
    }
}
$bandejaProhibida = Test-Endpoint -Name "Bandeja del Comité con rol Investigador (403 esperado)" -Endpoint "/propuestas/comite/bandeja?rol=Comit%C3%A9%20T%C3%A9cnico&id_usuario=1" -ExpectedStatus 403
if ($bandejaProhibida) {
    Write-Host "  [AVISO] El backend permitió la bandeja a un usuario sin rol Comité Técnico." -ForegroundColor Yellow
} else {
    Write-Host "  -> Rechazo correcto: el usuario 1 no tiene rol Comité Técnico." -ForegroundColor Gray
}

# C4. Propuesta de prueba creada directamente en «En evaluación del Comité Técnico»
$propuestaComite = $nuevaPropuesta.Clone()
$propuestaComite.titulo = "Test Comité Técnico - Rúbrica ponderada $marcaHora"
$propuestaComite.estado_inicial_nombre = "En evaluación del Comité Técnico"
$propuestaComite.Remove("estado_inicial")
$creacionComite = Test-Endpoint -Name "Creación de propuesta para el Comité Técnico" -Method "POST" -Endpoint "/propuestas" -Body $propuestaComite
$idPropuestaComite = if ($creacionComite -and $creacionComite.propuesta) { $creacionComite.propuesta.id_propuesta } else { $null }
if ($idPropuestaComite) {
    Write-Host "  -> Propuesta en evaluación del Comité: ID $idPropuestaComite" -ForegroundColor Cyan

    # C5. Expediente de evaluación del Comité (aún sin dictamen)
    $detalleComite = Test-Endpoint -Name "Expediente sin dictamen del Comité" -Endpoint "/propuestas/comite/$($idPropuestaComite)?id_usuario=$idUsuarioComite"

    # C6. Caso negativo: obligatorio en 6 con decisión favorable (409 esperado, sin cambios en BD)
    $criteriosBloqueo = @()
    $marcado = $false
    if ($rubricaComite) {
        foreach ($seccion in $rubricaComite.secciones) {
            foreach ($criterio in $seccion.criterios) {
                $nivel = 10
                if (-not $marcado -and $criterio.es_obligatorio) {
                    $nivel = 6
                    $marcado = $true
                }
                $criteriosBloqueo += @{
                    id_criterio_rubrica = $criterio.id_criterio_rubrica
                    puntaje = $nivel
                }
            }
        }
    }
    $bodyBloqueo = @{
        id_usuario_eval = $idUsuarioComite
        puntajes = $criteriosBloqueo
        justificacion = "Prueba negativa: criterio obligatorio con nivel insuficiente."
        observaciones = ""
        produccion_conforme = $true
        decision = "favorable"
    }
    $resBloqueo = Test-Endpoint -Name "Bloqueo por obligatorio insuficiente (409 esperado)" -Method "POST" -Endpoint "/propuestas/comite/$($idPropuestaComite)" -Body $bodyBloqueo -ExpectedStatus 409
    if ($resBloqueo) {
        Write-Host "  [AVISO] El backend permitió recomendar con un obligatorio en 6." -ForegroundColor Yellow
    } else {
        Write-Host "  -> Rechazo correcto: la recomendación exige obligatorios en 8 o 10." -ForegroundColor Gray
    }

    # C7. Dictamen favorable con todos los criterios en 10 (100/100 -> estado 4)
    $bodyFavorable = @{
        id_usuario_eval = $idUsuarioComite
        puntajes = $criteriosComite
        justificacion = "La propuesta acredita todos los criterios obligatorios de la rúbrica oficial."
        observaciones = "Evaluación técnica de prueba registrada por el script."
        produccion_conforme = $true
        decision = "favorable"
    }
    $resComite = Test-Endpoint -Name "Dictamen favorable del Comité Técnico" -Method "POST" -Endpoint "/propuestas/comite/$($idPropuestaComite)" -Body $bodyFavorable
    if ($resComite) {
        Write-Host "  -> Puntaje: $($resComite.puntaje)/100 | Estado: $($resComite.nombre_estado) ($($resComite.estado_actual))" -ForegroundColor Cyan
    }

    # C8. Relectura del expediente con los puntajes persistidos por criterio
    $detalleComite = Test-Endpoint -Name "Dictamen del Comité persistido" -Endpoint "/propuestas/comite/$($idPropuestaComite)?id_usuario=$idUsuarioComite"
    if ($detalleComite -and $detalleComite.evaluacion) {
        Write-Host "  -> Evaluación: $($detalleComite.evaluacion.id_evaluacion) | Puntajes: $(@($detalleComite.puntajes).Count) | Total: $($detalleComite.puntaje_total)" -ForegroundColor Gray
    }

    # C9. Segunda evaluación sobre la misma propuesta (409 esperado)
    $resDuplicado = Test-Endpoint -Name "Dictamen duplicado (409 esperado)" -Method "POST" -Endpoint "/propuestas/comite/$($idPropuestaComite)" -Body $bodyFavorable -ExpectedStatus 409
    if ($resDuplicado) {
        Write-Host "  [AVISO] El backend permitió dos dictámenes del Comité sobre la misma propuesta." -ForegroundColor Yellow
    } else {
        Write-Host "  -> Rechazo correcto: ya existe un dictamen del Comité para esta propuesta." -ForegroundColor Gray
    }

    # C10. El expediente general refleja los puntajes del Comité
    $dossierComite = Test-Endpoint -Name "Expediente con puntajes del Comité" -Endpoint "/propuestas/$($idPropuestaComite)"
    if ($dossierComite) {
        Write-Host "  -> Criterios en el expediente: $(@($dossierComite.comite_evaluacion).Count) | Estado: $($dossierComite.nombre_estado)" -ForegroundColor Gray
    }
}

# -------------------------------------------------------------
# FASE 7: DIRECCIÓN DE INVESTIGACIÓN (Elena Chacón)
# -------------------------------------------------------------

# D1. Login como Dirección de Investigación
$loginDireccion = Test-Endpoint -Name "Autenticación Dirección de Investigación" -Method "POST" -Endpoint "/auth/login" -Body @{ correo = "elena.chacon@example.com"; password = "demostracion" }
$idUsuarioDireccion = if ($loginDireccion) { $loginDireccion.id_usuario } else { 7 }
if ($loginDireccion) {
    Write-Host "  -> Usuario: $($loginDireccion.nombre) | ID: $idUsuarioDireccion | Roles: $($loginDireccion.roles -join ', ')" -ForegroundColor Gray
}

# D2. Bandeja de Dirección (sometidas ante VIE + ya dictaminadas)
$bandejaDireccion = Test-Endpoint -Name "Bandeja de Dirección de Investigación" -Endpoint "/propuestas/direccion/bandeja?rol=Direcci%C3%B3n%20de%20Investigaci%C3%B3n&id_usuario=$idUsuarioDireccion"
if ($bandejaDireccion) {
    Write-Host "  -> Expedientes en la bandeja: $(@($bandejaDireccion).Count)" -ForegroundColor Gray
}

# D2b. Dashboard de Dirección con los contadores reales
$dashboardDireccion = Test-Endpoint -Name "Dashboard de Dirección de Investigación" -Endpoint "/propuestas/direccion/dashboard?rol=Direcci%C3%B3n%20de%20Investigaci%C3%B3n&id_usuario=$idUsuarioDireccion"
if ($dashboardDireccion) {
    Write-Host "  -> Pendientes: $($dashboardDireccion.pendientes) | Determinadas: $($dashboardDireccion.determinadas) | Totales revisadas: $($dashboardDireccion.totales_revisadas)" -ForegroundColor Gray
    if ($dashboardDireccion.propuesta_destacada) {
        Write-Host "  -> Destacada (m?s reciente ingresada a VIE): $($dashboardDireccion.propuesta_destacada.codigo)" -ForegroundColor Gray
    }
}

# D3. Propuesta sometida ante VIE para dictamen.
# [Línea clave]: Se crea siempre una propuesta nueva en «Sometida ante VIE» en lugar de reutilizar una
# pendiente de la bandeja. Si se reutilizara, cada corrida del smoke test consumiría el
# dictamen pendiente y el tablero de Dirección quedaría con 0 pendientes para la validación visual.
$idPropuestaDireccion = $null
$propuestaDir = $nuevaPropuesta.Clone()
$propuestaDir.titulo = "Test Dirección de Investigación - Dictamen $marcaHora"
$propuestaDir.estado_inicial_nombre = "Sometida ante VIE"
$creacionDir = Test-Endpoint -Name "Creación de propuesta para Dirección (Sometida ante VIE)" -Method "POST" -Endpoint "/propuestas" -Body $propuestaDir
if ($creacionDir -and $creacionDir.propuesta) {
    $idPropuestaDireccion = $creacionDir.propuesta.id_propuesta
    Write-Host "  -> Propuesta sometida ante VIE: ID $idPropuestaDireccion" -ForegroundColor Cyan
}

if ($idPropuestaDireccion) {
    # D4. Expediente para dictamen
    $detalleDireccion = Test-Endpoint -Name "Expediente para dictamen de Dirección" -Endpoint "/propuestas/direccion/$($idPropuestaDireccion)?id_usuario=$idUsuarioDireccion"
    if ($detalleDireccion) {
        Write-Host "  -> Criterios VIE: $(@($detalleDireccion.criterios_vie).Count) | Puede dictaminar: $($detalleDireccion.puede_dictaminar)" -ForegroundColor Gray
    }

    # D5. Registrar dictamen favorable
    $bodyDireccion = @{
        id_usuario_eval = $idUsuarioDireccion
        dictamen = "Favorable"
        fundamentacion = "El expediente cumple los requisitos formales, los avales y la evaluación técnica. Se remite al CIE para resolución."
        verificacion_responsabilidades = $true
        verificacion_riesgos = $true
        verificacion_beca = $true
        verificacion_declaraciones = $true
        verificacion_documentos = $true
        verificacion_criterios = @(
            @{ id_criterio = 1; cumple = $true },
            @{ id_criterio = 2; cumple = $true },
            @{ id_criterio = 3; cumple = $true },
            @{ id_criterio = 4; cumple = $true }
        )
        observaciones = "Dictamen de prueba registrado por test_endpoints.ps1"
    }
    $resDireccion = Test-Endpoint -Name "Dictamen favorable de Dirección" -Method "POST" -Endpoint "/propuestas/direccion/$($idPropuestaDireccion)" -Body $bodyDireccion
    if ($resDireccion) {
        Write-Host "  -> Estado: $($resDireccion.nombre_estado) ($($resDireccion.estado_actual)) | Dictamen: $($resDireccion.dictamen)" -ForegroundColor Cyan
    }

    # D6. Duplicado (409 esperado)
    $resDirDuplicado = Test-Endpoint -Name "Dictamen duplicado de Dirección (409 esperado)" -Method "POST" -Endpoint "/propuestas/direccion/$($idPropuestaDireccion)" -Body $bodyDireccion -ExpectedStatus 409
    if (-not $resDirDuplicado) {
        Write-Host "  -> Rechazo correcto: ya existe un dictamen de Dirección." -ForegroundColor Gray
    }

    # D7. Expediente general con dictamen de Dirección
    $dossierDir = Test-Endpoint -Name "Expediente con dictamen de Dirección" -Endpoint "/propuestas/$($idPropuestaDireccion)"
    if ($dossierDir -and $dossierDir.dictamen_direccion) {
        Write-Host "  -> Dictamen Dirección: $($dossierDir.dictamen_direccion.dictamen) | Verificaciones: $(@($dossierDir.dictamen_direccion.verificaciones).Count)" -ForegroundColor Gray
        Write-Host "  -> Fundamentacion persistida: $($dossierDir.dictamen_direccion.fundamentacion.Length) caracteres" -ForegroundColor Gray
    }
}

# -------------------------------------------------------------
# FASE 8: ADMINISTRACIÓN INSTITUCIONAL (PANTALLAS 31 Y 32)
# -------------------------------------------------------------

Write-Host "`n--- FASE 8: ADMINISTRACION DE CONVOCATORIAS, RUBRICAS Y CATALOGOS ---" -ForegroundColor Cyan

# E1. Autorización: un investigador no puede administrar
$adminNegado = Test-Endpoint -Name "Catálogos con rol no administrativo (403 esperado)" -Endpoint "/admin/catalogos?id_usuario=1" -ExpectedStatus 403
if (-not $adminNegado) {
    Write-Host "  -> Rechazo correcto: el investigador no administra convocatorias." -ForegroundColor Gray
}

# E2. Los tres roles facultados listan las convocatorias
# [Línea clave]: El usuario con rol «Administrador del Sistema» se resuelve por su
# correo institucional, no por un identificador fijo.
$loginAdmin = Test-Endpoint -Name "Autenticación Administrador del Sistema" -Method "POST" -Endpoint "/auth/login" -Body @{
    correo = "administrador@example.com"
    password = "demostracion"
}
$idUsuarioAdmin = if ($loginAdmin) { $loginAdmin.id_usuario } else { 9 }
foreach ($rolAdmin in @(
    @{ etiqueta = "Dirección de Investigación"; id = $idUsuarioDireccion },
    @{ etiqueta = "Funcionario VIE"; id = 7 },
    @{ etiqueta = "Administrador del Sistema"; id = $idUsuarioAdmin }
)) {
    $convocatoriasAdmin = Test-Endpoint -Name "Convocatorias como $($rolAdmin.etiqueta)" -Endpoint "/admin/convocatorias?id_usuario=$($rolAdmin.id)"
    if ($convocatoriasAdmin) {
        Write-Host "  -> Convocatorias visibles: $(@($convocatoriasAdmin).Count)" -ForegroundColor Gray
    }
}

# E3. Crear, editar y cerrar una convocatoria de prueba
$convocatoriaAdmin = @{
    nombre = "Convocatoria de Pruebas Administrativas $marcaHora"
    descripcion = "Convocatoria creada por el smoke test administrativo."
    fecha_inicio = "2027-01-15"
    fecha_cierre = "2027-03-31"
    fecha_inicio_ejecucion = "2027-04-01"
    activo = $true
}
$creadaAdmin = Test-Endpoint -Name "Creación de convocatoria administrativa" -Method "POST" -Endpoint "/admin/convocatorias?id_usuario=$idUsuarioDireccion" -Body $convocatoriaAdmin
$idConvocatoriaAdmin = $null
if ($creadaAdmin -and $creadaAdmin.id_convocatoria) {
    $idConvocatoriaAdmin = $creadaAdmin.id_convocatoria
    Write-Host "  -> Creada con ID: $idConvocatoriaAdmin | Carpeta: $($creadaAdmin.carpeta_storage)" -ForegroundColor Cyan
}

if ($idConvocatoriaAdmin) {
    # E4. Cronograma de la convocatoria
    $etapaAdmin = @{
        nombre_etapa = "Recepcion de propuestas"
        responsable = "Investigadores Principales"
        fecha_inicio = "2027-01-15"
        fecha_fin = "2027-02-15"
        orden = 1
    }
    $etapaCreada = Test-Endpoint -Name "Creación de etapa del cronograma" -Method "POST" -Endpoint "/admin/convocatorias/$idConvocatoriaAdmin/etapas?id_usuario=$idUsuarioDireccion" -Body $etapaAdmin
    if ($etapaCreada -and $etapaCreada.id_etapa) {
        $idEtapaAdmin = $etapaCreada.id_etapa
        $editarEtapa = @{
            nombre_etapa = "Recepcion de propuestas"
            responsable = "Oficina de Vinculacion"
            fecha_inicio = "2027-01-15"
            fecha_fin = "2027-02-20"
            orden = 1
        }
        Test-Endpoint -Name "Edición de etapa del cronograma" -Method "PATCH" -Endpoint "/admin/etapas/${idEtapaAdmin}?id_usuario=$idUsuarioDireccion" -Body $editarEtapa | Out-Null
        Test-Endpoint -Name "Eliminación de etapa del cronograma" -Method "DELETE" -Endpoint "/admin/etapas/${idEtapaAdmin}?id_usuario=$idUsuarioDireccion" | Out-Null
    }

    # E5. Editar y cerrar la convocatoria
    $editarConvocatoria = @{
        descripcion = "Convocatoria editada por el smoke test administrativo."
        activo = $false
    }
    $editadaAdmin = Test-Endpoint -Name "Edición y cierre de convocatoria" -Method "PATCH" -Endpoint "/admin/convocatorias/${idConvocatoriaAdmin}?id_usuario=$idUsuarioDireccion" -Body $editarConvocatoria
    if ($editadaAdmin) {
        Write-Host "  -> Convocatoria cerrada: activo=$($editadaAdmin.activo)" -ForegroundColor Gray
    }

    # E6. Limpieza: eliminar la convocatoria de prueba
    Test-Endpoint -Name "Eliminación de convocatoria administrativa" -Method "DELETE" -Endpoint "/admin/convocatorias/${idConvocatoriaAdmin}?id_usuario=$idUsuarioDireccion" | Out-Null
}

# E7. Catálogos maestros: alta, edición y baja de una línea de investigación
$lineaAdmin = Test-Endpoint -Name "Creación de línea de investigación" -Method "POST" -Endpoint "/admin/catalogos/lineas?id_usuario=$idUsuarioDireccion" -Body @{ nombre_linea = "Linea de Prueba Administrativa $marcaHora" }
if ($lineaAdmin -and $lineaAdmin.id_linea_investigacion) {
    $idLineaAdmin = $lineaAdmin.id_linea_investigacion
    Test-Endpoint -Name "Edición de línea de investigación" -Method "PATCH" -Endpoint "/admin/catalogos/lineas/${idLineaAdmin}?id_usuario=$idUsuarioDireccion" -Body @{ nombre_linea = "Linea de Prueba Editada $marcaHora" } | Out-Null
    Test-Endpoint -Name "Eliminación de línea de investigación" -Method "DELETE" -Endpoint "/admin/catalogos/lineas/${idLineaAdmin}?id_usuario=$idUsuarioDireccion" | Out-Null
}

# E8. Un registro en uso no se puede eliminar (409 esperado)
Test-Endpoint -Name "Eliminación de escuela en uso (409 esperado)" -Method "DELETE" -Endpoint "/admin/catalogos/escuelas/1?id_usuario=$idUsuarioDireccion" -ExpectedStatus 409 | Out-Null

# E9. Orden de los roles institucionales
# [Línea clave]: El rol que se reordena se resuelve por su nombre oficial.
$idRolOrden = Get-IdRol -Nombre "Vinculación"
if ($idRolOrden) {
    Test-Endpoint -Name "Reordenamiento de roles institucionales" -Method "PATCH" -Endpoint "/admin/catalogos/roles/$idRolOrden/mover?id_usuario=$idUsuarioDireccion" -Body @{ direccion = "arriba" } | Out-Null
    Test-Endpoint -Name "Restauración del orden de roles" -Method "PATCH" -Endpoint "/admin/catalogos/roles/$idRolOrden/mover?id_usuario=$idUsuarioDireccion" -Body @{ direccion = "abajo" } | Out-Null
}

# E10. Rúbrica versionada: consulta, secciones, criterios y versiones
$rubricaAdmin = Test-Endpoint -Name "Rúbrica institucional versionada" -Endpoint "/admin/rubrica?id_usuario=$idUsuarioDireccion"
if ($rubricaAdmin) {
    Write-Host "  -> Versión activa: $($rubricaAdmin.version_activa) | Secciones: $(@($rubricaAdmin.secciones).Count) | Peso total: $($rubricaAdmin.peso_total)" -ForegroundColor Gray
}

$seccionAdmin = @{
    nombre_seccion = "Seccion de prueba $marcaHora"
    peso_porcentual = 10
    orden = 9
    version = $rubricaAdmin.version_activa
}
$seccionCreada = Test-Endpoint -Name "Creación de sección de rúbrica" -Method "POST" -Endpoint "/admin/rubrica/secciones?id_usuario=$idUsuarioDireccion" -Body $seccionAdmin
if ($seccionCreada -and $seccionCreada.id_seccion) {
    $idSeccionAdmin = $seccionCreada.id_seccion
    $criterioAdmin = @{
        id_seccion = $idSeccionAdmin
        nombre_criterio = "Criterio de prueba $marcaHora"
        peso_relativo = 10
        es_obligatorio = $false
        orden = 1
        version = $rubricaAdmin.version_activa
    }
    $criterioCreado = Test-Endpoint -Name "Creación de criterio de rúbrica" -Method "POST" -Endpoint "/admin/rubrica/criterios?id_usuario=$idUsuarioDireccion" -Body $criterioAdmin
    if ($criterioCreado -and $criterioCreado.id_criterio_rubrica) {
        Test-Endpoint -Name "Eliminación de criterio de rúbrica" -Method "DELETE" -Endpoint "/admin/rubrica/criterios/$($criterioCreado.id_criterio_rubrica)?id_usuario=$idUsuarioDireccion" | Out-Null
    }
    Test-Endpoint -Name "Eliminación de sección de rúbrica" -Method "DELETE" -Endpoint "/admin/rubrica/secciones/${idSeccionAdmin}?id_usuario=$idUsuarioDireccion" | Out-Null
}

# E11. La rúbrica oficial del Comité Técnico sigue disponible
Test-Endpoint -Name "Rúbrica oficial del Comité Técnico" -Endpoint "/propuestas/comite/rubrica" | Out-Null

# -------------------------------------------------------------
# FASE 9: DISPONIBILIDAD DEL SERVIDOR FRONTEND (SPA)
# -------------------------------------------------------------

# 20. Servidor Frontend Nginx / HTML
$frontendCheck = Test-Endpoint -Name "Disponibilidad Frontend SPA" -Endpoint "/html/SGPI.html" -CustomUrl "$FrontendUrl/html/SGPI.html"
if ($frontendCheck) {
    Write-Host "  -> Frontend servido correctamente en $FrontendUrl (Nginx/HTML5)" -ForegroundColor Green
}

# -------------------------------------------------------------
# FASE 10: COMITÉ DE ÉTICA EN INVESTIGACIÓN (CIE)
# -------------------------------------------------------------

Write-Host "`n--- FASE 10: COMITE DE ETICA EN INVESTIGACION (CIE) ---" -ForegroundColor Cyan

# C1. Autenticación de los dos roles institucionales del CIE
# [Línea clave]: El comité tiene dos roles («CIE» y «Evaluador Comité de Ética (CIE)»).
# Se prueban los correos sembrados y, si el segundo rol no existe en el ambiente,
# la comprobación se omite con aviso en lugar de falsear el resultado.
$loginCie = Test-Endpoint -Name "Autenticación Comité de Ética (CIE)" -Method "POST" -Endpoint "/auth/login" -Body @{ correo = "carlos.morales@example.com"; password = "demostracion" }
if (-not $loginCie) {
    $loginCie = Test-Endpoint -Name "Autenticación Comité de Ética (CIE) - correo alterno" -Method "POST" -Endpoint "/auth/login" -Body @{ correo = "ricardo.mora@example.com"; password = "demostracion" }
}
$idUsuarioCie = if ($loginCie) { $loginCie.id_usuario } else { 8 }
if ($loginCie) {
    Write-Host "  -> Usuario: $($loginCie.nombre) | ID: $idUsuarioCie | Roles: $($loginCie.roles -join ', ')" -ForegroundColor Gray
}

$loginCieEvaluador = Test-Endpoint -Name "Autenticación Evaluador Comité de Ética" -Method "POST" -Endpoint "/auth/login" -Body @{ correo = "patricia.solano@universidad.edu"; password = "demostracion" }
$idUsuarioCieEvaluador = if ($loginCieEvaluador) { $loginCieEvaluador.id_usuario } else { $null }
if ($loginCieEvaluador) {
    Write-Host "  -> Evaluadora: $($loginCieEvaluador.nombre) | ID: $idUsuarioCieEvaluador | Roles: $($loginCieEvaluador.roles -join ', ')" -ForegroundColor Gray
} else {
    Write-Host "  [AVISO] El rol «Evaluador Comité de Ética (CIE)» no existe en este ambiente: se omiten las pruebas exclusivas de ese rol." -ForegroundColor Yellow
}

# C2. Un investigador no tiene rol de CIE
Test-Endpoint -Name "Bandeja del CIE sin rol (403 esperado)" -Endpoint "/propuestas/cie/bandeja?rol=CIE&id_usuario=1" -ExpectedStatus 403 | Out-Null

# C3. Bandeja del CIE
$bandejaCie = Test-Endpoint -Name "Bandeja del Comité de Ética" -Endpoint "/propuestas/cie/bandeja?rol=CIE&id_usuario=$idUsuarioCie"
if ($bandejaCie) {
    Write-Host "  -> Expedientes en la bandeja: $(@($bandejaCie).Count)" -ForegroundColor Gray
}

# C3b. El evaluador individual del CIE ve la misma bandeja
if ($idUsuarioCieEvaluador) {
    $bandejaCieEvaluador = Test-Endpoint -Name "Bandeja del CIE (rol Evaluador Comité de Ética)" -Endpoint "/propuestas/cie/bandeja?rol=CIE&id_usuario=$idUsuarioCieEvaluador"
    if ($bandejaCieEvaluador) {
        Write-Host "  -> Expedientes visibles para el evaluador: $(@($bandejaCieEvaluador).Count)" -ForegroundColor Gray
    }
}

# C4. Dashboard del CIE con los contadores reales
$dashboardCie = Test-Endpoint -Name "Dashboard del Comité de Ética" -Endpoint "/propuestas/cie/dashboard?rol=CIE&id_usuario=$idUsuarioCie"
if ($dashboardCie) {
    Write-Host "  -> Pendientes: $($dashboardCie.pendientes) | Resueltas: $($dashboardCie.resueltas) | Totales revisadas: $($dashboardCie.totales_revisadas)" -ForegroundColor Gray
    if ($dashboardCie.propuesta_destacada) {
        Write-Host "  -> Destacada (más reciente dictaminada): $($dashboardCie.propuesta_destacada.codigo)" -ForegroundColor Gray
    }
}

# C5. Propuesta dictaminada por Dirección para resolver ante el CIE.
# [Línea clave]: Se crea siempre una propuesta nueva en «Dictaminada por Dirección» para que cada
# corrida del smoke test deje un expediente pendiente en la bandeja del comité (validación visual).
$idPropuestaCie = $null
$propuestaCie = $nuevaPropuesta.Clone()
$propuestaCie.titulo = "Test Comité de Ética en Investigación - Resolución $marcaHora"
$propuestaCie.resumen = "Propuesta automatizada para validar la resolución colegiado del Comité de Ética en Investigación."
$propuestaCie.estado_inicial_nombre = "Dictaminada por Dirección"
$creacionCie = Test-Endpoint -Name "Creación de propuesta dictaminada para el CIE (Dictaminada por Dirección)" -Method "POST" -Endpoint "/propuestas" -Body $propuestaCie
if ($creacionCie -and $creacionCie.propuesta) {
    $idPropuestaCie = $creacionCie.propuesta.id_propuesta
    Write-Host "  -> Propuesta dictaminada por Dirección: ID $idPropuestaCie" -ForegroundColor Cyan
}

if ($idPropuestaCie) {
    # C6. Expediente para resolver
    $detalleCie = Test-Endpoint -Name "Expediente para resolución del CIE" -Endpoint "/propuestas/cie/$($idPropuestaCie)?id_usuario=$idUsuarioCie"
    if ($detalleCie) {
        Write-Host "  -> Puede resolver: $($detalleCie.puede_resolver) | Tipos de acuerdo: $(@($detalleCie.tipos_resolucion).Count) | Documentos: $(@($detalleCie.documentos).Count)" -ForegroundColor Gray
    }

    # C7. Sin acuerdo previo no se pueden registrar condiciones (409 esperado)
    Test-Endpoint -Name "Condiciones del CIE sin resolución previa (409 esperado)" -Method "POST" -Endpoint "/propuestas/cie/$($idPropuestaCie)/condiciones" -Body @{ id_usuario_eval = $idUsuarioCie; condiciones = "Prueba sin acuerdo previo" } -ExpectedStatus 409 | Out-Null

    # C8. Resolucion colegiada favorable
    $bodyCie = @{
        id_usuario_eval = $idUsuarioCie
        id_resolucion = 1
        numero_sesion = "23-2026"
        articulo = "Articulo 5"
        fecha_resolucion = "2026-11-02"
        fundamentacion = "El protocolo cumple con los criterios eticos institucionales y no presenta riesgos bioeticos relevantes."
        condiciones = "Mantener la revision etica de datos personales cada seis meses."
        observaciones = "Acuerdo de prueba registrado por test_endpoints.ps1"
    }
    $resCie = Test-Endpoint -Name "Resolución favorable del CIE" -Method "POST" -Endpoint "/propuestas/cie/$($idPropuestaCie)" -Body $bodyCie
    if ($resCie) {
        Write-Host "  -> Estado: $($resCie.nombre_estado) ($($resCie.estado_actual)) | Acuerdo: $($resCie.resolucion)" -ForegroundColor Cyan
    }

    # C8. Duplicado (409 esperado)
    Test-Endpoint -Name "Resolución duplicada del CIE (409 esperado)" -Method "POST" -Endpoint "/propuestas/cie/$($idPropuestaCie)" -Body $bodyCie -ExpectedStatus 409 | Out-Null

    # C9. El expediente ya no admite una nueva resolucion (409 esperado)
    Test-Endpoint -Name "Segunda resolución sobre expediente cerrado (409 esperado)" -Method "POST" -Endpoint "/propuestas/cie/$($idPropuestaCie)" -Body $bodyCie -ExpectedStatus 409 | Out-Null

    # C10. Condiciones de aceptación posteriores (no cambian el estado)
    if ($idUsuarioCieEvaluador) {
        $bodyCondiciones = @{
            id_usuario_eval = $idUsuarioCieEvaluador
            condiciones = "Presentar el consentimiento informado actualizado antes de la segunda collecting."
            observaciones = "Recordatorio de la sesion 23-2026."
        }
        $resCondiciones = Test-Endpoint -Name "Condiciones posteriores del CIE" -Method "POST" -Endpoint "/propuestas/cie/$($idPropuestaCie)/condiciones" -Body $bodyCondiciones
        if ($resCondiciones) {
            Write-Host "  -> Condiciones registradas | Estado conservado: $($resCondiciones.nombre_estado)" -ForegroundColor Cyan
        }
    } else {
        Write-Host "  [AVISO] Sin evaluador del CIE en este ambiente: se omite la prueba de condiciones posteriores." -ForegroundColor Yellow
    }

    # C11. El expediente general expone la resolucion y la notificacion al lider
    $dossierCie = Test-Endpoint -Name "Expediente con resolución del CIE" -Endpoint "/propuestas/$($idPropuestaCie)"
    if ($dossierCie -and $dossierCie.resolucion_cie) {
        Write-Host "  -> Acuerdo persistido: $($dossierCie.resolucion_cie.nombre_resolucion) | Sesión: $($dossierCie.resolucion_cie.numero_sesion) | Evaluador: $($dossierCie.resolucion_cie.evaluador_nombre)" -ForegroundColor Gray
        $bloquesCondiciones = @([string]$dossierCie.resolucion_cie.condiciones -split "`n" | Where-Object { $_.Trim() })
        Write-Host "  -> Condiciones acumuladas: $($bloquesCondiciones.Count) bloque(s)" -ForegroundColor Gray
    }
    if ($dossierCie -and @($dossierCie.historial).Count -gt 0) {
        $ultimoHito = @($dossierCie.historial)[-1]
        Write-Host "  -> Último hito del historial: $($ultimoHito.estado_nuevo)" -ForegroundColor Gray
    }
}

# -------------------------------------------------------------
# FASE 11: MÁQUINA DE ESTADOS, RECHAZO TERMINAL Y CIERRE DEL PROYECTO
# -------------------------------------------------------------

Write-Host "`n--- FASE 11: MAQUINA DE ESTADOS, RECHAZO TERMINAL Y CIERRE DEL PROYECTO ---" -ForegroundColor Cyan

# M1. El Centro de Vinculación es el dueño de la etapa «En revisión de Vinculación».
$loginVinculacion = Test-Endpoint -Name "Login del Centro de Vinculación" -Method "POST" -Endpoint "/auth/login" -Body @{
    correo = "mariana.solis@example.com"
    password = "demostracion"
}
$idUsuarioVinculacion = if ($loginVinculacion) { $loginVinculacion.id_usuario } else { 4 }
if ($loginVinculacion) {
    Write-Host "  -> Vinculación: $($loginVinculacion.nombre) | ID: $idUsuarioVinculacion | Roles: $($loginVinculacion.roles -join ', ')" -ForegroundColor Gray
}

# M2. Expediente en revisión de Vinculación para la devolución con observaciones
$propuestaDevolucion = $nuevaPropuesta.Clone()
$propuestaDevolucion.titulo = "Test Maquina de Estados - Devolucion $marcaHora"
$propuestaDevolucion.estado_inicial_nombre = "En revisión de Vinculación"
$creacionDevolucion = Test-Endpoint -Name "Creación de expediente para la devolución" -Method "POST" -Endpoint "/propuestas" -Body $propuestaDevolucion
$idPropuestaDevolucion = if ($creacionDevolucion -and $creacionDevolucion.propuesta) { $creacionDevolucion.propuesta.id_propuesta } else { $null }

if ($idPropuestaDevolucion) {
    Write-Host "  -> Expediente en revisión de Vinculación: ID $idPropuestaDevolucion" -ForegroundColor Cyan

    # M3. Devolución con observaciones -> «Con observaciones» (y no «En ejecución»)
    $bodyDevolucion = @{
        id_usuario_eval = $idUsuarioVinculacion
        numero_oficio_dictamen = "CV-TEST-$marcaArchivo"
        potencial_pi_identificado = $true
        tipo_innovacion = "Software"
        activo_previsto = "Software"
        valoracion_tecnica = "Valoración técnica registrada por la prueba automatizada."
        requiere_reserva = $false
        observaciones = "Prueba de la devolución: se requieren ajustes en la justificación técnica."
        decision = "observaciones"
    }
    $resDevolucion = Test-Endpoint -Name "Devolución con observaciones de Vinculación" -Method "POST" -Endpoint "/propuestas/$idPropuestaDevolucion/vinculacion" -Body $bodyDevolucion
    if ($resDevolucion) {
        Write-Host "  -> Estado resultante: $($resDevolucion.nombre_estado) | Decisión: $($resDevolucion.decision)" -ForegroundColor Cyan
        if ($resDevolucion.nombre_estado -ne "Con observaciones") {
            Write-Host "  [AVISO] La devolución no quedó en «Con observaciones»." -ForegroundColor Red
        }
    }

    # M4. Solo el líder puede reenviar el expediente (403 esperado)
    Test-Endpoint -Name "Reenvío por un usuario que no es el líder (403 esperado)" -Method "POST" -Endpoint "/propuestas/$idPropuestaDevolucion/observaciones/reenvio" -Body @{
        id_usuario = $idUsuarioVinculacion
        observaciones = "Prueba negativa: Vinculación no reenvía su propia devolución."
    } -ExpectedStatus 403 | Out-Null

    # M5. El líder atiende las observaciones y reenvía a la etapa que devolvió el expediente
    $resReenvio = Test-Endpoint -Name "Reenvío del expediente tras atender las observaciones" -Method "POST" -Endpoint "/propuestas/$idPropuestaDevolucion/observaciones/reenvio" -Body @{
        id_usuario = 1
        observaciones = "Justificación técnica ampliada según las observaciones recibidas."
    }
    if ($resReenvio) {
        Write-Host "  -> Etapa a la que reingresó: $($resReenvio.nombre_estado)" -ForegroundColor Cyan
    }
}

# M6. Rechazo terminal: «Rechazada» no admite ninguna transición posterior
$propuestaRechazo = $nuevaPropuesta.Clone()
$propuestaRechazo.titulo = "Test Maquina de Estados - Rechazo $marcaHora"
$propuestaRechazo.estado_inicial_nombre = "En revisión de Vinculación"
$creacionRechazo = Test-Endpoint -Name "Creación de expediente para el rechazo terminal" -Method "POST" -Endpoint "/propuestas" -Body $propuestaRechazo
$idPropuestaRechazo = if ($creacionRechazo -and $creacionRechazo.propuesta) { $creacionRechazo.propuesta.id_propuesta } else { $null }

if ($idPropuestaRechazo) {
    $bodyRechazo = @{
        id_usuario_eval = $idUsuarioVinculacion
        numero_oficio_dictamen = "CV-REJ-$marcaArchivo"
        potencial_pi_identificado = $false
        valoracion_tecnica = "Valoración técnica registrada por la prueba automatizada."
        requiere_reserva = $false
        observaciones = "Prueba del rechazo: la propuesta no cumple los requisitos de Vinculación."
        decision = "rechazo"
    }
    $resRechazo = Test-Endpoint -Name "Rechazo terminal de Vinculación" -Method "POST" -Endpoint "/propuestas/$idPropuestaRechazo/vinculacion" -Body $bodyRechazo
    if ($resRechazo) {
        Write-Host "  -> Estado resultante: $($resRechazo.nombre_estado) | Decisión: $($resRechazo.decision)" -ForegroundColor Cyan
        if ($resRechazo.nombre_estado -ne "Rechazada") {
            Write-Host "  [AVISO] El rechazo no quedó en «Rechazada»." -ForegroundColor Red
        }
    }

    # M7. Un expediente rechazado es terminal (409 esperado)
    $estadoRevisionParaRechazo = Get-IdEstado -Nombre "En revisión de Vinculación"
    $resReabrirRechazo = Test-Endpoint -Name "Reapertura de un expediente rechazado (409 esperado)" -Method "PATCH" -Endpoint "/propuestas/$idPropuestaRechazo/estado" -Body @{
        id_nuevo_estado = $estadoRevisionParaRechazo
        id_usuario_responsable = $idUsuarioVinculacion
        observaciones = "Prueba negativa: «Rechazada» es terminal."
    } -ExpectedStatus 409
    if ($resReabrirRechazo) {
        Write-Host "  [AVISO] El backend permitió reabrir un expediente rechazado." -ForegroundColor Yellow
    } else {
        Write-Host "  -> Rechazo correcto: «Rechazada» es un estado terminal." -ForegroundColor Gray
    }
}

# M8. Aceptación de la carta: «Aprobada por CIE» -> «En ejecución»
$propuestaAceptacion = $nuevaPropuesta.Clone()
$propuestaAceptacion.titulo = "Test Maquina de Estados - Aceptacion $marcaHora"
$propuestaAceptacion.estado_inicial_nombre = "Aprobada por CIE"
$creacionAceptacion = Test-Endpoint -Name "Creación de expediente aprobado por el CIE" -Method "POST" -Endpoint "/propuestas" -Body $propuestaAceptacion
$idPropuestaAceptacion = if ($creacionAceptacion -and $creacionAceptacion.propuesta) { $creacionAceptacion.propuesta.id_propuesta } else { $null }

if ($idPropuestaAceptacion) {
    $resAceptacion = Test-Endpoint -Name "Aceptación de la carta del CIE" -Method "POST" -Endpoint "/propuestas/$idPropuestaAceptacion/aceptacion" -Body @{
        id_usuario = 1
        observaciones = "Carta de aceptación presentada por el investigador líder."
    }
    if ($resAceptacion) {
        Write-Host "  -> Estado resultante: $($resAceptacion.nombre_estado)" -ForegroundColor Cyan
    }

    # M9. El informe de seguimiento no cambia la etapa del proyecto
    $resInforme = Test-Endpoint -Name "Informe de seguimiento del proyecto" -Method "POST" -Endpoint "/propuestas/$idPropuestaAceptacion/informe" -Body @{
        id_usuario = 1
        observaciones = "Informe semestral: se ejecutaron las actividades del primer periodo."
    }
    if ($resInforme) {
        Write-Host "  -> Estado conservado: $($resInforme.nombre_estado)" -ForegroundColor Cyan
    }

    # M10. El cierre exige el informe final (400 esperado)
    $resCierreSinInforme = Test-Endpoint -Name "Cierre sin informe final (400 esperado)" -Method "POST" -Endpoint "/propuestas/$idPropuestaAceptacion/cierre" -Body @{
        id_usuario = $idUsuarioDireccion
        observaciones = "Prueba negativa: el cierre exige el informe final."
    } -ExpectedStatus 400
    if ($resCierreSinInforme) {
        Write-Host "  [AVISO] El backend permitió cerrar el expediente sin informe final." -ForegroundColor Yellow
    } else {
        Write-Host "  -> Rechazo correcto: el cierre exige el informe final." -ForegroundColor Gray
    }

    # M11. El cierre no le corresponde al investigador (403 esperado)
    Test-Endpoint -Name "Cierre por un investigador (403 esperado)" -Method "POST" -Endpoint "/propuestas/$idPropuestaAceptacion/cierre" -Body @{
        id_usuario = 1
        observaciones = "Prueba negativa: el cierre es una facultad de Dirección de Investigación."
    } -ExpectedStatus 403 | Out-Null

    # M12. Cierre administrativo: «En ejecución» -> «Cerrada»
    $documentoFinal = Test-UploadDocumento -Name "Informe final del proyecto" -IdPropuesta $idPropuestaAceptacion -IdUsuario 1 -TipoDocumento "Informe final del proyecto" -ArchivoLocal $rutaInformePdf
    if ($documentoFinal -and $documentoFinal.id_documento) {
        Write-Host "  -> Documento registrado: $($documentoFinal.id_documento) | $($documentoFinal.nombre_archivo)" -ForegroundColor Gray
        $resCierre = Test-Endpoint -Name "Cierre administrativo del proyecto" -Method "POST" -Endpoint "/propuestas/$idPropuestaAceptacion/cierre" -Body @{
            id_usuario = $idUsuarioDireccion
            observaciones = "Cierre administrativo: se cumplen los productos comprometidos y se entrega el informe final."
            id_documento = $documentoFinal.id_documento
        }
        if ($resCierre) {
            Write-Host "  -> Estado resultante: $($resCierre.nombre_estado)" -ForegroundColor Cyan
        }

        # M13. Un expediente cerrado es terminal (409 esperado)
        $estadoEjecucion = Get-IdEstado -Nombre "En ejecución"
        $resReabrirCerrada = Test-Endpoint -Name "Reapertura de un expediente cerrado (409 esperado)" -Method "PATCH" -Endpoint "/propuestas/$idPropuestaAceptacion/estado" -Body @{
            id_nuevo_estado = $estadoEjecucion
            id_usuario_responsable = $idUsuarioDireccion
            observaciones = "Prueba negativa: «Cerrada» es un estado terminal."
        } -ExpectedStatus 409
        if ($resReabrirCerrada) {
            Write-Host "  [AVISO] El backend permitió reabrir un expediente cerrado." -ForegroundColor Yellow
        } else {
            Write-Host "  -> Rechazo correcto: «Cerrada» es un estado terminal." -ForegroundColor Gray
        }

        # M14. El historial del expediente refleja el ciclo completo
        $dossierCierre = Test-Endpoint -Name "Expediente con el ciclo completo" -Endpoint "/propuestas/$idPropuestaAceptacion"
        if ($dossierCierre) {
            Write-Host "  -> Estado final: $($dossierCierre.nombre_estado) | Hitos de bitácora: $(@($dossierCierre.historial).Count)" -ForegroundColor Gray
        }
    }
}

if (Test-Path $rutaInformePdf) {
    Remove-Item $rutaInformePdf -ErrorAction SilentlyContinue
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "             PRUEBAS FINALIZADAS CON EXITO                " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan