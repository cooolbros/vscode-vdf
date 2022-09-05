export function decimalToHexadecimal(n: number): string {
	let str = n.toString(16)
	if (str.length < 6) {
		str = `${"0".repeat(6 - str.length)}${str}`
	}
	return str
	// 	let str = ""
	// 	do {
	// 		str = `${(n % 16).toString(16)}${str}`
	// 		n = Math.floor(n / 16)
	// 	}
	// 	while (n > 0)
	// 	return str
}

export function hexadecimalToRgb(n: string): [number, number, number] {
	const rgb = [...n.matchAll(/.{2}/g)].map(match => parseInt(match[0], 16))
	return [rgb[0], rgb[1], rgb[2]]
}

export function rgbToHexadecimal(r: number, g: number, b: number): string {
	const r1 = r.toString(16)
	const g1 = g.toString(16)
	const b1 = b.toString(16)
	return `${"0".repeat(2 - r1.length)}${r1}` + `${"0".repeat(2 - g1.length)}${g1}` + `${"0".repeat(2 - b1.length)}${b1}`
}

export function hexadecimalToDecimal(str: string): number {
	return parseInt(str, 16)
	// let n: number = 0
	// for (let i = 0; i < str.length; i++) {
	// 	n = n * 16 + parseInt(str[i], 16)
	// }
	// return n
}
