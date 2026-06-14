import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Card,
  Table,
  Button,
  Modal,
  Space,
  Tag,
  message,
  Typography,
  Tooltip,
  Tabs,
  Input,
  Descriptions,
  Alert,
  Badge,
  Layout,
  Avatar,
  Dropdown,
} from 'antd'
import {
  DeleteOutlined,
  PlayCircleOutlined,
  PauseOutlined,
  ReloadOutlined,
  ScheduleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  EyeOutlined,
  EditOutlined,
  SyncOutlined,
  RightOutlined,
  LeftOutlined,
  HolderOutlined,
  CodeOutlined,
  HomeOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { syncScheduleApi, etlApi, scheduleApi } from '../services/api'
import CronExpressionInput from '../components/CronExpressionInput'

const { Title, Text } = Typography
const { Header, Content } = Layout

// 调度列表项（从 sync-schedules API）
interface SyncScheduleItem {
  id: number
  name: string
  description?: string
  sync_task_id: number
  cron_expression: string
  is_enabled: boolean
  dag_id?: string
  airflow_status?: string
  next_run_time?: string
  last_run_time?: string
  last_run_status?: string
  // From sync_task
  sync_task_name: string
  source_table: string
  target_table: string
  sync_mode: string
  last_sync_at?: string
  last_sync_rows?: number
  // Creator
  creator_name?: string
  created_at: string
}

// 统一的调度项（包括同步、ETL和标签任务）
interface ScheduleItem {
  id: number
  type: 'sync' | 'etl' | 'tag'
  name: string
  description?: string
  taskId: number  // 实际任务的id（同步任务id、ETL任务id 或 标签任务调度id）
  taskName: string
  taskDetail: string  // 源表→目标表 或 SQL预览
  cron_expression: string
  is_enabled: boolean
  dag_id?: string
  airflow_status?: string
  next_run_time?: string
  last_run_at?: string
  last_run_rows?: number
  created_at: string
  status?: string  // 用于tag类型的状态
}

// 可调度的同步任务（未创建调度的）
interface AvailableSyncTask {
  id: number
  name: string
  source_table: string
  target_table: string
  sync_mode: string
}

// 可调度的ETL任务（未上线的）
interface AvailableEtlTask {
  id: number
  name: string
  description?: string
  sql_preview: string
}

export default function Scheduler() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [schedules, setSchedules] = useState<SyncScheduleItem[]>([])
  const [allSchedules, setAllSchedules] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [etlDisabling, setEtlDisabling] = useState<number | null>(null)
  const [etlDeleting, setEtlDeleting] = useState<number | null>(null)
  const [etlEnabling, setEtlEnabling] = useState<number | null>(null)

  // ETL view/edit modal
  const [etlViewModalVisible, setEtlViewModalVisible] = useState(false)
  const [etlEditModalVisible, setEtlEditModalVisible] = useState(false)
  const [etlEnableModalVisible, setEtlEnableModalVisible] = useState(false)
  const [viewingEtl, setViewingEtl] = useState<ScheduleItem | null>(null)
  const [editingEtl, setEditingEtl] = useState<ScheduleItem | null>(null)
  const [enablingEtl, setEnablingEtl] = useState<ScheduleItem | null>(null)
  const [etlEditCron, setEtlEditCron] = useState('')

  // Add schedule modal
  const [addModalVisible, setAddModalVisible] = useState(false)
  const [addTaskType, setAddTaskType] = useState<'sync' | 'etl'>('sync')
  const [availableTasks, setAvailableTasks] = useState<AvailableSyncTask[]>([])
  const [availableEtlTasks, setAvailableEtlTasks] = useState<AvailableEtlTask[]>([])
  const [leftSelected, setLeftSelected] = useState<number[]>([])
  const [rightSelected, setRightSelected] = useState<number[]>([])
  const [selectedTasks, setSelectedTasks] = useState<AvailableSyncTask[]>([])
  const [selectedEtlTasks, setSelectedEtlTasks] = useState<AvailableEtlTask[]>([])
  const [addCronExpression, setAddCronExpression] = useState('0 2 * * *')
  const [adding, setAdding] = useState(false)
  const [cronPopoverOpen, setCronPopoverOpen] = useState(false)

  // Enable modal (single schedule)
  const [enableModalVisible, setEnableModalVisible] = useState(false)
  const [selectedSchedule, setSelectedSchedule] = useState<SyncScheduleItem | null>(null)
  const [enabling, setEnabling] = useState(false)

  // Disable/Delete loading states
  const [disabling, setDisabling] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)

  // View modal
  const [viewModalVisible, setViewModalVisible] = useState(false)
  const [viewSchedule, setViewSchedule] = useState<SyncScheduleItem | null>(null)

  // Edit modal
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editSchedule, setEditSchedule] = useState<SyncScheduleItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCron, setEditCron] = useState('')
  const [editing, setEditing] = useState(false)

  // Batch selection (格式: "sync-1" 或 "etl-2")
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchEnabling, setBatchEnabling] = useState(false)
  const [batchDisabling, setBatchDisabling] = useState(false)

  // 未调度任务数量
  const [unscheduledCount, setUnscheduledCount] = useState(0)
  
  
  // Draggable popover
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const popoverRef = useRef<HTMLDivElement>(null)

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    if (popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect()
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
      // 如果是初始位置（居中），先设置为实际像素位置
      if (popoverPosition.x === 0 && popoverPosition.y === 0) {
        setPopoverPosition({
          x: rect.left,
          y: rect.top,
        })
      }
      setIsDragging(true)
    }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPopoverPosition({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        })
      }
    }
    const handleMouseUp = () => {
      setIsDragging(false)
    }
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // Reset popover position when opening
  const handleOpenCronPopover = () => {
    setPopoverPosition({ x: 0, y: 0 })
    setCronPopoverOpen(true)
  }

  useEffect(() => {
    loadSchedules()
  }, [statusFilter])

  // 防止URL参数处理重复执行
  const urlParamsProcessedRef = useRef(false)

  // 从 URL 参数获取 etl_id 或 sync_ids，或 add=1 自动打开增加调度弹框
  useEffect(() => {
    if (urlParamsProcessedRef.current) return

    const etlId = searchParams.get('etl_id')
    const etlIds = searchParams.get('etl_ids')
    const syncIds = searchParams.get('sync_ids')
    const addModal = searchParams.get('add')
    const addSyncIds = searchParams.get('syncIds')
    const addEtlIds = searchParams.get('etlIds')

    if (addModal === '1') {
      urlParamsProcessedRef.current = true
      // 自动打开增加调度弹框，预选指定任务
      const syncIdsToSelect = addSyncIds ? addSyncIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : []
      const etlIdsToSelect = addEtlIds ? addEtlIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : []

      // 打开弹框并预选
      handleOpenAddModalWithPreselect(syncIdsToSelect, etlIdsToSelect)
      setSearchParams({})
    } else if (etlId) {
      urlParamsProcessedRef.current = true
      setSearchKeyword(`etl:${etlId}`)
      setSearchParams({})
    } else if (etlIds) {
      urlParamsProcessedRef.current = true
      // 搜索过滤显示指定的ETL任务
      setSearchKeyword(`etl_ids:${etlIds}`)
      setSearchParams({})
    } else if (syncIds) {
      urlParamsProcessedRef.current = true
      // 搜索过滤显示指定的同步任务
      setSearchKeyword(`sync_ids:${syncIds}`)
      setSearchParams({})
    }
  }, [searchParams])



  const loadSchedules = async () => {
    setLoading(true)
    try {
      // 同时加载同步调度、ETL任务、通用调度（含标签任务）和可调度任务
      const [syncRes, etlRes, availableSyncRes] = await Promise.all([
        syncScheduleApi.list(statusFilter),
        etlApi.list(),
        syncScheduleApi.getAvailableTasks(),
      ])

      // 单独加载通用调度，避免影响其他数据
      let generalSchedulesRes: any = { data: [] }
      try {
        generalSchedulesRes = await scheduleApi.list()
        console.log('通用调度数据:', generalSchedulesRes.data)
      } catch (e) {
        console.error('加载通用调度失败:', e)
      }

      // 计算未调度任务数量：可调度同步任务 + 未调度ETL任务
      const unscheduledSyncCount = availableSyncRes.data?.length || 0
      const unscheduledEtlCount = etlRes.data.filter((t: any) => !t.is_scheduled).length
      setUnscheduledCount(unscheduledSyncCount + unscheduledEtlCount)

      setSchedules(syncRes.data)

      // 合并为统一的调度列表
      const syncItems: ScheduleItem[] = syncRes.data.map((s: SyncScheduleItem) => ({
        id: s.id,
        type: 'sync' as const,
        name: s.name,
        description: s.description,
        taskId: s.sync_task_id,  // 同步任务的实际id
        taskName: s.sync_task_name,
        taskDetail: `${s.source_table} → ${s.target_table}`,
        cron_expression: s.cron_expression,
        is_enabled: s.is_enabled,
        dag_id: s.dag_id,
        airflow_status: s.airflow_status,
        next_run_time: s.next_run_time,
        last_run_at: s.last_sync_at,
        last_run_rows: s.last_sync_rows,
        created_at: s.created_at,
      }))

      // 显示曾经调度过的ETL任务（有dag_id或cron_expression，说明曾经上过调度）
      const etlItems: ScheduleItem[] = etlRes.data
        .filter((e: any) => e.is_scheduled || e.dag_id || e.cron_expression)
        .map((e: any) => ({
          id: e.id,
          type: 'etl' as const,
          name: e.name,
          description: e.description,
          taskId: e.id,  // ETL任务的id
          taskName: e.name,
          taskDetail: (e.sql_preview || '').replace(/[\r\n]+/g, ' ').trim(),
          cron_expression: e.cron_expression || '',
          is_enabled: e.is_scheduled,
          dag_id: e.dag_id,
          airflow_status: e.airflow_status,
          next_run_time: e.next_run_time,
          last_run_at: e.last_run_at,
          last_run_rows: e.last_run_rows,
          created_at: e.created_at,
        }))

      // 标签任务调度（dag_id 以 tag_task_ 开头，或名称以 "标签任务-" 开头）
      const allGeneralSchedules = generalSchedulesRes.data || []
      console.log('所有通用调度:', allGeneralSchedules.map((s: any) => ({ id: s.id, name: s.name, dag_id: s.dag_id })))

      const tagItems: ScheduleItem[] = allGeneralSchedules
        .filter((s: any) => s.dag_id?.startsWith('tag_task_') || s.name?.startsWith('标签任务-'))
        .map((s: any) => ({
          id: s.id,
          type: 'tag' as const,
          name: s.name,
          description: s.description,
          taskId: s.id,
          taskName: s.name.replace('标签任务-', ''),
          taskDetail: s.description || 'SQL规则标签',
          cron_expression: s.cron_expression,
          is_enabled: s.status === 'active',
          dag_id: s.dag_id,
          airflow_status: s.status,
          next_run_time: undefined,
          last_run_at: undefined,
          last_run_rows: undefined,
          created_at: s.created_at,
          status: s.status,
        }))

      console.log('标签任务调度:', tagItems)

      // 根据筛选条件过滤
      let combined = [...syncItems, ...etlItems, ...tagItems]
      if (statusFilter === 'enabled') {
        combined = combined.filter(s => s.is_enabled)
      } else if (statusFilter === 'disabled') {
        combined = combined.filter(s => !s.is_enabled)
      }

      // 按创建时间排序
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      setAllSchedules(combined)
    } catch (error) {
      message.error('加载调度列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleEtlDisable = async (task: ScheduleItem, force: boolean = false) => {
    if (etlDisabling) return  // 防止重复提交
    setEtlDisabling(task.id)
    try {
      await etlApi.disable(task.id, force)
      message.success('ETL任务下线成功')
      loadSchedules()
    } catch (error: any) {
      if (error.response?.status === 409) {
        // 有下游依赖，弹出确认框
        Modal.confirm({
          title: '确认下线',
          content: error.response?.data?.detail,
          okText: '确认下线',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: () => handleEtlDisable(task, true),
        })
      } else {
        message.error(error.response?.data?.detail || 'ETL任务下线失败')
      }
    } finally {
      setEtlDisabling(null)
    }
  }

  const handleEtlView = (task: ScheduleItem) => {
    setViewingEtl(task)
    setEtlViewModalVisible(true)
  }

  const handleEtlOpenEditModal = (task: ScheduleItem) => {
    setEditingEtl(task)
    setEtlEditCron(task.cron_expression || '0 2 * * *')
    setEtlEditModalVisible(true)
  }

  const handleEtlSaveEdit = async () => {
    if (!editingEtl) return
    if (etlEnabling) return  // 防止重复提交
    setEtlEnabling(editingEtl.id)
    try {
      // 先下线再用新cron上线 (force=true 因为是修改操作)
      await etlApi.disable(editingEtl.id, true)
      await etlApi.enable(editingEtl.id, etlEditCron)
      message.success('修改成功')
      setEtlEditModalVisible(false)
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '修改失败')
    } finally {
      setEtlEnabling(null)
    }
  }

  const handleEtlOpenEnableModal = (task: ScheduleItem) => {
    setEnablingEtl(task)
    setEtlEditCron(task.cron_expression || '0 2 * * *')
    setEtlEnableModalVisible(true)
  }

  const handleEtlEnable = async () => {
    if (!enablingEtl) return
    if (etlEnabling) return  // 防止重复提交
    setEtlEnabling(enablingEtl.id)
    try {
      await etlApi.enable(enablingEtl.id, etlEditCron)
      message.success('上线成功')
      setEtlEnableModalVisible(false)
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '上线失败')
    } finally {
      setEtlEnabling(null)
    }
  }

  const handleEtlDelete = async (task: ScheduleItem) => {
    if (task.is_enabled) {
      message.warning('请先下线后再删除')
      return
    }
    setEtlDeleting(task.id)
    try {
      // 只取消调度，不删除ETL任务本身
      await etlApi.unschedule(task.id)
      message.success('调度已删除')
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    } finally {
      setEtlDeleting(null)
    }
  }

  // Open add modal and load available tasks
  const handleOpenAddModal = async () => {
    try {
      // Load both sync tasks and ETL tasks
      const [syncRes, etlRes] = await Promise.all([
        syncScheduleApi.getAvailableTasks(),
        etlApi.list(),
      ])
      setAvailableTasks(syncRes.data)
      // Filter ETL tasks that are not scheduled
      const unscheduledEtl = etlRes.data
        .filter((t: any) => !t.is_scheduled)
        .map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          sql_preview: t.sql_preview,
        }))
      setAvailableEtlTasks(unscheduledEtl)
      setLeftSelected([])
      setRightSelected([])
      setSelectedTasks([])
      setSelectedEtlTasks([])
      setAddCronExpression('0 2 * * *')
      setAddTaskType('sync')
      setAddModalVisible(true)
    } catch (error) {
      message.error('加载可用任务失败')
    }
  }

  // Open add modal with pre-selected tasks (from URL params)
  const handleOpenAddModalWithPreselect = async (syncIdsToSelect: number[], etlIdsToSelect: number[]) => {
    try {
      // Load both sync tasks and ETL tasks
      const [syncRes, etlRes] = await Promise.all([
        syncScheduleApi.getAvailableTasks(),
        etlApi.list(),
      ])

      const allSyncTasks: AvailableSyncTask[] = syncRes.data
      const allEtlTasks = etlRes.data
        .filter((t: any) => !t.is_scheduled)
        .map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          sql_preview: t.sql_preview,
        }))

      // 预选同步任务
      const preSelectedSync = allSyncTasks.filter(t => syncIdsToSelect.includes(t.id))
      const remainingSync = allSyncTasks.filter(t => !syncIdsToSelect.includes(t.id))

      // 预选ETL任务
      const preSelectedEtl = allEtlTasks.filter((t: AvailableEtlTask) => etlIdsToSelect.includes(t.id))
      const remainingEtl = allEtlTasks.filter((t: AvailableEtlTask) => !etlIdsToSelect.includes(t.id))

      setAvailableTasks(remainingSync)
      setAvailableEtlTasks(remainingEtl)
      setSelectedTasks(preSelectedSync)
      setSelectedEtlTasks(preSelectedEtl)
      setLeftSelected([])
      setRightSelected([])
      setAddCronExpression('0 2 * * *')

      // 根据预选内容决定显示哪个tab
      if (syncIdsToSelect.length > 0) {
        setAddTaskType('sync')
      } else if (etlIdsToSelect.length > 0) {
        setAddTaskType('etl')
      } else {
        setAddTaskType('sync')
      }

      setAddModalVisible(true)

      // 显示提示
      const totalPreselected = preSelectedSync.length + preSelectedEtl.length
      if (totalPreselected > 0) {
        message.info(`已自动选中 ${totalPreselected} 个待上线任务`)
      }
    } catch (error) {
      message.error('加载可用任务失败')
    }
  }

  // Move tasks to right (selected)
  const handleMoveRight = () => {
    if (addTaskType === 'sync') {
      const tasksToMove = availableTasks.filter(t => leftSelected.includes(t.id))
      setSelectedTasks([...selectedTasks, ...tasksToMove])
      setAvailableTasks(availableTasks.filter(t => !leftSelected.includes(t.id)))
    } else {
      const tasksToMove = availableEtlTasks.filter(t => leftSelected.includes(t.id))
      setSelectedEtlTasks([...selectedEtlTasks, ...tasksToMove])
      setAvailableEtlTasks(availableEtlTasks.filter(t => !leftSelected.includes(t.id)))
    }
    setLeftSelected([])
  }

  // Move tasks back to left
  const handleMoveLeft = () => {
    if (addTaskType === 'sync') {
      const tasksToMove = selectedTasks.filter(t => rightSelected.includes(t.id))
      setAvailableTasks([...availableTasks, ...tasksToMove])
      setSelectedTasks(selectedTasks.filter(t => !rightSelected.includes(t.id)))
    } else {
      const tasksToMove = selectedEtlTasks.filter(t => rightSelected.includes(t.id))
      setAvailableEtlTasks([...availableEtlTasks, ...tasksToMove])
      setSelectedEtlTasks(selectedEtlTasks.filter(t => !rightSelected.includes(t.id)))
    }
    setRightSelected([])
  }

  // Toggle left selection
  const handleLeftClick = (taskId: number) => {
    if (leftSelected.includes(taskId)) {
      setLeftSelected(leftSelected.filter(id => id !== taskId))
    } else {
      setLeftSelected([...leftSelected, taskId])
    }
  }

  // Toggle right selection
  const handleRightClick = (taskId: number) => {
    if (rightSelected.includes(taskId)) {
      setRightSelected(rightSelected.filter(id => id !== taskId))
    } else {
      setRightSelected([...rightSelected, taskId])
    }
  }

  // Batch create schedules
  const handleCreateSchedules = async (enableAfterCreate: boolean = false) => {
    // 防止重复提交
    if (adding) {
      return
    }

    if (addTaskType === 'sync') {
      // 处理同步任务
      if (selectedTasks.length === 0) {
        message.warning('请选择要调度的任务')
        return
      }
      setAdding(true)
      let success = 0
      let fail = 0
      const createdIds: number[] = []

      for (const task of selectedTasks) {
        try {
          const res = await syncScheduleApi.create({
            name: `${task.name}_调度`,
            sync_task_id: task.id,
            cron_expression: addCronExpression,
          })
          createdIds.push(res.data.id)
          success++
        } catch (error) {
          fail++
        }
      }

      // 如果需要上线
      if (enableAfterCreate && createdIds.length > 0) {
        let enableSuccess = 0
        for (const id of createdIds) {
          try {
            await syncScheduleApi.enable(id)
            enableSuccess++
          } catch (error) {
            // 上线失败不影响创建结果
          }
        }
        if (enableSuccess > 0) {
          message.success(`已创建并上线 ${enableSuccess} 个调度`)
        }
      } else if (fail === 0) {
        message.success(`已创建 ${success} 个调度`)
      } else {
        message.warning(`成功 ${success} 个，失败 ${fail} 个`)
      }
    } else {
      // 处理ETL任务
      if (selectedEtlTasks.length === 0) {
        message.warning('请选择要调度的ETL任务')
        return
      }
      setAdding(true)
      let success = 0
      let fail = 0

      for (const task of selectedEtlTasks) {
        try {
          if (enableAfterCreate) {
            // 保存并上线：直接调用 enable（会触发 Airflow 事务）
            await etlApi.enable(task.id, addCronExpression)
          } else {
            // 仅保存：只保存调度信息，不触发 Airflow
            await etlApi.schedule(task.id, addCronExpression)
          }
          success++
        } catch (error) {
          fail++
        }
      }

      if (fail === 0) {
        message.success(enableAfterCreate ? `已上线 ${success} 个ETL任务` : `已保存 ${success} 个ETL调度`)
      } else {
        message.warning(`成功 ${success} 个，失败 ${fail} 个`)
      }
    }

    setAdding(false)
    setAddModalVisible(false)
    loadSchedules()
  }

  const handleOpenEnableModal = (schedule: SyncScheduleItem) => {
    setSelectedSchedule(schedule)
    setEnableModalVisible(true)
  }

  const handleEnable = async () => {
    if (!selectedSchedule) return
    if (enabling) return  // 防止重复提交
    setEnabling(true)
    try {
      await syncScheduleApi.enable(selectedSchedule.id)
      message.success('上线成功')
      setEnableModalVisible(false)
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '上线失败')
    } finally {
      setEnabling(false)
    }
  }

  const handleDisable = async (schedule: SyncScheduleItem, force: boolean = false) => {
    if (disabling) return  // 防止重复提交
    setDisabling(schedule.id)
    try {
      await syncScheduleApi.disable(schedule.id, force)
      message.success('下线成功')
      loadSchedules()
    } catch (error: any) {
      if (error.response?.status === 409) {
        // 有下游依赖，弹出确认框
        Modal.confirm({
          title: '确认下线',
          content: error.response?.data?.detail,
          okText: '确认下线',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: () => handleDisable(schedule, true),
        })
      } else {
        message.error(error.response?.data?.detail || '下线失败')
      }
    } finally {
      setDisabling(null)
    }
  }

  const handleDelete = async (schedule: SyncScheduleItem) => {
    // 上线状态不可删除
    if (schedule.is_enabled) {
      message.warning('请先下线后再删除')
      return
    }
    setDeleting(schedule.id)
    try {
      await syncScheduleApi.delete(schedule.id)
      message.success('删除成功')
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    } finally {
      setDeleting(null)
    }
  }

  // 删除标签任务调度
  const handleTagDelete = async (record: ScheduleItem, force: boolean = false) => {
    if (record.is_enabled && !force) {
      // 如果是已上线状态，询问是否强制删除
      Modal.confirm({
        title: `确定删除"${record.name}"？`,
        icon: <DeleteOutlined style={{ color: '#ff4d4f' }} />,
        closable: false,
        centered: true,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => handleTagDelete(record, true),
      })
      return
    }
    setDeleting(record.id)
    try {
      // 如果是强制删除且还在上线状态，先尝试下线
      if (force && record.is_enabled) {
        try {
          await scheduleApi.pause(record.id)
        } catch (e) {
          // 忽略下线错误，继续删除
        }
      }
      await scheduleApi.delete(record.id)
      message.success('删除成功')
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    } finally {
      setDeleting(null)
    }
  }

  // 标签任务编辑
  const [tagEditModalVisible, setTagEditModalVisible] = useState(false)
  const [editingTagSchedule, setEditingTagSchedule] = useState<ScheduleItem | null>(null)
  const [tagEditCron, setTagEditCron] = useState('')

  const handleTagOpenEditModal = (record: ScheduleItem) => {
    setEditingTagSchedule(record)
    setTagEditCron(record.cron_expression)
    setTagEditModalVisible(true)
  }

  const handleTagEdit = async () => {
    if (!editingTagSchedule) return
    try {
      await scheduleApi.update(editingTagSchedule.id, {
        cron_expression: tagEditCron,
      })
      message.success('修改成功')
      setTagEditModalVisible(false)
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '修改失败')
    }
  }

  // 标签任务调度上线
  const [tagEnabling, setTagEnabling] = useState<number | null>(null)
  const handleTagEnable = async (record: ScheduleItem) => {
    setTagEnabling(record.id)
    try {
      // 先生成DAG
      await scheduleApi.generateDag(record.id)
      // 再部署上线
      await scheduleApi.deploy(record.id)
      message.success('上线成功')
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '上线失败')
    } finally {
      setTagEnabling(null)
    }
  }

  // 标签任务调度下线
  const [tagDisabling, setTagDisabling] = useState<number | null>(null)
  const handleTagDisable = async (record: ScheduleItem) => {
    setTagDisabling(record.id)
    try {
      await scheduleApi.pause(record.id)
      message.success('下线成功')
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '下线失败')
    } finally {
      setTagDisabling(null)
    }
  }

  // View schedule detail
  const handleView = (schedule: SyncScheduleItem) => {
    setViewSchedule(schedule)
    setViewModalVisible(true)
  }

  // Open edit modal
  const handleOpenEditModal = (schedule: SyncScheduleItem) => {
    setEditSchedule(schedule)
    setEditName(schedule.name)
    setEditDescription(schedule.description || '')
    setEditCron(schedule.cron_expression)
    setEditModalVisible(true)
  }

  // Save edit
  const handleSaveEdit = async () => {
    if (!editSchedule) return
    if (editing) return  // 防止重复提交
    if (!editName.trim()) {
      message.warning('请输入调度名称')
      return
    }
    setEditing(true)
    try {
      const cronChanged = editCron !== editSchedule.cron_expression
      const isEnabled = editSchedule.is_enabled

      if (cronChanged && isEnabled) {
        // 已上线且cron变了，需要先下线、更新、再上线（事务性操作）
        await syncScheduleApi.disable(editSchedule.id)
        await syncScheduleApi.update(editSchedule.id, {
          name: editName.trim(),
          description: editDescription.trim() || undefined,
          cron_expression: editCron,
        })
        await syncScheduleApi.enable(editSchedule.id)
        message.success('修改成功，已重新部署')
      } else {
        // 未上线或cron没变，直接更新
        await syncScheduleApi.update(editSchedule.id, {
          name: editName.trim(),
          description: editDescription.trim() || undefined,
          cron_expression: editCron,
        })
        message.success('修改成功')
      }
      setEditModalVisible(false)
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '修改失败')
    } finally {
      setEditing(false)
    }
  }

  // 解析选中的key，返回 {type, id}
  const parseSelectedKeys = () => {
    return selectedKeys.map(key => {
      const [type, id] = key.split('-')
      return { type: type as 'sync' | 'etl' | 'tag', id: parseInt(id, 10) }
    })
  }

  // 获取选中的调度项
  const getSelectedSchedules = () => {
    return allSchedules.filter(s => selectedKeys.includes(`${s.type}-${s.id}`))
  }

  // Batch delete
  const handleBatchDelete = async () => {
    if (selectedKeys.length === 0) return
    if (batchDeleting) return  // 防止重复提交

    setBatchDeleting(true)
    let success = 0
    let fail = 0

    for (const { type, id } of parseSelectedKeys()) {
      try {
        if (type === 'sync') {
          await syncScheduleApi.delete(id)
        } else {
          // ETL任务只取消调度，不删除任务本身
          await etlApi.unschedule(id)
        }
        success++
      } catch (error) {
        fail++
      }
    }

    setBatchDeleting(false)
    setSelectedKeys([])

    if (fail === 0) {
      message.success(`已删除 ${success} 个调度`)
    } else {
      message.warning(`成功 ${success} 个，失败 ${fail} 个`)
    }
    loadSchedules()
  }

  // Batch enable
  const handleBatchEnable = async () => {
    if (selectedKeys.length === 0) return
    if (batchEnabling) return  // 防止重复提交

    // 过滤出未上线的调度
    const toEnable = getSelectedSchedules().filter(s => !s.is_enabled)
    if (toEnable.length === 0) {
      message.warning('选中的调度都已上线')
      return
    }

    setBatchEnabling(true)
    let success = 0
    let fail = 0

    for (const item of toEnable) {
      try {
        if (item.type === 'sync') {
          await syncScheduleApi.enable(item.id)
        } else {
          // ETL任务需要cron表达式，使用已有的或默认值
          await etlApi.enable(item.id, item.cron_expression || '0 2 * * *')
        }
        success++
      } catch (error) {
        fail++
      }
    }

    setBatchEnabling(false)
    setSelectedKeys([])

    if (fail === 0) {
      message.success(`已上线 ${success} 个调度`)
    } else {
      message.warning(`成功 ${success} 个，失败 ${fail} 个`)
    }
    loadSchedules()
  }

  // Batch disable
  const handleBatchDisable = async () => {
    if (selectedKeys.length === 0) return
    if (batchDisabling) return  // 防止重复提交

    // 过滤出已上线的调度
    const toDisable = getSelectedSchedules().filter(s => s.is_enabled)
    if (toDisable.length === 0) {
      message.warning('选中的调度都未上线')
      return
    }

    setBatchDisabling(true)
    let success = 0
    let fail = 0

    for (const item of toDisable) {
      try {
        if (item.type === 'sync') {
          await syncScheduleApi.disable(item.id, true)  // force=true for batch
        } else {
          await etlApi.disable(item.id, true)  // force=true for batch
        }
        success++
      } catch (error) {
        fail++
      }
    }

    setBatchDisabling(false)
    setSelectedKeys([])

    if (fail === 0) {
      message.success(`已下线 ${success} 个调度`)
    } else {
      message.warning(`成功 ${success} 个，失败 ${fail} 个`)
    }
    loadSchedules()
  }

  // 统一调度列表的列配置
  const unifiedColumns = [
    {
      title: '类型',
      key: 'type',
      width: 80,
      render: (_: any, record: ScheduleItem) => {
        if (record.type === 'sync') {
          return <Tag color="blue"><SyncOutlined /> 同步</Tag>
        } else if (record.type === 'tag') {
          return <Tag color="green">标签</Tag>
        } else {
          return <Tag color="purple"><CodeOutlined /> ETL</Tag>
        }
      },
    },
    {
      title: '调度名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: { showTitle: false },
      render: (name: string, record: ScheduleItem) => {
        // 标签任务可点击跳转到标签页面
        if (record.type === 'tag' && record.dag_id) {
          const match = record.dag_id.match(/^tag_task_(\d+)$/)
          const tagNodeId = match ? match[1] : null
          if (tagNodeId) {
            return (
              <Tooltip title={record.description ? `${name} - ${record.description}（点击查看标签详情）` : `${name}（点击查看标签详情）`}>
                <a
                  style={{ fontWeight: 500, color: '#1890ff', cursor: 'pointer' }}
                  onClick={() => navigate(`/tags?tagId=${tagNodeId}&view=ai`)}
                >
                  {name}
                </a>
              </Tooltip>
            )
          }
        }
        return (
          <Tooltip title={record.description ? `${name} - ${record.description}` : name}>
            <Text strong style={{ fontSize: 13 }}>{name}</Text>
          </Tooltip>
        )
      },
    },
    {
      title: '任务详情',
      dataIndex: 'taskDetail',
      key: 'taskDetail',
      width: 200,
      ellipsis: { showTitle: false },
      render: (detail: string, record: ScheduleItem) => (
        <Tooltip title={detail} placement="topLeft">
          <div style={{
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 12,
          }}>
            {record.type === 'sync' ? (
              <span>{detail}</span>
            ) : record.type === 'tag' ? (
              <span style={{ color: '#52c41a' }}>{detail}</span>
            ) : (
              <Text code style={{ fontSize: 11 }}>{detail}</Text>
            )}
          </div>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      key: 'schedule_status',
      width: 90,
      render: (_: any, record: ScheduleItem) => (
        record.is_enabled ? (
          <Tag icon={<CheckCircleOutlined />} color="green">已上线</Tag>
        ) : (
          <Tag>未上线</Tag>
        )
      ),
    },
    {
      title: 'Cron',
      dataIndex: 'cron_expression',
      key: 'cron',
      width: 120,
      ellipsis: { showTitle: false },
      render: (cron: string) => cron ? (
        <Tooltip title={cron}>
          <Text code style={{ fontSize: 11 }}>{cron}</Text>
        </Tooltip>
      ) : '-',
    },
    {
      title: 'Airflow',
      dataIndex: 'airflow_status',
      key: 'airflow_status',
      width: 90,
      render: (status: string) => {
        if (!status) return '-'
        const config: Record<string, { color: string; icon: any }> = {
          active: { color: 'green', icon: <PlayCircleOutlined /> },
          paused: { color: 'orange', icon: <PauseOutlined /> },
          error: { color: 'red', icon: <ExclamationCircleOutlined /> },
        }
        const c = config[status] || { color: 'default', icon: null }
        return <Tag icon={c.icon} color={c.color}>{status}</Tag>
      },
    },
    {
      title: '上次执行',
      key: 'last_run',
      width: 160,
      ellipsis: { showTitle: false },
      render: (_: any, record: ScheduleItem) => {
        if (!record.last_run_at) return '-'
        const formatted = new Date(record.last_run_at).toLocaleString()
        const tip = record.last_run_rows !== undefined ? `${formatted} (${record.last_run_rows} 行)` : formatted
        return (
          <Tooltip title={tip}>
            <span style={{ fontSize: 12 }}>{formatted}</span>
          </Tooltip>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right' as const,
      render: (_: any, record: ScheduleItem) => (
        <Space size={2}>
          {record.type === 'sync' ? (
            // 同步任务的操作
            <>
              <Tooltip title="查看">
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => {
                    const syncItem = schedules.find(s => s.id === record.id)
                    if (syncItem) handleView(syncItem)
                  }}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
              <Tooltip title="编辑">
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    const syncItem = schedules.find(s => s.id === record.id)
                    if (syncItem) handleOpenEditModal(syncItem)
                  }}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
              {record.is_enabled ? (
                <Tooltip title="下线">
                  <Button
                    type="link"
                    size="small"
                    icon={<PauseOutlined />}
                    loading={disabling === record.id}
                    onClick={() => {
                      const syncItem = schedules.find(s => s.id === record.id)
                      if (syncItem) handleDisable(syncItem)
                    }}
                    style={{ color: '#faad14', padding: '0 4px' }}
                  />
                </Tooltip>
              ) : (
                <Tooltip title="上线">
                  <Button
                    type="link"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={() => {
                      const syncItem = schedules.find(s => s.id === record.id)
                      if (syncItem) handleOpenEnableModal(syncItem)
                    }}
                    style={{ color: '#52c41a', padding: '0 4px' }}
                  />
                </Tooltip>
              )}
              <Tooltip title={record.is_enabled ? '请先下线后删除' : '删除'}>
                <Button
                  type="link"
                  size="small"
                  danger={!record.is_enabled}
                  disabled={record.is_enabled}
                  icon={<DeleteOutlined />}
                  loading={deleting === record.id}
                  onClick={() => {
                    const syncItem = schedules.find(s => s.id === record.id)
                    if (syncItem) handleDelete(syncItem)
                  }}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
            </>
          ) : record.type === 'tag' ? (
            // 标签任务的操作
            <>
              <Tooltip title="查看">
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => window.open('/tags', '_blank')}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
              <Tooltip title="编辑">
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleTagOpenEditModal(record)}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
              {record.is_enabled ? (
                <Tooltip title="下线">
                  <Button
                    type="link"
                    size="small"
                    icon={<PauseOutlined />}
                    loading={tagDisabling === record.id}
                    onClick={() => handleTagDisable(record)}
                    style={{ color: '#faad14', padding: '0 4px' }}
                  />
                </Tooltip>
              ) : (
                <Tooltip title="上线">
                  <Button
                    type="link"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    loading={tagEnabling === record.id}
                    onClick={() => handleTagEnable(record)}
                    style={{ color: '#52c41a', padding: '0 4px' }}
                  />
                </Tooltip>
              )}
              <Tooltip title="删除">
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deleting === record.id}
                  onClick={() => handleTagDelete(record)}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
            </>
          ) : (
            // ETL任务的操作
            <>
              <Tooltip title="查看">
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => handleEtlView(record)}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
              <Tooltip title="编辑">
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleEtlOpenEditModal(record)}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
              {record.is_enabled ? (
                <Tooltip title="下线">
                  <Button
                    type="link"
                    size="small"
                    icon={<PauseOutlined />}
                    loading={etlDisabling === record.id}
                    onClick={() => handleEtlDisable(record)}
                    style={{ color: '#faad14', padding: '0 4px' }}
                  />
                </Tooltip>
              ) : (
                <Tooltip title="上线">
                  <Button
                    type="link"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={() => handleEtlOpenEnableModal(record)}
                    style={{ color: '#52c41a', padding: '0 4px' }}
                  />
                </Tooltip>
              )}
              <Tooltip title={record.is_enabled ? '请先下线后删除' : '删除'}>
                <Button
                  type="link"
                  size="small"
                  danger={!record.is_enabled}
                  disabled={record.is_enabled}
                  icon={<DeleteOutlined />}
                  loading={etlDeleting === record.id}
                  onClick={() => handleEtlDelete(record)}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
            </>
          )}
        </Space>
      ),
    },
  ]

  const onlineCount = allSchedules.filter((s) => s.is_enabled).length
  const offlineCount = allSchedules.filter((s) => !s.is_enabled).length

  // 根据搜索关键词过滤
  const filteredSchedules = allSchedules.filter((s) => {
    if (!searchKeyword) return true
    const keyword = searchKeyword.toLowerCase()
    // 支持 etl_ids:1,2,3 格式
    if (keyword.startsWith('etl_ids:')) {
      const ids = keyword.replace('etl_ids:', '').split(',').map(id => parseInt(id.trim()))
      return s.type === 'etl' && ids.includes(s.taskId)
    }
    // 支持 sync_ids:1,2,3 格式
    if (keyword.startsWith('sync_ids:')) {
      const ids = keyword.replace('sync_ids:', '').split(',').map(id => parseInt(id.trim()))
      return s.type === 'sync' && ids.includes(s.taskId)
    }
    // 支持精准搜索 etl:id 格式
    if (keyword.startsWith('etl:')) {
      const etlId = keyword.replace('etl:', '')
      return s.type === 'etl' && s.id.toString() === etlId
    }
    // 普通搜索：名称、任务详情
    return (
      s.name.toLowerCase().includes(keyword) ||
      s.taskName.toLowerCase().includes(keyword) ||
      s.taskDetail.toLowerCase().includes(keyword)
    )
  })

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Header style={{ background: '#1a1a1a', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>
              <ScheduleOutlined />
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>调度管理</span>
          </div>
          <Button type="text" icon={<HomeOutlined />} onClick={() => window.open('/', '_blank')} style={{ color: 'rgba(255,255,255,0.7)' }}>
            返回首页
          </Button>
        </div>
        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar size={32} icon={<UserOutlined />} style={{ background: '#722ed1' }} />
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>{user?.username || '用户'}</span>
          </div>
        </Dropdown>
      </Header>

      <Content style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <Space>
            <Title level={4} style={{ margin: 0 }}>
              任务调度列表
            </Title>
            <Tag color="green">{onlineCount} 已上线</Tag>
            <Tag>{offlineCount} 未上线</Tag>
          </Space>
        <Space>
          {selectedKeys.length > 0 && (
            <>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={batchEnabling}
                onClick={() => {
                  const toEnableCount = getSelectedSchedules().filter(s => !s.is_enabled).length
                  if (toEnableCount === 0) {
                    message.warning('选中的调度都已上线')
                    return
                  }
                  Modal.confirm({
                    title: null,
                    icon: null,
                    content: (
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>
                          <PlayCircleOutlined style={{ color: '#52c41a' }} />
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>批量上线</div>
                        <div style={{ fontSize: 13, color: '#666' }}>
                          确定要上线选中的 {toEnableCount} 个调度吗？
                        </div>
                      </div>
                    ),
                    okText: '上线',
                    cancelText: '取消',
                    onOk: handleBatchEnable,
                    centered: true,
                    width: 320,
                    okButtonProps: { style: { background: '#52c41a', borderColor: '#52c41a', borderRadius: 8, height: 36 } },
                    cancelButtonProps: { style: { borderRadius: 8, height: 36 } },
                    styles: { body: { padding: 0 } },
                    className: 'apple-style-modal',
                  })
                }}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}
              >
                批量上线
              </Button>
              <Button
                icon={<PauseOutlined />}
                loading={batchDisabling}
                onClick={() => {
                  const toDisableCount = getSelectedSchedules().filter(s => s.is_enabled).length
                  if (toDisableCount === 0) {
                    message.warning('选中的调度都未上线')
                    return
                  }
                  Modal.confirm({
                    title: null,
                    icon: null,
                    content: (
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>
                          <PauseOutlined style={{ color: '#faad14' }} />
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>批量下线</div>
                        <div style={{ fontSize: 13, color: '#666' }}>
                          确定要下线选中的 {toDisableCount} 个调度吗？
                        </div>
                      </div>
                    ),
                    okText: '下线',
                    cancelText: '取消',
                    onOk: handleBatchDisable,
                    centered: true,
                    width: 320,
                    okButtonProps: { style: { background: '#faad14', borderColor: '#faad14', borderRadius: 8, height: 36 } },
                    cancelButtonProps: { style: { borderRadius: 8, height: 36 } },
                    styles: { body: { padding: 0 } },
                    className: 'apple-style-modal',
                  })
                }}
                style={{ color: '#faad14', borderColor: '#faad14' }}
              >
                批量下线
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={batchDeleting}
                onClick={() => {
                  const enabledCount = getSelectedSchedules().filter(s => s.is_enabled).length
                  if (enabledCount > 0) {
                    message.warning(`有 ${enabledCount} 个调度已上线，请先下线后再删除`)
                    return
                  }
                  Modal.confirm({
                    title: null,
                    icon: null,
                    content: (
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>
                          <DeleteOutlined style={{ color: '#ff4d4f' }} />
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>批量删除</div>
                        <div style={{ fontSize: 13, color: '#666' }}>
                          确定要删除选中的 {selectedKeys.length} 个调度吗？
                        </div>
                      </div>
                    ),
                    okText: '删除',
                    okType: 'danger',
                    cancelText: '取消',
                    onOk: handleBatchDelete,
                    centered: true,
                    width: 320,
                    okButtonProps: { style: { borderRadius: 8, height: 36 } },
                    cancelButtonProps: { style: { borderRadius: 8, height: 36 } },
                    styles: { body: { padding: 0 } },
                    className: 'apple-style-modal',
                  })
                }}
              >
                批量删除
              </Button>
            </>
          )}
          <Button icon={<ReloadOutlined />} onClick={loadSchedules}>
            刷新
          </Button>
          <Badge count={unscheduledCount} offset={[-5, 5]} size="small">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleOpenAddModal}
              disabled={adding || batchEnabling || batchDisabling || batchDeleting}
            >
              添加调度
            </Button>
          </Badge>
        </Space>
        <Input.Search
          placeholder="搜索任务名称"
          allowClear
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          style={{ width: 200 }}
        />
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Tabs
          activeKey={statusFilter || 'all'}
          onChange={(key) => setStatusFilter(key === 'all' ? undefined : (key === 'online' ? 'enabled' : 'disabled'))}
          items={[
            { key: 'all', label: `全部 (${allSchedules.length})` },
            { key: 'online', label: `已上线 (${onlineCount})` },
            { key: 'offline', label: `未上线 (${offlineCount})` },
          ]}
          style={{ padding: '0 16px' }}
        />
        <Table
          columns={unifiedColumns}
          dataSource={filteredSchedules}
          rowKey={(record) => `${record.type}-${record.id}`}
          loading={loading}
          size="small"
          scroll={{ x: 'max-content' }}
          tableLayout="auto"
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys as string[]),
          }}
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          onRow={(record) => ({
            onDoubleClick: () => {
              if (record.type === 'etl') {
                window.open(`/bigdata/etl-tasks?id=${record.taskId}`, '_blank')
              } else if (record.type === 'tag') {
                window.open('/tags', '_blank')
              } else {
                window.open(`/bigdata/data-sync?id=${record.taskId}`, '_blank')
              }
            },
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* Add Schedule Modal */}
      <Modal
        title={null}
        closable={true}
        open={addModalVisible}
        onCancel={() => setAddModalVisible(false)}
        width={900}
        styles={{ body: { padding: '12px 16px' } }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Space>
              <Button size="small" onClick={() => setAddModalVisible(false)}>
                取消
              </Button>
              <Button
                type="primary"
                size="small"
                disabled={addTaskType === 'sync' ? selectedTasks.length === 0 : selectedEtlTasks.length === 0}
                style={{ borderRadius: 6 }}
                onClick={handleOpenCronPopover}
              >
                <ScheduleOutlined /> 创建调度 ({addTaskType === 'sync' ? selectedTasks.length : selectedEtlTasks.length})
              </Button>
            </Space>
          </div>
        }
      >
        {/* 任务类型选择 */}
        <Tabs
          activeKey={addTaskType}
          onChange={(key) => {
            setAddTaskType(key as 'sync' | 'etl')
            setLeftSelected([])
            setRightSelected([])
          }}
          items={[
            { key: 'sync', label: <span><SyncOutlined /> 同步任务 ({availableTasks.length})</span> },
            { key: 'etl', label: <span><CodeOutlined /> ETL任务 ({availableEtlTasks.length})</span> },
          ]}
          style={{ marginBottom: 12 }}
        />

        {/* 穿梭框 */}
        <div style={{ display: 'flex', gap: 10, height: 380 }}>
          {/* 左侧：可调度任务列表 */}
          <Card
            title={
              <Space size={4} style={{ fontSize: 12 }}>
                {addTaskType === 'sync' ? <SyncOutlined /> : <CodeOutlined />}
                可调度任务
                <Tag style={{ margin: 0, fontSize: 10 }}>
                  {addTaskType === 'sync' ? availableTasks.length : availableEtlTasks.length}
                </Tag>
              </Space>
            }
            size="small"
            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            styles={{ header: { minHeight: 36, padding: '0 12px' }, body: { flex: 1, overflow: 'auto', padding: 6 } }}
            extra={
              <Button
                type="link"
                size="small"
                style={{ padding: '0 4px', fontSize: 12 }}
                onClick={() => {
                  const tasks = addTaskType === 'sync' ? availableTasks : availableEtlTasks
                  if (leftSelected.length === tasks.length) {
                    setLeftSelected([])
                  } else {
                    setLeftSelected(tasks.map(t => t.id))
                  }
                }}
                disabled={(addTaskType === 'sync' ? availableTasks : availableEtlTasks).length === 0}
              >
                {leftSelected.length === (addTaskType === 'sync' ? availableTasks : availableEtlTasks).length &&
                 (addTaskType === 'sync' ? availableTasks : availableEtlTasks).length > 0 ? '取消' : '全选'}
              </Button>
            }
          >
            {addTaskType === 'sync' ? (
              availableTasks.length > 0 ? (
                availableTasks.map((task) => (
                  <Tooltip
                    key={task.id}
                    title={<div><div>{task.name}</div><div>{task.source_table} → {task.target_table}</div></div>}
                    placement="top"
                  >
                    <div
                      onClick={() => handleLeftClick(task.id)}
                      style={{
                        padding: '6px 10px',
                        cursor: 'pointer',
                        borderRadius: 4,
                        marginBottom: 3,
                        fontSize: 12,
                        background: leftSelected.includes(task.id) ? '#e6f4ff' : '#fafafa',
                        border: leftSelected.includes(task.id) ? '1px solid #91caff' : '1px solid transparent',
                        transition: 'all 0.15s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        overflow: 'hidden',
                      }}
                    >
                      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.name}</span>
                      <Tag color="blue" style={{ margin: 0, fontSize: 10, flexShrink: 0 }}>{task.sync_mode}</Tag>
                    </div>
                  </Tooltip>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: '#999', fontSize: 12 }}>
                  暂无可调度的同步任务
                </div>
              )
            ) : (
              availableEtlTasks.length > 0 ? (
                availableEtlTasks.map((task) => (
                  <Tooltip
                    key={task.id}
                    title={<div><div>{task.name}</div><div style={{ fontSize: 11 }}>{task.sql_preview?.replace(/[\r\n]+/g, ' ')}</div></div>}
                    placement="top"
                  >
                    <div
                      onClick={() => handleLeftClick(task.id)}
                      style={{
                        padding: '6px 10px',
                        cursor: 'pointer',
                        borderRadius: 4,
                        marginBottom: 3,
                        fontSize: 12,
                        background: leftSelected.includes(task.id) ? '#e6f4ff' : '#fafafa',
                        border: leftSelected.includes(task.id) ? '1px solid #91caff' : '1px solid transparent',
                        transition: 'all 0.15s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        overflow: 'hidden',
                      }}
                    >
                      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.name}</span>
                      <Tag color="purple" style={{ margin: 0, fontSize: 10, flexShrink: 0 }}>ETL</Tag>
                    </div>
                  </Tooltip>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: '#999', fontSize: 12 }}>
                  暂无可调度的ETL任务
                </div>
              )
            )}
          </Card>

          {/* 中间：操作按钮 */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <Tooltip title="添加">
              <Button
                size="small"
                icon={<RightOutlined />}
                onClick={handleMoveRight}
                disabled={leftSelected.length === 0}
              />
            </Tooltip>
            <Button
              size="small"
              icon={<LeftOutlined />}
              onClick={handleMoveLeft}
              disabled={rightSelected.length === 0}
            />
          </div>

          {/* 右侧：已选任务 */}
          <Card
            title={
              <Space size={4} style={{ fontSize: 12 }}>
                <ScheduleOutlined style={{ color: '#52c41a' }} />
                待创建调度
                <Tag color="green" style={{ margin: 0, fontSize: 10 }}>
                  {addTaskType === 'sync' ? selectedTasks.length : selectedEtlTasks.length}
                </Tag>
              </Space>
            }
            size="small"
            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            styles={{ header: { minHeight: 36, padding: '0 12px' }, body: { flex: 1, overflow: 'auto', padding: 6 } }}
            extra={
              <Button
                type="link"
                size="small"
                style={{ padding: '0 4px', fontSize: 12 }}
                onClick={() => {
                  const tasks = addTaskType === 'sync' ? selectedTasks : selectedEtlTasks
                  if (rightSelected.length === tasks.length) {
                    setRightSelected([])
                  } else {
                    setRightSelected(tasks.map(t => t.id))
                  }
                }}
                disabled={(addTaskType === 'sync' ? selectedTasks : selectedEtlTasks).length === 0}
              >
                {rightSelected.length === (addTaskType === 'sync' ? selectedTasks : selectedEtlTasks).length &&
                 (addTaskType === 'sync' ? selectedTasks : selectedEtlTasks).length > 0 ? '取消' : '全选'}
              </Button>
            }
          >
            {addTaskType === 'sync' ? (
              selectedTasks.length > 0 ? (
                selectedTasks.map((task) => (
                  <Tooltip
                    key={task.id}
                    title={<div><div>{task.name}</div><div>{task.source_table} → {task.target_table}</div></div>}
                    placement="top"
                  >
                    <div
                      onClick={() => handleRightClick(task.id)}
                      style={{
                        padding: '6px 10px',
                        cursor: 'pointer',
                        borderRadius: 4,
                        marginBottom: 3,
                        fontSize: 12,
                        background: rightSelected.includes(task.id) ? '#f6ffed' : '#fafafa',
                        border: rightSelected.includes(task.id) ? '1px solid #b7eb8f' : '1px solid transparent',
                        transition: 'all 0.15s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        overflow: 'hidden',
                      }}
                    >
                      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.name}</span>
                      <Tag color="blue" style={{ margin: 0, fontSize: 10, flexShrink: 0 }}>{task.sync_mode}</Tag>
                    </div>
                  </Tooltip>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: '#999', fontSize: 12 }}>
                  从左侧选择任务添加
                </div>
              )
            ) : (
              selectedEtlTasks.length > 0 ? (
                selectedEtlTasks.map((task) => (
                  <Tooltip
                    key={task.id}
                    title={<div><div>{task.name}</div><div style={{ fontSize: 11 }}>{task.sql_preview?.replace(/[\r\n]+/g, ' ')}</div></div>}
                    placement="top"
                  >
                    <div
                      onClick={() => handleRightClick(task.id)}
                      style={{
                        padding: '6px 10px',
                        cursor: 'pointer',
                        borderRadius: 4,
                        marginBottom: 3,
                        fontSize: 12,
                        background: rightSelected.includes(task.id) ? '#f6ffed' : '#fafafa',
                        border: rightSelected.includes(task.id) ? '1px solid #b7eb8f' : '1px solid transparent',
                        transition: 'all 0.15s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        overflow: 'hidden',
                      }}
                    >
                      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.name}</span>
                      <Tag color="purple" style={{ margin: 0, fontSize: 10, flexShrink: 0 }}>ETL</Tag>
                    </div>
                  </Tooltip>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: '#999', fontSize: 12 }}>
                  从左侧选择任务添加
                </div>
              )
            )}
          </Card>
        </div>
      </Modal>

      {/* Draggable Cron Popover */}
      {cronPopoverOpen && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1049,
            }}
            onClick={() => setCronPopoverOpen(false)}
          />
          {/* Popover */}
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              ...(popoverPosition.x === 0 && popoverPosition.y === 0
                ? {
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                  }
                : {
                    left: popoverPosition.x,
                    top: popoverPosition.y,
                  }),
              width: 360,
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)',
              zIndex: 1050,
              overflow: 'hidden',
            }}
          >
            {/* Header - Draggable */}
            <div
              onMouseDown={handleDragStart}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'move',
                userSelect: 'none',
                background: '#fafafa',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <HolderOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />
                <Text strong style={{ fontSize: 14 }}>调度设置</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  已选 {addTaskType === 'sync' ? selectedTasks.length : selectedEtlTasks.length} 个任务
                </Text>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  size="small"
                  loading={adding}
                  disabled={adding}
                  onClick={() => {
                    setCronPopoverOpen(false)
                    handleCreateSchedules(false)
                  }}
                  style={{
                    height: 26,
                    padding: '0 12px',
                    borderRadius: 13,
                    fontSize: 12,
                    fontWeight: 400,
                    border: '1px solid #d9d9d9',
                    boxShadow: 'none',
                  }}
                >
                  保存
                </Button>
                <Button
                  size="small"
                  type="primary"
                  loading={adding}
                  disabled={adding}
                  onClick={() => {
                    setCronPopoverOpen(false)
                    handleCreateSchedules(true)
                  }}
                  style={{
                    height: 26,
                    padding: '0 12px',
                    borderRadius: 13,
                    fontSize: 12,
                    fontWeight: 400,
                    background: adding ? undefined : '#34c759',
                    border: 'none',
                    boxShadow: 'none',
                  }}
                >
                  <PlayCircleOutlined style={{ fontSize: 11 }} /> 上线
                </Button>
              </div>
            </div>
            {/* Content */}
            <div style={{ padding: 16 }}>
              <CronExpressionInput
                value={addCronExpression}
                onChange={(v) => setAddCronExpression(v)}
              />
            </div>
          </div>
        </>
      )}

      {/* Enable Schedule Modal */}
      <Modal
        title={
          <Space>
            <ScheduleOutlined />
            <span>上线调度 - {selectedSchedule?.name}</span>
          </Space>
        }
        open={enableModalVisible}
        onCancel={() => setEnableModalVisible(false)}
        onOk={handleEnable}
        confirmLoading={enabling}
        okText="确定上线"
        width={550}
      >
        <Alert
          message="上线后将生成 Airflow DAG 并开始定时执行"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <div style={{ marginBottom: 8 }}>
          <Text strong>调度信息：</Text>
        </div>
        <Space direction="vertical" style={{ marginBottom: 16, width: '100%' }}>
          <Text>同步任务：<Tag color="blue">{selectedSchedule?.sync_task_name}</Tag></Text>
          <Text>源表：<Tag>{selectedSchedule?.source_table}</Tag></Text>
          <Text>目标表：<Tag color="gold">{selectedSchedule?.target_table}</Tag></Text>
          <Text>Cron 表达式：<Text code>{selectedSchedule?.cron_expression}</Text></Text>
        </Space>
      </Modal>

      {/* View Schedule Modal */}
      <Modal
        title={
          <Space>
            <EyeOutlined />
            <span>调度详情</span>
          </Space>
        }
        open={viewModalVisible}
        onCancel={() => setViewModalVisible(false)}
        footer={<Button onClick={() => setViewModalVisible(false)}>关闭</Button>}
        width={650}
      >
        {viewSchedule && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="调度名称" span={2}>{viewSchedule.name}</Descriptions.Item>
            <Descriptions.Item label="描述" span={2}>{viewSchedule.description || '-'}</Descriptions.Item>
            <Descriptions.Item label="同步任务">{viewSchedule.sync_task_name}</Descriptions.Item>
            <Descriptions.Item label="同步模式">{viewSchedule.sync_mode}</Descriptions.Item>
            <Descriptions.Item label="源表">{viewSchedule.source_table}</Descriptions.Item>
            <Descriptions.Item label="目标表">{viewSchedule.target_table}</Descriptions.Item>
            <Descriptions.Item label="Cron 表达式">
              <Text code>{viewSchedule.cron_expression}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {viewSchedule.is_enabled ? (
                <Tag icon={<CheckCircleOutlined />} color="green">已上线</Tag>
              ) : (
                <Tag>未上线</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="DAG ID">{viewSchedule.dag_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="Airflow 状态">{viewSchedule.airflow_status || '-'}</Descriptions.Item>
            <Descriptions.Item label="下次执行">
              {viewSchedule.next_run_time ? new Date(viewSchedule.next_run_time).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="上次执行">
              {viewSchedule.last_run_time ? new Date(viewSchedule.last_run_time).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="上次同步">
              {viewSchedule.last_sync_at ? new Date(viewSchedule.last_sync_at).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="同步行数">{viewSchedule.last_sync_rows ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="创建人">{viewSchedule.creator_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Date(viewSchedule.created_at).toLocaleString()}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* Edit Schedule Modal */}
      <Modal
        title={
          <Space>
            <EditOutlined />
            <span>编辑调度</span>
          </Space>
        }
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={handleSaveEdit}
        confirmLoading={editing}
        okText="保存"
        width={600}
      >
        <div style={{ marginBottom: 8 }}>
          <Text strong>调度名称：</Text>
        </div>
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="请输入调度名称"
          style={{ marginBottom: 16 }}
        />

        <div style={{ marginBottom: 8 }}>
          <Text strong>描述：</Text>
        </div>
        <Input
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          placeholder="请输入调度描述"
          style={{ marginBottom: 16 }}
        />

        <div style={{ marginBottom: 8 }}>
          <Text strong>Cron 表达式：</Text>
        </div>
        <CronExpressionInput
          value={editCron}
          onChange={(v) => setEditCron(v)}
        />

        {editSchedule?.is_enabled && (
          <Alert
            message="已上线的调度修改 Cron 后需重新上线才能生效"
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
          />
        )}
      </Modal>

      {/* ETL View Modal */}
      <Modal
        title={
          <Space>
            <EyeOutlined />
            <span>ETL任务详情</span>
          </Space>
        }
        open={etlViewModalVisible}
        onCancel={() => setEtlViewModalVisible(false)}
        footer={<Button onClick={() => setEtlViewModalVisible(false)}>关闭</Button>}
        width={650}
      >
        {viewingEtl && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="任务名称" span={2}>{viewingEtl.name}</Descriptions.Item>
            <Descriptions.Item label="描述" span={2}>{viewingEtl.description || '-'}</Descriptions.Item>
            <Descriptions.Item label="SQL预览" span={2}>
              <Text code style={{ fontSize: 11 }}>{viewingEtl.taskDetail}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Cron 表达式">
              <Text code>{viewingEtl.cron_expression}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {viewingEtl.is_enabled ? (
                <Tag icon={<CheckCircleOutlined />} color="green">已上线</Tag>
              ) : (
                <Tag>未上线</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="DAG ID">{viewingEtl.dag_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="Airflow 状态">{viewingEtl.airflow_status || '-'}</Descriptions.Item>
            <Descriptions.Item label="上次执行">
              {viewingEtl.last_run_at ? new Date(viewingEtl.last_run_at).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="影响行数">{viewingEtl.last_run_rows ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间" span={2}>
              {new Date(viewingEtl.created_at).toLocaleString()}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* ETL Edit Modal */}
      <Modal
        title={
          <Space>
            <EditOutlined />
            <span>编辑ETL调度</span>
          </Space>
        }
        open={etlEditModalVisible}
        onCancel={() => setEtlEditModalVisible(false)}
        onOk={handleEtlSaveEdit}
        confirmLoading={etlEnabling === editingEtl?.id}
        okText="保存"
        width={600}
      >
        <Alert
          message="修改Cron表达式将会重新部署DAG"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <div style={{ marginBottom: 8 }}>
          <Text strong>任务名称：</Text>
          <Text style={{ marginLeft: 8 }}>{editingEtl?.name}</Text>
        </div>
        <div style={{ marginBottom: 16 }}>
          <Text strong>SQL预览：</Text>
          <div style={{ marginTop: 4 }}>
            <Text code style={{ fontSize: 11 }}>{editingEtl?.taskDetail}</Text>
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <Text strong>Cron 表达式：</Text>
        </div>
        <CronExpressionInput
          value={etlEditCron}
          onChange={(v) => setEtlEditCron(v)}
        />
      </Modal>

      {/* ETL Enable Modal */}
      <Modal
        title={
          <Space>
            <ScheduleOutlined />
            <span>上线ETL任务 - {enablingEtl?.name}</span>
          </Space>
        }
        open={etlEnableModalVisible}
        onCancel={() => setEtlEnableModalVisible(false)}
        onOk={handleEtlEnable}
        confirmLoading={etlEnabling === enablingEtl?.id}
        okText="确定上线"
        width={550}
      >
        <Alert
          message="上线后将生成 Airflow DAG 并开始定时执行"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <div style={{ marginBottom: 8 }}>
          <Text strong>任务信息：</Text>
        </div>
        <Space direction="vertical" style={{ marginBottom: 16, width: '100%' }}>
          <Text>任务名称：<Tag color="purple">{enablingEtl?.name}</Tag></Text>
          <Text>SQL预览：<Text code style={{ fontSize: 11 }}>{enablingEtl?.taskDetail}</Text></Text>
        </Space>
        <div style={{ marginBottom: 8 }}>
          <Text strong>Cron 表达式：</Text>
        </div>
        <CronExpressionInput
          value={etlEditCron}
          onChange={(v) => setEtlEditCron(v)}
        />
      </Modal>

      {/* 标签调度编辑弹框 */}
      <Modal
        title={`编辑调度 - ${editingTagSchedule?.name || ''}`}
        open={tagEditModalVisible}
        onCancel={() => setTagEditModalVisible(false)}
        onOk={handleTagEdit}
        okText="保存"
        width={550}
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <Text strong>任务信息</Text>
            <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
              <div>调度名称：{editingTagSchedule?.name}</div>
              <div>DAG ID：{editingTagSchedule?.dag_id}</div>
              <div>状态：{editingTagSchedule?.is_enabled ? '已上线' : '未上线'}</div>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <Text strong>调度时间</Text>
          </div>
          <CronExpressionInput
            value={tagEditCron}
            onChange={(v) => setTagEditCron(v)}
          />
        </div>
      </Modal>

      </Content>
    </Layout>
  )
}
