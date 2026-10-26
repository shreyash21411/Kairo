# =============================================================================
# Kairo V1 Production API Dockerfile (Render / Cloud Container Deployment)
# Multi-stage build targeting .NET 10.0 runtime with non-root security
# =============================================================================

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project definition files first for optimal layer caching
COPY backend/Kairo.Domain/Kairo.Domain.csproj backend/Kairo.Domain/
COPY backend/Kairo.Application/Kairo.Application.csproj backend/Kairo.Application/
COPY backend/Kairo.Infrastructure/Kairo.Infrastructure.csproj backend/Kairo.Infrastructure/
COPY backend/Kairo.MCP/Kairo.MCP.csproj backend/Kairo.MCP/
COPY backend/Kairo.API/Kairo.API.csproj backend/Kairo.API/
COPY backend/Kairo.Tests/Kairo.Tests.csproj backend/Kairo.Tests/
COPY backend/Kairo.slnx backend/

RUN dotnet restore backend/Kairo.API/Kairo.API.csproj

# Copy remaining source code
COPY backend/ backend/

# Build and publish in Release configuration
WORKDIR /src/backend/Kairo.API
RUN dotnet publish -c Release -o /app/publish --no-restore

# ─────────────────────────────────────────────────────────────────────────────
# Runtime Stage
# ─────────────────────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Install the native GSSAPI/Kerberos dependency required at runtime.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*

# Restore non-root execution.
USER $APP_UID

COPY --from=build --chown=$APP_UID:$APP_UID /app/publish .

ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production

EXPOSE 8080

ENTRYPOINT ["dotnet", "Kairo.API.dll"]
