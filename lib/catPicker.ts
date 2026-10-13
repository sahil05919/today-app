import { useSyncExternalStore } from "react";
import type { ChipTarget } from "./catUi";

/**
 * The category picker is ONE sheet for the whole app, opened from any chip. (A chip sits inside a tappable row; a sheet opened from
 * inside it would pass its taps on to the row, so the chip only says "open the picker for this" and the app draws the sheet.)
 */
let current: ChipTarget | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const openCategoryPicker = (t: ChipTarget) => {
  current = t;
  emit();
};
export const closeCategoryPicker = () => {
  current = null;
  emit();
};
export const useCategoryPicker = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
    () => null,
  );
