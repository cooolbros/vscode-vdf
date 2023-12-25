import { AccelInterpolator, BiasInterpolator, BounceInterpolator, DeAccelInterpolator, FlickerInterpolator, GainInterpolator, HUDAnimationStatementType, LinearInterpolator, PulseInterpolator, SplineInterpolator } from "lib/HUDAnimationsDocumentSymbols/HUDAnimationsDocumentSymbol"
import { VDFFormatToken, VDFFormatTokeniser, VDFFormatTokenType } from "lib/VDFFormat/VDFFormatTokeniser"
import type { Animate, Animation, FireCommand, FormatInterpolator, HUDAnimationsFormatDocumentSymbol, PlaySound, RunEvent, RunEventChild, SetInputEnabled, SetVisible, StopAnimation, StopEvent, StopPanelAnimations } from "./HUDAnimationsFormatDocumentSymbol"

export function getHUDAnimationsFormatDocumentSymbols(str: string): HUDAnimationsFormatDocumentSymbol[] {

	const tokeniser = new VDFFormatTokeniser(str)

	function parseFile(): HUDAnimationsFormatDocumentSymbol[] {

		const documentSymbols: HUDAnimationsFormatDocumentSymbol[] = []

		while (true) {
			const token = tokeniser.next(false, true)
			if (token == null) {
				break
			}

			const documentSymbol: HUDAnimationsFormatDocumentSymbol = {}

			switch (token.type) {
				case VDFFormatTokenType.Comment: {
					documentSymbol.comment = token.value
					break
				}
				case VDFFormatTokenType.String: {
					if (token.value != "event") {
						throw new Error(token.type.toString())
					}

					const eventName = tokeniser.next(false, true)
					if (eventName == null) {
						throw new Error("eventName == null")
					}

					if (eventName.type != VDFFormatTokenType.String) {
						throw new Error(eventName.type.toString())
					}

					let conditional: string | undefined
					const conditionalToken = tokeniser.next(true, true)
					if (conditionalToken?.type == VDFFormatTokenType.Conditional) {
						conditional = conditionalToken.value
						tokeniser.next(false, true)
					}
					else {
						conditional = undefined
					}

					let comment: string | undefined
					const nextToken = tokeniser.next(true, true)
					if (nextToken?.type == VDFFormatTokenType.Comment) {
						comment = nextToken.value
						tokeniser.next(false, true)
					}
					else {
						comment = undefined
					}

					documentSymbol.event = {
						name: eventName.value,
						conditional: conditional,
						comment: comment,
						animations: parseEvent()
					}

					break
				}
				case VDFFormatTokenType.NewLine:
				case VDFFormatTokenType.ControlCharacter:
				case VDFFormatTokenType.Conditional: {
					throw new Error(token.type.toString())
				}
			}

			documentSymbols.push(documentSymbol)
		}

		return documentSymbols
	}

	function parseEvent(): (Animation | { comment?: string })[] {

		const statements: (Animation | { comment?: string })[] = []

		const token = tokeniser.next(false, true)
		if (token == null) {
			throw new Error("token == null")
		}

		if (token.type != VDFFormatTokenType.ControlCharacter || token.value != "{") {
			throw new Error(`${token.type} != VDFFormatTokenType.ControlCharacter || token.value != "{"`)
		}

		loop:
		while (true) {
			const animationCommandToken = tokeniser.next(false, true)
			if (animationCommandToken == null) {
				throw new Error("animationCommandToken == null")
			}

			switch (animationCommandToken.type) {
				case VDFFormatTokenType.String: {
					statements.push(parseAnimation(animationCommandToken.value))
					break
				}
				case VDFFormatTokenType.Comment: {
					statements.push({ comment: animationCommandToken.value })
					break
				}
				case VDFFormatTokenType.ControlCharacter: {
					if (animationCommandToken.value != "}") {
						throw new Error("animationCommandToken.value != \"}\"")
					}
					break loop
				}
				default:
					throw new Error(`default: ${animationCommandToken.value}`)
			}
		}

		return statements
	}

	function readString(peek = false, skipNewlines = false): VDFFormatToken {
		const token = tokeniser.next(peek, skipNewlines)
		if (token == null) {
			throw new Error("token == null")
		}
		if (token.type != VDFFormatTokenType.String) {
			throw new Error("token.type != VDFFormatTokenType.String")
		}
		return token
	}

	function readStringValue(): string {
		return readString(false, true).value
	}

	function readNumberValue(): string {
		const value = readStringValue()
		if (isNaN(parseFloat(value))) {
			throw new Error("isNaN(parseFloat(value))")
		}
		return value
	}

	function parseAnimation(type: string): Animation {

		let statement: Animation

		switch (type.toLowerCase()) {
			case "animate": {
				statement = <Animate>{
					type: HUDAnimationStatementType.Animate,
					element: readStringValue(),
					property: readStringValue(),
					value: readStringValue(),
					interpolator: ((): FormatInterpolator => {
						switch (readStringValue().toLowerCase()) {
							case "accel": return <AccelInterpolator>{ type: "Accel" }
							case "bias": return <BiasInterpolator>{ type: "Bias", bias: readStringValue() }
							case "bounce": return <BounceInterpolator>{ type: "Bounce" }
							case "deaccel": return <DeAccelInterpolator>{ type: "DeAccel" }
							case "flicker": return <FlickerInterpolator>{ type: "Flicker", randomness: readStringValue() }
							case "gain": return <GainInterpolator>{ type: "Gain", bias: readStringValue() }
							case "linear": return <LinearInterpolator>{ type: "Linear" }
							case "pulse": return <PulseInterpolator>{ type: "Pulse", frequency: readStringValue() }
							case "spline": return <SplineInterpolator>{ type: "Spline" }
							default: throw new Error("interpolator")
						}
					})(),
					delay: readNumberValue(),
					duration: readNumberValue(),
				}
				break
			}
			case "runevent": {
				statement = <RunEvent>{
					type: HUDAnimationStatementType.RunEvent,
					event: readStringValue(),
					delay: readNumberValue()
				}
				break
			}
			case "stopevent": {
				statement = <StopEvent>{
					type: HUDAnimationStatementType.StopEvent,
					event: readStringValue(),
					delay: readNumberValue()
				}
				break
			}
			case "setvisible": {
				statement = <SetVisible>{
					type: HUDAnimationStatementType.SetVisible,
					element: readStringValue(),
					visible: readStringValue(),
					delay: readNumberValue(),
				}
				break
			}
			case "firecommand": {
				statement = <FireCommand>{
					type: HUDAnimationStatementType.FireCommand,
					delay: readNumberValue(),
					command: readStringValue()
				}
				break
			}
			case "runeventchild": {
				statement = <RunEventChild>{
					type: HUDAnimationStatementType.RunEventChild,
					element: readStringValue(),
					event: readStringValue(),
					delay: readNumberValue()
				}
				break
			}
			case "setinputenabled": {
				statement = <SetInputEnabled>{
					type: HUDAnimationStatementType.SetInputEnabled,
					element: readStringValue(),
					enabled: readStringValue(),
					delay: readStringValue(),
				}
				break
			}
			case "playsound": {
				statement = <PlaySound>{
					type: HUDAnimationStatementType.PlaySound,
					delay: readStringValue(),
					sound: readStringValue(),
				}
				break
			}
			case "stoppanelanimations": {
				statement = <StopPanelAnimations>{
					type: HUDAnimationStatementType.StopPanelAnimations,
					element: readStringValue(),
					delay: readStringValue(),
				}
				break
			}
			case "stopanimation": {
				statement = <StopAnimation>{
					type: HUDAnimationStatementType.StopAnimation,
					element: readStringValue(),
					property: readStringValue(),
					delay: readStringValue(),
				}
				break
			}
			default: {
				throw new Error(type)
			}
		}

		let nextToken = tokeniser.next(true, false)
		if (nextToken == null) {
			return statement
		}

		if (nextToken.type == VDFFormatTokenType.Conditional) {
			statement.conditional = nextToken.value
			tokeniser.next(false, false)

			// Comment
			nextToken = tokeniser.next(true, false)
			if (nextToken == null) {
				return statement
			}

			if (nextToken.type == VDFFormatTokenType.Comment) {
				statement.comment = nextToken.value
			}
		}
		else if (nextToken.type == VDFFormatTokenType.Comment) {
			statement.comment = nextToken.value
			tokeniser.next(false, false)
		}

		return statement
	}

	return parseFile()
}
