import { mock } from "bun:test";

globalThis.__DEV__ ??= false;

mock.module("react-native", () => import("./test-native/reactNative.ts"));
mock.module("expo-modules-core", () => import("./test-native/expo.ts"));
