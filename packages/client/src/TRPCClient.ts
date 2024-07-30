import { clientRouter } from "./TRPCClientRouter"
import { t } from "./TRPCServer"

export const trpc = t.createCallerFactory(clientRouter)({})
