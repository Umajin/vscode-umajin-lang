'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
const vscode = require("vscode");
let taskProvider;
function activate(_context) {
    let workspaceRoot = vscode.workspace.rootPath;
    if (!workspaceRoot) {
        return;
    }
    let umajinPromise = undefined;
    taskProvider = vscode.tasks.registerTaskProvider('umajin-run', {
        provideTasks: () => {
            if (!umajinPromise) {
                umajinPromise = getUmajinTasks();
            }
            return umajinPromise;
        },
        resolveTask(_task) {
            return undefined;
        }
    });
}
exports.activate = activate;
function deactivate() {
    if (taskProvider) {
        taskProvider.dispose();
    }
}
exports.deactivate = deactivate;
function exists(file) {
    return new Promise((resolve, _reject) => {
        fs.exists(file, (value) => {
            resolve(value);
        });
    });
}
function getUmajinTasks() {
    return __awaiter(this, void 0, void 0, function* () {
        let workspaceRoot = vscode.workspace.rootPath;
        let result = [];
        if (!workspaceRoot) {
            return result;
        }
        let umajinFile = path.join(workspaceRoot, 'umajin.exe');
        if (!(yield exists(umajinFile))) {
            return result;
        }
        let kind = {
            label: 'Umajin',
            type: 'umajin-run',
            task: '.\\umajin.exe'
        };
        let task = new vscode.Task(kind, 'launch', 'Umajin', new vscode.ProcessExecution(kind.task));
        task.group = vscode.TaskGroup.Test;
        result.push(task);
        return result;
    });
}
//# sourceMappingURL=extension.js.map