use std::{
    fmt::Display,
    io::{BufReader, Cursor, Seek, SeekFrom},
};

use bincode::{
    error::{AllowedEnumVariants, DecodeError},
    impl_borrow_decode, Decode,
};
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[wasm_bindgen]
#[derive(Debug)]
pub struct VTF {
    #[wasm_bindgen(skip)]
    pub buf: Vec<u8>,
    pub header: VTFHeader,

    #[wasm_bindgen(skip)]
    pub resources: Option<Vec<VTFResourceEntryInfo>>,

    #[wasm_bindgen(skip)]
    pub mipmaps: Result<Vec<VTFMipMap>, VTFError>,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Decode)]
pub struct VTFHeader {
    pub signature: VTFSignature,
    pub version_major: u32,
    pub version_minor: u32,
    pub header_size: u32,
    pub width: u16,
    pub height: u16,
    pub flags: u32,
    pub frames: u16,
    pub first_frame: u16,
    _padding0: [u8; 4],
    _reflectivity: [f32; 3],
    _padding1: [u8; 4],
    pub bumpmap_scale: f32,
    pub high_res_image_format: VTFImageFormat,
    pub mipmap_count: u8,
    pub low_res_image_format: VTFImageFormat,
    pub low_res_image_width: u8,
    pub low_res_image_height: u8,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct VTFSignature;

impl Display for VTFSignature {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "VTF\0")
    }
}

impl Decode for VTFSignature {
    fn decode<D: bincode::de::Decoder>(decoder: &mut D) -> Result<Self, DecodeError> {
        match <[u8; 4] as bincode::Decode>::decode(decoder)? {
            [b'V', b'T', b'F', b'\0'] => Ok(VTFSignature),
            _ => Err(DecodeError::Other("VTF\0")),
        }
    }
}

impl_borrow_decode!(VTFSignature);

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum VTFImageFormat {
    None = -1,
    RGBA8888,
    ABGR8888,
    RGB888,
    BGR888,
    RGB565,
    I8,
    IA88,
    P8,
    A8,
    RGB888BlueScreen,
    BGR888BlueScreen,
    ARGB8888,
    BGRA8888,
    DXT1,
    DXT3,
    DXT5,
    BGRX8888,
    BGR565,
    BGRX5551,
    BGRA4444,
    DXT1OneBitAlpha,
    BGRA5551,
    UV88,
    UVWQ8888,
    RGBA16161616F,
    RGBA16161616,
    UVLX8888,
}

impl Decode for VTFImageFormat {
    fn decode<D: bincode::de::Decoder>(decoder: &mut D) -> Result<Self, DecodeError> {
        let variant_value = <i32 as bincode::Decode>::decode(decoder)?;
        match variant_value {
            -1 => Ok(VTFImageFormat::None),
            0 => Ok(VTFImageFormat::RGBA8888),
            1 => Ok(VTFImageFormat::ABGR8888),
            2 => Ok(VTFImageFormat::RGB888),
            3 => Ok(VTFImageFormat::BGR888),
            4 => Ok(VTFImageFormat::RGB565),
            5 => Ok(VTFImageFormat::I8),
            6 => Ok(VTFImageFormat::IA88),
            7 => Ok(VTFImageFormat::P8),
            8 => Ok(VTFImageFormat::A8),
            9 => Ok(VTFImageFormat::RGB888BlueScreen),
            10 => Ok(VTFImageFormat::BGR888BlueScreen),
            11 => Ok(VTFImageFormat::ARGB8888),
            12 => Ok(VTFImageFormat::BGRA8888),
            13 => Ok(VTFImageFormat::DXT1),
            14 => Ok(VTFImageFormat::DXT3),
            15 => Ok(VTFImageFormat::DXT5),
            16 => Ok(VTFImageFormat::BGRX8888),
            17 => Ok(VTFImageFormat::BGR565),
            18 => Ok(VTFImageFormat::BGRX5551),
            19 => Ok(VTFImageFormat::BGRA4444),
            20 => Ok(VTFImageFormat::DXT1OneBitAlpha),
            21 => Ok(VTFImageFormat::BGRA5551),
            22 => Ok(VTFImageFormat::UV88),
            23 => Ok(VTFImageFormat::UVWQ8888),
            24 => Ok(VTFImageFormat::RGBA16161616F),
            25 => Ok(VTFImageFormat::RGBA16161616),
            26 => Ok(VTFImageFormat::UVLX8888),
            variant => Err(DecodeError::UnexpectedVariant {
                type_name: "VTFImageFormat",
                allowed: &AllowedEnumVariants::Range { min: 0, max: 26 },
                found: variant as u32,
            }),
        }
    }
}

