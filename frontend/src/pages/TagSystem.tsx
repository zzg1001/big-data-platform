import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Layout,
  Card,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Row,
  Col,
  Avatar,
  Dropdown,
  Typography,
  Tree,
  Empty,
  Tooltip,
  Radio,
  Table,
  Checkbox,
  Spin,
  Steps,
  Descriptions,
  Tabs,
  Alert,
} from 'antd'
import {
  TagsOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  HomeOutlined,
  FolderOutlined,
  UserOutlined,
  LogoutOutlined,
  ReloadOutlined,
  PlusCircleOutlined,
  FilterOutlined,
  ApartmentOutlined,
  DatabaseOutlined,
  RobotOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  EyeOutlined,
  FileSearchOutlined,
} from '@ant-design/icons'
import { tagApi, datasourceApi, warehouseApi } from '../services/api'
import { useAuthStore } from '../stores/authStore'

const { Header, Content, Sider } = Layout
const { TextArea } = Input
const { Text } = Typography

interface TagNode {
  id: number
  name: string
  description?: string
  node_type: 'category' | 'type' | 'tag'  // category=分类, type=类型(字段名), tag=标签(字段值)
  parent_id?: number
  level: number
  color: string
  icon?: string
  usage_count: number
  rule_type?: string
  rule_config?: string
  tag_table_name?: string
  children?: TagNode[]
}

interface TypeNodeWithTags {
  id: number
  name: string
  description?: string
  color: string
  tags: { id: number; name: string; color: string }[]
}

interface ColumnInfo {
  name: string
  data_type: string
  is_nullable?: boolean
  comment?: string
}

type ModuleType = 'tree' | 'rule' | 'rowTag'

