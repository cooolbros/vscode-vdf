import { DocumentSymbol } from "vscode-languageserver"
import { Position, Range, SymbolKind } from "vscode-languageserver-types"
import { VDFTokeniserOptions } from "../../VDF/dist/models/VDFTokeniserOptions"
import { parserTools } from "../../VDF/dist/VDFParserTools"
import { VDFTokeniser } from "../../VDF/dist/VDFTokeniser"
import { Command, Commands, File, HUDAnimation, HUDAnimationTypes } from "./hudanimations"
import { HUDAnimationsSyntaxError } from "./HUDAnimationsErrors"
import { HUDAnimationsValidation } from "./validation"

export interface HUDAnimationEventDocumentSymbol extends DocumentSymbol {
	nameRange: Range
	animations: HUDAnimationStatementDocumentSymbol[]
}

export interface HUDAnimationStatementDocumentSymbol {
	animation: HUDAnimation<Command>

	/**
	 * Range covering the animation command e.g. `Animate`
	 */
	commandRange: Range

	/**
	 * Range covering the referenced element e.g. `Aniamte "SomeElement" FgColor Red`
	 */
	elementRange?: Range

	// Animate (References)
	// elementRange?: Range
	valueRange?: Range

	// RunEvent | StopEvent | RunEventChild

	/**
	 * Range covering the referenced event e.g. `RunEvent "SomeEvent" 0`
	 */
	eventRange?: Range
}

