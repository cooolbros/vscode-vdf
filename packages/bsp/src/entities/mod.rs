use std::collections::HashMap;

use serde::Serialize;
use thiserror::Error;
use tokeniser::{Token, Tokeniser};
use tsify::Tsify;

mod tokeniser;

#[derive(Debug, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Entities(pub Vec<HashMap<String, String>>);

#[derive(Debug, Error)]
#[error("{:#?}", self)]
pub struct SyntaxError;

impl Entities {
    pub fn new(str: String) -> Result<Self, SyntaxError> {
        let mut tokens = Tokeniser { chars: str.chars() };
        let mut entities = vec![];

        loop {
            let mut entity = HashMap::<String, String>::new();

            match tokens.next() {
                Some(Token::OpeningBrace) => loop {
                    match tokens.next().ok_or(SyntaxError)? {
                        Token::String(key) => {
                            let value = tokens
                                .next()
                                .and_then(|token| match token {
                                    Token::String(value) => Some(value),
                                    _ => None,
                                })
                                .ok_or(SyntaxError)?;

                            entity.insert(key, value);
                        }
                        Token::ClosingBrace => break,
                        _ => Err(SyntaxError)?,
                    };
                },
                Some(Token::EOF) => break,
                None => break,
                _ => Err(SyntaxError)?,
            };

            if !entity.is_empty() {
                entities.push(entity);
            }
        }

        Ok(Entities(entities))
    }
}
