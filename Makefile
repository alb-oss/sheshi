.PHONY: build backend-build frontend-build frontend-dev

build: backend-build frontend-build

backend-build:
	cd alb_sheshi/server && dotnet build Sheshi.sln

frontend-build:
	cd alb_sheshi/frontend && npm run build

frontend-dev:
	cd alb_sheshi/frontend && npm run dev
