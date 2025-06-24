# Change Log

## [5.5.6]
 - Add support for VTF image formats: `RGB888BlueScreen` and `BGR888BlueScreen`
 - [Popfile] Fix Wave Status Preview not loading when map skybox uses an unsupported VTF image format

## [5.5.5]
 - [Popfile] Add embedded Squirrel support (autcompletion, hover, signature help) for `RunScriptCode`
 - [Popfile] Fix incorrect attributes when using `EventChangeAttributes` in Wave Status Preview
 - [Popfile] Recommend `ocet247.tf2-vscript-support` for embedded Squirrel

## [5.5.4]
 - [Popfile] Add context menu items "Save image as..." and "Copy image" to Wave Status Preview
 - [Popfile] Fix unknown keys causing incorrect spawn counts in Wave Status Preview
 - [Popfile] Fix performance issues caused by "ClassIcon ... does not set VTF flag" diagnostics

## [5.5.3]
 - Fix BGR888 VTFs not displaying in VTF editor
 - Fix console spam
 - [VGUI] Fix workspace references not including `scripts` folder
 - [Popfile] Add Wave Status Preview
 - [Popfile] Fix useless-squad false positive diagnostic inside RandomChoice
 - [Popfile] Fix "Fix all issues of type" code action not working for "ClassIcon ... does not set VTF flag" diagnostics

## [5.5.2]
 - Fix crash when Steam or Team Fortress 2 are not installed

## [5.5.1]
 - Fix crash on Linux
 - Add Language Status items

