'use strict';

import * as fs from 'fs';
import * as vscode from 'vscode';
import * as langclient from 'vscode-languageclient/node';
import * as path from 'path';
import * as child_process from 'child_process';
import * as debugadapter from '@vscode/debugadapter';
import * as debugprotocol from '@vscode/debugprotocol';
import * as packageJson from './package.json';

interface ILaunchRequestArguments extends debugprotocol.DebugProtocol.LaunchRequestArguments {
	arguments?: string[];
}


const isWindows = (process.platform === 'win32');
const isOSX = (process.platform === 'darwin');


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

	public applyTo: 'message' | 'sourceInfo' | 'logLevel' =
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
			this.red = parseInt(match[1], 16);
			this.green = parseInt(match[2], 16);
			this.blue = parseInt(match[3], 16);

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
	private _languageClient?: langclient.LanguageClient = undefined;

	private _wsPath: string = '';

	private _collapseLongMessages: boolean = packageJson.contributes.configuration.properties['umajin.collapseLongMessages'].default;
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

			vscode.commands.registerCommand('umajin.applyAllCodeActions', this.applyAllCodeActions)
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

				vscode.debug.registerDebugConfigurationProvider('umajin', new DebugConfigurationProvider()),

				vscode.debug.registerDebugAdapterDescriptorFactory('umajin', new DebugAdapterDescriptorFactory())
			);
		}
	}

	public destruct() {
		if (this._languageClient) {
			this._languageClient.stop();
		}
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

		if (event.affectsConfiguration('umajin.path.languageServer')) {
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
				'Umajin files': ['u'],
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
					await vscode.window.showInformationMessage(`File "${cwFilename}" already exists.\nDo you want to overwrite it?`, 'Yes', 'No')
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
					await vscode.window.showInformationMessage(`Do you want to open "${cwFilename}" anyway?`, 'Yes', 'No')
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
				self._languageClient!.sendRequest("workspace/executeCommand",
					{
						"command": "applyAllCodeActions",
						"arguments":
							[
								{ "openOnly": openOnly }
							]
					}
				);
			}
			);
	}

	public highlightOutput(sourceInfo: string, logLevel: string, message: string, input: string): string | undefined {
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
						case 'message':
							where = message;
							break;

						case 'sourceInfo':
							where = sourceInfo;
							break;

						case 'logLevel':
							where = logLevel;
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

	private _readConfig() {
		this._wsPath = vscode.workspace.workspaceFolders![0].uri.fsPath;

		this._collapseLongMessages =
			vscode.workspace.getConfiguration().get('umajin.collapseLongMessages', this._collapseLongMessages);

		this._umajincFullPath = makeAbsolute(this._wsPath,
			vscode.workspace.getConfiguration().get('umajin.path.compiler', this._umajincFullPath),
			exeName('umajinc'));

		this._umajinJitFullPath = makeAbsolute(this._wsPath,
			vscode.workspace.getConfiguration().get('umajin.path.jitEngine', this._umajinJitFullPath),
			appName('umajin'));

		this._umajinlsFullPath = makeAbsolute(this._wsPath,
			vscode.workspace.getConfiguration().get('umajin.path.languageServer', this._umajinlsFullPath),
			exeName('umajinls'));

		this._root = makeAbsolute(this._wsPath, '.',
			vscode.workspace.getConfiguration().get('umajin.root', this._root));

		this._simulateCompiler =
			vscode.workspace.getConfiguration().get('umajin.simulate.compiler', this._simulateCompiler);

		this._simulatePlatform =
			vscode.workspace.getConfiguration().get('umajin.simulate.platform', this._simulatePlatform);
	}

	private async _restartLanguageClient() {
		if (this._languageClient) {
			this._languageClient.stop();
		}

		const serverOptions: langclient.ServerOptions = {
			command: this._umajinlsFullPath,
			args: []
		};

		const clientOptions: langclient.LanguageClientOptions = {
			documentSelector: [{ scheme: 'file', language: 'umajin' }]
		};

		this._languageClient = new langclient.LanguageClient(
			'umajinls',
			'Umajin Language Server',
			serverOptions,
			clientOptions
		);

		this._languageClient.start()
			.catch(error => {
				console.error(error);
				this._languageClient = undefined;
			});
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


class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
		config.type = 'umajin';
		config.name = 'Umajin: Run';
		config.request = 'launch';

		return config;
	}
}

class DebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new UmajinDebugSession());
	}
}

class UmajinDebugSession extends debugadapter.LoggingDebugSession {
	private _wsPath: string;
	private _collapseLongMessages: boolean;

	private _stdoutTail: string = '';
	private _stderrTail: string = '';
	private _lastCompilerOutputEvent?: debugprotocol.DebugProtocol.OutputEvent = undefined;

	private static readonly _reSourceInfo: RegExp = /^(([^:]+):(\d+)(?::(\d+))?[^\t]*)?\t(\d+\t(\w+)\t(.*))$/;
	//                                                12       3        4                5     6      7

