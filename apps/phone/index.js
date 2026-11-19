import { registerRootComponent } from "expo";

if (process.env.EXPO_PUBLIC_NILLA_LAB === "true") {
  registerRootComponent(require("./src/dev/LaunchRoot").LaunchRoot);
} else {
  registerRootComponent(require("./src/App").default);
}
