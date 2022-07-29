# Umajin Language for Visual Studio Code

A Visual Studio Code extension that add support for the Umajin language.

## Getting started

A good point to start is before opening any umajin file is to generate a workspace file.
Open command pallette and run command "**Generate Umajin VSCode Workspace file**"

![Generate Umajin VSCode Workspace file command](/images/generate-workspace-file-step1.png)

Select the start umajin file.

Auto-generated workspace file will be opened. Save it.

You can immediately open this newly created workspace via the button in the bottom right corner:

![Open Workspace button](/images/generate-workspace-file-step2.png)

If the Umajin Language Server is not in the root folder of your project you can modify it in settings (`umajin.path.languageServer`).

Also note that you can re-generate the standard library with "**Generate Umajin standard library**" command.

If your project was ported from an old compiler syntax and/or triggers many diagnostics, try "**Apply all code actions in Umajin project**" command.

## Features

This extension relies on Umajin Language Server to provide support using an up-to-date object model.

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

- Ability to (re-)generate the Umajin Standard Library using a command

- Scopes folding and brackets jumping

- Running the project (use "Run and Debug")

- Simulation of all supported platforms and JIT/AOT compilation modes

- Filtering and highlighting of JIT/compiler output

- Support for multiple projects in one folder

- Code snippets
