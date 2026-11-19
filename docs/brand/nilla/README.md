# Nilla icon and wordmark

A sun at the upper left and one hillside rising to the right, on Apple's 1024 grid (an 824 px squircle at a 100 px
inset). The default palette is **Highland**: sky `#D6E6EC` → `#E4ECE6` → `#EEF0E2`, sun `#F2C14E`, back hill `#8A9F6A`,
front hill `#43506E`. The other 23 palettes are the alternates in the app icon picker, in `palettes.json` order.

Everything here is drawn from code, so nothing is painted by hand and every size is exact:

| File | What it is |
| --- | --- |
| `build.mjs` | The pipeline. `node docs/brand/nilla/build.mjs --out <dir>` renders every asset into `<dir>`, which must be new or empty (it refuses anything else and never deletes) (with the repo's `@resvg/resvg-js`, no system fonts) and writes `<dir>/manifest.json` and `<dir>/icons/INDEX.md`, which map each output to its slot below |
| `shape.mjs` | The squircle outline |
| `glyphs.mjs` | The wordmark's lettering, drawn as stroked paths (no font file) |
| `palettes.json` | Highland and the 23 alternates with their six colours, names and picker groups |
| `source/default.svg`, `source/alternates/*.svg` | Each palette as a whole icon |
| `source/layers/*.svg` | The three Icon Composer layers (sun, back hill, front hill) on the full 1024 canvas |
| `source/layers-dev/*.svg` | The development build's icon: a copper slope on a circuit board, four layers |
| `wordmark/` | The icon with the lettering, lowercase `nilla` and title case `Nilla`: adaptive (ink follows `prefers-color-scheme`), on light (`#2B3550`) and on dark (`#EEF0E2`), plus the lettering alone and 1200 px PNGs of the fixed-ink versions |
| `web/` | Favicons (`.ico` 16/32/48, 64 px PNG), the 180 px apple-touch icon and the 1200×630 share image, for a future site |
| `app-icon-256.png` | The README header icon |

## Where the outputs go

| Output | Slot |
| --- | --- |
| `icons/macos/AppIcon.icon` | `apps/browser/macos/Nilla-macOS/AppIcon.icon`: the macOS 26 icon. The fill is the sky's middle colour; the sun and the two hills are separate layers, so macOS draws the dark, clear and tinted looks from them (check them in Icon Composer on a Mac) |
| `icons/macos/AppIcon-Dev.icon` | `apps/browser/macos/Nilla-macOS/AppIcon-Dev.icon` (development builds, `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon-Dev`) |
| `icons/macos/AppIcon.appiconset` | `apps/browser/macos/Nilla-macOS/Assets.xcassets/AppIcon.appiconset` (Apple's template with its shadow, 16 to 1024 px) |
| `icons/macos/variants/AppIconVariant-<id>.imageset` | `apps/browser/macos/Nilla-macOS/Assets.xcassets/`: the picker's 23 alternates (`packages/shell/ios/AppIcons.swift`), each drawn whole |
| `icons/macos/app-icon-512.png` | `apps/browser/assets/app-icon.png`, the app's own UI icon (drawn at 132 pt at most) |
| `icons/ntp/ntp-mark[-<colour>]-{back,front,sun}[@2x].png` | `apps/browser/assets/`: the New Tab page's hills, one set per profile colour, three layers that rise one after another |
| `icons/ntp/new-tab-mark[@2x].png` | `apps/browser/assets/`: the New Tab favicon, one colour (drawn tinted), hills split and the sun cut free |
| `icons/windows/Nilla.ico` | `apps/browser/windows/Ardia/Ardia.ico` (10 sizes; the file name is read by the Windows engine build) |
| `icons/linux/hicolor/` | `scripts/linux/icons/hicolor/`: 16 to 512 px and scalable, named `nilla` |
| `icons/phone/ios/AppIcon.icon` | `apps/phone/ios/App/AppIcon.icon` |
| `icons/phone/ios/OpenInNilla.png` | the share extension's icon in `apps/phone/ios/Action/Assets.xcassets/AppIcon.appiconset` |
| `icons/phone/AppIconPreview.png`, `icons/phone/appIconPreview.png` | `apps/phone/ios/App/Assets.xcassets/AppIconPreview.imageset` and `apps/phone/assets/appIconPreview.png` |
| `icons/phone/android/` | `apps/phone/android/app/src/main/res/`: the adaptive icon (sky gradient background, sun and hills foreground bleeding to the 108 dp edge, monochrome for themed icons) |
| `icons/extras/raycast-icon.png` | `extras/raycast-nilla/assets/icon.png` |
| `icons/engine/**` | Chromium's product logos and `mac/app.icns`. They belong to `engine/` and ship with the first Nilla engine builds, as does `Assets.car`, which needs `actool` on a Mac |

To check a change, build into a scratch folder and compare each output with its slot byte for byte.

`docs/brand/ardia/` is the previous painted-logo pipeline. It stays until the engine work, because the offline game's
pipeline still reads one of its source files.
