/**
 * Recursive merge all properties from one object into another
 * @param obj1 First Object
 * @param obj2 Second Object
 */
export function merge(obj1: any, obj2: any): any {
	for (let i in obj1) {
		if (typeof obj1[i] === "object") {
			if (obj2.hasOwnProperty(i) && typeof obj2[i] == "object") {
				merge(obj1[i], obj2[i])
			}
		}
		else {
			if (obj2.hasOwnProperty(i)) {
				obj1[i] = obj2[i]
			}
		}
	}
	for (let j in obj2) {
		// check if property exists because we dont want to shallow merge an object
		if (!obj1.hasOwnProperty(j)) {
			obj1[j] = obj2[j]
		}
	}

	return obj1
}