use std::{collections::HashMap, collections::hash_map::Entry, vec};

use serde::Serialize;
use serde_with::{OneOrMany, formats::PreferOne, serde_as};
use thiserror::Error;
use tokeniser::{Token, Tokeniser};
use tsify::Tsify;

mod tokeniser;

#[serde_as]
#[derive(Debug, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Entities(
    #[serde_as(as = "Vec<HashMap<_, OneOrMany<_, PreferOne>>>")]
    #[tsify(type = "Array<Record<string, string | string[]>>")]
    Vec<HashMap<String, Vec<String>>>,
);

#[derive(Debug, Error)]
#[error("{:#?}", self)]
pub struct SyntaxError;

impl Entities {
    pub fn new(str: String) -> Result<Self, SyntaxError> {
        let mut tokens = Tokeniser { chars: str.chars() };
        let mut entities = vec![];

        loop {
            let mut entity = HashMap::<String, Vec<String>>::new();

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

                            match entity.entry(key) {
                                Entry::Occupied(mut occupied) => occupied.get_mut().push(value),
                                Entry::Vacant(vacant) => _ = vacant.insert(vec![value]),
                            }
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
