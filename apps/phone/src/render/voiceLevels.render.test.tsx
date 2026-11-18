import { act } from "react-test-renderer";
import { VoiceSearchView } from "../components/search/VoiceSearchView";
import * as perf from "../state/app/interactionPerf";
import { closeVoiceSearch, presentVoiceSearch, useVoice } from "../state/voice/store";
import { renderSurface, textOf, unmount } from "../../test/render/harness";

type SpeechEvent = { type: "level"; session: number; level: number } | { type: "text"; session: number; text: string; isFinal: boolean };

const mockSpeech = { listener: null as ((event: SpeechEvent) => void) | null };

jest.mock("@ardia/phone-native", () => {
  const actual = jest.requireActual("@ardia/phone-native");
  return {
    ...actual,
    canUseSpeech: () => true,
    speech: {
      isAvailable: async () => true,
      requestAccess: async () => "granted",
      start: async () => undefined,
      stop: async () => undefined,
      addListener: (listener: (event: SpeechEvent) => void) => {
        mockSpeech.listener = listener;
        return { remove: () => undefined };
      },
    },
  };
});

let counts: Record<string, number> = {};

beforeEach(() => {
  jest.useFakeTimers();
  counts = {};
  jest.spyOn(perf, "countRender").mockImplementation((component: string) => {
    counts[component] = (counts[component] ?? 0) + 1;
  });
});

afterEach(() => {
  act(() => closeVoiceSearch());
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const flush = async () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

test("twenty level events while listening redraw the waveform, not the cover, its transcript or its controls", async () => {
  const root = renderSurface(<VoiceSearchView />);
  act(() => void presentVoiceSearch());
  await flush();
  const session = useVoice.getState().dictation.attempt;
  expect(useVoice.getState().dictation.phase).toBe("listening");
  expect(textOf(root)).toContain("Listening…");
  counts = {};
  for (let i = 1; i <= 20; i++) act(() => mockSpeech.listener!({ type: "level", session, level: (i % 5) / 5 }));
  expect(counts.VoiceCover ?? 0).toBe(0);
  expect(counts.VoiceControls ?? 0).toBe(0);
  expect(counts.WaveBar).toBe(20 * 24);
  expect(useVoice.getState().levels.slice(-3)).toEqual([0.6, 0.8, 0]);
  act(() => mockSpeech.listener!({ type: "text", session, text: "otters", isFinal: false }));
  expect(counts.VoiceCover).toBe(1);
  expect(textOf(root)).toContain("otters");
  unmount(root);
});
