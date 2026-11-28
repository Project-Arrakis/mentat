import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PermissionFlagsBits } from "discord.js";
import { isHiddenFromEveryone, readAtlasPasswords, withAtlasPasswords } from "../src/atlasPasswords.js";
import { atlasRefresher } from "../src/atlasRefresh.js";
import { createDatabase, getLiveMessage, setLiveMessage } from "../src/database.js";
import { formatAtlasEmbed } from "../src/embedFormat.js";

// The passwords below are made up.
const ATLAS = {
  ok: true,
  coriolisSeed: "cor-6",
  coriolisNextCycleAt: null,
  sietches: {
    HaggaBasin: [
      { partitionId: "1", serverDisplayName: "Sietch Zahir", combatState: "PVE" },
      { partitionId: "37", serverDisplayName: "Sietch Kadir", combatState: "PVP" }
    ],
    DeepDesert: [{ partitionId: "8", serverDisplayName: null, combatState: "PVP" }]
  }
};
const FILE = { "Sietch Zahir": "fake-zahir-pass", 8: "fake-desert-pass" };

function passwordsFile(t, content = JSON.stringify(FILE)) {
  const dir = mkdtempSync(join(tmpdir(), "atlas-pw-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "atlas-passwords.json");
  writeFileSync(path, content, { mode: 0o600 });
  return path;
}

function fakeChannel({ id = "channel-1", everyoneCanView = false } = {}) {
  const everyone = { id: "everyone" };
  const channel = {
    id,
    guildId: "guild-1",
    guild: { roles: { everyone } },
    permissionsFor: (role) => {
      assert.equal(role, everyone);
      return { has: (flag) => flag === PermissionFlagsBits.ViewChannel && everyoneCanView };
    },
    isTextBased: () => true,
    sent: [],
    edits: [],
    deleted: [],
    send: async (content) => { channel.sent.push(content); return { id: `${id}-message-${channel.sent.length}` }; },
    messages: {
      fetch: async (messageId) => ({
        id: messageId,
        edit: async (content) => { channel.edits.push(content); },
        delete: async () => { channel.deleted.push(messageId); }
      })
    }
  };
  return channel;
}

function refresherFor(channels, { file, db = createDatabase(":memory:"), channelId = "channel-1" } = {}) {
  const errors = [];
  const refresher = atlasRefresher({
    adapterClient: { atlas: async () => ATLAS },
    client: { channels: { fetch: async (id) => channels.find((c) => c.id === id) } },
    db,
    channelId,
    passwordsFile: file,
    onError: (error) => errors.push(error)
  });
  return { refresher, errors, db };
}

const textOf = (content) => JSON.stringify(content.embeds[0].toJSON());

test("a failing source still clears the message once @everyone can see the channel", async (t) => {
  const channel = fakeChannel();
  let fail = false;
  const errors = [];
  const refresher = atlasRefresher({
    adapterClient: { atlas: async () => { if (fail) throw new Error("source down"); return ATLAS; } },
    client: { channels: { fetch: async () => channel } },
    db: createDatabase(":memory:"),
    channelId: "channel-1",
    passwordsFile: passwordsFile(t),
    onError: (error) => errors.push(error)
  });
  await refresher.refresh();
  fail = true;

  await refresher.refresh();
  assert.equal(channel.edits.length, 0, "a restricted channel keeps its message");

  channel.permissionsFor = () => ({ has: () => true });
  await refresher.refresh();
  assert.equal(channel.edits.length, 1);
  assert.doesNotMatch(textOf(channel.edits[0]), /fake-/);
  assert.match(textOf(channel.edits[0]), /no longer restricted/);
  assert.equal(errors.length, 2);
});

test("a failing source posts nothing when there is no earlier message", async (t) => {
  const channel = fakeChannel({ everyoneCanView: true });
  const refresher = atlasRefresher({
    adapterClient: { atlas: async () => { throw new Error("source down"); } },
    client: { channels: { fetch: async () => channel } },
    db: createDatabase(":memory:"),
    channelId: "channel-1",
    passwordsFile: passwordsFile(t),
    onError: () => {}
  });
  await refresher.refresh();
  assert.equal(channel.sent.length, 0);
});

test("an earlier copy that cannot be removed is reported", async (t) => {
  for (const [code, reported] of [[50013, 1], [500, 1], [10008, 0]]) {
    const oldChannel = fakeChannel({ id: "old-channel" });
    oldChannel.messages.fetch = async () => ({ delete: async () => { throw Object.assign(new Error("no"), { code }); } });
    const channel = fakeChannel();
    const db = createDatabase(":memory:");
    setLiveMessage(db, "guild-1", "atlas", "old-channel", "old-message");
    const { refresher, errors } = refresherFor([oldChannel, channel], { file: passwordsFile(t), db });

    await refresher.refresh();

    assert.equal(errors.length, reported, String(code));
    if (reported) assert.match(errors[0].message, /old-channel could not be removed/);
    assert.equal(channel.sent.length, 1);
  }
});

test("file entries that match no sietch are counted, never named", async (t) => {
  const channel = fakeChannel();
  const file = passwordsFile(t, JSON.stringify({ "Sietch Zahir": "fake-zahir-pass", "fake-swapped": "x", "Partition 8": "y" }));
  const { refresher, errors } = refresherFor([channel], { file });

  await refresher.refresh();

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /matching no sietch: 2\./);
  assert.ok(!errors[0].message.includes("fake-swapped"));
});

test("a long list continues in further fields with every password whole", () => {
  const sietches = Array.from({ length: 12 }, (_, i) => ({
    partitionId: String(i + 1),
    serverDisplayName: `Sietch Number ${i + 1}`,
    combatState: "PVE",
    loginPassword: `${i + 1}-${"p".repeat(60)}`
  }));
  const embed = formatAtlasEmbed({ ok: true, sietches: { HaggaBasin: sietches, DeepDesert: [] } }).toJSON();
  const lists = embed.fields.filter((field) => field.name.startsWith("Hagga Basin"));
  assert.ok(lists.length > 1);
  assert.equal(lists[1].name, "Hagga Basin (continued)");
  const text = lists.map((field) => field.value).join("\n");
  for (const sietch of sietches) assert.ok(text.includes(`\`${sietch.loginPassword}\``), sietch.partitionId);
  for (const field of lists) assert.ok(field.value.length <= 1024);
});

test("a seed without a cycle date reads as not yet known", () => {
  const embed = formatAtlasEmbed({ ok: true, coriolisSeed: "cor-6", coriolisNextCycleAt: null, sietches: {} }).toJSON();
  assert.match(embed.description, /not yet known/);
  assert.doesNotMatch(embed.description, /<t:/);
});

test("passwords match by displayed name or partition number, without changing the source payload", () => {
  const result = withAtlasPasswords(ATLAS, new Map(Object.entries(FILE)));
  assert.equal(result.sietches.HaggaBasin[0].loginPassword, "fake-zahir-pass");
  assert.equal(result.sietches.HaggaBasin[1].loginPassword, undefined);
  assert.equal(result.sietches.DeepDesert[0].loginPassword, "fake-desert-pass");
  assert.equal(ATLAS.sietches.HaggaBasin[0].loginPassword, undefined);
  assert.deepEqual(withAtlasPasswords({ ok: false }, new Map()), { ok: false });
});

test("the shared entry covers every Hagga Basin sietch and never the Deep Desert", () => {
  const shared = withAtlasPasswords(ATLAS, new Map([["*", "fake-shared-pass"]]));
  assert.deepEqual(shared.sietches.HaggaBasin.map((s) => s.loginPassword), ["fake-shared-pass", "fake-shared-pass"]);
  assert.equal(shared.sietches.DeepDesert[0].loginPassword, undefined);

  const mixed = withAtlasPasswords(ATLAS, new Map([["*", "fake-shared-pass"], ["37", "fake-kadir-pass"], ["8", "fake-desert-pass"]]));
  assert.deepEqual(mixed.sietches.HaggaBasin.map((s) => s.loginPassword), ["fake-shared-pass", "fake-kadir-pass"]);
  assert.equal(mixed.sietches.DeepDesert[0].loginPassword, "fake-desert-pass");
});

test("the shared entry is shown in the channel message and not counted as unmatched", async (t) => {
  const channel = fakeChannel();
  const file = passwordsFile(t, JSON.stringify({ "*": "fake-shared-pass" }));
  const { refresher, errors } = refresherFor([channel], { file });

  await refresher.refresh();

  assert.equal(errors.length, 0);
  assert.equal(textOf(channel.sent[0]).split("fake-shared-pass").length - 1, 2);
});

test("the channel message shows the passwords when @everyone cannot see the channel", async (t) => {
  const channel = fakeChannel();
  const { refresher, errors } = refresherFor([channel], { file: passwordsFile(t) });

  await refresher.refresh();

  assert.deepEqual(errors, []);
  assert.match(textOf(channel.sent[0]), /fake-zahir-pass/);
  assert.match(textOf(channel.sent[0]), /fake-desert-pass/);
});

test("a changed file shows at the next refresh", async (t) => {
  const file = passwordsFile(t);
  const channel = fakeChannel();
  const { refresher } = refresherFor([channel], { file });

  await refresher.refresh();
  writeFileSync(file, JSON.stringify({ 1: "fake-new-pass" }));
  await refresher.refresh();

  assert.match(textOf(channel.edits[0]), /fake-new-pass/);
  assert.doesNotMatch(textOf(channel.edits[0]), /fake-zahir-pass/);
});

test("passwords are left out, and the reason reported, when @everyone can see the channel", async (t) => {
  const channel = fakeChannel({ everyoneCanView: true });
  const { refresher, errors } = refresherFor([channel], { file: passwordsFile(t) });

  await refresher.refresh();

  assert.equal(channel.sent.length, 1, "the atlas itself still posts");
  assert.doesNotMatch(textOf(channel.sent[0]), /fake-/);
  assert.match(errors[0].message, /passwords left out/);
});

test("a channel whose visibility cannot be checked counts as visible", () => {
  assert.equal(isHiddenFromEveryone({}), false);
  assert.equal(isHiddenFromEveryone({ guild: { roles: { everyone: {} } } }), false);
  assert.equal(isHiddenFromEveryone({ guild: { roles: { everyone: {} } }, permissionsFor: () => null }), false);
  assert.equal(isHiddenFromEveryone(fakeChannel()), true);
});

test("a bad file leaves passwords out and no error repeats its content", async (t) => {
  const cases = [
    "{ \"Sietch Zahir\": \"fake-secret\", }",
    "fake-secret",
    JSON.stringify(["fake-secret"]),
    JSON.stringify({ 1: "fake-secret`" }),
    JSON.stringify({ 1: "fake-secret\nsecond" }),
    JSON.stringify({ 1: `fake-secret${"x".repeat(64)}` }),
    JSON.stringify({ 1: "" }),
    JSON.stringify({ 1: 12345 })
  ];
  for (const content of cases) {
    const channel = fakeChannel();
    const { refresher, errors } = refresherFor([channel], { file: passwordsFile(t, content) });
    await refresher.refresh();
    assert.equal(errors.length, 1, content);
    assert.match(errors[0].message, /DUNE_ATLAS_PASSWORDS_FILE/);
    assert.ok(!errors[0].message.includes("fake-secret"), content);
    assert.doesNotMatch(textOf(channel.sent[0]), /fake-secret/);
  }
  await assert.rejects(readAtlasPasswords(join(tmpdir(), "no-such-atlas-passwords.json")), /ENOENT/);
});

const FROM_SOURCE = {
  ...ATLAS,
  sietches: {
    HaggaBasin: ATLAS.sietches.HaggaBasin.map((sietch) => ({ ...sietch, loginPassword: "fake-source-pass" })),
    DeepDesert: ATLAS.sietches.DeepDesert.map((sietch) => ({ ...sietch, loginPassword: "fake-source-desert" }))
  }
};

function sourceRefresher(channel, atlas, { file = null, db = createDatabase(":memory:") } = {}) {
  const errors = [];
  const refresher = atlasRefresher({
    adapterClient: { atlas },
    client: { channels: { fetch: async () => channel } },
    db,
    channelId: "channel-1",
    passwordsFile: file,
    onError: (error) => errors.push(error)
  });
  return { refresher, errors };
}

test("passwords from the source are left out when @everyone can see the channel", async (t) => {
  for (const file of [null, passwordsFile(t)]) {
    const channel = fakeChannel({ everyoneCanView: true });
    const { refresher, errors } = sourceRefresher(channel, async () => FROM_SOURCE, { file });

    await refresher.refresh();

    assert.equal(channel.sent.length, 1, "the atlas itself still posts");
    assert.doesNotMatch(textOf(channel.sent[0]), /fake-/);
    assert.match(textOf(channel.sent[0]), /Sietch Zahir/);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /passwords left out/);
    assert.ok(!errors[0].message.includes("fake-"));
  }
  assert.equal(FROM_SOURCE.sietches.HaggaBasin[0].loginPassword, "fake-source-pass", "the source payload is not changed");
});

