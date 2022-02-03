// HUD Animations

import { _Connection } from "vscode-languageserver";
import { DocumentSymbol, Position, Range, SymbolKind } from "vscode-languageserver-types";
import { VDFTokeniserOptions } from "../../VDF/dist/models/VDFTokeniserOptions";
import { VDFSyntaxError } from "../../VDF/dist/VDFErrors";
import { parserTools } from "../../VDF/dist/VDFParserTools";
import { VDFTokeniser } from "../../VDF/dist/VDFTokeniser";

export type File = Record<string, Event>
export type Event = HUDAnimation<Command>[]

const CommandKeys = <const>["Animate", "RunEvent", "StopEvent", "SetVisible", "FireCommand", "RunEventChild", "SetInputEnabled", "PlaySound", "StopPanelAnimations"]
export type Command = typeof CommandKeys[number]
export type CommandTypes = {
	"Animate": HUDAnimations.Animate
	"RunEvent": HUDAnimations.RunEvent
	"StopEvent": HUDAnimations.StopEvent
	"SetVisible": HUDAnimations.SetVisible
	"FireCommand": HUDAnimations.FireCommand
	"RunEventChild": HUDAnimations.RunEventChild
	"SetInputEnabled": HUDAnimations.SetInputEnabled
	"PlaySound": HUDAnimations.PlaySound
	"StopPanelAnimations": HUDAnimations.StopPanelAnimations
}

const Interpolators = <const>["Linear", "Accel", "Deaccel", "Spline", "Pulse", "Flicker", "Gain", "Bias", "Bounce"]
export type Interpolator = typeof Interpolators[number]
type Bit = 0 | 1

export interface HUDAnimation<T extends Command> {
	readonly type: T
	osTag?: `[${string}]`
}

export namespace HUDAnimations {
	export interface Animate extends HUDAnimation<"Animate"> {
		element: string
		property: string
		value: string
		interpolator: Interpolator
		frequency?: number
		bias?: number
		delay: number
		duration: number
	}
	export interface RunEvent extends HUDAnimation<"RunEvent"> {
		event: string
		delay: number
	}
	export interface StopEvent extends HUDAnimation<"StopEvent"> {
		event: string
		delay: number
	}
	export interface SetVisible extends HUDAnimation<"SetVisible"> {
		element: string
		visible: Bit
		delay: number
	}
	export interface FireCommand extends HUDAnimation<"FireCommand"> {
		delay: number
		command: string
	}
	export interface RunEventChild extends HUDAnimation<"RunEventChild"> {
		element: string
		event: string
		delay: number
	}
	export interface SetInputEnabled extends HUDAnimation<"SetInputEnabled"> {
		element: string
		visible: Bit
		delay: number
	}
	export interface PlaySound extends HUDAnimation<"PlaySound"> {
		delay: number
		sound: string
	}
	export interface StopPanelAnimations extends HUDAnimation<"StopPanelAnimations"> {
		element: string
		delay: number
	}
}

export function isHUDAnimationCommand(animationType: string): animationType is Command {
	animationType = animationType.toLocaleLowerCase()
	for (const p of CommandKeys) {
		if (p.toLocaleLowerCase() == animationType) {
			return true
		}
	}
	return false
}

export function animationisType<T extends Command>(animation: HUDAnimation<Command>, animationType: T): animation is CommandTypes[T] {
	return animation.type == animationType
}

export class HUDAnimationsSyntaxError extends VDFSyntaxError {
	constructor(unExpectedToken: string, position: { position: number, line: number, character: number }, message?: string) {
		super(`Unexpected "${unExpectedToken}" at position ${position.position} (line ${position.line}, character ${position.character})!${message ? ` ${message}` : ""}`, Range.create(Position.create(position.line, position.character - unExpectedToken.length), Position.create(position.line, position.character)))
	}
}

export interface HUDAnimationsStringifyOptions {
	readonly layoutScope: "event" | "file"
	readonly extraTabs: number
}

