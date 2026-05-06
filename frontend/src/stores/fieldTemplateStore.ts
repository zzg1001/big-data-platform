import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 支持的数据库类型
export type DatabaseType = 'mysql' | 'postgresql' | 'oracle' | 'sqlserver' | 'hive'

export const DATABASE_LABELS: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  oracle: 'Oracle',
  sqlserver: 'SQL Server',
  hive: 'Hive',
}

// 模板历史版本
export interface TemplateVersion {
  expression: string
  dbOverrides?: Partial<Record<DatabaseType, string>>
  description?: string
  updatedAt: string
}

export interface FieldValueTemplate {
  id: string
  label: string       // 标签名，如 etl_time
  expression: string  // 默认值表达式，如 CURRENT_TIMESTAMP
  dbOverrides?: Partial<Record<DatabaseType, string>>  // 数据库特定表达式覆盖
  description?: string // 说明
  createdAt: string
  updatedAt: string
  history?: TemplateVersion[]  // 历史版本
  usageCount?: number  // 引用计数（由外部更新）
}

interface FieldTemplateState {
  templates: FieldValueTemplate[]
  addTemplate: (template: Omit<FieldValueTemplate, 'id' | 'createdAt' | 'updatedAt' | 'history'>) => void
  updateTemplate: (id: string, updates: Partial<Omit<FieldValueTemplate, 'id' | 'createdAt' | 'history'>>) => void
  deleteTemplate: (id: string) => boolean  // 返回是否删除成功
  getTemplateByLabel: (label: string) => FieldValueTemplate | undefined
  getExpressionForDb: (label: string, dbType: DatabaseType) => string | undefined  // 获取特定数据库的表达式
  updateUsageCount: (label: string, count: number) => void  // 更新引用计数
  getHistory: (id: string) => TemplateVersion[]  // 获取历史版本
}

// 默认模板
const defaultTemplates: FieldValueTemplate[] = [
  {
    id: '1',
    label: 'etl_time',
    expression: 'CURRENT_TIMESTAMP',
    dbOverrides: {
      oracle: 'SYSTIMESTAMP',
      sqlserver: 'GETDATE()',
      hive: 'current_timestamp()',
    },
    description: 'ETL 执行时间',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    label: 'create_ts',
    expression: 'CURRENT_TIMESTAMP',
    dbOverrides: {
      oracle: 'SYSTIMESTAMP',
      sqlserver: 'GETDATE()',
      hive: 'current_timestamp()',
    },
    description: '记录创建时间',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    label: 'update_ts',
    expression: 'CURRENT_TIMESTAMP',
    dbOverrides: {
      oracle: 'SYSTIMESTAMP',
      sqlserver: 'GETDATE()',
      hive: 'current_timestamp()',
    },
    description: '记录更新时间',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '4',
    label: 'dt',
    expression: "DATE_FORMAT(CURRENT_DATE, '%Y%m%d')",
    dbOverrides: {
      postgresql: "TO_CHAR(CURRENT_DATE, 'YYYYMMDD')",
      oracle: "TO_CHAR(SYSDATE, 'YYYYMMDD')",
      sqlserver: "FORMAT(GETDATE(), 'yyyyMMdd')",
      hive: "date_format(current_date(), 'yyyyMMdd')",
    },
    description: '分区日期',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '5',
    label: 'data_source',
    expression: "'SOURCE_SYSTEM'",
    description: '数据来源标识（固定值，所有数据库通用）',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

export const useFieldTemplateStore = create<FieldTemplateState>()(
  persist(
    (set, get) => ({
      templates: defaultTemplates,

      addTemplate: (template) => {
        const now = new Date().toISOString()
        const newTemplate: FieldValueTemplate = {
          ...template,
          id: `${Date.now()}`,
          createdAt: now,
          updatedAt: now,
          history: [],
          usageCount: 0,
        }
        set((state) => ({
          templates: [...state.templates, newTemplate],
        }))
      },

      updateTemplate: (id, updates) => {
        set((state) => ({
          templates: state.templates.map((t) => {
            if (t.id !== id) return t

            // 检查是否有实质性变化
            const hasExpressionChange = updates.expression && updates.expression !== t.expression
            const hasDescriptionChange = updates.description !== undefined && updates.description !== t.description
            const hasOverridesChange = updates.dbOverrides !== undefined &&
              JSON.stringify(updates.dbOverrides) !== JSON.stringify(t.dbOverrides)

            if (hasExpressionChange || hasDescriptionChange || hasOverridesChange) {
              const newHistory: TemplateVersion[] = [
                ...(t.history || []),
                {
                  expression: t.expression,
                  dbOverrides: t.dbOverrides,
                  description: t.description,
                  updatedAt: t.updatedAt,
                },
              ]
              // 只保留最近 10 个版本
              const trimmedHistory = newHistory.slice(-10)

              return {
                ...t,
                ...updates,
                updatedAt: new Date().toISOString(),
                history: trimmedHistory,
              }
            }

            return { ...t, ...updates, updatedAt: new Date().toISOString() }
          }),
        }))
      },

      deleteTemplate: (id) => {
        const template = get().templates.find((t) => t.id === id)
        // 如果有引用，不允许删除
        if (template && template.usageCount && template.usageCount > 0) {
          return false
        }
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        }))
        return true
      },

      getTemplateByLabel: (label) => {
        return get().templates.find((t) => t.label === label)
      },

      getExpressionForDb: (label, dbType) => {
        const template = get().templates.find((t) => t.label === label)
        if (!template) return undefined
        // 优先使用数据库特定表达式，否则使用默认表达式
        return template.dbOverrides?.[dbType] || template.expression
      },

      updateUsageCount: (label, count) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.label === label ? { ...t, usageCount: count } : t
          ),
        }))
      },

      getHistory: (id) => {
        const template = get().templates.find((t) => t.id === id)
        return template?.history || []
      },
    }),
    {
      name: 'field-template-storage',
    }
  )
)
