import { desktopClientConfiguration } from "./extension/desktop/client/webpack.config"
import { desktopServersConfiguration } from "./extension/desktop/servers/webpack.config"

export default [
	desktopClientConfiguration,
	desktopServersConfiguration
]
