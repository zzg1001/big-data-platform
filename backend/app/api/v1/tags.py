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
from app.models.tag import TagNode, TagData, TagProject, TagDimension
from app.models.datasource import DataSource
from app.schemas.tag import (
    TagNodeCreate, TagNodeUpdate, TagNodeResponse, TagNodeTree,
    TagDataCreate, TagDataResponse,
    RuleTagCreate, RowTagTaskCreate, RowTagTaskExecute, DatasetTagCreate,
    TagStatistics,
    TagProjectCreate, TagProjectUpdate, TagProjectResponse,
    TagDimensionCreate, TagDimensionUpdate, TagDimensionResponse,
    BatchDimensionTagCreate, BatchDimensionTagResponse
)
from app.services.ai_assistant import AIAssistant

router = APIRouter()


# ==================== 标签项目 CRUD ====================

@router.get("/projects", response_model=List[TagProjectResponse])
async def list_tag_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有标签项目"""
    query = select(TagProject).filter(TagProject.is_active == True).order_by(TagProject.created_at.desc())
    result = await db.execute(query)
    projects = result.scalars().all()

    responses = []
    for project in projects:
        # 获取节点统计
        node_count_result = await db.execute(
            select(func.count(TagNode.id)).filter(
                TagNode.project_id == project.id,
                TagNode.is_active == True
            )
        )
        node_count = node_count_result.scalar() or 0

        tag_count_result = await db.execute(
            select(func.count(TagNode.id)).filter(
                TagNode.project_id == project.id,
                TagNode.is_active == True,
                TagNode.node_type.in_(['tag', 'value'])
            )
        )
        tag_count = tag_count_result.scalar() or 0

        responses.append(TagProjectResponse(
            id=project.id,
            name=project.name,
            description=project.description,
            color=project.color,
            icon=project.icon,
            node_count=node_count,
            tag_count=tag_count,
            is_active=project.is_active,
            created_at=project.created_at,
            updated_at=project.updated_at
        ))

    return responses


@router.post("/projects", response_model=TagProjectResponse)
async def create_tag_project(
    data: TagProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建标签项目"""
    project = TagProject(
        name=data.name,
        description=data.description,
        color=data.color,
        icon=data.icon,
        created_by=current_user.id
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    return TagProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        color=project.color,
        icon=project.icon,
        node_count=0,
        tag_count=0,
        is_active=project.is_active,
        created_at=project.created_at,
        updated_at=project.updated_at
    )


@router.get("/projects/{project_id}", response_model=TagProjectResponse)
async def get_tag_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取单个标签项目"""
    result = await db.execute(select(TagProject).filter(TagProject.id == project_id))
    project = result.scalars().first()

    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 获取节点统计
    node_count_result = await db.execute(
        select(func.count(TagNode.id)).filter(
            TagNode.project_id == project.id,
            TagNode.is_active == True
        )
    )
    node_count = node_count_result.scalar() or 0

    tag_count_result = await db.execute(
        select(func.count(TagNode.id)).filter(
            TagNode.project_id == project.id,
            TagNode.is_active == True,
            TagNode.node_type.in_(['tag', 'value'])
        )
    )
    tag_count = tag_count_result.scalar() or 0

    return TagProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        color=project.color,
        icon=project.icon,
        node_count=node_count,
        tag_count=tag_count,
        is_active=project.is_active,
        created_at=project.created_at,
        updated_at=project.updated_at
    )


@router.put("/projects/{project_id}", response_model=TagProjectResponse)
async def update_tag_project(
    project_id: int,
    data: TagProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新标签项目"""
    result = await db.execute(select(TagProject).filter(TagProject.id == project_id))
    project = result.scalars().first()

    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    if data.name is not None:
        project.name = data.name
    if data.description is not None:
        project.description = data.description
    if data.color is not None:
        project.color = data.color
    if data.icon is not None:
        project.icon = data.icon

    await db.commit()
    await db.refresh(project)

    # 获取节点统计
    node_count_result = await db.execute(
        select(func.count(TagNode.id)).filter(
            TagNode.project_id == project.id,
            TagNode.is_active == True
        )
    )
    node_count = node_count_result.scalar() or 0

    tag_count_result = await db.execute(
        select(func.count(TagNode.id)).filter(
            TagNode.project_id == project.id,
            TagNode.is_active == True,
            TagNode.node_type.in_(['tag', 'value'])
        )
    )
    tag_count = tag_count_result.scalar() or 0

    return TagProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        color=project.color,
        icon=project.icon,
        node_count=node_count,
        tag_count=tag_count,
        is_active=project.is_active,
        created_at=project.created_at,
        updated_at=project.updated_at
    )


@router.delete("/projects/{project_id}")
async def delete_tag_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除标签项目"""
    result = await db.execute(select(TagProject).filter(TagProject.id == project_id))
    project = result.scalars().first()

    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 软删除
    project.is_active = False
    await db.commit()

    return {"message": "删除成功"}


# ==================== 标签维度 CRUD ====================

@router.get("/dimensions", response_model=List[TagDimensionResponse])
async def list_tag_dimensions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有标签维度"""
    query = select(TagDimension).filter(TagDimension.is_active == True).order_by(TagDimension.is_preset.desc(), TagDimension.id)
    result = await db.execute(query)
    dimensions = result.scalars().all()
    return [TagDimensionResponse.model_validate(d) for d in dimensions]


