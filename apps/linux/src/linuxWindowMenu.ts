import { emitCommand, showMenu } from "@nilla/shell";
import { nillaHost } from "./host";
import { isLinuxUtility } from "./session";
import { createWindowMenu } from "./windowMenu";
import { useBrowser } from "../../browser/src/state/browser/store";
import { windowTitle } from "../../browser/src/state/browser/model";

export const linuxWindowMenu = nillaHost
  ? createWindowMenu(nillaHost, { state: () => useBrowser.getState(), title: windowTitle, utility: isLinuxUtility, show: showMenu, command: emitCommand })
  : null;
