// src/notifications/toast-stack-state.ts
import type { ToastSpec } from "./toast-renderer";

export const MAX_CARDS = 3;
export const AUTO_DISMISS_MS = 4000;

export interface StackCard {
  spec: ToastSpec;
  startedAt: number; // ms epoch, for timer calculation / hover resume
}

export interface StackState {
  cards: StackCard[]; // newest first (index 0 = top)
}

export type StackAction =
  | { kind: "push"; spec: ToastSpec; now: number }
  | { kind: "dismiss"; id: string }
  | { kind: "reset" };

export function initialStackState(): StackState {
  return { cards: [] };
}

export function nextStack(state: StackState, action: StackAction): StackState {
  switch (action.kind) {
    case "push": {
      const existing = state.cards.findIndex(c => c.spec.id === action.spec.id);
      if (existing >= 0) {
        // In-place update: replace spec, reset timer, keep position
        const updated = [...state.cards];
        updated[existing] = { spec: action.spec, startedAt: action.now };
        return { cards: updated };
      }
      // New id: prepend to top, evict bottom if overflow
      const prepended = [{ spec: action.spec, startedAt: action.now }, ...state.cards];
      if (prepended.length > MAX_CARDS) {
        return { cards: prepended.slice(0, MAX_CARDS) };
      }
      return { cards: prepended };
    }
    case "dismiss": {
      return { cards: state.cards.filter(c => c.spec.id !== action.id) };
    }
    case "reset": {
      return { cards: [] };
    }
  }
}
