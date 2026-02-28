import * as vscode from 'vscode';
import type { Project, Collection, Interface, Environment } from '../models/types';

type TreeDataItem = Project | Collection | Interface | { type: 'requestBody'; parent: Interface } | { type: 'responseBody'; parent: Interface };

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** 从完整 url 中提取路径（去掉 baseUrl 前缀） */
function getPathFromUrl(url: string, baseUrl?: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname || '/';
    if (baseUrl) {
      const base = normalizeUrl(baseUrl);
      const basePath = new URL(base).pathname.replace(/\/+$/, '');
      if (basePath && basePath !== '/') {
        if (path === basePath || path.startsWith(basePath + '/')) {
          return path === basePath ? '/' : path.slice(basePath.length) || '/';
        }
      }
    }
    return path;
  } catch {
    return url;
  }
}

export class HttpRequestTreeProvider implements vscode.TreeDataProvider<TreeDataItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeDataItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projects: Project[] = [];
  private context: vscode.ExtensionContext;

  private getProjectById(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id);
  }

  private getProjectForItem(item: Collection | Interface): Project | undefined {
    const parentId = item.parentId;
    const project = this.getProjectById(parentId);
    if (project) return project;
    for (const p of this.projects) {
      const col = p.children.find((c) => 'children' in c && (c as Collection).id === parentId) as Collection | undefined;
      if (col) return p;
    }
    return undefined;
  }

  private getCurrentBaseUrl(project: Project): string | undefined {
    const envs = project.environments ?? [];
    const current = project.currentEnvId ? envs.find((e) => e.id === project.currentEnvId) : envs[0];
    return current?.baseUrl;
  }

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadFromStorage();
  }

  private get storageKey() {
    return 'vscode-http.savedRequests';
  }

  private loadFromStorage() {
    const stored = this.context.globalState.get<Project[]>(this.storageKey);
    if (stored) {
      this.projects = stored;
    } else {
      // 默认示例数据，便于展示层级
      this.projects = [
        {
          id: 'proj-1',
          name: '示例项目',
          environments: [
            { id: 'env-1', name: '开发', baseUrl: 'https://api.example.com' },
          ],
          currentEnvId: 'env-1',
          children: [
            {
              id: 'coll-1',
              name: '用户相关',
              parentId: 'proj-1',
              children: [
                {
                  id: 'api-1',
                  name: '获取用户列表',
                  url: 'https://api.example.com/users',
                  method: 'GET',
                  parentId: 'coll-1',
                  requestBody: undefined,
                  responseBody: '[]',
                },
                {
                  id: 'api-2',
                  name: '创建用户',
                  url: 'https://api.example.com/users',
                  method: 'POST',
                  parentId: 'coll-1',
                  requestBody: '{"name": "", "email": ""}',
                  responseBody: undefined,
                },
              ],
            },
            {
              id: 'api-3',
              name: '健康检查',
              url: 'https://api.example.com/health',
              method: 'GET',
              parentId: 'proj-1',
              requestBody: undefined,
              responseBody: '{"status": "ok"}',
            },
          ],
        },
      ];
      this.saveToStorage();
    }
  }

  private saveToStorage() {
    this.context.globalState.update(this.storageKey, this.projects);
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeDataItem): vscode.TreeItem {
    if (this.isProject(element)) {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = element.id;
      item.iconPath = new vscode.ThemeIcon('folder-library');
      const baseUrl = this.getCurrentBaseUrl(element);
      item.description = baseUrl ?? '';
      item.tooltip = baseUrl ? `当前环境: ${baseUrl}` : `项目: ${element.name}`;
      item.contextValue = 'project';
      return item;
    }

    if (this.isCollection(element)) {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('folder');
      item.description = `${element.children.length} 个请求`;
      item.tooltip = `集合: ${element.name}`;
      item.contextValue = 'collection';
      return item;
    }

    if (this.isInterface(element)) {
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.iconPath = new vscode.ThemeIcon('globe');
      const project = this.getProjectForItem(element);
      const baseUrl = project ? this.getCurrentBaseUrl(project) : undefined;
      item.description = getPathFromUrl(element.url, baseUrl);
      item.tooltip = `${element.method || 'GET'} ${element.url}`;
      item.contextValue = 'interface';
      return item;
    }

    if (element.type === 'requestBody') {
      const item = new vscode.TreeItem('请求体', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('edit');
      item.tooltip = element.parent.requestBody || '暂无请求体';
      item.contextValue = 'requestBody';
      return item;
    }

    if (element.type === 'responseBody') {
      const item = new vscode.TreeItem('响应体', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('output');
      item.tooltip = element.parent.responseBody || '暂无响应体';
      item.contextValue = 'responseBody';
      return item;
    }

    return new vscode.TreeItem('未知');
  }

  getChildren(element?: TreeDataItem): TreeDataItem[] {
    if (!element) {
      return this.projects;
    }

    if (this.isProject(element)) {
      return element.children;
    }

    if (this.isCollection(element)) {
      return element.children;
    }

    if (this.isInterface(element)) {
      const children: TreeDataItem[] = [];
      children.push({ type: 'requestBody', parent: element });
      children.push({ type: 'responseBody', parent: element });
      return children;
    }

    return [];
  }

  private isProject(item: TreeDataItem): item is Project {
    return 'children' in item && Array.isArray(item.children) && !('parentId' in item);
  }

  private isCollection(item: TreeDataItem): item is Collection {
    return 'parentId' in item && 'children' in item && Array.isArray(item.children);
  }

  private isInterface(item: TreeDataItem): item is Interface {
    return 'parentId' in item && 'url' in item && !('children' in item);
  }

  getProjects(): Project[] {
    return this.projects;
  }

  async addEnvironment(project: Project): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: '输入环境名称', placeHolder: '例如：开发、测试、生产' });
    if (!name?.trim()) return;
    const baseUrl = await vscode.window.showInputBox({ prompt: '输入 baseUrl', placeHolder: 'https://api.example.com' });
    if (!baseUrl?.trim()) return;
    const env: Environment = {
      id: `env-${Date.now()}`,
      name: name.trim(),
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
    };
    if (!project.environments) project.environments = [];
    project.environments.push(env);
    if (!project.currentEnvId) project.currentEnvId = env.id;
    this.saveToStorage();
    this.refresh();
  }

  async setCurrentEnvironment(project: Project): Promise<void> {
    const envs = project.environments ?? [];
    if (envs.length === 0) {
      vscode.window.showInformationMessage('请先添加环境');
      return;
    }
    const chosen = await vscode.window.showQuickPick(
      envs.map((e) => ({ label: e.name, description: e.baseUrl, env: e })),
      { placeHolder: '选择当前环境' }
    );
    if (!chosen) return;
    project.currentEnvId = chosen.env.id;
    this.saveToStorage();
    this.refresh();
  }
}