impl_borrow_decode!(VTFImageFormat);

impl VTFImageFormat {
    pub fn bytes(&self, width: usize, height: usize) -> Result<usize, VTFImageFormat> {
        match self {
            VTFImageFormat::None => Err(VTFImageFormat::None),
            VTFImageFormat::RGBA8888 => Ok(width * height * 4),
            VTFImageFormat::ABGR8888 => Ok(width * height * 4),
            VTFImageFormat::RGB888 => Ok(width * height * 3),
            VTFImageFormat::BGR888 => Ok(width * height * 3),
            VTFImageFormat::RGB565 => Err(VTFImageFormat::RGB565),
            VTFImageFormat::I8 => Ok(width * height),
            VTFImageFormat::IA88 => Err(VTFImageFormat::IA88),
            VTFImageFormat::P8 => Err(VTFImageFormat::P8),
            VTFImageFormat::A8 => Ok(width * height),
            VTFImageFormat::RGB888BlueScreen => Ok(width * height * 3),
            VTFImageFormat::BGR888BlueScreen => Ok(width * height * 3),
            VTFImageFormat::ARGB8888 => Ok(width * height * 4),
            VTFImageFormat::BGRA8888 => Ok(width * height * 4),
            VTFImageFormat::DXT1 => Ok(texpresso::Format::Bc1.compressed_size(width, height)),
            VTFImageFormat::DXT3 => Ok(texpresso::Format::Bc2.compressed_size(width, height)),
            VTFImageFormat::DXT5 => Ok(texpresso::Format::Bc3.compressed_size(width, height)),
            VTFImageFormat::BGRX8888 => Err(VTFImageFormat::BGRX8888),
            VTFImageFormat::BGR565 => Err(VTFImageFormat::BGR565),
            VTFImageFormat::BGRX5551 => Err(VTFImageFormat::BGRX5551),
            VTFImageFormat::BGRA4444 => Err(VTFImageFormat::BGRA4444),
            VTFImageFormat::DXT1OneBitAlpha => Err(VTFImageFormat::DXT1OneBitAlpha),
            VTFImageFormat::BGRA5551 => Err(VTFImageFormat::BGRA5551),
            VTFImageFormat::UV88 => Err(VTFImageFormat::UV88),
            VTFImageFormat::UVWQ8888 => Err(VTFImageFormat::UVWQ8888),
            VTFImageFormat::RGBA16161616F => Err(VTFImageFormat::RGBA16161616F),
            VTFImageFormat::RGBA16161616 => Err(VTFImageFormat::RGBA16161616),
            VTFImageFormat::UVLX8888 => Err(VTFImageFormat::UVLX8888),
        }
    }
}

#[derive(Debug, Decode)]
pub struct VTFResourceEntryInfo {
    _tag: [u8; 3],
    pub flags: u8,
    pub offset: u32,
}

#[derive(Debug)]
pub struct VTFMipMap {
    pub width: u16,
    pub height: u16,
    pub frames: Vec<VTFFrame>,
}

#[derive(Debug)]
pub struct VTFFrame {
    pub offset: usize,
    pub bytes: usize,
}

#[derive(Debug)]
pub struct VTFDecodeError(DecodeError);

impl Display for VTFDecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:#?}", self)
    }
}

impl From<DecodeError> for VTFDecodeError {
    fn from(value: DecodeError) -> Self {
        VTFDecodeError(value)
    }
}

impl From<VTFDecodeError> for JsValue {
    fn from(value: VTFDecodeError) -> Self {
        JsValue::from(JsError::new(&format!("{:?}", value.0)))
    }
}