export class HUDAnimations {
	static parse(str: string): File {
		const tokeniser: VDFTokeniser = new VDFTokeniser(str)
		const parseFile = (): File => {
			const events: File = {}
			let currentToken: string = tokeniser.next();
			if (currentToken != "event") {
				throw new HUDAnimationsSyntaxError(currentToken, tokeniser, `Expected "event"`)
			}
			while (currentToken.toLowerCase() == "event") {
				const eventName = tokeniser.next();
				if (eventName == "{") {
					throw new HUDAnimationsSyntaxError(eventName, tokeniser, "Expected event name")
				}
				events[eventName] = parseEvent();
				currentToken = tokeniser.next();
			}
			return events;
		}

		const parseEvent = (): Event => {

			const animations: Event = []
			let nextToken: string = tokeniser.next();

			if (nextToken == "{") {
				while (nextToken != "}") {
					// NextToken is not a closing brace therefore it is the animation type.
					// Pass the animation type to the animation.
					nextToken = tokeniser.next();
					if (nextToken != "}") {
						animations.push(parseAnimation(nextToken));
					}

					if (nextToken == "EOF") {
						throw new HUDAnimationsSyntaxError("EOF", tokeniser, "Are you missing a close brace?")
					}
				}
			}
			else {
				throw new HUDAnimationsSyntaxError(nextToken, tokeniser, "Are you missing an opening brace?")
			}

			return animations
		}

		const getInterpolator = (interpolator: string): { interpolator: Interpolator, frequency?: number, bias?: number } => {
			interpolator = interpolator.toLowerCase()
			if (interpolator == "pulse") return { interpolator: "Pulse", frequency: parseFloat(tokeniser.next()) }
			if (interpolator == "gain" || interpolator == "bias") return { interpolator: interpolator == "gain" ? "Gain" : "Bias", bias: parseFloat(tokeniser.next()) }
			return { interpolator: Interpolators.find(i => i.toLowerCase() == interpolator) ?? "Linear" }
		}

		const parseAnimation = (animationType: string): HUDAnimation<Command> => {
			if (isHUDAnimationCommand(animationType)) {
				switch (animationType.toLocaleLowerCase()) {
					case "animate":
						const animate: HUDAnimations.Animate = {
							type: "Animate",
							element: tokeniser.next(),
							property: tokeniser.next(),
							value: tokeniser.next(),
							...getInterpolator(tokeniser.next()),
							delay: parseFloat(tokeniser.next()),
							duration: parseFloat(tokeniser.next()),
							...(parserTools.is.osTag(tokeniser.next(true)) && {
								osTag: parserTools.convert.osTag(tokeniser.next())
							})
						}
						return animate
					case "runevent":
						const runEvent: HUDAnimations.RunEvent = {
							type: "RunEvent",
							event: tokeniser.next(),
							delay: parseFloat(tokeniser.next()),
							...(parserTools.is.osTag(tokeniser.next(true)) && {
								osTag: parserTools.convert.osTag(tokeniser.next())
							})
						}
						return runEvent
					case "stopevent":
						const stopEvent: HUDAnimations.StopEvent = {
							type: "StopEvent",
							event: tokeniser.next(),
							// referencePosition: {
							// 	line: tokeniser.line,
							// 	character: tokeniser.character
							// },
							delay: parseFloat(tokeniser.next()),
							...(parserTools.is.osTag(tokeniser.next(true)) && {
								osTag: parserTools.convert.osTag(tokeniser.next())
							})
						}
						return stopEvent
					case "setvisible":
						const setVisible: HUDAnimations.SetVisible = {
							type: "SetVisible",
							element: tokeniser.next(),
							visible: tokeniser.next() == "1" ? 1 : 0,
							delay: parseFloat(tokeniser.next()),
							...(parserTools.is.osTag(tokeniser.next(true)) && {
								osTag: parserTools.convert.osTag(tokeniser.next())
							})
						}
						return setVisible
					case "firecommand":
						const fireCommand: HUDAnimations.FireCommand = {
							type: "FireCommand",
							delay: parseFloat(tokeniser.next()),
							command: tokeniser.next(),
							...(parserTools.is.osTag(tokeniser.next(true)) && {
								osTag: parserTools.convert.osTag(tokeniser.next())
							})
						}
						return fireCommand
					case "runeventchild":
						const runEventChild: HUDAnimations.RunEventChild = {
							type: "RunEventChild",
							element: tokeniser.next(),
							event: tokeniser.next(),
							// referencePosition: {
							// 	line: tokeniser.line,
							// 	character: tokeniser.character
							// },
							delay: parseFloat(tokeniser.next()),
							...(parserTools.is.osTag(tokeniser.next(true)) && {
								osTag: parserTools.convert.osTag(tokeniser.next())
							})
						}
						return runEventChild
					case "setinputenabled":
						const setInputEnabled: HUDAnimations.SetInputEnabled = {
							type: "SetInputEnabled",
							element: tokeniser.next(),
							visible: tokeniser.next() == "1" ? 1 : 0,
							delay: parseFloat(tokeniser.next()),
							...(parserTools.is.osTag(tokeniser.next(true)) && {
								osTag: parserTools.convert.osTag(tokeniser.next())
							})
						}
						return setInputEnabled
					case "playsound":
						const playSound: HUDAnimations.PlaySound = {
							type: "PlaySound",
							delay: parseFloat(tokeniser.next()),
							sound: tokeniser.next(),
							...(parserTools.is.osTag(tokeniser.next(true)) && {
								osTag: parserTools.convert.osTag(tokeniser.next())
							})
						}
						return playSound
					case "stoppanelanimations":
						const stopPanelAnimations: HUDAnimations.StopPanelAnimations = {
							type: "StopPanelAnimations",
							element: tokeniser.next(),
							delay: parseFloat(tokeniser.next()),
							...(parserTools.is.osTag(tokeniser.next(true)) && {
								osTag: parserTools.convert.osTag(tokeniser.next())
							})
						}
						return stopPanelAnimations
					default:
						throw new HUDAnimationsSyntaxError(animationType, tokeniser)
				}
			}
			else {
				throw new HUDAnimationsSyntaxError(animationType, tokeniser)
			}
		}

		return parseFile()
	}

