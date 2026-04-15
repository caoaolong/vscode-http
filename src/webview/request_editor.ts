import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import WebSocket from "ws";
import type {
  Interface,
  Environment,
  RequestSnapshot,
  ResponseSnapshot,
} from "../models/types";
import { tryReveal, registerPanel } from "./panel_registry";

export type BodyType =
  | "form-data"
  | "x-www-form-urlencoded"
  | "json"
  | "xml"
  | "raw"
  | "binary"
  | "graphql";

export interface FormDataItem {
  key: string;
  value: string;
  type: "text" | "file";
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
  name?: string;
  auth?: import("../models/types").AuthConfig;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** 响应体类型：图片直接展示+下载，其他二进制仅下载 */
  bodyKind?: "text" | "image" | "binary";
  /** 二进制/图片时的 base64 内容 */
  bodyBase64?: string;
  /** 建议的文件名（来自 Content-Disposition 或根据类型生成） */
  suggestedFilename?: string;
  /** 二进制/图片时的字节数（便于前端显示） */
  bodyByteLength?: number;
  error?: string;
}

function getHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
): string {
  const htmlPath = path.join(
    context.extensionPath,
    "resources",
    "request_editor.html",
  );
  let html = fs.readFileSync(htmlPath, "utf8");
  const jsonEditorBase = vscode.Uri.file(
    path.join(context.extensionPath, "resources", "vendor"),
  );
  const jsonEditorJs = webview
    .asWebviewUri(vscode.Uri.joinPath(jsonEditorBase, "jsoneditor.min.js"))
    .toString();
  const jsonEditorCss = webview
    .asWebviewUri(vscode.Uri.joinPath(jsonEditorBase, "jsoneditor.min.css"))
    .toString();
  html = html.replace(/\{\{JSONEDITOR_JS_URI\}\}/g, jsonEditorJs);
  html = html.replace(/\{\{JSONEDITOR_CSS_URI\}\}/g, jsonEditorCss);
  const scriptSrcParts = ["'unsafe-inline'", webview.cspSource?.trim()].filter(
    (s) => s != null && s !== "",
  );
  const csp = [
    "default-src 'none'",
    `script-src ${scriptSrcParts.join(" ")}`,
    `style-src 'unsafe-inline' ${webview.cspSource ?? ""}`,
    `font-src ${webview.cspSource ?? ""}`,
    `img-src data: ${webview.cspSource ?? ""}`,
    "worker-src blob:",
    "connect-src https: http: wss: ws:;",
  ].join("; ");
  html = html.replace(/\{\{CSP\}\}/g, csp);
  return html;
}

