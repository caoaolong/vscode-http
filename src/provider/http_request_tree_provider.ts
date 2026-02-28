import * as vscode from 'vscode';
import type { Project, Collection, Interface } from '../models/types';

type TreeDataItem = Project | Collection | Interface | { type: 'requestBody'; parent: Interface } | { type: 'responseBody'; parent: Interface };

export class HttpRequestTreeProvider implements vscode.TreeDataProvider<TreeDataItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeDataItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projects: Project[] = [];
  private context: vscode.ExtensionContext;

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
      item.iconPath = new vscode.ThemeIcon('folder-library');
      item.tooltip = `项目: ${element.name}`;
      item.contextValue = 'project';
      return item;
    }

    if (this.isCollection(element)) {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('folder');
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
      item.description = element.url;
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
}
