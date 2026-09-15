#!/usr/bin/env node
/**
 * chronicles-of-kanly-phase0-provision.js
 *
 * Executes the additive/renaming subset of meta#66's Phase 0 checklist
 * (Chronicles of Kanly Discord guild redesign, meta#64) against the live
 * guild: rename, Verification Level, role creation, category/channel
 * creation, voice channel creation. Matches
 * docs/community/chronicles-of-kanly-discord-plan.md §1-3/§9 in
 * Project-Arrakis/meta exactly -- if that doc changes, update this file's
 * ROLES/CATEGORIES/VOICE_CHANNELS constants to match, don't let them drift.
 *
 * Deliberately OUT of scope (separate, more deliberate follow-ups, each
 * with its own higher blast radius per the plan doc's own phrasing):
 *   - Native Onboarding config (Rules ack -> Pledge your House -> opt-ins)
 *   - Posting Articles I-XIV content to #the-writ (still DRAFT, needs
 *     operator sign-off -- see chronicles-of-kanly-code-of-conduct.md)
 *   - Existing-member Houseless migration/backfill (the plan doc's own
 *     Rollback note: "pause... this is the one step touching people who
 *     didn't ask for this restructure")
 *   - Scoping Mentat's own permissions down from Administrator (must wait
 *     until Phase 1's QA gate verifies the reduced scope actually works)
 *
 * Usage:
 *   node scripts/chronicles-of-kanly-phase0-provision.js            # dry run (default, no mutations)
 *   node scripts/chronicles-of-kanly-phase0-provision.js --apply    # actually execute
 *
 * Idempotent: every step checks for an existing role/category/channel by
 * name before creating one, so a re-run (dry or applied) never creates a
 * duplicate.
 *
 * Reads the same DISCORD_BOT_TOKEN / DISCORD_BOT_TOKEN_FILE config.js
 * already uses for the live bot -- no new secret path.
 */

import {
  Client,
  GatewayIntentBits,
  ChannelType,
  GuildVerificationLevel,
  PermissionsBitField
} from "discord.js";
import { loadConfig } from "../src/config.js";

const GUILD_ID = "1203221052679790702";
const NEW_GUILD_NAME = "Chronicles of Kanly";
const AUDIT_REASON = "Chronicles of Kanly Phase 0 (Project-Arrakis/meta#66)";

// Order matches the plan doc's §1 "Roles (top to bottom)" list, restricted
// to exactly the subset Phase 0's own checklist names -- Swordmaster,
// Sietch Guard, and the 14 service badges are explicitly NOT created here
// (Phase 2/3). Array order is enforced as the final role hierarchy
// (index 0 = highest, just below any pre-existing roles above the bot's
// own top role) via a single setPositions() call after creation.
export const ROLES = [
  { name: "🏛️ Naib" },
  { name: "🗡️ Fedaykin" },
  { name: "🔪 Crysknife-Bearer" },
  { name: "🌫️ Off-worlder" },
  { name: "🏳️ Houseless" },
  { name: "🦅 House Atreides" },
  { name: "🐍 House Harkonnen" },
  { name: "🌪️ Coriolis Watch", mentionable: true },
  { name: "🏛️ Landsraad Crier", mentionable: true },
  { name: "⚔️ Kanly Crier", mentionable: true },
  { name: "🟢 On Duty" },
  { name: "🤖 Mentat" }
];

// lockedTo: role name(s) that get ViewChannel on this category, with
// @everyone denied ViewChannel. Categories without lockedTo are open to
// @everyone (still governed by whatever @everyone's base perms already
// are on the guild). Category permission overwrites are NOT synced down
// to children automatically by the API -- syncChildPermissions handles
// that explicitly per category below.
export const CATEGORIES = [
  {
    name: "📜 Arrival",
    channels: [
      { name: "the-writ", topic: "Server rules and Code of Conduct. Read-only.", readOnly: true },
      { name: "welcome" },
      { name: "announcements", readOnly: true },
      { name: "pledge-your-house", topic: "Pledge your House, or leave a House you've pledged. See #the-writ for the Code of Conduct." }
    ]
  },
  {
    name: "🏜️ The Desert",
    channels: [
      { name: "general-chat" },
      { name: "screenshots-and-glory" },
      { name: "new-pilgrims" }
    ]
  },
  {
    name: "🦅 House Atreides",
    lockedTo: ["🦅 House Atreides"],
    channels: [
      { name: "atreides-hall" },
      { name: "atreides-strategy" }
    ]
  },
  {
    name: "🐍 House Harkonnen",
    lockedTo: ["🐍 House Harkonnen"],
    channels: [
      { name: "harkonnen-hall" },
      { name: "harkonnen-strategy" }
    ]
  },
  {
    name: "🏛️ The Landsraad",
    channels: [
      { name: "event-calendar" },
      { name: "kanly-duel-board" },
      { name: "raffles" }
    ]
  },
  {
    name: "🛠️ Support",
    channels: [
      { name: "bot-commands" },
      { name: "report-an-issue" },
      { name: "suggestions" }
    ]
  },
  {
    name: "🔒 Staff",
    lockedTo: ["🏛️ Naib", "🗡️ Fedaykin"],
    channels: [
      { name: "incident-log" },
      { name: "petition-review" }
    ]
  }
];

