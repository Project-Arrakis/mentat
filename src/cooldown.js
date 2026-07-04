const DEFAULT_COOLDOWN_MS = 5000;
const DEFAULT_ADMIN_COOLDOWN_MS = 1000;
const COOLDOWN_LOCK_MAX = 5000;

const cooldownMap = new Map();

export function checkCooldown({ userId, commandName, roleIds = [], config = {} } = {}) {
  if (!userId || !commandName) return { allowed: true, remainingMs: 0 };

  const key = `${userId}:${commandName}`;
  const now = Date.now();
  const entry = cooldownMap.get(key);

  if (entry && now - entry.startedAt < entry.durationMs) {
    return { allowed: false, remainingMs: entry.durationMs - (now - entry.startedAt) };
  }

  return { allowed: true, remainingMs: 0 };
}

export function applyCooldown({ userId, commandName, interaction, config = {} } = {}) {
  if (!userId || !commandName) return;

  const key = `${userId}:${commandName}`;
  const roleIds = extractRoleIdsFromInteraction(interaction) || [];
  const isAdmin = roleIds.some((r) => isAdminRole(r, config));

  const durationMs = parsePositiveInt(
    process.env.DUNE_COOLDOWN_MS || DEFAULT_COOLDOWN_MS,
    DEFAULT_COOLDOWN_MS
  );
  const adminDurationMs = parsePositiveInt(
    process.env.DUNE_ADMIN_COOLDOWN_MS || DEFAULT_ADMIN_COOLDOWN_MS,
    DEFAULT_ADMIN_COOLDOWN_MS
  );

  if (cooldownMap.size > COOLDOWN_LOCK_MAX) {
    pruneCooldownMap();
  }

  cooldownMap.set(key, {
    startedAt: Date.now(),
    durationMs: isAdmin ? adminDurationMs : durationMs,
    userId,
    commandName
  });
}

export function clearCooldown({ userId, commandName } = {}) {
  if (userId && commandName) {
    cooldownMap.delete(`${userId}:${commandName}`);
  } else if (userId) {
    for (const key of cooldownMap.keys()) {
      if (key.startsWith(`${userId}:`)) cooldownMap.delete(key);
    }
  }
}

export function cooldownStats() {
  const entries = [];
  const now = Date.now();
  for (const [key, entry] of cooldownMap) {
    const remaining = Math.max(0, entry.durationMs - (now - entry.startedAt));
    if (remaining > 0) entries.push({ key, remaining, userId: entry.userId, command: entry.commandName });
  }
  return { active: entries.length, entries };
}

export function resetCooldowns() {
  cooldownMap.clear();
}

function isAdminRole(roleId, config = {}) {
  const adminIds = new Set([
    ...parseCsv(process.env.DISCORD_ADMIN_ROLE_IDS),
    ...parseCsv(process.env.DISCORD_WRITE_ADMIN_ROLE_IDS),
    ...parseCsv(process.env.DISCORD_WRITE_OWNER_ROLE_IDS),
    ...(Array.isArray(config.discord?.rbac?.adminRoleIds) ? config.discord.rbac.adminRoleIds : [])
  ]);
  return adminIds.has(roleId);
}

function extractRoleIdsFromInteraction(interaction) {
  if (!interaction) return [];
  const roles = interaction.member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles.map(String);
  if (roles.cache?.keys) return [...roles.cache.keys()];
  if (roles instanceof Set) return [...roles].map(String);
  return [];
}

function pruneCooldownMap() {
  const now = Date.now();
  for (const [key, entry] of cooldownMap) {
    if (now - entry.startedAt > entry.durationMs) cooldownMap.delete(key);
  }
}

function parseCsv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}
