import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NILLA_MARK_CANVAS, NILLA_MARK_HILLS, NILLA_MARK_INK, NILLA_MARK_SUN, nillaMarkFrame, nillaMarkHaloFrame } from "./nillaMark.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const numbers = (text: string) => [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
const drawable = (name: string) => read(`../../../android/app/src/main/res-system/drawable/${name}.xml`);
const pathData = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag} android:pathData="([^"]+)"`, "g"))].map((match) => match[1]!);
const twins = {
  kotlin: read("../../../android/nilla-design/src/main/java/com/nilladigital/nilla/design/NillaLogoMark.kt"),
  swift: read("../../../../../packages/phone/ios/NillaKit/Sources/NillaDesign/Components/NillaLogoMark.swift"),
};

const near = (actual: number[], expected: number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < 0.05, `${value} is not ${expected[index]} at ${index}`));
};
const points = (d: string) => {
  const found: [number, number][] = [];
  let last: [number, number] = [0, 0];
  for (const [, command, args] of d.matchAll(/([MLCHVZ])([^MLCHVZ]*)/g)) {
    const values = numbers(args!);
    if (command === "H") last = [values[0]!, last[1]];
    else if (command === "V") last = [last[0], values[0]!];
    else for (let at = 0; at < values.length; at += 2) last = [values[at]!, values[at + 1]!];
    if (command !== "Z") found.push(last);
    if (command === "C") found.push([values[0]!, values[1]!], [values[2]!, values[3]!]);
  }
  return found;
};
const PLATFORM_POINT = {
  kotlin: ([x, y]: [number, number]) => [`${x}f, ${y}f`, `at(${x}f), at(${y}f)`],
  swift: ([x, y]: [number, number]) => [`CGPoint(x: ${x}, y: ${y})`, `at(${x}, ${y})`],
};

test("the phone mark is the widgets' Nilla mark: the same sun, hills and frame as nilla_logo_plain", () => {
  const xml = drawable("nilla_logo_plain");
  const [frame] = pathData(xml, "clip-path");
  assert.deepEqual(numbers(nillaMarkFrame()), numbers(frame!));
  const paths = pathData(xml, "path");
  assert.deepEqual(numbers(paths[0]!), [NILLA_MARK_SUN.cx - NILLA_MARK_SUN.r, NILLA_MARK_SUN.cy, NILLA_MARK_SUN.r, NILLA_MARK_SUN.r, 0, 1, 0, NILLA_MARK_SUN.r * 2, 0, NILLA_MARK_SUN.r, NILLA_MARK_SUN.r, 0, 1, 0, -NILLA_MARK_SUN.r * 2, 0]);
  assert.deepEqual(paths.slice(1).map(numbers), NILLA_MARK_HILLS.map((hill) => numbers(hill.d)));
  const fills = [...xml.matchAll(/android:fillColor="#FF([0-9A-F]{6})"/g)].map((match) => `#${match[1]}`);
  assert.deepEqual(fills, [NILLA_MARK_INK.sun, NILLA_MARK_INK.backHill, NILLA_MARK_INK.frontHill]);
  assert.deepEqual([NILLA_MARK_CANVAS.left, NILLA_MARK_CANVAS.top, NILLA_MARK_CANVAS.left + NILLA_MARK_CANVAS.width, NILLA_MARK_CANVAS.top + NILLA_MARK_CANVAS.height], [100, NILLA_MARK_SUN.cy - NILLA_MARK_SUN.r, 924, 924]);
});

test("the halo frame grows the frame by half the outline on every side, as nilla_logo's halo does", () => {
  const xml = drawable("nilla_logo");
  const [halo, frame] = pathData(xml, "clip-path");
  const stroke = Number(/android:strokeWidth="(\d+)"/.exec(xml)![1]);
  near(numbers(nillaMarkHaloFrame(stroke)), numbers(halo!));
  assert.deepEqual(numbers(nillaMarkFrame()), numbers(frame!));
  assert.ok(xml.includes(`a${NILLA_MARK_SUN.r + stroke / 2},${NILLA_MARK_SUN.r + stroke / 2}`), "the sun's halo is half the outline wider");
});

for (const [platform, source] of Object.entries(twins) as [keyof typeof PLATFORM_POINT, string][]) {
  test(`the ${platform} twin draws the same mark`, () => {
    const has = (point: [number, number]) => PLATFORM_POINT[platform](point).some((text) => source.includes(text));
    for (const hill of NILLA_MARK_HILLS) for (const point of points(hill.d)) assert.ok(has(point), `${hill.id} ${point} in ${platform}`);
    for (const point of points(nillaMarkFrame())) assert.ok(has(point), `frame ${point} in ${platform}`);
    for (const ink of [NILLA_MARK_INK.sun, NILLA_MARK_INK.backHill, NILLA_MARK_INK.frontHill]) assert.ok(source.includes(`0x${ink.slice(1)}`), `${ink} in ${platform}`);
    assert.ok(source.includes(platform === "swift" ? "CGRect(x: 100, y: 260, width: 824, height: 664)" : "Rect(100f, 260f, 924f, 924f)"), `canvas in ${platform}`);
    assert.ok(source.includes(platform === "swift" ? "CGRect(x: 222, y: 260, width: 224, height: 224)" : "Rect(222f, 260f, 446f, 484f)"), `sun in ${platform}`);
    assert.ok(!/0xFFCB45|0x17604B|432, y: 192|432f, 192f/.test(source), `no Ardia mark left in ${platform}`);
  });
}