## [5.5.0]
 - Add automatic Team Fortress 2 installation detection (Thanks [@james-ssh](https://github.com/James-SSH) for Linux support)
 - Add autocompletion parent element type fallback ([#52](https://github.com/cooolbros/vscode-vdf/issues/52))
 - Update VTF Viewer to reload when file changes
 - Add support for `surfaceproperties_*.txt`
 - Fix autocompletion not suggesting values when no whitespace is after key
 - Fix crash caused by code actions ([#61](https://github.com/cooolbros/vscode-vdf/issues/61))
 - Fix "process is not defined" crash in VSCode Web
 - Fix some document symbols missing conditional
 - Fix not always starting VMT Language Server
 - Fix being unable to read root directory in VPKs
 - VGUI:
   - Add support for `blueimage`, `redimage` image links
 - HUD Animations:
   - Add autocompletion for `SetVisible` visible
   - Add autocompletion for `SetInputEnabled` elements, enabled
   - Add autocompletion for conditionals ([#66](https://github.com/cooolbros/vscode-vdf/issues/66))
   - Fix event names autocompletion being lower case ([#77](https://github.com/cooolbros/vscode-vdf/issues/77))
   - Fix element and event completions having duplicate entries
 - Popfile:
   - Fix WaveSpawns not being scoped to Waves ([#47](https://github.com/cooolbros/vscode-vdf/issues/47))
   - Add `ClassIcon` missing "No Mipmap" and "No Level Of Detail" diagnostic ([#62](https://github.com/cooolbros/vscode-vdf/issues/62))
   - Fix folding not including default folding ranges ([#53](https://github.com/cooolbros/vscode-vdf/issues/53))
   - Allow `Tag` to be multiline (Thanks [@Brain-dawg](https://github.com/Brain-dawg))
   - Add `Tag` maximum buffer size diagnostic (Thanks [@Brain-dawg](https://github.com/Brain-dawg))
   - Add duplicate key diagnostics
   - Fix Wave currency decorations not using last `TotalCurrency`
   - Fix `Import #base templates into current popfile` command:
     - Fix not including templates referenced inside `Mission`, `Squad`, and `RandomChoice` blocks ([#43](https://github.com/cooolbros/vscode-vdf/issues/43))
     - Merge templates in #base files
     - Ignore templates declared in `robot_standard.pop`, `robot_giant.pop`, `robot_gatebot.pop` ([#69](https://github.com/cooolbros/vscode-vdf/issues/69))
 - VMT:
   - Fix header completion items inserting `WaveSchedule`
   - Add autocompletion for `$additive`, `$model`, `$nocull`, `$no_fullbright`, `$phong`, `$ssbump`
   - Add image link keys

## [5.4.4]
 - Fix extension activation failing in VSCode Web
 - Fix always starting VMT Language Server
 - Fix false positive diagnostics when value has unknown conditional
 - Fix conditionals autocompletion sometimes inserting incorrect `[` and `]`
 - [Popfile] Fix crash when BSP entity does not have `TeamNum`

## [5.4.3]
 - [Popfile] Add support `Where` enum values (`Ahead`, `Behind`, `Anywhere`, `""`)
 - [Popfile] Remove invalid-value diagnostic for `StartingPathTrackNode` values
 - [Popfile] Add support for `ClosestPoint`

## [5.4.2]
 - [Popfile] Fix false positive `Where` diagnostic for some `info_player_teamspawn` entities
 - [Popfile] Fix crash when `info_player_teamspawn` does not have `targetname`

## [5.4.1]
 - [Popfile] Remove invalid-value diagnostic for `Target` values
 - [Popfile] Update `Target` values autocompletion to suggest all entity types

## [5.4.0]
 - Add command to select `Team Fortress 2` folder using folder browser (`vscode-vdf.selectTeamFortress2Folder`)
 - Add support for animated VTFs in VTF Editor
 - Fix not reading files correctly from single archive VPKs
 - Fix not reading directories correctly inside custom folder
 - VGUI:
   - Add text edit option for enum inlay hints
   - Fix syntax highlighting for values that contain backslashes or escaped double quotes
   - Fix image hover not showing for suffixed keys
 - Popfile:
   - Add support for BSP values: `Where`, `Target`, `StartingPathTrackNode`
   - Add support for `Sound` key
   - Add autocompletion for `Param` key
   - Add autocompletion for `Delay` key ([#58](https://github.com/cooolbros/vscode-vdf/pull/58), Thanks [Windolon](https://github.com/Windolon))
   - Fix syntax highlighting for `Where` values with comments

## [5.3.1]
 - Remove unnecessary files from bundle

## [5.3.0]
 - Update minimum VSCode version to 1.97.0
 - Add image hovers
 - Add image autocompletion previews
 - Fix autocompletion returning incorrect files when searching parent directories (`..`)
 - Fix formatter inserting newline at incorrect position when using `insertNewlineBeforeObjects`
 - Add code action to fix all issues of same type
 - VGUI
   - Add inlay hints for enum numbers and language token references
   - Add language token values to autocompletion documentation
   - Add `activeimage` and `inactiveimage` image keys
 - Popfile:
   - Add wave currency to wave number decorations
   - Suggest `ItemName` inside ItemAttributes block
   - Add autocompletion for `Item` and `ItemName` values
   - Fix not suggesting `Where` in WaveSpawn blocks where Where is already present

## [5.2.0]
 - Fix publish of 5.1.0

## [5.1.0]
 - Fix crashed caused by URIs not beginning with a slash character
 - [Popfile] Add ItemAttributes missing ItemName diagnostic
 - [HUD Animations] Fix recomputing links for every request

## [5.0.0]
 - Add new reactive text documents system (Fixes some `#base` related diagnostics not updating)
 - Add new standalone VTF Editor
 - Enable VTF Editor in VSCode web
 - Add restart language server commands
 - Read `FileSystem`.`SearchPaths` from gameinfo.txt (Fixes all file not found false positives)
 - Fix references from #base files not being correctly removed
 - Fix VPK file system case insensitivity
 - Fix extension not activating for VPK files
 - Add support for `gameinfo.txt`, `chapterbackgrounds.txt` and `game_sounds_*.txt`
 - Fix Uri parser ignoring files or folders that start with `#` (#26)
 - Fix VDF keys autocompletion for lines that are not empty (#48)
 - Update minimum VSCode to `^1.95.0`
 - VGUI:
   - Add snippets
   - Add scheme colours reference support for `selectedcolor`, `titlebarfgcolor`, `unselectedcolor`
   - Add scheme borders reference support for `activeborder_override`, `normalborder_override`
   - Add language tokens reference support for `tooltip`, `button_token`, `desc_token`
   - Add image links for `image_armed`, `image_default`, `image_name`, `image_selected`
   - Add values support for `wrap`, `centerwrap`, `mouseinputenabled`, `scaleImage`
   - Add sound links for `sound_armed`
   - Add model links for `modelname`
 - HUD Animations:
   - Fix `SetInputEnabled` and `SetVisible` not referencing VGUI elements
 - Popfile:
   - Add embedded squirrel syntax highlighting support
   - Add inlay hints for Paint colours for `"set item tint RGB"`
   - Add auto completion for Paint colours for `"set item tint RGB"`
   - Allow multiple `Where` keys in autocompletion (#51)
   - Add Wave number decorations (#41)
   - Only allow multiline strings for the `Param` key (Fixes syntax error positions being not accurate)
   - Fix syntax highlighting for `#base` statement followed by a comment (#27)
   - Add RunScriptCode `Param` value max length diagnostic (#29)
   - Read attributes for `CharacterAttributes` and `ItemAttributes` from `items_game.txt` (#32)
   - Add sound links for `DoneWarningSound`, `FirstSpawnWarningSound`, `LastSpawnWarningSound`, `StartWaveWarningSound`
   - Add Squad with 1 subkey diagnostic (#33)
   - Add SpawnCounter greater than MaxActive softlock diagnostic (#34)
   - Add WaitForAllSpawned/WaitForAllDead WaveSpawn with Support 1 diagnostic (#35)
   - Fix autocompletion for `EventChangeAttributes`
   - Enable `"Import #base templates into current popfile"` in VSCode web
 - VMT:
   - Add support for `$detail` links (#37)

## [4.6.0]
 - Add support for nav keys (`navUp`, `navDown`, `navLeft`, `navRight`, `navToRelay`)
 - Disable element reference warnings for empty string values
 - Fix formatter error when file does not end with a newline
 - Improve performance of `"set item tint rgb"` colour picker
 - Add support for complex conditionals (e.g. `[$english || $spanish]`)
 - Fix obfuscated diagnostic codes
 - Add more expected values in parse errors

## [4.5.0]
 - Support multiline strings when formatting Popfiles
 - Fix HUD animations files not parsing correctly

## [4.4.0]
 - Allow multiline strings in Popfiles and VGUI language files
 - Add support for `StopAnimation`, `SetFont`, `SetTexture` and `SetString` animation commands
 - Fix not checking VGUI specific warnings
 - Fix scheme references in scheme files not updating
 - Exclude current file from #base file autocompletion items
 - Fix HUD Animations file labels
 - Fix conditional events incorrectly being declared as unreachable
 - Fix false positive warnings for HUD animations events that are defined in other files
 - Add support for escape characters in strings in VDF syntax highlighting
 - Include `appmanifest_*.acf` files
 - Update `Copy Key/Value Path To Clipboard` command to exclude file header
 - Update `Copy Key/Value Path To Clipboard` command to always copy the result to the clipboard

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
