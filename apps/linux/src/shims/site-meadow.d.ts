declare module "@nilla-site/meadow/scene" {
  export interface MeadowOptions {
    canvas: HTMLCanvasElement;
    hero: HTMLElement;
    hint: HTMLElement | null;
    reducedMotion: boolean;
    onFirstFrame: () => void;
    opening?: [from: number, to: number];
  }
  export interface Meadow {
    dispose(): void;
    travelTo(cycle: number): void;
  }
  export function createMeadow(options: MeadowOptions): Meadow | null;
}

declare module "@nilla-site/meadow/clock" {
  export function startSunrise(hero: HTMLElement): void;
  export function resetSunrise(): void;
}

declare module "@nilla-site/meadow/cycle" {
  export const CYCLE_STOPS: number[];
  export const MOON_RANGE: [number, number];
  export const SUNRISE_FROM: number;
  export const SUNRISE_TO: number;
}
