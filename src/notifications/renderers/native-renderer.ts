// src/notifications/renderers/native-renderer.ts
import * as vscode from "vscode";
import { log } from "../../utils";
import type { ToastAction, ToastRenderer, ToastSpec } from "../toast-renderer";

export class NativeRenderer implements ToastRenderer {
  async show(spec: ToastSpec): Promise<ToastAction> {
    const primaryLabel = labelFor(spec.primary);
    const secondaryLabel = spec.secondary ? labelFor(spec.secondary) : undefined;
    const dismissLabel = "Dismiss";

    log(`[Toast] route=native kind=${spec.kind} id=${spec.id}`);

    const message = spec.body ? `${spec.title}: ${spec.body}` : spec.title;
    const buttons: string[] = secondaryLabel
      ? [primaryLabel, secondaryLabel, dismissLabel]
      : [primaryLabel, dismissLabel];

    const picked = await vscode.window.showInformationMessage(message, ...buttons);

    if (picked === primaryLabel) { return spec.primary; }
    if (secondaryLabel && picked === secondaryLabel && spec.secondary) {
      return spec.secondary;
    }
    return { kind: "dismiss" };
  }

  dismiss(_id: string): void {
    // Native toasts cannot be dismissed programmatically by extension code.
    // Best effort: no-op.
  }

  reset(): void {
    // Same — no programmatic dismiss API.
  }
}

function labelFor(action: ToastAction): string {
  switch (action.kind) {
    case "openChat":  return "Open Chat";
    case "openInbox": return "Open Inbox";
    case "openUrl":   return "Open";
    case "markRead":  return "Mark All Read";
    case "dismiss":   return "Dismiss";
  }
}
