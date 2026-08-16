import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, reconstructFromShares, reconstructFromQR, verifyIdentity } from "../scripts/recover-keys.js";
import { generateAgeIdentity, generateRecoveryMaterial } from "../scripts/setup-keys.js";

function ageAvailable() {
  try {
    execFileSync("age", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("parseArgs requires --from-shares or --from-qr", () => {
  const originalExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error("process.exit called"); };
  try {
    assert.throws(() => parseArgs(["--output", "/tmp/x"]));
    assert.equal(exitCode, 2);
  } finally {
    process.exit = originalExit;
  }
});

test("parseArgs requires at least 2 share paths for --from-shares", () => {
  const originalExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error("process.exit called"); };
  try {
    assert.throws(() => parseArgs(["--from-shares", "one.txt", "--output", "/tmp/x"]));
    assert.equal(exitCode, 2);
  } finally {
    process.exit = originalExit;
  }
});

test("parseArgs requires --output", () => {
  const originalExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error("process.exit called"); };
  try {
    assert.throws(() => parseArgs(["--from-shares", "one.txt", "two.txt"]));
    assert.equal(exitCode, 2);
  } finally {
    process.exit = originalExit;
  }
});

test("parseArgs refuses to target an already-existing --output path", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-recover-keys-"));
  try {
    const existingPath = join(dir, "existing.txt");
    writeFileSync(existingPath, "x");
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; throw new Error("process.exit called"); };
    try {
      assert.throws(() => parseArgs(["--from-shares", "one.txt", "two.txt", "--output", existingPath]));
      assert.equal(exitCode, 1);
    } finally {
      process.exit = originalExit;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseArgs correctly collects multiple --from-shares paths up to the next flag", () => {
  const args = parseArgs(["--from-shares", "a.txt", "b.txt", "c.txt", "--output", "/tmp/nonexistent-output-xyz"]);
  assert.deepEqual(args.shares, ["a.txt", "b.txt", "c.txt"]);
  assert.equal(args.mode, "shamir");
});

test("reconstructFromQR reads the file's raw text unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-recover-keys-"));
  try {
    const qrTextPath = join(dir, "qr-text.txt");
    const content = "# created: 2026-01-01\n# public key: age1xxxxx\nAGE-SECRET-KEY-1XXXXX";
    writeFileSync(qrTextPath, content);
    assert.equal(reconstructFromQR(qrTextPath), content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconstructFromShares rejects a share file that isn't hex-encoded", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-recover-keys-"));
  try {
    const badShare = join(dir, "bad-share.txt");
    writeFileSync(badShare, "not-hex-at-all!!");
    assert.throws(() => reconstructFromShares([badShare, badShare]), /does not look like a hex-encoded share/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age + Shamir: full setup -> reconstruct -> verify pipeline recovers a working, matching identity", { skip: !ageAvailable() && "age binary not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-recover-keys-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    await generateRecoveryMaterial({ dir, recovery: "shamir", shamirShares: 3, shamirThreshold: 2 }, identityPath);

    const outputPath = join(dir, "recovered.txt");
    const identityText = reconstructFromShares([
      join(dir, "age-identity-share-1-of-3.txt"),
      join(dir, "age-identity-share-2-of-3.txt")
    ]);
    const recoveredPublicKey = verifyIdentity(identityText, outputPath);

    assert.equal(recoveredPublicKey, publicKey, "the recovered identity's public key must exactly match the original");
    assert.ok(existsSync(outputPath));
    assert.equal(statSync(outputPath).mode & 0o777, 0o400);

    // Prove the recovered identity is genuinely usable, not just
    // structurally similar: decrypt something real age-encrypted to the
    // ORIGINAL identity's public key, using the RECOVERED identity file.
    const probeEncPath = join(dir, "probe.age");
    execFileSync("age", ["-r", publicKey, "-o", probeEncPath], { input: "real-secret-value" });
    const decrypted = execFileSync("age", ["--decrypt", "-i", outputPath, probeEncPath], { encoding: "utf8" }).trim();
    assert.equal(decrypted, "real-secret-value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age + Shamir: recovering from too few shares fails verification and leaves no output file", { skip: !ageAvailable() && "age binary not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-recover-keys-"));
  try {
    const { identityPath } = generateAgeIdentity(dir);
    await generateRecoveryMaterial({ dir, recovery: "shamir", shamirShares: 3, shamirThreshold: 2 }, identityPath);

    const outputPath = join(dir, "recovered.txt");
    // Only 1 share when threshold is 2 -- sss.combine() does not throw
    // for this (its own documented behavior), it silently returns wrong
    // bytes. verifyIdentity() must catch this via its real round-trip
    // check, not accept a garbage reconstruction.
    const identityText = reconstructFromShares([join(dir, "age-identity-share-1-of-3.txt")]);
    assert.throws(() => verifyIdentity(identityText, outputPath), /not a valid age identity file/);
    assert.ok(!existsSync(outputPath), "no output file must be written when reconstruction is invalid");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age + Shamir: mixing shares from two different identities fails verification cleanly", { skip: !ageAvailable() && "age binary not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-recover-keys-"));
  try {
    const { mkdirSync } = await import("node:fs");
    const dirA = join(dir, "a");
    const dirB = join(dir, "b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    const { identityPath: identityPathA } = generateAgeIdentity(dirA);
    const { identityPath: identityPathB } = generateAgeIdentity(dirB);
    await generateRecoveryMaterial({ dir: dirA, recovery: "shamir", shamirShares: 3, shamirThreshold: 2 }, identityPathA);
    await generateRecoveryMaterial({ dir: dirB, recovery: "shamir", shamirShares: 3, shamirThreshold: 2 }, identityPathB);

    const outputPath = join(dir, "recovered.txt");
    const identityText = reconstructFromShares([
      join(dirA, "age-identity-share-1-of-3.txt"),
      join(dirB, "age-identity-share-1-of-3.txt")
    ]);
    assert.throws(() => verifyIdentity(identityText, outputPath));
    assert.ok(!existsSync(outputPath), "no output file must be written when shares from two different identities are mixed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age QR path: setup -> QR round-trip -> recover-keys.js --from-qr recovers a working identity", { skip: !ageAvailable() && "age binary not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-recover-keys-qr-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    const identityTextOnDisk = readFileSync(identityPath, "utf8");
    // Simulate the operator scanning the QR and saving the decoded text
    // to a file themselves (this repo deliberately does not decode QR
    // images -- see recover-keys.js's own "Why no image decoding"
    // comment) -- write the exact text QRCode.toFile() would have
    // encoded (setup-keys.js's own generateRecoveryMaterial() encodes
    // the TRIMMED identity text, see that file's comment).
    const qrTextPath = join(dir, "decoded-qr.txt");
    writeFileSync(qrTextPath, identityTextOnDisk.trim());

    const outputPath = join(dir, "recovered-from-qr.txt");
    const identityText = reconstructFromQR(qrTextPath);
    const recoveredPublicKey = verifyIdentity(identityText, outputPath);
    assert.equal(recoveredPublicKey, publicKey);

    const probeEncPath = join(dir, "probe.age");
    execFileSync("age", ["-r", publicKey, "-o", probeEncPath], { input: "qr-recovered-secret" });
    const decrypted = execFileSync("age", ["--decrypt", "-i", outputPath, probeEncPath], { encoding: "utf8" }).trim();
    assert.equal(decrypted, "qr-recovered-secret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
