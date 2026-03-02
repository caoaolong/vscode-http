import * as vscode from 'vscode';

const panels = new Map<string, vscode.WebviewPanel>();


/**
 * 若面板已存在则聚焦并返回 true；否则返回 false，由调用方创建新面板。
 */
export function tryReveal(panelId: string): boolean {
  const p = panels.get(panelId);
  if (p) {
    p.reveal(vscode.ViewColumn.One);
    return true;
  }
  return false;
}

/** 注册面板，关闭时自动从注册表移除 */
export function registerPanel(panelId: string, panel: vscode.WebviewPanel): void {
  panels.set(panelId, panel);
  panel.onDidDispose(() => panels.delete(panelId));
}
