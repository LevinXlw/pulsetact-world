"""Portable Stata PBR materials; no runtime shaders or transmission pass.

Usage in Blender (also works with a CAD-derived mesh):
    spec = effective_material_spec({**MATERIALS, **SITE_MATERIALS}, glazing=True)
    mats = make_materials(spec, texturePath, mobile, glazing=True)

Use *spec*, not the old MATERIALS, for any post-export baseColorFactor rewrite.
Tuple spec entries are (LINEAR rgba, roughness, metalness, texture_family).
UVs are owned by the caller. Existing brick maps expect its 2.3 x 1.2 m tile;
metal/roof detail uses repeating UVs, approximately 2 m per repeat.
All additional maps are deterministic, packed images generated on the CPU.
Existing source textures are read-only. This module writes no model/files.
"""
from pathlib import Path
import bpy
import numpy as np

# Factors remain explicit so the caller's GLB post-processing cannot silently
# restore the old dark orange brick or partly dielectric silver.
MATERIAL_OVERRIDES = {
    'brick': ((.48, .285, .15, 1), .83, 0, 'brick'),
    'silver': ((.64, .67, .69, 1), .30, .96, 'stata-metal'),
    'silverA': ((.63, .66, .68, 1), .32, .96, 'stata-metal'),
    'silverB': ((.66, .69, .71, 1), .28, .96, 'stata-metal'),
    'silverC': ((.645, .675, .695, 1), .34, .96, 'stata-metal'),
    'zinc': ((.40, .44, .45, 1), .39, .93, 'stata-metal'),
    'frame': ((.62, .65, .67, 1), .25, .93, 'stata-metal'),
    'roof': ((.21, .22, .21, 1), .87, 0, 'stata-roof'),
    'glass': ((.065, .115, .135, 1), .12, .12, None),
    'glassShade': ((.095, .13, .14, 1), .16, .08, None),
    'room': ((.105, .11, .105, 1), .91, 0, None),
    'blind': ((.56, .53, .46, 1), .90, 0, 'stata-fabric'),
    # Pisa's yellow cladding, as seen in the MIT CSAIL courtyard panorama;
    # this is a bright yellow finish, not copper or dark polished brass.
    'gold': ((.90, .72, .025, 1), .38, .35, 'stata-metal'),
    'mirror': ((.72, .74, .75, 1), .075, 1, 'stata-mirror'),
}
GLAZING_OVERRIDES = {
    'glass': ((.16, .22, .24, .40), .09, 0, None),
    'glassShade': ((.20, .235, .24, .44), .115, 0, None),
}
_IMAGES = {}
_NOISE = {}


def _isotropic_noise(size):
    """Seamless Gaussian-filtered noise, with no directional harmonic bands.

    FFT implements a circular convolution, so both value and slope continue
    across the tile boundary. The filter depends only on radial frequency;
    unlike the former sin(3*x+y), it has no preferred stripe direction.
    """
    if size not in _NOISE:
        rng = np.random.default_rng(320922)
        f = np.fft.fftfreq(size)
        radius_squared = f[:, None] ** 2 + f[None, :] ** 2
        fields = []
        for sigma in (24.0, 6.0, 2.0):
            white = rng.standard_normal((size, size))
            kernel = np.exp(-2 * np.pi ** 2 * sigma ** 2 * radius_squared)
            field = np.fft.ifft2(np.fft.fft2(white) * kernel).real
            field -= field.mean()
            field /= max(float(np.max(np.abs(field))), 1e-12)
            fields.append(field.astype(np.float32))
        height = fields[2]
        dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * .5
        dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * .5
        peak = max(float(np.max(np.hypot(dx, dy))), 1e-12)
        _NOISE[size] = (*fields, dx / peak, dy / peak)
    return _NOISE[size]