test("passwords from the source still show in a channel @everyone cannot see", async () => {
  const channel = fakeChannel();
  const { refresher, errors } = sourceRefresher(channel, async () => FROM_SOURCE);

  await refresher.refresh();

  assert.deepEqual(errors, []);
  assert.match(textOf(channel.sent[0]), /fake-source-pass/);
  assert.match(textOf(channel.sent[0]), /fake-source-desert/);
});

test("a failing source asked for passwords by role also clears an opened channel", async (t) => {
  const before = process.env.DUNE_ATLAS_PASSWORD_ROLE_IDS;
  t.after(() => {
    if (before === undefined) delete process.env.DUNE_ATLAS_PASSWORD_ROLE_IDS;
    else process.env.DUNE_ATLAS_PASSWORD_ROLE_IDS = before;
  });
  for (const [roles, edits] of [["role-1", 1], ["", 0]]) {
    process.env.DUNE_ATLAS_PASSWORD_ROLE_IDS = roles;
    const channel = fakeChannel({ everyoneCanView: true });
    const db = createDatabase(":memory:");
    setLiveMessage(db, "guild-1", "atlas", "channel-1", "message-1");
    const { refresher } = sourceRefresher(channel, async () => { throw new Error("source down"); }, { db });

    await refresher.refresh();

    assert.equal(channel.edits.length, edits, `roles "${roles}"`);
  }
});

