'use strict';

import * as packageJson from './package.json';

/* eslint-disable @typescript-eslint/naming-convention */
import * as child_process from 'child_process';
/* eslint-enable @typescript-eslint/naming-convention */
import * as debugadapter from '@vscode/debugadapter';
import * as debugprotocol from '@vscode/debugprotocol';
import * as fs from 'fs';
import * as langclient from 'vscode-languageclient/node';
import * as net from 'net';
import * as path from 'path';
import * as semver from 'semver';
import * as vscode from 'vscode';

interface ILaunchRequestArguments extends debugprotocol.DebugProtocol.LaunchRequestArguments {
	arguments?: string[];
	logFormatEngineSourceInfo?: boolean,
	logFormatThread?: boolean,
	logFormatTimestamp?: 'milli' | 'milli_float' | 'micro' | 'world_clock';
	logLevel?: 'critical' | 'error' | 'warning' | 'info' | 'debug' | 'verbose';
	overrideRootFile?: string;
}

interface IAttachRequestArguments extends debugprotocol.DebugProtocol.AttachRequestArguments {
	logHost?: string;
	logPort: number;
	logStream: boolean;
	debugHost?: string;
	debugPort: number;
}


const isLinux: boolean = (process.platform === 'linux');
const isOSX: boolean = (process.platform === 'darwin');
const isWindows: boolean = (process.platform === 'win32');

const nativeSuffix: string =
	isLinux ? '.linux' :
		(isOSX ? '.osx' :
			(isWindows ? '.windows' :
				''/* fallback to generic, should never happen */));

const operatorSymbols: Record<string, string> = {
	/* eslint-disable @typescript-eslint/naming-convention */
	'-': 'minus',
	'!': 'excl',
	'~': 'tilde',
	'=': 'equal',
	'+': 'plus',
	'*': 'star',
	'/': 'slash',
	'%': 'percent',
	'&': 'and',
	'|': 'bar',
	'^': 'hat',
	'<': 'less',
	'>': 'greater',
	'[]': 'brackets',
	/* eslint-enable @typescript-eslint/naming-convention */
};



const exeName = isWindows ? function (name: string): string {
	return name + '.exe';
} : function (name: string): string {
	return name;
};

const appName = isWindows ? function (name: string): string {
	return name + '.exe';
} : isOSX ? function (name: string): string {
	return name + '.app/Contents/MacOS/' + name;
} : function (name: string): string {
	return name;
};

function makeAbsolute(basePart: string, pathPart: string, filePart: string): string {
	if (!path.isAbsolute(pathPart)) {
		pathPart = basePart + path.sep + pathPart;
	}
	return path.resolve(pathPart + path.sep + filePart);
}


class OutputHighlightingRule {
	public match: string =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			match.default;

	public asRegex: boolean =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			asRegex.default;

	public caseSensitive: boolean =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			caseSensitive.default;

	public invert: boolean =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			invert.default;

	public applyTo: 'sourceInfo' | 'logProducer' | 'logLevel' | 'message' =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			applyTo.default as typeof this.applyTo;

	public action: 'highlight' | 'remove' =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			action.default as typeof this.action;

	public foreground: string =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			foreground.default;

	public background: string =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			background.default;

	public bold: 'keep' | 'on' | 'off' =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			bold.default as typeof this.bold;

	public italic: 'keep' | 'on' | 'off' =
		packageJson.contributes.configuration.properties['umajin.outputHighlighting'].items.properties.
			italic.default as typeof this.italic;
}

const defaultOutputHighlightingRule: OutputHighlightingRule = new OutputHighlightingRule();

function fillOutputHighlightingRuleDefaults(value: OutputHighlightingRule): void {
	if (value.match === undefined) {
		value.match = defaultOutputHighlightingRule.match;
	}
	if (value.asRegex === undefined) {
		value.asRegex = defaultOutputHighlightingRule.asRegex;
	}
	if (value.caseSensitive === undefined) {
		value.caseSensitive = defaultOutputHighlightingRule.caseSensitive;
	}
	if (value.invert === undefined) {
		value.invert = defaultOutputHighlightingRule.invert;
	}
	if (value.applyTo === undefined) {
		value.applyTo = defaultOutputHighlightingRule.applyTo;
	}
	if (value.action === undefined) {
		value.action = defaultOutputHighlightingRule.action;
	}
	if (value.foreground === undefined) {
		value.foreground = defaultOutputHighlightingRule.foreground;
	}
	if (value.background === undefined) {
		value.background = defaultOutputHighlightingRule.background;
	}
	if (value.bold === undefined) {
		value.bold = defaultOutputHighlightingRule.bold;
	}
	if (value.italic === undefined) {
		value.italic = defaultOutputHighlightingRule.italic;
	}
}
type OutputHighlightingRules = OutputHighlightingRule[];


class Color {
	public red: number = 0;
	public green: number = 0;
	public blue: number = 0;

	private static readonly _reHexColor: RegExp = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

	public constructor(hex?: string) {
		if (hex) {
			const match = hex.match(Color._reHexColor);
			if (match === null) {
				throw TypeError('Color is not a hex string');
			}
			this.red = parseInt(match[1]!, 16);
			this.green = parseInt(match[2]!, 16);
			this.blue = parseInt(match[3]!, 16);

		}
	}
}

class ColorMixer {
	private _colors: Color[] = [];

	public add(hex: string) {
		try {
			this._colors.push(new Color(hex));
		} catch (error) {
		}
	}

	public hasColors(): boolean {
		return this._colors.length > 0;
	}

	public mix(): Color {
		let mixed: Color = new Color();
		this._colors.forEach((color: Color): void => {
			mixed.red += color.red;
			mixed.green += color.green;
			mixed.blue += color.blue;
		});
		const amount: number = this._colors.length;
		mixed.red /= amount;
		mixed.green /= amount;
		mixed.blue /= amount;
		return mixed;
	}
}

class UmajinExtension {
	private _context: vscode.ExtensionContext;
	private _languageClient?: langclient.LanguageClient | null = null;
	private _serverVersion: string = '';

	private _wsPath: string = '';

