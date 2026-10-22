import { UnexpectedCharacterError, UnexpectedEndOfFileError, UnexpectedTokenError, VDFPosition, VDFRange, VDFTokenType, VDFTokeniser, type VDFToken } from "vdf"
import type { VDFText } from "vdf-documentsymbols"
import { Accel, AnimateDocumentSymbol, Bias, Bounce, DeAccel, FireCommandDocumentSymbol, Flicker, Gain, HUDAnimationsEventDocumentSymbol, Linear, PlaySoundDocumentSymbol, Pulse, RunEventChildDocumentSymbol, RunEventDocumentSymbol, SetFontDocumentSymbol, SetInputEnabledDocumentSymbol, SetStringDocumentSymbol, SetTextureDocumentSymbol, SetVisibleDocumentSymbol, Spline, StopAnimationDocumentSymbol, StopEventDocumentSymbol, StopPanelAnimationsDocumentSymbol, Unknown, type HUDAnimationsStatementDocumentSymbol, type Interpolator } from "./HUDAnimationsDocumentSymbol"
import { HUDAnimationsDocumentSymbols, HUDAnimationsStatementDocumentSymbols } from "./HUDAnimationsDocumentSymbols"

export function getHUDAnimationsDocumentSymbols(str: string): HUDAnimationsDocumentSymbols {

	const tokeniser = new VDFTokeniser(str)

	function parseFile(): HUDAnimationsDocumentSymbols {

		const documentSymbols = new HUDAnimationsDocumentSymbols()
		let comments: string[] | undefined = undefined

		while (true) {
			const token = tokeniser.format()
			if (token == null) {
				break
			}

			if (token.type == VDFTokenType.String && token.value.toLowerCase() == "event") {
				documentSymbols.push(parseEvent(token, comments?.join("\n")))
				comments = undefined
			}
			else if (token.type == VDFTokenType.Comment) {
				(comments ??= []).push(token.value)
			}
			else {
				throw new UnexpectedTokenError(`'${token.value}'`, ["'event'"], token.range)
			}
		}

		return documentSymbols
	}

	function parseEvent(eventToken: VDFToken, documentation?: string): HUDAnimationsEventDocumentSymbol {

		const eventName = tokeniser.token()
		if (eventName == null) {
			throw new UnexpectedEndOfFileError(["event name"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}
		if (eventName.type != VDFTokenType.String) {
			throw new UnexpectedTokenError(`'${eventName.value}'`, ["event name"], eventName.range)
		}

		let conditional: VDFToken | null = null

		let token = tokeniser.token()
		if (token == null) {
			throw new UnexpectedEndOfFileError(["'{'", "conditional"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}

		switch (token.type) {
			case VDFTokenType.OpeningBrace: {
				break
			}
			case VDFTokenType.Conditional: {
				conditional = token
				token = tokeniser.token()
				if (token == null) {
					throw new UnexpectedEndOfFileError(["'{'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
				}
				if (token.type != VDFTokenType.OpeningBrace) {
					throw new UnexpectedTokenError(`'${token.value}'`, ["'{'"], token.range)
				}
				break
			}
			default:
				throw new UnexpectedTokenError(`'${token.value}'`, ["'{'", "conditional"], token.range)
		}

		const statements = new HUDAnimationsStatementDocumentSymbols()

		while (true) {
			const animationCommandToken = tokeniser.token()
			if (animationCommandToken == null) {
				throw new UnexpectedEndOfFileError(["animation command", "'}'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}

			if (animationCommandToken.type == VDFTokenType.String) {
				statements.push(parseAnimation(animationCommandToken.value, animationCommandToken.range))
			}
			else if (animationCommandToken.type == VDFTokenType.ClosingBrace) {
				break
			}
			else {
				throw new UnexpectedCharacterError(`'${animationCommandToken.value}'`, ["animation command", "'}'"], animationCommandToken.range)
			}
		}

		return new HUDAnimationsEventDocumentSymbol(
			{ text: eventName.value, range: eventName.textRange, tokenRange: eventName.range, quoted: eventName.quoted },
			conditional,
			new VDFRange(eventToken.range.start, new VDFPosition(tokeniser.line, tokeniser.character)),
			statements,
			documentation
		)
	}

	function string(): VDFText {
		const token = tokeniser.token()
		if (token == null) {
			throw new UnexpectedEndOfFileError(["string"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}
		if (token.type != VDFTokenType.String) {
			throw new UnexpectedTokenError(`'${token.value}'`, ["string"], token.range)
		}

		return {
			text: token.value,
			range: token.textRange,
			tokenRange: token.range,
			quoted: token.quoted,
		}
	}

	function number(): VDFText {
		const token = tokeniser.token()
		if (token == null) {
			throw new UnexpectedEndOfFileError(["number"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}
		if (token.type != VDFTokenType.String || /[^\d.]/.test(token.value)) {
			throw new UnexpectedTokenError(`'${token.value}'`, ["number"], token.range)
		}

		return {
			text: token.value,
			range: token.textRange,
			tokenRange: token.range,
			quoted: token.quoted,
		}
	}

	function bool(): VDFText {
		const token = tokeniser.token()
		if (token == null) {
			throw new UnexpectedEndOfFileError(["'0'", "'1'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}

		if (token.value != "0" && token.value != "1") {
			throw new UnexpectedTokenError(`'${token.value}'`, ["'0'", "'1'"], token.range)
		}

		return {
			text: token.value,
			range: token.textRange,
			tokenRange: token.range,
			quoted: token.quoted,
		}
	}

	function parseAnimation(type: string, typeRange: VDFRange): HUDAnimationsStatementDocumentSymbol {

		let statement: HUDAnimationsStatementDocumentSymbol

		switch (type.toLowerCase()) {
			case "animate": {
				const element = string()
				const property = string()
				const value = string()
				const interpolator = ((): Interpolator => {
					const interpolator = string()
					switch (interpolator.text.toLowerCase()) {
						case "accel": {
							return new Accel(interpolator.range,)
						}
						case "bias": {
							const bias = string()
							return new Bias(interpolator.range, bias)
						}
						case "bounce": {
							return new Bounce(interpolator.range)
						}
						case "deaccel": {
							return new DeAccel(interpolator.range)
						}
						case "flicker": {
							const randomnessToken = string()
							return new Flicker(interpolator.range, randomnessToken)
						}
						case "gain": {
							const bias = string()
							return new Gain(interpolator.range, bias)
						}
						case "linear": {
							return new Linear(interpolator.range,)
						}
						case "pulse": {
							const frequency = string()
							return new Pulse(interpolator.range, frequency)
						}
						case "spline": {
							return new Spline(interpolator.range)
						}
						default: {
							return new Unknown(interpolator.range, interpolator)
						}
					}
				})()
				const delay = number()
				const duration = number()
				statement = new AnimateDocumentSymbol(
					element,
					property,
					value,
					interpolator,
					delay,
					duration,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)

				break
			}
			case "runevent": {
				const event = string()
				const delay = number()
				statement = new RunEventDocumentSymbol(
					event,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "stopevent": {
				const event = string()
				const delay = number()
				statement = new StopEventDocumentSymbol(
					event,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "setvisible": {
				const element = string()
				const visible = bool()
				const delay = number()
				statement = new SetVisibleDocumentSymbol(
					element,
					visible,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "firecommand": {
				const delay = number()
				const command = string()
				statement = new FireCommandDocumentSymbol(
					delay,
					command,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "runeventchild": {
				const element = string()
				const event = string()
				const delay = number()
				statement = new RunEventChildDocumentSymbol(
					element,
					event,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "setinputenabled": {
				const element = string()
				const enabled = bool()
				const delay = number()
				statement = new SetInputEnabledDocumentSymbol(
					element,
					enabled,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "playsound": {
				const delay = number()
				const sound = string()
				statement = new PlaySoundDocumentSymbol(
					delay,
					sound,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "stoppanelanimations": {
				const element = string()
				const delay = number()
				statement = new StopPanelAnimationsDocumentSymbol(
					element,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "stopanimation": {
				const element = string()
				const property = string()
				const delay = number()
				statement = new StopAnimationDocumentSymbol(
					element,
					property,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "setfont": {
				const element = string()
				const property = string()
				const font = string()
				const delay = number()
				statement = new SetFontDocumentSymbol(
					element,
					property,
					font,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "settexture": {
				const element = string()
				const property = string()
				const value = string()
				const delay = number()
				statement = new SetTextureDocumentSymbol(
					element,
					property,
					value,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "setstring": {
				const element = string()
				const property = string()
				const value = string()
				const delay = number()
				statement = new SetStringDocumentSymbol(
					element,
					property,
					value,
					delay,
					tokeniser.conditional(),
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			default:
				throw new UnexpectedTokenError(`'${type}'`, ["animation command", "'}'"], typeRange)
		}

		return statement
	}

	return parseFile()
}
