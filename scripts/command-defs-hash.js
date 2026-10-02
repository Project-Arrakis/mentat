// Content hash of the slash-command tree this deployment would register.
//
// The deploy hook (and register-commands.js, after a successful PUT) use it
// so the "does Discord need a re-register?" decision is made on the real
// rendered tree under the deployed .env -- every source file and every env
// value that feeds commandDefinitions() is covered, so no hand-kept file
// list can rot (mentat#440).
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { commandDefinitions } from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { writesEnabled } from "../src/writes.js";

export function renderRegistration(config = loadConfig()) {
  const includeWriteGroup = writesEnabled(config);
  const commands = commandDefinitions({ includeWriteGroup });
  const scope = config.discord.guildId ? `guild:${config.discord.guildId}` : "global";
  return { commands, scope, includeWriteGroup };
}

export function hashRegistration({ commands, scope }, clientId) {
  return createHash("sha256").update(JSON.stringify({ clientId, scope, commands })).digest("hex");
}

// Node resolves the main module's real path for import.meta.url but leaves
// process.argv[1] as typed, so a symlinked or space-containing path would
// never match a naive comparison and the script would silently print nothing.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const config = loadConfig();
  process.stdout.write(`${hashRegistration(renderRegistration(config), config.discord.clientId)}\n`);
}
