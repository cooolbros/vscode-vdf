use std::{
    collections::HashMap,
    io::{self, Cursor, Read},
    path::Component,
};

use serde::Serialize;
use thiserror::Error;
use tsify::Tsify;
use wasm_bindgen::{JsError, JsValue, prelude::wasm_bindgen};
use zip::{ZipArchive, result::ZipError};

#[wasm_bindgen]
pub struct Pakfile {
    archive: ZipArchive<Cursor<Vec<u8>>>,
}

#[derive(Debug, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Files(HashMap<String, BSPEntry>);

#[derive(Debug, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
#[serde(tag = "type", content = "value")]
pub enum BSPEntry {
    File { index: usize, len: usize },
    Directory(HashMap<String, BSPEntry>),
}

#[derive(Debug, Error)]
#[error(transparent)]
pub enum PakError {
    ZipError(#[from] ZipError),
    IO(#[from] io::Error),
    #[error("Invalid name")]
    InvalidName,
}

impl From<PakError> for JsValue {
    fn from(value: PakError) -> Self {
        JsValue::from(JsError::new(&format!("{:?}", value)))
    }
}

impl Pakfile {
    pub fn new(buf: Vec<u8>) -> Result<Pakfile, PakError> {
        let archive = ZipArchive::new(Cursor::new(buf))?;
        Ok(Pakfile { archive })
    }
}

#[wasm_bindgen]
impl Pakfile {
    pub fn files(&mut self) -> Result<Files, PakError> {
        let mut map: HashMap<String, BSPEntry> = HashMap::new();

        for i in 0..self.archive.len() {
            let file = self.archive.by_index(i)?;
            if !file.is_file() {
                continue;
            }

            let enclosed_name = file.enclosed_name().ok_or(PakError::InvalidName)?;
            let file_name = enclosed_name
                .file_name()
                .ok_or(PakError::InvalidName)?
                .to_str()
                .ok_or(PakError::InvalidName)?
                .to_string();

            let len = file.size() as usize;

            if let Some(parent) = enclosed_name.parent() {
                let mut dir = &mut map;
                for component in parent.components() {
                    let folder = match component {
                        Component::Normal(os_str) => os_str.to_str().ok_or(PakError::InvalidName)?.to_string(),
                        _ => unreachable!("enclosed_name"),
                    };

                    match dir.entry(folder).or_insert_with(|| BSPEntry::Directory(HashMap::new())) {
                        BSPEntry::File { .. } => {
                            return Err(PakError::InvalidName);
                        }
                        BSPEntry::Directory(map) => {
                            dir = map;
                        }
                    }
                }

                dir.insert(file_name, BSPEntry::File { index: i, len });
            } else {
                map.insert(file_name, BSPEntry::File { index: i, len });
            }
        }

        Ok(Files(map))
    }

    pub fn read(&mut self, i: usize) -> Result<Vec<u8>, PakError> {
        let mut file = self.archive.by_index(i)?;
        let mut buf = vec![0; file.size() as usize];
        file.read_exact(&mut buf)?;
        Ok(buf)
    }
}
