import { REST, Routes } from "discord.js";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { fileURLToPath } from "node:url";
import { logInfo, logWarn } from "../src/logger.js";
import { renderRegistration, hashRegistration } from "./command-defs-hash.js";

const config = loadConfig();
const rest = new REST({ version: "10" }).setToken(config.discord.token);
const rendered = renderRegistration(config);
const { commands, scope, includeWriteGroup } = rendered;

if (config.discord.guildId) {
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body: commands });
} else {
  await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
}

// The hash is stored only after the PUT succeeded: a failed registration
// leaves the old hash, so the next deploy retries (mentat#440). A failure to
// STORE it must not turn a successful registration into a failed one: Discord
// is already updated, so it is reported as its own warning and the next
// deploy simply registers once more.
const hash = hashRegistration(rendered, config.discord.clientId);
// Default is relative to the repo, not the caller's cwd, so a manual run and
// the deploy hook always agree on the file.
const stateFile = resolve(process.env.DUNE_REGISTER_STATE_FILE || fileURLToPath(new URL("../runtime/registered-commands.sha256", import.meta.url)));
let hashStored = true;
try {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(`${stateFile}.tmp`, `${hash}\n`, { mode: 0o600 });
  renameSync(`${stateFile}.tmp`, stateFile);
} catch (err) {
  hashStored = false;
  logWarn("discord.commands_hash_not_stored", { stateFile, error: err.message });
}

logInfo("discord.commands_registered", {
  commandSets: commands.length,
  scope: scope.startsWith("guild:") ? "guild" : "global",
  writesEnabled: includeWriteGroup,
  commands: commands.map((c) => c.name),
  groups: commands.flatMap((c) => (c.options || []).filter((o) => o.type === 2).map((o) => `${c.name}.${o.name}`)),
  hash: hash.slice(0, 12),
  hashStored
});
