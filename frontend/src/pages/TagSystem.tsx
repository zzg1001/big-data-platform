import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Layout,
  Button,
  Avatar,
  Dropdown,
  Typography,
  Table,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Steps,
  message,
  Spin,
  Empty,
  Tooltip,
  Checkbox,
  Card,
  List,
  Splitter,
  Alert,
  Divider,
  Tabs,
} from 'antd'
import type React from 'react'
import {
  TagsOutlined,
  TagOutlined,
  HomeOutlined,
  UserOutlined,
  LogoutOutlined,
  RobotOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  PlusOutlined,
  LeftOutlined,
  PlayCircleOutlined,
  ScheduleOutlined,
  EyeOutlined,
  DeleteOutlined,
  EditOutlined,
  DragOutlined,
  AimOutlined,
  ClearOutlined,
  RightOutlined,
  DownOutlined,
  SaveOutlined,
  FolderOpenOutlined,
  MergeCellsOutlined,
  StarOutlined,
  TableOutlined,
  ReloadOutlined,
  SearchOutlined,
  CloseOutlined,
  CaretRightOutlined,
  ThunderboltOutlined,
  PicLeftOutlined,
  PicCenterOutlined,
  DeploymentUnitOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { tagApi, warehouseApi, scheduleApi, aiApi } from '../services/api'
import Editor from '@monaco-editor/react'
import CronExpressionInput from '../components/CronExpressionInput'

const { Header, Content } = Layout
const { Title, Text } = Typography
const { TextArea } = Input

// 标签任务类型
type TaskType = 'ai' | 'sql' | 'dataset' | 'manage' | 'composite' | 'sql-editor' | 'graph' | null

// 任务状态
interface TagTask {
  id: number
  name: string
  description?: string
  node_type: string
  rule_type?: string
  source_table?: string
  source_datasource_id?: number
  usage_count: number
  created_at: string
  updated_at: string
  rule_config?: string
  color?: string
  is_scheduled?: boolean
}

// 画布上的节点
interface CanvasNode {
  id: number
  x: number
  y: number
  tag: any
}

// 连接线
interface Connection {
  fromId: number
  toId: number // toId 是父节点
}

export default function TagSystem() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  // 页面状态
  const [currentView, setCurrentView] = useState<TaskType>(null)
  const [loading, setLoading] = useState(false)
  const [tasks, setTasks] = useState<TagTask[]>([])
  const [statistics, setStatistics] = useState<any>(null)

  // 弹框状态
  const [modalVisible, setModalVisible] = useState(false)
  const [editingTask, setEditingTask] = useState<TagTask | null>(null)
  const [form] = Form.useForm()

  // 数据仓库表
  const [tables, setTables] = useState<string[]>([])
  const [loadingTables, setLoadingTables] = useState(false)

  // 执行状态
  const [executing, setExecuting] = useState<number | null>(null)

  // 预览弹框
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewData, setPreviewData] = useState<any[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)


  // 标签管理
  const [, setTagNodes] = useState<any[]>([])
  const [allTags, setAllTags] = useState<any[]>([]) // 扁平化的所有标签
  const [tagModalVisible, setTagModalVisible] = useState(false)
  const [editingTag, setEditingTag] = useState<any>(null)
  const [creatingParent, setCreatingParent] = useState<any>(null) // 创建子类时的父节点
  const [tagForm] = Form.useForm()

  // AI打标步骤
  const [aiStep, setAiStep] = useState(0)

  // 画布相关状态
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [connectingFrom, setConnectingFrom] = useState<number | null>(null)
  const [draggingNode, setDraggingNode] = useState<number | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  // 左侧列表折叠状态
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())

  // 保存布局相关
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const [layoutName, setLayoutName] = useState('')

  // AI生成SQL模式
  const [generatedSql, setGeneratedSql] = useState('')
  const [generatingSql, setGeneratingSql] = useState(false)
  const [sqlConfirmed, setSqlConfirmed] = useState(false)
  const [extractedTags, setExtractedTags] = useState<string[]>([])  // AI提取的标签

  // 调度相关
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false)
  const [schedulingTask, setSchedulingTask] = useState<TagTask | null>(null)
  const [cronExpression, setCronExpression] = useState('0 0 * * *')
  const [schedulingLoading, setSchedulingLoading] = useState(false)

  // 复合智能标签相关
  const [compositeModalVisible, setCompositeModalVisible] = useState(false)
  const [compositeStep, setCompositeStep] = useState(0)
  const [selectedTags, setSelectedTags] = useState<TagTask[]>([])
  const [compositePrompt, setCompositePrompt] = useState('')
  const [compositeSql, setCompositeSql] = useState('')
  const [compositeSqlConfirmed, setCompositeSqlConfirmed] = useState(false)
  const [generatingCompositeSql, setGeneratingCompositeSql] = useState(false)
  const [compositeForm] = Form.useForm()
  const [compositeTags, setCompositeTags] = useState<TagTask[]>([]) // 有SQL规则的标签列表

  // SQL编辑器视图相关
  interface EditorTab {
    id: string
    title: string
    sql: string
  }
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([{ id: '1', title: 'SQL 1', sql: '' }])
  const [activeEditorTab, setActiveEditorTab] = useState('1')
  const [editorTabCounter, setEditorTabCounter] = useState(1)
  const [editorExecuting, setEditorExecuting] = useState(false)
  const [editorResult, setEditorResult] = useState<any>(null)
  const [editorTables, setEditorTables] = useState<string[]>([])
  const [editorFilteredTables, setEditorFilteredTables] = useState<string[]>([])
  const [editorSearchText, setEditorSearchText] = useState('')
  const [editorSelectedTable, setEditorSelectedTable] = useState<string | null>(null)
  const [editorTableColumns, setEditorTableColumns] = useState<any[]>([])
  const [editorTableData, setEditorTableData] = useState<any[]>([])
  const [editorLoadingTableInfo, setEditorLoadingTableInfo] = useState(false)
  const [editorResultPosition, setEditorResultPosition] = useState<'bottom' | 'right'>('bottom')
  const [editorActiveResultTab, setEditorActiveResultTab] = useState('result')
  const [editorAiLoading, setEditorAiLoading] = useState(false)
  const [saveTagModalVisible, setSaveTagModalVisible] = useState(false)
  const [saveTagForm] = Form.useForm()
  const editorRef = useRef<any>(null)
  const editorTabsRef = useRef(editorTabs)
  const activeEditorTabRef = useRef(activeEditorTab)

  // Graph Intelligence 相关状态
  const [graphModalVisible, setGraphModalVisible] = useState(false)
  const [graphStep, setGraphStep] = useState(0)
  const [graphForm] = Form.useForm()
  const [graphTasks, setGraphTasks] = useState<TagTask[]>([])
  const [graphGenerating, setGraphGenerating] = useState(false)
  const [graphPreviewData, setGraphPreviewData] = useState<{ nodes: any[], edges: any[] } | null>(null)

  // 保持ref同步
  useEffect(() => {
    editorTabsRef.current = editorTabs
    activeEditorTabRef.current = activeEditorTab
  }, [editorTabs, activeEditorTab])

  // 当前Tab的SQL
  const currentEditorTab = editorTabs.find(t => t.id === activeEditorTab)
  const editorSql = currentEditorTab?.sql || ''
  const setEditorSql = (newSql: string) => {
    setEditorTabs(tabs => tabs.map(t =>
      t.id === activeEditorTab ? { ...t, sql: newSql } : t
    ))
  }


  useEffect(() => {
    loadStatistics()

    // 检查是否有要加载的布局
    const layoutToLoad = sessionStorage.getItem('loadLayout')
    if (layoutToLoad) {
      sessionStorage.removeItem('loadLayout')
      setCurrentView('manage')
      // 延迟加载布局，等待标签数据加载完成
      setTimeout(() => {
        try {
          const layout = JSON.parse(layoutToLoad)
          loadLayoutData(layout)
        } catch (e) {
          console.error('Failed to load layout', e)
        }
      }, 500)
    }
  }, [])

  useEffect(() => {
    if (currentView) {
      if (currentView === 'manage') {
        loadTagNodes()
      } else if (currentView === 'composite') {
        loadTasks()
        loadCompositeTags()
      } else if (currentView === 'sql-editor') {
        loadEditorTables()
      } else if (currentView === 'graph') {
        loadGraphTasks()
        loadTables()
      } else {
        loadTasks()
        loadTables()
      }
    }
  }, [currentView])

  // SQL编辑器：加载表列表
  const loadEditorTables = async () => {
    try {
      const res = await warehouseApi.getTables()
      setEditorTables(res.data || [])
      setEditorFilteredTables(res.data || [])
    } catch (error) {
      console.error('Failed to load tables')
    }
  }

  // SQL编辑器：搜索表
  useEffect(() => {
    if (editorSearchText) {
      setEditorFilteredTables(editorTables.filter(t => t.toLowerCase().includes(editorSearchText.toLowerCase())))
    } else {
      setEditorFilteredTables(editorTables)
    }
  }, [editorSearchText, editorTables])

  // SQL编辑器：选择表并加载结构
  const handleEditorSelectTable = async (tableName: string) => {
    setEditorSelectedTable(tableName)
    setEditorSql(`SELECT * FROM ${tableName} LIMIT 100;`)
    setEditorLoadingTableInfo(true)
    try {
      // 加载表结构
      const structRes = await warehouseApi.getTableMetadata(tableName)
      setEditorTableColumns(structRes.data.columns || [])
      // 加载预览数据
      const dataRes = await warehouseApi.previewTable(tableName, 100)
      setEditorTableData(dataRes.data.rows || [])
    } catch (error) {
      console.error('Failed to load table info')
    } finally {
      setEditorLoadingTableInfo(false)
    }
  }

  // SQL编辑器：Tab管理
  const addEditorTab = () => {
    const newId = String(editorTabCounter + 1)
    setEditorTabCounter(editorTabCounter + 1)
    setEditorTabs([...editorTabs, { id: newId, title: `SQL ${editorTabCounter + 1}`, sql: '' }])
    setActiveEditorTab(newId)
  }

  const closeEditorTab = (id: string) => {
    if (editorTabs.length <= 1) return
    const newTabs = editorTabs.filter(t => t.id !== id)
    setEditorTabs(newTabs)
    if (activeEditorTab === id) {
      setActiveEditorTab(newTabs[0].id)
    }
  }

  const getEditorTabContextMenu = (tabId: string) => {
    const idx = editorTabs.findIndex(t => t.id === tabId)
    const hasTabsToRight = idx < editorTabs.length - 1
    return {
      items: [
        { key: 'close', label: '关闭当前', disabled: editorTabs.length <= 1, onClick: () => closeEditorTab(tabId) },
        { key: 'closeRight', label: '关闭右侧', disabled: !hasTabsToRight, onClick: () => {
          const newTabs = editorTabs.slice(0, idx + 1)
          setEditorTabs(newTabs)
          if (!newTabs.find(t => t.id === activeEditorTab)) setActiveEditorTab(tabId)
        }},
        { key: 'closeAll', label: '关闭全部', onClick: () => {
          setEditorTabs([{ id: '1', title: 'SQL 1', sql: '' }])
          setActiveEditorTab('1')
          setEditorTabCounter(1)
        }},
      ],
    }
  }

  // SQL编辑器：执行SQL
  const handleEditorExecute = async () => {
    if (!editorSql.trim()) {
      message.warning('请输入SQL')
      return
    }
    setEditorExecuting(true)
    setEditorResult(null)
    setEditorActiveResultTab('result')
    try {
      const res = await warehouseApi.executeQuery({
        sql: editorSql.trim(),
        limit: 1000,
      })
      setEditorResult(res.data)
      message.success(`查询成功，返回 ${res.data.row_count} 行`)
    } catch (error: any) {
      setEditorResult({
        error: true,
        message: error.response?.data?.detail || '执行失败',
      })
    } finally {
      setEditorExecuting(false)
    }
  }

  // SQL编辑器：执行多条SQL（逐条执行）
  const handleEditorExecuteMultiple = async () => {
    if (!editorSql.trim()) {
      message.warning('请输入SQL')
      return
    }
    // 按分号分割SQL语句
    const statements = editorSql.split(';').map(s => s.trim()).filter(s => s.length > 0)
    if (statements.length === 0) {
      message.warning('请输入SQL')
      return
    }

    setEditorExecuting(true)
    setEditorResult(null)
    setEditorActiveResultTab('result')

    const results: any[] = []
    for (const sql of statements) {
      try {
        const res = await warehouseApi.executeQuery({ sql, limit: 1000 })
        results.push(res.data)
      } catch (error: any) {
        results.push({ error: true, message: error.response?.data?.detail || '执行失败' })
      }
    }

    if (results.length === 1) {
      setEditorResult(results[0])
    } else {
      setEditorResult({ multiple: true, results })
    }
    const successCount = results.filter((r: any) => !r.error).length
    message.success(`执行完成: ${successCount}/${results.length} 条成功`)
    setEditorExecuting(false)
  }

  // SQL编辑器：AI优化
  const handleEditorOptimize = async () => {
    if (!editorSql.trim()) {
      message.warning('请输入SQL')
      return
    }
    setEditorAiLoading(true)
    try {
      const res = await aiApi.optimize({ sql: editorSql })
      if (res.data.optimized_sql) {
        setEditorSql(res.data.optimized_sql)
        message.success('SQL已优化')
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'AI优化失败')
    } finally {
      setEditorAiLoading(false)
    }
  }

  // SQL编辑器：保存为标签
  const handleSaveAsTag = async () => {
    try {
      const values = await saveTagForm.validateFields()
      if (!editorSql.trim()) {
        message.error('请先输入SQL')
        return
      }
      await tagApi.createRuleTag({
        name: values.name,
        description: values.description,
        rule_config: {
          source_table: editorSelectedTable || '',
          full_sql: editorSql,
          source: 'sql',  // 标识为SQL规则手动创建
        } as any,
      })
      message.success('标签创建成功')
      setSaveTagModalVisible(false)
      saveTagForm.resetFields()
      setCurrentView('sql')  // 返回SQL规则列表
      loadTasks()
      loadStatistics()
    } catch (error: any) {
      if (error.errorFields) return
      message.error(error.response?.data?.detail || '创建失败')
    }
  }

  // 加载可用于复合智能标签的标签列表（有SQL规则的标签）
  const loadCompositeTags = async () => {
    try {
      const res = await tagApi.getTree()
      const allNodes: TagTask[] = []
      const flatten = (nodes: any[]) => {
        for (const node of nodes) {
          allNodes.push(node)
          if (node.children?.length) {
            flatten(node.children)
          }
        }
      }
      flatten(res.data || [])
      // 过滤出有SQL规则的标签
      const tagsWithSql = allNodes.filter(t => t.rule_type === 'sql' || t.rule_type === 'row')
      setCompositeTags(tagsWithSql)
    } catch (error) {
      console.error('Failed to load composite tags')
    }
  }

  // Graph Intelligence: 加载图标签任务
  const loadGraphTasks = async () => {
    setLoading(true)
    try {
      const res = await tagApi.getTree()
      const allNodes: TagTask[] = []
      const flatten = (nodes: any[]) => {
        for (const node of nodes) {
          allNodes.push(node)
          if (node.children?.length) {
            flatten(node.children)
          }
        }
      }
      flatten(res.data || [])
      // 过滤出图标签任务（rule_type === 'graph'）
      const graphNodes = allNodes.filter(t => t.rule_type === 'graph')
      setGraphTasks(graphNodes)
    } catch (error) {
      console.error('Failed to load graph tasks')
    } finally {
      setLoading(false)
    }
  }

  // Graph Intelligence: 打开创建弹框
  const handleOpenGraphCreate = () => {
    setGraphStep(0)
    setGraphPreviewData(null)
    graphForm.resetFields()
    setGraphModalVisible(true)
  }

  // Graph Intelligence: 生成图谱预览（模拟）
  const handleGenerateGraphPreview = async () => {
    try {
      await graphForm.validateFields(['source_table', 'entity_columns', 'relation_prompt'])
      setGraphGenerating(true)

      // 模拟AI生成图谱预览（实际需要后端API）
      await new Promise(resolve => setTimeout(resolve, 2000))

      // 模拟生成的节点和边
      setGraphPreviewData({
        nodes: [
          { id: '1', label: '用户A', type: 'user' },
          { id: '2', label: '用户B', type: 'user' },
          { id: '3', label: '商品X', type: 'product' },
          { id: '4', label: '商品Y', type: 'product' },
        ],
        edges: [
          { source: '1', target: '3', label: '购买' },
          { source: '1', target: '4', label: '收藏' },
          { source: '2', target: '3', label: '浏览' },
          { source: '2', target: '4', label: '购买' },
        ],
      })
      message.success('图谱预览生成成功')
      setGraphStep(1)
    } catch (error: any) {
      if (error.errorFields) return
      message.error('生成失败')
    } finally {
      setGraphGenerating(false)
    }
  }

  // Graph Intelligence: 保存图标签任务
  const handleSaveGraphTask = async () => {
    try {
      const values = await graphForm.validateFields()

      // 创建图标签任务（目前只是架子，实际需要后端支持）
      await tagApi.createRuleTag({
        name: values.name,
        description: values.description,
        rule_config: {
          source_table: values.source_table,
          entity_columns: values.entity_columns,
          relation_prompt: values.relation_prompt,
          source: 'graph',  // 标识为图标签
        } as any,
      })

      message.success('图标签任务创建成功')
      setGraphModalVisible(false)
      loadGraphTasks()
      loadStatistics()
    } catch (error: any) {
      if (error.errorFields) return
      message.error(error.response?.data?.detail || '创建失败')
    }
  }

  // 加载保存的布局数据
  const loadLayoutData = async (layout: any) => {
    try {
      // 先加载最新的标签数据
      const res = await tagApi.getTree()
      const treeData = res.data || []

      // 扁平化所有标签
      const flat: any[] = []
      const flattenTree = (nodes: any[], parentId?: number) => {
        for (const node of nodes) {
          flat.push({ ...node, parent_id: parentId })
          if (node.children?.length) {
            flattenTree(node.children, node.id)
          }
        }
      }
      flattenTree(treeData)
      setAllTags(flat)

      // 根据保存的布局恢复节点位置
      const restoredNodes: CanvasNode[] = []
      for (const savedNode of layout.nodes) {
        const tag = flat.find(t => t.id === savedNode.tagId || savedNode.id)
        if (tag) {
          restoredNodes.push({
            id: tag.id,
            x: savedNode.x,
            y: savedNode.y,
            tag,
          })
        }
      }

      setCanvasNodes(restoredNodes)
      setConnections(layout.connections || [])
      message.success(`已加载布局: ${layout.name}`)
    } catch (error) {
      message.error('加载布局失败')
    }
  }

  const loadStatistics = async () => {
    try {
      const res = await tagApi.getStatistics()
      setStatistics(res.data)
    } catch (error) {
      console.error('Failed to load statistics')
    }
  }

  const loadTagNodes = async () => {
    setLoading(true)
    try {
      const res = await tagApi.getTree()
      const treeData = res.data || []
      setTagNodes(treeData)

      // 扁平化所有标签
      const flat: any[] = []
      const flattenTree = (nodes: any[], parentId?: number) => {
        for (const node of nodes) {
          flat.push({ ...node, parent_id: parentId })
          if (node.children?.length) {
            flattenTree(node.children, node.id)
          }
        }
      }
      flattenTree(treeData)
      setAllTags(flat)

      // 初始化画布节点和连接 - 只放置没有父级的根节点
      const rootTags = flat.filter(t => !t.parent_id)
      const initialNodes: CanvasNode[] = rootTags.map((tag, idx) => ({
        id: tag.id,
        x: 100 + (idx % 4) * 180,
        y: 100 + Math.floor(idx / 4) * 140,
        tag,
      }))
      setCanvasNodes(initialNodes)

      // 初始化连接
      const initialConnections: Connection[] = flat
        .filter(t => t.parent_id)
        .map(t => ({ fromId: t.id, toId: t.parent_id }))
      setConnections(initialConnections)
    } catch (error) {
      message.error('加载标签失败')
    } finally {
      setLoading(false)
    }
  }

  const loadTasks = async () => {
    setLoading(true)
    try {
      // 使用 tree 接口获取所有节点，然后扁平化后过滤
      const res = await tagApi.getTree()
      const allNodes: TagTask[] = []

      // 递归扁平化树形数据
      const flatten = (nodes: any[]) => {
        for (const node of nodes) {
          allNodes.push(node)
          if (node.children?.length) {
            flatten(node.children)
          }
        }
      }
      flatten(res.data || [])

      // 根据当前视图过滤 - 每个功能只显示自己创建的任务
      if (currentView === 'ai') {
        // AI打标视图：只显示AI生成的任务（full_sql以 "-- TAGS:" 开头，或 source === 'ai'）
        setTasks(allNodes.filter((t) => {
          if (t.rule_type !== 'sql') return false
          if (t.rule_config) {
            try {
              const config = JSON.parse(t.rule_config)
              // 排除复合智能标签
              if (config.composite_tags) return false
              // AI打标的特征：full_sql以 "-- TAGS:" 开头 或 source === 'ai'
              const fullSql = config.full_sql || ''
              return fullSql.startsWith('-- TAGS:') || config.source === 'ai'
            } catch { /* ignore */ }
          }
          return false
        }))
      } else if (currentView === 'sql') {
        // SQL规则视图：只显示手动创建的SQL规则（不是AI生成的，也不是复合智能标签）
        setTasks(allNodes.filter((t) => {
          if (t.rule_type !== 'sql') return false
          if (t.rule_config) {
            try {
              const config = JSON.parse(t.rule_config)
              // 排除复合智能标签
              if (config.composite_tags) return false
              // 排除AI打标
              const fullSql = config.full_sql || ''
              if (fullSql.startsWith('-- TAGS:') || config.source === 'ai') return false
              // 排除复合智能标签的SQL
              if (fullSql.startsWith('-- 复合智能标签SQL')) return false
              return true
            } catch { /* ignore */ }
          }
          return true
        }))
      } else if (currentView === 'composite') {
        // 复合智能标签视图：只显示有composite_tags配置的SQL规则
        setTasks(allNodes.filter((t) => {
          if (t.rule_type !== 'sql') return false
          if (t.rule_config) {
            try {
              const config = JSON.parse(t.rule_config)
              return !!config.composite_tags
            } catch { /* ignore */ }
          }
          return false
        }))
      } else if (currentView === 'dataset') {
        setTasks(allNodes.filter((t) => t.rule_type === 'dataset'))
      }
    } catch (error) {
      message.error('加载任务失败')
    } finally {
      setLoading(false)
    }
  }

  const loadTables = async () => {
    setLoadingTables(true)
    try {
      const res = await warehouseApi.getTables()
      setTables(res.data || [])
    } catch (error) {
      console.error('Failed to load tables')
    } finally {
      setLoadingTables(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleOpenCreate = () => {
    setEditingTask(null)
    form.resetFields()
    setAiStep(0)
    setGeneratedSql('')
    setSqlConfirmed(false)
    setExtractedTags([])
    setModalVisible(true)
  }

  // 打开复合智能标签创建弹框
  const handleOpenCompositeCreate = () => {
    setCompositeStep(0)
    setSelectedTags([])
    setCompositePrompt('')
    setCompositeSql('')
    setCompositeSqlConfirmed(false)
    compositeForm.resetFields()
    setCompositeModalVisible(true)
  }

  // 复合智能标签：选择/取消选择标签
  const handleToggleTagSelection = (tag: TagTask) => {
    setSelectedTags(prev => {
      const isSelected = prev.some(t => t.id === tag.id)
      if (isSelected) {
        return prev.filter(t => t.id !== tag.id)
      } else {
        return [...prev, tag]
      }
    })
  }

  // 复合智能标签：生成SQL
  const handleGenerateCompositeSql = async () => {
    if (selectedTags.length < 2) {
      message.error('请至少选择两个标签')
      return
    }
    if (!compositePrompt.trim()) {
      message.error('请描述组合逻辑')
      return
    }
    setGeneratingCompositeSql(true)
    try {
      // 构建请求数据
      const tagInfos = selectedTags.map(t => ({
        id: t.id,
        name: t.name,
        source_table: t.source_table,
        rule_config: t.rule_config,
      }))
      const res = await tagApi.generateCompositeSql({
        tags: tagInfos,
        prompt: compositePrompt,
      })
      setCompositeSql(res.data?.sql || '')
      message.success('SQL已生成')
    } catch (error: any) {
      message.error(error.response?.data?.detail || '生成失败')
    } finally {
      setGeneratingCompositeSql(false)
    }
  }

  // 复合智能标签：下一步
  const handleCompositeNext = () => {
    if (compositeStep === 0) {
      if (selectedTags.length < 2) {
        message.error('请至少选择两个标签')
        return
      }
    } else if (compositeStep === 1) {
      if (!compositePrompt.trim()) {
        message.error('请描述组合逻辑')
        return
      }
    } else if (compositeStep === 2) {
      if (!compositeSqlConfirmed || !compositeSql) {
        message.error('请先生成并确认SQL')
        return
      }
    }
    setCompositeStep(compositeStep + 1)
  }

  // 复合智能标签：提交
  const handleCompositeSubmit = async () => {
    try {
      const values = await compositeForm.validateFields()
      if (!compositeSql) {
        message.error('请先生成SQL')
        return
      }
      // 创建复合智能标签
      await tagApi.createRuleTag({
        name: values.name,
        description: values.description || `由 ${selectedTags.map(t => t.name).join('、')} 组合生成`,
        rule_config: {
          source_table: selectedTags.map(t => t.source_table).filter(Boolean).join(', '),
          full_sql: compositeSql,
          composite_tags: selectedTags.map(t => ({ id: t.id, name: t.name })),
          source: 'composite',  // 标识为复合智能标签创建
        } as any,
      })
      message.success('复合智能标签创建成功')
      setCompositeModalVisible(false)
      loadTasks()
      loadStatistics()
    } catch (error: any) {
      if (error.errorFields) return
      message.error(error.response?.data?.detail || '创建失败')
    }
  }

  const handleDelete = async (id: number, taskName?: string) => {
    try {
      // 检查是否有关联的调度
      const schedulesRes = await scheduleApi.list()
      const relatedSchedule = (schedulesRes.data || []).find(
        (s: any) => s.dag_id === `tag_task_${id}` || s.name === `标签任务-${taskName}`
      )
      if (relatedSchedule) {
        message.warning('该任务已上调度，请先在调度管理中删除对应的调度')
        return
      }

      await tagApi.deleteNode(id)
      message.success('删除成功')
      loadTasks()
      loadStatistics()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      if (currentView === 'ai') {
        // AI生成SQL模式
        if (!generatedSql) {
          message.error('请先生成并确认SQL')
          return
        }
        // 将标签信息添加到SQL注释中
        const sqlWithTags = `-- TAGS: ${extractedTags.join(', ')}\n${generatedSql}`
        await tagApi.createRuleTag({
          name: values.name,
          description: values.sql_prompt,
          rule_config: {
            source_table: values.source_table,
            full_sql: sqlWithTags,
            source: 'ai',  // 标识为AI打标创建
          } as any,
        })
      } else if (currentView === 'sql') {
        // SQL 规则标签（从SQL规则入口进入）
        await tagApi.createRuleTag({
          name: values.name,
          description: values.description,
          parent_id: values.parent_id,
          color: values.color,
          rule_config: {
            source_table: values.source_table,
            full_sql: values.sql,
          },
        })
      }

      message.success(editingTask ? '更新成功' : '创建成功')
      setModalVisible(false)
      loadTasks()
      loadStatistics()
    } catch (error: any) {
      if (error.errorFields) return
      message.error(error.response?.data?.detail || '操作失败')
    }
  }

  const handleExecute = async (task: TagTask) => {
    setExecuting(task.id)
    try {
      if (task.rule_type === 'row') {
        // AI打标任务
        const res = await tagApi.executeRowTag(task.id, {})
        message.success(res.data?.message || 'AI打标任务已启动，后台执行中...')
        setTimeout(() => {
          message.info('执行完成后可点击"预览"查看打标结果')
        }, 2000)
      } else if (task.rule_type === 'sql') {
        // SQL规则标签：先检查是否需要生成SQL
        const ruleConfig = task.rule_config ? JSON.parse(task.rule_config) : {}
        if (ruleConfig.full_sql?.startsWith('-- AI_PROMPT:')) {
          // 需要先生成SQL
          message.loading('正在生成SQL...', 0)
          const genRes = await tagApi.generateRuleSql(task.id)
          message.destroy()
          if (genRes.data?.generated) {
            message.success('SQL已生成，正在执行...')
          }
        }
        // 执行SQL规则
        const res = await tagApi.executeRuleTag(task.id)
        message.success(`执行成功！已生成 ${res.data?.row_count || 0} 条数据`)
      }
      loadTasks()
    } catch (error: any) {
      message.destroy()
      message.error(error.response?.data?.detail || '执行失败')
    } finally {
      setExecuting(null)
    }
  }

  const handlePreview = async (task: TagTask) => {
    setPreviewLoading(true)
    setPreviewVisible(true)
    try {
      const res = await tagApi.previewTagData(task.id, 100)
      // 将 {columns, rows} 格式转换为对象数组
      const { columns = [], rows = [] } = res.data || {}
      const formattedData = rows.map((row: any[]) => {
        const obj: Record<string, any> = {}
        columns.forEach((col: string, index: number) => {
          obj[col] = row[index]
        })
        return obj
      })
      setPreviewData(formattedData)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '加载预览数据失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  // 打开调度弹框
  const handleOpenSchedule = (task: TagTask) => {
    setSchedulingTask(task)
    setCronExpression('0 0 * * *')
    setScheduleModalVisible(true)
  }

  // 创建调度任务并直接上线
  const handleCreateSchedule = async () => {
    if (!schedulingTask) return
    setSchedulingLoading(true)
    try {
      // 使用专门的标签调度API创建调度
      const res = await tagApi.createTagSchedule(schedulingTask.id, cronExpression)
      const scheduleId = res.data?.schedule_id

      // 自动部署上线
      if (scheduleId) {
        await scheduleApi.deploy(scheduleId)
      }

      message.success('上线成功')
      setScheduleModalVisible(false)
      // 刷新任务列表以更新按钮状态
      loadTasks()
      // 可选：跳转到调度管理页面查看
      Modal.confirm({
        title: '上线成功',
        content: `任务已上线 (DAG: ${res.data?.dag_id})，是否前往调度管理页面查看？`,
        onOk: () => navigate('/bigdata/scheduler'),
      })
    } catch (error: any) {
      message.error(error.response?.data?.detail || '上线失败')
    } finally {
      setSchedulingLoading(false)
    }
  }

  // 标签管理相关
  const handleOpenTagCreate = (parent?: any) => {
    setEditingTag(null)
    setCreatingParent(parent || null)
    tagForm.resetFields()

    // 如果有父节点，自动设置子类型
    if (parent) {
      if (parent.node_type === 'category') {
        tagForm.setFieldValue('node_type', 'type') // 默认创建类型
      } else if (parent.node_type === 'type') {
        tagForm.setFieldValue('node_type', 'tag') // 只能创建标签
      }
    }
    setTagModalVisible(true)
  }

  const handleEditTag = (tag: any) => {
    setEditingTag(tag)
    setCreatingParent(null)
    tagForm.setFieldsValue({
      name: tag.name,
      description: tag.description,
      node_type: tag.node_type,
      color: tag.color,
    })
    setTagModalVisible(true)
  }

  const handleTagSubmit = async () => {
    try {
      const values = await tagForm.validateFields()
      if (editingTag) {
        await tagApi.updateNode(editingTag.id, values)
        message.success('更新成功')
      } else {
        // 如果有父节点，添加 parent_id
        const createData = creatingParent
          ? { ...values, parent_id: creatingParent.id }
          : values

        const res = await tagApi.createNode(createData)
        message.success('创建成功')

        // 如果是在画布上创建子节点，自动添加到画布并建立连接
        if (creatingParent && res.data?.id) {
          const parentNode = canvasNodes.find(n => n.id === creatingParent.id)
          if (parentNode) {
            // 在父节点下方放置新节点
            const newNode: CanvasNode = {
              id: res.data.id,
              x: parentNode.x,
              y: parentNode.y + 120,
              tag: res.data,
            }
            setCanvasNodes(prev => [...prev, newNode])
            setConnections(prev => [...prev, { fromId: res.data.id, toId: creatingParent.id }])
          }
        }
      }
      setTagModalVisible(false)
      setCreatingParent(null)
      loadTagNodes()
      loadStatistics()
    } catch (error: any) {
      if (error.errorFields) return
      message.error(error.response?.data?.detail || '操作失败')
    }
  }

  const handleDeleteTag = async (id: number) => {
    try {
      await tagApi.deleteNode(id)
      message.success('删除成功')
      loadTagNodes()
      loadStatistics()
    } catch (error) {
      message.error('删除失败')
    }
  }

  // 画布：从列表拖拽标签到画布
  const handleDragStart = (e: React.DragEvent, tag: any) => {
    e.dataTransfer.setData('tag', JSON.stringify(tag))
  }

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const tagData = e.dataTransfer.getData('tag')
    if (!tagData) return

    const tag = JSON.parse(tagData)
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - 60 // 卡片宽度一半
    const y = e.clientY - rect.top - 40 // 卡片高度一半

    // 检查是否已在画布上
    if (canvasNodes.some(n => n.id === tag.id)) {
      message.warning('该标签已在画布上')
      return
    }

    setCanvasNodes(prev => [...prev, { id: tag.id, x, y, tag }])
  }

  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  // 画布：拖拽移动节点
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: number) => {
    if (connectingFrom !== null) return // 连线模式下不拖拽

    const node = canvasNodes.find(n => n.id === nodeId)
    if (!node) return

    setDraggingNode(nodeId)
    setDragOffset({
      x: e.clientX - node.x,
      y: e.clientY - node.y,
    })
  }

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingNode === null) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - dragOffset.x + canvas.scrollLeft
    const y = e.clientY - rect.top - dragOffset.y + canvas.scrollTop

    setCanvasNodes(prev =>
      prev.map(n => n.id === draggingNode ? { ...n, x: Math.max(0, x), y: Math.max(0, y) } : n)
    )
  }, [draggingNode, dragOffset])

  const handleCanvasMouseUp = () => {
    setDraggingNode(null)
  }

  // 画布：连线
  const handleStartConnect = (nodeId: number) => {
    if (connectingFrom === nodeId) {
      setConnectingFrom(null) // 取消
    } else if (connectingFrom !== null) {
      // 完成连线：connectingFrom 指向 nodeId（nodeId 成为父节点）
      if (connectingFrom !== nodeId) {
        // 检查是否会形成循环
        const wouldCycle = (childId: number, parentId: number): boolean => {
          if (childId === parentId) return true
          const parentConn = connections.find(c => c.fromId === parentId)
          if (parentConn) return wouldCycle(childId, parentConn.toId)
          return false
        }

        if (wouldCycle(nodeId, connectingFrom)) {
          message.error('不能形成循环关系')
        } else {
          // 移除旧的父级连接
          setConnections(prev => [
            ...prev.filter(c => c.fromId !== connectingFrom),
            { fromId: connectingFrom, toId: nodeId }
          ])
          // 更新后端
          updateTagParent(connectingFrom, nodeId)
        }
      }
      setConnectingFrom(null)
    } else {
      setConnectingFrom(nodeId)
    }
  }

  const updateTagParent = async (tagId: number, parentId: number) => {
    try {
      await tagApi.updateNode(tagId, { parent_id: parentId })
      message.success('关系已更新')
    } catch (error) {
      message.error('更新失败')
      loadTagNodes() // 回滚
    }
  }

  // 移除连接
  const handleRemoveConnection = async (fromId: number) => {
    try {
      await tagApi.updateNode(fromId, { parent_id: null })
      setConnections(prev => prev.filter(c => c.fromId !== fromId))
      message.success('已断开连接')
    } catch (error) {
      message.error('操作失败')
    }
  }

  // 从画布移除节点
  const handleRemoveFromCanvas = (nodeId: number) => {
    setCanvasNodes(prev => prev.filter(n => n.id !== nodeId))
    setConnections(prev => prev.filter(c => c.fromId !== nodeId && c.toId !== nodeId))
  }

  // 保存画布布局
  const handleSaveLayout = () => {
    if (!layoutName.trim()) {
      message.error('请输入布局名称')
      return
    }

    const layout = {
      id: Date.now().toString(),
      name: layoutName.trim(),
      createdAt: new Date().toISOString(),
      nodes: canvasNodes.map(n => ({
        id: n.id,
        x: n.x,
        y: n.y,
        tagId: n.tag.id,
        tagName: n.tag.name,
        nodeType: n.tag.node_type,
        color: n.tag.color,
      })),
      connections: connections,
    }

    // 保存到 localStorage
    const savedLayouts = JSON.parse(localStorage.getItem('tagLayouts') || '[]')
    savedLayouts.push(layout)
    localStorage.setItem('tagLayouts', JSON.stringify(savedLayouts))

    message.success('布局已保存')
    setSaveModalVisible(false)
    setLayoutName('')
  }

  // 跳转到布局管理页面
  const handleGoToLayouts = () => {
    navigate('/tag-layouts')
  }

  const userMenuItems = [
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
  ]

  // 卡片配置
  const taskCards = [
    {
      key: 'ai',
      title: 'AI打标',
      icon: <RobotOutlined style={{ fontSize: 32 }} />,
      description: '智能识别数据内容，自动打标签',
      color: '#1890ff',
      count: statistics?.ai_generated_count || 0,
    },
    {
      key: 'sql',
      title: 'SQL规则',
      icon: <FileTextOutlined style={{ fontSize: 32 }} />,
      description: '自定义SQL逻辑打标签',
      color: '#52c41a',
      count: statistics?.rule_tag_count || 0,
    },
    {
      key: 'composite',
      title: '复合智能标签',
      icon: <MergeCellsOutlined style={{ fontSize: 32 }} />,
      description: '组合多个标签，AI生成关联SQL',
      color: '#eb2f96',
      count: statistics?.composite_tag_count || 0,
    },
    {
      key: 'graph',
      title: 'Graph Intelligence',
      icon: <DeploymentUnitOutlined style={{ fontSize: 32 }} />,
      description: 'AI提取数据关系，构建知识图谱',
      color: '#13c2c2',
      count: statistics?.graph_tag_count || 0,
    },
    {
      key: 'dataset',
      title: '数据集',
      icon: <DatabaseOutlined style={{ fontSize: 32 }} />,
      description: '查看已打标的数据集',
      color: '#722ed1',
      count: statistics?.total_tagged_data || 0,
    },
    {
      key: 'manage',
      title: '标签管理',
      icon: <TagOutlined style={{ fontSize: 32 }} />,
      description: '管理标签分类和标签',
      color: '#fa8c16',
      count: statistics?.tag_count || 0,
    },
  ]

  // 渲染首页卡片
  const renderHome = () => (
    <div style={{ padding: '20px 40px' }}>
      <div style={{ marginBottom: 32 }}>
        <Title level={4} style={{ marginBottom: 8 }}>标签任务</Title>
        <Text type="secondary">选择标签类型开始创建任务</Text>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {taskCards.map((card) => (
          <div
            key={card.key}
            onClick={() => setCurrentView(card.key as TaskType)}
            style={{
              width: 280,
              padding: 24,
              background: '#fff',
              borderRadius: 12,
              border: '1px solid #e8e8e8',
              cursor: 'pointer',
              transition: 'all 0.3s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = card.color
              e.currentTarget.style.boxShadow = `0 4px 12px ${card.color}20`
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e8e8e8'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div style={{ color: card.color, marginBottom: 16 }}>
              {card.icon}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              {card.title}
            </div>
            <div style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
              {card.description}
            </div>
            <Tag color={card.color}>{card.count} 个任务</Tag>
          </div>
        ))}
      </div>

      {/* 统计信息 */}
      {statistics && (
        <div style={{ marginTop: 48 }}>
          <Title level={5} style={{ marginBottom: 16 }}>统计概览</Title>
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ padding: 16, background: '#fff', borderRadius: 8, minWidth: 120 }}>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#1890ff' }}>{statistics.total_nodes}</div>
              <div style={{ color: '#666', fontSize: 13 }}>总节点数</div>
            </div>
            <div style={{ padding: 16, background: '#fff', borderRadius: 8, minWidth: 120 }}>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#52c41a' }}>{statistics.tag_count}</div>
              <div style={{ color: '#666', fontSize: 13 }}>标签数</div>
            </div>
            <div style={{ padding: 16, background: '#fff', borderRadius: 8, minWidth: 120 }}>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#722ed1' }}>{statistics.total_tagged_data}</div>
              <div style={{ color: '#666', fontSize: 13 }}>打标数据</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // 渲染任务列表
  const renderTaskList = () => {
    const viewTitle = currentView === 'ai' ? 'AI打标任务' : currentView === 'sql' ? 'SQL规则标签' : currentView === 'composite' ? '复合智能标签' : '数据集'

    const columns = [
      {
        title: '任务名称',
        dataIndex: 'name',
        key: 'name',
        render: (name: string, record: TagTask) => (
          <Space>
            <span style={{ fontWeight: 500 }}>{name}</span>
            {record.color && <Tag color={record.color}>标签</Tag>}
          </Space>
        ),
      },
      {
        title: '类型',
        dataIndex: 'rule_type',
        key: 'rule_type',
        width: 100,
        render: (type: string) => (
          <Tag color={type === 'row' ? 'blue' : type === 'sql' ? 'green' : 'default'}>
            {type === 'row' ? 'AI逐行' : type === 'sql' ? 'SQL规则' : type || '-'}
          </Tag>
        ),
      },
      {
        title: '源表',
        dataIndex: 'source_table',
        key: 'source_table',
        render: (table: string) => table || '-',
      },
      {
        title: '数据量',
        dataIndex: 'usage_count',
        key: 'usage_count',
        width: 80,
      },
      {
        title: '创建时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 180,
        render: (date: string) => date ? new Date(date).toLocaleString() : '-',
      },
      {
        title: '操作',
        key: 'actions',
        width: 240,
        render: (_: any, record: TagTask) => (
          <Space>
            {(currentView === 'ai' || currentView === 'sql' || currentView === 'composite') && (
              <Button
                type="link"
                size="small"
                icon={<PlayCircleOutlined />}
                loading={executing === record.id}
                onClick={() => handleExecute(record)}
              >
                执行
              </Button>
            )}
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => handlePreview(record)}
            >
              预览
            </Button>
            {(currentView === 'ai' || currentView === 'sql' || currentView === 'composite') && (
              record.is_scheduled ? (
                <Button
                  type="link"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  disabled
                  style={{ color: '#52c41a' }}
                >
                  已上线
                </Button>
              ) : (
                <Button
                  type="link"
                  size="small"
                  icon={<ScheduleOutlined />}
                  onClick={() => handleOpenSchedule(record)}
                >
                  上线
                </Button>
              )
            )}
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record.id, record.name)}
            >
              删除
            </Button>
          </Space>
        ),
      },
    ]

    // 获取当前视图的配色
    const viewColors: Record<string, { primary: string; bg: string; icon: React.ReactNode }> = {
      ai: { primary: '#1890ff', bg: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)', icon: <RobotOutlined /> },
      sql: { primary: '#52c41a', bg: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)', icon: <FileTextOutlined /> },
      composite: { primary: '#eb2f96', bg: 'linear-gradient(135deg, #eb2f96 0%, #c41d7f 100%)', icon: <MergeCellsOutlined /> },
      dataset: { primary: '#722ed1', bg: 'linear-gradient(135deg, #722ed1 0%, #531dab 100%)', icon: <DatabaseOutlined /> },
    }
    const currentColors = viewColors[currentView || ''] || viewColors.ai

    return (
      <div style={{ padding: '16px 24px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 页面头部 */}
        <div style={{
          background: currentColors.bg,
          borderRadius: 10,
          padding: '12px 20px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button
              type="text"
              icon={<LeftOutlined />}
              onClick={() => setCurrentView(null)}
              style={{ color: 'rgba(255,255,255,0.85)' }}
            >
              返回
            </Button>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 16,
            }}>
              {currentColors.icon}
            </div>
            <div>
              <Title level={5} style={{ margin: 0, color: '#fff', fontSize: 15 }}>{viewTitle}</Title>
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>
                共 {tasks.length} 个任务
              </Text>
            </div>
          </div>
          <div>
            {currentView === 'ai' && (
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}
                style={{ background: 'rgba(255,255,255,0.2)', borderColor: 'transparent' }}>
                新建任务
              </Button>
            )}
            {currentView === 'sql' && (
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => {
                setEditorSql('')
                setEditorResult(null)
                setEditorSelectedTable(null)
                setCurrentView('sql-editor')
              }} style={{ background: 'rgba(255,255,255,0.2)', borderColor: 'transparent' }}>
                新建任务
              </Button>
            )}
            {currentView === 'composite' && (
              <Button size="small" type="primary" icon={<MergeCellsOutlined />} onClick={handleOpenCompositeCreate}
                style={{ background: 'rgba(255,255,255,0.2)', borderColor: 'transparent' }}>
                新建复合智能标签
              </Button>
            )}
          </div>
        </div>

        {/* 表格容器 */}
        <div style={{
          background: '#fff',
          borderRadius: 10,
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <Table
            dataSource={tasks}
            columns={columns}
            rowKey="id"
            loading={loading}
            size="small"
            pagination={{
              pageSize: 15,
              showTotal: (total) => `共 ${total} 条`,
              size: 'small',
            }}
            locale={{ emptyText: <Empty description="暂无任务，点击右上角创建" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            scroll={{ y: 'calc(100vh - 240px)' }}
          />
        </div>
      </div>
    )
  }

  // 颜色配置
  const typeColors: Record<string, string> = {
    category: '#1890ff',
    type: '#722ed1',
    tag: '#52c41a',
  }

  // 渲染标签管理页面 - 画布版本
  const renderTagManagement = () => {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 顶部工具栏 */}
        <div style={{
          padding: '8px 16px',
          background: '#fff',
          borderBottom: '1px solid #e8e8e8',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}>
          <Button type="text" size="small" icon={<LeftOutlined />} onClick={() => setCurrentView(null)}>
            返回
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 24,
              height: 24,
              borderRadius: 5,
              background: 'linear-gradient(135deg, #fa8c16 0%, #fa541c 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 12,
            }}>
              <TagOutlined />
            </div>
            <Text strong style={{ fontSize: 14 }}>标签管理</Text>
          </div>
          <div style={{ flex: 1 }} />
          {connectingFrom !== null && (
            <Tag color="processing" style={{ fontSize: 11 }}>
              连线模式：点击目标节点完成连接
            </Tag>
          )}
          <Button size="small" icon={<FolderOpenOutlined />} onClick={handleGoToLayouts}>已保存</Button>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            onClick={() => setSaveModalVisible(true)}
            disabled={canvasNodes.length === 0}
            style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderColor: 'transparent' }}
          >
            保存布局
          </Button>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => handleOpenTagCreate()}
            style={{ background: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)', borderColor: 'transparent' }}>
            新建标签
          </Button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* 左侧：标签列表（按类型分组） */}
          <div style={{
            width: 240,
            background: '#fafafa',
            borderRight: '1px solid #e8e8e8',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{ padding: '12px 16px', fontWeight: 600, borderBottom: '1px solid #e8e8e8' }}>
              标签列表
              <Text type="secondary" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                点击分组添加
              </Text>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
              <Spin spinning={loading}>
                {/* 渲染分组的辅助函数 */}
                {(() => {
                  const renderSection = (nodeType: string, label: string, color: string) => {
                    const items = allTags.filter(t => t.node_type === nodeType)
                    const isCollapsed = collapsedSections.has(nodeType)

                    const toggleCollapse = () => {
                      setCollapsedSections(prev => {
                        const next = new Set(prev)
                        if (next.has(nodeType)) {
                          next.delete(nodeType)
                        } else {
                          next.add(nodeType)
                        }
                        return next
                      })
                    }

                    const handleCreateNew = (e: React.MouseEvent) => {
                      e.stopPropagation()
                      // 创建新标签，预设类型
                      setEditingTag(null)
                      setCreatingParent(null)
                      tagForm.resetFields()
                      tagForm.setFieldValue('node_type', nodeType)
                      setTagModalVisible(true)
                    }

                    return (
                      <div style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            padding: '6px 8px',
                            fontSize: 12,
                            color: '#333',
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            cursor: 'pointer',
                            borderRadius: 4,
                            background: '#fafafa',
                            border: '1px solid #e8e8e8',
                          }}
                          onClick={toggleCollapse}
                        >
                          {isCollapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                          <span style={{ flex: 1 }}>{label} ({items.length})</span>
                          <Tooltip title={`新建${label}`}>
                            <Button
                              type="text"
                              size="small"
                              icon={<PlusOutlined style={{ fontSize: 11 }} />}
                              style={{ width: 20, height: 20, minWidth: 20, color: '#1890ff' }}
                              onClick={handleCreateNew}
                            />
                          </Tooltip>
                        </div>
                        {!isCollapsed && (
                          <div style={{ marginTop: 4 }}>
                            {items.length === 0 ? (
                              <div style={{ padding: '8px 16px', fontSize: 12, color: '#999' }}>
                                暂无{label}，点击 + 创建
                              </div>
                            ) : items.map(tag => {
                              const isOnCanvas = canvasNodes.some(n => n.id === tag.id)
                              return (
                                <div
                                  key={tag.id}
                                  draggable={!isOnCanvas}
                                  onDragStart={(e) => handleDragStart(e, tag)}
                                  style={{
                                    padding: '6px 10px',
                                    marginBottom: 4,
                                    marginLeft: 16,
                                    background: '#fff',
                                    borderRadius: 4,
                                    borderLeft: `3px solid ${tag.color || color}`,
                                    cursor: isOnCanvas ? 'default' : 'grab',
                                    opacity: isOnCanvas ? 0.5 : 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 13,
                                  }}
                                >
                                  <DragOutlined style={{ color: '#bbb', fontSize: 11 }} />
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag.name}</span>
                                  {isOnCanvas && <span style={{ fontSize: 10, color: '#52c41a' }}>✓</span>}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  }

                  return (
                    <>
                      {renderSection('category', '分类', typeColors.category)}
                      {renderSection('type', '类型', typeColors.type)}
                      {renderSection('tag', '标签', typeColors.tag)}
                    </>
                  )
                })()}

              </Spin>
            </div>
          </div>

          {/* 右侧：画布 */}
          <div
            ref={canvasRef}
            style={{
              flex: 1,
              background: '#f5f5f5',
              backgroundImage: 'radial-gradient(circle, #ddd 1px, transparent 1px)',
              backgroundSize: '20px 20px',
              overflow: 'auto',
              position: 'relative',
              cursor: draggingNode ? 'grabbing' : 'default',
            }}
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
          >
            {/* SVG 连接线层 */}
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#666" />
                </marker>
              </defs>
              {connections.map(conn => {
                const fromNode = canvasNodes.find(n => n.id === conn.fromId)
                const toNode = canvasNodes.find(n => n.id === conn.toId)
                if (!fromNode || !toNode) return null

                const fromX = fromNode.x + 60
                const fromY = fromNode.y
                const toX = toNode.x + 60
                const toY = toNode.y + 80

                // 贝塞尔曲线控制点
                const midY = (fromY + toY) / 2

                return (
                  <g key={`${conn.fromId}-${conn.toId}`}>
                    <path
                      d={`M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`}
                      stroke="#666"
                      strokeWidth="2"
                      fill="none"
                      markerEnd="url(#arrowhead)"
                    />
                    {/* 可点击删除连接的热区 */}
                    <path
                      d={`M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`}
                      stroke="transparent"
                      strokeWidth="15"
                      fill="none"
                      style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                      onClick={() => handleRemoveConnection(conn.fromId)}
                    />
                  </g>
                )
              })}
            </svg>

            {/* 节点层 */}
            {canvasNodes.map(node => {
              const tag = node.tag
              const color = tag.color || typeColors[tag.node_type] || '#d9d9d9'
              const isConnecting = connectingFrom === node.id

              return (
                <div
                  key={node.id}
                  style={{
                    position: 'absolute',
                    left: node.x,
                    top: node.y,
                    width: 120,
                    background: '#fff',
                    borderRadius: 8,
                    border: `2px solid ${isConnecting ? '#1890ff' : (connectingFrom !== null ? '#52c41a' : color)}`,
                    boxShadow: isConnecting ? '0 0 0 3px rgba(24,144,255,0.2)' : (connectingFrom !== null ? '0 0 0 2px rgba(82,196,26,0.3)' : '0 2px 8px rgba(0,0,0,0.1)'),
                    cursor: connectingFrom !== null ? 'pointer' : (draggingNode === node.id ? 'grabbing' : 'grab'),
                    userSelect: 'none',
                    zIndex: draggingNode === node.id ? 100 : 1,
                  }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={() => {
                    // 连线模式下，点击节点完成连线
                    if (connectingFrom !== null && connectingFrom !== node.id) {
                      handleStartConnect(node.id)
                    }
                  }}
                >
                  {/* 顶部颜色条 */}
                  <div style={{ height: 3, background: color, borderRadius: '6px 6px 0 0' }} />

                  {/* 内容 */}
                  <div style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tag.name}
                    </div>
                    <Tag color={color} style={{ fontSize: 10, padding: '0 4px', margin: 0 }}>
                      {tag.node_type === 'category' ? '分类' : tag.node_type === 'type' ? '类型' : '标签'}
                    </Tag>
                  </div>

                  {/* 操作按钮 */}
                  <div style={{ borderTop: '1px solid #f0f0f0', padding: 4, display: 'flex', justifyContent: 'center', gap: 2 }}>
                    <Tooltip title={isConnecting ? '取消连线' : '连接到父级'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<AimOutlined style={{ fontSize: 11, color: isConnecting ? '#1890ff' : undefined }} />}
                        style={{ width: 22, height: 22, minWidth: 22 }}
                        onClick={(e) => { e.stopPropagation(); handleStartConnect(node.id) }}
                      />
                    </Tooltip>
                    {/* 只有分类和类型可以创建子级 */}
                    {tag.node_type !== 'tag' && (
                      <Tooltip title="创建子级">
                        <Button
                          type="text"
                          size="small"
                          icon={<PlusOutlined style={{ fontSize: 11, color: '#52c41a' }} />}
                          style={{ width: 22, height: 22, minWidth: 22 }}
                          onClick={(e) => { e.stopPropagation(); handleOpenTagCreate(tag) }}
                        />
                      </Tooltip>
                    )}
                    <Tooltip title="编辑">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined style={{ fontSize: 11 }} />}
                        style={{ width: 22, height: 22, minWidth: 22 }}
                        onClick={(e) => { e.stopPropagation(); handleEditTag(tag) }}
                      />
                    </Tooltip>
                    <Tooltip title="从画布移除">
                      <Button
                        type="text"
                        size="small"
                        icon={<ClearOutlined style={{ fontSize: 11 }} />}
                        style={{ width: 22, height: 22, minWidth: 22 }}
                        onClick={(e) => { e.stopPropagation(); handleRemoveFromCanvas(node.id) }}
                      />
                    </Tooltip>
                    <Tooltip title="删除标签">
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                        style={{ width: 22, height: 22, minWidth: 22 }}
                        onClick={(e) => { e.stopPropagation(); handleDeleteTag(tag.id) }}
                      />
                    </Tooltip>
                  </div>
                </div>
              )
            })}

            {/* 空状态 */}
            {canvasNodes.length === 0 && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
                color: '#999',
              }}>
                <DragOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                <div>从左侧拖拽标签到画布</div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // AI打标下一步
  const handleAiNext = async () => {
    try {
      if (aiStep === 0) {
        await form.validateFields(['source_table', 'sql_prompt'])
      } else if (aiStep === 1) {
        if (!sqlConfirmed || !generatedSql) {
          message.error('请先生成并确认SQL')
          return
        }
      }
      setAiStep(aiStep + 1)
    } catch {
      // 验证失败
    }
  }

  // 渲染AI打标弹框
  const renderAIModal = () => {
    const sqlModeSteps = [
      { title: '选择数据表' },
      { title: '生成SQL' },
      { title: '保存任务' },
    ]

    // 生成SQL并提取标签
    const handleGenerateSql = async () => {
      const prompt = form.getFieldValue('sql_prompt')
      const table = form.getFieldValue('source_table')
      if (!table) {
        message.error('请先选择数据表')
        return
      }
      if (!prompt?.trim()) {
        message.error('请先输入打标逻辑描述')
        return
      }
      setGeneratingSql(true)
      try {
        const res = await tagApi.previewRuleSql(table, prompt)
        setGeneratedSql(res.data?.sql || '')
        setExtractedTags(res.data?.tags || [])
        message.success('SQL已生成，请确认')
      } catch (error: any) {
        message.error(error.response?.data?.detail || '生成失败')
      } finally {
        setGeneratingSql(false)
      }
    }

    return (
      <Modal
        title="新建打标任务"
        open={modalVisible && currentView === 'ai'}
        onCancel={() => {
          setModalVisible(false)
          setGeneratedSql('')
          setSqlConfirmed(false)
          setExtractedTags([])
          setAiStep(0)
        }}
        width={900}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button
              disabled={aiStep === 0}
              onClick={() => setAiStep(aiStep - 1)}
            >
              上一步
            </Button>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              {aiStep < 2 ? (
                <Button type="primary" onClick={handleAiNext}>
                  下一步
                </Button>
              ) : (
                <Button type="primary" onClick={handleSubmit}>
                  保存任务
                </Button>
              )}
            </Space>
          </div>
        }
      >
        {/* AI生成SQL模式 */}
        {(
          <>
            <Steps current={aiStep} items={sqlModeSteps} style={{ marginBottom: 24 }} size="small" />

            <Form form={form} layout="vertical" autoComplete="off">
              {/* 步骤1: 选择表 + 描述逻辑 */}
              <div style={{ display: aiStep === 0 ? 'block' : 'none' }}>
                <Form.Item
                  name="source_table"
                  label="选择数据表"
                  rules={[{ required: true, message: '请选择源表' }]}
                >
                  <Select
                    placeholder="请选择数据表"
                    loading={loadingTables}
                    showSearch
                    options={tables.map((t) => ({ value: t, label: t }))}
                    style={{ width: 300 }}
                  />
                </Form.Item>

                <Form.Item
                  name="sql_prompt"
                  label="打标逻辑描述"
                  rules={[{ required: true, message: '请描述打标逻辑' }]}
                  extra="用自然语言描述，AI会读取表样本数据后生成SQL"
                >
                  <TextArea
                    rows={5}
                    placeholder={`例如：
• 订单金额大于1000的标记为"高消费"，500-1000为"中等"，其他为"普通"
• 最近30天有登录记录的为"活跃用户"，否则为"沉默用户"
• 评分大于4.5的商品标记为"好评"，3-4.5为"一般"，其他为"差评"`}
                  />
                </Form.Item>
              </div>

              {/* 步骤2: 生成并确认SQL */}
              <div style={{ display: aiStep === 1 ? 'block' : 'none' }}>
                {!generatedSql ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Button
                      type="primary"
                      size="large"
                      icon={<RobotOutlined />}
                      loading={generatingSql}
                      onClick={handleGenerateSql}
                    >
                      {generatingSql ? 'AI正在分析数据...' : '生成SQL'}
                    </Button>
                    <div style={{ marginTop: 16, color: '#666' }}>
                      AI将读取表的样本数据，根据您的描述生成SQL
                    </div>
                  </div>
                ) : (
                  <>
                    {/* SQL编辑器 */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text strong>
                          生成的SQL
                          {sqlConfirmed && <Tag color="success" style={{ marginLeft: 8 }}>已确认</Tag>}
                        </Text>
                        <Space>
                          <Button
                            size="small"
                            onClick={() => {
                              setGeneratedSql('')
                              setSqlConfirmed(false)
                              setExtractedTags([])
                            }}
                          >
                            重新生成
                          </Button>
                          {!sqlConfirmed && (
                            <Button
                              type="primary"
                              size="small"
                              onClick={() => {
                                setSqlConfirmed(true)
                                message.success('SQL已确认')
                              }}
                            >
                              确认SQL
                            </Button>
                          )}
                        </Space>
                      </div>
                      <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
                        <Editor
                          height={180}
                          language="sql"
                          theme="vs-dark"
                          value={generatedSql}
                          onChange={(v) => {
                            setGeneratedSql(v || '')
                            if (sqlConfirmed) setSqlConfirmed(false)
                          }}
                          options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            lineNumbers: 'on',
                            readOnly: sqlConfirmed,
                          }}
                        />
                      </div>
                    </div>

                    {/* 提取的标签 */}
                    <div style={{ marginBottom: 16, padding: 12, background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
                      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text strong>提取的标签</Text>
                        <Button
                          type="link"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => setExtractedTags([...extractedTags, '新标签'])}
                        >
                          添加
                        </Button>
                      </div>
                      <Space wrap>
                        {extractedTags.map((tag, idx) => (
                          <Tag
                            key={idx}
                            closable
                            color="green"
                            onClose={() => setExtractedTags(extractedTags.filter((_, i) => i !== idx))}
                          >
                            <Input
                              size="small"
                              value={tag}
                              onChange={(e) => {
                                const updated = [...extractedTags]
                                updated[idx] = e.target.value
                                setExtractedTags(updated)
                              }}
                              style={{ width: 80, border: 'none', background: 'transparent', padding: 0 }}
                            />
                          </Tag>
                        ))}
                        {extractedTags.length === 0 && (
                          <Text type="secondary">未提取到标签，请检查SQL中的CASE WHEN语句</Text>
                        )}
                      </Space>
                    </div>
                  </>
                )}
              </div>

              {/* 步骤3: 保存任务 */}
              <div style={{ display: aiStep === 2 ? 'block' : 'none' }}>
                <Form.Item
                  name="name"
                  label="任务名称"
                  rules={[{ required: true, message: '请输入任务名称' }]}
                >
                  <Input placeholder="例如：用户分层打标任务" />
                </Form.Item>

                <Form.Item name="description" label="任务描述">
                  <TextArea rows={2} placeholder="可选，补充说明" />
                </Form.Item>

                <Form.Item name="target_table" label="结果保存到">
                  <Input placeholder="可选，留空则自动生成表名" />
                </Form.Item>

                <div style={{ padding: 16, background: '#fafafa', borderRadius: 8 }}>
                  <Text strong>任务信息预览</Text>
                  <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
                    <div>源表：{form.getFieldValue('source_table')}</div>
                    <div>标签：{extractedTags.join('、') || '无'}</div>
                    <div>SQL已确认：{sqlConfirmed ? '是' : '否'}</div>
                  </div>
                </div>
              </div>
            </Form>
          </>
        )}
      </Modal>
    )
  }

  // 渲染SQL规则弹框
  const renderSQLModal = () => (
    <Modal
      title={editingTask ? '编辑SQL规则标签' : '新建SQL规则标签'}
      open={modalVisible && currentView === 'sql'}
      onCancel={() => setModalVisible(false)}
      onOk={handleSubmit}
      width={700}
    >
      <Form form={form} layout="vertical" autoComplete="off" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="标签名称"
          rules={[{ required: true, message: '请输入标签名称' }]}
        >
          <Input placeholder="请输入标签名称" />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <TextArea rows={2} placeholder="标签描述" />
        </Form.Item>

        <Form.Item name="color" label="颜色">
          <Select
            options={[
              { value: 'blue', label: '蓝色' },
              { value: 'green', label: '绿色' },
              { value: 'orange', label: '橙色' },
              { value: 'red', label: '红色' },
              { value: 'purple', label: '紫色' },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="source_table"
          label="源表"
          rules={[{ required: true, message: '请选择源表' }]}
        >
          <Select
            loading={loadingTables}
            showSearch
            options={tables.map((t) => ({ value: t, label: t }))}
          />
        </Form.Item>

        <Form.Item
          name="sql"
          label="SQL规则"
          rules={[{ required: true, message: '请输入SQL' }]}
        >
          <div style={{ border: '1px solid #d9d9d9', borderRadius: 6 }}>
            <Editor
              height={200}
              language="sql"
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
              }}
              onChange={(v) => form.setFieldValue('sql', v)}
            />
          </div>
        </Form.Item>
      </Form>
    </Modal>
  )

  // 复合智能标签弹框
  const renderCompositeModal = () => {
    const compositeSteps = [
      { title: '选择标签' },
      { title: '描述逻辑' },
      { title: '确认SQL' },
      { title: '保存' },
    ]

    // 解析标签的源表信息
    const getTagSourceTable = (tag: TagTask) => {
      if (tag.source_table) return tag.source_table
      if (tag.rule_config) {
        try {
          const config = JSON.parse(tag.rule_config)
          return config.source_table || '-'
        } catch {
          return '-'
        }
      }
      return '-'
    }

    return (
      <Modal
        title="新建复合智能标签"
        open={compositeModalVisible}
        onCancel={() => setCompositeModalVisible(false)}
        width={1000}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button
              disabled={compositeStep === 0}
              onClick={() => setCompositeStep(compositeStep - 1)}
            >
              上一步
            </Button>
            <Space>
              <Button onClick={() => setCompositeModalVisible(false)}>取消</Button>
              {compositeStep < 3 ? (
                <Button type="primary" onClick={handleCompositeNext}>
                  下一步
                </Button>
              ) : (
                <Button type="primary" onClick={handleCompositeSubmit}>
                  创建复合智能标签
                </Button>
              )}
            </Space>
          </div>
        }
      >
        <Steps current={compositeStep} items={compositeSteps} style={{ marginBottom: 24 }} size="small" />

        {/* 步骤1: 选择标签 */}
        <div style={{ display: compositeStep === 0 ? 'block' : 'none' }}>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">选择2个或多个已有标签进行组合（只显示有SQL规则的标签）</Text>
          </div>
          {selectedTags.length > 0 && (
            <div style={{ marginBottom: 16, padding: 12, background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f' }}>
              <Text strong>已选择 {selectedTags.length} 个标签：</Text>
              <div style={{ marginTop: 8 }}>
                <Space wrap>
                  {selectedTags.map(tag => (
                    <Tag
                      key={tag.id}
                      closable
                      color="green"
                      onClose={() => handleToggleTagSelection(tag)}
                    >
                      {tag.name}
                    </Tag>
                  ))}
                </Space>
              </div>
            </div>
          )}
          <List
            dataSource={compositeTags}
            loading={loading}
            grid={{ gutter: 16, column: 3 }}
            renderItem={(tag) => {
              const isSelected = selectedTags.some(t => t.id === tag.id)
              return (
                <List.Item>
                  <Card
                    size="small"
                    hoverable
                    style={{
                      border: isSelected ? '2px solid #52c41a' : '1px solid #d9d9d9',
                      background: isSelected ? '#f6ffed' : '#fff',
                    }}
                    onClick={() => handleToggleTagSelection(tag)}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Checkbox checked={isSelected} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>{tag.name}</div>
                        <div style={{ fontSize: 12, color: '#666' }}>
                          源表：{getTagSourceTable(tag)}
                        </div>
                        <Tag color={tag.rule_type === 'row' ? 'blue' : 'green'} style={{ marginTop: 4 }}>
                          {tag.rule_type === 'row' ? 'AI打标' : 'SQL规则'}
                        </Tag>
                      </div>
                    </div>
                  </Card>
                </List.Item>
              )
            }}
            locale={{ emptyText: <Empty description="暂无可用标签，请先创建AI打标或SQL规则标签" /> }}
          />
        </div>

        {/* 步骤2: 描述组合逻辑 */}
        <div style={{ display: compositeStep === 1 ? 'block' : 'none' }}>
          <div style={{ marginBottom: 16, padding: 12, background: '#e6f7ff', borderRadius: 8, border: '1px solid #91d5ff' }}>
            <Text strong>已选择的标签：</Text>
            <div style={{ marginTop: 8 }}>
              {selectedTags.map(tag => (
                <div key={tag.id} style={{ marginBottom: 8 }}>
                  <Tag color="blue">{tag.name}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    源表：{getTagSourceTable(tag)}
                  </Text>
                </div>
              ))}
            </div>
          </div>
          <Form.Item
            label="组合逻辑描述"
            required
            extra="用自然语言描述如何关联这些标签背后的表，AI会生成关联SQL"
          >
            <TextArea
              rows={6}
              value={compositePrompt}
              onChange={(e) => setCompositePrompt(e.target.value)}
              placeholder={`例如：
• 将"高消费用户"和"活跃用户"两个标签组合，找出既是高消费又是活跃的用户
• 通过user_id关联两张表，取两个标签的交集
• 将订单表的标签和用户表的标签通过customer_id关联，生成新的复合视角`}
            />
          </Form.Item>
        </div>

        {/* 步骤3: 确认SQL */}
        <div style={{ display: compositeStep === 2 ? 'block' : 'none' }}>
          {!compositeSql ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Button
                type="primary"
                size="large"
                icon={<RobotOutlined />}
                loading={generatingCompositeSql}
                onClick={handleGenerateCompositeSql}
              >
                {generatingCompositeSql ? 'AI正在生成关联SQL...' : '生成关联SQL'}
              </Button>
              <div style={{ marginTop: 16, color: '#666' }}>
                AI将分析所选标签的源表结构，根据您的描述生成关联SQL
              </div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text strong>
                    生成的关联SQL
                    {compositeSqlConfirmed && <Tag color="success" style={{ marginLeft: 8 }}>已确认</Tag>}
                  </Text>
                  <Space>
                    <Button
                      size="small"
                      onClick={() => {
                        setCompositeSql('')
                        setCompositeSqlConfirmed(false)
                      }}
                    >
                      重新生成
                    </Button>
                    {!compositeSqlConfirmed && (
                      <Button
                        type="primary"
                        size="small"
                        onClick={() => {
                          setCompositeSqlConfirmed(true)
                          message.success('SQL已确认')
                        }}
                      >
                        确认SQL
                      </Button>
                    )}
                  </Space>
                </div>
                <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
                  <Editor
                    height={250}
                    language="sql"
                    theme="vs-dark"
                    value={compositeSql}
                    onChange={(v) => {
                      setCompositeSql(v || '')
                      if (compositeSqlConfirmed) setCompositeSqlConfirmed(false)
                    }}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      readOnly: compositeSqlConfirmed,
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* 步骤4: 保存 */}
        <div style={{ display: compositeStep === 3 ? 'block' : 'none' }}>
          <Form form={compositeForm} layout="vertical" autoComplete="off">
            <Form.Item
              name="name"
              label="复合智能标签名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="例如：高消费活跃用户" />
            </Form.Item>

            <Form.Item name="description" label="描述">
              <TextArea rows={2} placeholder="可选，补充说明" />
            </Form.Item>
          </Form>

          <div style={{ padding: 16, background: '#fafafa', borderRadius: 8 }}>
            <Text strong>复合智能标签信息预览</Text>
            <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
              <div>组合标签：{selectedTags.map(t => t.name).join('、')}</div>
              <div>涉及表：{selectedTags.map(t => getTagSourceTable(t)).filter(Boolean).join('、')}</div>
              <div>SQL已确认：{compositeSqlConfirmed ? '是' : '否'}</div>
            </div>
          </div>
        </div>
      </Modal>
    )
  }

  // 预览弹框
  const renderPreviewModal = () => (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 14,
          }}>
            <EyeOutlined />
          </div>
          <span>数据预览</span>
        </div>
      }
      open={previewVisible}
      onCancel={() => setPreviewVisible(false)}
      footer={null}
      width={900}
    >
      <Spin spinning={previewLoading}>
        {previewData.length > 0 ? (
          <>
            <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
              共 {previewData.length} 条数据
            </div>
            <Table
              dataSource={previewData}
              columns={Object.keys(previewData[0] || {}).map((key) => ({
                title: key,
                dataIndex: key,
                key,
                ellipsis: true,
              }))}
              rowKey={(_, index) => String(index)}
              scroll={{ x: 'max-content' }}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              size="small"
            />
          </>
        ) : (
          <Empty description="暂无数据" style={{ padding: '40px 0' }} />
        )}
      </Spin>
    </Modal>
  )

  // SQL编辑器视图 - 完全继承DataExplorer布局
  const renderSqlEditor = () => {
    const resultColumns = editorResult?.columns?.map((col: string) => ({
      title: col,
      dataIndex: col,
      key: col,
      ellipsis: true,
    })) || []

    // 转换查询结果：rows是二维数组，需要转换为对象数组
    const resultData = editorResult?.rows?.map((row: any[], index: number) => {
      const obj: any = { _key: index }
      editorResult.columns?.forEach((col: string, i: number) => {
        obj[col] = row[i]
      })
      return obj
    }) || []

    // 表结构列
    const structureColumns = [
      { title: '字段名', dataIndex: 'name', key: 'name', width: 150 },
      { title: '类型', dataIndex: 'data_type', key: 'data_type', width: 120 },
      { title: '可空', dataIndex: 'is_nullable', key: 'is_nullable', width: 60, render: (v: boolean) => v ? '是' : '否' },
      { title: '主键', dataIndex: 'is_primary_key', key: 'is_primary_key', width: 60, render: (v: boolean) => v ? <Tag color="blue">PK</Tag> : '-' },
      { title: '注释', dataIndex: 'comment', key: 'comment', ellipsis: true },
    ]

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 顶部工具栏 */}
        <div style={{ padding: '8px 16px', background: '#fff', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <Button type="text" icon={<LeftOutlined />} onClick={() => setCurrentView('sql')} size="small">
            返回
          </Button>
          <Text strong>SQL规则标签</Text>
        </div>

        {/* 主体内容 */}
        <Splitter style={{ flex: 1, minHeight: 0 }}>
          {/* 左侧：表列表 */}
          <Splitter.Panel defaultSize={220} min={160} max={360}>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fafafa', borderRight: '1px solid #f0f0f0' }}>
              {/* 表列表头部 */}
              <div style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 4 }}>
                <DatabaseOutlined style={{ fontSize: 12, color: '#8c8c8c' }} />
                <Text style={{ fontSize: 12, fontWeight: 500 }}>平台数据库</Text>
                <div style={{ flex: 1 }} />
                <Tooltip title="刷新表列表">
                  <Button type="text" size="small" icon={<ReloadOutlined style={{ fontSize: 12 }} />} onClick={loadEditorTables} />
                </Tooltip>
              </div>

              {/* 搜索框 */}
              <div style={{ padding: '6px 8px' }}>
                <Input
                  placeholder="搜索表..."
                  prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
                  size="small"
                  value={editorSearchText}
                  onChange={(e) => setEditorSearchText(e.target.value)}
                  allowClear
                />
              </div>

              {/* 表列表 */}
              <div style={{ flex: 1, overflow: 'auto', padding: '0 4px' }}>
                {editorFilteredTables.map((table) => (
                  <div
                    key={table}
                    onClick={() => handleEditorSelectTable(table)}
                    style={{
                      padding: '6px 8px',
                      cursor: 'pointer',
                      borderRadius: 4,
                      marginBottom: 2,
                      background: editorSelectedTable === table ? '#e6f7ff' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <TableOutlined style={{ fontSize: 12, color: '#8c8c8c' }} />
                    <Text ellipsis style={{ fontSize: 12, flex: 1, color: editorSelectedTable === table ? '#1890ff' : '#333' }}>
                      {table}
                    </Text>
                  </div>
                ))}
                {editorFilteredTables.length === 0 && (
                  <Empty description="无匹配表" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </div>
            </div>
          </Splitter.Panel>

          {/* 右侧：SQL编辑和结果 */}
          <Splitter.Panel>
            <div style={{ height: '100%', position: 'relative' }}>
              {/* 右上角布局切换按钮 */}
              <Tooltip title={editorResultPosition === 'bottom' ? '结果移到右侧' : '结果移到下方'}>
                <Button
                  type="text"
                  size="small"
                  icon={editorResultPosition === 'bottom' ? <PicLeftOutlined style={{ fontSize: 14 }} /> : <PicCenterOutlined style={{ fontSize: 14 }} />}
                  onClick={() => setEditorResultPosition(editorResultPosition === 'bottom' ? 'right' : 'bottom')}
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    zIndex: 100,
                    width: 24,
                    height: 24,
                    padding: 0,
                    background: 'rgba(255,255,255,0.95)',
                    border: '1px solid #d9d9d9',
                    borderRadius: 4,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  }}
                />
              </Tooltip>

              <Splitter layout={editorResultPosition === 'bottom' ? 'vertical' : 'horizontal'} style={{ height: '100%' }}>
                {/* SQL编辑器 */}
                <Splitter.Panel defaultSize={editorResultPosition === 'bottom' ? '45%' : '55%'} min={120} max="70%">
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
                    {/* 编辑器Tab栏 */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      borderBottom: '1px solid #f0f0f0',
                      background: '#fafafa',
                      height: 28,
                      minHeight: 28,
                      overflow: 'auto',
                    }}>
                      {editorTabs.map(tab => (
                        <Dropdown key={tab.id} menu={getEditorTabContextMenu(tab.id)} trigger={['contextMenu']}>
                          <div
                            onClick={() => setActiveEditorTab(tab.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0 8px',
                              height: 28,
                              cursor: 'pointer',
                              borderRight: '1px solid #e8e8e8',
                              background: activeEditorTab === tab.id ? '#fff' : 'transparent',
                              borderBottom: activeEditorTab === tab.id ? '2px solid #1890ff' : '2px solid transparent',
                              fontSize: 12,
                              gap: 4,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <span>{tab.title}</span>
                            {editorTabs.length > 1 && (
                              <CloseOutlined
                                style={{ fontSize: 10, color: '#999' }}
                                onClick={(e) => { e.stopPropagation(); closeEditorTab(tab.id) }}
                              />
                            )}
                          </div>
                        </Dropdown>
                      ))}
                      <Tooltip title="新建">
                        <div
                          onClick={addEditorTab}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, cursor: 'pointer', color: '#666' }}
                        >
                          <PlusOutlined style={{ fontSize: 12 }} />
                        </div>
                      </Tooltip>
                    </div>

                    {/* 编辑器主体 */}
                    <div style={{ flex: 1, display: 'flex' }}>
                      {/* 左侧按钮栏 */}
                      <div style={{
                        width: 32,
                        background: '#fafafa',
                        borderRight: '1px solid #f0f0f0',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        padding: '8px 0',
                        gap: 4,
                      }}>
                        <Tooltip title="执行 (Ctrl+Enter)" placement="right">
                          <Button type="primary" size="small" icon={<PlayCircleOutlined style={{ fontSize: 14 }} />} onClick={handleEditorExecute} loading={editorExecuting} style={{ width: 26, height: 26, padding: 0 }} />
                        </Tooltip>
                        <Tooltip title="执行全部(多条SQL)" placement="right">
                          <Button size="small" icon={<CaretRightOutlined style={{ fontSize: 14 }} />} onClick={handleEditorExecuteMultiple} loading={editorExecuting} style={{ width: 26, height: 26, padding: 0 }} />
                        </Tooltip>
                        <Tooltip title="AI优化" placement="right">
                          <Button size="small" icon={<ThunderboltOutlined style={{ fontSize: 14 }} />} onClick={handleEditorOptimize} loading={editorAiLoading} style={{ width: 26, height: 26, padding: 0 }} />
                        </Tooltip>
                        <Divider style={{ margin: '4px 0', borderColor: '#e0e0e0' }} />
                        <Tooltip title="保存为标签" placement="right">
                          <Button
                            size="small"
                            icon={<StarOutlined style={{ fontSize: 14, color: editorSql.trim() ? '#faad14' : undefined }} />}
                            onClick={() => {
                              if (!editorSql.trim()) {
                                message.warning('请先输入SQL')
                                return
                              }
                              setSaveTagModalVisible(true)
                            }}
                            style={{ width: 26, height: 26, padding: 0 }}
                          />
                        </Tooltip>
                      </div>

                      {/* Monaco编辑器 */}
                      <div style={{ flex: 1 }}>
                        <Editor
                          height="100%"
                          language="sql"
                          theme="vs-dark"
                          value={editorSql}
                          onChange={(v) => setEditorSql(v || '')}
                          onMount={(editor) => {
                            editorRef.current = editor
                            editor.addCommand(2048 | 3, () => handleEditorExecute()) // Ctrl+Enter
                            editor.addCommand(2048 | 49, () => { // Ctrl+S 保存
                              if (editorSql.trim()) setSaveTagModalVisible(true)
                            })
                          }}
                          options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            lineNumbers: 'on',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </Splitter.Panel>

                {/* 结果区域 */}
                <Splitter.Panel>
                  <Tabs
                    activeKey={editorActiveResultTab}
                    onChange={setEditorActiveResultTab}
                    size="small"
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}
                    tabBarStyle={{ margin: 0, padding: '0 12px', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}
                    items={[
                      {
                        key: 'result',
                        label: `结果${editorResult && !editorResult.error ? ` (${editorResult.row_count})` : ''}`,
                        children: (
                          <div style={{ height: '100%', overflow: 'auto', padding: 8, background: '#fff' }}>
                            {editorExecuting ? (
                              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
                                <Spin tip="执行中..." />
                              </div>
                            ) : editorResult?.error ? (
                              <Alert type="error" message="执行失败" description={editorResult.message} showIcon />
                            ) : editorResult?.multiple ? (
                              // 多条SQL结果
                              <div>
                                {editorResult.results.map((r: any, idx: number) => (
                                  <div key={idx} style={{ marginBottom: 16 }}>
                                    <Text strong>语句 {idx + 1}</Text>
                                    {r.error ? (
                                      <Alert type="error" message={r.message} style={{ marginTop: 8 }} />
                                    ) : (
                                      <Table
                                        dataSource={r.rows?.map((row: any[], i: number) => {
                                          const obj: any = { _key: i }
                                          r.columns?.forEach((col: string, j: number) => { obj[col] = row[j] })
                                          return obj
                                        }) || []}
                                        columns={r.columns?.map((col: string) => ({ title: col, dataIndex: col, key: col, ellipsis: true }))}
                                        rowKey="_key"
                                        size="small"
                                        scroll={{ x: 'max-content' }}
                                        pagination={{ pageSize: 20 }}
                                        style={{ marginTop: 8 }}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : resultData.length > 0 ? (
                              <Table
                                dataSource={resultData}
                                columns={resultColumns}
                                rowKey="_key"
                                size="small"
                                scroll={{ x: 'max-content' }}
                                pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
                              />
                            ) : (
                              <Empty description={editorResult ? '无数据' : '请输入SQL并执行'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            )}
                          </div>
                        ),
                      },
                      {
                        key: 'structure',
                        label: '表结构',
                        children: (
                          <div style={{ height: '100%', overflow: 'auto', padding: 8, background: '#fff' }}>
                            {editorLoadingTableInfo ? (
                              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
                                <Spin tip="加载中..." />
                              </div>
                            ) : editorSelectedTable && editorTableColumns.length > 0 ? (
                              <>
                                <div style={{ marginBottom: 8 }}>
                                  <Text strong>{editorSelectedTable}</Text>
                                  <Text type="secondary" style={{ marginLeft: 8 }}>{editorTableColumns.length} 个字段</Text>
                                </div>
                                <Table
                                  dataSource={editorTableColumns}
                                  columns={structureColumns}
                                  rowKey="name"
                                  size="small"
                                  pagination={false}
                                  scroll={{ y: 300 }}
                                />
                              </>
                            ) : (
                              <Empty description="请选择左侧表查看结构" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            )}
                          </div>
                        ),
                      },
                      {
                        key: 'preview',
                        label: '数据预览',
                        children: (
                          <div style={{ height: '100%', overflow: 'auto', padding: 8, background: '#fff' }}>
                            {editorLoadingTableInfo ? (
                              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
                                <Spin tip="加载中..." />
                              </div>
                            ) : editorSelectedTable && editorTableData.length > 0 ? (
                              <Table
                                dataSource={editorTableData}
                                columns={Object.keys(editorTableData[0] || {}).map(key => ({ title: key, dataIndex: key, key, ellipsis: true }))}
                                rowKey={(_, index) => String(index)}
                                size="small"
                                scroll={{ x: 'max-content' }}
                                pagination={{ pageSize: 50 }}
                              />
                            ) : (
                              <Empty description="请选择左侧表查看预览" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            )}
                          </div>
                        ),
                      },
                    ]}
                  />
                </Splitter.Panel>
              </Splitter>
            </div>
          </Splitter.Panel>
        </Splitter>
      </div>
    )
  }

  // 保存为标签弹框
  const renderSaveTagModal = () => (
    <Modal
      title="保存为SQL规则标签"
      open={saveTagModalVisible}
      onCancel={() => { setSaveTagModalVisible(false); saveTagForm.resetFields() }}
      onOk={handleSaveAsTag}
      okText="保存"
      cancelText="取消"
    >
      <Form form={saveTagForm} layout="vertical" autoComplete="off" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="标签名称"
          rules={[{ required: true, message: '请输入标签名称' }]}
        >
          <Input placeholder="例如：高价值用户" />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <TextArea rows={2} placeholder="可选，标签描述" />
        </Form.Item>

        <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
          <Text strong style={{ fontSize: 13 }}>SQL预览</Text>
          <div style={{ marginTop: 8, padding: 8, background: '#1e1e1e', borderRadius: 4, maxHeight: 120, overflow: 'auto' }}>
            <pre style={{ margin: 0, color: '#d4d4d4', fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {editorSql || '无SQL'}
            </pre>
          </div>
        </div>
      </Form>
    </Modal>
  )

  // Graph Intelligence 视图
  const renderGraphView = () => {
    const columns = [
      {
        title: '任务名称',
        dataIndex: 'name',
        key: 'name',
        render: (name: string) => (
          <Space>
            <DeploymentUnitOutlined style={{ color: '#13c2c2' }} />
            <span style={{ fontWeight: 500 }}>{name}</span>
          </Space>
        ),
      },
      {
        title: '源表',
        dataIndex: 'source_table',
        key: 'source_table',
        render: (table: string) => table || '-',
      },
      {
        title: '状态',
        key: 'status',
        width: 100,
        render: () => <Tag color="default">待开发</Tag>,
      },
      {
        title: '创建时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 180,
        render: (date: string) => date ? new Date(date).toLocaleString() : '-',
      },
      {
        title: '操作',
        key: 'actions',
        width: 200,
        render: (_: any, record: TagTask) => (
          <Space>
            <Tooltip title="图数据库功能开发中">
              <Button type="link" size="small" icon={<EyeOutlined />} disabled>
                预览图谱
              </Button>
            </Tooltip>
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record.id, record.name)}
            >
              删除
            </Button>
          </Space>
        ),
      },
    ]

    return (
      <div style={{ padding: '20px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
          <Button type="text" icon={<LeftOutlined />} onClick={() => setCurrentView(null)} style={{ marginRight: 16 }}>
            返回
          </Button>
          <Title level={4} style={{ margin: 0 }}>Graph Intelligence</Title>
          <div style={{ flex: 1 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenGraphCreate}>
            新建图标签
          </Button>
        </div>

        {/* 功能说明 */}
        <Alert
          message="Graph Intelligence - 知识图谱标签"
          description={
            <div>
              <p style={{ margin: '8px 0' }}>通过AI自动从数据中提取实体和关系，构建知识图谱。适用于：</p>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>用户关系网络分析</li>
                <li>商品关联推荐</li>
                <li>风控关系图谱</li>
                <li>供应链关系分析</li>
              </ul>
              <p style={{ margin: '8px 0 0', color: '#faad14' }}>
                <BranchesOutlined style={{ marginRight: 4 }} />
                图数据库集成开发中，当前为功能预览...
              </p>
            </div>
          }
          type="info"
          showIcon
          icon={<DeploymentUnitOutlined />}
          style={{ marginBottom: 24 }}
        />

        <div style={{ background: '#fff', borderRadius: 8, padding: 16 }}>
          <Table
            dataSource={graphTasks}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10 }}
            locale={{ emptyText: <Empty description="暂无图标签任务" /> }}
          />
        </div>
      </div>
    )
  }

  // Graph Intelligence 创建弹框
  const renderGraphModal = () => {
    const graphSteps = [
      { title: '配置数据源' },
      { title: '预览图谱' },
      { title: '保存任务' },
    ]

    return (
      <Modal
        title="新建 Graph Intelligence 任务"
        open={graphModalVisible}
        onCancel={() => setGraphModalVisible(false)}
        width={800}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button disabled={graphStep === 0} onClick={() => setGraphStep(graphStep - 1)}>
              上一步
            </Button>
            <Space>
              <Button onClick={() => setGraphModalVisible(false)}>取消</Button>
              {graphStep === 0 && (
                <Button type="primary" loading={graphGenerating} onClick={handleGenerateGraphPreview}>
                  生成预览
                </Button>
              )}
              {graphStep === 1 && (
                <Button type="primary" onClick={() => setGraphStep(2)}>
                  下一步
                </Button>
              )}
              {graphStep === 2 && (
                <Button type="primary" onClick={handleSaveGraphTask}>
                  保存任务
                </Button>
              )}
            </Space>
          </div>
        }
      >
        <Steps current={graphStep} items={graphSteps} style={{ marginBottom: 24 }} size="small" />

        <Form form={graphForm} layout="vertical" autoComplete="off">
          {/* 步骤1: 配置数据源 */}
          <div style={{ display: graphStep === 0 ? 'block' : 'none' }}>
            <Form.Item
              name="source_table"
              label="选择数据表"
              rules={[{ required: true, message: '请选择数据表' }]}
            >
              <Select
                placeholder="选择要分析的数据表"
                loading={loadingTables}
                showSearch
                options={tables.map(t => ({ value: t, label: t }))}
              />
            </Form.Item>

            <Form.Item
              name="entity_columns"
              label="实体字段"
              rules={[{ required: true, message: '请选择实体字段' }]}
              extra="选择要作为图谱节点的字段，如：用户ID、商品ID、订单ID等"
            >
              <Select
                mode="multiple"
                placeholder="选择实体字段"
                options={[
                  { value: 'user_id', label: 'user_id (用户ID)' },
                  { value: 'product_id', label: 'product_id (商品ID)' },
                  { value: 'order_id', label: 'order_id (订单ID)' },
                  { value: 'category', label: 'category (分类)' },
                ]}
              />
            </Form.Item>

            <Form.Item
              name="relation_prompt"
              label="关系提取描述"
              rules={[{ required: true, message: '请描述要提取的关系' }]}
              extra="用自然语言描述要提取的关系类型"
            >
              <TextArea
                rows={4}
                placeholder={`例如：
• 提取用户与商品之间的"购买"、"浏览"、"收藏"关系
• 识别用户之间的"关注"、"好友"关系
• 分析商品之间的"同类"、"搭配"关系`}
              />
            </Form.Item>
          </div>

          {/* 步骤2: 预览图谱 */}
          <div style={{ display: graphStep === 1 ? 'block' : 'none' }}>
            {graphPreviewData ? (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <Text strong>图谱预览</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    {graphPreviewData.nodes.length} 个节点, {graphPreviewData.edges.length} 条边
                  </Text>
                </div>

                {/* 简单的图谱预览展示 */}
                <div style={{
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: 24,
                  minHeight: 300,
                  background: '#fafafa',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <DeploymentUnitOutlined style={{ fontSize: 64, color: '#13c2c2', marginBottom: 16 }} />
                  <Text type="secondary">图谱可视化组件开发中...</Text>

                  <div style={{ marginTop: 24, width: '100%' }}>
                    <div style={{ marginBottom: 8 }}><Text strong>节点列表：</Text></div>
                    <Space wrap>
                      {graphPreviewData.nodes.map(node => (
                        <Tag key={node.id} color={node.type === 'user' ? 'blue' : 'green'}>
                          {node.label}
                        </Tag>
                      ))}
                    </Space>

                    <div style={{ marginTop: 16, marginBottom: 8 }}><Text strong>关系列表：</Text></div>
                    <Space wrap>
                      {graphPreviewData.edges.map((edge, idx) => (
                        <Tag key={idx} color="default">
                          {graphPreviewData.nodes.find(n => n.id === edge.source)?.label}
                          → {edge.label} →
                          {graphPreviewData.nodes.find(n => n.id === edge.target)?.label}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                </div>
              </div>
            ) : (
              <Empty description="请先配置数据源并生成预览" />
            )}
          </div>

          {/* 步骤3: 保存任务 */}
          <div style={{ display: graphStep === 2 ? 'block' : 'none' }}>
            <Form.Item
              name="name"
              label="任务名称"
              rules={[{ required: true, message: '请输入任务名称' }]}
            >
              <Input placeholder="例如：用户商品关系图谱" />
            </Form.Item>

            <Form.Item name="description" label="任务描述">
              <TextArea rows={2} placeholder="可选，补充说明" />
            </Form.Item>

            <Alert
              message="图数据库配置"
              description="图数据库（如 Neo4j、JanusGraph）集成功能开发中，当前任务将保存配置信息，待图数据库就绪后可执行。"
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
            />
          </div>
        </Form>
      </Modal>
    )
  }

  // 标签管理弹框
  const renderTagModal = () => {
    // 根据父节点类型确定可选的子类型
    const getNodeTypeOptions = () => {
      if (!creatingParent) {
        // 没有父节点，可以选择所有类型
        return [
          { value: 'category', label: '分类' },
          { value: 'type', label: '类型' },
          { value: 'tag', label: '标签' },
        ]
      }
      if (creatingParent.node_type === 'category') {
        // 分类下可以创建类型或标签
        return [
          { value: 'type', label: '类型' },
          { value: 'tag', label: '标签' },
        ]
      }
      if (creatingParent.node_type === 'type') {
        // 类型下只能创建标签
        return [{ value: 'tag', label: '标签' }]
      }
      return []
    }

    const nodeTypeOptions = getNodeTypeOptions()
    const showNodeTypeSelect = nodeTypeOptions.length > 1 && !editingTag

    // 生成标题
    const getModalTitle = () => {
      if (editingTag) return '编辑标签'
      if (creatingParent) return `新建子级 - ${creatingParent.name}`
      return '新建标签'
    }

    return (
      <Modal
        title={getModalTitle()}
        open={tagModalVisible}
        onCancel={() => { setTagModalVisible(false); setCreatingParent(null) }}
        onOk={handleTagSubmit}
        width={500}
      >
        <Form form={tagForm} layout="vertical" autoComplete="off" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="请输入名称" />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="描述" />
          </Form.Item>

          {/* 只有在有多个选项或编辑时才显示类型选择 */}
          {showNodeTypeSelect ? (
            <Form.Item
              name="node_type"
              label="类型"
              rules={[{ required: true, message: '请选择类型' }]}
            >
              <Select options={nodeTypeOptions} />
            </Form.Item>
          ) : (
            // 只有一个选项时，显示固定文本
            creatingParent && nodeTypeOptions.length === 1 && (
              <Form.Item label="类型">
                <Tag color={typeColors[nodeTypeOptions[0].value] || '#d9d9d9'}>
                  {nodeTypeOptions[0].label}
                </Tag>
              </Form.Item>
            )
          )}

          {/* 编辑时也显示类型（只读） */}
          {editingTag && (
            <Form.Item label="类型">
              <Tag color={typeColors[editingTag.node_type] || '#d9d9d9'}>
                {editingTag.node_type === 'category' ? '分类' : editingTag.node_type === 'type' ? '类型' : '标签'}
              </Tag>
            </Form.Item>
          )}

          <Form.Item name="color" label="颜色">
            <Select
              allowClear
              placeholder="选择颜色（可选）"
              options={[
                { value: 'blue', label: '蓝色' },
                { value: 'green', label: '绿色' },
                { value: 'orange', label: '橙色' },
                { value: 'red', label: '红色' },
                { value: 'purple', label: '紫色' },
                { value: 'cyan', label: '青色' },
                { value: 'magenta', label: '品红' },
              ]}
            />
          </Form.Item>

          {!creatingParent && !editingTag && (
            <div style={{ color: '#666', fontSize: 12, marginTop: -8 }}>
              提示：创建后可以在画布上通过连线设置父级关系
            </div>
          )}
        </Form>
      </Modal>
    )
  }

  return (
    <Layout style={{ height: '100vh', background: '#f5f7fa' }}>
      <Header style={{
        background: 'linear-gradient(90deg, #1a1a2e 0%, #16213e 100%)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
        height: 48,
        lineHeight: '48px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setCurrentView(null)}>
            <div style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 13,
            }}>
              <TagsOutlined />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>标签管理平台</span>
          </div>
          <div style={{ height: 16, width: 1, background: 'rgba(255,255,255,0.15)' }} />
          <Button
            type="text"
            size="small"
            icon={<HomeOutlined />}
            onClick={() => window.open('/', '_blank')}
            style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}
          >
            数据平台首页
          </Button>
        </div>
        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
          <div style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.08)',
          }}>
            <Avatar size={22} icon={<UserOutlined />} style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }} />
            <span style={{ color: '#fff', fontSize: 12 }}>{user?.username || 'User'}</span>
            <DownOutlined style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9 }} />
          </div>
        </Dropdown>
      </Header>

      <Content style={{
        overflow: currentView === 'manage' || currentView === 'sql-editor' ? 'hidden' : 'auto',
        display: currentView === 'manage' || currentView === 'sql-editor' ? 'flex' : 'block',
        flexDirection: 'column',
      }}>
        {currentView === null && renderHome()}
        {currentView === 'manage' && renderTagManagement()}
        {currentView === 'sql-editor' && renderSqlEditor()}
        {currentView === 'graph' && renderGraphView()}
        {currentView && !['manage', 'sql-editor', 'graph'].includes(currentView) && renderTaskList()}
      </Content>

      {renderAIModal()}
      {renderSQLModal()}
      {renderCompositeModal()}
      {renderPreviewModal()}
      {renderTagModal()}
      {renderSaveTagModal()}
      {renderGraphModal()}

      {/* 保存布局弹框 */}
      <Modal
        title="保存画布布局"
        open={saveModalVisible}
        onCancel={() => { setSaveModalVisible(false); setLayoutName('') }}
        onOk={handleSaveLayout}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8 }}>布局名称</div>
          <Input
            placeholder="请输入布局名称"
            value={layoutName}
            onChange={(e) => setLayoutName(e.target.value)}
            onPressEnter={handleSaveLayout}
          />
          <div style={{ marginTop: 16, color: '#666', fontSize: 12 }}>
            当前画布包含 {canvasNodes.length} 个节点，{connections.length} 条连接
          </div>
        </div>
      </Modal>

      {/* 上线弹框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 14,
            }}>
              <ScheduleOutlined />
            </div>
            <span>上线任务</span>
          </div>
        }
        open={scheduleModalVisible}
        onCancel={() => { setScheduleModalVisible(false); setSchedulingTask(null) }}
        onOk={handleCreateSchedule}
        okText="确认上线"
        cancelText="取消"
        confirmLoading={schedulingLoading}
        width={560}
        okButtonProps={{
          style: { background: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)', borderColor: 'transparent' }
        }}
      >
        <div style={{ marginTop: 16 }}>
          <div style={{
            marginBottom: 20,
            padding: 16,
            background: 'linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%)',
            borderRadius: 10,
            border: '1px solid #b7eb8f',
          }}>
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <TagOutlined style={{ color: '#52c41a' }} />
              <Text strong style={{ color: '#389e0d' }}>任务信息</Text>
            </div>
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.8 }}>
              <div><Text type="secondary">任务名称：</Text>{schedulingTask?.name}</div>
              <div><Text type="secondary">源表：</Text>{schedulingTask?.source_table || '-'}</div>
              <div><Text type="secondary">类型：</Text>
                <Tag color={schedulingTask?.rule_type === 'sql' ? 'green' : 'blue'} style={{ marginLeft: 4 }}>
                  {schedulingTask?.rule_type === 'sql' ? 'SQL规则' : schedulingTask?.rule_type === 'row' ? 'AI打标' : schedulingTask?.rule_type}
                </Tag>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ScheduleOutlined style={{ color: '#1890ff' }} />
            <Text strong>调度时间设置</Text>
          </div>
          <CronExpressionInput
            value={cronExpression}
            onChange={(v) => setCronExpression(v)}
          />
        </div>
      </Modal>
    </Layout>
  )
}