	private _collapseLongMessages: boolean = packageJson.contributes.configuration.properties['umajin.collapseLongMessages'].default;
	private _engineHelpLocalIgnoreVersion: boolean = packageJson.contributes.configuration.properties['umajin.engineHelp.local.ignoreVersion'].default;
	private _engineHelpLocalPath: string = packageJson.contributes.configuration.properties['umajin.engineHelp.local.path'].default;
	private _engineHelpRemoteServer: string = packageJson.contributes.configuration.properties['umajin.engineHelp.remote.server'].default;
	private _engineHelpRemoteSecure: boolean = packageJson.contributes.configuration.properties['umajin.engineHelp.remote.secure'].default;
	private _languageServerCommand: string = packageJson.contributes.configuration.properties['umajin.advanced.languageServer.command'].default;
	private _languageServerArguments: string[] = packageJson.contributes.configuration.properties['umajin.advanced.languageServer.arguments'].default;
	private _umajincFullPath: string = packageJson.contributes.configuration.properties['umajin.path.compiler'].default;
	private _umajinJitFullPath: string = packageJson.contributes.configuration.properties['umajin.path.jitEngine'].default;
	private _umajinlsFullPath: string = packageJson.contributes.configuration.properties['umajin.path.languageServer'].default;
	private _root: string = packageJson.contributes.configuration.properties['umajin.root'].default;
	private _simulateCompiler: string = packageJson.contributes.configuration.properties['umajin.simulate.compiler'].default;
	private _simulatePlatform: string = packageJson.contributes.configuration.properties['umajin.simulate.platform'].default;

	public constructor(context: vscode.ExtensionContext) {
		this._context = context;

		this._context.subscriptions.push(
			vscode.commands.registerCommand('umajin.generateStdLib', this.generateStdLib),
			vscode.commands.registerCommand('umajin.generateWorkspace', this.generateWorkspace),
			vscode.commands.registerCommand('umajin.applyAllCodeActions', this.applyAllCodeActions),
			vscode.commands.registerCommand('umajin.autoformatAll', this.autoformatAll),
			vscode.commands.registerCommand('umajin.stopLanguageClient', this.stopLanguageClient),
			vscode.commands.registerCommand('umajin.startLanguageClient', this.startLanguageClient),
			vscode.commands.registerCommand('umajin.restartLanguageClient', this.restartLanguageClient),
			vscode.commands.registerCommand('umajin.statusLanguageClient', this.statusLanguageClient),
			vscode.commands.registerCommand('umajin.openEngineHelp', this.openEngineHelp)
		);

		if (vscode.workspace.workspaceFolders !== undefined) {
			this._readConfig();

			this._restartLanguageClient();

			this._context.subscriptions.push(
				vscode.commands.registerCommand('umajin.run', (resource: vscode.Uri) => {
					let targetResource = resource;
					if (!targetResource && vscode.window.activeTextEditor) {
						targetResource = vscode.window.activeTextEditor.document.uri;
					}
					if (targetResource) {
						vscode.debug.startDebugging(undefined, {
							type: 'umajin',
							name: 'Umajin: Run',
							request: 'launch'
						},
							{}
						);
					}
				}),

				vscode.debug.registerDebugAdapterDescriptorFactory('umajin', new DebugAdapterDescriptorFactory())
			);
		}
	}

	public destruct() {
		this._stopLanguageClient();
	}


	public getWsPath(): string {
		return this._wsPath;
	}

	public getCollapseLongMessages(): boolean {
		return this._collapseLongMessages;
	}

	public getUmajincFullPath(): string {
		return this._umajincFullPath;
	}

	public getUmajinJitFullPath(): string {
		return this._umajinJitFullPath;
	}

	public getRoot(): string {
		return this._root;
	}

	public getSimulateCompiler(): string {
		return this._simulateCompiler;
	}

	public getSimulatePlatform(): string {
		return this._simulatePlatform;
	}


	public updateConfiguration(event: vscode.ConfigurationChangeEvent) {
		this._readConfig();

		if (event.affectsConfiguration('umajin.path.languageServer') ||
			event.affectsConfiguration('umajin.path' + nativeSuffix + '.languageServer') ||
			event.affectsConfiguration('umajin.advanced.languageServer')) {
			this._restartLanguageClient();
		}
	}

	public generateStdLib() {
		if (vscode.workspace.workspaceFolders === undefined) {
			vscode.window.showErrorMessage('Generating Umajin standard library requires Umajin workspace to be open.');
			return;
		}

		const self: UmajinExtension = umajin!;
		if (fs.existsSync(self._umajinJitFullPath)) {
			const options: child_process.SpawnSyncOptions = {
				cwd: self._wsPath
			};
			const result = child_process.spawnSync(self._umajinJitFullPath, ['--print-stdlib'], options);
			if ((result.status !== 0) && (result.status !== 2)) /* old expected status code of --print-stdlib is 2 */ {
				const message: string = 'An attempt to generate Umajin standard library using "' + self._umajinJitFullPath + '" failed with code ' + result.status;
				vscode.window.showErrorMessage(message);
				console.error(message);
				if (result.error !== undefined) {
					console.error('Error: ' + result.error);
				}
				if (Buffer.byteLength(result.stdout) !== 0) {
					console.error('Output: ' + result.stdout);
				}
				if (Buffer.byteLength(result.stderr) !== 0) {
					console.error('Error stream: ' + result.stderr);
				}
			} else {
				vscode.window.showInformationMessage('Umajin standard library generated.');
			}
		}
	}

	public async generateWorkspace(): Promise<void> {
		vscode.window.showOpenDialog({
			title: 'Select start file',
			canSelectMany: false,
			filters: {
				// eslint-disable-next-line @typescript-eslint/naming-convention
				'Umajin files': ['u'],
				// eslint-disable-next-line @typescript-eslint/naming-convention
				'All files': ['*']
			}
		}).then(async rootFileUri => {
			if (rootFileUri && rootFileUri[0]) {
				const rootFullPath = rootFileUri[0].fsPath;
				const rootFilename = path.parse(rootFullPath).base;
				const cwFilename = path.parse(rootFullPath).dir + path.sep + path.parse(rootFullPath).name + '.code-workspace';
				let write: boolean = true;
				let open: boolean = true;
				if (fs.existsSync(cwFilename)) {
					await vscode.window.showInformationMessage(`File '${cwFilename}' already exists.\nDo you want to overwrite it?`, 'Yes', 'No')
						.then(answer => {
							if (answer === 'No') {
								write = false;
							}
						});
				}
				if (write) {
					fs.writeFileSync(cwFilename, (JSON.parse(
						fs.readFileSync(
							umajin!._context.asAbsolutePath('snippets/code-workspace.json'), 'utf-8'))
					['Umajin VSCode Workspace'].body as string[]).join('\n')
						.replace('$0', rootFilename));
				} else {
					await vscode.window.showInformationMessage(`Do you want to open '${cwFilename}' anyway?`, 'Yes', 'No')
						.then(answer => {
							if (answer === 'No') {
								open = false;
							}
						});
				}
				if (open) {
					vscode.window.showTextDocument(vscode.Uri.file(cwFilename));
				}
			}
		});
	}

