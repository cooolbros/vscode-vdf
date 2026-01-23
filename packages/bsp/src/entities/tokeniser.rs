use std::{iter, str::Chars};

const WHITESPACE: [char; 4] = [' ', '\t', '\r', '\n'];

pub struct Tokeniser<'a> {
    pub chars: Chars<'a>,
}

#[derive(Debug)]
pub enum Token {
    OpeningBrace,
    ClosingBrace,
    String(String),
    Eof,
}

impl Iterator for Tokeniser<'_> {
    type Item = Token;

    fn next(&mut self) -> Option<Self::Item> {
        match self.chars.by_ref().find(|char| !WHITESPACE.contains(char))? {
            '\0' => Some(Token::Eof),
            '{' => Some(Token::OpeningBrace),
            '}' => Some(Token::ClosingBrace),
            '"' => Some(Token::String(self.chars.by_ref().take_while(|char| *char != '"').collect::<String>())),
            char => Some(Token::String(
                iter::once(char)
                    .chain(self.chars.by_ref())
                    .take_while(|char| !WHITESPACE.contains(char))
                    .collect::<String>(),
            )),
        }
    }
}
