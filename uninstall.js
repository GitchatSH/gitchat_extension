// This script runs when the extension is uninstalled.
// NO access to vscode.* API — plain Node.js only.
const https = require("https");
const os = require("os");
const crypto = require("crypto");

// Generate a stable machine fingerprint (same approach as VS Code's machineId)
const hostname = os.hostname();
const username = os.userInfo().username;
const machineId = crypto
  .createHash("sha256")
  .update(`${hostname}-${username}`)
  .digest("hex");

const data = JSON.stringify({
  machine_id: machineId,
  event_type: "uninstall",
  ide: "unknown",
});

const url = new URL("https://api-dev.gitchat.sh/api/v1/telemetry/event");

const req = https.request(
  {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    },
    timeout: 5000,
  },
  () => {}
);

req.on("error", () => {});
req.write(data);
req.end();