#[derive(Debug)]
pub struct VTFData {
    pub width: u16,
    pub height: u16,
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone)]
pub enum VTFError {
    FormatError(VTFImageFormat),
    UnexpectedEnd { additional: usize },
    UnexpectedMipMap { mipmap_count: u8, found: usize },
    UnexpectedFrame { frame_count: u16, found: usize },
}

impl From<VTFImageFormat> for VTFError {
    fn from(value: VTFImageFormat) -> Self {
        VTFError::FormatError(value)
    }
}

impl From<usize> for VTFError {
    fn from(value: usize) -> Self {
        VTFError::UnexpectedEnd { additional: value }
    }
}

impl From<VTFError> for JsValue {
    fn from(value: VTFError) -> Self {
        JsValue::from(JsError::new(&format!("{:?}", value)))
    }
}

#[wasm_bindgen]
impl VTF {
    #[wasm_bindgen(constructor)]
    pub fn new(buf: Vec<u8>) -> Result<VTF, VTFDecodeError> {
        let mut reader = BufReader::new(Cursor::new(&buf));
        let config = bincode::config::standard().with_fixed_int_encoding();

        let header: VTFHeader = bincode::decode_from_reader(&mut reader, config)?;
        console_log!("{:#?}", header);

        if header.version_major >= 7 && header.version_minor >= 2 {
            let _depth: u16 = bincode::decode_from_reader(&mut reader, config)?;
        }

        let num_resources_option = if header.version_major >= 7 && header.version_minor >= 3 {
            let _padding2: [u8; 3] = bincode::decode_from_reader(&mut reader, config)?;
            let num_resources: u32 = bincode::decode_from_reader(&mut reader, config)?;
            Some(num_resources)
        } else {
            None
        };

        let _padding3: [u8; 8] = bincode::decode_from_reader(&mut reader, config)?;

        let resources = match num_resources_option {
            Some(num_resources) => Some(
                (0..num_resources)
                    .map(|_| bincode::decode_from_reader::<VTFResourceEntryInfo, _, _>(&mut reader, config))
                    .collect::<Result<Vec<VTFResourceEntryInfo>, DecodeError>>()?,
            ),
            None => None,
        };

        reader.seek(SeekFrom::Start(header.header_size as u64)).map_err(|_| DecodeError::UnexpectedEnd {
            additional: header.header_size as usize,
        })?;

        let thumbnail_bytes = texpresso::Format::Bc1.compressed_size(header.low_res_image_width as usize, header.low_res_image_height as usize);
        reader
            .seek_relative(thumbnail_bytes as i64)
            .map_err(|_| DecodeError::UnexpectedEnd { additional: thumbnail_bytes })?;

        let mipmaps = (0..header.mipmap_count)
            .rev()
            .map(|i| -> Result<VTFMipMap, VTFError> {
                let width = (header.width as usize >> i).max(1);
                let height = (header.height as usize >> i).max(1);

                let bytes = header.high_res_image_format.bytes(width, height)?;

                let frames = (0..header.frames)
                    .map(|_| {
                        let offset = reader.stream_position().unwrap() as usize;
                        reader.seek_relative(bytes as i64).map_err(|_| bytes)?;
                        Ok(VTFFrame { offset, bytes })
                    })
                    .collect::<Result<Vec<VTFFrame>, VTFError>>()?;

                Ok(VTFMipMap {
                    width: width as u16,
                    height: height as u16,
                    frames,
                })
            })
            .collect::<Result<Vec<VTFMipMap>, VTFError>>();

        Ok(VTF { buf, header, resources, mipmaps })
    }
}

