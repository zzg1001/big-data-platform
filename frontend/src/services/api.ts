import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 60000,  // 增加到 60 秒，支持 Airflow 事务操作
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to add auth token
api.interceptors.request.use(
  async (config) => {
    // Dynamically import to avoid circular dependency
    const { useAuthStore } = await import('../stores/authStore')
    const token = useAuthStore.getState().accessToken
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // If 401 and not already retrying, try to refresh token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      // Check if it's a session expiration
      const detail = error.response?.data?.detail
      if (detail === 'Session expired, please login again') {
        // Session expired, clear local state and redirect to login
        const { useAuthStore } = await import('../stores/authStore')
        // Clear local state without calling server logout (session already expired)
        delete api.defaults.headers.common['Authorization']
        useAuthStore.setState({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        })
        window.location.href = '/login'
        return Promise.reject(error)
      }

      try {
        const { useAuthStore } = await import('../stores/authStore')
        await useAuthStore.getState().refreshAccessToken()

        // Retry original request with new token
        const token = useAuthStore.getState().accessToken
        originalRequest.headers['Authorization'] = `Bearer ${token}`
        return api(originalRequest)
      } catch {
        // Refresh failed, clear local state and redirect to login
        const { useAuthStore } = await import('../stores/authStore')
        delete api.defaults.headers.common['Authorization']
        useAuthStore.setState({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        })
        window.location.href = '/login'
      }
    }

    return Promise.reject(error)
  }
)

export default api

// API helper functions
export const datasourceApi = {
  // 分页查询（用于数据源管理页面）
  list: (params?: {
    page?: number
    page_size?: number
    keyword?: string
    is_warehouse?: boolean
    group_id?: number
  }) => api.get('/api/v1/datasources/', { params }),

  // 获取全部（用于下拉选择，不分页）
  listAll: (params?: { is_warehouse?: boolean }) =>
    api.get('/api/v1/datasources/all', { params }),

  get: (id: number) => api.get(`/api/v1/datasources/${id}`),
  create: (data: any) => api.post('/api/v1/datasources/', data),
  update: (id: number, data: any) => api.put(`/api/v1/datasources/${id}`, data),
  delete: (id: number) => api.delete(`/api/v1/datasources/${id}`),
  test: (data: any) => api.post('/api/v1/datasources/test', data),
  testSaved: (id: number) => api.post(`/api/v1/datasources/${id}/test`),
  getTables: (id: number) => api.get(`/api/v1/datasources/${id}/tables`),
  getTableMetadata: (id: number, table: string) =>
    api.get(`/api/v1/datasources/${id}/tables/${table}`),
}

export const queryApi = {
  execute: (data: { sql: string; datasource_id: number; limit?: number; offset?: number }) =>
    api.post('/api/v1/queries/execute', data),
  listSaved: () => api.get('/api/v1/queries/saved'),
  save: (data: any) => api.post('/api/v1/queries/saved', data),
  update: (id: number, data: any) => api.put(`/api/v1/queries/saved/${id}`, data),
  delete: (id: number) => api.delete(`/api/v1/queries/saved/${id}`),
  getHistory: (limit?: number) => api.get('/api/v1/queries/history', { params: { limit } }),
}

export const fileApi = {
  upload: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/api/v1/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  list: () => api.get('/api/v1/files/'),
  preview: (id: number, rows?: number) =>
    api.get(`/api/v1/files/${id}/preview`, { params: { rows } }),
  delete: (id: number) => api.delete(`/api/v1/files/${id}`),
  import: (id: number, data: any) => api.post(`/api/v1/files/${id}/import`, data),
}

export const scheduleApi = {
  list: () => api.get('/api/v1/schedules/'),
  get: (id: number) => api.get(`/api/v1/schedules/${id}`),
  create: (data: any) => api.post('/api/v1/schedules/', data),
  update: (id: number, data: any) => api.put(`/api/v1/schedules/${id}`, data),
  delete: (id: number) => api.delete(`/api/v1/schedules/${id}`),
  generateDag: (id: number) => api.post(`/api/v1/schedules/${id}/generate-dag`),
  deploy: (id: number) => api.post(`/api/v1/schedules/${id}/deploy`),
  pause: (id: number) => api.post(`/api/v1/schedules/${id}/pause`),
  resume: (id: number) => api.post(`/api/v1/schedules/${id}/resume`),
  getLogs: (id: number) => api.get(`/api/v1/schedules/${id}/logs`),
}

