import { DocumentSymbol, Position, SymbolKind } from "vscode-languageserver-types";
import { VDFTokeniser } from "../../../shared/vdf";
import { HUDAnimationsSyntaxError, HUDAnimationTypes } from "./hudanimations";

export function getDocumentInfo(str: string): { animations: HUDAnimationTypes.File, symbols: DocumentSymbol[] } {

	const result: ReturnType<typeof getDocumentInfo> = {
		animations: {},
		symbols: []
	}

	const tokeniser: VDFTokeniser = new VDFTokeniser(str)
	const parseFile = (): void => {
		let currentToken: string = tokeniser.next();
		if (currentToken != "event") {
			throw new HUDAnimationsSyntaxError(currentToken, tokeniser.position, tokeniser.line, tokeniser.character, `Expected "event"`)
		}
		while (currentToken.toLowerCase() == "event") {
			const startPosition = Position.create(tokeniser.line, tokeniser.character - "event".length)

			const eventName = tokeniser.next();

			if (eventName == "{") {
				throw new HUDAnimationsSyntaxError(eventName, tokeniser.position, tokeniser.line, tokeniser.character, "Expected event name")
			}

			result.animations[eventName] = []

			parseEvent(eventName);

			const endPosition = Position.create(tokeniser.line, tokeniser.character)

			result.symbols.push({
				name: eventName,
				kind: SymbolKind.Function,
				range: {
					start: startPosition,
					end: endPosition
				},
				selectionRange: {
					start: startPosition,
					end: endPosition
				}
			})

			// const e = events[events.length - 1]
			// connection?.console.log(`event ${e.name} starts at line ${e.range.start.line} and ends at line ${e.range.end.line}`)

			currentToken = tokeniser.next();
		}
	}

	const parseEvent = (eventName: string): void => {

		let nextToken: string = tokeniser.next();

		if (nextToken == "{") {
			while (nextToken != "}") {
				// NextToken is not a closing brace therefore it is the animation type.
				// Pass the animation type to the animation.
				nextToken = tokeniser.next();
				if (nextToken != "}") {
					result.animations[eventName].push(parseAnimation(eventName, nextToken))
				}

				if (nextToken == "EOF") {
					throw new HUDAnimationsSyntaxError("EOF", tokeniser.position, tokeniser.line, tokeniser.character, "Are you missing a close brace?")
				}
			}
		}
		else {
			throw new HUDAnimationsSyntaxError(nextToken, tokeniser.position, tokeniser.line, tokeniser.character, "Are you missing an opening brace?")
		}
	}

	const getInterpolator = (interpolator: string): { interpolator: HUDAnimationTypes.Interpolator, frequency?: number, bias?: number } => {
		interpolator = interpolator.toLowerCase()
		if (interpolator == "pulse") return { interpolator: "Pulse", frequency: parseFloat(tokeniser.next()) }
		if (interpolator == "gain" || interpolator == "bias") return { interpolator: interpolator == "gain" ? "Gain" : "Bias", bias: parseFloat(tokeniser.next()) }
		return { interpolator: HUDAnimationTypes.Interpolators.find(i => i.toLowerCase() == interpolator) ?? "Linear" }
	}

	const parseAnimation = (eventName: string, animationType: string): HUDAnimationTypes.HUDAnimation<keyof HUDAnimationTypes.Commands> => {
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

	parseFile()
	return result
}
