import { useEffect, useState, useRef } from 'react'
import {
  Card,
  Table,
  Typography,
  Space,
  Tag,
  message,
  Spin,
  Empty,
  Input,
  Button,
  Tooltip,
  Alert,
  Tabs,
  Descriptions,
  Splitter,
} from 'antd'
import {
  GoldOutlined,
  TableOutlined,
  ReloadOutlined,
  DatabaseOutlined,
  EyeOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined,
  BulbOutlined,
  CodeOutlined,
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import { configApi, warehouseApi, aiApi } from '../services/api'

const { Title, Text } = Typography
const { Search } = Input

interface ColumnInfo {
  name: string
  data_type: string
  is_nullable: boolean
  is_primary_key: boolean
  default_value?: string
  comment?: string
}

export default function DataExplorer() {
  // 数仓配置
  const [warehouseConfig, setWarehouseConfig] = useState<any>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)

  // 表列表
  const [tables, setTables] = useState<string[]>([])
  const [filteredTables, setFilteredTables] = useState<string[]>([])
  const [loadingTables, setLoadingTables] = useState(false)
  const [searchText, setSearchText] = useState('')

  // 当前选中的表
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tableColumns, setTableColumns] = useState<ColumnInfo[]>([])
  const [tableData, setTableData] = useState<any[]>([])
  const [loadingTableInfo, setLoadingTableInfo] = useState(false)
  const [totalRows, setTotalRows] = useState(0)

  // SQL 编辑
  const [sql, setSql] = useState('')
  const [executing, setExecuting] = useState(false)
  const [queryResult, setQueryResult] = useState<any>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const editorRef = useRef<any>(null)

  // Tab
  const [activeTab, setActiveTab] = useState('sql')

  useEffect(() => {
    loadWarehouseConfig()
  }, [])

  useEffect(() => {
    if (warehouseConfig?.configured) {
      loadTables()
    }
  }, [warehouseConfig])

  useEffect(() => {
    if (searchText) {
      setFilteredTables(
        tables.filter((t) => t.toLowerCase().includes(searchText.toLowerCase()))
      )
    } else {
      setFilteredTables(tables)
    }
  }, [searchText, tables])

  const loadWarehouseConfig = async () => {
    setLoadingConfig(true)
    try {
      const res = await configApi.getWarehouse()
      setWarehouseConfig(res.data)
    } catch (error) {
      console.error('Failed to load warehouse config')
    } finally {
      setLoadingConfig(false)
    }
  }

  const loadTables = async () => {
    setLoadingTables(true)
    try {
      const res = await warehouseApi.getTables()
      setTables(res.data)
      setFilteredTables(res.data)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '加载表列表失败')
    } finally {
      setLoadingTables(false)
    }
  }

  const handleSelectTable = async (tableName: string) => {
    setSelectedTable(tableName)
    setLoadingTableInfo(true)

    try {
      // 加载表结构
      const structRes = await warehouseApi.getTableMetadata(tableName)
      setTableColumns(structRes.data.columns || [])

      // 加载预览数据
      const dataRes = await warehouseApi.previewTable(tableName, 100)
      setTableData(dataRes.data.rows || [])
      setTotalRows(dataRes.data.total || 0)

      // 生成默认SQL
      setSql(`SELECT * FROM ${tableName} LIMIT 100;`)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '加载表数据失败')
      setTableColumns([])
      setTableData([])
    } finally {
      setLoadingTableInfo(false)
    }
  }

  const handleExecute = async () => {
    if (!sql.trim()) {
      message.warning('请输入SQL')
      return
    }

    setExecuting(true)
    setQueryResult(null)
    setActiveTab('result')

    try {
      const res = await warehouseApi.executeQuery({
        sql: sql.trim(),
        limit: 1000,
      })
      setQueryResult(res.data)
      message.success(`执行成功，返回 ${res.data.row_count} 行`)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '执行失败')
    } finally {
      setExecuting(false)
    }
  }

  const handleTextToSql = async () => {
    if (!aiPrompt.trim()) {
      message.warning('请输入查询描述')
      return
    }

    setAiLoading(true)
    try {
      const res = await aiApi.textToSql({
        natural_language: aiPrompt,
        datasource_id: -1,
        context: `数仓类型: ${warehouseConfig?.type || 'unknown'}, 表列表: ${tables.slice(0, 20).join(', ')}`,
      })
      setSql(res.data.sql)
      setActiveTab('sql')
      message.success('SQL生成成功')
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'AI服务不可用')
    } finally {
      setAiLoading(false)
    }
  }

  const handleOptimize = async () => {
    if (!sql.trim()) {
      message.warning('请输入SQL')
      return
    }

    setAiLoading(true)
    try {
      const res = await aiApi.optimize({ sql })
      setSql(res.data.optimized_sql)
      message.success('SQL优化完成')
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'AI服务不可用')
    } finally {
      setAiLoading(false)
    }
  }

  // 表结构列配置
  const structureColumns = [
    {
      title: '字段名',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ColumnInfo) => (
        <Space>
          <Text strong>{name}</Text>
          {record.is_primary_key && <Tag color="gold">PK</Tag>}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'data_type',
      key: 'data_type',
      render: (type: string) => <Tag color="blue">{type}</Tag>,
    },
    {
      title: '可空',
      dataIndex: 'is_nullable',
      key: 'is_nullable',
      width: 80,
      render: (nullable: boolean) => (nullable ? '是' : '否'),
    },
    {
      title: '默认值',
      dataIndex: 'default_value',
      key: 'default_value',
      render: (val: string) => val || '-',
    },
    {
      title: '备注',
      dataIndex: 'comment',
      key: 'comment',
      render: (comment: string) => comment || '-',
    },
  ]

  // 数据预览列配置
  const previewColumns = tableColumns.map((col) => ({
    title: col.name,
    dataIndex: col.name,
    key: col.name,
    ellipsis: true,
    width: 150,
    render: (val: any) => {
      if (val === null || val === undefined) {
        return <Text type="secondary">NULL</Text>
      }
      if (typeof val === 'object') {
        return JSON.stringify(val)
      }
      return String(val)
    },
  }))

  // 查询结果列配置
  const resultColumns =
    queryResult?.columns?.map((col: string) => ({
      title: col,
      dataIndex: col,
      key: col,
      ellipsis: true,
      width: 150,
    })) || []

  const resultData =
    queryResult?.rows?.map((row: any[], index: number) => {
      const obj: any = { key: index }
      queryResult.columns.forEach((col: string, i: number) => {
        obj[col] = row[i]
      })
      return obj
    }) || []

  if (loadingConfig) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin tip="加载中..." size="large" />
      </div>
    )
  }

  if (!warehouseConfig?.configured) {
    return (
      <div style={{ padding: 24 }}>
        <Title level={4}>数据探索</Title>
        <Alert
          message="数仓未配置"
          description={
            <Space direction="vertical">
              <Text>请先在「系统管理 - 数仓配置」中配置目标数据库连接。</Text>
              <Button type="primary" icon={<SettingOutlined />} href="#/admin">
                前往配置
              </Button>
            </Space>
          }
          type="warning"
          showIcon
          icon={<GoldOutlined />}
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
      {/* 顶部信息 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            数据探索
          </Title>
          <Tag icon={<GoldOutlined />} color="gold">
            {warehouseConfig.name}
          </Tag>
          <Tag color="blue">{warehouseConfig.type}</Tag>
          <Text type="secondary">
            {warehouseConfig.host}/{warehouseConfig.database}
          </Text>
        </Space>
        <div style={{ flex: 1 }} />
        <Space.Compact style={{ width: 300 }}>
          <Input
            placeholder="用自然语言描述查询..."
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onPressEnter={handleTextToSql}
          />
          <Tooltip title="AI生成SQL">
            <Button icon={<BulbOutlined />} onClick={handleTextToSql} loading={aiLoading} />
          </Tooltip>
        </Space.Compact>
        <Button icon={<ReloadOutlined />} onClick={loadTables}>
          刷新
        </Button>
      </div>

      {/* 主体内容 */}
      <Splitter style={{ flex: 1, minHeight: 0 }}>
        {/* 左侧：表列表 */}
        <Splitter.Panel defaultSize={260} min={200} max={400}>
          <Card
            title={
              <Space>
                <DatabaseOutlined />
                <span>数据表</span>
                <Tag>{filteredTables.length}</Tag>
              </Space>
            }
            size="small"
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            bodyStyle={{ flex: 1, overflow: 'auto', padding: 8 }}
            extra={
              <Search
                placeholder="搜索"
                size="small"
                style={{ width: 100 }}
                allowClear
                onChange={(e) => setSearchText(e.target.value)}
              />
            }
          >
            {loadingTables ? (
              <div style={{ textAlign: 'center', padding: 50 }}>
                <Spin tip="加载中..." />
              </div>
            ) : filteredTables.length > 0 ? (
              filteredTables.map((table) => (
                <div
                  key={table}
                  onClick={() => handleSelectTable(table)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderRadius: 6,
                    marginBottom: 4,
                    background: selectedTable === table ? '#e6f4ff' : '#fafafa',
                    border:
                      selectedTable === table ? '1px solid #91caff' : '1px solid #f0f0f0',
                    transition: 'all 0.2s',
                  }}
                >
                  <Space>
                    <TableOutlined
                      style={{ color: selectedTable === table ? '#1890ff' : '#8c8c8c' }}
                    />
                    <Text
                      style={{
                        fontWeight: selectedTable === table ? 500 : 400,
                      }}
                      ellipsis
                    >
                      {table}
                    </Text>
                  </Space>
                </div>
              ))
            ) : (
              <Empty description="暂无表" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Splitter.Panel>

        {/* 右侧：SQL编辑和结果 */}
        <Splitter.Panel>
          <Card
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            bodyStyle={{ flex: 1, overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}
          >
            {/* SQL 编辑器工具栏 */}
            <div
              style={{
                padding: '8px 16px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleExecute}
                loading={executing}
              >
                执行
              </Button>
              <Tooltip title="AI优化SQL">
                <Button icon={<ThunderboltOutlined />} onClick={handleOptimize} loading={aiLoading}>
                  优化
                </Button>
              </Tooltip>
              {selectedTable && (
                <>
                  <div style={{ width: 1, height: 20, background: '#e8e8e8' }} />
                  <Text type="secondary">
                    当前表: <Text strong>{selectedTable}</Text>
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      ({tableColumns.length} 字段, {totalRows.toLocaleString()} 行)
                    </Text>
                  </Text>
                </>
              )}
            </div>

            {/* SQL 编辑器 */}
            <div style={{ height: 200, borderBottom: '1px solid #f0f0f0' }}>
              <Editor
                height="100%"
                language="sql"
                value={sql}
                onChange={(value) => setSql(value || '')}
                onMount={(editor) => {
                  editorRef.current = editor
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>

            {/* 下方 Tabs：结构 / 数据预览 / 查询结果 */}
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              tabBarStyle={{ padding: '0 16px', marginBottom: 0 }}
              items={[
                {
                  key: 'result',
                  label: (
                    <span>
                      <CodeOutlined /> 查询结果
                      {queryResult && (
                        <Tag color="blue" style={{ marginLeft: 8 }}>
                          {queryResult.row_count}
                        </Tag>
                      )}
                    </span>
                  ),
                  children: (
                    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
                      {executing ? (
                        <div style={{ textAlign: 'center', padding: 50 }}>
                          <Spin tip="执行中..." />
                        </div>
                      ) : queryResult ? (
                        <>
                          <Alert
                            message={`返回 ${queryResult.row_count} 行，耗时 ${queryResult.execution_time_ms}ms`}
                            type="success"
                            showIcon
                            style={{ marginBottom: 16 }}
                          />
                          <Table
                            columns={resultColumns}
                            dataSource={resultData}
                            size="small"
                            scroll={{ x: 'max-content' }}
                            pagination={{
                              pageSize: 50,
                              showSizeChanger: true,
                              showTotal: (total) => `共 ${total} 条`,
                            }}
                          />
                        </>
                      ) : (
                        <Empty description="点击「执行」运行SQL查询" />
                      )}
                    </div>
                  ),
                },
                {
                  key: 'structure',
                  label: (
                    <span>
                      <DatabaseOutlined /> 表结构
                    </span>
                  ),
                  children: (
                    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
                      {selectedTable ? (
                        loadingTableInfo ? (
                          <div style={{ textAlign: 'center', padding: 50 }}>
                            <Spin tip="加载中..." />
                          </div>
                        ) : (
                          <>
                            <Descriptions size="small" column={4} style={{ marginBottom: 16 }}>
                              <Descriptions.Item label="表名">
                                <Text strong>{selectedTable}</Text>
                              </Descriptions.Item>
                              <Descriptions.Item label="字段数">
                                {tableColumns.length}
                              </Descriptions.Item>
                              <Descriptions.Item label="数据行数">
                                {totalRows.toLocaleString()}
                              </Descriptions.Item>
                            </Descriptions>
                            <Table
                              columns={structureColumns}
                              dataSource={tableColumns}
                              rowKey="name"
                              size="small"
                              pagination={false}
                            />
                          </>
                        )
                      ) : (
                        <Empty description="请从左侧选择一个表" />
                      )}
                    </div>
                  ),
                },
                {
                  key: 'preview',
                  label: (
                    <span>
                      <EyeOutlined /> 数据预览
                    </span>
                  ),
                  children: (
                    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
                      {selectedTable ? (
                        loadingTableInfo ? (
                          <div style={{ textAlign: 'center', padding: 50 }}>
                            <Spin tip="加载中..." />
                          </div>
                        ) : (
                          <>
                            <Alert
                              message={`显示前 ${tableData.length} 条数据，共 ${totalRows.toLocaleString()} 条`}
                              type="info"
                              showIcon
                              style={{ marginBottom: 16 }}
                            />
                            <Table
                              columns={previewColumns}
                              dataSource={tableData.map((row, idx) => ({ ...row, _key: idx }))}
                              rowKey="_key"
                              size="small"
                              scroll={{ x: 'max-content' }}
                              pagination={{
                                pageSize: 50,
                                showSizeChanger: false,
                                showTotal: (total) => `共 ${total} 条`,
                              }}
                            />
                          </>
                        )
                      ) : (
                        <Empty description="请从左侧选择一个表" />
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </Splitter.Panel>
      </Splitter>
    </div>
  )
}
