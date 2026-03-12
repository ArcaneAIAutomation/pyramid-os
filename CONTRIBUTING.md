# Contributing to PYRAMID OS

Thank you for your interest in contributing to PYRAMID OS! This guide will help you get started.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

### Prerequisites

- **Node.js** 22 or higher
- **pnpm** 9 or higher
- **Ollama** installed and running (for LLM features)
- **Minecraft server** (for bot testing, optional for most development)

### Setup

1. Fork the repository and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/pyramid-os.git
   cd pyramid-os
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build all packages:

   ```bash
   pnpm build
   ```

4. Run the test suite:

   ```bash
   pnpm test
   ```

5. Verify linting and formatting:

   ```bash
   pnpm lint
   pnpm format:check
   ```

## Development Workflow

1. Create a feature branch from `main`:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the relevant package(s) under `packages/`.

3. Write or update tests for your changes.

4. Ensure all checks pass:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   ```

5. Commit your changes with a descriptive message:

   ```bash
   git commit -m "feat(package-name): add feature description"
   ```

6. Push your branch and open a Pull Request against `main`.

## Coding Standards

### TypeScript

- All code must be written in TypeScript with strict mode enabled.
- Use the shared `tsconfig.base.json` for compiler options.
- Define shared types in `packages/shared-types` — do not duplicate type definitions across packages.

### Style

- **ESLint** enforces code quality rules. Run `pnpm lint` to check.
- **Prettier** enforces formatting. Run `pnpm format` to auto-format, or `pnpm format:check` to verify.
- Use meaningful variable and function names.
- Add JSDoc comments for public APIs and complex logic.

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat(scope): description` — new feature
- `fix(scope): description` — bug fix
- `docs(scope): description` — documentation changes
- `test(scope): description` — test additions or fixes
- `refactor(scope): description` — code refactoring
- `chore(scope): description` — maintenance tasks

Use the package name as the scope (e.g., `feat(orchestration): add agent recovery`).

## Testing

### Unit Tests

- Write unit tests for all new functions and classes.
- Co-locate tests with source files using `__tests__/` directories or `.test.ts` suffix.
- Use Vitest as the test runner.

### Property-Based Tests

- Use `fast-check` for property-based tests where applicable.
- Property tests are especially valuable for serialization round-trips, state machines, and data transformations.
- Name property test files with `.property.test.ts` suffix.

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @pyramid-os/orchestration test

# Run tests in watch mode (development)
pnpm --filter @pyramid-os/orchestration test -- --watch
```

## Pull Request Process

1. Ensure your PR targets the `main` branch.
2. Fill out the PR template completely.
3. Ensure CI passes (lint, typecheck, test, build).
4. Request review from at least one maintainer.
5. Address review feedback promptly.
6. Squash commits before merging if requested.

## Project Structure

```
pyramid-os/
├── packages/
│   ├── orchestration/        # OpenClaw agent orchestrator
│   ├── minecraft-controller/ # Mineflayer bot control
│   ├── society-engine/       # Planning and scheduling
│   ├── blueprint/            # Blueprint system
│   ├── control-centre/       # Visual dashboard
│   ├── shared-types/         # Shared TypeScript types
│   ├── data-layer/           # SQLite + JSON persistence
│   ├── api/                  # Fastify REST API + WebSocket
│   ├── cli/                  # Command-line interface
│   └── logger/               # Structured logging
├── scripts/                  # Installation and utility scripts
├── config/                   # Default configuration files
├── docs/                     # Architecture and API documentation
└── examples/                 # Example configuration files
```

## Reporting Issues

- Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template for bugs.
- Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template for new ideas.
- Search existing issues before creating a new one.

## License

By contributing to PYRAMID OS, you agree that your contributions will be licensed under the [MIT License](LICENSE).
