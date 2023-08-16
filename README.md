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

## Swithcing branches on Windows

Since Umajin Language Server is usually tracked by a source version control and Windows locks launched executable files it is problematic to switch a branch while the Language Server is running.

To overcome this problem there are commands to manually stop it before and start it after the branch switching.

The commands are called:

- `Stop Umajin Language Client`,

- `Start Umajin Language Client`, and

- `Report the status of Umajin Language Client`.

They all output the outcome with a message in the bottom right corner.

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

- Search for usages of a given symbol in the whole project (use "references" from the symbol)

- Search for all overrides for a given method (use "references" from `method` keyword)

- Contextual code completion

- Scopes folding and brackets jumping

- Auto-formatting of all files, open files, current file, or a fragment in a file

- Ability to (re-)generate the Umajin Standard Library using a command

- Running the project (use menu "Run -> Run without Debugging")

- Debugging of Umajin using Embedded Intrusive Debugger in the JIT engine (use menu "Run -> Start Debugging")

- Simulation of all supported platforms and JIT/AOT compilation modes

- Filtering and highlighting of JIT/compiler output

- Support for multiple projects in one folder

- Code snippets

## Settings samples

### Semantic highlighting

The following fragment lists all semantic scopes that are used by this extension and the Umajin Language Server.

Make sure you specify colour scheme you are really using. This example uses "Default Light+".

```json
{
    "editor.tokenColorCustomizations": {
        "[Default Light+]": {
            "textMateRules": [
                {
                    "scope": "comment.block",
                    "settings": {
                        "foreground": "#8cbb3d",
                        "fontStyle": "italic"
                    }
                },
                {
                    "scope": "comment.line.double-slash",
                    "settings": {
                        "foreground": "#8cbb3d",
                        "fontStyle": "italic"
                    }
                },
                {
                    "scope": "constant.language",
                    "settings": {
                        "foreground": "#84660a",
                        "fontStyle": "bold"
                    }
                },
                {
                    "scope": "constant.numeric.floating-point",
                    "settings": {
                        "foreground": "#ca693c"
                    }
                },
                {
                    "scope": "constant.numeric.binary",
                    "settings": {
                        "foreground": "#93b81c"
                    }
                },
                {
                    "scope": "constant.numeric.octal",
                    "settings": {
                        "foreground": "#e67848"
                    }
                },
                {
                    "scope": "constant.numeric.decimal",
                    "settings": {
                        "foreground": "#a7922e"
                    }
                },
                {
                    "scope": "constant.numeric.hexadecimal",
                    "settings": {
                        "foreground": "#91930d"
                    }
                },
                {
                    "scope": "constant.other.user-defined",
                    "settings": {
                        "foreground": "#84660a"
                    }
                },
                {
                    "scope": "entity.name.type.class",
                    "settings": {
                        "foreground": "#5a0095",
                        "fontStyle": "bold"
                    }
                },
                {
                    "scope": "entity.name.function",
                    "settings": {
                        "foreground": "#0000b2"
                    }
                },
                {
                    "scope": "entity.name.function.virtual",
                    "settings": {
                        "fontStyle": "italic"
                    }
                },
                {
                    "scope": "keyword.control",
                    "settings": {
                        "foreground": "#801702",
                        "fontStyle": "bold"
                    }
                },
                {
                    "scope": "keyword.operator",
                    "settings": {
                        "foreground": "#000000",
                        "fontStyle": ""
                    }
                },
                {
                    "scope": "string.quoted.double",
                    "settings": {
                        "foreground": "#808080"
                    }
                },
                {
                    "scope": "string.quoted.single",
                    "settings": {
                        "foreground": "#808080"
                    }
                },
                {
                    "scope": "string.quoted.other.backtick",
                    "settings": {
                        "foreground": "#808080"
                    }
                },
                {
                    "scope": "meta.disabled",
                    "settings": {
                        "foreground": "#c0c0c0"
                    }
                },
                {
                    "scope": "meta.preprocessor",
                    "settings": {
                        "foreground": "#d9341a",
                        "fontStyle": ""
                    }
                },
                {
                    "scope": "support.type.primitive",
                    "settings": {
                        "foreground": "#964cbf",
                        "fontStyle": "bold"
                    }
                },
                {
                    "scope": "support.type.utility",
                    "settings": {
                        "foreground": "#a74f89",
                        "fontStyle": "bold"
                    }
                },
                {
                    "scope": "variable.function",
                    "settings": {
                        "foreground": "#0000b2"
                    }
                },
                {
                    "scope": "variable.function.virtual",
                    "settings": {
                        "fontStyle": "italic"
                    }
                },
                {
                    "scope": "variable",
                    "settings": {
                        "foreground": "#0040c0"
                    }
                },
                {
                    "scope": "variable.other.local",
                    "settings": {
                        "foreground": "#33a6ef"
                    }
                },
                {
                    "scope": "variable.other.global",
                    "settings": {
                        "foreground": "#1559ef"
                    }
                },
                {
                    "scope": "variable.other.property",
                    "settings": {
                        "foreground": "#106b95"
                    }
                },
                {
                    "scope": "variable.parameter",
                    "settings": {
                        "foreground": "#092e64"
                    }
                }
            ]
        }
    }
}
```

### Log output highlighting and filtering

Here is a sample of log output highlighting settings based on log levels and one rule to highligh personal log messages:

```json
{
    "umajin.outputHighlighting": [
        {
            "applyTo": "logLevel",
            "asRegex": true,
            "match": "^CRITICAL$",
            "background": "#ff0000",
            "foreground": "#fff2f2",
            "bold": "on"
        },
        {
            "applyTo": "logLevel",
            "asRegex": true,
            "match": "^ERROR$",
            "background": "#ffcece",
            "foreground": "#800000",
            "bold": "on"
        },
        {
            "applyTo": "logLevel",
            "asRegex": true,
            "match": "^WARN(?:ING)?$",
            "background": "#fff3ce",
            "foreground": "#a25d08"
        },
        {
            "applyTo": "logLevel",
            "asRegex": true,
            "match": "^INFO$",
            "foreground": "#004de8"
        },
        {
            "applyTo": "logLevel",
            "asRegex": true,
            "match": "^DEBUG$",
            "foreground": "#6ac2dd"
        },
        {
            "applyTo": "logLevel",
            "asRegex": true,
            "match": "^VERBOSE$",
            "foreground": "#cddade"
        },
        {
            "applyTo": "message",
            "asRegex": true,
            "match": "^\\[your_name\\]",
            "background": "#ffd8ff",
            "foreground": "#7b087b"
        }
    ]
}
```

Rules apply in the order they appear in the settings. All colours of matching rules mixed together. For `bold` and `italic` parameters the last matching rule where it is set to "on" or "off" wins.

The log entry is not shown if at least one "remove" `action` matches.
