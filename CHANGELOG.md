# Changelog

## [Unreleased]

- Report project parsing failure

- Signature help (overload selection)

- Auto-formatting

- Call hierarchy

- Type hierarchy

- Improved code completion

- Improved performance

## [1.3.0] - 2023-02-16

### Added

- Support for Embedded Intrusive Debugger in Umajin JIT engine

## [1.2.3] - 2022-12-08

### Added

- Ability to override the root script filename for launching purposes

### Removed

- Bracket rules are not applied to multiline statements any more due to the problem with the `property` declaration ambiguity

## [1.2.2] - 2022-11-07

### Added

- Syntax highlighting pattern for approximate comparison operators

### Fixed

- Syntax highlighting pattern for floating point numbers

- Do not duplicate apostrophes, quotation marks and backticks inside of strings or comments

## [1.2.1] - 2022-08-22

### Fixed

- "Stop Debugging" command now works

## [1.2.0] - 2022-07-29

### Added

- Settings for finer control of umajin log format

### Changed

- Improved Read me

- Improved template for new projects

- "Apply all code actions" command renamed to "Apply all code actions in Umajin project" to be searchable by "umajin" keyword

## [1.1.4] - 2022-06-30

### Added

- Advanced settings to use anything as a language server (mainly for debugging purposes)

### Changed

- `umajin.languageServerArguments` settings renamed to `umajin.advanced.languageServer.arguments`

## [1.1.3] - 2022-06-27

### Fixed

- Auto-generated Umajin VSCode Workspace file structure fixed (umajin.root was misplaced)

## [1.1.2] - 2022-06-14

### Added

- Ability to specify arguments to Umajin Language Server

## [1.1.1] - 2022-06-14

### Added

- Massive project-wide auto-fix (use "Apply all code actions" command)

## [1.1.0] - 2022-06-07

### Added

- Automated Umajin VSCode Workspace generation (use "Generate Umajin VSCode Workspace file" command)

- The extension is now bundled

### Fixed

- Improved extension categories

- Fixed packaging

- Dependencies updated (LSP 3.17)

## [1.0.1] - 2022-05-20

### Fixed

- Language server is restarted if `umajin.path.languageServer` setting is changed

## [1.0.0] - 2022-05-18

### Added

- Using Umajin Language Server for all sorts of goodness including but not limited to:

  - Semantic highlighting

  - Outline structure of the current file

  - Highlighting symbol usage within the file

  - Diagnostics

  - Auto-fixes (code actions)

  - Navigation to the definition

  - Navigation to the included file (use "go to definition")

  - Navigation to the base method (use "go to definition" from `override` keyword)

  - Find usages of a given symbol in the whole project (use "references" from the symbol)

  - Find all overrides for a given method (use "references" from `method` keyword)

  - Contextual code completion

- Ability to (re-)generate the Umajin Standard Library (use "Generate Umajin standard library" command)

- Scopes folding and brackets jumping

- Filtering and highlighting of JIT/compiler output

- Support for multiple projects in one folder

- Simulation of all supported platforms and JIT/AOT compilation modes

- A bit more code snippets

### Changed

- Syntax highlighting was simplified to run faster and offer early highlighting before semantic highlighting

- Running the project is changed from a built-in task (Terminal -> Run Build Task) to Run and Debug (Run -> Run without Debugging)

## [0.0.6] - 2022-03-29

- Transferring the access.

## [0.0.4] - 2018-10-02

- Run project using built-in build task (Ctrl+Shift+b)

## [0.0.3] - 2018-02-16

### Added

- Basic syntax highlighting for umajin (.u) sources.

- Code snippets
