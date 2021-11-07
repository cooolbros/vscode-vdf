import { Position } from "vscode-languageserver-types";
import { VDFSyntaxError, VDFTokeniser } from "../../../shared/vdf";

export class HUDAnimationsSyntaxError extends VDFSyntaxError {
	line: number
	character: number
	constructor(unExpectedToken: string, position: number, line: number, character: number, message?: string) {
		super(`Unexpected ${unExpectedToken} at position ${position} (line ${line}, character ${character})!${message ? ` ${message}` : ""}`, line, character);
		this.line = line
		this.character = character
	}
}

export namespace HUDAnimationTypes {

	export type File = { [key: string]: Event }
	export type Event = HUDAnimation<typeof CommandKeys[number]>[]
	// export type Command = "Animate" | "RunEvent" | "StopEvent" | "SetVisible" | "FireCommand" | "RunEventChild" | "SetInputEnabled" | "PlaySound" | "StopPanelAnimations"
	export const CommandKeys = <const>["Animate", "RunEvent", "StopEvent", "SetVisible", "FireCommand", "RunEventChild", "SetInputEnabled", "PlaySound", "StopPanelAnimations"]
	export type Commands = {
		"Animate": Animate
		"RunEvent": RunEvent
		"StopEvent": StopEvent
		"SetVisible": SetVisible
		"FireCommand": FireCommand
		"RunEventChild": RunEventChild
		"SetInputEnabled": SetInputEnabled
		"PlaySound": PlaySound
		"StopPanelAnimations": StopPanelAnimations
	}

	export type Bit = 0 | 1
	export const Interpolators = <const>["Linear", "Accel", "Deaccel", "Spline", "Pulse", "Flicker", "Gain", "Bias"]
	export type Interpolator = typeof Interpolators[number]

	export const isHUDAnimation = (animationType: string): animationType is typeof CommandKeys[number] => {
		animationType = animationType.toLocaleLowerCase()
		for (const p of CommandKeys) {
			if (p.toLocaleLowerCase() == animationType) {
				return true
			}
		}
		return false
	}

	export const animationisType = <T extends typeof HUDAnimationTypes.CommandKeys[number]>(animation: HUDAnimationTypes.HUDAnimation<typeof HUDAnimationTypes.CommandKeys[number]>, animationType: T): animation is HUDAnimationTypes.Commands[typeof animationType] => animation.type == animationType

