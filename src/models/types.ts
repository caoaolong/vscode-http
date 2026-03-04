/**
 * HTTP 请求树状结构的数据模型
 */

export type TreeNodeType = 'project' | 'collection' | 'interface' | 'requestBody' | 'responseBody';

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
  responseBody?: string;
  headers?: Record<string, string>;
  bodyType?: BodyType;
  formData?: FormDataItem[];
  formUrlEncoded?: Array<{ key: string; value: string }>;
  binaryBase64?: string;
  auth?: AuthConfig;
}
