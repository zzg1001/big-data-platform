import { useState, useEffect } from 'react'
import {
  Space,
  Tag,
  Select,
  Button,
  Spin,
  Empty,
  Typography,
  Divider,
  message,
} from 'antd'
import {
  DeleteOutlined,
  RobotOutlined,
  CodeOutlined,
} from '@ant-design/icons'
import { taskDependencyApi } from '../services/api'

const { Text } = Typography

interface TaskSearchResult {
  task_type: string
  task_id: number
  task_name: string
  table_name?: string
  dw_layer_name?: string
  dw_layer_color?: string
}

interface Dependency {
  id?: number
  upstream_task_type: string
  upstream_task_id: number
  upstream_task_name?: string
  upstream_table_name?: string
  upstream_layer_name?: string
  upstream_layer_color?: string
  dependency_type?: string
  source_table?: string
}

interface Props {
  taskType: string
  taskId?: number
  sqlContent?: string
  value?: Dependency[]
  onChange?: (dependencies: Dependency[]) => void
  readonly?: boolean  // 只读模式，用于显示自动添加的依赖
}

export default function DependencySelector({
  taskType,
  taskId,
  sqlContent,
  value = [],
  onChange,
  readonly = false,
}: Props) {
  const [searchResults, setSearchResults] = useState<TaskSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [aiParsing, setAiParsing] = useState(false)
  const [parsedTables, setParsedTables] = useState<string[]>([])

  // Load existing dependencies when taskId changes
  useEffect(() => {
    if (taskId) {
      loadExistingDependencies()
    }
  }, [taskId])

  const loadExistingDependencies = async () => {
    if (!taskId) return
    try {
      const res = await taskDependencyApi.getForTask(taskType, taskId)
      const deps = res.data.map((d: any) => ({
        id: d.id,
        upstream_task_type: d.upstream_task_type,
        upstream_task_id: d.upstream_task_id,
        upstream_task_name: d.upstream_task_name,
        upstream_table_name: d.upstream_table_name,
        upstream_layer_name: d.upstream_layer_name,
        upstream_layer_color: d.upstream_layer_color,
        dependency_type: d.dependency_type,
        source_table: d.source_table,
      }))
      onChange?.(deps)
    } catch (err) {
      console.error('Failed to load dependencies:', err)
    }
  }

  const handleSearch = async (keyword: string) => {
    setSearchValue(keyword)
    if (!keyword || keyword.length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const res = await taskDependencyApi.searchTasks(keyword, taskType, taskId)
      setSearchResults(res.data)
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setSearching(false)
    }
  }

  const handleSelectTask = (task: TaskSearchResult) => {
    // Check if already added
    const exists = value.some(
      (d) => d.upstream_task_type === task.task_type && d.upstream_task_id === task.task_id
    )
    if (exists) {
      message.warning('该依赖已添加')
      return
    }

    const newDep: Dependency = {
      upstream_task_type: task.task_type,
      upstream_task_id: task.task_id,
      upstream_task_name: task.task_name,
      upstream_table_name: task.table_name,
      upstream_layer_name: task.dw_layer_name,
      upstream_layer_color: task.dw_layer_color,
      dependency_type: 'manual',
    }
    onChange?.([...value, newDep])
    setSearchValue('')
    setSearchResults([])
  }

  const handleRemove = (dep: Dependency) => {
    const newDeps = value.filter(
      (d) =>
        !(d.upstream_task_type === dep.upstream_task_type && d.upstream_task_id === dep.upstream_task_id)
    )
    onChange?.(newDeps)
  }

  const handleAiParse = async () => {
    if (!sqlContent) {
      message.warning('请先输入SQL脚本')
      return
    }
    setAiParsing(true)
    setParsedTables([])
    try {
      const res = await taskDependencyApi.parseSql(sqlContent)
      const { source_tables, matched_tasks } = res.data

      setParsedTables(source_tables)

      if (matched_tasks.length === 0) {
        message.info('未找到匹配的上游任务')
        return
      }

      // Add matched tasks as dependencies
      const newDeps: Dependency[] = []
      for (const task of matched_tasks) {
        const exists = value.some(
          (d) => d.upstream_task_type === task.task_type && d.upstream_task_id === task.task_id
        )
        if (!exists) {
          newDeps.push({
            upstream_task_type: task.task_type,
            upstream_task_id: task.task_id,
            upstream_task_name: task.task_name,
            upstream_table_name: task.table_name,
            upstream_layer_name: task.dw_layer_name,
            upstream_layer_color: task.dw_layer_color,
            dependency_type: 'ai_parsed',
            source_table: task.table_name,
          })
        }
      }

      if (newDeps.length > 0) {
        onChange?.([...value, ...newDeps])
        message.success(`已添加 ${newDeps.length} 个依赖`)
      } else {
        message.info('所有匹配的任务已在依赖列表中')
      }
    } catch (err: any) {
      message.error('解析失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setAiParsing(false)
    }
  }

  const getTaskTypeLabel = (type: string) => {
    return type === 'sync' ? '同步' : type === 'etl' ? 'ETL' : type
  }

  const getTaskTypeColor = (type: string) => {
    return type === 'sync' ? 'blue' : type === 'etl' ? 'purple' : 'default'
  }

  return (
    <div>
      {/* Search and AI Parse - hidden in readonly mode */}
      {!readonly && (
        <Space style={{ marginBottom: 12, width: '100%' }} direction="vertical" size={8}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              showSearch
              placeholder="搜索任务名称或表名"
              style={{ flex: 1 }}
              value={searchValue || undefined}
              onSearch={handleSearch}
              onChange={() => {}}
              filterOption={false}
              notFoundContent={
                searching ? (
                  <Spin size="small" />
                ) : searchValue && searchResults.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配的任务" />
                ) : null
              }
              dropdownRender={(menu) => (
                <>
                  {menu}
                  {searchResults.length > 0 && (
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #f0f0f0' }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        点击任务添加为依赖
                      </Text>
                    </div>
                  )}
                </>
              )}
            >
              {searchResults.map((task) => (
                <Select.Option
                  key={`${task.task_type}-${task.task_id}`}
                  value={`${task.task_type}-${task.task_id}`}
                >
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSelectTask(task)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <Space size={4}>
                      <Tag color={getTaskTypeColor(task.task_type)} style={{ marginRight: 0 }}>
                        {getTaskTypeLabel(task.task_type)}
                      </Tag>
                      <span>{task.task_name}</span>
                      {task.table_name && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          ({task.table_name})
                        </Text>
                      )}
                    </Space>
                    {task.dw_layer_name && (
                      <Tag
                        color={task.dw_layer_color || 'default'}
                        style={{ marginLeft: 8, fontSize: 10 }}
                      >
                        {task.dw_layer_name}
                      </Tag>
                    )}
                  </div>
                </Select.Option>
              ))}
            </Select>
            <Button
              icon={<RobotOutlined />}
              loading={aiParsing}
              onClick={handleAiParse}
              disabled={!sqlContent}
              title="AI解析SQL，自动识别上游依赖"
            >
              AI解析
            </Button>
          </div>

          {/* Parsed tables info */}
          {parsedTables.length > 0 && (
            <div style={{ background: '#f6ffed', padding: '8px 12px', borderRadius: 4 }}>
              <Text style={{ fontSize: 12 }}>
                <CodeOutlined style={{ marginRight: 4 }} />
                识别到的源表：
                {parsedTables.map((t) => (
                  <Tag key={t} style={{ marginLeft: 4 }}>
                    {t}
                  </Tag>
                ))}
              </Text>
            </div>
          )}
        </Space>
      )}

      {!readonly && <Divider style={{ margin: '12px 0' }} />}

      {/* Selected dependencies */}
      <div>
        <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>
          已选依赖 ({value.length})
        </Text>
        {value.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无依赖"
            style={{ margin: '16px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {value.map((dep) => (
              <div
                key={`${dep.upstream_task_type}-${dep.upstream_task_id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: '#fafafa',
                  borderRadius: 6,
                  border: '1px solid #f0f0f0',
                }}
              >
                <Space size={8}>
                  <Tag color={getTaskTypeColor(dep.upstream_task_type)}>
                    {getTaskTypeLabel(dep.upstream_task_type)}
                  </Tag>
                  <span>{dep.upstream_task_name || `ID: ${dep.upstream_task_id}`}</span>
                  {dep.upstream_table_name && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      ({dep.upstream_table_name})
                    </Text>
                  )}
                  {dep.upstream_layer_name && (
                    <Tag color={dep.upstream_layer_color || 'default'} style={{ fontSize: 10 }}>
                      {dep.upstream_layer_name}
                    </Tag>
                  )}
                  {dep.dependency_type === 'ai_parsed' && (
                    <Tag color="green" style={{ fontSize: 10 }}>
                      <RobotOutlined /> AI
                    </Tag>
                  )}
                  {dep.dependency_type === 'auto' && (
                    <Tag color="cyan" style={{ fontSize: 10 }}>
                      自动
                    </Tag>
                  )}
                </Space>
                {!readonly && (
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemove(dep)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
