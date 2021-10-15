import { VDFTokeniser } from "./vdf_tokeniser";

export class VDF {
	static OSTagDelimeter: string = "^"
	static parse(str: string): any {
		const tokeniser = new VDFTokeniser(str)
		const parseObject = (): { [key: string]: any } => {
			const obj: { [key: string]: any } = {}
			let currentToken = tokeniser.next();
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					currentToken += `${VDF.OSTagDelimeter}${tokeniser.next()}`;
					tokeniser.next(); // Skip over opening brace
					obj[currentToken] = parseObject();
				}
				else if (nextToken == "{") {
					// Object
					tokeniser.next(); // Skip over opening brace
					if (obj.hasOwnProperty(currentToken)) {
						const value = obj[currentToken]
						if (Array.isArray(value)) {
							// Object list exists
							obj[currentToken].push(parseObject());
						}
						else {
							// Object already exists
							obj[currentToken] = [value, parseObject()]
						}
					}
					else {
						// Object doesnt exist
						obj[currentToken] = parseObject();
					}
				}
				else {
					// Primitive
					tokeniser.next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						currentToken += `${VDF.OSTagDelimeter}${tokeniser.next()}`;
					}
					if (obj.hasOwnProperty(currentToken)) {
						const value = obj[currentToken]
						// dynamic property exists
						if (Array.isArray(value)) {
							// Array already exists
							obj[currentToken].push(nextToken);
						}
						else {
							// Primitive type already exists
							obj[currentToken] = [value, nextToken]
						}
					}
					else {
						// Property doesn't exist
						obj[currentToken] = nextToken;
					}
				}
				currentToken = tokeniser.next();
				nextToken = tokeniser.next(true);
			}
			return obj;
		}
		return parseObject();
	}
	static stringify(obj: any, indentation: "Tabs" | "Spaces" = "Tabs", newLine: "CRLF" | "LF" = "CRLF"): string {
		const tab: string = "\t"
		const space: string = " "
		const eol: string = newLine == "CRLF" ? "\r\n" : "\n"
		const tabIndentation: boolean = indentation == "Tabs"
		const getIndentation: (level: number) => string = tabIndentation
			? (level: number) => tab.repeat(level)
			: (level: number) => space.repeat(level * 4)
		const getWhitespace: (longest: number, current: number) => string = tabIndentation
			? (longest: number, current: number) => tab.repeat(Math.floor(((longest + 2) / 4) - Math.floor((current + 2) / 4)) + 2)
			: (longest: number, current: number) => space.repeat((longest + 2) - (current + 2) + (4 - (longest + 2) % 4))
		const stringifyObject = (obj: any, level: number = 0): string => {
			let str: string = ""
			const longestKeyLength: number = Object.keys(obj).reduce((total: number, current: string) => Math.max(total, typeof obj[current] != "object" ? current.split(VDF.OSTagDelimeter)[0].length : 0), 0)
			for (const key in obj) {
				const keyTokens: string[] = key.split(VDF.OSTagDelimeter)
				if (Array.isArray(obj[key])) {
					for (const item of obj[key]) {
						if (typeof item == "object") {
							if (keyTokens.length > 1) {
								str += `${getIndentation(level)}"${keyTokens[0]}" ${keyTokens[1]}${eol}`
							}
							else {
								str += `${getIndentation(level)}"${key}"${eol}`;
							}
							str += `${getIndentation(level)}{${eol}`;
							str += `${stringifyObject(item, level + 1)}`;
							str += `${getIndentation(level)}}${eol}`;
						}
						else {
							if (keyTokens.length > 1) {
								str += `${getIndentation(level)}"${keyTokens[0]}"${getWhitespace(longestKeyLength, keyTokens[0].length)}"${item}" ${keyTokens[1]}${eol}`;
							}
							else {
								str += `${getIndentation(level)}"${key}"${getWhitespace(longestKeyLength, key.length)}"${item}"${eol}`;
							}
						}
					}
				}
				else {
					if (typeof obj[key] == "object") {
						if (keyTokens.length > 1) {
							str += `${getIndentation(level)}"${keyTokens[0]}" ${keyTokens[1]}${eol}`;
						}
						else {
							str += `${getIndentation(level)}"${key}"${eol}`;
						}
						str += `${getIndentation(level)}{${eol}`;
						str += `${stringifyObject(obj[key], level + 1)}`;
						str += `${getIndentation(level)}}${eol}`;
					}
					else {
						if (keyTokens.length > 1) {
							str += `${getIndentation(level)}"${keyTokens[0]}"${getWhitespace(longestKeyLength, keyTokens[0].length)}"${obj[key]}" ${keyTokens[1]}${eol}`;
						}
						else {
							str += `${getIndentation(level)}"${key}"${getWhitespace(longestKeyLength, key.length)}"${obj[key]}"${eol}`;
						}
					}
				}
			}
			return str
		}
		return stringifyObject(obj)
	}
}
