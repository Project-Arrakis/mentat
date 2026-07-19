# Cutting Upstream PRs

## Process

1. **Implement and test** the feature on a local branch.
2. **Push the branch** and verify CI passes before staging:
   ```
   git push origin <branch>
   gh run watch $(gh run list --branch <branch> --limit 1 --json databaseId -q '.[0].databaseId')
   ```
3. **Review and resolve** any GitHub Actions failures. Both `CI` and `Security Gates` workflows must pass.
4. **Stage the PR body** in `releases/<train>/pr-body.md` using the [PR transparency template](pr-transparency-template.md).
5. **Run the cutter** from that branch:
   ```
   bash scripts/cut-pr.sh <train-name>
   ```
6. **Create the change note** at `docs/changes/PR-####-short-name.md`.
7. **Update `docs/changes/README.md`** with the new PR entry.

## CI Gate Checks (Pre-PR)

Before cutting a PR, verify all workflows pass on the branch:

```bash
# Check CI status for your branch
bash scripts/ci-check.sh <branch>

# Or manually
gh run list --branch <branch> --limit 5 --json status,conclusion,name,headBranch
```

**Both must pass:**
- `CI` — lint, build, test
- `Security Gates` — Semgrep, Gitleaks, Trivy, npm audit, Docker build, Trivy image

### No Skipping Rule

**No tests or security gates may be skipped or excluded unless:**
1. **Explicitly instructed** to do so by the user, or
2. **The test is not relevant** to the PR scope (e.g., Discord bot tests when no Discord bot code is being PR'd, or console API tests when only bot documentation is changed)

**Never** use `--no-verify` to bypass pre-commit hooks without explicit instruction. If a gate fails, fix the root cause — do not skip it.

If either fails, resolve the failures before cutting the PR. Common failures:
| Failure | Fix |
|---------|-----|
| Docker Hub `connection reset by peer` | Re-run the job (transient) |
| Semgrep finding | Fix code or add documented false-positive allowlist |
| Gitleaks finding | Redact secret or add `.gitleaksignore` entry |
| Trivy image CVE | Update base image or accept documented risk |
| npm audit vulnerability | `npm audit fix` or pin/upgrade dependency |

## Examples

```bash
# Cut a PR for the write foundation
git checkout feature/r2-write-foundation
bash scripts/ci-check.sh feature/r2-write-foundation  # verify green
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
3. Runs `scripts/ci-check.sh` to verify CI status on the branch
4. Extracts the title from the first `#` heading in pr-body.md
5. Runs pre-commit hooks (semgrep, gitleaks, trivy, npm audit)
6. Runs unit tests
7. Prompts for confirmation
8. Creates the PR using `gh pr create`

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
