import { HUDAnimationStatementType } from "hudanimations-documentsymbols"
import type { Animation, HUDAnimationsFormatDocumentSymbol } from "./HUDAnimationsFormatDocumentSymbol"
import type { HUDAnimationsFormatStringifyOptions } from "./HUDAnimationsFormatStringifyOptions"

export function printHUDAnimationsFormatDocumentSymbols(documentSymbols: HUDAnimationsFormatDocumentSymbol[], options: HUDAnimationsFormatStringifyOptions): string {

	const space = " "
	const eol = "\n"

	const spaces = options.tabs * 4

	function quoted(value: string): boolean {
		return value == "" || /\s/.test(value)
	}

	function len(str?: string): number {
		if (str == undefined) {
			return 0
		}
		return str.length + (quoted(str) ? 2 : 0)
	}

	function getKeyLengths(animation: Animation): number[] {
		switch (animation.type) {
			case HUDAnimationStatementType.Animate: {
				const animateLength = "Animate".length
				switch (animation.interpolator.type) {
					case "Bias":
						return [animateLength, len(animation.element), len(animation.property), len(animation.value), animation.interpolator.type.length, len(animation.interpolator.bias), len(animation.delay), len(animation.duration)]
					case "Flicker":
						return [animateLength, len(animation.element), len(animation.property), len(animation.value), animation.interpolator.type.length, len(animation.interpolator.randomness), len(animation.delay), len(animation.duration)]
					case "Gain":
						return [animateLength, len(animation.element), len(animation.property), len(animation.value), animation.interpolator.type.length, len(animation.interpolator.bias), len(animation.delay), len(animation.duration)]
					case "Pulse":
						return [animateLength, len(animation.element), len(animation.property), len(animation.value), animation.interpolator.type.length, len(animation.interpolator.frequency), len(animation.delay), len(animation.duration)]
					default:
						return [animateLength, len(animation.element), len(animation.property), len(animation.value), animation.interpolator.type.length, len(animation.delay), len(animation.duration)]
				}
			}
			case HUDAnimationStatementType.RunEvent: {
				return ["RunEvent".length, len(animation.event), len(animation.delay)]
			}
			case HUDAnimationStatementType.StopEvent: {
				return ["StopEvent".length, len(animation.event), len(animation.delay)]
			}
			case HUDAnimationStatementType.SetVisible: {
				return ["SetVisible".length, len(animation.element), len(animation.visible), len(animation.delay)]
			}
			case HUDAnimationStatementType.FireCommand: {
				return ["FireCommand".length, len(animation.delay), len(animation.command)]
			}
			case HUDAnimationStatementType.RunEventChild: {
				return ["RunEventChild".length, len(animation.element), len(animation.event), len(animation.delay)]
			}
			case HUDAnimationStatementType.SetInputEnabled: {
				return ["SetInputEnabled".length, len(animation.element), len(animation.enabled), len(animation.delay)]
			}
			case HUDAnimationStatementType.PlaySound: {
				return ["PlaySound".length, len(animation.delay), len(animation.sound)]
			}
			case HUDAnimationStatementType.StopPanelAnimations: {
				return ["StopPanelAnimations".length, len(animation.element), len(animation.delay)]
			}
			case HUDAnimationStatementType.StopAnimation: {
				return ["StopAnimation".length, len(animation.element), len(animation.property), len(animation.delay)]
			}
			case HUDAnimationStatementType.SetFont: {
				return ["SetFont".length, len(animation.element), len(animation.property), len(animation.value), len(animation.delay)]
			}
			case HUDAnimationStatementType.SetTexture: {
				return ["SetTexture".length, len(animation.element), len(animation.property), len(animation.value), len(animation.delay)]
			}
			case HUDAnimationStatementType.SetString: {
				return ["SetString".length, len(animation.element), len(animation.property), len(animation.value), len(animation.delay)]
			}
		}
	}

	function print(value: string): string {
		return quoted(value) ? `"${value}"` : value
	}

	function printComment(comment: string): string {
		return `//${comment != "" && comment[0] != "/" ? " " : ""}${comment}`
	}

	function printAnimation(animation: Animation, maxKeyLengths: number[]): string {
		let s = ""
		let i = 0
		switch (animation.type) {
			case HUDAnimationStatementType.Animate: {
				s += `    Animate${space.repeat(maxKeyLengths[i++] - "Animate".length + spaces)}`
				s += `${print(animation.element)}${space.repeat(maxKeyLengths[i++] - len(animation.element) + spaces)}`
				s += `${print(animation.property)}${space.repeat(maxKeyLengths[i++] - len(animation.property) + spaces)}`
				s += `${print(animation.value)}${space.repeat(maxKeyLengths[i++] - len(animation.value) + spaces)}`
				s += `${animation.interpolator.type}${space.repeat(maxKeyLengths[i++] - len(animation.interpolator.type) + spaces)}`
				switch (animation.interpolator.type) {
					case "Pulse": {
						s += `${animation.interpolator.frequency}${space.repeat(maxKeyLengths[i++] - len(animation.interpolator.frequency) + spaces)}`
						break
					}
					case "Flicker": {
						s += `${animation.interpolator.randomness}${space.repeat(maxKeyLengths[i++] - len(animation.interpolator.randomness) + spaces)}`
						break
					}
					case "Gain":
					case "Bias": {
						s += `${animation.interpolator.bias}${space.repeat(maxKeyLengths[i++] - len(animation.interpolator.bias) + spaces)}`
						break
					}
				}
				s += `${print(animation.delay)}${space.repeat(maxKeyLengths[i++] - len(animation.delay) + spaces)}`
				s += `${print(animation.duration)}`
				return s
			}
			case HUDAnimationStatementType.RunEvent: {
				s += `    RunEvent${space.repeat(maxKeyLengths[i++] - "RunEvent".length + spaces)}`
				s += `${print(animation.event)}${space.repeat(maxKeyLengths[i++] - len(animation.event) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
			case HUDAnimationStatementType.StopEvent: {
				s += `    StopEvent${space.repeat(maxKeyLengths[i++] - "StopEvent".length + spaces)}`
				s += `${print(animation.event)}${space.repeat(maxKeyLengths[i++] - len(animation.event) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
			case HUDAnimationStatementType.SetVisible: {
				s += `    SetVisible${space.repeat(maxKeyLengths[i++] - "SetVisible".length + spaces)}`
				s += `${print(animation.element)}${space.repeat(maxKeyLengths[i++] - len(animation.element) + spaces)}`
				s += `${print(animation.visible)}${space.repeat(maxKeyLengths[i++] - len(animation.visible) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
			case HUDAnimationStatementType.FireCommand: {
				s += `    FireCommand${space.repeat(maxKeyLengths[i++] - "FireCommand".length + spaces)}`
				s += `${print(animation.delay)}${space.repeat(maxKeyLengths[i++] - len(animation.delay) + spaces)}`
				s += `${print(animation.command)}`
				return s
			}
			case HUDAnimationStatementType.RunEventChild: {
				s += `    RunEventChild${space.repeat(maxKeyLengths[i++] - "RunEventChild".length + spaces)}`
				s += `${print(animation.element)}${space.repeat(maxKeyLengths[i++] - len(animation.element) + spaces)}`
				s += `${print(animation.event)}${space.repeat(maxKeyLengths[i++] - len(animation.event) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
			case HUDAnimationStatementType.SetInputEnabled: {
				s += `    SetInputEnabled${space.repeat(maxKeyLengths[i++] - "SetInputEnabled".length + spaces)}`
				s += `${print(animation.element)}${space.repeat(maxKeyLengths[i++] - len(animation.element) + spaces)}`
				s += `${print(animation.enabled)}${space.repeat(maxKeyLengths[i++] - len(animation.enabled) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
			case HUDAnimationStatementType.PlaySound: {
				s += `    PlaySound${space.repeat(maxKeyLengths[i++] - "PlaySound".length + spaces)}`
				s += `${print(animation.delay)}${space.repeat(maxKeyLengths[i++] - len(animation.delay) + spaces)}`
				s += `${print(animation.sound)}`
				return s
			}
			case HUDAnimationStatementType.StopPanelAnimations: {
				s += `    StopPanelAnimations${space.repeat(maxKeyLengths[i++] - "StopPanelAnimations".length + spaces)}`
				s += `${print(animation.element)}${space.repeat(maxKeyLengths[i++] - len(animation.element) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
			case HUDAnimationStatementType.StopAnimation: {
				s += `    StopAnimation${space.repeat(maxKeyLengths[i++] - "StopAnimation".length + spaces)}`
				s += `${print(animation.element)}${space.repeat(maxKeyLengths[i++] - len(animation.element) + spaces)}`
				s += `${print(animation.property)}${space.repeat(maxKeyLengths[i++] - len(animation.property) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
			case HUDAnimationStatementType.SetFont: {
				s += `    SetFont${space.repeat(maxKeyLengths[i++] - "SetFont".length + spaces)}`
				s += `${print(animation.element)}${space.repeat(maxKeyLengths[i++] - len(animation.element) + spaces)}`
				s += `${print(animation.property)}${space.repeat(maxKeyLengths[i++] - len(animation.property) + spaces)}`
				s += `${print(animation.value)}${space.repeat(maxKeyLengths[i++] - len(animation.value) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
			case HUDAnimationStatementType.SetTexture: {
				s += `    SetTexture${space.repeat(maxKeyLengths[i++] - "SetTexture".length + spaces)}`
				s += `${print(animation.element)}${space.repeat(maxKeyLengths[i++] - len(animation.element) + spaces)}`
				s += `${print(animation.property)}${space.repeat(maxKeyLengths[i++] - len(animation.property) + spaces)}`
				s += `${print(animation.value)}${space.repeat(maxKeyLengths[i++] - len(animation.value) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
			case HUDAnimationStatementType.SetString: {
				s += `    SetString${space.repeat(maxKeyLengths[i++] - "SetString".length + spaces)}`
				s += `${print(animation.element)}${space.repeat(maxKeyLengths[i++] - len(animation.element) + spaces)}`
				s += `${print(animation.property)}${space.repeat(maxKeyLengths[i++] - len(animation.property) + spaces)}`
				s += `${print(animation.value)}${space.repeat(maxKeyLengths[i++] - len(animation.value) + spaces)}`
				s += `${print(animation.delay)}`
				return s
			}
		}
	}

	let fileScopeMaxKeyLengths: number[] | null = null

	if (options.layoutScope == "file") {

		fileScopeMaxKeyLengths = Array.from<number>({ length: 20 }).fill(0)

		for (const documentSymbol of documentSymbols) {
			if (!documentSymbol.event) {
				continue
			}
			for (const animation of documentSymbol.event.animations) {
				if ("type" in animation) {
					for (const [index, keyLength] of getKeyLengths(animation).entries()) {
						fileScopeMaxKeyLengths[index] = Math.max(fileScopeMaxKeyLengths[index], keyLength)
					}
				}
			}
		}
	}

	let str = ""

	const length = documentSymbols.length - 1

	for (const [index, documentSymbol] of documentSymbols.entries()) {
		if (documentSymbol.comment != undefined) {
			str += `${printComment(documentSymbol.comment)}`
			if (index < length) {
				str += eol
			}
			else {
				if (options.insertFinalNewline) {
					str += eol
				}
			}
		}
		else if (documentSymbol.event != undefined) {
			str += `event ${print(documentSymbol.event.name)}`
			if (documentSymbol.event.conditional != undefined) {
				str += ` ${documentSymbol.event.conditional}`
			}
			if (documentSymbol.event.comment != undefined) {
				str += `    ${printComment(documentSymbol.event.comment)}`
			}
			str += `${eol}{${eol}`

			let eventScopeMaxKeyLengths = fileScopeMaxKeyLengths

			if (eventScopeMaxKeyLengths == null) {

				eventScopeMaxKeyLengths = Array.from<number>({ length: 10 }).fill(0)

				for (const animation of documentSymbol.event.animations) {
					if ("type" in animation) {
						for (const [index, keyLength] of getKeyLengths(animation).entries()) {
							eventScopeMaxKeyLengths[index] = Math.max(eventScopeMaxKeyLengths[index], keyLength)
						}
					}
				}
			}

			for (const animation of documentSymbol.event.animations) {
				if ("type" in animation) {
					str += printAnimation(animation, eventScopeMaxKeyLengths)
					if (animation.conditional) {
						str += ` ${animation.conditional}`
					}
					if (animation.comment) {
						str += ` ${printComment(animation.comment)}`
					}
				}
				else if (animation.comment != undefined) {
					str += `    ${printComment(animation.comment)}`
				}

				str += eol
			}

			str += "}"

			if (index < length) {
				str += eol
				if (options.breakAfterEvent) {
					str += eol
				}
			}
			else {
				if (options.insertFinalNewline) {
					str += eol
				}
			}
		}
	}

	return str
}
