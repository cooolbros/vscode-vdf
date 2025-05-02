use std::{collections::HashMap, error::Error, fmt::Display};

use serde::Serialize;
use tokeniser::{Token, Tokeniser};
use tsify::Tsify;
use wasm_bindgen::{JsError, JsValue};

use crate::bsp::BSPError;

mod tokeniser;

#[derive(Debug, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Entities(pub Vec<HashMap<String, String>>);

impl Entities {
    pub fn new(str: String) -> Result<Self, ()> {
        let mut tokens = Tokeniser { chars: str.chars() };
        let mut entities = vec![];

        loop {
            let mut entity = HashMap::<String, String>::new();

            match tokens.next() {
                Some(Token::OpeningBrace) => loop {
                    match tokens.next().ok_or(())? {
                        Token::String(key) => {
                            let value = tokens
                                .next()
                                .and_then(|token| match token {
                                    Token::String(value) => Some(value),
                                    _ => None,
                                })
                                .ok_or(())?;

                            entity.insert(key, value);
                        }
                        Token::ClosingBrace => break,
                        _ => Err(())?,
                    };
                },
                Some(Token::EOF) => break,
                None => break,
                _ => Err(())?,
            };

            if !entity.is_empty() {
                entities.push(entity);
            }
        }

        Ok(Entities(entities))
    }
}

#[derive(Debug)]
pub enum EntitiesError {
    BSPError(BSPError),
    SyntaxError,
}

impl Error for EntitiesError {}

impl Display for EntitiesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl From<BSPError> for EntitiesError {
    fn from(value: BSPError) -> Self {
        EntitiesError::BSPError(value)
    }
}

impl From<()> for EntitiesError {
    fn from(_value: ()) -> Self {
        EntitiesError::SyntaxError
    }
}

impl From<EntitiesError> for JsValue {
    fn from(value: EntitiesError) -> Self {
        JsValue::from(JsError::new(&format!("{:?}", value)))
    }
}
