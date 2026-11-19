import { provideNativeModuleProvider } from "./expo-modules-core";
import { nillaHost, hostModuleMethod, reportHostError } from "../host";

export * from "@nilla-real/ardiacore";
export { devPagerState, pagerState, selectPager, stepPager, SwipeArea, switchPager } from "./web/Pager";
export { HostWebView as WebView } from "./web/HostWebView";

provideNativeModuleProvider((module, method) => module === "ArdiaTabs" && method === "claimLaunchTab" && nillaHost
  ? (...args: unknown[]) => { void hostModuleMethod(module, method)(...args).catch(reportHostError); }
  : undefined);
