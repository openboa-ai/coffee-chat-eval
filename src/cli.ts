import { createDryRunRegistry } from "./registry.ts";
import { formatDryRunReport } from "./report.ts";

if (process.argv[2] !== "dry-run") {
  console.error("usage: coffee-chat-eval dry-run");
  process.exitCode = 1;
} else {
  console.log(formatDryRunReport(createDryRunRegistry()));
}
