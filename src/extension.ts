// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { HttpRequestTreeProvider } from './provider/http_request_tree_provider';

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	console.log('vscode-http 扩展已激活');

	const treeProvider = new HttpRequestTreeProvider(context);
	const treeView = vscode.window.createTreeView('vscode-http.requestTree', {
		treeDataProvider: treeProvider,
	});

	context.subscriptions.push(treeView);

	const disposable = vscode.commands.registerCommand('vscode-http.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from vscode-http!');
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