	static stringify(hudanimations: File, options?: HUDAnimationsStringifyOptions): string {

		const keyOrders: { [key in Command]: readonly (keyof CommandTypes[key])[] } = {
			"Animate": <const>["type", "element", "property", "value", "interpolator", "delay", "duration"],
			"RunEvent": <const>["type", "event", "delay"],
			"StopEvent": <const>["type", "event", "delay"],
			"SetVisible": <const>["type", "element", "visible", "delay"],
			"FireCommand": <const>["type", "delay", "command"],
			"RunEventChild": <const>["type", "element", "event", "delay"],
			"SetInputEnabled": <const>["type", "element", "visible", "delay"],
			"PlaySound": <const>["type", "delay", "sound"],
			"StopPanelAnimations": <const>["type", "element", "delay"],
		}


		const _options: Required<HUDAnimationsStringifyOptions> = {
			extraTabs: options?.extraTabs ?? 1,
			layoutScope: options?.layoutScope ?? "event",
		}

		const newLine = "\r\n"
		let str: string = ""

		for (const eventName in hudanimations) {
			str += `event ${eventName}${newLine}{${newLine}`

			const keyLengths: number[] = new Array(10).fill(0)

			for (const animation of hudanimations[eventName]) {
				let keys: string[]
				if (animationisType(animation, "Animate")) {
					if (animation.interpolator == "Gain" || animation.interpolator == "Bias") {
						keys = [...keyOrders.Animate]
						keys.splice(5, 0, "bias")
					}
					else if (animation.interpolator == "Pulse") {
						keys = [...keyOrders.Animate]
						keys.splice(5, 0, "frequency")
					}
					else {
						keys = [...keyOrders[animation.type]]
					}
				}
				else {
					keys = [...keyOrders[animation.type]]
				}

				for (const [i, key] of keys.entries()) {
					// @ts-ignore
					let value = animation[key]
					if (value) {
						keyLengths[i] = Math.max(keyLengths[i], /\s/.test(value) ? (value.toString().length + 2) : value.toString().length)
					}
				}
			}

			const extraSpaces = _options.extraTabs * 4

			for (const animation of hudanimations[eventName]) {
				if (animationisType(animation, "Animate")) {
					str += `    Animate${" ".repeat(keyLengths[0] - animation.type.length + extraSpaces)}`
					str += `${animation.element}${" ".repeat(keyLengths[1] - animation.element.length + extraSpaces)}`
					str += `${animation.property}${" ".repeat(keyLengths[2] - animation.property.length + extraSpaces)}`
					str += `${/\s/.test(animation.value) ? `"${animation.value}"` : animation.value}${" ".repeat(keyLengths[3] - (/\s/.test(animation.value) ? animation.value.length + 2 : animation.value.length) + extraSpaces)}`

					if (animation.interpolator == "Gain" || animation.interpolator == "Bias") {
						str += `${animation.interpolator}${" ".repeat(keyLengths[4] - animation.interpolator.length + extraSpaces)}`
						str += `${animation.bias}${" ".repeat(keyLengths[5] - animation.bias!.toString().length + extraSpaces)}`
						str += `${animation.delay}${" ".repeat(keyLengths[6] - animation.delay.toString().length + extraSpaces)}`
						str += `${animation.duration}`
						str += `${animation.osTag ? `${" ".repeat(keyLengths[7] - animation.duration.toString().length + extraSpaces)}${animation.osTag}` : ""}`
					}
					else if (animation.interpolator == "Pulse") {
						str += `${animation.interpolator}${" ".repeat(keyLengths[4] - animation.interpolator.length + extraSpaces)}`
						str += `${animation.frequency}${" ".repeat(keyLengths[5] - animation.frequency!.toString().length + extraSpaces)}`
						str += `${animation.delay}${" ".repeat(keyLengths[6] - animation.delay.toString().length + extraSpaces)}`
						str += `${animation.duration}`
						str += `${animation.osTag ? `${" ".repeat(keyLengths[7] - animation.duration.toString().length + extraSpaces)}${animation.osTag}` : ""}`
					}
					else {
						str += `${animation.interpolator}${" ".repeat(keyLengths[4] - animation.interpolator.length + extraSpaces)}`
						str += `${animation.delay}${" ".repeat(keyLengths[5] - animation.delay.toString().length + extraSpaces)}`
						str += `${animation.duration}`
						str += `${animation.osTag ? `${" ".repeat(keyLengths[6] - animation.duration.toString().length + extraSpaces)}${animation.osTag}` : ""}`
					}
					str += `${newLine}`
				}
				if (animationisType(animation, "RunEvent")) {
					str += `    RunEvent${" ".repeat(keyLengths[0] - animation.type.length + extraSpaces)}`
					str += `${animation.event}${" ".repeat(keyLengths[1] - animation.event.length + extraSpaces)}`
					str += `${animation.delay}`
					str += `${animation.osTag ? `${" ".repeat(keyLengths[2] - animation.delay.toString().length + extraSpaces)}${animation.osTag}` : ""}`
					str += `${newLine}`
				}
				if (animationisType(animation, "StopEvent")) {
					str += `    StopEvent${" ".repeat(keyLengths[0] - animation.type.length + extraSpaces)}`
					str += `${animation.event}${" ".repeat(keyLengths[1] - animation.event.length + extraSpaces)}`
					str += `${animation.delay}`
					str += `${animation.osTag ? `${" ".repeat(keyLengths[2] - animation.delay.toString().length + extraSpaces)}${animation.osTag}` : ""}`
					str += `${newLine}`
				}
				if (animationisType(animation, "SetVisible")) {
					str += `    SetVisible${" ".repeat(keyLengths[0] - animation.type.length + extraSpaces)}`
					str += `${animation.element}${" ".repeat(keyLengths[1] - animation.element.length + extraSpaces)}`
					str += `${animation.visible}${" ".repeat(keyLengths[2] - animation.visible.toString().length + extraSpaces)}`
					str += `${animation.delay}`
					str += `${animation.osTag ? `${" ".repeat(keyLengths[3] - animation.delay.toString().length + extraSpaces)}${animation.osTag}` : ""}`
					str += `${newLine}`
				}
				if (animationisType(animation, "FireCommand")) {

					str += `    FireCommand${" ".repeat(keyLengths[0] - animation.type.length + extraSpaces)}`
					str += `${animation.delay}${" ".repeat(keyLengths[1] - animation.delay.toString().length + extraSpaces)}`
					str += `${/\s/.test(animation.command) ? `"${animation.command}"` : animation.command}`
					str += `${animation.osTag ? `${" ".repeat(keyLengths[2] - animation.command.length + extraSpaces)}${animation.osTag}` : ""}`
					str += `${newLine}`
				}
				if (animationisType(animation, "RunEventChild")) {

					str += `    RunEventChild${" ".repeat(keyLengths[0] - animation.type.length + extraSpaces)}`
					str += `${animation.element}${" ".repeat(keyLengths[1] - animation.element.length + extraSpaces)}`
					str += `${animation.event}${" ".repeat(keyLengths[2] - animation.event.length + extraSpaces)}`
					str += `${animation.delay}`
					str += `${animation.osTag ? `${" ".repeat(keyLengths[2] - animation.delay.toString().length + extraSpaces)}${animation.osTag}` : ""}`
					str += `${newLine}`
				}
				if (animationisType(animation, "SetInputEnabled")) {
					str += `    SetInputEnabled${" ".repeat(keyLengths[0] - animation.type.length + extraSpaces)}`
					str += `${animation.element}${" ".repeat(keyLengths[1] - animation.element.length + extraSpaces)}`
					str += `${animation.visible}${" ".repeat(keyLengths[2] - 1 + extraSpaces)}`
					str += `${animation.delay}`
					str += `${animation.osTag ? `${" ".repeat(keyLengths[2] - animation.delay.toString().length + extraSpaces)}${animation.osTag}` : ""}`
					str += `${newLine}`
				}
				if (animationisType(animation, "PlaySound")) {
					str += `    PlaySound${" ".repeat(keyLengths[0] - animation.type.length + extraSpaces)}`
					str += `${animation.delay}${" ".repeat(keyLengths[1] - animation.delay.toString().length + extraSpaces)}`
					str += `${animation.sound}`
					str += `${animation.osTag ? `${" ".repeat(keyLengths[2] - animation.sound.length + extraSpaces)}${animation.osTag}` : ""}`
					str += `${newLine}`

				}
				if (animationisType(animation, "StopPanelAnimations")) {
					str += `    StopPanelAnimations${" ".repeat(keyLengths[0] - animation.type.length + extraSpaces)}`
					str += `${animation.element}${" ".repeat(keyLengths[1] - animation.element.length + extraSpaces)}`
					str += `${animation.delay}`
					str += `${animation.osTag ? `${" ".repeat(keyLengths[2] - animation.delay.toString().length + extraSpaces)}${animation.osTag}` : ""}`
					str += `${newLine}`
				}
			}
			str += `}${newLine}`
		}
		return str
	}
}

