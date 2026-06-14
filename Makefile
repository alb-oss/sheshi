.PHONY: build backend-build backend-test frontend-build frontend-dev

build: backend-build frontend-build

backend-build:
	dotnet build server/Sheshi.sln

backend-test:
	dotnet test server/Sheshi.sln

frontend-build:
	npm run frontend:build

frontend-dev:
	npm run dev
