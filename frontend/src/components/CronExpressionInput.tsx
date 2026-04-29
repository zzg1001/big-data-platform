import { useState, useEffect, useCallback } from 'react'
import {
  Input,
  Button,
  Space,
  Tag,
  Tooltip,
  Modal,
  Typography,
  Spin,
  message,
} from 'antd'
import {
  RobotOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  SendOutlined,
  AppstoreOutlined,
} from '@ant-design/icons'
import { CronExpressionParser } from 'cron-parser'
import { aiApi } from '../services/api'

const { Text } = Typography

interface CronExpressionInputProps {
  value?: string
  onChange?: (value: string) => void
}

// Cron presets organized by category
const cronPresets = [
  {
    category: '每天',
    items: [
      { label: '凌晨0点', value: '0 0 * * *' },
      { label: '凌晨2点', value: '0 2 * * *' },
      { label: '早上6点', value: '0 6 * * *' },
      { label: '早上8点', value: '0 8 * * *' },
      { label: '中午12点', value: '0 12 * * *' },
      { label: '下午6点', value: '0 18 * * *' },
      { label: '晚上8点', value: '0 20 * * *' },
      { label: '晚上10点', value: '0 22 * * *' },
    ],
  },
  {
    category: '每小时',
    items: [
      { label: '每小时整点', value: '0 * * * *' },
      { label: '每2小时', value: '0 */2 * * *' },
      { label: '每3小时', value: '0 */3 * * *' },
      { label: '每4小时', value: '0 */4 * * *' },
      { label: '每6小时', value: '0 */6 * * *' },
      { label: '每8小时', value: '0 */8 * * *' },
      { label: '每12小时', value: '0 */12 * * *' },
    ],
  },
  {
    category: '分钟级',
    items: [
      { label: '每5分钟', value: '*/5 * * * *' },
      { label: '每10分钟', value: '*/10 * * * *' },
      { label: '每15分钟', value: '*/15 * * * *' },
      { label: '每20分钟', value: '*/20 * * * *' },
      { label: '每30分钟', value: '*/30 * * * *' },
    ],
  },
  {
    category: '每周',
    items: [
      { label: '周一凌晨2点', value: '0 2 * * 1' },
      { label: '周一早上8点', value: '0 8 * * 1' },
      { label: '周五晚上6点', value: '0 18 * * 5' },
      { label: '工作日早上8点', value: '0 8 * * 1-5' },
      { label: '工作日早上9点', value: '0 9 * * 1-5' },
      { label: '周末早上9点', value: '0 9 * * 0,6' },
      { label: '周末早上10点', value: '0 10 * * 0,6' },
    ],
  },
  {
    category: '每月',
    items: [
      { label: '1号凌晨0点', value: '0 0 1 * *' },
      { label: '1号凌晨2点', value: '0 2 1 * *' },
      { label: '15号凌晨2点', value: '0 2 15 * *' },
      { label: '最后一天凌晨0点', value: '0 0 L * *' },
      { label: '最后一天凌晨2点', value: '0 2 L * *' },
    ],
  },
]

