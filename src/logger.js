import { redactSecrets } from "./format.js";

export function logInfo(event, fields = {}, sink = console.log) {
  writeLog("info", event, fields, sink);
}

export function logError(event, error, fields = {}, sink = console.error) {
  writeLog("error", event, {
    ...fields,
    error: serializeError(error)
  }, sink);
}

function writeLog(level, event, fields, sink) {
  const entry = redactSecrets({
    level,
    event,
    time: new Date().toISOString(),
    fields
  });

  sink(JSON.stringify(entry));
}

function serializeError(error) {
  if (!error || typeof error !== "object") {
    return {
      name: "Error",
      message: redactSecrets(String(error || "Unknown error."))
    };
  }

  return {
    name: error.name || "Error",
    message: redactSecrets(error.message || "Unknown error."),
    status: error.status,
    route: error.route
  };
}
