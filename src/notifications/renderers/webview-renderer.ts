// src/notifications/renderers/webview-renderer.ts
import { log } from "../../utils";
import type { ToastAction, ToastRenderer, ToastSpec } from "../toast-renderer";

export interface WebviewPoster {
  postMessage(message: unknown): Thenable<boolean> | boolean;
}

interface Pending {
  resolve: (action: ToastAction) => void;
}

/**
 * Sends toast specs to the sidebar webview and resolves show() when the
 * webview posts back `toast:action` for that id. If the webview never
 * responds (reset, user collapses sidebar), resolves to `{kind:"dismiss"}`.
 */
export class WebviewRenderer implements ToastRenderer {
  private pending = new Map<string, Pending>();
  private ready = false;

  constructor(private readonly poster: WebviewPoster) {}

  setReady(ready: boolean): void {
    this.ready = ready;
    if (!ready) {
      // Webview gone — resolve all pending as dismiss so coordinator drains.
      this.resolveAllAsDismiss();
    }
  }

  isReady(): boolean { return this.ready; }

  show(spec: ToastSpec): Promise<ToastAction> {
    log(`[Toast] route=webview kind=${spec.kind} id=${spec.id}`);
    return new Promise<ToastAction>((resolve) => {
      this.pending.set(spec.id, { resolve });
      void this.poster.postMessage({ type: "toast:push", spec });
    });
  }

  /** Called by explore.ts onMessage handler when webview posts toast:action. */
  handleAction(id: string, action: ToastAction): void {
    const p = this.pending.get(id);
    if (!p) { return; }
    this.pending.delete(id);
    p.resolve(action);
  }

  dismiss(id: string): void {
    void this.poster.postMessage({ type: "toast:dismiss", id });
    const p = this.pending.get(id);
    if (p) {
      this.pending.delete(id);
      p.resolve({ kind: "dismiss" });
    }
  }

  reset(): void {
    void this.poster.postMessage({ type: "toast:reset" });
    this.resolveAllAsDismiss();
  }

  private resolveAllAsDismiss(): void {
    for (const [, p] of this.pending) { p.resolve({ kind: "dismiss" }); }
    this.pending.clear();
  }
}
