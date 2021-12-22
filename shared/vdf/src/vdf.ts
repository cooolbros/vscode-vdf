// VDF

import { Range } from "vscode-languageserver-types"

export interface VDFTokeniserOptions {
	allowMultilineStrings?: boolean
	osTags?: VDFOSTags
}

export enum VDFOSTags {
	None,
	Strings,
	Objects,
	All
}

export interface VDFStringifyOptions {
	indentation?: VDFIndentation
	tabSize?: number
	newLine?: VDFNewLine
	order?: string[] | null
}

export enum VDFIndentation {
	Tabs,
	Spaces
}

export enum VDFNewLine {
	LF = 1,
	CRLF = 2
}

export class VDFTokeniser {
	private static readonly whiteSpaceIgnore: string[] = [" ", "\t", "\r", "\n"]
	private static readonly whiteSpaceTokenTerminate: string[] = ["\"", "{", "}"]
	private readonly str: string
	public readonly options: VDFTokeniserOptions
	public position: number = 0
	public line: number = 0
	public character: number = 0
	public quoted: 0 | 1 = 0

	// Peek
	private _peekToken: string | null = null
	private _peekPosition: number = 0
	private _peekLine: number = 0
	private _peekCharacter: number = 0
	private _peekQuoted: 0 | 1 = 0

	constructor(str: string, options?: VDFTokeniserOptions) {
		this.str = str
		this.options = {
			allowMultilineStrings: options?.allowMultilineStrings ?? false,
			osTags: options?.osTags ?? VDFOSTags.All
		}
	}
	next(lookAhead: boolean = false): string {
		let currentToken: string = ""
		if (this._peekToken != null) {
			currentToken = this._peekToken;
			this.position = this._peekPosition;
			this.line = this._peekLine;
			this.character = this._peekCharacter;
			this.quoted = this._peekQuoted;
			this._peekToken = null;
			return currentToken;
		}

		let j: number = this.position
		let _line: number = this.line
		let _character: number = this.character
		let _quoted: 0 | 1 = this.quoted

		if (j >= this.str.length) {
			return "EOF"
		}

		while (j < this.str.length && (VDFTokeniser.whiteSpaceIgnore.includes(this.str[j]) || this.str[j] == "/")) {
			if (this.str[j] == "\n") {
				_line++
				_character = 0
			}
			else if (this.str[j] == "/") {
				const j1 = j + 1
				if (j1 < this.str.length && this.str[j1] == "/") {
					j++
					while (j < this.str.length && this.str[j] != "\n") {
						j++
					}
					_line++
					_character = 0
				}
				else {
					break
				}
			}
			else {
				_character++
			}
			j++
		}

		if (j >= this.str.length) {
			return "EOF"
		}

		if (this.str[j] == "\"") {
			// Read until next quote (ignore opening quote)
			_quoted = 1
			j++ // Skip over opening double quote
			_character++ // Skip over opening double quote
			while (this.str[j] != "\"") {
				if (this.str[j] == '\n') {
					if (!this.options.allowMultilineStrings) {
						throw new VDFSyntaxError(`Unexpected EOL at position ${j} (line ${_line + 1}, position ${_character + 1})! Are you missing a closing double quote?`, {
							start: { line: _line, character: _character - currentToken.length },
							end: { line: _line, character: _character }
						})
					}
					else {
						_line++
						_character = 0
					}
				}
				else if (this.str[j] == "\\") {
					// Add backslash
					currentToken += "\\"
					j++
					_character++

					if (j >= this.str.length) {
						throw new VDFSyntaxError(`Unclosed escape sequence at position ${j} (line ${_line + 1}, character ${_character + 1})!`, {
							start: { line: _line, character: _character - currentToken.length },
							end: { line: _line, character: _character }
						})
					}

					// Add character
					currentToken += this.str[j]
					j++
					_character++
				}
				else {
					currentToken += this.str[j]
					j++
					_character++
				}

				if (j >= this.str.length) {
					throw new VDFSyntaxError(`Unexpected EOF at position ${j} (line ${_line + 1}, character ${_character + 1})!`, {
						start: { line: _line, character: _character - currentToken.length },
						end: { line: _line, character: _character }
					})
				}
			}
			j++ // Skip over closing quote
			_character++ // Skip over closing quote
		}
		else {
			// Read until whitespace (or end of file)
			_quoted = 0
			while (j < this.str.length && !VDFTokeniser.whiteSpaceIgnore.includes(this.str[j])) {
				if (this.str[j] == "\\") {
					// Add backslash
					currentToken += "\\"
					j++
					_character++

					if (j >= this.str.length) {
						throw new VDFSyntaxError(`Unclosed escape sequence at position ${j} (line ${_line + 1}, character ${_character + 1})!`, {
							start: { line: _line, character: _character - currentToken.length },
							end: { line: _line, character: _character }
						})
					}

					// Add character
					currentToken += this.str[j]
					j++
					_character++
				}
				else if (VDFTokeniser.whiteSpaceTokenTerminate.includes(this.str[j])) {
					// ", {, } terminate a whitespace initiated token but are not added
					if (currentToken == "") {
						// VDFTokeniser.WhiteSpaceTokenTerminate contains a '"' but it that should not be
						// the case here because if currentToken is "" it would be a quoted token
						currentToken += this.str[j];
						j++
						_character++
					}
					break;
				}
				else {
					currentToken += this.str[j]
					j++
					_character++
				}
			}
		}
		if (!lookAhead) {
			this.position = j
			this.line = _line
			this.character = _character
			this.quoted = _quoted
		}
		return currentToken
	}
}

