export const NILLA_MARK_CANVAS = { left: 100, top: 260, width: 824, height: 664 } as const;

export const NILLA_MARK_INK = { sun: "#F2C14E", backHill: "#8A9F6A", frontHill: "#43506E", outline: "#FFFFFF" } as const;

export const NILLA_MARK_SUN = { cx: 334, cy: 372, r: 112 } as const;

export const NILLA_MARK_HILLS = [
  { id: "backHill", d: "M100 700C320 640 560 610 924 560V924H100Z", ink: NILLA_MARK_INK.backHill },
  { id: "frontHill", d: "M100 812C380 760 650 600 924 338V924H100Z", ink: NILLA_MARK_INK.frontHill },
] as const;

const FRAME_CENTER = 512;

export function nillaMarkFrame(scale = 1): string {
  const at = (value: number) => Number((FRAME_CENTER + (value - FRAME_CENTER) * scale).toFixed(2));
  const point = (x: number, y: number) => `${at(x)} ${at(y)}`;
  return [
    `M${point(360, 100)}`,
    `H${at(664)}`,
    `C${point(861.3, 100)} ${point(924, 162.7)} ${point(924, 360)}`,
    `V${at(664)}`,
    `C${point(924, 861.3)} ${point(861.3, 924)} ${point(664, 924)}`,
    `H${at(360)}`,
    `C${point(162.7, 924)} ${point(100, 861.3)} ${point(100, 664)}`,
    `V${at(360)}`,
    `C${point(100, 162.7)} ${point(162.7, 100)} ${point(360, 100)}`,
    "Z",
  ].join("");
}

export const nillaMarkHaloFrame = (stroke: number) => nillaMarkFrame((NILLA_MARK_CANVAS.width + stroke) / NILLA_MARK_CANVAS.width);
