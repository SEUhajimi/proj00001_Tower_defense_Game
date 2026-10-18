"""渲染脚本的通用工具：场景、相机、材质、几何体。render.py 和 vehicles.py 共用。

坐标约定：游戏的格子坐标 (x, y) 对应 Blender 的 (x, -y)；1 格 = 1 个 Blender 单位，高度也按格算。
游戏画面 1 格宽 64 像素（2:1 等角）；这里按 2 倍分辨率渲染，游戏里缩小一半显示。
"""
import math
import os

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, 'art', 'textures')
OUT = os.path.join(ROOT, 'public', 'assets', 'rendered')

PX_PER_UNIT = 32 * math.sqrt(2) * 2  # 游戏 1 格边长在画面上的像素（2 倍分辨率）
ELEVATION = math.radians(30)  # 相机俯角：2:1 等角

manifest: dict = {}
_mats: dict = {}  # 同一场景里复用材质


# ---------- 场景 ----------

def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()  # 重置场景后旧材质都没了
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.cycles.device = 'CPU'
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'

    world = bpy.data.worlds.new('world')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.55, 0.6, 0.68, 1)
    bg.inputs['Strength'].default_value = 0.55

    # 太阳从画面左上方照下来，影子落向右下
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.2
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(42), math.radians(-28), math.radians(-35))
    scene.collection.objects.link(sun)


def camera(width_px: int, height_px: int, shift_y: float = 0.0) -> None:
    """正交相机：画面中心对准原点，shift_y 把原点往画面下方挪（给高的东西留出头顶空间）。"""
    scene = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(width_px, height_px) / PX_PER_UNIT
    cam.data.shift_y = shift_y
    cam.data.clip_end = 200
    d = 50
    fwd = Vector((-math.cos(ELEVATION) * math.sin(math.radians(45)), math.cos(ELEVATION) * math.cos(math.radians(45)), -math.sin(ELEVATION)))
    cam.location = -fwd * d
    cam.rotation_euler = (math.radians(90) - ELEVATION, 0, math.radians(45))
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = width_px
    scene.render.resolution_y = height_px


def shadow_catcher(size: float = 12) -> None:
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    bpy.context.active_object.is_shadow_catcher = True


def top_height() -> float:
    """场景里最高点的高度（格），阴影接收面不算。"""
    top = 0.0
    for o in bpy.context.scene.objects:
        if o.type != 'MESH' or o.is_shadow_catcher or o.hide_render:
            continue
        top = max(top, max((o.matrix_world @ Vector(c)).z for c in o.bound_box))
    return top


def lift_px(z: float) -> float:
    """高度 z（格）在游戏画面上（1 倍分辨率）往上偏多少像素。"""
    return z * PX_PER_UNIT / 2 * math.cos(ELEVATION)


def render(rel: str, w: int, h: int, shift_y: float, extra: dict | None = None) -> None:
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # 锚点：世界原点在图里的像素位置（游戏里把它对准占地中心或单位脚下）
    big = max(w, h)
    manifest[rel.replace('\\', '/')] = {'w': w, 'h': h, 'ax': w / 2, 'ay': h / 2 + shift_y * big, **(extra or {})}
    print('rendered', rel)


# ---------- 材质 ----------

def pbr(name: str, tex: str, scale: float = 1.0, tint=(1, 1, 1), rough: float | None = None, metal: float = 0.0, offset=(0.0, 0.0)):
    """用 CC0 照片贴图做材质，盒式投影，不用展 UV。"""
    key = (name, tex, scale, tint, offset)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes['Principled BSDF']
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (scale, scale, scale)
    mapping.inputs['Location'].default_value = (offset[0], offset[1], 0)
    links.new(coord.outputs['Object'], mapping.inputs['Vector'])

    def img(file: str, color: bool):
        path = os.path.join(TEX, tex, file)
        if not os.path.exists(path):
            return None
        n = nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(path, check_existing=True)
        n.image.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        n.projection = 'BOX'
        n.projection_blend = 0.3
        links.new(mapping.outputs['Vector'], n.inputs['Vector'])
        return n

    diff = img('diff.jpg', True)
    if diff:
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1
        mix.inputs['B'].default_value = (*tint, 1)
        links.new(diff.outputs['Color'], mix.inputs['A'])
        links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    nor = img('nor.jpg', False) or img('nor.png', False)
    if nor:
        nm = nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = 0.8
        links.new(nor.outputs['Color'], nm.inputs['Color'])
        links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    arm = img('arm.jpg', False)
    if arm and rough is None:
        sep = nodes.new('ShaderNodeSeparateColor')
        links.new(arm.outputs['Color'], sep.inputs['Color'])
        links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    else:
        bsdf.inputs['Roughness'].default_value = 0.7 if rough is None else rough
    bsdf.inputs['Metallic'].default_value = metal
    _mats[key] = m
    return m


def flat(name: str, color, rough: float = 0.6, metal: float = 0.0, emission: float = 0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emission:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emission
    return m


def camo(name: str, colors):
    """军用迷彩：噪声分出三块颜色，再叠一层锈铁贴图的凹凸。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes['Principled BSDF']
    coord = nodes.new('ShaderNodeTexCoord')
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 3.5
    noise.inputs['Detail'].default_value = 2
    links.new(coord.outputs['Object'], noise.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (*colors[0], 1)
    els[1].position, els[1].color = 0.48, (*colors[1], 1)
    e = els.new(0.6)
    e.color = (*colors[2], 1)
    links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.75
    bsdf.inputs['Metallic'].default_value = 0.15
    return m


# ---------- 搭模型的小工具 ----------

def box(size, loc, mat, bevel: float = 0.0, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    o.data.materials.append(mat)
    if parent:
        o.parent = parent
    return o


def cyl(r, depth, loc, mat, rot=(0, 0, 0), verts=24, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    if parent:
        o.parent = parent
    return o


def sphere(r, loc, mat, scale=(1, 1, 1), parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=20, ring_count=12)
    o = bpy.context.active_object
    o.scale = scale
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    if parent:
        o.parent = parent
    return o


def empty(name: str):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    return o


TEAM = {'player': (0.12, 0.35, 0.8), 'enemy': (0.75, 0.12, 0.1)}