export class VDFSyntaxError extends Error {
	constructor(message: string, public range: Range) {
		super(message)
	}
}

export class VDF {
	static readonly OSTagDelimeter: "^" = "^"
	static parse(str: string, options?: VDFTokeniserOptions) {
		const tokeniser = new VDFTokeniser(str, options)
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
	static stringify(obj: any, options?: VDFStringifyOptions): any {
		const _options: Required<VDFStringifyOptions> = {
			indentation: options?.indentation ?? VDFIndentation.Tabs,
			tabSize: options?.tabSize ?? 4,
			newLine: options?.newLine ?? VDFNewLine.CRLF,
			order: options?.order ?? null
		}
		const tab: string = "\t"
		const space: string = " "
		const eol: string = _options.newLine == VDFNewLine.CRLF ? "\r\n" : "\n"
		const tabIndentation: boolean = _options.indentation == VDFIndentation.Tabs
		const getIndentation: (level: number) => string = tabIndentation
			? (level: number) => tab.repeat(level)
			: (level: number) => space.repeat(level * _options.tabSize)
		const getWhitespace: (longest: number, current: number) => string = tabIndentation
			? (longest: number, current: number) => tab.repeat(Math.floor(((longest + 2) / 4) - Math.floor((current + 2) / 4)) + 2)
			: (longest: number, current: number) => space.repeat((longest + 2) - (current + 2) + (4 - (longest + 2) % 4))
		const stringifyObject = (obj: any, level: number = 0): string => {
			let str: string = ""
			let keys: string[]
			let longestKeyLength: number = 0
			if (_options.order != null) {
				keys = Object.keys(obj).sort((a: string, b: string) => {
					longestKeyLength = Math.max(longestKeyLength, typeof obj[a] != "object" ? a.split(VDF.OSTagDelimeter)[0].length : 0)
					// @ts-ignore
					let _a = _options.order.indexOf(a)
					if (_a == -1) {
						return 1
					}
					// @ts-ignore
					return _a - _options.order.indexOf(b)
				})
			}
			else {
				keys = []
				for (const key in obj) {
					keys.push(key)
					longestKeyLength = Math.max(longestKeyLength, typeof obj[key] != "object" ? key.split(VDF.OSTagDelimeter)[0].length : 0)
				}
			}
			for (const key of keys) {
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