test("a sietch named like the shared entry does not pick it up", () => {
  const payload = {
    ok: true,
    sietches: {
      HaggaBasin: [{ partitionId: "1", serverDisplayName: "*" }],
      DeepDesert: [{ partitionId: "8", serverDisplayName: "*" }, { partitionId: "*", serverDisplayName: null }]
    }
  };
  const result = withAtlasPasswords(payload, new Map([["*", "fake-shared-pass"]]));
  assert.equal(result.sietches.HaggaBasin[0].loginPassword, "fake-shared-pass");
  assert.deepEqual(result.sietches.DeepDesert.map((s) => s.loginPassword), [undefined, undefined]);
});

test("a file other users can access is not used", { skip: process.platform === "win32" && "no POSIX permissions" }, async (t) => {
  for (const mode of [0o644, 0o640, 0o604, 0o660, 0o606]) {
    const file = passwordsFile(t);
    chmodSync(file, mode);
    const channel = fakeChannel();
    const { refresher, errors } = refresherFor([channel], { file });

    await refresher.refresh();

    assert.doesNotMatch(textOf(channel.sent[0]), /fake-/, mode.toString(8));
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, new RegExp(`open to other users \\(permissions ${mode.toString(8)}\\)`));
    assert.ok(!errors[0].message.includes("fake-"));
  }
  for (const mode of [0o600, 0o400]) {
    const file = passwordsFile(t);
    chmodSync(file, mode);
    assert.equal((await readAtlasPasswords(file)).get("8"), "fake-desert-pass", mode.toString(8));
  }
});

