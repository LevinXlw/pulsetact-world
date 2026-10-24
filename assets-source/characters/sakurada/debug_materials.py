import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='C:/Users/xieli/Desktop/projects/pulsetact-world/public/assets/characters/sakurada/sakurada.glb')
for mat in bpy.data.materials:
    print('MAT',mat.name)
    for n in mat.node_tree.nodes:
        if n.type=='TEX_IMAGE':
            print('IMAGE',n.image.name,n.image.size[:],n.image.colorspace_settings.name, n.image.pixels[len(n.image.pixels)//2:len(n.image.pixels)//2+8])
        if n.type=='EMISSION':print('EMISSION',n.inputs['Color'].default_value[:],n.inputs['Strength'].default_value)
    print('LINKS',[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in mat.node_tree.links])
for obj in bpy.data.objects:
    if obj.type=='MESH':print('MESH',obj.name,'UVS',[[(l.name,l.uv[i].vector[:]) for i in range(min(3,len(l.uv)))] for l in obj.data.uv_layers])
