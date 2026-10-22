// oxlint-disable typescript/parameter-properties
import type { VDFRange, VDFToken, VDFTokenType } from "vdf"
import type { VDFText } from "vdf-documentsymbols"
import { DocumentSymbol, SymbolKind } from "vscode-languageserver"
import type { HUDAnimationsStatementDocumentSymbols } from "./HUDAnimationsDocumentSymbols"

export class HUDAnimationsEventDocumentSymbol implements DocumentSymbol {

	/** @deprecated Use {@link eventName} */
	public readonly name: string
	public readonly eventName: VDFText
	public readonly conditional: { value: `[${string}]`, range: VDFRange } | null
	public readonly kind: typeof SymbolKind.Event
	public readonly range: VDFRange
	public readonly selectionRange: VDFRange
	public readonly children: HUDAnimationsStatementDocumentSymbols
	public readonly documentation?: string

	public constructor(event: VDFText, conditional: Extract<VDFToken, { type: VDFTokenType.Conditional }> | null, range: VDFRange, children: HUDAnimationsStatementDocumentSymbols, documentation?: string) {
		// oxlint-disable-next-line typescript/no-deprecated
		this.name = `${event.text}${conditional ? ` ${conditional.value}` : ""}`
		this.eventName = event
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

	public constructor(name: string, range: VDFRange) {
		// oxlint-disable-next-line typescript/no-deprecated
		this.name = name
		this.kind = SymbolKind.Variable
		this.range = range
		this.selectionRange = range
	}

	public toJSON(): DocumentSymbol {
		return {
			// oxlint-disable-next-line typescript/no-deprecated
			name: this.name,
			kind: this.kind,
			range: this.range,
			selectionRange: this.selectionRange,
		}
	}
}

export class AnimateDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.Animate
	public constructor(
		public readonly element: VDFText,
		public readonly property: VDFText,
		public readonly value: VDFText,
		public readonly interpolator: Interpolator,
		public readonly delay: VDFText,
		public readonly duration: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`Animate ${element.text} ${property.text} ${value.text} ${interpolator.toString()} ${delay.text} ${duration.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class Linear {
	public readonly type = <const>"Linear"
	public constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "Linear"
	}
}

export class Accel {
	public readonly type = <const>"Accel"
	public constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "Accel"
	}
}

export class DeAccel {
	public readonly type = <const>"DeAccel"
	public constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "DeAccel"
	}
}

export class Spline {
	public readonly type = <const>"Spline"
	public constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "Spline"
	}
}

export class Bounce {
	public readonly type = <const>"Bounce"
	public constructor(public readonly range: VDFRange) { }
	public toString(): string {
		return "Bounce"
	}
}

export class Pulse {
	public readonly type = <const>"Pulse"
	public constructor(
		public readonly range: VDFRange,
		public readonly frequency: VDFText,
	) { }
	public toString(): string {
		return `Pulse ${this.frequency.text}`
	}
}

export class Flicker {
	public readonly type = <const>"Flicker"
	public constructor(
		public readonly range: VDFRange,
		public readonly randomness: VDFText,
	) { }
	public toString(): string {
		return `Flicker ${this.randomness.text}`
	}
}

export class Gain {
	public readonly type = <const>"Gain"
	public constructor(
		public readonly range: VDFRange,
		public readonly bias: VDFText,
	) { }
	public toString(): string {
		return `Gain ${this.bias.text}`
	}
}

export class Bias {
	public readonly type = <const>"Bias"
	public constructor(
		public readonly range: VDFRange,
		public readonly bias: VDFText,
	) { }
	public toString(): string {
		return `Bias ${this.bias.text}`
	}
}

export class Unknown {
	public readonly type = <const>"Unknown"
	public constructor(public readonly range: VDFRange, public readonly value: VDFText) { }
	public toString(): string {
		return this.value.text
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
	| Unknown
)

export class RunEventDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.RunEvent

	public constructor(
		public readonly event: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`RunEvent ${event.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class StopEventDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.StopEvent

	public constructor(
		public readonly event: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`StopEvent ${event.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class SetVisibleDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetVisible

	public constructor(
		public readonly element: VDFText,
		public readonly visible: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetVisible ${element.text} ${visible.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class FireCommandDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.FireCommand
	public constructor(
		public readonly delay: VDFText,
		public readonly command: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`FireCommand ${delay.text} ${command.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class RunEventChildDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.RunEventChild
	public constructor(
		public readonly element: VDFText,
		public readonly event: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`RunEventChild ${element.text} ${event.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class SetInputEnabledDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetInputEnabled
	public constructor(
		public readonly element: VDFText,
		public readonly enabled: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetInputEnabled ${element.text} ${enabled.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class PlaySoundDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.PlaySound
	public constructor(
		public readonly delay: VDFText,
		public readonly sound: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`PlaySound ${delay.text} ${sound.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class StopPanelAnimationsDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.StopPanelAnimations
	public constructor(
		public readonly element: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`StopPanelAnimations ${element.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class StopAnimationDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.StopAnimation
	public constructor(
		public readonly element: VDFText,
		public readonly property: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`StopAnimation ${element.text} ${property.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class SetFontDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetFont
	public constructor(
		public readonly element: VDFText,
		public readonly property: VDFText,
		public readonly font: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetFont ${element.text} ${property.text} ${font.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class SetTextureDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetTexture
	public constructor(
		public readonly element: VDFText,
		public readonly property: VDFText,
		public readonly value: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetTexture ${element.text} ${property.text} ${value.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export class SetStringDocumentSymbol extends HUDAnimationsStatementDocumentSymbolBase {
	public readonly type = HUDAnimationStatementType.SetString
	public constructor(
		public readonly element: VDFText,
		public readonly property: VDFText,
		public readonly value: VDFText,
		public readonly delay: VDFText,
		conditional: `[${string}]` | null,
		range: VDFRange
	) {
		super(`SetString ${element.text} ${property.text} ${value.text} ${delay.text}${conditional ? ` ${conditional}` : ""}`, range)
	}
}

export type HUDAnimationsStatementDocumentSymbol = AnimateDocumentSymbol | RunEventDocumentSymbol | StopEventDocumentSymbol | SetVisibleDocumentSymbol | FireCommandDocumentSymbol | RunEventChildDocumentSymbol | SetInputEnabledDocumentSymbol | PlaySoundDocumentSymbol | StopPanelAnimationsDocumentSymbol | StopAnimationDocumentSymbol | SetFontDocumentSymbol | SetTextureDocumentSymbol | SetStringDocumentSymbol
