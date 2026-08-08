# Market Lab Docs

This directory is the maintainer documentation for Market Lab. Keep it practical and implementation-oriented: architecture boundaries, formula evidence, data pipeline, quality gates, release flow, and handoff notes belong here. Long market essays or research logs should stay outside the app workspace.

## Start Here

- [Developer Guide](./development/README.md): local setup, code map, contribution workflow, and maintenance rules.
- [Bounded Context Map](./bounded-context-map.md): domain ownership and dependency direction.
- [Formula Evidence](./formula-evidence/README.md): formula source status, audit output, and implementation roadmap.

## Developer Structure

- [Contribution Workflow](./development/contributing.md): change routing, ownership checks, and review expectations.
- [Architecture](./development/architecture.md): DDD, MVVM, CQRS, and allowed dependency shape.
- [Domain Boundaries](./development/domain-boundaries.md): module ownership under `src/domain/`.
- [Formula and Planning Flow](./development/formula-and-planning.md): executable formula path, research path, and default order plan rules.
- [Data Pipeline](./development/data-pipeline.md): market data refresh, generated JS data assets, and validation.
- [ViewModel and UI](./development/viewmodel-ui.md): Pinia facade, composables, components, and UI text rules.
- [Quality Gates](./development/quality-gates.md): tests, build checks, data checks, audits, and Pine verification.
- [Release and GitFlow](./development/release-gitflow.md): branch rules, merge checklist, static deployment, and rollback notes.
- [Troubleshooting](./development/troubleshooting.md): common data, build, and UI symptoms with repo-local checks.
- [Glossary](./development/glossary.md): price semantics and domain terms that must not be mixed.

## Where Things Belong

| Topic | Location |
| --- | --- |
| Runtime architecture and code ownership | `docs/development/` |
| Formula sources, audits, and research status | `docs/formula-evidence/` |
| Historical planning handoffs | `docs/superpowers/` and focused handoff files |
| Public project positioning | root `README.md` |
| Long market essays or research logs | outside the app workspace |

## Handoff Notes

- [Optimization handoff](./optimization-handoff-cc.md)
- [Formula understanding audit](./formula-understanding-audit.md)
- [Superpowers plans and specs](./superpowers/)

## Documentation Rules

- Keep docs connected to real code paths and commands.
- Prefer compact checklists, ownership tables, and maintenance notes.
- Do not turn the main app docs into a blog.
- When behavior changes, update the nearest developer doc in the same branch.
