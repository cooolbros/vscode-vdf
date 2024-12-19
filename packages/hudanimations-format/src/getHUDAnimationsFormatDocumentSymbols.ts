import { AccelInterpolator, BiasInterpolator, BounceInterpolator, DeAccelInterpolator, FlickerInterpolator, GainInterpolator, HUDAnimationStatementType, LinearInterpolator, PulseInterpolator, SplineInterpolator } from "hudanimations-documentsymbols"
import { VDFFormatTokenType, VDFFormatTokeniser, type VDFFormatToken } from "vdf-format"
import type { Animate, Animation, FireCommand, FormatInterpolator, HUDAnimationsFormatDocumentSymbol, PlaySound, RunEvent, RunEventChild, SetFont, SetInputEnabled, SetString, SetTexture, SetVisible, StopAnimation, StopEvent, StopPanelAnimations } from "./HUDAnimationsFormatDocumentSymbol"

export function getHUDAnimationsFormatDocumentSymbols(str: string): HUDAnimationsFormatDocumentSymbol[] {

	const tokeniser = new VDFFormatTokeniser(str)

	function parseFile(): HUDAnimationsFormatDocumentSymbol[] {

		const documentSymbols: HUDAnimationsFormatDocumentSymbol[] = []

		while (true) {
			const token = tokeniser.next({ skipNewlines: true })
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

					const eventName = tokeniser.next({ skipNewlines: true })
					if (eventName == null) {
						throw new Error("eventName == null")
					}

					if (eventName.type != VDFFormatTokenType.String) {
						throw new Error(eventName.type.toString())
					}

					let conditional: string | undefined
					const conditionalToken = tokeniser.next({ skipNewlines: true, peek: true })
					if (conditionalToken?.type == VDFFormatTokenType.Conditional) {
						conditional = conditionalToken.value
						tokeniser.next({ skipNewlines: true })
					}
					else {
						conditional = undefined
					}

					let comment: string | undefined
					const nextToken = tokeniser.next({ skipNewlines: true, peek: true })
					if (nextToken?.type == VDFFormatTokenType.Comment) {
						comment = nextToken.value
						tokeniser.next({ skipNewlines: true })
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

		const token = tokeniser.next({ skipNewlines: true })
		if (token == null) {
			throw new Error("token == null")
		}

		if (token.type != VDFFormatTokenType.ControlCharacter || token.value != "{") {
			throw new Error(`${token.type} != VDFFormatTokenType.ControlCharacter || token.value != "{"`)
		}

		loop:
		while (true) {
			const animationCommandToken = tokeniser.next({ skipNewlines: true })
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

	function readString(skipNewlines = false, peek = false): VDFFormatToken {
		const token = tokeniser.next({ skipNewlines, peek })
		if (token == null) {
			throw new Error("token == null")
		}
		if (token.type != VDFFormatTokenType.String) {
			throw new Error("token.type != VDFFormatTokenType.String")
		}
		return token
	}

	function readStringValue(): string {
		return readString(true, false).value
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
			case "setfont": {
				statement = <SetFont>{
					type: HUDAnimationStatementType.SetFont,
					element: readStringValue(),
					property: readStringValue(),
					value: readStringValue(),
					delay: readNumberValue(),
				}
				break
			}
			case "settexture": {
				statement = <SetTexture>{
					type: HUDAnimationStatementType.SetTexture,
					element: readStringValue(),
					property: readStringValue(),
					value: readStringValue(),
					delay: readNumberValue(),
				}
				break
			}
			case "setstring": {
				statement = <SetString>{
					type: HUDAnimationStatementType.SetString,
					element: readStringValue(),
					property: readStringValue(),
					value: readStringValue(),
					delay: readNumberValue(),
				}
				break
			}
			default: {
				throw new Error(type)
			}
		}

		let nextToken = tokeniser.next({ skipNewlines: false, peek: true })
		if (nextToken == null) {
			return statement
		}

		if (nextToken.type == VDFFormatTokenType.Conditional) {
			statement.conditional = nextToken.value
			tokeniser.next({ skipNewlines: false })

			// Comment
			nextToken = tokeniser.next({ skipNewlines: false })
			if (nextToken == null) {
				return statement
			}

			if (nextToken.type == VDFFormatTokenType.Comment) {
				statement.comment = nextToken.value
			}
		}
		else if (nextToken.type == VDFFormatTokenType.Comment) {
			statement.comment = nextToken.value
			tokeniser.next({ skipNewlines: false })
		}

		return statement
	}

	return parseFile()
}
