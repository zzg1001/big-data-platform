-- 数据服务 API 密钥表
-- 用于存储外部访问的 API 密钥

CREATE TABLE IF NOT EXISTS big_api_keys (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,

    -- 密钥基本信息
    name VARCHAR(100) NOT NULL COMMENT '密钥名称',
    description VARCHAR(500) COMMENT '密钥描述',

    -- 密钥凭证
    key_prefix VARCHAR(16) NOT NULL COMMENT '密钥前缀，用于识别 (bdk_xxxx****)',
    key_hash VARCHAR(255) NOT NULL COMMENT '密钥 SHA256 哈希',

    -- 权限范围
    scope_type VARCHAR(20) DEFAULT 'all' COMMENT '权限范围: all, project, tag',
    scope_ids TEXT COMMENT 'JSON数组，授权的项目/标签ID',

    -- 访问限制
    rate_limit INT DEFAULT 1000 COMMENT '每小时请求限制',

    -- 有效期
    expires_at DATETIME COMMENT '过期时间，NULL为永不过期',

    -- 状态与统计
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at DATETIME COMMENT '最后使用时间',
    total_requests BIGINT DEFAULT 0 COMMENT '总请求次数',

    -- 审计
    created_by BIGINT COMMENT '创建人ID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_api_key_prefix (key_prefix),
    INDEX idx_api_key_hash (key_hash),
    INDEX idx_api_key_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据服务 API 密钥表';


-- API 访问日志表
CREATE TABLE IF NOT EXISTS big_api_access_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,

    -- 关联密钥
    api_key_id BIGINT COMMENT '关联的API密钥ID',

    -- 请求信息
    endpoint VARCHAR(255) NOT NULL COMMENT '访问端点',
    method VARCHAR(10) NOT NULL COMMENT 'HTTP方法',
    request_params TEXT COMMENT '请求参数JSON',

    -- 响应信息
    status_code INT NOT NULL COMMENT 'HTTP状态码',
    response_time_ms INT COMMENT '响应时间(毫秒)',
    row_count INT COMMENT '返回数据行数',

    -- 来源信息
    client_ip VARCHAR(45) COMMENT '客户端IP',
    user_agent VARCHAR(500) COMMENT 'User-Agent',

    -- 时间
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_access_log_key (api_key_id),
    INDEX idx_access_log_time (created_at),
    INDEX idx_access_log_endpoint (endpoint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='API 访问日志表';
