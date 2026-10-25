# Script de verificación rápida de endpoints de SGPI Backend (FastAPI)
# Ejecutar en PowerShell: .\test_endpoints.ps1

$BaseUrl = "http://localhost:3001"
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       VERIFICACION DE ENDPOINTS SGPI BACKEND             " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method = "GET",
        [string]$Endpoint,
        [object]$Body = $null
    )

    $url = "$BaseUrl$Endpoint"
    Write-Host "`nProbando: [$Method] $Endpoint ($Name)..." -NoNewline
    try {
        $params = @{
            Uri = $url
            Method = $Method
            ErrorAction = "Stop"
        }
        if ($Body) {
            $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
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

# 1. Healthcheck
$health = Test-Endpoint -Name "Conexion BD" -Endpoint "/health"
if (-not $health) {
    Write-Host "`n[AVISO] No se pudo conectar a $BaseUrl." -ForegroundColor Yellow
    Write-Host "Asegúrate de que los contenedores estén levantados con:" -ForegroundColor Gray
    Write-Host "  docker compose up --build" -ForegroundColor Cyan
    Write-Host "O verifica los logs con:" -ForegroundColor Gray
    Write-Host "  docker compose logs backend" -ForegroundColor Cyan
    exit
}

# 2. Catálogos unificados
$catalogos = Test-Endpoint -Name "Catálogos Unificados" -Endpoint "/catalogos"
if ($catalogos) {
    Write-Host "  -> Escuelas: $($catalogos.escuelas.Count), Modalidades: $($catalogos.modalidades.Count), Tipos de Hora: $($catalogos.tipos_hora.Count)" -ForegroundColor Gray
}

# 3. Tipos de Hora (Desajuste #2)
$tiposHora = Test-Endpoint -Name "Tipos de Hora VIE 2027" -Endpoint "/tipos_hora/totalTiposHora"

# 4. Escuelas abiertas sin id_usuario (Desajuste #5)
$escuelas = Test-Endpoint -Name "Todas las Escuelas" -Endpoint "/escuelas/totalescuelas"

# 5. Documentos oficiales de la Convocatoria (Desajuste #3)
$documentos = Test-Endpoint -Name "Documentos Convocatoria Fondos VIE 2027" -Endpoint "/convocatorias/documentos_convocatoria?id_convocatoria=1"
if ($documentos) {
    Write-Host "  -> Total instrumentos oficiales encontrados: $($documentos.Count)" -ForegroundColor Gray
}

# 6. Dashboard de Propuestas (Desajuste #1)
$dashboard = Test-Endpoint -Name "Dashboard del Usuario 1" -Endpoint "/propuestas/dashboardpropuestas?id_usuario=1"
if ($dashboard) {
    Write-Host "  -> Total: $($dashboard.total), Formulacion: $($dashboard.formulacion), Ejecucion: $($dashboard.ejecucion), Cerradas: $($dashboard.cerradas)" -ForegroundColor Gray
}

# 7. Top propuestas con códigos reales (Desajuste #4)
$top = Test-Endpoint -Name "Top Propuestas Recientes" -Endpoint "/propuestas/top3PropuestaMasReciente?id_usuario=1"
if ($top -and $top.Count -gt 0) {
    Write-Host "  -> Propuesta 1: Codigo=$($top[0].code), Titulo=$($top[0].title), Periodo=$($top[0].period)" -ForegroundColor Gray
}

# 8. Listado general de propuestas (Desajuste #6)
$lista = Test-Endpoint -Name "Listado General de Propuestas" -Endpoint "/propuestas"

# 9. Crear Propuesta de prueba (Desajuste #6)
$nuevaPropuesta = @{
    id_usuario_lider = 1
    id_escuela = 1
    id_modalidad = 1
    id_linea_investigacion = 1
    titulo = "Test Automatizado - Sistema de Monitoreo Ambiental $(Get-Date -Format 'HH:mm:ss')"
    resumen = "Propuesta de prueba generada para validar inserción atómica multitabla."
    id_convocatoria = 1
    fecha_inicio = "2027-01-01"
    fecha_fin = "2027-12-31"
    estado_inicial = 1
    equipo = @(
        @{ id_usuario = 1; id_tipo_hora = 1; horas_asignadas = 10 }
    )
    objetivos = @(
        @{ codigo_objetivo = "OG"; descripcion = "Objetivo general de prueba"; orden = 1 }
    )
    productos_academicos = @(
        @{ tipo_producto = "Artículo"; descripcion = "Artículo en revista indexada"; meta_esperada = "1 artículo publicado"; categoria = "Publicación"; es_obligatorio = $true }
    )
    plan_accion = @(
        @{ descripcion_actividad = "Fase 1: Recolección y análisis de campo"; fecha_inicio = "2027-01-15"; fecha_fin = "2027-06-30"; id_usuario_responsable = 1 }
    )
    riesgos = @(
        @{ descripcion_riesgo = "Riesgo de retraso en compras"; id_nivel_probabilidad = 1; id_nivel_impacto = 2; medida_mitigacion = "Compras tempranas en mes 1" }
    )
    presupuesto = @(
        @{ id_rubro = 1; monto = 500000; anio = 1 }
    )
    declaraciones_eticas = @(
        @{ tipo_aspecto = "Uso de datos"; aplica = $false; justificacion_exencion = "No maneja datos personales sensibles" }
    )
}

$creacion = Test-Endpoint -Name "Creación Atómica de Propuesta" -Method "POST" -Endpoint "/propuestas" -Body $nuevaPropuesta
if ($creacion -and $creacion.propuesta) {
    $nuevoId = $creacion.propuesta.id_propuesta
    Write-Host "  -> Creada con ID: $nuevoId, Código: $($creacion.propuesta.codigo)" -ForegroundColor Cyan

    # 10. Consultar Dossier Completo
    $dossier = Test-Endpoint -Name "Expediente Completo de la Propuesta" -Endpoint "/propuestas/$nuevoId"

    # 11. Cambiar Estado
    $cambioEstado = @{
        id_nuevo_estado = 2
        id_usuario_responsable = 1
        observaciones = "Envío automático de prueba a revisión"
    }
    $resEstado = Test-Endpoint -Name "Transición de Estado" -Method "PATCH" -Endpoint "/propuestas/$nuevoId/estado" -Body $cambioEstado
}

# 12. Notificaciones: marcar como leída
$notifs = Test-Endpoint -Name "Marcar Notificaciones como Leídas" -Method "PATCH" -Endpoint "/notificaciones/leer-todas?id_usuario=1"

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "             PRUEBAS FINALIZADAS CON EXITO                " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
