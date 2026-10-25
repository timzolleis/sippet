# sippet

Personal recipe app; Claude reads and edits a cook's library through MCP.

- `stories/` — the what. Rules are cited as "rule 3" (same file) or "recipe rule 11" (other file).
- `specs/` — the how. Read in order: `mcp.md`, `hosting.md`, `account-ui.md`.
- `spike/` — throwaway reference. Don't import from it.

## Layout

| Path | Owner |
|---|---|
| `src/domain/`, `test/domain/` | domain: pure Effect 4, no Workers, no IO |
| `alchemy.run.ts`, `src/worker.ts`, `src/auth.ts`, `src/cook-library.ts`, `scripts/`, `migrations/` | hosting |
| `web/`, `vite.config.ts`, `components.json` | account UI: Vite + React on the Triargos design system; `web/src/components/ui`, `web/src/lib` are vendored from its registry |

## Rules

- Code style: the effect-ddd skill (`~/.agents/skills/effect-ddd/SKILL.md`).
- Stay inside your paths. Need a change elsewhere? Say so in your final report.
- Only hosting adds dependencies. Pin exact versions (`pnpm add -E`).
- `pnpm test`, `pnpm typecheck` and `pnpm lint` pass before you report done.
- Commit on your branch with conventional commits. Don't merge, rebase, or push.
- Spec wrong or a Verify item fails: stop, report the finding and options. Don't redesign silently.
