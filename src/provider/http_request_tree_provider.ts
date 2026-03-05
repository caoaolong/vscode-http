import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { Project, Collection, Interface, Environment, Instance, RequestSnapshot, ResponseSnapshot } from '../models/types';

const STORAGE_DIR = '.vscode-http';
const PROJECTS_INDEX = 'projects.json';

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'project';
}

type TreeDataItem = Project | Collection | Interface | Instance;

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** 从完整 url 中提取路径（去掉 baseUrl 前缀），保留 query 参数 */
function getPathFromUrl(url: string, baseUrl?: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname || '/';
    const search = u.search || '';
    if (baseUrl) {
      const base = normalizeUrl(baseUrl);
      const basePath = new URL(base).pathname.replace(/\/+$/, '');
      if (basePath && basePath !== '/') {
        if (path === basePath || path.startsWith(basePath + '/')) {
          const pathOnly = path === basePath ? '/' : path.slice(basePath.length) || '/';
          return pathOnly + search;
        }
      }
    }
    return path + search;
  } catch {
    return url;
  }
}

/** 从完整 url 中仅提取路径（去掉 baseUrl 前缀与 query 参数），用于 Tree 展示 */
function getPathOnlyFromUrl(url: string, baseUrl?: string): string {
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

  private getStorageDir(): string | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? path.join(folder.uri.fsPath, STORAGE_DIR) : undefined;
  }

  private loadFromStorage() {
    const dir = this.getStorageDir();
    if (dir) {
      try {
        const indexPath = path.join(dir, PROJECTS_INDEX);
        if (fs.existsSync(indexPath)) {
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { projects: Array<{ id: string; name: string }> };
          this.projects = [];
          for (const p of index.projects || []) {
            const fileName = sanitizeFileName(p.name) + '.json';
            const filePath = path.join(dir, fileName);
            if (fs.existsSync(filePath)) {
              const project = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Project;
              this.projects.push(project);
            }
          }
        }
      } catch {
        this.projects = [];
      }
    }
    if (this.projects.length === 0) {
      const stored = this.context.globalState.get<Project[]>(this.storageKey);
      if (stored) {
        this.projects = stored;
        this.saveToStorage();
      } else {
        this.projects = [
          {
            id: 'proj-1',
            name: '示例项目',
            environments: [{ id: 'env-1', name: '开发', baseUrl: 'https://api.example.com' }],
            currentEnvId: 'env-1',
            children: [
              {
                id: 'coll-1',
                name: '用户相关',
                parentId: 'proj-1',
                children: [
                  { id: 'api-1', name: '获取用户列表', url: 'https://api.example.com/users', method: 'GET', parentId: 'coll-1', requestBody: undefined, instances: [] },
                  { id: 'api-2', name: '创建用户', url: 'https://api.example.com/users', method: 'POST', parentId: 'coll-1', requestBody: '{"name": "", "email": ""}', instances: [] },
                ],
              },
              { id: 'api-3', name: '健康检查', url: 'https://api.example.com/health', method: 'GET', parentId: 'proj-1', requestBody: undefined, instances: [] },
            ],
          },
        ];
        this.saveToStorage();
      }
    }
  }

  private saveToStorage() {
    const dir = this.getStorageDir();
    if (dir) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const index = { projects: this.projects.map((p) => ({ id: p.id, name: p.name })) };
        fs.writeFileSync(path.join(dir, PROJECTS_INDEX), JSON.stringify(index, null, 2), 'utf8');
        for (const project of this.projects) {
          const fileName = sanitizeFileName(project.name) + '.json';
          fs.writeFileSync(path.join(dir, fileName), JSON.stringify(project, null, 2), 'utf8');
        }
      } catch (e) {
        console.error('vscode-http save failed:', e);
      }
    }
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
      item.command = { command: 'vscode-http.manageEnvironments', arguments: [element.id], title: '环境管理' };
      return item;
    }

    if (this.isCollection(element)) {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = element.id;
      item.iconPath = new vscode.ThemeIcon('folder');
      item.description = `${element.children.length} 个请求`;
      item.tooltip = `集合: ${element.name}`;
      item.contextValue = 'collection';
      item.command = { command: 'vscode-http.manageCollection', arguments: [element.id], title: '管理集合' };
      return item;
    }

    if (this.isInterface(element)) {
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.id = element.id;
      item.iconPath = new vscode.ThemeIcon('globe');
      const project = this.getProjectForItem(element);
      const baseUrl = project ? this.getCurrentBaseUrl(project) : undefined;
      const pathOnly = getPathOnlyFromUrl(element.url, baseUrl);
      item.description = `${element.method || 'GET'} ${pathOnly}`;
      item.tooltip = `${element.method || 'GET'} ${element.url}`;
      item.contextValue = 'interface';
      return item;
    }

    if (this.isInstance(element)) {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
      item.id = element.id;
      item.iconPath = new vscode.ThemeIcon('save');
      const res = element.responseSnapshot;
      const status = res?.status;
      const tip = status != null ? `${element.name} · ${status} ${res?.statusText || ''}` : element.name;
      item.tooltip = tip;
      item.description = status != null ? `${status}` : '';
      item.contextValue = 'instance';
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
      return (element.instances ?? []) as TreeDataItem[];
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
    return 'parentId' in item && 'url' in item && !('children' in item) && !('requestSnapshot' in item);
  }

  private isInstance(item: TreeDataItem): item is Instance {
    return 'requestSnapshot' in item && 'responseSnapshot' in item && 'parentId' in item;
  }

  getProjects(): Project[] {
    return this.projects;
  }

  /** 获取接口所属项目的当前环境 baseUrl */
  getBaseUrlForInterface(iface: Interface): string | undefined {
    const project = this.getProjectForItem(iface);
    return project ? this.getCurrentBaseUrl(project) : undefined;
  }

  /** 获取接口所属项目 */
  getProjectForInterface(iface: Interface): Project | undefined {
    return this.getProjectForItem(iface);
  }

  /** 获取接口所属项目的环境列表、当前环境 id，供编辑器下拉选择 */
  getEnvironmentsForInterface(iface: Interface): { environments: Environment[]; currentEnvId?: string } {
    const project = this.getProjectForItem(iface);
    const envs = project?.environments ?? [];
    return { environments: envs, currentEnvId: project?.currentEnvId };
  }

  /** 从完整 url 中提取路径部分（去除 baseUrl 前缀），供编辑器使用 */
  getPathFromFullUrl(url: string, baseUrl?: string): string {
    return getPathFromUrl(url, baseUrl);
  }

  getInterfaceById(id: string): Interface | undefined {
    for (const p of this.projects) {
      for (const c of p.children) {
        if (this.isInterface(c)) {
          if (c.id === id) return c;
        } else {
          const found = (c as Collection).children.find((i) => i.id === id);
          if (found) return found;
        }
      }
    }
    return undefined;
  }

  getCollectionById(id: string): Collection | undefined {
    for (const p of this.projects) {
      const col = p.children.find((c) => 'children' in c && (c as Collection).id === id) as Collection | undefined;
      if (col) return col;
    }
    return undefined;
  }

  async createCollection(project: Project): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: '输入集合名称',
      placeHolder: '例如：用户相关、订单相关',
    });
    if (!name?.trim()) return;
    const coll: Collection = {
      id: `coll-${Date.now()}`,
      name: name.trim(),
      parentId: project.id,
      children: [],
    };
    project.children.push(coll);
    this.saveToStorage();
    this.refresh();
    vscode.window.showInformationMessage('已创建集合');
  }

  async deleteCollection(collection: Collection): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `确定删除集合「${collection.name}」？将同时删除其下所有接口。`,
      '删除',
      '取消'
    );
    if (confirm !== '删除') return;
    const project = this.getProjectForItem(collection);
    if (!project) return;
    const idx = project.children.findIndex((c) => 'children' in c && (c as Collection).id === collection.id);
    if (idx >= 0) {
      project.children.splice(idx, 1);
      this.saveToStorage();
      this.refresh();
      vscode.window.showInformationMessage('已删除集合');
    }
  }

  renameCollectionSync(collection: Collection, name: string): void {
    if (!name?.trim()) return;
    collection.name = name.trim();
    this.saveToStorage();
    this.refresh();
  }

  async createInterface(collection: Collection): Promise<Interface | undefined> {
    const project = this.getProjectForItem(collection);
    const baseUrl = project ? this.getCurrentBaseUrl(project) : undefined;
    const name = await vscode.window.showInputBox({ prompt: '输入接口名称', placeHolder: '例如：获取用户信息' });
    if (!name?.trim()) return undefined;
    const pathInput = await vscode.window.showInputBox({
      prompt: '输入路径',
      placeHolder: baseUrl ? '/users 或 /api/users/1' : 'https://api.example.com/users',
      value: '/',
    });
    if (pathInput === undefined) return undefined;
    const path = (pathInput ?? '/').trim();
    const method = await vscode.window.showQuickPick(
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      { placeHolder: '选择请求方法', canPickMany: false }
    );
    if (!method) return undefined;
    const fullUrl = baseUrl
      ? (baseUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path))
      : path.startsWith('http') ? path : 'https://api.example.com' + (path.startsWith('/') ? path : '/' + path);
    const iface: Interface = {
      id: `api-${Date.now()}`,
      name: name.trim(),
      url: fullUrl,
      method,
      parentId: collection.id,
    };
    collection.children.push(iface);
    this.saveToStorage();
    this.refresh();
    vscode.window.showInformationMessage('已创建接口');
    return iface;
  }

  async deleteInterface(iface: Interface): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(`确定删除接口「${iface.name}」？`, '删除', '取消');
    if (confirm !== '删除') return;
    const project = this.getProjectForItem(iface);
    if (!project) return;
    if (iface.parentId === project.id) {
      const idx = project.children.findIndex((c) => !('children' in c) && (c as Interface).id === iface.id);
      if (idx >= 0) {
        project.children.splice(idx, 1);
        this.saveToStorage();
        this.refresh();
        // vscode.window.showInformationMessage('已删除接口');
      }
    } else {
      const collection = project.children.find((c) => 'children' in c && (c as Collection).id === iface.parentId) as Collection | undefined;
      if (!collection) return;
      const idx = collection.children.findIndex((i) => i.id === iface.id);
      if (idx >= 0) {
        collection.children.splice(idx, 1);
        this.saveToStorage();
        this.refresh();
        // vscode.window.showInformationMessage('已删除接口');
      }
    }
  }

  renameProjectSync(project: Project, name: string): void {
    if (!name?.trim()) return;
    project.name = name.trim();
    this.saveToStorage();
    this.refresh();
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

  updateEnvironment(project: Project, envId: string, data: { name: string; baseUrl: string }): void {
    const env = (project.environments ?? []).find((e) => e.id === envId);
    if (!env) return;
    if (data.name) env.name = data.name;
    if (data.baseUrl !== undefined) env.baseUrl = data.baseUrl.replace(/\/+$/, '');
    this.saveToStorage();
    this.refresh();
  }

  async deleteEnvironment(project: Project, envId: string): Promise<void> {
    const env = (project.environments ?? []).find((e) => e.id === envId);
    if (!env) return;
    const confirm = await vscode.window.showWarningMessage(`确定删除环境「${env.name}」？`, '删除', '取消');
    if (confirm !== '删除') return;
    const envs = project.environments ?? [];
    const idx = envs.findIndex((e) => e.id === envId);
    if (idx < 0) return;
    envs.splice(idx, 1);
    if (project.currentEnvId === envId) {
      project.currentEnvId = envs[0]?.id ?? undefined;
    }
    this.saveToStorage();
    this.refresh();
    // vscode.window.showInformationMessage('已删除');
  }

  updateInterface(iface: Interface, data: {
    url: string; method?: string; headers?: Record<string, string>;
    requestBody?: string; bodyType?: import('../models/types').BodyType;
    formData?: import('../models/types').FormDataItem[];
    formUrlEncoded?: Array<{ key: string; value: string }>;
    binaryBase64?: string;
    name?: string;
    auth?: import('../models/types').AuthConfig;
  }): void {
    iface.url = data.url;
    if (data.method) iface.method = data.method;
    if (data.name !== undefined) iface.name = data.name;
    if (data.auth !== undefined) iface.auth = data.auth;
    if (data.headers !== undefined) iface.headers = data.headers;
    if (data.requestBody !== undefined) iface.requestBody = data.requestBody;
    if (data.bodyType !== undefined) iface.bodyType = data.bodyType;
    if (data.formData !== undefined) iface.formData = data.formData;
    if (data.formUrlEncoded !== undefined) iface.formUrlEncoded = data.formUrlEncoded;
    if (data.binaryBase64 !== undefined) iface.binaryBase64 = data.binaryBase64;
    this.saveToStorage();
    this.refresh();
  }

  /** 将一次请求保存为实例（由请求编辑器「保存为实例」调用） */
  addInstance(iface: Interface, name: string, requestSnapshot: RequestSnapshot, responseSnapshot: ResponseSnapshot): void {
    if (!iface.instances) iface.instances = [];
    const instance: Instance = {
      id: `inst-${Date.now()}`,
      name: name.trim() || `实例 ${iface.instances.length + 1}`,
      parentId: iface.id,
      requestSnapshot,
      responseSnapshot,
    };
    iface.instances.push(instance);
    this.saveToStorage();
    this.refresh();
    vscode.window.showInformationMessage(`已保存实例「${instance.name}」`);
  }

  getInstanceById(id: string): Instance | undefined {
    for (const p of this.projects) {
      for (const c of p.children) {
        if (this.isInterface(c)) {
          const found = (c.instances ?? []).find((inst) => inst.id === id);
          if (found) return found;
        } else {
          for (const i of (c as Collection).children) {
            const found = (i.instances ?? []).find((inst) => inst.id === id);
            if (found) return found;
          }
        }
      }
    }
    return undefined;
  }

  /** 获取实例所属的 Interface */
  getInterfaceForInstance(instance: Instance): Interface | undefined {
    return this.getInterfaceById(instance.parentId);
  }

  async deleteInstance(instance: Instance): Promise<void> {
    const iface = this.getInterfaceForInstance(instance);
    if (!iface) return;
    const confirm = await vscode.window.showWarningMessage(
      `确定删除实例「${instance.name}」？`,
      '删除',
      '取消'
    );
    if (confirm !== '删除') return;
    const list = iface.instances ?? [];
    const idx = list.findIndex((inst) => inst.id === instance.id);
    if (idx >= 0) {
      list.splice(idx, 1);
      this.saveToStorage();
      this.refresh();
      vscode.window.showInformationMessage('已删除实例');
    }
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

  /** 由请求编辑器调用：切换项目的当前环境 */
  setCurrentEnvironmentById(project: Project, envId: string): void {
    const envs = project.environments ?? [];
    if (envs.some((e) => e.id === envId)) {
      project.currentEnvId = envId;
      this.saveToStorage();
      this.refresh();
    }
  }
}
