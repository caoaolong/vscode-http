// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { HttpRequestTreeProvider } from './provider/http_request_tree_provider';
import { createRequestEditorPanel } from './webview/request_editor';
import type { Project } from './models/types';

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	console.log('vscode-http 扩展已激活');

	const treeProvider = new HttpRequestTreeProvider(context);
	const treeView = vscode.window.createTreeView('vscode-http.requestTree', {
		treeDataProvider: treeProvider,
	});

	context.subscriptions.push(treeView);

	treeView.onDidChangeSelection((e) => {
		const item = e.selection[0] as vscode.TreeItem | undefined;
		const id = item?.id;
		if (!id) return;
		const iface = treeProvider.getInterfaceById(id);
		if (iface) {
			const project = treeProvider.getProjectForInterface(iface);
			if (!project) return;
			const { environments, currentEnvId } = treeProvider.getEnvironmentsForInterface(iface);
			const baseUrl = treeProvider.getBaseUrlForInterface(iface);
			const pathFromUrl = baseUrl ? treeProvider.getPathFromFullUrl(iface.url, baseUrl) : iface.url;
			createRequestEditorPanel(
				context,
				iface,
				baseUrl,
				pathFromUrl,
				environments,
				currentEnvId,
				project,
				(i, data) => {
					treeProvider.updateInterface(i, {
						url: data.url,
						method: data.method,
						headers: data.headers,
						requestBody: data.body,
						bodyType: data.bodyType,
						formData: data.formData,
						formUrlEncoded: data.formUrlEncoded,
						binaryBase64: data.binaryBase64,
					});
				},
				(projectId, envId) => {
					const p = treeProvider.getProjects().find((pr) => pr.id === projectId);
					if (p) treeProvider.setCurrentEnvironmentById(p, envId);
				}
			);
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-http.helloWorld', () => {
			vscode.window.showInformationMessage('Hello World from vscode-http!');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-http.manageEnvironments', (project: Project) => {
			treeProvider.addEnvironment(project);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-http.setCurrentEnvironment', (project: Project) => {
			treeProvider.setCurrentEnvironment(project);
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
