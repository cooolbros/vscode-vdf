import { ColorInformation, TextEdit } from "vscode-languageserver/node";
import { VDFTokeniser } from './vdf_tokeniser';

export class VDFExtended {
	static OSTagDelimeter: string = "^"

	static getColours(str: string): ColorInformation[] {
		const tokeniser = new VDFTokeniser(str)
		const parseObject = (): ColorInformation[] => {
			const obj: { [key: string]: any } = {}
			const colours: ColorInformation[] = []
			let currentToken = tokeniser.next();
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
					tokeniser.next(); // Skip over opening brace
					// obj[currentToken] = parseObject();
					colours.push(...parseObject())
				}
				else if (nextToken == "{") {
					// Object
					tokeniser.next(); // Skip over opening brace
					if (obj.hasOwnProperty(currentToken)) {
						const value = obj[currentToken]
						if (Array.isArray(value)) {
							// Object list exists
							// obj[currentToken].push(parseObject());
							colours.push(...parseObject())
						}
						else {
							// Object already exists
							// obj[currentToken] = [value, parseObject()]
							colours.push(...parseObject())
						}
					}
					else {
						// Object doesnt exist
						// obj[currentToken] = parseObject();
						colours.push(...parseObject())
					}
				}
				else {
					// Primitive
					tokeniser.next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
					}

					if (/\d+\s+\d+\s+\d+\s+\d+/.test(nextToken)) {
						const colour = nextToken.split(/\s+/)
						colours.push({
							color: {
								red: parseInt(colour[0]) / 255,
								green: parseInt(colour[1]) / 255,
								blue: parseInt(colour[2]) / 255,
								alpha: parseInt(colour[3]) / 255
							},
							range: {
								// The tokeniser skips over the last closing brace, subtract 1 to stay inside
								start: {
									line: tokeniser.line,
									character: tokeniser.character - nextToken.length - 1
								},
								end: {
									line: tokeniser.line,
									character: tokeniser.character - 1
								}
							}
						})
					}

					// if (obj.hasOwnProperty(currentToken)) {
					// 	const value = obj[currentToken]
					// 	// dynamic property exists
					// 	if (Array.isArray(value)) {
					// 		// Array already exists
					// 		obj[currentToken].push(nextToken);
					// 	}
					// 	else {
					// 		// Primitive type already exists
					// 		obj[currentToken] = [value, nextToken]
					// 	}
					// }
					// else {
					// 	// Property doesn't exist
					// 	obj[currentToken] = nextToken;
					// }
				}
				currentToken = tokeniser.next();
				nextToken = tokeniser.next(true);
			}
			return colours;
		}
		return parseObject();
	}
	static renameToken(str: string, oldName: string, newName: string, uri?: string): { [uri: string]: TextEdit[] } {
		const tokeniser = new VDFTokeniser(str)
		const result: { [uri: string]: TextEdit[] } = {}
		const parseObject = (): { [key: string]: any } => {
			const obj: { [key: string]: any } = {}
			let currentToken = tokeniser.next();
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
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
						currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
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
		parseObject();
		return result
	}
}