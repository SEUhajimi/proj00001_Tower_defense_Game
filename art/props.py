"""地图上的树木和岩石：森林地块上摆树丛，山地地块和战场上摆岩石堆。

每张图是一丛（占 2×2 格），锚点是这 2×2 格的中心。坐标同 kit.py。
同一种东西出几张不同的（随机种子不同），游戏里轮流用，免得看着一模一样。
"""
import math
import random

import bpy

from kit import pbr


# ---------- 材质 ----------

def foliage(name: str, dark, light):
    """树叶：噪声在两种绿之间过渡，背光处略透光。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes['Principled BSDF']
    coord = nodes.new('ShaderNodeTexCoord')
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 9
    noise.inputs['Detail'].default_value = 4
    links.new(coord.outputs['Object'], noise.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.35, (*dark, 1)
    els[1].position, els[1].color = 0.65, (*light, 1)
    links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.6
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.85
    bsdf.inputs['Subsurface Weight'].default_value = 0.08
    return m


def stone_mat(name: str):
    """岩石：两种灰随噪声交错，加岩石照片贴图的法线做纹理。"""
    m = pbr(name, 'rock', 1.5, tint=(0.85, 0.85, 0.85))
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes['Principled BSDF']
    coord = nodes.new('ShaderNodeTexCoord')
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 4
    noise.inputs['Detail'].default_value = 6
    links.new(coord.outputs['Object'], noise.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.3, (0.16, 0.155, 0.145, 1)
    els[1].position, els[1].color = 0.7, (0.42, 0.41, 0.385, 1)
    links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    # 照片贴图的颜色压暗后叠在灰色上，保留石头的细纹
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'OVERLAY'
    mix.inputs['Factor'].default_value = 0.5
    links.new(ramp.outputs['Color'], mix.inputs['A'])
    old = bsdf.inputs['Base Color'].links[0].from_socket if bsdf.inputs['Base Color'].links else None
    if old:
        links.new(old, mix.inputs['B'])
    links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    return m


def mats():
    return {
        'bark': pbr('bark', 'bark', 4.0, tint=(0.7, 0.62, 0.55)),
        'pine': foliage('pine', (0.02, 0.06, 0.025), (0.06, 0.13, 0.05)),
        'oak': foliage('oak', (0.04, 0.09, 0.02), (0.14, 0.24, 0.05)),
        'birch': foliage('birch', (0.08, 0.14, 0.03), (0.22, 0.3, 0.07)),
        'rock': stone_mat('rockp'),
        'moss': foliage('moss', (0.05, 0.08, 0.03), (0.12, 0.16, 0.06)),
    }


# ---------- 形状 ----------

def _noise_tex(seed: int, size: float, kind: str = 'CLOUDS'):
    t = bpy.data.textures.new(f'n{seed}', kind)
    t.noise_scale = size
    if kind == 'CLOUDS':
        t.noise_depth = 2
    return t


def blob(r, loc, mat, seed, scale=(1, 1, 1), rough=0.35, size=0.35, subdiv=3, kind='CLOUDS', smooth=True):
    """凹凸不平的团块：细分球加噪声位移。树冠、石头都用它。"""
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=subdiv, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    o.rotation_euler = (0, 0, seed * 1.7)
    mod = o.modifiers.new('d', 'DISPLACE')
    mod.texture = _noise_tex(seed, size, kind)
    mod.strength = r * rough
    mod.mid_level = 0.5
    # 噪声位置随种子错开，每个团块长得不一样
    mod.texture_coords = 'GLOBAL'
    o.location = loc
    o.data.materials.append(mat)
    if smooth:
        bpy.ops.object.shade_smooth()
    return o


def trunk(x, y, h, r, m):
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r * 0.55, depth=h, location=(x, y, h / 2), vertices=10)
    o = bpy.context.active_object
    o.data.materials.append(m['bark'])
    bpy.ops.object.shade_smooth()
    return o


def pine(x, y, s, m, rng):
    """松树：细树干上叠几层锥形的针叶，越往上越小。"""
    h = 1.15 * s
    trunk(x, y, h * 0.4, 0.05 * s, m)
    layers = 4
    for i in range(layers):
        t = i / layers
        r = (0.34 - 0.24 * t) * s
        depth = 0.42 * s
        z = h * (0.18 + 0.62 * t) + depth / 2 - 0.08 * s
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=0.01, depth=depth, location=(x, y, z), vertices=14)
        o = bpy.context.active_object
        o.rotation_euler = (rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), rng.uniform(0, 6.28))
        mod = o.modifiers.new('sub', 'SUBSURF')
        mod.levels = mod.render_levels = 2
        d = o.modifiers.new('d', 'DISPLACE')
        d.texture = _noise_tex(rng.randrange(1000), 0.12)
        d.strength = 0.07 * s
        o.data.materials.append(m['pine'])
        bpy.ops.object.shade_smooth()


def leafy(x, y, s, m, rng, kind='oak'):
    """阔叶树：树干分两三个杈，顶上几团树冠。"""
    h = 0.4 * s
    trunk(x, y, h + 0.1 * s, 0.06 * s, m)
    crown = 0.34 * s
    blob(crown, (x, y, h + crown * 0.7), m[kind], rng.randrange(1000), scale=(1, 1, 0.85), rough=0.5, size=0.18 * s)
    for _ in range(rng.randint(2, 3)):
        a = rng.uniform(0, 2 * math.pi)
        d = crown * rng.uniform(0.45, 0.7)
        rr = crown * rng.uniform(0.55, 0.75)
        blob(rr, (x + math.cos(a) * d, y + math.sin(a) * d, h + crown * rng.uniform(0.45, 0.95)),
             m[kind], rng.randrange(1000), rough=0.5, size=0.15 * s)


def stone(x, y, s, m, rng, mossy=False):
    """一块石头：压扁的不规则团块，半埋在地里。"""
    r = 0.28 * s
    o = blob(r, (x, y, r * 0.25), m['rock'], rng.randrange(1000),
             scale=(rng.uniform(0.9, 1.3), rng.uniform(0.8, 1.1), rng.uniform(0.7, 1.0)), rough=0.6, size=0.35 * s, subdiv=2, kind='VORONOI', smooth=False)
    o.rotation_euler = (rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), rng.uniform(0, 6.28))
    if mossy:  # 脚下长一圈草
        for _ in range(3):
            a = rng.uniform(0, 2 * math.pi)
            blob(r * 0.25, (x + math.cos(a) * r, y + math.sin(a) * r, 0.02), m['moss'], rng.randrange(1000),
                 scale=(1.4, 1, 0.4), rough=0.4, size=0.08)
    return o


# ---------- 树丛、石堆 ----------

# 一丛里各棵树的位置：2×2 格内（中心为原点，范围约 ±0.8），后排先放
def _spots(rng, n):
    pts = []
    while len(pts) < n:
        p = (rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7))
        if all(math.dist(p, q) > 0.42 for q in pts):
            pts.append(p)
    return pts


def trees(seed: int):
    rng = random.Random(seed)
    m = mats()
    # 后排（画面上方，-x、+y 方向）先放，前排挡住后排
    for x, y in sorted(_spots(rng, rng.randint(5, 6)), key=lambda p: p[0] - p[1]):
        s = rng.uniform(1.1, 1.45)
        kind = rng.random()
        if kind < 0.5:
            pine(x, y, s, m, rng)
        else:
            leafy(x, y, s, m, rng, 'oak' if kind < 0.8 else 'birch')
    # 树下零星几簇灌木
    for _ in range(rng.randint(1, 3)):
        x, y = rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7)
        blob(0.12, (x, y, 0.05), m['oak'], rng.randrange(1000), scale=(1, 1, 0.6), rough=0.5, size=0.08)


def rocks(seed: int):
    rng = random.Random(seed)
    m = mats()
    # 一块大的居中偏后，周围几块小的
    stone(rng.uniform(-0.15, 0.1), rng.uniform(0, 0.2), rng.uniform(2.3, 2.7), m, rng, mossy=True)
    for _ in range(rng.randint(3, 4)):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0.55, 0.75)
        stone(math.cos(a) * d, math.sin(a) * d, rng.uniform(0.7, 1.2), m, rng, mossy=rng.random() < 0.4)


VARIANTS = 4
PROPS = {**{f'trees-{i}': (lambda i=i: trees(100 + i)) for i in range(VARIANTS)},
         **{f'rocks-{i}': (lambda i=i: rocks(200 + i)) for i in range(VARIANTS)}}
