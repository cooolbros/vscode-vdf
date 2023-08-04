export function decimalToHexadecimal(n: number): string {
	return n.toString(16).padStart(6, "0")
}

export function hexadecimalToRgb(n: string): [number, number, number] {
	const rgb = [...n.matchAll(/.{2}/g)].map(match => parseInt(match[0], 16))
	return [rgb[0], rgb[1], rgb[2]]
}

export function rgbToHexadecimal(r: number, g: number, b: number): string {
	return `${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

export function hexadecimalToDecimal(str: string): number {
	return parseInt(str, 16)
}
