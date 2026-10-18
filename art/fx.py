"""开火和爆炸特效：用体积（一团带噪声的“雾”）渲染逐帧图。

  explosion  爆炸：火球迅速胀大、变暗，翻成黑烟
  smoke      烟团：灰黑色的烟胀大、变淡（大东西被摧毁时）
  fire       火焰：受损建筑上烧着的火，循环播放
  flash      枪口火光：一张星形的亮光
每种的锚点都是地面上的原点（火焰是火苗底部），游戏里对准爆炸点。
"""
import math

import bpy

from kit import camera, empty, flat, render, reset


def _math(nodes, links, op, a, b=None, clamp=False):
    n = nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            links.new(x, n.inputs[i])
    return n.outputs[0]


def volume(name: str, stretch: float = 1.0):
    """体积材质。可调参数是几个 Value 节点，逐帧改它们的值：
    R 形状半径（0–1，相对体积物体）、D 浓度、E 发光强度、W 噪声随时间变化、rise 噪声往上飘的距离、
    H 温度系数（越大越接近白热）。
    形状 = 球形衰减 × 噪声，越靠中心越浓、越热。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    nodes.remove(nodes['Principled BSDF'])
    vol = nodes.new('ShaderNodeVolumePrincipled')
    vol.name = 'vol'
    links.new(vol.outputs[0], nodes['Material Output'].inputs['Volume'])

    def val(n, v):
        node = nodes.new('ShaderNodeValue')
        node.name = n
        node.outputs[0].default_value = v
        return node.outputs[0]

    R, D, E, W, rise, H = val('R', 1), val('D', 1), val('E', 0), val('W', 0), val('rise', 0), val('H', 2.0)
    coord = nodes.new('ShaderNodeTexCoord')
    # 噪声坐标往下挪 = 花纹往上飘
    shift = nodes.new('ShaderNodeCombineXYZ')
    links.new(_math(nodes, links, 'MULTIPLY', rise, -1.0), shift.inputs['Z'])
    moved = nodes.new('ShaderNodeVectorMath')
    moved.operation = 'ADD'
    links.new(coord.outputs['Object'], moved.inputs[0])
    links.new(shift.outputs[0], moved.inputs[1])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '4D'
    noise.inputs['Scale'].default_value = 2.2
    noise.inputs['Detail'].default_value = 8
    noise.inputs['Roughness'].default_value = 0.6
    links.new(moved.outputs[0], noise.inputs['Vector'])
    links.new(W, noise.inputs['W'])
    # 球形衰减：1 - |p| / R
    length = nodes.new('ShaderNodeVectorMath')
    length.operation = 'LENGTH'
    links.new(coord.outputs['Object'], length.inputs[0])
    shape = _math(nodes, links, 'SUBTRACT', 1.0, _math(nodes, links, 'DIVIDE', length.outputs['Value'], R), clamp=True)
    n = noise.outputs['Fac']
    dens = _math(nodes, links, 'MULTIPLY', _math(nodes, links, 'SUBTRACT', _math(nodes, links, 'ADD', n, shape), 1.0), 3.0, clamp=True)
    links.new(_math(nodes, links, 'MULTIPLY', _math(nodes, links, 'MULTIPLY', dens, D), 12.0), vol.inputs['Density'])
    heat = _math(nodes, links, 'MULTIPLY', _math(nodes, links, 'SUBTRACT', _math(nodes, links, 'ADD', n, _math(nodes, links, 'MULTIPLY', shape, 1.4)), 1.0), H, clamp=True)
    ramp = nodes.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.2, 0.01, 0.0, 1)
    els[1].position, els[1].color = 1.0, (1.0, 0.75, 0.3, 1)
    e = els.new(0.4)
    e.color = (0.9, 0.12, 0.01, 1)
    e = els.new(0.75)
    e.color = (1.0, 0.4, 0.04, 1)
    links.new(heat, ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], vol.inputs['Emission Color'])
    links.new(_math(nodes, links, 'MULTIPLY', heat, E), vol.inputs['Emission Strength'])
    vol.inputs['Color'].default_value = (0.05, 0.045, 0.04, 1)
    return m


def _domain(mat, scale, z):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=1, subdivisions=3, location=(0, 0, z))
    o = bpy.context.active_object
    o.scale = scale
    o.data.materials.append(mat)
    return o


def _setup(px: int, shift: float):
    reset()
    sc = bpy.context.scene
    sc.cycles.samples = 48
    sc.cycles.volume_bounces = 1
    sc.cycles.volume_step_rate = 0.5
    # AgX 会把亮的火光压成发白的米色，特效用标准色彩变换，火才是橙红的
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    camera(px, px, shift_y=shift)


def _set(mat, **kw):
    nodes = mat.node_tree.nodes
    for k, v in kw.items():
        if k == 'color':
            nodes['vol'].inputs['Color'].default_value = (*v, 1)
        else:
            nodes[k].outputs[0].default_value = v


FRAMES = 8


def render_explosion() -> None:
    """爆炸 8 帧：前两帧是亮黄的火球，之后变红变暗，最后是散开的黑烟。"""
    px = 256
    _setup(px, 0.12)
    mat = volume('boom')
    _domain(mat, (1.5, 1.5, 1.3), 0.8)
    for k in range(FRAMES):
        t = k / (FRAMES - 1)
        _set(mat, R=0.45 + 0.55 * (1 - (1 - t) ** 2), D=0.9 - 0.45 * t, E=28 * (1 - t / 0.75) ** 1.5 if t < 0.75 else 0.0,
             W=t * 1.2, rise=t * 0.35, color=(0.06 + 0.05 * t,) * 3)
        render(f'fx/explosion-{k}.png', px, px, 0.12)


def render_smoke() -> None:
    """烟团 8 帧：灰黑色的烟胀大、往上飘、变淡，底部带一点余火。"""
    px = 256
    _setup(px, 0.15)
    mat = volume('smoke')
    _domain(mat, (1.3, 1.3, 1.4), 1.0)
    for k in range(FRAMES):
        t = k / (FRAMES - 1)
        _set(mat, R=0.5 + 0.5 * t, D=0.85 * (1 - t) ** 1.3 + 0.05, E=5 * max(0.0, 1 - t * 2.5), W=t * 0.8, rise=t * 0.5,
             color=(0.1 + 0.08 * t,) * 3)
        render(f'fx/smoke-{k}.png', px, px, 0.15)


def render_fire() -> None:
    """火焰循环 8 帧：瘦高的火苗，噪声一直往上飘；顶上冒一点黑烟。"""
    px = 192
    _setup(px, 0.3)
    mat = volume('fire')
    _domain(mat, (0.45, 0.45, 1.0), 0.8)
    for k in range(FRAMES):
        t = k / FRAMES
        # W 绕一个小圈变化不了（只有一维），就让它和 rise 一起匀速走，循环接缝处变化很小
        _set(mat, R=1.35, D=0.6, E=9, H=0.8, W=t * 0.6, rise=t * 1.2, color=(0.05, 0.045, 0.04))
        render(f'fx/fire-{k}.png', px, px, 0.3)


def render_flash() -> None:
    """枪口火光：几根发光的尖刺围成的星形，中间一个亮点。"""
    px = 64
    reset()
    bpy.context.scene.view_settings.view_transform = 'Standard'
    bpy.context.scene.view_settings.look = 'None'
    camera(px, px, 0)
    hot = flat('flash', (1.0, 0.55, 0.15), emission=4)
    core = flat('core', (1.0, 0.85, 0.5), emission=8)
    # 星形搭在一个平面里，再整体转到正对相机（和相机同样的旋转）
    root = empty('flash')
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.05, location=(0, 0, 0))
    o = bpy.context.active_object
    o.data.materials.append(core)
    o.parent = root
    for k in range(6):
        a = k * math.pi / 3 + 0.3
        L = 0.16 if k % 2 else 0.24
        bpy.ops.mesh.primitive_cone_add(radius1=0.035, radius2=0, depth=L, vertices=8,
                                        location=(math.cos(a) * L / 2, math.sin(a) * L / 2, 0), rotation=(0, math.pi / 2, a))
        o = bpy.context.active_object
        o.data.materials.append(hot)
        o.parent = root
    root.rotation_euler = bpy.context.scene.camera.rotation_euler.copy()
    bpy.context.scene.cycles.samples = 16
    render('fx/flash.png', px, px, 0)


FX = {'explosion': render_explosion, 'smoke': render_smoke, 'fire': render_fire, 'flash': render_flash}
