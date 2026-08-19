import assert from "node:assert/strict";
import { test } from "node:test";
import { BridgeError, ErrorClass, classifyError, securityError } from "./errors.mjs";

test("BridgeError rejects an invalid error class", () => {
  assert.throws(() => new BridgeError("x", "NOT_A_CLASS"));
});

test("classifyError passes through an existing BridgeError unchanged", () => {
  const original = securityError("blocked", { reason: "secret" });
  assert.equal(classifyError(original), original);
});

test("classifyError maps HTTP statuses to the correct class", () => {
  assert.equal(classifyError({ status: 401 }).errorClass, ErrorClass.AUTHORIZATION);
  assert.equal(classifyError({ status: 403 }).errorClass, ErrorClass.AUTHORIZATION);
  assert.equal(classifyError({ status: 429 }).errorClass, ErrorClass.RATE_LIMIT);
  assert.equal(classifyError({ status: 502 }).errorClass, ErrorClass.TRANSIENT);
  assert.equal(classifyError({ status: 503 }).errorClass, ErrorClass.TRANSIENT);
  assert.equal(classifyError({ status: 504 }).errorClass, ErrorClass.TRANSIENT);
  assert.equal(classifyError({ status: 404 }).errorClass, ErrorClass.UNKNOWN);
});

test("classifyError maps network error codes to TRANSIENT", () => {
  assert.equal(classifyError({ code: "ETIMEDOUT" }).errorClass, ErrorClass.TRANSIENT);
  assert.equal(classifyError({ code: "ECONNRESET" }).errorClass, ErrorClass.TRANSIENT);
  assert.equal(classifyError({ name: "AbortError" }).errorClass, ErrorClass.TRANSIENT);
});

test("classifyError preserves status in details for later inspection", () => {
  const err = classifyError({ status: 404, message: "not found" });
  assert.equal(err.details.status, 404);
});
