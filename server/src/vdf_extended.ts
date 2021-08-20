import { ColorInformation } from "vscode-languageserver/node";

export class VDFExtended {
	static OSTagDelimeter: string = "^"

	static getColours(str: string): ColorInformation[] {
		const whiteSpaceIgnore: string[] = [" ", "\t", "\r", "\n"]
		let i: number = 0;
		let line: number = 0;
		let character: number = 0;
		const next = (lookAhead: boolean = false): string => {
			let currentToken: string = ""
			let j: number = i
			let _line: number = line
			let _character: number = character
			if (j >= str.length - 1) {
				return "EOF"
			}
			while ((whiteSpaceIgnore.includes(str[j]) || str[j] == "/") && j <= str.length - 1) {
				if (str[j] == '\n') {
					_line++;
					_character = 0;
				}
				else {
					_character++;
				}
				if (str[j] == '/') {
					if (str[j + 1] == '/') {
						while (str[j] != '\n') {
							j++;
							// _character++;
						}
						_line++;
						_character = 0;
					}
				}
				else {
					j++;
					// _character++
				}
				if (j >= str.length) {
					return "EOF";
				}
			}
			if (str[j] == '"') {
				// Read until next quote (ignore opening quote)
				j++; // Skip over opening double quote
				_character++; // Skip over opening double quote
				while (str[j] != '"' && j < str.length) {
					if (str[j] == '\n') {
						throw {
							message: `Unexpected EOL at position ${j} (line ${_line + 1}, position ${_character + 1})! Are you missing a closing double quote?`,
							line: _line,
							character: _character
						}
					}
					currentToken += str[j];
					j++;
					_character++;
				}
				j++; // Skip over closing quote
				_character++; // Skip over closing quote
			}
			else {
				// Read until whitespace (or end of file)
				while (!whiteSpaceIgnore.includes(str[j]) && j < str.length - 1) {
					if (str[j] == '"') {
						throw {
							message: `Unexpected " at position ${j} (line ${line}, position ${character})! Are you missing terminating whitespace?`,
							line: _line,
							character: _character
						}
					}
					currentToken += str[j];
					j++;
				}
			}
			if (!lookAhead) {
				i = j;
				line = _line;
				character = _character;
			}
			return currentToken
		}
		const parseObject = (): ColorInformation[] => {
			const obj: { [key: string]: any } = {}
			const colours: ColorInformation[] = []
			let currentToken = next();
			let nextToken = next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					currentToken += `${VDFExtended.OSTagDelimeter}${next()}`;
					next(); // Skip over opening brace
					// obj[currentToken] = parseObject();
					colours.push(...parseObject())
				}
				else if (nextToken == "{") {
					// Object
					next(); // Skip over opening brace
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
					next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						currentToken += `${VDFExtended.OSTagDelimeter}${next()}`;
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
									line: line,
									character: character - nextToken.length - 1
								},
								end: {
									line: line,
									character: character - 1
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
				currentToken = next();
				nextToken = next(true);
			}
			return colours;
		}
		return parseObject();
	}
}