def effective_material_spec(materialSpec, glazing=False):
    """Return tuples suitable for both material construction and GLB factors.

    Every unknown material (including SITE_MATERIALS) is preserved. Generic
    gold/mirror aliases inherit a finish without requiring architectural IDs.
    Transparent glazing must have room/curtain backing geometry supplied by
    the caller; opaque glazing remains the compatibility default.
    """
    result = {}
    for name, value in materialSpec.items():
        if isinstance(value, dict):
            value = (value.get('color', (1, 1, 1, 1)), value.get('roughness', .8),
                     value.get('metalness', 0), value.get('family'))
        if len(value) != 4:
            raise ValueError('Material %s must contain rgba, roughness, metalness, family' % name)
        key = name if name in MATERIAL_OVERRIDES else ('mirror' if 'mirror' in name.lower()
                else 'gold' if 'gold' in name.lower() else None)
        result[name] = MATERIAL_OVERRIDES.get(key, value)
        if glazing and name in GLAZING_OVERRIDES:
            result[name] = GLAZING_OVERRIDES[name]
    return result


def _packed_image(name, pixels, noncolor=False, maximum=None):
    h, w = pixels.shape[:2]
    image = bpy.data.images.new(name, width=w, height=h, alpha=True)
    image.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    image.pixels.foreach_set(np.ascontiguousarray(pixels, dtype=np.float32).ravel())
    if maximum and max(image.size) > maximum:
        scale = maximum / max(image.size)
        image.scale(max(1, round(image.size[0] * scale)), max(1, round(image.size[1] * scale)))
    image.file_format = 'PNG'
    image.pack()
    return image


def _read_image(path, mobile, noncolor=False):
    key = (str(path.resolve()), bool(mobile), bool(noncolor))
    if key not in _IMAGES:
        original = bpy.data.images.load(str(path), check_existing=True)
        image = original.copy() if mobile else original
        image.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
        if mobile and max(image.size) > 256:
            scale = 256 / max(image.size)
            image.scale(max(1, round(image.size[0] * scale)), max(1, round(image.size[1] * scale)))
        image.pack()
        _IMAGES[key] = image
    return _IMAGES[key]


def _detail_maps(family, roughness, metalness, mobile):
    key = ('generated', family, round(roughness, 4), round(metalness, 4), bool(mobile))
    if key in _IMAGES:
        return _IMAGES[key]
    # Generate once at desktop sampling rate and filter down for mobile.
    size = 512
    output_size = 128 if mobile else 512
    broad, medium, fine, slope_x, slope_y = _isotropic_noise(size)
    normal = np.ones((size, size, 4), np.float32)
    orm = np.ones_like(normal)
    base = None
    if family == 'stata-roof':
        stain = np.clip((broad + 1) * .5, 0, 1)
        grey = 1 - stain * .03
        base = np.ones_like(normal); base[:, :, :3] = grey[:, :, None]
        nx, ny = slope_x * .4, slope_y * .4
        orm[:, :, 0] = 1 - stain * .01
        orm[:, :, 1] = np.clip(roughness + medium * .015, .70, .98)
    elif family == 'stata-fabric':
        nx, ny = slope_x * .4, slope_y * .4
        orm[:, :, 1] = roughness + medium * .01
    else:
        nx, ny = slope_x * .4, slope_y * .4
        orm[:, :, 1] = np.clip(roughness + medium * (.005 if family == 'stata-mirror' else .015), .045, .65)
    nz = np.ones_like(broad)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal[:, :, 0] = nx / length * .5 + .5
    normal[:, :, 1] = ny / length * .5 + .5
    normal[:, :, 2] = nz / length * .5 + .5
    orm[:, :, 2] = metalness
    suffix = '%s-r%.3f-m%.3f-%s' % (family, roughness, metalness, output_size)
    # The finish's microscopic surface shape is independent of its tint and
    # roughness. Share one image across silver variants, zinc, frames and gold.
    normal_key = ('generated-normal', family, bool(mobile))
    if normal_key not in _IMAGES:
        _IMAGES[normal_key] = _packed_image('%s-%s-normal' % (family, output_size), normal, True, output_size)
    result = {'normal': _IMAGES[normal_key],
              'orm': _packed_image(suffix + '-orm', orm, True, output_size)}
    if base is not None:
        result['basecolor'] = _packed_image(suffix + '-basecolor', base, maximum=output_size)
    _IMAGES[key] = result
    return result


