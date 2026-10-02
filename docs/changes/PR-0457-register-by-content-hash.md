# PR Change Summary — Register slash commands by content hash (#440)

See the CHANGELOG entry. Files: `scripts/command-defs-hash.js`, `scripts/command-register-decision.sh`, `scripts/register-commands.js`, `scripts/deploy-post-receive.sh`; tests in `test/deploy-hook.bats` and `test/commandDefsHash.test.js`.

Deferred: layout guard (needs the layout flag, PR-3) and an ops alert (no ops webhook available to the hook).
