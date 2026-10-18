"""建筑受损和废墟。

受损：在搭好的建筑上炸出几个缺口、整体烧黑几块、四周散落碎块。血量降到一半以下时游戏换成这张图。
废墟：建筑被摧毁后留在原地的瓦砾堆，按占地大小（1、2、3 格）各做几张通用的，不分建筑。
坐标同 kit.py。
"""
import math
import random

import bpy
from mathutils import Vector

from kit import box, cyl, flat, pbr, top_height


def _meshes():
    return [o for o in bpy.context.scene.objects
            if o.type == 'MESH' and not o.is_shadow_catcher and not o.hide_render]


def _chunk_mats():
    return [
        pbr('rb_conc', 'concrete', 1.0, tint=(0.72, 0.7, 0.66)),
        pbr('rb_conc2', 'concrete_floor', 1.0, tint=(0.6, 0.58, 0.55)),
        pbr('rb_brick', 'brick', 1.5, tint=(0.8, 0.75, 0.72)),
        flat('rb_char', (0.03, 0.028, 0.025), rough=0.95),
    ]


def scorch(seed: int, amount: float = 0.5) -> None:
    """所有材质叠一层焦黑：按世界坐标取噪声，噪声高的地方烧黑。amount 越大烧黑的面积越大。"""
    for m in list(bpy.data.materials):
        if not m.use_nodes:
            continue
        nodes, links = m.node_tree.nodes, m.node_tree.links
        bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf or 'scorch' in nodes:
            continue
        inp = bsdf.inputs['Base Color']
        geo = nodes.new('ShaderNodeNewGeometry')
        noise = nodes.new('ShaderNodeTexNoise')
        noise.name = 'scorch'
        noise.noise_dimensions = '4D'
        noise.inputs['W'].default_value = seed * 3.1
        noise.inputs['Scale'].default_value = 1.4
        noise.inputs['Detail'].default_value = 6
        links.new(geo.outputs['Position'], noise.inputs['Vector'])
        ramp = nodes.new('ShaderNodeValToRGB')
        els = ramp.color_ramp.elements
        els[0].position, els[0].color = 0.62 - amount * 0.25, (1, 1, 1, 1)
        els[1].position, els[1].color = 0.7 - amount * 0.2, (0.06, 0.055, 0.05, 1)
        links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1
        if inp.links:
            links.new(inp.links[0].from_socket, mix.inputs['A'])
        else:
            mix.inputs['A'].default_value = inp.default_value
        links.new(ramp.outputs['Color'], mix.inputs['B'])
        links.new(mix.outputs['Result'], inp)


def _cutter(center, r, seed):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=3, location=center)
    c = bpy.context.active_object
    c.name = 'cutter'
    t = bpy.data.textures.new(f'cut{seed}', 'CLOUDS')
    t.noise_scale = r * 0.6
    mod = c.modifiers.new('d', 'DISPLACE')
    mod.texture = t
    mod.strength = r * 0.6
    mod.texture_coords = 'GLOBAL'
    bpy.ops.object.modifier_apply(modifier='d')
    c.hide_render = True
    c.hide_viewport = True
    return c


