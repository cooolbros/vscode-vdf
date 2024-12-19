import { UnexpectedCharacterError, UnexpectedEndOfFileError, UnexpectedTokenError, VDFPosition, VDFRange, VDFTokenType, VDFTokeniser, type VDFToken } from "vdf"
import { AccelInterpolator, AnimateDocumentSymbol, BiasInterpolator, BounceInterpolator, DeAccelInterpolator, FireCommandDocumentSymbol, FlickerInterpolator, GainInterpolator, HUDAnimationsEventDocumentSymbol, LinearInterpolator, PlaySoundDocumentSymbol, PulseInterpolator, RunEventChildDocumentSymbol, RunEventDocumentSymbol, SetFontDocumentSymbol, SetInputEnabledDocumentSymbol, SetStringDocumentSymbol, SetTextureDocumentSymbol, SetVisibleDocumentSymbol, SplineInterpolator, StopAnimationDocumentSymbol, StopEventDocumentSymbol, StopPanelAnimationsDocumentSymbol, type HUDAnimationsStatementDocumentSymbol, type Interpolator } from "./HUDAnimationsDocumentSymbol"
import { HUDAnimationsDocumentSymbols, HUDAnimationsStatementDocumentSymbols } from "./HUDAnimationsDocumentSymbols"

export function getHUDAnimationsDocumentSymbols(str: string): HUDAnimationsDocumentSymbols {

	const tokeniser = new VDFTokeniser(str)

	function parseFile(): HUDAnimationsDocumentSymbols {

		const documentSymbols = new HUDAnimationsDocumentSymbols()

		while (true) {
			const token = tokeniser.next()
			if (token == null) {
				break
			}

			if (token.type == VDFTokenType.String && token.value == "event") {
				documentSymbols.push(parseEvent(token))
			}
			else {
				throw new UnexpectedTokenError(`'${token.value}'`, ["'event'"], token.range)
			}
		}

		return documentSymbols
	}

	function parseEvent(eventToken: VDFToken): HUDAnimationsEventDocumentSymbol {

		const eventName = tokeniser.next()
		if (eventName == null) {
			throw new UnexpectedEndOfFileError(["event name"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}
		if (eventName.type != VDFTokenType.String) {
			throw new UnexpectedTokenError(`'${eventName.value}'`, ["event name"], eventName.range)
		}

		let conditional: VDFToken | null = null

		let token = tokeniser.next()
		if (token == null) {
			throw new UnexpectedEndOfFileError(["'{'", "conditional"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}

		switch (token.type) {
			case VDFTokenType.ControlCharacter: {
				if (token.value != "{") {
					throw new UnexpectedTokenError(`'${token.value}'`, ["'{'", "conditional"], token.range)
				}
				break
			}
			case VDFTokenType.Conditional: {
				conditional = token
				token = tokeniser.next()
				if (token == null) {
					throw new UnexpectedEndOfFileError(["'{'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
				}
				if (token.type != VDFTokenType.ControlCharacter || token.value != "{") {
					throw new UnexpectedTokenError(`'${token.value}'`, ["'{'"], token.range)
				}
				break
			}
			default:
				throw new UnexpectedTokenError(`'${token.value}'`, ["'{'", "conditional"], token.range)
		}

		const statements = new HUDAnimationsStatementDocumentSymbols()

		while (true) {
			const animationCommandToken = tokeniser.next()
			if (animationCommandToken == null) {
				throw new UnexpectedEndOfFileError(["animation command", "'}'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}

			if (animationCommandToken.type == VDFTokenType.String) {
				statements.push(parseAnimation(animationCommandToken.value, animationCommandToken.range))
			}
			else if (animationCommandToken.type == VDFTokenType.ControlCharacter && animationCommandToken.value == "}") {
				break
			}
			else {
				throw new UnexpectedCharacterError(`'${animationCommandToken.value}'`, ["animation command", "'}'"], animationCommandToken.range)
			}
		}

		return new HUDAnimationsEventDocumentSymbol(
			eventName,
			conditional,
			new VDFRange(eventToken.range.start, new VDFPosition(tokeniser.line, tokeniser.character)),
			statements
		)
	}

	function readString(check = true): VDFToken {
		const token = tokeniser.next()
		if (token == null) {
			throw new UnexpectedEndOfFileError(["string"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}
		if (check && token.type != VDFTokenType.String) {
			throw new UnexpectedTokenError(`'${token.value}'`, ["string"], token.range)
		}
		return token
	}

	function readStringValue(): string {
		return readString().value
	}

	function readNumber(): number {
		const token = readString(false)
		if (/[^\d.]/.test(token.value)) {
			throw new UnexpectedTokenError(`'${token.value}'`, ["number"], token.range)
		}
		return parseFloat(token.value)
	}

	function readBool(): string {

		const token = tokeniser.next()
		if (token == null) {
			throw new UnexpectedEndOfFileError(["'0'", "'1'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}

		if (token.value != "0" && token.value != "1") {
			throw new UnexpectedTokenError(`'${token.value}'`, ["'0'", "'1'"], token.range)
		}

		return token.value
	}

	function readConditional(): string | undefined {
		try {
			const token = tokeniser.next({ peek: true })
			if (token?.type != VDFTokenType.Conditional) {
				return undefined
			}
			tokeniser.next()
			return token.value
		}
		catch (error: any) {
			return undefined
		}
	}

	function parseAnimation(type: string, typeRange: VDFRange): HUDAnimationsStatementDocumentSymbol {

		let statement: HUDAnimationsStatementDocumentSymbol

		switch (type.toLowerCase()) {
			case "animate": {
				const elementToken = readString()
				const propertyToken = readString()
				const valueToken = readString()
				statement = new AnimateDocumentSymbol(
					{
						element: elementToken.value,
						elementRange: elementToken.range,
						property: propertyToken.value,
						propertyRange: propertyToken.range,
						value: valueToken.value,
						valueRange: valueToken.range,
						interpolator: ((): Interpolator => {
							const interpolator = tokeniser.next()
							if (interpolator == null) {
								throw new UnexpectedEndOfFileError(["string"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
							}

							if (interpolator.type != VDFTokenType.String) {
								throw new UnexpectedTokenError(`'${interpolator.value}'`, ["string"], interpolator.range)
							}

							switch (interpolator.value.toLowerCase()) {
								case "accel": return new AccelInterpolator()
								case "bias": return new BiasInterpolator(readStringValue())
								case "bounce": return new BounceInterpolator()
								case "deaccel": return new DeAccelInterpolator()
								case "flicker": return new FlickerInterpolator(readStringValue())
								case "gain": return new GainInterpolator(readStringValue())
								case "linear": return new LinearInterpolator()
								case "pulse": return new PulseInterpolator(readStringValue())
								case "spline": return new SplineInterpolator()
								default: throw new UnexpectedTokenError(`'${interpolator.value}'`, ["interpolator"], interpolator.range)
							}
						})(),
						delay: readNumber(),
						duration: readNumber(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "runevent": {
				const eventToken = readString()
				statement = new RunEventDocumentSymbol(
					{
						event: eventToken.value,
						eventRange: eventToken.range,
						delay: readNumber(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "stopevent": {
				const eventToken = readString()
				statement = new StopEventDocumentSymbol(
					{
						event: eventToken.value,
						eventRange: eventToken.range,
						delay: readNumber(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "setvisible": {
				const elementToken = readString()
				statement = new SetVisibleDocumentSymbol(
					{
						element: elementToken.value,
						elementRange: elementToken.range,
						visible: readBool(),
						delay: readNumber(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "firecommand": {
				statement = new FireCommandDocumentSymbol(
					{
						delay: readNumber(),
						command: readStringValue(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "runeventchild": {
				const elementToken = readString()
				const eventToken = readString()
				statement = new RunEventChildDocumentSymbol(
					{
						element: elementToken.value,
						elementRange: elementToken.range,
						event: eventToken.value,
						eventRange: eventToken.range,
						delay: readNumber(),
						conditional: readConditional()
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "setinputenabled": {
				const elementToken = readString()
				statement = new SetInputEnabledDocumentSymbol(
					{
						element: elementToken.value,
						elementRange: elementToken.range,
						enabled: readStringValue(),
						delay: readNumber(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "playsound": {
				const delay = readNumber()
				const soundToken = readString()
				statement = new PlaySoundDocumentSymbol(
					{
						delay: delay,
						sound: soundToken.value,
						soundRange: soundToken.range,
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "stoppanelanimations": {
				statement = new StopPanelAnimationsDocumentSymbol(
					{
						element: readStringValue(),
						delay: readNumber(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "stopanimation": {
				statement = new StopAnimationDocumentSymbol(
					{
						element: readStringValue(),
						property: readStringValue(),
						delay: readNumber(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "setfont": {
				const elementToken = readString()
				const propertyToken = readString()
				const fontToken = readString()

				statement = new SetFontDocumentSymbol(
					{
						element: elementToken.value,
						elementRange: elementToken.range,
						property: propertyToken.value,
						propertyRange: propertyToken.range,
						font: fontToken.value,
						fontRange: fontToken.range,
						delay: readNumber(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "settexture": {
				const elementToken = readString()
				const propertyToken = readString()
				const valueToken = readString()

				statement = new SetTextureDocumentSymbol(
					{
						element: elementToken.value,
						elementRange: elementToken.range,
						property: propertyToken.value,
						propertyRange: propertyToken.range,
						value: valueToken.value,
						valueRange: valueToken.range,
						delay: readNumber(),
						conditional: readConditional(),
					},
					new VDFRange(typeRange.start, new VDFPosition(tokeniser.line, tokeniser.character))
				)
				break
			}
			case "setstring": {
				const elementToken = readString()
				const propertyToken = readString()
				const valueToken = readString()

				statement = new SetStringDocumentSymbol(
					{
						element: elementToken.value,
						elementRange: elementToken.range,
						property: propertyToken.value,
						propertyRange: propertyToken.range,
						value: valueToken.value,
						valueRange: valueToken.range,
						delay: readNumber(),
						conditional: readConditional(),
					},
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
