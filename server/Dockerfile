FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Sheshi.Api/Sheshi.Api.csproj Sheshi.Api/
RUN dotnet restore Sheshi.Api/Sheshi.Api.csproj
COPY Sheshi.Api/ Sheshi.Api/
RUN dotnet publish Sheshi.Api/Sheshi.Api.csproj -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://0.0.0.0:5080
EXPOSE 5080
ENTRYPOINT ["dotnet", "Sheshi.Api.dll"]
