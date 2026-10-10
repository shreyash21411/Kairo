# Kairo PostgreSQL + pgvector Infrastructure

## Purpose

This directory contains the Docker Compose configuration for Kairo's development PostgreSQL database with pgvector.

**Important:** Kairo's existing SQL Server backend remains unchanged. This setup does not migrate the application schema or modify application code.

## Components

- Docker Desktop with the WSL 2 backend
- PostgreSQL 17 with pgvector 0.8.7
- Docker Compose
- Database: `kairo_dev`
- Administrative role: `kairo_admin`
- Application role: `kairo_dev`
- Host port: `5433`, bound to localhost
- Persistent Docker volume: `kairo_postgres_data`

## First-time setup

1. Install Docker Desktop and enable the WSL 2 backend.
2. Clone or copy the Kairo repository to the local machine.
3. Open PowerShell in `infrastructure/docker`.
4. Create a local `.env` file from `.env.example`:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Replace both password placeholders in `.env` with strong, unique local passwords. Never commit `.env`.
6. Validate the configuration:

   ```powershell
   docker compose config --quiet
   ```

7. Start PostgreSQL:

   ```powershell
   docker compose up -d
   ```

8. Wait for the container to become healthy:

   ```powershell
   docker inspect --format '{{.State.Health.Status}}' kairo-postgres
   ```

9. Provision the application role:

   ```powershell
   .\provision-app-user.ps1
   ```

10. Verify PostgreSQL and pgvector:

    ```powershell
    docker exec kairo-postgres psql -U kairo_admin -d kairo_dev -c "SELECT version();"
    docker exec kairo-postgres psql -U kairo_admin -d kairo_dev -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
    ```

## Daily commands

Start:

```powershell
docker compose up -d
```

Check status:

```powershell
docker compose ps
```

View logs:

```powershell
docker compose logs --tail 100 kairo-postgres
```

Stop the container without deleting database data:

```powershell
docker compose stop
```

Restart:

```powershell
docker compose restart kairo-postgres
```

## Backup and restore

Create a custom-format backup:

```powershell
docker exec kairo-postgres pg_dump -U kairo_admin -d kairo_dev -Fc -f /tmp/kairo_dev.dump
docker cp kairo-postgres:/tmp/kairo_dev.dump E:\KairoBackups\kairo_dev.dump
```

Validate the archive:

```powershell
docker exec kairo-postgres pg_restore --list /tmp/kairo_dev.dump
```

Copy backups to removable storage only after validating them and checking that the file fits the destination filesystem.

A database backup does not include cluster-wide roles. Provision the application role separately on a fresh installation.

**Do not restore over an existing database without a verified backup and an explicit restoration plan.**

## Office and home PCs

- Git synchronizes source code, Compose configuration, scripts and documentation.
- `.env` contains local credentials and must not be committed.
- The named Docker volume stores live database data locally.
- Docker Desktop storage should remain on an internal drive on each PC.
- A database backup must be transferred and restored separately to transfer database records.
- Each PC must have Docker Desktop, compatible image versions and its own local configuration.

## Safety

- Do not run `docker compose down -v` as a routine cleanup command; it can delete the database volume.
- Do not delete `kairo_postgres_data` unless the data is intentionally disposable and a recovery plan exists.
- Do not run Kairo schema migrations until the application integration plan is reviewed.
- Keep existing SQL Server configuration and data untouched.
