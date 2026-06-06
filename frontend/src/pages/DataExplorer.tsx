import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
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
  Modal,
  Form,
  Select,
  Divider,
  Dropdown,
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
  CodeOutlined,
  PicLeftOutlined,
  PicCenterOutlined,
  PlusOutlined,
  CloseOutlined,
  CaretRightOutlined,
  SaveOutlined,
  SyncOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import Editor, { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { configApi, warehouseApi, aiApi, etlApi, dwLayerApi, taskDependencyApi, sqlScriptApi } from '../services/api'

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

interface DwLayer {
  id: number
  name: string
  level: number
  color?: string
  requires_dependency?: boolean
}

interface ParsedDependency {
  task_type: string
  task_id: number
  task_name?: string
  table_name?: string
  layer_name?: string
  layer_color?: string
  is_scheduled?: boolean
}

export default function DataExplorer() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // 平台数据库配置
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

  // SQL 编辑器多Tab
  interface EditorTab {
    id: string
    title: string  // 文件名（不含.sql后缀）
    sql: string
    savedSql: string  // 服务器上保存的内容，用于比较是否有修改
    isNew: boolean    // 是否是新建的（未保存到服务器）
    etlId?: number    // 如果是ETL任务的SQL，保存ETL任务ID
  }

  // 从localStorage读取当前打开的Tab状态（用于恢复会话）
  // 如果URL有etl_id参数，不恢复localStorage，从空白开始
  const loadSavedTabs = (): { tabs: EditorTab[], activeId: string, counter: number } => {
    // 检查URL是否有etl_id参数，如果有则不恢复localStorage
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('etl_id')) {
      return { tabs: [{ id: '1', title: 'SQL 1', sql: '', savedSql: '', isNew: true }], activeId: '1', counter: 1 }
    }

    try {
      const saved = localStorage.getItem('dataExplorer_tabs')
      if (saved) {
        const data = JSON.parse(saved)
        if (data.tabs && data.tabs.length > 0) {
          // 确保每个 tab 都有 savedSql 和 isNew 字段（兼容旧数据）
          const tabs = data.tabs.map((t: any) => ({
            ...t,
            savedSql: t.savedSql ?? '',  // 旧数据可能没有这个字段
            isNew: t.isNew ?? true,      // 默认视为新建
          }))
          return {
            tabs,
            activeId: data.activeId || tabs[0].id,
            counter: data.counter || tabs.length
          }
        }
      }
    } catch (e) {
      console.error('Failed to load saved tabs:', e)
    }
    return { tabs: [{ id: '1', title: 'SQL 1', sql: '', savedSql: '', isNew: true }], activeId: '1', counter: 1 }
  }

  const savedData = loadSavedTabs()
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>(savedData.tabs)
  const [activeEditorTab, setActiveEditorTab] = useState(savedData.activeId)
  const [tabCounter, setTabCounter] = useState(savedData.counter)
  const [serverScripts, setServerScripts] = useState<{name: string, size: number, modified_at: string}[]>([])

  // 用 ref 保存最新的 tabs 状态，供 Monaco 快捷键回调使用
  const editorTabsRef = useRef(editorTabs)
  const activeEditorTabRef = useRef(activeEditorTab)
  useEffect(() => {
    editorTabsRef.current = editorTabs
    activeEditorTabRef.current = activeEditorTab
  }, [editorTabs, activeEditorTab])

  // 加载服务器上的脚本列表
  const loadServerScripts = async () => {
    try {
      const res = await sqlScriptApi.list()
      setServerScripts(res.data)
    } catch (e) {
      console.error('Failed to load server scripts:', e)
    }
  }

  // 初始化加载服务器脚本
  useEffect(() => {
    loadServerScripts()
  }, [])

  // 保存Tab状态到localStorage（用于恢复会话）
  useEffect(() => {
    try {
      localStorage.setItem('dataExplorer_tabs', JSON.stringify({
        tabs: editorTabs,
        activeId: activeEditorTab,
        counter: tabCounter
      }))
    } catch (e) {
      console.error('Failed to save tabs:', e)
    }
  }, [editorTabs, activeEditorTab, tabCounter])

  // 防止重复加载 ETL 任务
  const etlLoadedRef = useRef(false)

  // 从 URL 参数加载 ETL 任务的 SQL
  useEffect(() => {
    const etlId = searchParams.get('etl_id')
    const etlName = searchParams.get('etl_name')
    if (etlId && !etlLoadedRef.current) {
      etlLoadedRef.current = true
      // 获取 ETL 任务的 SQL
      etlApi.get(parseInt(etlId)).then(res => {
        const task = res.data
        const title = etlName || task.name || `ETL ${etlId}`
        // 直接替换所有tabs，只保留这一个ETL任务
        setEditorTabs([{
          id: '1',
          title,
          sql: task.sql_content || '',
          savedSql: task.sql_content || '',
          isNew: false,  // ETL任务已存在
          etlId: parseInt(etlId),  // 关联ETL任务ID
        }])
        setActiveEditorTab('1')
        setTabCounter(1)
        message.success(`已加载 ETL 任务: ${title}`)
      }).catch(() => {
        message.error('加载 ETL 任务失败')
      })
      // 清除 URL 参数
      setSearchParams({})
    }
  }, [searchParams])

  // 当前Tab的SQL（从tabs中获取）
  const currentTab = editorTabs.find(t => t.id === activeEditorTab)
  const sql = currentTab?.sql || ''
  const setSql = (newSql: string) => {
    setEditorTabs(tabs => tabs.map(t =>
      t.id === activeEditorTab ? { ...t, sql: newSql } : t
    ))
  }

  const [executing, setExecuting] = useState(false)
  const [queryResult, setQueryResult] = useState<any>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)

  // 表字段缓存
  const [tableColumnsCache, setTableColumnsCache] = useState<Record<string, ColumnInfo[]>>({})

  // 用于补全的最新数据引用
  const tablesRef = useRef<string[]>([])
  const tableColumnsCacheRef = useRef<Record<string, ColumnInfo[]>>({})

  // 结果Tab
  const [activeTab, setActiveTab] = useState('result')

  // 保存为ETL任务
  const [saveEtlModalVisible, setSaveEtlModalVisible] = useState(false)
  const [saveEtlForm] = Form.useForm()
  const [savingEtl, setSavingEtl] = useState(false)
  const [layers, setLayers] = useState<DwLayer[]>([])
  const [parsedDeps, setParsedDeps] = useState<ParsedDependency[]>([])
  const [parsingDeps, setParsingDeps] = useState(false)
  const [parsedTables, setParsedTables] = useState<{name: string, exists: boolean, checking: boolean}[]>([])
  const [manualTableInput, setManualTableInput] = useState('')
  const [showAddTableInput, setShowAddTableInput] = useState(false)

  // 添加新编辑器Tab
  const addEditorTab = () => {
    const newId = String(tabCounter + 1)
    setTabCounter(tabCounter + 1)
    setEditorTabs([...editorTabs, { id: newId, title: `SQL ${tabCounter + 1}`, sql: '', savedSql: '', isNew: true }])
    setActiveEditorTab(newId)
  }

  // 关闭编辑器Tab
  const closeEditorTab = (id: string) => {
    if (editorTabs.length <= 1) return // 至少保留一个
    const newTabs = editorTabs.filter(t => t.id !== id)
    setEditorTabs(newTabs)
    if (activeEditorTab === id) {
      setActiveEditorTab(newTabs[0].id)
    }
  }

  // 关闭右侧所有Tab
  const closeTabsToRight = (id: string) => {
    const idx = editorTabs.findIndex(t => t.id === id)
    if (idx === -1 || idx === editorTabs.length - 1) return
    const newTabs = editorTabs.slice(0, idx + 1)
    setEditorTabs(newTabs)
    // 如果当前激活的tab被关闭，切换到点击的tab
    if (!newTabs.find(t => t.id === activeEditorTab)) {
      setActiveEditorTab(id)
    }
  }

  // 关闭全部Tab（保留一个默认）
  const closeAllTabs = () => {
    const newTab = { id: '1', title: 'SQL 1', sql: '', savedSql: '', isNew: true }
    setEditorTabs([newTab])
    setActiveEditorTab('1')
    setTabCounter(1)
  }

  // Tab右键菜单
  const getTabContextMenu = (tabId: string) => {
    const idx = editorTabs.findIndex(t => t.id === tabId)
    const hasTabsToRight = idx < editorTabs.length - 1
    return {
      items: [
        {
          key: 'close',
          label: '关闭当前',
          disabled: editorTabs.length <= 1,
          onClick: () => closeEditorTab(tabId),
        },
        {
          key: 'closeRight',
          label: '关闭右侧',
          disabled: !hasTabsToRight,
          onClick: () => closeTabsToRight(tabId),
        },
        {
          key: 'closeAll',
          label: '关闭全部',
          onClick: () => closeAllTabs(),
        },
      ],
    }
  }

  // 保存当前Tab到服务器（使用 ref 获取最新状态，避免闭包问题）
  const saveCurrentTab = async () => {
    const tabs = editorTabsRef.current
    const activeId = activeEditorTabRef.current
    const tab = tabs.find(t => t.id === activeId)
    if (!tab) return

    console.log('saveCurrentTab:', { etlId: tab.etlId, title: tab.title, isNew: tab.isNew })

    try {
      if (tab.etlId) {
        // ETL任务的SQL，保存回ETL任务
        console.log('Saving to ETL task:', tab.etlId)
        await etlApi.update(tab.etlId, { sql_content: tab.sql })
        message.success('ETL任务已保存')
      } else if (tab.isNew) {
        // 新建脚本
        await sqlScriptApi.create(tab.title, tab.sql)
        message.success('已保存')
        loadServerScripts()  // 刷新脚本列表
      } else {
        // 更新现有脚本
        await sqlScriptApi.update(tab.title, tab.sql)
        message.success('已保存')
        loadServerScripts()  // 刷新脚本列表
      }
      setEditorTabs(tabs => tabs.map(t =>
        t.id === activeEditorTab ? { ...t, savedSql: t.sql, isNew: false } : t
      ))
    } catch (err: any) {
      message.error('保存失败: ' + (err.response?.data?.detail || err.message))
    }
  }

  // 打开服务器上的脚本
  const openServerScript = async (name: string) => {
    // 检查是否已打开
    const existingTab = editorTabs.find(t => t.title === name && !t.isNew)
    if (existingTab) {
      setActiveEditorTab(existingTab.id)
      return
    }

    try {
      const res = await sqlScriptApi.get(name)
      const newId = String(tabCounter + 1)
      setTabCounter(tabCounter + 1)
      setEditorTabs([...editorTabs, {
        id: newId,
        title: name,
        sql: res.data.content,
        savedSql: res.data.content,
        isNew: false,
      }])
      setActiveEditorTab(newId)
    } catch (err: any) {
      message.error('打开失败: ' + (err.response?.data?.detail || err.message))
    }
  }

  // 删除服务器上的脚本
  const deleteServerScript = async (name: string) => {
    try {
      await sqlScriptApi.delete(name)
      message.success('已删除')
      // 如果当前打开了这个脚本，关闭它
      const tab = editorTabs.find(t => t.title === name && !t.isNew)
      if (tab) {
        closeEditorTab(tab.id)
      }
      loadServerScripts()
    } catch (err: any) {
      message.error('删除失败: ' + (err.response?.data?.detail || err.message))
    }
  }

  // 检查Tab是否有未保存修改
  const isTabDirty = (tab: EditorTab) => tab.sql !== tab.savedSql

  // 切换编辑器Tab
  const switchEditorTab = (id: string) => {
    setActiveEditorTab(id)
  }

  // 重命名编辑器Tab
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const startRenameTab = (id: string, currentTitle: string) => {
    setEditingTabId(id)
    setEditingTitle(currentTitle)
  }

  const finishRenameTab = async () => {
    if (editingTabId && editingTitle.trim()) {
      const tab = editorTabs.find(t => t.id === editingTabId)
      if (tab && !tab.isNew && tab.title !== editingTitle.trim()) {
        // 服务器上的文件需要重命名
        try {
          await sqlScriptApi.rename(tab.title, editingTitle.trim())
          loadServerScripts()
        } catch (err: any) {
          message.error('重命名失败: ' + (err.response?.data?.detail || err.message))
          setEditingTabId(null)
          setEditingTitle('')
          return
        }
      }
      setEditorTabs(tabs => tabs.map(t =>
        t.id === editingTabId ? { ...t, title: editingTitle.trim() } : t
      ))
    }
    setEditingTabId(null)
    setEditingTitle('')
  }

  // 结果面板位置: 'bottom' | 'right'
  const [resultPosition, setResultPosition] = useState<'bottom' | 'right'>('bottom')

  useEffect(() => {
    loadWarehouseConfig()
    loadLayers()
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
    // 同步到 ref 供补全使用
    tablesRef.current = tables
  }, [searchText, tables])

  useEffect(() => {
    tableColumnsCacheRef.current = tableColumnsCache
  }, [tableColumnsCache])

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

  const loadLayers = async () => {
    try {
      const res = await dwLayerApi.list()
      setLayers(res.data)
    } catch (err) {
      console.error('Failed to load layers:', err)
    }
  }

  const handleSelectTable = async (tableName: string) => {
    setSelectedTable(tableName)
    setLoadingTableInfo(true)

    try {
      // 加载表结构
      const structRes = await warehouseApi.getTableMetadata(tableName)
      const columns = structRes.data.columns || []
      setTableColumns(columns)

      // 缓存表字段
      setTableColumnsCache(prev => ({ ...prev, [tableName]: columns }))

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

  // 获取表字段（优先从缓存，否则异步加载）
  const getTableColumns = async (tableName: string): Promise<ColumnInfo[]> => {
    // 先检查 ref 缓存（供补全使用）
    if (tableColumnsCacheRef.current[tableName]) {
      return tableColumnsCacheRef.current[tableName]
    }
    if (tableColumnsCache[tableName]) {
      return tableColumnsCache[tableName]
    }
    try {
      const res = await warehouseApi.getTableMetadata(tableName)
      const columns = res.data.columns || []
      setTableColumnsCache(prev => {
        const newCache = { ...prev, [tableName]: columns }
        tableColumnsCacheRef.current = newCache
        return newCache
      })
      return columns
    } catch {
      return []
    }
  }

  const handleExecute = async () => {
    // 获取要执行的SQL：
    // 1. 优先选中内容
    // 2. 没选中则找光标所在的连续SQL块（被空行分隔的块）
    // 3. 都没有则执行全部
    let sqlToExecute = ''
    if (editorRef.current) {
      const editor = editorRef.current
      const model = editor.getModel()
      const selection = editor.getSelection()

      // 1. 检查是否有选中内容
      if (selection && !selection.isEmpty()) {
        sqlToExecute = model?.getValueInRange(selection) || ''
      }
      // 2. 没选中，找光标所在的连续SQL块
      else if (model) {
        const position = editor.getPosition()
        if (position) {
          const currentLine = position.lineNumber
          const totalLines = model.getLineCount()

          // 向上找到块的开始（遇到空行停止）
          let startLine = currentLine
          while (startLine > 1) {
            const lineContent = model.getLineContent(startLine - 1).trim()
            if (lineContent === '') break
            startLine--
          }

          // 向下找到块的结束（遇到空行停止）
          let endLine = currentLine
          while (endLine < totalLines) {
            const lineContent = model.getLineContent(endLine + 1).trim()
            if (lineContent === '') break
            endLine++
          }

          // 检查当前行是否为空
          const currentLineContent = model.getLineContent(currentLine).trim()
          if (currentLineContent !== '') {
            // 获取这个块的内容
            const blockRange = {
              startLineNumber: startLine,
              startColumn: 1,
              endLineNumber: endLine,
              endColumn: model.getLineMaxColumn(endLine),
            }
            sqlToExecute = model.getValueInRange(blockRange)
          }
        }
      }
    }

    // 3. 如果还是没有，执行全部
    if (!sqlToExecute) {
      sqlToExecute = sql
    }

    if (!sqlToExecute.trim()) {
      message.warning('请输入SQL')
      return
    }

    setExecuting(true)
    setQueryResult(null)
    setActiveTab('result')

    try {
      const res = await warehouseApi.executeQuery({
        sql: sqlToExecute.trim(),
        limit: 1000,
      })
      setQueryResult(res.data)
      // 根据SQL类型显示不同的成功消息
      if (res.data.sql_type === 'SELECT') {
        message.success(`查询成功，返回 ${res.data.row_count} 行`)
      } else if (res.data.sql_type === 'DDL') {
        message.success('执行成功')
      } else {
        message.success(`执行成功，影响 ${res.data.affected_rows} 行`)
      }
    } catch (error: any) {
      // 错误信息显示在结果框
      setQueryResult({
        error: true,
        message: error.response?.data?.detail || error.message || '执行失败',
      })
    } finally {
      setExecuting(false)
    }
  }

  // 执行多条SQL（用分号分隔）
  const handleExecuteMultiple = async () => {
    if (!sql.trim()) {
      message.warning('请输入SQL')
      return
    }

    // 按分号分割SQL，过滤空语句
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    if (statements.length === 0) {
      message.warning('没有有效的SQL语句')
      return
    }

    setExecuting(true)
    setQueryResult(null)
    setActiveTab('result')

    const results: any[] = []
    let hasError = false

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      try {
        const res = await warehouseApi.executeQuery({
          sql: stmt,
          limit: 1000,
        })
        results.push({
          index: i + 1,
          sql: stmt.length > 50 ? stmt.substring(0, 50) + '...' : stmt,
          success: true,
          row_count: res.data.row_count,
          execution_time_ms: res.data.execution_time_ms,
          data: res.data,
        })
      } catch (error: any) {
        hasError = true
        results.push({
          index: i + 1,
          sql: stmt.length > 50 ? stmt.substring(0, 50) + '...' : stmt,
          success: false,
          error: error.response?.data?.detail || error.message || '执行失败',
        })
      }
    }

    // 设置多条结果
    setQueryResult({
      multiple: true,
      results,
      hasError,
      totalCount: statements.length,
      successCount: results.filter(r => r.success).length,
    })

    if (hasError) {
      message.warning(`执行完成，${results.filter(r => !r.success).length} 条失败`)
    } else {
      message.success(`执行完成，共 ${statements.length} 条语句`)
    }

    setExecuting(false)
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

  // 校验单个表是否存在
  const checkTableExists = async (tableName: string): Promise<boolean> => {
    try {
      const allTables = tables.length > 0 ? tables : (await warehouseApi.getTables()).data
      return allTables.some((t: string) => t.toLowerCase() === tableName.toLowerCase())
    } catch {
      return false
    }
  }

  // 解析SQL依赖
  const parseSqlDependencies = async () => {
    if (!sql.trim()) return
    setParsingDeps(true)
    setParsedTables([])
    setParsedDeps([])
    try {
      const res = await taskDependencyApi.parseSql(sql)
      const { source_tables, matched_tasks } = res.data

      // 初始化表列表，开始校验
      const tableList = (source_tables || []).map((t: string) => ({ name: t, exists: false, checking: true }))
      setParsedTables(tableList)

      // 逐个校验表是否存在
      for (let i = 0; i < tableList.length; i++) {
        const exists = await checkTableExists(tableList[i].name)
        setParsedTables(prev => prev.map((t, idx) =>
          idx === i ? { ...t, exists, checking: false } : t
        ))
      }

      setParsedDeps((matched_tasks || []).map((t: any) => ({
        task_type: t.task_type,
        task_id: t.task_id,
        task_name: t.name,
        table_name: t.detail?.split(' → ')[1] || t.detail,
        layer_name: t.layer_name,
        layer_color: t.layer_color,
        is_scheduled: t.is_scheduled,
      })))
    } catch (err) {
      console.warn('SQL解析失败:', err)
    } finally {
      setParsingDeps(false)
    }
  }

  // 手动添加表
  const handleAddTable = async () => {
    const tableName = manualTableInput.trim()
    if (!tableName) return
    if (parsedTables.some(t => t.name.toLowerCase() === tableName.toLowerCase())) {
      message.warning('该表已在列表中')
      return
    }

    // 添加到列表并校验
    setParsedTables(prev => [...prev, { name: tableName, exists: false, checking: true }])
    setManualTableInput('')

    const exists = await checkTableExists(tableName)
    setParsedTables(prev => prev.map(t =>
      t.name === tableName ? { ...t, exists, checking: false } : t
    ))

    // 如果表存在，尝试匹配依赖
    if (exists) {
      try {
        const res = await taskDependencyApi.parseSql(`SELECT * FROM ${tableName}`)
        const { matched_tasks } = res.data
        if (matched_tasks?.length > 0) {
          const newDeps = matched_tasks.filter((t: any) =>
            !parsedDeps.some(d => d.task_type === t.task_type && d.task_id === t.task_id)
          ).map((t: any) => ({
            task_type: t.task_type,
            task_id: t.task_id,
            task_name: t.name,
            table_name: t.detail?.split(' → ')[1] || t.detail,
            layer_name: t.layer_name,
            layer_color: t.layer_color,
            is_scheduled: t.is_scheduled,
          }))
          if (newDeps.length > 0) {
            setParsedDeps(prev => [...prev, ...newDeps])
          }
        }
      } catch (err) {
        console.warn('匹配依赖失败:', err)
      }
    }
  }

  // 保存为ETL任务
  const handleSaveAsEtl = async () => {
    if (!sql.trim()) {
      message.warning('请输入SQL')
      return
    }
    // 使用当前Tab的标题作为默认名称
    const defaultName = currentTab?.title || 'ETL任务'
    saveEtlForm.setFieldsValue({
      name: defaultName,
      description: '',
      dw_layer_id: undefined,
    })
    setSaveEtlModalVisible(true)
    // 自动解析依赖
    await parseSqlDependencies()
  }

  const handleSaveEtlSubmit = async () => {
    try {
      const values = await saveEtlForm.validateFields()
      setSavingEtl(true)

      // 创建ETL任务
      const res = await etlApi.create({
        name: values.name,
        description: values.description,
        sql_content: sql,
        dw_layer_id: values.dw_layer_id,
      })
      const taskId = res.data.id

      // 保存依赖关系
      if (parsedDeps.length > 0) {
        for (const dep of parsedDeps) {
          try {
            await taskDependencyApi.create({
              task_type: 'etl',
              task_id: taskId,
              upstream_task_type: dep.task_type,
              upstream_task_id: dep.task_id,
            })
          } catch (err) {
            console.error('Failed to create dependency:', err)
          }
        }
        message.success(`已保存，添加 ${parsedDeps.length} 个依赖`)
      } else {
        message.success('已保存为ETL任务')
      }

      setSaveEtlModalVisible(false)
      saveEtlForm.resetFields()
      setParsedDeps([])
      setParsedTables([])

      // 跳转到 ETL 任务页面
      navigate(`/etl-tasks?id=${taskId}`)
    } catch (error: any) {
      if (error.errorFields) return
      message.error('保存失败: ' + (error.response?.data?.detail || error.message))
    } finally {
      setSavingEtl(false)
    }
  }

  // SQL常用关键词（精简版）
  const sqlKeywords = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'IN', 'LIKE', 'NOT',
    'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
    'GROUP BY', 'ORDER BY', 'HAVING', 'ASC', 'DESC', 'LIMIT',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT',
    'NULL', 'IS NULL', 'IS NOT NULL', 'BETWEEN',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  ]

  // 编辑器挂载处理
  const handleEditorMount = (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editorInstance
    monacoRef.current = monaco

    // 解析SQL中的表别名
    const parseTableAliases = (sqlText: string): Record<string, string> => {
      const aliases: Record<string, string> = {}
      const currentTables = tablesRef.current
      const excludeKeywords = ['WHERE', 'ON', 'AND', 'OR', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'JOIN', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'SET', 'VALUES', 'SELECT']

      // 匹配: FROM/JOIN [db.]table alias 或 FROM/JOIN [db.]table AS alias
      const patterns = [
        /(?:FROM|JOIN)\s+(?:[\w]+\.)?(\w+)\s+AS\s+(\w+)/gi,
        /(?:FROM|JOIN)\s+(?:[\w]+\.)?(\w+)\s+(\w+)/gi,
      ]

      for (const pattern of patterns) {
        let match
        while ((match = pattern.exec(sqlText)) !== null) {
          const tableName = match[1]
          const alias = match[2]
          // 跳过SQL关键词和已存在的别名
          if (!excludeKeywords.includes(alias.toUpperCase()) &&
              alias.toLowerCase() !== tableName.toLowerCase() &&
              currentTables.includes(tableName)) {
            aliases[alias.toLowerCase()] = tableName
          }
        }
      }
      return aliases
    }

    // 注册SQL补全提供者
    monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.'],
      provideCompletionItems: async (model: any, position: any) => {
        const fullText = model.getValue()
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })

        // 如果光标前是两个或更多空格，不补全
        if (/\s{2,}$/.test(textUntilPosition)) {
          return { suggestions: [] }
        }

        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const suggestions: any[] = []
        const addedLabels = new Set<string>() // 用于去重

        // 解析表别名
        const tableAliases = parseTableAliases(fullText)

        // 检测 别名. 或 表名. 模式
        const tableRefMatch = textUntilPosition.match(/(\w+)\.(\w*)$/)
        if (tableRefMatch) {
          const ref = tableRefMatch[1]
          const partialField = tableRefMatch[2] || ''
          const fieldRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column - partialField.length,
            endColumn: position.column,
          }

          // 查找实际表名（先查别名，再查表名）
          const currentTables = tablesRef.current
          const actualTableName = tableAliases[ref.toLowerCase()] || (currentTables.includes(ref) ? ref : null)

          if (actualTableName) {
            // 从缓存或API获取表字段
            const columns = await getTableColumns(actualTableName)
            columns.forEach((col) => {
              if (!addedLabels.has(col.name)) {
                addedLabels.add(col.name)
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  range: fieldRange,
                  detail: `${col.data_type}`,
                  documentation: col.comment || undefined,
                  sortText: '0' + col.name,
                })
              }
            })
            return { suggestions }
          }
        }

        // 如果正在输入单词才补全
        if (word.word.length === 0) {
          return { suggestions: [] }
        }

        // SQL关键词补全
        sqlKeywords.forEach((keyword) => {
          if (!addedLabels.has(keyword)) {
            addedLabels.add(keyword)
            suggestions.push({
              label: keyword,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: keyword,
              range,
              detail: 'SQL',
              sortText: '2' + keyword,
            })
          }
        })

        // 表名补全
        tablesRef.current.forEach((table) => {
          if (!addedLabels.has(table)) {
            addedLabels.add(table)
            suggestions.push({
              label: table,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: table,
              range,
              detail: '表',
              sortText: '1' + table,
            })
          }
        })

        // 当前选中表的字段补全
        tableColumns.forEach((col) => {
          if (!addedLabels.has(col.name)) {
            addedLabels.add(col.name)
            suggestions.push({
              label: col.name,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: col.name,
              range,
              detail: `${col.data_type}`,
            })
          }
        })

        return { suggestions }
      },
    })

    // 添加快捷键：Ctrl+Enter 执行SQL
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleExecute()
    })

    // 添加快捷键：Ctrl+S 保存到服务器
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveCurrentTab()
    })
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
          message="平台数据库未配置"
          description={
            <Space direction="vertical">
              <Text>请先在「系统管理 - 平台数据库配置」中配置目标数据库连接。</Text>
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
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 64px)',
      width: '100%',
    }}>
      {/* 主体内容 */}
      <Splitter style={{ flex: 1, minHeight: 0 }}>
        {/* 左侧：表列表 */}
        <Splitter.Panel defaultSize={220} min={160} max={360}>
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fafafa', borderRight: '1px solid #f0f0f0' }}>
            {/* 表列表头部 */}
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 4 }}>
              <DatabaseOutlined style={{ fontSize: 12, color: '#8c8c8c' }} />
              <Text style={{ fontSize: 12, fontWeight: 500 }}>平台数据库</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>({filteredTables.length})</Text>
              <div style={{ flex: 1 }} />
              <Tooltip title="刷新">
                <Button type="text" size="small" icon={<ReloadOutlined style={{ fontSize: 12 }} />} onClick={loadTables} style={{ width: 22, height: 22 }} />
              </Tooltip>
            </div>
            {/* 搜索框 */}
            <div style={{ padding: '4px 8px' }}>
              <Search
                placeholder="搜索表..."
                size="small"
                allowClear
                onChange={(e) => setSearchText(e.target.value)}
                style={{ fontSize: 12 }}
              />
            </div>
            {/* 表列表 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
              {loadingTables ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <Spin size="small" />
                </div>
              ) : filteredTables.length > 0 ? (
                filteredTables.map((table) => (
                  <div
                    key={table}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', table)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => handleSelectTable(table)}
                    style={{
                      padding: '4px 8px',
                      cursor: 'grab',
                      borderRadius: 4,
                      marginBottom: 2,
                      background: selectedTable === table ? '#e6f4ff' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <Space size={6}>
                      <TableOutlined
                        style={{ fontSize: 12, color: selectedTable === table ? '#1890ff' : '#8c8c8c' }}
                      />
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: selectedTable === table ? 500 : 400,
                          color: selectedTable === table ? '#1890ff' : 'inherit',
                        }}
                        ellipsis
                      >
                        {table}
                      </Text>
                    </Space>
                  </div>
                ))
              ) : (
                <Empty description="暂无表" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />
              )}
            </div>
          </div>
        </Splitter.Panel>

        {/* 右侧：SQL编辑和结果 */}
        <Splitter.Panel>
          <div style={{ height: '100%', position: 'relative' }}>
            {/* 右上角布局切换按钮 */}
            <Tooltip title={resultPosition === 'bottom' ? '结果移到右侧' : '结果移到下方'}>
              <Button
                type="text"
                size="small"
                icon={resultPosition === 'bottom' ? <PicLeftOutlined style={{ fontSize: 14 }} /> : <PicCenterOutlined style={{ fontSize: 14 }} />}
                onClick={() => setResultPosition(resultPosition === 'bottom' ? 'right' : 'bottom')}
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
            <Splitter layout={resultPosition === 'bottom' ? 'vertical' : 'horizontal'} style={{ height: '100%' }}>
            {/* SQL编辑器 */}
            <Splitter.Panel defaultSize={resultPosition === 'bottom' ? '45%' : '55%'} min={120} max="70%">
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
                    <Dropdown
                      key={tab.id}
                      menu={getTabContextMenu(tab.id)}
                      trigger={['contextMenu']}
                    >
                      <div
                        onClick={() => switchEditorTab(tab.id)}
                        onDoubleClick={() => startRenameTab(tab.id, tab.title)}
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
                        {editingTabId === tab.id ? (
                          <input
                            autoFocus
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={finishRenameTab}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') finishRenameTab()
                              if (e.key === 'Escape') {
                                setEditingTabId(null)
                                setEditingTitle('')
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: 60,
                              height: 18,
                              fontSize: 12,
                              border: '1px solid #1890ff',
                              borderRadius: 2,
                              outline: 'none',
                              padding: '0 4px',
                            }}
                          />
                        ) : (
                          <span>
                            {isTabDirty(tab) && <span style={{ color: '#ff4d4f', marginRight: 2 }}>*</span>}
                            {tab.title}
                          </span>
                        )}
                        {editorTabs.length > 1 && (
                          <CloseOutlined
                            style={{ fontSize: 10, color: '#999' }}
                            onClick={(e) => {
                              e.stopPropagation()
                              closeEditorTab(tab.id)
                            }}
                          />
                        )}
                      </div>
                    </Dropdown>
                  ))}
                  <Tooltip title="新建">
                    <div
                      onClick={addEditorTab}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        cursor: 'pointer',
                        color: '#666',
                      }}
                    >
                      <PlusOutlined style={{ fontSize: 12 }} />
                    </div>
                  </Tooltip>
                </div>
                {/* 编辑器主体 */}
                <div style={{ flex: 1, display: 'flex' }}>
                  {/* 左侧按钮栏 */}
                  <div
                    style={{
                      width: 32,
                      background: '#fafafa',
                      borderRight: '1px solid #f0f0f0',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '8px 0',
                      gap: 4,
                    }}
                  >
                  <Tooltip title="执行 (Ctrl+Enter)" placement="right">
                    <Button
                      type="primary"
                      size="small"
                      icon={<PlayCircleOutlined style={{ fontSize: 14 }} />}
                      onClick={handleExecute}
                      loading={executing}
                      style={{ width: 26, height: 26, padding: 0 }}
                    />
                  </Tooltip>
                  <Tooltip title="执行全部(多条SQL)" placement="right">
                    <Button
                      size="small"
                      icon={<CaretRightOutlined style={{ fontSize: 14 }} />}
                      onClick={handleExecuteMultiple}
                      loading={executing}
                      style={{ width: 26, height: 26, padding: 0 }}
                    />
                  </Tooltip>
                  <Tooltip title="AI优化" placement="right">
                    <Button
                      size="small"
                      icon={<ThunderboltOutlined style={{ fontSize: 14 }} />}
                      onClick={handleOptimize}
                      loading={aiLoading}
                      style={{ width: 26, height: 26, padding: 0 }}
                    />
                  </Tooltip>
                  <Tooltip title="保存为ETL任务" placement="right">
                    <Button
                      size="small"
                      icon={<SaveOutlined style={{ fontSize: 14 }} />}
                      onClick={handleSaveAsEtl}
                      style={{ width: 26, height: 26, padding: 0 }}
                    />
                  </Tooltip>
                  <Divider style={{ margin: '4px 0', borderColor: '#e0e0e0' }} />
                  <Dropdown
                    trigger={['click']}
                    placement="topRight"
                    menu={{
                      items: [
                        {
                          key: 'header',
                          type: 'group',
                          label: <span style={{ fontWeight: 500 }}>已保存的脚本</span>,
                        },
                        ...(serverScripts.length > 0
                          ? serverScripts.map(s => ({
                              key: s.name,
                              onClick: () => openServerScript(s.name),
                              label: (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 140 }}>
                                  <span style={{ flex: 1 }}>{s.name}.sql</span>
                                  <DeleteOutlined
                                    style={{ color: '#ff4d4f', fontSize: 12 }}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      Modal.confirm({
                                        title: '删除脚本',
                                        content: `确定要删除 ${s.name}.sql 吗？`,
                                        okText: '删除',
                                        okButtonProps: { danger: true },
                                        onOk: () => deleteServerScript(s.name),
                                      })
                                    }}
                                  />
                                </div>
                              ),
                            }))
                          : [{ key: 'empty', label: <Text type="secondary">暂无保存的脚本</Text>, disabled: true }]
                        ),
                        { type: 'divider' },
                        {
                          key: 'refresh',
                          icon: <ReloadOutlined />,
                          label: '刷新列表',
                          onClick: () => loadServerScripts(),
                        },
                      ],
                    }}
                  >
                    <Tooltip title="已保存的脚本" placement="right">
                      <Button
                        size="small"
                        icon={<FolderOpenOutlined style={{ fontSize: 14 }} />}
                        style={{ width: 26, height: 26, padding: 0 }}
                      />
                    </Tooltip>
                  </Dropdown>
                </div>

                {/* SQL编辑器 */}
                <div
                  style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const tableName = e.dataTransfer.getData('text/plain')
                    if (tableName && editorRef.current) {
                      const editor = editorRef.current
                      const position = editor.getPosition()
                      if (position) {
                        // 加上库名
                        const fullTableName = warehouseConfig?.database
                          ? `${warehouseConfig.database}.${tableName}`
                          : tableName
                        editor.executeEdits('drag-drop', [{
                          range: {
                            startLineNumber: position.lineNumber,
                            startColumn: position.column,
                            endLineNumber: position.lineNumber,
                            endColumn: position.column,
                          },
                          text: fullTableName,
                        }])
                        editor.focus()
                      }
                    }
                  }}
                >
                  <Editor
                    height="100%"
                    language="sql"
                    value={sql}
                    onChange={(value) => setSql(value || '')}
                    onMount={handleEditorMount}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      padding: { top: 4 },
                    }}
                  />
                </div>
                </div>
              </div>
            </Splitter.Panel>

            {/* 下半部分：结果区域 */}
            <Splitter.Panel>
              <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              size="small"
              style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}
              tabBarStyle={{ padding: '0 8px', marginBottom: 0, minHeight: 28, height: 28 }}
              items={[
                {
                  key: 'result',
                  label: (
                    <span style={{ fontSize: 12 }}>
                      <CodeOutlined /> 结果
                      {queryResult?.multiple && (
                        <Tag color={queryResult.hasError ? 'orange' : 'blue'} style={{ marginLeft: 4, fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>
                          {queryResult.successCount}/{queryResult.totalCount}
                        </Tag>
                      )}
                      {queryResult && !queryResult.error && !queryResult.multiple && (
                        <Tag color={queryResult.sql_type === 'SELECT' ? 'blue' : 'green'} style={{ marginLeft: 4, fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>
                          {queryResult.sql_type === 'SELECT'
                            ? queryResult.row_count
                            : queryResult.sql_type === 'DDL'
                              ? 'OK'
                              : queryResult.affected_rows}
                        </Tag>
                      )}
                      {queryResult?.error && (
                        <Tag color="red" style={{ marginLeft: 4, fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>
                          错误
                        </Tag>
                      )}
                    </span>
                  ),
                  children: (
                    <div style={{ padding: 8, overflow: 'auto', height: '100%' }}>
                      {executing ? (
                        <div style={{ textAlign: 'center', padding: 50 }}>
                          <Spin tip="执行中..." />
                        </div>
                      ) : queryResult?.error ? (
                        <Alert
                          message="执行失败"
                          description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{queryResult.message}</pre>}
                          type="error"
                          showIcon
                          style={{ fontSize: 12 }}
                        />
                      ) : queryResult?.multiple ? (
                        // 多条SQL执行结果 - 用Tab切换
                        <Tabs
                          size="small"
                          tabBarStyle={{ marginBottom: 8 }}
                          items={queryResult.results.map((r: any) => ({
                            key: String(r.index),
                            label: (
                              <span style={{ fontSize: 12 }}>
                                结果 {r.index}
                                <Tag
                                  color={r.success ? 'green' : 'red'}
                                  style={{ marginLeft: 4, fontSize: 10, padding: '0 4px' }}
                                >
                                  {r.success ? r.row_count : '错误'}
                                </Tag>
                              </span>
                            ),
                            children: r.success ? (
                              r.data?.sql_type === 'SELECT' ? (
                                // SELECT 查询结果
                                <>
                                  <Alert
                                    message={`${r.sql}`}
                                    description={`返回 ${r.row_count} 行，耗时 ${r.execution_time_ms}ms`}
                                    type="success"
                                    showIcon
                                    style={{ marginBottom: 8, padding: '4px 12px', fontSize: 12 }}
                                  />
                                  <Table
                                    columns={r.data?.columns?.map((col: string) => ({
                                      title: col,
                                      dataIndex: col,
                                      key: col,
                                      ellipsis: true,
                                      width: 150,
                                    })) || []}
                                    dataSource={r.data?.rows?.map((row: any[], idx: number) => {
                                      const obj: any = { key: idx }
                                      r.data.columns?.forEach((col: string, i: number) => {
                                        obj[col] = row[i]
                                      })
                                      return obj
                                    }) || []}
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
                                // DML/DDL 执行结果
                                <Alert
                                  message={`${r.sql}`}
                                  description={
                                    r.data?.sql_type === 'DDL'
                                      ? `执行成功，耗时 ${r.execution_time_ms}ms`
                                      : `影响 ${r.data?.affected_rows} 行，耗时 ${r.execution_time_ms}ms`
                                  }
                                  type="success"
                                  showIcon
                                  style={{ padding: '8px 12px', fontSize: 12 }}
                                />
                              )
                            ) : (
                              <Alert
                                message={r.sql}
                                description={r.error}
                                type="error"
                                showIcon
                                style={{ fontSize: 12 }}
                              />
                            ),
                          }))}
                        />
                      ) : queryResult ? (
                        queryResult.sql_type === 'SELECT' ? (
                          // SELECT 查询结果 - 显示表格
                          <>
                            <Alert
                              message={`返回 ${queryResult.row_count} 行，耗时 ${queryResult.execution_time_ms}ms`}
                              type="success"
                              showIcon
                              style={{ marginBottom: 8, padding: '4px 12px', fontSize: 12 }}
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
                          // DML/DDL 执行结果 - 显示影响行数
                          <Alert
                            message={
                              queryResult.sql_type === 'DDL'
                                ? '执行成功'
                                : `执行成功，影响 ${queryResult.affected_rows} 行`
                            }
                            description={`耗时 ${queryResult.execution_time_ms}ms`}
                            type="success"
                            showIcon
                            style={{ padding: '12px 16px', fontSize: 13 }}
                          />
                        )
                      ) : (
                        <Empty description="点击「执行」运行SQL查询" />
                      )}
                    </div>
                  ),
                },
                {
                  key: 'structure',
                  label: (
                    <span style={{ fontSize: 12 }}>
                      <DatabaseOutlined /> 结构
                    </span>
                  ),
                  children: (
                    <div style={{ padding: 8, overflow: 'auto', height: '100%' }}>
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
                    <span style={{ fontSize: 12 }}>
                      <EyeOutlined /> 预览
                    </span>
                  ),
                  children: (
                    <div style={{ padding: 8, overflow: 'auto', height: '100%' }}>
                      {selectedTable ? (
                        loadingTableInfo ? (
                          <div style={{ textAlign: 'center', padding: 50 }}>
                            <Spin tip="加载中..." />
                          </div>
                        ) : (
                          <>
                            <Alert
                              message={`显示前 ${tableData.length} 条，共 ${totalRows.toLocaleString()} 条`}
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
            </Splitter.Panel>
          </Splitter>
          </div>
        </Splitter.Panel>
      </Splitter>

      {/* 保存为ETL任务的Modal - 苹果风格 */}
      <Modal
        title={null}
        open={saveEtlModalVisible}
        onCancel={() => {
          setSaveEtlModalVisible(false)
          setParsedDeps([])
          setParsedTables([])
          setManualTableInput('')
          setShowAddTableInput(false)
        }}
        footer={null}
        width={420}
        centered
        styles={{
          content: { borderRadius: 16, padding: 0, overflow: 'hidden' },
          body: { padding: 0 },
        }}
      >
        {/* 头部 */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid #f0f0f0',
          background: 'linear-gradient(to bottom, #fafafa, #fff)',
        }}>
          <Text strong style={{ fontSize: 13 }}>保存为 ETL 任务</Text>
        </div>

        {/* 表单区域 */}
        <div style={{ padding: '16px 20px' }}>
          <Form form={saveEtlForm} layout="vertical" style={{ marginBottom: 0 }}>
            <Form.Item
              name="name"
              rules={[{ required: true, message: '请输入任务名称' }]}
              style={{ marginBottom: 12 }}
            >
              <Input
                placeholder="任务名称"
                style={{ borderRadius: 8, height: 38 }}
              />
            </Form.Item>
            <Form.Item name="description" style={{ marginBottom: 12 }}>
              <Input
                placeholder="描述（可选）"
                style={{ borderRadius: 8, height: 38 }}
              />
            </Form.Item>
            <Form.Item
              name="dw_layer_id"
              rules={[{ required: true, message: '请选择层级' }]}
              style={{ marginBottom: 0 }}
            >
              <Select
                placeholder="选择层级"
                style={{ width: '100%', height: 38 }}
                options={layers
                  .filter((l) => l.level > 1 && l.name.toUpperCase() !== 'ODS')
                  .map((l) => ({
                    value: l.id,
                    label: <Tag color={l.color || 'default'} style={{ margin: 0 }}>{l.name}</Tag>,
                  }))}
              />
            </Form.Item>
          </Form>
        </div>

        {/* 依赖表区域 */}
        <div style={{
          margin: '0 20px 16px',
          padding: 12,
          background: '#f8f8f8',
          borderRadius: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: 12, color: '#666' }}>依赖表</Text>
            <span
              onClick={parsingDeps ? undefined : parseSqlDependencies}
              style={{
                fontSize: 12,
                color: parsingDeps ? '#999' : '#007aff',
                cursor: parsingDeps ? 'default' : 'pointer',
              }}
            >
              {parsingDeps ? <><SyncOutlined spin /> 识别中</> : '重新识别'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {parsedTables.map((t) => (
              <div
                key={t.name}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  padding: '4px 8px 4px 10px',
                  borderRadius: 14,
                  fontSize: 12,
                  background: t.checking ? '#e6f4ff' : t.exists ? '#f6ffed' : '#fff2f0',
                  color: t.checking ? '#1890ff' : t.exists ? '#52c41a' : '#ff4d4f',
                  border: `1px solid ${t.checking ? '#91caff' : t.exists ? '#b7eb8f' : '#ffccc7'}`,
                }}
              >
                {t.checking && <Spin size="small" style={{ marginRight: 4 }} />}
                {t.name}
                {!t.checking && <span style={{ marginLeft: 4 }}>{t.exists ? '✓' : '✗'}</span>}
                <CloseOutlined
                  style={{ marginLeft: 6, fontSize: 10, cursor: 'pointer', opacity: 0.6 }}
                  onClick={() => setParsedTables(prev => prev.filter(p => p.name !== t.name))}
                />
              </div>
            ))}
            {parsedTables.length === 0 && !parsingDeps && (
              <Text type="secondary" style={{ fontSize: 12 }}>无</Text>
            )}
          </div>
          {/* 手动添加 */}
          <div style={{ marginTop: 10 }}>
            {showAddTableInput && (
              <Input
                size="small"
                autoFocus
                placeholder="输入表名，回车添加"
                value={manualTableInput}
                onChange={(e) => setManualTableInput(e.target.value)}
                onPressEnter={() => {
                  if (manualTableInput.trim()) {
                    handleAddTable()
                  }
                }}
                onBlur={() => {
                  if (manualTableInput.trim()) {
                    handleAddTable()
                  }
                  setShowAddTableInput(false)
                }}
                style={{ width: '100%', borderRadius: 8, fontSize: 12, marginBottom: 8 }}
              />
            )}
            <div
              onClick={() => setShowAddTableInput(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 14,
                fontSize: 12,
                color: '#007aff',
                background: '#fff',
                border: '1px dashed #d9d9d9',
                cursor: 'pointer',
              }}
            >
              <PlusOutlined style={{ fontSize: 10 }} /> 添加
            </div>
          </div>

          {/* 匹配到的上游任务（只有未上线的才显示） */}
          {parsedDeps.some(d => !d.is_scheduled) && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e0e0e0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: '#666' }}>匹配到的上游任务</Text>
                {parsedDeps.some(d => !d.is_scheduled) && (
                  <span
                    onClick={() => {
                      // 收集未上线的任务
                      const unscheduled = parsedDeps.filter(d => !d.is_scheduled)
                      const syncIds = unscheduled.filter(d => d.task_type === 'sync').map(d => d.task_id)
                      const etlIds = unscheduled.filter(d => d.task_type === 'etl').map(d => d.task_id)
                      // 构建URL参数
                      const params = new URLSearchParams()
                      params.set('add', '1')
                      if (syncIds.length > 0) params.set('syncIds', syncIds.join(','))
                      if (etlIds.length > 0) params.set('etlIds', etlIds.join(','))
                      // 新窗口打开调度管理
                      window.open(`/scheduler?${params.toString()}`, '_blank')
                    }}
                    style={{
                      fontSize: 11,
                      color: '#d46b08',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    去上线未调度任务 →
                  </span>
                )}
              </div>
              {parsedDeps.some(d => !d.is_scheduled) && (
                <div style={{
                  marginTop: 6,
                  padding: '6px 10px',
                  background: '#fff7e6',
                  border: '1px solid #ffd591',
                  borderRadius: 6,
                  fontSize: 11,
                  color: '#d46b08',
                }}>
                  ⚠️ 有依赖任务尚未上线调度，上线此任务前需先上线它们
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                {parsedDeps.filter(d => !d.is_scheduled).map((dep) => (
                  <div
                    key={`${dep.task_type}-${dep.task_id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      background: '#fff',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {dep.layer_name && (
                        <Tag color={dep.layer_color || 'default'} style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                          {dep.layer_name}
                        </Tag>
                      )}
                      <span style={{ color: '#333' }}>{dep.task_name}</span>
                    </div>
                    <Tag color="orange" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                      未上线
                    </Tag>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          onClick={savingEtl ? undefined : handleSaveEtlSubmit}
          style={{
            padding: '12px 0',
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 500,
            color: '#fff',
            background: savingEtl ? '#ccc' : '#007aff',
            cursor: savingEtl ? 'default' : 'pointer',
            margin: '0 20px 16px',
            borderRadius: 8,
          }}
        >
          {savingEtl ? '保存中...' : '保存'}
        </div>
      </Modal>
    </div>
  )
}
