import { DocumentSymbol, _Connection } from "vscode-languageserver";
import { Position, Range, SymbolKind } from "vscode-languageserver-types";
import { VDFTokeniserOptions } from "../../VDF/dist/models/VDFTokeniserOptions";
import { parserTools } from "../../VDF/dist/VDFParserTools";
import { VDFTokeniser } from "../../VDF/dist/VDFTokeniser";
import { Command, CommandKeys, File, HUDAnimation, HUDAnimations, HUDAnimationsSyntaxError, Interpolators, sanitizeBit, sanitizeNaN, sanitizeString } from "./hudanimations";

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

export function getHUDAnimationsDocumentInfo(connection: _Connection, str: string, options?: VDFTokeniserOptions): { animations: File; symbols: HUDAnimationEventDocumentSymbol[]; } {

	const result: ReturnType<typeof getHUDAnimationsDocumentInfo> = {
		animations: {},
		symbols: []
	};

	const tokeniser = new VDFTokeniser(str, options);

	let currentToken = tokeniser.next().toLowerCase();

	if (currentToken == "eof") {
		return result;
	}

	if (currentToken != "event") {
		throw new HUDAnimationsSyntaxError(currentToken, tokeniser, `Expected "event"`);
	}

	let eventStartPosition = Position.create(tokeniser.line, tokeniser.character);

	while (currentToken == "event") {
		const eventName = tokeniser.next();
		if (eventName == "{") {
			throw new HUDAnimationsSyntaxError(eventName, tokeniser, "Expected event name");
		}

		const eventNameRange = Range.create(Position.create(tokeniser.line, tokeniser.character - eventName.length), Position.create(tokeniser.line, tokeniser.character));

		result.animations[eventName] = [];
		const eventAnimations: HUDAnimationStatementDocumentSymbol[] = [];

		let openingBrace = tokeniser.next();
		if (openingBrace != "{") {
			throw new HUDAnimationsSyntaxError(openingBrace, tokeniser, "Are you missing an opening brace?");
		}

		let animationCommand: string = tokeniser.next();

		while (animationCommand != "}") {
			const commandRange = Range.create(Position.create(tokeniser.line, tokeniser.character - animationCommand.length), Position.create(tokeniser.line, tokeniser.character));
			switch (sanitizeString(animationCommand, CommandKeys, tokeniser)) {
				case "Animate": {

					const element = tokeniser.next();
					// const elementRange = Range.create(Position.create(tokeniser.line, tokeniser.character - element.length), Position.create(tokeniser.line, tokeniser.character))
					const property = tokeniser.next();
					const value = tokeniser.next();
					const valueRange = Range.create(Position.create(tokeniser.line, tokeniser.character - value.length), Position.create(tokeniser.line, tokeniser.character));

					const interpolator = sanitizeString(tokeniser.next(), Interpolators, tokeniser);

					const frequency = interpolator == "Pulse" ? sanitizeNaN(tokeniser.next(), tokeniser) : undefined;
					const bias = (interpolator == "Gain" || interpolator == "Bias") ? sanitizeNaN(tokeniser.next(), tokeniser) : undefined;

					const delay = sanitizeNaN(tokeniser.next(), tokeniser);
					const duration = sanitizeNaN(tokeniser.next(), tokeniser);

					let osTag: `[${string}]` | undefined;
					if (parserTools.is.osTag(tokeniser.next(true))) {
						osTag = parserTools.convert.osTag(tokeniser.next());
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
					};
					result.animations[eventName].push(animation);
					eventAnimations.push({
						commandRange: commandRange,
						valueRange: valueRange,
						animation: animation
					});
					break;
				}
				case "RunEvent": {
					const referencedEventName = tokeniser.next();
					const eventRange = Range.create(
						Position.create(tokeniser.line, tokeniser.character - referencedEventName.length),
						Position.create(tokeniser.line, tokeniser.character)
					);
					const runEvent: HUDAnimations.RunEvent = {
						type: "RunEvent",
						event: referencedEventName,
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					};
					result.animations[eventName].push(runEvent);
					eventAnimations.push({
						commandRange: commandRange,
						eventRange: eventRange,
						animation: runEvent
					});
					break;
				}
				case "StopEvent": {
					const referencedEventName = tokeniser.next();
					const eventRange = Range.create(
						Position.create(tokeniser.line, tokeniser.character - referencedEventName.length),
						Position.create(tokeniser.line, tokeniser.character)
					);
					const stopEvent: HUDAnimations.StopEvent = {
						type: "StopEvent",
						event: referencedEventName,
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					};
					result.animations[eventName].push(stopEvent);
					eventAnimations.push({
						commandRange: commandRange,
						eventRange: eventRange,
						animation: stopEvent
					});
					break;
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
					};
					result.animations[eventName].push(setVisible);
					eventAnimations.push({
						commandRange: commandRange,
						animation: setVisible
					});
					break;
				}
				case "FireCommand": {
					const fireCommand: HUDAnimations.FireCommand = {
						type: "FireCommand",
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						command: tokeniser.next(),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					};
					result.animations[eventName].push(fireCommand);
					eventAnimations.push({
						commandRange: commandRange,
						animation: fireCommand
					});
					break;
				}
				case "RunEventChild": {
					const referencedElement = tokeniser.next();
					const referencedEventName = tokeniser.next();
					const eventRange = Range.create(
						Position.create(tokeniser.line, tokeniser.character - referencedEventName.length),
						Position.create(tokeniser.line, tokeniser.character)
					);

					const runEventChild: HUDAnimations.RunEventChild = {
						type: "RunEventChild",
						element: referencedElement,
						event: referencedEventName,
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					};
					result.animations[eventName].push(runEventChild);
					eventAnimations.push({
						commandRange: commandRange,
						eventRange: eventRange,
						animation: runEventChild
					});
					break;
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
					};
					result.animations[eventName].push(setInputEnabled);
					eventAnimations.push({
						commandRange: commandRange,
						animation: setInputEnabled
					});
					break;
				}
				case "PlaySound": {
					const playSound: HUDAnimations.PlaySound = {
						type: "PlaySound",
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						sound: tokeniser.next(),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					};
					result.animations[eventName].push(playSound);
					eventAnimations.push({
						commandRange: commandRange,
						animation: playSound
					});
					break;
				}
				case "StopPanelAnimations": {
					const stopPanelAnimations: HUDAnimations.StopPanelAnimations = {
						type: "StopPanelAnimations",
						element: tokeniser.next(),
						delay: sanitizeNaN(tokeniser.next(), tokeniser),
						...(parserTools.is.osTag(tokeniser.next(true)) && {
							osTag: parserTools.convert.osTag(tokeniser.next())
						})
					};
					result.animations[eventName].push(stopPanelAnimations);
					eventAnimations.push({
						commandRange: commandRange,
						animation: stopPanelAnimations
					});
					break;
				}
				default: {
					throw new HUDAnimationsSyntaxError(animationCommand, tokeniser, `Expected "${CommandKeys.join(`" | "`)}"`);
				}
			}

			animationCommand = tokeniser.next();
		}

		const eventEndPosition = Position.create(tokeniser.line, tokeniser.character);

		result.symbols.push({
			name: eventName,
			nameRange: eventNameRange,
			range: Range.create(eventStartPosition, eventEndPosition),
			selectionRange: Range.create(eventStartPosition, eventEndPosition),
			kind: SymbolKind.Event,
			// kind: SymbolKind.Function,
			animations: eventAnimations
		});

		currentToken = tokeniser.next();
		eventStartPosition = Position.create(tokeniser.line, tokeniser.character - "event".length);
	}

	return result;
}
