"""Rebuild the texture-free wisp with Blender 5.2:
flock /tmp/storytree-heavy.lock ~/.local/bin/blender -b --python packages/forest-world/assets/wisp.blend.py

The exported model faces +X and trails toward -X. Coordinates below are glTF's
Y-up world; convert to Blender's Z-up world before exporting. Two closed low-poly
volumes share an origin, so the renderer can tint them without cloning geometry.
"""
from pathlib import Path
from math import cos, sin, tau
import bpy

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, colour, emission, alpha):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, alpha)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*colour, 1)
    bsdf.inputs['Roughness'].default_value = 0.55
    bsdf.inputs['Emission Color'].default_value = (*colour, 1)
    bsdf.inputs['Emission Strength'].default_value = emission
    bsdf.inputs['Alpha'].default_value = alpha
    if alpha < 1:
        mat.surface_render_method = 'BLENDED'
    return mat


def flame(name, rings, segments, mat):
    # Each ring is (x, centre_y, radius_y, radius_z), from nose to tail.
    vertices = []
    for x, centre_y, ry, rz in rings:
        for j in range(segments):
            angle = tau * j / segments
            y, z = centre_y + ry * cos(angle), rz * sin(angle)
            vertices.append((x, -z, y))
    faces = []
    for i in range(len(rings) - 1):
        for j in range(segments):
            a, b = i * segments + j, i * segments + (j + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.extend([tuple(reversed(range(segments))),
                  tuple((len(rings) - 1) * segments + j for j in range(segments))])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    # Recalculate outward normals on both watertight volumes.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    return obj


flame('WispShell', [
    (2.25, 0.0, 0.12, 0.12),
    (1.7, 0.0, 1.35, 1.35),
    (0.45, 0.0, 2.15, 1.9),
    (-0.95, 0.12, 1.95, 1.7),
    (-2.25, 0.5, 1.3, 1.1),
    (-3.5, 1.2, 0.62, 0.52),
    (-4.9, 2.5, 0.04, 0.04),
], 10, material('ShellPreview', (0.34, 0.69, 1.0), 0.18, 0.62))

flame('WispCore', [
    (1.65, 0.0, 0.06, 0.06),
    (1.0, 0.0, 0.85, 0.85),
    (0.0, 0.05, 1.18, 1.04),
    (-1.05, 0.23, 0.83, 0.73),
    (-2.5, 0.85, 0.04, 0.04),
], 8, material('CorePreview', (0.84, 0.94, 1.0), 0.8, 1.0))

output = Path(__file__).with_name('wisp.glb')
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format='GLB', export_yup=True,
    export_texcoords=False, export_normals=True, export_materials='EXPORT',
    export_cameras=False, export_lights=False, export_animations=False,
)
print(f'Wisp exported: {output.stat().st_size} bytes')
