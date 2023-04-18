import { browserClientConfiguration } from "./extension/browser/client/webpack.config"
import { browserServersConfiguration } from "./extension/browser/servers/webpack.config"
import { desktopClientConfiguration } from "./extension/desktop/client/webpack.config"
import { desktopServersConfiguration } from "./extension/desktop/servers/webpack.config"

export default [
	browserClientConfiguration,
	browserServersConfiguration,
	desktopClientConfiguration,
	desktopServersConfiguration
]
