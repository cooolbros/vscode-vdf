# VSCode VDF Language Support

VDF/Valve KeyValues language support for VSCode

***This extension is still in development***

### Features
 - Syntax highlighting
 - Document formatting (currently removes comments, see TODO)
 - Convert VDF to JSON
 - Convert JSON to VDF
 - Jump/Peek definition for #base files

### Features (HUD Specific)
 - Definition Provider
    - All Clientscheme properties
    - labelText
    - pin_to_sibling
    - image
    - customfontfiles
 - Autocomplete for element properties:
    - ImagePanel => image, scaleImage, etc...
    - CExLabel => labelText, font, textAlignment, fgcolor, etc...
 - Autocomplete for property values
    - font => Will suggest from clientscheme
    - textAlignment => center, north, east, south, west
 - Autocomplete for #base paths
 - Autocomplete for image paths
 - Autocomplete for pin_to_sibling elements
 - Rename HUD elements

### Features (HUD Animations Specific)
 - Autocompletion for keywords, HUD elements (from associated files), common properties, clientscheme values, interpolators
 - Codelens for event references
 - Reference provider for events
 - Rename provider for events
 - Syntax highlighting for HUD Animations

### TODO
 - Add code actions for non-normalized file paths
 - Add support for renaming clientscheme entries (project wide)
 - Add settings for formatting preference
 - Add type checking for HUD files
 - Better HUD Animations formatting
 - Better VDF formatting
 - Code lens for clientscheme references
 - Unify behaviour for #base and image path autocomplete