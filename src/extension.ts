'use strict';

import * as path from 'path';
import * as fs from 'fs';
// import * as cp from 'child_process';
import * as vscode from 'vscode';


let taskProvider: vscode.Disposable | undefined;


interface UmajinTaskDefinition extends vscode.TaskDefinition {
	task: string;
}


export function activate(_context: vscode.ExtensionContext): void {
	let workspaceRoot = vscode.workspace.rootPath;
	if (!workspaceRoot) {
		return;
	}
	let umajinPromise: Thenable<vscode.Task[]> | undefined = undefined;
	taskProvider = vscode.tasks.registerTaskProvider('umajin-run', {
		provideTasks: () => {
			if (!umajinPromise) {
				umajinPromise = getUmajinTasks();
			}
			return umajinPromise;
		},
		resolveTask(_task: vscode.Task): vscode.Task | undefined {
			return undefined;
		}
	});
}

export function deactivate(): void {
	if (taskProvider) {
		taskProvider.dispose();
	}
}

function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
		fs.exists(file, (value) => {
			resolve(value);
		});
	});
}

async function getUmajinTasks(): Promise<vscode.Task[]> {
	let workspaceRoot = vscode.workspace.rootPath;
	let result: vscode.Task[] = [];
	if (!workspaceRoot) {
		return result;
	}
	
	let umajinFile = path.join(workspaceRoot, 'umajin.exe');
	if (!await exists(umajinFile)) {
		return result;
	}
	
	let kind: UmajinTaskDefinition = {
		label: 'Umajin',
		type: 'umajin-run',
		task: '.\\umajin.exe'
	};
	let task = new vscode.Task(kind, 'launch', 'Umajin', new vscode.ProcessExecution(kind.task));
	task.group = vscode.TaskGroup.Test;
	result.push(task);
	
	return result;
}

