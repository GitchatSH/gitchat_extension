import * as vscode from "vscode";
import type { ExtensionModule } from "../types";
import { log } from "../utils";

const INSTALL_SENT_KEY = "gitstar.installEventSent";

function detectIde(): string {
  const appName = (vscode.env.appName ?? "").toLowerCase();
  if (appName.includes("cursor")) return "cursor";
  if (appName.includes("windsurf")) return "windsurf";
  if (appName.includes("antigravity")) return "antigravity";
  if (appName.includes("void")) return "void";
  return "vscode";
}

function getExtensionVersion(): string {
  return vscode.extensions.getExtension("GitstarAI.top-github-trending")
    ?.packageJSON?.version ?? "unknown";
}

async function sendTelemetryEvent(
  eventType: "install" | "uninstall",
  apiUrl: string,
): Promise<void> {
  try {
    const body = {
      machine_id: vscode.env.machineId,
      event_type: eventType,
      ide: detectIde(),
      ide_version: vscode.version,
      extension_version: getExtensionVersion(),
    };

    const res = await fetch(`${apiUrl}/telemetry/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      log(`Telemetry: ${eventType} event sent`);
    } else {
      log(`Telemetry: ${eventType} event failed (${res.status})`, "warn");
    }
  } catch (err) {
    log(`Telemetry: ${eventType} event error: ${err}`, "warn");
  }
}

export const telemetryModule: ExtensionModule = {
  id: "telemetry",
  async activate(context: vscode.ExtensionContext) {
    const alreadySent = context.globalState.get<boolean>(INSTALL_SENT_KEY);
    if (alreadySent) return;

    const apiUrl = vscode.workspace
      .getConfiguration("trending")
      .get<string>("apiUrl", "https://api-dev.gitstar.ai/api/v1");

    await sendTelemetryEvent("install", apiUrl);
    await context.globalState.update(INSTALL_SENT_KEY, true);
  },
};
