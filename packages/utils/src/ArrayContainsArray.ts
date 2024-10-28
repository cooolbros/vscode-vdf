export function ArrayContainsArray<T1, T2>(arr1: T1[], arr2: T2[], comparer: (a: T1, b: T2) => boolean): boolean {

	if (arr2.length == 0) {
		return true
	}

	if (arr1.length < arr2.length) {
		return false
	}

	return arr1.some((_, index) => arr2.every((v, i) => index + i < arr1.length && comparer(arr1[index + i], v)))
}
