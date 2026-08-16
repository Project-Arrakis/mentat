#!/usr/bin/env node
/**
 * setup-keys.js
 *
 * Phase 1 of the KEK/DEK secrets hierarchy (issues #107/#108/#109, design
 * doc: docs/design/pki-cmk-secrets-l1-design-audit-2026-08-08.md).
 *
 * Generates:
 *   1. An age identity key pair (the root of trust -- operator-controlled,
 *      never sent anywhere, never stored by this bot except on disk where
 *      the operator puts it).
 *   2. A random 32-byte KEK (Key Encryption Key), age-encrypted to the
 *      identity's public key.
 *   3. (Unless --no-recovery) Break-glass recovery material for the age
 *      identity: either Shamir M-of-N shares or a QR code backup image,
 *      operator's choice -- see docs/security-secrets-at-rest.md's
 *      "Break-Glass Recovery" section for when to use which.
 *
 * This script does NOT modify any existing secret, database row, or
 * environment file. It only creates new files under the given --dir (or
 * ~/.config/acp by default) and prints the environment variables the
 * operator must set to activate them. Activation is a separate, explicit
 * step (setting ACP_KEK_FILE/ACP_AGE_IDENTITY_FILE and restarting the
 * bot) -- this script never restarts anything or writes to .env itself,
 * so a mistake here cannot brick an already-running bot.
 *
 * Requires the `age` binary (https://age-encryption.org) to be installed
 * and on PATH. This is the same dependency dune-awakening-selfhost-docker's
 * own age-based secrets library already requires, for the same reason
 * (single static binary, no service dependency, operator-controlled root
 * of trust -- see that repo's runtime/scripts/lib/secrets.sh).
 *
 * Usage:
 *   node scripts/setup-keys.js [--dir <path>] [--recovery shamir|qr|none]
 *     [--shamir-shares N] [--shamir-threshold N]
 *
 * Defaults: --dir ~/.config/acp, --recovery shamir, shares=3, threshold=2
 * (matching the design doc's "3 shares, any 2 reconstruct" recommendation).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import sss from "shamirs-secret-sharing";
import QRCode from "qrcode";

export function parseArgs(argv) {
  const args = { dir: join(homedir(), ".config", "acp"), recovery: "shamir", shamirShares: 3, shamirThreshold: 2 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--recovery") args.recovery = argv[++i];
    else if (arg === "--shamir-shares") args.shamirShares = Number.parseInt(argv[++i], 10);
    else if (arg === "--shamir-threshold") args.shamirThreshold = Number.parseInt(argv[++i], 10);
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  if (!["shamir", "qr", "none"].includes(args.recovery)) {
    console.error(`Unknown --recovery value: ${args.recovery} (expected shamir, qr, or none)`);
    process.exit(2);
  }
  if (args.recovery === "shamir" && !(args.shamirThreshold >= 2 && args.shamirThreshold <= args.shamirShares)) {
    console.error(`--shamir-threshold must be between 2 and --shamir-shares (got threshold=${args.shamirThreshold}, shares=${args.shamirShares})`);
    process.exit(2);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/setup-keys.js [--dir <path>] [--recovery shamir|qr|none] [--shamir-shares N] [--shamir-threshold N]

Generates an age identity key, a KEK encrypted to it, and (unless
--recovery none) break-glass recovery material for the identity key.

  --dir <path>              Output directory (default: ~/.config/acp)
  --recovery <mode>         shamir (default), qr, or none
  --shamir-shares N         Total shares to generate (default: 3)
  --shamir-threshold N      Shares required to reconstruct (default: 2)
`);
}

function requireAgeBinary() {
  try {
    execFileSync("age", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    console.error("The `age` binary is required but was not found on PATH. Install it from https://age-encryption.org before running this script.");
    process.exit(1);
  }
}

export function generateAgeIdentity(dir) {
  const identityPath = join(dir, "age-identity.txt");
  if (existsSync(identityPath)) {
    console.error(`Refusing to overwrite an existing age identity: ${identityPath}`);
    console.error("If you intend to replace it, move or delete that file first, or use a different --dir.");
    process.exit(1);
  }
  execFileSync("age-keygen", ["-o", identityPath]);
  chmodSync(identityPath, 0o400);
  const identityText = readFileSync(identityPath, "utf8");
  const publicKeyLine = identityText.split("\n").find((line) => line.startsWith("# public key:"));
  const publicKey = publicKeyLine ? publicKeyLine.replace("# public key:", "").trim() : null;
  if (!publicKey) {
    console.error(`Could not extract the public key from the generated identity file: ${identityPath}`);
    process.exit(1);
  }
  return { identityPath, publicKey };
}

export function generateAndWrapKEK(dir, publicKey) {
  const kekHex = randomBytes(32).toString("hex");
  const kekPlainPath = join(dir, ".kek-plain-tmp.txt");
  const kekPath = join(dir, "kek.age");
  if (existsSync(kekPath)) {
    console.error(`Refusing to overwrite an existing KEK: ${kekPath}`);
    console.error("Use rotate-keys.js to replace an already-provisioned KEK, or a different --dir.");
    process.exit(1);
  }
  writeFileSync(kekPlainPath, kekHex, { mode: 0o600 });
  try {
    execFileSync("age", ["-r", publicKey, "-o", kekPath, kekPlainPath]);
  } finally {
    // Best-effort: the plaintext KEK must not linger on disk even if age
    // itself fails partway through.
    try { writeFileSync(kekPlainPath, ""); } catch {}
    try { execFileSync("rm", ["-f", kekPlainPath]); } catch {}
  }
  chmodSync(kekPath, 0o600);
  return kekPath;
}

export async function generateRecoveryMaterial(args, identityPath) {
  const identityText = readFileSync(identityPath, "utf8").trim();

  if (args.recovery === "none") {
    console.log("\nSkipping break-glass recovery material (--recovery none). If this age identity is ever lost, every secret encrypted under its KEK becomes permanently unrecoverable -- see the 'What if the key is lost' section of docs/security-secrets-at-rest.md before choosing this in production.");
    return;
  }

  if (args.recovery === "qr") {
    const qrPath = join(args.dir, "age-identity-recovery.png");
    await QRCode.toFile(qrPath, identityText, { errorCorrectionLevel: "M" });
    chmodSync(qrPath, 0o600);
    console.log(`\nQR code recovery backup written to: ${qrPath}`);
    console.log("Print this and store it somewhere physically secure (a safe, a safety deposit box) -- anyone who can scan it can decrypt every secret this bot protects. Do not store it digitally alongside the bot's other files.");
    return;
  }

  // Shamir sharding: split the full (trimmed) identity file text, not
  // just the AGE-SECRET-KEY-... line, so combine() reconstructs a
  // complete, valid identity file (including its "# created:"/
  // "# public key:" comment lines) -- recover-keys.js writes the
  // combined result straight back out as a valid age identity file with
  // no reformatting step that could introduce a transcription bug. Note
  // this is the TRIMMED text (no trailing newline) -- functionally
  // identical to the original file for age's own purposes (it does not
  // care about trailing whitespace, and recover-keys.js's own
  // verifyIdentity() proves this with a real encrypt/decrypt round-trip
  // rather than a byte comparison), but not literally byte-for-byte
  // identical to what's on disk at identityPath.
  const secretBuffer = Buffer.from(identityText, "utf8");
  const shares = sss.split(secretBuffer, { shares: args.shamirShares, threshold: args.shamirThreshold });
  console.log(`\n${args.shamirShares} Shamir shares generated (any ${args.shamirThreshold} reconstruct the age identity):\n`);
  const shareLines = [];
  for (let i = 0; i < shares.length; i++) {
    const sharePath = join(args.dir, `age-identity-share-${i + 1}-of-${args.shamirShares}.txt`);
    const shareHex = shares[i].toString("hex");
    writeFileSync(sharePath, shareHex, { mode: 0o600 });
    shareLines.push(sharePath);
    console.log(`  Share ${i + 1}: ${sharePath}`);
  }
  console.log(`\nDistribute these ${args.shamirShares} files to separate, trusted locations (different people, different physical locations, or a mix). No single share reveals anything about the identity -- only ${args.shamirThreshold} or more combined can reconstruct it. Do NOT keep all ${args.shamirShares} shares in the same place as each other or as the bot's own data -- that defeats the purpose of sharding. Use recover-keys.js to reconstruct the identity from any ${args.shamirThreshold} shares if the original is ever lost.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireAgeBinary();
  mkdirSync(args.dir, { recursive: true, mode: 0o700 });

  console.log(`Generating age identity and KEK in: ${args.dir}\n`);
  const { identityPath, publicKey } = generateAgeIdentity(args.dir);
  console.log(`Age identity: ${identityPath} (mode 0400)`);
  console.log(`Public key:   ${publicKey}`);

  const kekPath = generateAndWrapKEK(args.dir, publicKey);
  console.log(`KEK (age-encrypted): ${kekPath} (mode 0600)`);

  await generateRecoveryMaterial(args, identityPath);

  console.log("\nTo activate this KEK, set these environment variables and restart the bot:\n");
  console.log(`  ACP_AGE_IDENTITY_FILE=${identityPath}`);
  console.log(`  ACP_KEK_FILE=${kekPath}`);
  console.log(`  ACP_KEK_VERSION=1`);
  console.log("\nExisting adapter_token/access_token rows continue to work unchanged (v1 single-key format) until their next write, at which point they are transparently upgraded to per-row DEKs wrapped by this KEK. No manual migration step is required.");
}

// Guarded so this file can be imported for direct unit testing of the
// exported functions above without also running the full CLI flow --
// matches this repo's own established pattern (see reencrypt-secrets.js).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`setup-keys.js failed: ${error.message}`);
    process.exit(1);
  });
}