	export const keyOrders: { [key in typeof CommandKeys[number]]: readonly (keyof Commands[key])[] } = {
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

	export interface HUDAnimation<T extends typeof CommandKeys[number]> {
		type: T
		osTag?: `[${string}]`
	}

	export interface HUDAnimationEventReference {
		referencePosition: Position
	}


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

	export interface RunEvent extends HUDAnimation<"RunEvent">, HUDAnimationEventReference {
		event: string
		delay: number
	}

	export interface StopEvent extends HUDAnimation<"StopEvent">, HUDAnimationEventReference {
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

	export interface RunEventChild extends HUDAnimation<"RunEventChild">, HUDAnimationEventReference {
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

export interface HUDAnimationsStringifyOptions {
	extraTabs?: number
}

export class HUDAnimations {
	static parse(str: string): HUDAnimationTypes.File {
		const tokeniser: VDFTokeniser = new VDFTokeniser(str)
		const parseFile = (): HUDAnimationTypes.File => {
			const events: HUDAnimationTypes.File = {}
			let currentToken: string = tokeniser.next();
			if (currentToken != "event") {
				throw new HUDAnimationsSyntaxError(currentToken, tokeniser.position, tokeniser.line, tokeniser.character, `Expected "event"`)
			}
			while (currentToken.toLowerCase() == "event") {
				const eventName = tokeniser.next();
				if (eventName == "{") {
					throw new HUDAnimationsSyntaxError(eventName, tokeniser.position, tokeniser.line, tokeniser.character, "Expected event name")
				}
				events[eventName] = parseEvent();
				currentToken = tokeniser.next();
			}
			return events;
		}

		const parseEvent = (): HUDAnimationTypes.Event => {

			const animations: HUDAnimationTypes.Event = []
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
						throw new HUDAnimationsSyntaxError("EOF", tokeniser.position, tokeniser.line, tokeniser.character, "Are you missing a close brace?")
					}
				}
			}
			else {
				throw new HUDAnimationsSyntaxError(nextToken, tokeniser.position, tokeniser.line, tokeniser.character, "Are you missing an opening brace?")
			}

			return animations
		}

		const getInterpolator = (interpolator: string): { interpolator: HUDAnimationTypes.Interpolator, frequency?: number, bias?: number } => {
			interpolator = interpolator.toLowerCase()
			if (interpolator == "pulse") return { interpolator: "Pulse", frequency: parseFloat(tokeniser.next()) }
			if (interpolator == "gain" || interpolator == "bias") return { interpolator: interpolator == "gain" ? "Gain" : "Bias", bias: parseFloat(tokeniser.next()) }
			return { interpolator: HUDAnimationTypes.Interpolators.find(i => i.toLowerCase() == interpolator) ?? "Linear" }
		}

		const parseAnimation = (animationType: string): HUDAnimationTypes.HUDAnimation<keyof HUDAnimationTypes.Commands> => {
			if (HUDAnimationTypes.isHUDAnimation(animationType)) {
				switch (animationType.toLocaleLowerCase()) {
					case "animate":
						const animate: HUDAnimationTypes.Animate = {
							type: "Animate",
							element: tokeniser.next(),
							property: tokeniser.next(),
							value: tokeniser.next(),
							...getInterpolator(tokeniser.next()),
							delay: parseFloat(tokeniser.next()),
							duration: parseFloat(tokeniser.next()),
							...(tokeniser.next(true).startsWith("[") && {
								osTag: `[${tokeniser.next().slice(1, -1)}]`
							})
						}
						return animate
					case "runevent":
						const runEvent: HUDAnimationTypes.RunEvent = {
							type: "RunEvent",
							event: tokeniser.next(),
							referencePosition: {
								line: tokeniser.line,
								character: tokeniser.character
							},
							delay: parseFloat(tokeniser.next()),
							...(tokeniser.next(true).startsWith("[") && {
								osTag: `[${tokeniser.next().slice(1, -1)}]`
							})
						}
						return runEvent
					case "stopevent":
						const stopEvent: HUDAnimationTypes.StopEvent = {
							type: "StopEvent",
							event: tokeniser.next(),
							referencePosition: {
								line: tokeniser.line,
								character: tokeniser.character
							},
							delay: parseFloat(tokeniser.next()),
							...(tokeniser.next(true).startsWith("[") && {
								osTag: `[${tokeniser.next().slice(1, -1)}]`
							})
						}
						return stopEvent
					case "setvisible":
						const setVisible: HUDAnimationTypes.SetVisible = {
							type: "SetVisible",
							element: tokeniser.next(),
							visible: tokeniser.next() == "1" ? 1 : 0,
							delay: parseFloat(tokeniser.next()),
							...(tokeniser.next(true).startsWith("[") && {
								osTag: `[${tokeniser.next().slice(1, -1)}]`
							})
						}
						return setVisible
					case "firecommand":
						const fireCommand: HUDAnimationTypes.FireCommand = {
							type: "FireCommand",
							delay: parseFloat(tokeniser.next()),
							command: tokeniser.next(),
							...(tokeniser.next(true).startsWith("[") && {
								osTag: `[${tokeniser.next().slice(1, -1)}]`
							})
						}
						return fireCommand
					case "runeventchild":
						const runEventChild: HUDAnimationTypes.RunEventChild = {
							type: "RunEventChild",
							element: tokeniser.next(),
							event: tokeniser.next(),
							referencePosition: {
								line: tokeniser.line,
								character: tokeniser.character
							},
							delay: parseFloat(tokeniser.next()),
							...(tokeniser.next(true).startsWith("[") && {
								osTag: `[${tokeniser.next().slice(1, -1)}]`
							})
						}
						return runEventChild
					case "setinputenabled":
						const setInputEnabled: HUDAnimationTypes.SetInputEnabled = {
							type: "SetInputEnabled",
							element: tokeniser.next(),
							visible: tokeniser.next() == "1" ? 1 : 0,
							delay: parseFloat(tokeniser.next()),
							...(tokeniser.next(true).startsWith("[") && {
								osTag: `[${tokeniser.next().slice(1, -1)}]`
							})
						}
						return setInputEnabled
					case "playsound":
						const playSound: HUDAnimationTypes.PlaySound = {
							type: "PlaySound",
							delay: parseFloat(tokeniser.next()),
							sound: tokeniser.next(),
							...(tokeniser.next(true).startsWith("[") && {
								osTag: `[${tokeniser.next().slice(1, -1)}]`
							})
						}
						return playSound
					case "stoppanelanimations":
						const stopPanelAnimations: HUDAnimationTypes.StopPanelAnimations = {
							type: "StopPanelAnimations",
							element: tokeniser.next(),
							delay: parseFloat(tokeniser.next()),
							...(tokeniser.next(true).startsWith("[") && {
								osTag: `[${tokeniser.next().slice(1, -1)}]`
							})
						}
						return stopPanelAnimations
					default:
						throw new HUDAnimationsSyntaxError(animationType, tokeniser.position, tokeniser.line, tokeniser.character)
				}
			}
			else {
				throw new HUDAnimationsSyntaxError(animationType, tokeniser.position, tokeniser.line, tokeniser.character)
			}
		}

		return parseFile()
	}

	static stringify(hudanimations: HUDAnimationTypes.File, options?: HUDAnimationsStringifyOptions): string {

		const _options: Required<HUDAnimationsStringifyOptions> = {
			extraTabs: options?.extraTabs ?? 1
		}

		const newLine = "\r\n"
		let str: string = ""

		const animationisType = <T extends typeof HUDAnimationTypes.CommandKeys[number]>(animation: HUDAnimationTypes.HUDAnimation<typeof HUDAnimationTypes.CommandKeys[number]>, animationType: T): animation is HUDAnimationTypes.Commands[typeof animationType] => animation.type == animationType

		const getInterpolator = (animation: HUDAnimationTypes.Animate): string => {
			if (animation.interpolator == "Pulse") return `${animation.interpolator} ${animation.frequency}`
			if (animation.interpolator == "Gain" || animation.interpolator == "Bias") return `${animation.interpolator} ${animation.bias}`
			return animation.interpolator
		}

		for (const eventName in hudanimations) {
			str += `event ${eventName}${newLine}{${newLine}`

			const keyLengths: number[] = new Array(10).fill(0)

			for (const animation of hudanimations[eventName]) {
				let keys: string[]
				if (animationisType(animation, "Animate")) {
					if (animation.interpolator == "Gain" || animation.interpolator == "Bias") {
						keys = [...HUDAnimationTypes.keyOrders[animation.type]]
						keys.splice(5, 0, "bias")
					}
					else if (animation.interpolator == "Pulse") {
						keys = [...HUDAnimationTypes.keyOrders[animation.type]]
						keys.splice(5, 0, "frequency")
					}
					else {
						keys = [...HUDAnimationTypes.keyOrders[animation.type]]
					}
				}
				else {
					keys = [...HUDAnimationTypes.keyOrders[animation.type]]
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
