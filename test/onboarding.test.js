import assert from "node:assert/strict";
import test from "node:test";

// Task 12 (hosted-bot-oauth-registration plan): the DM-on-invite
// onboarding trigger (handleGuildCreate and every helper that existed
// only to support it -- clampGuildName/clampMessageContent/
// proclamationHeader/proclamationSetupSteps/setupMessageFor/
// ownerNoticeFor/fallbackNoticeFor/findInviter/SETUP_URL) has been
// removed outright, replaced by an explicit in-guild "not registered"
// reply in commands.js's executeDuneCommand() (see commands.test.js).
// This pins the removal itself; the DM-flow behavior tests that used to
// live in this file (retry logic, fallback notice copy, DM-length
// clamping, etc.) are gone along with the code they exercised, not
// migrated -- there is nothing left to regression-test about a DM this
// bot no longer sends.
test("handleGuildCreate is no longer exported (DM-on-invite trigger removed)", async () => {
  const onboarding = await import("../src/onboarding.js");
  assert.equal(onboarding.handleGuildCreate, undefined);
});

test("handleGuildDelete is still exported (unrelated to the removed DM trigger)", async () => {
  const onboarding = await import("../src/onboarding.js");
  assert.equal(typeof onboarding.handleGuildDelete, "function");
});
