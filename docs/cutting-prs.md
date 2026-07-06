# Cutting Upstream PRs

## Process

1. **Implement and test** the feature on a local branch.
2. **Stage the PR body** in `releases/<train>/pr-body.md` using the [PR transparency template](pr-transparency-template.md).
3. **Run the cutter** from that branch:
   ```
   bash scripts/cut-pr.sh <train-name>
   ```
4. **Create the change note** at `docs/changes/PR-####-short-name.md`.
5. **Update `docs/changes/README.md`** with the new PR entry.

## Examples

```bash
# Cut a PR for the write foundation
git checkout feature/r2-write-foundation
bash scripts/cut-pr.sh R2-foundation

# Cut a PR for the core adapter (different repo)
git checkout release/discord-adapter-readonly-code
gh pr create \
  --repo Red-Blink/dune-awakening-selfhost-docker \
  --base main \
  --head yacketrj:dune-awakening-selfhost-docker:release/discord-adapter-readonly-code \
  --title "Add modular read-only Discord adapter" \
  --body-file releases/adapter-readonly/pr-body.md
```

## What `cut-pr.sh` Does

1. Reads `releases/<train>/pr-body.md` for the PR body
2. Determines the branch from `git rev-parse --abbrev-ref HEAD`
3. Extracts the title from the first `#` heading in pr-body.md
4. Runs pre-commit hooks (semgrep, gitleaks, trivy, npm audit)
5. Runs unit tests
6. Prompts for confirmation
7. Creates the PR using `gh pr create`

## Required: `releases/<train>/pr-body.md`

Each train folder must have a `pr-body.md` with the transparency sections:

```markdown
# PR-XXXX: Title Here

## Summary
...

## User Impact
...

## Security Impact
...

## Least Privilege
...

## Tests and Evidence
- [ ] ...

## Known Limitations
...

## Sources
...
```

## Upstream Doc Policy

When cutting PRs upstream:
- **Always include (if changed):** adapter `setup-guide.md`, `admin-guide.md`, `api-adapter-contract.md`
- **Never include:** installation-guide.md, configuration.md, security audit, roadmap, release-process, releases/ staging
- Bot-only docs live in the bot repo for our tracking and usage
