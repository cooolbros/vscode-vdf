import type { VDFRange, VDFToken, VDFTokenType } from "vdf"
import { DocumentSymbol, SymbolKind } from "vscode-languageserver"
import type { HUDAnimationsStatementDocumentSymbols } from "./HUDAnimationsDocumentSymbols"

export class HUDAnimationsEventDocumentSymbol implements DocumentSymbol {

	/** @deprecated Use {@link eventName} */
	public readonly name: string
	public readonly eventName: string
	public readonly eventNameRange: VDFRange
	public readonly conditional: { value: `[${string}]`, range: VDFRange } | null
	public readonly kind: typeof SymbolKind.Event
	public readonly range: VDFRange
	public readonly selectionRange: VDFRange
	public readonly children: HUDAnimationsStatementDocumentSymbols
	public readonly documentation?: string

	constructor(event: VDFToken, conditional: Extract<VDFToken, { type: VDFTokenType.Conditional }> | null, range: VDFRange, children: HUDAnimationsStatementDocumentSymbols, documentation?: string) {
		this.name = event.value + (conditional ? ` ${conditional.value}` : "")
		this.eventName = event.value
		this.eventNameRange = event.range
		this.conditional = conditional
		this.kind = SymbolKind.Event
		this.range = range
		this.selectionRange = range
		this.children = children
		this.documentation = documentation
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

	public toJSON(): DocumentSymbol {
		return {
			name: this.name,
			kind: this.kind,
			range: this.range,
			selectionRange: this.selectionRange,
		}
	}
}

export class AnimateDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.Animate
	constructor(
		public readonly element: string,
		public readonly elementRange: VDFRange,
		public readonly property: string,
		public readonly propertyRange: VDFRange,
		public readonly value: string,
		public readonly valueRange: VDFRange,
		public readonly interpolator: Interpolator,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		public readonly duration: number,
		public readonly durationRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`Animate ${element} ${property} ${value} ${interpolator} ${delay} ${duration}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class Linear {
	public readonly type = <const>"Linear"
	constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "Linear"
	}
}

export class Accel {
	public readonly type = <const>"Accel"
	constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "Accel"
	}
}

export class DeAccel {
	public readonly type = <const>"DeAccel"
	constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "DeAccel"
	}
}

export class Spline {
	public readonly type = <const>"Spline"
	constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "Spline"
	}
}

export class Bounce {
	public readonly type = <const>"Bounce"
	constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "Bounce"
	}
}

export class Pulse {
	public readonly type = <const>"Pulse"
	public constructor(
		public readonly range: VDFRange,
		public readonly frequency: string,
		public readonly frequencyRange: VDFRange,
	) { }
	public toString(): string {
		return `Pulse ${this.frequency}`
	}
}

export class Flicker {
	public readonly type = <const>"Flicker"
	public constructor(
		public readonly range: VDFRange,
		public readonly randomness: string,
		public readonly randomnessRange: VDFRange,
	) { }
	public toString(): string {
		return `Flicker ${this.randomness}`
	}
}

export class Gain {
	public readonly type = <const>"Gain"
	public constructor(
		public readonly range: VDFRange,
		public readonly bias: string,
		public readonly biasRange: VDFRange
	) { }
	public toString(): string {
		return `Gain ${this.bias}`
	}
}

export class Bias {
	public readonly type = <const>"Bias"
	public constructor(
		public readonly range: VDFRange,
		public readonly bias: string,
		public readonly biasRange: VDFRange
	) { }
	public toString(): string {
		return `Bias ${this.bias}`
	}
}

export type Interpolator = (
	| Linear
	| Accel
	| DeAccel
	| Spline
	| Bounce
	| Pulse
	| Flicker
	| Gain
	| Bias
)

export class RunEventDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.RunEvent

	constructor(
		public readonly event: string,
		public readonly eventRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`RunEvent ${event} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class StopEventDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.StopEvent

	constructor(
		public readonly event: string,
		public readonly eventRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`StopEvent ${event} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class SetVisibleDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetVisible

	constructor(
		public readonly element: string,
		public readonly elementRange: VDFRange,
		public readonly visible: boolean,
		public readonly visibleRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetVisible ${element} ${visible} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class FireCommandDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.FireCommand
	constructor(
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		public readonly command: string,
		public readonly commandRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`FireCommand ${delay} ${command}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class RunEventChildDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.RunEventChild
	constructor(
		public readonly element: string,
		public readonly elementRange: VDFRange,
		public readonly event: string,
		public readonly eventRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`RunEventChild ${element} ${event} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class SetInputEnabledDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetInputEnabled
	constructor(
		public readonly element: string,
		public readonly elementRange: VDFRange,
		public readonly enabled: boolean,
		public readonly enabledRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetInputEnabled ${element} ${enabled} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class PlaySoundDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.PlaySound
	constructor(
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		public readonly sound: string,
		public readonly soundRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`PlaySound ${delay} ${sound}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class StopPanelAnimationsDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.StopPanelAnimations
	constructor(
		public readonly element: string,
		public readonly elementRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`StopPanelAnimations ${element} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class StopAnimationDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.StopAnimation
	constructor(
		public readonly element: string,
		public readonly elementRange: VDFRange,
		public readonly property: string,
		public readonly propertyRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`StopAnimation ${element} ${property} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class SetFontDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetFont
	constructor(
		public readonly element: string,
		public readonly elementRange: VDFRange,
		public readonly property: string,
		public readonly propertyRange: VDFRange,
		public readonly font: string,
		public readonly fontRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetFont ${element} ${property} ${font} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class SetTextureDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetTexture
	constructor(
		public readonly element: string,
		public readonly elementRange: VDFRange,
		public readonly property: string,
		public readonly propertyRange: VDFRange,
		public readonly value: string,
		public readonly valueRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetTexture ${element} ${property} ${value} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export class SetStringDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetString
	constructor(
		public readonly element: string,
		public readonly elementRange: VDFRange,
		public readonly property: string,
		public readonly propertyRange: VDFRange,
		public readonly value: string,
		public readonly valueRange: VDFRange,
		public readonly delay: number,
		public readonly delayRange: VDFRange,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetString ${element} ${property} ${value} ${delay}` + (conditional ? ` ${conditional}` : ""), range)
	}
}

export type HUDAnimationsStatementDocumentSymbol = AnimateDocumentSymbol | RunEventDocumentSymbol | StopEventDocumentSymbol | SetVisibleDocumentSymbol | FireCommandDocumentSymbol | RunEventChildDocumentSymbol | SetInputEnabledDocumentSymbol | PlaySoundDocumentSymbol | StopPanelAnimationsDocumentSymbol | StopAnimationDocumentSymbol | SetFontDocumentSymbol | SetTextureDocumentSymbol | SetStringDocumentSymbol
