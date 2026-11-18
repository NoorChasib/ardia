const CIRCLE = "M0,-250 A250,250 0 1 0 500,-250 A250,250 0 1 0 0,-250";

export const GLYPHS = {
  a: { d: `${CIRCLE} M500,-500 V0`, x: [0, 500] },
  b: { d: `M0,-720 V0 ${CIRCLE}`, x: [0, 500] },
  c: { d: "M410.7,-441.5 A250,250 0 1 0 410.7,-58.5", x: [0, 411] },
  d: { d: `${CIRCLE} M500,-720 V0`, x: [0, 500] },
  e: { d: "M0,-250 H500 A250,250 0 1 0 426.8,-73.2", x: [0, 500] },
  f: { d: "M350,-720 H300 A180,180 0 0 0 120,-540 V0 M0,-500 H300", x: [0, 330] },
  g: { d: `${CIRCLE} M500,-500 V0 A250,220 0 0 1 40,120`, x: [0, 500] },
  h: { d: "M0,-720 V0 M0,-250 A250,250 0 0 1 500,-250 V0", x: [0, 500] },
  i: { d: "M0,-500 V0", x: [0, 0], dots: [[0, -700]] },
  k: { d: "M0,-720 V0 M400,-500 L0,-180 M150,-300 L420,0", x: [0, 420] },
  l: { d: "M0,-720 V0", x: [0, 0] },
  m: { d: "M0,-500 V0 M0,-310 A190,190 0 0 1 380,-310 V0 M380,-310 A190,190 0 0 1 760,-310 V0", x: [0, 760] },
  n: { d: "M0,-500 V0 M0,-250 A250,250 0 0 1 500,-250 V0", x: [0, 500] },
  o: { d: CIRCLE, x: [0, 500] },
  r: { d: "M0,-500 V0 M0,-250 A250,250 0 0 1 250,-500 H300", x: [0, 300] },
  s: { d: "M337.4,-446.7 A180,125 0 1 0 190,-250 A190,125 0 1 1 34.4,-53.3", x: [20, 380] },
  t: { d: "M120,-680 V-90 A90,90 0 0 0 210,0 H260 M0,-500 H270", x: [0, 270] },
  w: { d: "M0,-500 L175,0 L350,-500 L525,0 L700,-500", x: [0, 700] },
  y: { d: "M0,-500 L250,0 M500,-500 L140,220", x: [0, 500] },
  u: { d: "M0,-500 V-250 A250,250 0 0 0 500,-250 M500,-500 V0", x: [0, 500] },
  N: { d: "M0,0 V-720 L540,0 V-720", x: [0, 540] },
  ".": { d: "", x: [0, 0], dots: [[0, -46]] },
  " ": { d: "", x: [0, 0] },
};

const PAIR_TIGHTEN = { r: -50, f: -40, t: -30, y: -30, w: -20, k: -20 };

function shiftPath(d, dx) {
  return d.replace(/([MLHVAC])([^MLHVAC]*)/g, (all, cmd, args) => {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const fmt = (v) => +v.toFixed(1);
    if (cmd === "H") return `H${fmt(n[0] + dx)} `;
    if (cmd === "V") return `V${fmt(n[0])} `;
    if (cmd === "A") return `A${n[0]},${n[1]} ${n[2]} ${n[3]} ${n[4]} ${fmt(n[5] + dx)},${fmt(n[6])} `;
    const out = [];
    for (let i = 0; i < n.length; i += 2) out.push(`${fmt(n[i] + dx)},${fmt(n[i + 1])}`);
    return `${cmd}${out.join(" ")} `;
  }).trim();
}

export function setWord(word, gap = 200) {
  let cursor = 0;
  const paths = [];
  const dots = [];
  let prev = null;
  for (const ch of word) {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`no glyph for ${ch}`);
    if (prev) cursor += gap + (PAIR_TIGHTEN[prev] || 0) + (PAIR_TIGHTEN[ch] ? PAIR_TIGHTEN[ch] / 2 : 0);
    const dx = cursor - g.x[0];
    paths.push(shiftPath(g.d, dx));
    for (const [x, y] of g.dots || []) dots.push([x + dx, y]);
    cursor = dx + g.x[1];
    prev = ch;
  }
  return { d: paths.join(" "), dots, width: cursor };
}

export function glyph(ch) {
  const g = GLYPHS[ch];
  return { d: g.d, dots: g.dots || [], x: g.x };
}