export const aiApi = {
  textToSql: (data: { natural_language: string; datasource_id: number; context?: string }) =>
    api.post('/api/v1/ai/text-to-sql', data),
  optimize: (data: { sql: string; datasource_id?: number }) =>
    api.post('/api/v1/ai/optimize', data),
  explain: (data: { sql: string }) => api.post('/api/v1/ai/explain', data),
  generateDag: (data: any) => api.post('/api/v1/ai/generate-dag', data),
  convertDdl: (data: {
    source_datasource_id: number
    target_datasource_id: number
    source_table: string
    source_schema?: string
    target_table?: string
    target_schema?: string
  }) => api.post('/api/v1/ai/convert-ddl', data),
  executeDdl: (data: { datasource_id: number; ddl: string }) =>
    api.post('/api/v1/ai/execute-ddl', data),
  fixDdl: (data: { ddl: string; error: string; target_db_type: string }) =>
    api.post('/api/v1/ai/fix-ddl', data),
  generateCron: (data: { description: string }) =>
    api.post('/api/v1/ai/generate-cron', data),
  convertColumnTypes: (data: {
    columns: { name: string; data_type: string }[]
    source_db_type: string
    target_db_type: string
  }) => api.post('/api/v1/ai/convert-column-types', data),
}

export const lineageApi = {
  parse: (sql: string) => api.post('/api/v1/lineage/parse', { sql }),
  getDependencies: (sqls: string[]) => api.post('/api/v1/lineage/dependencies', { sqls }),
}

export const configApi = {
  getWarehouse: () => api.get('/api/v1/config/warehouse'),
  setWarehouse: (data: {
    name: string
    type: string
    host: string
    port: number
    database: string
    username: string
    password?: string
    schema_name?: string
    extra_params?: string
  }) => api.put('/api/v1/config/warehouse', data),
  testWarehouse: (data: {
    name: string
    type: string
    host: string
    port: number
    database: string
    username: string
    password?: string
    schema_name?: string
  }) => api.post('/api/v1/config/warehouse/test', data),
  clearWarehouse: () => api.delete('/api/v1/config/warehouse'),
}

export const warehouseApi = {
  getTables: () => api.get('/api/v1/warehouse/tables'),
  getTableMetadata: (tableName: string) => api.get(`/api/v1/warehouse/tables/${tableName}`),
  previewTable: (tableName: string, limit?: number) =>
    api.get(`/api/v1/warehouse/tables/${tableName}/preview`, { params: { limit } }),
  executeQuery: (data: { sql: string; limit?: number; offset?: number }) =>
    api.post('/api/v1/warehouse/query', data),
}

export const syncApi = {
  list: () => api.get('/api/v1/sync/'),
  get: (id: number) => api.get(`/api/v1/sync/${id}`),
  create: (data: any) => api.post('/api/v1/sync/', data),
  update: (id: number, data: any) => api.put(`/api/v1/sync/${id}`, data),
  delete: (id: number) => api.delete(`/api/v1/sync/${id}`),
  preview: (data: any) => api.post('/api/v1/sync/preview', data),
  execute: (id: number) => api.post(`/api/v1/sync/${id}/execute`),
  getColumns: (id: number) => api.get(`/api/v1/sync/${id}/columns`),
  getTableColumns: (datasourceId: number, tableName: string, schemaName?: string) =>
    api.get('/api/v1/sync/table-columns', {
      params: {
        datasource_id: datasourceId,
        table_name: tableName,
        ...(schemaName ? { schema_name: schemaName } : {}),
      },
    }),
  getLogs: (id: number) => api.get(`/api/v1/sync/${id}/logs`),
  generateDdl: (id: number) => api.post(`/api/v1/sync/${id}/generate-ddl`),
  generateDdlAi: (id: number) => api.post(`/api/v1/sync/${id}/generate-ddl-ai`),
  generateDag: (id: number) => api.post(`/api/v1/sync/${id}/generate-dag`),
  executeDdlOnWarehouse: (ddl: string, targetDatasourceId?: number | null) =>
    api.post('/api/v1/sync/execute-ddl-warehouse', {
      ddl,
      target_datasource_id: targetDatasourceId
    }),
  // 预览 DDL（无需创建任务）
  generateDdlPreview: (data: {
    source_datasource_id?: number  // 为空时使用平台数据库
    source_table: string
    source_schema?: string
    target_table?: string
    target_schema?: string
    target_datasource_id?: number | null
  }) => api.post('/api/v1/sync/generate-ddl-preview', data),
  // 字段映射
  saveColumnMappings: (data: {
    source_datasource_id?: number  // 为空时使用平台数据库
    source_table: string
    target_table: string
    mappings: { source_column: string; source_type: string; target_column: string; target_type: string; is_new_column?: boolean }[]
    sync_task_id?: number
  }) => api.post('/api/v1/sync/column-mappings', data),
  getColumnMappings: (sourceDatasourceId: number, sourceTable: string, targetTable: string) =>
    api.get('/api/v1/sync/column-mappings', {
      params: { source_datasource_id: sourceDatasourceId, source_table: sourceTable, target_table: targetTable },
    }),
  deleteColumnMappings: (sourceDatasourceId: number, sourceTable: string, targetTable: string) =>
    api.delete('/api/v1/sync/column-mappings', {
      params: { source_datasource_id: sourceDatasourceId, source_table: sourceTable, target_table: targetTable },
    }),
}