export function getHUDAnimationsDocumentInfo(str: string, options?: VDFTokeniserOptions): { animations: File, symbols: HUDAnimationEventDocumentSymbol[] } {

	const result: ReturnType<typeof getHUDAnimationsDocumentInfo> = {
		animations: {},
		symbols: []
	}

	const tokeniser = new VDFTokeniser(str, options)

	let currentToken = tokeniser.next().toLowerCase()

	let eventStartPosition = Position.create(tokeniser.line, tokeniser.character)

	while (currentToken != "__EOF__") {

		if (VDFTokeniser.whiteSpaceTokenTerminate.includes(currentToken)) {
			throw new HUDAnimationsSyntaxError(currentToken, tokeniser, "Expected \"event\"")
		}

		currentToken = parserTools.convert.token(currentToken)[0]

		if (currentToken.toLowerCase() != "event") {
			throw new HUDAnimationsSyntaxError(currentToken, tokeniser, "Expected \"event\"")
		}

		const eventNameToken = tokeniser.next()
		if (eventNameToken == "{") {
			throw new HUDAnimationsSyntaxError(eventNameToken, tokeniser, "Expected event name")
		}

		const [eventName, eventNameQuoted] = parserTools.convert.token(eventNameToken)

		const eventNameRange = Range.create(Position.create(tokeniser.line, tokeniser.character - eventName.length), Position.create(tokeniser.line, tokeniser.character))

		result.animations[eventName] = []
		const eventAnimations: HUDAnimationStatementDocumentSymbol[] = []

		let openingBrace = tokeniser.next()
		if (openingBrace != "{") {
			throw new HUDAnimationsSyntaxError(openingBrace, tokeniser, "Are you missing an opening brace?")
		}

		let animationCommand: string = tokeniser.next()

		while (animationCommand != "}") {
			const commandRange = Range.create(Position.create(tokeniser.line, tokeniser.character - animationCommand.length), Position.create(tokeniser.line, tokeniser.character))
			switch (HUDAnimationsValidation.validateAnimationCommand(parserTools.convert.token(animationCommand), tokeniser)) {
				case "Animate": {
					// Element
					const [element, elementQuoted] = parserTools.convert.token(tokeniser.next())
					const elementRange = Range.create(tokeniser.line, tokeniser.character - element.length - elementQuoted, tokeniser.line, tokeniser.character - elementQuoted)

					// Property
					const property = parserTools.convert.token(tokeniser.next())[0]

					// Value
					const [value, valueQuoted] = parserTools.convert.token(tokeniser.next())
					const valueRange = Range.create(tokeniser.line, tokeniser.character - element.length - valueQuoted, tokeniser.line, tokeniser.character - valueQuoted)

					const interpolator = HUDAnimationsValidation.validateInterpolator(parserTools.convert.token(tokeniser.next()), tokeniser)

					const frequency = interpolator == "Pulse" ? HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser) : null
					const bias = (interpolator == "Gain" || interpolator == "Bias") ? HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser) : null

					const delay = HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser)
					const duration = HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser)

					let osTag: `[${string}]` | undefined
					if (parserTools.is.osTag(tokeniser.next(true))) {
						osTag = parserTools.convert.osTag(tokeniser.next())
					}

					const animation: HUDAnimationTypes["Animate"] = {
						type: "Animate",
						element: element,
						property: property,
						value: value,
						interpolator: interpolator,
						...(frequency != null && { frequency: frequency }),
						...(bias != null && { bias: bias }),
						delay: delay,
						duration: duration,
						osTag: osTag
					}
					result.animations[eventName].push(animation)
					eventAnimations.push({
						commandRange: commandRange,
						elementRange: elementRange,
						valueRange: valueRange,
						animation: animation
					})
					break
				}
				case "RunEvent": {
					const [referencedEventName, referencedEventNameTokenQuoted] = parserTools.convert.token(tokeniser.next())
					const eventRange = Range.create(
						Position.create(tokeniser.line, tokeniser.character - referencedEventName.length - referencedEventNameTokenQuoted),
						Position.create(tokeniser.line, tokeniser.character - referencedEventNameTokenQuoted)
					)
					const runEvent: HUDAnimationTypes["RunEvent"] = {
						type: "RunEvent",
						event: referencedEventName,
						delay: HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(runEvent)
					eventAnimations.push({
						commandRange: commandRange,
						eventRange: eventRange,
						animation: runEvent
					})
					break
				}
				case "StopEvent": {
					const [referencedEventName, referencedEventNameTokenQuoted] = parserTools.convert.token(tokeniser.next())
					const eventRange = Range.create(
						Position.create(tokeniser.line, tokeniser.character - referencedEventName.length - referencedEventNameTokenQuoted),
						Position.create(tokeniser.line, tokeniser.character - referencedEventNameTokenQuoted)
					)
					const stopEvent: HUDAnimationTypes["StopEvent"] = {
						type: "StopEvent",
						event: referencedEventName,
						delay: HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(stopEvent)
					eventAnimations.push({
						commandRange: commandRange,
						eventRange: eventRange,
						animation: stopEvent
					})
					break
				}
				case "SetVisible": {

					const [element, elementQuoted] = parserTools.convert.token(tokeniser.next())
					const elementRange = Range.create(tokeniser.line, tokeniser.character - element.length - elementQuoted, tokeniser.line, tokeniser.character - elementQuoted)

					const setVisible: HUDAnimationTypes["SetVisible"] = {
						type: "SetVisible",
						element: element,
						visible: HUDAnimationsValidation.validateBit(parserTools.convert.token(tokeniser.next()), tokeniser),
						delay: HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(setVisible)
					eventAnimations.push({
						commandRange: commandRange,
						elementRange: elementRange,
						animation: setVisible
					})
					break
				}
				case "FireCommand": {
					const fireCommand: HUDAnimationTypes["FireCommand"] = {
						type: "FireCommand",
						delay: HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser),
						command: parserTools.convert.token(tokeniser.next())[0],
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(fireCommand)
					eventAnimations.push({
						commandRange: commandRange,
						animation: fireCommand
					})
					break
				}
				case "RunEventChild": {
					const [element, elementQuoted] = parserTools.convert.token(tokeniser.next())
					const elementRange = Range.create(tokeniser.line, tokeniser.character - element.length - elementQuoted, tokeniser.line, tokeniser.character - elementQuoted)

					const referencedEventName = tokeniser.next()
					const eventRange = Range.create(
						Position.create(tokeniser.line, tokeniser.character - referencedEventName.length),
						Position.create(tokeniser.line, tokeniser.character)
					)

					const runEventChild: HUDAnimationTypes["RunEventChild"] = {
						type: "RunEventChild",
						element: element,
						event: referencedEventName,
						delay: HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(runEventChild)
					eventAnimations.push({
						commandRange: commandRange,
						elementRange: elementRange,
						eventRange: eventRange,
						animation: runEventChild
					})
					break
				}
				case "SetInputEnabled": {
					const [element, elementQuoted] = parserTools.convert.token(tokeniser.next())
					const elementRange = Range.create(tokeniser.line, tokeniser.character - element.length - elementQuoted, tokeniser.line, tokeniser.character - elementQuoted)

					const setInputEnabled: HUDAnimationTypes["SetInputEnabled"] = {
						type: "SetInputEnabled",
						element: element,
						visible: HUDAnimationsValidation.validateBit(parserTools.convert.token(tokeniser.next()), tokeniser),
						delay: HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(setInputEnabled)
					eventAnimations.push({
						commandRange: commandRange,
						elementRange: elementRange,
						animation: setInputEnabled
					})
					break
				}
				case "PlaySound": {
					const playSound: HUDAnimationTypes["PlaySound"] = {
						type: "PlaySound",
						delay: HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser),
						sound: parserTools.convert.token(tokeniser.next())[0],
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(playSound)
					eventAnimations.push({
						commandRange: commandRange,
						animation: playSound
					})
					break
				}
				case "StopPanelAnimations": {

					const [element, elementQuoted] = parserTools.convert.token(tokeniser.next())
					const elementRange = Range.create(tokeniser.line, tokeniser.character - element.length - elementQuoted, tokeniser.line, tokeniser.character - elementQuoted)

					const stopPanelAnimations: HUDAnimationTypes["StopPanelAnimations"] = {
						type: "StopPanelAnimations",
						element: element,
						delay: HUDAnimationsValidation.validateNaN(parserTools.convert.token(tokeniser.next()), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(stopPanelAnimations)
					eventAnimations.push({
						commandRange: commandRange,
						elementRange: elementRange,
						animation: stopPanelAnimations
					})
					break
				}
				default: {
					throw new HUDAnimationsSyntaxError(animationCommand, tokeniser, `Expected "${Commands.join(`" | "`)}"`)
				}
			}

			animationCommand = tokeniser.next()
		}

		const eventEndPosition = Position.create(tokeniser.line, tokeniser.character)

		result.symbols.push({
			name: eventName,
			nameRange: eventNameRange,
			range: Range.create(eventStartPosition, eventEndPosition),
			selectionRange: Range.create(eventStartPosition, eventEndPosition),
			kind: SymbolKind.Event,
			// kind: SymbolKind.Function,
			animations: eventAnimations
		})

		currentToken = tokeniser.next()
		eventStartPosition = Position.create(tokeniser.line, tokeniser.character - "event".length)
	}

	return result
}
