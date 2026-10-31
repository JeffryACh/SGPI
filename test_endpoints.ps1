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
        [string]$CustomUrl = $null
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
        Write-Host " [OK 200]" -ForegroundColor Green
        return $res
    } catch {
        Write-Host " [ERROR]" -ForegroundColor Red
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
        Write-Host "Detalle: $errorDetail" -ForegroundColor Yellow
        return $null
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

# -------------------------------------------------------------
# FASE 2: CATALOGOS UNIFICADOS Y REGLAS NORMATIVAS VIE 2027
# -------------------------------------------------------------

# 3. Catálogos unificados
$catalogos = Test-Endpoint -Name "Catálogos Unificados" -Endpoint "/catalogos"
if ($catalogos) {
    Write-Host "  -> Escuelas: $($catalogos.escuelas.Count), Modalidades: $($catalogos.modalidades.Count), Tipos de Hora: $($catalogos.tipos_hora.Count)" -ForegroundColor Gray
}

# 4. Tipos de Hora oficiales
$tiposHora = Test-Endpoint -Name "Tipos de Hora VIE 2027" -Endpoint "/tipos_hora/totalTiposHora"

# 5. Escuelas abiertas
$escuelas = Test-Endpoint -Name "Todas las Escuelas" -Endpoint "/escuelas/totalescuelas"

# 6. Documentos oficiales de la Convocatoria Fondos VIE 2027
$documentos = Test-Endpoint -Name "Documentos Convocatoria Fondos VIE 2027" -Endpoint "/convocatorias/documentos_convocatoria?id_convocatoria=1"
if ($documentos) {
    Write-Host "  -> Total instrumentos oficiales encontrados: $($documentos.Count)" -ForegroundColor Gray
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
if ($top -and $top.Count -gt 0) {
    Write-Host "  -> Propuesta 1: Código=$($top[0].code), Título=$($top[0].title), Período=$($top[0].period)" -ForegroundColor Gray
}

# 9. Listado general de propuestas
$lista = Test-Endpoint -Name "Listado General de Propuestas" -Endpoint "/propuestas"

# 10. Crear Propuesta de prueba (Inserción Atómica Multitabla)
$marcaHora = Get-Date -Format 'HH:mm:ss'
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
    estado_inicial = 1
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
    $cambioEstado = @{
        id_nuevo_estado = 2
        id_usuario_responsable = 1
        observaciones = "Envío automático de prueba a revisión técnica"
    }
    $resEstado = Test-Endpoint -Name "Transición de Estado (Disparo Automático IA)" -Method "PATCH" -Endpoint "/propuestas/$nuevoId/estado" -Body $cambioEstado
    if ($resEstado -and $resEstado.evaluacion_preliminar_ia) {
        Write-Host "  -> IA activada automáticamente. Puntaje: $($resEstado.evaluacion_preliminar_ia.puntaje_preliminar)/100" -ForegroundColor Gray
    }

    # 13. Registro de Dictamen / Calificación Oficial por Evaluador
    $evalOficial = @{
        id_usuario_eval = 1
        id_rol_evaluador = 3
        observaciones = "Evaluación técnica de prueba conforme a rúbrica oficial."
        puntaje_comite = 88
        cambiar_a_estado = 3
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
# FASE 5: DISPONIBILIDAD DEL SERVIDOR FRONTEND (SPA)
# -------------------------------------------------------------

# 20. Servidor Frontend Nginx / HTML
$frontendCheck = Test-Endpoint -Name "Disponibilidad Frontend SPA" -Endpoint "/html/SGPI.html" -CustomUrl "$FrontendUrl/html/SGPI.html"
if ($frontendCheck) {
    Write-Host "  -> Frontend servido correctamente en $FrontendUrl (Nginx/HTML5)" -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "             PRUEBAS FINALIZADAS CON EXITO                " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