def bite(center, r, seed) -> None:
    """在 center 处炸出一个半径约 r 的缺口：碰到的每个物体都减去一个不规则的球。"""
    c = _cutter(center, r, seed)
    cv = Vector(center)
    for o in _meshes():
        if o is c:
            continue
        corners = [o.matrix_world @ Vector(p) for p in o.bound_box]
        lo = Vector((min(p.x for p in corners), min(p.y for p in corners), min(p.z for p in corners)))
        hi = Vector((max(p.x for p in corners), max(p.y for p in corners), max(p.z for p in corners)))
        near = Vector((min(max(cv.x, lo.x), hi.x), min(max(cv.y, lo.y), hi.y), min(max(cv.z, lo.z), hi.z)))
        if (near - cv).length > r * 1.3:
            continue
        mod = o.modifiers.new('bite', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = c
        mod.solver = 'EXACT'


def chunks(rng, n, center, spread, mats, size=0.07, mound=0.0) -> None:
    """散落的碎块：混凝土、砖、烧焦的木头。mound > 0 时堆成中间高的一堆。"""
    cx, cy = center
    for _ in range(n):
        a = rng.uniform(0, 2 * math.pi)
        d = spread * math.sqrt(rng.random())
        s = size * rng.uniform(0.5, 1.6)
        z = mound * (1 - d / spread) * rng.uniform(0.4, 1.0) if mound else 0
        box((s * rng.uniform(0.8, 1.8), s * rng.uniform(0.6, 1.4), s * rng.uniform(0.4, 0.9)),
            (cx + math.cos(a) * d, cy + math.sin(a) * d, z + s * 0.25), rng.choice(mats), bevel=s * 0.12,
            rot=(rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(0, 6.28)))


def damage(size: int, seed: int) -> None:
    """把已经搭好的建筑改成受损的样子。"""
    rng = random.Random(seed)
    top = top_height()
    objs = _meshes()
    # 缺口开在建筑上半部：随机挑上部的物体，在它的顶面附近炸
    tall = []
    for o in objs:
        corners = [o.matrix_world @ Vector(p) for p in o.bound_box]
        zt = max(p.z for p in corners)
        if zt > top * 0.45 and zt > 0.15:
            cx = sum(p.x for p in corners) / 8
            cy = sum(p.y for p in corners) / 8
            tall.append((cx, cy, zt))
    for k in range(size if size > 1 else 1):
        if not tall:
            break
        cx, cy, zt = rng.choice(tall)
        r = (0.18 + 0.1 * size) * rng.uniform(0.8, 1.2)
        bite((cx + rng.uniform(-0.2, 0.2) * size, cy + rng.uniform(-0.2, 0.2) * size, zt), r, seed * 10 + k)
    scorch(seed, 0.45)
    mats = _chunk_mats()
    # 碎块散在占地边缘和前方（画面上看得见的一侧）
    for _ in range(3 + size):
        a = rng.uniform(0, 2 * math.pi)
        d = size * 0.5 * rng.uniform(0.85, 1.05)
        chunks(rng, 5 + 2 * size, (math.cos(a) * d, math.sin(a) * d), 0.12 + 0.05 * size, mats, 0.05 + 0.015 * size)


def ruins(size: int, seed: int) -> None:
    """一座建筑塌成的瓦砾堆：焦黑的地面、碎块堆、几截残墙、露出来的钢筋和烧焦的梁。"""
    rng = random.Random(seed)
    mats = _chunk_mats()
    # 焦黑的地面：圆形渐隐的黑斑
    bpy.ops.mesh.primitive_plane_add(size=size * 1.25, location=(0, 0, 0.004))
    decal = bpy.context.active_object
    decal.data.materials.append(_burn_decal(seed, size * 1.25 / 2))
    R = size * 0.42
    # 残墙：沿占地边缘立几截，顶上炸得参差不齐
    walls = []
    for k in range(rng.randint(2, 3) if size > 1 else 1):
        a = rng.choice([0, 0.5, 1, 1.5]) * math.pi + rng.uniform(-0.3, 0.3)
        d = R * rng.uniform(0.7, 0.95)
        h = (0.35 + 0.2 * size) * rng.uniform(0.7, 1.1)
        L = size * rng.uniform(0.25, 0.45)
        rot = a + math.pi / 2
        w = box((L, 0.08, h), (math.cos(a) * d, math.sin(a) * d, h / 2), rng.choice(mats[:3]),
                bevel=0.01, rot=(rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), rot))
        walls.append((w, math.cos(a) * d, math.sin(a) * d, h, L, rot))
    for i, (_w, x, y, h, L, rot) in enumerate(walls):
        bite((x + math.cos(rot) * L * 0.3, y + math.sin(rot) * L * 0.3, h), h * 0.6, seed * 10 + i)
    # 碎块堆
    chunks(rng, int(34 * size * size), (0, 0), R, mats[:3], 0.06 + 0.02 * size, mound=0.25 + 0.15 * size)
    chunks(rng, 8 * size, (0, 0), R * 1.35, mats, 0.05)
    # 钢筋和烧焦的梁
    rebar = flat('rebar', (0.25, 0.12, 0.06), rough=0.6, metal=0.6)
    for _ in range(3 * size):
        a, d = rng.uniform(0, 2 * math.pi), R * rng.uniform(0, 0.7)
        L = rng.uniform(0.2, 0.45) * (0.7 + 0.3 * size)
        cyl(0.008, L, (math.cos(a) * d, math.sin(a) * d, 0.1 + L * 0.35), rebar, verts=6,
            rot=(rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), 0))
    for _ in range(size + 1):
        a, d = rng.uniform(0, 2 * math.pi), R * rng.uniform(0.1, 0.6)
        L = rng.uniform(0.4, 0.7) * size ** 0.5
        box((L, 0.06, 0.06), (math.cos(a) * d, math.sin(a) * d, 0.12), mats[3],
            rot=(0, rng.uniform(-0.5, 0.5), rng.uniform(0, 6.28)))
    scorch(seed, 0.4)


def _burn_decal(seed: int, half: float):
    """地上的焦黑斑：中间黑，往外按噪声渐隐成透明。"""
    m = bpy.data.materials.new('burn')
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.025, 0.022, 0.02, 1)
    bsdf.inputs['Roughness'].default_value = 1
    coord = nodes.new('ShaderNodeTexCoord')
    length = nodes.new('ShaderNodeVectorMath')
    length.operation = 'LENGTH'
    links.new(coord.outputs['Object'], length.inputs[0])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '4D'
    noise.inputs['W'].default_value = seed
    noise.inputs['Scale'].default_value = 2.5 / half
    noise.inputs['Detail'].default_value = 5
    links.new(coord.outputs['Object'], noise.inputs['Vector'])

    def math_node(op, a, b, clamp=False):
        n = nodes.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, x in enumerate((a, b)):
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                links.new(x, n.inputs[i])
        return n.outputs[0]

    radial = math_node('SUBTRACT', 1.0, math_node('DIVIDE', length.outputs['Value'], half))
    a = math_node('ADD', math_node('MULTIPLY', radial, 2.2), math_node('MULTIPLY', math_node('SUBTRACT', noise.outputs['Fac'], 0.5), 2.5))
    alpha = math_node('MULTIPLY', math_node('SUBTRACT', a, 0.3, clamp=True), 0.9, clamp=True)
    links.new(alpha, bsdf.inputs['Alpha'])
    return m


RUIN_VARIANTS = 2
RUINS = {f's{size}-{v}': (size, (lambda size=size, v=v: ruins(size, 300 + size * 10 + v)))
         for size in (1, 2, 3) for v in range(RUIN_VARIANTS)}
