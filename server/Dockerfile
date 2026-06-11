# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Sheshi.Api/Sheshi.Api.csproj Sheshi.Api/
RUN dotnet restore Sheshi.Api/Sheshi.Api.csproj
COPY Sheshi.Api/ Sheshi.Api/
RUN dotnet publish Sheshi.Api/Sheshi.Api.csproj -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
# curl is only needed for the container HEALTHCHECK below.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app .

# Run as a non-root user. The writable dirs are created and owned by that user
# so volume mounts (uploads, DataProtection keys) inherit the right ownership.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/uploads /app/keys \
    && chown -R app:app /app/uploads /app/keys
USER app

ENV ASPNETCORE_URLS=http://0.0.0.0:5080
EXPOSE 5080

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:5080/health || exit 1

ENTRYPOINT ["dotnet", "Sheshi.Api.dll"]
