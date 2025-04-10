use std::{
    error::Error,
    fmt::Display,
    io::{BufReader, Cursor},
    vec,
};

use bincode::{
    Decode, Encode,
    error::{DecodeError, EncodeError},
    impl_borrow_decode,
};
use wasm_bindgen::{JsError, JsValue, prelude::wasm_bindgen};

use crate::{Entities, entities::EntitiesError};

#[wasm_bindgen]
#[derive(Debug, Decode)]
pub struct BSP {
    buf: Vec<u8>,
    pub header: BSPHeader,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Decode)]
pub struct BSPHeader {
    pub signature: BSPSignature,
    pub version: i32,

    #[wasm_bindgen(skip)]
    pub lumps: [Lump; 64],

    pub map_revision: i32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct BSPSignature;

impl Display for BSPSignature {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "VBSP")
    }
}

impl Decode for BSPSignature {
    fn decode<D: bincode::de::Decoder>(decoder: &mut D) -> Result<Self, DecodeError> {
        match <[u8; 4] as bincode::Decode>::decode(decoder)? {
            [b'V', b'B', b'S', b'P'] => Ok(BSPSignature),
            _ => Err(DecodeError::Other("VBSP")),
        }
    }
}

impl_borrow_decode!(BSPSignature);

#[wasm_bindgen]
#[derive(Debug, Decode, Clone, Copy)]
pub struct Lump {
    pub offset: i32,
    pub len: i32,
    pub version: i32,

    #[wasm_bindgen(skip)]
    pub four_cc: [u8; 4],
}

#[derive(Debug, Decode)]
struct BSPLZMAHeader {
    _signature: LZMASignature,
    pub actual_size: u32,
    pub lzma_size: u32,
    pub properties: [u8; 5],
}

#[derive(Debug)]
struct LZMASignature;

impl Display for LZMASignature {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "LZMA")
    }
}

impl Decode for LZMASignature {
    fn decode<D: bincode::de::Decoder>(decoder: &mut D) -> Result<Self, DecodeError> {
        match <[u8; 4] as bincode::Decode>::decode(decoder)? {
            [b'L', b'Z', b'M', b'A'] => Ok(LZMASignature),
            _ => Err(DecodeError::Other("LZMA")),
        }
    }
}

impl_borrow_decode!(LZMASignature);

#[derive(Debug, Encode)]
#[repr(C)]
pub struct LZMAHeader {
    pub properties: [u8; 5],
    pub actual_size: u64,
}

#[derive(Debug)]
pub enum BSPError {
    DecodeError(DecodeError),
    EncodeError(EncodeError),
    LZMA(lzma_rs::error::Error),
}

impl Error for BSPError {}

impl Display for BSPError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:#?}", self)
    }
}

impl From<DecodeError> for BSPError {
    fn from(value: DecodeError) -> Self {
        BSPError::DecodeError(value)
    }
}

impl From<EncodeError> for BSPError {
    fn from(value: EncodeError) -> Self {
        BSPError::EncodeError(value)
    }
}

impl From<lzma_rs::error::Error> for BSPError {
    fn from(value: lzma_rs::error::Error) -> Self {
        BSPError::LZMA(value)
    }
}

impl From<BSPError> for JsValue {
    fn from(value: BSPError) -> Self {
        JsValue::from(JsError::new(&format!("{:?}", value)))
    }
}

#[wasm_bindgen]
impl BSP {
    #[wasm_bindgen(constructor)]
    pub fn new(buf: Vec<u8>) -> Result<BSP, BSPError> {
        let mut reader = BufReader::new(Cursor::new(&buf));
        let config = bincode::config::standard().with_fixed_int_encoding();

        let header: BSPHeader = bincode::decode_from_reader(&mut reader, config)?;

        Ok(BSP { buf, header })
    }

    pub fn lump(&self, i: usize) -> Result<Vec<u8>, BSPError> {
        let lump = &self.header.lumps[i];
        let buf = &self
            .buf
            .get(lump.offset as usize..(lump.offset + lump.len) as usize)
            .ok_or(DecodeError::UnexpectedEnd { additional: lump.len as usize })?;

        match buf[0..4] {
            [b'L', b'Z', b'M', b'A'] => {
                let config = bincode::config::standard().with_fixed_int_encoding();

                let (bsp_header, bytes_read): (BSPLZMAHeader, usize) = bincode::decode_from_slice(buf, config)?;

                let header = LZMAHeader {
                    properties: bsp_header.properties,
                    actual_size: bsp_header.actual_size as u64,
                };

                let lzma_header_size = 5 + 8;

                let mut lzma_data = vec![0u8; lzma_header_size + bsp_header.lzma_size as usize];

                bincode::encode_into_slice(&header, &mut lzma_data, config)?;
                lzma_data[lzma_header_size..].copy_from_slice(&buf[bytes_read..]);

                let mut out = vec![0u8; bsp_header.actual_size as usize];
                lzma_rs::lzma_decompress(&mut Cursor::new(&lzma_data), &mut Cursor::new(&mut out))?;

                Ok(out)
            }
            _ => Ok(buf.to_vec()),
        }
    }

    #[wasm_bindgen]
    pub fn entities(&self) -> Result<Entities, EntitiesError> {
        let buf = self.lump(0)?;
        let text = String::from_utf8_lossy_owned(buf);
        let entities = Entities::new(text)?;

        Ok(entities)
    }
}
