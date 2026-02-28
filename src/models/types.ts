/**
 * HTTP 请求树状结构的数据模型
 */

export type TreeNodeType = 'project' | 'collection' | 'interface' | 'requestBody' | 'responseBody';

export interface Project {
  id: string;
  name: string;
  children: (Collection | Interface)[];
}

export interface Collection {
  id: string;
  name: string;
  parentId: string;
  children: Interface[];
}

export interface Interface {
  id: string;
  name: string;
  url: string;
  method?: string;
  parentId: string;
  requestBody?: string;
  responseBody?: string;
}
