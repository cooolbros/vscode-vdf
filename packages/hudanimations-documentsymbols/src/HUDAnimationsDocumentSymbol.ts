import type { VDFRange, VDFToken } from "vdf"
import { DocumentSymbol, SymbolKind } from "vscode-languageserver"
import type { HUDAnimationsStatementDocumentSymbols } from "./HUDAnimationsDocumentSymbols"

export class HUDAnimationsEventDocumentSymbol implements DocumentSymbol {

	/** @deprecated Use {@link eventName} */
	public readonly name: string
	public readonly eventName: string
	public readonly eventNameRange: VDFRange
	public readonly conditional: { value: string, range: VDFRange } | null
	public readonly kind: typeof SymbolKind.Event
	public readonly range: VDFRange
	public readonly selectionRange: VDFRange
	public readonly children: HUDAnimationsStatementDocumentSymbols

	constructor(event: VDFToken, conditional: VDFToken | null, range: VDFRange, children: HUDAnimationsStatementDocumentSymbols) {
		this.name = event.value + (conditional ? ` ${conditional.value}` : "")
		this.eventName = event.value
		this.eventNameRange = event.range
		this.conditional = conditional
		this.kind = SymbolKind.Event
		this.range = range
		this.selectionRange = range
		this.children = children
	}
}

export const enum HUDAnimationStatementType {
	Animate,
	RunEvent,
	StopEvent,
	SetVisible,
	FireCommand,
	RunEventChild,
	SetInputEnabled,
	PlaySound,
	StopPanelAnimations,
	StopAnimation,
	SetFont,
	SetTexture,
	SetString
}

abstract class HUDAnimationsStatementDocumentSymbolBase implements DocumentSymbol {

	public readonly abstract type: HUDAnimationStatementType

	/** @deprecated */
	public readonly name: string
	public readonly kind: typeof SymbolKind.Variable
	public readonly range: VDFRange
	public readonly selectionRange: VDFRange

	constructor(name: string, range: VDFRange) {
		this.name = name
		this.kind = SymbolKind.Variable
		this.range = range
		this.selectionRange = range
	}
}

export class AnimateDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.Animate
	public readonly element: string
	public readonly elementRange: VDFRange
	public readonly property: string
	public readonly propertyRange: VDFRange
	public readonly value: string
	public readonly valueRange: VDFRange
	constructor(
		{ element, elementRange, property, propertyRange, value, valueRange, interpolator, delay, duration, conditional }: { element: string, elementRange: VDFRange, property: string, propertyRange: VDFRange, value: string, valueRange: VDFRange, interpolator: Interpolator, delay: number, duration: number, conditional?: string },
		range: VDFRange
	) {
		super(`Animate ${element} ${property} ${value} ${interpolator} ${delay} ${duration}` + (conditional ? ` ${conditional}` : ""), range)
		this.element = element
		this.elementRange = elementRange
		this.property = property
		this.propertyRange = propertyRange
		this.value = value
		this.valueRange = valueRange
	}
}

export interface Interpolator {
	readonly type: string
	toString(): string
}

export class LinearInterpolator implements Interpolator {
	public readonly type = <const>"Linear"
	public toString(): string {
		return "Linear"
	}
}

export class AccelInterpolator implements Interpolator {
	public readonly type = <const>"Accel"
	public toString(): string {
		return "Accel"
	}
}

export class DeAccelInterpolator implements Interpolator {
	public readonly type = <const>"DeAccel"
	public toString(): string {
		return "DeAccel"
	}
}

export class SplineInterpolator implements Interpolator {
	public readonly type = <const>"Spline"
	public toString(): string {
		return "Spline"
	}
}

export class BounceInterpolator implements Interpolator {
	public readonly type = <const>"Bounce"
	public toString(): string {
		return "Bounce"
	}
}

export class PulseInterpolator implements Interpolator {
	public readonly type = <const>"Pulse"
	public readonly frequency: string
	constructor(frequency: string) {
		this.frequency = frequency
	}
	public toString(): string {
		return `Pulse ${this.frequency}`
	}
}

export class FlickerInterpolator implements Interpolator {
	public readonly type = <const>"Flicker"
	public readonly randomness: string
	constructor(randomness: string) {
		this.randomness = randomness
	}
	public toString(): string {
		return `Flicker ${this.randomness}`
	}
}

export class GainInterpolator implements Interpolator {
	public readonly type = <const>"Gain"
	public readonly bias: string
	constructor(bias: string) {
		this.bias = bias
	}
	public toString(): string {
		return `Gain ${this.bias}`
	}
}

export class BiasInterpolator implements Interpolator {
	public readonly type = <const>"Bias"
	public readonly bias: string
	constructor(bias: string) {
		this.bias = bias
	}
	public toString(): string {
		return `Bias ${this.bias}`
	}
}