@router.post("/dimensions", response_model=TagDimensionResponse)
async def create_tag_dimension(
    data: TagDimensionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建自定义标签维度"""
    dimension = TagDimension(
        name=data.name,
        display_name=data.display_name,
        id_field=data.id_field,
        description=data.description,
        is_preset=False,
        created_by=current_user.id
    )
    db.add(dimension)
    await db.commit()
    await db.refresh(dimension)
    return TagDimensionResponse.model_validate(dimension)


@router.get("/dimensions/{dimension_id}", response_model=TagDimensionResponse)
async def get_tag_dimension(
    dimension_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取单个标签维度"""
    result = await db.execute(select(TagDimension).filter(TagDimension.id == dimension_id))
    dimension = result.scalars().first()
    if not dimension:
        raise HTTPException(status_code=404, detail="维度不存在")
    return TagDimensionResponse.model_validate(dimension)


@router.delete("/dimensions/{dimension_id}")
async def delete_tag_dimension(
    dimension_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除标签维度"""
    result = await db.execute(select(TagDimension).filter(TagDimension.id == dimension_id))
    dimension = result.scalars().first()
    if not dimension:
        raise HTTPException(status_code=404, detail="维度不存在")

    # 检查是否有标签使用此维度
    tag_count_result = await db.execute(
        select(func.count(TagNode.id)).filter(TagNode.dimension_id == dimension_id)
    )
    tag_count = tag_count_result.scalar() or 0
    if tag_count > 0:
        raise HTTPException(status_code=400, detail=f"该维度下有 {tag_count} 个标签，无法删除")

    await db.delete(dimension)
    await db.commit()
    return {"message": "删除成功"}


# ==================== 批量创建维度标签 ====================

@router.post("/batch-create", response_model=BatchDimensionTagResponse)
async def batch_create_dimension_tags(
    data: BatchDimensionTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批量创建维度标签
    一次创建一个类型标签 + 多个子维度标签
    parent_id 可选，为空时创建在根目录
    """
    parent_node = None
    project_id = None
    parent_path = ""
    parent_level = 0

    # 如果指定了父节点，验证其存在并获取 project_id
    if data.parent_id:
        parent_result = await db.execute(select(TagNode).filter(TagNode.id == data.parent_id))
        parent_node = parent_result.scalars().first()
        if not parent_node:
            raise HTTPException(status_code=404, detail="父节点不存在")
        project_id = parent_node.project_id
        parent_path = parent_node.path or f"/{parent_node.id}"
        parent_level = parent_node.level or 1

    # 检查画布内同名（类型标签名 + 所有子标签名）
    all_names = [data.type_name] + [tag.name for tag in data.tags]
    check_query = select(TagNode).filter(
        TagNode.name.in_(all_names),
        TagNode.project_id == project_id,
        TagNode.is_active == True
    )
    check_result = await db.execute(check_query)
    existing_names = [node.name for node in check_result.scalars().all()]
    if existing_names:
        raise HTTPException(
            status_code=400,
            detail=f"当前画布中以下标签名已存在：{', '.join(existing_names)}"
        )

    # 验证维度存在
    dimension_result = await db.execute(select(TagDimension).filter(TagDimension.id == data.dimension_id))
    dimension = dimension_result.scalars().first()
    if not dimension:
        raise HTTPException(status_code=404, detail="维度不存在")

    # 1. 创建类型标签（包含SQL规则和所有子标签名称）
    tag_names = [tag.name for tag in data.tags]
    type_node = TagNode(
        name=data.type_name,
        description=data.type_description,
        node_type="type",
        parent_id=data.parent_id if data.parent_id else None,
        project_id=project_id,
        dimension_id=data.dimension_id,
        path=parent_path,
        level=parent_level + 1,
        color="#722ed1",  # 紫色表示类型标签
        rule_type="sql",
        rule_config=json.dumps({
            "source": "ai_dimension",
            "full_sql": data.rule_config.full_sql,
            "source_table": data.rule_config.source_table,
            "tag_names": tag_names  # 包含所有子标签名称
        }),
        ai_generated=True,
        created_by=current_user.id
    )
    db.add(type_node)
    await db.flush()  # 获取type_node.id

    # 更新类型标签的path
    type_node.path = f"{parent_path}/{type_node.id}"

    # 2. 创建值标签（不带SQL规则，只是标签值）
    tag_nodes = []
    for i, tag_item in enumerate(data.tags):
        tag_node = TagNode(
            name=tag_item.name,
            description=tag_item.description,
            node_type="value",
            parent_id=type_node.id,
            project_id=project_id,
            dimension_id=data.dimension_id,
            path=f"{type_node.path}",
            level=parent_level + 2,
            color="#1890ff",
            # 子标签不需要SQL规则，SQL在类型标签上
            rule_type=None,
            rule_config=None,
            ai_generated=True,
            sort_order=i,
            created_by=current_user.id
        )
        db.add(tag_node)
        tag_nodes.append(tag_node)

    await db.flush()

    # 更新子标签的path
    for tag_node in tag_nodes:
        tag_node.path = f"{type_node.path}/{tag_node.id}"

    await db.commit()

    # 刷新获取完整数据
    await db.refresh(type_node)
    for tag_node in tag_nodes:
        await db.refresh(tag_node)

    # 构建响应
    type_response = TagNodeResponse(
        id=type_node.id,
        name=type_node.name,
        description=type_node.description,
        node_type=type_node.node_type,
        parent_id=type_node.parent_id,
        project_id=type_node.project_id,
        dimension_id=type_node.dimension_id,
        path=type_node.path,
        level=type_node.level,
        color=type_node.color,
        rule_type=type_node.rule_type,
        rule_config=type_node.rule_config,
        ai_generated=type_node.ai_generated,
        is_active=type_node.is_active,
        created_at=type_node.created_at,
        updated_at=type_node.updated_at,
        dimension_name=dimension.display_name
    )

    tag_responses = []
    for tag_node in tag_nodes:
        tag_responses.append(TagNodeResponse(
            id=tag_node.id,
            name=tag_node.name,
            description=tag_node.description,
            node_type=tag_node.node_type,
            parent_id=tag_node.parent_id,
            project_id=tag_node.project_id,
            dimension_id=tag_node.dimension_id,
            path=tag_node.path,
            level=tag_node.level,
            color=tag_node.color,
            rule_type=tag_node.rule_type,
            rule_config=tag_node.rule_config,
            ai_generated=tag_node.ai_generated,
            is_active=tag_node.is_active,
            created_at=tag_node.created_at,
            updated_at=tag_node.updated_at,
            dimension_name=dimension.display_name
        ))

    return BatchDimensionTagResponse(
        type_node=type_response,
        tag_nodes=tag_responses
    )


# ==================== 标签节点 CRUD ====================

@router.get("/nodes", response_model=List[TagNodeResponse])
async def list_tag_nodes(
    parent_id: Optional[int] = None,
    node_type: Optional[str] = None,
    keyword: Optional[str] = None,
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取标签节点列表"""
    query = select(TagNode).filter(TagNode.is_active == True)

    if project_id is not None:
        query = query.filter(TagNode.project_id == project_id)

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

        # 如果是模版标签且有引用原标签，获取原标签的名字
        display_name = node.name
        if node.source_node_id:
            source_result = await db.execute(select(TagNode).filter(TagNode.id == node.source_node_id))
            source_node = source_result.scalars().first()
            if source_node:
                display_name = source_node.name

        responses.append(TagNodeResponse(
            id=node.id,
            name=display_name,  # 使用原标签名字（如果有引用）
            description=node.description,
            node_type=node.node_type,
            parent_id=node.parent_id,
            project_id=node.project_id,
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
            source_node_id=node.source_node_id,
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


@router.get("/tree")
async def get_tag_tree(
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取完整的标签树"""
    from app.models.schedule import Schedule, ScheduleStatus

    query = select(TagNode).filter(TagNode.is_active == True)
    if project_id is not None:
        query = query.filter(TagNode.project_id == project_id)
    query = query.order_by(TagNode.sort_order, TagNode.id)

    result = await db.execute(query)
    all_nodes = result.scalars().all()

    # 查询已上线的标签调度（dag_id 以 tag_task_ 开头且状态为 ACTIVE）
    schedule_result = await db.execute(
        select(Schedule.dag_id)
        .filter(Schedule.dag_id.like("tag_task_%"))
        .filter(Schedule.status == ScheduleStatus.ACTIVE)
    )
    deployed_dag_ids = {row[0] for row in schedule_result.fetchall()}

    # 先收集所有需要查询原标签名字的 source_node_id
    source_ids = [node.source_node_id for node in all_nodes if node.source_node_id]
    source_names = {}
    if source_ids:
        source_result = await db.execute(
            select(TagNode.id, TagNode.name).filter(TagNode.id.in_(source_ids))
        )
        source_names = {row[0]: row[1] for row in source_result.fetchall()}

    # 构建树
    node_map = {}
    for node in all_nodes:
        # 判断是否已上线
        is_scheduled = f"tag_task_{node.id}" in deployed_dag_ids
        # 如果有引用原标签，使用原标签名字
        display_name = source_names.get(node.source_node_id, node.name) if node.source_node_id else node.name
        node_map[node.id] = {
            "id": node.id,
            "name": display_name,  # 使用原标签名字（如果有引用）
            "description": node.description,
            "node_type": node.node_type,
            "color": node.color,
            "icon": node.icon,
            "level": node.level,
            "parent_id": node.parent_id,
            "project_id": node.project_id,
            "dimension_id": node.dimension_id,
            "source_node_id": node.source_node_id,
            "usage_count": node.usage_count,
            "rule_type": node.rule_type,
            "rule_config": node.rule_config,
            "source_table": node.source_table,
            "tag_table_name": node.tag_table_name,
            "is_scheduled": is_scheduled,
            "created_at": node.created_at.isoformat() if node.created_at else None,
            "updated_at": node.updated_at.isoformat() if node.updated_at else None,
            "children": []
        }

    # 组装树形结构
    root_nodes = []
    for node_id, node_data in node_map.items():
        parent_id = node_data.get("parent_id")
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

    # 检查画布内同名（标签名在当前画布内唯一）
    check_query = select(TagNode).filter(
        TagNode.name == data.name,
        TagNode.project_id == data.project_id,
        TagNode.is_active == True
    )
    result = await db.execute(check_query)
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="当前画布中已存在同名标签")

    node = TagNode(
        name=data.name,
        description=data.description,
        node_type=data.node_type,
        parent_id=data.parent_id,
        project_id=data.project_id,
        dimension_id=data.dimension_id,
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
        project_id=node.project_id,
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


@router.get("/nodes/{node_id}", response_model=TagNodeResponse)
async def get_tag_node(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取单个标签节点"""
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")

    # 获取父节点名称
    parent_name = None
    if node.parent_id:
        parent_result = await db.execute(select(TagNode.name).filter(TagNode.id == node.parent_id))
        parent_name = parent_result.scalar()

    return TagNodeResponse(
        id=node.id,
        name=node.name,
        description=node.description,
        node_type=node.node_type,
        parent_id=node.parent_id,
        project_id=node.project_id,
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
        is_active=node.is_active,
        usage_count=node.usage_count,
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

    # 如果修改了名字，检查画布内唯一性
    if data.name is not None and data.name != node.name:
        check_query = select(TagNode).filter(
            TagNode.name == data.name,
            TagNode.id != node_id,
            TagNode.project_id == node.project_id,
            TagNode.is_active == True
        )
        check_result = await db.execute(check_query)
        if check_result.scalars().first():
            raise HTTPException(status_code=400, detail="当前画布中已存在同名标签")

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
    from app.models.tag import TagTemplateFavorite

    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")

    # 收集所有要删除的节点ID（包括子节点）
    all_node_ids = [node_id]

    async def collect_children_ids(parent_id: int):
        children_result = await db.execute(
            select(TagNode).filter(TagNode.parent_id == parent_id)
        )
        children = children_result.scalars().all()
        for child in children:
            all_node_ids.append(child.id)
            await collect_children_ids(child.id)

    await collect_children_ids(node_id)

    # 先删除相关的收藏记录
    await db.execute(
        delete(TagTemplateFavorite).filter(TagTemplateFavorite.node_id.in_(all_node_ids))
    )

    # 删除所有子节点（parent_id 指向当前节点的）
    async def delete_children(parent_id: int):
        children_result = await db.execute(
            select(TagNode).filter(TagNode.parent_id == parent_id)
        )
        children = children_result.scalars().all()
        for child in children:
            await delete_children(child.id)
            await db.delete(child)

    await delete_children(node_id)
    await db.delete(node)
    await db.flush()

    return {"message": "删除成功"}


# ==================== 模版收藏 ====================

@router.post("/nodes/{node_id}/save-to-template")
async def save_to_template(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    收藏分类标签到模版（只存储引用关系，不复制标签）
    收藏不影响其他画布的标签命名
    """
    from app.models.tag import TagTemplateFavorite

    # 获取源节点
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    source_node = result.scalars().first()
    if not source_node:
        raise HTTPException(status_code=404, detail="节点不存在")

    # 只有分类标签可以收藏到模版
    if source_node.node_type != "category":
        raise HTTPException(status_code=400, detail="只有分类标签可以收藏到模版")

    # 检查是否已收藏
    existing = await db.execute(
        select(TagTemplateFavorite).filter(TagTemplateFavorite.node_id == node_id)
    )
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="该分类已收藏到模版")

    # 创建收藏记录
    favorite = TagTemplateFavorite(
        node_id=node_id,
        created_by=current_user.id
    )
    db.add(favorite)
    await db.commit()
    await db.refresh(favorite)

    # 统计子标签数量
    async def count_children(parent_id: int) -> int:
        children_result = await db.execute(
            select(func.count(TagNode.id)).filter(
                TagNode.parent_id == parent_id,
                TagNode.is_active == True
            )
        )
        count = children_result.scalar() or 0
        if count > 0:
            children = await db.execute(
                select(TagNode.id).filter(
                    TagNode.parent_id == parent_id,
                    TagNode.is_active == True
                )
            )
            for child_id in children.scalars().all():
                count += await count_children(child_id)
        return count

    child_count = await count_children(node_id)

    return {
        "message": f"成功收藏到模版",
        "favorite_id": favorite.id,
        "node_id": node_id,
        "node_name": source_node.name,
        "child_count": child_count
    }


@router.get("/template-favorites")
async def list_template_favorites(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取所有模版收藏（返回原标签信息）
    """
    from app.models.tag import TagTemplateFavorite

    result = await db.execute(
        select(TagTemplateFavorite).order_by(TagTemplateFavorite.created_at.desc())
    )
    favorites = result.scalars().all()

    responses = []
    for fav in favorites:
        # 获取原标签信息
        node_result = await db.execute(
            select(TagNode).filter(TagNode.id == fav.node_id, TagNode.is_active == True)
        )
        node = node_result.scalars().first()
        if not node:
            continue  # 原标签已删除，跳过

        # 统计子标签数量
        children_result = await db.execute(
            select(func.count(TagNode.id)).filter(
                TagNode.parent_id == node.id,
                TagNode.is_active == True
            )
        )
        children_count = children_result.scalar() or 0

        responses.append({
            "favorite_id": fav.id,
            "node_id": node.id,
            "name": node.name,
            "description": node.description,
            "node_type": node.node_type,
            "color": node.color,
            "icon": node.icon,
            "children_count": children_count,
            "created_at": fav.created_at.isoformat() if fav.created_at else None
        })

    return responses


@router.delete("/template-favorites/{node_id}")
async def remove_template_favorite(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    取消模版收藏
    """
    from app.models.tag import TagTemplateFavorite

    result = await db.execute(
        select(TagTemplateFavorite).filter(TagTemplateFavorite.node_id == node_id)
    )
    favorite = result.scalars().first()
    if not favorite:
        raise HTTPException(status_code=404, detail="收藏记录不存在")

    await db.delete(favorite)
    await db.commit()

    return {"message": "已取消收藏"}


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

    # 计算层级和路径，获取 project_id
    level = 1
    path = ""
    parent_name = None
    project_id = None

    if data.parent_id:
        result = await db.execute(select(TagNode).filter(TagNode.id == data.parent_id))
        parent = result.scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="父节点不存在")
        level = parent.level + 1
        path = f"{parent.path or ''}/{parent.id}"
        parent_name = parent.name
        project_id = parent.project_id

    # 检查画布内同名
    check_query = select(TagNode).filter(
        TagNode.name == data.name,
        TagNode.project_id == project_id,
        TagNode.is_active == True
    )
    check_result = await db.execute(check_query)
    if check_result.scalars().first():
        raise HTTPException(status_code=400, detail="当前画布中已存在同名标签")

    node = TagNode(
        name=data.name,
        description=data.description,
        node_type=data.node_type or "detail",  # 规则引擎默认为粒度标签(detail)
        parent_id=data.parent_id,
        project_id=project_id,
        level=level,
        path=path,
        color=data.color,
        rule_type="sql",
        rule_config=json.dumps(data.rule_config.model_dump(), ensure_ascii=False),
        source_datasource_id=data.rule_config.datasource_id,
        source_table=data.rule_config.source_table,
        tag_table_name=data.rule_config.tag_table_name,  # 保存AI生成的目标表名
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
        project_id=node.project_id,
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


# ==================== 规则标签执行 ====================

@router.post("/rule-tag/preview-sql")
async def preview_rule_sql(
    source_table: str,
    ai_prompt: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    预览AI生成的SQL（保存任务前）
    1. 读取表的少量样本数据
    2. 调用AI生成SQL + 提取标签
    3. 返回SQL和标签给前端确认
    """
    engine, _ = await get_warehouse_engine(db)

    # 获取表结构
    table_schema = ""
    sample_data = []
    try:
        with engine.connect() as conn:
            # 获取表结构
            desc_result = conn.execute(text(f"DESCRIBE `{source_table}`"))
            columns = desc_result.fetchall()
            table_schema = f"表名: {source_table}\n字段:\n"
            for col in columns:
                table_schema += f"  - {col[0]}: {col[1]}\n"

            # 读取少量样本数据（5条）
            sample_result = conn.execute(text(f"SELECT * FROM `{source_table}` LIMIT 5"))
            column_names = list(sample_result.keys())
            rows = sample_result.fetchall()
            sample_data = [dict(zip(column_names, row)) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"读取表数据失败: {str(e)}")

    # 调用AI生成SQL
    ai_assistant = AIAssistant()
    system_prompt = """你是一个SQL专家。根据用户的自然语言描述和样本数据，生成符合条件的SQL查询。

要求：
1. 生成的SQL用于筛选数据并打上标签
2. SELECT语句应包含原表的主要字段和一个标签字段(tag_result)
3. 使用CASE WHEN来根据条件生成标签值
4. 确保SQL语法正确，可以直接执行
5. SQL要能覆盖所有数据行，不符合条件的也要有默认标签

返回格式（JSON）：
{
  "sql": "SELECT ... FROM ...",
  "tags": ["标签1", "标签2", "其他"],
  "tag_field": "tag_result"
}

只返回JSON，不要其他解释。"""

    # 格式化样本数据
    sample_text = "样本数据:\n"
    for i, row in enumerate(sample_data):
        sample_text += f"  第{i+1}行: {json.dumps(row, ensure_ascii=False, default=str)}\n"

    user_prompt = f"""
表结构:
{table_schema}

{sample_text}

用户需求:
{ai_prompt}

请生成SQL并提取标签列表。
"""

    try:
        ai_response = ai_assistant._call_claude(system_prompt, user_prompt)

        # 解析JSON响应
        response_text = ai_response.strip()
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()

        try:
            result = json.loads(response_text)
            generated_sql = result.get("sql", "")
            extracted_tags = result.get("tags", [])
            tag_field = result.get("tag_field", "tag_result")
        except json.JSONDecodeError:
            # 如果不是JSON，尝试提取SQL
            generated_sql = response_text
            if "```sql" in generated_sql:
                generated_sql = generated_sql.split("```sql")[1].split("```")[0].strip()
            # 从SQL中提取标签
            extracted_tags = []
            import re
            then_matches = re.findall(r"THEN\s+['\"]([^'\"]+)['\"]", generated_sql, re.IGNORECASE)
            else_matches = re.findall(r"ELSE\s+['\"]([^'\"]+)['\"]", generated_sql, re.IGNORECASE)
            extracted_tags = list(set(then_matches + else_matches))
            tag_field = "tag_result"

        return {
            "sql": generated_sql,
            "tags": extracted_tags,
            "tag_field": tag_field,
            "sample_data": sample_data,
            "table_schema": table_schema
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI生成SQL失败: {str(e)}")


@router.post("/rule-tag/{node_id}/generate-sql")
async def generate_rule_sql(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    根据AI提示词生成SQL
    如果rule_config中的full_sql以 '-- AI_PROMPT:' 开头，则调用AI生成SQL
    """
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="标签节点不存在")
    if node.rule_type != "sql":
        raise HTTPException(status_code=400, detail="该标签不是SQL规则标签")

    config = json.loads(node.rule_config) if node.rule_config else {}
    full_sql = config.get("full_sql", "")

    # 检查是否是AI提示词
    if not full_sql.startswith("-- AI_PROMPT:"):
        return {"sql": full_sql, "generated": False}

    # 提取AI提示词
    ai_prompt = full_sql.replace("-- AI_PROMPT:", "").split("\n")[0].strip()
    source_table = config.get("source_table", "")

    # 获取表结构
    engine, _ = await get_warehouse_engine(db)
    table_schema = ""
    try:
        with engine.connect() as conn:
            desc_result = conn.execute(text(f"DESCRIBE `{source_table}`"))
            columns = desc_result.fetchall()
            table_schema = f"表名: {source_table}\n字段:\n"
            for col in columns:
                table_schema += f"  - {col[0]}: {col[1]}\n"
    except Exception as e:
        table_schema = f"表名: {source_table} (无法获取结构: {e})"

    # 调用AI生成SQL
    ai_assistant = AIAssistant()
    system_prompt = """你是一个SQL专家。根据用户的自然语言描述，生成符合条件的SQL查询。
要求：
1. 生成的SQL用于筛选数据并打上标签
2. SELECT语句应包含原表的主要字段和一个标签字段
3. 使用CASE WHEN来根据条件生成标签值
4. 只返回SQL语句，不要其他解释"""

    user_prompt = f"""
表结构:
{table_schema}

用户需求:
{ai_prompt}

请生成SQL，格式类似:
SELECT *, CASE WHEN 条件 THEN '标签A' WHEN 条件 THEN '标签B' ELSE '其他' END AS tag_result
FROM {source_table}
"""

    try:
        ai_response = ai_assistant._call_claude(system_prompt, user_prompt)
        # 提取SQL
        generated_sql = ai_response.strip()
        if "```sql" in generated_sql:
            generated_sql = generated_sql.split("```sql")[1].split("```")[0].strip()
        elif "```" in generated_sql:
            generated_sql = generated_sql.split("```")[1].split("```")[0].strip()

        # 更新rule_config
        config["full_sql"] = generated_sql
        config["ai_prompt"] = ai_prompt
        node.rule_config = json.dumps(config, ensure_ascii=False)
        node.ai_generated = True
        await db.flush()

        return {"sql": generated_sql, "generated": True, "prompt": ai_prompt}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI生成SQL失败: {str(e)}")


@router.post("/rule-tag/{node_id}/execute")
async def execute_rule_tag(
    node_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    执行SQL规则标签
    执行SQL并将结果写入新表
    """
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="标签节点不存在")
    if node.rule_type != "sql":
        raise HTTPException(status_code=400, detail="该标签不是SQL规则标签")

    config = json.loads(node.rule_config) if node.rule_config else {}
    full_sql = config.get("full_sql", "")

    # 如果是AI提示词，先生成SQL
    if full_sql.startswith("-- AI_PROMPT:"):
        raise HTTPException(status_code=400, detail="请先生成SQL（点击'生成SQL'按钮）")

    if not full_sql:
        raise HTTPException(status_code=400, detail="SQL规则为空")

    # 生成目标表名
    if not node.tag_table_name:
        # 默认表名格式：tag_任务名拼音_时间戳
        import time
        safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', node.name.lower())
        safe_name = re.sub(r'_+', '_', safe_name).strip('_')  # 清理多余下划线
        timestamp = time.strftime('%Y%m%d%H%M%S')
        target_table = f"tag_{safe_name}_{timestamp}" if safe_name else f"tag_data_{timestamp}"
        node.tag_table_name = target_table
        await db.flush()
    else:
        target_table = node.tag_table_name

    engine, _ = await get_warehouse_engine(db)

    try:
        with engine.connect() as conn:
            # 创建目标表并插入数据
            create_sql = f"CREATE TABLE IF NOT EXISTS `{target_table}` AS {full_sql}"
            conn.execute(text(create_sql))
            conn.commit()

            # 获取结果数量
            count_result = conn.execute(text(f"SELECT COUNT(*) FROM `{target_table}`"))
            count = count_result.scalar() or 0

        # 更新使用计数
        node.usage_count = count
        await db.flush()

        return {
            "message": "SQL规则执行成功",
            "target_table": target_table,
            "row_count": count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行失败: {str(e)}")


# ==================== 复合智能标签 ====================

from pydantic import BaseModel

class CompositeTagInfo(BaseModel):
    id: int
    name: str
    source_table: Optional[str] = None
    rule_config: Optional[str] = None

class CompositeTagRequest(BaseModel):
    tags: List[CompositeTagInfo]
    prompt: str

@router.post("/composite-tag/generate-sql")
async def generate_composite_sql(
    data: CompositeTagRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    为复合智能标签生成关联SQL
    1. 获取所选标签的源表信息
    2. 调用AI分析表结构并生成关联SQL
    """
    if len(data.tags) < 2:
        raise HTTPException(status_code=400, detail="请至少选择两个标签")

    engine, _ = await get_warehouse_engine(db)

    # 收集所有标签的表信息
    tables_info = []
    for tag_info in data.tags:
        # 获取完整的标签节点信息
        result = await db.execute(select(TagNode).filter(TagNode.id == tag_info.id))
        node = result.scalars().first()
        if not node:
            continue

        # 解析source_table
        source_table = node.source_table
        tag_table = node.tag_table_name

        if not source_table and node.rule_config:
            try:
                config = json.loads(node.rule_config)
                source_table = config.get("source_table", "")
            except:
                pass

        # 获取表结构
        table_to_describe = tag_table or source_table
        if table_to_describe:
            try:
                with engine.connect() as conn:
                    desc_result = conn.execute(text(f"DESCRIBE `{table_to_describe}`"))
                    columns = desc_result.fetchall()
                    column_info = [{"name": col[0], "type": col[1]} for col in columns]

                    # 获取少量样本数据
                    sample_result = conn.execute(text(f"SELECT * FROM `{table_to_describe}` LIMIT 3"))
                    sample_rows = [dict(zip([c[0] for c in columns], row)) for row in sample_result.fetchall()]

                    tables_info.append({
                        "tag_id": node.id,
                        "tag_name": node.name,
                        "source_table": source_table,
                        "tag_table": tag_table,
                        "table_used": table_to_describe,
                        "columns": column_info,
                        "sample_data": sample_rows,
                        "rule_type": node.rule_type,
                    })
            except Exception as e:
                tables_info.append({
                    "tag_id": node.id,
                    "tag_name": node.name,
                    "source_table": source_table,
                    "tag_table": tag_table,
                    "error": str(e),
                })

    if len(tables_info) < 2:
        raise HTTPException(status_code=400, detail="无法获取足够的表信息，请确保选择的标签有关联的表")

    # 构建AI提示
    ai_assistant = AIAssistant()

    # 表结构描述
    tables_description = []
    for info in tables_info:
        if "error" in info:
            tables_description.append(f"标签 '{info['tag_name']}': 无法获取表结构 ({info['error']})")
        else:
            cols_desc = ", ".join([f"{c['name']}({c['type']})" for c in info['columns']])
            sample_str = json.dumps(info['sample_data'], ensure_ascii=False, default=str) if info['sample_data'] else "无样本数据"
            tables_description.append(f"""
标签: {info['tag_name']}
表名: {info['table_used']}
字段: {cols_desc}
样本数据: {sample_str}
""")

    system_prompt = """你是一个SQL专家。根据用户提供的多个标签表信息和组合逻辑，生成一个将这些表关联起来的SQL查询。

要求：
1. 分析表结构，找出可能的关联字段（如id、user_id、order_id等）
2. 根据用户描述的组合逻辑生成合适的JOIN查询
3. SELECT子句应包含有意义的字段，并添加一个composite_tag标签字段
4. 使用CASE WHEN来根据条件生成复合智能标签值
5. 如果用户描述的是交集，使用INNER JOIN；如果是并集，使用FULL OUTER JOIN或UNION
6. 确保SQL语法正确，可以直接执行

只返回SQL语句，不要其他解释。SQL应该以注释开头说明关联逻辑。"""

    user_prompt = f"""
以下是需要组合的标签表信息：

{chr(10).join(tables_description)}

用户描述的组合逻辑：
{data.prompt}

请生成关联SQL，将这些表组合成一个复合视图。
"""

    try:
        ai_response = ai_assistant._call_claude(system_prompt, user_prompt)

        # 提取SQL
        generated_sql = ai_response.strip()
        if "```sql" in generated_sql:
            generated_sql = generated_sql.split("```sql")[1].split("```")[0].strip()
        elif "```" in generated_sql:
            generated_sql = generated_sql.split("```")[1].split("```")[0].strip()

        # 添加注释头
        sql_header = f"""-- 复合智能标签SQL
-- 组合标签: {', '.join([t['tag_name'] for t in tables_info if 'tag_name' in t])}
-- 涉及表: {', '.join([t['table_used'] for t in tables_info if 'table_used' in t])}
-- 组合逻辑: {data.prompt[:100]}{'...' if len(data.prompt) > 100 else ''}
--
"""
        full_sql = sql_header + generated_sql

        return {
            "sql": full_sql,
            "tables_info": tables_info,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI生成SQL失败: {str(e)}")


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

    # 标签数（包括 tag 和 value 类型）
    result = await db.execute(
        select(func.count(TagNode.id)).filter(
            TagNode.node_type.in_(["tag", "value"]),
            TagNode.is_active == True
        )
    )
    tag_count = result.scalar() or 0

    # 打标数据总量
    result = await db.execute(select(func.count(TagData.id)))
    total_tagged_data = result.scalar() or 0

    # 获取所有SQL规则类型的标签，根据rule_config分类统计
    result = await db.execute(
        select(TagNode).filter(TagNode.rule_type == "sql", TagNode.is_active == True)
    )
    sql_nodes = result.scalars().all()

    ai_generated_count = 0  # AI打标任务
    rule_tag_count = 0  # 普通SQL规则
    composite_tag_count = 0  # 复合智能标签
    graph_tag_count = 0  # Graph Intelligence任务

    for node in sql_nodes:
        if node.rule_config:
            try:
                config = json.loads(node.rule_config)
                full_sql = config.get("full_sql", "")
                source = config.get("source", "")
                # Graph Intelligence: source === 'graph'
                if source == "graph":
                    graph_tag_count += 1
                # 复合智能标签：有composite_tags字段
                elif config.get("composite_tags"):
                    composite_tag_count += 1
                # AI打标：source === 'ai' 或 'ai_chat' 或 'ai_dimension'
                elif source in ("ai", "ai_chat", "ai_dimension"):
                    ai_generated_count += 1
                # 其他为普通SQL规则
                else:
                    rule_tag_count += 1
            except:
                rule_tag_count += 1
        else:
            rule_tag_count += 1

    # Top标签（包括 tag 和 value 类型）
    result = await db.execute(
        select(TagNode.name, TagNode.usage_count)
        .filter(TagNode.node_type.in_(["tag", "value"]), TagNode.is_active == True)
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
        composite_tag_count=composite_tag_count,
        graph_tag_count=graph_tag_count,
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
    # 计算层级和路径，获取 project_id
    level = 1
    path = ""
    parent_name = None
    project_id = None

    if data.parent_id:
        result = await db.execute(select(TagNode).filter(TagNode.id == data.parent_id))
        parent = result.scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="父节点不存在")
        level = parent.level + 1
        path = f"{parent.path or ''}/{parent.id}"
        parent_name = parent.name
        project_id = parent.project_id

    # 检查画布内同名
    check_query = select(TagNode).filter(
        TagNode.name == data.name,
        TagNode.project_id == project_id,
        TagNode.is_active == True
    )
    check_result = await db.execute(check_query)
    if check_result.scalars().first():
        raise HTTPException(status_code=400, detail="当前画布中已存在同名标签")

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
        project_id=project_id,
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
        project_id=node.project_id,
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
    # 计算层级和路径，获取 project_id
    level = 1
    path = ""
    parent_name = None
    project_id = None

    if data.parent_id:
        result = await db.execute(select(TagNode).filter(TagNode.id == data.parent_id))
        parent = result.scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="父节点不存在")
        level = parent.level + 1
        path = f"{parent.path or ''}/{parent.id}"
        parent_name = parent.name
        project_id = parent.project_id

    # 检查画布内同名
    check_query = select(TagNode).filter(
        TagNode.name == data.name,
        TagNode.project_id == project_id,
        TagNode.is_active == True
    )
    check_result = await db.execute(check_query)
    if check_result.scalars().first():
        raise HTTPException(status_code=400, detail="当前画布中已存在同名标签")

    # 验证源标签
    for tag_id in data.source_tag_ids:
        result = await db.execute(select(TagNode).filter(TagNode.id == tag_id))
        if not result.scalars().first():
            raise HTTPException(status_code=404, detail=f"标签 {tag_id} 不存在")

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
        project_id=project_id,
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
        project_id=node.project_id,
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

    # 值标签 (value/tag 类型) 需要从父节点的表中筛选
    tag_table_name = node.tag_table_name
    filter_condition = None

    if node.node_type in ('value', 'tag') and not tag_table_name and node.parent_id:
        # 获取父节点（类型标签）
        parent_result = await db.execute(select(TagNode).filter(TagNode.id == node.parent_id))
        parent_node = parent_result.scalars().first()
        if parent_node and parent_node.tag_table_name:
            tag_table_name = parent_node.tag_table_name
            # 值标签按 tag_name 字段筛选
            filter_condition = f"tag_name = '{node.name}'"

    if not tag_table_name:
        return {"columns": [], "rows": [], "total": 0}

    engine, _ = await get_warehouse_engine(db)

    with engine.connect() as conn:
        # 构建查询SQL
        if filter_condition:
            data_sql = f"SELECT * FROM `{tag_table_name}` WHERE {filter_condition} LIMIT {limit}"
            count_sql = f"SELECT COUNT(*) FROM `{tag_table_name}` WHERE {filter_condition}"
        else:
            data_sql = f"SELECT * FROM `{tag_table_name}` LIMIT {limit}"
            count_sql = f"SELECT COUNT(*) FROM `{tag_table_name}`"

        # 获取数据
        result = conn.execute(text(data_sql))
        columns = list(result.keys())
        rows = [list(row) for row in result.fetchall()]

        # 获取总数
        count_result = conn.execute(text(count_sql))
        total = count_result.scalar() or 0

    return {
        "columns": columns,
        "rows": rows,
        "total": total,
        "filter": filter_condition  # 返回筛选条件供前端显示
    }


# ==================== 调度集成 ====================

@router.get("/row-tag/{node_id}/status")
async def get_row_tag_status(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取行级标签任务的状态"""
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="标签节点不存在")
    if node.rule_type != "row":
        raise HTTPException(status_code=400, detail="该标签不是行级标签")

    # 获取打标数据量
    data_count = 0
    if node.tag_table_name:
        try:
            engine, _ = await get_warehouse_engine(db)
            with engine.connect() as conn:
                count_result = conn.execute(text(f"SELECT COUNT(*) FROM `{node.tag_table_name}`"))
                data_count = count_result.scalar() or 0
        except:
            pass

    return {
        "node_id": node.id,
        "name": node.name,
        "source_table": node.source_table,
        "target_table": node.tag_table_name,
        "usage_count": node.usage_count,
        "data_count": data_count,
        "last_updated": node.updated_at.isoformat() if node.updated_at else None,
    }


@router.post("/row-tag/{node_id}/schedule")
async def create_tag_schedule(
    node_id: int,
    cron_expression: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    为标签任务创建调度
    支持行级标签(row)和SQL规则标签(sql)两种类型
    这会在 Schedule 表中创建一条记录，并生成对应的 Airflow DAG
    """
    from app.models.schedule import Schedule, ScheduleStatus
    from app.services.dag_generator import DAGGenerator

    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="标签节点不存在")
    if node.rule_type not in ("row", "sql"):
        raise HTTPException(status_code=400, detail="该标签类型不支持调度")

    # 创建调度记录 - 使用node.id确保唯一性，避免中文名称被sanitize后丢失
    dag_generator = DAGGenerator()
    dag_id = f"tag_task_{node.id}"

    # 检查是否已存在
    existing = await db.execute(select(Schedule).filter(Schedule.dag_id == dag_id))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="该任务已存在调度")

    # 根据规则类型生成不同的SQL内容
    if node.rule_type == "sql":
        # SQL规则标签：直接执行存储的SQL
        config = json.loads(node.rule_config) if node.rule_config else {}
        full_sql = config.get("full_sql", "")
        if not full_sql or full_sql.startswith("-- AI_PROMPT:"):
            raise HTTPException(status_code=400, detail="SQL规则尚未确认，请先生成并确认SQL")

        sql_content = f"""-- SQL规则标签调度
-- 任务ID: {node.id}
-- 任务名称: {node.name}
-- 源表: {node.source_table}
-- 目标表: {node.tag_table_name or 'auto_generated'}
--
-- 此任务通过 HTTP API 执行:
-- POST /api/v1/tags/rule-tag/{node.id}/execute
--
-- SQL规则内容:
{full_sql}
"""
        description = f"SQL规则标签自动调度: {node.description or node.name}"
        execute_endpoint = f"rule-tag/{node.id}/execute"
    else:
        # 行级标签：调用AI打标
        sql_content = f"""-- AI打标任务调度
-- 任务ID: {node.id}
-- 任务名称: {node.name}
-- 源表: {node.source_table}
-- 目标表: {node.tag_table_name}
--
-- 此任务通过 HTTP API 执行:
-- POST /api/v1/tags/row-tag/{node.id}/execute
--
-- 执行逻辑: 读取源表数据，调用AI进行打标，结果写入目标表
SELECT 'tag_task_{node.id}' as task_type;
"""
        description = f"AI打标任务自动调度: {node.description or node.name}"
        execute_endpoint = f"row-tag/{node.id}/execute"

    # 生成 DAG 代码
    dag_code = dag_generator.generate_sql_dag(
        name=dag_id,
        description=description,
        sql_content=sql_content,
        conn_id="warehouse_default",  # 使用默认连接
        schedule_interval=cron_expression,
    )

    schedule = Schedule(
        name=f"标签任务-{node.name}",
        description=description,
        dag_id=dag_id,
        cron_expression=cron_expression,
        sql_content=sql_content,
        dag_code=dag_code,  # 保存生成的 DAG 代码
        datasource_id=node.source_datasource_id,
        status=ScheduleStatus.DRAFT,
        created_by=current_user.id,
    )
    db.add(schedule)
    await db.flush()
    await db.refresh(schedule)

    return {
        "message": "调度创建成功",
        "schedule_id": schedule.id,
        "dag_id": dag_id,
        "cron_expression": cron_expression,
        "rule_type": node.rule_type,
        "execute_endpoint": execute_endpoint,
    }


# ==================== 层级管理 ====================

@router.get("/unbound")
async def get_unbound_tags(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取未绑定层级的标签列表（parent_id 为空的 tag 类型节点）"""
    result = await db.execute(
        select(TagNode)
        .filter(TagNode.is_active == True)
        .filter(TagNode.node_type == "tag")
        .filter(TagNode.parent_id == None)
        .order_by(TagNode.created_at.desc())
    )
    nodes = result.scalars().all()

    return [
        {
            "id": node.id,
            "name": node.name,
            "description": node.description,
            "rule_type": node.rule_type,
            "source_table": node.source_table,
            "usage_count": node.usage_count,
            "created_at": node.created_at.isoformat() if node.created_at else None,
        }
        for node in nodes
    ]


@router.get("/hierarchy")
async def get_hierarchy_nodes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取层级节点树（只包含 category 和 type，用于层级选择）"""
    result = await db.execute(
        select(TagNode)
        .filter(TagNode.is_active == True)
        .filter(TagNode.node_type.in_(["category", "type"]))
        .order_by(TagNode.sort_order, TagNode.id)
    )
    all_nodes = result.scalars().all()

    # 构建树形结构
    node_map = {}
    for node in all_nodes:
        node_map[node.id] = {
            "id": node.id,
            "name": node.name,
            "node_type": node.node_type,
            "parent_id": node.parent_id,
            "children": []
        }

    root_nodes = []
    for node_id, node_data in node_map.items():
        parent_id = node_data.pop("parent_id")
        if parent_id and parent_id in node_map:
            node_map[parent_id]["children"].append(node_data)
        else:
            root_nodes.append(node_data)

    return root_nodes


@router.put("/nodes/{node_id}/bind")
async def bind_tag_to_parent(
    node_id: int,
    parent_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """绑定标签到层级（设置 parent_id）"""
    # 获取标签节点
    result = await db.execute(select(TagNode).filter(TagNode.id == node_id))
    node = result.scalars().first()
    if not node:
        raise HTTPException(status_code=404, detail="标签不存在")
    if node.node_type != "tag":
        raise HTTPException(status_code=400, detail="只能绑定标签类型的节点")

    # 验证父节点
    if parent_id:
        parent_result = await db.execute(select(TagNode).filter(TagNode.id == parent_id))
        parent = parent_result.scalars().first()
        if not parent:
            raise HTTPException(status_code=404, detail="父节点不存在")
        if parent.node_type == "tag":
            raise HTTPException(status_code=400, detail="不能绑定到标签下")

        # 更新层级信息
        node.parent_id = parent_id
        node.level = parent.level + 1
        node.path = f"{parent.path or ''}/{parent.id}"
    else:
        # 解绑
        node.parent_id = None
        node.level = 1
        node.path = f"/{node.id}"

    await db.flush()
    await db.refresh(node)

    return {
        "message": "绑定成功" if parent_id else "已解绑",
        "id": node.id,
        "parent_id": node.parent_id,
    }


# ==================== AI 对话打标 ====================

import uuid
from datetime import datetime
from app.schemas.tag import (
    CreateChatRequest, CreateChatResponse,
    SendMessageRequest, SendMessageResponse,
    ChatMessage, ChatSessionResponse,
    ConfirmSchemaRequest, DataSchema
)

# 内存会话存储（简化版，生产环境建议使用 Redis）
_chat_sessions: dict = {}


@router.post("/chat/create", response_model=CreateChatResponse)
async def create_chat_session(
    data: CreateChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建对话会话
    - 传 table_name: 单表模式，获取指定表的结构和样本数据
    - 不传 table_name: 全库模式，获取所有表的结构信息
    """
    engine, config = await get_warehouse_engine(db)

    table_schema = ""
    sample_data = []
    initial_prompt = ""

    try:
        with engine.connect() as conn:
            if data.table_name:
                # 单表模式
                desc_result = conn.execute(text(f"DESCRIBE `{data.table_name}`"))
                columns = desc_result.fetchall()
                table_schema = f"表名: {data.table_name}\n字段:\n"
                for col in columns:
                    table_schema += f"  - {col[0]}: {col[1]}\n"

                sample_result = conn.execute(text(f"SELECT * FROM `{data.table_name}` LIMIT 5"))
                column_names = list(sample_result.keys())
                rows = sample_result.fetchall()
                sample_data = [dict(zip(column_names, row)) for row in rows]

                initial_prompt = data.first_message or "你好，我想看看这张表的数据"
            else:
                # 全库模式：获取所有表的结构信息
                schema_name = config.get("schema_name") or config.get("database")
                tables_result = conn.execute(text(
                    f"SELECT table_name FROM information_schema.tables WHERE table_schema = '{schema_name}'"
                ))
                all_tables = [row[0] for row in tables_result.fetchall()]

                table_schema = f"数据库: {schema_name}\n共 {len(all_tables)} 张表:\n\n"

                # 获取每张表的结构（限制最多20张表的详细信息）
                for i, tbl in enumerate(all_tables[:20]):
                    try:
                        desc_result = conn.execute(text(f"DESCRIBE `{tbl}`"))
                        columns = desc_result.fetchall()
                        table_schema += f"【{tbl}】\n"
                        for col in columns:
                            table_schema += f"  - {col[0]}: {col[1]}\n"
                        table_schema += "\n"
                    except:
                        table_schema += f"【{tbl}】(无法获取结构)\n\n"

                if len(all_tables) > 20:
                    table_schema += f"\n... 还有 {len(all_tables) - 20} 张表未列出\n"
                    table_schema += f"所有表名: {', '.join(all_tables)}\n"

                # 全库模式不获取样本数据，由用户指定后再获取
                sample_data = [{"_info": f"全库模式，共 {len(all_tables)} 张表可用"}]
                initial_prompt = data.first_message or "你好，我想看看有什么数据"

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"读取数据失败: {str(e)}")

    # 创建会话
    session_id = str(uuid.uuid4())
    now = datetime.now()

    # AI 初始分析
    ai_assistant = AIAssistant()
    initial_result = ai_assistant.chat_for_tagging(
        table_schema=table_schema,
        sample_data=sample_data,
        messages=[],
        user_message=initial_prompt
    )

    # 保存会话
    _chat_sessions[session_id] = {
        "session_id": session_id,
        "table_name": data.table_name,  # 可能为 None（全库模式）
        "table_schema": table_schema,
        "sample_data": sample_data,
        "messages": [
            {"role": "user", "content": initial_prompt, "timestamp": now.isoformat()},
            {"role": "assistant", "content": initial_result["reply"], "timestamp": now.isoformat()},
        ],
        "confirmed_schemas": [],  # 已确认的数据方案列表
        "generated_sql": None,
        "created_at": now.isoformat(),
        "user_id": current_user.id,
    }

    return CreateChatResponse(
        session_id=session_id,
        table_schema=table_schema,
        sample_data=sample_data,
        initial_message=initial_result["reply"]
    )


@router.post("/chat/send", response_model=SendMessageResponse)
async def send_chat_message(
    data: SendMessageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """发送对话消息"""
    session = _chat_sessions.get(data.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    # 构建消息历史
    messages = [{"role": m["role"], "content": m["content"]} for m in session["messages"]]

    # 调用 AI，传递已确认的方案
    ai_assistant = AIAssistant()
    result = ai_assistant.chat_for_tagging(
        table_schema=session["table_schema"],
        sample_data=session["sample_data"],
        messages=messages,
        user_message=data.message,
        confirmed_schemas=session.get("confirmed_schemas", [])
    )

    # 更新会话
    now = datetime.now()
    session["messages"].append({"role": "user", "content": data.message, "timestamp": now.isoformat()})
    session["messages"].append({"role": "assistant", "content": result["reply"], "timestamp": now.isoformat()})

    if result["is_final"]:
        session["generated_sql"] = result["sql"]
        session["task_name"] = result.get("task_name")
        session["task_desc"] = result.get("task_desc")
        session["table_name"] = result.get("table_name")

    # 构建方案响应
    schema_response = None
    if result.get("schema"):
        schema_response = DataSchema(**result["schema"])

    return SendMessageResponse(
        session_id=data.session_id,
        reply=result["reply"],
        schema=schema_response,
        generated_sql=result["sql"],
        is_final=result["is_final"],
        task_name=result.get("task_name"),
        task_desc=result.get("task_desc"),
        table_name=result.get("table_name")
    )


@router.post("/chat/confirm-schema")
async def confirm_schema(
    data: ConfirmSchemaRequest,
    current_user: User = Depends(get_current_user)
):
    """确认方案，添加到已确认列表"""
    session = _chat_sessions.get(data.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    # 添加到已确认方案列表
    schema_dict = data.schema.model_dump()
    session["confirmed_schemas"].append(schema_dict)

    return {
        "message": "方案已确认",
        "confirmed_count": len(session["confirmed_schemas"]),
        "schemas": session["confirmed_schemas"]
    }


@router.delete("/chat/{session_id}/schema/{index}")
async def remove_confirmed_schema(
    session_id: str,
    index: int,
    current_user: User = Depends(get_current_user)
):
    """移除已确认的方案"""
    session = _chat_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    schemas = session.get("confirmed_schemas", [])
    if 0 <= index < len(schemas):
        removed = schemas.pop(index)
        return {"message": "方案已移除", "removed": removed, "remaining": len(schemas)}
    else:
        raise HTTPException(status_code=400, detail="无效的方案索引")


@router.get("/chat/{session_id}", response_model=ChatSessionResponse)
async def get_chat_session(
    session_id: str,
    current_user: User = Depends(get_current_user)
):
    """获取对话会话信息"""
    session = _chat_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    return ChatSessionResponse(
        session_id=session["session_id"],
        table_name=session["table_name"],
        messages=[
            ChatMessage(role=m["role"], content=m["content"], timestamp=m.get("timestamp"))
            for m in session["messages"]
        ],
        confirmed_schemas=[DataSchema(**s) for s in session.get("confirmed_schemas", [])],
        generated_sql=session.get("generated_sql")
    )


@router.delete("/chat/{session_id}")
async def delete_chat_session(
    session_id: str,
    current_user: User = Depends(get_current_user)
):
    """删除对话会话"""
    if session_id in _chat_sessions:
        del _chat_sessions[session_id]
    return {"message": "会话已删除"}


# ==================== AI 维度标签对话 ====================

# 维度对话会话存储
_dimension_chat_sessions: dict = {}


@router.post("/chat/dimension/create")
async def create_dimension_chat_session(
    dimension_id: int,
    first_message: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建维度标签对话会话
    """
    # 验证维度存在
    dimension_result = await db.execute(select(TagDimension).filter(TagDimension.id == dimension_id))
    dimension = dimension_result.scalars().first()
    if not dimension:
        raise HTTPException(status_code=404, detail="维度不存在")

    # 获取仓库连接
    engine, config = await get_warehouse_engine(db)

    table_schema = ""
    sample_data = []

    try:
        with engine.connect() as conn:
            # 全库模式：获取所有表的结构信息
            schema_name = config.get("schema_name") or config.get("database")
            tables_result = conn.execute(text(
                f"SELECT table_name FROM information_schema.tables WHERE table_schema = '{schema_name}'"
            ))
            all_tables = [row[0] for row in tables_result.fetchall()]

            table_schema = f"数据库: {schema_name}\n共 {len(all_tables)} 张表:\n\n"

            # 获取每张表的结构（限制最多20张表）
            for tbl in all_tables[:20]:
                try:
                    desc_result = conn.execute(text(f"DESCRIBE `{tbl}`"))
                    columns = desc_result.fetchall()
                    table_schema += f"【{tbl}】\n"
                    for col in columns:
                        table_schema += f"  - {col[0]}: {col[1]}\n"
                    table_schema += "\n"
                except:
                    table_schema += f"【{tbl}】(无法获取结构)\n\n"

            if len(all_tables) > 20:
                table_schema += f"\n... 还有 {len(all_tables) - 20} 张表未列出\n"
                table_schema += f"所有表名: {', '.join(all_tables)}\n"

            sample_data = [{"_info": f"全库模式，共 {len(all_tables)} 张表可用"}]

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"读取数据失败: {str(e)}")

    # 创建会话
    session_id = str(uuid.uuid4())
    now = datetime.now()

    dimension_info = {
        "id": dimension.id,
        "display_name": dimension.display_name,
        "id_field": dimension.id_field,
        "name": dimension.name
    }

    initial_prompt = first_message or f"你好，我想在{dimension.display_name}下创建一些标签"

    # AI 初始分析
    ai_assistant = AIAssistant()
    initial_result = ai_assistant.chat_for_dimension_tagging(
        table_schema=table_schema,
        sample_data=sample_data,
        messages=[],
        user_message=initial_prompt,
        dimension_info=dimension_info
    )

    # 保存会话
    _dimension_chat_sessions[session_id] = {
        "session_id": session_id,
        "dimension_id": dimension_id,
        "dimension_info": dimension_info,
        "table_schema": table_schema,
        "sample_data": sample_data,
        "messages": [
            {"role": "user", "content": initial_prompt, "timestamp": now.isoformat()},
            {"role": "assistant", "content": initial_result["reply"], "timestamp": now.isoformat()},
        ],
        "confirmed_tags": [],
        "created_at": now.isoformat(),
        "user_id": current_user.id,
    }

    return {
        "session_id": session_id,
        "dimension": dimension_info,
        "table_schema": table_schema,
        "initial_message": initial_result["reply"]
    }


@router.post("/chat/dimension/send")
async def send_dimension_chat_message(
    session_id: str,
    message: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """发送维度标签对话消息"""
    session = _dimension_chat_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    # 构建消息历史
    messages = [{"role": m["role"], "content": m["content"]} for m in session["messages"]]

    # 调用 AI
    ai_assistant = AIAssistant()
    result = ai_assistant.chat_for_dimension_tagging(
        table_schema=session["table_schema"],
        sample_data=session["sample_data"],
        messages=messages,
        user_message=message,
        dimension_info=session["dimension_info"],
        confirmed_tags=session.get("confirmed_tags", [])
    )

    # 更新消息历史
    now = datetime.now()
    session["messages"].append({"role": "user", "content": message, "timestamp": now.isoformat()})
    session["messages"].append({"role": "assistant", "content": result["reply"], "timestamp": now.isoformat()})

    response = {
        "session_id": session_id,
        "reply": result["reply"],
        "tags": result.get("tags"),
        "type_name": result.get("type_name"),
        "type_description": result.get("type_description"),
        "sql": result.get("sql"),
        "is_final": result.get("is_final", False),
        "dimension_tags_list": result.get("dimension_tags_list"),  # 多个类型标签
    }

    # 如果是最终结果，保存到会话
    if result.get("is_final"):
        if result.get("dimension_tags_list"):
            # 多个类型标签
            session["dimension_tags_list"] = result.get("dimension_tags_list")
        else:
            session["generated_sql"] = result.get("sql")
            session["type_name"] = result.get("type_name")
            session["type_description"] = result.get("type_description")
            session["confirmed_tags"] = result.get("tags", [])

    return response


@router.get("/chat/dimension/{session_id}")
async def get_dimension_chat_session(
    session_id: str,
    current_user: User = Depends(get_current_user)
):
    """获取维度标签对话会话信息"""
    session = _dimension_chat_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    return {
        "session_id": session["session_id"],
        "dimension": session["dimension_info"],
        "messages": [
            {"role": m["role"], "content": m["content"], "timestamp": m.get("timestamp")}
            for m in session["messages"]
        ],
        "confirmed_tags": session.get("confirmed_tags", []),
        "generated_sql": session.get("generated_sql"),
        "type_name": session.get("type_name"),
        "type_description": session.get("type_description")
    }


@router.delete("/chat/dimension/{session_id}")
async def delete_dimension_chat_session(
    session_id: str,
    current_user: User = Depends(get_current_user)
):
    """删除维度标签对话会话"""
    if session_id in _dimension_chat_sessions:
        del _dimension_chat_sessions[session_id]
    return {"message": "会话已删除"}


# ==================== AI 维度定义对话 ====================

# 维度定义会话存储
_dimension_define_sessions: dict = {}


@router.post("/chat/define-dimension/create")
async def create_dimension_define_session(
    first_message: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建维度定义对话会话
    用户通过AI对话来定义新的维度
    """
    # 获取仓库连接
    engine, config = await get_warehouse_engine(db)

    table_schema = ""

    try:
        with engine.connect() as conn:
            # 获取所有表的结构，只提取ID相关字段
            schema_name = config.get("schema_name") or config.get("database")
            tables_result = conn.execute(text(
                f"SELECT table_name FROM information_schema.tables WHERE table_schema = '{schema_name}'"
            ))
            all_tables = [row[0] for row in tables_result.fetchall()]

            # 只列出每个表的ID字段
            id_fields_info = []
            for tbl in all_tables[:50]:
                try:
                    desc_result = conn.execute(text(f"DESCRIBE `{tbl}`"))
                    columns = desc_result.fetchall()
                    id_cols = []
                    for col in columns:
                        col_name = col[0].lower()
                        if '_id' in col_name or col_name == 'id' or col_name.endswith('id'):
                            id_cols.append(col[0])
                    if id_cols:
                        id_fields_info.append(f"{tbl}: {', '.join(id_cols)}")
                except:
                    pass

            table_schema = "可用的ID字段:\n" + "\n".join(id_fields_info)

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"读取数据失败: {str(e)}")

    # 创建会话
    session_id = str(uuid.uuid4())
    now = datetime.now()

    initial_prompt = first_message or "你好，我想定义一个新的维度"

    # AI 初始分析
    ai_assistant = AIAssistant()
    initial_result = ai_assistant.chat_for_dimension_definition(
        table_schema=table_schema,
        messages=[],
        user_message=initial_prompt
    )

    # 保存会话
    _dimension_define_sessions[session_id] = {
        "session_id": session_id,
        "table_schema": table_schema,
        "messages": [
            {"role": "user", "content": initial_prompt, "timestamp": now.isoformat()},
            {"role": "assistant", "content": initial_result["reply"], "timestamp": now.isoformat()},
        ],
        "defined_dimension": None,
        "created_at": now.isoformat(),
        "user_id": current_user.id,
    }

    return {
        "session_id": session_id,
        "initial_message": initial_result["reply"],
        "dimension": initial_result.get("dimension"),
        "is_final": initial_result.get("is_final", False)
    }


@router.post("/chat/define-dimension/send")
async def send_dimension_define_message(
    session_id: str,
    message: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """发送维度定义对话消息"""
    session = _dimension_define_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    # 构建消息历史
    messages = [{"role": m["role"], "content": m["content"]} for m in session["messages"]]

    # 调用 AI
    ai_assistant = AIAssistant()
    result = ai_assistant.chat_for_dimension_definition(
        table_schema=session["table_schema"],
        messages=messages,
        user_message=message
    )

    # 更新消息历史
    now = datetime.now()
    session["messages"].append({"role": "user", "content": message, "timestamp": now.isoformat()})
    session["messages"].append({"role": "assistant", "content": result["reply"], "timestamp": now.isoformat()})

    # 如果AI返回了维度定义，保存到会话
    if result.get("is_final") and result.get("dimension"):
        session["defined_dimension"] = result["dimension"]

    return {
        "session_id": session_id,
        "reply": result["reply"],
        "dimension": result.get("dimension"),
        "is_final": result.get("is_final", False)
    }


@router.post("/chat/define-dimension/confirm")
async def confirm_dimension_definition(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """确认并保存维度定义"""
    session = _dimension_define_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在或已过期")

    dimension_data = session.get("defined_dimension")
    if not dimension_data:
        raise HTTPException(status_code=400, detail="还没有确定的维度定义")

    # 创建维度
    dimension = TagDimension(
        name=dimension_data["name"],
        display_name=dimension_data["display_name"],
        id_field=dimension_data["id_field"],
        description=dimension_data.get("description", ""),
        is_preset=False,
        is_active=True,
        created_by=current_user.id
    )
    db.add(dimension)
    await db.commit()
    await db.refresh(dimension)

    # 清理会话
    del _dimension_define_sessions[session_id]

    return {
        "message": "维度创建成功",
        "dimension": TagDimensionResponse.model_validate(dimension)
    }


@router.delete("/chat/define-dimension/{session_id}")
async def delete_dimension_define_session(
    session_id: str,
    current_user: User = Depends(get_current_user)
):
    """删除维度定义对话会话"""
    if session_id in _dimension_define_sessions:
        del _dimension_define_sessions[session_id]
    return {"message": "会话已删除"}