export default function CronExpressionInput({
  value = '0 0 * * *',
  onChange,
}: CronExpressionInputProps) {
  const [cronValue, setCronValue] = useState(value)
  const [aiDescription, setAiDescription] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [nextRuns, setNextRuns] = useState<string[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [templateModalVisible, setTemplateModalVisible] = useState(false)

  // Parse cron expression and calculate next runs
  const calculateNextRuns = useCallback((cron: string) => {
    try {
      const interval = CronExpressionParser.parse(cron)
      const runs: string[] = []
      for (let i = 0; i < 5; i++) {
        const next = interval.next()
        runs.push(next.toDate().toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }))
      }
      setNextRuns(runs)
      setParseError(null)
    } catch (error) {
      setNextRuns([])
      setParseError('无效的 Cron 表达式')
    }
  }, [])

  // Update next runs when cron value changes
  useEffect(() => {
    if (cronValue) {
      calculateNextRuns(cronValue)
    }
  }, [cronValue, calculateNextRuns])

  // Sync with external value
  useEffect(() => {
    if (value !== cronValue) {
      setCronValue(value)
    }
  }, [value])

  const handleCronChange = (newValue: string) => {
    setCronValue(newValue)
    onChange?.(newValue)
  }

  const handlePresetClick = (presetValue: string) => {
    handleCronChange(presetValue)
    setTemplateModalVisible(false)
  }

  const handleAiGenerate = async () => {
    if (!aiDescription.trim()) {
      message.warning('请输入调度描述')
      return
    }

    setAiLoading(true)
    try {
      const res = await aiApi.generateCron({ description: aiDescription })
      const { cron_expression, explanation } = res.data
      handleCronChange(cron_expression)
      message.success(explanation || 'Cron 表达式已生成')
      setAiDescription('')
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'AI 生成失败')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Cron Expression Input */}
      <div style={{ marginBottom: 12 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={cronValue}
            onChange={(e) => handleCronChange(e.target.value)}
            placeholder="0 0 * * *"
            status={parseError ? 'error' : undefined}
            addonBefore={<ClockCircleOutlined />}
            style={{ fontFamily: 'monospace' }}
          />
          <Tooltip title="选择模板">
            <Button
              icon={<AppstoreOutlined />}
              onClick={() => setTemplateModalVisible(true)}
            >
              模板
            </Button>
          </Tooltip>
        </Space.Compact>
        {parseError && (
          <Text type="danger" style={{ fontSize: 12 }}>
            {parseError}
          </Text>
        )}
      </div>

      {/* AI Generation */}
      <div
        style={{
          background: '#f9f0ff',
          border: '1px solid #d3adf7',
          borderRadius: 6,
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <RobotOutlined style={{ color: '#722ed1', marginRight: 6 }} />
          <Text strong style={{ color: '#722ed1', fontSize: 13 }}>
            AI 智能生成
          </Text>
        </div>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={aiDescription}
            onChange={(e) => setAiDescription(e.target.value)}
            placeholder="例如：每天早上6点35分、每月最后一天、工作日每2小时"
            onPressEnter={handleAiGenerate}
            disabled={aiLoading}
            style={{ fontSize: 13 }}
          />
          <Button
            type="primary"
            icon={aiLoading ? <Spin size="small" /> : <SendOutlined />}
            onClick={handleAiGenerate}
            disabled={aiLoading || !aiDescription.trim()}
            style={{ background: '#722ed1', borderColor: '#722ed1' }}
          >
            生成
          </Button>
        </Space.Compact>
      </div>

      {/* Next Runs Preview */}
      {nextRuns.length > 0 && (
        <div
          style={{
            background: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: 6,
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <CalendarOutlined style={{ color: '#52c41a', marginRight: 6 }} />
            <Text strong style={{ color: '#52c41a', fontSize: 13 }}>
              未来 5 次执行时间
            </Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {nextRuns.map((run, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px 8px',
                  background: index === 0 ? '#d9f7be' : '#f6ffed',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: index === 0 ? '#52c41a' : '#b7eb8f',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 8,
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {index + 1}
                </span>
                <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{run}</Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Template Modal */}
      <Modal
        title={
          <span>
            <AppstoreOutlined style={{ marginRight: 8 }} />
            Cron 模板
          </span>
        }
        open={templateModalVisible}
        onCancel={() => setTemplateModalVisible(false)}
        footer={null}
        width={600}
      >
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          {cronPresets.map((category) => (
            <div key={category.category} style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#666',
                  marginBottom: 8,
                  borderBottom: '1px solid #f0f0f0',
                  paddingBottom: 4,
                }}
              >
                {category.category}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {category.items.map((item) => (
                  <Tooltip key={item.value} title={<code>{item.value}</code>}>
                    <Tag
                      color={cronValue === item.value ? 'purple' : 'default'}
                      style={{
                        cursor: 'pointer',
                        padding: '4px 12px',
                        fontSize: 13,
                      }}
                      onClick={() => handlePresetClick(item.value)}
                    >
                      {item.label}
                    </Tag>
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