export interface HUDAnimationEventDocumentSymbol extends DocumentSymbol {
	nameRange: Range
	animations: HUDAnimationStatementDocumentSymbol[]
}

export interface HUDAnimationStatementDocumentSymbol {
	animation: HUDAnimation<Command>

	/**
	 * Range covering the animation command e.g. `Animate`
	 * 	 */
	commandRange: Range

	// Animate (References)
	// elementRange?: Range
	valueRange?: Range

	// RunEvent | StopEvent | RunEventChild

	/**
	 * Range covering the referenced event e.g. `RunEvent "SomeEvent" 0`
	 */
	eventRange?: Range
}

// These both work

// function sanitizeString<T extends string>(str: string, options: readonly T[], tokeniser: VDFTokeniser): T {
// 	const _str = str.toLowerCase()
// 	const result = options.find(i => i.toLowerCase() == _str)
// 	if (!result) {
// 		throw new HUDAnimationsSyntaxError(str, tokeniser, `Expected "${options.join(`" | "`)}"`)
// 	}
// 	return result
// }
export function sanitizeString<T extends readonly string[]>(str: string, options: T, tokeniser: VDFTokeniser): T[number] {
	const _str = str.toLowerCase()
	const result = options.find(i => i.toLowerCase() == _str)
	if (!result) {
		throw new HUDAnimationsSyntaxError(str, tokeniser, `Expected "${options.join(`" | "`)}"!`)
	}
	return result
}

