import Svg, { Circle, ClipPath, Defs, G, Path } from "react-native-svg";
import { NILLA_MARK_CANVAS as CANVAS, NILLA_MARK_HILLS as HILLS, NILLA_MARK_INK as INK, NILLA_MARK_SUN as SUN, nillaMarkFrame, nillaMarkHaloFrame } from "./nillaMark";

const OUTLINE = 0.05;

export function NillaLogo({ width }: { width: number }) {
  const stroke = CANVAS.width * OUTLINE;
  const pad = stroke / 2 + 2;
  const box = `${CANVAS.left - pad} ${CANVAS.top - pad} ${CANVAS.width + pad * 2} ${CANVAS.height + pad * 2}`;
  const height = (width * (CANVAS.height + pad * 2)) / (CANVAS.width + pad * 2);
  return (
    <Svg width={width} height={height} viewBox={box}>
      <Defs>
        <ClipPath id="nillaMarkHalo">
          <Path d={nillaMarkHaloFrame(stroke)} />
        </ClipPath>
        <ClipPath id="nillaMarkFrame">
          <Path d={nillaMarkFrame()} />
        </ClipPath>
      </Defs>
      <G clipPath="url(#nillaMarkHalo)">
        {HILLS.map((hill) => (
          <Path key={`outline-${hill.id}`} d={hill.d} fill={INK.outline} stroke={INK.outline} strokeWidth={stroke} strokeLinejoin="round" />
        ))}
      </G>
      <Circle cx={SUN.cx} cy={SUN.cy} r={SUN.r + stroke / 2} fill={INK.outline} />
      <Circle cx={SUN.cx} cy={SUN.cy} r={SUN.r} fill={INK.sun} />
      <G clipPath="url(#nillaMarkFrame)">
        {HILLS.map((hill) => (
          <Path key={hill.id} d={hill.d} fill={hill.ink} />
        ))}
      </G>
    </Svg>
  );
}
