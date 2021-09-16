export class VDFExtended {
	static OSTagDelimeter: string = "^"

	static sort(obj: any, order: string[], tabs: number = 0): string {
		let str: string = "";
		const tab: string = "\t";
		const newLine: string = "\r\n";
		let longestKeyLength: number = 0;

		const keys = Object.keys(obj).sort((a: string, b: string) => {
			let _a = order.indexOf(a)
			if (_a == -1) {
				return 1
			}
			return _a - order.indexOf(b)
		})

		for (let key of keys) {
			if (typeof obj[key] != "object" || Array.isArray(obj[key])) {
				longestKeyLength = Math.max(longestKeyLength, key.split(VDFExtended.OSTagDelimeter)[0].length)
			}
		}
		for (let key of keys) {
			if (Array.isArray(obj[key])) {
				// Object has multiple instances
				for (var item of obj[key]) {
					if (typeof item == "object") {
						const keyTokens: string[] = key.split(VDFExtended.OSTagDelimeter);
						if (keyTokens.length > 1) {
							// OS Tag
							str += `${tab.repeat(tabs)}\"${key}\" ${keyTokens[1]}${newLine}`;
						}
						else {
							// No OS Tag
							str += `${tab.repeat(tabs)}\"${key}\"${newLine}`;
						}
						str += `${tab.repeat(tabs)}{${newLine}`;
						str += `${VDFExtended.sort(item, order, tabs + 1)}${tab.repeat(tabs)}}${newLine}`
					}
					else {
						const keyTokens: string[] = key.split(VDFExtended.OSTagDelimeter);
						if (keyTokens.length > 1) {
							// OS Tag
							str += `${tab.repeat(tabs)}"${key}\"${tab.repeat(Math.floor((longestKeyLength + 2) / 4) - Math.floor((keyTokens[0].length + 2) / 4) + 2)}\"${item}\" ${keyTokens[1]}${newLine}"`;
						}
						else {
							// No OS Tag
							str += `${tab.repeat(tabs)}"${key}"${tab.repeat(Math.floor((longestKeyLength + 2) / 4) - Math.floor((key.length + 2) / 4) + 2)}"${item}"${newLine}`;
						}
					}
				}
			}
			else {
				// There is only one object object/value
				if (typeof obj[key] == "object") {
					const keyTokens: string[] = key.split(VDFExtended.OSTagDelimeter);
					if (keyTokens.length > 1) {
						str += `${tab.repeat(tabs)}"${keyTokens[0]}\" ${keyTokens[1]}${newLine}`;
					}
					else {
						// No OS Tag
						str += `${tab.repeat(tabs)}"${key}\"${newLine}`;
					}
					str += `${tab.repeat(tabs)}{${newLine}`;
					str += `${VDFExtended.sort(obj[key], order, tabs + 1)}${tab.repeat(tabs)}}${newLine}`
				}
				else {
					const keyTokens: string[] = key.split(VDFExtended.OSTagDelimeter);
					if (keyTokens.length > 1) {
						// OS Tag
						str += `${tab.repeat(tabs)}\"${keyTokens[0]}"${tab.repeat(Math.floor((longestKeyLength + 2) / 4) - Math.floor((keyTokens[0].length + 2) / 4) + 2)}"${obj[key]}" ${keyTokens[1]}${newLine}`;
					}
					else {
						// No OS Tag
						str += `${tab.repeat(tabs)}"${key}"${tab.repeat(((Math.floor(longestKeyLength + 2) / 4) - Math.floor((key.length + 2) / 4)) + 2)}"${obj[key]}"${newLine}`;
					}
				}
			}
		}
		return str
	}

}