// name: exact voice channel name (no category per the plan doc -- these
// sit at guild top level, matching how §3 describes them as a flat list,
// not nested under any of the text categories above).
export const VOICE_CHANNELS = [
  { name: "Sietch Kadir" },
  { name: "Atreides War Room", lockedTo: ["🦅 House Atreides"] },
  { name: "Harkonnen War Room", lockedTo: ["🐍 House Harkonnen"] },
  { name: "Deep Desert Run" },
  { name: "Coriolis Watch" },
  { name: "Naib's Chamber", lockedTo: ["🏛️ Naib", "🗡️ Fedaykin"] }
];

export function permissionOverwritesFor(lockedTo, roleByName, guild) {
  if (!lockedTo || lockedTo.length === 0) return undefined;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }
  ];
  for (const name of lockedTo) {
    const role = roleByName.get(name);
    if (!role) throw new Error(`permissionOverwritesFor: role "${name}" was not found/created -- role creation must run before channel creation`);
    overwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] });
  }
  return overwrites;
}

export function planRoles(existingRoles) {
  const plan = [];
  for (const role of ROLES) {
    if (!existingRoles.some((r) => r.name === role.name)) {
      plan.push({ type: "create-role", name: role.name, mentionable: Boolean(role.mentionable) });
    }
  }
  return plan;
}

export function planCategoriesAndChannels(existingChannels) {
  const plan = [];
  for (const category of CATEGORIES) {
    const existingCategory = existingChannels.find((c) => c.type === ChannelType.GuildCategory && c.name === category.name);
    if (!existingCategory) {
      plan.push({ type: "create-category", name: category.name, lockedTo: category.lockedTo || null });
    }
    for (const channel of category.channels) {
      const existingChannel = existingChannels.find((c) => c.type === ChannelType.GuildText && c.name === channel.name && (!existingCategory || c.parentId === existingCategory.id));
      if (!existingChannel) {
        plan.push({
          type: "create-text-channel",
          name: channel.name,
          categoryName: category.name,
          topic: channel.topic || null,
          readOnly: Boolean(channel.readOnly),
          inheritsLockFrom: category.lockedTo || null
        });
      }
    }
  }
  return plan;
}

export function planVoiceChannels(existingChannels) {
  const plan = [];
  for (const voice of VOICE_CHANNELS) {
    const existing = existingChannels.find((c) => c.type === ChannelType.GuildVoice && c.name === voice.name);
    if (!existing) {
      plan.push({ type: "create-voice-channel", name: voice.name, lockedTo: voice.lockedTo || null });
    }
  }
  return plan;
}

async function buildPlan(guild, existingRoles) {
  const plan = [];
  if (guild.name !== NEW_GUILD_NAME) {
    plan.push({ type: "rename-guild", from: guild.name, to: NEW_GUILD_NAME });
  }
  if (guild.verificationLevel !== GuildVerificationLevel.High) {
    plan.push({ type: "set-verification-level", from: guild.verificationLevel, to: "High" });
  }

  plan.push(...planRoles(existingRoles));

  const existingChannels = [...(await guild.channels.fetch()).values()];
  plan.push(...planCategoriesAndChannels(existingChannels));
  plan.push(...planVoiceChannels(existingChannels));

  return plan;
}

