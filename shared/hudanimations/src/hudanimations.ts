// HUD Animations

import { Position, Range } from "vscode-languageserver-types";
import { VDFSyntaxError } from "../../VDF/dist/VDFErrors";
import { VDFTokeniser } from "../../VDF/dist/VDFTokeniser";

export type File = Record<string, Event>
export type Event = HUDAnimation<Command>[]

export const CommandKeys = <const>["Animate", "RunEvent", "StopEvent", "SetVisible", "FireCommand", "RunEventChild", "SetInputEnabled", "PlaySound", "StopPanelAnimations"]
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

export const Interpolators = <const>["Linear", "Accel", "Deaccel", "Spline", "Pulse", "Flicker", "Gain", "Bias", "Bounce"]
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


