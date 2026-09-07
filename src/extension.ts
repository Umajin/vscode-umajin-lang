'use strict';

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as process from 'process';
import * as semver from 'semver';
import * as unzipper from 'unzipper';
import * as vscode from 'vscode';

import * as debugAdapter from '@vscode/debugadapter';
import * as debugProtocol from '@vscode/debugprotocol';
import * as languageClient from 'vscode-languageclient/node';

import * as packageJson from '../package.json';


interface ILaunchRequestArguments extends debugProtocol.DebugProtocol.LaunchRequestArguments {
	arguments?: string[];
	engineArguments?: string[];
	scriptArguments?: string[];
	env?: { [key: string]: string };
	envUnset?: string[];
	logFormatEngineSourceInfo?: boolean,
	logFormatThread?: boolean,
	logFormatTimestamp?: 'milli' | 'milli_float' | 'micro' | 'world_clock';
	logLevel?: 'critical' | 'error' | 'warning' | 'info' | 'debug' | 'verbose';
	logToFile?: string;
	overrideRootFile?: string;
	overrideUI?: string;
}

interface IAttachRequestArguments extends debugProtocol.DebugProtocol.AttachRequestArguments {
	logHost?: string;
	logPort: number;
	logStream: boolean;
	debugHost?: string;
	debugPort: number;
}

// As `umajinls` understands them
enum PlatformNameValue {
	WindowsX64 = 'windows',
	MacArm64 = 'mac-arm64',
	LinuxX64 = 'linux-x86_64',
	LinuxArm64 = 'linux-aarch64'
};

type PlatformName = PlatformNameValue.WindowsX64 | PlatformNameValue.MacArm64 | PlatformNameValue.LinuxX64 | PlatformNameValue.LinuxArm64;

class Platform {
	public readonly isWindows: boolean;
	public readonly isMac: boolean;
	public readonly isLinux: boolean;

	public readonly isX64: boolean;
	public readonly isArm64: boolean;
	public readonly isSupported: boolean;

	public static readonly WindowsPlatformName: string = 'win32';
	public static readonly MacPlatformName: string = 'darwin';
	public static readonly LinuxPlatformName: string = 'linux';

	public static readonly X64ArchitectureName: string = 'x64';
	public static readonly Arm64ArchitectureName: string = 'arm64';

	public readonly configGenericSuffix: string;

	public readonly configSpecificSuffix: string;

	public readonly nameForCompiler: PlatformName;

	public readonly redirectionFolder: string;

	public constructor(platformName: string, architectureName: string) {
		this.isWindows = (platformName === Platform.WindowsPlatformName);
		this.isMac = (platformName === Platform.MacPlatformName);
		this.isLinux = (platformName === Platform.LinuxPlatformName);

		this.isX64 = (architectureName === Platform.X64ArchitectureName);
		this.isArm64 = (architectureName === Platform.Arm64ArchitectureName);
		this.isSupported =
			(this.isWindows && this.isX64) ||
			(this.isMac && this.isArm64) ||
			(this.isLinux && (this.isX64 || this.isArm64));

		this.configGenericSuffix =
			this.isWindows ?
				'.windows' : (
					this.isMac ?
						'.mac' :
					/* this.isLinux */ '.linux');

		this.configSpecificSuffix =
			this.isWindows ?
				'.windows' : (
					this.isMac ? '.mac' :
					/* this.isLinux */ (this.isX64 ? '.linux.x86_64' : '.linux.aarch64'));

		this.nameForCompiler =
			this.isWindows ?
				PlatformNameValue.WindowsX64 : (
					this.isMac ? PlatformNameValue.MacArm64 :
					/* this.isLinux */ (this.isX64 ? PlatformNameValue.LinuxX64 : PlatformNameValue.LinuxArm64));

		this.redirectionFolder =
			this.isWindows ?
				'.' : (
					this.isMac ? (`Darwin${path.sep}arm64`) :
					/* this.isLinux */ (`Linux${path.sep}${(this.isX64 ? 'x86_64' : 'aarch64')}`));
	}

	public redirectedPath(filename: string): string {
		return this.isWindows ? filename : path.resolve(path.dirname(filename) + path.sep + this.redirectionFolder + path.sep + path.basename(filename));
	}

	public binName(name: string): string {
		return this.isWindows ?
			(name + '.exe') :
			name;
	};

	public appName(name: string): string {
		return this.isMac ?
			(name + '.app') :
			this.binName(name);
	};

	public binInAppName(name: string): string {
		return this.isMac ?
			(`${this.appName(name)}${path.sep}Contents${path.sep}MacOS${path.sep}${this.binName(name)}`) :
			this.binName(name);
	};

};

const nativePlatform: Platform = new Platform(os.platform(), os.arch());


const operatorSymbols: Record<string, string> = {
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
};


function makeAbsolute(basePart: string, pathPart: string, filePart: string): string {
	if (!path.isAbsolute(pathPart)) {
		pathPart = basePart + path.sep + pathPart;
	}
	return path.resolve(pathPart + path.sep + filePart);
}


function jsonParse(str: string): any {
	try {
		return JSON.parse(str);
	} catch {
		return {};
	}
};


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


class Channel {
	public title: string = '';
	public url: string = '';
};
type Channels = Channel[];


class Color {
	public red: number = 0;
	public green: number = 0;
	public blue: number = 0;

	private static readonly _reHexColor: RegExp = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

