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
 - Syntax highlighting for HUD Animations


### TODO
 - Add code actions for non-normalized file paths
 - Add rename provider
 - Add settings for formatting preference
 - Better VDF formatting
 - Code lens for element and clientscheme references
 - Document formatting for HUD animations
 - Unify behaviour for #base and image path autocomplete