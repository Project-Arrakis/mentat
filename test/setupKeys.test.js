import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, generateAgeIdentity, generateAndWrapKEK, generateRecoveryMaterial } from "../scripts/setup-keys.js";

function ageAvailable() {
  try {
    execFileSync("age", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("parseArgs applies documented defaults", () => {
  const args = parseArgs([]);
  assert.equal(args.recovery, "shamir");
  assert.equal(args.shamirShares, 3);
  assert.equal(args.shamirThreshold, 2);
  assert.ok(args.dir.endsWith(join(".config", "acp")));
});

test("parseArgs accepts every documented flag", () => {
  const args = parseArgs(["--dir", "/custom/path", "--recovery", "qr", "--shamir-shares", "5", "--shamir-threshold", "3"]);
  assert.equal(args.dir, "/custom/path");
  assert.equal(args.recovery, "qr");
  assert.equal(args.shamirShares, 5);
  assert.equal(args.shamirThreshold, 3);
});

test("parseArgs rejects an unrecognized --recovery value", () => {
  const originalExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error("process.exit called"); };
  try {
    assert.throws(() => parseArgs(["--recovery", "bogus"]));
    assert.equal(exitCode, 2);
  } finally {
    process.exit = originalExit;
  }
});

test("parseArgs rejects a Shamir threshold below 2 or above shares", () => {
  const originalExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error("process.exit called"); };
  try {
    assert.throws(() => parseArgs(["--shamir-threshold", "1"]));
    assert.equal(exitCode, 2);
    exitCode = null;
    assert.throws(() => parseArgs(["--shamir-shares", "3", "--shamir-threshold", "5"]));
    assert.equal(exitCode, 2);
  } finally {
    process.exit = originalExit;
  }
});

test("real age: generateAgeIdentity writes a mode-0400 identity file and extracts its real public key", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-setup-keys-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    assert.ok(existsSync(identityPath));
    assert.equal(statSync(identityPath).mode & 0o777, 0o400);
    assert.match(publicKey, /^age1[a-z0-9]+$/);

    // The extracted public key must be the REAL one age itself reports
    // for this identity file, not just some string that looks right.
    const realPublicKey = execFileSync("age-keygen", ["-y", identityPath], { encoding: "utf8" }).trim();
    assert.equal(publicKey, realPublicKey);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age: generateAgeIdentity refuses to overwrite an existing identity file", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-setup-keys-"));
  try {
    generateAgeIdentity(dir);
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; throw new Error("process.exit called"); };
    try {
      assert.throws(() => generateAgeIdentity(dir));
      assert.equal(exitCode, 1);
    } finally {
      process.exit = originalExit;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age: generateAndWrapKEK produces a real, decryptable, mode-0600 KEK file with no plaintext left behind", { skip: !ageAvailable() && "age binary not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-setup-keys-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    const kekPath = generateAndWrapKEK(dir, publicKey);
    assert.ok(existsSync(kekPath));
    assert.equal(statSync(kekPath).mode & 0o777, 0o600);

    const decrypted = execFileSync("age", ["--decrypt", "-i", identityPath, kekPath], { encoding: "utf8" }).trim();
    assert.match(decrypted, /^[0-9a-f]{64}$/, "the KEK must be a valid 64-hex-char (32-byte) key");

    // No plaintext KEK temp file must remain on disk after a successful run.
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(dir);
    assert.ok(!files.some((f) => f.includes("plain")), "no plaintext KEK temp file must remain on disk");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age: generateAndWrapKEK refuses to overwrite an existing KEK", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-setup-keys-"));
  try {
    const { publicKey } = generateAgeIdentity(dir);
    generateAndWrapKEK(dir, publicKey);
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; throw new Error("process.exit called"); };
    try {
      assert.throws(() => generateAndWrapKEK(dir, publicKey));
      assert.equal(exitCode, 1);
    } finally {
      process.exit = originalExit;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age: generateRecoveryMaterial with --recovery none writes no recovery file", { skip: !ageAvailable() && "age binary not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-setup-keys-"));
  try {
    const { identityPath } = generateAgeIdentity(dir);
    await generateRecoveryMaterial({ dir, recovery: "none" }, identityPath);
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(dir);
    assert.ok(!files.some((f) => f.includes("share") || f.includes("recovery")), "no recovery artifact should be written when --recovery none is chosen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age: generateRecoveryMaterial with --recovery shamir produces N real, reconstructable shares that pass a real age round-trip", { skip: !ageAvailable() && "age binary not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-setup-keys-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    // generateRecoveryMaterial() shares the TRIMMED identity text (no
    // trailing newline) -- functionally identical to the original for
    // age's own purposes, but not literally byte-for-byte what's on
    // disk. See setup-keys.js's own comment on this for why that's fine.
    const originalIdentityTrimmed = readFileSync(identityPath, "utf8").trim();
    await generateRecoveryMaterial({ dir, recovery: "shamir", shamirShares: 3, shamirThreshold: 2 }, identityPath);

    const sss = (await import("shamirs-secret-sharing")).default;
    const share1 = Buffer.from(readFileSync(join(dir, "age-identity-share-1-of-3.txt"), "utf8").trim(), "hex");
    const share2 = Buffer.from(readFileSync(join(dir, "age-identity-share-2-of-3.txt"), "utf8").trim(), "hex");
    const combined = sss.combine([share1, share2]).toString("utf8");
    assert.equal(combined, originalIdentityTrimmed, "any 2 of the 3 real shares must reconstruct the exact (trimmed) original identity text");
    assert.equal(statSync(join(dir, "age-identity-share-1-of-3.txt")).mode & 0o777, 0o600);

    // The property that actually matters: the reconstructed text is a
    // genuinely usable age identity, proven with a real encrypt/decrypt
    // round-trip, not just a string comparison.
    const probePath = join(dir, "reconstructed-identity.txt");
    const { writeFileSync: write } = await import("node:fs");
    write(probePath, combined, { mode: 0o400 });
    const probeEncPath = join(dir, "probe.age");
    execFileSync("age", ["-r", publicKey, "-o", probeEncPath], { input: "probe-value" });
    const decrypted = execFileSync("age", ["--decrypt", "-i", probePath, probeEncPath], { encoding: "utf8" }).trim();
    assert.equal(decrypted, "probe-value", "the reconstructed identity must actually decrypt real age ciphertext, not just look correct");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age: generateRecoveryMaterial with --recovery qr produces a real, scannable-format QR image", { skip: !ageAvailable() && "age binary not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-setup-keys-"));
  try {
    const { identityPath } = generateAgeIdentity(dir);
    await generateRecoveryMaterial({ dir, recovery: "qr" }, identityPath);
    const qrPath = join(dir, "age-identity-recovery.png");
    assert.ok(existsSync(qrPath));
    assert.equal(statSync(qrPath).mode & 0o777, 0o600);
    // A real PNG file starts with the PNG magic bytes -- confirms
    // QRCode.toFile() actually produced image data, not an empty or
    // corrupted file.
    const { readFileSync: readBytes } = await import("node:fs");
    const bytes = readBytes(qrPath);
    assert.equal(bytes[0], 0x89);
    assert.equal(bytes[1], 0x50); // 'P'
    assert.equal(bytes[2], 0x4e); // 'N'
    assert.equal(bytes[3], 0x47); // 'G'
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
