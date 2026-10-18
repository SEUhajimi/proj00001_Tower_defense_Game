"""资源图标：每种资源一个小物件，按游戏的等角视角渲染成 128×128 的图（界面里缩小显示）。

  gold 金条堆  food 粮袋和麦穗  wood 原木堆  stone 石料块
  steel 工字钢  fuel 红色油桶  ammo 炮弹  electronics 电路板
物件都摆在原点附近、大约 0.8 格见方，坐标同 kit.py。
"""
import math

import bpy

from kit import box, cyl, flat, pbr, sphere
from vehicles import extrude


def _cone(r1, r2, depth, loc, mat, verts=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o


def gold():
    m = flat('gold', (1.0, 0.68, 0.18), rough=0.22, metal=1.0)

    def bar(x, y, z, rot=0.0):
        # 梯形截面的金条：底宽顶窄
        pts = [(-0.13, 0), (0.13, 0), (0.1, 0.1), (-0.1, 0.1)]
        o = extrude('bar', [(p[0] + y, p[1] + z) for p in pts], 'x', x - 0.22, x + 0.22, m, None, bevel=0.012)
        o.rotation_euler = (0, 0, rot)
        return o
    for k, y in enumerate((-0.15, 0.15)):
        bar(0, y, 0)
    bar(0, 0, 0.1)


def food():
    sack = flat('sack', (0.62, 0.48, 0.28), rough=0.95)
    rope = flat('rope', (0.35, 0.25, 0.12), rough=0.9)
    sphere(0.26, (0, 0, 0.24), sack, scale=(1, 1, 1.05))
    _cone(0.17, 0.08, 0.16, (0, 0, 0.52), sack)
    cyl(0.085, 0.04, (0, 0, 0.48), rope, verts=16)
    # 袋口露出的麦穗
    wheat = flat('wheat', (0.85, 0.66, 0.22), rough=0.7)
    for k in range(5):
        a = k * 2 * math.pi / 5
        o = sphere(0.035, (math.cos(a) * 0.04, math.sin(a) * 0.04, 0.66), wheat, scale=(0.7, 0.7, 2.2))
        o.rotation_euler = (math.cos(a) * 0.4, math.sin(a) * 0.4, 0)
    # 地上撒的一小堆粮
    sphere(0.12, (0.26, -0.22, 0.0), wheat, scale=(1, 1, 0.35))


def wood():
    bark = pbr('bark', 'bark', 4.0)
    end = flat('woodend', (0.78, 0.58, 0.34), rough=0.8)
    for (y, z) in ((-0.15, 0.1), (0.15, 0.1), (0, 0.36)):
        cyl(0.13, 0.62, (0, y, z), bark, rot=(0, math.radians(90), 0), verts=20)
        for sx in (-1, 1):
            cyl(0.115, 0.01, (sx * 0.311, y, z), end, rot=(0, math.radians(90), 0), verts=20)


def stone():
    m = pbr('stoneblk', 'concrete', 1.5, tint=(0.75, 0.73, 0.7))
    box((0.3, 0.3, 0.22), (-0.12, 0.08, 0.11), m, bevel=0.02, rot=(0, 0, 0.1))
    box((0.28, 0.28, 0.2), (0.17, -0.1, 0.1), m, bevel=0.02, rot=(0, 0, -0.15))
    box((0.26, 0.26, 0.2), (0.02, 0.0, 0.32), m, bevel=0.02, rot=(0, 0, 0.35))


def steel():
    m = flat('steelbeam', (0.55, 0.58, 0.62), rough=0.3, metal=1.0)
    # 工字钢截面
    t, w, h = 0.025, 0.16, 0.16
    prof = [(-w / 2, 0), (w / 2, 0), (w / 2, t), (t / 2, t), (t / 2, h - t), (w / 2, h - t), (w / 2, h),
            (-w / 2, h), (-w / 2, h - t), (-t / 2, h - t), (-t / 2, t), (-w / 2, t)]
    for (y, z) in ((-0.1, 0.0), (0.1, 0.0), (0.0, h)):
        extrude('beam', [(p[0] + y, p[1] + z) for p in prof], 'x', -0.32, 0.32, m, None, bevel=0.004)


def fuel():
    red = flat('can', (0.72, 0.06, 0.04), rough=0.35, metal=0.3)
    dark = flat('cap', (0.12, 0.12, 0.12), rough=0.5)
    box((0.2, 0.42, 0.52), (0, 0, 0.26), red, bevel=0.03)
    for y in (-0.08, 0.08):  # 提手
        box((0.04, 0.04, 0.1), (0, y, 0.56), red, bevel=0.01)
    box((0.04, 0.2, 0.04), (0, 0, 0.62), red, bevel=0.01)
    cyl(0.045, 0.1, (0, -0.15, 0.55), dark, rot=(math.radians(-30), 0, 0), verts=16)
    box((0.21, 0.3, 0.02), (0, 0, 0.36), flat('canx', (0.55, 0.04, 0.03), rough=0.4), rot=(0.9, 0, 0))  # 侧面的 X 压筋
    box((0.21, 0.3, 0.02), (0, 0, 0.36), flat('canx', (0.55, 0.04, 0.03), rough=0.4), rot=(-0.9, 0, 0))


def ammo():
    brass = flat('brass', (0.85, 0.6, 0.22), rough=0.25, metal=1.0)
    tip = flat('tip', (0.25, 0.27, 0.22), rough=0.4, metal=0.6)
    for (x, y) in ((-0.13, 0.1), (0.13, 0.1), (0.0, -0.12)):
        cyl(0.08, 0.36, (x, y, 0.18), brass, verts=24)
        cyl(0.085, 0.03, (x, y, 0.015), brass, verts=24)
        _cone(0.08, 0.0, 0.22, (x, y, 0.47), tip, verts=24)


def electronics():
    pcb = flat('pcb', (0.03, 0.32, 0.12), rough=0.45)
    chip = flat('chip', (0.03, 0.03, 0.03), rough=0.35)
    gold_m = flat('pin', (0.95, 0.7, 0.25), rough=0.25, metal=1.0)
    copper = flat('trace', (0.75, 0.5, 0.2), rough=0.3, metal=0.9)
    box((0.62, 0.48, 0.04), (0, 0, 0.02), pcb, bevel=0.005)
    box((0.22, 0.22, 0.05), (-0.08, 0.04, 0.065), chip, bevel=0.005)
    for k in range(5):  # 芯片两边的针脚
        for sx in (-1, 1):
            box((0.03, 0.02, 0.01), (-0.08 + sx * 0.125, 0.04 - 0.08 + k * 0.04, 0.045), gold_m)
    box((0.1, 0.08, 0.04), (0.2, -0.12, 0.06), chip, bevel=0.004)
    cyl(0.04, 0.08, (0.2, 0.13, 0.08), flat('cap2', (0.15, 0.2, 0.55), rough=0.3), verts=16)  # 电容
    for k in range(4):  # 铜线
        box((0.3, 0.012, 0.004), (0.12, -0.2 + k * 0.035, 0.042), copper)
    box((0.08, 0.04, 0.01), (-0.27, -0.2, 0.045), gold_m)


ICONS = {'gold': gold, 'food': food, 'wood': wood, 'stone': stone,
         'steel': steel, 'fuel': fuel, 'ammo': ammo, 'electronics': electronics}
