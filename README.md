# VSCode VDF Language Support

VDF/Valve KeyValues language support for VSCode

### Features
 - Syntax highlighting
 - Document formatting (somewhat)
 - Convert `VDF` to `JSON`
 - Convert `JSON` to `VDF`
 - Jump/Peek definition for #base files

 ### Features (HUD Specific)
  - Jump/Peek definition for clientscheme
  - Jump/Peek definition for `pin_to_sibling`
 - Autocomplete for element properties:
    - `ImagePanel` => `image`, `scaleImage`, etc...
    - `CExLabel` => `labelText`, `font`, `textAlignment`, `fgcolor`, etc...
 - Autocomplete for property values
    - `font` => Will suggest from clientscheme
    - `textAlignment` => `center`, `north`, `east`, `south`, `west`
 - Autocomplete for #base paths
 - Autocomplete for image paths
 - Autocomplete for pin_to_sibling elements
 - Syntax highlighting for HUD Animations
