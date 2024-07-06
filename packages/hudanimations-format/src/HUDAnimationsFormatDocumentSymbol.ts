import type { HUDAnimationStatementType } from "hudanimations-documentsymbols"

export interface HUDAnimationsFormatDocumentSymbol {
	comment?: string
	event?: HUDAnimationsFormatEventDocumentSymbol
}

export interface HUDAnimationsFormatEventDocumentSymbol {
	name: string
	conditional?: string
	comment?: string
	animations: (Animation | { comment?: string })[]
}

/**
 * HUD Animations Format Document Symbol Base
 */
export interface StatementBase {
	conditional?: string
	comment?: string
}

/**
 * HUD Animations Format Animate Document Symbol
 */
export interface Animate extends StatementBase {
	type: HUDAnimationStatementType.Animate
	element: string
	property: string
	value: string
	interpolator: FormatInterpolator
	delay: string
	duration: string
}

/**
 * HUD Animations Format RunEvent Document Symbol
 */
export interface RunEvent extends StatementBase {
	type: HUDAnimationStatementType.RunEvent
	event: string
	delay: string
}

/**
 * HUD Animations Format StopEvent Document Symbol
 */
export interface StopEvent extends StatementBase {
	type: HUDAnimationStatementType.StopEvent
	event: string
	delay: string
}

/**
 * HUD Animations Format SetVisible Document Symbol
 */
export interface SetVisible extends StatementBase {
	type: HUDAnimationStatementType.SetVisible
	element: string
	visible: string
	delay: string
}

/**
 * HUD Animations Format FireCommand Document Symbol
 */
export interface FireCommand extends StatementBase {
	type: HUDAnimationStatementType.FireCommand
	delay: string
	command: string
}

/**
 * HUD Animations Format RunEventChild Document Symbol
 */
export interface RunEventChild extends StatementBase {
	type: HUDAnimationStatementType.RunEventChild
	element: string
	event: string
	delay: string
}

/**
 * HUD Animations Format SetInputEnabled Document Symbol
 */
export interface SetInputEnabled extends StatementBase {
	type: HUDAnimationStatementType.SetInputEnabled
	element: string
	enabled: string
	delay: string
}

/**
 * HUD Animations Format PlaySound Document Symbol
 */
export interface PlaySound extends StatementBase {
	type: HUDAnimationStatementType.PlaySound
	delay: string
	sound: string
}

/**
 * HUD Animations Format StopPanelAnimations Document Symbol
 */
export interface StopPanelAnimations extends StatementBase {
	type: HUDAnimationStatementType.StopPanelAnimations
	element: string
	delay: string
}

export interface StopAnimation extends StatementBase {
	type: HUDAnimationStatementType.StopAnimation
	element: string
	property: string
	delay: string
}

export interface SetFont extends StatementBase {
	type: HUDAnimationStatementType.SetFont
	element: string
	property: string
	value: string
	delay: string
}

export interface SetTexture extends StatementBase {
	type: HUDAnimationStatementType.SetTexture
	element: string
	property: string
	value: string
	delay: string
}

export interface SetString extends StatementBase {
	type: HUDAnimationStatementType.SetString
	element: string
	property: string
	value: string
	delay: string
}

type Animations = {
	"Animate": Animate
	"RunEvent": RunEvent
	"StopEvent": StopEvent
	"SetVisible": SetVisible
	"FireCommand": FireCommand
	"RunEventChild": RunEventChild
	"SetInputEnabled": SetInputEnabled
	"PlaySound": PlaySound
	"StopPanelAnimations": StopPanelAnimations
	"StopAnimation": StopAnimation
	"SetFont": SetFont
	"SetTexture": SetTexture
	"SetString": SetString
}

export type Animation = Animations[keyof Animations]


export interface AccelInterpolator {
	type: "Accel"
}

export interface BiasInterpolator {
	type: "Bias"
	bias: string
}

export interface BounceInterpolator {
	type: "Bounce"
}

export interface DeAccelInterpolator {
	type: "DeAccel"
}

export interface FlickerInterpolator {
	type: "Flicker"
	randomness: string
}

export interface GainInterpolator {
	type: "Gain"
	bias: string
}

export interface LinearInterpolator {
	type: "Linear"
}

export interface PulseInterpolator {
	type: "Pulse"
	frequency: string
}

export interface SplineInterpolator {
	type: "Spline"
}

type FormatInterpolators = {
	"Accel": AccelInterpolator
	"Bias": BiasInterpolator
	"Bounce": BounceInterpolator
	"DeAccel": DeAccelInterpolator
	"Flicker": FlickerInterpolator
	"Gain": GainInterpolator
	"Linear": LinearInterpolator
	"Pulse": PulseInterpolator
	"Spline": SplineInterpolator
}

export type FormatInterpolator = FormatInterpolators[keyof FormatInterpolators]
