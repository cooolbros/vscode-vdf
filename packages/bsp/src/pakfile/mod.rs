use std::{
    collections::HashMap,
    io::{self, Cursor, Read},
    path::Component,
};

use serde::Serialize;
use thiserror::Error;
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zip::{ZipArchive, result::ZipError};

#[wasm_bindgen]
pub struct Pakfile {
    archive: ZipArchive<Cursor<Vec<u8>>>,
}

#[derive(Debug, Serialize, Tsify)]
pub struct Files(HashMap<String, BSPEntry>);

#[derive(Debug, Serialize, Tsify)]
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

impl Pakfile {
    pub fn new(buf: Vec<u8>) -> Result<Pakfile, PakError> {
        let archive = ZipArchive::new(Cursor::new(buf))?;
        Ok(Pakfile { archive })
    }
}

#[wasm_bindgen]
impl Pakfile {
    #[wasm_bindgen]
    pub fn files(&mut self) -> Result<Ts<Files>, JsError> {
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
                .to_lowercase();

            let len = file.size() as usize;

            if let Some(parent) = enclosed_name.parent() {
                let mut dir = &mut map;
                for component in parent.components() {
                    let folder = match component {
                        Component::Normal(os_str) => os_str.to_str().ok_or(PakError::InvalidName)?.to_string(),
                        _ => unreachable!("enclosed_name"),
                    };

                    dir = match dir.entry(folder).or_insert_with(|| BSPEntry::Directory(HashMap::new())) {
                        BSPEntry::File { .. } => Err(PakError::InvalidName)?,
                        BSPEntry::Directory(map) => map,
                    };
                }

                dir.insert(file_name, BSPEntry::File { index: i, len });
            } else {
                map.insert(file_name, BSPEntry::File { index: i, len });
            }
        }

        Ok(Files(map).into_ts()?)
    }

    #[wasm_bindgen]
    pub fn read(&mut self, i: usize) -> Result<Vec<u8>, JsError> {
        let mut file = self.archive.by_index(i)?;
        let mut buf = vec![0; file.size() as usize];
        file.read_exact(&mut buf)?;
        Ok(buf)
    }
}
