import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  TreeSelect,
  ColorPicker,
  Popover,
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
  DownOutlined,
  FolderOpenOutlined,
  FolderOutlined,
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
  AppstoreOutlined,
  DownloadOutlined,
  CodeOutlined,
  LinkOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { tagApi, warehouseApi, scheduleApi, aiApi } from '../services/api'
import Editor from '@monaco-editor/react'
import CronExpressionInput from '../components/CronExpressionInput'
import AIChatPanel from '../components/AIChatPanel'

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
  parent_id?: number
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

export default function TagSystem() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, logout } = useAuthStore()

  // 页面状态
  const [currentView, setCurrentView] = useState<TaskType>(null)
  const [loading, setLoading] = useState(false)
  const [tasks, setTasks] = useState<TagTask[]>([])
  const [statistics, setStatistics] = useState<any>(null)
  const [highlightedTagId, setHighlightedTagId] = useState<number | null>(null)  // 从URL跳转过来时高亮的标签ID（任务页面）
  const [highlightedManageTagId, setHighlightedManageTagId] = useState<number | null>(null)  // 从URL跳转过来时高亮的标签ID（标签页面）
  const [taskSearchText, setTaskSearchText] = useState('')  // 任务搜索文本
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([])  // 展开的行

  // 项目相关
  interface TagProject {
    id: number
    name: string
    description?: string
    color?: string
    icon?: string
    node_count: number
    tag_count: number
    created_at: string
    updated_at: string
  }
  const [projects, setProjects] = useState<TagProject[]>([])
  const [currentProject, setCurrentProject] = useState<TagProject | null>(null)
  const [projectModalVisible, setProjectModalVisible] = useState(false)
  const [editingProject, setEditingProject] = useState<TagProject | null>(null)
  const [projectForm] = Form.useForm()

  // 弹框状态
  const [modalVisible, setModalVisible] = useState(false)
  const [editingTask, setEditingTask] = useState<TagTask | null>(null)
  const [form] = Form.useForm()
  const [chatForm] = Form.useForm()  // AI对话模式专用表单

  // 数据仓库表
  const [tables, setTables] = useState<string[]>([])
  const [loadingTables, setLoadingTables] = useState(false)

  // 执行状态
  const [executing, setExecuting] = useState<number | null>(null)

  // 批量操作
  const [selectedTaskKeys, setSelectedTaskKeys] = useState<React.Key[]>([])
  const [taskScheduleMap, setTaskScheduleMap] = useState<Record<number, { scheduleId: number; isEnabled: boolean; dagId: string }>>({})

  // 预览弹框
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewData, setPreviewData] = useState<any[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)


  // 标签管理
  const [, setTagNodes] = useState<any[]>([])
  const [allTags, setAllTags] = useState<any[]>([]) // 扁平化的当前项目标签
  const [sidebarTags, setSidebarTags] = useState<any[]>([]) // 侧边栏显示的所有标签
  const [tagModalVisible, setTagModalVisible] = useState(false)
  const [editingTag, setEditingTag] = useState<any>(null)
  const [creatingParent, setCreatingParent] = useState<any>(null) // 创建子类时的父节点
  const [creatingStandalone, setCreatingStandalone] = useState(false) // 独立创建标签（不关联项目）
  const [tagForm] = Form.useForm()
  const [hierarchyNodes, setHierarchyNodes] = useState<any[]>([]) // 层级节点树（category/type）

  // 思维导图拖拽相关
  const [nodePositions, setNodePositions] = useState<Record<number, { x: number; y: number }>>({})
  const [collapsedNodes, setCollapsedNodes] = useState<Set<number>>(new Set())  // 收缩的节点ID集合
  const [canvasContextMenu, setCanvasContextMenu] = useState<{ x: number; y: number; step: 'type' | 'dimension'; nodeType?: 'category' | 'type' | 'value' } | null>(null)
  const [draggingNodeId, setDraggingNodeId] = useState<number | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [hasDragged, setHasDragged] = useState(false)
  const mindMapRef = useRef<HTMLDivElement>(null)

  // 拖拽连接相关
  const [dragOverNodeId, setDragOverNodeId] = useState<number | null>(null)
  const [draggingTagFromSidebar, setDraggingTagFromSidebar] = useState<{ id: number; type: string } | null>(null)

  // 节点连线相关
  const [connectingFrom, setConnectingFrom] = useState<{ id: number; x: number; y: number; nodeType: string } | null>(null)
  const [connectingTo, setConnectingTo] = useState<{ x: number; y: number } | null>(null)

  // 待保存的连接变更 { nodeId: { parentId: number | null, projectId: number | null } }
  const [pendingConnections, setPendingConnections] = useState<Record<number, { parentId: number | null; projectId: number | null }>>({})
  const [savingConnections, setSavingConnections] = useState(false)

  // 点击的连线
  const [clickedLine, setClickedLine] = useState<{ childId: number; childName: string; parentName: string; x: number; y: number } | null>(null)
  // 拖拽连线重连
  const [draggingLine, setDraggingLine] = useState<{ childId: number; childName: string; startX: number; startY: number } | null>(null)
  const [draggingLineEnd, setDraggingLineEnd] = useState<{ x: number; y: number } | null>(null)

  // 节点右键菜单
  const [nodeContextMenu, setNodeContextMenu] = useState<{ x: number; y: number; node: any } | null>(null)

  // 侧边栏折叠状态
  const [typeGroupCollapsed, setTypeGroupCollapsed] = useState(false)
  const [tagGroupCollapsed, setTagGroupCollapsed] = useState(false)
  const [collapsedDimensions, setCollapsedDimensions] = useState<Record<number, boolean>>({})

  const toggleDimensionCollapsed = (dimId: number) => {
    setCollapsedDimensions(prev => ({ ...prev, [dimId]: !prev[dimId] }))
  }
  const [detailGroupCollapsed, setDetailGroupCollapsed] = useState(false)

  // 标签列表页面状态
  const [tagSearchText, setTagSearchText] = useState('')
  // tagFilterType removed - now using dimension-based grouping

  // 标签管理子页面
  const [manageSubView, setManageSubView] = useState<'project' | 'tags'>('project')

  // AI打标步骤
  const [aiStep, setAiStep] = useState(0)

  // AI生成SQL模式
  const [generatedSql, setGeneratedSql] = useState('')
  const [generatingSql, setGeneratingSql] = useState(false)
  const [sqlConfirmed, setSqlConfirmed] = useState(false)
  const [extractedTags, setExtractedTags] = useState<string[]>([])  // AI提取的标签

  // AI打标Tab: 'single' 单表打标, 'chat' AI对话（粒度标签）, 'dimension' 智能-值标签
  const [aiTabKey, setAiTabKey] = useState<'single' | 'chat' | 'dimension'>('single')

  // 智能-值标签相关
  interface Dimension {
    id: number
    name: string
    display_name: string
    id_field: string
    description?: string
    is_preset: boolean
  }
  const [dimensions, setDimensions] = useState<Dimension[]>([])
  const [selectedDimension, setSelectedDimension] = useState<Dimension | null>(null)
  const [dimensionSessionId, setDimensionSessionId] = useState<string | null>(null)
  const [dimensionMessages, setDimensionMessages] = useState<{ role: string; content: string }[]>([])
  const [dimensionInput, setDimensionInput] = useState('')
  const [dimensionSending, setDimensionSending] = useState(false)
  const [dimensionTags, setDimensionTags] = useState<{ name: string; description?: string }[]>([])
  const [dimensionTypeName, setDimensionTypeName] = useState('')
  const [dimensionTypeDesc, setDimensionTypeDesc] = useState('')
  const [dimensionSql, setDimensionSql] = useState('')
  const dimensionMessagesEndRef = useRef<HTMLDivElement>(null)
  // 标签建议勾选
  interface TagValue { name: string; description: string; condition?: string; selected: boolean }
  interface TagSuggestion { type_name: string; type_description: string; field?: string; values: TagValue[]; selected: boolean }
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([])

  // 维度定义相关 - 简化为直接输入
  const [dimensionModalVisible, setDimensionModalVisible] = useState(false)
  const [newDimensionName, setNewDimensionName] = useState('')
  const [dimensionSaving, setDimensionSaving] = useState(false)

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
  const [compositeTags, setCompositeTags] = useState<TagTask[]>([]) // 有规则引擎的标签列表

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

  // 标签详情弹框状态
  const [tagDetailVisible, setTagDetailVisible] = useState(false)
  const [tagDetailData, setTagDetailData] = useState<any>(null)
  const [tagDetailChildren, setTagDetailChildren] = useState<any[]>([])  // 类型标签的子标签列表
  const [tagPreviewData, setTagPreviewData] = useState<{ columns: string[], rows: any[], total: number, filter?: string } | null>(null)
  const [tagPreviewLoading, setTagPreviewLoading] = useState(false)
  const [tagShowPreview, setTagShowPreview] = useState(false)

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
  }, [])

  // 处理 URL 参数 - 从任务列表或调度页面点击标签名跳转过来
  useEffect(() => {
    const viewParam = searchParams.get('view')
    const tagIdParam = searchParams.get('tagId')

    if (viewParam) {
      setCurrentView(viewParam as TaskType)
      // 如果是 manage 视图且有 tagId，直接进入标签页面
      if (viewParam === 'manage' && tagIdParam) {
        setManageSubView('tags')
        setHighlightedManageTagId(parseInt(tagIdParam))
      }
    }

    // 如果有 tagId 参数且不是 manage 视图，保存到任务页面高亮状态
    if (tagIdParam && viewParam !== 'manage') {
      setHighlightedTagId(parseInt(tagIdParam))
    }

    if (tagIdParam) {
      setSearchParams({})
    }
  }, [])

  // 当任务加载完成且有高亮标签时，用任务名称筛选
  useEffect(() => {
    if (highlightedTagId && tasks.length > 0) {
      const targetTask = tasks.find(t => t.id === highlightedTagId)
      if (targetTask) {
        // 如果是值标签，用父标签名筛选（这样父标签和所有子标签都显示）
        const isValueTag = targetTask.node_type === 'value' || targetTask.node_type === 'tag'
        if (isValueTag && targetTask.parent_id) {
          const parentTask = tasks.find(t => t.id === targetTask.parent_id)
          if (parentTask) {
            setTaskSearchText(parentTask.name)
            // 展开父节点
            setExpandedRowKeys([parentTask.id])
          } else {
            setTaskSearchText(targetTask.name)
          }
        } else {
          // 类型标签，直接用自己的名字筛选
          setTaskSearchText(targetTask.name)
        }
        // 8秒后清除高亮和展开
        const timer = setTimeout(() => {
          setHighlightedTagId(null)
          setExpandedRowKeys([])
        }, 8000)
        return () => clearTimeout(timer)
      }
    }
  }, [highlightedTagId, tasks])

  // 标签页面：当sidebarTags加载完成且有高亮标签ID时，设置搜索文本
  useEffect(() => {
    if (highlightedManageTagId && sidebarTags.length > 0) {
      const targetTag = sidebarTags.find(t => t.id === highlightedManageTagId)
      if (targetTag) {
        // 如果是类型标签，用类型标签名筛选（显示类型标签和它的子标签）
        if (targetTag.node_type === 'type') {
          setTagSearchText(targetTag.name)
        } else {
          // 值标签，直接用值标签名筛选
          setTagSearchText(targetTag.name)
        }
        // 8秒后清除
        const timer = setTimeout(() => {
          setHighlightedManageTagId(null)
        }, 8000)
        return () => clearTimeout(timer)
      }
    }
  }, [highlightedManageTagId, sidebarTags])

  useEffect(() => {
    if (currentView) {
      if (currentView === 'manage') {
        loadProjects()
        loadTagNodes() // 加载标签列表
        // 加载维度列表（用于按维度分组展示）
        tagApi.listDimensions().then(res => setDimensions(res.data || [])).catch(() => {})
      } else if (currentView === 'composite') {
        loadTasks()
        loadCompositeTags()
        loadHierarchyForSelect()
      } else if (currentView === 'sql-editor') {
        loadEditorTables()
        loadHierarchyForSelect()
      } else if (currentView === 'graph') {
        loadGraphTasks()
        loadTables()
      } else {
        loadTasks()
        loadTables()
        loadHierarchyForSelect()
      }
    }
  }, [currentView])

  // 加载项目列表
  const loadProjects = async () => {
    setLoading(true)
    try {
      const res = await tagApi.listProjects()
      setProjects(res.data || [])
    } catch (error) {
      message.error('加载项目列表失败')
    } finally {
      setLoading(false)
    }
  }

  // 加载层级节点用于选择
  const loadHierarchyForSelect = async () => {
    try {
      const res = await tagApi.getHierarchy()
      setHierarchyNodes(res.data || [])
    } catch (error) {
      console.error('Failed to load hierarchy')
    }
  }

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
        parent_id: values.parent_id || null,
        rule_config: {
          source_table: editorSelectedTable || '',
          full_sql: editorSql,
          source: 'sql',  // 标识为规则引擎手动创建
        } as any,
      })
      message.success('标签创建成功')
      setSaveTagModalVisible(false)
      saveTagForm.resetFields()
      setCurrentView('sql')  // 返回规则引擎列表
      loadTasks()
      loadStatistics()
    } catch (error: any) {
      if (error.errorFields) return
      message.error(error.response?.data?.detail || '创建失败')
    }
  }

  // 加载可用于复合智能标签的标签列表（有规则引擎的标签）
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
      // 过滤出有规则引擎的标签
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

  const loadStatistics = async () => {
    try {
      const res = await tagApi.getStatistics()
      setStatistics(res.data)
    } catch (error) {
      console.error('Failed to load statistics')
    }
  }

  const loadTagNodes = async (projectId?: number) => {
    setLoading(true)
    try {
      // 并行加载所有数据
      const pid = projectId ?? currentProject?.id
      const [treeRes, allTreeRes, hierarchyRes] = await Promise.all([
        tagApi.getTree(pid),  // 当前项目的树（用于画布）
        tagApi.getTree(),     // 所有节点（用于侧边栏）
        tagApi.getHierarchy(),
      ])

      const treeData = treeRes.data || []
      setTagNodes(treeData)
      setHierarchyNodes(hierarchyRes.data || [])

      // 扁平化当前项目的标签（用于画布）
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

      // 扁平化所有标签（用于侧边栏列表）
      const allFlat: any[] = []
      const flattenAll = (nodes: any[], parentId?: number) => {
        for (const node of nodes) {
          allFlat.push({ ...node, parent_id: parentId })
          if (node.children?.length) {
            flattenAll(node.children, node.id)
          }
        }
      }
      flattenAll(allTreeRes.data || [])
      setSidebarTags(allFlat)
    } catch (error) {
      message.error('加载标签失败')
    } finally {
      setLoading(false)
    }
  }

  const loadTasks = async () => {
    setLoading(true)
    setSelectedTaskKeys([]) // 清除选中状态
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

      // 获取所有调度，构建 taskId -> schedule 的映射
      const schedulesRes = await scheduleApi.list()
      const schedules = schedulesRes.data || []
      const scheduleMap: Record<number, { scheduleId: number; isEnabled: boolean; dagId: string }> = {}

      for (const schedule of schedules) {
        // 根据 dag_id 格式 tag_task_{id} 解析任务ID
        const match = schedule.dag_id?.match(/^tag_task_(\d+)$/)
        if (match) {
          const taskId = parseInt(match[1])
          scheduleMap[taskId] = {
            scheduleId: schedule.id,
            isEnabled: schedule.status === 'active' && schedule.is_deployed,  // 已部署且状态为active
            dagId: schedule.dag_id,
          }
        }
      }
      setTaskScheduleMap(scheduleMap)

      // 为任务添加调度状态
      const addScheduleStatus = (nodes: TagTask[]) => {
        return nodes.map(t => ({
          ...t,
          is_scheduled: !!scheduleMap[t.id]?.isEnabled,
        }))
      }

      // 根据当前视图过滤 - 每个功能只显示自己创建的任务
      if (currentView === 'ai') {
        // AI打标视图：显示AI生成的任务（类型标签）和对应的值标签
        const filtered = allNodes.filter((t) => {
          // 值标签也显示（它们是AI维度标签的子标签）
          if (t.node_type === 'value' || t.node_type === 'tag') {
            return true
          }
          if (t.rule_type !== 'sql') return false
          if (t.rule_config) {
            try {
              const config = JSON.parse(t.rule_config)
              // 排除复合智能标签
              if (config.composite_tags) return false
              // AI打标的特征：source === 'ai' 或 'ai_chat' 或 'ai_dimension'
              return config.source === 'ai' || config.source === 'ai_chat' || config.source === 'ai_dimension'
            } catch { /* ignore */ }
          }
          return false
        })
        setTasks(addScheduleStatus(filtered))
      } else if (currentView === 'sql') {
        // 规则引擎视图：只显示手动创建的规则引擎（不是AI生成的，也不是复合智能标签）
        const filtered = allNodes.filter((t) => {
          if (t.rule_type !== 'sql') return false
          if (t.rule_config) {
            try {
              const config = JSON.parse(t.rule_config)
              // 排除复合智能标签
              if (config.composite_tags) return false
              // 排除AI打标
              if (config.source === 'ai' || config.source === 'ai_chat' || config.source === 'ai_dimension') return false
              // 排除复合智能标签的SQL
              const fullSql = config.full_sql || ''
              if (fullSql.startsWith('-- 复合智能标签SQL')) return false
              return true
            } catch { /* ignore */ }
          }
          return true
        })
        setTasks(addScheduleStatus(filtered))
      } else if (currentView === 'composite') {
        // 复合智能标签视图：只显示有composite_tags配置的规则引擎
        const filtered = allNodes.filter((t) => {
          if (t.rule_type !== 'sql') return false
          if (t.rule_config) {
            try {
              const config = JSON.parse(t.rule_config)
              return !!config.composite_tags
            } catch { /* ignore */ }
          }
          return false
        })
        setTasks(addScheduleStatus(filtered))
      } else if (currentView === 'dataset') {
        setTasks(addScheduleStatus(allNodes.filter((t) => t.rule_type === 'dataset')))
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
        parent_id: values.parent_id || null,
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

  // 删除任务（保留标签，只清除任务配置）
  const handleDeleteTask = async (id: number, taskName?: string) => {
    try {
      // 先检查是否有关联的调度
      const schedulesRes = await scheduleApi.list()
      const relatedSchedule = (schedulesRes.data || []).find(
        (s: any) => s.dag_id === `tag_task_${id}` || s.name === `标签任务-${taskName}`
      )

      // 如果有关联的调度（无论上线还是下线），必须先在调度管理中删除
      if (relatedSchedule) {
        const isActive = relatedSchedule.status === 'active' && relatedSchedule.is_deployed
        Modal.warning({
          title: '无法删除',
          content: (
            <div>
              <div>任务「{taskName || '未命名'}」存在关联的调度任务，请先在调度管理中处理。</div>
              <div style={{ marginTop: 12, padding: 12, background: '#f5f5f5', borderRadius: 6 }}>
                <div style={{ fontSize: 13, color: '#666' }}>
                  <strong>操作步骤：</strong>
                  <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                    {isActive && <li>在调度管理页面下线该调度</li>}
                    <li>在调度管理页面删除该调度</li>
                    <li>返回此处删除任务</li>
                  </ol>
                </div>
              </div>
            </div>
          ),
          okText: '前往调度管理',
          cancelText: '取消',
          onOk: () => {
            navigate('/scheduler')
          }
        })
        return
      }

      // 没有关联的调度，确认删除
      Modal.confirm({
        title: '确认删除任务',
        content: (
          <div>
            <div>确定要删除任务「{taskName || '未命名'}」吗？</div>
            <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
              删除后：
              <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                <li>任务配置和SQL将被清除</li>
                <li>标签本身将保留</li>
              </ul>
            </div>
          </div>
        ),
        okText: '删除任务',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            // 清除任务配置，保留标签
            await tagApi.updateNode(id, {
              rule_type: null,
              rule_config: null,
            })
            message.success('任务已删除，标签已保留')
            loadTasks()
            loadTagNodes()
            loadStatistics()
          } catch (error: any) {
            message.error(error.response?.data?.detail || '删除失败')
          }
        }
      })
    } catch (error: any) {
      message.error('检查调度状态失败')
    }
  }

  // 批量上线
  const handleBatchOnline = () => {
    const selectedTasks = tasks.filter(t => selectedTaskKeys.includes(t.id))
    const offlineTasks = selectedTasks.filter(t => !taskScheduleMap[t.id]?.isEnabled)

    if (offlineTasks.length === 0) {
      message.warning('所选任务中没有可上线的任务（可能都已上线）')
      return
    }

    Modal.confirm({
      title: '批量上线',
      content: (
        <div>
          <div>确定要上线 {offlineTasks.length} 个任务吗？</div>
          <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
            上线后任务将按默认调度规则（每天0点）执行，如需自定义请单独配置。
          </div>
        </div>
      ),
      okText: '确认上线',
      cancelText: '取消',
      onOk: async () => {
        let successCount = 0
        let failCount = 0

        for (const task of offlineTasks) {
          try {
            const res = await tagApi.createTagSchedule(task.id, '0 0 * * *')
            const scheduleId = res.data?.schedule_id
            if (scheduleId) {
              await scheduleApi.deploy(scheduleId)
              successCount++
            }
          } catch {
            failCount++
          }
        }

        if (successCount > 0) {
          message.success(`成功上线 ${successCount} 个任务${failCount > 0 ? `，${failCount} 个失败` : ''}`)
          loadTasks()
        } else {
          message.error('批量上线失败')
        }
      }
    })
  }

  // 批量删除
  const handleBatchDelete = async () => {
    const selectedTasks = tasks.filter(t => selectedTaskKeys.includes(t.id))

    // 检查是否有关联调度的任务（无论上线还是下线）
    const tasksWithSchedule = selectedTasks.filter(t => taskScheduleMap[t.id])
    if (tasksWithSchedule.length > 0) {
      const onlineTasks = tasksWithSchedule.filter(t => taskScheduleMap[t.id]?.isEnabled)
      Modal.warning({
        title: '无法删除',
        content: (
          <div>
            <div>以下 {tasksWithSchedule.length} 个任务存在关联的调度，请先在调度管理中删除：</div>
            <ul style={{ marginTop: 8, paddingLeft: 20, maxHeight: 200, overflow: 'auto' }}>
              {tasksWithSchedule.map(t => (
                <li key={t.id}>
                  {t.name}
                  {taskScheduleMap[t.id]?.isEnabled && <span style={{ color: '#52c41a', marginLeft: 8 }}>(已上线)</span>}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 12, padding: 12, background: '#f5f5f5', borderRadius: 6 }}>
              <div style={{ fontSize: 13, color: '#666' }}>
                <strong>操作步骤：</strong>
                <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                  {onlineTasks.length > 0 && <li>在调度管理页面下线已上线的调度</li>}
                  <li>在调度管理页面删除所有相关调度</li>
                  <li>返回此处批量删除任务</li>
                </ol>
              </div>
            </div>
          </div>
        ),
        okText: '前往调度管理',
        cancelText: '取消',
        onOk: () => {
          navigate('/scheduler')
        }
      })
      return
    }

    // 计算子节点数量
    let childCount = 0
    for (const task of selectedTasks) {
      const children = tasks.filter(t => t.parent_id === task.id)
      childCount += children.length
    }

    Modal.confirm({
      title: '批量删除',
      content: (
        <div>
          <div>确定要删除 {selectedTasks.length} 个标签吗？</div>
          {childCount > 0 && (
            <div style={{ marginTop: 8, padding: 8, background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 4 }}>
              <span style={{ color: '#fa8c16' }}>⚠️ 这些标签下共有 {childCount} 个子标签，将一并删除</span>
            </div>
          )}
          <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
            删除后：
            <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
              <li>标签及其所有子标签将被永久删除</li>
              <li>相关的任务配置和数据将被清除</li>
            </ul>
          </div>
        </div>
      ),
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        let successCount = 0
        let failCount = 0

        for (const task of selectedTasks) {
          try {
            // 真正删除节点（后端会级联删除子节点）
            await tagApi.deleteNode(task.id)
            // 清理 pendingConnections
            setPendingConnections(prev => {
              const next = { ...prev }
              delete next[task.id]
              return next
            })
            successCount++
          } catch {
            failCount++
          }
        }

        if (successCount > 0) {
          message.success(`成功删除 ${successCount} 个标签${childCount > 0 ? '（含子标签）' : ''}${failCount > 0 ? `，${failCount} 个失败` : ''}`)
          setSelectedTaskKeys([])
          loadTasks()
          loadTagNodes()
          loadStatistics()
        } else {
          message.error('批量删除失败')
        }
      }
    })
  }

  const handleSubmit = async () => {
    try {
      // 根据模式选择正确的表单
      const currentForm = (currentView === 'ai' && (aiTabKey === 'chat' || aiTabKey === 'dimension')) ? chatForm : form
      const values = await currentForm.validateFields()

      if (currentView === 'ai') {
        // 值标签模式：批量创建
        if (aiTabKey === 'dimension') {
          if (!selectedDimension) {
            message.error('请先选择维度')
            return
          }
          if (!dimensionTags.length) {
            message.error('请先通过AI对话生成标签')
            return
          }

          // 批量模式：dimensionTags 是完整的 dimension_tags_list
          if (dimensionSql === 'batch' && Array.isArray(dimensionTags) && (dimensionTags as any)[0]?.type_name) {
            // 批量创建多个类型标签
            const tagsList = dimensionTags as any[]
            let totalTags = 0
            for (const typeTag of tagsList) {
              await tagApi.batchCreateDimensionTags({
                type_name: typeTag.type_name,
                type_description: typeTag.type_description || '',
                parent_id: values.parent_id,
                dimension_id: selectedDimension.id,
                tags: typeTag.tags || [],
                rule_config: {
                  full_sql: typeTag.sql || '',
                  source_table: 'multi_table',
                  source: 'ai_dimension',
                },
              })
              totalTags += (typeTag.tags?.length || 0)
            }
            message.success(`成功创建 ${tagsList.length} 个类型标签 + ${totalTags} 个值标签`)
          } else {
            // 单个类型标签
            await tagApi.batchCreateDimensionTags({
              type_name: values.name || dimensionTypeName,
              type_description: values.description || dimensionTypeDesc,
              parent_id: values.parent_id,
              dimension_id: selectedDimension.id,
              tags: dimensionTags,
              rule_config: {
                full_sql: dimensionSql,
                source_table: 'multi_table',
                source: 'ai_dimension',
              },
            })
            message.success(`成功创建 1 个类型标签 + ${dimensionTags.length} 个值标签`)
          }
          setModalVisible(false)
          // 重置维度相关状态
          setSelectedDimension(null)
          setDimensionSessionId(null)
          setDimensionMessages([])
          setDimensionTags([])
          setDimensionTypeName('')
          setDimensionTypeDesc('')
          setDimensionSql('')
          setSqlConfirmed(false)
          setAiTabKey('single')
          chatForm.resetFields()
          loadTasks()
          loadTagNodes()
          loadStatistics()
          return
        }

        // AI生成SQL模式（单表打标 / 粒度标签）
        if (!generatedSql) {
          message.error('请先生成并确认SQL')
          return
        }
        // AI对话模式下，source_table 可能为空（全库模式），使用 'multi_table' 标识
        const isAiChatMode = aiTabKey === 'chat'
        const sourceTable = values.source_table || (isAiChatMode ? 'multi_table' : '')
        // chat=粒度标签(detail), single=值标签(tag)
        const nodeType = aiTabKey === 'chat' ? 'detail' : 'tag'
        // 区分来源：ai_chat=粒度标签对话, ai=单表打标
        const sourceType = aiTabKey === 'chat' ? 'ai_chat' : 'ai'
        await tagApi.createRuleTag({
          name: values.name,
          description: values.description || values.sql_prompt,
          parent_id: values.parent_id || null,  // 可选的层级绑定
          node_type: nodeType,
          rule_config: {
            source_table: sourceTable,
            full_sql: generatedSql,
            source: sourceType,
            tag_table_name: values.tag_table_name || undefined,  // AI生成的目标表名
          },
        })
      } else if (currentView === 'sql') {
        // 规则引擎标签（从规则引擎入口进入）
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
      // 重置状态
      setGeneratedSql('')
      setSqlConfirmed(false)
      setExtractedTags([])
      setAiStep(0)
      setAiTabKey('single')
      form.resetFields()
      chatForm.resetFields()
      loadTasks()
      loadTagNodes()  // 刷新侧边栏，确保rule_type更新
      loadStatistics()
    } catch (error: any) {
      console.error('保存任务失败:', error)
      if (error.errorFields) {
        message.error('请填写任务名称')
        return
      }
      message.error(error.response?.data?.detail || '保存失败')
    }
  }

  const handleExecute = async (task: TagTask) => {
    setExecuting(task.id)
    try {
      if (task.rule_type === 'row') {
        // 智能标签
        const res = await tagApi.executeRowTag(task.id, {})
        message.success(res.data?.message || '智能标签已启动，后台执行中...')
        setTimeout(() => {
          message.info('执行完成后可点击"预览"查看打标结果')
        }, 2000)
      } else if (task.rule_type === 'sql') {
        // 规则引擎标签：先检查是否需要生成SQL
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
        // 执行规则引擎
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
        onOk: () => navigate('/scheduler'),
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

    // 根据父节点类型设置默认子类型
    if (parent) {
      if (parent.node_type === 'category') {
        tagForm.setFieldValue('node_type', 'category') // 默认创建子分类
      } else if (parent.node_type === 'type') {
        tagForm.setFieldValue('node_type', 'value') // 只能创建值标签
      }
    } else {
      tagForm.setFieldValue('node_type', 'category') // 根节点默认创建分类
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

  // 查看标签详情
  const handleViewTagDetail = async (tag: any) => {
    setTagDetailData(tag)
    setTagDetailVisible(true)
    setTagPreviewData(null)
    setTagShowPreview(false)
    setTagDetailChildren([])

    // 如果是类型标签，加载子标签列表
    if (tag.node_type === 'type') {
      try {
        const res = await tagApi.listNodes({ parent_id: tag.id })
        setTagDetailChildren(res.data || [])
      } catch (error) {
        console.error('Failed to load child tags:', error)
      }
    }
  }

  // 加载标签预览数据
  const handleLoadTagPreview = async () => {
    // 值标签可以从父类型获取数据，不需要自己有 tag_table_name
    const isValueTag = tagDetailData?.node_type === 'value' || tagDetailData?.node_type === 'tag'
    if (!isValueTag && !tagDetailData?.tag_table_name) {
      message.warning('尚未生成数据表')
      return
    }
    if (isValueTag && !tagDetailData?.parent_id) {
      message.warning('值标签缺少父类型，无法加载数据')
      return
    }
    setTagShowPreview(true)
    setTagPreviewLoading(true)
    try {
      const res = await tagApi.previewTagData(tagDetailData.id, 100)
      setTagPreviewData(res.data)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '加载预览数据失败')
    } finally {
      setTagPreviewLoading(false)
    }
  }

  // 下载标签数据为Excel
  const handleDownloadTagData = () => {
    if (!tagPreviewData || tagPreviewData.rows.length === 0) {
      message.warning('没有数据可下载')
      return
    }

    // 构建CSV内容
    const { columns, rows } = tagPreviewData
    const csvContent = [
      columns.join(','),
      ...rows.map(row => row.map((cell: any) => `"${cell || ''}"`).join(','))
    ].join('\n')

    // 添加BOM以支持中文
    const BOM = '\uFEFF'
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${tagDetailData?.name || '标签数据'}_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
    message.success('下载成功')
  }

  const handleTagSubmit = async () => {
    try {
      const values = await tagForm.validateFields()

      // 处理 ColorPicker 返回的颜色对象，转换为 hex 字符串
      const processedValues = {
        ...values,
        color: values.color
          ? (typeof values.color === 'string' ? values.color : values.color.toHexString?.() || null)
          : null,
      }

      // 先保存待处理的连接变更（避免刷新时丢失拖拽的标签）
      if (Object.keys(pendingConnections).length > 0) {
        const promises = Object.entries(pendingConnections).map(async ([nodeId, data]) => {
          try {
            await tagApi.updateNode(Number(nodeId), {
              parent_id: data.parentId,
              project_id: data.projectId
            })
          } catch (err: any) {
            // 忽略 404 错误（节点可能已被删除）
            if (err.response?.status !== 404) {
              throw err
            }
            console.warn(`节点 ${nodeId} 不存在，跳过连接保存`)
          }
        })
        await Promise.all(promises)
        setPendingConnections({})
      }

      if (editingTag) {
        await tagApi.updateNode(editingTag.id, processedValues)
        message.success('更新成功')
      } else {
        // 如果有父节点，添加 parent_id；独立创建模式不设置 project_id
        // 显式设置 parent_id，确保创建根节点时一定是 null（避免表单残留值）
        const createData = {
          ...processedValues,
          parent_id: creatingParent ? creatingParent.id : null,
          ...(!creatingStandalone && currentProject ? { project_id: currentProject.id } : {}),
        }

        await tagApi.createNode(createData)
        message.success('创建成功')
      }
      setTagModalVisible(false)
      setCreatingParent(null)
      setCreatingStandalone(false)
      // 传递当前项目 ID 刷新导图
      loadTagNodes(currentProject?.id)
      loadStatistics()
    } catch (error: any) {
      if (error.errorFields) return
      message.error(error.response?.data?.detail || '操作失败')
    }
  }

  const handleDeleteTag = async (id: number) => {
    // 从API获取最新的标签信息，避免使用过期缓存
    let tag: any = null
    try {
      const res = await tagApi.getNode(id)
      tag = res.data
    } catch {
      // 如果API获取失败，尝试从缓存获取
      tag = sidebarTags.find(t => t.id === id)
    }

    if (!tag) {
      message.error('标签不存在')
      return
    }

    // 检查是否有任务关联（rule_type 不为空说明有任务）- 必须去任务页面删除
    if (tag.rule_type) {
      const ruleTypeMap: Record<string, string> = {
        'ai': '智能标签',
        'ai_chat': 'AI对话任务',
        'sql': '规则引擎任务',
        'composite': '复合智能标签',
        'row': '行级标签任务',
        'graph': '图谱标签',
      }

      // 判断任务类型对应的视图
      let taskView = 'ai'
      if (tag.rule_config) {
        try {
          const config = JSON.parse(tag.rule_config)
          if (config.composite_tags) {
            taskView = 'composite'
          } else if (config.source === 'ai' || config.source === 'ai_chat' || config.source === 'ai_dimension') {
            taskView = 'ai'
          } else {
            taskView = 'sql'
          }
        } catch { /* ignore */ }
      }

      Modal.warning({
        title: '无法删除',
        width: 480,
        content: (
          <div>
            <div style={{ marginBottom: 16, color: '#666' }}>
              标签「{tag.name}」关联了任务，必须先在标签任务页面删除任务。
            </div>
            <div style={{ padding: 12, background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color="orange">关联任务</Tag>
                <span>{ruleTypeMap[tag.rule_type] || tag.rule_type}</span>
              </div>
            </div>
            <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 6, fontSize: 13, color: '#666' }}>
              <strong>操作步骤：</strong>
              <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                <li>前往标签任务页面</li>
                <li>找到并删除关联的任务</li>
                <li>返回此处删除标签</li>
              </ol>
            </div>
          </div>
        ),
        okText: '前往任务页面',
        cancelText: '取消',
        onOk: () => {
          setCurrentView(taskView as any)
        }
      })
      return
    }

    // 检查是否在画布中（nodePositions 中有该标签）
    if (nodePositions[id]) {
      Modal.warning({
        title: '无法删除',
        width: 480,
        content: (
          <div>
            <div style={{ marginBottom: 16, color: '#666' }}>
              标签「{tag.name}」在导图画布中被引用，必须先从画布中移除。
            </div>
            <div style={{ padding: 12, background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color="blue">画布引用</Tag>
                <span>{currentProject?.name || '当前导图'}</span>
              </div>
            </div>
            <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 6, fontSize: 13, color: '#666' }}>
              <strong>操作步骤：</strong>
              <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                <li>进入导图页面</li>
                <li>在画布中找到该标签并移除</li>
                <li>返回此处删除标签</li>
              </ol>
            </div>
          </div>
        ),
        okText: '知道了',
        cancelText: '取消'
      })
      return
    }

    // 没有阻塞项，二次确认后删除
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除标签「${tag.name}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await tagApi.deleteNode(id)
          message.success('删除成功')
          // 清理 pendingConnections 中的对应节点
          setPendingConnections(prev => {
            const next = { ...prev }
            delete next[id]
            return next
          })
          loadTagNodes()
          loadStatistics()
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
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
      title: '规则引擎',
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
      description: '管理标签项目和标签',
      color: '#fa8c16',
      count: statistics?.tag_count || 0,
    },
  ]

  // 渲染首页卡片
  const renderHome = () => (
    <div style={{ padding: '20px 40px' }}>
      {/* 统计概览 */}
      {statistics && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
          <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: 8, minWidth: 130 }}>
            <div style={{ fontSize: 26, fontWeight: 600, color: '#fff' }}>{statistics.total_nodes}</div>
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>总节点数</div>
          </div>
          <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', borderRadius: 8, minWidth: 130 }}>
            <div style={{ fontSize: 26, fontWeight: 600, color: '#fff' }}>{statistics.tag_count}</div>
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>标签数</div>
          </div>
          <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #fc4a1a 0%, #f7b733 100%)', borderRadius: 8, minWidth: 130 }}>
            <div style={{ fontSize: 26, fontWeight: 600, color: '#fff' }}>{statistics.total_tagged_data}</div>
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>打标数据</div>
          </div>
          <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', borderRadius: 8, minWidth: 130 }}>
            <div style={{ fontSize: 26, fontWeight: 600, color: '#fff' }}>{statistics.ai_generated_count + statistics.rule_tag_count}</div>
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>任务数</div>
          </div>
        </div>
      )}

      <div style={{
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 4,
            height: 24,
            borderRadius: 2,
            background: 'linear-gradient(180deg, #667eea 0%, #764ba2 100%)',
          }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a2e' }}>全功能</div>
            <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>选择功能开始使用</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 60, height: 1, background: 'linear-gradient(90deg, transparent, #e8e8e8)' }} />
          <ThunderboltOutlined style={{ color: '#bbb', fontSize: 14 }} />
          <div style={{ width: 60, height: 1, background: 'linear-gradient(90deg, #e8e8e8, transparent)' }} />
        </div>
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
            <Tag color={card.color}>{card.count} 个</Tag>
          </div>
        ))}
      </div>
    </div>
  )

  // 渲染任务列表
  const renderTaskList = () => {
    const viewTitle = currentView === 'ai' ? '智能标签' : currentView === 'sql' ? '规则引擎标签' : currentView === 'composite' ? '复合智能标签' : '数据集'

    const columns = [
      {
        title: '任务名称',
        dataIndex: 'name',
        key: 'name',
        width: 200,
        ellipsis: true,
        render: (name: string, record: TagTask) => (
          <Space>
            {record.id === highlightedTagId && (
              <Tag color="orange" style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>当前</Tag>
            )}
            <a
              style={{ fontWeight: 500, color: record.id === highlightedTagId ? '#fa8c16' : '#1890ff', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                // 在新标签页打开标签页面，带上标签ID参数
                window.open(`/tags?tagId=${record.id}&view=manage`, '_blank')
              }}
            >
              {name}
            </a>
          </Space>
        ),
      },
      {
        title: '类型',
        dataIndex: 'rule_type',
        key: 'rule_type',
        width: 80,
        render: (type: string, record: TagTask) => {
          // 值标签显示"值标签"
          if (record.node_type === 'value' || record.node_type === 'tag') {
            return <Tag color="green" style={{ margin: 0 }}>值标签</Tag>
          }
          // 类型标签显示"类型标签"
          if (record.node_type === 'type') {
            return <Tag color="blue" style={{ margin: 0 }}>类型标签</Tag>
          }
          return (
            <Tag color="default" style={{ margin: 0 }}>
              {type || '-'}
            </Tag>
          )
        },
      },
      {
        title: '源表',
        dataIndex: 'source_table',
        key: 'source_table',
        width: 150,
        ellipsis: true,
        render: (table: string) => table || '-',
      },
      {
        title: '数据量',
        dataIndex: 'usage_count',
        key: 'usage_count',
        width: 70,
        align: 'center' as const,
      },
      {
        title: '创建时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 150,
        render: (date: string) => date ? new Date(date).toLocaleString() : '-',
      },
      {
        title: '状态',
        dataIndex: 'is_scheduled',
        key: 'status',
        width: 80,
        align: 'center' as const,
        render: (isScheduled: boolean) => (
          isScheduled ? (
            <Tag color="success" style={{ margin: 0 }}>已上线</Tag>
          ) : (
            <Tag color="default" style={{ margin: 0 }}>未上线</Tag>
          )
        ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 160,
        fixed: 'right' as const,
        render: (_: any, record: TagTask) => {
          // 值标签禁用执行和调度按钮
          const isValueTag = record.node_type === 'value' || record.node_type === 'tag'
          return (
            <Space size={4}>
              {(currentView === 'ai' || currentView === 'sql' || currentView === 'composite') && (
                <Tooltip title={isValueTag ? '值标签不支持执行' : '执行'}>
                  <Button
                    type="link"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    loading={executing === record.id}
                    disabled={isValueTag}
                    onClick={() => handleExecute(record)}
                    style={{ padding: '0 4px' }}
                  />
                </Tooltip>
              )}
              <Tooltip title="预览">
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => handlePreview(record)}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
              {(currentView === 'ai' || currentView === 'sql' || currentView === 'composite') && (
                record.is_scheduled ? (
                  <Tooltip title="前往调度管理下线">
                    <Button
                      type="link"
                      size="small"
                      icon={<ScheduleOutlined />}
                      disabled={isValueTag}
                      onClick={() => navigate('/scheduler')}
                      style={{ color: isValueTag ? undefined : '#52c41a', padding: '0 4px' }}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip title={isValueTag ? '值标签不支持调度' : '上线'}>
                    <Button
                      type="link"
                      size="small"
                      icon={<ScheduleOutlined />}
                      disabled={isValueTag}
                      onClick={() => handleOpenSchedule(record)}
                      style={{ padding: '0 4px' }}
                    />
                  </Tooltip>
                )
              )}
              <Tooltip title="删除">
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDeleteTask(record.id, record.name)}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
            </Space>
          )
        },
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
          <Space>
            <Input.Search
              placeholder="搜索任务名称"
              allowClear
              value={taskSearchText}
              onChange={(e) => setTaskSearchText(e.target.value)}
              style={{ width: 200 }}
              size="small"
            />
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
          </Space>
        </div>

        {/* 批量操作栏 */}
        {(() => {
          // 只统计当前任务列表中实际存在的选中项
          const actualSelectedCount = tasks.filter(t => selectedTaskKeys.includes(t.id)).length
          return actualSelectedCount > 0 && (
          <div style={{
            background: '#e6f7ff',
            borderRadius: 8,
            padding: '8px 16px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ color: '#1890ff' }}>
              已选择 <strong>{actualSelectedCount}</strong> 个任务
            </span>
            <Space>
              <Button size="small" icon={<ScheduleOutlined />} onClick={handleBatchOnline}>
                批量上线
              </Button>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
                批量删除
              </Button>
              <Button size="small" type="link" onClick={() => setSelectedTaskKeys([])}>
                取消选择
              </Button>
            </Space>
          </div>
        )})()}

        {/* 表格容器 */}
        <div style={{
          background: '#fff',
          borderRadius: 10,
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
{(() => {
            // 构建树形结构
            const buildTaskTree = (flatTasks: TagTask[]): (TagTask & { children?: TagTask[] })[] => {
              const taskMap = new Map<number, TagTask & { children?: TagTask[] }>()
              const rootTasks: (TagTask & { children?: TagTask[] })[] = []

              // 先创建所有节点的副本
              flatTasks.forEach(task => {
                taskMap.set(task.id, { ...task, children: [] })
              })

              // 建立父子关系
              flatTasks.forEach(task => {
                const taskNode = taskMap.get(task.id)!
                if (task.parent_id && taskMap.has(task.parent_id)) {
                  const parent = taskMap.get(task.parent_id)!
                  if (!parent.children) parent.children = []
                  parent.children.push(taskNode)
                } else {
                  rootTasks.push(taskNode)
                }
              })

              // 清理空的children数组
              const cleanChildren = (nodes: (TagTask & { children?: TagTask[] })[]) => {
                nodes.forEach(node => {
                  if (node.children && node.children.length === 0) {
                    delete node.children
                  } else if (node.children) {
                    cleanChildren(node.children)
                  }
                })
              }
              cleanChildren(rootTasks)

              return rootTasks
            }

            // 根据搜索文本筛选任务（保留匹配项及其父子关系）
            const filteredTasks = (() => {
              if (!taskSearchText) return tasks

              const searchLower = taskSearchText.toLowerCase()
              const matchedIds = new Set<number>()

              // 找出所有名字匹配的任务
              tasks.forEach(t => {
                if (t.name.toLowerCase().includes(searchLower)) {
                  matchedIds.add(t.id)
                }
              })

              // 添加匹配项的所有子任务
              const addChildren = (parentId: number) => {
                tasks.forEach(t => {
                  if (t.parent_id === parentId && !matchedIds.has(t.id)) {
                    matchedIds.add(t.id)
                    addChildren(t.id)
                  }
                })
              }
              matchedIds.forEach(id => addChildren(id))

              // 添加匹配项的所有父任务（确保树结构完整）
              const addParents = (task: TagTask) => {
                if (task.parent_id) {
                  const parent = tasks.find(t => t.id === task.parent_id)
                  if (parent && !matchedIds.has(parent.id)) {
                    matchedIds.add(parent.id)
                    addParents(parent)
                  }
                }
              }
              tasks.filter(t => matchedIds.has(t.id)).forEach(addParents)

              return tasks.filter(t => matchedIds.has(t.id))
            })()

            // 转成树形结构
            const treeData = buildTaskTree(filteredTasks)

            return (
              <Table
                dataSource={treeData}
                columns={columns}
                rowKey="id"
                loading={loading}
                size="small"
                rowSelection={{
                  selectedRowKeys: selectedTaskKeys,
                  onChange: (keys) => setSelectedTaskKeys(keys),
                }}
                rowClassName={(record) => record.id === highlightedTagId ? 'highlighted-row' : ''}
                expandable={{
                  expandedRowKeys,
                  onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as React.Key[]),
                }}
                pagination={{
                  pageSize: 15,
                  showTotal: (total) => `共 ${total} 条`,
                  size: 'small',
                }}
                locale={{ emptyText: taskSearchText
                  ? <Empty description={<span>未找到匹配的任务 <a onClick={() => setTaskSearchText('')}>清除筛选</a></span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  : <Empty description="暂无任务，点击右上角创建" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                }}
                scroll={{ x: 950, y: 'calc(100vh - 280px)' }}
              />
            )
          })()}
        </div>
      </div>
    )
  }

  // 渲染项目列表页面
  const renderProjectList = () => {
    const projectColors = ['#1890ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#13c2c2', '#f5222d', '#faad14']

    const handleCreateProject = async (values: any) => {
      try {
        await tagApi.createProject(values)
        message.success('创建项目成功')
        setProjectModalVisible(false)
        projectForm.resetFields()
        loadProjects()
      } catch (error: any) {
        message.error(error.response?.data?.detail || '创建失败')
      }
    }

    const handleUpdateProject = async (values: any) => {
      if (!editingProject) return
      try {
        await tagApi.updateProject(editingProject.id, values)
        message.success('更新项目成功')
        setProjectModalVisible(false)
        setEditingProject(null)
        projectForm.resetFields()
        loadProjects()
      } catch (error: any) {
        message.error(error.response?.data?.detail || '更新失败')
      }
    }

    const handleDeleteProject = async (project: TagProject) => {
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除项目"${project.name}"吗？删除后该项目下的所有标签数据将无法恢复。`,
        okText: '删除',
        okType: 'danger',
        onOk: async () => {
          try {
            await tagApi.deleteProject(project.id)
            message.success('删除成功')
            loadProjects()
          } catch (error: any) {
            message.error(error.response?.data?.detail || '删除失败')
          }
        },
      })
    }

    const handleEnterProject = (project: TagProject) => {
      setCurrentProject(project)
      loadTagNodes(project.id)
    }

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f5f6f8' }}>
        {/* 顶部工具栏 */}
        <div style={{
          padding: '12px 24px',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 13, color: '#666' }}>选择或创建项目来管理标签体系</div>
          <Button size="small" icon={<ReloadOutlined />} onClick={loadProjects}>刷新</Button>
        </div>

        {/* 项目卡片列表 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <Spin spinning={loading}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 180px))',
              gap: 12,
            }}>
              {[...projects].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((project, index) => (
                  <Card
                    key={project.id}
                    hoverable
                    style={{
                      borderRadius: 8,
                      overflow: 'hidden',
                      cursor: 'pointer',
                    }}
                    styles={{
                      body: { padding: 0 }
                    }}
                    onDoubleClick={() => handleEnterProject(project)}
                  >
                    {/* 卡片顶部颜色条 */}
                    <div style={{
                      height: 4,
                      background: project.color || projectColors[index % projectColors.length],
                    }} />

                    <div style={{ padding: 10 }}>
                      {/* 项目图标和名称 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: `${project.color || projectColors[index % projectColors.length]}15`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <BranchesOutlined style={{
                            fontSize: 14,
                            color: project.color || projectColors[index % projectColors.length],
                          }} />
                        </div>
                        <div style={{
                          flex: 1,
                          minWidth: 0,
                          fontWeight: 600,
                          fontSize: 13,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {project.name}
                        </div>
                      </div>

                      {/* 统计信息 */}
                      <div style={{
                        display: 'flex',
                        gap: 12,
                        padding: '6px 0',
                        borderTop: '1px solid #f0f0f0',
                        fontSize: 11,
                      }}>
                        <div>
                          <span style={{ fontWeight: 600, color: project.color || '#1890ff' }}>{project.node_count}</span>
                          <span style={{ color: '#999', marginLeft: 2 }}>节点</span>
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, color: '#52c41a' }}>{project.tag_count}</span>
                          <span style={{ color: '#999', marginLeft: 2 }}>标签</span>
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
                        <Tooltip title="编辑">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined style={{ fontSize: 12 }} />}
                            style={{ padding: '0 4px', height: 22 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingProject(project)
                              projectForm.setFieldsValue(project)
                              setProjectModalVisible(true)
                            }}
                          />
                        </Tooltip>
                        <Tooltip title="删除">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                            style={{ padding: '0 4px', height: 22 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteProject(project)
                            }}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </Card>
                ))}

              {/* 新建项目卡片 */}
              <Card
                hoverable
                style={{
                  borderRadius: 8,
                  border: '1px dashed #d9d9d9',
                  background: '#fafafa',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                }}
                styles={{
                  body: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 10,
                    minHeight: 100,
                  }
                }}
                onClick={() => {
                  setEditingProject(null)
                  projectForm.resetFields()
                  projectForm.setFieldValue('color', projectColors[projects.length % projectColors.length])
                  setProjectModalVisible(true)
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#6366f1'
                  e.currentTarget.style.background = '#f0f0ff'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#d9d9d9'
                  e.currentTarget.style.background = '#fafafa'
                }}
              >
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 6,
                }}>
                  <PlusOutlined style={{ fontSize: 14, color: '#6366f1' }} />
                </div>
                <div style={{ fontSize: 11, color: '#999' }}>新建</div>
              </Card>
            </div>
          </Spin>
        </div>

        {/* 新建/编辑项目弹框 */}
        <Modal
          title={editingProject ? '编辑项目' : '新建项目'}
          open={projectModalVisible}
          onCancel={() => {
            setProjectModalVisible(false)
            setEditingProject(null)
            projectForm.resetFields()
          }}
          onOk={() => projectForm.submit()}
          width={480}
        >
          <Form
            form={projectForm}
            layout="vertical"
            onFinish={editingProject ? handleUpdateProject : handleCreateProject}
            style={{ marginTop: 16 }}
            autoComplete="off"
          >
            <Form.Item
              name="name"
              label="项目名称"
              rules={[{ required: true, message: '请输入项目名称' }]}
            >
              <Input placeholder="请输入项目名称" maxLength={50} autoComplete="off" />
            </Form.Item>
            <Form.Item name="description" label="项目描述">
              <TextArea placeholder="请输入项目描述" rows={3} maxLength={200} />
            </Form.Item>
            <Form.Item name="color" label="项目颜色">
              <ColorPicker format="hex" />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    )
  }

  // 标签管理页面 - 管理所有标签的生命周期
  const renderTagList = () => {
    // 按维度分组标签
    const dimensionGroups: { [key: number]: { dimension: Dimension; typeTags: any[]; valueTags: any[] } } = {}
    const detailTags: any[] = []
    const unassignedTypeTags: any[] = []
    const unassignedValueTags: any[] = []

    // 先找出所有匹配的类型标签ID（用于显示其子标签）
    const matchedTypeTagIds = new Set<number>()
    if (tagSearchText) {
      sidebarTags.forEach(tag => {
        if (tag.node_type === 'type' && tag.name.toLowerCase().includes(tagSearchText.toLowerCase())) {
          matchedTypeTagIds.add(tag.id)
        }
      })
    }

    sidebarTags.forEach(tag => {
      // 搜索过滤：匹配自己的名字，或者是匹配类型标签的子标签
      if (tagSearchText) {
        const nameMatch = tag.name.toLowerCase().includes(tagSearchText.toLowerCase())
        const isChildOfMatchedType = (tag.node_type === 'tag' || tag.node_type === 'value') && tag.parent_id && matchedTypeTagIds.has(tag.parent_id)
        if (!nameMatch && !isChildOfMatchedType) return
      }

      if (tag.node_type === 'detail') {
        detailTags.push(tag)
      } else if (tag.node_type === 'type') {
        if (tag.dimension_id) {
          if (!dimensionGroups[tag.dimension_id]) {
            const dim = dimensions.find(d => d.id === tag.dimension_id)
            // 即使找不到维度对象，也创建一个占位
            dimensionGroups[tag.dimension_id] = {
              dimension: dim || { id: tag.dimension_id, name: `dim_${tag.dimension_id}`, display_name: `维度#${tag.dimension_id}`, id_field: 'unknown', is_preset: false },
              typeTags: [],
              valueTags: []
            }
          }
          dimensionGroups[tag.dimension_id].typeTags.push(tag)
        } else {
          unassignedTypeTags.push(tag)
        }
      } else if (tag.node_type === 'tag' || tag.node_type === 'value') {
        // 值标签直接使用自己的 dimension_id
        if (tag.dimension_id) {
          if (!dimensionGroups[tag.dimension_id]) {
            const dim = dimensions.find(d => d.id === tag.dimension_id)
            dimensionGroups[tag.dimension_id] = {
              dimension: dim || { id: tag.dimension_id, name: `dim_${tag.dimension_id}`, display_name: `维度#${tag.dimension_id}`, id_field: 'unknown', is_preset: false },
              typeTags: [],
              valueTags: []
            }
          }
          dimensionGroups[tag.dimension_id].valueTags.push(tag)
        } else {
          unassignedValueTags.push(tag)
        }
      }
    })

    // 渲染标签项
    const renderTagItem = (tag: any, color: string) => (
      <Dropdown
        key={tag.id}
        trigger={['contextMenu']}
        menu={{
          items: [
            { key: 'edit', label: '编辑', onClick: () => handleEditTag(tag) },
            { key: 'delete', label: '删除', danger: true, onClick: () => handleDeleteTag(tag.id) },
          ]
        }}
      >
        <div
          style={{
            padding: '4px 10px',
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = color
            e.currentTarget.style.color = color
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#d9d9d9'
            e.currentTarget.style.color = 'inherit'
          }}
          onClick={() => (tag.rule_type || tag.node_type === 'value' || tag.node_type === 'tag') ? handleViewTagDetail(tag) : handleEditTag(tag)}
        >
          <div style={{ width: 6, height: 6, borderRadius: 2, background: tag.color || color }} />
          {tag.name}
        </div>
      </Dropdown>
    )

    return (
      <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        {/* 顶部操作栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Input.Search
            placeholder="搜索标签"
            allowClear
            style={{ width: 280 }}
            value={tagSearchText}
            onChange={(e) => setTagSearchText(e.target.value)}
          />
        </div>

        {/* 维度标签 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1890ff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <TagsOutlined />
            维度标签
          </div>

          {Object.values(dimensionGroups).length > 0 ? (
            Object.values(dimensionGroups).map(group => (
              <div key={group.dimension.id} style={{ marginBottom: 20, marginLeft: 16 }}>
                {/* 维度名称 */}
                <div style={{ fontSize: 13, fontWeight: 500, color: '#fa8c16', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 3, height: 14, background: '#fa8c16', borderRadius: 2 }} />
                  {group.dimension.display_name}
                  <span style={{ fontSize: 11, color: '#999', fontWeight: 400 }}>({group.dimension.id_field})</span>
                </div>

                {/* 类型标签 */}
                {group.typeTags.length > 0 && (
                  <div style={{ marginLeft: 16, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: '#722ed1', marginBottom: 6 }}>
                      类型标签 ({group.typeTags.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {group.typeTags.map(tag => renderTagItem(tag, '#722ed1'))}
                    </div>
                  </div>
                )}

                {/* 值标签 */}
                {group.valueTags.length > 0 && (
                  <div style={{ marginLeft: 16 }}>
                    <div style={{ fontSize: 12, color: '#52c41a', marginBottom: 6 }}>
                      值标签 ({group.valueTags.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {group.valueTags.map(tag => renderTagItem(tag, '#52c41a'))}
                    </div>
                  </div>
                )}

                {group.typeTags.length === 0 && group.valueTags.length === 0 && (
                  <div style={{ marginLeft: 16, color: '#999', fontSize: 12 }}>暂无标签</div>
                )}
              </div>
            ))
          ) : (
            <div style={{ marginLeft: 16, color: '#999', fontSize: 12 }}>暂无维度标签，请先在"AI打标"中创建</div>
          )}

          {/* 未分配维度的标签 */}
          {(unassignedTypeTags.length > 0 || unassignedValueTags.length > 0) && (
            <div style={{ marginBottom: 20, marginLeft: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#999', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 3, height: 14, background: '#999', borderRadius: 2 }} />
                未分配维度
              </div>
              {unassignedTypeTags.length > 0 && (
                <div style={{ marginLeft: 16, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#722ed1', marginBottom: 6 }}>类型标签 ({unassignedTypeTags.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {unassignedTypeTags.map(tag => renderTagItem(tag, '#722ed1'))}
                  </div>
                </div>
              )}
              {unassignedValueTags.length > 0 && (
                <div style={{ marginLeft: 16 }}>
                  <div style={{ fontSize: 12, color: '#52c41a', marginBottom: 6 }}>值标签 ({unassignedValueTags.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {unassignedValueTags.map(tag => renderTagItem(tag, '#52c41a'))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 粒度标签 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#eb2f96', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <TagOutlined />
            粒度标签
            <span style={{ fontSize: 12, color: '#999', fontWeight: 400 }}>({detailTags.length})</span>
          </div>
          {detailTags.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 16 }}>
              {detailTags.map(tag => renderTagItem(tag, '#eb2f96'))}
            </div>
          ) : (
            <div style={{ marginLeft: 16, color: '#999', fontSize: 12 }}>暂无粒度标签</div>
          )}
        </div>
      </div>
    )
  }

  // 渲染标签管理页面
  const renderTagManagement = () => {
    // 顶部导航栏组件
    const renderManageHeader = () => (
      <div style={{
        padding: '0 24px',
        height: 48,
        borderBottom: '1px solid #f0f0f0',
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Button
            type="text"
            icon={<LeftOutlined />}
            onClick={() => setCurrentView(null)}
            style={{ color: '#666' }}
          >
            返回
          </Button>
          <div style={{ width: 1, height: 16, background: '#e8e8e8', margin: '0 8px' }} />
          <div style={{ display: 'flex', gap: 4 }}>
            <div
              onClick={() => setManageSubView('project')}
              style={{
                padding: '6px 16px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                background: manageSubView === 'project' ? '#1890ff' : 'transparent',
                color: manageSubView === 'project' ? '#fff' : '#666',
                transition: 'all 0.2s',
              }}
            >
              项目
            </div>
            <div
              onClick={() => setManageSubView('tags')}
              style={{
                padding: '6px 16px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                background: manageSubView === 'tags' ? '#1890ff' : 'transparent',
                color: manageSubView === 'tags' ? '#fff' : '#666',
                transition: 'all 0.2s',
              }}
            >
              标签
            </div>
          </div>
        </div>
      </div>
    )

    // 标签管理子页面切换
    if (manageSubView === 'tags') {
      return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {renderManageHeader()}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {renderTagList()}
          </div>
        </div>
      )
    }

    // 项目视图
    // 如果没有选择项目，显示项目列表
    if (!currentProject) {
      return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {renderManageHeader()}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {renderProjectList()}
          </div>
        </div>
      )
    }

    // 默认颜色配置（用于没有自定义颜色的节点）
    const defaultColors = ['#52c41a', '#fa8c16', '#eb2f96', '#1890ff', '#722ed1', '#13c2c2']

    // 解析颜色值（支持 hex 字符串和 ColorPicker 对象）
    const parseColor = (color: any): string | null => {
      if (!color) return null
      if (typeof color === 'string') return color
      if (typeof color === 'object' && color.toHexString) return color.toHexString()
      return null
    }

    // 节点拖拽处理
    const handleNodeMouseDown = (e: React.MouseEvent, nodeId: number, nodeX: number, nodeY: number) => {
      e.preventDefault()
      e.stopPropagation()
      if (!mindMapRef.current) return

      const rect = mindMapRef.current.getBoundingClientRect()
      const scrollLeft = mindMapRef.current.scrollLeft
      const scrollTop = mindMapRef.current.scrollTop

      // 计算鼠标相对于容器的位置
      const mouseX = e.clientX - rect.left + scrollLeft
      const mouseY = e.clientY - rect.top + scrollTop

      setDraggingNodeId(nodeId)
      setHasDragged(false)
      setDragOffset({
        x: mouseX - nodeX,
        y: mouseY - nodeY,
      })
    }

    const handleMouseMove = (e: React.MouseEvent) => {
      if (!mindMapRef.current) return

      const rect = mindMapRef.current.getBoundingClientRect()
      const scrollLeft = mindMapRef.current.scrollLeft
      const scrollTop = mindMapRef.current.scrollTop

      // 处理节点拖拽
      if (draggingNodeId !== null) {
        const newX = e.clientX - rect.left + scrollLeft - dragOffset.x
        const newY = e.clientX - rect.top + scrollTop - dragOffset.y

        setHasDragged(true)
        setNodePositions(prev => ({
          ...prev,
          [draggingNodeId]: { x: Math.max(0, newX), y: Math.max(0, newY) }
        }))
      }

      // 处理连线拖拽
      if (connectingFrom) {
        const x = e.clientX - rect.left + scrollLeft
        const y = e.clientY - rect.top + scrollTop
        setConnectingTo({ x, y })
      }
    }

    const handleMouseUp = async () => {
      setDraggingNodeId(null)
      // 取消连线
      if (connectingFrom) {
        setConnectingFrom(null)
        setConnectingTo(null)
      }
    }

    // 开始从节点拖出连线
    const handleStartConnection = (e: React.MouseEvent, nodeId: number, nodeX: number, nodeY: number, nodeType: string) => {
      e.preventDefault()
      e.stopPropagation()
      // 标签类型（tag/value）不能作为父节点，也不能连接其他节点
      if (nodeType === 'tag' || nodeType === 'value') {
        message.warning('值标签不能连接其他节点')
        return
      }
      setConnectingFrom({
        id: nodeId,
        x: nodeX + 120, // 从节点右侧开始
        y: nodeY + 18,  // 节点中心高度
        nodeType
      })
    }

    // 完成连线 - 存储到待保存变更
    const handleCompleteConnection = (targetNodeId: number, targetNodeType: string) => {
      if (!connectingFrom || connectingFrom.id === targetNodeId || !currentProject) {
        setConnectingFrom(null)
        setConnectingTo(null)
        return
      }

      // 检查层级规则：分类下可放类型或标签，类型下可放类型或标签，标签不能有子节点
      if (connectingFrom.nodeType === 'category' && targetNodeType === 'category') {
        message.warning('分类下不能放分类')
        setConnectingFrom(null)
        setConnectingTo(null)
        return
      }
      if (connectingFrom.nodeType === 'type' && targetNodeType !== 'type' && targetNodeType !== 'tag') {
        message.warning('类型下只能连接类型或标签')
        setConnectingFrom(null)
        setConnectingTo(null)
        return
      }

      // 检查维度一致性：不同维度的标签不能相连
      // 但分类节点（category）可以连接任何节点，因为分类是容器，不受维度限制
      const sourceTag = allTags.find(t => t.id === connectingFrom.id)
      const targetTag = allTags.find(t => t.id === targetNodeId)
      if (sourceTag && targetTag) {
        // 如果源节点是分类，跳过维度检查
        if (sourceTag.node_type !== 'category') {
          const sourceDimension = sourceTag.dimension_id
          const targetDimension = targetTag.dimension_id
          // 只有当两个节点都有维度且不同时，才阻止连接
          if (sourceDimension && targetDimension && sourceDimension !== targetDimension) {
            const sourceDim = dimensions.find(d => d.id === sourceDimension)
            const targetDim = dimensions.find(d => d.id === targetDimension)
            const sourceLabel = sourceDim?.display_name || '未知维度'
            const targetLabel = targetDim?.display_name || '未知维度'
            message.warning(`不能连接不同维度的标签：${sourceLabel} 与 ${targetLabel}`)
            setConnectingFrom(null)
            setConnectingTo(null)
            return
          }
        }
      }

      // 添加到待保存变更
      setPendingConnections(prev => ({
        ...prev,
        [targetNodeId]: { parentId: connectingFrom.id, projectId: currentProject.id }
      }))

      // 更新本地 allTags 以显示连接
      setAllTags(prev => prev.map(t =>
        t.id === targetNodeId ? { ...t, parent_id: connectingFrom.id } : t
      ))

      message.info('连接已添加，点击保存按钮提交')
      setConnectingFrom(null)
      setConnectingTo(null)
    }

    // 删除连接
    const handleDeleteConnection = (nodeId: number) => {
      if (!currentProject) return

      // 添加到待保存变更（设置 parentId 为 null）
      setPendingConnections(prev => ({
        ...prev,
        [nodeId]: { parentId: null, projectId: currentProject.id }
      }))

      // 更新本地 allTags
      setAllTags(prev => prev.map(t =>
        t.id === nodeId ? { ...t, parent_id: null } : t
      ))

      message.info('连接已删除，点击保存按钮提交')
    }

    // 从项目中移出节点
    const handleRemoveFromProject = (nodeId: number) => {
      // 添加到待保存变更（设置 projectId 为 null）
      setPendingConnections(prev => ({
        ...prev,
        [nodeId]: { parentId: null, projectId: null }
      }))

      // 更新本地显示（从画布移除）
      setAllTags(prev => prev.filter(t => t.id !== nodeId))

      message.info('已标记移出，点击保存按钮提交')
    }

    // 保存所有待保存的连接变更
    const handleSaveConnections = async () => {
      if (Object.keys(pendingConnections).length === 0) {
        message.info('没有待保存的变更')
        return
      }

      setSavingConnections(true)
      try {
        // 批量保存所有变更
        const promises = Object.entries(pendingConnections).map(([nodeId, data]) =>
          tagApi.updateNode(Number(nodeId), {
            parent_id: data.parentId,
            project_id: data.projectId
          })
        )
        await Promise.all(promises)

        setPendingConnections({})
        message.success('保存成功')
        loadTagNodes(currentProject?.id)
      } catch (error: any) {
        message.error(error.response?.data?.detail || '保存失败')
      } finally {
        setSavingConnections(false)
      }
    }

    // 重置布局
    const handleResetLayout = () => {
      setNodePositions({})
    }

    // 计算思维导图布局
    const calculateMindMapLayout = () => {
      const nodes: Array<{
        id: number
        name: string
        node_type: string
        x: number
        y: number
        color: string
        parentId?: number
        level: number
      }> = []

      // 使用 allTags 构建树形结构 - 显示所有没有父节点的节点
      const buildTree = () => {
        const rootNodes = allTags.filter(t => !t.parent_id)
        return rootNodes
      }

      const rootNodes = buildTree()

      // 配置
      const startX = 80
      const startY = 60
      const levelGap = 180  // 层级间距
      const nodeHeight = 36
      const nodeWidth = 120
      const verticalGap = 12  // 节点间垂直间距

      // 计算子树高度（考虑收缩状态）
      const getSubtreeHeight = (nodeId: number): number => {
        // 如果节点是收缩的，只返回自身高度
        if (collapsedNodes.has(nodeId)) return nodeHeight
        const children = allTags.filter(t => t.parent_id === nodeId)
        if (children.length === 0) return nodeHeight
        let height = 0
        children.forEach((child, i) => {
          height += getSubtreeHeight(child.id)
          if (i < children.length - 1) height += verticalGap
        })
        return Math.max(height, nodeHeight)
      }

      // 递归布局节点
      const layoutNode = (
        node: any,
        level: number,
        y: number,
        inheritColor: string
      ): number => {
        const defaultX = startX + level * levelGap
        const isCollapsed = collapsedNodes.has(node.id)
        const children = isCollapsed ? [] : allTags.filter(t => t.parent_id === node.id)
        const nodeColor = parseColor(node.color) || inheritColor

        let currentY = y
        let childrenTotalHeight = 0

        children.forEach((child, i) => {
          const childHeight = getSubtreeHeight(child.id)
          currentY += childHeight
          if (i < children.length - 1) currentY += verticalGap
          childrenTotalHeight = currentY - y
        })

        const defaultY = children.length > 0
          ? y + childrenTotalHeight / 2 - nodeHeight / 2
          : y

        // 使用自定义位置或默认位置
        const finalX = nodePositions[node.id]?.x ?? defaultX
        const finalY = nodePositions[node.id]?.y ?? defaultY

        // 检查是否有子节点（用于显示展开/收缩按钮）
        const hasChildren = allTags.some(t => t.parent_id === node.id)

        nodes.push({
          id: node.id,
          name: node.name,
          node_type: node.node_type,
          x: finalX,
          y: finalY,
          color: nodeColor,
          parentId: node.parent_id,
          level,
          hasChildren,
          isCollapsed,
        } as any)

        // 递归布局子节点（如果没有收缩）
        if (!isCollapsed) {
          currentY = y
          children.forEach((child, i) => {
            layoutNode(child, level + 1, currentY, nodeColor)
            currentY += getSubtreeHeight(child.id)
            if (i < children.length - 1) currentY += verticalGap
          })
        }

        return childrenTotalHeight || nodeHeight
      }

      // 布局所有根节点
      let currentY = startY
      rootNodes.forEach((category, index) => {
        const nodeColor = parseColor(category.color) || defaultColors[index % defaultColors.length]
        const height = layoutNode(category, 0, currentY, nodeColor)
        currentY += height + 40
      })

      // 计算连接线（基于实际节点位置）
      const lines: Array<{
        fromX: number
        fromY: number
        toX: number
        toY: number
        color: string
        childId: number
        childName: string
        parentName: string
      }> = []

      nodes.forEach(node => {
        if (node.parentId) {
          const parentNode = nodes.find(n => n.id === node.parentId)
          if (parentNode) {
            lines.push({
              fromX: parentNode.x + nodeWidth,
              fromY: parentNode.y + nodeHeight / 2,
              toX: node.x,
              toY: node.y + nodeHeight / 2,
              color: node.color,
              childId: node.id,
              childName: node.name,
              parentName: parentNode.name,
            })
          }
        }
      })

      if (rootNodes.length === 0) {
        return { nodes: [], lines: [], totalHeight: 400, totalWidth: 600 }
      }

      return {
        nodes,
        lines,
        totalHeight: Math.max(currentY + 60, 400),
        totalWidth: Math.max(...nodes.map(n => n.x)) + 200,
      }
    }

    const { nodes: mapNodes, lines: mapLines, totalHeight, totalWidth } = calculateMindMapLayout()

    // 渲染曲线路径
    const renderCurvePath = (line: typeof mapLines[0], index: number) => {
      const { fromX, fromY, toX, toY, color, childId, childName, parentName } = line
      const midX = (fromX + toX) / 2
      const pathD = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
      const isDragging = draggingLine?.childId === childId

      return (
        <g key={index}>
          {/* 不可见的宽路径用于点击和拖拽 */}
          <path
            d={pathD}
            stroke="transparent"
            strokeWidth="12"
            fill="none"
            style={{ cursor: 'grab' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              // 检查是否是值标签的连线，值标签不能拖拽重连
              const childNode = allTags.find(t => t.id === childId)
              if (childNode && (childNode.node_type === 'tag' || childNode.node_type === 'value')) {
                return // 值标签不能拖拽，让 click 事件处理
              }
              const rect = mindMapRef.current?.getBoundingClientRect()
              if (rect) {
                const startX = e.clientX
                const startY = e.clientY
                let hasMoved = false

                const handleMouseMove = (moveE: MouseEvent) => {
                  // 检查是否真的移动了（超过5px才算拖拽）
                  if (!hasMoved && (Math.abs(moveE.clientX - startX) > 5 || Math.abs(moveE.clientY - startY) > 5)) {
                    hasMoved = true
                    // 开始拖拽连线
                    setDraggingLine({
                      childId,
                      childName,
                      startX: toX,
                      startY: toY,
                    })
                    setClickedLine(null)
                  }
                  if (hasMoved) {
                    setDraggingLineEnd({
                      x: moveE.clientX - rect.left,
                      y: moveE.clientY - rect.top,
                    })
                  }
                }

                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                }

                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
              }
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (draggingLine) return // 拖拽时不触发点击
              // 检查是否是值标签的连线，值标签不能删除连接
              const childNode = allTags.find(t => t.id === childId)
              if (childNode && (childNode.node_type === 'tag' || childNode.node_type === 'value')) {
                message.warning('值标签的连线不能修改')
                return
              }
              const rect = mindMapRef.current?.getBoundingClientRect()
              if (rect) {
                setClickedLine({
                  childId,
                  childName,
                  parentName,
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                })
              }
            }}
          />
          {/* 可见的细路径 - 拖拽时隐藏原线 */}
          {!isDragging && (
            <path
              d={pathD}
              stroke={color}
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              style={{ pointerEvents: 'none' }}
            />
          )}
        </g>
      )
    }

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {/* 顶部工具栏 */}
        <div style={{
          padding: '12px 20px',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
        }}>
          <Button type="text" icon={<LeftOutlined />} onClick={() => {
            setCurrentProject(null)
            setAllTags([])
            setNodePositions({})
          }}>
            返回项目
          </Button>
          <div style={{
            width: 1,
            height: 20,
            background: '#e8e8e8'
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: currentProject.color || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 16,
            }}>
              <BranchesOutlined />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{currentProject.name} - 导图页面</div>
              <div style={{ fontSize: 12, color: '#999' }}>可视化管理标签层级结构</div>
            </div>
          </div>
          <div style={{ flex: 1 }} />

          {Object.keys(nodePositions).length > 0 && (
            <Tooltip title="恢复默认布局">
              <Button icon={<ReloadOutlined />} onClick={handleResetLayout}>
                重置布局
              </Button>
            </Tooltip>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => loadTagNodes()}>刷新</Button>
          {Object.keys(pendingConnections).length > 0 && (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={savingConnections}
              onClick={handleSaveConnections}
            >
              保存 ({Object.keys(pendingConnections).length})
            </Button>
          )}
        </div>

        {/* 主内容区域：左侧导航 + 右侧画布 */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* 左侧标签导航栏 */}
          <div style={{
            width: 200,
            background: '#fff',
            borderRight: '1px solid #f0f0f0',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}>
            <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 4 }}>标签库</div>
              <div style={{ fontSize: 11, color: '#999' }}>拖拽到画布建立关联</div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
              {/* 类型标签组 */}
              <div style={{
                marginBottom: 12,
                background: '#e6f7ff',
                borderRadius: 8,
                border: '1px solid #91d5ff',
                overflow: 'hidden',
              }}>
                <div
                  style={{
                    fontSize: 12,
                    color: '#1890ff',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 500,
                    background: '#bae7ff',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}
                    onClick={() => setTypeGroupCollapsed(!typeGroupCollapsed)}
                  >
                    <CaretRightOutlined style={{
                      fontSize: 10,
                      transition: 'transform 0.2s',
                      transform: typeGroupCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                    }} />
                    <TagsOutlined />
                    <span>类型标签</span>
                  </div>
                  <Popover
                    trigger="click"
                    placement="rightTop"
                    content={(() => {
                      const typeTags = sidebarTags.filter(t => t.node_type === 'type')
                      const groupedByDim: Record<number, { dim: any; tags: any[] }> = {}
                      const ungrouped: any[] = []

                      typeTags.forEach(tag => {
                        if (tag.dimension_id) {
                          if (!groupedByDim[tag.dimension_id]) {
                            const dim = dimensions.find(d => d.id === tag.dimension_id)
                            groupedByDim[tag.dimension_id] = {
                              dim: dim || { id: tag.dimension_id, display_name: `维度#${tag.dimension_id}` },
                              tags: []
                            }
                          }
                          groupedByDim[tag.dimension_id].tags.push(tag)
                        } else {
                          ungrouped.push(tag)
                        }
                      })

                      const renderTag = (tag: any) => (
                        <div
                          key={tag.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('tagId', String(tag.id))
                            e.dataTransfer.setData('tagType', 'type')
                            e.dataTransfer.effectAllowed = 'copy'
                            setDraggingTagFromSidebar({ id: tag.id, type: 'type' })
                          }}
                          onDragEnd={() => {
                            setDraggingTagFromSidebar(null)
                            setDragOverNodeId(null)
                          }}
                          style={{
                            padding: '6px 8px',
                            background: '#e6f7ff',
                            borderRadius: 4,
                            fontSize: 11,
                            cursor: 'grab',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            border: '1px solid #91d5ff',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#1890ff'
                            e.currentTarget.style.color = '#fff'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#e6f7ff'
                            e.currentTarget.style.color = 'inherit'
                          }}
                        >
                          <div style={{
                            width: 6,
                            height: 6,
                            borderRadius: 2,
                            background: tag.color || '#1890ff',
                            flexShrink: 0,
                          }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tag.name}
                          </span>
                        </div>
                      )

                      return (
                        <div style={{ minWidth: 280, maxHeight: 400, overflow: 'auto' }}>
                          {Object.values(groupedByDim).map(({ dim, tags }) => (
                            <div key={dim.id} style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: '#722ed1', marginBottom: 6, fontWeight: 500 }}>
                                {dim.display_name} ({tags.length})
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                                {tags.map(renderTag)}
                              </div>
                            </div>
                          ))}
                          {ungrouped.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              {Object.keys(groupedByDim).length > 0 && (
                                <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>其他</div>
                              )}
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                                {ungrouped.map(renderTag)}
                              </div>
                            </div>
                          )}
                          {typeTags.length === 0 && (
                            <div style={{ fontSize: 12, color: '#999', textAlign: 'center', padding: 16 }}>
                              暂无类型标签
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        background: '#1890ff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#40a9ff'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#1890ff'
                      }}
                    >
                      <AppstoreOutlined style={{ color: '#fff', fontSize: 12 }} />
                    </div>
                  </Popover>
                  <span style={{
                    background: '#1890ff',
                    color: '#fff',
                    padding: '0 8px',
                    borderRadius: 10,
                    fontSize: 11,
                  }}>
                    {sidebarTags.filter(t => t.node_type === 'type').length}
                  </span>
                </div>
                {!typeGroupCollapsed && (() => {
                  // 按维度分组类型标签
                  const typeTags = sidebarTags.filter(t => t.node_type === 'type')
                  const groupedByDim: Record<number, { dim: any; tags: any[] }> = {}
                  const ungrouped: any[] = []

                  typeTags.forEach(tag => {
                    if (tag.dimension_id) {
                      if (!groupedByDim[tag.dimension_id]) {
                        const dim = dimensions.find(d => d.id === tag.dimension_id)
                        groupedByDim[tag.dimension_id] = {
                          dim: dim || { id: tag.dimension_id, display_name: `维度#${tag.dimension_id}` },
                          tags: []
                        }
                      }
                      groupedByDim[tag.dimension_id].tags.push(tag)
                    } else {
                      ungrouped.push(tag)
                    }
                  })

                  const renderTypeTag = (tag: any) => (
                    <Dropdown
                      key={tag.id}
                      trigger={['contextMenu']}
                      menu={{
                        items: [
                          { key: 'view', label: '查看详情', onClick: () => handleViewTagDetail(tag) },
                          { key: 'edit', label: '编辑', onClick: () => handleEditTag(tag) },
                          { key: 'delete', label: '删除', danger: true, onClick: () => handleDeleteTag(tag.id) },
                        ]
                      }}
                    >
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('tagId', String(tag.id))
                          e.dataTransfer.setData('tagType', 'type')
                          e.dataTransfer.effectAllowed = 'copy'
                          setDraggingTagFromSidebar({ id: tag.id, type: 'type' })
                        }}
                        onDragEnd={() => {
                          setDraggingTagFromSidebar(null)
                          setDragOverNodeId(null)
                        }}
                        onClick={() => handleViewTagDetail(tag)}
                        style={{
                          padding: '6px 10px',
                          background: '#fff',
                          borderRadius: 6,
                          fontSize: 12,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          border: '1px solid #d9d9d9',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#e6f4ff'
                          e.currentTarget.style.borderColor = '#1890ff'
                          e.currentTarget.style.boxShadow = '0 2px 4px rgba(24,144,255,0.2)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#fff'
                          e.currentTarget.style.borderColor = '#d9d9d9'
                          e.currentTarget.style.boxShadow = 'none'
                        }}
                      >
                        <div style={{
                          width: 6,
                          height: 6,
                          borderRadius: 2,
                          background: tag.color || '#1890ff',
                        }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tag.name}
                        </span>
                      </div>
                    </Dropdown>
                  )

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px' }}>
                      {/* 按维度分组显示 */}
                      {Object.values(groupedByDim).map(({ dim, tags }) => (
                        <div key={dim.id} style={{ marginBottom: 4 }}>
                          <div
                            style={{
                              fontSize: 11,
                              color: '#722ed1',
                              marginBottom: 4,
                              fontWeight: 500,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                            onClick={() => toggleDimensionCollapsed(dim.id)}
                          >
                            <CaretRightOutlined style={{
                              fontSize: 10,
                              transition: 'transform 0.2s',
                              transform: collapsedDimensions[dim.id] ? 'rotate(0deg)' : 'rotate(90deg)',
                            }} />
                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#722ed1' }} />
                            {dim.display_name}
                            <span style={{ color: '#999', fontWeight: 400 }}>({tags.length})</span>
                          </div>
                          {!collapsedDimensions[dim.id] && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
                              {tags.map(renderTypeTag)}
                            </div>
                          )}
                        </div>
                      ))}
                      {/* 未分组的标签 */}
                      {ungrouped.length > 0 && (
                        <div>
                          {Object.keys(groupedByDim).length > 0 && (
                            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>其他</div>
                          )}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {ungrouped.map(renderTypeTag)}
                          </div>
                        </div>
                      )}
                      {typeTags.length === 0 && (
                        <div style={{ fontSize: 11, color: '#999', padding: '8px', textAlign: 'center' }}>暂无类型标签</div>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* 值标签组 */}
              <div style={{
                background: '#f6ffed',
                borderRadius: 8,
                border: '1px solid #b7eb8f',
                overflow: 'hidden',
              }}>
                <div
                  style={{
                    fontSize: 12,
                    color: '#52c41a',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 500,
                    background: '#d9f7be',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}
                    onClick={() => setTagGroupCollapsed(!tagGroupCollapsed)}
                  >
                    <CaretRightOutlined style={{
                      fontSize: 10,
                      transition: 'transform 0.2s',
                      transform: tagGroupCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                    }} />
                    <TagOutlined />
                    <span>值标签</span>
                  </div>
                  <Popover
                    trigger="click"
                    placement="rightTop"
                    content={(() => {
                      const valueTags = sidebarTags.filter(t => t.node_type === 'tag' || t.node_type === 'value')
                      const groupedByDim: Record<number, { dim: any; tags: any[] }> = {}
                      const ungrouped: any[] = []

                      valueTags.forEach(tag => {
                        if (tag.dimension_id) {
                          if (!groupedByDim[tag.dimension_id]) {
                            const dim = dimensions.find(d => d.id === tag.dimension_id)
                            groupedByDim[tag.dimension_id] = {
                              dim: dim || { id: tag.dimension_id, display_name: `维度#${tag.dimension_id}` },
                              tags: []
                            }
                          }
                          groupedByDim[tag.dimension_id].tags.push(tag)
                        } else {
                          ungrouped.push(tag)
                        }
                      })

                      const renderTag = (tag: any) => (
                        <div
                          key={tag.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('tagId', String(tag.id))
                            e.dataTransfer.setData('tagType', 'tag')
                            e.dataTransfer.effectAllowed = 'copy'
                            setDraggingTagFromSidebar({ id: tag.id, type: 'tag' })
                          }}
                          onDragEnd={() => {
                            setDraggingTagFromSidebar(null)
                            setDragOverNodeId(null)
                          }}
                          style={{
                            padding: '6px 8px',
                            background: '#f6ffed',
                            borderRadius: 4,
                            fontSize: 11,
                            cursor: 'grab',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            border: '1px solid #b7eb8f',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#52c41a'
                            e.currentTarget.style.color = '#fff'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#f6ffed'
                            e.currentTarget.style.color = 'inherit'
                          }}
                        >
                          <div style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: tag.color || '#52c41a',
                            flexShrink: 0,
                          }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tag.name}
                          </span>
                        </div>
                      )

                      return (
                        <div style={{ minWidth: 280, maxHeight: 400, overflow: 'auto' }}>
                          {Object.values(groupedByDim).map(({ dim, tags }) => (
                            <div key={dim.id} style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: '#52c41a', marginBottom: 6, fontWeight: 500 }}>
                                {dim.display_name} ({tags.length})
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                                {tags.map(renderTag)}
                              </div>
                            </div>
                          ))}
                          {ungrouped.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              {Object.keys(groupedByDim).length > 0 && (
                                <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>其他</div>
                              )}
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                                {ungrouped.map(renderTag)}
                              </div>
                            </div>
                          )}
                          {valueTags.length === 0 && (
                            <div style={{ fontSize: 12, color: '#999', textAlign: 'center', padding: 16 }}>
                              暂无值标签
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        background: '#52c41a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#73d13d'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#52c41a'
                      }}
                    >
                      <AppstoreOutlined style={{ color: '#fff', fontSize: 12 }} />
                    </div>
                  </Popover>
                  <span style={{
                    background: '#52c41a',
                    color: '#fff',
                    padding: '0 8px',
                    borderRadius: 10,
                    fontSize: 11,
                  }}>
                    {sidebarTags.filter(t => (t.node_type === 'tag' || t.node_type === 'value')).length}
                  </span>
                </div>
                {!tagGroupCollapsed && (() => {
                  // 按维度分组值标签
                  const valueTags = sidebarTags.filter(t => t.node_type === 'tag' || t.node_type === 'value')
                  const groupedByDim: Record<number, { dim: any; tags: any[] }> = {}
                  const ungrouped: any[] = []

                  valueTags.forEach(tag => {
                    if (tag.dimension_id) {
                      if (!groupedByDim[tag.dimension_id]) {
                        const dim = dimensions.find(d => d.id === tag.dimension_id)
                        groupedByDim[tag.dimension_id] = {
                          dim: dim || { id: tag.dimension_id, display_name: `维度#${tag.dimension_id}` },
                          tags: []
                        }
                      }
                      groupedByDim[tag.dimension_id].tags.push(tag)
                    } else {
                      ungrouped.push(tag)
                    }
                  })

                  const renderValueTag = (tag: any) => (
                    <Dropdown
                      key={tag.id}
                      trigger={['contextMenu']}
                      menu={{
                        items: [
                          { key: 'view', label: '查看详情', onClick: () => handleViewTagDetail(tag) },
                          { key: 'edit', label: '编辑', onClick: () => handleEditTag(tag) },
                          { key: 'delete', label: '删除', danger: true, onClick: () => handleDeleteTag(tag.id) },
                        ]
                      }}
                    >
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('tagId', String(tag.id))
                          e.dataTransfer.setData('tagType', 'tag')
                          e.dataTransfer.effectAllowed = 'copy'
                          setDraggingTagFromSidebar({ id: tag.id, type: 'tag' })
                        }}
                        onDragEnd={() => {
                          setDraggingTagFromSidebar(null)
                          setDragOverNodeId(null)
                        }}
                        onClick={() => handleViewTagDetail(tag)}
                        style={{
                          padding: '6px 10px',
                          background: '#fff',
                          borderRadius: 6,
                          fontSize: 12,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          border: '1px solid #d9d9d9',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#f6ffed'
                          e.currentTarget.style.borderColor = '#52c41a'
                          e.currentTarget.style.boxShadow = '0 2px 4px rgba(82,196,26,0.2)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#fff'
                          e.currentTarget.style.borderColor = '#d9d9d9'
                          e.currentTarget.style.boxShadow = 'none'
                        }}
                      >
                        <div style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: tag.color || '#52c41a',
                        }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tag.name}
                        </span>
                      </div>
                    </Dropdown>
                  )

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px' }}>
                      {/* 按维度分组显示 */}
                      {Object.values(groupedByDim).map(({ dim, tags }) => (
                        <div key={dim.id} style={{ marginBottom: 4 }}>
                          <div
                            style={{
                              fontSize: 11,
                              color: '#52c41a',
                              marginBottom: 4,
                              fontWeight: 500,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                            onClick={() => toggleDimensionCollapsed(dim.id + 1000)}
                          >
                            <CaretRightOutlined style={{
                              fontSize: 10,
                              transition: 'transform 0.2s',
                              transform: collapsedDimensions[dim.id + 1000] ? 'rotate(0deg)' : 'rotate(90deg)',
                            }} />
                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#52c41a' }} />
                            {dim.display_name}
                            <span style={{ color: '#999', fontWeight: 400 }}>({tags.length})</span>
                          </div>
                          {!collapsedDimensions[dim.id + 1000] && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
                              {tags.map(renderValueTag)}
                            </div>
                          )}
                        </div>
                      ))}
                      {/* 未分组的标签 */}
                      {ungrouped.length > 0 && (
                        <div>
                          {Object.keys(groupedByDim).length > 0 && (
                            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>其他</div>
                          )}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {ungrouped.map(renderValueTag)}
                          </div>
                        </div>
                      )}
                      {valueTags.length === 0 && (
                        <div style={{ fontSize: 11, color: '#999', padding: '8px', textAlign: 'center' }}>暂无值标签</div>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* 粒度标签组 */}
              <div style={{
                background: '#f9f0ff',
                borderRadius: 8,
                border: '1px solid #d3adf7',
                overflow: 'hidden',
              }}>
                <div
                  style={{
                    fontSize: 12,
                    color: '#722ed1',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 500,
                    background: '#efdbff',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}
                    onClick={() => setDetailGroupCollapsed && setDetailGroupCollapsed(!detailGroupCollapsed)}
                  >
                    <CaretRightOutlined style={{
                      fontSize: 10,
                      transition: 'transform 0.2s',
                      transform: detailGroupCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                    }} />
                    <DatabaseOutlined />
                    <span>粒度标签</span>
                  </div>
                  <span style={{
                    background: '#722ed1',
                    color: '#fff',
                    padding: '0 8px',
                    borderRadius: 10,
                    fontSize: 11,
                  }}>
                    {sidebarTags.filter(t => t.node_type === 'detail').length}
                  </span>
                </div>
                {!detailGroupCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px' }}>
                    {sidebarTags.filter(t => t.node_type === 'detail').map(tag => (
                      <Dropdown
                        key={tag.id}
                        trigger={['contextMenu']}
                        menu={{
                          items: [
                            { key: 'edit', label: '编辑', onClick: () => handleEditTag(tag) },
                            { key: 'delete', label: '删除', danger: true, onClick: () => handleDeleteTag(tag.id) },
                          ]
                        }}
                      >
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('tagId', String(tag.id))
                            e.dataTransfer.setData('tagType', 'detail')
                            e.dataTransfer.effectAllowed = 'copy'
                            setDraggingTagFromSidebar({ id: tag.id, type: 'detail' })
                          }}
                          onDragEnd={() => {
                            setDraggingTagFromSidebar(null)
                            setDragOverNodeId(null)
                          }}
                          style={{
                            padding: '6px 10px',
                            background: '#fff',
                            borderRadius: 4,
                            fontSize: 11,
                            cursor: 'grab',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            border: '1px solid #d3adf7',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = '#722ed1'
                            e.currentTarget.style.background = '#f9f0ff'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = '#d3adf7'
                            e.currentTarget.style.background = '#fff'
                          }}
                          onClick={() => (tag.rule_type || tag.node_type === 'value' || tag.node_type === 'tag') ? handleViewTagDetail(tag) : handleEditTag(tag)}
                        >
                          <div style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: tag.color || '#722ed1',
                          }} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tag.name}
                          </span>
                        </div>
                      </Dropdown>
                    ))}
                    {sidebarTags.filter(t => t.node_type === 'detail').length === 0 && (
                      <div style={{ fontSize: 11, color: '#999', padding: '8px', textAlign: 'center' }}>暂无粒度标签</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 思维导图区域 */}
          <div
            ref={mindMapRef}
            style={{
              flex: 1,
              overflow: 'auto',
              background: 'linear-gradient(180deg, #fafbfc 0%, #f5f6f8 100%)',
              cursor: draggingNodeId ? 'grabbing' : 'default',
              position: 'relative',
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={async (e) => {
              e.preventDefault()
              const tagId = e.dataTransfer.getData('tagId')
              if (!tagId || !mindMapRef.current || !currentProject) return

              // 计算放置位置
              const rect = mindMapRef.current.getBoundingClientRect()
              const x = e.clientX - rect.left + mindMapRef.current.scrollLeft
              const y = e.clientY - rect.top + mindMapRef.current.scrollTop

              const numTagId = Number(tagId)
              const draggedTag = sidebarTags.find(t => t.id === numTagId)
              if (!draggedTag) return

              // 如果是类型标签，展开子标签
              if (draggedTag.node_type === 'type') {
                // 找出所有子标签
                const childTags = sidebarTags.filter(t => t.parent_id === numTagId)

                // 添加类型标签
                setPendingConnections(prev => ({
                  ...prev,
                  [numTagId]: { parentId: null, projectId: currentProject.id }
                }))
                setAllTags(prev => {
                  const exists = prev.some(t => t.id === numTagId)
                  if (exists) {
                    return prev.map(t => t.id === numTagId ? { ...t, parent_id: null } : t)
                  } else {
                    return [...prev, { ...draggedTag, parent_id: null }]
                  }
                })
                setNodePositions(prev => ({
                  ...prev,
                  [numTagId]: { x, y }
                }))

                // 添加子标签，垂直排列在类型标签下方
                childTags.forEach((child, index) => {
                  const childX = x + 30
                  const childY = y + 50 + index * 40

                  setPendingConnections(prev => ({
                    ...prev,
                    [child.id]: { parentId: numTagId, projectId: currentProject.id }
                  }))
                  setAllTags(prev => {
                    const exists = prev.some(t => t.id === child.id)
                    if (exists) {
                      return prev.map(t => t.id === child.id ? { ...t, parent_id: numTagId } : t)
                    } else {
                      return [...prev, { ...child, parent_id: numTagId }]
                    }
                  })
                  setNodePositions(prev => ({
                    ...prev,
                    [child.id]: { x: childX, y: childY }
                  }))
                })

                message.info(`已添加类型标签及 ${childTags.length} 个子标签`)
              } else {
                // 普通标签，单独添加
                setPendingConnections(prev => ({
                  ...prev,
                  [numTagId]: { parentId: null, projectId: currentProject.id }
                }))
                setAllTags(prev => {
                  const exists = prev.some(t => t.id === numTagId)
                  if (exists) {
                    return prev.map(t => t.id === numTagId ? { ...t, parent_id: null } : t)
                  } else {
                    return [...prev, { ...draggedTag, parent_id: null }]
                  }
                })
                setNodePositions(prev => ({
                  ...prev,
                  [numTagId]: { x, y }
                }))
                message.info('已添加到画布，点击保存按钮提交')
              }
            }}
            onContextMenu={(e) => {
              // 检查是否点击在节点上（如果是则不处理，让节点的右键菜单处理）
              const target = e.target as HTMLElement
              if (target.closest('[data-node-id]')) return

              e.preventDefault()
              const rect = mindMapRef.current?.getBoundingClientRect()
              if (rect && mindMapRef.current) {
                setCanvasContextMenu({
                  x: e.clientX - rect.left + mindMapRef.current.scrollLeft,
                  y: e.clientY - rect.top + mindMapRef.current.scrollTop,
                  step: 'type'
                })
              }
            }}
          >
            <Spin spinning={loading}>
              {mapNodes.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  minHeight: 400,
                  color: '#999',
                }}
                onClick={() => setCanvasContextMenu(null)}
              >
                <TagOutlined style={{ fontSize: 64, marginBottom: 24, color: '#d9d9d9' }} />
                <div style={{ fontSize: 16, marginBottom: 8 }}>暂无节点</div>
                <div style={{ fontSize: 13 }}>右键点击画布创建节点，或从左侧拖拽标签到画布</div>
              </div>
            ) : (
              <div
                style={{
                  minWidth: totalWidth,
                  minHeight: totalHeight,
                  padding: '20px 0',
                  position: 'relative',
                }}
                onClick={() => { setClickedLine(null); setNodeContextMenu(null); setCanvasContextMenu(null) }}
                onMouseMove={(e) => {
                  // 拖拽连线时更新终点位置
                  if (draggingLine) {
                    const rect = mindMapRef.current?.getBoundingClientRect()
                    if (rect) {
                      setDraggingLineEnd({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                      })
                    }
                  }
                }}
                onMouseUp={() => {
                  // 释放时取消拖拽（未落在有效节点上）
                  if (draggingLine) {
                    setDraggingLine(null)
                    setDraggingLineEnd(null)
                  }
                }}
                onMouseLeave={() => {
                  // 离开画布时取消拖拽
                  if (draggingLine) {
                    setDraggingLine(null)
                    setDraggingLineEnd(null)
                  }
                }}
              >
                {/* SVG 连接线 */}
                <svg
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: draggingLine ? 'none' : 'auto',
                  }}
                >
                  {mapLines.map((line, i) => renderCurvePath(line, i))}
                  {/* 临时连接线 - 节点拖拽 */}
                  {connectingFrom && connectingTo && (
                    <path
                      d={`M ${connectingFrom.x} ${connectingFrom.y} C ${connectingFrom.x + 60} ${connectingFrom.y}, ${connectingTo.x - 60} ${connectingTo.y}, ${connectingTo.x} ${connectingTo.y}`}
                      stroke="#1890ff"
                      strokeWidth={2}
                      strokeDasharray="6,4"
                      fill="none"
                      opacity={0.8}
                    />
                  )}
                  {/* 临时连接线 - 线条拖拽重连 */}
                  {draggingLine && draggingLineEnd && (
                    <path
                      d={`M ${draggingLine.startX} ${draggingLine.startY} C ${(draggingLine.startX + draggingLineEnd.x) / 2} ${draggingLine.startY}, ${(draggingLine.startX + draggingLineEnd.x) / 2} ${draggingLineEnd.y}, ${draggingLineEnd.x} ${draggingLineEnd.y}`}
                      stroke="#fa8c16"
                      strokeWidth={2}
                      strokeDasharray="6,4"
                      fill="none"
                      opacity={0.8}
                    />
                  )}
                </svg>

                {/* 节点 */}
                {mapNodes.map(node => {
                  const isCategory = node.node_type === 'category'
                  const isDropTarget = dragOverNodeId === node.id
                  const canReceiveConnection = node.node_type !== 'tag' && node.node_type !== 'value' && node.node_type !== 'detail' // 只有分类和类型可以接收连接
                  // 拖拽连线时高亮可接收的节点
                  const isLineDropTarget = draggingLine && canReceiveConnection && draggingLine.childId !== node.id

                  return (
                    <div
                      key={node.id}
                      data-node-id={node.id}
                      style={{
                        position: 'absolute',
                        left: node.x,
                        top: node.y,
                        minWidth: 100,
                        maxWidth: 160,
                        height: 36,
                        background: (isDropTarget && canReceiveConnection) || isLineDropTarget ? '#52c41a' : node.color,
                        color: '#fff',
                        borderRadius: isCategory ? 8 : 18,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 16px',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: draggingLine ? (canReceiveConnection ? 'pointer' : 'not-allowed') : (draggingNodeId === node.id ? 'grabbing' : 'grab'),
                        boxShadow: (isDropTarget && canReceiveConnection) || isLineDropTarget
                          ? '0 0 0 3px rgba(82,196,26,0.4), 0 8px 24px rgba(0,0,0,0.25)'
                          : draggingNodeId === node.id
                            ? '0 8px 24px rgba(0,0,0,0.25)'
                            : '0 2px 8px rgba(0,0,0,0.15)',
                        transition: draggingNodeId === node.id ? 'none' : 'all 0.2s',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        zIndex: draggingNodeId === node.id ? 1000 : (isDropTarget || isLineDropTarget) ? 100 : 1,
                        transform: (isDropTarget && canReceiveConnection) || isLineDropTarget ? 'scale(1.08)' : draggingNodeId === node.id ? 'scale(1.05)' : 'none',
                      }}
                      onMouseDown={(e) => !draggingLine && handleNodeMouseDown(e, node.id, node.x, node.y)}
                      onClick={() => {
                        // 只有没有拖拽过才触发点击
                        if (!hasDragged) {
                          const tag = allTags.find(t => t.id === node.id)
                          if (tag) {
                            // 与标签页面点击逻辑一致
                            if (tag.rule_type || tag.node_type === 'value' || tag.node_type === 'tag') {
                              handleViewTagDetail(tag)
                            } else {
                              handleEditTag(tag)
                            }
                          }
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (canReceiveConnection && draggingTagFromSidebar && draggingTagFromSidebar.id !== node.id) {
                          setDragOverNodeId(node.id)
                          e.dataTransfer.dropEffect = 'link'
                        }
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault()
                        if (dragOverNodeId === node.id) {
                          setDragOverNodeId(null)
                        }
                      }}
                      onDrop={async (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setDragOverNodeId(null)

                        const tagId = e.dataTransfer.getData('tagId')
                        if (!tagId || !canReceiveConnection || !currentProject) return

                        // 从 sidebarTags 中查找（包含所有项目的标签）
                        const sourceTag = sidebarTags.find(t => t.id === Number(tagId))
                        if (!sourceTag || sourceTag.id === node.id) return

                        // 检查层级规则：分类下可放类型或标签，类型下可放类型或标签
                        if (node.node_type === 'category' && sourceTag.node_type === 'category') {
                          message.warning('分类下不能放置分类')
                          return
                        }
                        if (node.node_type === 'type' && sourceTag.node_type === 'category') {
                          message.warning('类型下不能放置分类')
                          return
                        }

                        // 检查维度一致性
                        const targetTag = allTags.find(t => t.id === node.id)
                        if (targetTag && sourceTag.dimension_id !== targetTag.dimension_id) {
                          const sourceDim = dimensions.find(d => d.id === sourceTag.dimension_id)
                          const targetDim = dimensions.find(d => d.id === targetTag.dimension_id)
                          const sourceLabel = sourceDim?.display_name || (sourceTag.dimension_id ? '未知维度' : '无维度')
                          const targetLabel = targetDim?.display_name || (targetTag.dimension_id ? '未知维度' : '无维度')
                          message.warning(`不能连接不同维度的标签：${sourceLabel} 与 ${targetLabel}`)
                          return
                        }

                        // 添加到待保存变更
                        setPendingConnections(prev => ({
                          ...prev,
                          [sourceTag.id]: { parentId: node.id, projectId: currentProject.id }
                        }))

                        // 更新本地数据以显示连接
                        setAllTags(prev => prev.map(t =>
                          t.id === sourceTag.id ? { ...t, parent_id: node.id } : t
                        ))
                        setSidebarTags(prev => prev.map(t =>
                          t.id === sourceTag.id ? { ...t, parent_id: node.id } : t
                        ))

                        message.info(`已将"${sourceTag.name}"连接到"${node.name}"，点击保存按钮提交`)
                      }}
                      onMouseUp={() => {
                        // 完成从其他节点拖出的连线
                        if (connectingFrom && connectingFrom.id !== node.id) {
                          handleCompleteConnection(node.id, node.node_type)
                        }
                        // 拖拽连线释放到节点上 - 重新连接
                        if (draggingLine && canReceiveConnection && draggingLine.childId !== node.id && currentProject) {
                          // 检查维度一致性
                          const childTag = allTags.find(t => t.id === draggingLine.childId)
                          const parentTag = allTags.find(t => t.id === node.id)
                          if (childTag && parentTag && childTag.dimension_id !== parentTag.dimension_id) {
                            const childDim = dimensions.find(d => d.id === childTag.dimension_id)
                            const parentDim = dimensions.find(d => d.id === parentTag.dimension_id)
                            const childLabel = childDim?.display_name || (childTag.dimension_id ? '未知维度' : '无维度')
                            const parentLabel = parentDim?.display_name || (parentTag.dimension_id ? '未知维度' : '无维度')
                            message.warning(`不能连接不同维度的标签：${childLabel} 与 ${parentLabel}`)
                            setDraggingLine(null)
                            setDraggingLineEnd(null)
                            return
                          }
                          // 更新连接：将子节点的父节点改为当前节点
                          setPendingConnections(prev => ({
                            ...prev,
                            [draggingLine.childId]: { parentId: node.id, projectId: currentProject.id }
                          }))
                          // 更新本地数据
                          setAllTags(prev => prev.map(t =>
                            t.id === draggingLine.childId ? { ...t, parent_id: node.id } : t
                          ))
                          message.info(`已将 "${draggingLine.childName}" 连接到 "${node.name}"，点击保存按钮提交`)
                          setDraggingLine(null)
                          setDraggingLineEnd(null)
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const tag = allTags.find(t => t.id === node.id)
                        if (!tag) return
                        const rect = mindMapRef.current?.getBoundingClientRect()
                        if (rect) {
                          setNodeContextMenu({
                            x: e.clientX - rect.left,
                            y: e.clientY - rect.top,
                            node: tag
                          })
                        }
                      }}
                    >
                      {/* 左侧连接点 - 接收连接（从侧边栏拖入或从其他节点连线） */}
                      {(draggingTagFromSidebar || connectingFrom) && (
                        <div
                          style={{
                            position: 'absolute',
                            left: -8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            background: isDropTarget ? '#52c41a' : '#fff',
                            border: `2px solid ${isDropTarget ? '#52c41a' : node.color}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                          }}
                        >
                          <div style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: isDropTarget ? '#fff' : node.color,
                          }} />
                        </div>
                      )}
                      {node.name}
                      {/* 展开/收缩按钮 - 只有有子节点的节点才显示 */}
                      {(node as any).hasChildren && (
                        <div
                          style={{
                            marginLeft: 6,
                            width: 16,
                            height: 16,
                            borderRadius: 3,
                            background: 'rgba(255,255,255,0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            fontSize: 12,
                            color: '#fff',
                            fontWeight: 'bold',
                            flexShrink: 0,
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setCollapsedNodes(prev => {
                              const newSet = new Set(prev)
                              if (newSet.has(node.id)) {
                                newSet.delete(node.id)
                              } else {
                                newSet.add(node.id)
                              }
                              return newSet
                            })
                          }}
                          title={(node as any).isCollapsed ? '展开' : '收缩'}
                        >
                          {(node as any).isCollapsed ? '+' : '−'}
                        </div>
                      )}
                      {/* 右侧连接点 - 拖出连线（只有分类和类型可以拖出连线） */}
                      {node.node_type !== 'tag' && node.node_type !== 'value' && node.node_type !== 'detail' && (
                        <Tooltip title="拖拽连接子节点">
                          <div
                            style={{
                              position: 'absolute',
                              right: -12,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: connectingFrom?.id === node.id ? '#1890ff' : '#fff',
                              border: `2px solid ${connectingFrom?.id === node.id ? '#1890ff' : node.color}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'crosshair',
                              opacity: 0.9,
                              transition: 'all 0.2s',
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              handleStartConnection(e, node.id, node.x, node.y, node.node_type)
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%) scale(1.2)'
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%)'
                            }}
                          >
                            <div style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: connectingFrom?.id === node.id ? '#fff' : node.color,
                            }} />
                          </div>
                        </Tooltip>
                      )}
                    </div>
                  )
                })}

                {/* 连线删除弹框 */}
                {clickedLine && (
                  <div
                    style={{
                      position: 'absolute',
                      left: clickedLine.x,
                      top: clickedLine.y,
                      transform: 'translate(-50%, -50%)',
                      background: '#fff',
                      borderRadius: '50%',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      zIndex: 2000,
                      color: '#ff4d4f',
                      fontSize: 16,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteConnection(clickedLine.childId)
                      setClickedLine(null)
                    }}
                  >
                    <DeleteOutlined />
                  </div>
                )}

                {/* 节点右键菜单 */}
                {nodeContextMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      left: nodeContextMenu.x,
                      top: nodeContextMenu.y,
                      background: '#fff',
                      borderRadius: 6,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                      zIndex: 2000,
                      overflow: 'hidden',
                      minWidth: 80,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}
                      onClick={() => { handleEditTag(nodeContextMenu.node); setNodeContextMenu(null) }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                    >
                      编辑
                    </div>
                    {nodeContextMenu.node.node_type !== 'tag' && nodeContextMenu.node.node_type !== 'value' && nodeContextMenu.node.node_type !== 'detail' && (
                      <div
                        style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}
                        onClick={() => { handleOpenTagCreate(nodeContextMenu.node); setNodeContextMenu(null) }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                      >
                        添加子级
                      </div>
                    )}
                    {nodeContextMenu.node.node_type === 'category' ? (
                      <div
                        style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: '#ff4d4f' }}
                        onClick={() => { handleDeleteTag(nodeContextMenu.node.id); setNodeContextMenu(null) }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#fff1f0')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                      >
                        删除
                      </div>
                    ) : (
                      <div
                        style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: '#ff4d4f' }}
                        onClick={() => { handleRemoveFromProject(nodeContextMenu.node.id); setNodeContextMenu(null) }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#fff1f0')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                      >
                        移出
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}
          </Spin>
          {/* 画布右键菜单 - 新建节点 */}
          {canvasContextMenu && (
            <div
              style={{
                position: 'absolute',
                left: canvasContextMenu.x,
                top: canvasContextMenu.y,
                background: '#fff',
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 2000,
                overflow: 'hidden',
                minWidth: 120,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {canvasContextMenu.step === 'type' ? (
                <>
                  <div style={{
                    padding: '6px 10px',
                    fontSize: 11,
                    color: '#999',
                    borderBottom: '1px solid #f0f0f0',
                    background: '#fafafa',
                  }}>
                    选择节点类型
                  </div>
                  {[
                    { value: 'category', label: '分类', icon: <FolderOutlined />, color: '#722ed1' },
                    { value: 'type', label: '类型', icon: <AppstoreOutlined />, color: '#1890ff' },
                    { value: 'value', label: '标签', icon: <TagOutlined />, color: '#52c41a' },
                  ].map(item => (
                    <div
                      key={item.value}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: 13,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                      onClick={() => {
                        setCanvasContextMenu({
                          ...canvasContextMenu,
                          step: 'dimension',
                          nodeType: item.value as 'category' | 'type' | 'value',
                        })
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                    >
                      <span style={{ color: item.color, fontSize: 14 }}>{item.icon}</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                  <div
                    style={{
                      padding: '6px 12px',
                      borderTop: '1px solid #f0f0f0',
                      fontSize: 12,
                      color: '#999',
                      cursor: 'pointer',
                    }}
                    onClick={() => setCanvasContextMenu(null)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                  >
                    取消
                  </div>
                </>
              ) : (
                <>
                  <div style={{
                    padding: '6px 10px',
                    fontSize: 11,
                    color: '#999',
                    borderBottom: '1px solid #f0f0f0',
                    background: '#fafafa',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    <span
                      style={{ cursor: 'pointer', color: '#1890ff' }}
                      onClick={() => setCanvasContextMenu({ ...canvasContextMenu, step: 'type', nodeType: undefined })}
                    >
                      ←
                    </span>
                    选择维度
                  </div>
                  {dimensions.map(dim => (
                    <div
                      key={dim.id}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: 13,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                      onClick={() => {
                        // 创建新节点
                        tagForm.resetFields()
                        tagForm.setFieldValue('node_type', canvasContextMenu.nodeType)
                        tagForm.setFieldValue('dimension_id', dim.id)
                        setEditingTag(null)
                        setCreatingParent(null)
                        setTagModalVisible(true)
                        setCanvasContextMenu(null)
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                    >
                      <TagsOutlined style={{ color: '#1890ff', fontSize: 12 }} />
                      <span>{dim.display_name}</span>
                      <span style={{ fontSize: 11, color: '#999' }}>({dim.id_field})</span>
                    </div>
                  ))}
                  <div
                    style={{
                      padding: '6px 12px',
                      borderTop: '1px solid #f0f0f0',
                      fontSize: 12,
                      color: '#999',
                      cursor: 'pointer',
                    }}
                    onClick={() => setCanvasContextMenu(null)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                  >
                    取消
                  </div>
                </>
              )}
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

    // 处理AI对话确认SQL
    const handleChatSqlConfirmed = (sql: string, tags: string[], taskInfo?: { name: string; description: string; tables: string[]; tagTableName?: string }) => {
      setGeneratedSql(sql)
      setExtractedTags(tags)
      setSqlConfirmed(true)
      // 自动填充表单，生成带时间戳的表名
      if (taskInfo) {
        const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
        const tableName = taskInfo.tagTableName
          ? `${taskInfo.tagTableName}_${timestamp}`
          : `tag_analysis_${timestamp}`
        chatForm.setFieldsValue({
          name: taskInfo.name,
          description: taskInfo.description,
          source_table: taskInfo.tables.join(', '),
          tag_table_name: tableName,
        })
      }
    }

    // Tab切换时重置状态
    const handleTabChange = async (key: string) => {
      setAiTabKey(key as 'single' | 'chat' | 'dimension')
      setAiStep(0)
      setGeneratedSql('')
      setSqlConfirmed(false)
      setExtractedTags([])
      form.resetFields()
      chatForm.resetFields()

      // 切换到值标签时加载维度列表
      if (key === 'dimension') {
        try {
          const res = await tagApi.listDimensions()
          setDimensions(res.data || [])
        } catch (e) {
          console.error('加载维度列表失败', e)
        }
        // 重置维度相关状态
        setSelectedDimension(null)
        setDimensionSessionId(null)
        setDimensionMessages([])
        setDimensionInput('')
        setDimensionTags([])
        setDimensionTypeName('')
        setDimensionTypeDesc('')
        setDimensionSql('')
        // 重置维度定义状态
        setDimensionModalVisible(false)
        setNewDimensionName('')
      }
    }

    // 渲染单表打标内容
    const renderSingleTableContent = () => (
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
              <Input placeholder="例如：用户分层打标任务" autoComplete="off" />
            </Form.Item>

            <Form.Item name="description" label="任务描述">
              <TextArea rows={2} placeholder="可选，补充说明" />
            </Form.Item>

            <Form.Item name="target_table" label="结果保存到">
              <Input placeholder="可选，留空则自动生成表名" autoComplete="off" />
            </Form.Item>

            <Form.Item name="parent_id" label="所属层级">
              <TreeSelect
                allowClear
                placeholder="可选，选择标签所属的分类/类型"
                treeData={hierarchyNodes}
                fieldNames={{ label: 'name', value: 'id', children: 'children' }}
                treeDefaultExpandAll
                style={{ width: '100%' }}
              />
            </Form.Item>

            <div style={{ padding: 16, background: '#fafafa', borderRadius: 8 }}>
              <Text strong>任务信息预览</Text>
              <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
                <div>源表：{form.getFieldValue('source_table') || '(全库模式)'}</div>
                <div>标签：{extractedTags.join('、') || '无'}</div>
                <div>SQL已确认：{sqlConfirmed ? '是' : '否'}</div>
              </div>
            </div>
          </div>
        </Form>
      </>
    )

    // 渲染AI对话内容（粒度标签模式）
    const renderChatContent = () => {
      // 如果已确认SQL，显示保存任务表单
      if (sqlConfirmed && aiStep === 2) {
        return (
          <Form form={chatForm} layout="vertical" autoComplete="off">
            <Form.Item
              name="name"
              label="任务名称"
              rules={[{ required: true, message: '请输入任务名称' }]}
            >
              <Input placeholder="AI已自动填充，可修改" autoComplete="off" />
            </Form.Item>

            <Form.Item name="description" label="任务描述">
              <TextArea rows={2} placeholder="AI已自动填充，可修改" />
            </Form.Item>

            <Form.Item name="source_table" label="依赖表">
              <Input disabled style={{ background: '#f5f5f5' }} autoComplete="off" />
            </Form.Item>

            <Form.Item name="tag_table_name" label="写入表">
              <Input placeholder="AI已自动生成，格式：tag_业务场景_时间戳" autoComplete="off" />
            </Form.Item>

            <Form.Item name="parent_id" label="所属层级">
              <TreeSelect
                allowClear
                placeholder="可选，选择标签所属的分类/类型"
                treeData={hierarchyNodes}
                fieldNames={{ label: 'name', value: 'id', children: 'children' }}
                treeDefaultExpandAll
                style={{ width: '100%' }}
              />
            </Form.Item>

            <div style={{ padding: 16, background: '#fafafa', borderRadius: 8 }}>
              <Text strong>任务信息预览</Text>
              <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
                <div>方案：{extractedTags.join('、') || '无'}</div>
                <div>SQL已确认：是</div>
              </div>
            </div>
          </Form>
        )
      }

      // 显示AI对话面板
      return (
        <AIChatPanel
          onSqlConfirmed={handleChatSqlConfirmed}
          onCancel={() => setAiTabKey('single')}
        />
      )
    }

    // 保存新维度
    const handleSaveDimension = async () => {
      if (!newDimensionName.trim()) return
      setDimensionSaving(true)
      try {
        await tagApi.createDimension({
          name: newDimensionName.trim().replace(/维度$/, ''),
          display_name: newDimensionName.trim(),
          id_field: newDimensionName.trim().replace(/维度$/, '') + '_id',
        })
        message.success('已创建')
        setDimensionModalVisible(false)
        setNewDimensionName('')
        // 刷新列表
        const dimsRes = await tagApi.listDimensions()
        setDimensions(dimsRes.data || [])
      } catch (e: any) {
        message.error(e.response?.data?.detail || '创建失败')
      } finally {
        setDimensionSaving(false)
      }
    }

    // 选择维度（不自动调AI）
    const handleSelectDimension = (dimension: Dimension) => {
      setSelectedDimension(dimension)
      setDimensionSessionId(null)
      setDimensionMessages([])
      setTagSuggestions([])
    }

    // 发送维度对话消息
    const handleSendDimensionMessage = async () => {
      if (!dimensionInput.trim() || !selectedDimension) return
      const userMsg = dimensionInput.trim()
      setDimensionInput('')
      setDimensionMessages(prev => [...prev, { role: 'user', content: userMsg }])
      setDimensionSending(true)

      try {
        // 首次发送时创建会话
        let sessionId = dimensionSessionId
        if (!sessionId) {
          const createRes = await tagApi.createDimensionChatSession(selectedDimension.id)
          sessionId = createRes.data.session_id
          setDimensionSessionId(sessionId)
        }
        const res = await tagApi.sendDimensionChatMessage(sessionId!, userMsg)
        const reply = res.data.reply

        // 检查是否返回了 tag_suggestions JSON
        try {
          const jsonMatch = reply.match(/\{[\s\S]*"type"\s*:\s*"tag_suggestions"[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            if (parsed.type === 'tag_suggestions' && parsed.suggestions) {
              // 转换为带 selected 状态
              const suggestions = parsed.suggestions.map((s: any) => ({
                ...s,
                selected: true,
                values: s.values.map((v: any) => ({ ...v, selected: true }))
              }))
              setTagSuggestions(suggestions)
              setDimensionMessages(prev => [...prev, { role: 'assistant', content: parsed.message || '请选择要创建的标签：' }])
            } else {
              setDimensionMessages(prev => [...prev, { role: 'assistant', content: reply }])
            }
          } else {
            setDimensionMessages(prev => [...prev, { role: 'assistant', content: reply }])
          }
        } catch {
          setDimensionMessages(prev => [...prev, { role: 'assistant', content: reply }])
        }

        // 检查是否有最终结果
        if (res.data.is_final && res.data.tags && res.data.tags.length > 0) {
          setDimensionTags(res.data.tags)
          setDimensionTypeName(res.data.type_name || '')
          setDimensionTypeDesc(res.data.type_description || '')
          setDimensionSql(res.data.sql || '')
          setSqlConfirmed(true)
          // 预填表单
          chatForm.setFieldsValue({
            name: res.data.type_name || '',
            description: res.data.type_description || '',
          })
        }
      } catch (e: any) {
        message.error('发送失败: ' + (e.response?.data?.detail || e.message))
      } finally {
        setDimensionSending(false)
        setTimeout(() => {
          dimensionMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 100)
      }
    }

    // 渲染智能-值标签内容
    const renderDimensionContent = () => {
      // 删除维度
      const handleDeleteDimension = async (dim: Dimension, e: React.MouseEvent) => {
        e.stopPropagation()
        try {
          await tagApi.deleteDimension(dim.id)
          message.success('已删除')
          const res = await tagApi.listDimensions()
          setDimensions(res.data || [])
        } catch (err: any) {
          message.error(err.response?.data?.detail || '删除失败')
        }
      }

      // 步骤1：选择维度或定义新维度
      if (!selectedDimension) {
        return (
          <div style={{ padding: '20px 0' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
              {dimensions.map(dim => (
                <Card
                  key={dim.id}
                  hoverable
                  style={{ width: 160, cursor: 'pointer', position: 'relative' }}
                  onClick={() => handleSelectDimension(dim)}
                >
                  <DeleteOutlined
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      color: '#999',
                      fontSize: 12,
                    }}
                    onClick={(e) => handleDeleteDimension(dim, e)}
                  />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%', margin: '0 auto 8px',
                      background: '#fff7e6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <TagsOutlined style={{ fontSize: 20, color: '#fa8c16' }} />
                    </div>
                    <Text strong style={{ fontSize: 13 }}>{dim.display_name}</Text>
                    <div style={{ color: '#999', fontSize: 11, marginTop: 2 }}>
                      {dim.id_field}
                    </div>
                  </div>
                </Card>
              ))}
              {/* 添加新维度的 + 卡片 */}
              <Card
                hoverable
                style={{ width: 160, cursor: 'pointer', borderStyle: 'dashed' }}
                onClick={() => setDimensionModalVisible(true)}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', margin: '0 auto 8px',
                    background: '#f0f0f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <PlusOutlined style={{ fontSize: 20, color: '#999' }} />
                  </div>
                  <Text type="secondary" style={{ fontSize: 13 }}>新建维度</Text>
                </div>
              </Card>
            </div>

            {/* 新建维度弹窗 */}
            <Modal
              title="新建维度"
              open={dimensionModalVisible}
              onCancel={() => { setDimensionModalVisible(false); setNewDimensionName('') }}
              onOk={handleSaveDimension}
              okText="创建"
              cancelText="取消"
              confirmLoading={dimensionSaving}
              okButtonProps={{ disabled: !newDimensionName.trim() }}
            >
              <Input
                placeholder="输入维度名称，如：用户维度"
                value={newDimensionName}
                onChange={e => setNewDimensionName(e.target.value)}
                onPressEnter={handleSaveDimension}
                autoFocus
              />
            </Modal>
          </div>
        )
      }

      // 步骤3：保存任务表单（SQL已确认）
      if (sqlConfirmed) {
        const isBatchMode = dimensionSql === 'batch' && (dimensionTags as any)[0]?.type_name
        return (
          <Form form={chatForm} layout="vertical" autoComplete="off">
            <Alert
              type="success"
              message={isBatchMode
                ? `批量创建 ${(dimensionTags as any[]).length} 个类型标签 - 维度：${selectedDimension.display_name}`
                : `维度：${selectedDimension.display_name} (${selectedDimension.id_field})`
              }
              style={{ marginBottom: 16 }}
            />

            {/* 批量模式下隐藏名称和描述输入 */}
            {!isBatchMode && (
              <>
                <Form.Item
                  name="name"
                  label="类型标签名称"
                  rules={[{ required: true, message: '请输入类型标签名称' }]}
                >
                  <Input placeholder="AI已自动填充，可修改" autoComplete="off" />
                </Form.Item>

                <Form.Item name="description" label="类型标签描述">
                  <TextArea rows={2} placeholder="AI已自动填充，可修改" />
                </Form.Item>
              </>
            )}

            <Form.Item name="parent_id" label="所属分类（可选）">
              <TreeSelect
                allowClear
                placeholder={hierarchyNodes.length > 0 ? "选择标签所属的分类" : "暂无分类，可直接保存"}
                treeData={hierarchyNodes}
                fieldNames={{ label: 'name', value: 'id', children: 'children' }}
                treeDefaultExpandAll
                style={{ width: '100%' }}
              />
            </Form.Item>
            {hierarchyNodes.length === 0 && (
              <Alert
                type="info"
                message="提示：暂无分类节点，标签将创建在根目录下。您可以稍后在「标签管理」中创建分类并整理标签层级。"
                style={{ marginBottom: 16 }}
              />
            )}

            {/* 标签层级预览 */}
            <div style={{ padding: 16, background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f', marginBottom: 16, maxHeight: 300, overflow: 'auto' }}>
              <Text strong style={{ color: '#52c41a' }}>标签层级预览</Text>
              <div style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 8 }}>
                  <Tag color="orange">{selectedDimension.display_name}</Tag>
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>(维度)</Text>
                </div>
                <div style={{ paddingLeft: 20, borderLeft: '2px solid #fa8c16' }}>
                  {/* 批量模式：显示多个类型标签 */}
                  {dimensionSql === 'batch' && (dimensionTags as any)[0]?.type_name ? (
                    (dimensionTags as any[]).map((typeTag, tIdx) => (
                      <div key={tIdx} style={{ marginBottom: 12 }}>
                        <div style={{ marginBottom: 4 }}>
                          <Tag color="purple">{typeTag.type_name}</Tag>
                          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>(类型标签)</Text>
                        </div>
                        <div style={{ paddingLeft: 20, borderLeft: '2px solid #722ed1' }}>
                          {(typeTag.tags || []).map((tag: any, i: number) => (
                            <div key={i} style={{ marginBottom: 2 }}>
                              <Tag color="green" style={{ fontSize: 11 }}>{tag.name}</Tag>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    /* 单个类型模式 */
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <Tag color="purple">{dimensionTypeName || '类型标签'}</Tag>
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>(类型标签)</Text>
                      </div>
                      <div style={{ paddingLeft: 20, borderLeft: '2px solid #722ed1' }}>
                        {dimensionTags.map((tag, i) => (
                          <div key={i} style={{ marginBottom: 4 }}>
                            <Tag color="green">{tag.name}</Tag>
                            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>(值标签)</Text>
                            {tag.description && (
                              <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
                                - {tag.description}
                              </Text>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* SQL预览 - 批量模式不显示 */}
            {dimensionSql && dimensionSql !== 'batch' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text strong>SQL语句</Text>
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={async () => {
                      try {
                        const res = await warehouseApi.executeQuery({ sql: dimensionSql, limit: 10 })
                        Modal.info({
                          title: '执行结果预览',
                          width: 800,
                          content: (
                            <div style={{ maxHeight: 400, overflow: 'auto' }}>
                              {res.data?.data?.length > 0 ? (
                                <Table
                                  size="small"
                                  dataSource={res.data.data}
                                  columns={Object.keys(res.data.data[0] || {}).map(key => ({
                                    title: key,
                                    dataIndex: key,
                                    key,
                                    ellipsis: true,
                                  }))}
                                  pagination={false}
                                  scroll={{ x: true }}
                                />
                              ) : (
                                <Empty description="无数据" />
                              )}
                            </div>
                          ),
                        })
                      } catch (e: any) {
                        message.error('执行失败: ' + (e.response?.data?.detail || e.message))
                      }
                    }}
                  >
                    执行预览
                  </Button>
                </div>
                <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, maxHeight: 200, overflow: 'auto' }}>
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {dimensionSql}
                  </pre>
                </div>
              </div>
            )}
          </Form>
        )
      }

      // 步骤2：AI对话
      return (
        <div style={{ height: 450, display: 'flex', flexDirection: 'column' }}>
          <Alert
            type="info"
            message={`当前维度：${selectedDimension.display_name} (ID字段: ${selectedDimension.id_field})`}
            action={
              <Button size="small" onClick={() => {
                setSelectedDimension(null)
                setDimensionSessionId(null)
                setDimensionMessages([])
                setTagSuggestions([])
              }}>
                更换维度
              </Button>
            }
            style={{ marginBottom: 16 }}
          />

          {/* 消息区域 */}
          <div style={{ flex: 1, overflow: 'auto', padding: '0 4px', marginBottom: 16 }}>
            {dimensionMessages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 12
                }}
              >
                <div
                  style={{
                    maxWidth: '80%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: msg.role === 'user' ? '#1890ff' : '#f5f5f5',
                    color: msg.role === 'user' ? '#fff' : '#333',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* 标签建议勾选区域 */}
            {tagSuggestions.length > 0 && (
              <div style={{
                background: '#fafafa',
                borderRadius: 8,
                padding: 16,
                marginTop: 8,
                border: '1px solid #e8e8e8'
              }}>
                <div style={{ marginBottom: 12 }}>
                  <span style={{ fontWeight: 500 }}>请勾选要创建的标签：</span>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setTagSuggestions(tagSuggestions.map(s => ({
                        ...s,
                        selected: true,
                        values: s.values.map(v => ({ ...v, selected: true }))
                      })))
                    }}
                  >
                    全选
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setTagSuggestions(tagSuggestions.map(s => ({
                        ...s,
                        selected: false,
                        values: s.values.map(v => ({ ...v, selected: false }))
                      })))
                    }}
                  >
                    清空
                  </Button>
                </div>
                {tagSuggestions.map((suggestion, sIdx) => (
                  <div key={sIdx} style={{ marginBottom: 16 }}>
                    <Checkbox
                      checked={suggestion.selected}
                      onChange={e => {
                        const newSuggestions = [...tagSuggestions]
                        newSuggestions[sIdx].selected = e.target.checked
                        newSuggestions[sIdx].values = newSuggestions[sIdx].values.map(v => ({ ...v, selected: e.target.checked }))
                        setTagSuggestions(newSuggestions)
                      }}
                      style={{ fontWeight: 500 }}
                    >
                      <span style={{ color: '#1890ff' }}>{suggestion.type_name}</span>
                      {suggestion.type_description && (
                        <span style={{ color: '#999', marginLeft: 8, fontWeight: 'normal' }}>
                          ({suggestion.type_description})
                        </span>
                      )}
                    </Checkbox>
                    <div style={{ marginLeft: 24, marginTop: 8 }}>
                      {suggestion.values.map((value, vIdx) => (
                        <div key={vIdx} style={{ marginBottom: 4 }}>
                          <Checkbox
                            checked={value.selected}
                            onChange={e => {
                              const newSuggestions = [...tagSuggestions]
                              newSuggestions[sIdx].values[vIdx].selected = e.target.checked
                              newSuggestions[sIdx].selected = newSuggestions[sIdx].values.some(v => v.selected)
                              setTagSuggestions(newSuggestions)
                            }}
                          >
                            {value.name}
                            {value.description && (
                              <span style={{ color: '#999', marginLeft: 8 }}>- {value.description}</span>
                            )}
                          </Checkbox>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                  <Button
                    type="primary"
                    onClick={async () => {
                      // 收集选中的标签
                      const selected = tagSuggestions
                        .filter(s => s.selected)
                        .map(s => ({
                          type_name: s.type_name,
                          type_description: s.type_description,
                          field: s.field,
                          values: s.values.filter(v => v.selected).map(v => ({
                            name: v.name,
                            description: v.description,
                            condition: v.condition
                          }))
                        }))
                        .filter(s => s.values.length > 0)

                      if (selected.length === 0) {
                        message.warning('请至少选择一个标签')
                        return
                      }

                      // 发送确认消息，包含完整条件信息
                      const confirmMsg = `请为以下标签生成SQL：${JSON.stringify(selected, null, 0)}`
                      setTagSuggestions([])
                      setDimensionMessages(prev => [...prev, { role: 'user', content: '已选择标签，请生成SQL' }])
                      setDimensionSending(true)

                      try {
                        const res = await tagApi.sendDimensionChatMessage(dimensionSessionId!, confirmMsg)
                        setDimensionMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }])

                        // 处理多个类型标签的情况
                        if (res.data.is_final && res.data.dimension_tags_list && res.data.dimension_tags_list.length > 0) {
                          // 多个类型标签，直接批量创建
                          const tagsList = res.data.dimension_tags_list
                          setDimensionMessages(prev => [...prev, {
                            role: 'assistant',
                            content: `将创建 ${tagsList.length} 个类型标签，请选择所属分类后保存`
                          }])
                          // 存储到状态，显示保存表单
                          setDimensionTags(tagsList)  // 存储完整列表
                          setDimensionTypeName(`${tagsList.length}个类型标签`)
                          setDimensionTypeDesc(tagsList.map((t: any) => t.type_name).join('、'))
                          setDimensionSql('batch')  // 标记为批量模式
                          setSqlConfirmed(true)
                          chatForm.setFieldsValue({
                            name: tagsList[0].type_name || '',
                            description: `批量创建: ${tagsList.map((t: any) => t.type_name).join('、')}`,
                          })
                          message.success(`已生成 ${tagsList.length} 个类型标签，请选择分类后保存`)
                        } else if (res.data.is_final && res.data.tags && res.data.tags.length > 0 && res.data.sql) {
                          // 单个类型标签
                          setDimensionTags(res.data.tags)
                          setDimensionTypeName(res.data.type_name || '')
                          setDimensionTypeDesc(res.data.type_description || '')
                          setDimensionSql(res.data.sql)
                          setSqlConfirmed(true)
                          chatForm.setFieldsValue({
                            name: res.data.type_name || '',
                            description: res.data.type_description || '',
                          })
                          message.success('SQL已生成，请填写信息后保存')
                        } else if (res.data.is_final && (!res.data.tags && !res.data.dimension_tags_list)) {
                          message.warning('AI未返回完整数据，请重试')
                        }
                      } catch (e: any) {
                        message.error('确认失败: ' + (e.response?.data?.detail || e.message))
                      } finally {
                        setDimensionSending(false)
                      }
                    }}
                  >
                    确认选择
                  </Button>
                  <Button onClick={() => setTagSuggestions([])}>
                    清除重选
                  </Button>
                </div>
              </div>
            )}

            {dimensionSending && (
              <div style={{ textAlign: 'center', padding: 8 }}>
                <Spin size="small" />
                <Text type="secondary" style={{ marginLeft: 8 }}>AI思考中...</Text>
              </div>
            )}
            <div ref={dimensionMessagesEndRef} />
          </div>

          {/* 输入区域 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <Input.TextArea
              value={dimensionInput}
              onChange={e => setDimensionInput(e.target.value)}
              placeholder="描述你想要的标签，例如：帮我做一些用户价值标签"
              autoSize={{ minRows: 2, maxRows: 4 }}
              onPressEnter={e => {
                if (!e.shiftKey) {
                  e.preventDefault()
                  handleSendDimensionMessage()
                }
              }}
              disabled={dimensionSending}
            />
            <Button
              type="primary"
              onClick={handleSendDimensionMessage}
              disabled={!dimensionInput.trim() || dimensionSending}
              style={{ alignSelf: 'flex-end' }}
            >
              发送
            </Button>
          </div>
        </div>
      )
    }

    // 计算footer
    const getFooter = () => {
      // 值标签模式
      if (aiTabKey === 'dimension') {
        if (!selectedDimension) {
          // 未选择维度
          return (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
            </div>
          )
        }
        if (sqlConfirmed) {
          // SQL已确认，显示保存
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => {
                setSqlConfirmed(false)
                setDimensionTags([])
                setDimensionTypeName('')
                setDimensionTypeDesc('')
                setDimensionSql('')
              }}>
                返回对话
              </Button>
              <Space>
                <Button onClick={() => setModalVisible(false)}>取消</Button>
                <Button type="primary" onClick={handleSubmit}>
                  保存标签
                </Button>
              </Space>
            </div>
          )
        }
        // 对话中
        return (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setModalVisible(false)}>取消</Button>
          </div>
        )
      }

      // AI对话模式（粒度标签）
      if (aiTabKey === 'chat') {
        if (sqlConfirmed && aiStep === 2) {
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => { setAiStep(0); setSqlConfirmed(false) }}>
                返回对话
              </Button>
              <Space>
                <Button onClick={() => setModalVisible(false)}>取消</Button>
                <Button type="primary" onClick={handleSubmit}>
                  保存任务
                </Button>
              </Space>
            </div>
          )
        }
        return (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              {sqlConfirmed && (
                <Button type="primary" onClick={() => setAiStep(2)}>
                  下一步：保存任务
                </Button>
              )}
            </Space>
          </div>
        )
      }

      // 单表模式
      return (
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
      )
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
          setAiTabKey('single')
          // 重置维度相关状态
          setSelectedDimension(null)
          setDimensionSessionId(null)
          setDimensionMessages([])
          setTagSuggestions([])
          setDimensionTags([])
          setDimensionTypeName('')
          setDimensionTypeDesc('')
          setDimensionSql('')
          // 重置维度定义状态
          setDimensionModalVisible(false)
          setNewDimensionName('')
        }}
        width={950}
        footer={getFooter()}
      >
        <Tabs
          activeKey={aiTabKey}
          onChange={handleTabChange}
          destroyInactiveTabPane={false}
          items={[
            {
              key: 'single',
              label: (
                <span>
                  <TableOutlined />
                  单表打标
                </span>
              ),
              children: renderSingleTableContent(),
            },
            {
              key: 'chat',
              label: (
                <span>
                  <RobotOutlined />
                  AI对话（粒度标签）
                </span>
              ),
              children: renderChatContent(),
            },
            {
              key: 'dimension',
              label: (
                <span>
                  <TagsOutlined />
                  智能-值标签
                </span>
              ),
              children: renderDimensionContent(),
            },
          ]}
        />
      </Modal>
    )
  }

  // 渲染规则引擎弹框
  const renderSQLModal = () => (
    <Modal
      title={editingTask ? '编辑规则引擎标签' : '新建规则引擎标签'}
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
          <Input placeholder="请输入标签名称" autoComplete="off" />
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

        <Form.Item name="parent_id" label="所属层级">
          <TreeSelect
            allowClear
            placeholder="可选，选择标签所属的分类/类型"
            treeData={hierarchyNodes}
            fieldNames={{ label: 'name', value: 'id', children: 'children' }}
            treeDefaultExpandAll
            style={{ width: '100%' }}
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
          label="规则引擎"
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
            <Text type="secondary">选择2个或多个已有标签进行组合（只显示有规则引擎的标签）</Text>
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
                          {tag.rule_type === 'row' ? 'AI打标' : '规则引擎'}
                        </Tag>
                      </div>
                    </div>
                  </Card>
                </List.Item>
              )
            }}
            locale={{ emptyText: <Empty description="暂无可用标签，请先创建AI打标或规则引擎标签" /> }}
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
              <Input placeholder="例如：高消费活跃用户" autoComplete="off" />
            </Form.Item>

            <Form.Item name="description" label="描述">
              <TextArea rows={2} placeholder="可选，补充说明" />
            </Form.Item>

            <Form.Item name="parent_id" label="所属层级">
              <TreeSelect
                allowClear
                placeholder="可选，选择标签所属的分类/类型"
                treeData={hierarchyNodes}
                fieldNames={{ label: 'name', value: 'id', children: 'children' }}
                treeDefaultExpandAll
                style={{ width: '100%' }}
              />
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
          <Text strong>规则引擎标签</Text>
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
      title="保存为规则引擎标签"
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
          <Input placeholder="例如：高价值用户" autoComplete="off" />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <TextArea rows={2} placeholder="可选，标签描述" />
        </Form.Item>

        <Form.Item name="parent_id" label="所属层级">
          <TreeSelect
            allowClear
            placeholder="可选，选择标签所属的分类/类型"
            treeData={hierarchyNodes}
            fieldNames={{ label: 'name', value: 'id', children: 'children' }}
            treeDefaultExpandAll
            style={{ width: '100%' }}
          />
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
              onClick={() => handleDeleteTask(record.id, record.name)}
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
              <Input placeholder="例如：用户商品关系图谱" autoComplete="off" />
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

  // 标签详情弹框
  const renderTagDetailModal = () => {
    if (!tagDetailData) return null

    // 解析规则配置
    let ruleConfig: any = {}
    try {
      ruleConfig = tagDetailData.rule_config ? JSON.parse(tagDetailData.rule_config) : {}
    } catch (e) {
      ruleConfig = {}
    }

    return (
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: tagDetailData.color || '#52c41a'
            }} />
            <span>{tagDetailData.name}</span>
            <Tag color="blue" style={{ marginLeft: 8 }}>{tagDetailData.rule_type || '标签'}</Tag>
          </div>
        }
        open={tagDetailVisible}
        onCancel={() => setTagDetailVisible(false)}
        width={900}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Space>
              <Button onClick={() => {
                setTagDetailVisible(false)
                handleEditTag(tagDetailData)
              }}>
                编辑标签
              </Button>
              <Button
                type="primary"
                ghost
                icon={<LinkOutlined />}
                onClick={() => {
                  // 在新页面打开标签任务页面，直接传递当前标签ID
                  window.open(`/tags?tagId=${tagDetailData.id}&view=ai`, '_blank')
                }}
              >
                查看任务
              </Button>
            </Space>
            <Space>
              <Button onClick={() => setTagDetailVisible(false)}>关闭</Button>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleDownloadTagData}
                disabled={!tagPreviewData || tagPreviewData.rows.length === 0}
              >
                下载数据
              </Button>
            </Space>
          </div>
        }
      >
        {/* 基本信息 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>基本信息</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', background: '#fafafa', padding: 16, borderRadius: 8 }}>
            <div>
              <Text type="secondary">描述：</Text>
              <Text>{tagDetailData.description || '无'}</Text>
            </div>
            <div>
              <Text type="secondary">标签类型：</Text>
              <Text>
                {tagDetailData.node_type === 'value' || tagDetailData.node_type === 'tag'
                  ? '值标签'
                  : tagDetailData.rule_type === 'sql' ? '规则引擎' : tagDetailData.rule_type === 'row' ? '行级标签' : '手动标签'}
              </Text>
            </div>
            {/* 值标签显示所属类型标签 */}
            {(tagDetailData.node_type === 'value' || tagDetailData.node_type === 'tag') && tagDetailData.parent_id && (
              <div>
                <Text type="secondary">所属类型：</Text>
                <Text>{tagDetailData.parent_name || `类型#${tagDetailData.parent_id}`}</Text>
              </div>
            )}
            {/* 值标签显示筛选条件 */}
            {(tagDetailData.node_type === 'value' || tagDetailData.node_type === 'tag') && (
              <div>
                <Text type="secondary">筛选条件：</Text>
                <Text code>tag_name = '{tagDetailData.name}'</Text>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <Text type="secondary">依赖表：</Text>
              <div style={{ marginTop: 4 }}>
                {(() => {
                  const sourceStr = tagDetailData.source_table || ruleConfig.source_table || ''
                  const tables = sourceStr.split(',').map((t: string) => t.trim()).filter(Boolean)
                  return tables.length > 0 ? (
                    <Space wrap>
                      {tables.map((t: string, i: number) => (
                        <Tag key={i} color="blue" icon={<DatabaseOutlined />}>{t}</Tag>
                      ))}
                    </Space>
                  ) : (
                    <Text type="secondary">无</Text>
                  )
                })()}
              </div>
            </div>
            <div>
              <Text type="secondary">目标表：</Text>
              <Text code>{tagDetailData.tag_table_name || '从父类型获取'}</Text>
            </div>
            <div>
              <Text type="secondary">数据量：</Text>
              <Text>{tagDetailData.usage_count || 0} 条</Text>
            </div>
            <div>
              <Text type="secondary">创建时间：</Text>
              <Text>{tagDetailData.created_at ? new Date(tagDetailData.created_at).toLocaleString() : '未知'}</Text>
            </div>
          </div>
        </div>

        {/* 子标签列表 - 仅类型标签显示 */}
        {tagDetailData.node_type === 'type' && tagDetailChildren.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
              值标签 <span style={{ color: '#999', fontWeight: 400, fontSize: 12 }}>({tagDetailChildren.length}个)</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, background: '#fafafa', padding: 16, borderRadius: 8 }}>
              {tagDetailChildren.map((child: any) => (
                <Tag
                  key={child.id}
                  color="blue"
                  style={{ cursor: 'pointer', padding: '4px 12px', fontSize: 13 }}
                  onClick={() => handleViewTagDetail(child)}
                >
                  {child.name}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* 规则引擎 - 跳转到数据探索 */}
        {ruleConfig.full_sql && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>规则引擎</div>
              <Button
                type="primary"
                ghost
                size="small"
                icon={<CodeOutlined />}
                onClick={() => {
                  const sql = encodeURIComponent(ruleConfig.full_sql)
                  const title = encodeURIComponent(tagDetailData.name || '标签规则')
                  navigate(`/bigdata/data-explorer?sql=${sql}&title=${title}`)
                }}
              >
                在数据探索中查看
              </Button>
            </div>
          </div>
        )}

        {/* 数据预览 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>数据预览</div>
            <Space>
              {tagPreviewData && (
                <Space>
                  {tagPreviewData.filter && (
                    <Tag color="green">筛选: {tagPreviewData.filter}</Tag>
                  )}
                  <Text type="secondary">共 {tagPreviewData.total} 条，显示前 {tagPreviewData.rows.length} 条</Text>
                </Space>
              )}
              {!tagShowPreview && (tagDetailData.tag_table_name || ((tagDetailData.node_type === 'value' || tagDetailData.node_type === 'tag') && tagDetailData.parent_id)) && (
                <Button
                  type="primary"
                  ghost
                  size="small"
                  icon={<TableOutlined />}
                  onClick={handleLoadTagPreview}
                >
                  预览数据
                </Button>
              )}
            </Space>
          </div>
          {tagShowPreview ? (
            tagPreviewLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin tip="加载数据中..." />
              </div>
            ) : tagPreviewData && tagPreviewData.rows.length > 0 ? (
              <Table
                size="small"
                dataSource={tagPreviewData.rows.map((row, idx) => {
                  const obj: any = { _key: idx }
                  tagPreviewData.columns.forEach((col, i) => {
                    obj[col] = row[i]
                  })
                  return obj
                })}
                columns={tagPreviewData.columns.map(col => ({
                  title: col,
                  dataIndex: col,
                  key: col,
                  ellipsis: true,
                  width: 150,
                }))}
                rowKey="_key"
                scroll={{ x: 'max-content', y: 300 }}
                pagination={false}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#999', background: '#fafafa', borderRadius: 8 }}>
                暂无数据
              </div>
            )
          ) : (
            <div style={{ textAlign: 'center', padding: 24, color: '#999', background: '#fafafa', borderRadius: 8 }}>
              {(tagDetailData.tag_table_name || ((tagDetailData.node_type === 'value' || tagDetailData.node_type === 'tag') && tagDetailData.parent_id))
                ? '点击上方按钮预览数据'
                : '尚未生成数据表，请先执行任务'}
            </div>
          )}
        </div>
      </Modal>
    )
  }

  // 标签管理弹框
  const renderTagModal = () => {
    // 根据父节点类型确定可选的子类型
    // 规则：分类可创建3种（分类/类型/值标签/粒度标签），类型只能创建标签，标签无子类
    const getNodeTypeOptions = () => {
      // 独立创建模式：可创建类型、值标签和粒度标签
      if (creatingStandalone) {
        return [
          { value: 'type', label: '类型', icon: <TagsOutlined />, desc: '类型标签', color: '#1890ff' },
          { value: 'tag', label: '维度', icon: <TagOutlined />, desc: '值标签', color: '#52c41a' },
          { value: 'detail', label: '明细', icon: <DatabaseOutlined />, desc: '粒度标签', color: '#722ed1' },
        ]
      }
      if (!creatingParent) {
        // 根节点只能创建分类
        return [
          { value: 'category', label: '分类', icon: <FolderOpenOutlined />, desc: '最顶层的分组', color: '#fa8c16' },
        ]
      }
      if (creatingParent.node_type === 'category') {
        // 分类下可创建：子分类、类型、值标签、粒度标签
        return [
          { value: 'category', label: '分类', icon: <FolderOpenOutlined />, desc: '子分类', color: '#fa8c16' },
          { value: 'type', label: '类型', icon: <TagsOutlined />, desc: '分类下的细分', color: '#1890ff' },
          { value: 'tag', label: '维度', icon: <TagOutlined />, desc: '值标签', color: '#52c41a' },
          { value: 'detail', label: '明细', icon: <DatabaseOutlined />, desc: '粒度标签', color: '#722ed1' },
        ]
      }
      if (creatingParent.node_type === 'type') {
        // 类型下可创建值标签和粒度标签
        return [
          { value: 'tag', label: '维度', icon: <TagOutlined />, desc: '值标签', color: '#52c41a' },
          { value: 'detail', label: '明细', icon: <DatabaseOutlined />, desc: '粒度标签', color: '#722ed1' },
        ]
      }
      // 标签没有子类
      return []
    }

    const nodeTypeOptions = getNodeTypeOptions()
    const showNodeTypeSelect = nodeTypeOptions.length > 1 && !editingTag
    const currentNodeType = Form.useWatch('node_type', tagForm)
    const currentColor = Form.useWatch('color', tagForm)
    const currentName = Form.useWatch('name', tagForm)

    // 获取预览颜色
    const getPreviewColor = () => {
      if (currentColor) {
        // ColorPicker 返回的是 Color 对象，需要转换为 hex 字符串
        if (typeof currentColor === 'string') return currentColor
        if (typeof currentColor.toHexString === 'function') return currentColor.toHexString()
        if (currentColor.metaColor) return currentColor.metaColor.originalInput
        return '#1890ff'
      }
      const option = nodeTypeOptions.find(o => o.value === currentNodeType)
      return option?.color || '#1890ff'
    }

    // 类型图标和颜色配置
    const typeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
      category: { icon: <FolderOpenOutlined />, color: '#fa8c16', label: '分类' },
      type: { icon: <TagsOutlined />, color: '#1890ff', label: '类型' },
      tag: { icon: <TagOutlined />, color: '#52c41a', label: '标签' },
    }

    return (
      <Modal
        title={
          <span style={{ fontSize: 14 }}>
            {editingTag ? '编辑节点' : creatingParent ? `新建子节点 · ${creatingParent.name}` : '新建节点'}
          </span>
        }
        open={tagModalVisible}
        onCancel={() => { setTagModalVisible(false); setCreatingParent(null); setCreatingStandalone(false) }}
        width={400}
        footer={
          <Button type="primary" onClick={handleTagSubmit}>
            {editingTag ? '保存' : '创建'}
          </Button>
        }
        styles={{ body: { padding: '16px' } }}
      >
        <Form form={tagForm} layout="vertical" autoComplete="off" size="small">
            {/* 隐藏的 node_type 字段，确保值始终存在 */}
            <Form.Item name="node_type" hidden>
              <Input autoComplete="off" />
            </Form.Item>
            {/* 隐藏的 dimension_id 字段 */}
            <Form.Item name="dimension_id" hidden>
              <Input autoComplete="off" />
            </Form.Item>

            {/* 显示所属维度 */}
            <Form.Item noStyle shouldUpdate={(prev, curr) => prev.dimension_id !== curr.dimension_id}>
              {({ getFieldValue }) => {
                const dimensionId = getFieldValue('dimension_id')
                if (!dimensionId) return null
                const dim = dimensions.find(d => d.id === dimensionId)
                return (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    background: '#e6f7ff',
                    border: '1px solid #91d5ff',
                    borderRadius: 4,
                    marginBottom: 12,
                    fontSize: 12,
                  }}>
                    <TagsOutlined style={{ color: '#1890ff' }} />
                    <span style={{ color: '#666' }}>所属维度：</span>
                    <span style={{ fontWeight: 500, color: '#1890ff' }}>
                      {dim?.display_name || '未知'} ({dim?.id_field || ''})
                    </span>
                  </div>
                )
              }}
            </Form.Item>

            {/* 节点类型选择 - 紧凑卡片样式 */}
            {showNodeTypeSelect && (
              <Form.Item
                label={<span style={{ fontSize: 13 }}>节点类型</span>}
                rules={[{ required: true, message: '请选择节点类型' }]}
                style={{ marginBottom: 12 }}
              >
                <div style={{ display: 'flex', gap: 8 }}>
                  {nodeTypeOptions.map(option => (
                    <div
                      key={option.value}
                      onClick={() => tagForm.setFieldValue('node_type', option.value)}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: 6,
                        border: `1.5px solid ${currentNodeType === option.value ? option.color : '#d9d9d9'}`,
                        background: currentNodeType === option.value ? `${option.color}10` : '#fafafa',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: currentNodeType === option.value ? option.color : '#d9d9d9',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 4px',
                        fontSize: 14,
                      }}>
                        {option.icon}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: currentNodeType === option.value ? option.color : '#333' }}>
                        {option.label}
                      </div>
                    </div>
                  ))}
                </div>
              </Form.Item>
            )}

            {/* 编辑时显示类型（只读） */}
            {editingTag && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                background: '#f5f5f5',
                borderRadius: 4,
                marginBottom: 12,
                fontSize: 12,
              }}>
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: typeConfig[editingTag.node_type]?.color || '#999',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                }}>
                  {typeConfig[editingTag.node_type]?.icon}
                </div>
                <span style={{ color: '#666' }}>类型：</span>
                <span style={{ fontWeight: 500 }}>{typeConfig[editingTag.node_type]?.label}</span>
              </div>
            )}

            {/* 只有一个类型选项时显示 */}
            {!showNodeTypeSelect && !editingTag && creatingParent && nodeTypeOptions.length === 1 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                background: '#f5f5f5',
                borderRadius: 4,
                marginBottom: 12,
                fontSize: 12,
              }}>
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: nodeTypeOptions[0].color,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                }}>
                  {nodeTypeOptions[0].icon}
                </div>
                <span style={{ color: '#666' }}>类型：</span>
                <span style={{ fontWeight: 500 }}>{nodeTypeOptions[0].label}</span>
              </div>
            )}

            {/* 名称输入 */}
            <Form.Item
              name="name"
              label={<span style={{ fontSize: 13 }}>名称</span>}
              rules={[{ required: true, message: '请输入节点名称' }]}
              style={{ marginBottom: 12 }}
            >
              <Input placeholder="输入节点名称" autoComplete="off" />
            </Form.Item>

            {/* 描述输入 */}
            <Form.Item
              name="description"
              label={<span style={{ fontSize: 13 }}>描述 <span style={{ color: '#999' }}>(可选)</span></span>}
              style={{ marginBottom: 12 }}
            >
              <TextArea rows={2} placeholder="添加描述..." />
            </Form.Item>

            {/* 颜色选择 */}
            <Form.Item
              name="color"
              label={<span style={{ fontSize: 13 }}>颜色 <span style={{ color: '#999' }}>(可选，不选则继承父节点)</span></span>}
              style={{ marginBottom: 12 }}
              getValueFromEvent={(color) => color}
            >
              <ColorPicker
                allowClear
                size="small"
                presets={[
                  {
                    label: '推荐',
                    colors: [
                      '#52c41a', '#1890ff', '#fa8c16', '#eb2f96', '#722ed1',
                      '#13c2c2', '#faad14', '#f5222d', '#2f54eb', '#a0d911',
                    ],
                  },
                ]}
                format="hex"
              />
            </Form.Item>

            {/* 预览 */}
            <div style={{
              padding: '10px 12px',
              background: '#f5f5f5',
              borderRadius: 6,
            }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>预览</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  padding: '5px 14px',
                  borderRadius: currentNodeType === 'category' || editingTag?.node_type === 'category' ? 6 : 12,
                  background: getPreviewColor(),
                  color: '#fff',
                  fontWeight: 500,
                  fontSize: 12,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                }}>
                  {currentName || '节点名称'}
                </div>
                <div style={{
                  width: 24,
                  height: 2,
                  background: getPreviewColor(),
                }} />
                <div style={{
                  padding: '4px 10px',
                  borderRadius: 10,
                  background: getPreviewColor(),
                  fontSize: 11,
                  color: '#fff',
                }}>
                  子节点
                </div>
              </div>
            </div>
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
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>AI Tag Engine</span>
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
      {renderTagDetailModal()}

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
                  {schedulingTask?.rule_type === 'sql' ? '规则引擎' : schedulingTask?.rule_type === 'row' ? 'AI打标' : schedulingTask?.rule_type}
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
