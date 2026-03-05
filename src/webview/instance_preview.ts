import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { Instance } from '../models/types';
import { tryReveal, registerPanel } from './panel_registry';

const PREVIEW_PANEL_PREFIX = 'instance-preview:';

function getHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const htmlPath = path.join(context.extensionPath, 'resources', 'instance_preview.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const cspParts = ["'unsafe-inline'", webview.cspSource?.trim()].filter((s) => s != null && s !== '');
  const csp = [
    "default-src 'none'",
    `script-src ${cspParts.join(' ')}`,
    `style-src 'unsafe-inline' ${webview.cspSource ?? ''}`,
    `font-src ${webview.cspSource ?? ''}`,
    "connect-src 'none'",
  ].join('; ');
  html = html.replace(/\{\{CSP\}\}/g, csp);
  return html;
}

export function createInstancePreviewPanel(
  context: vscode.ExtensionContext,
  instance: Instance
): void {
  const panelId = PREVIEW_PANEL_PREFIX + instance.id;
  if (tryReveal(panelId)) return;

  const title = `实例: ${instance.name}`;
  const panel = vscode.window.createWebviewPanel(
    'vscode-http.instancePreview',
    title,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  registerPanel(panelId, panel);
  panel.webview.html = getHtml(context, panel.webview);

  const req = instance.requestSnapshot;
  const res = instance.responseSnapshot;

  panel.webview.postMessage({
    type: 'init',
    name: instance.name,
    request: {
      method: req?.method ?? 'GET',
      url: req?.url ?? '',
      headers: req?.headers ?? {},
      body: req?.body ?? '',
      bodyType: req?.bodyType,
      formData: req?.formData,
      formUrlEncoded: req?.formUrlEncoded,
    },
    response: {
      status: res?.status,
      statusText: res?.statusText ?? '',
      headers: res?.headers ?? {},
      body: res?.body ?? '',
      error: res?.error,
    },
  });
}
