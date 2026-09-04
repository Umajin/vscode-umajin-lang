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

- Simple wizard-like engine installation and updating process

## Settings samples

### Semantic highlighting

The following fragment lists all semantic scopes that are used by this extension and the Umajin Language Server.

Light theme:

```json
{
    "editor.tokenColorCustomizations": {
        "textMateRules": [
            {
                "scope": "comment.block",
                "settings": {
                    "fontStyle": "italic",
                    "foreground": "#b3b3b3" // 0° 0% 70%
                }
            },
            {
                "scope": "comment.line.double-slash",
                "settings": {
                    "fontStyle": "italic",
                    "foreground": "#999999" // 0° 0% 60%
                }
            },
            {
                "scope": "constant.language",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#8c8c20" // 60° 75% 50%
                }
            },
            {
                "scope": "constant.numeric.floating-point",
                "settings": {
                    "foreground": "#aa7c20" // 40° 75% 50%
                }
            },
            {
                "scope": "constant.numeric.integral.binary",
                "settings": {
                    "foreground": "#bf6b41" // 20° 50% 50%
                }
            },
            {
                "scope": "constant.numeric.integral.octal",
                "settings": {
                    "foreground": "#ff5703" // 20° 100% 50%
                }
            },
            {
                "scope": "constant.numeric.integral.decimal",
                "settings": {
                    "foreground": "#c17120" // 30° 75% 50%
                }
            },
            {
                "scope": "constant.numeric.integral.hexadecimal",
                "settings": {
                    "foreground": "#ab3f09" // 20° 90% 35%
                }
            },
            {
                "scope": "constant.other.user-defined",
                "settings": {
                    "foreground": "#8c8c20" // 60° 75% 50%
                }
            },
            {
                "scope": "entity.name.function",
                "settings": {
                    "foreground": "#8627e6" // 270° 85% 35%
                }
            },
            {
                "scope": "entity.name.function.virtual",
                "settings": {
                    "fontStyle": "italic"
                }
            },
            {
                "scope": "entity.name.type",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#3852d6" // 230° 75% 35%
                }
            },
            {
                "scope": "keyword.control",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#934141" // 0° 35% 35%
                }
            },
            {
                "scope": "keyword.operator",
                "settings": {
                    "fontStyle": "",
                    "foreground": "#6e0d5e" // 310° 75% 20%
                }
            },
            {
                "scope": "meta.disabled",
                "settings": {
                    "foreground": "#c6ae97" // 30° 25% 70%
                }
            },
            {
                "scope": "meta.preprocessor",
                "settings": {
                    "fontStyle": "",
                    "foreground": "#e3358c" // 330° 80% 45%
                }
            },
            {
                "scope": "string.quoted.double",
                "settings": {
                    "foreground": "#1a8d66" // 160° 75% 40%
                }
            },
            {
                "scope": "string.quoted.single",
                "settings": {
                    "foreground": "#1a9c1a" // 120° 75% 40%
                }
            },
            {
                "scope": "string.quoted.other.backtick",
                "settings": {
                    "foreground": "#4d811a" // 90° 75% 40%
                }
            },
            {
                "scope": "support.type.primitive",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#288fa4" // 190° 65% 35%
                }
            },
            {
                "scope": "support.type.utility",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#166f9b" // 200° 75% 35%
                }
            },
            {
                "scope": "variable.function",
                "settings": {
                    "foreground": "#8627e6"
                }
            },
            {
                "scope": "variable.function.virtual",
                "settings": {
                    "fontStyle": "italic"
                }
            },
            {
                "scope": "variable.other.local",
                "settings": {
                    "foreground": "#4949d6" // 240° 75% 35%
                }
            },
            {
                "scope": "variable.other.global",
                "settings": {
                    "foreground": "#626bc7" // 235° 60% 45%
                }
            },
            {
                "scope": "variable.other.member",
                "settings": {
                    "foreground": "#2185ea" // 210° 85% 45%
                }
            },
            {
                "scope": "variable.parameter",
                "settings": {
                    "foreground": "#4949d6",
                    "fontStyle": "italic"
                }
            },
            // fallback
            {
                "scope": "variable",
                "settings": {
                    "foreground": "#1919ff" // 240° 100% 20%
                }
            },
            // compatibility
            {
                "scope": "constant.numeric.binary",
                "settings": {
                    "foreground": "#bf6b41"
                }
            },
            {
                "scope": "constant.numeric.octal",
                "settings": {
                    "foreground": "#ff5703"
                }
            },
            {
                "scope": "constant.numeric.decimal",
                "settings": {
                    "foreground": "#c17120"
                }
            },
            {
                "scope": "constant.numeric.hexadecimal",
                "settings": {
                    "foreground": "#ab3f09"
                }
            },
            {
                "scope": "entity.name",
                "settings": {
                    "foreground": "#3852d6"
                }
            },
            {
                "scope": "keyword",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#934141"
                }
            },
            {
                "scope": "support.other.disabled-code",
                "settings": {
                    "foreground": "#c6ae97"
                }
            },
            {
                "scope": "support.other.preprocessor",
                "settings": {
                    "fontStyle": "",
                    "foreground": "#e3358c"
                }
            },
            {
                "scope": "variable.other.property",
                "settings": {
                    "foreground": "#2185ea"
                }
            }
        ]
    }
}
```