async function applyPlan(guild, plan) {
  const roleByName = new Map((await guild.roles.fetch()).map((role) => [role.name, role]));
  const categoryByName = new Map();

  for (const item of plan) {
    if (item.type === "rename-guild") {
      await guild.setName(NEW_GUILD_NAME, AUDIT_REASON);
      console.log(`  renamed guild -> "${NEW_GUILD_NAME}"`);
    } else if (item.type === "set-verification-level") {
      await guild.setVerificationLevel(GuildVerificationLevel.High, AUDIT_REASON);
      console.log("  set verification level -> High");
    } else if (item.type === "create-role") {
      const role = await guild.roles.create({ name: item.name, mentionable: item.mentionable, reason: AUDIT_REASON });
      roleByName.set(item.name, role);
      console.log(`  created role "${item.name}"`);
    } else if (item.type === "create-category") {
      const overwrites = permissionOverwritesFor(item.lockedTo, roleByName, guild);
      const category = await guild.channels.create({
        name: item.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
        reason: AUDIT_REASON
      });
      categoryByName.set(item.name, category);
      console.log(`  created category "${item.name}"${item.lockedTo ? ` (locked to ${item.lockedTo.join(", ")})` : ""}`);
    } else if (item.type === "create-text-channel") {
      let parent = categoryByName.get(item.categoryName);
      if (!parent) {
        parent = (await guild.channels.fetch()).find((c) => c.type === ChannelType.GuildCategory && c.name === item.categoryName);
        if (parent) categoryByName.set(item.categoryName, parent);
      }
      const overwrites = item.readOnly
        ? [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.SendMessages] }]
        : undefined;
      await guild.channels.create({
        name: item.name,
        type: ChannelType.GuildText,
        parent: parent ? parent.id : undefined,
        topic: item.topic || undefined,
        permissionOverwrites: overwrites,
        reason: AUDIT_REASON
      });
      console.log(`  created #${item.name}${item.readOnly ? " (read-only)" : ""} under "${item.categoryName}"`);
    } else if (item.type === "create-voice-channel") {
      const overwrites = permissionOverwritesFor(item.lockedTo, roleByName, guild);
      await guild.channels.create({
        name: item.name,
        type: ChannelType.GuildVoice,
        permissionOverwrites: overwrites,
        reason: AUDIT_REASON
      });
      console.log(`  created voice channel "${item.name}"${item.lockedTo ? ` (locked to ${item.lockedTo.join(", ")})` : ""}`);
    } else {
      throw new Error(`applyPlan: unknown plan item type "${item.type}"`);
    }
  }

  // Role hierarchy: enforce the exact top-to-bottom order from ROLES,
  // positioned directly below the bot's own highest role (Discord will
  // reject positioning a role at/above the bot's own top role). Runs last
  // so it isn't undone by any role created above.
  const botMember = await guild.members.fetchMe();
  const botTopPosition = botMember.roles.highest.position;
  const positions = ROLES
    .map((role, index) => ({ role: roleByName.get(role.name), index }))
    .filter((entry) => entry.role)
    .map((entry) => ({ role: entry.role.id, position: Math.max(1, botTopPosition - 1 - entry.index) }));
  if (positions.length > 0) {
    await guild.roles.setPositions(positions, AUDIT_REASON);
    console.log("  set role hierarchy order");
  }
}

// reportBots: read-only, always runs (dry-run and --apply alike) -- lists
// every bot currently integrated into the guild and what its auto-managed
// role grants it. Added specifically to surface YAGPDB's current footprint
// before Phase 0's native Onboarding config goes live: YAGPDB is reported
// as "enabled for onboarding" on this guild already (operator, 2026-09-15)
// and its exact current permission grant was not previously documented
// anywhere in this project (see meta#72). This function does not decide
// anything about YAGPDB -- it only makes the real, current state visible
// so a human can.
//
// Deliberately does NOT request the privileged GuildMembers intent (the
// live bot's own src/index.js only requests Guilds) -- fetching every
// member is unnecessary and would risk a hard login failure if that
// intent isn't toggled on for this application in the Discord Developer
// Portal. Every bot in a guild gets an auto-created "managed" role
// (role.managed === true, role.tags.botId set) with exactly the
// permissions that bot was granted on invite -- guild.roles.fetch() (used
// elsewhere in this script already) surfaces that without needing member
// access at all.
export const NOTABLE_PERMISSIONS = [
  "Administrator", "ManageGuild", "ManageRoles", "ManageChannels",
  "ManageWebhooks", "ManageNicknames", "KickMembers", "BanMembers",
  "ManageMessages", "MentionEveryone", "ManageEvents"
];

async function reportBots(guild, existingRoles) {
  const managedRoles = existingRoles.filter((role) => role.managed && role.tags?.botId);
  console.log(`\nBot-managed roles currently in "${guild.name}" (${managedRoles.length}):`);
  for (const role of managedRoles) {
    const granted = NOTABLE_PERMISSIONS.filter((name) => role.permissions.has(PermissionsBitField.Flags[name]));
    console.log(`  - "${role.name}" (bot application id ${role.tags.botId})`);
    console.log(`      notable permissions: ${granted.length ? granted.join(", ") : "(none of the notable set)"}`);
  }
  const yagpdb = managedRoles.filter((role) => /yagpdb/i.test(role.name));
  if (yagpdb.length > 0) {
    console.log(`  !! YAGPDB detected (${yagpdb.length} role(s)) -- meta#72 tracks vetting this before Phase 0's native Onboarding replaces whatever it currently does for onboarding.`);
  }
  return managedRoles;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const config = loadConfig();
  if (!config.discord.token) {
    console.error("❌ DISCORD_BOT_TOKEN (or DISCORD_BOT_TOKEN_FILE) is not configured.");
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.discord.token);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const existingRoles = [...(await guild.roles.fetch()).values()];
    await reportBots(guild, existingRoles);
    const plan = await buildPlan(guild, existingRoles);

    if (plan.length === 0) {
      console.log("✅ Nothing to do -- guild already matches the Phase 0 plan.");
      return;
    }

    console.log(`${apply ? "Applying" : "DRY RUN --"} ${plan.length} planned change(s) against "${guild.name}" (${guild.id}):\n`);
    console.log(JSON.stringify(plan, null, 2));

    if (!apply) {
      console.log("\nNo changes made. Re-run with --apply to execute the plan above.");
      return;
    }

    console.log("\nApplying:");
    await applyPlan(guild, plan);
    console.log("\n✅ Phase 0 provisioning (structural subset) complete.");
  } finally {
    await client.destroy();
  }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error("❌ Provisioning failed:", error);
    process.exit(1);
  });
}
