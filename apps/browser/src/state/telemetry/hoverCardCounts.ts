const NONE = {
  tab_hover_cards_shown: 0,
  tab_hover_card_presses: 0,
  tab_hover_card_resets: 0,
  tab_menu_pinned_resets: 0,
  tab_close_button_presses: 0,
  tab_close_button_presses_left: 0,
  tab_hover_previews_shown: 0,
  tab_hover_previews_none: 0,
  tab_hover_previews_stale: 0,
  tab_hover_preview_captures: 0,
  tab_hover_preview_capture_misses: 0,
  tab_hover_card_memory_exact: 0,
  tab_hover_card_memory_estimate: 0,
  tab_hover_card_memory_shared: 0,
  tab_hover_card_memory_unavailable: 0,
  tab_hover_card_memory_asleep: 0,
  tab_hover_card_memory_samples: 0,
  tab_hover_card_memory_cold_waits: 0,
  tab_hover_card_memory_failures: 0,
};
let counts = { ...NONE };

export const noteTabHoverCardShown = () => void counts.tab_hover_cards_shown++;

export function noteTabHoverCardPress(reset: boolean) {
  counts.tab_hover_card_presses++;
  if (reset) counts.tab_hover_card_resets++;
}

export const noteTabMenuPinnedReset = () => void counts.tab_menu_pinned_resets++;

export function noteTabCloseButtonPress(left: boolean) {
  counts.tab_close_button_presses++;
  if (left) counts.tab_close_button_presses_left++;
}

export const noteTabHoverPreview = (state: "shown" | "none" | "stale") => void counts[`tab_hover_previews_${state}`]++;

export function noteTabHoverPreviewCapture(missed: boolean) {
  counts.tab_hover_preview_captures++;
  if (missed) counts.tab_hover_preview_capture_misses++;
}

export const noteTabMemoryShown = (kind: "exact" | "estimate" | "shared" | "unavailable" | "asleep") => void counts[`tab_hover_card_memory_${kind}`]++;

export function noteTabMemorySample(waited: boolean, failed: boolean) {
  counts.tab_hover_card_memory_samples++;
  if (waited) counts.tab_hover_card_memory_cold_waits++;
  if (failed) counts.tab_hover_card_memory_failures++;
}

export function takeHoverCardCounts() {
  const taken = counts;
  counts = { ...NONE };
  return taken;
}
