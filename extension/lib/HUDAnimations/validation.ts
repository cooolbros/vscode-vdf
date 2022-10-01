import { UnexpectedTokenError } from "../../VDF/dist/VDFErrors"
import { parserTools } from "../../VDF/dist/VDFParserTools"
import { VDFTokeniser } from "../../VDF/dist/VDFTokeniser"
import { Bit, Command, Commands, Interpolator, Interpolators } from "./hudanimations"

export const HUDAnimationsValidation = {
	/**
	 * Assert that a given string is an animation command
	 * @param str String
	 * @param tokeniser tokeniser to retrieve token Range from if the string is invalid
	 * @returns Animation Command
	 */
	validateAnimationCommand: ([str, quoted]: [string, 0 | 1], tokeniser: VDFTokeniser): Command => {
		const _animationType = str.toLowerCase()
		const result = Commands.find(command => command.toLowerCase() == _animationType)
		if (result == undefined) {
			throw new UnexpectedTokenError(str, `"${Commands.join(`" | "`)}"`, parserTools.calculate.tokenRange([str, quoted], tokeniser.line, tokeniser.character))
		}
		return result
	},
	validateInterpolator: ([str, quoted]: [string, 0 | 1], tokeniser: VDFTokeniser): Interpolator => {
		const _interpolatorType = str.toLowerCase()
		const result = Interpolators.find(interpolator => interpolator.toLowerCase() == _interpolatorType)
		if (result == undefined) {
			throw new UnexpectedTokenError(str, `"${Interpolators.join(`" | "`)}"`, parserTools.calculate.tokenRange([str, quoted], tokeniser.line, tokeniser.character))
		}
		return result
	},
	validateNaN: ([str, quoted]: [string, 0 | 1], tokeniser: VDFTokeniser): number => {
		const result = parseFloat(str)
		if (isNaN(result)) {
			throw new UnexpectedTokenError(str, "number", parserTools.calculate.tokenRange([str, quoted], tokeniser.line, tokeniser.character))
		}
		return result
	},
	validateBit: ([str, quoted]: [string, 0 | 1], tokeniser: VDFTokeniser): Bit => {
		const result = parseInt(str)
		if (isNaN(result) || (result != 0 && result != 1)) {
			throw new UnexpectedTokenError(str, `0 | 1`, parserTools.calculate.tokenRange([str, quoted], tokeniser.line, tokeniser.character))
		}
		return result
	}
}
