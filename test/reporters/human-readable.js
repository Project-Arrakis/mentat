import { spec } from "node:test/reporters";
import { Transform } from "node:stream";

function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

export default function humanReadableReporter() {
  const specStream = spec();

  return new Transform({
    readableObjectMode: false,
    writableObjectMode: true,
    transform(chunk, _encoding, callback) {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      const formatted = text.replace(/duration_ms\s+([\d.]+)/g, (_, ms) => {
        return `duration ${formatDuration(Number(ms))}`;
      });
      callback(null, formatted);
    },
    flush(callback) {
      callback();
    }
  });
}
