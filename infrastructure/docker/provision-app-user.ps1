
$ErrorActionPreference = "Stop"

$container = "kairo-postgres"

$running = docker inspect --format '{{.State.Running}}' $container
if ($LASTEXITCODE -ne 0 -or $running.Trim() -ne "true") {
    throw "The kairo-postgres container must be running."
}

# Verify required settings without displaying passwords.
$check = docker exec $container psql -U kairo_admin -d kairo_dev -Atc "SELECT 1;"
if ($LASTEXITCODE -ne 0 -or $check.Trim() -ne "1") {
    throw "Could not connect to PostgreSQL as kairo_admin."
}

$sql = @'
\getenv app_user KAIRO_APP_USER
\getenv app_password KAIRO_APP_PASSWORD
\getenv db_name POSTGRES_DB

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db_name', :'app_user')
\gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user')
\gexec
'@

$sql | docker exec -i $container psql -U kairo_admin -d kairo_dev -v ON_ERROR_STOP=1

if ($LASTEXITCODE -ne 0) {
    throw "Application account provisioning failed."
}

Write-Output "Application account provisioning completed."
