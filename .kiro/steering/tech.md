# Tech Stack & Build System

## Runtime & Package Manager

- Node.js >= 22
- pnpm >= 9 (workspace monorepo)

## Language

- TypeScript 5.5+ with strict mode
- ES2022 target, ESM module resolution
- Shared `tsconfig.base.json` at root; each package extends it via `tsc --build` (project references)

## Key Libraries

| Area | Library |
|---|---|
| HTTP API | Fastify 5 |
| Minecraft bots | Mineflayer 4, mineflayer-pathfinder 2 |
| Database | better-sqlite3 |
| Testing | Vitest 2 |
| Property-based testing | fast-check 3/4 |
| Linting | ESLint 9 + @typescript-eslint |
| Formatting | Prettier 3 |
| Config | YAML (config/default.yaml) |

## Common Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (tsc --build across workspace)
pnpm test             # Run all unit tests (vitest run in each package)
pnpm lint             # ESLint across all packages
pnpm format           # Prettier auto-format
pnpm format:check     # Prettier check only
pnpm typecheck        # Type-check without emitting (tsc --build)
pnpm clean            # Remove dist/ and tsbuildinfo in all packages

# Single package
pnpm --filter @pyramid-os/<package-name> test
pnpm --filter @pyramid-os/<package-name> build
```

## Code Style Rules (enforced)

- Semicolons, single quotes, trailing commas, 2-space indent, LF line endings, 100 char print width
- `no-explicit-any` is an error
- `no-floating-promises` is an error
- `explicit-function-return-type` is a warning
- Unused vars prefixed with `_` are allowed

## Commit Convention

Conventional Commits: `type(scope): description`
- Types: feat, fix, docs, test, refactor, chore
- Scope: package name (e.g., `feat(orchestration): add agent recovery`)

## Testing Conventions

- Test runner: Vitest with `vitest run` (no watch mode in CI)
- Unit tests: `__tests__/*.test.ts` co-located in each package's `src/`
- Property-based tests: `__tests__/*.property.test.ts` using fast-check
- Each package has its own `vitest.config.ts`
