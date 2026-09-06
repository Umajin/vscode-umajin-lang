# Changelog

## [Unreleased]

- Report project parsing failure

- Signature help (overload selection)

- Call hierarchy

- Type hierarchy

- Improved code completion

- Improved performance

## [1.10.0] - 2026-09-??

### Added

- Support for new function object types syntax

- A way to redirect log to a file

- Separate "engineArguments" and "scriptArguments" in launch configuration

### Improved

- Syntax highlighting schemes

### Fixed

- `platform-redirector` for Mac

- Stopping/restarting the language server when it was not running

## [1.9.6] - 2026-05-22

### Fixed

- Debugging using an engine older than 6.17.0 "Rotorua"

## [1.9.5] - 2026-05-15

### Added

- Support for threads in the debugged script

## [1.9.4] - 2026-04-28

### Added

- Support for environment variables in launch configuration

## [1.9.3] - 2026-04-21

### Improved

- Failed symlink test message to cover more variations

## [1.9.2] - 2026-04-20

### Fixed

- Generation of the VSCode workspace file (was broken since version 1.9.0)

### Improved

- The name of a generated VSCode workspace file now includes the folder name to differentiate between multiple open projects as majority of them were named `start`.

## [1.9.1] - 2026-04-17

### Improved

- Logging

### Added

- Symlink creation testing during the install/update process

## [1.9.0] - 2026-04-14

### Added

- Command:

  - "Install or update Umajin support" that works by analysing and fixing the current setup and then downloads and unpacks job artifacts from the internal Umajin Jenkins server

- Settings:

  - `umajin.path.linux.aarch64.*` and `umajin.path.linux.x86_64.*` to support Linux subplatforms

  - `umajin.update.channels` for flexible connection to the Jenkins server

### Deprecated

- Settings `umajin.path.osx.*` - use `umajin.path.mac.*` instead

### Changed

- Values in `umajin.simulate.platform` setting:

  - `win32` -> `windows`

  - `osx` -> `mac-x86_64` and `mac-arm64`

  - `linux` -> `linux-x86_64` and `linux-aarch64`

## [1.8.1] - 2025-05-06

### Fixed

- VSCode version compatibility

## [1.8.0] - 2025-04-11

### Added

- CLI JIT Engine support

## [1.7.3] - 2024-08-28

### Fixed

- Testing for debugger capabilities

## [1.7.2] - 2024-08-27

### Fixed

- Project file template syntax

## [1.7.1] - 2024-08-21

### Fixed

- Testing for debugger capabilities

## [1.7.0] - 2024-08-21

### Added

- Command to restart the Language Client manually

### Fixed

- Platform-specific paths to binaries in settings

### Changed

- Project file template now turns off `editor.minimap.showRegionSectionHeaders` setting.

## [1.6.0] - 2024-02-23

### Added

- Support for Linux platform in parsing simulation

- Platform-specific paths to binaries

### Fixed

- Generated project file

## [1.5.0] - 2023-08-17

### Added

- Massive project-wide autoformatting (use "Autoformat all Umajin files" command)

## [1.4.0] - 2023-08-11

### Added

- Provision for auto-formatting settings schema

## [1.3.6] - 2023-06-08

### Fixed

- JIT's version detection for debugging

## [1.3.5] - 2023-05-25

### Changed

- Improved parsing of `umajin.openEngineHelp` command argument

## [1.3.4] - 2023-05-16

### Added

- Open engine docs command and settings to assist the Hover support in Umajin Language Server

## [1.3.3] - 2023-03-17

### Added

- Commands to start and stop the Language Client manually

## [1.3.2] - 2023-02-16

### Changed

- Source code transferred to the Umajin organisation

## [1.3.1] - 2023-02-16

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
