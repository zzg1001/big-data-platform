import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Card,
  Button,
  Select,
  Space,
  Tag,
  message,
  Typography,
  Spin,
  Empty,
  Modal,
  Tooltip,
  Input,
  Table,
  Popconfirm,
} from 'antd'
import {
  RightOutlined,
  LeftOutlined,
  DatabaseOutlined,
  TableOutlined,
  GoldOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  PlusOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  SettingOutlined,
  SaveOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons'
import { datasourceApi, syncApi, configApi, warehouseApi, aiApi, dwLayerApi } from '../services/api'
import { useFieldTemplateStore } from '../stores/fieldTemplateStore'
import Editor from '@monaco-editor/react'

const { Text } = Typography

interface SyncTaskItem {
  id: number
  name: string
  description?: string
  source_datasource_id: number
  source_table: string
  target_datasource_id?: number | null  // 为空时使用平台数据库配置
  target_table: string
  sync_mode: string
  status: string
  is_scheduled: boolean
  cron_expression?: string
  last_sync_at?: string
  last_sync_rows?: number
  last_error?: string
  dw_layer_id?: number
  dw_layer_name?: string
  dw_layer_color?: string
}

interface DwLayer {
  id: number
  name: string
  display_name: string
  color?: string
  level: number
}

interface ColumnMapping {
  sourceColumn: string
  sourceType: string
  targetColumn: string
  targetType: string
}

interface SelectedTableItem {
  tableName: string
  targetTableName: string
  ddl: string
  ddlStatus: 'generating' | 'success' | 'error'
  ddlError?: string
  createStatus?: 'pending' | 'creating' | 'success' | 'error'
  createError?: string
  syncStatus?: 'pending' | 'syncing' | 'success' | 'error'
  syncError?: string
  syncRows?: number
  columnMappings?: ColumnMapping[]
}

export default function DataSync() {
  // 同步任务列表
  const [syncTasks, setSyncTasks] = useState<SyncTaskItem[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)

  // 数据源
  const [datasources, setDatasources] = useState<any[]>([])
  const [sourceDsId, setSourceDsId] = useState<number | null>(null)
  const [targetDsId, setTargetDsId] = useState<number | null>(null)  // null表示使用平台数据库

  // 平台数据库层级
  const [layers, setLayers] = useState<DwLayer[]>([])

  // 平台数据库配置（从系统配置读取）
  const [warehouseConfig, setWarehouseConfig] = useState<any>(null)
  const [, setLoadingWarehouse] = useState(true)

  // 新增弹窗
  const [addModalVisible, setAddModalVisible] = useState(false)
  const [sourceTables, setSourceTables] = useState<string[]>([])
  const [loadingTables, setLoadingTables] = useState(false)
  const [selectedTables, setSelectedTables] = useState<SelectedTableItem[]>([])
  const [leftSelected, setLeftSelected] = useState<string[]>([])
  const [rightSelected, setRightSelected] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [tasksCreated, setTasksCreated] = useState(false)
  const [selectedLayerId, setSelectedLayerId] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [, setCreatedCount] = useState(0) // 已创建的表数量
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  // DDL 预览弹窗
  const [ddlModalVisible, setDdlModalVisible] = useState(false)
  const [currentDdlTable, setCurrentDdlTable] = useState<string>('')
  const [currentDdl, setCurrentDdl] = useState('')
  const [ddlLoading, setDdlLoading] = useState(false)
  const [executing, setExecuting] = useState(false)

  // 冲突检测
  const [conflictModalVisible, setConflictModalVisible] = useState(false)
  const [conflictTables, setConflictTables] = useState<{tableName: string, targetTableName: string, existingTasks: SyncTaskItem[]}[]>([])
  const [newTables, setNewTables] = useState<{tableName: string, targetTableName: string}[]>([])
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, 'skip' | 'rename' | 'recreate'>>({})
  const [renameValues, setRenameValues] = useState<Record<string, string>>({})

  // 下线提示弹窗
  const [warningVisible, setWarningVisible] = useState(false)
  const [warningTaskId, setWarningTaskId] = useState<number | null>(null)

  // AI 修复日志弹窗
  const [aiFixLogVisible, setAiFixLogVisible] = useState(false)
  const [aiFixLog, setAiFixLog] = useState<{
    tableName: string
    originalDdl: string
    error: string
    fixedDdl: string
    explanation: string
    changes: string[]
    status: 'loading' | 'success' | 'error'
  } | null>(null)

  // 字段映射弹窗
  const [columnMappingVisible, setColumnMappingVisible] = useState(false)
  const [columnMappingTable, setColumnMappingTable] = useState<SelectedTableItem | null>(null)
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([])
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [columnMappingFullscreen, setColumnMappingFullscreen] = useState(false)
  const columnMappingListRef = useRef<HTMLDivElement>(null)

  // 批量加字段弹窗
  const [batchAddFieldVisible, setBatchAddFieldVisible] = useState(false)
  const [batchFields, setBatchFields] = useState<Array<{ name: string; type: string; size: string; templateLabel?: string }>>([
    { name: '', type: 'TIMESTAMP', size: '' }
  ])

  // 全局重置状态
  const [globalResetting, setGlobalResetting] = useState(false)
  const [globalResetProgress, setGlobalResetProgress] = useState({ current: 0, total: 0 })

  // 字段值模板（从共享 Store 获取）
  const { templates: fieldValueTemplates } = useFieldTemplateStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchKeyword, setSearchKeyword] = useState('')

  // 平台数据库是否已配置
  const warehouseConfigured = warehouseConfig?.configured || false

  useEffect(() => {
    loadDatasources()
    loadSyncTasks()
    loadWarehouseConfig()
    loadLayers()
  }, [])

  // 从 URL 参数获取 id 并自动搜索
  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      setSearchKeyword(`id:${id}`)
      // 清除 URL 参数
      setSearchParams({})
    }
  }, [searchParams])

  useEffect(() => {
    if (sourceDsId && addModalVisible) {
      loadSourceTables()
    }
  }, [sourceDsId, addModalVisible])


  const loadDatasources = async () => {
    try {
      const res = await datasourceApi.listAll()
      setDatasources(res.data)
      if (res.data.length > 0) {
        setSourceDsId(res.data[0].id)
      }
    } catch (error) {
      message.error('加载数据源失败')
    }
  }

  const loadWarehouseConfig = async () => {
    setLoadingWarehouse(true)
    try {
      const res = await configApi.getWarehouse()
      setWarehouseConfig(res.data)
    } catch (error) {
      console.error('Failed to load warehouse config')
    } finally {
      setLoadingWarehouse(false)
    }
  }

  const loadSyncTasks = async () => {
    setLoadingTasks(true)
    try {
      const res = await syncApi.list()
      setSyncTasks(res.data)
    } catch (error) {
      message.error('加载同步任务失败')
    } finally {
      setLoadingTasks(false)
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

  const loadSourceTables = async () => {
    if (!sourceDsId) return
    setLoadingTables(true)
    try {
      // 如果是平台数据库（sourceDsId === -1），调用平台数据库 API；否则调用数据源 API
      const res = sourceDsId === -1
        ? await warehouseApi.getTables()
        : await datasourceApi.getTables(sourceDsId)
      setSourceTables(res.data)
    } catch (error) {
      message.error('加载表列表失败')
    } finally {
      setLoadingTables(false)
    }
  }

  // 打开新增弹窗
  const handleOpenAddModal = () => {
    setSelectedTables([])
    setLeftSelected([])
    setRightSelected([])
    setTasksCreated(false)
    setCreatedCount(0)
    setTargetDsId(null)  // 重置目标数据源（null表示使用平台数据库）
    // 默认选择ODS层级（如果存在）
    const odsLayer = layers.find((l) => l.name === 'ODS')
    setSelectedLayerId(odsLayer?.id || (layers.length > 0 ? layers[0].id : null))
    setAddModalVisible(true)
  }

  // 移动到右侧并生成 DDL
  const handleMoveRight = async () => {
    if (leftSelected.length === 0 || !sourceDsId) return

    // 检查冲突
    const conflicts: {tableName: string, targetTableName: string, existingTasks: SyncTaskItem[]}[] = []
    const newOnes: {tableName: string, targetTableName: string}[] = []

    for (const tableName of leftSelected) {
      const targetTableName = generateTargetTableName(tableName)
      const existingTasks = findExistingTasks(tableName)
      if (existingTasks.length > 0) {
        conflicts.push({ tableName, targetTableName, existingTasks })
      } else {
        newOnes.push({ tableName, targetTableName })
      }
    }

    // 如果有冲突，显示冲突处理弹窗
    if (conflicts.length > 0) {
      setConflictTables(conflicts)
      setNewTables(newOnes)
      // 初始化解决方案为 skip
      const resolutions: Record<string, 'skip' | 'rename' | 'recreate'> = {}
      const renames: Record<string, string> = {}
      conflicts.forEach((c) => {
        resolutions[c.tableName] = 'skip'
        // 根据已有任务数量生成新名称后缀
        const suffix = c.existingTasks.length + 1
        renames[c.tableName] = c.targetTableName + '_v' + suffix
      })
      setConflictResolutions(resolutions)
      setRenameValues(renames)
      setConflictModalVisible(true)
      return
    }

    // 没有冲突，直接添加
    await addTablesToSync(newOnes)
  }

  // 添加表到同步列表并生成 DDL
  const addTablesToSync = async (tables: {tableName: string, targetTableName: string, withDrop?: boolean}[]) => {
    if (tables.length === 0) return

    // 创建后不允许添加新表
    if (tasksCreated) {
      message.warning('请先执行同步或关闭弹框重新操作')
      return
    }

    // 先添加到列表，状态为 generating
    const newItems: SelectedTableItem[] = tables.map((t) => ({
      tableName: t.tableName,
      targetTableName: t.targetTableName,
      ddl: '',
      ddlStatus: 'generating' as const,
    }))
    setSelectedTables((prev) => [...prev, ...newItems])
    setLeftSelected([])

    // 为每个表生成 DDL
    for (const table of tables) {
      try {
        const res = await syncApi.generateDdlPreview({
          source_datasource_id: sourceDsId === -1 ? undefined : sourceDsId!,
          source_table: table.tableName,
          target_table: table.targetTableName,
          target_datasource_id: targetDsId,
        })
        // 如果是删除重建，在 DDL 前加 DROP TABLE
        let ddl = res.data.target_ddl
        if (table.withDrop) {
          ddl = `DROP TABLE IF EXISTS ${table.targetTableName};\n\n${ddl}`
        }
        // 从 type_mappings 提取字段映射，确保 DDL 和字段映射一致
        const columnMappings: ColumnMapping[] = (res.data.type_mappings || []).map((m: any) => ({
          sourceColumn: m.column_name,
          sourceType: m.source_type,
          targetColumn: m.column_name,  // 默认目标字段名与源字段名相同
          targetType: m.target_type,
        }))
        // 更新对应表的 DDL 和字段映射
        setSelectedTables((prev) =>
          prev.map((item) =>
            item.tableName === table.tableName
              ? { ...item, ddl, ddlStatus: 'success' as const, columnMappings }
              : item
          )
        )
      } catch (error: any) {
        // 更新为错误状态
        setSelectedTables((prev) =>
          prev.map((item) =>
            item.tableName === table.tableName
              ? {
                  ...item,
                  ddlStatus: 'error' as const,
                  ddlError: error.response?.data?.detail || 'DDL 生成失败',
                }
              : item
          )
        )
      }
    }
  }

  // 处理冲突解决
  const handleConflictResolve = async () => {
    const tablesToAdd: {tableName: string, targetTableName: string, withDrop?: boolean}[] =
      newTables.map(t => ({ ...t, withDrop: false }))
    const tasksToDelete: number[] = []

    for (const conflict of conflictTables) {
      const resolution = conflictResolutions[conflict.tableName]
      if (resolution === 'skip') {
        // 跳过，不添加
        continue
      } else if (resolution === 'rename') {
        // 新增一个目标表（一对多）
        tablesToAdd.push({
          tableName: conflict.tableName,
          targetTableName: renameValues[conflict.tableName],
          withDrop: false,
        })
      } else if (resolution === 'recreate') {
        // 删除所有旧任务，DDL 加上 DROP TABLE
        conflict.existingTasks.forEach(task => tasksToDelete.push(task.id))
        tablesToAdd.push({
          tableName: conflict.tableName,
          targetTableName: conflict.targetTableName,
          withDrop: true,
        })
      }
    }

    // 删除旧任务
    for (const taskId of tasksToDelete) {
      try {
        await syncApi.delete(taskId)
      } catch (error) {
        console.error('删除任务失败:', error)
      }
    }

    // 刷新任务列表
    if (tasksToDelete.length > 0) {
      await loadSyncTasks()
    }

    setConflictModalVisible(false)
    setLeftSelected([])

    // 添加表
    await addTablesToSync(tablesToAdd)
  }

  // 移动到左侧（移除）
  const handleMoveLeft = () => {
    if (rightSelected.length === 0) return
    setSelectedTables(selectedTables.filter((t) => !rightSelected.includes(t.tableName)))
    setRightSelected([])
  }

  // 左侧点击选择
  const handleLeftClick = (table: string) => {
    if (selectedTables.find((t) => t.tableName === table)) return
    if (leftSelected.includes(table)) {
      setLeftSelected(leftSelected.filter((t) => t !== table))
    } else {
      setLeftSelected([...leftSelected, table])
    }
  }

  // 右侧点击选择
  const handleRightClick = (table: string) => {
    if (rightSelected.includes(table)) {
      setRightSelected(rightSelected.filter((t) => t !== table))
    } else {
      setRightSelected([...rightSelected, table])
    }
  }

  // 删除单个
  const handleRemoveTable = (tableName: string) => {
    setSelectedTables(selectedTables.filter((t) => t.tableName !== tableName))
  }

  // 查看/编辑 DDL（在新增弹窗中）
  const [previewDdlSourceTable, setPreviewDdlSourceTable] = useState<string>('')
  const [previewDdlTargetTable, setPreviewDdlTargetTable] = useState<string>('')
  const [previewDdl, setPreviewDdl] = useState<string>('')
  const [previewDdlVisible, setPreviewDdlVisible] = useState(false)

  const handleViewDdl = (item: SelectedTableItem) => {
    setPreviewDdlSourceTable(item.tableName)
    setPreviewDdlTargetTable(item.targetTableName)
    setPreviewDdl(item.ddl)
    setPreviewDdlVisible(true)
  }

  const handleSaveDdl = () => {
    // 保存编辑后的 DDL
    setSelectedTables((prev) =>
      prev.map((item) =>
        item.tableName === previewDdlSourceTable ? { ...item, ddl: previewDdl } : item
      )
    )
    setPreviewDdlVisible(false)
    message.success('DDL 已保存')
  }

  // 打开字段映射弹窗
  const handleOpenColumnMapping = async (item: SelectedTableItem) => {
    if (!sourceDsId) {
      message.warning('请先选择数据源')
      return
    }

    setColumnMappingTable(item)
    setLoadingColumns(true)
    setColumnMappingVisible(true)

    let finalMappings: ColumnMapping[] = []

    // 获取源库和目标库类型
    const sourceDbType = sourceDs?.type?.toLowerCase() || 'mysql'
    const targetDbType = warehouseConfig?.type?.toLowerCase() || 'mysql'

    try {
      // 1. 优先使用 selectedTables 中已有的映射（上次保存的映射）
      if (item.columnMappings && item.columnMappings.length > 0) {
        finalMappings = item.columnMappings
        message.success(`已加载 ${finalMappings.length} 个字段映射`)
        setColumnMappings(finalMappings)
        setLoadingColumns(false)
        return
      }

      // 2. 尝试从数据库加载已保存的映射
      try {
        const savedRes = await syncApi.getColumnMappings(sourceDsId, item.tableName, item.targetTableName)
        if (savedRes.data.mappings && savedRes.data.mappings.length > 0) {
          finalMappings = savedRes.data.mappings.map((m: any) => ({
            sourceColumn: m.source_column,
            sourceType: m.source_type,
            targetColumn: m.target_column,
            targetType: m.target_type,
          }))
          message.success(`已加载保存的 ${finalMappings.length} 个字段映射`)
          setColumnMappings(finalMappings)
          setLoadingColumns(false)
          return // 已有保存的映射，直接返回
        }
      } catch (e) {
        // 没有保存的映射，继续从数据库获取
        console.log('没有已保存的映射，从源表获取')
      }

      // 3. 获取源表字段
      const res = await syncApi.getTableColumns(sourceDsId, item.tableName)
      const sourceColumns = res.data

      if (Array.isArray(sourceColumns) && sourceColumns.length > 0) {
        // 判断源库和目标库类型是否相同
        if (sourceDbType === targetDbType) {
          // 类型相同，直接复制字段和类型
          finalMappings = sourceColumns.map((col: any) => ({
            sourceColumn: col.name || 'unknown',
            sourceType: col.data_type || 'unknown',
            targetColumn: col.name || 'unknown',
            targetType: col.data_type || 'unknown',
          }))
          message.info('源库和目标库类型相同，字段和类型直接复制')
        } else {
          // 类型不同，调用AI转换
          try {
            const convertRes = await aiApi.convertColumnTypes({
              columns: sourceColumns.map((col: any) => ({
                name: col.name,
                data_type: col.data_type,
              })),
              source_db_type: sourceDbType,
              target_db_type: targetDbType,
            })
            if (convertRes.data.mappings && convertRes.data.mappings.length > 0) {
              finalMappings = convertRes.data.mappings.map((m: any) => ({
                sourceColumn: m.source_column,
                sourceType: m.source_type,
                targetColumn: m.target_column,
                targetType: m.target_type,
              }))
              if (convertRes.data.explanation) {
                message.success(convertRes.data.explanation)
              }
            }
          } catch (convertError) {
            console.error('AI转换失败，使用默认规则:', convertError)
            // AI失败时使用本地转换规则
            finalMappings = sourceColumns.map((col: any) => ({
              sourceColumn: col.name || 'unknown',
              sourceType: col.data_type || 'unknown',
              targetColumn: col.name || 'unknown',
              targetType: convertToTargetType(col.data_type || 'unknown', targetDbType),
            }))
            message.warning('AI转换失败，使用默认转换规则')
          }
        }
      } else {
        // 4. 备用方案：从已有 DDL 解析字段
        if (item.ddl && item.ddlStatus === 'success') {
          const ddlFields = parseDdlFields(item.ddl)
          if (ddlFields.length > 0) {
            finalMappings = ddlFields
            message.info(`从 DDL 恢复了 ${ddlFields.length} 个字段`)
          } else {
            message.warning('未获取到字段信息')
          }
        } else {
          message.warning('未获取到字段信息')
        }
      }
    } catch (error: any) {
      const errDetail = error.response?.data?.detail || error.message || '未知错误'
      const errStatus = error.response?.status || ''
      console.error('获取字段信息失败:', { status: errStatus, detail: errDetail, error })
      // 弹窗显示详细错误
      Modal.error({
        title: '获取字段信息失败',
        content: (
          <div>
            <p><strong>数据源 ID:</strong> {sourceDsId}</p>
            <p><strong>表名:</strong> {item.tableName}</p>
            <p><strong>错误码:</strong> {errStatus}</p>
            <p><strong>错误详情:</strong> {errDetail}</p>
          </div>
        ),
        okText: '确定',
      })
    }

    // 统一在最后设置状态
    setColumnMappings(finalMappings)
    setLoadingColumns(false)
  }

  // 从 DDL 解析字段（备用方案）
  const parseDdlFields = (ddl: string): ColumnMapping[] => {
    const mappings: ColumnMapping[] = []
    try {
      // 匹配 CREATE TABLE ... ( ... )
      const match = ddl.match(/CREATE\s+TABLE[^(]*\(([\s\S]*)\)/i)
      if (!match) return []

      const columnsStr = match[1]
      // 按逗号分割，但要注意类型中的逗号如 DECIMAL(10,2)
      const lines = columnsStr.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--'))

      lines.forEach(line => {
        // 移除末尾的逗号
        const cleanLine = line.replace(/,\s*$/, '').trim()
        if (!cleanLine) return

        // 匹配字段名和类型，如 "  field_name VARCHAR(255)"
        const fieldMatch = cleanLine.match(/^\s*(\w+)\s+(\S+.*)$/i)
        if (fieldMatch) {
          const fieldName = fieldMatch[1]
          const fieldType = fieldMatch[2].trim()
          mappings.push({
            sourceColumn: '',
            sourceType: '-',
            targetColumn: fieldName,
            targetType: fieldType,
          })
        }
      })
    } catch (e) {
      console.error('解析 DDL 失败:', e)
    }
    return mappings
  }

  // 类型转换（根据目标数据库类型）
  const convertToTargetType = (sourceType: string, targetDbType: string = 'hive'): string => {
    const type = sourceType.toLowerCase()
    const target = targetDbType.toLowerCase()

    // Hive/Spark 类型
    if (target === 'hive' || target === 'spark') {
      if (type.includes('int')) return 'BIGINT'
      if (type.includes('varchar') || type.includes('char') || type.includes('text')) return 'STRING'
      if (type.includes('decimal') || type.includes('numeric')) return 'DECIMAL(38,10)'
      if (type.includes('float') || type.includes('double')) return 'DOUBLE'
      if (type.includes('date') && !type.includes('time')) return 'DATE'
      if (type.includes('time') || type.includes('timestamp')) return 'TIMESTAMP'
      if (type.includes('bool')) return 'BOOLEAN'
      return 'STRING'
    }

    // Doris/StarRocks 类型
    if (target === 'doris' || target === 'starrocks') {
      if (type.includes('bigint')) return 'BIGINT'
      if (type.includes('int')) return 'INT'
      if (type.includes('varchar')) return 'VARCHAR(65533)'
      if (type.includes('char') || type.includes('text')) return 'STRING'
      if (type.includes('decimal') || type.includes('numeric')) return 'DECIMAL(38,10)'
      if (type.includes('float')) return 'FLOAT'
      if (type.includes('double')) return 'DOUBLE'
      if (type.includes('date') && !type.includes('time')) return 'DATE'
      if (type.includes('time') || type.includes('timestamp')) return 'DATETIME'
      if (type.includes('bool')) return 'BOOLEAN'
      return 'STRING'
    }

    // MySQL 类型（默认）
    if (type.includes('int')) return 'BIGINT'
    if (type.includes('varchar')) return type.toUpperCase()
    if (type.includes('char') || type.includes('text')) return 'TEXT'
    if (type.includes('decimal') || type.includes('numeric')) return 'DECIMAL(38,10)'
    if (type.includes('float') || type.includes('double')) return 'DOUBLE'
    if (type.includes('date') && !type.includes('time')) return 'DATE'
    if (type.includes('time') || type.includes('timestamp')) return 'DATETIME'
    if (type.includes('bool')) return 'TINYINT(1)'
    return sourceType
  }

  // 添加新字段（目标表新增字段）
  const handleAddTargetColumn = () => {
    const newMapping: ColumnMapping = {
      sourceColumn: '',
      sourceType: '-',
      targetColumn: `new_column_${columnMappings.length + 1}`,
      targetType: 'STRING',
    }
    setColumnMappings([...columnMappings, newMapping])
    // 滚动到底部
    setTimeout(() => {
      columnMappingListRef.current?.scrollTo({
        top: columnMappingListRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }, 50)
  }

  // 批量添加字段到所有表
  const handleBatchAddField = () => {
    // 过滤有效字段
    const validFields = batchFields.filter(f => f.name.trim())
    if (validFields.length === 0) {
      message.warning('请至少添加一个字段')
      return
    }

    // 检查有多少表可以添加（有 DDL 的表）
    const tablesToUpdate = selectedTables.filter(t => t.ddlStatus === 'success')
    if (tablesToUpdate.length === 0) {
      message.warning('没有可更新的表，请先生成 DDL')
      return
    }

    let totalAdded = 0

    // 给每个表添加字段并更新 DDL
    setSelectedTables(prev => prev.map(item => {
      if (item.ddlStatus !== 'success') return item

      const existingMappings = item.columnMappings || []
      const newMappings: ColumnMapping[] = []

      // 添加每个新字段
      validFields.forEach(field => {
        const fieldName = field.name.trim()
        // 检查字段是否已存在
        if (!existingMappings.some(m => m.targetColumn.toLowerCase() === fieldName.toLowerCase()) &&
            !newMappings.some(m => m.targetColumn.toLowerCase() === fieldName.toLowerCase())) {
          // 构建完整类型（带大小）
          const fullType = field.size ? `${field.type}(${field.size})` : field.type

          // 如果有模板，使用模板的表达式
          const template = field.templateLabel ? fieldValueTemplates.find(t => t.label === field.templateLabel) : null

          newMappings.push({
            sourceColumn: template ? `{{${template.label}}}` : '',
            sourceType: template ? template.expression : '-',
            targetColumn: fieldName,
            targetType: fullType,
          })
        }
      })

      if (newMappings.length === 0) return item

      totalAdded += newMappings.length
      const updatedMappings = [...existingMappings, ...newMappings]

      // 重新生成 DDL
      const columns = updatedMappings
        .filter(m => m.targetColumn)
        .map(m => `  ${m.targetColumn} ${m.targetType}`)
        .join(',\n')
      const newDdl = `CREATE TABLE IF NOT EXISTS ${item.targetTableName} (\n${columns}\n);`

      return {
        ...item,
        columnMappings: updatedMappings,
        ddl: newDdl,
      }
    }))

    message.success(`已为 ${tablesToUpdate.length} 个表添加 ${validFields.length} 个字段`)
    setBatchAddFieldVisible(false)
    setBatchFields([{ name: '', type: 'TIMESTAMP', size: '' }])
  }

  // 全局重置所有表的字段映射（恢复到源表原始状态，使用和初始化相同的逻辑）
  const handleGlobalReset = async () => {
    if (!sourceDsId) {
      message.warning('请先选择数据源')
      return
    }

    const tablesToReset = selectedTables.filter(t => t.ddlStatus === 'success')
    if (tablesToReset.length === 0) {
      message.warning('没有可重置的表')
      return
    }

    setGlobalResetting(true)
    setGlobalResetProgress({ current: 0, total: tablesToReset.length })

    let successCount = 0
    let failCount = 0

    // 逐个重置，使用和初始化相同的 API
    for (let i = 0; i < tablesToReset.length; i++) {
      const item = tablesToReset[i]
      setGlobalResetProgress({ current: i + 1, total: tablesToReset.length })

      try {
        // 调用和初始化相同的 API
        const res = await syncApi.generateDdlPreview({
          source_datasource_id: sourceDsId === -1 ? undefined : sourceDsId!,
          source_table: item.tableName,
          target_table: item.targetTableName,
          target_datasource_id: targetDsId,
        })

        const ddl = res.data.target_ddl
        const newMappings: ColumnMapping[] = (res.data.type_mappings || []).map((m: any) => ({
          sourceColumn: m.column_name,
          sourceType: m.source_type,
          targetColumn: m.column_name,
          targetType: m.target_type,
        }))

        // 更新表数据
        setSelectedTables(prev => prev.map(t =>
          t.tableName === item.tableName
            ? { ...t, ddl, ddlStatus: 'success' as const, columnMappings: newMappings }
            : t
        ))

        // 如果当前正在查看这个表，同步更新弹窗
        if (columnMappingTable?.tableName === item.tableName) {
          setColumnMappings(newMappings)
          setColumnMappingTable(prev => prev ? { ...prev, ddl, columnMappings: newMappings } : prev)
        }

        successCount++
      } catch (error: any) {
        console.error(`重置表 ${item.tableName} 失败:`, error)
        failCount++
      }
    }

    setGlobalResetting(false)
    if (failCount > 0) {
      message.warning(`重置完成：${successCount} 个成功，${failCount} 个失败`)
    } else {
      message.success(`已重置 ${successCount} 个表`)
    }
  }

  // 单个表重置字段映射（使用和初始化相同的逻辑）
  const handleResetColumnMapping = async () => {
    if (!columnMappingTable || !sourceDsId) return

    setLoadingColumns(true)

    try {
      // 调用和初始化相同的 API
      const res = await syncApi.generateDdlPreview({
        source_datasource_id: sourceDsId === -1 ? undefined : sourceDsId!,
        source_table: columnMappingTable.tableName,
        target_table: columnMappingTable.targetTableName,
        target_datasource_id: targetDsId,
      })

      const ddl = res.data.target_ddl
      const newMappings: ColumnMapping[] = (res.data.type_mappings || []).map((m: any) => ({
        sourceColumn: m.column_name,
        sourceType: m.source_type,
        targetColumn: m.column_name,
        targetType: m.target_type,
      }))

      // 更新弹窗数据
      setColumnMappings(newMappings)

      // 同步更新 selectedTables
      setSelectedTables(prev => prev.map(t =>
        t.tableName === columnMappingTable.tableName
          ? { ...t, ddl, ddlStatus: 'success' as const, columnMappings: newMappings }
          : t
      ))

      // 同步更新 columnMappingTable
      setColumnMappingTable(prev => prev ? { ...prev, ddl, columnMappings: newMappings } : prev)

      message.success(`已重置 ${newMappings.length} 个字段`)
    } catch (error: any) {
      console.error('重置失败:', error)
      message.error('重置失败: ' + (error.response?.data?.detail || error.message || '未知错误'))
    } finally {
      setLoadingColumns(false)
    }
  }

  // 删除字段映射
  const handleDeleteColumnMapping = (index: number) => {
    setColumnMappings((prev) => prev.filter((_, i) => i !== index))
  }

  // 更新目标字段名
  const handleUpdateTargetColumn = (index: number, newName: string) => {
    setColumnMappings((prev) =>
      prev.map((m, i) => (i === index ? { ...m, targetColumn: newName } : m))
    )
  }

  // 更新目标字段类型
  const handleUpdateTargetType = (index: number, newType: string) => {
    setColumnMappings((prev) =>
      prev.map((m, i) => (i === index ? { ...m, targetType: newType } : m))
    )
  }

  // 保存字段映射并重新生成 DDL
  const handleSaveColumnMapping = async () => {
    if (!columnMappingTable || !sourceDsId) return

    // 1. 保存到数据库
    try {
      await syncApi.saveColumnMappings({
        source_datasource_id: sourceDsId === -1 ? undefined : sourceDsId!,
        source_table: columnMappingTable.tableName,
        target_table: columnMappingTable.targetTableName,
        mappings: columnMappings.map((m) => ({
          source_column: m.sourceColumn,
          source_type: m.sourceType,
          target_column: m.targetColumn,
          target_type: m.targetType,
          is_new_column: !m.sourceColumn || m.sourceColumn === '',
        })),
      })
    } catch (error: any) {
      console.error('保存映射到数据库失败:', error)
      message.warning('映射保存到本地，但未能持久化到数据库')
    }

    // 2. 将映射保存到 selectedTables（内存）
    setSelectedTables((prev) =>
      prev.map((item) =>
        item.tableName === columnMappingTable.tableName
          ? { ...item, columnMappings }
          : item
      )
    )

    // 3. 根据映射重新生成 DDL
    const targetTable = columnMappingTable.targetTableName
    const columns = columnMappings
      .filter((m) => m.targetColumn) // 过滤掉空的目标字段
      .map((m) => `  ${m.targetColumn} ${m.targetType}`)
      .join(',\n')
    const newDdl = `CREATE TABLE IF NOT EXISTS ${targetTable} (\n${columns}\n);`

    setSelectedTables((prev) =>
      prev.map((item) =>
        item.tableName === columnMappingTable.tableName
          ? { ...item, ddl: newDdl, ddlStatus: 'success' as const }
          : item
      )
    )

    setColumnMappingVisible(false)
    message.success('字段映射已保存并更新 DDL')
  }

  // 重新生成单个表的 DDL
  const handleRegenerateDdl = async (tableName: string) => {
    if (!sourceDsId) return

    const item = selectedTables.find((t) => t.tableName === tableName)
    if (!item) return

    setSelectedTables((prev) =>
      prev.map((t) =>
        t.tableName === tableName
          ? { ...t, ddlStatus: 'generating' as const, ddlError: undefined }
          : t
      )
    )

    try {
      const res = await syncApi.generateDdlPreview({
        source_datasource_id: sourceDsId === -1 ? undefined : sourceDsId!,
        source_table: tableName,
        target_table: item.targetTableName,
        target_datasource_id: targetDsId,
      })
      setSelectedTables((prev) =>
        prev.map((t) =>
          t.tableName === tableName
            ? { ...t, ddl: res.data.target_ddl, ddlStatus: 'success' as const }
            : t
        )
      )
    } catch (error: any) {
      setSelectedTables((prev) =>
        prev.map((t) =>
          t.tableName === tableName
            ? {
                ...t,
                ddlStatus: 'error' as const,
                ddlError: error.response?.data?.detail || 'DDL 生成失败',
              }
            : t
        )
      )
    }
  }

  // 单独同步一个表
  const handleSyncSingle = async (item: SelectedTableItem) => {
    const task = syncTasks.find((t) => t.target_table === item.targetTableName)
    if (!task) {
      message.error('未找到同步任务')
      return
    }

    // 设置为同步中
    setSelectedTables((prev) =>
      prev.map((t) =>
        t.tableName === item.tableName
          ? { ...t, syncStatus: 'syncing' as const, syncError: undefined }
          : t
      )
    )

    try {
      // 先尝试清空目标表数据
      try {
        const truncateSql = `TRUNCATE TABLE ${item.targetTableName}`
        await syncApi.executeDdlOnWarehouse(truncateSql, targetDsId)
      } catch (truncateError) {
        console.log(`TRUNCATE跳过 (${item.targetTableName})`)
      }

      // 执行同步
      const res = await syncApi.execute(task.id)
      if (res.data.status === 'success') {
        // 测试读取
        try {
          const testSql = `SELECT * FROM ${item.targetTableName} LIMIT 10`
          const testRes = await warehouseApi.executeQuery({ sql: testSql, limit: 10 })
          const testRowCount = testRes.data?.rows?.length || 0
          setSelectedTables((prev) =>
            prev.map((t) =>
              t.tableName === item.tableName
                ? { ...t, syncStatus: 'success' as const, syncRows: testRowCount }
                : t
            )
          )
          message.success(`${item.tableName} 同步成功`)
        } catch (testError) {
          setSelectedTables((prev) =>
            prev.map((t) =>
              t.tableName === item.tableName
                ? { ...t, syncStatus: 'error' as const, syncError: '验证失败' }
                : t
            )
          )
        }
      } else {
        throw new Error(res.data.error_message || '同步失败')
      }
    } catch (error: any) {
      const errMsg = error.response?.data?.detail || error.message || '同步异常'
      setSelectedTables((prev) =>
        prev.map((t) =>
          t.tableName === item.tableName
            ? { ...t, syncStatus: 'error' as const, syncError: errMsg }
            : t
        )
      )
      message.error(`${item.tableName}: ${errMsg}`)
    }

    loadSyncTasks()
  }

  // 单独创建一个表
  const handleCreateSingle = async (item: SelectedTableItem) => {
    if (!sourceDsId || !item.ddl) return

    // 设置为创建中
    setSelectedTables((prev) =>
      prev.map((t) =>
        t.tableName === item.tableName
          ? { ...t, createStatus: 'creating' as const, createError: undefined }
          : t
      )
    )

    try {
      // 执行 DDL 建表
      const ddlRes = await syncApi.executeDdlOnWarehouse(item.ddl, targetDsId)
      if (!ddlRes.data.success) {
        throw new Error(ddlRes.data.message || 'DDL执行失败')
      }

      // 创建同步任务（sourceDsId为-1时表示平台数据库，发送null）
      await syncApi.create({
        name: `Sync_${item.targetTableName}`,
        description: `${item.tableName} → ${item.targetTableName}`,
        source_datasource_id: sourceDsId === -1 ? null : sourceDsId,
        source_table: item.tableName,
        target_datasource_id: targetDsId,  // null表示使用平台数据库
        target_table: item.targetTableName,
        sync_mode: 'full',
        is_scheduled: false,
        dw_layer_id: selectedLayerId,
      })

      // 成功
      setSelectedTables((prev) =>
        prev.map((t) =>
          t.tableName === item.tableName ? { ...t, createStatus: 'success' as const } : t
        )
      )
      message.success(`${item.tableName} 创建成功`)
      loadSyncTasks()

      // 检查是否全部创建完成
      const allCreated = selectedTables.every(
        (t) => t.tableName === item.tableName || t.createStatus === 'success'
      )
      if (allCreated) {
        setTasksCreated(true)
      }
    } catch (error: any) {
      const errMsg = error.response?.data?.detail || error.message || '创建失败'
      setSelectedTables((prev) =>
        prev.map((t) =>
          t.tableName === item.tableName
            ? { ...t, createStatus: 'error' as const, createError: errMsg }
            : t
        )
      )
      message.error(`${item.tableName}: ${errMsg}`)
    }
  }

  // AI 修复 DDL（只修复DDL，不自动创建任务）
  const handleAiFixDdl = async (item: SelectedTableItem) => {
    if (!item.ddl || !item.createError) return

    // 打开日志弹窗，显示加载状态
    setAiFixLog({
      tableName: item.tableName,
      originalDdl: item.ddl,
      error: item.createError,
      fixedDdl: '',
      explanation: '',
      changes: [],
      status: 'loading',
    })
    setAiFixLogVisible(true)

    // 设置为修复中状态
    setSelectedTables((prev) =>
      prev.map((t) =>
        t.tableName === item.tableName
          ? { ...t, createStatus: 'creating' as const, createError: undefined }
          : t
      )
    )

    try {
      // 调用 AI 修复 DDL
      const targetDbType = warehouseConfig?.type || 'mysql'
      const res = await aiApi.fixDdl({
        ddl: item.ddl,
        error: item.createError || '未知错误',
        target_db_type: targetDbType,
      })

      const fixedDdl = res.data.fixed_ddl
      if (!fixedDdl) {
        throw new Error('AI 未能生成修复的 DDL')
      }

      // 更新日志
      setAiFixLog({
        tableName: item.tableName,
        originalDdl: item.ddl,
        error: item.createError,
        fixedDdl: fixedDdl,
        explanation: res.data.explanation || '',
        changes: res.data.changes || [],
        status: 'success',
      })

      message.success(`${item.tableName} DDL 已修复，请点击创建按钮`)

      // 更新 DDL，重置状态为未创建（让用户自己点创建）
      setSelectedTables((prev) =>
        prev.map((t) =>
          t.tableName === item.tableName
            ? { ...t, ddl: fixedDdl, createStatus: undefined, createError: undefined }
            : t
        )
      )
    } catch (error: any) {
      const errMsg = error.response?.data?.detail || error.message || 'AI 修复失败'
      setAiFixLog((prev) =>
        prev ? { ...prev, status: 'error', explanation: errMsg } : null
      )
      message.error(errMsg)
      setSelectedTables((prev) =>
        prev.map((t) =>
          t.tableName === item.tableName
            ? { ...t, createStatus: 'error' as const, createError: errMsg }
            : t
        )
      )
    }
  }

  // 确认创建同步任务（先执行 DDL 建表，再创建同步任务）
  const handleConfirmCreate = async () => {
    if (!sourceDsId) {
      message.warning('请选择源数据库')
      return
    }
    if (!warehouseConfigured) {
      message.warning('请先在「系统管理」中配置目标平台数据库')
      return
    }
    if (selectedTables.length === 0) {
      message.warning('请选择要同步的表')
      return
    }

    // 检查是否有 DDL 生成中或失败的
    const generating = selectedTables.filter((t) => t.ddlStatus === 'generating')
    if (generating.length > 0) {
      message.warning('部分表的 DDL 正在生成中，请稍候')
      return
    }

    const failed = selectedTables.filter((t) => t.ddlStatus === 'error')
    if (failed.length > 0) {
      message.warning(`${failed.length} 个表的 DDL 生成失败，请检查后重试`)
      return
    }

    setCreating(true)
    let taskSuccessCount = 0
    let taskFailCount = 0

    // 过滤出未创建的表
    const tablesToCreate = selectedTables.filter((t) => t.createStatus !== 'success')

    if (tablesToCreate.length === 0) {
      message.info('所有表已创建完成')
      setCreating(false)
      setTasksCreated(true)
      return
    }

    // 初始化未创建的表为 pending 状态
    setSelectedTables((prev) =>
      prev.map((t) =>
        t.createStatus !== 'success'
          ? { ...t, createStatus: 'pending' as const, createError: undefined }
          : t
      )
    )

    // 逐个执行：DDL建表 + 创建任务（跳过已创建的）
    for (const table of tablesToCreate) {
      // 设置为创建中
      setSelectedTables((prev) =>
        prev.map((t) =>
          t.tableName === table.tableName ? { ...t, createStatus: 'creating' as const } : t
        )
      )

      try {
        // 第一步：执行 DDL 建表
        if (!table.ddl) {
          throw new Error('DDL 为空')
        }
        const ddlRes = await syncApi.executeDdlOnWarehouse(table.ddl, targetDsId)
        if (!ddlRes.data.success) {
          throw new Error(ddlRes.data.message || 'DDL执行失败')
        }

        // 第二步：创建同步任务（sourceDsId为-1时表示平台数据库，发送null）
        await syncApi.create({
          name: `Sync_${table.targetTableName}`,
          description: `${table.tableName} → ${table.targetTableName}`,
          source_datasource_id: sourceDsId === -1 ? null : sourceDsId,
          source_table: table.tableName,
          target_table: table.targetTableName,
          sync_mode: 'full',
          is_scheduled: false,
          dw_layer_id: selectedLayerId,
          target_datasource_id: targetDsId,
        })

        // 成功
        setSelectedTables((prev) =>
          prev.map((t) =>
            t.tableName === table.tableName ? { ...t, createStatus: 'success' as const } : t
          )
        )
        taskSuccessCount++
      } catch (error: any) {
        // 失败
        const errMsg = error.response?.data?.detail || error.message || '创建失败'
        setSelectedTables((prev) =>
          prev.map((t) =>
            t.tableName === table.tableName
              ? { ...t, createStatus: 'error' as const, createError: errMsg }
              : t
          )
        )
        taskFailCount++
      }
    }

    setCreating(false)

    // 显示结果
    if (taskSuccessCount > 0) {
      // 只要有任务创建成功，就切换到同步模式
      setTasksCreated(true)
      setCreatedCount(selectedTables.length)
      loadSyncTasks()
      loadSourceTables()

      if (taskFailCount === 0) {
        message.success('全部创建成功，可执行同步')
      } else {
        message.success(`创建成功 ${taskSuccessCount} 个，失败 ${taskFailCount} 个`)
      }
    } else if (taskFailCount > 0) {
      message.error(`创建失败 ${taskFailCount} 个`)
    }
    // 不自动关闭弹框，让用户查看测试结果
  }

  // 执行同步并测试
  const handleSyncAndTest = async () => {
    setSyncing(true)

    // 过滤出需要同步的表（跳过已成功的）
    const tablesToSync = selectedTables.filter((t) => t.syncStatus !== 'success')

    if (tablesToSync.length === 0) {
      message.info('所有表已同步完成')
      setSyncing(false)
      return
    }

    // 初始化需要同步的表为 pending 状态
    setSelectedTables((prev) =>
      prev.map((t) =>
        t.syncStatus !== 'success'
          ? { ...t, syncStatus: 'pending' as const, syncError: undefined, syncRows: undefined }
          : t
      )
    )

    // 获取任务列表
    const latestTasks = syncTasks.filter((t) =>
      tablesToSync.some((st) => st.targetTableName === t.target_table)
    )

    // 逐个执行同步（跳过已成功的）
    for (const table of tablesToSync) {
      const task = latestTasks.find((t) => t.target_table === table.targetTableName)
      if (!task) {
        setSelectedTables((prev) =>
          prev.map((t) =>
            t.tableName === table.tableName
              ? { ...t, syncStatus: 'error' as const, syncError: '未找到同步任务' }
              : t
          )
        )
        continue
      }

      // 设置为同步中
      setSelectedTables((prev) =>
        prev.map((t) =>
          t.tableName === table.tableName ? { ...t, syncStatus: 'syncing' as const } : t
        )
      )

      try {
        // 先尝试清空目标表数据（表不存在则跳过）
        try {
          const truncateSql = `TRUNCATE TABLE ${table.targetTableName}`
          await syncApi.executeDdlOnWarehouse(truncateSql, targetDsId)
        } catch (truncateError) {
          console.log(`TRUNCATE跳过 (${table.targetTableName}): 表可能不存在`)
        }

        // 执行同步
        const res = await syncApi.execute(task.id)
        if (res.data.status === 'success') {
          // 同步成功，测试读取10条数据
          try {
            const testSql = `SELECT * FROM ${table.targetTableName} LIMIT 10`
            const testRes = await warehouseApi.executeQuery({ sql: testSql, limit: 10 })
            const testRowCount = testRes.data?.rows?.length || 0
            setSelectedTables((prev) =>
              prev.map((t) =>
                t.tableName === table.tableName
                  ? { ...t, syncStatus: 'success' as const, syncRows: testRowCount }
                  : t
              )
            )
          } catch (testError) {
            setSelectedTables((prev) =>
              prev.map((t) =>
                t.tableName === table.tableName
                  ? { ...t, syncStatus: 'error' as const, syncError: '验证失败' }
                  : t
              )
            )
          }
        } else {
          setSelectedTables((prev) =>
            prev.map((t) =>
              t.tableName === table.tableName
                ? { ...t, syncStatus: 'error' as const, syncError: res.data.error_message || '同步失败' }
                : t
            )
          )
        }
      } catch (error: any) {
        setSelectedTables((prev) =>
          prev.map((t) =>
            t.tableName === table.tableName
              ? { ...t, syncStatus: 'error' as const, syncError: error.response?.data?.detail || '同步异常' }
              : t
          )
        )
      }
    }

    setSyncing(false)
    loadSyncTasks()

    // 统计结果
    const successCount = selectedTables.filter((t) => t.syncStatus === 'success').length
    const failCount = selectedTables.filter((t) => t.syncStatus === 'error').length
    if (failCount === 0) {
      message.success('全部同步完成')
    } else {
      message.warning(`${successCount} 成功，${failCount} 失败`)
    }
  }

  // 删除同步任务（同时删除平台数据库表）
  const handleDeleteTask = async (task: SyncTaskItem) => {
    // 前端判断：如果有调度引用，直接弹框提示
    if (task.is_scheduled) {
      setWarningTaskId(task.id)
      setWarningVisible(true)
      return
    }
    try {
      await syncApi.delete(task.id)
      // 成功后删除平台数据库中的表
      try {
        const dropDdl = `DROP TABLE IF EXISTS ${task.target_table}`
        await syncApi.executeDdlOnWarehouse(dropDdl, task.target_datasource_id)
      } catch {
        // 删除表失败不影响主流程
      }
      message.success('任务已删除')
      loadSyncTasks()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    }
  }

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedTaskIds.length === 0) return

    const tasksToDelete = syncTasks.filter((t) => selectedTaskIds.includes(t.id))
    const scheduledTasks = tasksToDelete.filter((t) => t.is_scheduled)
    const deletableTasks = tasksToDelete.filter((t) => !t.is_scheduled)

    // 如果有已调度的任务，弹框提示并支持跳转
    if (scheduledTasks.length > 0 && deletableTasks.length === 0) {
      Modal.confirm({
        title: '请先下线再删除',
        content: `选中的 ${scheduledTasks.length} 个任务均已调度`,
        okText: '去下线',
        cancelText: '取消',
        onOk: () => {
          // 跳转到调度管理，带上sync_id参数
          const ids = scheduledTasks.map(t => t.id).join(',')
          navigate(`/scheduler?sync_ids=${ids}`)
        },
      })
      return
    }

    setBatchDeleting(true)
    let success = 0
    let fail = 0

    for (const task of deletableTasks) {
      try {
        await syncApi.delete(task.id)
        try {
          const dropDdl = `DROP TABLE IF EXISTS ${task.target_table}`
          await syncApi.executeDdlOnWarehouse(dropDdl, task.target_datasource_id)
        } catch {
          // 删除表失败不影响主流程
        }
        success++
      } catch {
        fail++
      }
    }

    setBatchDeleting(false)
    setSelectedTaskIds([])
    loadSyncTasks()

    if (scheduledTasks.length > 0) {
      message.warning(`已删除 ${success} 个，${scheduledTasks.length} 个需先下线`)
    } else if (fail === 0) {
      message.success(`已删除 ${success} 个任务`)
    } else {
      message.warning(`成功 ${success} 个，失败 ${fail} 个`)
    }
    loadSyncTasks()
  }

  // 执行同步
  const handleExecuteTask = async (task: SyncTaskItem) => {
    try {
      message.loading({ content: `正在同步 ${task.source_table}...`, key: `sync_${task.id}` })
      const res = await syncApi.execute(task.id)
      if (res.data.status === 'success') {
        message.success({ content: `同步完成: ${res.data.rows_written} 行`, key: `sync_${task.id}` })
      } else {
        message.error({ content: res.data.error_message || '同步失败', key: `sync_${task.id}` })
      }
      loadSyncTasks()
    } catch (error: any) {
      message.error({ content: error.response?.data?.detail || '同步失败', key: `sync_${task.id}` })
    }
  }

  // AI 生成 DDL（使用 sync API，会自动读取平台数据库配置）
  const [, setCurrentDdlTaskId] = useState<number | null>(null)

  const handleShowDdl = async (task: SyncTaskItem) => {
    setCurrentDdlTable(task.source_table)
    setCurrentDdlTaskId(task.id)
    setDdlModalVisible(true)
    setDdlLoading(true)
    setCurrentDdl('')

    try {
      const res = await syncApi.generateDdlAi(task.id)
      setCurrentDdl(res.data.target_ddl)
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'DDL 生成失败')
    } finally {
      setDdlLoading(false)
    }
  }

  // 执行 DDL（在目标数据源或平台数据库上执行）
  const handleExecuteDdl = async () => {
    if (!currentDdl) return

    setExecuting(true)
    try {
      const res = await syncApi.executeDdlOnWarehouse(currentDdl, targetDsId)
      if (res.data.success) {
        message.success(`表 ${res.data.table_name || currentDdlTable} 创建成功`)
        setDdlModalVisible(false)
      } else {
        message.error(res.data.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '执行失败')
    } finally {
      setExecuting(false)
    }
  }

  // sourceDs: 如果是平台数据库（sourceDsId === -1），从 warehouseConfig 构建；否则从 datasources 获取
  const sourceDs = sourceDsId === -1
    ? { id: -1, name: warehouseConfig?.name || '平台数据库', type: warehouseConfig?.type || 'mysql', database: warehouseConfig?.database || 'warehouse' }
    : datasources.find((d) => d.id === sourceDsId)
  const availableTables = sourceTables.filter(
    (t) => !selectedTables.find((st) => st.tableName === t)
  )

  // 生成目标表名: 层名_类型_库名_表名
  const generateTargetTableName = (tableName: string) => {
    if (!sourceDs) return tableName
    // 获取层名（默认 ods）
    const selectedLayer = layers.find(l => l.id === selectedLayerId)
    const layerName = (selectedLayer?.name || 'ods').toLowerCase()
    const dbType = (sourceDs.type || 'unknown').toLowerCase()
    const dbName = (sourceDs.database || 'db').toLowerCase().replace(/[^a-z0-9]/g, '_')
    return `${layerName}_${dbType}_${dbName}_${tableName}`
  }

  // 检查表是否已有同步任务（返回所有匹配的任务）
  const findExistingTasks = (tableName: string) => {
    return syncTasks.filter(
      (task) => task.source_datasource_id === sourceDsId && task.source_table === tableName
    )
  }

  // 任务列表列配置
  const taskColumns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: { showTitle: false },
      render: (name: string, record: SyncTaskItem) => (
        <Tooltip title={<div><div>{name}</div><div style={{ fontSize: 11, opacity: 0.8 }}>{record.description}</div></div>}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Text strong>{name}</Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: '源表',
      key: 'source',
      width: 180,
      ellipsis: { showTitle: false },
      render: (_: any, record: SyncTaskItem) => {
        const ds = datasources.find((d) => d.id === record.source_datasource_id)
        return (
          <Tooltip title={`${ds?.name || '-'} / ${record.source_table}`}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Space size={4}>
                <DatabaseOutlined style={{ fontSize: 12 }} />
                <span style={{ fontSize: 12 }}>{ds?.name || '-'}</span>
                <Tag style={{ margin: 0, fontSize: 11 }}>{record.source_table}</Tag>
              </Space>
            </div>
          </Tooltip>
        )
      },
    },
    {
      title: '目标表',
      key: 'target',
      width: 220,
      ellipsis: { showTitle: false },
      render: (_: any, record: SyncTaskItem) => {
        const targetName = record.target_datasource_id
          ? datasources.find((d) => d.id === record.target_datasource_id)?.name
          : warehouseConfig?.name
        return (
          <Tooltip title={`${targetName || '平台数据库'} / ${record.target_table}`}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Space size={4}>
                <GoldOutlined style={{ color: '#d4af37', fontSize: 12 }} />
                <Tag color="gold" style={{ margin: 0, fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{record.target_table}</Tag>
              </Space>
            </div>
          </Tooltip>
        )
      },
    },
    {
      title: '同步模式',
      dataIndex: 'sync_mode',
      key: 'sync_mode',
      width: 100,
      render: (mode: string) => (
        <Tag color={mode === 'incremental' ? 'blue' : 'green'}>
          {mode === 'incremental' ? '增量' : '全量'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const statusMap: Record<string, { color: string; text: string }> = {
          draft: { color: 'default', text: '草稿' },
          active: { color: 'success', text: '已激活' },
          paused: { color: 'warning', text: '已暂停' },
          running: { color: 'processing', text: '运行中' },
          failed: { color: 'error', text: '失败' },
        }
        const s = statusMap[status] || { color: 'default', text: status }
        return <Tag color={s.color}>{s.text}</Tag>
      },
    },
    {
      title: '层级',
      dataIndex: 'dw_layer_name',
      key: 'dw_layer_name',
      width: 80,
      render: (_: string, record: SyncTaskItem) =>
        record.dw_layer_name ? (
          <Tag color={record.dw_layer_color || 'default'}>{record.dw_layer_name}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '上次同步',
      key: 'last_sync',
      width: 150,
      render: (_: any, record: SyncTaskItem) =>
        record.last_sync_at ? (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 12 }}>{new Date(record.last_sync_at).toLocaleString()}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>{record.last_sync_rows} 行</Text>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: any, record: SyncTaskItem) => (
        <Space>
          <Tooltip title="执行同步">
            <Button
              type="text"
              size="small"
              icon={<PlayCircleOutlined style={{ color: '#52c41a' }} />}
              onClick={() => handleExecuteTask(record)}
            />
          </Tooltip>
          <Tooltip title="AI建表">
            <Button
              type="text"
              size="small"
              icon={<RobotOutlined style={{ color: '#722ed1' }} />}
              onClick={() => handleShowDdl(record)}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除该任务？"
            onConfirm={() => handleDeleteTask(record)}
            okText="删除"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // 根据搜索关键词过滤
  const filteredSyncTasks = syncTasks.filter((t) => {
    if (!searchKeyword) return true
    const keyword = searchKeyword.toLowerCase()
    // 支持精准搜索 id:xxx 格式
    if (keyword.startsWith('id:')) {
      const id = keyword.replace('id:', '')
      return t.id.toString() === id
    }
    // 普通搜索：名称、描述、源表、目标表
    return (
      t.name.toLowerCase().includes(keyword) ||
      (t.description || '').toLowerCase().includes(keyword) ||
      t.source_table.toLowerCase().includes(keyword) ||
      t.target_table.toLowerCase().includes(keyword)
    )
  })

  return (
    <div style={{ padding: '0 4px' }}>
      {/* 顶部工具栏 - 苹果风格 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        padding: '12px 16px',
        background: 'linear-gradient(to bottom, #fafafa, #f5f5f5)',
        borderRadius: 12,
        border: '1px solid #eee',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f' }}>数据同步</span>
          {warehouseConfig?.configured ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              background: 'linear-gradient(135deg, #fef3cd, #fff8e1)',
              borderRadius: 20,
              fontSize: 12,
              color: '#856404',
            }}>
              <GoldOutlined />
              <span>平台数据库</span>
              <span style={{ opacity: 0.7 }}>({warehouseConfig.type})</span>
            </div>
          ) : (
            <div style={{
              padding: '4px 12px',
              background: '#fff3cd',
              borderRadius: 20,
              fontSize: 12,
              color: '#856404',
            }}>
              未配置平台数据库
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selectedTaskIds.length > 0 && (
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={batchDeleting}
              onClick={handleBatchDelete}
              style={{ borderRadius: 6 }}
            >
              删除 ({selectedTaskIds.length})
            </Button>
          )}
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadSyncTasks}
            style={{ borderRadius: 6 }}
          >
            刷新
          </Button>
          <Tooltip title="管理字段值模板（如 etl_time = CURRENT_TIMESTAMP）">
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={() => navigate('/field-templates')}
              style={{ borderRadius: 6 }}
            >
              字段模板
            </Button>
          </Tooltip>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={handleOpenAddModal}
            style={{ borderRadius: 6 }}
          >
            新增任务
          </Button>
          <Input.Search
            placeholder="搜索任务名称"
            allowClear
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            style={{ width: 180 }}
            size="small"
          />
        </div>
      </div>

      {/* 任务列表 - 苹果风格卡片 */}
      <Card
        style={{
          borderRadius: 12,
          border: '1px solid #e8e8e8',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          columns={taskColumns}
          dataSource={filteredSyncTasks}
          rowKey="id"
          loading={loadingTasks}
          size="small"
          scroll={{ x: 1000 }}
          rowSelection={{
            selectedRowKeys: selectedTaskIds,
            onChange: (keys) => setSelectedTaskIds(keys as number[]),
          }}
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </Card>

      {/* 新增同步任务弹窗 - 苹果风格 */}
      <Modal
        title={null}
        closable={true}
        open={addModalVisible}
        onCancel={() => setAddModalVisible(false)}
        width={960}
        style={{ top: 30 }}
        styles={{
          body: { padding: '16px 20px' },
          content: { borderRadius: 16, overflow: 'hidden' },
        }}
        footer={[
          <Button key="cancel" size="small" onClick={() => setAddModalVisible(false)}>
            取消
          </Button>,
          tasksCreated ? (
            <Button
              key="sync"
              type="primary"
              size="small"
              icon={<SyncOutlined />}
              loading={syncing}
              onClick={handleSyncAndTest}
              style={{ background: '#52c41a', borderColor: '#52c41a' }}
            >
              同步 ({selectedTables.filter((t) => t.syncStatus !== 'success').length})
            </Button>
          ) : (
            <Button
              key="confirm"
              type="primary"
              size="small"
              icon={<ThunderboltOutlined />}
              loading={creating}
              disabled={
                selectedTables.length === 0 ||
                !warehouseConfigured ||
                selectedTables.some((t) => t.ddlStatus === 'generating') ||
                selectedTables.some((t) => t.ddlStatus === 'error')
              }
              onClick={handleConfirmCreate}
            >
              {selectedTables.some((t) => t.ddlStatus === 'generating')
                ? '生成中...'
                : `创建 (${selectedTables.filter((t) => t.createStatus !== 'success').length})`}
            </Button>
          ),
        ]}
      >
        {/* 顶部：源库 → 目标平台数据库 - 苹果风格 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          marginBottom: 16,
          padding: '12px 20px',
          background: 'linear-gradient(to bottom, #fafafa, #f5f5f5)',
          borderRadius: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <DatabaseOutlined style={{ fontSize: 16, color: '#1890ff' }} />
            <Select
              size="small"
              style={{ width: 180 }}
              placeholder="选择源数据库"
              value={sourceDsId}
              onChange={(v) => {
                setSourceDsId(v)
                setSelectedTables([])
              }}
              options={[
                // 平台数据库选项
                ...(warehouseConfig?.configured ? [{
                  value: -1,
                  label: `平台数据库 (${warehouseConfig.type})`,
                }] : []),
                // 其他数据源
                ...datasources.map((ds) => ({
                  value: ds.id,
                  label: `${ds.name} (${ds.type})`,
                })),
              ]}
            />
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 16px',
            background: '#fff',
            borderRadius: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}>
            <RightOutlined style={{ color: '#1890ff', fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <GoldOutlined style={{ fontSize: 16, color: '#d4af37' }} />
            <Select
              size="small"
              style={{ width: 180 }}
              placeholder="选择目标数据库"
              value={targetDsId}
              onChange={(v) => {
                setTargetDsId(v)
                setSelectedTables([])
              }}
              allowClear
              options={[
                // 平台数据库选项
                ...(warehouseConfig?.configured ? [{
                  value: null as any,
                  label: `平台数据库 (${warehouseConfig.type})`,
                }] : []),
                // 其他数据源（不做互斥）
                ...datasources.map((ds) => ({
                  value: ds.id,
                  label: `${ds.name} (${ds.type})`,
                })),
              ]}
            />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>层级:</Text>
            <Select
              size="small"
              style={{ width: 120 }}
              placeholder="选择层级"
              allowClear
              value={selectedLayerId}
              onChange={setSelectedLayerId}
              options={layers.map((l) => ({
                value: l.id,
                label: (
                  <Space size={4}>
                    <Tag color={l.color || 'default'} style={{ marginRight: 0, fontSize: 11 }}>
                      {l.name}
                    </Tag>
                  </Space>
                ),
              }))}
            />
          </div>
        </div>

        {/* 穿梭框 - 苹果风格 */}
        <div style={{ display: 'flex', gap: 12, height: 540 }}>
          {/* 左侧：源表列表 */}
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TableOutlined style={{ color: '#1890ff' }} />
                <span style={{ fontWeight: 500 }}>源表</span>
                <span style={{
                  background: '#e6f4ff',
                  color: '#1890ff',
                  padding: '1px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                }}>{availableTables.length}</span>
              </div>
            }
            size="small"
            style={{
              flex: 2,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 200,
              borderRadius: 12,
              border: '1px solid #e8e8e8',
            }}
            styles={{
              header: { minHeight: 40, padding: '0 14px', borderBottom: '1px solid #f0f0f0' },
              body: { flex: 1, overflow: 'auto', padding: 8 },
            }}
            extra={
              <Button
                type="text"
                size="small"
                style={{ fontSize: 12, color: '#1890ff' }}
                onClick={() => {
                  if (leftSelected.length === availableTables.length) {
                    setLeftSelected([])
                  } else {
                    setLeftSelected([...availableTables])
                  }
                }}
                disabled={availableTables.length === 0}
              >
                {leftSelected.length === availableTables.length && availableTables.length > 0 ? '取消全选' : '全选'}
              </Button>
            }
          >
            {loadingTables ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <Spin size="small" />
              </div>
            ) : availableTables.length > 0 ? (
              availableTables.map((table) => {
                const existingCount = findExistingTasks(table).length
                return (
                  <div
                    key={table}
                    onClick={() => handleLeftClick(table)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderRadius: 8,
                      marginBottom: 4,
                      fontSize: 13,
                      background: leftSelected.includes(table) ? '#e6f4ff' : '#fff',
                      border: leftSelected.includes(table) ? '1px solid #91caff' : '1px solid #f0f0f0',
                      transition: 'all 0.2s',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{table}</span>
                    {existingCount > 0 && (
                      <Tooltip title={`已同步 ${existingCount} 个目标表`}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: '#52c41a',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 500,
                        }}>
                          {existingCount}
                        </span>
                      </Tooltip>
                    )}
                  </div>
                )
              })
            ) : (
              <Empty description="暂无表" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 20 }} />
            )}
          </Card>

          {/* 中间：操作按钮 - 苹果风格 */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 8,
            padding: '0 4px',
          }}>
            <Tooltip title="添加到待同步">
              <Button
                type="primary"
                size="small"
                icon={<RightOutlined style={{ fontSize: 12 }} />}
                onClick={handleMoveRight}
                disabled={leftSelected.length === 0 || !warehouseConfigured || tasksCreated}
                style={{ borderRadius: 8, width: 36, height: 36 }}
              />
            </Tooltip>
            <Tooltip title="移除">
              <Button
                size="small"
                icon={<LeftOutlined style={{ fontSize: 12 }} />}
                onClick={handleMoveLeft}
                disabled={rightSelected.length === 0 || tasksCreated}
                style={{ borderRadius: 8, width: 36, height: 36 }}
              />
            </Tooltip>
          </div>

          {/* 右侧：已选表列表 - 苹果风格 */}
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <GoldOutlined style={{ color: '#d4af37' }} />
                <span style={{ fontWeight: 500 }}>待同步</span>
                <span style={{
                  background: '#f6ffed',
                  color: '#52c41a',
                  padding: '1px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                }}>{selectedTables.length}</span>
                {creating && (
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: '#e6f4ff',
                    color: '#1890ff',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: 11,
                  }}>
                    <LoadingOutlined spin style={{ fontSize: 10 }} />
                    {selectedTables.filter((t) => t.createStatus === 'success' || t.createStatus === 'error').length}/{selectedTables.length}
                  </span>
                )}
                {syncing && (
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: '#e6f4ff',
                    color: '#1890ff',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: 11,
                  }}>
                    <LoadingOutlined spin style={{ fontSize: 10 }} />
                    {selectedTables.filter((t) => t.syncStatus === 'success' || t.syncStatus === 'error').length}/{selectedTables.length}
                  </span>
                )}
              </div>
            }
            size="small"
            style={{
              flex: 3,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 12,
              border: '1px solid #e8e8e8',
            }}
            styles={{
              header: { minHeight: 40, padding: '0 14px', borderBottom: '1px solid #f0f0f0' },
              body: { flex: 1, overflow: 'auto', padding: 8 },
            }}
            extra={
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                background: '#f5f5f5',
                borderRadius: 6,
                padding: '2px 4px',
              }}>
                <Tooltip title={globalResetting ? `${globalResetProgress.current}/${globalResetProgress.total}` : '全局重置（恢复到源表原始状态）'}>
                  <Button
                    type="text"
                    size="small"
                    icon={globalResetting ? <LoadingOutlined spin style={{ fontSize: 12 }} /> : <ReloadOutlined style={{ fontSize: 12 }} />}
                    onClick={handleGlobalReset}
                    disabled={selectedTables.length === 0 || tasksCreated || globalResetting}
                    style={{ color: '#666', padding: '0 6px' }}
                  />
                </Tooltip>
                <Tooltip title="批量添加字段">
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined style={{ fontSize: 12 }} />}
                    onClick={() => setBatchAddFieldVisible(true)}
                    disabled={selectedTables.length === 0 || !selectedTables.some(t => t.ddlStatus === 'success') || tasksCreated}
                    style={{ color: '#666', padding: '0 6px' }}
                  />
                </Tooltip>
                <div style={{ width: 1, height: 14, background: '#ddd', margin: '0 2px' }} />
                <Button
                  type="text"
                  size="small"
                  onClick={() => {
                    if (rightSelected.length === selectedTables.length) {
                      setRightSelected([])
                    } else {
                      setRightSelected(selectedTables.map((t) => t.tableName))
                    }
                  }}
                  disabled={selectedTables.length === 0}
                  style={{ color: '#666', padding: '0 6px', fontSize: 11 }}
                >
                  {rightSelected.length === selectedTables.length && selectedTables.length > 0 ? '取消' : '全选'}
                </Button>
                <Button
                  type="text"
                  size="small"
                  onClick={() => setSelectedTables([])}
                  disabled={selectedTables.length === 0 || tasksCreated}
                  style={{ color: '#ff4d4f', padding: '0 6px', fontSize: 11 }}
                >
                  清空
                </Button>
              </div>
            }
          >
            {selectedTables.length > 0 ? (
              selectedTables.map((item) => (
                <div
                  key={item.tableName}
                  onClick={() => handleRightClick(item.tableName)}
                  onDoubleClick={() => {
                    if (item.ddlStatus === 'success' && !tasksCreated) {
                      handleOpenColumnMapping(item)
                    }
                  }}
                  style={{
                    padding: '4px 8px',
                    cursor: 'pointer',
                    borderRadius: 4,
                    marginBottom: 2,
                    fontSize: 12,
                    background: item.syncStatus === 'error' || item.createStatus === 'error'
                      ? '#fff1f0'
                      : item.syncStatus === 'success'
                      ? '#f6ffed'
                      : item.createStatus === 'success'
                      ? '#f0f5ff'
                      : rightSelected.includes(item.tableName)
                      ? '#e6f4ff'
                      : '#fafafa',
                    border: item.syncStatus === 'error' || item.createStatus === 'error'
                      ? '1px solid #ffa39e'
                      : item.syncStatus === 'success'
                      ? '1px solid #b7eb8f'
                      : item.createStatus === 'success'
                      ? '1px solid #adc6ff'
                      : rightSelected.includes(item.tableName)
                      ? '1px solid #91caff'
                      : item.ddlStatus === 'error'
                      ? '1px solid #ff4d4f'
                      : '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s',
                  }}
                >
                  <Tooltip title={item.targetTableName}>
                    <Space size={4}>
                      <TableOutlined style={{ color: '#52c41a', fontSize: 11 }} />
                      <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {item.targetTableName}
                      </span>
                    </Space>
                  </Tooltip>
                  <Space size={2}>
                    {/* DDL 状态指示（创建前显示） */}
                    {!item.createStatus && !item.syncStatus && (
                      <>
                        {item.ddlStatus === 'generating' && (
                          <Tag icon={<LoadingOutlined spin />} color="processing" style={{ margin: 0, fontSize: 11 }}>
                            生成中
                          </Tag>
                        )}
                        {item.ddlStatus === 'success' && (
                          <Tag icon={<CheckCircleOutlined />} color="success" style={{ margin: 0, fontSize: 11 }}>
                            就绪
                          </Tag>
                        )}
                        {item.ddlStatus === 'error' && (
                          <Tooltip title={item.ddlError}>
                            <Tag icon={<ExclamationCircleOutlined />} color="error" style={{ margin: 0, fontSize: 11 }}>
                              失败
                            </Tag>
                          </Tooltip>
                        )}
                      </>
                    )}
                    {/* 创建状态指示 */}
                    {item.createStatus === 'pending' && (
                      <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                        待创建
                      </Tag>
                    )}
                    {item.createStatus === 'creating' && (
                      <Tag icon={<LoadingOutlined spin />} color="processing" style={{ margin: 0, fontSize: 11 }}>
                        创建中
                      </Tag>
                    )}
                    {item.createStatus === 'success' && !item.syncStatus && (
                      <Tag icon={<CheckCircleOutlined />} color="success" style={{ margin: 0, fontSize: 11 }}>
                        已创建
                      </Tag>
                    )}
                    {item.createStatus === 'error' && (
                      <>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: '0 4px', fontSize: 11, height: 'auto' }}
                          icon={<RobotOutlined />}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAiFixDdl(item)
                          }}
                        >
                          AI修复
                        </Button>
                        <Tooltip title={item.createError}>
                          <Tag icon={<ExclamationCircleOutlined />} color="error" style={{ margin: 0, fontSize: 11, background: '#fff1f0', borderColor: '#ffa39e' }}>
                            失败
                          </Tag>
                        </Tooltip>
                      </>
                    )}
                    {/* 单独创建按钮（DDL就绪且未创建时显示） */}
                    {item.ddlStatus === 'success' && !item.createStatus && (
                      <Tooltip title="单独创建">
                        <Button
                          type="text"
                          size="small"
                          style={{ padding: '0 4px' }}
                          icon={<ThunderboltOutlined style={{ color: '#1890ff', fontSize: 13 }} />}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCreateSingle(item)
                          }}
                        />
                      </Tooltip>
                    )}
                    {/* 单独同步按钮（创建成功但同步失败时显示） */}
                    {item.createStatus === 'success' && item.syncStatus === 'error' && (
                      <Tooltip title="重新同步">
                        <Button
                          type="text"
                          size="small"
                          style={{ padding: '0 4px' }}
                          icon={<SyncOutlined style={{ color: '#52c41a', fontSize: 13 }} />}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSyncSingle(item)
                          }}
                        />
                      </Tooltip>
                    )}
                    {/* 同步状态指示 */}
                    {item.syncStatus === 'pending' && (
                      <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                        待同步
                      </Tag>
                    )}
                    {item.syncStatus === 'syncing' && (
                      <Tag icon={<LoadingOutlined spin />} color="processing" style={{ margin: 0, fontSize: 11 }}>
                        同步中
                      </Tag>
                    )}
                    {item.syncStatus === 'success' && (
                      <Tag icon={<CheckCircleOutlined />} color="success" style={{ margin: 0, fontSize: 11 }}>
                        {String(item.syncRows ?? 0).padStart(2, '0')}行
                      </Tag>
                    )}
                    {item.syncStatus === 'error' && (
                      <Tooltip title={item.syncError}>
                        <Tag icon={<ExclamationCircleOutlined />} color="error" style={{ margin: 0, fontSize: 11, background: '#fff1f0', borderColor: '#ffa39e' }}>
                          失败
                        </Tag>
                      </Tooltip>
                    )}
                    {/* 查看 DDL 按钮（创建前可编辑） */}
                    {item.ddlStatus === 'success' && !tasksCreated && (
                      <Tooltip title="查看/编辑 DDL">
                        <Button
                          type="text"
                          size="small"
                          style={{ padding: '0 4px' }}
                          icon={<EyeOutlined style={{ color: '#722ed1', fontSize: 13 }} />}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleViewDdl(item)
                          }}
                        />
                      </Tooltip>
                    )}
                    {/* 重新生成按钮（失败时显示，创建前可用） */}
                    {item.ddlStatus === 'error' && !tasksCreated && (
                      <Tooltip title="重新生成">
                        <Button
                          type="text"
                          size="small"
                          style={{ padding: '0 4px' }}
                          icon={<ReloadOutlined style={{ color: '#1890ff', fontSize: 13 }} />}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRegenerateDdl(item.tableName)
                          }}
                        />
                      </Tooltip>
                    )}
                    {!tasksCreated && (
                      <Button
                        type="text"
                        size="small"
                        danger
                        style={{ padding: '0 4px' }}
                        icon={<DeleteOutlined style={{ fontSize: 13 }} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveTable(item.tableName)
                        }}
                      />
                    )}
                  </Space>
                </div>
              ))
            ) : (
              <Empty description="从左侧选择表" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 20 }} />
            )}
          </Card>
        </div>
      </Modal>

      {/* DDL 预览/编辑弹窗（新增时使用） */}
      <Modal
        title={<span style={{ fontSize: 14 }}><FileTextOutlined style={{ color: '#722ed1' }} /> DDL - {previewDdlTargetTable}</span>}
        open={previewDdlVisible}
        onCancel={() => setPreviewDdlVisible(false)}
        width={650}
        styles={{ header: { padding: '10px 16px' }, body: { padding: '12px 16px' } }}
        footer={[
          <Button key="cancel" size="small" onClick={() => setPreviewDdlVisible(false)}>
            取消
          </Button>,
          <Button key="save" size="small" type="primary" onClick={handleSaveDdl}>
            保存
          </Button>,
        ]}
      >
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden' }}>
          <Editor
            height="320px"
            language="sql"
            value={previewDdl}
            onChange={(v) => setPreviewDdl(v || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      </Modal>

      {/* DDL 预览弹窗（任务列表中使用） */}
      <Modal
        title={<span style={{ fontSize: 14 }}><RobotOutlined style={{ color: '#722ed1' }} /> AI DDL - {currentDdlTable}</span>}
        open={ddlModalVisible}
        onCancel={() => setDdlModalVisible(false)}
        width={700}
        styles={{ header: { padding: '10px 16px' }, body: { padding: '12px 16px' } }}
        footer={[
          <Button key="cancel" size="small" onClick={() => setDdlModalVisible(false)}>
            取消
          </Button>,
          <Button
            key="execute"
            type="primary"
            size="small"
            icon={<ThunderboltOutlined />}
            loading={executing}
            disabled={!currentDdl || ddlLoading}
            onClick={handleExecuteDdl}
          >
            执行
          </Button>,
        ]}
      >
        {ddlLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="small" tip="生成中..." />
          </div>
        ) : (
          <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden' }}>
            <Editor
              height="350px"
              language="sql"
              value={currentDdl}
              onChange={(v) => setCurrentDdl(v || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
        )}
      </Modal>

      {/* 冲突处理弹窗 */}
      <Modal
        title={null}
        closable={false}
        open={conflictModalVisible}
        onCancel={() => {
          setConflictModalVisible(false)
          setLeftSelected([])
        }}
        width={520}
        styles={{ body: { padding: 0, width: '100%' }, content: { padding: 24, width: '100%' } }}
        footer={null}
        modalRender={(modal) => (
          <div
            style={{ cursor: 'move' }}
            onMouseDown={(e) => {
              const target = e.target as HTMLElement
              if (target.tagName === 'INPUT') return
              const modalEl = (e.currentTarget as HTMLElement).querySelector('.ant-modal-content') as HTMLElement
              if (!modalEl) return
              const rect = modalEl.getBoundingClientRect()
              const offsetX = e.clientX - rect.left
              const offsetY = e.clientY - rect.top
              const onMouseMove = (ev: MouseEvent) => {
                modalEl.style.position = 'fixed'
                modalEl.style.left = `${ev.clientX - offsetX}px`
                modalEl.style.top = `${ev.clientY - offsetY}px`
                modalEl.style.margin = '0'
              }
              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
              }
              document.addEventListener('mousemove', onMouseMove)
              document.addEventListener('mouseup', onMouseUp)
            }}
          >
            {modal}
          </div>
        )}
      >
        {/* 顶部 */}
        <div style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f' }}>
            <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 6 }} />
            冲突 {conflictTables.length}
          </span>
          {newTables.length > 0 && (
            <span style={{ fontSize: 11, color: '#52c41a' }}>+{newTables.length} 新</span>
          )}
        </div>

        {/* 内容区 */}
        <div style={{ padding: 0, maxHeight: 600, overflow: 'auto', width: '100%' }}>
          {conflictTables.map((conflict, index) => (
            <div
              key={conflict.tableName}
              style={{
                background: '#f5f5f7',
                padding: '12px 16px',
                marginBottom: index < conflictTables.length - 1 ? 1 : 0,
                width: '100%',
              }}
            >
              {/* 表名行 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f' }}>
                  <TableOutlined style={{ color: '#1890ff', fontSize: 12, marginRight: 6 }} />
                  {conflict.tableName}
                </span>
                <span style={{ fontSize: 11, color: '#86868b' }}>{conflict.existingTasks.length}个目标</span>
              </div>

              {/* 已有目标表 */}
              <div style={{ marginBottom: 8, paddingLeft: 18 }}>
                {conflict.existingTasks.map((task) => (
                  <div key={task.id} style={{ fontSize: 12, color: '#86868b', lineHeight: '18px' }}>
                    <GoldOutlined style={{ fontSize: 10, marginRight: 4, color: '#d4af37' }} />{task.target_table}
                  </div>
                ))}
              </div>

              {/* 操作选项 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 18 }}>
                {['skip', 'rename', 'recreate'].map((action) => {
                  const isSelected = conflictResolutions[conflict.tableName] === action
                  const config: Record<string, { label: string; color: string; tip: string }> = {
                    skip: { label: '跳过', color: '#8c8c8c', tip: '不处理此表，保留现有同步任务' },
                    rename: { label: '新增', color: '#34c759', tip: '创建新的目标表，实现一对多同步' },
                    recreate: { label: '重建', color: '#ff3b30', tip: '删除旧任务，DROP TABLE 后重新建表' },
                  }
                  const { label, color, tip } = config[action]
                  return (
                    <Tooltip
                      key={action}
                      title={<span style={{ fontSize: 11 }}>{tip}</span>}
                      color="rgba(0,0,0,0.75)"
                      overlayInnerStyle={{ padding: '4px 8px', minHeight: 'auto' }}
                    >
                      <span
                        onClick={() => setConflictResolutions((prev) => ({ ...prev, [conflict.tableName]: action as any }))}
                        style={{
                          padding: '3px 10px',
                          borderRadius: 4,
                          fontSize: 12,
                          cursor: 'pointer',
                          background: isSelected ? color : '#e5e5ea',
                          color: isSelected ? '#fff' : '#8e8e93',
                          fontWeight: 500,
                          transition: 'all 0.15s',
                        }}
                      >
                        {label}
                      </span>
                    </Tooltip>
                  )
                })}
                {conflictResolutions[conflict.tableName] === 'rename' && (
                  <Input
                    size="small"
                    style={{ width: 140, fontSize: 12, height: 24, marginLeft: 4 }}
                    placeholder="新表名"
                    value={renameValues[conflict.tableName]}
                    onChange={(e) => setRenameValues((prev) => ({
                      ...prev,
                      [conflict.tableName]: e.target.value,
                    }))}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 底部按钮 */}
        <div style={{ padding: '4px 8px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <span
            onClick={() => {
              const resolutions: Record<string, 'skip' | 'rename' | 'recreate'> = {}
              conflictTables.forEach((c) => {
                resolutions[c.tableName] = 'skip'
              })
              setConflictResolutions(resolutions)
            }}
            style={{ fontSize: 11, color: '#8c8c8c', cursor: 'pointer', padding: '2px 8px' }}
          >
            重置
          </span>
          <span
            onClick={handleConflictResolve}
            style={{ fontSize: 11, color: '#1890ff', cursor: 'pointer', fontWeight: 500, padding: '2px 8px' }}
          >
            确定
          </span>
        </div>
      </Modal>

      {/* AI 修复日志弹窗 */}
      <Modal
        title={
          <span style={{ fontSize: 14 }}>
            <RobotOutlined style={{ color: '#722ed1', marginRight: 8 }} />
            AI 修复日志 - {aiFixLog?.tableName}
          </span>
        }
        open={aiFixLogVisible}
        onCancel={() => setAiFixLogVisible(false)}
        width={900}
        footer={[
          <Button key="close" onClick={() => setAiFixLogVisible(false)}>
            关闭
          </Button>,
        ]}
      >
        {aiFixLog && (
          <div style={{ maxHeight: 600, overflow: 'auto' }}>
            {/* 状态 */}
            {aiFixLog.status === 'loading' && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin size="large" tip="AI 正在分析修复中..." />
              </div>
            )}

            {aiFixLog.status !== 'loading' && (
              <>
                {/* 错误信息 */}
                <div style={{ marginBottom: 16 }}>
                  <Text strong style={{ color: '#ff4d4f' }}>错误信息：</Text>
                  <div
                    style={{
                      background: '#fff1f0',
                      border: '1px solid #ffa39e',
                      borderRadius: 4,
                      padding: 12,
                      marginTop: 8,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {aiFixLog.error}
                  </div>
                </div>

                {/* 原始 DDL */}
                <div style={{ marginBottom: 16 }}>
                  <Text strong>原始 DDL：</Text>
                  <div
                    style={{
                      background: '#f5f5f5',
                      border: '1px solid #d9d9d9',
                      borderRadius: 4,
                      padding: 12,
                      marginTop: 8,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      maxHeight: 150,
                      overflow: 'auto',
                    }}
                  >
                    {aiFixLog.originalDdl}
                  </div>
                </div>

                {/* AI 分析 */}
                {aiFixLog.explanation && (
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ color: '#722ed1' }}>AI 分析：</Text>
                    <div
                      style={{
                        background: '#f9f0ff',
                        border: '1px solid #d3adf7',
                        borderRadius: 4,
                        padding: 12,
                        marginTop: 8,
                        fontSize: 13,
                      }}
                    >
                      {aiFixLog.explanation}
                    </div>
                  </div>
                )}

                {/* 修改内容 */}
                {aiFixLog.changes && aiFixLog.changes.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ color: '#1890ff' }}>修改内容：</Text>
                    <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                      {aiFixLog.changes.map((change, idx) => (
                        <li key={idx} style={{ fontSize: 13, marginBottom: 4 }}>{change}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 修复后 DDL */}
                {aiFixLog.fixedDdl && (
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ color: '#52c41a' }}>修复后 DDL：</Text>
                    <div
                      style={{
                        background: '#f6ffed',
                        border: '1px solid #b7eb8f',
                        borderRadius: 4,
                        padding: 12,
                        marginTop: 8,
                        fontSize: 12,
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        maxHeight: 200,
                        overflow: 'auto',
                      }}
                    >
                      {aiFixLog.fixedDdl}
                    </div>
                  </div>
                )}

                {/* 状态标签 */}
                <div style={{ textAlign: 'right' }}>
                  {aiFixLog.status === 'success' && (
                    <Tag icon={<CheckCircleOutlined />} color="success">修复成功</Tag>
                  )}
                  {aiFixLog.status === 'error' && (
                    <Tag icon={<ExclamationCircleOutlined />} color="error">修复失败</Tag>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* 字段映射弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 500 }}>字段映射</span>
              {columnMappingTable && (
                <span style={{ fontSize: 12, color: '#666', fontWeight: 400 }}>
                  {columnMappingTable.tableName} → {columnMappingTable.targetTableName}
                </span>
              )}
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              marginRight: 20,
              background: '#f5f5f5',
              borderRadius: 6,
              padding: '2px 4px',
            }}>
              <Tooltip title="重置（恢复到源表原始状态，清除新增字段和修改）">
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined style={{ fontSize: 14 }} />}
                  onClick={handleResetColumnMapping}
                  disabled={loadingColumns}
                  style={{ color: '#666' }}
                />
              </Tooltip>
              <Tooltip title="添加字段">
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined style={{ fontSize: 14 }} />}
                  onClick={handleAddTargetColumn}
                  style={{ color: '#666' }}
                />
              </Tooltip>
              <div style={{ width: 1, height: 16, background: '#e0e0e0', margin: '0 4px' }} />
              <Tooltip title="保存并更新 DDL">
                <Button
                  type="text"
                  size="small"
                  icon={<SaveOutlined style={{ fontSize: 14 }} />}
                  onClick={handleSaveColumnMapping}
                  disabled={loadingColumns}
                  style={{ color: '#1890ff' }}
                />
              </Tooltip>
              <div style={{ width: 1, height: 16, background: '#e0e0e0', margin: '0 4px' }} />
              <Tooltip title={columnMappingFullscreen ? '退出全屏' : '全屏'}>
                <Button
                  type="text"
                  size="small"
                  icon={columnMappingFullscreen ? <FullscreenExitOutlined style={{ fontSize: 14 }} /> : <FullscreenOutlined style={{ fontSize: 14 }} />}
                  onClick={() => setColumnMappingFullscreen(!columnMappingFullscreen)}
                  style={{ color: '#666' }}
                />
              </Tooltip>
            </div>
          </div>
        }
        open={columnMappingVisible}
        onCancel={() => { setColumnMappingVisible(false); setColumnMappingFullscreen(false) }}
        width={columnMappingFullscreen ? '100vw' : 1000}
        style={columnMappingFullscreen ? { top: 0, maxWidth: '100vw', paddingBottom: 0 } : { top: 20 }}
        styles={{
          body: {
            height: columnMappingFullscreen ? 'calc(100vh - 55px)' : 'calc(100vh - 180px)',
            overflow: 'auto',
            padding: '12px 16px',
          },
        }}
        footer={null}
      >
        {/* 源库和目标库类型信息 */}
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <Tag color="cyan" style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}>{sourceDs?.type || '源库'}</Tag>
          <RightOutlined style={{ fontSize: 9, color: '#999' }} />
          <Tag color="gold" style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}>{warehouseConfig?.type || '目标库'}</Tag>
          <span style={{ color: '#999' }}>
            {sourceDs?.type?.toLowerCase() === warehouseConfig?.type?.toLowerCase()
              ? '类型相同，直接复制'
              : '类型不同，智能转换'}
          </span>
        </div>

        {loadingColumns ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="small" tip="加载字段信息..." />
          </div>
        ) : (
          <div ref={columnMappingListRef} style={{ height: columnMappingFullscreen ? 'calc(100vh - 120px)' : 'calc(100vh - 260px)', overflow: 'auto' }}>
            <Table
              dataSource={columnMappings}
              rowKey={(record, index) => `${record.sourceColumn}_${index}`}
              size="small"
              pagination={false}
              locale={{ emptyText: '暂无字段数据' }}
              columns={[
                {
                  title: '源字段',
                  dataIndex: 'sourceColumn',
                  key: 'sourceColumn',
                  width: 160,
                  render: (text: string, _: any, index: number) => {
                    const safeText = text || ''
                    // 如果是新增字段（sourceColumn为空），显示模板选择器
                    if (!safeText) {
                      // 检查是否已选择了模板（sourceColumn 为 {{label}} 格式）
                      const currentMapping = columnMappings[index]
                      // 从 sourceColumn 提取已选模板（如果有的话）
                      const existingLabel = currentMapping?.sourceColumn?.startsWith('{{')
                        ? currentMapping.sourceColumn.slice(2, -2)
                        : undefined
                      return (
                        <Select
                          size="small"
                          value={existingLabel}
                          placeholder="选择模板..."
                          style={{ width: '100%', fontSize: 12 }}
                          allowClear
                          onChange={(value) => {
                            const template = fieldValueTemplates.find(t => t.label === value)
                            const newMappings = [...columnMappings]
                            newMappings[index] = {
                              ...newMappings[index],
                              sourceColumn: value ? `{{${value}}}` : '',
                              sourceType: template?.expression || '-',
                            }
                            setColumnMappings(newMappings)
                          }}
                          options={fieldValueTemplates.map(t => ({
                            value: t.label,
                            label: (
                              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                {t.label}
                                <span style={{ color: '#999', marginLeft: 6, fontSize: 10 }}>
                                  {t.description || t.expression}
                                </span>
                              </span>
                            ),
                          }))}
                        />
                      )
                    }
                    // 如果是模板字段（以{{开头），显示模板标签
                    if (safeText.startsWith('{{') && safeText.endsWith('}}')) {
                      const templateLabel = safeText.slice(2, -2)
                      return (
                        <Tag color="blue" style={{ margin: 0, fontFamily: 'monospace', fontSize: 11 }}>
                          {templateLabel}
                        </Tag>
                      )
                    }
                    // 普通源字段
                    return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{safeText}</span>
                  },
                },
                {
                  title: '源类型/表达式',
                  dataIndex: 'sourceType',
                  key: 'sourceType',
                  width: 140,
                  render: (text: string, record: ColumnMapping) => {
                    const safeText = text || '-'
                    const safeSourceColumn = record.sourceColumn || ''
                    // 如果是模板字段，显示表达式
                    if (safeSourceColumn.startsWith('{{') && safeSourceColumn.endsWith('}}')) {
                      return (
                        <Tooltip title={safeText}>
                          <span style={{
                            fontFamily: 'monospace',
                            fontSize: 10,
                            color: '#52c41a',
                            background: '#f6ffed',
                            padding: '2px 6px',
                            borderRadius: 4,
                            display: 'inline-block',
                            maxWidth: 120,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {safeText}
                          </span>
                        </Tooltip>
                      )
                    }
                    return safeText && safeText !== '-' ? (
                      <Tag style={{ margin: 0, fontSize: 10 }}>{safeText}</Tag>
                    ) : (
                      <span style={{ color: '#999', fontSize: 11 }}>-</span>
                    )
                  },
                },
                {
                  title: '',
                  key: 'arrow',
                  width: 36,
                  align: 'center' as const,
                  render: () => (
                    <RightOutlined style={{ fontSize: 11, color: '#1890ff' }} />
                  ),
                },
                {
                  title: '目标字段',
                  dataIndex: 'targetColumn',
                  key: 'targetColumn',
                  width: 130,
                  render: (text: string, _: any, index: number) => (
                    <Input
                      size="small"
                      value={text}
                      onChange={(e) => handleUpdateTargetColumn(index, e.target.value)}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                  ),
                },
                {
                  title: '目标类型',
                  dataIndex: 'targetType',
                  key: 'targetType',
                  width: 130,
                  render: (text: string, _: any, index: number) => {
                    // 解析类型和大小，如 VARCHAR(255) -> VARCHAR, 255
                    const match = text?.match(/^([A-Za-z]+)(?:\(([^)]+)\))?$/)
                    const baseType = match ? match[1].toUpperCase() : text?.toUpperCase() || ''
                    return (
                      <Select
                        size="small"
                        value={baseType}
                        onChange={(v) => {
                          // 保留原有大小
                          const sizeMatch = text?.match(/\(([^)]+)\)/)
                          const size = sizeMatch ? sizeMatch[1] : ''
                          const needsSize = ['VARCHAR', 'CHAR', 'DECIMAL', 'NUMERIC'].includes(v)
                          const newType = needsSize && size ? `${v}(${size})` : v
                          handleUpdateTargetType(index, newType)
                        }}
                        style={{ width: '100%', fontSize: 12 }}
                        options={[
                          { value: 'VARCHAR', label: 'VARCHAR' },
                          { value: 'CHAR', label: 'CHAR' },
                          { value: 'TEXT', label: 'TEXT' },
                          { value: 'STRING', label: 'STRING' },
                          { value: 'INT', label: 'INT' },
                          { value: 'BIGINT', label: 'BIGINT' },
                          { value: 'SMALLINT', label: 'SMALLINT' },
                          { value: 'TINYINT', label: 'TINYINT' },
                          { value: 'DECIMAL', label: 'DECIMAL' },
                          { value: 'DOUBLE', label: 'DOUBLE' },
                          { value: 'FLOAT', label: 'FLOAT' },
                          { value: 'DATE', label: 'DATE' },
                          { value: 'DATETIME', label: 'DATETIME' },
                          { value: 'TIMESTAMP', label: 'TIMESTAMP' },
                          { value: 'BOOLEAN', label: 'BOOLEAN' },
                        ]}
                      />
                    )
                  },
                },
                {
                  title: '大小',
                  key: 'typeSize',
                  width: 90,
                  render: (_: any, record: ColumnMapping, index: number) => {
                    // 解析大小，如 VARCHAR(255) -> 255
                    const match = record.targetType?.match(/\(([^)]+)\)/)
                    const size = match ? match[1] : ''
                    const baseType = record.targetType?.replace(/\([^)]+\)/, '').toUpperCase() || ''
                    const needsSize = ['VARCHAR', 'CHAR', 'DECIMAL', 'NUMERIC'].includes(baseType)

                    if (!needsSize) {
                      return <span style={{ color: '#999', fontSize: 11 }}>-</span>
                    }

                    return (
                      <Input
                        size="small"
                        value={size}
                        onChange={(e) => {
                          const newSize = e.target.value.trim()
                          const newType = newSize ? `${baseType}(${newSize})` : baseType
                          handleUpdateTargetType(index, newType)
                        }}
                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                        placeholder="255"
                      />
                    )
                  },
                },
                {
                  title: '',
                  key: 'action',
                  width: 40,
                  render: (_: any, __: any, index: number) => (
                    <Tooltip title="删除">
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                        onClick={() => handleDeleteColumnMapping(index)}
                      />
                    </Tooltip>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>

      {/* 批量加字段弹窗 - 苹果风格 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 500 }}>批量添加字段</span>
            <span style={{ fontSize: 12, color: '#999', fontWeight: 400, marginRight: 20 }}>
              {selectedTables.filter(t => t.ddlStatus === 'success').length} 个表
            </span>
          </div>
        }
        open={batchAddFieldVisible}
        onCancel={() => {
          setBatchAddFieldVisible(false)
          setBatchFields([{ name: '', type: 'TIMESTAMP', size: '' }])
        }}
        width={600}
        footer={null}
        styles={{ body: { padding: '12px 20px 16px' } }}
      >
        {/* 快捷预设 - 使用字段值模板 */}
        <div style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          padding: '8px 12px',
          background: '#fafafa',
          borderRadius: 8,
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 11, color: '#999', marginRight: 4 }}>快捷添加模板字段:</span>
          {fieldValueTemplates.map(template => (
            <Tooltip key={template.label} title={`${template.expression}${template.description ? ` - ${template.description}` : ''}`}>
              <div
                onClick={() => {
                  // 检查是否已添加
                  if (!batchFields.some(f => f.name === template.label)) {
                    setBatchFields(prev => {
                      // 如果第一行是空的，替换它；否则添加新行
                      if (prev.length === 1 && !prev[0].name.trim()) {
                        return [{ name: template.label, type: 'TIMESTAMP', size: '', templateLabel: template.label }]
                      }
                      return [...prev, { name: template.label, type: 'TIMESTAMP', size: '', templateLabel: template.label }]
                    })
                  }
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  background: batchFields.some(f => f.name === template.label) ? '#e6f4ff' : '#fff',
                  border: batchFields.some(f => f.name === template.label) ? '1px solid #91caff' : '1px solid #e8e8e8',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontFamily: 'monospace',
                }}
              >
                {template.label}
              </div>
            </Tooltip>
          ))}
        </div>

        {/* 字段列表 */}
        <div style={{ marginBottom: 12 }}>
          {batchFields.map((field, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: 8,
                padding: '8px 12px',
                background: field.templateLabel ? '#f0f5ff' : '#fafafa',
                borderRadius: 8,
                border: field.templateLabel ? '1px solid #adc6ff' : '1px solid transparent',
              }}
            >
              {/* 字段名 */}
              <Input
                value={field.name}
                onChange={e => {
                  const newFields = [...batchFields]
                  newFields[index].name = e.target.value
                  // 如果手动修改字段名，清除模板关联
                  if (newFields[index].templateLabel && e.target.value !== newFields[index].templateLabel) {
                    newFields[index].templateLabel = undefined
                  }
                  setBatchFields(newFields)
                }}
                placeholder="字段名"
                style={{ flex: 2, fontFamily: 'monospace', fontSize: 13 }}
                size="small"
              />
              {/* 值来源（模板选择） */}
              <Select
                value={field.templateLabel || undefined}
                onChange={v => {
                  const newFields = [...batchFields]
                  newFields[index].templateLabel = v
                  // 如果选择了模板，自动填充字段名
                  if (v && !newFields[index].name) {
                    newFields[index].name = v
                  }
                  setBatchFields(newFields)
                }}
                allowClear
                placeholder="值来源"
                style={{ width: 100, fontSize: 12 }}
                size="small"
                options={[
                  { value: undefined, label: <span style={{ color: '#999' }}>无</span> },
                  ...fieldValueTemplates.map(t => ({
                    value: t.label,
                    label: <span style={{ fontFamily: 'monospace' }}>{t.label}</span>,
                  }))
                ]}
              />
              {/* 类型 */}
              <Select
                value={field.type}
                onChange={v => {
                  const newFields = [...batchFields]
                  newFields[index].type = v
                  // 清除不需要大小的类型的 size
                  if (!['VARCHAR', 'CHAR', 'DECIMAL'].includes(v)) {
                    newFields[index].size = ''
                  }
                  setBatchFields(newFields)
                }}
                style={{ width: 110, fontSize: 12 }}
                size="small"
                options={[
                  { value: 'TIMESTAMP', label: 'TIMESTAMP' },
                  { value: 'DATETIME', label: 'DATETIME' },
                  { value: 'DATE', label: 'DATE' },
                  { value: 'STRING', label: 'STRING' },
                  { value: 'VARCHAR', label: 'VARCHAR' },
                  { value: 'CHAR', label: 'CHAR' },
                  { value: 'TEXT', label: 'TEXT' },
                  { value: 'BIGINT', label: 'BIGINT' },
                  { value: 'INT', label: 'INT' },
                  { value: 'DECIMAL', label: 'DECIMAL' },
                  { value: 'DOUBLE', label: 'DOUBLE' },
                  { value: 'BOOLEAN', label: 'BOOLEAN' },
                ]}
              />
              {/* 大小 */}
              <Input
                value={field.size}
                onChange={e => {
                  const newFields = [...batchFields]
                  newFields[index].size = e.target.value
                  setBatchFields(newFields)
                }}
                placeholder={
                  ['VARCHAR', 'CHAR', 'DECIMAL'].includes(field.type)
                    ? (field.type === 'DECIMAL' ? '10,2' : '255')
                    : '-'
                }
                disabled={!['VARCHAR', 'CHAR', 'DECIMAL'].includes(field.type)}
                style={{
                  width: 60,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  background: ['VARCHAR', 'CHAR', 'DECIMAL'].includes(field.type) ? '#fff' : '#fafafa',
                  color: ['VARCHAR', 'CHAR', 'DECIMAL'].includes(field.type) ? 'inherit' : '#ccc',
                }}
                size="small"
              />
              {/* 删除按钮 */}
              {batchFields.length > 1 && (
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined style={{ fontSize: 13, color: '#999' }} />}
                  onClick={() => setBatchFields(prev => prev.filter((_, i) => i !== index))}
                  style={{ padding: '0 4px' }}
                />
              )}
            </div>
          ))}
        </div>

        {/* 底部操作栏 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 8,
          borderTop: '1px solid #f0f0f0',
        }}>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined style={{ fontSize: 12 }} />}
            onClick={() => setBatchFields(prev => [...prev, { name: '', type: 'STRING', size: '' }])}
            style={{ color: '#1890ff', padding: '0 8px' }}
          >
            添加字段
          </Button>
          <Space size={8}>
            <Button
              size="small"
              onClick={() => {
                setBatchAddFieldVisible(false)
                setBatchFields([{ name: '', type: 'TIMESTAMP', size: '' }])
              }}
              style={{ borderRadius: 6 }}
            >
              取消
            </Button>
            <Button
              type="primary"
              size="small"
              onClick={handleBatchAddField}
              disabled={!batchFields.some(f => f.name.trim())}
              style={{ borderRadius: 6 }}
            >
              添加到所有表
            </Button>
          </Space>
        </div>
      </Modal>

      {/* 下线提示弹窗 */}
      <Modal
        open={warningVisible}
        onCancel={() => setWarningVisible(false)}
        closable={true}
        footer={null}
        width={280}
        centered
        styles={{ body: { textAlign: 'center', padding: '20px 24px' } }}
      >
        <ExclamationCircleOutlined style={{ fontSize: 32, color: '#faad14', marginBottom: 12 }} />
        <div style={{ fontSize: 14, marginBottom: 16 }}>请先下线再删除</div>
        <Button
          type="primary"
          onClick={() => {
            setWarningVisible(false)
            navigate(`/scheduler?sync_ids=${warningTaskId}`)
          }}
        >
          去下线
        </Button>
      </Modal>

    </div>
  )
}
