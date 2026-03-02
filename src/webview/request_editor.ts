import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import type { Interface, Environment } from '../models/types';
import { tryReveal, registerPanel } from './panel_registry';

export type BodyType = 'form-data' | 'x-www-form-urlencoded' | 'json' | 'xml' | 'raw' | 'binary' | 'graphql';

export interface FormDataItem {
  key: string;
  value: string;
  type: 'text' | 'file';
  fileName?: string;
  fileBase64?: string;
}

export interface RequestData {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyType: BodyType;
  body: string;
  formData?: FormDataItem[];
  formUrlEncoded?: Array<{ key: string; value: string }>;
  binaryBase64?: string;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

function getHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const htmlPath = path.join(context.extensionPath, 'resources', 'request_editor.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const monacoUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'monaco-editor', 'min'));
  html = html.replace(/\{\{MONACO_URI\}\}/g, monacoUri.toString());
  const monacoSrc = monacoUri.toString().replace(/\/$/, '');
  const csp = `default-src 'none'; script-src 'unsafe-inline' ${webview.cspSource} ${monacoSrc}; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource}; img-src data: ${webview.cspSource}; worker-src blob:; connect-src 'none';`;
  html = html.replace(/\{\{CSP\}\}/g, csp);
  return html;
}

function buildRequestBody(data: RequestData): { body: Buffer; contentType?: string } {
  if (['GET', 'HEAD'].includes(data.method)) return { body: Buffer.alloc(0) };

  switch (data.bodyType) {
    case 'form-data': {
      const boundary = '----FormBoundary' + Date.now();
      const parts: Buffer[] = [];
      for (const item of data.formData || []) {
        if (!item.key) continue;
        parts.push(Buffer.from(`--${boundary}\r\n`));
        if (item.type === 'file' && item.fileBase64) {
          parts.push(Buffer.from(`Content-Disposition: form-data; name="${item.key}"; filename="${item.fileName || 'file'}"\r\n\r\n`));
          parts.push(Buffer.from(item.fileBase64, 'base64'));
        } else {
          parts.push(Buffer.from(`Content-Disposition: form-data; name="${item.key}"\r\n\r\n`));
          parts.push(Buffer.from(item.value || '', 'utf8'));
        }
        parts.push(Buffer.from('\r\n'));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
    }
    case 'x-www-form-urlencoded': {
      const params = new URLSearchParams();
      for (const item of data.formUrlEncoded || []) {
        if (item.key) params.append(item.key, item.value);
      }
      const body = params.toString();
      return { body: Buffer.from(body, 'utf8'), contentType: 'application/x-www-form-urlencoded' };
    }
    case 'json':
      return { body: Buffer.from(data.body || '{}', 'utf8'), contentType: 'application/json' };
    case 'xml':
      return { body: Buffer.from(data.body || '', 'utf8'), contentType: 'application/xml' };
    case 'graphql':
      return { body: Buffer.from(data.body || '{}', 'utf8'), contentType: 'application/json' };
    case 'raw':
      return { body: Buffer.from(data.body || '', 'utf8'), contentType: 'text/plain' };
    case 'binary':
      return { body: data.binaryBase64 ? Buffer.from(data.binaryBase64, 'base64') : Buffer.alloc(0), contentType: 'application/octet-stream' };
    default:
      return { body: Buffer.from(data.body || '', 'utf8'), contentType: 'application/json' };
  }
}

async function sendHttpRequest(data: RequestData): Promise<ResponseData> {
  return new Promise((resolve) => {
    try {
      const url = new URL(data.url);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const { body, contentType } = buildRequestBody(data);
      const headers: Record<string, string> = { ...data.headers };
      if (body.length > 0) {
        if (contentType && !headers['Content-Type']) headers['Content-Type'] = contentType;
        headers['Content-Length'] = String(body.length);
      }

      const opts: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: data.method,
        headers,
      };

      const req = lib.request(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const resHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') resHeaders[k] = v;
          }
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: resHeaders,
            body: raw,
          });
        });
      });
      req.on('error', (err) => {
        resolve({
          status: 0,
          statusText: '',
          headers: {},
          body: '',
          error: err.message,
        });
      });
      req.write(body);
      req.end();
    } catch (err: unknown) {
      resolve({
        status: 0,
        statusText: '',
        headers: {},
        body: '',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

const REQUEST_PANEL_PREFIX = 'request-editor:';

export function createRequestEditorPanel(
  context: vscode.ExtensionContext,
  iface: Interface,
  baseUrl: string | undefined,
  pathFromUrl: string,
  environments: Environment[],
  currentEnvId: string | undefined,
  project: { id: string },
  onSave: (iface: Interface, data: RequestData) => void,
  onEnvChange: (projectId: string, envId: string) => void
): void {
  const panelId = REQUEST_PANEL_PREFIX + iface.id;
  if (tryReveal(panelId)) return;

  const title = iface.name;
  const panel = vscode.window.createWebviewPanel('vscode-http.requestEditor', title, vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'monaco-editor')],
  });

  registerPanel(panelId, panel);
  panel.webview.html = getHtml(context, panel.webview);

  panel.webview.onDidReceiveMessage(
    async (msg) => {
      if (msg.type === 'setCurrentEnvironment') {
        onEnvChange(project.id, msg.envId);
      } else if (msg.type === 'sendRequest') {
        const result = await sendHttpRequest({
          url: msg.url,
          method: msg.method,
          headers: msg.headers || {},
          bodyType: msg.bodyType || 'json',
          body: msg.body || '',
          formData: msg.formData,
          formUrlEncoded: msg.formUrlEncoded,
          binaryBase64: msg.binaryBase64,
        });
        panel.webview.postMessage({ type: 'response', ...result });
      } else if (msg.type === 'saveRequest') {
        const data: RequestData = {
          url: msg.url,
          method: msg.method,
          headers: msg.headers || {},
          bodyType: msg.bodyType || 'json',
          body: msg.body || '',
          formData: msg.formData,
          formUrlEncoded: msg.formUrlEncoded,
          binaryBase64: msg.binaryBase64,
        };
        onSave(iface, data);
        vscode.window.showInformationMessage('已保存');
      }
    },
    undefined,
    context.subscriptions
  );

  const getMonacoTheme = () => {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === 1 ? 'vs' : kind === 3 || kind === 4 ? 'hc-black' : 'vs-dark';
  };

  panel.webview.postMessage({
    type: 'init',
    theme: getMonacoTheme(),
    baseUrl: baseUrl ?? '',
    path: pathFromUrl,
    environments,
    currentEnvId: currentEnvId ?? '',
    method: iface.method || 'GET',
    headers: iface.headers || {},
    bodyType: iface.bodyType || 'json',
    body: iface.requestBody || '',
    formData: iface.formData || [],
    formUrlEncoded: iface.formUrlEncoded || [],
    binaryBase64: iface.binaryBase64 || '',
  });

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      panel.webview.postMessage({ type: 'theme', theme: getMonacoTheme() });
    })
  );
}
