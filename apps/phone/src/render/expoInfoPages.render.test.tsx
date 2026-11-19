import { Platform } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { SettingsView } from "../components/settings/SettingsView";
import * as settingsActions from "../state/settings/actions";
import * as defaultBrowser from "../state/settings/defaultBrowser";
import { openSettings, type SettingsRoute } from "../state/settings/nav";
import { PHONE_WHATS_SENT } from "../lib/telemetryCopy";
import { LICENSE_TEXTS } from "../state/settings/licenseTexts";
import { dataCredits } from "../components/settings/DataPages";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

const onIos = Platform.OS === "ios" ? test : test.skip;

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(1);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Root = ReturnType<typeof renderSurface>;

const open = async (route: SettingsRoute) => {
  openSettings(route);
  const root = renderSurface(<SettingsView />);
  await act(async () => undefined);
  const page = root.root.findAll((node) => typeof node.type === "string" && node.props.name === "destination" && (node.props.extraProps as { value?: string } | undefined)?.value === route.page)[0]!;
  return { root, page };
};
const within = (node: ReactTestInstance, has: (props: Record<string, unknown>) => boolean) => node.findAll((inner) => typeof inner.type === "string" && has(inner.props));
const texts = (node: ReactTestInstance) => within(node, (props) => typeof props.text === "string").map((inner) => inner.props.text as string);
const press = async (node: ReactTestInstance) => act(async () => void (node.props.onButtonPress ?? node.props.onPress)({ nativeEvent: {} }));
const done = async (root: Root) => {
  await act(async () => void jest.advanceTimersByTime(1000));
  unmount(root);
};

onIos("Clear Browsing Data is main's form on Expo UI: Time Range, the Clear switches, Archived Tabs only for all time, and Clear Data behind main's confirmation", async () => {
  const clear = jest.spyOn(settingsActions, "clearBrowsingData").mockResolvedValue(undefined as never);
  jest.spyOn(settingsActions, "websiteDataClearsByTime").mockReturnValue(true);
  const { root, page } = await open({ page: "clearData" });
  expect(within(page, (props) => props.label === "Time Range")).toHaveLength(1);
  expect(texts(page)).toEqual(expect.arrayContaining(["History", "Cache", "Cookies and Site Data", "Clear Data…"]));
  expect(texts(page)).not.toContain("Archived Tabs");
  await act(async () => within(page, (props) => props.label === "Time Range")[0]!.props.onSelectionChange({ nativeEvent: { selection: "allTime" } }));
  expect(texts(within(root.root, (props) => props.name === "destination")[0]!)).toContain("Archived Tabs");
  await press(within(root.root, (props) => props.label === "Clear Data")[0]!);
  expect(clear).toHaveBeenCalledTimes(1);
  await done(root);
});

onIos("About Nilla has one Source Code link to Nilla's repository with its arrow and Open Source Licenses, and no Release Notes", async () => {
  const openLink = jest.spyOn(settingsActions, "openFromSettings").mockImplementation(() => undefined);
  const about = await open({ page: "about" });
  expect(texts(about.page)).toEqual(expect.arrayContaining(["Nilla", "Source Code", "Open Source Licenses"]));
  expect(texts(about.page)).not.toContain("Release Notes");
  expect(within(about.page, (props) => props.systemName === "arrow.up.forward")).toHaveLength(1);
  await press(within(about.page, (props) => typeof props.onButtonPress === "function" || typeof props.onPress === "function").find((node) => texts(node).includes("Source Code"))!);
  expect(openLink).toHaveBeenCalledWith("https://github.com/NoorChasib/nilla");
  await done(about.root);
});

onIos("Licenses lists every credit with its use, license and address, the full license texts, and the code in this app", async () => {
  const openLink = jest.spyOn(settingsActions, "openFromSettings").mockImplementation(() => undefined);
  const licenses = await open({ page: "licenses" });
  const words = texts(licenses.page);
  expect(dataCredits().map((credit) => credit.name)).toEqual(expect.arrayContaining(["Nilla", "!Bang List", "EasyList", "Public Suffix List"]));
  for (const credit of dataCredits()) expect(words).toEqual(expect.arrayContaining([credit.name, credit.use, credit.license, credit.url.replace(/^https:\/\//, "")]));
  expect(within(licenses.page, (props) => props.label === "License").length).toBeGreaterThan(3);
  expect(within(licenses.page, (props) => props.title === "Code in This App")).toHaveLength(1);
  expect(within(licenses.page, (props) => props.title === "License Texts")).toHaveLength(1);
  const groups = within(licenses.page, (props) => typeof props.onIsExpandedChange === "function");
  expect(groups.map((group) => group.props.label)).toEqual(LICENSE_TEXTS.map((license) => license.title));
  expect(groups.every((group) => group.props.isExpanded === false)).toBe(true);
  for (const group of groups) await act(async () => group.props.onIsExpandedChange({ nativeEvent: { isExpanded: true } }));
  const shown = texts(licenses.page);
  for (const license of LICENSE_TEXTS) expect(shown).toContain(license.text.trim());
  const buttons = within(licenses.page, (props) => typeof props.onButtonPress === "function" || typeof props.onPress === "function");
  for (const credit of dataCredits()) {
    await press(buttons.find((node) => texts(node).includes(credit.url.replace(/^https:\/\//, "")))!);
    expect(openLink).toHaveBeenLastCalledWith(credit.url);
  }
  await done(licenses.root);
});

onIos("Default Browser shows main's instructions and steps card with the primary button; What's Sent lists every section", async () => {
  jest.spyOn(defaultBrowser, "refreshDefaultBrowser").mockResolvedValue(null);
  defaultBrowser.useDefaultBrowser.setState({ status: { isDefault: false, canAsk: false, isOffered: true } as never });
  const ask = jest.spyOn(defaultBrowser, "askForDefaultBrowser").mockResolvedValue({ status: null, unavailable: false } as never);
  const browser = await open({ page: "defaultBrowser" });
  const words = texts(browser.page);
  expect(words.some((text) => /^1\. /.test(text))).toBe(true);
  const action = within(browser.page, (props) => Array.isArray(props.modifiers) && (props.modifiers as { $type: string; style?: string }[]).some((modifier) => modifier.$type === "buttonStyle" && modifier.style === "borderedProminent"))[0]!;
  await press(action);
  expect(ask).toHaveBeenCalledTimes(1);
  await done(browser.root);
  const sent = await open({ page: "whatsSent" });
  expect(within(sent.page, (props) => typeof props.title === "string").map((node) => node.props.title)).toEqual(expect.arrayContaining(PHONE_WHATS_SENT.map((section) => section.title)));
  await done(sent.root);
});
