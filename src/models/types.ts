/**
 * HTTP 请求树状结构的数据模型
 */

export type TreeNodeType = 'project' | 'collection' | 'interface' | 'instance';

/** 一次请求的请求参数快照 */
export interface RequestSnapshot {
  url: string;
  method: string;
  headers?: Record<string, string>;
  bodyType?: BodyType;
  body?: string;
  formData?: FormDataItem[];
  formUrlEncoded?: Array<{ key: string; value: string }>;
  binaryBase64?: string;
  queryParams?: Array<{ key: string; value: string }>;
  auth?: AuthConfig;
}

/** 一次请求的返回结果快照 */
export interface ResponseSnapshot {
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  body: string;
  error?: string;
}

/** 实例：保存某次请求的请求参数与返回结果 */
export interface Instance {
  id: string;
  name: string;
  parentId: string;
  requestSnapshot: RequestSnapshot;
  responseSnapshot: ResponseSnapshot;
}

export interface Environment {
  id: string;
  name: string;
  baseUrl: string;
}

export interface Project {
  id: string;
  name: string;
  children: (Collection | Interface)[];
  environments?: Environment[];
  currentEnvId?: string;
}

export interface Collection {
  id: string;
  name: string;
  parentId: string;
  children: Interface[];
}

export type BodyType = 'form-data' | 'x-www-form-urlencoded' | 'json' | 'xml' | 'raw' | 'binary' | 'graphql';

export interface FormDataItem {
  key: string;
  value: string;
  type: 'text' | 'file';
  fileName?: string;
  fileBase64?: string;
}

/** 授权配置，用于生成 Authorization 等请求头 */
export interface AuthConfig {
  enabled: boolean;
  type: 'bearer' | 'basic' | 'oauth1' | 'oauth2' | 'apiKey' | 'jwt';
  token?: string;
  username?: string;
  password?: string;
  consumerKey?: string;
  consumerSecret?: string;
  accessToken?: string;
  keyName?: string;
  value?: string;
}

export interface Interface {
  id: string;
  name: string;
  url: string;
  method?: string;
  parentId: string;
  requestBody?: string;
  headers?: Record<string, string>;
  bodyType?: BodyType;
  formData?: FormDataItem[];
  formUrlEncoded?: Array<{ key: string; value: string }>;
  binaryBase64?: string;
  auth?: AuthConfig;
  /** 该接口下的请求实例（每次请求可保存为实例） */
  instances?: Instance[];
}
