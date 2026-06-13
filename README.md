# Sheshi

Canonical production code lives in `alb_sheshi/`.

- `alb_sheshi/frontend` is the current SPA frontend.
- `alb_sheshi/server` is the current .NET backend.
- `alb_sheshi/infra` contains current deployment/runtime support.
- `alb_sheshi/server/README.md` is the backend runbook.
- `docs/` contains planning and historical design notes. Treat docs as context,
  not as the runtime ownership boundary.

The root-level app tree (`src/`, `server/`, `supabase/`, `public/`, and the root
frontend build files) is legacy reference material from the earlier prototype.
Do not add production work there. New application changes should go under
`alb_sheshi/` unless the legacy tree is intentionally removed or migrated.

Generated or tool-owned paths are not production source:

- `node_modules/`, `dist/`, `bin/`, and `obj/` are dependency/build output.
- `.desloppify*` and `.agents/` are local code-health tooling state.
- `alb_sheshi/.superpowers/` is design scratch/archive material.
- Runtime uploads under `alb_sheshi/server/Sheshi.Api/uploads/` are local data.

Canonical local commands:

```bash
npm run build       # same as make build
make build          # builds alb_sheshi/server and alb_sheshi/frontend
npm run dev         # runs the canonical SPA on localhost:3001
make frontend-dev   # same frontend dev command
```

Legacy prototype scripts are explicitly namespaced as `legacy:*` in the root
`package.json`.
