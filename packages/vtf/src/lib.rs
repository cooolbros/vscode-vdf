use vtf::{VTFData, VTFError, VTF};
use wasm_bindgen::{prelude::wasm_bindgen, Clamped};
use web_sys::{CanvasRenderingContext2d, ImageData};

pub mod vtf;

#[wasm_bindgen]
impl VTF {
    #[wasm_bindgen(js_name = "putImageData")]
    pub fn put_image_data(self, context: &CanvasRenderingContext2d, mipmap_index: usize, frame_index: usize) -> Result<(), VTFError> {
        let VTFData { width, height, rgba } = self.extract(mipmap_index, frame_index)?;
        let data = ImageData::new_with_u8_clamped_array_and_sh(Clamped(&rgba), width as u32, height as u32).unwrap();
        context.put_image_data(&data, 0.0, 0.0).unwrap();
        Ok(())
    }
}
