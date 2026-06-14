/**
 * AI 对话打标面板组件
 * 迭代累积模式：每次对话给出一个数据方案，确认后累积，最终生成宽表
 */
import React, { useState, useRef, useEffect } from 'react'
import {
  Button,
  Input,
  Space,
  Tag,
  Typography,
  Spin,
  message,
  Divider,
  Alert,
  Card,
  List,
} from 'antd'
import {
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  TableOutlined,
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import { tagApi } from '../services/api'

const { Text, Paragraph } = Typography
const { TextArea } = Input

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface DataSchema {
  name: string
  description?: string
  table: string
  fields: string[]
  join_key?: string
}

interface TaskInfo {
  name: string
  description: string
  tables: string[]
  tagTableName?: string  // AI生成的目标表名
}

interface AIChatPanelProps {
  tableName?: string  // 为空时为全库模式
  onSqlConfirmed: (sql: string, tags: string[], taskInfo: TaskInfo) => void
  onCancel: () => void
}

const AIChatPanel: React.FC<AIChatPanelProps> = ({
  tableName,
  onSqlConfirmed,
}) => {
  const isFullDbMode = !tableName
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)

  // 新增：方案相关状态
  const [currentSchema, setCurrentSchema] = useState<DataSchema | null>(null)
  const [confirmedSchemas, setConfirmedSchemas] = useState<DataSchema[]>([])
  const [generatedSql, setGeneratedSql] = useState<string | null>(null)
  const [sqlConfirmed, setSqlConfirmed] = useState(false)
  const [aiTaskName, setAiTaskName] = useState<string | null>(null)
  const [aiTaskDesc, setAiTaskDesc] = useState<string | null>(null)
  const [aiTableName, setAiTableName] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 单表模式：进入时立即创建会话
  useEffect(() => {
    if (tableName) {
      initSession()
    }
    // 清理会话
    return () => {
      if (sessionId) {
        tagApi.deleteChatSession(sessionId).catch(() => {})
      }
    }
  }, [tableName])

  // 创建会话
  const initSession = async (firstMessage?: string) => {
    try {
      setLoading(true)
      // 传入用户的第一条消息，让 AI 直接回应
      const res = await tagApi.createChatSession(tableName, firstMessage)
      setSessionId(res.data.session_id)

      if (firstMessage) {
        // 有用户消息：显示用户消息 + AI 回复
        setMessages([
          { role: 'user', content: firstMessage },
          { role: 'assistant', content: res.data.initial_message },
        ])
      } else {
        // 无用户消息（单表模式自动进入）：只显示 AI 开场
        setMessages([
          { role: 'assistant', content: res.data.initial_message },
        ])
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建对话失败')
    } finally {
      setLoading(false)
    }
  }

  // 发送消息
  const handleSend = async () => {
    if (!inputValue.trim() || loading) return

    const userMessage = inputValue.trim()
    setInputValue('')
    setCurrentSchema(null) // 清除上一个待确认方案

    // 全库模式：第一次发消息时创建会话
    if (isFullDbMode && !sessionId) {
      setMessages([{ role: 'user', content: userMessage }])
      await initSession(userMessage)
      return
    }

    if (!sessionId) return

    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await tagApi.sendChatMessage(sessionId, userMessage)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.data.reply },
      ])

      // 检查返回的内容
      if (res.data.schema) {
        // AI 返回了一个方案
        setCurrentSchema(res.data.schema)
      } else if (res.data.is_final && res.data.generated_sql) {
        // AI 生成了最终宽表 SQL
        setGeneratedSql(res.data.generated_sql)
        setAiTaskName(res.data.task_name || null)
        setAiTaskDesc(res.data.task_desc || null)
        setAiTableName(res.data.table_name || null)
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '发送消息失败')
    } finally {
      setLoading(false)
    }
  }

  // 确认方案
  const handleConfirmSchema = async () => {
    if (!currentSchema || !sessionId) return

    try {
      await tagApi.confirmSchema(sessionId, currentSchema)
      setConfirmedSchemas((prev) => [...prev, currentSchema])
      setCurrentSchema(null)
      message.success(`方案「${currentSchema.name}」已确认`)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '确认方案失败')
    }
  }

  // 移除已确认的方案
  const handleRemoveSchema = async (index: number) => {
    if (!sessionId) return

    try {
      await tagApi.removeSchema(sessionId, index)
      setConfirmedSchemas((prev) => prev.filter((_, i) => i !== index))
      message.success('方案已移除')
    } catch (error: any) {
      message.error(error.response?.data?.detail || '移除方案失败')
    }
  }

  // 请求生成宽表
  const handleGenerateWideTable = async () => {
    if (confirmedSchemas.length === 0) {
      message.warning('请先确认至少一个方案')
      return
    }

    const prompt = '请根据已确认的所有方案，生成一个完整的宽表SQL，将所有数据整合在一起。'
    setInputValue(prompt)
    // 触发发送
    setMessages((prev) => [...prev, { role: 'user', content: prompt }])
    setLoading(true)

    try {
      const res = await tagApi.sendChatMessage(sessionId!, prompt)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.data.reply },
      ])

      if (res.data.is_final && res.data.generated_sql) {
        setGeneratedSql(res.data.generated_sql)
        setAiTaskName(res.data.task_name || null)
        setAiTaskDesc(res.data.task_desc || null)
        setAiTableName(res.data.table_name || null)
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '生成宽表失败')
    } finally {
      setLoading(false)
      setInputValue('')
    }
  }

  // 确认最终 SQL
  const handleConfirmSql = () => {
    if (generatedSql) {
      setSqlConfirmed(true)
      // 提取方案名称作为标签
      const tags = confirmedSchemas.map((s) => s.name)
      // 使用 AI 生成的任务信息
      const tables = [...new Set(confirmedSchemas.map((s) => s.table))]
      const taskInfo: TaskInfo = {
        name: aiTaskName || (confirmedSchemas.length > 0
          ? confirmedSchemas.map((s) => s.name).join(' + ')
          : '数据分析任务'),
        description: aiTaskDesc || confirmedSchemas.map((s) => s.description || s.name).join('；'),
        tables: tables,
        tagTableName: aiTableName || undefined,  // AI 生成的目标表名
      }
      onSqlConfirmed(generatedSql, tags, taskInfo)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 520 }}>
      {/* 已确认方案列表 */}
      {confirmedSchemas.length > 0 && (
        <Card
          size="small"
          title={
            <Space>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              <span>已确认的方案（{confirmedSchemas.length}）</span>
            </Space>
          }
          style={{ marginBottom: 12 }}
          extra={
            !generatedSql && (
              <Button
                type="primary"
                size="small"
                icon={<TableOutlined />}
                onClick={handleGenerateWideTable}
                disabled={loading}
              >
                生成宽表
              </Button>
            )
          }
        >
          <List
            size="small"
            dataSource={confirmedSchemas}
            renderItem={(schema, index) => (
              <List.Item
                actions={[
                  !sqlConfirmed && (
                    <Button
                      key="delete"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemoveSchema(index)}
                    />
                  ),
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Tag color="blue">{schema.table}</Tag>
                      <Text strong>{schema.name}</Text>
                    </Space>
                  }
                  description={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      字段：{schema.fields.join(', ')}
                      {schema.join_key && ` | 关联键：${schema.join_key}`}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* 消息列表 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          background: '#fafafa',
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            {isFullDbMode
              ? '描述您的业务场景，AI 助手将智能理解需求并自动生成数据方案'
              : '正在加载...'}
          </div>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              marginBottom: 16,
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: msg.role === 'user' ? '#1890ff' : '#52c41a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                flexShrink: 0,
              }}
            >
              {msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
            </div>
            <div
              style={{
                maxWidth: '80%',
                marginLeft: msg.role === 'user' ? 0 : 12,
                marginRight: msg.role === 'user' ? 12 : 0,
                padding: '10px 14px',
                background: msg.role === 'user' ? '#1890ff' : '#fff',
                color: msg.role === 'user' ? '#fff' : '#333',
                borderRadius: 8,
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
              }}
            >
              <Paragraph
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  color: msg.role === 'user' ? '#fff' : '#333',
                }}
              >
                {msg.content}
              </Paragraph>
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', marginBottom: 16 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#52c41a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <RobotOutlined />
            </div>
            <div
              style={{
                marginLeft: 12,
                padding: '10px 14px',
                background: '#fff',
                borderRadius: 8,
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
              }}
            >
              <Spin size="small" />
              <Text style={{ marginLeft: 8, color: '#999' }}>
                {isFullDbMode && !sessionId ? 'AI 正在分析数据...' : 'AI 思考中...'}
              </Text>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 待确认的方案 */}
      {currentSchema && !generatedSql && (
        <Alert
          type="info"
          style={{ marginBottom: 12 }}
          message={
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Space>
                  <PlusOutlined style={{ color: '#1890ff' }} />
                  <Text strong>AI 推荐方案：{currentSchema.name}</Text>
                </Space>
                <Button type="primary" size="small" onClick={handleConfirmSchema}>
                  确认该方案
                </Button>
              </div>
              <div style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12 }}>
                <div><Text type="secondary">表：</Text> <Tag>{currentSchema.table}</Tag></div>
                <div><Text type="secondary">字段：</Text> {currentSchema.fields.join(', ')}</div>
                {currentSchema.join_key && (
                  <div><Text type="secondary">关联键：</Text> {currentSchema.join_key}</div>
                )}
                {currentSchema.description && (
                  <div><Text type="secondary">说明：</Text> {currentSchema.description}</div>
                )}
              </div>
            </div>
          }
        />
      )}

      {/* 生成的宽表 SQL */}
      {generatedSql && (
        <Alert
          type="success"
          style={{ marginBottom: 12 }}
          message={
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Space>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  <Text strong>AI 已生成宽表</Text>
                  {sqlConfirmed && <Tag color="success">已确认</Tag>}
                </Space>
                {!sqlConfirmed && (
                  <Button type="primary" size="small" onClick={handleConfirmSql}>
                    确认使用
                  </Button>
                )}
              </div>
              <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden' }}>
                <Editor
                  height={120}
                  language="sql"
                  theme="vs-dark"
                  value={generatedSql}
                  onChange={(v) => setGeneratedSql(v || '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: 'off',
                    readOnly: sqlConfirmed,
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
            </div>
          }
        />
      )}

      {/* 输入框 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <TextArea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={isFullDbMode ? '描述您的业务场景...' : '继续对话...'}
          autoSize={{ minRows: 2, maxRows: 3 }}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          disabled={loading || sqlConfirmed}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={loading}
          disabled={!inputValue.trim() || sqlConfirmed}
          style={{ height: 'auto' }}
        >
          发送
        </Button>
      </div>

      {sqlConfirmed && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <div style={{ textAlign: 'right' }}>
            <Text type="secondary">宽表已确认，点击"下一步"保存任务</Text>
          </div>
        </>
      )}
    </div>
  )
}

export default AIChatPanel