impl VTF {
    pub fn extract(&self, mipmap_index: usize, frame_index: usize) -> Result<VTFData, VTFError> {
        let mipmaps = self.mipmaps.as_ref().map_err(|err| err.clone())?;

        let mipmap = mipmaps.get(mipmap_index).ok_or(VTFError::UnexpectedMipMap {
            mipmap_count: self.header.mipmap_count,
            found: mipmap_index,
        })?;

        let frame = mipmap.frames.get(frame_index).ok_or(VTFError::UnexpectedFrame {
            frame_count: self.header.frames,
            found: frame_index,
        })?;

        let buf = self.buf.get(frame.offset..(frame.offset + frame.bytes)).ok_or(frame.bytes)?;

        let mut rgba = vec![0; mipmap.width as usize * mipmap.height as usize * 4];

        match self.header.high_res_image_format {
            VTFImageFormat::RGBA8888 => {
                rgba.copy_from_slice(buf);
            }
            VTFImageFormat::ABGR8888 => {
                let mut i = 0;
                for chunk in buf.chunks_exact(4) {
                    rgba[i] = chunk[3];
                    rgba[i + 1] = chunk[2];
                    rgba[i + 2] = chunk[1];
                    rgba[i + 3] = chunk[0];
                    i += 4;
                }
            }
            VTFImageFormat::RGB888 => {
                let mut i = 0;
                for chunk in buf.chunks_exact(3) {
                    rgba[i] = chunk[0];
                    rgba[i + 1] = chunk[1];
                    rgba[i + 2] = chunk[2];
                    rgba[i + 3] = 255;
                    i += 4;
                }
            }
            VTFImageFormat::BGR888 => {
                let mut i = 0;
                for chunk in buf.chunks_exact(3) {
                    rgba[i] = chunk[2];
                    rgba[i + 1] = chunk[1];
                    rgba[i + 2] = chunk[0];
                    rgba[i + 3] = 255;
                    i += 4;
                }
            }
            VTFImageFormat::I8 => {
                let mut i = 0;
                for byte in buf {
                    rgba[i] = *byte;
                    rgba[i + 1] = *byte;
                    rgba[i + 2] = *byte;
                    rgba[i + 3] = 255;
                    i += 4;
                }
            }
            VTFImageFormat::A8 => {
                let mut i = 0;
                for byte in buf {
                    rgba[i] = 0;
                    rgba[i + 1] = 0;
                    rgba[i + 2] = 0;
                    rgba[i + 3] = *byte;
                    i += 4;
                }
            }
            VTFImageFormat::RGB888BlueScreen => {
                let mut i = 0;
                for chunk in buf.chunks_exact(3) {
                    if chunk != [0, 0, 255] {
                        rgba[i] = chunk[0];
                        rgba[i + 1] = chunk[1];
                        rgba[i + 2] = chunk[2];
                        rgba[i + 3] = 255;
                    }
                    i += 4;
                }
            }
            VTFImageFormat::BGR888BlueScreen => {
                let mut i = 0;
                for chunk in buf.chunks_exact(3) {
                    if chunk != [255, 0, 0] {
                        rgba[i] = chunk[2];
                        rgba[i + 1] = chunk[1];
                        rgba[i + 2] = chunk[0];
                        rgba[i + 3] = 255;
                    }
                    i += 4;
                }
            }
            VTFImageFormat::ARGB8888 => {
                let mut i = 0;
                for chunk in buf.chunks_exact(4) {
                    rgba[i] = chunk[1];
                    rgba[i + 1] = chunk[2];
                    rgba[i + 2] = chunk[3];
                    rgba[i + 3] = chunk[0];
                    i += 4;
                }
            }
            VTFImageFormat::BGRA8888 => {
                let mut i = 0;
                for chunk in buf.chunks_exact(4) {
                    rgba[i] = chunk[2];
                    rgba[i + 1] = chunk[1];
                    rgba[i + 2] = chunk[0];
                    rgba[i + 3] = chunk[3];
                    i += 4;
                }
            }
            VTFImageFormat::DXT1 => {
                texpresso::Format::Bc1.decompress(buf, mipmap.width as usize, mipmap.height as usize, &mut rgba);
            }
            VTFImageFormat::DXT3 => {
                texpresso::Format::Bc2.decompress(buf, mipmap.width as usize, mipmap.height as usize, &mut rgba);
            }
            VTFImageFormat::DXT5 => {
                texpresso::Format::Bc3.decompress(buf, mipmap.width as usize, mipmap.height as usize, &mut rgba);
            }
            _variant => unreachable!(),
        };

        Ok(VTFData {
            width: mipmap.width,
            height: mipmap.height,
            rgba,
        })
    }
}
