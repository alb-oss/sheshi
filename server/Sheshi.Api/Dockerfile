FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY server/Sheshi.sln server/Sheshi.sln
COPY server/Sheshi.Api/Sheshi.Api.csproj server/Sheshi.Api/Sheshi.Api.csproj
COPY server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj
RUN dotnet restore server/Sheshi.sln
COPY server server
RUN dotnet publish server/Sheshi.Api/Sheshi.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/alb-oss/sheshi"
ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "Sheshi.Api.dll"]
