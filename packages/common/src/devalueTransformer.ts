import * as devalue from "devalue"
import { Uri } from "./Uri"

const reducers = {
	Uri: (value: unknown) => {
		if (value instanceof Uri) {
			return value.toJSON()
		}
	}
}

const revivers = {
	Uri: (value: ReturnType<Uri["toJSON"]>) => {
		return new Uri(value)
	}
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