export function sanitizeNaN(str: string, tokeniser: VDFTokeniser): number {
	const result = parseFloat(str)
	if (isNaN(result)) {
		throw new HUDAnimationsSyntaxError(str, tokeniser, `Expected number!`)
	}
	return result
}

export function sanitizeBit(str: string, tokeniser: VDFTokeniser): Bit {
	if (str == "1" || str == "0") {
		return str == "1" ? 1 : 0
	}
	throw new HUDAnimationsSyntaxError(str, tokeniser, `Expected "1" | "0"`)
}

export function getHUDAnimationsDocumentInfo(connection: _Connection, str: string, options?: VDFTokeniserOptions): { animations: File, symbols: HUDAnimationEventDocumentSymbol[] } {

	const result: ReturnType<typeof getHUDAnimationsDocumentInfo> = {
		animations: {},
		symbols: []
	}

	const tokeniser = new VDFTokeniser(str, options)

	let currentToken = tokeniser.next().toLowerCase()

	if (currentToken == "eof") {
		return result
	}

	if (currentToken != "event") {
		throw new HUDAnimationsSyntaxError(currentToken, tokeniser, `Expected "event"`)
	}

	let eventStartPosition = Position.create(tokeniser.line, tokeniser.character)

	while (currentToken == "event") {
		const eventName = tokeniser.next()
		if (eventName == "{") {
			throw new HUDAnimationsSyntaxError(eventName, tokeniser, "Expected event name")
		}

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
			switch (sanitizeString(animationCommand, CommandKeys, tokeniser)) {
				case "Animate": {

					const element = tokeniser.next()
					// const elementRange = Range.create(Position.create(tokeniser.line, tokeniser.character - element.length), Position.create(tokeniser.line, tokeniser.character))

					const property = tokeniser.next()
					const value = tokeniser.next()
					const valueRange = Range.create(Position.create(tokeniser.line, tokeniser.character - value.length), Position.create(tokeniser.line, tokeniser.character))

					const interpolator = sanitizeString(tokeniser.next(), Interpolators, tokeniser)

					const frequency = interpolator == "Pulse" ? sanitizeNaN(tokeniser.next(), tokeniser) : undefined
					const bias = (interpolator == "Gain" || interpolator == "Bias") ? sanitizeNaN(tokeniser.next(), tokeniser) : undefined

					const delay = sanitizeNaN(tokeniser.next(), tokeniser)
					const duration = sanitizeNaN(tokeniser.next(), tokeniser)

					let osTag: `[${string}]` | undefined
					if (parserTools.is.osTag(tokeniser.next(true))) {
						osTag = parserTools.convert.osTag(tokeniser.next())
					}

					const animation: HUDAnimations.Animate = {
						type: "Animate",
						element: element,
						property: property,
						value: value,
						interpolator: interpolator,
						...(frequency && { frequency: frequency }),
						...(bias && { bias: bias }),
						delay: delay,
						duration: duration,
						osTag: osTag
					}
					result.animations[eventName].push(animation)
					eventAnimations.push({
						commandRange: commandRange,
						valueRange: valueRange,
						animation: animation
					})
					break
				}
				case "RunEvent": {
					const referencedEventName = tokeniser.next()
					const eventRange = Range.create(
						Position.create(tokeniser.line, tokeniser.character - referencedEventName.length),
						Position.create(tokeniser.line, tokeniser.character)
					)
					const runEvent: HUDAnimations.RunEvent = {
						type: "RunEvent",
						event: referencedEventName,
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
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
					const referencedEventName = tokeniser.next()
					const eventRange = Range.create(
						Position.create(tokeniser.line, tokeniser.character - referencedEventName.length),
						Position.create(tokeniser.line, tokeniser.character)
					)
					const stopEvent: HUDAnimations.StopEvent = {
						type: "StopEvent",
						event: referencedEventName,
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
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
					const setVisible: HUDAnimations.SetVisible = {
						type: "SetVisible",
						element: tokeniser.next(),
						visible: sanitizeBit(tokeniser.next(), tokeniser),
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(setVisible)
					eventAnimations.push({
						commandRange: commandRange,
						animation: setVisible
					})
					break
				}
				case "FireCommand": {
					const fireCommand: HUDAnimations.FireCommand = {
						type: "FireCommand",
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						command: tokeniser.next(),
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
					const referencedElement = tokeniser.next()
					const referencedEventName = tokeniser.next()
					const eventRange = Range.create(
						Position.create(tokeniser.line, tokeniser.character - referencedEventName.length),
						Position.create(tokeniser.line, tokeniser.character)
					)

					const runEventChild: HUDAnimations.RunEventChild = {
						type: "RunEventChild",
						element: referencedElement,
						event: referencedEventName,
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(runEventChild)
					eventAnimations.push({
						commandRange: commandRange,
						eventRange: eventRange,
						animation: runEventChild
					})
					break
				}
				case "SetInputEnabled": {
					const setInputEnabled: HUDAnimations.SetInputEnabled = {
						type: "SetInputEnabled",
						element: tokeniser.next(),
						visible: sanitizeBit(tokeniser.next(), tokeniser),
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(setInputEnabled)
					eventAnimations.push({
						commandRange: commandRange,
						animation: setInputEnabled
					})
					break
				}
				case "PlaySound": {
					const playSound: HUDAnimations.PlaySound = {
						type: "PlaySound",
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						sound: tokeniser.next(),
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
					const stopPanelAnimations: HUDAnimations.StopPanelAnimations = {
						type: "StopPanelAnimations",
						element: tokeniser.next(),
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					}
					result.animations[eventName].push(stopPanelAnimations)
					eventAnimations.push({
						commandRange: commandRange,
						animation: stopPanelAnimations
					})
					break
				}
				default: {
					throw new HUDAnimationsSyntaxError(animationCommand, tokeniser, `Expected "${CommandKeys.join(`" | "`)}"`)
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
