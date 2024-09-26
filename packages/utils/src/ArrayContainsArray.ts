/**
 * Check to see if one array contains all items of another array in order
 * @param arr1 Outer array
 * @param arr2 Inner array
 * @returns `true` if the outer array contains all the elements of the inner array in order
 * @example ```
 * ArrayContainsArray(["a", "b", "c", "d"], ["b", "c"]) // true
 * ArrayContainsArray(["a", "b", "c", "d"], ["d", "e"]) // false
 * ArrayContainsArray(["a", "b", "c", "d"], []) // true
 * ```
 */
export function ArrayContainsArray<T1, T2>(arr1: T1[], arr2: T2[], comparer: (a: T1, b: T2) => boolean): boolean {

	if (arr2.length == 0) {
		return true
	}

	// Impossible for arr1 to satisfy arr2 if it doesnt have enough length
	if (arr1.length < arr2.length) {
		return false
	}

	let i = 0
	let index = 0

	while (i < arr1.length) {
		if (comparer(arr1[i], arr2[index])) {

			while (index < arr2.length) {

				if (!comparer(arr1[i], arr2[index])) {
					return false
				}

				i++
				index++
			}

			return true
		}
		i++
	}

	return false
}
