use std::{cmp, io::Cursor};

use base64::{Engine, engine::general_purpose};
use image::{ColorType, DynamicImage, ImageFormat, RgbaImage};
use vtf::{VTF, VTFData, VTFError};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(js_name = "VTFToPNG")]
pub fn vtf_to_png(vtf: VTF, size: u16) -> Result<String, VTFError> {
    match &vtf.mipmaps {
        Ok(mipmaps) => {
            let mipmap_index = if vtf.header.mipmap_count == 1 {
                0
            } else {
                mipmaps
                    .iter()
                    .enumerate()
                    .rev()
                    .find_map(|(index, mipmap)| (cmp::max(mipmap.width, mipmap.height) <= size).then(|| index))
                    .unwrap_or(0)
            };

            let VTFData { width, height, rgba } = vtf.extract(mipmap_index, 0)?;
            let mut out = vec![];

            if cmp::max(width, height) > size {
                let image_buffer = RgbaImage::from_vec(width as u32, height as u32, rgba).unwrap();
                let thumbnail = DynamicImage::ImageRgba8(image_buffer).thumbnail(512, 512);
                thumbnail.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).unwrap();
            } else {
                image::write_buffer_with_format(&mut Cursor::new(&mut out), &rgba, width as u32, height as u32, ColorType::Rgba8, ImageFormat::Png).unwrap();
            };

            Ok(String::from("data:image/png;base64,") + &general_purpose::STANDARD.encode(out))
        }
        Err(_) => Err(vtf.mipmaps.unwrap_err()),
    }
}
