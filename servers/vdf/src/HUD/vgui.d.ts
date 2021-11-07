declare namespace vgui {

	type Bool = Int
	type Color = string
	type Float = number
	type Image = string
	type Int = number

	class AnalogBar extends Panel {
		analogValue: Float
		variable: string
	}

	class Panel {
		xpos: Int
		ypos: Int
		zpos: Int
		navUp: string
		navDown: string
		navLeft: string
		navRight: string
		navToRelay: string
		navActivate: string
		navBack: string
		IgnoreScheme: Int
		visible: Int
		enabled: Int
		mouseinputenabled: Int
		tabPosition: Int
		tooltiptext: string
		paintbackground: Int
		paintborder: Int
		border: string
		fieldName: string
		actionsignallevel: string
		ForceStereoRenderToFrameBuffer: Bool
		RoundedCorners: Int
		pin_to_sibling: string
		pin_corner_to_sibling: string
		pin_to_sibling_corner: string
		keyboardinputenabled: Bool
	}

	class Label extends Panel {

	}

	class Button extends Label { }

	class CExButton extends Button {
		border_default: string
		border_armed: string
		border_disabled: string
		border_selected: string
	}

	class CExImagebutton extends CExButton {
		image_drawcolor: Color
		image_armedcolor: Color
		image_depressedcolor: Color
		image_disabledcolor: Color
		image_selectedcolor: Color
		image_default: Image
		image_armed: Image
		image_selected: Image
	}

	class RichText { }

	class CExRichText extends RichText { }

	class CRichTextWithScrollbarBorders extends CExRichText { }
}