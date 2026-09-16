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

export function getPendingApplication(db, guildId, serviceKey, applicantId) {
  return db.prepare(`
    SELECT * FROM service_applications
    WHERE guild_id = ? AND service_key = ? AND applicant_id = ? AND status = 'pending'
  `).get(guildId, serviceKey, applicantId);
}

export function getApplication(db, applicationId) {
  return db.prepare("SELECT * FROM service_applications WHERE id = ?").get(applicationId);
}

// createApplication: the pre-check via getPendingApplication() (done by
// the caller in serviceComponent.js before ever showing the modal) is a
// fast, friendly first line -- this function's own try/catch around the
// INSERT is the real, authoritative guard, since
// idx_service_applications_pending is a UNIQUE partial index. Two
// near-simultaneous calls for the same guild+service+applicant will have
// exactly one succeed and one land here with a caught constraint
// violation, translated to a typed result instead of throwing a raw
// SQLITE_CONSTRAINT_UNIQUE at the caller.
export function createApplication(db, { guildId, serviceKey, applicantId, characterName, proofLink }) {
  try {
    const result = db.prepare(`
      INSERT INTO service_applications (guild_id, service_key, applicant_id, character_name, proof_link)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, serviceKey, applicantId, characterName, proofLink || null);
    return { ok: true, application: getApplication(db, result.lastInsertRowid) };
  } catch (error) {
    if (error?.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return { ok: false, reason: "already_pending" };
    }
    throw error;
  }
}

export function setApplicationReviewMessage(db, applicationId, reviewMessageId) {
  db.prepare("UPDATE service_applications SET review_message_id = ? WHERE id = ?").run(reviewMessageId, applicationId);
}

// resolveApplication: guildId is REQUIRED and part of the WHERE clause --
// never key only on applicationId, since mentat is confirmed
// multi-tenant. Returns null, not a thrown error, for a wrong-guild or
// nonexistent applicationId -- the caller treats null the same as
// "application not found," never leaking whether a differently-scoped
// row exists.
export function resolveApplication(db, guildId, applicationId, { status, reviewedBy }) {
  const existing = db.prepare("SELECT * FROM service_applications WHERE id = ? AND guild_id = ?").get(applicationId, guildId);
  if (!existing) return null;
  db.prepare(`
    UPDATE service_applications
    SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(status, reviewedBy, applicationId);
  return getApplication(db, applicationId);
}
