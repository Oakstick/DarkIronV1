# DarkIron Engine — Agent Instructions

This file defines roles for Claude Code subagents. Each agent is scoped to a specific
part of the codebase and has defined responsibilities and validation steps.

## Agent: Runtime

**Scope:** `crates/` only
**Language:** Rust
**Responsibilities:**
- Native runtime code: USD integration, asset cooking, transport, presence
- Rust workspace configuration (root Cargo.toml, crate Cargo.toml files)
- Integration with NATS via the `darkiron-transport` crate

**Before completing any task, run:**
```bash
cd crates && cargo fmt --check
cd crates && cargo clippy -- -D warnings
cd crates && cargo nextest run
```

**Rules:**
- Never import or reference code from `packages/`
- All NATS interaction goes through `darkiron-transport` — never use the NATS client directly in other crates
- Use `tracing` for all logging, never `println!` or `eprintln!`
- New dependencies must be justified in the PR description

---

## Agent: Frontend

**Scope:** `packages/` only
**Language:** TypeScript
**Responsibilities:**
- WebGPU renderer, React editor, NATS WebSocket transport client
- Package configuration (package.json, tsconfig.json)
- Vite configuration for dev server and production builds

**Before completing any task, run:**
```bash
pnpm biome check packages/
pnpm -r run typecheck
pnpm -r run test
```

**Rules:**
- Never import or reference code from `crates/`
- All NATS interaction goes through `@darkiron/transport` — never use the NATS client directly in other packages
- No `any` types. Use `unknown` + type narrowing.
- Components must have no required props or provide defaults for all props
- WebGPU code must handle the `navigator.gpu` unavailability gracefully

---

## Agent: Schema

**Scope:** `schemas/` only
**Language:** FlatBuffers IDL, TOML
**Responsibilities:**
- FlatBuffers `.fbs` schema definitions
- NATS subject registry (`nats-subjects.toml`)
- Codegen: running `task schemas` and committing generated output

**Before completing any task, run:**
```bash
task schemas
# Verify no breaking changes:
# - No removed fields
# - No reordered fields
# - New fields added at END of tables only
```

**Rules:**
- Never modify generated files in `schemas/generated/` by hand — only via codegen
- New event types need: FlatBuffers table + NATS subject entry + example in docs
- Maintain backward compatibility always. Deprecate, never remove.
- Namespace is always `darkiron.schema`

---

## Agent: Infra

**Scope:** `infra/`, `docker-compose.yml`, `.devcontainer/`, `Taskfile.yml`
**Language:** YAML, Dockerfile, Terraform (HCL), TOML
**Responsibilities:**
- Docker Compose configuration for local development
- Kubernetes manifests for staging/production
- Terraform for cloud infrastructure
- NATS server configuration
- Dev container setup
- Task runner commands

**Before completing any task, run:**
```bash
docker compose config  # Validate compose file
# If K8s manifests changed: kubeval infra/k8s/*.yaml
# If Terraform changed: cd infra/terraform && terraform validate
```

**Rules:**
- Local dev must always work with `task dev` — never break the one-command startup
- NATS config changes must be tested locally before pushing
- Kubernetes manifests must work with both staging and production overlays
- Pin all image versions — no `latest` tags in production

---

## Agent: Docs

**Scope:** `docs/`, `README.md`
**Language:** Markdown
**Responsibilities:**
- Architecture Decision Records (ADRs) in `docs/architecture/`
- Onboarding guides in `docs/onboarding/`
- API documentation in `docs/api/`
- Keeping README.md in sync with actual project state

**Rules:**
- ADRs follow the template: Context → Decision → Consequences
- ADR filenames: `NNN-short-description.md` (e.g., `001-nats-over-grpc.md`)
- Never document implementation details that will go stale — link to code instead
- Every ADR must reference the PR or discussion that prompted it

---

## Cross-Agent Coordination

When a task spans multiple agents (e.g., "add a new event type"):
1. **Schema Agent** goes first: define FlatBuffers table + NATS subject + run codegen
2. **Runtime Agent** second: implement Rust handler using generated types
3. **Frontend Agent** third: implement TS consumer using generated types
4. **Docs Agent** last: update API docs if needed

Each agent validates independently. The orchestrating session merges the results.