	public applyAllCodeActions() {
		if (vscode.workspace.workspaceFolders === undefined) {
			vscode.window.showErrorMessage('Applying all code actions requires Umajin workspace to be open.');
			return;
		}

		const self: UmajinExtension = umajin!;
		if (!self._languageClient) {
			vscode.window.showErrorMessage('Applying all code actions requires Umajin language server to be connected.');
			return;
		}

		vscode.window.showInformationMessage('Do you want to apply code actions to all files in the project or to open files only?', 'The whole project', 'Open files only')
			.then(answer => {
				const openOnly = (answer === 'Open files only');
				self._languageClient!.sendRequest('workspace/executeCommand',
					{
						'command': 'applyAllCodeActions',
						'arguments':
							[
								{ 'openOnly': openOnly }
							]
					}
				);
			}
			);
	}

	public autoformatAll() {
		if (vscode.workspace.workspaceFolders === undefined) {
			vscode.window.showErrorMessage('Autoformatting all Umajin files requires Umajin workspace to be open.');
			return;
		}

		const self: UmajinExtension = umajin!;
		if (!self._languageClient) {
			vscode.window.showErrorMessage('Autoformatting all Umajin files requires Umajin language server to be connected.');
			return;
		}

		vscode.window.showInformationMessage('Do you want to autoformat all files in the project or to open files only?', 'The whole project', 'Open files only')
			.then(answer => {
				const openOnly = (answer === 'Open files only');
				self._languageClient!.sendRequest('workspace/executeCommand',
					{
						'command': 'autoformatAll',
						'arguments':
							[
								{ 'openOnly': openOnly }
							]
					}
				);
			}
			);
	}

	public highlightOutput(sourceInfo: string, logProducer: string, logLevel: string, message: string, input: string): string | undefined {
		let remove: boolean = false;
		let foreground: ColorMixer = new ColorMixer();
		let background: ColorMixer = new ColorMixer();
		let bold: boolean = false;
		let italic: boolean = false;

		const rules: OutputHighlightingRules | undefined = vscode.workspace.getConfiguration().get('umajin.outputHighlighting');
		if (rules !== undefined) {
			rules.forEach((rule: OutputHighlightingRule): void => {
				fillOutputHighlightingRuleDefaults(rule);
				if (rule.match !== '') {
					let where: string = '';
					switch (rule.applyTo) {
						case 'sourceInfo':
							where = sourceInfo;
							break;

						case 'logProducer':
							where = logProducer;
							break;

						case 'logLevel':
							where = logLevel;
							break;

						case 'message':
							where = message;
							break;
					}

					let matches: boolean = false;
					if (rule.asRegex) {
						let re: RegExp = new RegExp(rule.match, rule.caseSensitive ? '' : 'i');
						matches = where.match(re) !== null;
					} else {
						if (rule.caseSensitive) {
							matches = where.indexOf(rule.match) !== -1;
						} else {
							matches = where.toLocaleLowerCase().indexOf(rule.match.toLocaleLowerCase()) !== -1;
						}
					}

					if (matches !== rule.invert) {
						if (rule.action === 'remove') {
							remove = true;
						} else {
							if (rule.foreground !== '') {
								foreground.add(rule.foreground);
							}
							if (rule.background !== '') {
								background.add(rule.background);
							}
							switch (rule.bold) {
								case 'keep':
									break;

								case 'on':
									bold = true;
									break;

								case 'off':
									bold = false;
									break;
							}
							switch (rule.italic) {
								case 'keep':
									break;

								case 'on':
									italic = true;
									break;

								case 'off':
									italic = false;
									break;
							}
						}
					}
				}
			});
		}

		if (remove) {
			return undefined;
		}

		let prefix: string = '';
		let postfix: string = '';

		if (foreground.hasColors()) {
			let mixed: Color = foreground.mix();
			prefix += `\u001b[38;2;${mixed.red};${mixed.green};${mixed.blue}m`;
		}

		if (background.hasColors()) {
			let mixed: Color = background.mix();
			prefix += `\u001b[48;2;${mixed.red};${mixed.green};${mixed.blue}m`;
		}

		if (foreground.hasColors() || background.hasColors()) {
			postfix = '\u001b[0m';
		}

		if (bold) {
			prefix += '\u001b[1m';
			postfix = '\u001b[22m' + postfix;
		}

		if (italic) {
			prefix += '\u001b[3m';
			postfix = '\u001b[23m' + postfix;
		}

		return prefix + input + postfix;
	}

	private _readPath(entryTail: string, defaultValue: string, filePart: string) {
		return makeAbsolute(this._wsPath,
			vscode.workspace.getConfiguration().get('umajin.path' + nativeSuffix + entryTail,
				vscode.workspace.getConfiguration().get('umajin.path' + entryTail, defaultValue)),
			filePart);
	}

	private _readConfig() {
		this._wsPath = vscode.workspace.workspaceFolders![0]!.uri.fsPath;

		this._collapseLongMessages =
			vscode.workspace.getConfiguration().get('umajin.collapseLongMessages', this._collapseLongMessages);

		this._engineHelpLocalIgnoreVersion =
			vscode.workspace.getConfiguration().get('umajin.engineHelp.local.ignoreVersion', this._engineHelpLocalIgnoreVersion);

		this._engineHelpLocalPath =
			vscode.workspace.getConfiguration().get('umajin.engineHelp.local.path', this._engineHelpLocalPath);

		this._engineHelpRemoteServer =
			vscode.workspace.getConfiguration().get('umajin.engineHelp.remote.server', this._engineHelpRemoteServer);

		this._engineHelpRemoteSecure =
			vscode.workspace.getConfiguration().get('umajin.engineHelp.remote.secure', this._engineHelpRemoteSecure);

		this._languageServerCommand =
			vscode.workspace.getConfiguration().get('umajin.advanced.languageServer.command', this._languageServerCommand);

		this._languageServerArguments =
			vscode.workspace.getConfiguration().get('umajin.advanced.languageServer.arguments', this._languageServerArguments);

		this._umajincFullPath = this._readPath('.compiler', this._umajincFullPath, exeName('umajinc'));

		this._umajinJitFullPath = this._readPath('.jitEngine', this._umajinJitFullPath, appName('umajin'));

		this._umajinlsFullPath = this._readPath('.languageServer', this._umajinlsFullPath, exeName('umajinls'));

		this._root = makeAbsolute(this._wsPath, '.',
			vscode.workspace.getConfiguration().get('umajin.root', this._root));

		this._simulateCompiler =
			vscode.workspace.getConfiguration().get('umajin.simulate.compiler', this._simulateCompiler);

		this._simulatePlatform =
			vscode.workspace.getConfiguration().get('umajin.simulate.platform', this._simulatePlatform);
	}

	public stopLanguageClient() {
		const self: UmajinExtension = umajin!;
		if (self._stopLanguageClient()) {
			vscode.window.showInformationMessage('Umajin Language Client is stopped.');
		} else {
			vscode.window.showErrorMessage('Cannot stop Umajin Language Client: it was not running.');
		}
	}

	public startLanguageClient() {
		const self: UmajinExtension = umajin!;
		if (self._startLanguageClient()) {
			vscode.window.showInformationMessage('Umajin Language Client is started.');
		} else {
			vscode.window.showErrorMessage('Cannot start Umajin Language Client: it was already running.');
		}
	}

