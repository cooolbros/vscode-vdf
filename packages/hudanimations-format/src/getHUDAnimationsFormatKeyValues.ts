import { Accel, Bias, Bounce, DeAccel, Flicker, Gain, HUDAnimationStatementType, Linear, Pulse, Spline } from "hudanimations-documentsymbols"
import { VDFTokeniser, VDFTokenType } from "vdf"
import type { Animate, Animation, FireCommand, FormatInterpolator, HUDAnimationsFormatKeyValue, PlaySound, RunEvent, RunEventChild, SetFont, SetInputEnabled, SetString, SetTexture, SetVisible, StopAnimation, StopEvent, StopPanelAnimations } from "./HUDAnimationsFormatKeyValues"

export function getHUDAnimationsFormatKeyValues(str: string): HUDAnimationsFormatKeyValue[] {

	const tokeniser = new VDFTokeniser(str)

	function parseFile(): HUDAnimationsFormatKeyValue[] {

		const keyValues: HUDAnimationsFormatKeyValue[] = []

		while (true) {
			const token = tokeniser.format()
			if (token == null) {
				break
			}

			const keyValue: HUDAnimationsFormatKeyValue = {}

			switch (token.type) {
				case VDFTokenType.String: {
					if (token.value != "event") {
						throw new Error(token.value)
					}

					const eventName = tokeniser.format()
					if (eventName == null) {
						throw new Error("eventName == null")
					}

					if (eventName.type != VDFTokenType.String) {
						throw new Error(eventName.type.toString())
					}

					let conditional: string | undefined
					while (true) {
						const conditionalToken = tokeniser.peek()
						if (conditionalToken == null) {
							conditional = undefined
							break
						}

						if (conditionalToken.type == VDFTokenType.NewLine) {
							tokeniser.next()
							continue
						}
						else if (conditionalToken.type == VDFTokenType.Conditional) {
							conditional = conditionalToken.value
							tokeniser.next()
							break
						}
						else {
							conditional = undefined
							break
						}
					}

					let comment: string | undefined
					while (true) {
						const commentToken = tokeniser.peek()
						if (commentToken == null) {
							comment = undefined
							break
						}

						if (commentToken.type == VDFTokenType.NewLine) {
							tokeniser.next()
							continue
						}
						else if (commentToken.type == VDFTokenType.Comment) {
							comment = commentToken.value
							tokeniser.next()
							break
						}
						else {
							comment = undefined
							break
						}
					}

					keyValue.event = {
						name: eventName.value,
						conditional: conditional,
						comment: comment,
						animations: parseEvent()
					}

					break
				}
				case VDFTokenType.OpeningBrace: {
					throw new Error(token.type.toString())
				}
				case VDFTokenType.ClosingBrace: {
					throw new Error(token.type.toString())
				}
				case VDFTokenType.Conditional: {
					throw new Error(token.type.toString())
				}
				case VDFTokenType.Comment: {
					keyValue.comment = token.value
					break
				}
			}

			keyValues.push(keyValue)
		}

		return keyValues
	}

	function parseEvent(): (Animation | { comment?: string })[] {

		const statements: (Animation | { comment?: string })[] = []

		const token = tokeniser.token()
		if (token == null) {
			throw new Error("token == null")
		}

		if (token.type != VDFTokenType.OpeningBrace) {
			throw new Error(`${token.type} != VDFTokenType.OpeningBrace`)
		}

		loop:
		while (true) {
			let animationCommandToken = tokeniser.next()
			while (true) {
				if (animationCommandToken == null) {
					throw new Error("animationCommandToken == null")
				}

				if (animationCommandToken.type != VDFTokenType.NewLine) {
					break
				}

				animationCommandToken = tokeniser.next()
			}

			switch (animationCommandToken.type) {
				case VDFTokenType.String: {
					statements.push(parseAnimation(animationCommandToken.value))
					break
				}
				case VDFTokenType.Comment: {
					statements.push({ comment: animationCommandToken.value })
					break
				}
				case VDFTokenType.ClosingBrace: {
					break loop
				}
				default:
					throw new Error(`default: ${animationCommandToken.value}`)
			}
		}

		return statements
	}

	function readString() {
		const token = tokeniser.token()
		if (token == null) {
			throw new Error("token == null")
		}
		if (token.type != VDFTokenType.String) {
			throw new Error("token.type != VDFTokenType.String")
		}
		return token
	}

	function readStringValue(): string {
		return readString().value
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
				statement = {
					type: HUDAnimationStatementType.Animate,
					element: readStringValue(),
					property: readStringValue(),
					value: readStringValue(),
					interpolator: ((): FormatInterpolator => {
						switch (readStringValue().toLowerCase()) {
							case "accel": return <Accel>{ type: "Accel" }
							case "bias": return <Bias>{ type: "Bias", bias: readStringValue() }
							case "bounce": return <Bounce>{ type: "Bounce" }
							case "deaccel": return <DeAccel>{ type: "DeAccel" }
							case "flicker": return <Flicker>{ type: "Flicker", randomness: readStringValue() }
							case "gain": return <Gain>{ type: "Gain", bias: readStringValue() }
							case "linear": return <Linear>{ type: "Linear" }
							case "pulse": return <Pulse>{ type: "Pulse", frequency: readStringValue() }
							case "spline": return <Spline>{ type: "Spline" }
							default: throw new Error("")
						}
					})(),
					delay: readNumberValue(),
					duration: readNumberValue(),
				} satisfies Animate
				break
			}
			case "runevent": {
				statement = {
					type: HUDAnimationStatementType.RunEvent,
					event: readStringValue(),
					delay: readNumberValue()
				} satisfies RunEvent
				break
			}
			case "stopevent": {
				statement = {
					type: HUDAnimationStatementType.StopEvent,
					event: readStringValue(),
					delay: readNumberValue()
				} satisfies StopEvent
				break
			}
			case "setvisible": {
				statement = {
					type: HUDAnimationStatementType.SetVisible,
					element: readStringValue(),
					visible: readStringValue(),
					delay: readNumberValue(),
				} satisfies SetVisible
				break
			}
			case "firecommand": {
				statement = {
					type: HUDAnimationStatementType.FireCommand,
					delay: readNumberValue(),
					command: readStringValue()
				} satisfies FireCommand
				break
			}
			case "runeventchild": {
				statement = {
					type: HUDAnimationStatementType.RunEventChild,
					element: readStringValue(),
					event: readStringValue(),
					delay: readNumberValue()
				} satisfies RunEventChild
				break
			}
			case "setinputenabled": {
				statement = {
					type: HUDAnimationStatementType.SetInputEnabled,
					element: readStringValue(),
					enabled: readStringValue(),
					delay: readStringValue(),
				} satisfies SetInputEnabled
				break
			}
			case "playsound": {
				statement = {
					type: HUDAnimationStatementType.PlaySound,
					delay: readStringValue(),
					sound: readStringValue(),
				} satisfies PlaySound
				break
			}
			case "stoppanelanimations": {
				statement = {
					type: HUDAnimationStatementType.StopPanelAnimations,
					element: readStringValue(),
					delay: readStringValue(),
				} satisfies StopPanelAnimations
				break
			}
			case "stopanimation": {
				statement = {
					type: HUDAnimationStatementType.StopAnimation,
					element: readStringValue(),
					property: readStringValue(),
					delay: readStringValue(),
				} satisfies StopAnimation
				break
			}
			case "setfont": {
				statement = {
					type: HUDAnimationStatementType.SetFont,
					element: readStringValue(),
					property: readStringValue(),
					value: readStringValue(),
					delay: readNumberValue(),
				} satisfies SetFont
				break
			}
			case "settexture": {
				statement = {
					type: HUDAnimationStatementType.SetTexture,
					element: readStringValue(),
					property: readStringValue(),
					value: readStringValue(),
					delay: readNumberValue(),
				} satisfies SetTexture
				break
			}
			case "setstring": {
				statement = {
					type: HUDAnimationStatementType.SetString,
					element: readStringValue(),
					property: readStringValue(),
					value: readStringValue(),
					delay: readNumberValue(),
				} satisfies SetString
				break
			}
			default: {
				throw new Error(type)
			}
		}

		let nextToken = tokeniser.peek()
		if (nextToken != null) {
			if (nextToken.type == VDFTokenType.Conditional) {
				statement.conditional = nextToken.value
				tokeniser.next()

				nextToken = tokeniser.peek()
				if (nextToken?.type == VDFTokenType.Comment) {
					statement.comment = nextToken.value
					tokeniser.next()
				}
			}
			else if (nextToken.type == VDFTokenType.Comment) {
				statement.comment = nextToken.value
				tokeniser.next()
			}
		}

		return statement
	}

	return parseFile()
}
