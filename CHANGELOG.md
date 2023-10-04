# Change Log

## [4.3.0]
 - Add support for `mod_textures.txt`
 - Fix crash related to document links
 - Add support for conditional events in HUD animations
 - Add code action for `textAlignment` values
 - Various fixes
 - Add key/values

## [4.2.2]
 - Fix formatting error (#9)

## [4.2.0]
 - Fix document symbols error when using snippets
 - Disable autocompletion in VGUI scheme definition files
 - Add setting to enable/disable autocompletion (`vscode-vdf.[language].suggest.enable`)
 - Updated the localization files

## [4.1.0]
 - Add more Popfile key/values
 - Fix crash when opening Untitled files
 - Fix not suggesting Popfile subtree keys
 - Fix suggesting deleted definitions
 - Improve some warning messages
 - Update Popfile syntax highlighting

## [4.0.2]
 - VTF viewer fix

## [4.0.1]
 - Update Changelog

## [4.0.0]
 - Full release version 3.0.0

## [3.0.0] (Pre-Release)
 - Rewrite: Unify all VDF based languages functionality
 - Add support for VSCode web
 - Add Copy Key/Value path to clipboard command (`VDF: Copy Key/Value Path To Clipboard`)
 - Add Extract VPK file command (`VPK: Extract file to workspace`)
 - Add Import external bot templates into Popfile command (`Popfile: Import #base templates into current popfile`)
 - Add more document links
 - Add setting to update file diagnostics on file save (`vscode-vdf.updateDiagnosticsEvent`)
 - Add VPK file system support
 - Add VTF Viewer/Editor
 - Fix document links error when viewing a git diff
 - Fix VDF diagnostics not detecting missing closing braces at end of file
 - Fix VDF formatter including multiple double quotes when key has a conditional
 - Fix VDF formatter interfering with ASCII comments
 - Remove format VDF command (Use `Format Document` instead)
 - Remove sort VDF command
 - Remove useless hover
 - Update Popfile syntax highlighting
 - Update VDF syntax highlighting

## [2.1.0]
 - Add double quoted tokens support to HUD Animations Language Server
 - Add features to Popfile Language Server
   - Add Colours provider
   - Add Definition/References provider
   - Add Rename provider

## [2.0.1]
 - Update README

## [2.0.0]
 - Add Popfile Language Server

## [1.0.1]
 - Update VDF Formatter

## [1.0.0]
 - Initial release