	public restartLanguageClient() {
		const self: UmajinExtension = umajin!;
		self.stopLanguageClient();
		self.startLanguageClient();
	}

	public statusLanguageClient() {
		const self: UmajinExtension = umajin!;
		vscode.window.showInformationMessage(self._languageClient
			? 'Umajin Language Client is running.'
			: 'Umajin Language Client is not running.');
	}

	private _stopLanguageClient(): boolean {
		if (this._languageClient) {
			this._languageClient.stop();
			this._deleteLanguageClient();
			return true;
		}
		return false;
	}

	private _deleteLanguageClient() {
		delete this._languageClient;
		this._languageClient = null;
		this._serverVersion = '';
	}

	private _startLanguageClient(): boolean {
		if (!this._languageClient) {
			const serverOptions: langclient.ServerOptions = {
				command: (this._languageServerCommand !== '') ? this._languageServerCommand : this._umajinlsFullPath,
				args: this._languageServerArguments
			};

			const clientOptions: langclient.LanguageClientOptions = {
				documentSelector: [
					{
						scheme: 'file',
						language: 'umajin'
					}
				],
				markdown: {
					isTrusted: true,
					supportHtml: true
				}
			};

			this._languageClient = new langclient.LanguageClient(
				'umajinls',
				'Umajin Language Server',
				serverOptions,
				clientOptions
			);

			this._languageClient.start()
				.then(() => {
					const initializeResult = this._languageClient!.initializeResult;
					if (initializeResult) {
						const serverInfo = initializeResult.serverInfo;
						if (serverInfo) {
							if (serverInfo.name === 'UmajinLS') {
								const version = serverInfo.version;
								if (version) {
									this._serverVersion = version;
								}
							}
						}
					}
				})
				.catch(error => {
					console.error(error);
					this._deleteLanguageClient();
				});
			return true;
		}
		return false;
	}

	private _restartLanguageClient() {
		this._stopLanguageClient();
		this._startLanguageClient();
	}

	public async openEngineHelp(args: Object) {
		const self: UmajinExtension = umajin!;

		if (self._serverVersion === '') {
			vscode.window.showErrorMessage('Cannot generate link for engine help: version unknown');
		}
		else {
			let section: string = '';
			if (args !== undefined && 'section' in args) {
				section = args.section as string;
			}

			let type: string;
			if (args !== undefined && 'type' in args) {
				type = args.type as string;
			} else {
				const typed = await vscode.window.showInputBox({
					prompt: "Umajin type, constant, property, method, or event name or signature"
				});

				if (typed !== undefined) {
					const splitted = typed.match(/^([^:.]+)(?:(?:::|\.)\w+.*)?$/);
					if (splitted === null) {
						return;
					}

					type = splitted[1]!; // if it matched then [1] is defined

					if (splitted[0] !== undefined) {
						section = splitted[0];
					}
				}
				else {
					return;
				}
			}

			const local = self._engineHelpLocalPath;
			const remote =
				(self._engineHelpRemoteSecure ? 'https' : 'http') + '://' +
				self._engineHelpRemoteServer + '/' + self._serverVersion;

			const path = '/library/' + type + '.html';

			let useLocal = false;

			let fullPath = makeAbsolute(self._wsPath, local, path);
			if (fs.existsSync(fullPath)) {
				if (self._engineHelpLocalIgnoreVersion) {
					useLocal = true;
				}
				else {
					let versionCheckPath = makeAbsolute(self._wsPath, local, 'version.txt');
					if (fs.existsSync(versionCheckPath)) {
						const versionCheck = fs.readFileSync(versionCheckPath, 'utf-8');
						if (versionCheck && versionCheck === self._serverVersion) {
							useLocal = true;
						}
					}
				}
			}
			if (useLocal) {
				fullPath = 'file://' + fullPath;
			}
			else {
				fullPath = remote + path;
			}

			if (section !== '') {
				if (section.includes('operator ')) {
					let skip = true;
					section = section.split(/operator /).map(part => {
						if (skip) {
							skip = false;
							return part;
						} else {
							let parts = part.split(/(\()/);
							if (parts.length > 0) {
								parts[0] = 'operator_' + parts[0]!
									.split(/([-!~=+*/%|^<>]|\[\])/)
									.filter(subpart => subpart.length > 0)
									.map(subpart => operatorSymbols[subpart] || subpart)
									.join('_');
							}
							return parts.join('');
						}
					}).join('');
				}
				section = section
					.replace('::', '--')
					.replace('.', '-')
					.replace(',', '-')
					.replace('(', '-')
					.replace(')', '');
				fullPath += '#' + section;
			}
			const command = isOSX ? 'open' : (isWindows
				? (`${process.env['SYSTEMROOT']}\\System32\\WindowsPowerShell\\v1.0\\powershell`
					+ ' -NoProfile'
					+ ' -NonInteractive'
					+ ' -ExecutionPolicy'
					+ ' Bypass'
					+ ' start')
				: 'xdg-open');
			child_process.exec(`${command} "${fullPath}"`);

		}
	}
}

let umajin: UmajinExtension | null = null;

export function activate(context: vscode.ExtensionContext): void {
	vscode.workspace.onDidChangeConfiguration(event => {
		if (umajin) {
			umajin.updateConfiguration(event);
		}
	});

	umajin = new UmajinExtension(context);
}

export function deactivate(): void {
	if (umajin) {
		umajin.destruct();
		umajin = null;
	}
}

class DebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new UmajinDebugSession());
	}
}

class BinaryAccumulator {
	private static readonly _headerSize: number = 4; // sizeof uint32

	private _buffer: Buffer;
	private _expectHeader: boolean = true;
	private _expectBytes: number = BinaryAccumulator._headerSize;
	private _callback: (data: Buffer) => void;


	public constructor(callback: (data: Buffer) => void) {
		this._buffer = Buffer.concat([]);
		this._callback = callback;
	}

	public append(incoming: Buffer) {
		this._buffer = Buffer.concat([this._buffer, incoming]);
		while (this._buffer.length >= this._expectBytes) {
			if (this._expectHeader) {
				this._expectBytes = this._buffer.readUInt32BE(); // network order
				this._buffer = this._buffer.subarray(BinaryAccumulator._headerSize);
			} else {
				this._callback(this._buffer.subarray(0, this._expectBytes));
				this._buffer = this._buffer.subarray(this._expectBytes);
				this._expectBytes = BinaryAccumulator._headerSize;
			}
			this._expectHeader = !this._expectHeader;
		}
	}
}

class NetRequest {
	public request: debugprotocol.DebugProtocol.Request;
	public response: debugprotocol.DebugProtocol.Response;
	private _callback: (response: debugprotocol.DebugProtocol.Response) => void;