	public constructor(hex?: string) {
		if (hex) {
			const match: RegExpMatchArray | null = hex.match(Color._reHexColor);
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
		const mixed: Color = new Color();
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
};



const platformRedirectorName: string = 'platform-redirector';
const platformRedirectorContent: string = '#!/bin/sh\n\n"`dirname "$0"`/`uname -s`/`uname -m`/`basename "$0"`" "$@"\n';


enum Binary {
	GUI = 'umajin',
	CLI = 'umajin_cli',
	Compiler = 'umajinc',
	LS = 'umajinls'
};

class EngineUpdateUIItem implements vscode.QuickPickItem {
	readonly binary: Binary;
	readonly label: string;
	readonly kind: vscode.QuickPickItemKind = vscode.QuickPickItemKind.Default;
	readonly description: string;
	readonly detail: string;

	public constructor(binary: Binary, label: string, description: string, detail: string) {
		this.binary = binary;
		this.label = label;
		this.description = description;
		this.detail = detail;
	}
};

class EngineUpdatePlatformItem implements vscode.QuickPickItem {
	readonly platformName: PlatformName;
	readonly label: string;
	readonly kind: vscode.QuickPickItemKind = vscode.QuickPickItemKind.Default;
	readonly description: string;
	readonly detail: string;

	public constructor(platformName: PlatformName, label: string, description: string = '', detail: string = '') {
		this.platformName = platformName;
		this.label = label;
		this.description = description;
		this.detail = detail;
	}
};

class EngineUpdateSimulationPlatformItem implements vscode.QuickPickItem {
	readonly withSimCross: boolean;
	readonly label: string;
	readonly kind: vscode.QuickPickItemKind = vscode.QuickPickItemKind.Default;
	readonly description: string;
	readonly detail: string;

	public constructor(withSimCross: boolean, label: string, description: string, detail: string) {
		this.withSimCross = withSimCross;
		this.label = label;
		this.description = description;
		this.detail = detail;
	}
};

class EngineUpdateChannelItem implements vscode.QuickPickItem {
	readonly channel: Channel;
	readonly label: string;
	readonly kind: vscode.QuickPickItemKind = vscode.QuickPickItemKind.Default;
	readonly description: string;
	readonly detail: string;

	public constructor(channel: Channel, label: string, description: string = '', detail: string = '') {
		this.channel = channel;
		this.label = label;
		this.description = description;
		this.detail = detail;
	}
};

class EngineUpdateJobsetItem implements vscode.QuickPickItem {
	readonly jobDescription: string;
	readonly label: string;
	readonly kind: vscode.QuickPickItemKind = vscode.QuickPickItemKind.Default;
	readonly description: string;
	readonly detail: string;

	public constructor(jobDescription: string, timestamp: number) {
		this.jobDescription = jobDescription;
		const match: RegExpMatchArray | null = this.jobDescription.match(/^\<pre\>([^<]*)\<br\/\>([^<]*)\<\/pre\>$/);
		if (match) {
			this.label = match[2]!;
			this.detail = match[1]!;
		}
		else {
			this.label = jobDescription;
			this.detail = '';
		}
		this.description = new Date(timestamp).toLocaleString();
	}
};

// As jenkins job are named
enum JobPlatformNameValue {
	WindowsX64 = 'win',
	MacArm64 = 'mac-arm64',
	LinuxX64 = 'linux-x86_64',
	LinuxArm64 = 'linux-arm64'
};

class Artifact {
	readonly URL: string;
	readonly timestamp: number;

	public constructor(URL: string, timestamp: number) {
		this.URL = URL;
		this.timestamp = timestamp;
	}
};

enum FileInZipKind {
	Regular,
	Symlink,
	Ignore,
	Unsupported
};

type VSCodeProgress = vscode.Progress<{
	message?: string;
	increment?: number;
}>;

class Progress {
	private _base: number = 0;
	private _total: number = 1;
	private _done: number = 0;
	private _vscProgress: VSCodeProgress;
	private _nextStep: () => void;
	private _resolve: (value: void | PromiseLike<void>) => void;

	public constructor(vscProgress: VSCodeProgress, nextStep: () => void, resolve: (value: void | PromiseLike<void>) => void) {
		this._vscProgress = vscProgress;
		this._nextStep = nextStep;
		this._resolve = resolve;

		this._vscProgress.report({ increment: 0 });
	}

	private _updateProgress() {
		this._vscProgress.report({ increment: this._base + (100 - this._base) * this._done / this._total });
	}

	public setBase(base: number) {
		this._base = base;
		this._updateProgress();
	}

	public setTotal(total: number) {
		this._total = total;
		this._updateProgress();
	}

	public addPart() {
		this._total++;
		this._updateProgress();
	}

	public partFinished() {
		this._done++;
		this._updateProgress();

		if (this._done === this._total) {
			this._resolve();
			this._nextStep();
		}
	}
};

class EngineUpdateContext {
	private _ext: UmajinExtension;

	private static readonly platforms = new Map<PlatformName, Platform>([
		[PlatformNameValue.WindowsX64, /**/ new Platform(Platform.WindowsPlatformName, /**/Platform.X64ArchitectureName)],
		[PlatformNameValue.MacArm64, /*  */ new Platform(Platform.MacPlatformName, /*    */Platform.Arm64ArchitectureName)],
		[PlatformNameValue.LinuxX64, /*  */ new Platform(Platform.LinuxPlatformName, /*  */Platform.X64ArchitectureName)],
		[PlatformNameValue.LinuxArm64, /**/ new Platform(Platform.LinuxPlatformName, /*  */Platform.Arm64ArchitectureName)]
	]);

	private static readonly jobNameMapper = new Map<string, PlatformName>([
		[JobPlatformNameValue.WindowsX64, /**/ PlatformNameValue.WindowsX64],
		[JobPlatformNameValue.MacArm64, /*  */ PlatformNameValue.MacArm64],
		[JobPlatformNameValue.LinuxX64, /*  */ PlatformNameValue.LinuxX64],
		[JobPlatformNameValue.LinuxArm64, /**/ PlatformNameValue.LinuxArm64]
	]);

	private static readonly allBinaries = new Set<Binary>([
		Binary.GUI,
		Binary.CLI,
		Binary.Compiler,
		Binary.LS
	]);

	private _redirectedBinaries = new Set<string>();

	// Not tracking the presence of the platform redirector.
	// The original idea was: if a redirector is present: keep it.
	// The current idea is: wipe old, install new, if only 1 *nix platform: no redirector is needed.
	// private _hasPlatformRedirector = false;

	private _needPlatformRedirector = false;

	private _presentBinaries = new Map<PlatformName, Map<Binary, string>>();

	private static readonly knownAssociatedFiles = new Set<string>([
		'stdlib.u', // always delete it - by the end it will be either regenerated or absent, but not outdated!
		'd3dcompiler_47.dll',
		'libcrypto-1_1-x64.dll',
		'libssl-1_1-x64.dll',
		'llc.exe',
		'Microsoft.Web.WebView2.Core.dll',
		'Microsoft.Web.WebView2.Core.winmd',
		'Microsoft.WindowsAppRuntime.Bootstrap.dll',
		'openh264-2.5.1-win64.dll',
		'rlottie.dll',
		'umajin_cli.pdb',
		'umajin.pdb',
		'umajinc.pdb',
		'umajinls.pdb'
	]);

	private _presentAssociatedFiles = new Set<string>();

	private _detectedUIs = new Set<Binary>();
	private _detectedPlatforms = new Set<PlatformName>();

	private _selectedUIs = new Set<Binary>();
	private _selectedDevPlatforms = new Set<PlatformName>();
	private _withSimCross: boolean = false;
	private _selectedRunPlatforms = new Set<PlatformName>();
	private _selectedChannel: Channel | undefined = undefined;
	private _selectedJobset: EngineUpdateJobsetItem | undefined = undefined;

	private _URLs = new Map<Binary, Map<PlatformName, string>>();
	private _zips = new Map<string, Map<Binary, Map<PlatformName, Artifact>>>();

	private _needRedirection = new Set<Binary>();

	public constructor(ext: UmajinExtension) {
		this._ext = ext;
		EngineUpdateContext.platforms.forEach((_value, key) => {
			this._presentBinaries.set(key, new Map<Binary, string>());
		});

		this._scanLocalfiles();
	}

	private _cacheFolder(): string {
		return `${this._ext.getWsPath()}${path.sep}.vscode${path.sep}.umajin-engine-update-cache`;
	}

	private _scanLocalfiles() {
		this._ext.log("Engine update step 1: Scan local files");
		vscode.window.withProgress<void>({
			location: vscode.ProgressLocation.Notification,
			title: 'Engine update: Scanning local files',
			cancellable: true
		}, (vscProgress, token) => {
			token.onCancellationRequested(() => {
				this._ext.log("Engine update cancelled - User cancelled scanning local files");
			});

			return new Promise<void>((resolve, reject) => {
				const progress = new Progress(vscProgress, () => {
					this._checkInside();
				}, resolve);

				fs.readdir(this._ext.getWsPath(), { withFileTypes: true }, (errno, files: fs.Dirent[]) => {
					if (errno !== null) {
						this._ext.reportFailureAndReject(reject, `Cannot read folder "${this._ext.getWsPath()}": ${errno}`);
					} else {
						progress.setBase(25);
						files.forEach((dirent) => {
							/* this._ext.log('parentPath: "' + dirent.parentPath +
								'" name: "' + dirent.name +
								'" isFile: ' + dirent.isFile() +
								' isDirectory: ' + dirent.isDirectory() +
								' isBlockDevice: ' + dirent.isBlockDevice() +
								' isCharacterDevice: ' + dirent.isCharacterDevice() +
								' isSymbolicLink: ' + dirent.isSymbolicLink() +
								' isFIFO: ' + dirent.isFIFO() +
								' isSocket: ' + dirent.isSocket()); */
							if (dirent.isSymbolicLink()) {
								progress.addPart();
								const filename: string = dirent.parentPath + path.sep + dirent.name;
								fs.readlink(filename, (errno, linkString: string) => {
									if (errno !== null) {
										this._ext.logError(`Cannot read link "${filename}: ${errno}`);
									} else {
										if (linkString === platformRedirectorName) {
											this._ext.log(`File "${dirent.name}" is redirected`);
											this._redirectedBinaries.add(filename);
											// this._hasPlatformRedirector = true;
										}
										progress.partFinished();
									}
								});
								// } else if (dirent.isFile()) {
								// 	if (dirent.name === platformRedirectorName) {
								// 		this._ext.log('Found "platform-redirector"');
								// 		this._hasPlatformRedirector = true;
								// 	}
							}
						});
						progress.partFinished(); // the initial presumed part, as we never set the total, only increased it
					}
				});
			});
		});
	}

	// check that all binaries are inside the workspace
	private _checkInside() {
		this._ext.log("Engine update step 2: Check all the binaries are inside the workspace");
		let outside: string = '';
		const wsPath: string = this._ext.getWsPath();

		EngineUpdateContext.allBinaries.forEach((binaryValue) => {
			const platforms = new Set<PlatformName>();
			EngineUpdateContext.platforms.forEach((platformValue, platformKey) => {
				if (!this._ext.getBundlePath(platformValue, binaryValue).startsWith(wsPath)) {
					platforms.add(platformKey);
				}
			});
			if (platforms.size !== 0) {
				outside += ' '.repeat(60) + '\n  • Umajin ';
				switch (binaryValue) {
					case Binary.GUI:
						outside += 'GUI JIT engine:';
						break;

					case Binary.CLI:
						outside += 'CLI JIT engine:';
						break;

					case Binary.Compiler:
						outside += 'compiler:';
						break;

					case Binary.LS:
						outside += 'language server:';
						break;
				}
				if (platforms.size === EngineUpdateContext.platforms.size) {
					outside += ' All platforms';
				} else {
					platforms.forEach((platformKey) => {
						outside += ' '.repeat(60) + '\n    • ';
						switch (platformKey) {
							case PlatformNameValue.WindowsX64:
								outside += 'Windows';
								break;

							case PlatformNameValue.MacArm64:
								outside += 'Mac (Apple Silicon)';
								break;

							case PlatformNameValue.LinuxX64:
								outside += 'Linux (x86_64)';
								break;

							case PlatformNameValue.LinuxArm64:
								outside += 'Linux (aarch64)';
								break;
						}
					});
				}
			}
		});

		if (outside.length === 0) {
			this._locateOld();
		} else {
			this._ext.reportFailure(`Cannot automatically update Umajin engine, because the following binaries are outside the workspace: ${outside}`);
		}
	}

	private _locateOld() {
		this._ext.log("Engine update step 3: Locate the old installation");
		vscode.window.withProgress<void>({
			location: vscode.ProgressLocation.Notification,
			title: 'Engine update: Looking for the old installation',
			cancellable: true
		}, (vscProgress, token) => {
			token.onCancellationRequested(() => {
				this._ext.log("Engine update cancelled - User cancelled looking for the old installation");
			});

			return new Promise<void>((resolve, _reject) => {
				const progress = new Progress(vscProgress, () => {
					// print results:
					this._presentBinaries.forEach((binaryMap, platformKey) => {
						binaryMap.forEach((filename, binaryKey) => {
							this._ext.log(`Found binary ${platformKey} ${binaryKey}: "${filename}"`);
							this._detectedUIs.add(binaryKey);
							this._detectedPlatforms.add(platformKey);
						});
					});
					this._presentAssociatedFiles.forEach((filename) => {
						this._ext.log(`Found an associated file "${filename}"`);
					});

					// move to the next step:
					this._selectUIs();
				}, resolve);

				const associatedFiles = new Set<string>();

				const windowsPlatform: Platform = EngineUpdateContext.platforms.get(PlatformNameValue.WindowsX64)!;

				EngineUpdateContext.knownAssociatedFiles.forEach((associatedFile) => {
					EngineUpdateContext.allBinaries.forEach((binaryValue) => {
						associatedFiles.add(this._ext.getFilePath(windowsPlatform, binaryValue, associatedFile));
					});
				});

				const markBinaryPresent = (platformName: PlatformName, binary: Binary, filename: string) => {
					const binaryMap: Map<Binary, string> = this._presentBinaries.get(platformName)!;
					binaryMap.set(binary, filename);
					this._presentBinaries.set(platformName, binaryMap);
				};

				const markArtifactPresent = (filename: string) => {
					this._presentAssociatedFiles.add(filename);
				};

				progress.setTotal(
					// all binaries
					EngineUpdateContext.platforms.size * EngineUpdateContext.allBinaries.size
					// redirected stdlib.u-s
					+ EngineUpdateContext.platforms.size - 1 /* windows */
					// associated files
					+ associatedFiles.size);

				EngineUpdateContext.platforms.forEach((platformValue, platformKey) => {
					EngineUpdateContext.allBinaries.forEach((binaryValue) => {
						/* windows?
						 *  |n  |y
						 *  |   v
						 *  |  found?
						 *  |   |n |y
						 *  |   |  \-> mark present & set complete (normal setup)
						 *  |   |
						 *  |   \-> set complete (normal setup, platform absent)
						 *  v
						 * found?
						 *  |y  |n
						 *  |   v
						 *  |  look for redirected. found?
						 *  |   |n  |y
						 *  |   |   \-> mark present & set complete (no link, redirected setup is broken, but found the binary)
						 *  |   |
						 *  |   \-> set complete (platform absent, redirector is absent or broken)
						 *  v
						 * is a symlink?
						 *  |y  |n
						 *  |   \-> mark present & set complete (normal direct setup, no redirector)
						 *  v
						 * can read symlink?
						 *  |y  |n
						 *  |   \-> mark present & set complete (something is broken - symlink cannot be read, something else might fail later)
						 *  v
						 * points to `platform-redirector`?
						 *  |y  |n
						 *  |   \-> mark present & set complete (custom setup - not sure how it will clash with the platform-redirector)
						 *  v
						 * look for redirected. found?
						 *  |n  |y
						 *  |   \-> mark present & set complete (correct redirected setup)
						 *  |
						 *  \-> set complete (redirector is present, but no binary for this platform)
						 */
						let filename: string = this._ext.getBundlePath(platformValue, binaryValue);
						if (platformKey === PlatformNameValue.WindowsX64) {
							this._ext.log(`Looking for binary "${filename}"`);
							fs.lstat(filename, (errno) => {
								if (errno === null) {
									// windows? y:
									// found? y:
									//   mark present & set complete (normal setup)
									markBinaryPresent(platformKey, binaryValue, filename);
								}
								// windows? y:
								// found? n:
								//   set complete (normal setup, platform absent)
								progress.partFinished();
							});
						}
						else {
							this._ext.log(`Looking for binary "${filename}"`);
							fs.lstat(filename, (errno, stats) => {
								if (errno === null) {
									if (stats.isSymbolicLink()) {
										fs.readlink(filename, (errno, linkString: string) => {
											if (errno === null) {
												if (linkString === platformRedirectorName) {
													filename = platformValue.redirectedPath(filename);
													this._ext.log(`Looking for binary "${filename}"`);
													fs.lstat(filename, (errno) => {
														if (errno === null) {
															// windows? n:
															// found? y:
															// is a symlink? y:
															// can read symlink? y:
															// points to `platform-redirector`? y:
															// look for redirected. found? y:
															//   mark present & set complete (correct redirected setup)
															markBinaryPresent(platformKey, binaryValue, filename);
														}
														// windows? n:
														// found? y:
														// is a symlink? y:
														// can read symlink? y:
														// points to `platform-redirector`? y:
														// look for redirected. found? n:
														//   set complete (redirector is present, but no binary for this platform)
														progress.partFinished();
													});
												} else {
													// windows? n:
													// found? y:
													// is a symlink? y:
													// can read symlink? y:
													// points to `platform-redirector`? n:
													//   mark present & set complete (custom setup - not sure how it will clash with the platform-redirector)
													markBinaryPresent(platformKey, binaryValue, filename);
													progress.partFinished();
												}
											} else {
												// windows? n:
												// found? y:
												// is a symlink? y:
												// can read symlink? n:
												//   mark present & set complete (something is broken - symlink cannot be read, something else might fail later)
												markBinaryPresent(platformKey, binaryValue, filename);
												progress.partFinished();
											}
										});
									} else {
										// windows? n:
										// found? y:
										// is a symlink? n:
										//   mark present & set complete (normal direct setup, no redirector)
										markBinaryPresent(platformKey, binaryValue, filename);
										progress.partFinished();
									}
								} else {
									filename = platformValue.redirectedPath(filename);
									this._ext.log(`Looking for binary "${filename}"`);
									fs.lstat(filename, (errno) => {
										if (errno === null) {
											// windows? n:
											// found? n:
											// look for redirected. found? y:
											//   mark present & set complete (no link, redirected setup is broken, but found the binary)
											markBinaryPresent(platformKey, binaryValue, filename);
										}
										// windows? n:
										// found? n:
										// look for redirected. found? n:
										//   set complete (platform absent, redirector is absent or broken)
										progress.partFinished();
									});
								}
							});
						}
					});

					if (platformKey !== PlatformNameValue.WindowsX64) {
						const filename: string = platformValue.redirectedPath(this._ext.getWsPath() + path.sep + 'stdlib.u');
						this._ext.log(`Looking for symlink "${filename}"`);
						fs.lstat(filename, (errno) => {
							if (errno === null) {
								markArtifactPresent(filename);
							}
							progress.partFinished();
						});
					}
				});

				associatedFiles.forEach((filename) => {
					this._ext.log(`Looking for an associated file "${filename}"`);
					fs.stat(filename, (errno) => {
						if (errno === null) {
							markArtifactPresent(filename);
						}
						progress.partFinished();
					});
				});
			});
		});
	}

	private _selectUIs() {
		this._ext.log("Engine update step 4: Ask user to select UI");

		const guiItem: EngineUpdateUIItem = new EngineUpdateUIItem(Binary.GUI, 'GUI', '-- Graphical User Interface', '(with a window)');
		const cliItem: EngineUpdateUIItem = new EngineUpdateUIItem(Binary.CLI, 'CLI', '-- Command Line Interface', '(without a window)');

		const selectedItems: EngineUpdateUIItem[] = [];
		if (this._detectedUIs.has(Binary.GUI)) {
			selectedItems.push(guiItem);
		}
		if (this._detectedUIs.has(Binary.CLI)) {
			selectedItems.push(cliItem);
		}

		const uiSelector: vscode.QuickPick<EngineUpdateUIItem> = vscode.window.createQuickPick<EngineUpdateUIItem>();
		uiSelector.title = 'Installing Umajin Engine';
		uiSelector.step = 1;
		uiSelector.totalSteps = 6;
		uiSelector.prompt = 'Choose at least one interface to install';
		uiSelector.placeholder = 'filter';
		uiSelector.matchOnDescription = true;
		uiSelector.matchOnDetail = true;
		uiSelector.canSelectMany = true;
		uiSelector.items = [guiItem, cliItem];
		uiSelector.selectedItems = selectedItems;
		uiSelector.onDidAccept(() => {
			uiSelector.selectedItems.forEach((item) => {
				this._selectedUIs.add(item.binary);
			});
			uiSelector.dispose();

			if (this._selectedUIs.size === 0) {
				vscode.window.showWarningMessage('At least one UI has to be selected. Would you like to try again?', 'Try again', 'Cancel the update').then((value) => {
					if (value === 'Try again') {
						this._selectUIs();
					}
				});
			}
			else {
				this._ext.log(`User selected: ${Array.from(this._selectedUIs).join(', ')}`);
				this._selectDevPlatforms();
			}
		});
		uiSelector.onDidHide(() => {
			uiSelector.dispose();
		});
		uiSelector.show();
	}

	private _selectDevPlatforms() {
		this._ext.log("Engine update step 5: Ask user to select Dev platforms");
		const windowsItem: EngineUpdatePlatformItem = new EngineUpdatePlatformItem(PlatformNameValue.WindowsX64, 'Windows - x86_64', '(Intel/AMD CPUs)', 'x64');
		const macArm64Item: EngineUpdatePlatformItem = new EngineUpdatePlatformItem(PlatformNameValue.MacArm64, 'Mac - arm64', '(Apple Silicon)', 'arm64');
		const linuxX64Item: EngineUpdatePlatformItem = new EngineUpdatePlatformItem(PlatformNameValue.LinuxX64, 'Linux - x86_64', '(Intel/AMD CPUs)', 'x64');
		const linuxArm64Item: EngineUpdatePlatformItem = new EngineUpdatePlatformItem(PlatformNameValue.LinuxArm64, 'Linux - aarch64', '(NVIDIA Jetson Orin, Raspberry Pi)', 'arm64');

		const selectedItems: EngineUpdatePlatformItem[] = [];
		if (this._detectedPlatforms.has(PlatformNameValue.WindowsX64)) {
			selectedItems.push(windowsItem);
		}
		if (this._detectedPlatforms.has(PlatformNameValue.MacArm64)) {
			selectedItems.push(macArm64Item);
		}
		if (this._detectedPlatforms.has(PlatformNameValue.LinuxX64)) {
			selectedItems.push(linuxX64Item);
		}
		if (this._detectedPlatforms.has(PlatformNameValue.LinuxArm64)) {
			selectedItems.push(linuxArm64Item);
		}

		const devPlatformSelector: vscode.QuickPick<EngineUpdatePlatformItem> = vscode.window.createQuickPick<EngineUpdatePlatformItem>();
		devPlatformSelector.title = 'Installing Umajin Engine';
		devPlatformSelector.step = 2;
		devPlatformSelector.totalSteps = 6;
		devPlatformSelector.prompt = 'Choose at least one platform for development';
		devPlatformSelector.placeholder = 'filter';
		devPlatformSelector.matchOnDescription = true;
		devPlatformSelector.matchOnDetail = true;
		devPlatformSelector.canSelectMany = true;
		devPlatformSelector.items = [windowsItem, macArm64Item, linuxX64Item, linuxArm64Item];
		devPlatformSelector.selectedItems = selectedItems;
		devPlatformSelector.onDidAccept(() => {
			devPlatformSelector.selectedItems.forEach((item) => {
				this._selectedDevPlatforms.add(item.platformName);
			});
			devPlatformSelector.dispose();

			if (this._selectedDevPlatforms.size === 0) {
				vscode.window.showWarningMessage('At least one development platform has to be selected. Would you like to try again?', 'Try again', 'Cancel the update').then((value) => {
					if (value === 'Try again') {
						this._selectDevPlatforms();
					}
				});
			}
			else {
				this._ext.log(`User selected: ${Array.from(this._selectedDevPlatforms).join(', ')}`);
				this._selectSimPlatforms();
			}
		});
		devPlatformSelector.onDidHide(() => {
			devPlatformSelector.dispose();
		});
		devPlatformSelector.show();
	}

	private _selectSimPlatforms() {
		this._ext.log("Engine update step 6: Ask user to select Sim platforms");
		const nativeOnlyItem: EngineUpdateSimulationPlatformItem = new EngineUpdateSimulationPlatformItem(false, 'Native only', '', '');
		const crossSimItem: EngineUpdateSimulationPlatformItem = new EngineUpdateSimulationPlatformItem(true, 'Cross-platform', '', 'Compilation simulation via umajinc');

		const simPlatformSelector: vscode.QuickPick<EngineUpdateSimulationPlatformItem> = vscode.window.createQuickPick<EngineUpdateSimulationPlatformItem>();
		simPlatformSelector.title = 'Installing Umajin Engine';
		simPlatformSelector.step = 3;
		simPlatformSelector.totalSteps = 6;
		simPlatformSelector.prompt = 'Select compilation simulation support';
		simPlatformSelector.placeholder = 'filter';
		simPlatformSelector.matchOnDescription = true;
		simPlatformSelector.matchOnDetail = true;
		simPlatformSelector.items = [nativeOnlyItem, crossSimItem];
		simPlatformSelector.activeItems = [this._detectedUIs.has(Binary.Compiler) ? crossSimItem : nativeOnlyItem];
		simPlatformSelector.onDidAccept(() => {
			simPlatformSelector.selectedItems.forEach((item) => {
				this._withSimCross = item.withSimCross;
			});
			simPlatformSelector.dispose();

			this._ext.log(`User selected: ${(this._withSimCross ? 'with' : 'without')} simulation support`);
			this._selectRunPlatforms();
		});
		simPlatformSelector.onDidHide(() => {
			simPlatformSelector.dispose();
		});
		simPlatformSelector.show();
	}

	private _selectRunPlatforms() {
		this._ext.log("Engine update step 7: Ask user to select Run platforms");
		if (this._selectedDevPlatforms.size === EngineUpdateContext.platforms.size) {
			this._selectChannel();
		} else {
			const allItems = new Map<PlatformName, EngineUpdatePlatformItem>([
				[PlatformNameValue.WindowsX64, new EngineUpdatePlatformItem(PlatformNameValue.WindowsX64, 'Windows - x86_64', '(Intel/AMD CPUs)', 'x64')],
				[PlatformNameValue.MacArm64, new EngineUpdatePlatformItem(PlatformNameValue.MacArm64, 'Mac - arm64', '(Apple Silicon)', 'arm64')],
				[PlatformNameValue.LinuxX64, new EngineUpdatePlatformItem(PlatformNameValue.LinuxX64, 'Linux - x86_64', '(Intel/AMD CPUs)', 'x64')],
				[PlatformNameValue.LinuxArm64, new EngineUpdatePlatformItem(PlatformNameValue.LinuxArm64, 'Linux - aarch64', '(NVIDIA Jetson Orin, Raspberry Pi)', 'arm64')]
			]);

			const items: EngineUpdatePlatformItem[] = [];
			const selectedItems: EngineUpdatePlatformItem[] = [];

			allItems.forEach((platformItem, platformName) => {
				if (!this._selectedDevPlatforms.has(platformName)) {
					items.push(platformItem);
					if (this._detectedPlatforms.has(platformName)) {
						selectedItems.push(platformItem);
					}
				}
			});

			const runPlatformSelector: vscode.QuickPick<EngineUpdatePlatformItem> = vscode.window.createQuickPick<EngineUpdatePlatformItem>();
			runPlatformSelector.title = 'Installing Umajin Engine';
			runPlatformSelector.step = 4;
			runPlatformSelector.totalSteps = 6;
			runPlatformSelector.prompt = 'Choose platforms for launching only (can be none)';
			runPlatformSelector.placeholder = 'filter';
			runPlatformSelector.matchOnDescription = true;
			runPlatformSelector.matchOnDetail = true;
			runPlatformSelector.canSelectMany = true;
			runPlatformSelector.items = items;
			runPlatformSelector.selectedItems = selectedItems;
			runPlatformSelector.onDidAccept(() => {
				runPlatformSelector.selectedItems.forEach((item) => {
					this._selectedRunPlatforms.add(item.platformName);
				});
				runPlatformSelector.dispose();

				if (this._selectedRunPlatforms.size === 0) {
					this._ext.log('User selected nothing');
				} else {
					this._ext.log(`User selected: ${Array.from(this._selectedRunPlatforms).join(', ')}`);
				}
				this._checkIfRedirectionIsNeeded();
			});
			runPlatformSelector.onDidHide(() => {
				runPlatformSelector.dispose();
			});
			runPlatformSelector.show();
		}
	}

	private _checkIfRedirectionIsNeeded() {
		this._ext.log("Engine update step 8: Check if platform redirector is needed");
		// find if there is going to be any clashes
		{
			const allBinaries = new Set<string>();
			const addBinary = (platform: Platform, binary: Binary) => {
				const filename: string = this._ext.getBundlePath(platform, binary);
				if (allBinaries.has(filename)) {
					this._needPlatformRedirector = true;
				} else {
					allBinaries.add(filename);
				}
			};
			this._selectedDevPlatforms.forEach((platformName) => {
				const platform: Platform = EngineUpdateContext.platforms.get(platformName)!;
				addBinary(platform, Binary.LS);
				if (this._withSimCross) {
					addBinary(platform, Binary.Compiler);
				}
				this._selectedUIs.forEach((binary) => {
					addBinary(platform, binary);
				});
			});
			this._selectedRunPlatforms.forEach((platformName) => {
				const platform: Platform = EngineUpdateContext.platforms.get(platformName)!;
				this._selectedUIs.forEach((binary) => {
					addBinary(platform, binary);
				});
			});
		}

		// test if we can create symlinks
		if (this._needPlatformRedirector && nativePlatform.isWindows) {
			const symlink: string = `${this._cacheFolder()}${path.sep}symlinktest`;
			fs.mkdir(path.dirname(symlink), { recursive: true }, (errno) => {
				if (errno !== null) {
					this._ext.reportFailure(`Failed to test symlink creation: Failed to create folder: ${errno}`);
				} else {
					fs.rm(symlink, { recursive: true, force: true }, (errno) => {
						if (errno !== null) {
							this._ext.reportFailure(`Failed to test symlink creation: Failed to remove: ${errno}`);
						} else {
							fs.symlink('.', symlink, (errno) => {
								if (errno !== null) {
									if (errno.code === 'EPERM') {
										this._ext.reportFailure(
											'Selected installation will require creation of symlinks '
											+ 'and the current system setup prohibits them. Most '
											+ 'probably because the Developer Mode is not turned '
											+ 'on. To fix it, launch Windows Settings, search for the '
											+ 'Developer Mode and make sure it is turned on. It can '
											+ 'be located at: '
											+ '   • "Update & Security" > "For developers",       '
											+ '   • "System" > "For developers",                  '
											+ '   • "System" > "Advanced",                        '
											+ '   • or somewhere else.');
									} else {
										this._ext.reportFailure(`Failed to test symlink creation: Failed to create symbolic link: ${errno}`);
									}
								} else {
									fs.rm(symlink, { recursive: true, force: true }, (errno) => {
										if (errno !== null) {
											this._ext.reportFailure(`Failed to test symlink creation: Failed to cleanup: ${errno}`);
										} else {
											this._selectChannel();
										}
									});
								}
							});
						}
					});
				}
			});
		} else {
			this._selectChannel();
		}
	}


	private _selectChannel() {
		this._ext.log("Engine update step 9: Ask user to select distribution channel");
		const channelSelector: vscode.QuickPick<EngineUpdateChannelItem> = vscode.window.createQuickPick<EngineUpdateChannelItem>();
		channelSelector.title = 'Installing Umajin Engine';
		channelSelector.step = 5;
		channelSelector.totalSteps = 6;
		channelSelector.prompt = 'Select distribution channel';
		channelSelector.placeholder = 'filter';
		channelSelector.matchOnDescription = true;
		channelSelector.matchOnDetail = true;
		channelSelector.items = this._ext.getChannels().map(
			(channel) => new EngineUpdateChannelItem(channel, channel.title, '', channel.url)
		);
		channelSelector.onDidAccept(() => {
			this._selectedChannel = channelSelector.selectedItems[0]?.channel;
			channelSelector.dispose();
			if (this._selectedChannel) {
				this._ext.log(`User selected: ${this._selectedChannel.title}`);
				this._selectSource();
			}
		});
		channelSelector.onDidHide(() => {
			channelSelector.dispose();
		});
		channelSelector.show();
	}

	private _selectSource() {
		this._ext.log("Engine update step 10: Fetch and parse the distribution channel jobs");
		vscode.window.withProgress<void>({
			location: vscode.ProgressLocation.Notification,
			title: 'Engine update: Scanning remote jobs',
			cancellable: true
		}, (vscProgress, token) => {
			token.onCancellationRequested(() => {
				this._ext.log("Engine update cancelled - User cancelled scanning remote jobs");
			});

			return new Promise<void>((resolve, reject) => {
				const progress = new Progress(vscProgress, () => {
					this._selectJobSet();
				}, resolve);

				fetch(this._selectedChannel!.url + '/api/json/')
					.then(
						(response) => {
							progress.setBase(5);
							// this._ext.log('response: ' + JSON.stringify(response));
							response.json().then(
								(content) => {
									// this._ext.log('content: ' + JSON.stringify(content));
									this._ext.log(`Fetched from "${this._selectedChannel!.url}"`);

									if ('_class' in content && typeof content._class === 'string' && content._class === 'hudson.model.ListView' &&
										'jobs' in content && Array.isArray(content.jobs)) {

										const jobs = (content.jobs as Array<any>);
										let jobDone: number = 0;

										jobs.forEach((job) => {
											if ('name' in job && typeof job.name === 'string' &&
												'url' in job && typeof job.url === 'string') {

												const nameMatch: RegExpMatchArray | null = job.name.match(/^engine-\w+-(\w+(?:-\w+)?)-(\w+)$/);
												if (nameMatch) {
													if (EngineUpdateContext.jobNameMapper.has(nameMatch[1]!)) {
														const platformName: PlatformName = EngineUpdateContext.jobNameMapper.get(nameMatch[1]!)!;

														let binaryGroup: Binary | undefined = undefined;

														switch (nameMatch[2]!) {
															case 'tools':
																if (this._selectedDevPlatforms.has(platformName)) {
																	binaryGroup = Binary.LS;
																}
																break;

															case 'gui':
																if (this._selectedUIs.has(Binary.GUI) &&
																	(this._selectedDevPlatforms.has(platformName) || this._selectedRunPlatforms.has(platformName))) {
																	binaryGroup = Binary.GUI;
																}
																break;

															case 'cli':
																if (this._selectedUIs.has(Binary.CLI) &&
																	(this._selectedDevPlatforms.has(platformName) || this._selectedRunPlatforms.has(platformName))) {
																	binaryGroup = Binary.CLI;
																}
																break;
														}

														if (binaryGroup !== undefined) {
															const binaries: Map<PlatformName, string> = this._URLs.has(binaryGroup) ? this._URLs.get(binaryGroup)! : new Map<PlatformName, string>();
															binaries.set(platformName, job.url);
															this._URLs.set(binaryGroup, binaries);
															this._ext.log(`Job name "${job.name}" matches the selection`);
														} else {
															this._ext.log(`Job name "${job.name}" does not match any selected binary-platform combination`);
														}
													} else {
														this._ext.log(`Job name "${job.name}" does not match a known platform`);
													}
												} else {
													this._ext.log(`Job name "${job.name}" does not match the template`);
												}
											}
											jobDone++;
										});

										if (// found tools for all dev platforms
											(this._URLs.get(Binary.LS)!.size === this._selectedDevPlatforms.size) &&
											// and found GUIs for all rev and run platforms (or picked none if not needed)
											(this._selectedUIs.has(Binary.GUI) ?
												(this._URLs.has(Binary.GUI) && this._URLs.get(Binary.GUI)!.size === (this._selectedDevPlatforms.size + this._selectedRunPlatforms.size)) :
												!this._URLs.has(Binary.GUI)) &&
											// and found CLIs for all rev and run platforms (or picked none if not needed)
											(this._selectedUIs.has(Binary.CLI) ?
												(this._URLs.has(Binary.CLI) && this._URLs.get(Binary.CLI)!.size === (this._selectedDevPlatforms.size + this._selectedRunPlatforms.size)) :
												!this._URLs.has(Binary.CLI))) {

											progress.setBase(10);
											progress.setTotal(this._URLs.get(Binary.LS)!.size
												+ (this._URLs.has(Binary.GUI) ? this._URLs.get(Binary.GUI)!.size : 0)
												+ (this._URLs.has(Binary.CLI) ? this._URLs.get(Binary.CLI)!.size : 0));

											this._URLs.forEach((map, binary) => {
												map.forEach((URL, platformName) => {
													fetch(URL + '/api/json/?depth=2')
														.then(
															(response) => {
																// this._ext.log('response: ' + JSON.stringify(response));
																response.json().then(
																	(content) => {
																		// this._ext.log('content: ' + JSON.stringify(content));
																		this._ext.log(`Fetched from "${URL}"`);

																		if ('_class' in content && typeof content._class === 'string' && content._class === 'hudson.model.FreeStyleProject' &&
																			'builds' in content && Array.isArray(content.builds)) {

																			(content.builds as Array<any>).forEach((build) => {
																				if ('_class' in build && typeof build._class === 'string' && build._class === 'hudson.model.FreeStyleBuild' &&
																					'building' in build && typeof build.building === 'boolean' && build.building === false &&
																					'result' in build && typeof build.result === 'string' && build.result === 'SUCCESS' &&
																					'actions' in build && Array.isArray(build.actions) &&
																					'artifacts' in build && Array.isArray(build.artifacts) &&
																					'description' in build && typeof build.description === 'string' &&
																					'timestamp' in build && typeof build.timestamp === 'number') {

																					const description: string = build.description;

																					let artifactsUrl: string | undefined = undefined;
																					(build.actions as Array<any>).forEach((action) => {
																						if ('_class' in action && typeof action._class === 'string' && action._class === 'org.jenkinsci.plugins.displayurlapi.actions.RunDisplayAction' &&
																							'artifactsUrl' in action && typeof action.artifactsUrl === 'string') {
																							artifactsUrl = action.artifactsUrl;
																						}
																					});
																					if (artifactsUrl !== undefined) {
																						let relativePath: string | undefined = undefined;
																						(build.artifacts as Array<any>).forEach((artifact) => {
																							if ('fileName' in artifact && typeof artifact.fileName === 'string' && !artifact.fileName.match(/-for-app-/) &&
																								'relativePath' in artifact && typeof artifact.relativePath === 'string') {
																								relativePath = artifact.relativePath;
																							}
																						});
																						if (relativePath !== undefined) {
																							this._ext.log(`Found artifact "${artifactsUrl}/${relativePath}" compiled on ${new Date(build.timestamp as number).toString()}`);
																							const zipsL1: Map<Binary, Map<PlatformName, Artifact>> = this._zips.has(description) ? this._zips.get(description)! : new Map<Binary, Map<PlatformName, Artifact>>();
																							const zipsL2: Map<PlatformName, Artifact> = zipsL1.has(binary) ? zipsL1.get(binary)! : new Map<PlatformName, Artifact>();
																							zipsL2.set(platformName, new Artifact(`${artifactsUrl}/${relativePath}`, build.timestamp as number));
																							zipsL1.set(binary, zipsL2);
																							this._zips.set(description, zipsL1);

																						} else {
																							this._ext.log('Artifact relative path not found');
																						}
																					} else {
																						this._ext.log('Artifacts URL not found');
																					}
																				} else {
																					this._ext.log('Invalid build structure');
																				}
																			});
																		} else {
																			this._ext.log('Invalid content structure');
																		}

																		progress.partFinished();
																	},
																	(reason) => {
																		this._ext.reportFailureAndReject(reject, `Failed to parse fetched job info for the engine update: ${JSON.stringify(reason)}`);
																	});
															},
															(reason) => {
																this._ext.reportFailureAndReject(reject, `Failed to fetch job info for the engine update: ${JSON.stringify(reason)}`);
															});
												});
											});

										} else {
											this._ext.reportFailureAndReject(reject, 'Could not find all the required jobs for the engine update');
										}
									}
								},
								(reason) => {
									this._ext.reportFailureAndReject(reject, `Failed to parse fetched channel info for the engine update: ${JSON.stringify(reason)}`);
								});
						},
						(reason) => {
							this._ext.reportFailureAndReject(reject, `Failed to fetch channel info for the engine update: ${JSON.stringify(reason)}`);
						});
			});
		});
	}

	private _selectJobSet() {
		this._ext.log("Engine update step 11: Ask user to select the jobset");
		const fullSets = new Map<number, Set<string>>();
		this._zips.forEach((zipsL1, description) => {
			this._ext.log(`Job description: ${description}`);

			let earliestTimestamp: number = 0;
			zipsL1.forEach((zipsL2, binary) => {
				this._ext.log(`Binary: ${binary}`);
				zipsL2.forEach((artifact, platformName) => {
					this._ext.log(`PlatformName: ${platformName}`);
					this._ext.log(`URL: ${artifact.URL}`);
					this._ext.log(`Date: ${new Date(artifact.timestamp).toLocaleString()}`);
					earliestTimestamp = Math.min(earliestTimestamp, -artifact.timestamp);
				});
			});

			if (zipsL1.has(Binary.LS) && (zipsL1.get(Binary.LS)!.size === this._selectedDevPlatforms.size) &&
				(this._selectedUIs.has(Binary.GUI) ?
					(zipsL1.has(Binary.GUI) && zipsL1.get(Binary.GUI)!.size === (this._selectedDevPlatforms.size + this._selectedRunPlatforms.size)) :
					!zipsL1.has(Binary.GUI)) &&
				(this._selectedUIs.has(Binary.CLI) ?
					(zipsL1.has(Binary.CLI) && zipsL1.get(Binary.CLI)!.size === (this._selectedDevPlatforms.size + this._selectedRunPlatforms.size)) :
					!zipsL1.has(Binary.CLI))) {
				this._ext.log(description + ' is a full set');

				const fullSet: Set<string> = fullSets.has(earliestTimestamp) ? fullSets.get(earliestTimestamp)! : new Set<string>();
				fullSet.add(description);
				fullSets.set(earliestTimestamp, fullSet);
			} else {
				this._ext.log(description + ' is NOT a full set');
			}
		});

		const items: EngineUpdateJobsetItem[] = [];

		fullSets.forEach((set, timestamp) => {
			set.forEach((description) => {
				items.push(new EngineUpdateJobsetItem(description, -timestamp));
			});
		});

		if (items.length === 0) {
			vscode.window.showErrorMessage('Could not find a full set of required artifacts');
		} else {
			const buildSelector: vscode.QuickPick<EngineUpdateJobsetItem> = vscode.window.createQuickPick<EngineUpdateJobsetItem>();
			buildSelector.title = 'Installing Umajin Engine';
			buildSelector.step = 6;
			buildSelector.totalSteps = 6;
			buildSelector.prompt = 'Select build';
			buildSelector.placeholder = 'filter';
			buildSelector.matchOnDescription = true;
			buildSelector.matchOnDetail = true;
			buildSelector.items = items;
			buildSelector.onDidAccept(() => {
				this._selectedJobset = buildSelector.selectedItems[0];
				buildSelector.dispose();
				if (this._selectedJobset !== undefined) {
					this._ext.log(`User selected: ${this._selectedJobset.label}`);
					this._download();
				}
			});
			buildSelector.onDidHide(() => {
				buildSelector.dispose();
			});
			buildSelector.show();
		}
	}

	private _download() {
		this._ext.log("Engine update step 12: Download the job artifacts");
		vscode.window.withProgress<void>({
			location: vscode.ProgressLocation.Notification,
			title: 'Engine update (1/4): Downloading artifacts',
			cancellable: true
		}, (vscProgress, token) => {
			token.onCancellationRequested(() => {
				this._ext.log("Engine update cancelled - User cancelled downloading artifacts");
			});

			return new Promise<void>((resolve, reject) => {
				const progress = new Progress(vscProgress, () => {
					this._deleteOld();
				}, resolve);

				const selectedDescription: string = this._selectedJobset!.jobDescription;

				progress.setTotal(((): number => {
					let remains: number = 0;
					this._zips.get(selectedDescription)!.forEach((zipsL1) => {
						remains += zipsL1.size;
					});
					return remains;
				})());

				const cacheFolder: string = this._cacheFolder();

				const createAndProceed = () => {
					fs.mkdir(cacheFolder, { recursive: true }, (errno) => {
						if (errno !== null) {
							this._ext.logError(`Cannot create directory "${cacheFolder}": ${errno}`);
						} else {
							this._zips.get(selectedDescription)!.forEach((zipsL1, binary) => {
								zipsL1.forEach((artifact, platformName) => {
									const filename: string = `${cacheFolder}${path.sep}${binary}-${platformName}.zip`;

									http.get(artifact.URL, (response) => {
										response.pipe(fs.createWriteStream(filename, { flush: true }))
											.on('error', (reason) => {
												fs.unlink(filename, (errno) => {
													if (errno !== null) {
														this._ext.logError(`Cannot remove file "${filename}": ${errno}`);
													}
												});
												this._ext.reportFailureAndReject(reject, `Failed to save downloaded artifact "${artifact.URL}": ${reason}`);
											})
											.on('finish', () => {
												this._ext.log(`Artifact "${filename}" downloaded successfully`);

												progress.partFinished();
											});
									}).on('error', (reason) => {
										fs.unlink(filename, (errno) => {
											if (errno !== null) {
												this._ext.logError(`Cannot remove file "${filename}": ${errno}`);
											}
										});
										this._ext.reportFailureAndReject(reject, `Failed to download artifact "${artifact.URL}": ${reason}`);
									});

								});
							});
						}
					});
				};

				fs.stat(cacheFolder, (errno) => {
					if (errno !== null) {
						createAndProceed();
					} else {
						fs.rm(cacheFolder, { recursive: true, force: true }, (errno) => {
							if (errno !== null) {
								this._ext.reportFailureAndReject(reject, `Failed to cleanup the cache folder: ${errno}`);
							} else {
								createAndProceed();
							}
						});
					}
				});
			});
		});
	}

	private _deleteOld() {
		this._ext.log("Engine update step 13: Delete the old installation");
		this._ext.stopLanguageClientImpl().finally(() => {
			vscode.window.withProgress<void>({
				location: vscode.ProgressLocation.Notification,
				title: 'Engine update (2/4): Deleting previous installation',
				cancellable: true
			}, (vscProgress, token) => {
				token.onCancellationRequested(() => {
					this._ext.log("Engine update cancelled - User cancelled deleting files");
				});

				return new Promise<void>((resolve, reject) => {
					const progress = new Progress(vscProgress, () => {
						this._checkInfrastructure();
					}, resolve);

					progress.setTotal(((): number => {
						let remains: number = this._presentAssociatedFiles.size + 1 /* if there are none, proceed to the next step*/;
						this._presentBinaries.forEach((map) => {
							remains += map.size;
						});
						return remains;
					})());

					const deleteOld = (filename: string, attempts: number = 5, delay: number = 500) => {
						this._ext.log(`Deleting "${filename}"...`);

						fs.rm(filename, { recursive: true, force: true }, (errno) => {
							if (errno !== null) {
								if (attempts !== 0) {
									this._ext.logError(`Failed to delete "${filename}" with $(attempts - 1) attempts remaining: ${errno}, trying again in ${delay}ms...`);
									setTimeout(() => {
										deleteOld(filename, attempts - 1, delay);
									}, delay);
								} else {
									this._ext.reportFailureAndReject(reject, `Failed to delete "${filename}": ${errno}`);
								}
							} else {
								this._ext.log(`File "${filename}" is deleted`);
								progress.partFinished();
							}
						});
					};

					this._presentAssociatedFiles.forEach((filename) => {
						deleteOld(filename);
					});
					this._presentBinaries.forEach((map) => {
						map.forEach((filename) => {
							deleteOld(filename);
						});
					});
					progress.partFinished();
				});
			});
		});
	}

	private _checkInfrastructure() {
		this._ext.log("Engine update step 14: Check and fix the generated infrastructure");
		vscode.window.withProgress<void>({
			location: vscode.ProgressLocation.Notification,
			title: 'Engine update (3/4): Checking infrastructure...',
			cancellable: true
		}, (vscProgress, token) => {
			token.onCancellationRequested(() => {
				this._ext.log("Engine update cancelled - User cancelled checking the infrastructure");
			});
			return new Promise<void>((resolve, reject) => {
				const progress = new Progress(vscProgress, () => {
					this._installNew();
				}, resolve);

				if (this._needPlatformRedirector) {
					if (this._selectedDevPlatforms.has(PlatformNameValue.MacArm64) ||
						this._selectedDevPlatforms.has(PlatformNameValue.LinuxX64) ||
						this._selectedDevPlatforms.has(PlatformNameValue.LinuxArm64)) {
						this._needRedirection.add(Binary.LS);
					}

					if (this._withSimCross && (
						this._selectedDevPlatforms.has(PlatformNameValue.MacArm64) ||
						this._selectedDevPlatforms.has(PlatformNameValue.LinuxX64) ||
						this._selectedDevPlatforms.has(PlatformNameValue.LinuxArm64))) {
						this._needRedirection.add(Binary.Compiler);
					}

					if (this._selectedUIs.has(Binary.GUI) && (
						this._selectedDevPlatforms.has(PlatformNameValue.LinuxX64) ||
						this._selectedDevPlatforms.has(PlatformNameValue.LinuxArm64) ||
						this._selectedRunPlatforms.has(PlatformNameValue.LinuxX64) ||
						this._selectedRunPlatforms.has(PlatformNameValue.LinuxArm64))) {
						this._needRedirection.add(Binary.GUI);
					}

					if (this._selectedUIs.has(Binary.CLI) && (
						this._selectedDevPlatforms.has(PlatformNameValue.MacArm64) ||
						this._selectedDevPlatforms.has(PlatformNameValue.LinuxX64) ||
						this._selectedDevPlatforms.has(PlatformNameValue.LinuxArm64) ||
						this._selectedRunPlatforms.has(PlatformNameValue.MacArm64) ||
						this._selectedRunPlatforms.has(PlatformNameValue.LinuxX64) ||
						this._selectedRunPlatforms.has(PlatformNameValue.LinuxArm64))) {
						this._needRedirection.add(Binary.CLI);
					}
				}

				progress.setTotal(
					// test / create symlinks
					EngineUpdateContext.allBinaries.size
					// for each unix dev platform create platform / stdlib.u symlink
					+ (this._needPlatformRedirector
						? (this._selectedDevPlatforms.size
							- (this._selectedDevPlatforms.has(PlatformNameValue.WindowsX64) ? 1 : 0))
						: 0)
					// check / fix / delete the platform-redirector
					+ 1
					// check / delete empty redirected folders
					+ EngineUpdateContext.platforms.size - 1 /* windows */
				);

				const makeSymlink = (filename: string, target: string, attempts: number, delay: number) => {
					if (attempts === 0) {
						this._ext.reportFailureAndReject(reject, `Failed to create symlink "${filename}"`);
					} else {
						this._ext.log(`Creating symlink "${filename}" pointing at "${target}"...`);
						fs.symlink(target, filename, (errno) => {
							if (errno !== null) {
								this._ext.logError(`Failed to create symlink "${filename}" with ${(attempts - 1)} attempts remaining: ${errno}, trying again in ${delay}ms...`);
								setTimeout(() => {
									makeSymlink(filename, target, attempts - 1, delay);
								}, delay);
							} else {
								this._ext.log(`Symlink "${filename}" created`);
								progress.partFinished();
							}
						});
					}
				};

				const makeFoldersAndSymlink = (filename: string, target: string, attempts: number, delay: number) => {
					this._ext.log(`Creating folders for symlink "${filename}"...`);
					fs.mkdir(path.dirname(filename), { recursive: true }, (errno) => {
						if (errno !== null) {
							this._ext.reportFailureAndReject(reject, `Failed to create directory "${path.dirname(filename)}": ${errno}`);
						} else {
							this._ext.log(`Folders created for symlink "${filename}"`);
							makeSymlink(filename, target, attempts, delay);
						}
					});
				};

				const deleteAndMakeSymlink = (filename: string, target: string, attempts: number, delay: number) => {
					this._ext.log(`Deleting symlink "${filename}"...`);
					fs.rm(filename, { recursive: true, force: true }, (errno) => {
						if (errno !== null) {
							this._ext.reportFailureAndReject(reject, `Failed to delete symlink "${filename}": ${errno}`);
						} else {
							this._ext.log(`Symlink "${filename}" is deleted`);
							makeFoldersAndSymlink(filename, target, attempts, delay);
						}
					});
				};

				const ensureSymlink = (filename: string, target: string, attempts: number = 5, delay: number = 500) => {
					this._ext.log(`Checking symlink "${filename}"...`);
					fs.lstat(filename, (errno, stats) => {
						if (errno === null) {
							if (stats.isSymbolicLink()) {
								this._ext.log(`File "${filename}" is a symlink`);
								this._ext.log(`Reading symlink "${filename}"...`);
								fs.readlink(filename, (errno, linkString: string) => {
									if (errno !== null) {
										this._ext.reportFailureAndReject(reject, `Cannot read symlink "${filename}": ${errno}`);
									} else {
										if (linkString === target) {
											this._ext.log(`Symlink "${filename}" is correct`);
											progress.partFinished();
										} else {
											this._ext.log(`Symlink "${filename}" read. It points at "${linkString}"`);
											deleteAndMakeSymlink(filename, target, attempts, delay);
										}
									}
								});
								return;
							} else {
								this._ext.log(`File "${filename}" is not a symlink`);
								deleteAndMakeSymlink(filename, target, attempts, delay);
							}
						} else {
							this._ext.log(`Failed to check symlink "${filename}": ${errno}`);
							makeFoldersAndSymlink(filename, target, attempts, delay);
						}
					});
				};

				// test / create symlinks
				EngineUpdateContext.allBinaries.forEach((binary) => {
					const filename: string = this._ext.getWsPath() + path.sep + binary;
					if (this._needRedirection.has(binary)) {
						ensureSymlink(filename, platformRedirectorName);
					} else {
						this._ext.log(`Deleting symlink "${filename}"...`);
						fs.rm(filename, { recursive: true, force: true }, (errno) => {
							if (errno !== null) {
								this._ext.reportFailure(`Failed to delete "${filename}": ${errno}`);
							}
							this._ext.log(`Symlink "${filename}" is deleted`);
							progress.partFinished();
						});
					}
				});

				if (this._needPlatformRedirector) {
					// for each unix dev platform create platform / stdlib.u symlink
					this._selectedDevPlatforms.forEach((platformName) => {
						if (platformName !== PlatformNameValue.WindowsX64) {
							ensureSymlink(EngineUpdateContext.platforms.get(platformName)!.redirectedPath(this._ext.getWsPath() + path.sep + 'stdlib.u'), '../../stdlib.u');
						}
					});

					// check / fix the content of platform-redirector
					{
						const checkAccess = (filename: string) => {
							this._ext.log(`Checking executable access on "${filename}"...`);
							fs.access(filename, fs.constants.X_OK, (errno) => {
								if (errno !== null) {
									this._ext.log(`Failed to confirm that "${filename}" has an executable access: ${errno}`);
									this._ext.log(`Setting access on "${filename}"...`);
									fs.chmod(filename, 0o775 /* rwxrwxr-x */, (errno) => {
										if (errno !== null) {
											this._ext.reportFailureAndReject(reject, `Cannot change "platform-redirector" file access mode: ${errno}`);
										} else {
											this._ext.log(`Executable access is set for file "${filename}"`);
											progress.partFinished();
										}
									});
								} else {
									this._ext.log(`File "${filename}" has an executable access`);
									progress.partFinished();
								}
							});
						};

						const createFile = (filename: string) => {
							this._ext.log(`Writing file "${filename}"...`);
							fs.writeFile(filename, platformRedirectorContent, (errno) => {
								if (errno === null) {
									this._ext.log(`File "${filename}" is written`);
									checkAccess(filename);
								} else {
									this._ext.reportFailureAndReject(reject, `Cannot create "platform-redirector" file: ${errno}`);
								}
							});
						};

						const recreateFile = (filename: string) => {
							this._ext.log(`Deleting file "${filename}"...`);
							fs.rm(filename, { recursive: true, force: true }, (errno) => {
								if (errno === null) {
									createFile(filename);
								} else {
									this._ext.log(`File "${filename}" is deleted`);
									this._ext.reportFailureAndReject(reject, `Cannot recreate "platform-redirector" file: ${errno}`);
								}
							});
						};

						const filename: string = this._ext.getWsPath() + path.sep + platformRedirectorName;
						this._ext.log(`Checking file "${filename}"...`);
						fs.stat(filename, (errno, stats) => {
							if (errno === null) {
								if (stats.isFile()) {
									this._ext.log(`Reading file "${filename}"...`);
									fs.readFile(filename, 'utf-8', (errno, data) => {
										if (errno !== null) {
											this._ext.logError(`Cannot read platform-redirector file: ${errno}`);
										} else {
											this._ext.log(`File "${filename}" is read`);
											if (data === platformRedirectorContent) {
												checkAccess(filename);
											} else {
												recreateFile(filename);
											}
										}
									});
								} else {
									this._ext.log(`File "${filename}" is not a file`);
									recreateFile(filename);
								}
							} else {
								this._ext.log(`Failed to check file "${filename}": ${errno}`);
								createFile(filename);
							}
						});
					}
				} else {
					// delete the platform-redirector
					const filename: string = this._ext.getWsPath() + path.sep + platformRedirectorName;
					this._ext.log(`Deleting file "${filename}"...`);
					fs.rm(filename, { recursive: true, force: true }, (errno) => {
						if (errno !== null) {
							this._ext.reportFailure(`Failed to delete "${filename}": ${errno}`);
						} else {
							this._ext.log(`File "${filename}" is deleted`);
						}
						progress.partFinished();
					});
				}

				// delete folders if empty
				EngineUpdateContext.platforms.forEach((platformValue, platformName) => {
					if (platformName !== PlatformNameValue.WindowsX64) {
						if (!this._needPlatformRedirector
							|| (!this._selectedDevPlatforms.has(platformName)
								&& !this._selectedRunPlatforms.has(platformName)
							)) {
							const subfoldername: string = this._ext.getWsPath() + path.sep + platformValue.redirectionFolder;
							this._ext.log(`Checking if folder "${subfoldername}" is empty...`);
							fs.readdir(subfoldername, (errno, files) => {
								if (errno !== null) {
									if (errno.code !== 'ENOENT' /* was not here at all */) {
										this._ext.reportFailure(`Cannot read folder "${subfoldername}": ${errno}`);
									}
									progress.partFinished();
								} else {
									if (files.length !== 0) {
										this._ext.log(`Folder "${subfoldername}" is not empty`);
										progress.partFinished();
									} else {
										this._ext.log(`Deleting folder "${subfoldername}"...`);
										fs.rmdir(subfoldername, (errno) => {
											if (errno !== null) {
												this._ext.reportFailure(`Cannot remove empty folder "${subfoldername}": ${errno}`);
												progress.partFinished();
											} else {
												this._ext.log(`Folder "${subfoldername}" is deleted`);
												if (!this._needPlatformRedirector // only sinlge *nix platform is selected
													|| ( // no subplatforms:
														platformValue.isMac
														// multiple subplatforms:
														|| (platformValue.isLinux
															// but none is selected:
															&& !this._selectedDevPlatforms.has(PlatformNameValue.LinuxX64)
															&& !this._selectedRunPlatforms.has(PlatformNameValue.LinuxX64)
															&& !this._selectedDevPlatforms.has(PlatformNameValue.LinuxArm64)
															&& !this._selectedRunPlatforms.has(PlatformNameValue.LinuxArm64)))) {
													const foldername: string = path.dirname(subfoldername);
													this._ext.log(`Checking if folder "${foldername}" is empty...`);
													fs.readdir(foldername, (errno, files) => {
														if (errno !== null) {
															this._ext.reportFailure(`Cannot read folder "${foldername}": ${errno}`);
															progress.partFinished();
														} else {
															if (files.length !== 0) {
																this._ext.log(`Folder "${foldername}" is not empty`);
																progress.partFinished();
															} else {
																this._ext.log(`Deleting folder "${foldername}"...`);
																fs.rmdir(foldername, (errno) => {
																	if (errno !== null && errno.code !== 'ENOENT' /* may be already deleted */) {
																		this._ext.reportFailure(`Cannot remove empty folder "${foldername}": ${errno}`);
																	} else {
																		this._ext.log(`Folder "${foldername}" is deleted`);
																	}
																	progress.partFinished();
																});
															}
														}
													});
												} else {
													progress.partFinished();
												}
											}
										});
									}
								}
							});
						} else {
							progress.partFinished();
						}
					}
				});
			});
		});
	}

	private _installNew() {
		this._ext.log("Engine update step 15: Unpack the artifacts");
		vscode.window.withProgress<void>({
			location: vscode.ProgressLocation.Notification,
			title: 'Engine update (4/4): Unpacking artifacts...',
			cancellable: true
		}, (vscProgress, token) => {
			token.onCancellationRequested(() => {
				this._ext.log("Engine update cancelled - User cancelled unpacking artifacts");
			});

			vscProgress.report({ increment: 0 });

			return new Promise<void>((resolve, reject) => {
				const progress = new Progress(vscProgress, () => {
					this._cleanUp();
				}, resolve);

				const selectedDescription: string = this._selectedJobset!.jobDescription;

				progress.setTotal(((): number => {
					let remains: number = this._withSimCross ? this._zips.get(selectedDescription)!.get(Binary.LS)!.size : 0;
					this._zips.get(selectedDescription)!.forEach((zipsL1) => {
						remains += zipsL1.size;
					});
					return remains;
				})());

				const cacheFolder: string = this._cacheFolder();

				const zips: Map<Binary, Map<PlatformName, Artifact>> = this._zips.get(selectedDescription)!;

				zips.forEach((zipsL1, binary) => {
					switch (binary) {
						case Binary.LS:
							zipsL1.forEach((_artifact, platformName) => {
								const zipname: string = `${binary}-${platformName}.zip`;
								const filename: string = cacheFolder + path.sep + zipname;

								unzipper.Open.file(filename).then(
									(centralDirectory) => {
										centralDirectory.files.forEach((file) => {
											if (file.type === 'File') {
												let binary: Binary | undefined = undefined;
												if (/umajinls/.test(file.path)) {
													binary = Binary.LS;
												} else if (/umajinc/.test(file.path) && this._withSimCross) {
													binary = Binary.Compiler;
												}
												if (binary !== undefined) {
													const platformValue: Platform = EngineUpdateContext.platforms.get(platformName)!;
													let targetFilepath: string = path.dirname(this._ext.getBundlePath(platformValue, binary)) + path.sep + file.path;
													if (this._needRedirection.has(binary)) {
														targetFilepath = platformValue.redirectedPath(targetFilepath);
													}

													file.stream()
														.pipe(fs.createWriteStream(targetFilepath,
															{
																mode: ((file.externalFileAttributes & 0x1ff0000) !== 0) ? ((file.externalFileAttributes & 0x1ff0000) >> 16) : undefined,
																flush: true
															}))
														.on('error', (reason) => {
															this._ext.reportFailureAndReject(reject, `Failed to extract file "${file.path}" from "${zipname}": ${reason}`);
														})
														.on('finish', () => {
															this._ext.log(`Artifact for ${binary} on ${platformName} unpacked`);
															progress.partFinished();
														});
												}
											}
										});
									},
									(reason) => {
										this._ext.reportFailureAndReject(reject, `Failed to open "${zipname}": ${reason}`);
									});
							});
							break;

						case Binary.GUI:
						case Binary.CLI:
							zipsL1.forEach((_artifact, platformName) => {
								const zipname: string = `${binary}-${platformName}.zip`;
								const filename: string = cacheFolder + path.sep + zipname;

								unzipper.Open.file(filename).then((centralDirectory) => {
									let zipRemain: number = centralDirectory.files.length;
									const onUnzipped = () => {
										zipRemain--;
										if (zipRemain === 0) {
											this._ext.log(`Artifact for ${binary} on ${platformName} unpacked`);
											progress.partFinished();
										}
									};
									centralDirectory.files.forEach((file) => {
										const platformValue: Platform = EngineUpdateContext.platforms.get(platformName)!;
										let targetFilepath: string = path.dirname(this._ext.getBundlePath(platformValue, binary)) + path.sep + file.path;
										const unzip = () => {
											switch (file.type) {
												case 'File':
													let fileKind: FileInZipKind = FileInZipKind.Unsupported;

													if ((file.externalFileAttributes & 0xffff0000) === 0) {
														// Windows file attributes: treat all as files
														fileKind = FileInZipKind.Regular;
													} else {
														switch ((file.externalFileAttributes >> 16) & 0xf000) {
															case 0xa000: // symlink
																fileKind = FileInZipKind.Symlink;
																break;

															case 0x8000: // file
																if ((platformName === PlatformNameValue.MacArm64) && path.basename(file.path).startsWith('._')) {
																	// it may be a weird apple meta file
																	fileKind = FileInZipKind.Ignore;
																}
																else {
																	fileKind = FileInZipKind.Regular;
																}
																break;
														}
													}
													switch (fileKind) {
														case FileInZipKind.Regular:
															fs.mkdir(path.dirname(targetFilepath), {
																recursive: true,
																mode: ((file.externalFileAttributes & 0x1ff0000) !== 0) ? (((file.externalFileAttributes & 0x1ff0000) >> 16) | 0o111/*--x--x--x*/) : undefined
															}, (errno) => {
																if (errno === null) {
																	file.stream()
																		.pipe(fs.createWriteStream(targetFilepath,
																			{
																				mode: ((file.externalFileAttributes & 0x1ff0000) !== 0) ? ((file.externalFileAttributes & 0x1ff0000) >> 16) : undefined,
																				flush: true
																			}))
																		.on('error', (reason) => {
																			this._ext.reportFailureAndReject(reject, `Failed to extract file "${file.path}" from "${zipname}": ${reason}`);
																		})
																		.on('finish', () => {
																			onUnzipped();
																		});
																} else {
																	this._ext.reportFailureAndReject(reject, `Failed to create directory for file "${file.path}" while unpacking "${zipname}": ${errno}`);
																}
															});
															break;

														case FileInZipKind.Symlink:
															fs.mkdir(path.dirname(targetFilepath), {
																recursive: true,
																mode: ((file.externalFileAttributes & 0x1ff0000) !== 0) ? (((file.externalFileAttributes & 0x1ff0000) >> 16) | 0o111/*--x--x--x*/) : undefined
															}, (errno) => {
																if (errno === null) {
																	file.buffer().then((value) => {
																		fs.symlink(value.toString(), targetFilepath, (errno) => {
																			if (errno === null) {
																				onUnzipped();
																			} else {
																				this._ext.reportFailureAndReject(reject, `Failed to create symlink "${file.path}" while unpacking "${zipname}": ${errno}`);
																			}
																		});
																	});
																} else {
																	this._ext.reportFailureAndReject(reject, `Failed to create directory for symlink "${file.path}" while unpacking "${zipname}": ${errno}`);
																}
															});
															break;

														case FileInZipKind.Ignore:
															onUnzipped();
															break;

														default:
															this._ext.reportFailureAndReject(reject, `Failed to extract unsupported item "${file.path}" from "${zipname}"`);
													}

													break;

												case 'Directory':
													fs.mkdir(targetFilepath, {
														recursive: true,
														mode: ((file.externalFileAttributes & 0x1ff0000) !== 0) ? (file.externalFileAttributes & 0x1ff0000) >> 16 : undefined
													}, (errno) => {
														if (errno === null) {
															onUnzipped();
														} else {
															this._ext.reportFailureAndReject(reject, `Failed to create directory "${file.path}" while unpacking "${zipname}": ${errno}`);
														}
													});
													break;
											}
										};

										if (!((platformName === PlatformNameValue.MacArm64) && (binary === Binary.GUI))) {
											if (this._needRedirection.has(binary)) {
												targetFilepath = platformValue.redirectedPath(targetFilepath);
											}
										}

										unzip();
									});
								},
									(reason) => {
										this._ext.reportFailureAndReject(reject, `Failed to open "${zipname}": ${reason}`);
									});
							});
							break;
					}
				});
			});
		});
	}

	private _cleanUp() {
		this._ext.log("Engine update step 16: Clean up the cache");
		fs.rm(this._cacheFolder(), { recursive: true, force: true }, (errno) => {
			if (errno !== null) {
				this._ext.logError(`Failed to delete engine update cache folder: ${errno}`);
			}

			this._ext.log('Cache cleaned up');
			this._generateStdlib();
		});
	}

	private _generateStdlib() {
		this._ext.log("Engine update step 17: Generate stdlib.u");
		if (this._selectedDevPlatforms.has(nativePlatform.nameForCompiler) || this._selectedRunPlatforms.has(nativePlatform.nameForCompiler)) {
			this._ext.generateStdLibTry(this._selectedUIs.has(Binary.GUI), this._selectedUIs.has(Binary.CLI), (success) => {
				this._ext.log(`stdlib.u is ${(success ? '' : 'NOT ')}generated`);
				this._reportUpdateComplete();
			});
		} else {
			vscode.window.showWarningMessage('Cannot generate Umajin Standard Library: no Umajin support is installed for this platform.');
			this._reportUpdateComplete();
		}
	}

	private _reportUpdateComplete() {
		this._ext.log("Engine update step 18: Report the completion to user");
		if (this._selectedDevPlatforms.has(nativePlatform.nameForCompiler)) {
			this._ext.startLanguageClientImpl();
		} else {
			vscode.window.showWarningMessage('Cannot start Umajin Language Client: no Umajin development support is installed for this platform.');
		}

		let engineVersion: string = this._selectedJobset!.label;
		if (this._selectedJobset!.detail !== '') {
			engineVersion += ` (${this._selectedJobset!.detail})`;
		}

		const message: string = `Umajin Engine is updated to ${engineVersion}`;
		this._ext.log(message);
		vscode.window.showInformationMessage(message);
	}
};

class UmajinExtension {
	private _context: vscode.ExtensionContext;
	private _log: vscode.OutputChannel;

	private _languageClient?: languageClient.LanguageClient | null = null;
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
	private _umajinCliFullPath: string = packageJson.contributes.configuration.properties['umajin.path.cliEngine'].default;
	private _umajinGuiFullPath: string = packageJson.contributes.configuration.properties['umajin.path.jitEngine'].default;
	private _umajinlsFullPath: string = packageJson.contributes.configuration.properties['umajin.path.languageServer'].default;
	private _root: string = packageJson.contributes.configuration.properties['umajin.root'].default;
	private _ui: string = packageJson.contributes.configuration.properties['umajin.ui'].default;
	private _simulateCompiler: string = packageJson.contributes.configuration.properties['umajin.simulate.compiler'].default;
	private _simulatePlatform: string = packageJson.contributes.configuration.properties['umajin.simulate.platform'].default;
	private _channels: Channels = packageJson.contributes.configuration.properties['umajin.update.channels'].default;

	public constructor(context: vscode.ExtensionContext) {
		this._context = context;

		this._log = vscode.window.createOutputChannel("Umajin");

		this._context.subscriptions.push(
			this._log,
			vscode.commands.registerCommand('umajin.generateStdLib', this.generateStdLib, this),
			vscode.commands.registerCommand('umajin.generateWorkspace', this.generateWorkspace, this),
			vscode.commands.registerCommand('umajin.applyAllCodeActions', this.applyAllCodeActions, this),
			vscode.commands.registerCommand('umajin.autoformatAll', this.autoformatAll, this),
			vscode.commands.registerCommand('umajin.stopLanguageClient', this.stopLanguageClient, this),
			vscode.commands.registerCommand('umajin.startLanguageClient', this.startLanguageClient, this),
			vscode.commands.registerCommand('umajin.restartLanguageClient', this.restartLanguageClient, this),
			vscode.commands.registerCommand('umajin.statusLanguageClient', this.statusLanguageClient, this),
			vscode.commands.registerCommand('umajin.openEngineHelp', this.openEngineHelp, this),
			vscode.commands.registerCommand('umajin.updateEngine', this.updateEngine, this)
		);

		if (vscode.workspace.workspaceFolders !== undefined) {
			this._readConfig();

			this._restartLanguageClientImpl().finally(() => {
				this._context.subscriptions.push(
					vscode.commands.registerCommand('umajin.run', (resource: vscode.Uri) => {
						let targetResource: vscode.Uri = resource;
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
			});
		}
	}

	public async destruct() {
		await this.stopLanguageClientImpl();
	}


	public log(message: string) {
		console.log(message);
		this._log.appendLine(`[INFO] ${message}`);
	}

	public logError(message: string) {
		console.error(message);
		this._log.appendLine(`[ERROR] ${message}`);
	}

	public reportFailure(message: string) {
		this.logError(message);
		vscode.window.showErrorMessage(message);
	};

	public reportFailureAndReject(reject: (reason?: any) => void, message: string) {
		this.reportFailure(message);
		reject(message);
	};


	public getWsPath(): string {
		return this._wsPath;
	}

	public getCollapseLongMessages(): boolean {
		return this._collapseLongMessages;
	}

	public getUmajincFullPath(): string {
		return this._umajincFullPath;
	}

	public getUmajinCliFullPath(): string {
		return this._umajinCliFullPath;
	}

	public getUmajinGuiFullPath(): string {
		return this._umajinGuiFullPath;
	}

	public getRoot(): string {
		return this._root;
	}

	public getUI(): string {
		return this._ui;
	}

	public getSimulateCompiler(): string {
		return this._simulateCompiler;
	}

	public getSimulatePlatform(): string {
		return this._simulatePlatform;
	}

	public getChannels(): Channels {
		return this._channels;
	}


	public updateConfiguration(event: vscode.ConfigurationChangeEvent) {
		this._readConfig();

		if (event.affectsConfiguration('umajin.path.languageServer') ||
			event.affectsConfiguration(`umajin.path${nativePlatform.configGenericSuffix}.languageServer`) ||
			event.affectsConfiguration(`umajin.path${nativePlatform.configSpecificSuffix}.languageServer`) ||
			event.affectsConfiguration('umajin.advanced.languageServer')) {
			this._restartLanguageClientImpl();
		}
	}

	public generateStdLib() {
		if (vscode.workspace.workspaceFolders === undefined) {
			vscode.window.showErrorMessage('Generating Umajin Standard Library requires Umajin workspace to be open.');
			return;
		}

		this.generateStdLibTry(true, true, (success) => {
			if (success) {
				vscode.window.showInformationMessage('Umajin Standard Library generated.');
			} else {
				vscode.window.showWarningMessage('Failed to generate Umajin Standard Library.');
			}
		});
	}

	public generateStdLibTry(tryGUI: boolean, tryCLI: boolean, callback: (success: boolean) => void) {
		if (tryGUI) {
			this._generateStdLibTryUI(this._umajinGuiFullPath, (success) => {
				if (success) {
					callback(true);
				} else {
					this.generateStdLibTry(false, tryCLI, callback);
				}
			});
		} else if (tryCLI) {
			this._generateStdLibTryUI(this._umajinCliFullPath, callback);
		}
	}

	private _generateStdLibTryUI(umajinJitFullPath: string, callback: (success: boolean) => void, attempts: number = 5, delay: number = 1000) {
		if (attempts === 0) {
			this.log(`Will not generate stdlib.u using "${umajinJitFullPath}", no attempts remaining`);
			callback(false);
		} else {
			this.log(`Generating stdlib.u using "${umajinJitFullPath}", attempts remaining: ${attempts}, checking the access...`);
			fs.access(umajinJitFullPath, fs.constants.R_OK | fs.constants.X_OK, (errno) => {
				if (errno !== null) {
					this.logError(`Cannot check "read+execute" access of "${umajinJitFullPath}": ${errno}`);
					callback(false);
				} else {
					let exited: boolean = false;
					this.log('Read and execute access confirmed, spawning the child process...');
					try {
						const child = childProcess.spawn(umajinJitFullPath, ['--print-stdlib'], {
							cwd: this._wsPath,
							stdio: ['ignore', 'pipe', 'pipe']
						},)
							.on('exit', () => {
								this.log('Child process exited, waiting for streams to be closed...');
								exited = true;
							})
							.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
								this.log('Child process closed streams, checking the exit code...');
								if (exited) {
									if (signal === null && code !== null) {
										switch (code) {
											case 0:
											case 2: // old expected status code of --print-stdlib
												this.log('Exit code is good, stdlib.u generated');
												callback(true);
												return;

											case 126: // text file busy
												this.log(`Child process reports "text file busy", trying again in ${delay}ms...`);
												setTimeout(() => {
													this._generateStdLibTryUI(umajinJitFullPath, callback, attempts - 1, delay);
												}, delay);
												return;
										}
									}

									let info: string = '';
									if (code !== null) {
										info += ` exit code: ${code}`;
									}
									if (signal !== null) {
										info += ` signal: ${signal}`;
									}
									const stdout: Buffer | null = child.stdout.read();
									if (stdout !== null) {
										info += ` stdout: "${stdout.toString()}"`;
									}
									const stderr: Buffer | null = child.stderr.read();
									if (stderr !== null) {
										info += ` stderr: "${stderr.toString()}"`;
									}
									this.logError(`Cannot generate Umajin Standard Library using "${umajinJitFullPath}":${info}`);
									callback(false);
								}
							})
							.on('error', (err: Error) => {
								this.reportFailure(`Cannot generate Umajin Standard Library using "${umajinJitFullPath}": ${err}`);
								callback(false);
							});
						this.log('Child process spawned.');
					} catch (reason: any) {
						if (reason.code === 'EBUSY') {
							this.log(`Child process fails to spawn throwing "EBUSY" exception, trying again in ${delay}ms...`);
							setTimeout(() => {
								this._generateStdLibTryUI(umajinJitFullPath, callback, attempts - 1, delay);
							}, delay);
						}
						else {
							this.reportFailure(`Cannot generate Umajin Standard Library using "${umajinJitFullPath}": ${reason}`);
							callback(false);
						}
					}
				}
			});
		}
	}

	public generateWorkspace() {
		vscode.window.showOpenDialog({
			title: 'Select start file',
			canSelectMany: false,
			filters: {
				'Umajin files': ['u'],
				'All files': ['*']
			}
		}).then((rootFileUri) => {
			if (rootFileUri && rootFileUri[0]) {
				const rootFullname: string = rootFileUri[0].fsPath;
				const rootFullParsedPath: path.ParsedPath = path.parse(rootFullname);
				const rootFilename: string = rootFullParsedPath.base;
				const cwFilename: string = `${rootFullParsedPath.dir}${path.sep}${path.basename(rootFullParsedPath.dir)}--${rootFullParsedPath.name}.code-workspace`;

				const writeFile = (callback: () => void) => {
					fs.readFile(umajin!._context.asAbsolutePath('snippets/code-workspace.json'), 'utf-8', (errno, data) => {
						if (errno) {
							this.reportFailure(`Cannot read the VSCode workspace file snippet: ${errno}`);
						}
						else {
							fs.writeFile(cwFilename, (jsonParse(data)
							['Umajin VSCode Workspace'].body as string[]).join('\n')
								.replace('$0', rootFilename), (errno) => {
									if (errno) {
										this.reportFailure(`Cannot write Umajin VSCode workspace file "${path.basename(cwFilename)}": ${errno}`);
									}
									else {
										callback();
									}
								});
						}
					});
				};

				const openFile = () => {
					vscode.window.showTextDocument(vscode.Uri.file(cwFilename));
				};

				fs.access(cwFilename, fs.constants.R_OK, (errno) => {
					if (errno?.code === 'ENOENT') {
						writeFile(openFile);
					} else {
						vscode.window.showInformationMessage(`File "${path.basename(cwFilename)}" already exists.\nDo you want to overwrite it?`, 'Yes', 'No')
							.then((answer) => {
								switch (answer) {
									case 'Yes':
										fs.unlink(cwFilename, (errno) => {
											if (errno !== null) {
												this.reportFailure(`Cannot remove Umajin VSCode workspace file "${path.basename(cwFilename)}" before writing: ${errno}`);
											} else {
												writeFile(openFile);
											}
										});
										break;

									case 'No':
										vscode.window.showInformationMessage(`Do you want to open "${path.basename(cwFilename)}" anyway?`, 'Yes', 'No')
											.then((answer) => {
												switch (answer) {
													case 'Yes':
														openFile();
														break;

													case 'No':
														break;
												}
											});
										break;
								}
							});
					}
				});
			}
		});
	}

	public applyAllCodeActions() {
		if (vscode.workspace.workspaceFolders === undefined) {
			vscode.window.showErrorMessage('Applying all code actions requires Umajin workspace to be open.');
			return;
		}

		if (!this._languageClient) {
			vscode.window.showErrorMessage('Applying all code actions requires Umajin language server to be connected.');
			return;
		}

		vscode.window.showInformationMessage('Do you want to apply code actions to all files in the project or to open files only?', 'The whole project', 'Open files only')
			.then(answer => {
				this._languageClient!.sendRequest('workspace/executeCommand',
					{
						'command': 'applyAllCodeActions',
						'arguments':
							[
								{ 'openOnly': (answer === 'Open files only') }
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

		if (!this._languageClient) {
			vscode.window.showErrorMessage('Autoformatting all Umajin files requires Umajin language server to be connected.');
			return;
		}

		vscode.window.showInformationMessage('Do you want to autoformat all files in the project or to open files only?', 'The whole project', 'Open files only')
			.then(answer => {
				this._languageClient!.sendRequest('workspace/executeCommand',
					{
						'command': 'autoformatAll',
						'arguments':
							[
								{ 'openOnly': (answer === 'Open files only') }
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

	private _readPath(platform: Platform, entryTail: string, defaultValue: string, filePart: string) {
		let path: string = vscode.workspace.getConfiguration().get('umajin.path' + platform.configSpecificSuffix + entryTail, '');
		if (path === '') {
			path = vscode.workspace.getConfiguration().get('umajin.path' + platform.configGenericSuffix + entryTail, defaultValue);
		}
		if (path === '') {
			path = vscode.workspace.getConfiguration().get('umajin.path' + entryTail, defaultValue);
		}

		return makeAbsolute(this._wsPath, path, filePart);
	}

	public getFilePath(platform: Platform, binary: Binary, file: string): string {
		switch (binary) {
			case Binary.GUI:
				return this._readPath(platform, '.jitEngine', this._umajinGuiFullPath, file);

			case Binary.CLI:
				return this._readPath(platform, '.cliEngine', this._umajinCliFullPath, file);

			case Binary.Compiler:
				return this._readPath(platform, '.compiler', this._umajincFullPath, file);

			case Binary.LS:
				return this._readPath(platform, '.languageServer', this._umajinlsFullPath, file);
		}
	}

	public getBundlePath(platform: Platform, binary: Binary): string {
		switch (binary) {
			case Binary.GUI:
				return this.getFilePath(platform, binary, platform.appName(binary));

			case Binary.CLI:
			case Binary.Compiler:
			case Binary.LS:
				return this.getFilePath(platform, binary, platform.binName(binary));
		}
	}

	public getExePath(platform: Platform, binary: Binary): string {
		switch (binary) {
			case Binary.GUI:
				return this.getFilePath(platform, binary, platform.binInAppName(binary));

			case Binary.CLI:
			case Binary.Compiler:
			case Binary.LS:
				return this.getFilePath(platform, binary, platform.binName(binary));
		}
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

		this._umajinGuiFullPath = this.getExePath(nativePlatform, Binary.GUI);

		this._umajinCliFullPath = this.getExePath(nativePlatform, Binary.CLI);

		this._umajincFullPath = this.getExePath(nativePlatform, Binary.Compiler);

		this._umajinlsFullPath = this.getExePath(nativePlatform, Binary.LS);

		this._root = makeAbsolute(this._wsPath, '.',
			vscode.workspace.getConfiguration().get('umajin.root', this._root));

		this._ui =
			vscode.workspace.getConfiguration().get('umajin.ui', this._ui);

		this._simulateCompiler =
			vscode.workspace.getConfiguration().get('umajin.simulate.compiler', this._simulateCompiler);

		this._simulatePlatform =
			vscode.workspace.getConfiguration().get('umajin.simulate.platform', this._simulatePlatform);

		this._channels =
			vscode.workspace.getConfiguration().get('umajin.update.channels', this._channels);
	}

	public stopLanguageClient(): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			this.stopLanguageClientImpl().then((noop) => {
				if (noop) {
					vscode.window.showInformationMessage('Umajin Language Client was not running.');
				} else {
					vscode.window.showInformationMessage('Umajin Language Client is stopped.');
				}
				resolve(noop);
			}).catch((error) => {
				vscode.window.showErrorMessage(`Cannot stop Umajin Language Client: ${error}`);
				reject(error);
			});
		});
	}

	public stopLanguageClientImpl(): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			this.log('Stopping language client...');
			if (this._languageClient) {
				this._languageClient.stop().then(() => {
					this.log('Language client stopped');
					this._deleteLanguageClient();
					resolve(false);
				}).catch((error) => {
					this.logError(`Failed to stop the Language client: ${error}`);
					this._deleteLanguageClient();
					reject(error);
				});
			} else {
				resolve(true);
			}
		});
	}

	private _deleteLanguageClient() {
		this._languageClient = null;
		this._serverVersion = '';
	}

	public startLanguageClient(): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			this.startLanguageClientImpl().then((noop) => {
				if (noop) {
					vscode.window.showInformationMessage('Umajin Language Client was running.');
				} else {
					vscode.window.showInformationMessage('Umajin Language Client is started.');
				}
				resolve(noop);
			}).catch((error) => {
				vscode.window.showErrorMessage(`Cannot start Umajin Language Client: ${error}`);
				reject(error);
			});
		});
	}

	public startLanguageClientImpl(): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			this.log('Starting language client...');
			if (!this._languageClient) {
				const serverOptions: languageClient.ServerOptions = {
					command: (this._languageServerCommand !== '') ? this._languageServerCommand : this._umajinlsFullPath,
					args: this._languageServerArguments
				};

				const clientOptions: languageClient.LanguageClientOptions = {
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

				this._languageClient = new languageClient.LanguageClient(
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
						this.log('Language client started');
						resolve(false);
					})
					.catch(error => {
						this.logError(`Failed to start the Language client: ${error}`);
						this._deleteLanguageClient();
						reject(error);
					});
			} else {
				resolve(true);
			}
		});
	}

	public restartLanguageClient() {
		this.stopLanguageClient().finally(() => {
			this.startLanguageClient();
		});
	}

	private _restartLanguageClientImpl(): Promise<void> {
		return new Promise<void>((resolve) => {
			this.stopLanguageClientImpl().finally(() => {
				this.startLanguageClientImpl().finally(() => {
					resolve();
				});
			});
		});
	}

	public statusLanguageClient() {
		vscode.window.showInformationMessage(this._languageClient
			? 'Umajin Language Client is running.'
			: 'Umajin Language Client is not running.');
	}

	public updateEngine() {
		if (vscode.workspace.workspaceFolders === undefined) {
			vscode.window.showErrorMessage('Updating Umajin engine requires Umajin workspace to be open.');
			return;
		}

		new EngineUpdateContext(this);
	}

	public async openEngineHelp(args: Object) {
		if (this._serverVersion === '') {
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
					prompt: 'Umajin type, constant, property, method, or event name or signature'
				});

				if (typed !== undefined) {
					const splitted: RegExpMatchArray | null = typed.match(/^([^:.]+)(?:(?:::|\.)\w+.*)?$/);
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

			const local: string = this._engineHelpLocalPath;
			const remote: string =
				(this._engineHelpRemoteSecure ? 'https' : 'http') + '://' +
				this._engineHelpRemoteServer + '/' + this._serverVersion;

			const path: string = `/library/${type}.html`;

			let useLocal: boolean = false;

			let fullPath: string = makeAbsolute(this._wsPath, local, path);
			if (fs.existsSync(fullPath)) {
				if (this._engineHelpLocalIgnoreVersion) {
					useLocal = true;
				}
				else {
					let versionCheckPath: string = makeAbsolute(this._wsPath, local, 'version.txt');
					if (fs.existsSync(versionCheckPath)) {
						const versionCheck: string = fs.readFileSync(versionCheckPath, 'utf-8');
						if (versionCheck && versionCheck === this._serverVersion) {
							useLocal = true;
						}
					}
				}
			}
			let documentationUri: vscode.Uri = useLocal ?
				vscode.Uri.file(fullPath) :
				vscode.Uri.parse(remote + path);

			if (section !== '') {
				if (section.includes('operator ')) {
					let skip: boolean = true;
					section = section.split(/operator /).map(part => {
						if (skip) {
							skip = false;
							return part;
						} else {
							let parts: string[] = part.split(/(\()/);
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
				documentationUri = documentationUri.with({ fragment: section });
			}

			try {
				if (!await vscode.env.openExternal(documentationUri)) {
					this.reportFailure(`Cannot open Umajin Engine documentation: ${documentationUri.toString()}`);
				}
			} catch (error) {
				this.reportFailure(`Cannot open Umajin Engine documentation: ${error}`);
			}

		}
	}
}

let umajin: UmajinExtension | null = null;

export function activate(context: vscode.ExtensionContext): void {
	if (!nativePlatform.isSupported) {
		vscode.window.showErrorMessage(
			`Umajin Language extension does not support ${os.platform()} (${os.arch()}). ` +
			'Supported platforms are Windows x64, macOS arm64, Linux x64, and Linux arm64.'
		);
		return;
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (umajin) {
				umajin.updateConfiguration(event);
			}
		})
	);

	umajin = new UmajinExtension(context);
}

export async function deactivate(): Promise<void> {
	const umajinToDeactivate: UmajinExtension | null = umajin;
	// Prevent configuration callbacks from using the extension while it is shutting down.
	umajin = null;
	if (umajinToDeactivate) {
		await umajinToDeactivate.destruct();
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
	public request: debugProtocol.DebugProtocol.Request;
	public response: debugProtocol.DebugProtocol.Response;
	private _callback: (response: debugProtocol.DebugProtocol.Response) => void;

	public constructor(request: debugProtocol.DebugProtocol.Request, response: debugProtocol.DebugProtocol.Response, callback: (response: debugProtocol.DebugProtocol.Response) => void) {
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

class UmajinDebugSession extends debugAdapter.LoggingDebugSession {
	private _logChannel: vscode.OutputChannel;

	private _wsPath: string;
	private _collapseLongMessages: boolean;

	private _child: childProcess.ChildProcess | null;

	private _stdoutTail: string = '';
	private _stderrTail: string = '';
	private _lastCompilerOutputEvent?: debugProtocol.DebugProtocol.OutputEvent = undefined;

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
	private _hasColoriseLog: boolean = false;
	private _hasMTSupport: boolean = false;

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
	private static readonly _EIDPortMessage: string = "Embedded Intrusive Debugger port: ";

	private static readonly _specialArgs = new Set<string>(['--log-output', '--log-level', '-L', '--log-format', '-F', '--script', '--colorise-log', '-C', '--target', '--print-llvm-ir', '-o', '--generate-debug-code', '-d']);


	public constructor() {
		super();

		this._logChannel = vscode.window.createOutputChannel("Umajin Debugger");

		this._wsPath = umajin!.getWsPath();
		this._collapseLongMessages = umajin!.getCollapseLongMessages();

		this._child = null;
		this._debuggingInputAccumulator = new BinaryAccumulator((data: Buffer) => { this._processDebugging(data); });
		this._loggingInputAccumulator = new BinaryAccumulator((data: Buffer) => { this._processStdout(data.toString() + '\n'); });

		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);
	}

	override sendEvent(event: debugProtocol.DebugProtocol.Event): void {
		super.sendEvent(event);
	}

	override sendResponse(response: debugProtocol.DebugProtocol.Response): void {
		super.sendResponse(response);
	}

	private _log(message: string) {
		console.log(message);
		this._logChannel.appendLine(message);
	}

	protected override initializeRequest(response: debugProtocol.DebugProtocol.InitializeResponse, args: debugProtocol.DebugProtocol.InitializeRequestArguments): void {
		const ui: string = umajin!.getUI();
		const useGui: boolean = ui === "GUI";
		const simulateCompiler: string = umajin!.getSimulateCompiler();
		const simulatePlatform: string = umajin!.getSimulatePlatform();
		const useJit: boolean =
			(simulateCompiler === 'JIT') &&
			((simulatePlatform === 'native') || (simulatePlatform === nativePlatform.nameForCompiler));

		const program: string = useJit ? (useGui ? umajin!.getUmajinGuiFullPath() : umajin!.getUmajinCliFullPath()) : umajin!.getUmajincFullPath();

		let hasCapabilities: boolean = false;

		if (useJit) {
			// check version
			const versionCheck: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(program, ['--version'], {
				cwd: this._wsPath,
				encoding: 'utf8'
			});
			if (!versionCheck.error && versionCheck.status === 0) {
				const versionLines: string[] = (versionCheck.stdout + '\n' + versionCheck.stderr).split(/\r?\n/).filter((line) => line.startsWith("Version "));
				if (versionLines.length === 1) {
					const matched: RegExpMatchArray | null = versionLines[0]!.match(/^Version (\d+\.\d+\.\d+)\.\d+(?:-\S+)? "[^"]+" [0-9a-fA-F]+$/);
					if (matched?.length === 2) {
						this._hasDebugger = semver.gte(matched[1]!, '6.11.0'); // Levin
						this._hasColoriseLog = semver.gte(matched[1]!, '6.14.0'); // Ohakune
						this._hasMTSupport = semver.gte(matched[1]!, '6.17.0'); // Rotorua
					}
				}
			}
			if (this._hasDebugger) {
				// get capabilities
				const capabilitiesCheck: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(program, ['--debugging-capabilities'], {
					cwd: this._wsPath,
					encoding: 'utf8'
				});
				if (!capabilitiesCheck.error && capabilitiesCheck.status === 0) {
					response.body = jsonParse((!!capabilitiesCheck.stdout.length) ? capabilitiesCheck.stdout : capabilitiesCheck.stderr);
					response.body!.supportsTerminateRequest = true;
					response.body!.supportTerminateDebuggee = true;
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

		this.sendEvent(new debugAdapter.InitializedEvent());
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
				const aLocalCopy: NetRequestList = uds._sendOnConnect;
				uds._sendOnConnect = [];
				aLocalCopy.forEach((value: NetRequest) => {
					uds._sendToDebugger(value);
				});
			})
			.on('data', (data: Buffer) => {
				uds._debuggingInputAccumulator.append(data);
			});
	}

	protected override disconnectRequest(response: debugProtocol.DebugProtocol.DisconnectResponse, args: debugProtocol.DebugProtocol.DisconnectArguments, request?: debugProtocol.DebugProtocol.Request) {
		if (args) {
			if (args.terminateDebuggee) {
				if (this._child) {
					this._child.kill();
				}
			}
		}
		this.sendResponse(response);
	}

	protected override async launchRequest(response: debugProtocol.DebugProtocol.LaunchResponse, launchRequestArgs: ILaunchRequestArguments, request?: debugProtocol.DebugProtocol.Request) {
		debugAdapter.logger.setup(debugAdapter.Logger.LogLevel.Verbose, false, false);

		const uds: UmajinDebugSession = this;
		this._wsPath = umajin!.getWsPath();
		this._collapseLongMessages = umajin!.getCollapseLongMessages();
		const ui: string = umajin!.getUI();
		const simulateCompiler: string = umajin!.getSimulateCompiler();
		const simulatePlatform: string = umajin!.getSimulatePlatform();
		const useJit: boolean =
			(simulateCompiler === 'JIT') &&
			((simulatePlatform === 'native') || (simulatePlatform === nativePlatform.nameForCompiler));

		let useGui: boolean = ui === "GUI";
		if (launchRequestArgs.overrideUI) {
			useGui = launchRequestArgs.overrideUI === "GUI";
		}

		const program: string = useJit ? (useGui ? umajin!.getUmajinGuiFullPath() : umajin!.getUmajinCliFullPath()) : umajin!.getUmajincFullPath();

		let logOutputArgs: string[] = ['--log-output=stderr'];
		if (launchRequestArgs.logToFile) {
			logOutputArgs.push(`--log-output=file:${launchRequestArgs.logToFile}`);
		}

		let reLogMessageString: string = '^(([^:]+):(\\d+)(?::(\\d+))?.*)?\t([^\t]+\t(\\w+)\t(\\w+)';
		//                                 12     2 3    3_   4    4_   1   5        6   6   7    7
		//                                 s                                 t*      lp      ll

		let logFormat: string = 's:t';
		if (launchRequestArgs.logFormatTimestamp) {
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
		if (launchRequestArgs.logFormatThread) {
			logFormat += ':h';
			reLogMessageString += '\t(?:[^\t]*)';
			//
			//                       h
		}
		if (launchRequestArgs.logFormatEngineSourceInfo) {
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
		if (launchRequestArgs.logLevel) {
			logLevel = launchRequestArgs.logLevel;
		}

		let rootFile: string = umajin!.getRoot();
		if (launchRequestArgs.overrideRootFile) {
			rootFile = launchRequestArgs.overrideRootFile;
		}

		let programArgs: string[] = logOutputArgs.concat([`--log-level=${logLevel}`, `--log-format=${logFormat}`, `--script=${rootFile}`]);
		if (this._hasColoriseLog) {
			programArgs.push('--colorise-log=no');
		}
		if (!useJit) {
			switch (simulatePlatform) {
				case 'native':
					break;

				case 'windows':
					programArgs.push('--target=x86_64-pc-windows-msvc');
					break;

				case 'mac-x86_64':
					programArgs.push('--target=x86_64-apple-darwin');
					break;

				case 'mac-arm64':
					programArgs.push('--target=arm64-apple-darwin');
					break;

				case 'ios':
					programArgs.push('--target=arm64-apple-ios');
					break;

				case 'android':
					programArgs.push('--target=aarch64-linux-android');
					break;

				case 'linux-x86_64':
					programArgs.push('--target=x86_64-unknown-linux-gnu');
					break;

				case 'linux-aarch64':
					programArgs.push('--target=aarch64-unknown-linux-gnu');
					break;
			}
			programArgs.push('--print-llvm-ir=none:');
		}
		if (this._hasDebugger && !launchRequestArgs.noDebug) {
			this._createDebugger();
			programArgs.push('--generate-debug-code');
		} else {
			this._debugger = null;
		}


		const checkArg = (arg: string): boolean => {
			const match = arg.match(/^(-(?:(?:-[A-Za-z0-9_]+)+|[A-Za-z]))(?:=.*)?$/);
			if (match !== null) {
				const argKey = match[1]!;
				if (UmajinDebugSession._specialArgs.has(argKey)) {
					{
						const event: debugProtocol.DebugProtocol.OutputEvent = new debugAdapter.OutputEvent(
							`Umajin arguments error: argument "${argKey}" cannot be used in launch configuration\n`,
							'console');
						uds.sendEvent(event);
					}

					uds.sendEvent(new debugAdapter.TerminatedEvent());

					this._child = null;

					this.shutdown();

					return false;
				}
			}
			return true;
		}

		if (launchRequestArgs.engineArguments !== undefined) {
			for (const arg of launchRequestArgs.engineArguments!) {
				if (!checkArg(arg)) {
					return;
				}
			}
			programArgs = programArgs.concat(launchRequestArgs.engineArguments);
		}

		let haveArgSeparator: boolean = false;
		if (launchRequestArgs.arguments !== undefined) {
			for (const arg of launchRequestArgs.arguments!) {
				if (!checkArg(arg)) {
					return;
				}
				if (arg === '--') {
					haveArgSeparator = true
					break;
				}
			}
			programArgs = programArgs.concat(launchRequestArgs.arguments);
		}

		if (launchRequestArgs.scriptArguments !== undefined) {
			if (!haveArgSeparator) {
				programArgs.push('--');
			}
			programArgs = programArgs.concat(launchRequestArgs.scriptArguments);
		}


		let env: NodeJS.ProcessEnv = structuredClone(process.env); // has to be a deep copy, otherwise the changes propagate back and are not reset for the next run
		if (launchRequestArgs.env !== undefined) {
			for (const envName in launchRequestArgs.env!) {
				env[envName] = launchRequestArgs.env[envName];
			}
		}
		if (launchRequestArgs.envUnset !== undefined) {
			for (const envName of launchRequestArgs.envUnset!) {
				delete env[envName];
			}
		}

		{
			const e: debugProtocol.DebugProtocol.OutputEvent = new debugAdapter.OutputEvent(`Launching "${program} ${programArgs.join(' ')}"  ...\n`, 'console');
			this.sendEvent(e);
		}

		const child = childProcess.spawn(program, programArgs, {
			detached: true,
			cwd: this._wsPath,
			env: env,
			stdio: ['ignore', 'pipe', 'pipe']
		})
			.on('error', (err: Error) => {
				const event: debugProtocol.DebugProtocol.OutputEvent = new debugAdapter.OutputEvent(
					`Umajin launch error: ${err}\n`,
					'console');
				uds.sendEvent(event);

				uds.sendEvent(new debugAdapter.TerminatedEvent());

				this._child = null;
			})
			.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
				const event: debugProtocol.DebugProtocol.OutputEvent = new debugAdapter.OutputEvent(
					(signal !== null) ?
						`Umajin exited with code ${code}, signal ${signal}\n` :
						`Umajin exited with code ${code}\n`,
					'console');
				uds.sendEvent(event);
				if (code !== null) {
					uds.sendEvent(new debugAdapter.ExitedEvent(code));
				}
				uds.sendEvent(new debugAdapter.TerminatedEvent());

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

	protected override async attachRequest(response: debugProtocol.DebugProtocol.AttachResponse, attachRequestArgs: IAttachRequestArguments, request?: debugProtocol.DebugProtocol.Request) {
		const uds: UmajinDebugSession = this;

		this._netLogStream = attachRequestArgs.logStream;

		this._netLogger = new net.Socket()
			.on('connect', () => {
				uds._log('Net logger connected');
			})
			.on('close', (hadError: boolean) => {
				uds._log(`Net logger closed, hadError: ${hadError}`);
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
							for (let i: number = 0; i < data.length; i++) {
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

	protected override async terminateRequest(response: debugProtocol.DebugProtocol.TerminateResponse, args: debugProtocol.DebugProtocol.TerminateArguments, request?: debugProtocol.DebugProtocol.Request) {
		if (this._child) {
			this._child.kill();
		}
		this.sendResponse(response);
	}

	protected override async restartRequest(response: debugProtocol.DebugProtocol.RestartResponse, args: debugProtocol.DebugProtocol.RestartArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async setBreakPointsRequest(response: debugProtocol.DebugProtocol.SetBreakpointsResponse, args: debugProtocol.DebugProtocol.SetBreakpointsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setFunctionBreakPointsRequest(response: debugProtocol.DebugProtocol.SetFunctionBreakpointsResponse, args: debugProtocol.DebugProtocol.SetFunctionBreakpointsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setExceptionBreakPointsRequest(response: debugProtocol.DebugProtocol.SetExceptionBreakpointsResponse, args: debugProtocol.DebugProtocol.SetExceptionBreakpointsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async configurationDoneRequest(response: debugProtocol.DebugProtocol.ConfigurationDoneResponse, args: debugProtocol.DebugProtocol.ConfigurationDoneArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async continueRequest(response: debugProtocol.DebugProtocol.ContinueResponse, args: debugProtocol.DebugProtocol.ContinueArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async nextRequest(response: debugProtocol.DebugProtocol.NextResponse, args: debugProtocol.DebugProtocol.NextArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async stepInRequest(response: debugProtocol.DebugProtocol.StepInResponse, args: debugProtocol.DebugProtocol.StepInArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async stepOutRequest(response: debugProtocol.DebugProtocol.StepOutResponse, args: debugProtocol.DebugProtocol.StepOutArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async stepBackRequest(response: debugProtocol.DebugProtocol.StepBackResponse, args: debugProtocol.DebugProtocol.StepBackArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async reverseContinueRequest(response: debugProtocol.DebugProtocol.ReverseContinueResponse, args: debugProtocol.DebugProtocol.ReverseContinueArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async restartFrameRequest(response: debugProtocol.DebugProtocol.RestartFrameResponse, args: debugProtocol.DebugProtocol.RestartFrameArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async gotoRequest(response: debugProtocol.DebugProtocol.GotoResponse, args: debugProtocol.DebugProtocol.GotoArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async pauseRequest(response: debugProtocol.DebugProtocol.PauseResponse, args: debugProtocol.DebugProtocol.PauseArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async sourceRequest(response: debugProtocol.DebugProtocol.SourceResponse, args: debugProtocol.DebugProtocol.SourceArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async threadsRequest(response: debugProtocol.DebugProtocol.ThreadsResponse, request?: debugProtocol.DebugProtocol.Request) {
		if (this._hasMTSupport) {
			this._redirectToDebugger(response, request);
		} else {
			if (this._child || this._debuggerConnected) {
				response.body = { threads: [{ id: 0, name: 'Umajin' }] };
			}
			this.sendResponse(response);
		}
	}

	protected override async terminateThreadsRequest(response: debugProtocol.DebugProtocol.TerminateThreadsResponse, args: debugProtocol.DebugProtocol.TerminateThreadsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async stackTraceRequest(response: debugProtocol.DebugProtocol.StackTraceResponse, args: debugProtocol.DebugProtocol.StackTraceArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async scopesRequest(response: debugProtocol.DebugProtocol.ScopesResponse, args: debugProtocol.DebugProtocol.ScopesArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async variablesRequest(response: debugProtocol.DebugProtocol.VariablesResponse, args: debugProtocol.DebugProtocol.VariablesArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setVariableRequest(response: debugProtocol.DebugProtocol.SetVariableResponse, args: debugProtocol.DebugProtocol.SetVariableArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setExpressionRequest(response: debugProtocol.DebugProtocol.SetExpressionResponse, args: debugProtocol.DebugProtocol.SetExpressionArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async evaluateRequest(response: debugProtocol.DebugProtocol.EvaluateResponse, args: debugProtocol.DebugProtocol.EvaluateArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async stepInTargetsRequest(response: debugProtocol.DebugProtocol.StepInTargetsResponse, args: debugProtocol.DebugProtocol.StepInTargetsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async gotoTargetsRequest(response: debugProtocol.DebugProtocol.GotoTargetsResponse, args: debugProtocol.DebugProtocol.GotoTargetsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async completionsRequest(response: debugProtocol.DebugProtocol.CompletionsResponse, args: debugProtocol.DebugProtocol.CompletionsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async exceptionInfoRequest(response: debugProtocol.DebugProtocol.ExceptionInfoResponse, args: debugProtocol.DebugProtocol.ExceptionInfoArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async loadedSourcesRequest(response: debugProtocol.DebugProtocol.LoadedSourcesResponse, args: debugProtocol.DebugProtocol.LoadedSourcesArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async dataBreakpointInfoRequest(response: debugProtocol.DebugProtocol.DataBreakpointInfoResponse, args: debugProtocol.DebugProtocol.DataBreakpointInfoArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async setDataBreakpointsRequest(response: debugProtocol.DebugProtocol.SetDataBreakpointsResponse, args: debugProtocol.DebugProtocol.SetDataBreakpointsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async readMemoryRequest(response: debugProtocol.DebugProtocol.ReadMemoryResponse, args: debugProtocol.DebugProtocol.ReadMemoryArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async writeMemoryRequest(response: debugProtocol.DebugProtocol.WriteMemoryResponse, args: debugProtocol.DebugProtocol.WriteMemoryArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async disassembleRequest(response: debugProtocol.DebugProtocol.DisassembleResponse, args: debugProtocol.DebugProtocol.DisassembleArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async cancelRequest(response: debugProtocol.DebugProtocol.CancelResponse, args: debugProtocol.DebugProtocol.CancelArguments, request?: debugProtocol.DebugProtocol.Request) {
		this.sendResponse(response);
	}

	protected override async breakpointLocationsRequest(response: debugProtocol.DebugProtocol.BreakpointLocationsResponse, args: debugProtocol.DebugProtocol.BreakpointLocationsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}

	protected override async setInstructionBreakpointsRequest(response: debugProtocol.DebugProtocol.SetInstructionBreakpointsResponse, args: debugProtocol.DebugProtocol.SetInstructionBreakpointsArguments, request?: debugProtocol.DebugProtocol.Request) {
		this._redirectToDebugger(response, request);
	}


	private _processStdout(chunk: string) {
		this._stdoutTail = this._processChunk(this._stdoutTail + chunk, 'stdout');
	}

	private _processStderr(chunk: string) {
		this._stderrTail = this._processChunk(this._stderrTail + chunk, 'stderr');
	}

	private _processChunk(chunk: string, stream: string): string {
		for (let index: number = chunk.indexOf('\n'); index !== -1; index = chunk.indexOf('\n')) {
			this._processLine(chunk.substring(0, index), stream);
			chunk = chunk.substring(index + 1);
		}
		return chunk;
	}

	private _processLine(line: string, stream: string) {
		const event: debugProtocol.DebugProtocol.OutputEvent = new debugAdapter.OutputEvent(line + '\n', stream);
		let looksLike: 'first' | 'single' | 'extra' = 'single';
		let emitEnd: boolean = false;

		const match: RegExpMatchArray | null = line.match(this._reLogMessage);
		if (match !== null) {
			if (match[UmajinDebugSession._reLogMessageIndexScriptSourceInfo] !== undefined && match[UmajinDebugSession._reLogMessageIndexScriptSourceInfo]!.length > 0) {
				event.body.source = new debugAdapter.Source(match[UmajinDebugSession._reLogMessageIndexScriptSourceInfoFile]!, this.convertDebuggerPathToClient(path.resolve(this._wsPath + path.sep + match[UmajinDebugSession._reLogMessageIndexScriptSourceInfoFile]!)));
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
			const endEvent: debugProtocol.DebugProtocol.OutputEvent = new debugAdapter.OutputEvent('', stream);
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
		const message: any = jsonParse(data.toString('utf-8'));
		if (message.type === 'response') {
			if (message.request_seq !== undefined) {
				if (this._sentRequests[message.request_seq] !== undefined) {
					this._sentRequests[message.request_seq]!.callback(message);
					delete this._sentRequests[message.request_seq];
				}
				else {
					this._log('Received message\'s request_seq didn\'t match any of saved requests');
				}
			}
			else {
				this._log('Received message does not have request_seq');
			}
		}
		else if (message.type === 'event') {
			this.sendEvent(message);
		}
		else if (message.type === 'request') {
			this._log('Do not know how to process requests');
		}
		else if (message.type !== undefined) {
			this._log(`Do not know how to process message ${message.type}`);
		}
		else if (message.type !== undefined) {
			this._log('Do not know how to process a message without type');
		}
	}

	private _redirectToDebugger(response: debugProtocol.DebugProtocol.Response, request?: debugProtocol.DebugProtocol.Request) {
		if (request) {
			this._sendToDebugger(new NetRequest(request, response, (response: debugProtocol.DebugProtocol.Response) => {
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
				const header: Buffer = Buffer.alloc(4);
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
