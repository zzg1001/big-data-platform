"""
标签管理平台 API
统一的树形结构管理
"""
import json
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, text

from app.core.database import get_db
from app.api.deps import get_current_user
from app.api.v1.warehouse import get_warehouse_engine
from app.models.user import User
from app.models.tag import TagNode, TagData
from app.models.datasource import DataSource
from app.schemas.tag import (
    TagNodeCreate, TagNodeUpdate, TagNodeResponse, TagNodeTree,
    TagDataCreate, TagDataResponse,
    RuleTagCreate, RowTagTaskCreate, RowTagTaskExecute, DatasetTagCreate,
    TagStatistics
)
from app.services.ai_assistant import AIAssistant

router = APIRouter()


# ==================== 标签节点 CRUD ====================

@router.get("/nodes", response_model=List[TagNodeResponse])
async def list_tag_nodes(
    parent_id: Optional[int] = None,
    node_type: Optional[str] = None,
    keyword: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取标签节点列表"""
    query = select(TagNode).filter(TagNode.is_active == True)

    if parent_id is not None:
        query = query.filter(TagNode.parent_id == parent_id)
    elif parent_id is None and not keyword:
        # 默认只返回顶级节点
        query = query.filter(TagNode.parent_id == None)

    if node_type:
        query = query.filter(TagNode.node_type == node_type)

    if keyword:
        query = query.filter(TagNode.name.ilike(f"%{keyword}%"))

    query = query.order_by(TagNode.sort_order, TagNode.id)
    result = await db.execute(query)
    nodes = result.scalars().all()

    responses = []
    for node in nodes:
        # 获取父节点名称
        parent_name = None
        if node.parent_id:
            parent_result = await db.execute(select(TagNode).filter(TagNode.id == node.parent_id))
            parent = parent_result.scalars().first()
            if parent:
                parent_name = parent.name

        # 获取子节点数量
        children_result = await db.execute(
            select(func.count(TagNode.id)).filter(TagNode.parent_id == node.id)
        )
        children_count = children_result.scalar() or 0

        responses.append(TagNodeResponse(
            id=node.id,
            name=node.name,
            description=node.description,
            node_type=node.node_type,
            parent_id=node.parent_id,
            path=node.path,
            level=node.level,
            color=node.color,
            icon=node.icon,
            sort_order=node.sort_order,
            rule_type=node.rule_type,
            rule_config=node.rule_config,
            tag_table_name=node.tag_table_name,
            source_datasource_id=node.source_datasource_id,
            source_table=node.source_table,
            ai_generated=node.ai_generated,
            ai_confidence=node.ai_confidence,
            usage_count=node.usage_count,
            is_active=node.is_active,
            created_at=node.created_at,
            updated_at=node.updated_at,
            parent_name=parent_name,
            children_count=children_count
        ))

    return responses


@router.get("/tree", response_model=List[TagNodeTree])
async def get_tag_tree(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取完整的标签树"""
    result = await db.execute(
        select(TagNode)
        .filter(TagNode.is_active == True)
        .order_by(TagNode.sort_order, TagNode.id)
    )
    all_nodes = result.scalars().all()

    # 构建树
    node_map = {}
    for node in all_nodes:
        node_map[node.id] = {
            "id": node.id,
            "name": node.name,
            "description": node.description,
            "node_type": node.node_type,
            "color": node.color,
            "icon": node.icon,
            "level": node.level,
            "usage_count": node.usage_count,
            "rule_type": node.rule_type,
            "parent_id": node.parent_id,
            "children": []
        }

    # 组装树形结构
    root_nodes = []
    for node_id, node_data in node_map.items():
        parent_id = node_data.pop("parent_id")
        if parent_id and parent_id in node_map:
            node_map[parent_id]["children"].append(node_data)
        else:
            root_nodes.append(node_data)

    return root_nodes


@router.post("/nodes", response_model=TagNodeResponse)
async def create_tag_node(
    data: TagNodeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建标签节点
    层级规则:
    - category(分类): 下面可放 category/type/tag
    - type(类型): 下面只能放 tag
    - tag(标签): 下面不能放任何节点
    """
    # 计算层级和路径
    level = 1
    path = ""
    parent_name = None

    if data.parent_id:
        result = await db.execute(select(TagNode).filter(TagNode.id == data.parent_id))
        parent = result.scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="父节点不存在")

        # 层级规则验证
        if parent.node_type == "tag":
            raise HTTPException(status_code=400, detail="标签下不能再添加子节点")
        if parent.node_type == "type" and data.node_type != "tag":
            raise HTTPException(status_code=400, detail="类型下只能添加标签")

        level = parent.level + 1
        path = f"{parent.path or ''}/{parent.id}"
        parent_name = parent.name

    # 检查同级同名
    check_query = select(TagNode).filter(
        TagNode.name == data.name,
        TagNode.parent_id == data.parent_id,
        TagNode.is_active == True
    )
    result = await db.execute(check_query)
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="同级下已存在同名节点")

    node = TagNode(
        name=data.name,
        description=data.description,
        node_type=data.node_type,
        parent_id=data.parent_id,
        level=level,
        path=path,
        color=data.color,
        icon=data.icon,
        sort_order=data.sort_order,
        created_by=current_user.id
    )
    db.add(node)
    await db.flush()

    # 更新path包含自己的id
    node.path = f"{path}/{node.id}" if path else f"/{node.id}"
    await db.flush()
    await db.refresh(node)

    return TagNodeResponse(
        id=node.id,
        name=node.name,
        description=node.description,
        node_type=node.node_type,
        parent_id=node.parent_id,
        path=node.path,
        level=node.level,
        color=node.color,
        icon=node.icon,
        sort_order=node.sort_order,
        rule_type=node.rule_type,
        rule_config=node.rule_config,
        tag_table_name=node.tag_table_name,
        source_datasource_id=node.source_datasource_id,
        source_table=node.source_table,
        ai_generated=node.ai_generated,
        ai_confidence=node.ai_confidence,
        usage_count=node.usage_count,
        is_active=node.is_active,
        created_at=node.created_at,
        updated_at=node.updated_at,
        parent_name=parent_name,
        children_count=0
    )


@router.put("/nodes/{node_id}", response_model=TagNodeResponse)
async def update_tag_node(
    node_id: int,
    data: TagNodeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新标签节点"""
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")

    # 如果修改了父节点，需要重新计算层级和路径
    if data.parent_id is not None and data.parent_id != node.parent_id:
        if data.parent_id == node_id:
            raise HTTPException(status_code=400, detail="不能将自己设为父节点")

        if data.parent_id:
            parent_result = await db.execute(select(TagNode).filter(TagNode.id == data.parent_id))
            parent = parent_result.scalars().first()
            if not parent:
                raise HTTPException(status_code=404, detail="父节点不存在")
            node.level = parent.level + 1
            node.path = f"{parent.path}/{node.id}"
        else:
            node.level = 1
            node.path = f"/{node.id}"

    for key, value in data.model_dump(exclude_unset=True).items():
        if key != "parent_id" or data.parent_id is not None:
            setattr(node, key, value)

    await db.flush()
    await db.refresh(node)

    # 获取父节点名称
    parent_name = None
    if node.parent_id:
        parent_result = await db.execute(select(TagNode).filter(TagNode.id == node.parent_id))
        parent = parent_result.scalars().first()
        if parent:
            parent_name = parent.name

    # 获取子节点数量
    children_result = await db.execute(
        select(func.count(TagNode.id)).filter(TagNode.parent_id == node.id)
    )
    children_count = children_result.scalar() or 0

    return TagNodeResponse(
        id=node.id,
        name=node.name,
        description=node.description,
        node_type=node.node_type,
        parent_id=node.parent_id,
        path=node.path,
        level=node.level,
        color=node.color,
        icon=node.icon,
        sort_order=node.sort_order,
        rule_type=node.rule_type,
        rule_config=node.rule_config,
        tag_table_name=node.tag_table_name,
        source_datasource_id=node.source_datasource_id,
        source_table=node.source_table,
        ai_generated=node.ai_generated,
        ai_confidence=node.ai_confidence,
        usage_count=node.usage_count,
        is_active=node.is_active,
        created_at=node.created_at,
        updated_at=node.updated_at,
        parent_name=parent_name,
        children_count=children_count
    )


@router.delete("/nodes/{node_id}")
async def delete_tag_node(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除标签节点（包括所有子节点）"""
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")

    # 查找所有子孙节点（通过path前缀）
    path_prefix = node.path or f"/{node_id}"
    await db.execute(
        delete(TagNode).where(TagNode.path.like(f"{path_prefix}%"))
    )
    await db.delete(node)
    await db.flush()

    return {"message": "删除成功"}


# ==================== 标签数据 ====================

@router.get("/data", response_model=List[TagDataResponse])
async def list_tag_data(
    tag_node_id: Optional[int] = None,
    datasource_id: Optional[int] = None,
    table_name: Optional[str] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取标签数据"""
    query = select(TagData)

    if tag_node_id:
        query = query.filter(TagData.tag_node_id == tag_node_id)
    if datasource_id:
        query = query.filter(TagData.datasource_id == datasource_id)
    if table_name:
        query = query.filter(TagData.table_name == table_name)

    query = query.order_by(TagData.created_at.desc()).limit(limit)
    result = await db.execute(query)
    data_list = result.scalars().all()

    responses = []
    for data in data_list:
        # 获取标签名称
        tag_result = await db.execute(select(TagNode).filter(TagNode.id == data.tag_node_id))
        tag_node = tag_result.scalars().first()

        # 获取数据源名称
        ds_name = None
        if data.datasource_id:
            ds_result = await db.execute(select(DataSource).filter(DataSource.id == data.datasource_id))
            ds = ds_result.scalars().first()
            if ds:
                ds_name = ds.name

        responses.append(TagDataResponse(
            id=data.id,
            tag_node_id=data.tag_node_id,
            tag_name=tag_node.name if tag_node else None,
            datasource_id=data.datasource_id,
            datasource_name=ds_name,
            table_name=data.table_name,
            row_id=data.row_id,
            tagged_by=data.tagged_by,
            ai_confidence=data.ai_confidence,
            created_at=data.created_at
        ))

    return responses


@router.post("/data", response_model=TagDataResponse)
async def create_tag_data(
    data: TagDataCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建标签数据（打标）"""
    # 验证标签节点
    result = await db.execute(select(TagNode).filter(TagNode.id == data.tag_node_id))
    tag_node = result.scalars().first()
    if not tag_node:
        raise HTTPException(status_code=404, detail="标签节点不存在")
    if tag_node.node_type != "tag":
        raise HTTPException(status_code=400, detail="只能对标签类型节点打标")

    tag_data = TagData(
        tag_node_id=data.tag_node_id,
        datasource_id=data.datasource_id,
        table_name=data.table_name,
        row_id=data.row_id,
        tagged_by=data.tagged_by,
        created_by=current_user.id
    )
    db.add(tag_data)
    tag_node.usage_count += 1
    await db.flush()
    await db.refresh(tag_data)

    return TagDataResponse(
        id=tag_data.id,
        tag_node_id=tag_data.tag_node_id,
        tag_name=tag_node.name,
        datasource_id=tag_data.datasource_id,
        datasource_name=None,
        table_name=tag_data.table_name,
        row_id=tag_data.row_id,
        tagged_by=tag_data.tagged_by,
        ai_confidence=tag_data.ai_confidence,
        created_at=tag_data.created_at
    )


@router.delete("/data/{data_id}")
async def delete_tag_data(
    data_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除标签数据"""
    result = await db.execute(select(TagData).filter(TagData.id == data_id))
    tag_data = result.scalars().first()
    if not tag_data:
        raise HTTPException(status_code=404, detail="标签数据不存在")

    # 减少使用计数
    result = await db.execute(select(TagNode).filter(TagNode.id == tag_data.tag_node_id))
    tag_node = result.scalars().first()
    if tag_node and tag_node.usage_count > 0:
        tag_node.usage_count -= 1

    await db.delete(tag_data)
    await db.flush()
    return {"message": "删除成功"}


# ==================== 规则标签 ====================

@router.post("/rule-tag", response_model=TagNodeResponse)
async def create_rule_tag(
    data: RuleTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建规则标签（SQL逻辑保存为标签）"""
    import json

    # 计算层级和路径
    level = 1
    path = ""
    parent_name = None

    if data.parent_id:
        result = await db.execute(select(TagNode).filter(TagNode.id == data.parent_id))
        parent = result.scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="父节点不存在")
        level = parent.level + 1
        path = f"{parent.path or ''}/{parent.id}"
        parent_name = parent.name

    node = TagNode(
        name=data.name,
        description=data.description,
        node_type="tag",
        parent_id=data.parent_id,
        level=level,
        path=path,
        color=data.color,
        rule_type="sql",
        rule_config=json.dumps(data.rule_config.model_dump(), ensure_ascii=False),
        source_datasource_id=data.rule_config.datasource_id,
        source_table=data.rule_config.source_table,
        created_by=current_user.id
    )
    db.add(node)
    await db.flush()

    node.path = f"{path}/{node.id}" if path else f"/{node.id}"
    await db.flush()
    await db.refresh(node)

    return TagNodeResponse(
        id=node.id,
        name=node.name,
        description=node.description,
        node_type=node.node_type,
        parent_id=node.parent_id,
        path=node.path,
        level=node.level,
        color=node.color,
        icon=node.icon,
        sort_order=node.sort_order,
        rule_type=node.rule_type,
        rule_config=node.rule_config,
        tag_table_name=node.tag_table_name,
        source_datasource_id=node.source_datasource_id,
        source_table=node.source_table,
        ai_generated=node.ai_generated,
        ai_confidence=node.ai_confidence,
        usage_count=node.usage_count,
        is_active=node.is_active,
        created_at=node.created_at,
        updated_at=node.updated_at,
        parent_name=parent_name,
        children_count=0
    )


# ==================== 统计 ====================

@router.get("/statistics", response_model=TagStatistics)
async def get_tag_statistics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取标签统计"""
    # 总节点数
    result = await db.execute(select(func.count(TagNode.id)).filter(TagNode.is_active == True))
    total_nodes = result.scalar() or 0

    # 分类数
    result = await db.execute(
        select(func.count(TagNode.id)).filter(TagNode.node_type == "category", TagNode.is_active == True)
    )
    category_count = result.scalar() or 0

    # 标签数
    result = await db.execute(
        select(func.count(TagNode.id)).filter(TagNode.node_type == "tag", TagNode.is_active == True)
    )
    tag_count = result.scalar() or 0

    # 打标数据总量
    result = await db.execute(select(func.count(TagData.id)))
    total_tagged_data = result.scalar() or 0

    # AI生成数
    result = await db.execute(
        select(func.count(TagNode.id)).filter(TagNode.ai_generated == True, TagNode.is_active == True)
    )
    ai_generated_count = result.scalar() or 0

    # 规则标签数
    result = await db.execute(
        select(func.count(TagNode.id)).filter(TagNode.rule_type != None, TagNode.is_active == True)
    )
    rule_tag_count = result.scalar() or 0

    # Top标签
    result = await db.execute(
        select(TagNode.name, TagNode.usage_count)
        .filter(TagNode.node_type == "tag", TagNode.is_active == True)
        .order_by(TagNode.usage_count.desc())
        .limit(10)
    )
    top_tags = [{"name": name, "usage_count": count} for name, count in result.all()]

    return TagStatistics(
        total_nodes=total_nodes,
        category_count=category_count,
        tag_count=tag_count,
        total_tagged_data=total_tagged_data,
        ai_generated_count=ai_generated_count,
        rule_tag_count=rule_tag_count,
        top_tags=top_tags
    )


# ==================== 获取类型下的标签选项 ====================

@router.get("/types")
async def list_type_nodes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有类型节点（用于行级标签选择）"""
    result = await db.execute(
        select(TagNode)
        .filter(TagNode.node_type == "type", TagNode.is_active == True)
        .order_by(TagNode.sort_order, TagNode.id)
    )
    type_nodes = result.scalars().all()

    response = []
    for node in type_nodes:
        # 获取该类型下的所有标签
        tags_result = await db.execute(
            select(TagNode)
            .filter(TagNode.parent_id == node.id, TagNode.node_type == "tag", TagNode.is_active == True)
            .order_by(TagNode.sort_order, TagNode.id)
        )
        tags = tags_result.scalars().all()

        response.append({
            "id": node.id,
            "name": node.name,
            "description": node.description,
            "color": node.color,
            "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in tags]
        })

    return response


@router.get("/nodes/{node_id}/tags")
async def get_tags_under_type(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定类型节点下的所有标签"""
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")
    if node.node_type != "type":
        raise HTTPException(status_code=400, detail="只能获取类型节点下的标签")

    tags_result = await db.execute(
        select(TagNode)
        .filter(TagNode.parent_id == node_id, TagNode.node_type == "tag", TagNode.is_active == True)
        .order_by(TagNode.sort_order, TagNode.id)
    )
    tags = tags_result.scalars().all()

    return [{"id": t.id, "name": t.name, "color": t.color, "description": t.description} for t in tags]


# ==================== 行级标签 ====================

@router.post("/row-tag", response_model=TagNodeResponse)
async def create_row_tag_task(
    data: RowTagTaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建行级标签任务
    1. 验证每个标签字段绑定的类型节点
    2. 创建标签数据表（使用自定义字段名）
    3. 保存配置
    """
    # 验证标签字段配置
    tag_fields_info = []
    for field in data.tag_fields:
        result = await db.execute(select(TagNode).filter(TagNode.id == field.type_id))
        type_node = result.scalars().first()
        if not type_node:
            raise HTTPException(status_code=404, detail=f"类型节点 {field.type_id} 不存在")
        if type_node.node_type != "type":
            raise HTTPException(status_code=400, detail=f"节点 {type_node.name} 不是类型节点")

        # 获取该类型下的标签
        tags_result = await db.execute(
            select(TagNode)
            .filter(TagNode.parent_id == field.type_id, TagNode.node_type == "tag", TagNode.is_active == True)
        )
        tags = tags_result.scalars().all()
        if not tags:
            raise HTTPException(status_code=400, detail=f"类型 {type_node.name} 下没有定义标签")

        tag_fields_info.append({
            "field_name": field.name,
            "field_description": field.description,
            "type_id": type_node.id,
            "type_name": type_node.name,
            "tags": [{"id": t.id, "name": t.name} for t in tags]
        })

    # 计算层级和路径
    level = 1
    path = ""
    parent_name = None

    if data.parent_id:
        result = await db.execute(select(TagNode).filter(TagNode.id == data.parent_id))
        parent = result.scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="父节点不存在")
        level = parent.level + 1
        path = f"{parent.path or ''}/{parent.id}"
        parent_name = parent.name

    # 生成目标表名
    target_table = data.target_table
    if not target_table:
        safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', data.name.lower())
        target_table = f"tag_{safe_name}_{int(__import__('time').time())}"

    # 创建标签节点（记录任务）
    node = TagNode(
        name=data.name,
        description=data.description,
        node_type="category",  # 行级标签任务作为分类节点
        parent_id=data.parent_id,
        level=level,
        path=path,
        color=data.color,
        rule_type="row",
        rule_config=json.dumps({
            "source_columns": data.source_columns,
            "tag_fields": tag_fields_info,  # 新格式：包含字段名和绑定的类型
        }, ensure_ascii=False),
        source_datasource_id=data.datasource_id,
        source_table=data.source_table,
        tag_table_name=target_table,
        created_by=current_user.id
    )
    db.add(node)
    await db.flush()

    node.path = f"{path}/{node.id}" if path else f"/{node.id}"
    await db.flush()

    # 在平台仓库中创建标签表
    engine, _ = await get_warehouse_engine(db)

    # 构建CREATE TABLE语句
    columns_sql = []
    columns_sql.append("id BIGINT AUTO_INCREMENT PRIMARY KEY")
    columns_sql.append("source_row_id VARCHAR(255)")  # 原表行标识

    # 添加源字段
    for col in data.source_columns:
        columns_sql.append(f"`{col}` TEXT")

    # 添加标签字段（使用用户自定义的字段名）
    for field_info in tag_fields_info:
        safe_field_name = re.sub(r'[^a-zA-Z0-9_\u4e00-\u9fa5]', '_', field_info['field_name'])
        comment = f"标签字段，绑定类型: {field_info['type_name']}"
        if field_info.get('field_description'):
            comment = f"{field_info['field_description']}，绑定类型: {field_info['type_name']}"
        columns_sql.append(f"`{safe_field_name}` VARCHAR(255) COMMENT '{comment}'")

    columns_sql.append("ai_confidence INT")
    columns_sql.append("created_at DATETIME DEFAULT CURRENT_TIMESTAMP")

    create_sql = f"CREATE TABLE IF NOT EXISTS `{target_table}` ({', '.join(columns_sql)}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"

    with engine.connect() as conn:
        conn.execute(text(create_sql))
        conn.commit()

    await db.refresh(node)

    return TagNodeResponse(
        id=node.id,
        name=node.name,
        description=node.description,
        node_type=node.node_type,
        parent_id=node.parent_id,
        path=node.path,
        level=node.level,
        color=node.color,
        icon=node.icon,
        sort_order=node.sort_order,
        rule_type=node.rule_type,
        rule_config=node.rule_config,
        tag_table_name=node.tag_table_name,
        source_datasource_id=node.source_datasource_id,
        source_table=node.source_table,
        ai_generated=node.ai_generated,
        ai_confidence=node.ai_confidence,
        usage_count=node.usage_count,
        is_active=node.is_active,
        created_at=node.created_at,
        updated_at=node.updated_at,
        parent_name=parent_name,
        children_count=0
    )


@router.post("/row-tag/{node_id}/execute")
async def execute_row_tag(
    node_id: int,
    data: RowTagTaskExecute,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    执行行级标签AI打标
    读取源表数据，调用AI从预定义标签中选择，写入标签表
    """
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="标签节点不存在")
    if node.rule_type != "row":
        raise HTTPException(status_code=400, detail="该标签不是行级标签")

    # 解析配置
    config = json.loads(node.rule_config) if node.rule_config else {}
    source_columns = config.get("source_columns", [])
    tag_fields = config.get("tag_fields", [])

    if not source_columns or not tag_fields:
        raise HTTPException(status_code=400, detail="标签配置不完整")

    # 启动后台任务执行AI打标
    background_tasks.add_task(
        execute_ai_tagging_task,
        node_id=node.id,
        datasource_id=node.source_datasource_id,
        source_table=node.source_table,
        target_table=node.tag_table_name,
        source_columns=source_columns,
        tag_fields=tag_fields,
        batch_size=data.batch_size,
        ai_prompt=data.ai_prompt
    )

    return {"message": "AI打标任务已启动", "tag_node_id": node.id}


async def execute_ai_tagging_task(
    node_id: int,
    datasource_id: int,
    source_table: str,
    target_table: str,
    source_columns: list,
    tag_fields: list,  # [{field_name, field_description, type_id, type_name, tags: [{id, name}]}]
    batch_size: int = 100,
    ai_prompt: str = None
):
    """
    后台执行AI打标任务
    AI从预定义的标签中选择，不能自定义
    """
    from app.core.database import async_session_factory
    from app.services.datasource_service import DatasourceService

    # 获取源数据
    async with async_session_factory() as session:
        engine, _ = await get_warehouse_engine(session)

        if datasource_id:
            # 从外部数据源读取
            ds_service = DatasourceService(session)
            source_engine = await ds_service.get_engine(datasource_id)
            with source_engine.connect() as conn:
                cols_str = ", ".join([f"`{c}`" for c in source_columns])
                result = conn.execute(text(f"SELECT {cols_str} FROM `{source_table}` LIMIT 1000"))
                rows = result.fetchall()
                columns = result.keys()
        else:
            # 从平台仓库读取
            with engine.connect() as conn:
                cols_str = ", ".join([f"`{c}`" for c in source_columns])
                result = conn.execute(text(f"SELECT {cols_str} FROM `{source_table}` LIMIT 1000"))
                rows = result.fetchall()
                columns = list(result.keys())

    if not rows:
        return

    # 准备AI打标
    ai_assistant = AIAssistant()

    # 构建字段和标签选项说明
    field_names = []
    field_options_text = []
    for field_info in tag_fields:
        safe_field_name = re.sub(r'[^a-zA-Z0-9_\u4e00-\u9fa5]', '_', field_info['field_name'])
        field_names.append(safe_field_name)
        tag_options = ", ".join([f'"{t["name"]}"' for t in field_info['tags']])
        desc = field_info.get('field_description', '') or field_info['type_name']
        field_options_text.append(f"- {field_info['field_name']}({desc}): 只能从以下选项中选择一个 [{tag_options}]")

    # 批量处理
    processed = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]

        # 构建AI提示 - 强调只能从预定义标签中选择
        system_prompt = """你是一个数据标签专家。请根据数据内容为每条数据选择最合适的标签。
重要规则：
1. 每个字段只能从给定的选项中选择，不能自创标签
2. 如果数据不明确，选择最接近的标签
3. 只返回JSON格式，不要其他说明"""

        user_prompt = f"""
需要为每条数据选择标签，每个字段只能从对应的选项中选择：
{chr(10).join(field_options_text)}

数据字段：{', '.join(source_columns)}

请为每条数据选择标签，返回JSON数组格式：
[{{"row_index": 0, {', '.join([f'"{name}": "选中的标签"' for name in field_names])}}}, ...]

数据内容：
"""

        # 添加数据行
        data_lines = []
        for idx, row in enumerate(batch):
            row_dict = dict(zip(columns, row))
            data_lines.append(f"第{idx}行: {json.dumps(row_dict, ensure_ascii=False)}")

        user_prompt += "\n".join(data_lines)

        try:
            # 调用AI
            ai_response = ai_assistant._call_claude(system_prompt, user_prompt)

            # 解析AI响应
            json_match = re.search(r'\[[\s\S]*\]', ai_response)
            if json_match:
                tag_results = json.loads(json_match.group())

                # 写入标签表
                with engine.connect() as conn:
                    for tag_result in tag_results:
                        row_idx = tag_result.get('row_index', 0)
                        if row_idx < len(batch):
                            source_row = dict(zip(columns, batch[row_idx]))

                            # 构建INSERT语句
                            insert_cols = ['source_row_id'] + list(source_columns) + field_names + ['ai_confidence']
                            insert_vals = [str(processed + row_idx)]
                            insert_vals.extend([str(source_row.get(c, '')) for c in source_columns])
                            insert_vals.extend([str(tag_result.get(name, '')) for name in field_names])
                            insert_vals.append('80')  # AI置信度

                            placeholders = ', '.join(['%s'] * len(insert_vals))
                            cols_sql = ', '.join([f'`{c}`' for c in insert_cols])

                            conn.execute(
                                text(f"INSERT INTO `{target_table}` ({cols_sql}) VALUES ({placeholders})"),
                                insert_vals
                            )
                    conn.commit()
        except Exception as e:
            print(f"AI打标错误: {e}")
            continue

        processed += len(batch)

    # 更新标签节点的使用计数
    async with async_session_factory() as session:
        result = await session.execute(select(TagNode).filter(TagNode.id == node_id))
        node = result.scalars().first()
        if node:
            node.usage_count = processed
            await session.commit()


# ==================== 数据集标签 ====================

@router.post("/dataset-tag", response_model=TagNodeResponse)
async def create_dataset_tag(
    data: DatasetTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    从已打标数据创建数据集标签
    1. 根据选择的标签筛选数据
    2. 创建新表存储数据
    3. 创建新标签节点
    """
    # 验证源标签
    for tag_id in data.source_tag_ids:
        result = await db.execute(select(TagNode).filter(TagNode.id == tag_id))
        if not result.scalars().first():
            raise HTTPException(status_code=404, detail=f"标签 {tag_id} 不存在")

    # 计算层级和路径
    level = 1
    path = ""
    parent_name = None

    if data.parent_id:
        result = await db.execute(select(TagNode).filter(TagNode.id == data.parent_id))
        parent = result.scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="父节点不存在")
        level = parent.level + 1
        path = f"{parent.path or ''}/{parent.id}"
        parent_name = parent.name

    # 生成目标表名
    target_table = data.target_table
    if not target_table:
        safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', data.name.lower())
        target_table = f"dataset_{safe_name}_{int(__import__('time').time())}"

    engine, _ = await get_warehouse_engine(db)

    # 获取源标签的打标数据并合并
    # 构建UNION查询
    union_queries = []
    for tag_id in data.source_tag_ids:
        result = await db.execute(select(TagNode).filter(TagNode.id == tag_id))
        tag_node = result.scalars().first()
        if tag_node and tag_node.tag_table_name:
            union_queries.append(f"SELECT * FROM `{tag_node.tag_table_name}`")

    if union_queries:
        # 创建数据集表
        with engine.connect() as conn:
            # 首先获取表结构
            first_table = union_queries[0].replace("SELECT * FROM ", "").strip("`")
            desc_result = conn.execute(text(f"DESCRIBE `{first_table}`"))
            columns_info = desc_result.fetchall()

            # 创建新表
            columns_sql = []
            for col in columns_info:
                col_name, col_type = col[0], col[1]
                if col_name == 'id':
                    columns_sql.append("id BIGINT AUTO_INCREMENT PRIMARY KEY")
                else:
                    columns_sql.append(f"`{col_name}` {col_type}")

            columns_sql.append("dataset_tag_id BIGINT")  # 标记数据集标签

            create_sql = f"CREATE TABLE IF NOT EXISTS `{target_table}` ({', '.join(columns_sql)}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            conn.execute(text(create_sql))

            # 插入数据
            union_sql = " UNION ALL ".join(union_queries)
            if data.filter_condition:
                union_sql = f"SELECT * FROM ({union_sql}) AS combined WHERE {data.filter_condition}"

            # 获取列名（排除id）
            col_names = [c[0] for c in columns_info if c[0] != 'id']
            cols_str = ", ".join([f"`{c}`" for c in col_names])

            insert_sql = f"INSERT INTO `{target_table}` ({cols_str}) SELECT {cols_str} FROM ({union_sql}) AS src"
            conn.execute(text(insert_sql))
            conn.commit()

    # 创建标签节点
    node = TagNode(
        name=data.name,
        description=data.description,
        node_type="tag",
        parent_id=data.parent_id,
        level=level,
        path=path,
        color=data.color,
        rule_type="dataset",
        rule_config=json.dumps({
            "source_tag_ids": data.source_tag_ids,
            "filter_condition": data.filter_condition,
        }, ensure_ascii=False),
        tag_table_name=target_table,
        created_by=current_user.id
    )
    db.add(node)
    await db.flush()

    node.path = f"{path}/{node.id}" if path else f"/{node.id}"
    await db.flush()
    await db.refresh(node)

    return TagNodeResponse(
        id=node.id,
        name=node.name,
        description=node.description,
        node_type=node.node_type,
        parent_id=node.parent_id,
        path=node.path,
        level=node.level,
        color=node.color,
        icon=node.icon,
        sort_order=node.sort_order,
        rule_type=node.rule_type,
        rule_config=node.rule_config,
        tag_table_name=node.tag_table_name,
        source_datasource_id=node.source_datasource_id,
        source_table=node.source_table,
        ai_generated=node.ai_generated,
        ai_confidence=node.ai_confidence,
        usage_count=node.usage_count,
        is_active=node.is_active,
        created_at=node.created_at,
        updated_at=node.updated_at,
        parent_name=parent_name,
        children_count=0
    )


# ==================== 标签数据预览 ====================

@router.get("/nodes/{node_id}/preview")
async def preview_tag_data(
    node_id: int,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """预览标签的数据"""
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="标签节点不存在")

    if not node.tag_table_name:
        return {"columns": [], "rows": [], "total": 0}

    engine, _ = await get_warehouse_engine(db)

    with engine.connect() as conn:
        # 获取数据
        result = conn.execute(text(f"SELECT * FROM `{node.tag_table_name}` LIMIT {limit}"))
        columns = list(result.keys())
        rows = [list(row) for row in result.fetchall()]

        # 获取总数
        count_result = conn.execute(text(f"SELECT COUNT(*) FROM `{node.tag_table_name}`"))
        total = count_result.scalar() or 0

    return {
        "columns": columns,
        "rows": rows,
        "total": total
    }
