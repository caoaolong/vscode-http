import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { Project } from '../models/types';
import { tryReveal, registerPanel } from './panel_registry';

function getHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const htmlPath = path.join(context.extensionPath, 'resources', 'environment_manager.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const csp = `default-src 'none'; script-src 'unsafe-inline' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource};`;
  html = html.replace(/\{\{CSP\}\}/g, csp);
  return html;
}

const ENV_PANEL_PREFIX = 'env-manager:';

export function createEnvironmentManagerPanel(
  context: vscode.ExtensionContext,
  project: Project,
  onAdd: (project: Project) => void,
  onUpdate: (project: Project, envId: string, data: { name: string; baseUrl: string }) => void,
  onDelete: (project: Project, envId: string) => void,
  onSetCurrent: (project: Project, envId: string) => void,
  onRenameProject: (project: Project, name: string) => void
): void {
  const panelId = ENV_PANEL_PREFIX + project.id;
  if (tryReveal(panelId)) return;

  const panel = vscode.window.createWebviewPanel(
    'vscode-http.environmentManager',
    `环境管理 - ${project.name}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getHtml(context, panel.webview);

  const sendUpdate = () => {
    panel.webview.postMessage({
      type: 'update',
      projectName: project.name,
      environments: project.environments ?? [],
      currentEnvId: project.currentEnvId ?? '',
    });
    panel.title = `环境管理 - ${project.name}`;
  };

  panel.webview.onDidReceiveMessage(
    async (msg) => {
      if (msg.type === 'addEnv') {
        await onAdd(project);
        sendUpdate();
      } else if (msg.type === 'updateEnv') {
        onUpdate(project, msg.envId, { name: msg.name, baseUrl: msg.baseUrl });
        sendUpdate();
      } else if (msg.type === 'deleteEnv') {
        await onDelete(project, msg.envId);
        sendUpdate();
      } else if (msg.type === 'setCurrent') {
        onSetCurrent(project, msg.envId);
        sendUpdate();
      } else if (msg.type === 'updateProjectName') {
        if (msg.name?.trim()) {
          onRenameProject(project, msg.name.trim());
          sendUpdate();
        }
      }
    },
    undefined,
    context.subscriptions
  );

  registerPanel(panelId, panel);

  panel.webview.postMessage({
    type: 'init',
    projectId: project.id,
    projectName: project.name,
    environments: project.environments ?? [],
    currentEnvId: project.currentEnvId ?? '',
  });
}
