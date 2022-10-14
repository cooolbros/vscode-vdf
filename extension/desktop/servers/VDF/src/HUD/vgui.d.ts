declare namespace vgui {

	type Bool = Int
	type Color = string
	type Float = number
	type Image = string
	type Int = number

	class AnalogBar extends Panel {
		public analogValue: Float
		public variable: string
	}

	class Panel {
		public xpos: Int
		public ypos: Int
		public zpos: Int
		public navUp: string
		public navDown: string
		public navLeft: string
		public navRight: string
		public navToRelay: string
		public navActivate: string
		public navBack: string
		public IgnoreScheme: Int
		public visible: Int
		public enabled: Int
		public mouseinputenabled: Int
		public tabPosition: Int
		public tooltiptext: string
		public paintbackground: Int
		public paintborder: Int
		public border: string
		public fieldName: string
		public actionsignallevel: string
		public ForceStereoRenderToFrameBuffer: Bool
		public RoundedCorners: Int
		public pin_to_sibling: string
		public pin_corner_to_sibling: string
		public pin_to_sibling_corner: string
		public keyboardinputenabled: Bool
	}

	class Label extends Panel {

	}

	class Button extends Label { }

	class CExButton extends Button {
		public border_default: string
		public border_armed: string
		public border_disabled: string
		public border_selected: string
	}

	class CExImagebutton extends CExButton {
		public image_drawcolor: Color
		public image_armedcolor: Color
		public image_depressedcolor: Color
		public image_disabledcolor: Color
		public image_selectedcolor: Color
		public image_default: Image
		public image_armed: Image
		public image_selected: Image
	}

	class RichText { }

	class CExRichText extends RichText { }

	class CRichTextWithScrollbarBorders extends CExRichText { }
}