function buildRequestBody(data: RequestData): {
  body: Buffer;
  contentType?: string;
} {
  if (["GET", "HEAD"].includes(data.method)) return { body: Buffer.alloc(0) };

  switch (data.bodyType) {
    case "form-data": {
      const boundary = "----FormBoundary" + Date.now();
      const parts: Buffer[] = [];
      for (const item of data.formData || []) {
        if (!item.key) continue;
        parts.push(Buffer.from(`--${boundary}\r\n`));
        if (item.type === "file" && item.fileBase64) {
          parts.push(
            Buffer.from(
              `Content-Disposition: form-data; name="${item.key}"; filename="${item.fileName || "file"}"\r\n\r\n`,
            ),
          );
          parts.push(Buffer.from(item.fileBase64, "base64"));
        } else {
          parts.push(
            Buffer.from(
              `Content-Disposition: form-data; name="${item.key}"\r\n\r\n`,
            ),
          );
          parts.push(Buffer.from(item.value || "", "utf8"));
        }
        parts.push(Buffer.from("\r\n"));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      return {
        body: Buffer.concat(parts),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }
    case "x-www-form-urlencoded": {
      const params = new URLSearchParams();
      for (const item of data.formUrlEncoded || []) {
        if (item.key) params.append(item.key, item.value);
      }
      const body = params.toString();
      return {
        body: Buffer.from(body, "utf8"),
        contentType: "application/x-www-form-urlencoded",
      };
    }
    case "json":
      return {
        body: Buffer.from(data.body || "{}", "utf8"),
        contentType: "application/json",
      };
    case "xml":
      return {
        body: Buffer.from(data.body || "", "utf8"),
        contentType: "application/xml",
      };
    case "graphql":
      return {
        body: Buffer.from(data.body || "{}", "utf8"),
        contentType: "application/json",
      };
    case "raw":
      return {
        body: Buffer.from(data.body || "", "utf8"),
        contentType: "text/plain",
      };
    case "binary":
      return {
        body: data.binaryBase64
          ? Buffer.from(data.binaryBase64, "base64")
          : Buffer.alloc(0),
        contentType: "application/octet-stream",
      };
    default:
      return {
        body: Buffer.from(data.body || "", "utf8"),
        contentType: "application/json",
      };
  }
}

function getDebugOutputChannel(): vscode.OutputChannel {
  const name = "vscode-http";
  return vscode.window.createOutputChannel(name);
}

/** 在扩展侧发起 SSE 连接，将收到的 chunk 直接转发给前端显示；返回用于断开连接的 destroy 函数 */
function connectSSE(
  url: string,
  headers: Record<string, string>,
  postMessage: (msg: { type: string; [k: string]: unknown }) => void,
  method: string = "GET",
  body?: string,
): () => void {
  let destroyed = false;
  let req: http.ClientRequest | null = null;

  const destroy = () => {
    destroyed = true;
    if (req) {
      req.destroy();
      req = null;
    }
  };

  const reqMethod = (method || "GET").toUpperCase();

  try {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const reqHeaders = { ...headers };
    const bodyBuffer =
      reqMethod !== "GET" && reqMethod !== "HEAD" && body != null && body !== ""
        ? Buffer.from(body, "utf8")
        : Buffer.alloc(0);
    if (bodyBuffer.length > 0) {
      reqHeaders["Content-Length"] = String(bodyBuffer.length);
      if (!reqHeaders["Content-Type"])
        reqHeaders["Content-Type"] = "application/json";
    }
    const opts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: reqMethod,
      headers: Object.keys(reqHeaders).length > 0 ? reqHeaders : undefined,
    };

    req = lib.request(opts, (res) => {
      if (destroyed) return;
      postMessage({
        type: "sseStatus",
        status: res.statusCode ?? 0,
        statusText: res.statusMessage ?? "",
      });
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        if (destroyed) return;
        postMessage({ type: "sseEvent", data: chunk });
      });
      res.on("end", () => {
        if (destroyed) return;
        postMessage({ type: "sseEnd" });
      });
      res.on("error", (err) => {
        if (destroyed) return;
        postMessage({ type: "sseEnd", error: err.message });
      });
    });
    req.on("error", (err) => {
      if (destroyed) return;
      postMessage({ type: "sseEnd", error: err.message });
    });
    req.write(bodyBuffer);
    req.end();
  } catch (err) {
    postMessage({
      type: "sseEnd",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return destroy;
}

/** 在扩展侧建立 WebSocket 连接，通过 postMessage 向 webview 推送事件；返回 { close, send } */
function connectWebSocket(
  url: string,
  postMessage: (msg: { type: string; [k: string]: unknown }) => void,
): { close: () => void; send: (data: string) => void } {
  let ws: WebSocket | null = null;
  const close = () => {
    if (ws) {
      try {
        ws.removeAllListeners();
        ws.close();
      } catch {
        // ignore
      }
      ws = null;
    }
  };
  const send = (data: string) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  };
  try {
    ws = new WebSocket(url);
    ws.on("open", () => {
      postMessage({ type: "wsOpen" });
    });
    ws.on("message", (data: Buffer | string) => {
      const text =
        typeof data === "string" ? data : (data as Buffer).toString("utf8");
      postMessage({ type: "wsMessage", data: text });
    });
    ws.on("close", () => {
      ws = null;
      postMessage({ type: "wsEnd" });
    });
    ws.on("error", (err: Error) => {
      postMessage({ type: "wsEnd", error: err.message });
    });
  } catch (err) {
    postMessage({
      type: "wsEnd",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { close, send };
}

function getHeader(headers: Record<string, string>, name: string): string {
  const lower = name.toLowerCase();
  const entry = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === lower,
  );
  return entry ? entry[1] : "";
}

function parseSuggestedFilename(
  contentDisposition: string,
  contentType: string,
): string | null {
  if (!contentDisposition) return null;
  const match =
    contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i) ||
    contentDisposition.match(/filename=["']?([^"';]+)["']?/i);
  if (match && match[1]) return match[1].trim();
  return null;
}

const IMAGE_TYPES = /^image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml|x-icon|ico)$/i;
const TEXT_TYPES =
  /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql))/i;

