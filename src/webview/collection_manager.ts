import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { Collection, Interface } from '../models/types';
import { tryReveal, registerPanel } from './panel_registry';

function getHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const htmlPath = path.join(context.extensionPath, 'resources', 'collection_manager.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const csp = `default-src 'none'; script-src 'unsafe-inline' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource};`;
  html = html.replace(/\{\{CSP\}\}/g, csp);
  return html;
}

const COLLECTION_PANEL_PREFIX = 'collection-manager:';

export function createCollectionManagerPanel(
  context: vscode.ExtensionContext,
  collection: Collection,
  onRename: (c: Collection, name: string) => void,
  onEditInterface: (iface: Interface) => void,
  onDeleteInterface: (iface: Interface) => void | Promise<void>,
  onAddInterface: (c: Collection) => void | Promise<void>
): void {
  const panelId = COLLECTION_PANEL_PREFIX + collection.id;
  if (tryReveal(panelId)) return;

  const panel = vscode.window.createWebviewPanel(
    'vscode-http.collectionManager',
    `集合管理 - ${collection.name}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  registerPanel(panelId, panel);
  panel.webview.html = getHtml(context, panel.webview);

  const sendUpdate = () => {
    panel.webview.postMessage({
      type: 'update',
      collectionName: collection.name,
      interfaces: [...collection.children],
    });
    panel.title = `集合管理 - ${collection.name}`;
  };

  panel.webview.onDidReceiveMessage(
    async (msg) => {
      if (msg.type === 'updateCollectionName' && msg.name?.trim()) {
        onRename(collection, msg.name.trim());
        sendUpdate();
      } else if (msg.type === 'editInterface') {
        const iface = collection.children.find((i) => i.id === msg.ifaceId);
        if (iface) onEditInterface(iface);
      } else if (msg.type === 'addInterface') {
        await onAddInterface(collection);
        sendUpdate();
      } else if (msg.type === 'deleteInterface') {
        const iface = collection.children.find((i) => i.id === msg.ifaceId);
        if (iface) {
          await onDeleteInterface(iface);
          sendUpdate();
        }
      }
    },
    undefined,
    context.subscriptions
  );

  panel.webview.postMessage({
    type: 'init',
    collectionId: collection.id,
    collectionName: collection.name,
    interfaces: [...collection.children],
  });
}
