#!/usr/bin/env python3
"""Plot measured circles and centres without a browser or WebGL (system pycairo).

Run: flock /tmp/storytree-heavy.lock python3 spike/planet-places/render.py
Both PNG and SVG come from the same vector drawing at the same size.
"""
import json
import math
from pathlib import Path
import cairo

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / 'results/measurements.json').read_text())
W, H = 1860, 1540
BG = '#0c1421'
FG = '#e9f0f8'
MUTED = '#aebdd0'
COLORS = {1: '#6cdcd0', 6: '#e8bd63', 19: '#f29b91'}


def color(ctx, value, alpha=1):
    ctx.set_source_rgba(*(int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)), alpha)


def text(ctx, x, y, value, size=21, fill=FG, bold=False):
    color(ctx, fill)
    ctx.select_font_face('DejaVu Sans', cairo.FONT_SLANT_NORMAL,
                         cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
    ctx.set_font_size(size)
    ctx.move_to(x, y)
    ctx.show_text(str(value))


def line(ctx, x1, y1, x2, y2, fill=MUTED, width=1, alpha=1):
    color(ctx, fill, alpha)
    ctx.set_line_width(width)
    ctx.move_to(x1, y1)
    ctx.line_to(x2, y2)
    ctx.stroke()


def ring(ctx, place, angular_radius, cx, cy, scale, side, fill):
    # The ring is the exact radial projection of a flat tangent disc.
    # Plot only visible runs; this does not turn far-side dots into front dots.
    ca, sa = math.cos(angular_radius), math.sin(angular_radius)
    active = False
    color(ctx, fill, .77)
    ctx.set_line_width(1.25)
    for step in range(145):
        t = step * 2 * math.pi / 144
        p = [ca * place['normal'][k] + sa * (math.cos(t) * place['east'][k] +
             math.sin(t) * place['north'][k]) for k in range(3)]
        if side * p[2] >= 0:
            x, y = cx + scale * side * p[0], cy - scale * p[1]
            if active:
                ctx.line_to(x, y)
            else:
                ctx.move_to(x, y)
            active = True
        else:
            active = False
    ctx.stroke()


def globe(ctx, measurement, count, cx, cy, scale, side):
    color(ctx, '#172c40')
    ctx.new_sub_path()
    ctx.arc(cx, cy, scale, 0, 2 * math.pi)
    ctx.fill()
    color(ctx, '#36516a', .65)
    ctx.set_line_width(1)
    for lat in (30, 60, 90):
        ctx.new_sub_path()
        ctx.arc(cx, cy, scale * math.sin(math.radians(lat)), 0, 2 * math.pi)
        ctx.stroke()
    for degrees in range(0, 180, 30):
        a = math.radians(degrees)
        line(ctx, cx - scale * math.cos(a), cy - scale * math.sin(a),
             cx + scale * math.cos(a), cy + scale * math.sin(a), '#36516a', alpha=.4)
    for place in measurement['places'][:count]:
        for shape in reversed(DATA['shapes']):
            r = shape['shoreRadius']['max']
            ring(ctx, place, math.atan(r / measurement['radius']), cx, cy, scale, side,
                 COLORS[shape['capabilities']])
    row = next(c for c in measurement['counts'] if c['count'] == count)
    visible = 0
    for place in measurement['places'][:count]:
        p = place['normal']
        if side * p[2] < 0:
            continue
        visible += 1
        x, y = cx + scale * side * p[0], cy - scale * p[1]
        color(ctx, FG)
        ctx.new_sub_path()
        ctx.arc(x, y, 2.5, 0, 2 * math.pi)
        ctx.fill()
        if place['place'] in (1, count):
            text(ctx, x + 6, y - 7, str(place['place']), 15, bold=True)
    color(ctx, '#58728a')
    ctx.new_sub_path()
    ctx.arc(cx, cy, scale, 0, 2 * math.pi)
    ctx.stroke()
    text(ctx, cx - scale, cy - scale - 19,
         f'{"FRONT" if side == 1 else "BACK"}  /  {visible} centres', 20, MUTED, True)
    if visible == 0:
        text(ctx, cx - 85, cy + 7, 'No story centres', 20, MUTED)


def draw(ctx, count):
    color(ctx, BG)
    ctx.paint()
    text(ctx, 48, 59, f'{count} stories on the wrapped spiral', 38, bold=True)
    text(ctx, 48, 100, 'Same flat spiral and 110 ground units per place-width; each column keeps one fixed globe radius.', 23, MUTED)
    text(ctx, 48, 139, 'White dots: centres. Rings: maximum measured shore radius for', 21, MUTED)
    for x, caps in ((790, 1), (1070, 6), (1350, 19)):
        text(ctx, x, 139, f'{caps} {"capability" if caps == 1 else "capabilities"}', 21, COLORS[caps], True)

    for index, m in enumerate(DATA['measurements']):
        x = 48 + index * 610
        radius = m['radius']
        row = next(r for r in m['counts'] if r['count'] == count)
        text(ctx, x, 199, f'R = {radius:,.1f} ground units', 26, bold=True)
        text(ctx, x, 232, f'{m["radiusPlaceWidths"]:.2f} place-widths  |  place {count} at {row["lastPolarDegrees"]:.1f}°', 20, MUTED)
        text(ctx, x, 263, '100th at 150°' if index == 0 else ('Middle comparison' if index == 1 else 'Recommended, with size bound'), 20, '#b4c9e8')
        globe(ctx, m, count, x + 263, 548, 225, 1)
        globe(ctx, m, count, x + 263, 1060, 225, -1)
        if index < 2:
            line(ctx, x + 568, 188, x + 568, 1480, '#314056')

        text(ctx, x, 1326, 'Minimum actual shore gap (ground units)', 19, MUTED, True)
        for offset, s in enumerate(m['shores']):
            exact = next(r for r in s['byCount'] if r['count'] == count)
            label = 'OVERLAP' if exact['overlap'] else f'{exact["gap"]:.2f}'
            text(ctx, x + offset * 177, 1360, f'{s["capabilities"]} cap', 18, COLORS[s['capabilities']])
            text(ctx, x + offset * 177, 1393, label, 22, COLORS[s['capabilities']], True)
        worst = row['sizes'][-1]['gap']
        text(ctx, x, 1436, f'19-cap circular bound: {worst:+.2f}  |  rim lift: {m["sizes"][-1]["rimLiftApprox"]:.2f}', 18, MUTED)

    text(ctx, 48, 1510, 'Real coast outlines measured separately; circles are conservative bounds. All globes shown at equal screen size. Back view is rotated 180°.', 18, MUTED)


for count in DATA['counts']:
    base = HERE / 'results' / f'places-{count:03d}'
    png = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    draw(cairo.Context(png), count)
    png.write_to_png(str(base.with_suffix('.png')))
    svg = cairo.SVGSurface(str(base.with_suffix('.svg')), W, H)
    draw(cairo.Context(svg), count)
    svg.finish()
    print(base.with_suffix('.png'))
