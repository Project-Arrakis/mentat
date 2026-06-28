import { checkHealthState } from "../src/healthcheck.js";

try {
  checkHealthState();
  process.exit(0);
} catch (error) {
  console.error(error?.message || "Bot healthcheck failed.");
  process.exit(1);
}
