// serviceChannels.js (mentat#372): DB accessors for the generalized
// service duty/apply component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md.
// Every query is parameterized -- never string-interpolated -- matching
// the getLiveMessage/setLiveMessage precedent in database.js.

export function getServiceChannel(db, guildId, serviceKey) {
  return db.prepare("SELECT * FROM service_channels WHERE guild_id = ? AND service_key = ?").get(guildId, serviceKey);
}

export function setServiceChannel(db, guildId, serviceKey, { channelId, roleId, reviewChannelId, requiresReview = true }) {
  db.prepare(`
    INSERT INTO service_channels (guild_id, service_key, channel_id, role_id, review_channel_id, requires_review)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, service_key) DO UPDATE SET
      channel_id = excluded.channel_id,
      role_id = excluded.role_id,
      review_channel_id = excluded.review_channel_id,
      requires_review = excluded.requires_review
  `).run(guildId, serviceKey, channelId, roleId, reviewChannelId, requiresReview ? 1 : 0);
}

export function listServiceChannels(db, guildId) {
  return db.prepare("SELECT * FROM service_channels WHERE guild_id = ?").all(guildId);
}

export function setServiceStatusMessageId(db, guildId, serviceKey, statusMessageId) {
  db.prepare("UPDATE service_channels SET status_message_id = ? WHERE guild_id = ? AND service_key = ?")
    .run(statusMessageId, guildId, serviceKey);
}

export function setDutyStatus(db, guildId, serviceKey, userId) {
  db.prepare(`
    INSERT OR IGNORE INTO service_duty_status (guild_id, service_key, user_id)
    VALUES (?, ?, ?)
  `).run(guildId, serviceKey, userId);
}

export function clearDutyStatus(db, guildId, serviceKey, userId) {
  db.prepare("DELETE FROM service_duty_status WHERE guild_id = ? AND service_key = ? AND user_id = ?")
    .run(guildId, serviceKey, userId);
}

export function isOnDuty(db, guildId, serviceKey, userId) {
  return !!db.prepare("SELECT 1 FROM service_duty_status WHERE guild_id = ? AND service_key = ? AND user_id = ?")
    .get(guildId, serviceKey, userId);
}

export function listOnDuty(db, guildId, serviceKey) {
  return db.prepare("SELECT * FROM service_duty_status WHERE guild_id = ? AND service_key = ? ORDER BY started_at ASC")
    .all(guildId, serviceKey);
}
