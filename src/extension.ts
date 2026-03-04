// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { HttpRequestTreeProvider } from './provider/http_request_tree_provider';
import { createRequestEditorPanel } from './webview/request_editor';
import { createEnvironmentManagerPanel } from './webview/environment_manager';
import { createCollectionManagerPanel } from './webview/collection_manager';
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
						name: data.name,
						auth: data.auth,
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
		vscode.commands.registerCommand('vscode-http.addCollection', async (item: vscode.TreeItem) => {
			const project = item?.id ? treeProvider.getProjects().find((p) => p.id === item.id) : undefined;
			if (project) await treeProvider.createCollection(project);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-http.manageEnvironments', (projectId: string) => {
			const project = projectId ? treeProvider.getProjects().find((p) => p.id === projectId) : undefined;
			if (project) {
				createEnvironmentManagerPanel(
					context,
					project,
					(p) => treeProvider.addEnvironment(p),
					(p, envId, data) => treeProvider.updateEnvironment(p, envId, data),
					(p, envId) => treeProvider.deleteEnvironment(p, envId),
					(p, envId) => treeProvider.setCurrentEnvironmentById(p, envId),
					(p, name) => treeProvider.renameProjectSync(p, name)
				);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-http.manageCollection', (collectionId: string) => {
			const coll = collectionId ? treeProvider.getCollectionById(collectionId) : undefined;
			if (!coll) return;
			createCollectionManagerPanel(
				context,
				coll,
				(c, name) => treeProvider.renameCollectionSync(c, name),
				(iface) => {
					const p = treeProvider.getProjectForInterface(iface);
					if (!p) return;
					const { environments, currentEnvId } = treeProvider.getEnvironmentsForInterface(iface);
					const baseUrl = treeProvider.getBaseUrlForInterface(iface);
					const pathFromUrl = baseUrl ? treeProvider.getPathFromFullUrl(iface.url, baseUrl) : iface.url;
					createRequestEditorPanel(context, iface, baseUrl, pathFromUrl, environments, currentEnvId, p,
						(i, data) => treeProvider.updateInterface(i, {
							url: data.url, method: data.method, headers: data.headers, requestBody: data.body,
							bodyType: data.bodyType, formData: data.formData, formUrlEncoded: data.formUrlEncoded, binaryBase64: data.binaryBase64, name: data.name, auth: data.auth,
						}),
						(projectId, envId) => {
							const px = treeProvider.getProjects().find((pr) => pr.id === projectId);
							if (px) treeProvider.setCurrentEnvironmentById(px, envId);
						}
					);
				},
				(iface) => treeProvider.deleteInterface(iface),
				async (c) => {
					const iface = await treeProvider.createInterface(c);
					if (iface) {
						const p = treeProvider.getProjectForInterface(iface);
						if (!p) return;
						const { environments, currentEnvId } = treeProvider.getEnvironmentsForInterface(iface);
						const baseUrl = treeProvider.getBaseUrlForInterface(iface);
						const pathFromUrl = baseUrl ? treeProvider.getPathFromFullUrl(iface.url, baseUrl) : iface.url;
						createRequestEditorPanel(context, iface, baseUrl, pathFromUrl, environments, currentEnvId, p,
							(i, data) => treeProvider.updateInterface(i, {
								url: data.url, method: data.method, headers: data.headers, requestBody: data.body,
								bodyType: data.bodyType, formData: data.formData, formUrlEncoded: data.formUrlEncoded, binaryBase64: data.binaryBase64, name: data.name, auth: data.auth,
							}),
							(projectId, envId) => {
								const px = treeProvider.getProjects().find((pr) => pr.id === projectId);
								if (px) treeProvider.setCurrentEnvironmentById(px, envId);
							}
						);
					}
				}
			);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-http.deleteCollection', async (item: vscode.TreeItem) => {
			const coll = item?.id ? treeProvider.getCollectionById(item.id) : undefined;
			if (coll) await treeProvider.deleteCollection(coll);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-http.addInterface', async (item: vscode.TreeItem) => {
			const coll = item?.id ? treeProvider.getCollectionById(item.id) : undefined;
			if (!coll) return;
			const iface = await treeProvider.createInterface(coll);
			if (iface) {
				const project = treeProvider.getProjectForInterface(iface);
				if (!project) return;
				const { environments, currentEnvId } = treeProvider.getEnvironmentsForInterface(iface);
				const baseUrl = treeProvider.getBaseUrlForInterface(iface);
				const pathFromUrl = baseUrl ? treeProvider.getPathFromFullUrl(iface.url, baseUrl) : iface.url;
				createRequestEditorPanel(context, iface, baseUrl, pathFromUrl, environments, currentEnvId, project,
					(i, data) => treeProvider.updateInterface(i, {
						url: data.url, method: data.method, headers: data.headers, requestBody: data.body,
						bodyType: data.bodyType, formData: data.formData, formUrlEncoded: data.formUrlEncoded, binaryBase64: data.binaryBase64, name: data.name, auth: data.auth,
					}),
					(projectId, envId) => {
						const p = treeProvider.getProjects().find((pr) => pr.id === projectId);
						if (p) treeProvider.setCurrentEnvironmentById(p, envId);
					}
				);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-http.deleteInterface', async (item: vscode.TreeItem) => {
			const iface = item?.id ? treeProvider.getInterfaceById(item.id) : undefined;
			if (iface) await treeProvider.deleteInterface(iface);
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
