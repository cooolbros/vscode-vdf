import * as devalue from "devalue"
import { VDFPosition, VDFRange } from "vdf"
import { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { Uri } from "./Uri"

export { devalue }

export const reducers = {
	Symbol: (value: unknown) => typeof value == "symbol" ? Symbol.keyFor(value) : undefined,
	Uri: (value: unknown) => value instanceof Uri ? value.toJSON() : undefined,
	VDFDocumentSymbol: (value: unknown) => value instanceof VDFDocumentSymbol ? value.toJSON() : undefined,
	VDFDocumentSymbols: (value: unknown) => value instanceof VDFDocumentSymbols ? value.toJSON() : undefined,
	VDFPosition: (value: unknown) => value instanceof VDFPosition ? value.toJSON() : undefined,
	VDFRange: (value: unknown) => value instanceof VDFRange ? value.toJSON() : undefined,
}

export const revivers = {
	Symbol: (value: ReturnType<Symbol["toString"]>) => Symbol.for(value),
	Uri: (value: ReturnType<Uri["toJSON"]>) => Uri.schema.parse(value),
	VDFDocumentSymbol: (value: ReturnType<VDFDocumentSymbol["toJSON"]>) => VDFDocumentSymbol.schema.parse(value),
	VDFDocumentSymbols: (value: ReturnType<VDFDocumentSymbols["toJSON"]>) => VDFDocumentSymbols.schema.parse(value),
	VDFPosition: (value: ReturnType<VDFPosition["toJSON"]>) => VDFPosition.schema.parse(value),
	VDFRange: (value: ReturnType<VDFRange["toJSON"]>) => VDFRange.schema.parse(value),
}

export const devalueTransformer = {
	input: {
		serialize: (object: any) => devalue.stringify(object, reducers),
		deserialize: (object: any) => devalue.parse(object, revivers)
	},
	output: {
		serialize: (object: any) => devalue.stringify(object, reducers),
		deserialize: (object: any) => devalue.parse(object, revivers)
	}
}
