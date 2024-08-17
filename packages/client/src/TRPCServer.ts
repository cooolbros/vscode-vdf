import { initTRPC } from "@trpc/server"
import { devalueTransformer } from "common/devalueTransformer"

export const t = initTRPC.create({ transformer: devalueTransformer })