Dark theme:

```json
{
    "editor.tokenColorCustomizations": {
        "textMateRules": [
            {
                "scope": "comment.block",
                "settings": {
                    "fontStyle": "italic",
                    "foreground": "#4d4d4d" // 0° 0% 30%
                }
            },
            {
                "scope": "comment.line.double-slash",
                "settings": {
                    "fontStyle": "italic",
                    "foreground": "#666666" // 0° 0% 40%
                }
            },
            {
                "scope": "constant.language",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#8c8c20" // 60° 75% 50%
                }
            },
            {
                "scope": "constant.numeric.floating-point",
                "settings": {
                    "foreground": "#aa7c20" // 40° 75% 50%
                }
            },
            {
                "scope": "constant.numeric.integral.binary",
                "settings": {
                    "foreground": "#bf6b41" // 20° 50% 50%
                }
            },
            {
                "scope": "constant.numeric.integral.octal",
                "settings": {
                    "foreground": "#ff5703" // 20° 100% 50%
                }
            },
            {
                "scope": "constant.numeric.integral.decimal",
                "settings": {
                    "foreground": "#c17120" // 30° 75% 50%
                }
            },
            {
                "scope": "constant.numeric.integral.hexadecimal",
                "settings": {
                    "foreground": "#f68c57" // 20° 90% 65%
                }
            },
            {
                "scope": "constant.other.user-defined",
                "settings": {
                    "foreground": "#8c8c20" // 60° 75% 50%
                }
            },
            {
                "scope": "entity.name.function",
                "settings": {
                    "foreground": "#be8bf2" // 270° 85% 65%
                }
            },
            {
                "scope": "entity.name.function.virtual",
                "settings": {
                    "fontStyle": "italic"
                }
            },
            {
                "scope": "entity.name.type",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#61bce9" // 200° 75% 65%
                }
            },
            {
                "scope": "keyword.control",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#c59898" // 0° 35% 65%
                }
            },
            {
                "scope": "keyword.operator",
                "settings": {
                    "fontStyle": "",
                    "foreground": "#d9c4d5" // 310° 25% 80%
                }
            },
            {
                "scope": "meta.disabled",
                "settings": {
                    "foreground": "#5a4a39" // 30° 25% 30%
                }
            },
            {
                "scope": "meta.preprocessor",
                "settings": {
                    "fontStyle": "",
                    "foreground": "#ed7eb6" // 330° 80% 65%
                }
            },
            {
                "scope": "string.quoted.double",
                "settings": {
                    "foreground": "#26d39a" // 160° 75% 60%
                }
            },
            {
                "scope": "string.quoted.single",
                "settings": {
                    "foreground": "#2ce62c" // 120° 75% 60%
                }
            },
            {
                "scope": "string.quoted.other.backtick",
                "settings": {
                    "foreground": "#74c226" // 90° 75% 60%
                }
            },
            {
                "scope": "support.type.primitive",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#5bc2d7" // 190° 55% 65%
                }
            },
            {
                "scope": "support.type.utility",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#61bce9" // 200° 75% 65%
                }
            },
            {
                "scope": "variable.function",
                "settings": {
                    "foreground": "#be8bf2"
                }
            },
            {
                "scope": "variable.function.virtual",
                "settings": {
                    "fontStyle": "italic"
                }
            },
            {
                "scope": "variable.other.local",
                "settings": {
                    "foreground": "#9d9de9" // 240° 75% 65%
                }
            },
            {
                "scope": "variable.other.global",
                "settings": {
                    "foreground": "#7f86d1" // 235° 60% 55%
                }
            },
            {
                "scope": "variable.other.member",
                "settings": {
                    "foreground": "#499bee" // 210° 85% 55%
                }
            },
            {
                "scope": "variable.parameter",
                "settings": {
                    "foreground": "#9d9de9",
                    "fontStyle": "italic"
                }
            },
            // fallback
            {
                "scope": "variable",
                "settings": {
                    "foreground": "#c5c5ff" // 240° 100% 80%
                }
            },
            // compatibility
            {
                "scope": "constant.numeric.binary",
                "settings": {
                    "foreground": "#bf6b41"
                }
            },
            {
                "scope": "constant.numeric.octal",
                "settings": {
                    "foreground": "#ff5703"
                }
            },
            {
                "scope": "constant.numeric.decimal",
                "settings": {
                    "foreground": "#c17120"
                }
            },
            {
                "scope": "constant.numeric.hexadecimal",
                "settings": {
                    "foreground": "#f68c57"
                }
            },
            {
                "scope": "entity.name",
                "settings": {
                    "foreground": "#94a2e9"
                }
            },
            {
                "scope": "keyword",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#c59898"
                }
            },
            {
                "scope": "support.other.disabled-code",
                "settings": {
                    "foreground": "#5a4a39"
                }
            },
            {
                "scope": "support.other.preprocessor",
                "settings": {
                    "fontStyle": "",
                    "foreground": "#ed7eb6"
                }
            },
            {
                "scope": "variable.other.property",
                "settings": {
                    "foreground": "#499bee"
                }
            }
        ]
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