	public constructor() {
		super();
		this._wsPath = umajin!.getWsPath();
		this._collapseLongMessages = umajin!.getCollapseLongMessages();

		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);
	}

	protected initializeRequest(response: debugprotocol.DebugProtocol.InitializeResponse, args: debugprotocol.DebugProtocol.InitializeRequestArguments): void {
		response.body = response.body || {};
		this.sendResponse(response);

		this.sendEvent(new debugadapter.InitializedEvent());
	}

	protected async launchRequest(response: debugprotocol.DebugProtocol.LaunchResponse, launchRequestArgs: ILaunchRequestArguments) {
		debugadapter.logger.setup(debugadapter.Logger.LogLevel.Verbose, false, false);


		const uds = this;

		this._wsPath = umajin!.getWsPath();
		this._collapseLongMessages = umajin!.getCollapseLongMessages();
		const simulateCompiler = umajin!.getSimulateCompiler();
		const simulatePlatform = umajin!.getSimulatePlatform();
		const useJit = (simulateCompiler === 'JIT') && ((simulatePlatform === 'native') || (simulatePlatform === (isWindows ? 'win32' : (isOSX ? 'osx' : '<unknown>'))));

		const program: string = useJit ? umajin!.getUmajinJitFullPath() : umajin!.getUmajincFullPath();

		let programArgs: string[] = ['--log-output=stdout', '--log-level=verbose', '--log-format=s:t:l', `--script=${umajin!.getRoot()}`];
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
			}
			programArgs = programArgs.concat(['--print-llvm-ir=none:']);
		}
		if (launchRequestArgs.arguments !== undefined) {
			programArgs = programArgs.concat(launchRequestArgs.arguments);
		}
		{
			const e: debugprotocol.DebugProtocol.OutputEvent = new debugadapter.OutputEvent(`Launching "${program} ${programArgs.join(' ')}"  ...\n`, 'console');
			this.sendEvent(e);
		}

		const options: child_process.SpawnOptionsWithStdioTuple<child_process.StdioNull, child_process.StdioPipe, child_process.StdioPipe> = {
			detached: true,
			cwd: this._wsPath,
			stdio: ['ignore', 'pipe', 'pipe']
		};
		const child = child_process.spawn(program, programArgs, options)
			.on('error', (err: Error) => {
				{
					const event: debugprotocol.DebugProtocol.OutputEvent = new debugadapter.OutputEvent(
						`Umajin launch error: ${err}\n`,
						'console');
					uds.sendEvent(event);
				}

				uds.sendEvent(new debugadapter.TerminatedEvent());
			})
			.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
				{
					const event: debugprotocol.DebugProtocol.OutputEvent = new debugadapter.OutputEvent(
						(signal !== null) ?
							`Umajin exited with code ${code}, signal ${signal}\n` :
							`Umajin exited with code ${code}\n`,
						'console');
					uds.sendEvent(event);
				}

				uds.sendEvent(new debugadapter.TerminatedEvent());
			});

		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			uds._processStdout(chunk);
		});

		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			uds._processStderr(chunk);
		});

		this.sendResponse(response);
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

		const match = line.match(UmajinDebugSession._reSourceInfo);
		if (match !== null) {
			if (match[1] !== undefined) {
				event.body.source = new debugadapter.Source(match[2], this.convertDebuggerPathToClient(path.resolve(this._wsPath + path.sep + match[2])));
				event.body.line = this.convertDebuggerLineToClient(parseInt(match[3]));
				if (match[4] !== undefined) {
					event.body.column = this.convertDebuggerColumnToClient(parseInt(match[4]));
				}
			}

			// applying output highlighting rules
			const output: string | undefined = umajin!.highlightOutput(match[1], match[6], match[7], match[5]);
			if (output === undefined) // it was removed
			{
				return;
			}
			event.body.output = output + '\n';

			// collapse long messages
			if (this._collapseLongMessages) {
				if (match[6].startsWith('COMPILER_')) {
					if (match[7].startsWith('... ') || match[7].startsWith('(Control this diagnostic via')) {
						looksLike = 'extra';
					} else {
						looksLike = 'first';
					}
				}
			}
		}

		// process collapsing long messages - if collapsing is turned off then all of the `if`s below are skipped
		if (looksLike !== 'extra') {
			if (this._lastCompilerOutputEvent !== undefined) {
				if (this._lastCompilerOutputEvent.body.group === 'startCollapsed') {
					this._lastCompilerOutputEvent.body.group = undefined;
				} else {
					emitEnd = true;
				}
			}
		}

		if (this._lastCompilerOutputEvent !== undefined) {
			if (this._lastCompilerOutputEvent.body.group === 'startCollapsed') {
				// emit start twice because 'startCollapsed' does not show the source info
				this.sendEvent(this._lastCompilerOutputEvent);
				this._lastCompilerOutputEvent.body.group = undefined;
			}
			this.sendEvent(this._lastCompilerOutputEvent);
			this._lastCompilerOutputEvent = undefined;
		}

		if (emitEnd) {
			// emit 'end' separately with empty output because otherwise it is shown outside
			const endEvent: debugprotocol.DebugProtocol.OutputEvent = new debugadapter.OutputEvent('', stream);
			endEvent.body.group = 'end';
			this.sendEvent(endEvent);
		}

		if (looksLike === 'single') {
			this.sendEvent(event);
		} else {
			this._lastCompilerOutputEvent = event;
			if (looksLike === 'first') {
				this._lastCompilerOutputEvent.body.group = 'startCollapsed';
			}
		}
	}
}
