// atlasPasswords.js -- sietch join passwords for the #the-atlas channel
// message, from a file the operator keeps on the bot host
// (DUNE_ATLAS_PASSWORDS_FILE, see docs/configuration.md).
//
// Rules this module keeps:
//  - passwords are added only to the message in the configured channel, never
//    to a command reply (only atlasRefresh.js uses this module);
//  - they are added only when @everyone cannot see that channel; if that
//    cannot be established, they are left out;
//  - no error repeats anything from the file.

import { readFile } from "node:fs/promises";
import { PermissionFlagsBits } from "discord.js";

const MAX_PASSWORD_LENGTH = 64;
const MAPS = ["HaggaBasin", "DeepDesert"];
// One password shared by the Hagga Basin sietches. It never applies to the
// Deep Desert, which gets a password only from an entry of its own.
const SHARED_ENTRY = "*";

// The file is one JSON object. Each name is a sietch's displayed name, its
// partition number or the shared entry, and each value that password.
export async function readAtlasPasswords(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    // A JSON.parse message quotes the text it failed on, so it is not passed on.
    throw new Error(`DUNE_ATLAS_PASSWORDS_FILE could not be read as JSON (${error?.code || error?.name}).`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DUNE_ATLAS_PASSWORDS_FILE must hold one JSON object of sietch names and passwords.");
  }
  const passwords = new Map();
  for (const [sietch, password] of Object.entries(parsed)) {
    // A backtick or line break would break out of the code span in the message.
    if (typeof password !== "string" || !password || password.length > MAX_PASSWORD_LENGTH || /[`\r\n]/.test(password)) {
      throw new Error(`DUNE_ATLAS_PASSWORDS_FILE: every password must be 1 to ${MAX_PASSWORD_LENGTH} characters, with no backtick or line break.`);
    }
    passwords.set(sietch, password);
  }
  return passwords;
}

export function isHiddenFromEveryone(channel) {
  const everyone = channel?.guild?.roles?.everyone;
  const permissions = everyone ? channel.permissionsFor?.(everyone) : null;
  return Boolean(permissions) && !permissions.has(PermissionFlagsBits.ViewChannel);
}

export function countUnmatchedPasswords(payload, passwords) {
  if (payload?.ok !== true) return 0;
  const known = new Set();
  for (const map of MAPS) {
    for (const sietch of payload.sietches?.[map] ?? []) {
      known.add(String(sietch.partitionId));
      if (sietch.serverDisplayName) known.add(sietch.serverDisplayName);
    }
  }
  return [...passwords.keys()].filter((name) => name !== SHARED_ENTRY && !known.has(name)).length;
}

export function withAtlasPasswords(payload, passwords) {
  if (payload?.ok !== true) return payload;
  const sietches = { ...payload.sietches };
  for (const map of MAPS) {
    if (!Array.isArray(sietches[map])) continue;
    const shared = map === "HaggaBasin" ? passwords.get(SHARED_ENTRY) : undefined;
    sietches[map] = sietches[map].map((sietch) => {
      const password = passwords.get(String(sietch.partitionId)) ?? passwords.get(sietch.serverDisplayName) ?? shared;
      return password ? { ...sietch, loginPassword: password } : sietch;
    });
  }
  return { ...payload, sietches };
}
