import "../../browser/src/test-preload.mjs";
import { mock } from "bun:test";

mock.module("react-native", () => import("./host-test-native.mjs"));
