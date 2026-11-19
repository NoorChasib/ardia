import AppKit
import ArdiaCore

NillaHost.markMainStarted()

let config = LaunchConfig.shared
if config.prewarm { exit(0) }

exit(NillaHost.run(argc: CommandLine.argc, argv: CommandLine.unsafeArgv) { AppDelegate() })