def _occlusion_node(nodes):
    group = bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        if hasattr(group, 'interface'):
            group.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        else:
            group.inputs.new('NodeSocketFloat', 'Occlusion')
    node = nodes.new('ShaderNodeGroup'); node.node_tree = group
    return node


def make_materials(materialSpec, texturePath, mobile, *, glazing=False):
    """Create exportable Blender Principled materials, without touching meshes.

    ORM: R=ambient occlusion, G=roughness, B=metalness. Textured channels are
    direct image/SeparateColor links understood by Blender's glTF exporter.
    All finishes are one-sided to retain the roof shadow-acne fix.
    """
    texturePath = Path(texturePath)
    spec = effective_material_spec(materialSpec, glazing=glazing)
    result = {}
    for name, (color, roughness, metalness, family) in spec.items():
        if len(color) != 4:
            raise ValueError('Material %s color must be linear RGBA' % name)
        material = bpy.data.materials.new(name)
        material.use_nodes = True; material.use_backface_culling = True
        material.diffuse_color = tuple(color)
        material['stata_base_color_factor'] = list(color)
        material['stata_pbr_family'] = family or 'constant'
        nodes, links = material.node_tree.nodes, material.node_tree.links
        bs = nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value = color
        bs.inputs['Roughness'].default_value = roughness
        bs.inputs['Metallic'].default_value = metalness
        bs.inputs['Alpha'].default_value = color[3]
        if 'IOR' in bs.inputs:
            bs.inputs['IOR'].default_value = 1.52
        if 'Specular IOR Level' in bs.inputs:
            bs.inputs['Specular IOR Level'].default_value = .5
        for key in ('Transmission Weight', 'Transmission'):
            if key in bs.inputs:
                bs.inputs[key].default_value = 0
        if color[3] < .999:
            if hasattr(material, 'surface_render_method'):
                material.surface_render_method = 'DITHERED'
            elif hasattr(material, 'blend_method'):
                material.blend_method = 'BLEND'
            material['stata_requires_room_backing'] = True
        maps = {}
        if family and family.startswith('stata-'):
            maps = _detail_maps(family, roughness, metalness, mobile)
        elif family:
            for kind in ('basecolor', 'normal', 'orm'):
                path = texturePath / (family + '-' + kind + '.png')
                if path.exists():
                    maps[kind] = _read_image(path, mobile, kind != 'basecolor')
        for kind, image in maps.items():
            tex = nodes.new('ShaderNodeTexImage'); tex.image = image
            tex.name = 'Stata ' + kind; tex.extension = 'REPEAT'
            if kind == 'basecolor':
                links.new(tex.outputs['Color'], bs.inputs['Base Color'])
                # glTF image * factor is restored from effective spec by caller.
            elif kind == 'normal':
                normal = nodes.new('ShaderNodeNormalMap')
                # A .003 slope encoded directly into an 8-bit normal PNG
                # collapses to 127/128 and becomes quantization noise. Encode
                # a wider signal, then attenuate using glTF normalTexture.scale.
                # The 3% margin also bounds the final 8-bit decoded slope.
                limits = {'stata-roof': .012, 'stata-metal': .003,
                          'stata-mirror': .001, 'stata-fabric': .003}
                normal.inputs['Strength'].default_value = limits[family] / .4 * .97 if family in limits else .85 if family == 'brick' else .35
                links.new(tex.outputs['Color'], normal.inputs['Color'])
                links.new(normal.outputs['Normal'], bs.inputs['Normal'])
            else:
                separate = nodes.new('ShaderNodeSeparateColor'); separate.mode = 'RGB'
                links.new(tex.outputs['Color'], separate.inputs['Color'])
                links.new(separate.outputs['Green'], bs.inputs['Roughness'])
                links.new(separate.outputs['Blue'], bs.inputs['Metallic'])
                links.new(separate.outputs['Red'], _occlusion_node(nodes).inputs['Occlusion'])
        result[name] = material
    return result