export class RunEventDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.RunEvent
	public readonly event: string
	public readonly eventRange: VDFRange
	constructor(
		{ event, eventRange, delay, conditional }: { event: string, eventRange: VDFRange, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`RunEvent ${event} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
		this.event = event
		this.eventRange = eventRange
	}
}

export class StopEventDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.StopEvent
	public readonly event: string
	public readonly eventRange: VDFRange
	constructor(
		{ event, eventRange, delay, conditional }: { event: string, eventRange: VDFRange, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`StopEvent ${event} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
		this.event = event
		this.eventRange = eventRange
	}
}

export class SetVisibleDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetVisible
	public readonly element: string
	public readonly elementRange: VDFRange
	constructor(
		{ element, elementRange, visible, delay, conditional }: { element: string, elementRange: VDFRange, visible: string, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`SetVisible ${element} ${visible} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
		this.element = element
		this.elementRange = elementRange
	}
}


export class FireCommandDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.FireCommand
	constructor(
		{ delay, command, conditional }: { delay: number, command: string, conditional?: string },
		range: VDFRange
	) {
		super(`FireCommand ${delay} ${command}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class RunEventChildDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.RunEventChild
	public readonly element: string
	public readonly elementRange: VDFRange
	public readonly event: string
	public readonly eventRange: VDFRange
	constructor(
		{ element, elementRange, event, eventRange, delay, conditional }: { element: string, elementRange: VDFRange, event: string, eventRange: VDFRange, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`RunEventChild ${element} ${event} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
		this.element = element
		this.elementRange = elementRange
		this.event = event
		this.eventRange = eventRange
	}
}

export class SetInputEnabledDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetInputEnabled
	public readonly element: string
	public readonly elementRange: VDFRange
	constructor(
		{ element, elementRange, enabled, delay, conditional }: { element: string, elementRange: VDFRange, enabled: string, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`SetInputEnabled ${element} ${enabled} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
		this.element = element
		this.elementRange = elementRange
	}
}

export class PlaySoundDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.PlaySound
	public readonly sound: string
	public readonly soundRange: VDFRange
	constructor(
		{ delay, sound, soundRange, conditional }: { delay: number, sound: string, soundRange: VDFRange, conditional?: string },
		range: VDFRange
	) {
		super(`PlaySound ${delay} ${sound}` + (conditional ? ` ${conditional}` : ""), range)
		this.sound = sound
		this.soundRange = soundRange
	}
}

export class StopPanelAnimationsDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.StopPanelAnimations
	constructor(
		{ element, delay, conditional }: { element: string, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`StopPanelAnimations ${element} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class StopAnimationDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.StopAnimation
	constructor(
		{ element, property, delay, conditional }: { element: string, property: string, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`StopAnimation ${element} ${property} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}

}

export class SetFontDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetFont
	public readonly element: string
	public readonly elementRange: VDFRange
	public readonly property: string
	public readonly propertyRange: VDFRange
	public readonly font: string
	public readonly fontRange: VDFRange
	constructor(
		{ element, elementRange, property, propertyRange, font, fontRange, delay, conditional }: { element: string, elementRange: VDFRange, property: string, propertyRange: VDFRange, font: string, fontRange: VDFRange, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`SetFont ${element} ${property} ${font} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
		this.element = element
		this.elementRange = elementRange
		this.property = property
		this.propertyRange = propertyRange
		this.font = font
		this.fontRange = fontRange
	}
}

export class SetTextureDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetTexture
	public readonly element: string
	public readonly elementRange: VDFRange
	public readonly property: string
	public readonly propertyRange: VDFRange
	public readonly value: string
	public readonly valueRange: VDFRange
	constructor(
		{ element, elementRange, property, propertyRange, value, valueRange, delay, conditional }: { element: string, elementRange: VDFRange, property: string, propertyRange: VDFRange, value: string, valueRange: VDFRange, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`SetTexture ${element} ${property} ${value} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
		this.element = element
		this.elementRange = elementRange
		this.property = property
		this.propertyRange = propertyRange
		this.value = value
		this.valueRange = valueRange
	}
}

export class SetStringDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetString
	public readonly element: string
	public readonly elementRange: VDFRange
	public readonly property: string
	public readonly propertyRange: VDFRange
	public readonly value: string
	public readonly valueRange: VDFRange
	constructor(
		{ element, elementRange, property, propertyRange, value, valueRange, delay, conditional }: { element: string, elementRange: VDFRange, property: string, propertyRange: VDFRange, value: string, valueRange: VDFRange, delay: number, conditional?: string },
		range: VDFRange
	) {
		super(`SetString ${element} ${property} ${value} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
		this.element = element
		this.elementRange = elementRange
		this.property = property
		this.propertyRange = propertyRange
		this.value = value
		this.valueRange = valueRange
	}
}

export type HUDAnimationsStatementDocumentSymbol = AnimateDocumentSymbol | RunEventDocumentSymbol | StopEventDocumentSymbol | SetVisibleDocumentSymbol | FireCommandDocumentSymbol | RunEventChildDocumentSymbol | SetInputEnabledDocumentSymbol | PlaySoundDocumentSymbol | StopPanelAnimationsDocumentSymbol | StopAnimationDocumentSymbol | SetFontDocumentSymbol | SetTextureDocumentSymbol | SetStringDocumentSymbol