test("permissions are not checked on Windows", async (t) => {
  const file = passwordsFile(t);
  chmodSync(file, 0o644);
  assert.equal((await readAtlasPasswords(file, { platform: "win32" })).size, 2);
});

test("without a passwords file nothing is added", async () => {
  const channel = fakeChannel({ everyoneCanView: true });
  const { refresher, errors } = refresherFor([channel], { file: null });
  await refresher.refresh();
  assert.deepEqual(errors, []);
  assert.doesNotMatch(textOf(channel.sent[0]), /fake-/);
});

test("passwords never go to an earlier channel: the old message is removed and a new one posted", async (t) => {
  const oldChannel = fakeChannel({ id: "old-channel", everyoneCanView: true });
  const channel = fakeChannel();
  const db = createDatabase(":memory:");
  setLiveMessage(db, "guild-1", "atlas", "old-channel", "old-message");
  const { refresher } = refresherFor([oldChannel, channel], { file: passwordsFile(t), db });

  await refresher.refresh();

  assert.equal(oldChannel.edits.length, 0);
  assert.deepEqual(oldChannel.deleted, ["old-message"]);
  assert.match(textOf(channel.sent[0]), /fake-zahir-pass/);
  assert.equal(getLiveMessage(db, "guild-1", "atlas").channel_id, "channel-1");
});

test("a passing Discord error posts no second copy", async (t) => {
  const channel = fakeChannel();
  channel.messages.fetch = async () => { throw Object.assign(new Error("Discord is unavailable"), { code: 500 }); };
  const db = createDatabase(":memory:");
  setLiveMessage(db, "guild-1", "atlas", "channel-1", "message-1");
  const { refresher, errors } = refresherFor([channel], { file: passwordsFile(t), db });

  await refresher.refresh();

  assert.equal(channel.sent.length, 0);
  assert.match(errors[0].message, /unavailable/);
});
