import AppKit
import ArdiaCore

ArdiaHost.markMainStarted()

let config = LaunchConfig.shared
if config.prewarm { exit(0) }

exit(ArdiaHost.run(argc: CommandLine.argc, argv: CommandLine.unsafeArgv) { AppDelegate() })
