import { showMenu as showNativeMenu, type MenuItem } from "@nilla/shell";
import { withIconNames } from "../lib/activeLook";

export { menuShown, watchMenus, type MenuItem, type MenuEntry } from "@nilla/shell";

export const showMenu = (items: MenuItem[], onKeepOpenPick?: (id: string) => MenuItem[]): Promise<string | null> =>
  showNativeMenu(withIconNames(items), onKeepOpenPick && ((id) => withIconNames(onKeepOpenPick(id))));
