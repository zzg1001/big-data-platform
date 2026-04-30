import { useEffect, useState } from 'react'
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
} from '@ant-design/icons'
import { datasourceApi, syncApi, configApi, warehouseApi, aiApi } from '../services/api'
import Editor from '@monaco-editor/react'

const { Text, Title } = Typography

interface SyncTaskItem {
  id: number
  name: string
  description?: string
  source_datasource_id: number
  source_table: string
  target_datasource_id?: number | null  // 为空时使用系统数仓配置
  target_table: string
  sync_mode: string
  status: string
  is_scheduled: boolean
  cron_expression?: string
  last_sync_at?: string
  last_sync_rows?: number
  last_error?: string
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

  // 数仓配置（从系统配置读取）
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

  // 数仓是否已配置
  const warehouseConfigured = warehouseConfig?.configured || false

  useEffect(() => {
    loadDatasources()
    loadSyncTasks()
    loadWarehouseConfig()
  }, [])

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

  const loadSourceTables = async () => {
    if (!sourceDsId) return
    setLoadingTables(true)
    try {
      const res = await datasourceApi.getTables(sourceDsId)
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
          source_datasource_id: sourceDsId!,
          source_table: table.tableName,
          target_table: table.targetTableName,
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

  // 默认示例映射数据（仅在 API 失败时显示）
  const defaultMockMappings: ColumnMapping[] = [
    { sourceColumn: 'id', sourceType: 'INT', targetColumn: 'id', targetType: 'INT' },
    { sourceColumn: 'name', sourceType: 'VARCHAR(255)', targetColumn: 'name', targetType: 'VARCHAR(255)' },
    { sourceColumn: 'created_at', sourceType: 'DATETIME', targetColumn: 'created_at', targetType: 'DATETIME' },
  ]

  // 打开字段映射弹窗
  const handleOpenColumnMapping = async (item: SelectedTableItem) => {
    if (!sourceDsId) {
      message.warning('请先选择数据源')
      return
    }

    // 先设置默认数据，确保弹窗有内容显示
    setColumnMappingTable(item)
    setColumnMappings(defaultMockMappings)
    setLoadingColumns(true)
    setColumnMappingVisible(true)

    let finalMappings: ColumnMapping[] = defaultMockMappings

    // 获取源库和目标库类型
    const sourceDbType = sourceDs?.type?.toLowerCase() || 'mysql'
    const targetDbType = warehouseConfig?.type?.toLowerCase() || 'mysql'

    try {
      // 1. 优先使用 selectedTables 中已有的映射（与 DDL 一致）
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
        message.info('未获取到字段信息，显示示例数据')
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
        source_datasource_id: sourceDsId,
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
        source_datasource_id: sourceDsId,
        source_table: tableName,
        target_table: item.targetTableName,
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
        await syncApi.executeDdlOnWarehouse(truncateSql)
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
      const ddlRes = await syncApi.executeDdlOnWarehouse(item.ddl)
      if (!ddlRes.data.success) {
        throw new Error(ddlRes.data.message || 'DDL执行失败')
      }

      // 创建同步任务
      await syncApi.create({
        name: `Sync_${item.targetTableName}`,
        description: `${item.tableName} → ${item.targetTableName}`,
        source_datasource_id: sourceDsId,
        source_table: item.tableName,
        target_table: item.targetTableName,
        sync_mode: 'full',
        is_scheduled: false,
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
      message.warning('请先在「系统管理」中配置目标数仓')
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
        const ddlRes = await syncApi.executeDdlOnWarehouse(table.ddl)
        if (!ddlRes.data.success) {
          throw new Error(ddlRes.data.message || 'DDL执行失败')
        }

        // 第二步：创建同步任务
        await syncApi.create({
          name: `Sync_${table.targetTableName}`,
          description: `${table.tableName} → ${table.targetTableName}`,
          source_datasource_id: sourceDsId,
          source_table: table.tableName,
          target_table: table.targetTableName,
          sync_mode: 'full',
          is_scheduled: false,
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
          await syncApi.executeDdlOnWarehouse(truncateSql)
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

  // 删除同步任务（同时删除数仓表）
  const handleDeleteTask = async (task: SyncTaskItem) => {
    try {
      // 先删除数仓中的表
      const dropDdl = `DROP TABLE IF EXISTS ${task.target_table}`
      await syncApi.executeDdlOnWarehouse(dropDdl)
      // 再删除任务记录
      await syncApi.delete(task.id)
      message.success('任务和数仓表已删除')
      loadSyncTasks()
    } catch (error: any) {
      const detail = error.response?.data?.detail || '删除失败'
      message.error(detail)
    }
  }

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedTaskIds.length === 0) return
    setBatchDeleting(true)
    let success = 0
    let fail = 0
    const errors: string[] = []

    const tasksToDelete = syncTasks.filter((t) => selectedTaskIds.includes(t.id))

    for (const task of tasksToDelete) {
      try {
        const dropDdl = `DROP TABLE IF EXISTS ${task.target_table}`
        await syncApi.executeDdlOnWarehouse(dropDdl)
        await syncApi.delete(task.id)
        success++
      } catch (error: any) {
        fail++
        const detail = error.response?.data?.detail
        if (detail && !errors.includes(detail)) {
          errors.push(detail)
        }
      }
    }

    setBatchDeleting(false)
    setSelectedTaskIds([])

    if (fail === 0) {
      message.success(`已删除 ${success} 个任务`)
    } else if (errors.length > 0) {
      message.warning(`成功 ${success} 个，失败 ${fail} 个：${errors.join('; ')}`)
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

  // AI 生成 DDL（使用 sync API，会自动读取系统数仓配置）
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

  // 执行 DDL（在系统数仓上执行）
  const handleExecuteDdl = async () => {
    if (!currentDdl) return

    setExecuting(true)
    try {
      const res = await syncApi.executeDdlOnWarehouse(currentDdl)
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

  const sourceDs = datasources.find((d) => d.id === sourceDsId)
  const availableTables = sourceTables.filter(
    (t) => !selectedTables.find((st) => st.tableName === t)
  )

  // 生成目标表名: ods_类型_库名_表名
  const generateTargetTableName = (tableName: string) => {
    if (!sourceDs) return tableName
    const dbType = (sourceDs.type || 'unknown').toLowerCase()
    const dbName = (sourceDs.database || 'db').toLowerCase().replace(/[^a-z0-9]/g, '_')
    return `ods_${dbType}_${dbName}_${tableName}`
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
          <Tooltip title={`${targetName || '系统数仓'} / ${record.target_table}`}>
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
          {!record.is_scheduled && (
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDeleteTask(record)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>数据同步</Title>
          {warehouseConfig?.configured ? (
            <Tag icon={<GoldOutlined />} color="gold" style={{ marginLeft: 16 }}>
              目标数仓: {warehouseConfig.name} ({warehouseConfig.type})
            </Tag>
          ) : (
            <Tag color="warning" style={{ marginLeft: 16 }}>
              未配置数仓，请在「系统管理」中配置
            </Tag>
          )}
        </Space>
        <Space>
          {selectedTaskIds.length > 0 && (() => {
            const selectedTasks = syncTasks.filter((t) => selectedTaskIds.includes(t.id))
            const deletableCount = selectedTasks.filter((t) => !t.is_scheduled).length
            return (
              <>
                {deletableCount > 0 && (
                  <Button danger icon={<DeleteOutlined />} loading={batchDeleting} onClick={handleBatchDelete}>
                    批量删除 ({deletableCount})
                  </Button>
                )}
                {deletableCount < selectedTaskIds.length && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    已上线任务需先在「调度管理」下线后才能删除
                  </Text>
                )}
              </>
            )
          })()}
          <Button icon={<ReloadOutlined />} onClick={loadSyncTasks}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAddModal}>
            新增同步任务
          </Button>
        </Space>
      </div>

      {/* 任务列表 */}
      <Card bodyStyle={{ padding: 12 }}>
        <Table
          columns={taskColumns}
          dataSource={syncTasks}
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

      {/* 新增同步任务弹窗 */}
      <Modal
        title={null}
        closable={true}
        open={addModalVisible}
        onCancel={() => setAddModalVisible(false)}
        width={920}
        styles={{ body: { padding: '12px 16px' } }}
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
        {/* 顶部：源库 → 目标数仓 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, fontSize: 12 }}>
          <Space size={6}>
            <Select
              size="small"
              style={{ width: 160, fontSize: 12 }}
              placeholder="选择源库"
              value={sourceDsId}
              onChange={(v) => {
                setSourceDsId(v)
                setSelectedTables([])
              }}
              options={datasources.map((ds) => ({
                value: ds.id,
                label: (
                  <span style={{ fontSize: 12 }}>
                    {ds.name} <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>{ds.type}</Tag>
                  </span>
                ),
              }))}
            />
            {sourceDs && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {sourceDs.type}/{sourceDs.database}
              </Text>
            )}
          </Space>
          <RightOutlined style={{ color: '#999', fontSize: 10 }} />
          {warehouseConfig?.configured ? (
            <Space size={4}>
              <GoldOutlined style={{ color: '#d4af37' }} />
              <Text strong style={{ fontSize: 12 }}>{warehouseConfig.name}</Text>
              <Tag color="gold" style={{ margin: 0, fontSize: 10 }}>{warehouseConfig.type}</Tag>
            </Space>
          ) : (
            <Tag color="warning" style={{ fontSize: 11 }}>未配置数仓</Tag>
          )}
        </div>

        {/* 穿梭框 */}
        <div style={{ display: 'flex', gap: 10, height: 580 }}>
          {/* 左侧：源表列表 */}
          <Card
            title={
              <Space size={4} style={{ fontSize: 12 }}>
                <DatabaseOutlined />
                {sourceDs ? `${sourceDs.type}` : '源表'}
                <Tag style={{ margin: 0, fontSize: 10 }}>{availableTables.length}</Tag>
              </Space>
            }
            size="small"
            style={{ flex: 2, display: 'flex', flexDirection: 'column', minWidth: 200 }}
            styles={{ header: { minHeight: 36, padding: '0 12px' }, body: { flex: 1, overflow: 'auto', padding: 6 } }}
            extra={
              <Button
                type="link"
                size="small"
                style={{ padding: '0 4px', fontSize: 12 }}
                onClick={() => {
                  if (leftSelected.length === availableTables.length) {
                    setLeftSelected([])
                  } else {
                    setLeftSelected([...availableTables])
                  }
                }}
                disabled={availableTables.length === 0}
              >
                {leftSelected.length === availableTables.length && availableTables.length > 0 ? '取消' : '全选'}
              </Button>
            }
          >
            {loadingTables ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
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
                      padding: '5px 10px',
                      cursor: 'pointer',
                      borderRadius: 4,
                      marginBottom: 2,
                      fontSize: 13,
                      background: leftSelected.includes(table) ? '#e6f4ff' : '#fafafa',
                      border: leftSelected.includes(table) ? '1px solid #91caff' : '1px solid transparent',
                      transition: 'all 0.15s',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Space size={6}>
                      <TableOutlined style={{ color: '#1890ff', fontSize: 12 }} />
                      <span>{table}</span>
                    </Space>
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

          {/* 中间：操作按钮 */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <Tooltip title="添加并生成DDL">
              <Button
                size="small"
                icon={<RightOutlined />}
                onClick={handleMoveRight}
                disabled={leftSelected.length === 0 || !warehouseConfigured || tasksCreated}
              />
            </Tooltip>
            <Button
              size="small"
              icon={<LeftOutlined />}
              onClick={handleMoveLeft}
              disabled={rightSelected.length === 0 || tasksCreated}
            />
          </div>

          {/* 右侧：已选表列表 */}
          <Card
            title={
              <Space size={4} style={{ fontSize: 12 }}>
                <GoldOutlined style={{ color: '#d4af37' }} />
                待同步
                <Tag color="green" style={{ margin: 0, fontSize: 10 }}>{selectedTables.length}</Tag>
                <Tooltip title="双击表名可打开字段映射">
                  <span style={{ color: '#999', fontSize: 10, cursor: 'help' }}>双击映射</span>
                </Tooltip>
                {creating && (
                  <Tag icon={<LoadingOutlined spin />} color="blue" style={{ margin: 0, fontSize: 10 }}>
                    创建 {selectedTables.filter((t) => t.createStatus === 'success' || t.createStatus === 'error').length}/{selectedTables.length}
                  </Tag>
                )}
                {syncing && (
                  <Tag icon={<LoadingOutlined spin />} color="processing" style={{ margin: 0, fontSize: 10 }}>
                    同步 {selectedTables.filter((t) => t.syncStatus === 'success' || t.syncStatus === 'error').length}/{selectedTables.length}
                  </Tag>
                )}
              </Space>
            }
            size="small"
            style={{ flex: 3, display: 'flex', flexDirection: 'column' }}
            styles={{ header: { minHeight: 36, padding: '0 12px' }, body: { flex: 1, overflow: 'auto', padding: 6 } }}
            extra={
              <Space size={0}>
                <Button
                  type="link"
                  size="small"
                  style={{ padding: '0 4px', fontSize: 12 }}
                  onClick={() => {
                    if (rightSelected.length === selectedTables.length) {
                      setRightSelected([])
                    } else {
                      setRightSelected(selectedTables.map((t) => t.tableName))
                    }
                  }}
                  disabled={selectedTables.length === 0}
                >
                  {rightSelected.length === selectedTables.length && selectedTables.length > 0 ? '取消' : '全选'}
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  style={{ padding: '0 4px', fontSize: 12 }}
                  onClick={() => setSelectedTables([])}
                  disabled={selectedTables.length === 0 || tasksCreated}
                >
                  清空
                </Button>
              </Space>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SettingOutlined style={{ color: '#1890ff' }} />
            <span>字段映射</span>
            {columnMappingTable && (
              <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
                {columnMappingTable.tableName} → {columnMappingTable.targetTableName}
              </Tag>
            )}
          </div>
        }
        open={columnMappingVisible}
        onCancel={() => setColumnMappingVisible(false)}
        width={950}
        style={{ top: 40 }}
        styles={{ body: { maxHeight: 'calc(100vh - 200px)', overflow: 'auto' } }}
        footer={[
          <Button key="add" size="small" icon={<PlusOutlined />} onClick={handleAddTargetColumn}>
            添加字段
          </Button>,
          <Button key="cancel" size="small" onClick={() => setColumnMappingVisible(false)}>
            取消
          </Button>,
          <Button
            key="save"
            type="primary"
            size="small"
            onClick={handleSaveColumnMapping}
            disabled={loadingColumns}
          >
            保存并更新 DDL
          </Button>,
        ]}
      >
        {/* 源库和目标库类型信息 */}
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <Tag color="cyan">{sourceDs?.type || '源库'}</Tag>
          <RightOutlined style={{ fontSize: 10, color: '#999' }} />
          <Tag color="gold">{warehouseConfig?.type || '目标库'}</Tag>
          <span style={{ color: '#999', marginLeft: 8 }}>
            {sourceDs?.type?.toLowerCase() === warehouseConfig?.type?.toLowerCase()
              ? '类型相同，字段直接复制'
              : '类型不同，智能转换'}
          </span>
        </div>

        {loadingColumns ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="small" tip="加载字段信息..." />
          </div>
        ) : (
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
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
                  width: 130,
                  render: (text: string) => (
                    text ? (
                      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{text}</span>
                    ) : (
                      <span style={{ color: '#999', fontSize: 11 }}>新增字段</span>
                    )
                  ),
                },
                {
                  title: '源类型',
                  dataIndex: 'sourceType',
                  key: 'sourceType',
                  width: 100,
                  render: (text: string) => (
                    text && text !== '-' ? (
                      <Tag style={{ margin: 0, fontSize: 10 }}>{text}</Tag>
                    ) : (
                      <span style={{ color: '#999', fontSize: 11 }}>-</span>
                    )
                  ),
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

    </div>
  )
}
