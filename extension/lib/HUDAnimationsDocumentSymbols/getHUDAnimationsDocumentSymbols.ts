import { EndOfStreamError, UnexpectedTokenError } from "$lib/VDF/VDFErrors"
import { VDFPosition } from "$lib/VDF/VDFPosition"
import { VDFRange } from "$lib/VDF/VDFRange"
import { VDFToken, VDFTokenType } from "$lib/VDF/VDFToken"
import { VDFTokeniser } from "$lib/VDF/VDFTokeniser"
import { AccelInterpolator, AnimateDocumentSymbol, BiasInterpolator, BounceInterpolator, DeAccelInterpolator, FireCommandDocumentSymbol, FlickerInterpolator, GainInterpolator, HUDAnimationsEventDocumentSymbol, HUDAnimationsStatementDocumentSymbol, Interpolator, LinearInterpolator, PlaySoundDocumentSymbol, PulseInterpolator, RunEventChildDocumentSymbol, RunEventDocumentSymbol, SetInputEnabledDocumentSymbol, SetVisibleDocumentSymbol, SplineInterpolator, StopEventDocumentSymbol, StopPanelAnimationsDocumentSymbol } from "./HUDAnimationsDocumentSymbol"
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

			switch (token.type) {
				case VDFTokenType.String: {
					if (token.value.toLowerCase() == "event") {
						const eventStartPosition = token.range.start
						const eventName = tokeniser.next()
						if (eventName == null) {
							throw new EndOfStreamError(["'event'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
						}
						if (eventName.type == VDFTokenType.String) {
							const statements = parseEvent()
							const eventEndPosition = new VDFPosition(tokeniser.line, tokeniser.character)
							documentSymbols.push(new HUDAnimationsEventDocumentSymbol(eventName.value, eventName.range, new VDFRange(eventStartPosition, eventEndPosition), statements))
						}
						else {
							throw new UnexpectedTokenError(`'${token.value}'`, ["event name"], token.range)
						}
						break
					}
					else {
						throw new UnexpectedTokenError(`'${token.value}'`, ["'event'"], token.range)
					}
				}
				default:
					throw new UnexpectedTokenError(`'${token.value}'`, ["'event'"], token.range)
			}
		}

		return documentSymbols
	}

	function parseEvent(): HUDAnimationsStatementDocumentSymbols {
		const statements = new HUDAnimationsStatementDocumentSymbols()

		const token = tokeniser.next()
		if (token == null) {
			throw new EndOfStreamError(["'{'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}
		if (token.type != VDFTokenType.ControlCharacter || token.value != "{") {
			throw new UnexpectedTokenError(`'${token.value}'`, ["'{'"], token.range)
		}

		while (true) {
			const animationCommandToken = tokeniser.next()
			if (animationCommandToken == null) {
				throw new EndOfStreamError(["animation command", "'}'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}

			if (animationCommandToken.type == VDFTokenType.String) {
				statements.push(parseAnimation(animationCommandToken.value, animationCommandToken.range))
			}
			else if (animationCommandToken.type == VDFTokenType.ControlCharacter && animationCommandToken.value == "}") {
				break
			}
			else {
				throw new EndOfStreamError(["animation command", "'}'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}
		}

		return statements
	}

	function readString(): VDFToken {
		const token = tokeniser.next()
		if (token == null) {
			throw new EndOfStreamError(["string"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}
		if (token.type != VDFTokenType.String) {
			throw new UnexpectedTokenError(`'${token.value}'`, ["string"], token.range)
		}
		return token
	}

	function readStringValue(): string {
		return readString().value
	}

	function readNumber(): number {
		const token = readString()
		if (/[^\d.]/.test(token.value)) {
			throw new UnexpectedTokenError(`'${token.value}'`, ["number"], token.range)
		}
		return parseFloat(token.value)
	}

	function readBool(): string {

		const token = tokeniser.next()
		if (token == null) {
			throw new EndOfStreamError(["'0'", "'1'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
		}

		if (token.value != "0" && token.value != "1") {
			throw new UnexpectedTokenError(`'${token.value}'`, ["'0'", "'1'"], token.range)
		}

		return token.value
	}

	function readConditional(): string | undefined {
		try {
			const token = tokeniser.next(true)
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
				const property = readString()
				const valueToken = readString()
				statement = new AnimateDocumentSymbol(
					{
						element: elementToken.value,
						elementRange: elementToken.range,
						property: property.value,
						propertyRange: property.range,
						value: valueToken.value,
						valueRange: valueToken.range,
						interpolator: ((): Interpolator => {
							const interpolator = tokeniser.next()
							if (interpolator == null) {
								throw new EndOfStreamError(["string"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
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
				statement = new SetInputEnabledDocumentSymbol(
					{
						element: readStringValue(),
						visible: readStringValue(),
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
			default:
				throw new UnexpectedTokenError(`'${type}'`, ["string"], typeRange)
		}

		return statement
	}

	return parseFile()
}
