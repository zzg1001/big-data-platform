import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30000,
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

      try {
        const { useAuthStore } = await import('../stores/authStore')
        await useAuthStore.getState().refreshAccessToken()

        // Retry original request with new token
        const token = useAuthStore.getState().accessToken
        originalRequest.headers['Authorization'] = `Bearer ${token}`
        return api(originalRequest)
      } catch {
        // Refresh failed, logout user
        const { useAuthStore } = await import('../stores/authStore')
        useAuthStore.getState().logout()
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
      params: { datasource_id: datasourceId, table_name: tableName, schema_name: schemaName },
    }),
  getLogs: (id: number) => api.get(`/api/v1/sync/${id}/logs`),
  generateDdl: (id: number) => api.post(`/api/v1/sync/${id}/generate-ddl`),
  generateDdlAi: (id: number) => api.post(`/api/v1/sync/${id}/generate-ddl-ai`),
  generateDag: (id: number) => api.post(`/api/v1/sync/${id}/generate-dag`),
  executeDdlOnWarehouse: (ddl: string) => api.post('/api/v1/sync/execute-ddl-warehouse', { ddl }),
  // 预览 DDL（无需创建任务）
  generateDdlPreview: (data: {
    source_datasource_id: number
    source_table: string
    source_schema?: string
    target_table?: string
    target_schema?: string
  }) => api.post('/api/v1/sync/generate-ddl-preview', data),
}
