export function ArrayEndsWithArray<T1, T2>(arr1: T1[], arr2: T2[], comparer: (a: T1, b: T2) => boolean): boolean {

	if (arr1.length < arr2.length) {
		return false
	}

	const start = arr1.length - arr2.length
	return arr2.every((value, index) => comparer(arr1[start + index], value))
}