	public constructor(request: debugprotocol.DebugProtocol.Request, response: debugprotocol.DebugProtocol.Response, callback: (response: debugprotocol.DebugProtocol.Response) => void) {
		this.request = request;
		this.response = response;
		this._callback = callback;
	}

	public callback(fromNet?: any) {
		if (fromNet) {
			this.response.success = fromNet.success;
			if (fromNet.message) {
				this.response.message = fromNet.message;
			}
			if (fromNet.body) {
				this.response.body = fromNet.body;
			}
		}
		this._callback(this.response);
	}
}

type NetRequestList = NetRequest[];

type NetRequestMap = {
	[key: string]: NetRequest;
};

class UmajinDebugSession extends debugadapter.LoggingDebugSession {
	private _wsPath: string;
	private _collapseLongMessages: boolean;

	private _child: child_process.ChildProcess | null;

	private _stdoutTail: string = '';
	private _stderrTail: string = '';
	private _lastCompilerOutputEvent?: debugprotocol.DebugProtocol.OutputEvent = undefined;

	private _reLogMessage: RegExp = new RegExp('');

	private static readonly _reLogMessageIndexScriptSourceInfo: number = 1;
	private static readonly _reLogMessageIndexScriptSourceInfoFile: number = 2;
	private static readonly _reLogMessageIndexScriptSourceInfoLine: number = 3;
	private static readonly _reLogMessageIndexScriptSourceInfoColumn: number = 4;
	private static readonly _reLogMessageIndexWholeMessage: number = 5;
	private static readonly _reLogMessageIndexLogProducer: number = 6;
	private static readonly _reLogMessageIndexLogLevel: number = 7;
	private static readonly _reLogMessageIndexMessage: number = 8;

	private _hasDebugger: boolean = false;

	private _debugger: net.Socket | null = null;

	private _debuggingPort: number = 0;
	private _debuggerConnected: boolean = false;

	private _debuggingInputAccumulator: BinaryAccumulator;

	private _sendOnConnect: NetRequestList = [];

	private _sentRequests: NetRequestMap = {};

	private _netLogger: net.Socket | null = null;
	private _netLogStream: boolean = false;

	private _loggingInputAccumulator: BinaryAccumulator;
	private _logSyncing: boolean = true;
	private _logSyncingPrintables: number = 0;

	// It should _binary_ match the message printed by the JIT Engine
	// eslint-disable-next-line @typescript-eslint/naming-convention
	private static readonly _EIDPortMessage: string = "Embedded Intrusive Debugger port: ";


