# Contributing to Skaro

Thank you for your interest in contributing to Skaro! Every contribution matters — whether it's a bug report, a documentation fix, or a new feature.

Before starting work on a large change, please open a thread in [GitHub Discussions](https://github.com/skarodev/skaro/discussions) so the idea can be discussed with maintainers and the community.

## Ways to Contribute

- **Bug reports** — found a problem? Open an [Issue](https://github.com/skarodev/skaro/issues) with steps to reproduce.
- **Feature proposals** — share your idea in [Discussions](https://github.com/skarodev/skaro/discussions) first; after approval it becomes an Issue.
- **Code** — fix a bug, implement an approved feature, or improve internals.
- **Tests** — increase coverage or add missing edge-case tests.
- **Documentation** — improve README, docstrings, or create usage guides.
- **Translations** — Skaro supports i18n; help translate the interface into your language.

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ |
| Node.js | 18+ |
| Git | any recent |

## Setting Up the Development Environment

```bash
git clone https://github.com/skarodev/skaro.git
cd skaro
python -m venv .venv
```

Activate the virtual environment:

```powershell
# Windows (PowerShell)
.venv\Scripts\activate
```

```bash
# macOS / Linux
source .venv/bin/activate
```

Install the project in editable mode with dev dependencies:

```bash
pip install -e ".[dev]"
```

Build the frontend:

```bash
cd frontend
npm install
npm run build
cd ..
```

Verify everything works:

```bash
pytest
```

## Code Style

### Python

The project uses [Ruff](https://docs.astral.sh/ruff/) for linting and formatting.

Current config (`pyproject.toml`):

- `line-length = 100`
- Enabled rule sets: `E`, `F`, `I`, `N`, `W`, `UP`

Run the linter before committing:

```bash
ruff check .
ruff format .
```

### Frontend (Svelte 5)

The frontend lives in `frontend/` and uses SvelteKit with Vite. Follow the existing code style and keep components small and focused.

## Running Tests

```bash
pytest
```

All new code should include tests. If you fix a bug, add a test that reproduces it.

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <short description>
```

**Types:**

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build process, CI, dependencies |

**Examples:**

```
feat(web): add dark mode toggle
fix(cli): correct config path on Windows
docs: update installation instructions
test(core): add coverage for devplan parser
```

## Branch Naming

Create branches from `main` using the pattern:

```
<type>/<short-description>
```

Examples: `feat/dark-mode`, `fix/windows-path`, `docs/contributing`.

## Pull Request Process

1. Create a branch from `main` following the naming convention above.
2. Make your changes in small, focused commits.
3. Ensure `ruff check .` and `pytest` pass locally.
4. Push your branch and open a Pull Request against `main`.
5. Fill in the PR description: **what** changed, **why**, and **how to test**.
6. Wait for a maintainer review. Address feedback with new commits (don't force-push during review).

## Reporting Issues

When filing a bug, include:

- Skaro version (`skaro --version`).
- OS and Python version.
- Steps to reproduce.
- Expected vs. actual behavior.
- Logs or error output if available.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license, the same license as the project.
