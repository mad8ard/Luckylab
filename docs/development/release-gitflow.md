# Release and GitFlow

`main` should stay publishable. Use narrow branches and merge only after checks pass.

## Branch Types

```txt
feature/<scope>  normal development
hotfix/<scope>   production fix
release/<version> release preparation
```

Each branch should handle one clear topic.

## Daily Development

1. Start from current `main`.
2. Create a feature or hotfix branch.
3. Keep changes scoped to the topic.
4. Run focused checks while developing.
5. Run merge gates before returning to `main`.

## Merge Checklist

Before merging back:

- `git status --short` contains only this topic's files.
- Temporary screenshots, page snapshots, and local logs are not staged.
- `pnpm test` passes.
- `pnpm run build` passes.
- `pnpm run verify:pine` passes if Pine changed.
- Data generated assets are refreshed if CSV or index data changed.
- Developer docs are updated if architecture, commands, or workflows changed.

## Static Deployment

Production deploy reads `amplify.yml`:

```txt
preBuild:
  install pnpm
  remove node_modules
  pnpm install --frozen-lockfile

build:
  pnpm run build

artifacts:
  dist/
```

The clean install step is intentional. Do not reintroduce cached `node_modules` as an optimization unless the hosted build cache issue has been revalidated.

## Release Commit Style

Use clear commit prefixes:

- `feat:` for product or developer-facing capability
- `fix:` for bug or production repair
- `docs:` for documentation
- `build:` for build or CI pipeline
- `test:` for test-only changes

## Rollback Notes

Because the app is static, rollback usually means redeploying a previous good commit or reverting the faulty branch. For data incidents, first confirm whether `dist/` contains generated data modules before chasing runtime fetch behavior.