	public constructor() {
		super();
		this._wsPath = umajin!.getWsPath();
		this._collapseLongMessages = umajin!.getCollapseLongMessages();

		this._child = null;
		this._debuggingInputAccumulator = new BinaryAccumulator((data: Buffer) => { this._processDebugging(data); });
		this._loggingInputAccumulator = new BinaryAccumulator((data: Buffer) => { this._processStdout(data.toString() + '\n'); });

		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);
	}

	override sendEvent(event: debugprotocol.DebugProtocol.Event): void {
		super.sendEvent(event);
	}

	override sendResponse(response: debugprotocol.DebugProtocol.Response): void {
		super.sendResponse(response);
	}

	protected override initializeRequest(response: debugprotocol.DebugProtocol.InitializeResponse, args: debugprotocol.DebugProtocol.InitializeRequestArguments): void {
		const simulateCompiler: string = umajin!.getSimulateCompiler();
		const simulatePlatform: string = umajin!.getSimulatePlatform();
		const useJit: boolean =
			(simulateCompiler === 'JIT') &&
			((simulatePlatform === 'native') ||
				(simulatePlatform ===
					(isWindows ? 'win32' :
						(isOSX ? 'osx' :
							(isLinux ? 'linux' : 'native')))));

		const program: string = useJit ? umajin!.getUmajinJitFullPath() : umajin!.getUmajincFullPath();

		let hasCapabilities: boolean = false;

		if (useJit) {
			// check version
			const options: child_process.SpawnSyncOptionsWithStringEncoding = {
				cwd: this._wsPath,
				encoding: 'utf8'
			};
			const versionCheck: child_process.SpawnSyncReturns<string> = child_process.spawnSync(program, ['--version'], options);
			if (!versionCheck.error && versionCheck.status === 0) {
				const versionLines: string[] = versionCheck.stdout.split(/\r?\n/).filter((line) => line.startsWith("Version "));
				if (versionLines.length === 1) {
					const matched: RegExpMatchArray | null = versionLines[0]!.match(/^Version (\d+\.\d+\.\d+)\.\d+(?:-\S+)? "[^"]+" [0-9a-fA-F]+$/);
					if (matched?.length === 2) {
						this._hasDebugger = semver.gte(matched[1]!, '6.11.0'); // Levin
					}
				}
			}
			if (this._hasDebugger) {
				// get capabilities
				const options: child_process.SpawnSyncOptionsWithStringEncoding = {
					cwd: this._wsPath,
					encoding: 'utf8'
				};
				const capabilitiesCheck: child_process.SpawnSyncReturns<string> = child_process.spawnSync(program, ['--debugging-capabilities'], options);
				if (!capabilitiesCheck.error && capabilitiesCheck.status === 0) {
					response.body = JSON.parse(capabilitiesCheck.stdout);
					response.body = response.body || {};
					response.body.supportsTerminateRequest = true;
					response.body.supportTerminateDebuggee = true;
					hasCapabilities = true;
				}
			}
		}

		if (!hasCapabilities) {
			response.body = {
				supportsTerminateRequest: true,
				supportTerminateDebuggee: true
			};
		}

		this.sendResponse(response);

		this.sendEvent(new debugadapter.InitializedEvent());
	}

	private _createDebugger() {
		const uds: UmajinDebugSession = this;

		this._debugger = new net.Socket()
			.on('connect', () => {
				uds._debuggerConnected = true;
			})
			.on('close', (hadError: boolean) => {
				uds._debuggerConnected = false;
			})
			.on('ready', () => {
				let aLocalCopy: NetRequestList = uds._sendOnConnect;
				uds._sendOnConnect = [];
				aLocalCopy.forEach((value: NetRequest) => {
					uds._sendToDebugger(value);
				});
			})
			.on('data', (data: Buffer) => {
				uds._debuggingInputAccumulator.append(data);
			});
	}

	protected override disconnectRequest(response: debugprotocol.DebugProtocol.DisconnectResponse, args: debugprotocol.DebugProtocol.DisconnectArguments, request?: debugprotocol.DebugProtocol.Request) {
		if (args) {
			if (args.terminateDebuggee) {
				if (this._child) {
					this._child.kill();
				}
			}
		}
		this.sendResponse(response);
	}

	protected override async launchRequest(response: debugprotocol.DebugProtocol.LaunchResponse, launchRequestArgs: ILaunchRequestArguments, request?: debugprotocol.DebugProtocol.Request) {
		debugadapter.logger.setup(debugadapter.Logger.LogLevel.Verbose, false, false);

		const uds: UmajinDebugSession = this;
		this._wsPath = umajin!.getWsPath();
		this._collapseLongMessages = umajin!.getCollapseLongMessages();
		const simulateCompiler: string = umajin!.getSimulateCompiler();
		const simulatePlatform: string = umajin!.getSimulatePlatform();
		const useJit: boolean =
			(simulateCompiler === 'JIT') &&
			((simulatePlatform === 'native') ||
				(simulatePlatform ===
					(isWindows ? 'win32' :
						(isOSX ? 'osx' :
							(isLinux ? 'linux' : 'native')))));

		const program: string = useJit ? umajin!.getUmajinJitFullPath() : umajin!.getUmajincFullPath();

		let reLogMessageString: string = '^(([^:]+):(\\d+)(?::(\\d+))?.*)?\t([^\t]+\t(\\w+)\t(\\w+)';
		//                                 12     2 3    3_   4    4_   1   5        6   6   7    7
		//                                 s                                 t*      lp      ll

		let logFormat: string = 's:t';
		if (launchRequestArgs.logFormatTimestamp !== undefined) {
			switch (launchRequestArgs.logFormatTimestamp) {
				case 'milli':
					break;

				case 'milli_float':
					logFormat += 'f';
					break;

				case 'micro':
					logFormat += 'u';
					break;

				case 'world_clock':
					logFormat += 'w';
					break;
			}
		}
		logFormat += ':lp:ll';
		if ((launchRequestArgs.logFormatThread !== undefined) && launchRequestArgs.logFormatThread) {
			logFormat += ':h';
			reLogMessageString += '\t(?:[^\t]*)';
			//
			//                       h
		}
		if ((launchRequestArgs.logFormatEngineSourceInfo !== undefined) && launchRequestArgs.logFormatEngineSourceInfo) {
			logFormat += ':e';
			reLogMessageString += '\t(?:[^\t]*)';
			//
			//                       e
		}
		reLogMessageString += '\t(.*))$';
		//                       8  85
		//                       *

		this._reLogMessage = new RegExp(reLogMessageString);

		let logLevel: 'critical' | 'error' | 'warning' | 'info' | 'debug' | 'verbose' = 'info';
		if (launchRequestArgs.logLevel !== undefined) {
			logLevel = launchRequestArgs.logLevel;
		}

		let rootFile: string = umajin!.getRoot();
		if (launchRequestArgs.overrideRootFile !== undefined) {
			rootFile = launchRequestArgs.overrideRootFile;
		}

		let programArgs: string[] = ['--log-output=stdout', `--log-level=${logLevel}`, `--log-format=${logFormat}`, `--script=${rootFile}`];
		if (!useJit) {
			switch (simulatePlatform) {
				case 'native':
					break;

				case 'win32':
					programArgs = programArgs.concat(['--target=x86_64-pc-windows-msvc']);
					break;

				case 'osx':
					programArgs = programArgs.concat(['--target=x86_64-apple-darwin']);
					break;

				case 'ios':
					programArgs = programArgs.concat(['--target=arm64-apple-ios']);
					break;

				case 'android':
					programArgs = programArgs.concat(['--target=aarch64-linux-android']);
					break;

				case 'linux':
					programArgs = programArgs.concat(['--target=x86_64-unknown-linux-gnu']);
					break;
			}
			programArgs = programArgs.concat(['--print-llvm-ir=none:']);
		}
		if (this._hasDebugger && !launchRequestArgs.noDebug) {
			this._createDebugger();
			programArgs = programArgs.concat(['--generate-debug-code']);
		} else {
			this._debugger = null;
		}
		if (launchRequestArgs.arguments !== undefined) {
			programArgs = programArgs.concat(launchRequestArgs.arguments);
		}
		{
			const e: debugprotocol.DebugProtocol.OutputEvent = new debugadapter.OutputEvent(`Launching '${program} ${programArgs.join(' ')}'  ...\n`, 'console');
			this.sendEvent(e);
		}

		const options: child_process.SpawnOptionsWithStdioTuple<child_process.StdioNull, child_process.StdioPipe, child_process.StdioPipe> = {
			detached: true,
			cwd: this._wsPath,
			stdio: ['ignore', 'pipe', 'pipe']
		};
		const child = child_process.spawn(program, programArgs, options)
			.on('error', (err: Error) => {
				const event: debugprotocol.DebugProtocol.OutputEvent = new debugadapter.OutputEvent(
					`Umajin launch error: ${err}\n`,
					'console');
				uds.sendEvent(event);

				uds.sendEvent(new debugadapter.TerminatedEvent());

				this._child = null;
			})
			.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
				const event: debugprotocol.DebugProtocol.OutputEvent = new debugadapter.OutputEvent(
					(signal !== null) ?
						`Umajin exited with code ${code}, signal ${signal}\n` :
						`Umajin exited with code ${code}\n`,
					'console');
				uds.sendEvent(event);
				if (code !== null) {
					uds.sendEvent(new debugadapter.ExitedEvent(code));
				}
				uds.sendEvent(new debugadapter.TerminatedEvent());

				this._child = null;
			});

		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			uds._processStdout(chunk);
		});

		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			uds._processStderr(chunk);
		});

		this._child = child;

		this.sendResponse(response);
	}

	protected override async attachRequest(response: debugprotocol.DebugProtocol.AttachResponse, attachRequestArgs: IAttachRequestArguments, request?: debugprotocol.DebugProtocol.Request) {
		const uds: UmajinDebugSession = this;

		this._netLogStream = attachRequestArgs.logStream;

		this._netLogger = new net.Socket()
			.on('connect', () => {
				console.log('Net logger connected');
			})
			.on('close', (hadError: boolean) => {
				console.log('Net logger closed, hadError = ' + hadError);
			})
			.on('data', (data: Buffer) => {
				if (uds._netLogStream) {
					uds._processStdout(data.toString());
				} else {
					// First we need to find the start of a message.
					// The presumptions here are:
					// a message length is between 4 and 0xffffff bytes long
					// and no message contain symbols between 0 and 0x1f (inclusive) except tab, lf, and cr.
					// It means that a combination of 4 printable symbols followed by '\0' signifies that
					// a message header starts at that '\0'.
					// Alternatively if it starts with triple '\0' we assume it's a header
					if (uds._logSyncing) {
						if (data.length >= 3 && data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x00) {
							uds._loggingInputAccumulator.append(data);
							uds._logSyncing = false;
						}
						else {
							for (let i = 0; i < data.length; i++) {
								if (data[i]! >= 0x20 || data[i] === 0x09 /* tab */ || data[i] === 0x0a /* lf */ || data[i] === 0x0d /* cr */) {
									uds._logSyncingPrintables++;
								}
								else {
									if (data[i] === 0x00 && uds._logSyncingPrintables >= 4) {
										uds._loggingInputAccumulator.append(data.slice(i));
										uds._logSyncing = false;
										break;
									}
									uds._logSyncingPrintables = 0;
								}
							}
						}
					}
					else {
						uds._loggingInputAccumulator.append(data);
					}
				}
			});
		this._netLogger!.connect(attachRequestArgs.logPort, attachRequestArgs.logHost || '127.0.0.1');

		this._createDebugger();
		this._debuggingPort = attachRequestArgs.debugPort;
		this._debugger!.connect(attachRequestArgs.debugPort, attachRequestArgs.debugHost || '127.0.0.1');

		this.sendResponse(response);
	}

	protected override async terminateRequest(response: debugprotocol.DebugProtocol.TerminateResponse, args: debugprotocol.DebugProtocol.TerminateArguments, request?: debugprotocol.DebugProtocol.Request) {
		if (this._child) {
			this._child.kill();
		}
		this.sendResponse(response);
	}

	protected override async restartRequest(response: debugprotocol.DebugProtocol.RestartResponse, args: debugprotocol.DebugProtocol.RestartArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async setBreakPointsRequest(response: debugprotocol.DebugProtocol.SetBreakpointsResponse, args: debugprotocol.DebugProtocol.SetBreakpointsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setFunctionBreakPointsRequest(response: debugprotocol.DebugProtocol.SetFunctionBreakpointsResponse, args: debugprotocol.DebugProtocol.SetFunctionBreakpointsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setExceptionBreakPointsRequest(response: debugprotocol.DebugProtocol.SetExceptionBreakpointsResponse, args: debugprotocol.DebugProtocol.SetExceptionBreakpointsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async configurationDoneRequest(response: debugprotocol.DebugProtocol.ConfigurationDoneResponse, args: debugprotocol.DebugProtocol.ConfigurationDoneArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async continueRequest(response: debugprotocol.DebugProtocol.ContinueResponse, args: debugprotocol.DebugProtocol.ContinueArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async nextRequest(response: debugprotocol.DebugProtocol.NextResponse, args: debugprotocol.DebugProtocol.NextArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async stepInRequest(response: debugprotocol.DebugProtocol.StepInResponse, args: debugprotocol.DebugProtocol.StepInArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async stepOutRequest(response: debugprotocol.DebugProtocol.StepOutResponse, args: debugprotocol.DebugProtocol.StepOutArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async stepBackRequest(response: debugprotocol.DebugProtocol.StepBackResponse, args: debugprotocol.DebugProtocol.StepBackArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async reverseContinueRequest(response: debugprotocol.DebugProtocol.ReverseContinueResponse, args: debugprotocol.DebugProtocol.ReverseContinueArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async restartFrameRequest(response: debugprotocol.DebugProtocol.RestartFrameResponse, args: debugprotocol.DebugProtocol.RestartFrameArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async gotoRequest(response: debugprotocol.DebugProtocol.GotoResponse, args: debugprotocol.DebugProtocol.GotoArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async pauseRequest(response: debugprotocol.DebugProtocol.PauseResponse, args: debugprotocol.DebugProtocol.PauseArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async sourceRequest(response: debugprotocol.DebugProtocol.SourceResponse, args: debugprotocol.DebugProtocol.SourceArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async threadsRequest(response: debugprotocol.DebugProtocol.ThreadsResponse, request?: debugprotocol.DebugProtocol.Request) {
		if (this._child || this._debuggerConnected) {
			response.body = { threads: [{ id: 0, name: 'Umajin' }] };
		}
		this.sendResponse(response);
	}

	protected override async terminateThreadsRequest(response: debugprotocol.DebugProtocol.TerminateThreadsResponse, args: debugprotocol.DebugProtocol.TerminateThreadsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async stackTraceRequest(response: debugprotocol.DebugProtocol.StackTraceResponse, args: debugprotocol.DebugProtocol.StackTraceArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async scopesRequest(response: debugprotocol.DebugProtocol.ScopesResponse, args: debugprotocol.DebugProtocol.ScopesArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async variablesRequest(response: debugprotocol.DebugProtocol.VariablesResponse, args: debugprotocol.DebugProtocol.VariablesArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setVariableRequest(response: debugprotocol.DebugProtocol.SetVariableResponse, args: debugprotocol.DebugProtocol.SetVariableArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setExpressionRequest(response: debugprotocol.DebugProtocol.SetExpressionResponse, args: debugprotocol.DebugProtocol.SetExpressionArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async evaluateRequest(response: debugprotocol.DebugProtocol.EvaluateResponse, args: debugprotocol.DebugProtocol.EvaluateArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async stepInTargetsRequest(response: debugprotocol.DebugProtocol.StepInTargetsResponse, args: debugprotocol.DebugProtocol.StepInTargetsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async gotoTargetsRequest(response: debugprotocol.DebugProtocol.GotoTargetsResponse, args: debugprotocol.DebugProtocol.GotoTargetsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async completionsRequest(response: debugprotocol.DebugProtocol.CompletionsResponse, args: debugprotocol.DebugProtocol.CompletionsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async exceptionInfoRequest(response: debugprotocol.DebugProtocol.ExceptionInfoResponse, args: debugprotocol.DebugProtocol.ExceptionInfoArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async loadedSourcesRequest(response: debugprotocol.DebugProtocol.LoadedSourcesResponse, args: debugprotocol.DebugProtocol.LoadedSourcesArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async dataBreakpointInfoRequest(response: debugprotocol.DebugProtocol.DataBreakpointInfoResponse, args: debugprotocol.DebugProtocol.DataBreakpointInfoArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async setDataBreakpointsRequest(response: debugprotocol.DebugProtocol.SetDataBreakpointsResponse, args: debugprotocol.DebugProtocol.SetDataBreakpointsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async readMemoryRequest(response: debugprotocol.DebugProtocol.ReadMemoryResponse, args: debugprotocol.DebugProtocol.ReadMemoryArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async writeMemoryRequest(response: debugprotocol.DebugProtocol.WriteMemoryResponse, args: debugprotocol.DebugProtocol.WriteMemoryArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async disassembleRequest(response: debugprotocol.DebugProtocol.DisassembleResponse, args: debugprotocol.DebugProtocol.DisassembleArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async cancelRequest(response: debugprotocol.DebugProtocol.CancelResponse, args: debugprotocol.DebugProtocol.CancelArguments, request?: debugprotocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async breakpointLocationsRequest(response: debugprotocol.DebugProtocol.BreakpointLocationsResponse, args: debugprotocol.DebugProtocol.BreakpointLocationsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setInstructionBreakpointsRequest(response: debugprotocol.DebugProtocol.SetInstructionBreakpointsResponse, args: debugprotocol.DebugProtocol.SetInstructionBreakpointsArguments, request?: debugprotocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}


	private _processStdout(chunk: string) {
		this._stdoutTail = this._processChunk(this._stdoutTail + chunk, 'stdout');
	}

	private _processStderr(chunk: string) {
		this._stderrTail = this._processChunk(this._stderrTail + chunk, 'stderr');
	}

	private _processChunk(chunk: string, stream: string): string {
		for (let index = chunk.indexOf('\n'); index !== -1; index = chunk.indexOf('\n')) {
			this._processLine(chunk.substring(0, index), stream);
			chunk = chunk.substring(index + 1);
		}
		return chunk;
	}

	private _processLine(line: string, stream: string) {
		let event: debugprotocol.DebugProtocol.OutputEvent = new debugadapter.OutputEvent(line + '\n', stream);
		let looksLike: 'first' | 'single' | 'extra' = 'single';
		let emitEnd: boolean = false;

		const match: RegExpMatchArray | null = line.match(this._reLogMessage);
		if (match !== null) {
			if (match[UmajinDebugSession._reLogMessageIndexScriptSourceInfo] !== undefined && match[UmajinDebugSession._reLogMessageIndexScriptSourceInfo]!.length > 0) {
				event.body.source = new debugadapter.Source(match[UmajinDebugSession._reLogMessageIndexScriptSourceInfoFile]!, this.convertDebuggerPathToClient(path.resolve(this._wsPath + path.sep + match[UmajinDebugSession._reLogMessageIndexScriptSourceInfoFile]!)));
				event.body.line = this.convertDebuggerLineToClient(parseInt(match[UmajinDebugSession._reLogMessageIndexScriptSourceInfoLine]!));
				if (match[UmajinDebugSession._reLogMessageIndexScriptSourceInfoColumn] !== undefined) {
					event.body.column = this.convertDebuggerColumnToClient(parseInt(match[UmajinDebugSession._reLogMessageIndexScriptSourceInfoColumn]!));
				}
			}

			// applying output highlighting rules
			const output: string | undefined = umajin!.highlightOutput(
				match[UmajinDebugSession._reLogMessageIndexScriptSourceInfo]!,
				match[UmajinDebugSession._reLogMessageIndexLogProducer]!,
				match[UmajinDebugSession._reLogMessageIndexLogLevel]!,
				match[UmajinDebugSession._reLogMessageIndexMessage]!,
				match[UmajinDebugSession._reLogMessageIndexWholeMessage]!);
			if (output === undefined) // it was removed
			{
				return;
			}
			event.body.output = output + '\n';

			// collapse long messages
			if (this._collapseLongMessages) {
				if (match[UmajinDebugSession._reLogMessageIndexLogProducer] === 'COMPILER') {
					if (match[UmajinDebugSession._reLogMessageIndexMessage]?.startsWith('... ') ||
						match[UmajinDebugSession._reLogMessageIndexMessage]?.startsWith('(Control this diagnostic via')) {
						looksLike = 'extra';
					} else {
						looksLike = 'first';
					}
				}
			}
		}

		// process collapsing long messages - if collapsing is turned off then all of the `if`s below are skipped
		if (looksLike !== 'extra') {
			if (this._lastCompilerOutputEvent) {
				if (this._lastCompilerOutputEvent.body.group === 'startCollapsed') {
					delete this._lastCompilerOutputEvent.body.group;
				} else {
					emitEnd = true;
				}
			}
		}

		if (this._lastCompilerOutputEvent) {
			if (this._lastCompilerOutputEvent.body.group === 'startCollapsed') {
				// emit start twice because 'startCollapsed' does not show the source info
				this.sendEvent(this._lastCompilerOutputEvent);
				delete this._lastCompilerOutputEvent.body.group;
			}
			this.sendEvent(this._lastCompilerOutputEvent);
			delete this._lastCompilerOutputEvent;
		}

		if (emitEnd) {
			// emit 'end' separately with empty output because otherwise it is shown outside
			const endEvent: debugprotocol.DebugProtocol.OutputEvent = new debugadapter.OutputEvent('', stream);
			endEvent.body.group = 'end';
			this.sendEvent(endEvent);
		}

		if (looksLike === 'single') {
			if (this._debugger !== null && !this._debugger.connecting && !this._debuggerConnected && match !== null) {
				const messageItself: string = match[UmajinDebugSession._reLogMessageIndexMessage]!;
				if (messageItself.startsWith(UmajinDebugSession._EIDPortMessage)) {
					this._debuggingPort = Number(messageItself.substring(UmajinDebugSession._EIDPortMessage.length));
					this._connectToDebugger();
				}
			}
			this.sendEvent(event);
		} else {
			this._lastCompilerOutputEvent = event;
			if (looksLike === 'first') {
				this._lastCompilerOutputEvent.body.group = 'startCollapsed';
			}
		}
	}

	private _connectToDebugger() {
		if (this._debugger && this._debuggingPort !== 0) {
			this._debugger.connect(this._debuggingPort);
		}
	}

	private _processDebugging(data: Buffer) {
		const message: any = JSON.parse(data.toString('utf-8'));
		if (message.type === 'response') {
			if (message.request_seq !== undefined) {
				if (this._sentRequests[message.request_seq] !== undefined) {
					this._sentRequests[message.request_seq]!.callback(message);
					delete this._sentRequests[message.request_seq];
				}
				else {
					console.log('Received message\'s request_seq didn\'t match any of saved requests');
				}
			}
			else {
				console.log('Received message does not have request_seq');
			}
		}
		else if (message.type === 'event') {
			this.sendEvent(message);
		}
		else if (message.type === 'request') {
			console.log('Do not know how to process requests');
		}
		else if (message.type !== undefined) {
			console.log(`Do not know how to process message ${message.type}`);
		}
		else if (message.type !== undefined) {
			console.log('Do not know how to process a message without type');
		}
	}

	private _redirectToDebugger(response: debugprotocol.DebugProtocol.Response, request?: debugprotocol.DebugProtocol.Request) {
		if (request) {
			this._sendToDebugger(new NetRequest(request, response, (response: debugprotocol.DebugProtocol.Response) => {
				this.sendResponse(response);
			}));
		}
	}

	private _sendToDebugger(request: NetRequest) {
		if (this._debugger) {
			if (this._debuggerConnected) {
				// store for reply matching
				this._sentRequests[request.request.seq] = request;
				const data: Buffer = Buffer.from(JSON.stringify(request.request), "utf-8");
				let header: Buffer = Buffer.alloc(4);
				header.writeUInt32BE(data.length); // network order
				this._debugger.write(header);
				this._debugger.write(data);
			}
			else {
				// store to be sent on connect
				this._sendOnConnect.push(request);
			}
		}
		else {
			request.callback();
		}
	}
}