// ETL任务 API
export const etlApi = {
  list: (statusFilter?: string) =>
    api.get('/api/v1/etl/', { params: { status_filter: statusFilter } }),
  get: (id: number) => api.get(`/api/v1/etl/${id}`),
  create: (data: { name: string; description?: string; sql_content: string; datasource_id?: number; dw_layer_id?: number }) =>
    api.post('/api/v1/etl/', data),
  update: (id: number, data: any) => api.put(`/api/v1/etl/${id}`, data),
  delete: (id: number) => api.delete(`/api/v1/etl/${id}`),
  execute: (id: number) => api.post(`/api/v1/etl/${id}/execute`),
  getLogs: (id: number, limit?: number) =>
    api.get(`/api/v1/etl/${id}/logs`, { params: { limit } }),
  schedule: (id: number, cronExpression: string) =>
    api.post(`/api/v1/etl/${id}/schedule`, { cron_expression: cronExpression }),
  enable: (id: number, cronExpression: string) =>
    api.post(`/api/v1/etl/${id}/enable`, { cron_expression: cronExpression }),
  disable: (id: number, force: boolean = false) => api.post(`/api/v1/etl/${id}/disable`, null, { params: { force } }),
  unschedule: (id: number) => api.post(`/api/v1/etl/${id}/unschedule`),
}

// 调度管理 API (独立实体，封装 sync task)
export const syncScheduleApi = {
  // 调度列表
  list: (enabledFilter?: string) =>
    api.get('/api/v1/sync-schedules/', { params: { enabled_filter: enabledFilter } }),
  // 获取可调度的任务（未创建调度的同步任务）
  getAvailableTasks: () => api.get('/api/v1/sync-schedules/available-tasks'),
  // 创建调度
  create: (data: { name: string; description?: string; sync_task_id: number; cron_expression: string }) =>
    api.post('/api/v1/sync-schedules/', data),
  // 获取单个调度
  get: (id: number) => api.get(`/api/v1/sync-schedules/${id}`),
  // 更新调度
  update: (id: number, data: { name?: string; description?: string; cron_expression?: string }) =>
    api.put(`/api/v1/sync-schedules/${id}`, data),
  // 删除调度
  delete: (id: number) => api.delete(`/api/v1/sync-schedules/${id}`),
  // 上线调度（生成 DAG 并激活）
  enable: (id: number) => api.post(`/api/v1/sync-schedules/${id}/enable`),
  // 下线调度（暂停 DAG）
  disable: (id: number, force: boolean = false) => api.post(`/api/v1/sync-schedules/${id}/disable`, null, { params: { force } }),
}

// 平台数据库层级 API
export const dwLayerApi = {
  list: () => api.get('/api/v1/dw-layers/'),
  get: (id: number) => api.get(`/api/v1/dw-layers/${id}`),
  create: (data: { name: string; display_name: string; description?: string; level: number; color?: string }) =>
    api.post('/api/v1/dw-layers/', data),
  update: (id: number, data: { name?: string; display_name?: string; description?: string; level?: number; color?: string }) =>
    api.put(`/api/v1/dw-layers/${id}`, data),
  delete: (id: number) => api.delete(`/api/v1/dw-layers/${id}`),
  initDefaults: () => api.post('/api/v1/dw-layers/init-defaults'),
}

