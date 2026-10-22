<#
.SYNOPSIS
    Runs the Kairo.API locally using the designated PostgreSQL launch profile.
.DESCRIPTION
    Launches Kairo.API against local PostgreSQL. Securely resolves the local
    database password from infrastructure/docker/.env and configures the process
    environment without logging or displaying sensitive credentials.

    SQL Server is no longer supported. VOIDZONE requires PostgreSQL with pgvector.
    Specifying any profile other than 'PostgreSQL Local' will produce an error.

.PARAMETER Profile
    The launch profile to use. Only 'PostgreSQL Local' (default) is supported.
    SQL Server profiles are explicitly rejected; the runtime is PostgreSQL-only.
.PARAMETER SyncSecrets
    Strictly opt-in. Syncs the local PostgreSQL connection string into .NET User
    Secrets so that subsequent plain 'dotnet run' commands succeed without this
    launcher. IMPORTANT: This stores a development credential in the local user
    secrets store. Never use for production credentials.
.EXAMPLE
    .\scripts\run-api.ps1
    .\scripts\run-api.ps1 -SyncSecrets
    .\scripts\run-api.ps1 -- --urls http://localhost:5172
#>
param(
    [string]$Profile = "PostgreSQL Local",
    [switch]$SyncSecrets,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$AdditionalArgs
)

$ErrorActionPreference = "Stop"

# ── Reject obsolete SQL Server profile ────────────────────────────────────────
if ($Profile -match "(?i)sql.?server|mssql") {
    Write-Error @"
ERROR: The SQL Server launch profile is no longer supported.
VOIDZONE requires PostgreSQL with pgvector as the sole runtime database provider.
Use the 'PostgreSQL Local' profile (default) instead.
"@
    exit 1
}

$repoRoot   = Split-Path -Parent $PSScriptRoot
$apiProject = Join-Path $repoRoot "backend\Kairo.API\Kairo.API.csproj"
$dockerEnv  = Join-Path $repoRoot "infrastructure\docker\.env"

# ── Validate project exists ────────────────────────────────────────────────────
if (-not (Test-Path $apiProject)) {
    Write-Error "API project not found at: $apiProject"
    exit 1
}

if ($Profile -like "*PostgreSQL*") {
    # ── Check Docker container status (read-only inspect; never recreates) ────
    try {
        $containerStatus = docker inspect --format '{{.State.Status}}' kairo-postgres 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerStatus)) {
            Write-Warning "Could not inspect 'kairo-postgres' container. Docker Desktop may not be running."
            Write-Warning "To start: docker compose -f infrastructure/docker/compose.yaml up -d"
        } elseif ($containerStatus.Trim() -ne "running") {
            Write-Warning "Local PostgreSQL container 'kairo-postgres' status: '$($containerStatus.Trim())' (expected: running)."
            Write-Warning "To start: docker compose -f infrastructure/docker/compose.yaml up -d"
        }
    }
    catch {
        Write-Warning "Docker inspect failed. Ensure Docker Desktop is running. Error: $($_.Exception.Message)"
    }

    # ── Resolve local password from .env (never echo secrets) ─────────────────
    if (Test-Path $dockerEnv) {
        $envVars = @{}
        Get-Content $dockerEnv | ForEach-Object {
            $line = $_.Trim()
            # Skip blank lines and comments
            if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
                $parts = $line.Split('=', 2)
                $key   = $parts[0].Trim()
                $val   = $parts[1].Trim()
                if ($key) { $envVars[$key] = $val }
            }
        }

        $hostPort = if ($envVars['POSTGRES_HOST_PORT']) { $envVars['POSTGRES_HOST_PORT'] } else { '5433' }
        $dbName   = if ($envVars['POSTGRES_DB'])         { $envVars['POSTGRES_DB']         } else { 'kairo_dev' }
        $appUser  = if ($envVars['KAIRO_APP_USER'])      { $envVars['KAIRO_APP_USER']      } else { 'kairo_dev' }
        $appPass  = $envVars['KAIRO_APP_PASSWORD']

        if ([string]::IsNullOrWhiteSpace($appPass)) {
            Write-Warning "KAIRO_APP_PASSWORD not found in $dockerEnv. Ensure User Secrets or environment variables are configured."
        } else {
            # Set process-scoped environment variable — does NOT modify the shell permanently
            $connString = "Host=127.0.0.1;Port=$hostPort;Database=$dbName;Username=$appUser;Password=$appPass;"
            $env:ConnectionStrings__KairoPostgres = $connString

            if ($SyncSecrets) {
                Write-Warning @"
NOTICE: Syncing connection string to .NET User Secrets (local development only).
This stores a local development credential. Never use for production credentials.
"@
                dotnet user-secrets set "ConnectionStrings:KairoPostgres" $connString --project $apiProject | Out-Null
                Write-Host "Synchronized ConnectionStrings:KairoPostgres to .NET User Secrets." -ForegroundColor Green
            }
        }
    }
    else {
        Write-Warning "infrastructure/docker/.env not found. Ensure User Secrets or environment variables are configured."
        Write-Warning "Expected path: $dockerEnv"
    }
}
else {
    Write-Error "Unrecognized launch profile: '$Profile'. Only 'PostgreSQL Local' is supported."
    exit 1
}

Write-Host "Launching Kairo.API with profile: $Profile" -ForegroundColor Cyan
dotnet run --project $apiProject --launch-profile $Profile @AdditionalArgs
