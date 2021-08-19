export class VDF {
	static OSTagDelimeter: string = "^"
	static parse(str: string): any {
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
					if (str[j + 1] == "/") {
						while (str[j] != '\n') {
							j++;
						}
						_line++;
					}
				}
				else {
					j++;
				}
				if (j >= str.length) {
					return "EOF";
				}
			}
			if (str[j] == '"') {
				// Read until next quote (ignore opening quote)
				j++;
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
			}
			else {
				// Read until whitespace (or end of file)
				while (!whiteSpaceIgnore.includes(str[j]) && j < str.length - 1) {
					if (str[j] == '"') {
						throw {
							message: `Unexpected '"' at position ${j} (line ${line}, position ${character})! Are you missing terminating whitespace?`,
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
		const parseObject = (): { [key: string]: any } => {
			const obj: { [key: string]: any } = {}
			let currentToken = next();
			let nextToken = next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					currentToken += `${VDF.OSTagDelimeter}${next()}`;
					next(); // Skip over opening brace
					obj[currentToken] = parseObject();
				}
				else if (nextToken == "{") {
					// Object
					next(); // Skip over opening brace
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
					next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						currentToken += `${VDF.OSTagDelimeter}${next()}`;
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
				currentToken = next();
				nextToken = next(true);
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
