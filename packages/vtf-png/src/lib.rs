use std::{cmp, io::Cursor};

use base64::{Engine, engine::general_purpose};
use image::{ColorType, DynamicImage, ImageFormat, RgbaImage};
use vtf::{VTF, VTFData, VTFExtractError};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(js_name = "VTFToPNG")]
pub fn vtf_to_png(vtf: &VTF, size: u16) -> Result<Vec<u8>, VTFExtractError> {
    let mipmap_index = match vtf.header.mipmap_count {
        1 => 0,
        _ => vtf
            .mipmaps
            .as_ref()
            .map_err(|err| err.clone())?
            .iter()
            .enumerate()
            .rev()
            .find_map(|(index, mipmap)| (cmp::max(mipmap.width, mipmap.height) <= size).then_some(index))
            .unwrap_or(0),
    };

    let VTFData { width, height, rgba } = vtf.extract(mipmap_index, 0)?;
    let mut out = vec![];

    if cmp::max(width, height) > size {
        let image_buffer = RgbaImage::from_vec(width as u32, height as u32, rgba).unwrap();
        let thumbnail = DynamicImage::ImageRgba8(image_buffer).thumbnail(512, 512);
        thumbnail.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).unwrap();
    } else {
        image::write_buffer_with_format(
            &mut Cursor::new(&mut out),
            &rgba,
            width as u32,
            height as u32,
            ColorType::Rgba8,
            ImageFormat::Png,
        )
        .unwrap();
    };

    Ok(out)
}

#[wasm_bindgen(js_name = "VTFToPNGBase64")]
pub fn vtf_to_png_base64(vtf: &VTF, size: u16) -> Result<String, VTFExtractError> {
    vtf_to_png(vtf, size).map(|out| format!("![](data:image/png;base64,{})", general_purpose::STANDARD.encode(out)))
}
