import { Platform, StyleSheet } from "react-native";
import { act } from "react-test-renderer";
import { AboutPage, dataCredits, LicensesPage } from "../components/settings/DataPages";
import * as settingsActions from "../state/settings/actions";
import { LICENSE_TEXTS } from "../state/settings/licenseTexts";
import { renderSurface, textOf, unmount, withTabs } from "../../test/render/harness";

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(1);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

test("About's hero is the 72-point app icon on white with a shadow, over a bold title", () => {
  const root = renderSurface(<AboutPage />);
  const icon = root.root.findAll((node) => node.props.testID === "appIcon" && typeof node.type === "string")[0]!;
  const frame = StyleSheet.flatten(icon.props.style);
  expect(frame.width).toBe(72);
  expect(frame.backgroundColor).toBe("#FFFFFF");
  expect(frame.boxShadow).toBeDefined();
  expect(icon.findAll((node) => node.props.source !== undefined && typeof node.type === "string").length).toBeGreaterThan(0);
  const title = root.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "header" && textOf({ root: node } as never) === "Nilla")[0]!;
  expect(StyleSheet.flatten(title.props.style).fontWeight).toBe("700");
  unmount(root);
});

test("the licences list this phone's own native code: Nilla's Swift packages on iPhone, the Android libraries on Android", () => {
  const root = renderSurface(<LicensesPage />);
  const text = textOf(root);
  if (Platform.OS === "ios") {
    expect(text).toContain("NillaKit and NillaSyncCore");
    expect(text).not.toContain("Android Jetpack");
  } else {
    expect(text).toContain("Android Jetpack");
    expect(text).not.toContain("NillaKit");
  }
  unmount(root);
});

test("About links only to Nilla's source code, with no Release Notes row", () => {
  const openLink = jest.spyOn(settingsActions, "openFromSettings").mockImplementation(() => undefined);
  const root = renderSurface(<AboutPage />);
  const links = root.root.findAll((node) => node.props.accessibilityRole === "link" && typeof node.props.onPress === "function");
  expect(links.map((link) => textOf({ root: link } as never))).toEqual(["Source Code"]);
  act(() => links[0]!.props.onPress());
  expect(openLink).toHaveBeenCalledWith("https://github.com/NoorChasib/nilla");
  expect(textOf(root)).not.toContain("Release Notes");
  openLink.mockRestore();
  unmount(root);
});

test("the licences show every credit with its use, license and address, and each license text opens in full under License Texts", () => {
  const root = renderSurface(<LicensesPage />);
  const text = textOf(root);
  expect(dataCredits().map((credit) => credit.name)).toEqual(expect.arrayContaining(["Nilla", "!Bang List"]));
  for (const credit of dataCredits()) for (const words of [credit.name, credit.use, credit.license, credit.url.replace(/^https:\/\//, "")]) expect(text).toContain(words);
  expect(text).toContain("License Texts");
  for (const license of LICENSE_TEXTS) {
    expect(textOf(root)).not.toContain(license.text.trim());
    const row = root.root.findAll((node) => node.props.accessibilityLabel === license.title && typeof node.props.onPress === "function")[0]!;
    expect(row.props.accessibilityState).toEqual({ expanded: false });
    act(() => row.props.onPress());
    expect(textOf(root)).toContain(license.text.trim());
  }
  unmount(root);
});