export default function TagSystem() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const [currentModule, setCurrentModule] = useState<ModuleType>('tree')
  const [treeData, setTreeData] = useState<TagNode[]>([])
  const [flatTags, setFlatTags] = useState<TagNode[]>([])
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [loading, setLoading] = useState(false)

  // 弹窗
  const [modalVisible, setModalVisible] = useState(false)
  const [modalType, setModalType] = useState<'category' | 'type' | 'tag'>('category')
  const [editingNode, setEditingNode] = useState<TagNode | null>(null)
  const [parentNode, setParentNode] = useState<TagNode | null>(null)
  const [form] = Form.useForm()

  // 预览弹窗
  const [previewModalVisible, setPreviewModalVisible] = useState(false)
  const [previewNode, setPreviewNode] = useState<TagNode | null>(null)
  const [previewColumns, setPreviewColumns] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<any[]>([])
  const [previewTotal, setPreviewTotal] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)

  // 规则标签
  const [ruleTabKey, setRuleTabKey] = useState('sql')
  const [ruleForm] = Form.useForm()
  const [datasetForm] = Form.useForm()
  const [datasources, setDatasources] = useState<any[]>([])
  const [tables, setTables] = useState<string[]>([])
  const [tableColumns, setTableColumns] = useState<ColumnInfo[]>([])
  const [dataSourceMode, setDataSourceMode] = useState<'warehouse' | 'datasource'>('warehouse')
  const [selectedDatasource, setSelectedDatasource] = useState<number | null>(null)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [rulePreviewData, setRulePreviewData] = useState<any[]>([])
  const [rulePreviewLoading, setRulePreviewLoading] = useState(false)

  // 行级标签
  const [rowTagStep, setRowTagStep] = useState(0)
  const [rowTagForm] = Form.useForm()
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [typeNodesWithTags, setTypeNodesWithTags] = useState<TypeNodeWithTags[]>([])
  // 标签字段配置: 每个字段绑定一个类型节点
  const [tagFields, setTagFields] = useState<{ name: string; description: string; typeId: number | null }[]>([])
  const [aiTagging, setAiTagging] = useState(false)
  const [aiProgress, setAiProgress] = useState('')
  const [createdRowTagId, setCreatedRowTagId] = useState<number | null>(null)

  useEffect(() => {
    loadTree()
    loadDatasources()
    loadTypeNodes()
  }, [])

  const loadTypeNodes = async () => {
    try {
      const res = await tagApi.listTypes()
      setTypeNodesWithTags(res.data || [])
    } catch (error) {
      console.error('加载类型节点失败', error)
    }
  }

  const loadTree = async () => {
    setLoading(true)
    try {
      const res = await tagApi.getTree()
      setTreeData(res.data)
      const keys = collectKeys(res.data)
      setExpandedKeys(keys)
      setFlatTags(flattenTags(res.data))
    } catch (error) {
      console.error('加载标签树失败', error)
    } finally {
      setLoading(false)
    }
  }

  const collectKeys = (nodes: TagNode[]): React.Key[] => {
    let keys: React.Key[] = []
    nodes.forEach(node => {
      keys.push(node.id)
      if (node.children?.length) {
        keys = keys.concat(collectKeys(node.children))
      }
    })
    return keys
  }

  const flattenTags = (nodes: TagNode[], result: TagNode[] = []): TagNode[] => {
    nodes.forEach(node => {
      if (node.node_type === 'tag') {
        result.push(node)
      }
      if (node.children?.length) {
        flattenTags(node.children, result)
      }
    })
    return result
  }

  const flattenCategories = (nodes: TagNode[], result: TagNode[] = []): TagNode[] => {
    nodes.forEach(node => {
      if (node.node_type === 'category') {
        result.push(node)
      }
      if (node.children?.length) {
        flattenCategories(node.children, result)
      }
    })
    return result
  }

  const loadDatasources = async () => {
    try {
      // 获取所有数据源（排除平台仓库）
      const res = await datasourceApi.listAll()
      console.log('数据源列表:', res.data)
      // 过滤掉仓库类型的数据源
      const nonWarehouseDatasources = (res.data || []).filter((ds: any) => !ds.is_warehouse)
      console.log('非仓库数据源:', nonWarehouseDatasources)
      setDatasources(nonWarehouseDatasources)
    } catch (error) {
      console.error('加载数据源失败', error)
    }
  }

  const loadTables = async (datasourceId: number) => {
    try {
      console.log('加载数据源表, datasourceId:', datasourceId)
      const res = await datasourceApi.getTables(datasourceId)
      console.log('表列表:', res.data)
      setTables(res.data || [])
    } catch (error) {
      console.error('加载表失败', error)
      setTables([])
    }
  }

  const loadTableColumns = async (datasourceId: number, tableName: string) => {
    try {
      const res = await datasourceApi.getTableMetadata(datasourceId, tableName)
      setTableColumns(res.data.columns || [])
    } catch (error) {
      console.error('加载表结构失败', error)
      setTableColumns([])
    }
  }

  const loadWarehouseTables = async () => {
    try {
      const res = await warehouseApi.getTables()
      setTables(res.data)
    } catch (error) {
      console.error('加载平台表失败', error)
      setTables([])
    }
  }

  const loadWarehouseTableColumns = async (tableName: string) => {
    try {
      const res = await warehouseApi.getTableMetadata(tableName)
      setTableColumns(res.data.columns || [])
    } catch (error) {
      console.error('加载表结构失败', error)
      setTableColumns([])
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const userMenuItems = [
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
  ]

  // 打开新建/编辑弹窗
  const openModal = (type: 'category' | 'type' | 'tag', parent?: TagNode, editing?: TagNode) => {
    setModalType(type)
    setParentNode(parent || null)
    setEditingNode(editing || null)
    form.resetFields()

    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        description: editing.description,
        color: editing.color,
        node_type: editing.node_type,
      })
    } else {
      form.setFieldsValue({
        color: type === 'category' ? '#1890ff' : '#52c41a',
        node_type: type,
      })
    }
    setModalVisible(true)
  }

  // 保存节点
  const handleSave = async (values: any) => {
    try {
      if (editingNode) {
        await tagApi.updateNode(editingNode.id, values)
        message.success('更新成功')
      } else {
        await tagApi.createNode({
          ...values,
          parent_id: parentNode?.id || null,
        })
        message.success('创建成功')
      }
      setModalVisible(false)
      loadTree()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '操作失败')
    }
  }

  // 删除节点
  const handleDelete = async (node: TagNode) => {
    try {
      await tagApi.deleteNode(node.id)
      message.success('删除成功')
      loadTree()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    }
  }

  // 预览标签数据
  const handlePreview = async (node: TagNode) => {
    setPreviewNode(node)
    setPreviewModalVisible(true)
    setPreviewLoading(true)

    try {
      const res = await tagApi.previewTagData(node.id, 100)
      setPreviewColumns(res.data.columns || [])
      setPreviewRows(res.data.rows?.map((row: any[], idx: number) => {
        const obj: any = { key: idx }
        res.data.columns.forEach((col: string, i: number) => {
          obj[col] = row[i]
        })
        return obj
      }) || [])
      setPreviewTotal(res.data.total || 0)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '预览失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  // 保存规则标签（SQL方式）
  const handleSaveRuleTag = async (values: any) => {
    if (!selectedTable) {
      message.warning('请先选择数据表')
      return
    }

    try {
      await tagApi.createRuleTag({
        name: values.name,
        description: values.description,
        parent_id: values.parent_id || null,
        color: values.color || '#722ed1',
        rule_config: {
          datasource_id: selectedDatasource || undefined,
          source_table: selectedTable,
          sql_condition: values.condition,
          full_sql: values.sql,
        },
      })
      message.success('规则标签创建成功')
      ruleForm.resetFields()
      setSelectedTable(null)
      setTableColumns([])
      setRulePreviewData([])
      loadTree()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建失败')
    }
  }

  // 保存数据集标签
  const handleSaveDatasetTag = async (values: any) => {
    if (!values.source_tag_ids || values.source_tag_ids.length === 0) {
      message.warning('请选择至少一个源标签')
      return
    }

    try {
      await tagApi.createDatasetTag({
        name: values.name,
        description: values.description,
        parent_id: values.parent_id || null,
        color: values.color || '#fa8c16',
        source_tag_ids: values.source_tag_ids,
        filter_condition: values.filter_condition,
      })
      message.success('数据集标签创建成功')
      datasetForm.resetFields()
      loadTree()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建失败')
    }
  }

  // 预览规则数据
  const handlePreviewRule = async () => {
    const values = ruleForm.getFieldsValue()
    if (!selectedTable) {
      message.warning('请先选择数据表')
      return
    }

    setRulePreviewLoading(true)
    try {
      let sql = values.sql
      if (!sql) {
        sql = `SELECT * FROM ${selectedTable}${values.condition ? ` WHERE ${values.condition}` : ''} LIMIT 100`
      }

      const res = await warehouseApi.executeQuery({ sql, limit: 100 })
      if (res.data.columns && res.data.rows) {
        const data = res.data.rows.map((row: any[], idx: number) => {
          const obj: any = { key: idx }
          res.data.columns.forEach((col: string, i: number) => {
            obj[col] = row[i]
          })
          return obj
        })
        setRulePreviewData(data)
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '预览失败')
    } finally {
      setRulePreviewLoading(false)
    }
  }

  // 行级标签 - 创建任务
  const handleCreateRowTag = async () => {
    const values = rowTagForm.getFieldsValue()

    // 验证标签字段配置
    const validTagFields = tagFields.filter(f => f.name && f.typeId)
    if (!selectedTable || selectedColumns.length === 0 || validTagFields.length === 0) {
      message.warning('请完成所有配置：选择数据表、源字段，并创建至少一个标签字段')
      return
    }

    try {
      const res = await tagApi.createRowTag({
        name: values.name || `行级标签_${selectedTable}`,
        description: values.description,
        color: '#52c41a',
        datasource_id: selectedDatasource || undefined,
        source_table: selectedTable,
        source_columns: selectedColumns,
        tag_fields: validTagFields.map(f => ({
          name: f.name,
          description: f.description,
          type_id: f.typeId,
        })),
      })
      message.success('行级标签任务创建成功')
      setCreatedRowTagId(res.data.id)
      setRowTagStep(3)
      loadTree()
      loadTypeNodes()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建失败')
    }
  }

  // 行级标签 - AI打标
  const handleAiTagging = async () => {
    if (!createdRowTagId) {
      message.warning('请先创建行级标签任务')
      return
    }

    setAiTagging(true)
    setAiProgress('正在启动AI打标任务...')

    try {
      await tagApi.executeRowTag(createdRowTagId, { batch_size: 100 })
      message.success('AI打标任务已启动，请稍后查看结果')

      // 重置状态
      setRowTagStep(0)
      setSelectedColumns([])
      setTagFields([])
      setCreatedRowTagId(null)
      rowTagForm.resetFields()
      loadTree()
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'AI打标失败')
    } finally {
      setAiTagging(false)
      setAiProgress('')
    }
  }

  // 转换为 antd Tree 数据格式
  const convertToTreeData = (nodes: TagNode[]): any[] => {
    return nodes.map(node => ({
      key: node.id,
      title: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
          <Space>
            {node.node_type === 'category' ? (
              <FolderOutlined style={{ color: node.color }} />
            ) : node.node_type === 'type' ? (
              <Tag color={node.color} style={{ margin: 0 }} icon={<DatabaseOutlined />}>{node.name}</Tag>
            ) : (
              <Tag color={node.color} style={{ margin: 0 }}>{node.name}</Tag>
            )}
            {node.node_type === 'category' && <span>{node.name}</span>}
            {node.rule_type === 'sql' && (
              <Tooltip title="SQL规则标签">
                <FilterOutlined style={{ color: '#722ed1', fontSize: 12 }} />
              </Tooltip>
            )}
            {node.rule_type === 'row' && (
              <Tooltip title="行级标签">
                <RobotOutlined style={{ color: '#52c41a', fontSize: 12 }} />
              </Tooltip>
            )}
            {node.rule_type === 'dataset' && (
              <Tooltip title="数据集标签">
                <FileSearchOutlined style={{ color: '#fa8c16', fontSize: 12 }} />
              </Tooltip>
            )}
          </Space>
          <Space size={4} onClick={e => e.stopPropagation()}>
            {node.node_type === 'tag' && node.usage_count > 0 && (
              <Tag color="green">{node.usage_count}</Tag>
            )}
            {node.tag_table_name && (
              <Tooltip title="预览数据">
                <Button
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => handlePreview(node)}
                />
              </Tooltip>
            )}
            {/* 标签下不能再添加子节点 */}
            {node.node_type !== 'tag' && (
              <Tooltip title={node.node_type === 'type' ? '添加标签' : '添加子节点'}>
                <Button
                  type="text"
                  size="small"
                  icon={<PlusCircleOutlined />}
                  onClick={() => openModal(node.node_type === 'type' ? 'tag' : 'category', node)}
                />
              </Tooltip>
            )}
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openModal(node.node_type, undefined, node)}
            />
            <Popconfirm
              title={node.children?.length ? "将同时删除所有子节点，确定？" : "确定删除？"}
              onConfirm={() => handleDelete(node)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        </div>
      ),
      children: node.children?.length ? convertToTreeData(node.children) : undefined,
      isLeaf: !node.children?.length && node.node_type === 'tag',
    }))
  }

  // 递归渲染分类选项
  const renderCategoryOptions = (node: TagNode): React.ReactNode => {
    if (node.node_type !== 'category') return null
    return (
      <React.Fragment key={node.id}>
        <Select.Option value={node.id}>
          <Space>
            <span style={{ paddingLeft: (node.level - 1) * 16 }}>
              <FolderOutlined style={{ color: node.color }} />
            </span>
            {node.name}
          </Space>
        </Select.Option>
        {node.children?.map(child => renderCategoryOptions(child))}
      </React.Fragment>
    )
  }

  // 渲染标签树
  const renderTree = () => (
    <Card
      title={<Space><ApartmentOutlined /> 标签体系</Space>}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadTree} loading={loading}>刷新</Button>
          <Button icon={<PlusOutlined />} onClick={() => openModal('category')}>新建分类</Button>
          <Button icon={<PlusOutlined />} onClick={() => openModal('type')}>新建类型</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal('tag')}>新建标签</Button>
        </Space>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : treeData.length === 0 ? (
        <Empty description="暂无标签，点击右上角新建">
          <Space>
            <Button icon={<PlusOutlined />} onClick={() => openModal('category')}>新建分类</Button>
            <Button icon={<PlusOutlined />} onClick={() => openModal('type')}>新建类型</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal('tag')}>新建标签</Button>
          </Space>
        </Empty>
      ) : (
        <Tree
          showLine={{ showLeafIcon: false }}
          showIcon
          blockNode
          expandedKeys={expandedKeys}
          onExpand={setExpandedKeys}
          treeData={convertToTreeData(treeData)}
          style={{ fontSize: 14 }}
        />
      )}
    </Card>
  )

  // 渲染规则标签
  const renderRuleTag = () => (
    <Card title={<Space><FilterOutlined /> 规则标签</Space>}>
      <Tabs
        activeKey={ruleTabKey}
        onChange={setRuleTabKey}
        items={[
          {
            key: 'sql',
            label: <Space><FilterOutlined />SQL逻辑标签</Space>,
            children: (
              <Row gutter={24}>
                <Col span={12}>
                  <Form form={ruleForm} layout="vertical" onFinish={handleSaveRuleTag}>
                    <Form.Item label="数据来源">
                      <Radio.Group
                        value={dataSourceMode}
                        onChange={e => {
                          setDataSourceMode(e.target.value)
                          if (e.target.value === 'warehouse') {
                            setSelectedDatasource(null)
                            loadWarehouseTables()
                          } else {
                            setSelectedDatasource(null)
                            setTables([])
                          }
                          setSelectedTable(null)
                          setTableColumns([])
                          setRulePreviewData([])
                        }}
                      >
                        <Radio.Button value="warehouse">平台数据仓库</Radio.Button>
                        <Radio.Button value="datasource">外部数据源</Radio.Button>
                      </Radio.Group>
                    </Form.Item>

                    {dataSourceMode === 'datasource' && (
                      <Form.Item label="选择数据源" extra={datasources.length === 0 ? '暂无可用数据源' : `共 ${datasources.length} 个数据源`}>
                        <Select
                          placeholder="选择数据源"
                          value={selectedDatasource || undefined}
                          onChange={(val) => {
                            setSelectedDatasource(val)
                            loadTables(val)
                            setSelectedTable(null)
                            setTableColumns([])
                          }}
                          notFoundContent={datasources.length === 0 ? '暂无数据源' : null}
                        >
                          {datasources.map(ds => (
                            <Select.Option key={ds.id} value={ds.id}>{ds.name}</Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                    )}

                    <Form.Item label="选择数据表" required>
                      <Select
                        placeholder="选择数据表"
                        showSearch
                        value={selectedTable || undefined}
                        onChange={(val) => {
                          setSelectedTable(val)
                          if (selectedDatasource) {
                            loadTableColumns(selectedDatasource, val)
                          } else {
                            loadWarehouseTableColumns(val)
                          }
                          setRulePreviewData([])
                        }}
                      >
                        {tables.map(t => (
                          <Select.Option key={t} value={t}>{t}</Select.Option>
                        ))}
                      </Select>
                    </Form.Item>

                    {tableColumns.length > 0 && (
                      <Form.Item label="表字段参考">
                        <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 120, overflow: 'auto' }}>
                          <Space wrap size={4}>
                            {tableColumns.map(col => (
                              <Tag
                                key={col.name}
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  const current = ruleForm.getFieldValue('condition') || ''
                                  ruleForm.setFieldValue('condition', current + col.name)
                                }}
                              >
                                {col.name} <Text type="secondary" style={{ fontSize: 10 }}>({col.data_type})</Text>
                              </Tag>
                            ))}
                          </Space>
                        </div>
                      </Form.Item>
                    )}

                    <Form.Item name="condition" label="筛选条件" extra="WHERE 后面的条件，如：amount > 10000">
                      <TextArea rows={2} placeholder="amount > 10000 AND status = 'active'" />
                    </Form.Item>

                    <Form.Item name="sql" label="完整SQL（可选）" extra="留空则自动根据表和条件生成">
                      <TextArea rows={3} placeholder="SELECT * FROM table WHERE ..." />
                    </Form.Item>

                    <Form.Item>
                      <Button icon={<PlayCircleOutlined />} onClick={handlePreviewRule} loading={rulePreviewLoading}>
                        预览数据
                      </Button>
                    </Form.Item>

                    <Form.Item name="name" label="标签名称" rules={[{ required: true }]}>
                      <Input placeholder="如：高价值客户、活跃用户" />
                    </Form.Item>

                    <Form.Item name="description" label="描述">
                      <TextArea rows={2} placeholder="标签描述" />
                    </Form.Item>

                    <Form.Item name="parent_id" label="所属分类">
                      <Select placeholder="选择父节点（可选）" allowClear>
                        {treeData.map(node => renderCategoryOptions(node))}
                      </Select>
                    </Form.Item>

                    <Form.Item name="color" label="颜色" initialValue="#722ed1">
                      <Input type="color" style={{ width: 80 }} />
                    </Form.Item>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                        保存为规则标签
                      </Button>
                    </Form.Item>
                  </Form>
                </Col>
                <Col span={12}>
                  <Card title="数据预览" size="small">
                    {rulePreviewLoading ? (
                      <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                    ) : rulePreviewData.length > 0 ? (
                      <Table
                        dataSource={rulePreviewData}
                        columns={Object.keys(rulePreviewData[0] || {}).filter(k => k !== 'key').map(k => ({
                          title: k,
                          dataIndex: k,
                          key: k,
                          ellipsis: true,
                          width: 120,
                        }))}
                        size="small"
                        scroll={{ x: 'max-content', y: 400 }}
                        pagination={{ pageSize: 10, size: 'small' }}
                      />
                    ) : (
                      <Empty description="点击预览按钮查看数据" />
                    )}
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'dataset',
            label: <Space><FileSearchOutlined />数据集标签</Space>,
            children: (
              <Row gutter={24}>
                <Col span={12}>
                  <Alert
                    message="数据集标签"
                    description="从已有的标签数据中筛选，形成新的数据集并打上新标签"
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <Form form={datasetForm} layout="vertical" onFinish={handleSaveDatasetTag}>
                    <Form.Item
                      name="source_tag_ids"
                      label="选择源标签"
                      rules={[{ required: true, message: '请选择至少一个源标签' }]}
                      extra="选择已有的标签，合并这些标签的数据"
                    >
                      <Select mode="multiple" placeholder="选择已有标签">
                        {flatTags.filter(t => t.tag_table_name).map(tag => (
                          <Select.Option key={tag.id} value={tag.id}>
                            <Tag color={tag.color}>{tag.name}</Tag>
                            {tag.usage_count > 0 && <Text type="secondary">({tag.usage_count}条)</Text>}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>

                    <Form.Item name="filter_condition" label="额外筛选条件（可选）">
                      <TextArea rows={2} placeholder="如：ai_confidence > 80" />
                    </Form.Item>

                    <Form.Item name="name" label="新标签名称" rules={[{ required: true }]}>
                      <Input placeholder="如：高质量客户群、核心用户" />
                    </Form.Item>

                    <Form.Item name="description" label="描述">
                      <TextArea rows={2} placeholder="标签描述" />
                    </Form.Item>

                    <Form.Item name="parent_id" label="所属分类">
                      <Select placeholder="选择父节点（可选）" allowClear>
                        {treeData.map(node => renderCategoryOptions(node))}
                      </Select>
                    </Form.Item>

                    <Form.Item name="color" label="颜色" initialValue="#fa8c16">
                      <Input type="color" style={{ width: 80 }} />
                    </Form.Item>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                        创建数据集标签
                      </Button>
                    </Form.Item>
                  </Form>
                </Col>
                <Col span={12}>
                  <Card title="已有标签数据" size="small">
                    {flatTags.filter(t => t.tag_table_name).length === 0 ? (
                      <Empty description="暂无可用的标签数据，请先创建行级标签或SQL标签" />
                    ) : (
                      <Table
                        dataSource={flatTags.filter(t => t.tag_table_name).map(t => ({ ...t, key: t.id }))}
                        columns={[
                          {
                            title: '标签',
                            dataIndex: 'name',
                            render: (name: string, record: TagNode) => <Tag color={record.color}>{name}</Tag>,
                          },
                          { title: '类型', dataIndex: 'rule_type', render: (v: string) => v || 'manual' },
                          { title: '数据量', dataIndex: 'usage_count' },
                          {
                            title: '操作',
                            render: (_: any, record: TagNode) => (
                              <Button size="small" icon={<EyeOutlined />} onClick={() => handlePreview(record)}>
                                预览
                              </Button>
                            ),
                          },
                        ]}
                        size="small"
                        pagination={{ pageSize: 5 }}
                      />
                    )}
                  </Card>
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </Card>
  )

  // 渲染行级标签
  const renderRowTag = () => (
    <Card title={<Space><RobotOutlined /> 行级标签（AI打标）</Space>}>
      <Steps
        current={rowTagStep}
        items={[
          { title: '选择数据表' },
          { title: '配置字段' },
          { title: '选择分类' },
          { title: 'AI打标' },
        ]}
        style={{ marginBottom: 24 }}
      />

      {rowTagStep === 0 && (
        <div>
          <Form form={rowTagForm} layout="vertical">
            <Form.Item label="数据来源">
              <Radio.Group
                value={dataSourceMode}
                onChange={e => {
                  setDataSourceMode(e.target.value)
                  if (e.target.value === 'warehouse') {
                    setSelectedDatasource(null)
                    loadWarehouseTables()
                  } else {
                    setSelectedDatasource(null)
                    setTables([])
                  }
                  setSelectedTable(null)
                  setTableColumns([])
                }}
              >
                <Radio.Button value="warehouse">平台数据仓库</Radio.Button>
                <Radio.Button value="datasource">外部数据源</Radio.Button>
              </Radio.Group>
            </Form.Item>

            {dataSourceMode === 'datasource' && (
              <Form.Item label="选择数据源" extra={datasources.length === 0 ? '暂无可用数据源，请先在数据源管理中添加' : `共 ${datasources.length} 个数据源`}>
                <Select
                  placeholder="选择数据源"
                  style={{ width: 300 }}
                  value={selectedDatasource || undefined}
                  onChange={(val) => {
                    setSelectedDatasource(val)
                    loadTables(val)
                    setSelectedTable(null)
                    setTableColumns([])
                  }}
                  notFoundContent={datasources.length === 0 ? '暂无数据源' : null}
                >
                  {datasources.map(ds => (
                    <Select.Option key={ds.id} value={ds.id}>{ds.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}

            <Form.Item label="选择数据表">
              <Select
                placeholder="选择数据表"
                showSearch
                style={{ width: 300 }}
                value={selectedTable || undefined}
                onChange={(val) => {
                  setSelectedTable(val)
                  if (selectedDatasource) {
                    loadTableColumns(selectedDatasource, val)
                  } else {
                    loadWarehouseTableColumns(val)
                  }
                }}
              >
                {tables.map(t => (
                  <Select.Option key={t} value={t}>{t}</Select.Option>
                ))}
              </Select>
            </Form.Item>

            {tableColumns.length > 0 && (
              <Card title="表结构" size="small" style={{ marginTop: 16 }}>
                <Table
                  dataSource={tableColumns.map((c, i) => ({ ...c, key: i }))}
                  columns={[
                    { title: '字段名', dataIndex: 'name' },
                    { title: '类型', dataIndex: 'data_type' },
                    { title: '说明', dataIndex: 'comment', render: (v: string) => v || '-' },
                  ]}
                  size="small"
                  pagination={false}
                />
              </Card>
            )}
          </Form>
          <div style={{ marginTop: 24 }}>
            <Button
              type="primary"
              disabled={!selectedTable || tableColumns.length === 0}
              onClick={() => setRowTagStep(1)}
            >
              下一步：配置字段
            </Button>
          </div>
        </div>
      )}

      {rowTagStep === 1 && (
        <div>
          <Row gutter={24}>
            <Col span={10}>
              <Card title="选择源字段" size="small" extra={<Text type="secondary">AI将分析这些字段</Text>}>
                <Checkbox.Group
                  value={selectedColumns}
                  onChange={(vals) => setSelectedColumns(vals as string[])}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {tableColumns.map(col => (
                    <Checkbox key={col.name} value={col.name}>
                      {col.name} <Text type="secondary">({col.data_type})</Text>
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              </Card>
            </Col>
            <Col span={14}>
              <Card
                title="创建标签字段"
                size="small"
                extra={
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setTagFields([...tagFields, { name: '', description: '', typeId: null }])}
                  >
                    添加字段
                  </Button>
                }
              >
                <Alert
                  message="标签字段说明"
                  description="每个标签字段绑定一个类型，AI分析后从该类型的标签中选择值写入此字段"
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                />
                {tagFields.length === 0 ? (
                  <Empty description="点击添加按钮创建标签字段" />
                ) : (
                  tagFields.map((field, idx) => (
                    <div key={idx} style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 4 }}>
                      <Row gutter={8} align="middle">
                        <Col span={6}>
                          <Input
                            placeholder="字段名"
                            value={field.name}
                            onChange={e => {
                              const newFields = [...tagFields]
                              newFields[idx].name = e.target.value
                              setTagFields(newFields)
                            }}
                          />
                        </Col>
                        <Col span={10}>
                          <Select
                            placeholder="绑定标签类型"
                            style={{ width: '100%' }}
                            value={field.typeId || undefined}
                            onChange={(val) => {
                              const newFields = [...tagFields]
                              newFields[idx].typeId = val
                              setTagFields(newFields)
                            }}
                          >
                            {typeNodesWithTags.map(typeNode => (
                              <Select.Option key={typeNode.id} value={typeNode.id}>
                                <Tag color={typeNode.color}>{typeNode.name}</Tag>
                                <Text type="secondary">({typeNode.tags.length}个标签)</Text>
                              </Select.Option>
                            ))}
                          </Select>
                        </Col>
                        <Col span={6}>
                          <Input
                            placeholder="描述（可选）"
                            value={field.description}
                            onChange={e => {
                              const newFields = [...tagFields]
                              newFields[idx].description = e.target.value
                              setTagFields(newFields)
                            }}
                          />
                        </Col>
                        <Col span={2}>
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => setTagFields(tagFields.filter((_, i) => i !== idx))}
                          />
                        </Col>
                      </Row>
                      {field.typeId && (
                        <div style={{ marginTop: 8, marginLeft: 4 }}>
                          <Text type="secondary">可选值: </Text>
                          <Space wrap size={4}>
                            {typeNodesWithTags.find(t => t.id === field.typeId)?.tags.map(tag => (
                              <Tag key={tag.id} color={tag.color}>{tag.name}</Tag>
                            ))}
                          </Space>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </Card>
            </Col>
          </Row>
          <div style={{ marginTop: 24 }}>
            <Space>
              <Button onClick={() => setRowTagStep(0)}>上一步</Button>
              <Button
                type="primary"
                disabled={selectedColumns.length === 0 || tagFields.length === 0 || tagFields.some(f => !f.name || !f.typeId)}
                onClick={() => setRowTagStep(2)}
              >
                下一步：确认配置
              </Button>
            </Space>
          </div>
        </div>
      )}

      {rowTagStep === 2 && (
        <div>
          <Row gutter={24}>
            <Col span={12}>
              <Card title="任务信息" size="small">
                <Form form={rowTagForm} layout="vertical">
                  <Form.Item name="name" label="任务名称" rules={[{ required: true }]}>
                    <Input placeholder="如：客户情感分析、评论分类" />
                  </Form.Item>
                  <Form.Item name="description" label="描述">
                    <TextArea rows={2} placeholder="任务描述" />
                  </Form.Item>
                </Form>
              </Card>
            </Col>
            <Col span={12}>
              <Card title="配置预览" size="small">
                <Descriptions bordered size="small" column={1}>
                  <Descriptions.Item label="数据表">{selectedTable}</Descriptions.Item>
                  <Descriptions.Item label="数据源">{dataSourceMode === 'warehouse' ? '平台数据仓库' : datasources.find(d => d.id === selectedDatasource)?.name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="分析字段">{selectedColumns.join(', ')}</Descriptions.Item>
                  <Descriptions.Item label="标签字段">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {tagFields.filter(f => f.name && f.typeId).map((field, idx) => {
                        const typeNode = typeNodesWithTags.find(t => t.id === field.typeId)
                        return (
                          <div key={idx}>
                            <Text strong>{field.name}</Text>
                            <Text type="secondary"> → </Text>
                            {typeNode && <Tag color={typeNode.color}>{typeNode.name}</Tag>}
                          </div>
                        )
                      })}
                    </div>
                  </Descriptions.Item>
                </Descriptions>

                <Alert
                  message="目标表结构预览"
                  description={
                    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      <div>id BIGINT PRIMARY KEY</div>
                      <div>source_row_id VARCHAR(255)</div>
                      {selectedColumns.map(col => <div key={col}>{col} TEXT</div>)}
                      {tagFields.filter(f => f.name).map(f => <div key={f.name} style={{ color: '#52c41a' }}>{f.name} VARCHAR(255) -- 标签字段</div>)}
                      <div>ai_confidence INT</div>
                      <div>created_at DATETIME</div>
                    </div>
                  }
                  type="info"
                  style={{ marginTop: 16 }}
                />
              </Card>
            </Col>
          </Row>
          <div style={{ marginTop: 24 }}>
            <Space>
              <Button onClick={() => setRowTagStep(1)}>上一步</Button>
              <Button
                type="primary"
                onClick={handleCreateRowTag}
              >
                创建任务并进入打标
              </Button>
            </Space>
          </div>
        </div>
      )}

      {rowTagStep === 3 && (
        <div>
          <Card title="配置确认" size="small">
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="数据表">{selectedTable}</Descriptions.Item>
              <Descriptions.Item label="数据源">{dataSourceMode === 'warehouse' ? '平台数据仓库' : datasources.find(d => d.id === selectedDatasource)?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="分析字段">{selectedColumns.join(', ')}</Descriptions.Item>
              <Descriptions.Item label="标签字段">
                {tagFields.filter(f => f.name && f.typeId).map((field, idx) => {
                  const typeNode = typeNodesWithTags.find(t => t.id === field.typeId)
                  return (
                    <div key={idx}>
                      <Text code>{field.name}</Text>
                      <Text type="secondary"> 绑定类型: </Text>
                      {typeNode && <Tag color={typeNode.color}>{typeNode.name}</Tag>}
                    </div>
                  )
                })}
              </Descriptions.Item>
              <Descriptions.Item label="任务ID">{createdRowTagId}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Alert
            message="AI打标说明"
            description="点击开始后，系统将读取表数据，调用AI分析每行内容，从预定义的标签中选择最匹配的标签并写入结果表。处理过程可能需要几分钟，请耐心等待。"
            type="info"
            showIcon
            style={{ marginTop: 16 }}
          />

          {aiTagging && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
              <div style={{ marginTop: 16 }}>{aiProgress}</div>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <Space>
              <Button onClick={() => setRowTagStep(2)} disabled={aiTagging}>上一步</Button>
              <Button
                type="primary"
                icon={<RobotOutlined />}
                onClick={handleAiTagging}
                loading={aiTagging}
              >
                开始AI打标
              </Button>
            </Space>
          </div>
        </div>
      )}
    </Card>
  )

  return (
    <Layout style={{ height: '100vh', background: '#f0f2f5' }}>
      {/* 顶部导航 */}
      <Header style={{ background: '#1a1a1a', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>
              <TagsOutlined />
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>标签管理平台</span>
          </div>
          <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/')} style={{ color: 'rgba(255,255,255,0.7)' }}>
            返回首页
          </Button>
        </div>
        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar size={26} icon={<UserOutlined />} style={{ background: '#11998e' }} />
            <span style={{ color: '#fff', fontSize: 13 }}>{user?.username || 'User'}</span>
          </div>
        </Dropdown>
      </Header>

      <Layout>
        {/* 左侧菜单 */}
        <Sider width={200} style={{ background: '#fff' }}>
          <div style={{ padding: '16px 0' }}>
            <div
              style={{
                padding: '12px 24px',
                cursor: 'pointer',
                background: currentModule === 'tree' ? '#e6f7ff' : 'transparent',
                borderRight: currentModule === 'tree' ? '3px solid #1890ff' : 'none',
              }}
              onClick={() => setCurrentModule('tree')}
            >
              <Space><ApartmentOutlined /> 标签体系</Space>
            </div>
            <div
              style={{
                padding: '12px 24px',
                cursor: 'pointer',
                background: currentModule === 'rule' ? '#e6f7ff' : 'transparent',
                borderRight: currentModule === 'rule' ? '3px solid #1890ff' : 'none',
              }}
              onClick={() => setCurrentModule('rule')}
            >
              <Space><FilterOutlined /> 规则标签</Space>
            </div>
            <div
              style={{
                padding: '12px 24px',
                cursor: 'pointer',
                background: currentModule === 'rowTag' ? '#e6f7ff' : 'transparent',
                borderRight: currentModule === 'rowTag' ? '3px solid #1890ff' : 'none',
              }}
              onClick={() => setCurrentModule('rowTag')}
            >
              <Space><RobotOutlined /> 行级标签</Space>
            </div>
          </div>
        </Sider>

        <Content style={{ padding: 24, overflow: 'auto' }}>
          {/* 主内容 */}
          {currentModule === 'tree' && renderTree()}
          {currentModule === 'rule' && renderRuleTag()}
          {currentModule === 'rowTag' && renderRowTag()}
        </Content>
      </Layout>

      {/* 新建/编辑节点弹窗 */}
      <Modal
        title={editingNode ? '编辑节点' : `新建${modalType === 'category' ? '分类' : modalType === 'type' ? '类型' : '标签'}`}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Alert
            message="层级规则"
            description={
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li><b>分类</b>: 可以包含分类、类型或标签</li>
                <li><b>类型</b>: 相当于字段名，只能包含标签</li>
                <li><b>标签</b>: 相当于字段值，不能再添加子节点</li>
              </ul>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          {parentNode && (
            <Form.Item label="父节点">
              <Input value={parentNode.name} disabled prefix={<FolderOutlined />} />
            </Form.Item>
          )}
          <Form.Item name="node_type" label="节点类型" rules={[{ required: true }]}>
            <Radio.Group disabled={!!editingNode}>
              <Radio.Button value="category" disabled={parentNode?.node_type === 'type'}>
                <FolderOutlined /> 分类
              </Radio.Button>
              <Radio.Button value="type" disabled={parentNode?.node_type === 'type'}>
                <DatabaseOutlined /> 类型
              </Radio.Button>
              <Radio.Button value="tag"><TagsOutlined /> 标签</Radio.Button>
            </Radio.Group>
          </Form.Item>
          {parentNode?.node_type === 'type' && (
            <Alert
              message="类型节点下只能创建标签"
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder={modalType === 'category' ? '如：客户标签、订单标签' : '如：VIP客户、高价值订单'} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="节点描述（可选）" />
          </Form.Item>
          <Form.Item name="color" label="颜色" initialValue="#1890ff">
            <Input type="color" style={{ width: 80, height: 32, padding: 2 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 预览数据弹窗 */}
      <Modal
        title={`预览标签数据 - ${previewNode?.name || ''}`}
        open={previewModalVisible}
        onCancel={() => setPreviewModalVisible(false)}
        footer={null}
        width={900}
      >
        {previewLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : previewRows.length > 0 ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">共 {previewTotal} 条数据（显示前100条）</Text>
            </div>
            <Table
              dataSource={previewRows}
              columns={previewColumns.filter(k => k !== 'key').map(k => ({
                title: k,
                dataIndex: k,
                key: k,
                ellipsis: true,
                width: 120,
              }))}
              size="small"
              scroll={{ x: 'max-content', y: 400 }}
              pagination={{ pageSize: 10, size: 'small' }}
            />
          </>
        ) : (
          <Empty description="暂无数据" />
        )}
      </Modal>
    </Layout>
  )
}
