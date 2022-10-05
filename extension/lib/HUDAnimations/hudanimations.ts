// HUD Animations

export type File = { [key: string]: Event }
export type Event = HUDAnimation[]

export const Commands = <const>["Animate", "RunEvent", "StopEvent", "SetVisible", "FireCommand", "RunEventChild", "SetInputEnabled", "PlaySound", "StopPanelAnimations"]

export type Command = typeof Commands[number]

export const Interpolators = <const>["Linear", "Accel", "Deaccel", "Spline", "Pulse", "Flicker", "Gain", "Bias", "Bounce"]

export type Interpolator = typeof Interpolators[number]

export type Bit = 0 | 1

export interface HUDAnimation<T extends Command = Command> {
	readonly type: T
	readonly osTag?: `[${string}]`
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

export type HUDAnimationTypes = {
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

export function animationIsType<T extends Command>(animation: HUDAnimation<Command>, animationType: T): animation is HUDAnimationTypes[T] {
	return animation.type == animationType
}
