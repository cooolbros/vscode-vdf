use vtf::{VTF, VTFData, VTFError};
use wasm_bindgen::prelude::wasm_bindgen;
use web_sys::{CanvasRenderingContext2d, ImageData, wasm_bindgen::Clamped};

#[wasm_bindgen(js_name = "VTFPutImageData")]
pub fn vtf_put_image_data(vtf: &VTF, context: &CanvasRenderingContext2d, mipmap_index: usize, frame_index: usize) -> Result<(), VTFError> {
    let VTFData { width, height, rgba } = vtf.extract(mipmap_index, frame_index)?;
    let data = ImageData::new_with_u8_clamped_array_and_sh(Clamped(&rgba), width as u32, height as u32).unwrap();
    context.put_image_data(&data, 0.0, 0.0).unwrap();
    Ok(())
}