// 任务依赖 API
export const taskDependencyApi = {
  getForTask: (taskType: string, taskId: number) =>
    api.get(`/api/v1/task-dependencies/task/${taskType}/${taskId}`),
  create: (data: {
    task_type: string;
    task_id: number;
    upstream_task_type: string;
    upstream_task_id: number;
    dependency_type?: string;
    source_table?: string;
  }) => api.post('/api/v1/task-dependencies/', data),
  delete: (id: number) => api.delete(`/api/v1/task-dependencies/${id}`),
  searchTasks: (q: string, excludeType?: string, excludeId?: number) =>
    api.get('/api/v1/task-dependencies/search-tasks', {
      params: { q, exclude_type: excludeType, exclude_id: excludeId },
    }),
  parseSql: (sqlContent: string) =>
    api.post('/api/v1/task-dependencies/parse-sql', { sql_content: sqlContent }),
}

// SQL 脚本文件 API
export const sqlScriptApi = {
  list: () => api.get('/api/v1/sql-scripts/'),
  get: (name: string) => api.get(`/api/v1/sql-scripts/${encodeURIComponent(name)}`),
  create: (name: string, content: string) =>
    api.post('/api/v1/sql-scripts/', { name, content }),
  update: (name: string, content: string) =>
    api.put(`/api/v1/sql-scripts/${encodeURIComponent(name)}`, { content }),
  delete: (name: string) =>
    api.delete(`/api/v1/sql-scripts/${encodeURIComponent(name)}`),
  rename: (name: string, newName: string) =>
    api.post(`/api/v1/sql-scripts/${encodeURIComponent(name)}/rename`, null, {
      params: { new_name: newName },
    }),
}

// 标签管理平台 API
export const tagApi = {
  // 标签节点
  listNodes: (params?: { parent_id?: number; node_type?: string; keyword?: string }) =>
    api.get('/api/v1/tags/nodes', { params }),
  getTree: () => api.get('/api/v1/tags/tree'),
  createNode: (data: { name: string; description?: string; node_type: string; parent_id?: number; color?: string }) =>
    api.post('/api/v1/tags/nodes', data),
  updateNode: (id: number, data: any) =>
    api.put(`/api/v1/tags/nodes/${id}`, data),
  deleteNode: (id: number) =>
    api.delete(`/api/v1/tags/nodes/${id}`),

  // 标签数据
  listData: (params?: { tag_node_id?: number; datasource_id?: number; table_name?: string }) =>
    api.get('/api/v1/tags/data', { params }),
  createData: (data: { tag_node_id: number; datasource_id?: number; table_name?: string; row_id?: string }) =>
    api.post('/api/v1/tags/data', data),
  deleteData: (id: number) =>
    api.delete(`/api/v1/tags/data/${id}`),

  // 规则标签
  createRuleTag: (data: {
    name: string;
    description?: string;
    parent_id?: number;
    color?: string;
    rule_config: { datasource_id?: number; source_table: string; sql_condition?: string; full_sql?: string };
  }) => api.post('/api/v1/tags/rule-tag', data),

  // 获取所有类型节点（用于行级标签）
  listTypes: () => api.get('/api/v1/tags/types'),

  // 获取类型下的标签选项
  getTagsUnderType: (typeId: number) => api.get(`/api/v1/tags/nodes/${typeId}/tags`),

  // 行级标签
  createRowTag: (data: {
    name: string;
    description?: string;
    parent_id?: number;
    color?: string;
    datasource_id?: number;
    source_table: string;
    source_columns: string[];
    tag_fields: { name: string; description: string; type_id: number | null }[];  // 标签字段配置，每个字段绑定一个类型
    target_table?: string;
  }) => api.post('/api/v1/tags/row-tag', data),

  executeRowTag: (nodeId: number, data: { batch_size?: number; ai_prompt?: string }) =>
    api.post(`/api/v1/tags/row-tag/${nodeId}/execute`, data),

  // 数据集标签
  createDatasetTag: (data: {
    name: string;
    description?: string;
    parent_id?: number;
    color?: string;
    source_tag_ids: number[];
    filter_condition?: string;
    target_table?: string;
  }) => api.post('/api/v1/tags/dataset-tag', data),

  // 预览标签数据
  previewTagData: (nodeId: number, limit?: number) =>
    api.get(`/api/v1/tags/nodes/${nodeId}/preview`, { params: { limit } }),

  // 统计
  getStatistics: () => api.get('/api/v1/tags/statistics'),
}