function classifyResponseBody(
  buf: Buffer,
  contentType: string,
): {
  body: string;
  bodyKind: "text" | "image" | "binary";
  bodyBase64?: string;
} {
  const base64 = buf.toString("base64");
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (IMAGE_TYPES.test(type)) {
    return { body: "", bodyKind: "image", bodyBase64: base64 };
  }
  if (TEXT_TYPES.test(type) || type === "application/javascript") {
    try {
      const body = buf.toString("utf8");
      return { body, bodyKind: "text" };
    } catch {
      return { body: "", bodyKind: "binary", bodyBase64: base64 };
    }
  }
  return { body: "", bodyKind: "binary", bodyBase64: base64 };
}

function defaultImageFilename(contentType: string): string {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/png": "image.png",
    "image/jpeg": "image.jpg",
    "image/jpg": "image.jpg",
    "image/gif": "image.gif",
    "image/webp": "image.webp",
    "image/bmp": "image.bmp",
    "image/svg+xml": "image.svg",
    "image/x-icon": "image.ico",
  };
  return map[type] || "image.png";
}

function defaultBinaryFilename(_contentType: string): string {
  return "download.bin";
}

async function sendHttpRequest(data: RequestData): Promise<ResponseData> {
  return new Promise((resolve) => {
    try {
      const url = new URL(data.url);
      const isHttps = url.protocol === "https:";
      const lib = isHttps ? https : http;

      const { body, contentType } = buildRequestBody(data);
      const headers: Record<string, string> = { ...data.headers };
      if (body.length > 0) {
        if (contentType && !headers["Content-Type"])
          headers["Content-Type"] = contentType;
        headers["Content-Length"] = String(body.length);
      }

      // 调试日志：最终请求地址与请求体
      const out = getDebugOutputChannel();
      out.appendLine(`[HTTP] ${data.method} ${data.url}`);
      if (body.length > 0) {
        if (data.bodyType === "binary") {
          out.appendLine(`[HTTP] 请求体: (二进制, ${body.length} 字节)`);
        } else {
          const maxLog = 2048;
          const bodyPreview =
            body.length <= maxLog
              ? body.toString("utf8")
              : body.toString("utf8", 0, maxLog) +
                `\n... (共 ${body.length} 字节，已截断)`;
          out.appendLine("[HTTP] 请求体:");
          out.appendLine(bodyPreview);
        }
      } else {
        out.appendLine("[HTTP] 请求体: (无)");
      }
      out.appendLine("");

      const opts: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: data.method,
        headers,
      };

      const req = lib.request(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const resHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") resHeaders[k] = v;
          }
          const contentType = getHeader(resHeaders, "content-type");
          const contentDisposition = getHeader(
            resHeaders,
            "content-disposition",
          );
          let suggestedFilename = parseSuggestedFilename(
            contentDisposition,
            contentType,
          );
          const { body, bodyKind, bodyBase64 } = classifyResponseBody(
            buf,
            contentType,
          );
          if (
            (bodyKind === "image" || bodyKind === "binary") &&
            !suggestedFilename
          ) {
            suggestedFilename =
              bodyKind === "image"
                ? defaultImageFilename(contentType)
                : defaultBinaryFilename(contentType);
          }
          const bodyByteLength =
            bodyKind === "image" || bodyKind === "binary"
              ? buf.length
              : undefined;
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? "",
            headers: resHeaders,
            body,
            bodyKind,
            bodyBase64,
            suggestedFilename: suggestedFilename || undefined,
            bodyByteLength,
          });
        });
      });
      req.on("error", (err) => {
        resolve({
          status: 0,
          statusText: "",
          headers: {},
          body: "",
          error: err.message,
        });
      });
      req.write(body);
      req.end();
    } catch (err: unknown) {
      resolve({
        status: 0,
        statusText: "",
        headers: {},
        body: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

const REQUEST_PANEL_PREFIX = "request-editor:";

export function createRequestEditorPanel(
  context: vscode.ExtensionContext,
  iface: Interface,
  baseUrl: string | undefined,
  pathFromUrl: string,
  environments: Environment[],
  currentEnvId: string | undefined,
  project: { id: string },
  onSave: (iface: Interface, data: RequestData) => void,
  onEnvChange: (projectId: string, envId: string) => void,
  onSaveAsInstance?: (
    iface: Interface,
    name: string,
    requestSnapshot: RequestSnapshot,
    responseSnapshot: ResponseSnapshot,
  ) => void,
): void {
  const panelId = REQUEST_PANEL_PREFIX + iface.id;
  if (tryReveal(panelId)) return;

  const title = iface.name;
  const panel = vscode.window.createWebviewPanel(
    "vscode-http.requestEditor",
    title,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    },
  );

  registerPanel(panelId, panel);
  panel.webview.html = getHtml(context, panel.webview);

  let sseDestroy: (() => void) | null = null;
  let wsHandle: { close: () => void; send: (data: string) => void } | null =
    null;

  panel.webview.onDidReceiveMessage(
    (msg) => {
      try {
        if (msg.type === "setCurrentEnvironment") {
          onEnvChange(project.id, msg.envId);
        } else if (msg.type === "connectSSE") {
          if (sseDestroy) {
            sseDestroy();
            sseDestroy = null;
          }
          sseDestroy = connectSSE(
            msg.url as string,
            (msg.headers as Record<string, string>) || {},
            (m) => panel.webview.postMessage(m),
            (msg.method as string) || "GET",
            msg.body as string | undefined,
          );
        } else if (msg.type === "disconnectSSE") {
          if (sseDestroy) {
            sseDestroy();
            sseDestroy = null;
            panel.webview.postMessage({ type: "sseEnd" });
          }
        } else if (msg.type === "connectWS") {
          if (wsHandle) {
            wsHandle.close();
            wsHandle = null;
          }
          const url = msg.url as string;
          if (url) {
            wsHandle = connectWebSocket(url, (m) =>
              panel.webview.postMessage(m),
            );
          }
        } else if (msg.type === "disconnectWS") {
          if (wsHandle) {
            wsHandle.close();
            wsHandle = null;
            panel.webview.postMessage({ type: "wsEnd" });
          }
        } else if (msg.type === "sendWS") {
          if (wsHandle && msg.data !== undefined) {
            wsHandle.send(String(msg.data));
          }
        } else if (msg.type === "pickImageForJsonBody") {
          const encoding =
            (msg.encoding as string) === "raw" ? "raw" : "dataUrl";
          void vscode.window
            .showOpenDialog({
              canSelectMany: false,
              openLabel: "插入到请求体",
              filters: {
                图像: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
              },
            })
            .then((uris) => {
              if (!uris || !uris[0]) return;
              try {
                const buf = fs.readFileSync(uris[0].fsPath);
                const b64 = buf.toString("base64");
                const ext = path.extname(uris[0].fsPath).toLowerCase();
                const mimeByExt: Record<string, string> = {
                  ".png": "image/png",
                  ".jpg": "image/jpeg",
                  ".jpeg": "image/jpeg",
                  ".gif": "image/gif",
                  ".webp": "image/webp",
                  ".bmp": "image/bmp",
                  ".svg": "image/svg+xml",
                };
                const mime = mimeByExt[ext] || "application/octet-stream";
                const value =
                  encoding === "raw"
                    ? b64
                    : `data:${mime};base64,${b64}`;
                panel.webview.postMessage({
                  type: "jsonImageFieldValue",
                  value,
                });
              } catch (e) {
                panel.webview.postMessage({
                  type: "jsonImageFieldValue",
                  error:
                    e instanceof Error ? e.message : String(e),
                });
              }
            });
        } else if (msg.type === "sendRequest") {
          sendHttpRequest({
            url: msg.url,
            method: msg.method,
            headers: msg.headers || {},
            bodyType: msg.bodyType || "json",
            body: msg.body || "",
            formData: msg.formData,
            formUrlEncoded: msg.formUrlEncoded,
            binaryBase64: msg.binaryBase64,
          })
            .then((result: ResponseData) => {
              panel.webview.postMessage({ type: "response", ...result });
            })
            .catch((err: unknown) => {
              panel.webview.postMessage({
                type: "response",
                status: 0,
                statusText: "",
                headers: {} as Record<string, string>,
                body: "",
                error: err instanceof Error ? err.message : String(err),
              });
            });
        } else if (msg.type === "downloadResponse") {
          const base64 = msg.bodyBase64 as string | undefined;
          const suggestedFilename =
            (msg.suggestedFilename as string) || "download.bin";
          if (!base64) {
            vscode.window.showWarningMessage("无内容可下载");
            return;
          }
          vscode.window
            .showSaveDialog({
              defaultUri: vscode.Uri.file(suggestedFilename),
              saveLabel: "保存",
            })
            .then((uri) => {
              if (!uri) return;
              try {
                const buf = Buffer.from(base64, "base64");
                fs.writeFileSync(uri.fsPath, buf);
              } catch (e) {
                vscode.window.showErrorMessage(
                  "保存失败: " + (e instanceof Error ? e.message : String(e)),
                );
              }
            });
        } else if (msg.type === "saveRequest") {
          const data: RequestData = {
            url: msg.url,
            method: msg.method,
            headers: msg.headers || {},
            bodyType: msg.bodyType || "json",
            body: msg.body || "",
            formData: msg.formData,
            formUrlEncoded: msg.formUrlEncoded,
            binaryBase64: msg.binaryBase64,
            name: msg.name,
            auth: msg.auth,
          };
          onSave(iface, data);
        } else if (msg.type === "saveAsInstance" && onSaveAsInstance) {
          const rawReq = msg.requestPayload as RequestData | undefined;
          const rawRes = msg.responsePayload as ResponseData | undefined;
          if (!rawReq || !rawRes) {
            vscode.window.showWarningMessage("缺少请求或响应数据");
            return;
          }
          vscode.window
            .showInputBox({
              prompt: "输入本实例的名称",
              placeHolder: "例如：成功响应示例、测试用例",
            })
            .then((name) => {
              if (name === undefined) return;
              const requestSnapshot: RequestSnapshot = {
                url: rawReq.url,
                method: rawReq.method,
                headers: rawReq.headers,
                bodyType: rawReq.bodyType,
                body: rawReq.body,
                formData: rawReq.formData,
                formUrlEncoded: rawReq.formUrlEncoded,
                binaryBase64: rawReq.binaryBase64,
                auth: rawReq.auth,
              };
              const responseSnapshot: ResponseSnapshot = {
                status: rawRes.status,
                statusText: rawRes.statusText,
                headers: rawRes.headers,
                body: rawRes.body,
                bodyKind: rawRes.bodyKind,
                bodyBase64: rawRes.bodyBase64,
                suggestedFilename: rawRes.suggestedFilename,
                error: rawRes.error,
              };
              onSaveAsInstance(
                iface,
                name.trim(),
                requestSnapshot,
                responseSnapshot,
              );
            });
        }
      } catch (err) {
        const errorResult = {
          status: 0,
          statusText: "",
          headers: {} as Record<string, string>,
          body: "",
          error: err instanceof Error ? err.message : String(err),
        };
        panel.webview.postMessage({ type: "response", ...errorResult });
      }
    },
    undefined,
    context.subscriptions,
  );

  const getMonacoTheme = () => {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === 1
      ? "vs"
      : kind === 3 || kind === 4
        ? "hc-black"
        : "vs-dark";
  };

  panel.webview.postMessage({
    type: "init",
    theme: getMonacoTheme(),
    interfaceType: iface.interfaceType || "http",
    name: iface.name || "",
    baseUrl: baseUrl ?? "",
    path: pathFromUrl,
    environments,
    currentEnvId: currentEnvId ?? "",
    method: iface.method || "GET",
    headers: iface.headers || {},
    bodyType: iface.bodyType || "json",
    body: iface.requestBody || "",
    formData: iface.formData || [],
    formUrlEncoded: iface.formUrlEncoded || [],
    binaryBase64: iface.binaryBase64 || "",
    auth: iface.auth,
  });

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      panel.webview.postMessage({ type: "theme", theme: getMonacoTheme() });
    }),
  );
}
