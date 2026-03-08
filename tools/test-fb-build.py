import sys, os
sys.path.insert(0, os.path.join(r"D:\DarkIron\darkiron", "schemas", "generated", "python"))
import flatbuffers
from darkiron.schema import MeshData, SceneLoaded, SceneEvent, SceneEventPayload
print("Imports OK")

# Test building a simple mesh
builder = flatbuffers.Builder(1024)
name = builder.CreateString("test_cube")
MeshData.StartVerticesVector(builder, 3)
builder.PrependFloat32(3.0)
builder.PrependFloat32(2.0)
builder.PrependFloat32(1.0)
verts = builder.EndVector()
MeshData.StartIndicesVector(builder, 3)
builder.PrependUint32(2)
builder.PrependUint32(1)
builder.PrependUint32(0)
idxs = builder.EndVector()
MeshData.Start(builder)
MeshData.AddName(builder, name)
MeshData.AddVertices(builder, verts)
MeshData.AddIndices(builder, idxs)
mesh = MeshData.End(builder)

SceneLoaded.StartMeshesVector(builder, 1)
builder.PrependUOffsetTRelative(mesh)
meshes = builder.EndVector()
sid = builder.CreateString("test")
SceneLoaded.Start(builder)
SceneLoaded.AddSessionId(builder, sid)
SceneLoaded.AddMeshes(builder, meshes)
scene = SceneLoaded.End(builder)

SceneEvent.Start(builder)
SceneEvent.AddPayloadType(builder, SceneEventPayload.SceneEventPayload.SceneLoaded)
SceneEvent.AddPayload(builder, scene)
SceneEvent.AddTimestampMs(builder, 12345)
event = SceneEvent.End(builder)
builder.Finish(event)

buf = bytes(builder.Output())
print(f"FlatBuffer built: {len(buf)} bytes")

# Verify by reading it back
import flatbuffers
bb = flatbuffers.Builder(0)  # dummy
buf2 = bytearray(buf)
from darkiron.schema.SceneEvent import SceneEvent as SE
evt = SE.GetRootAs(buf2)
print(f"Timestamp: {evt.TimestampMs()}")
print(f"PayloadType: {evt.PayloadType()}")
from darkiron.schema.SceneLoaded import SceneLoaded as SL
sl = SL()
sl.Init(evt.Payload().Bytes, evt.Payload().Pos)
print(f"Session: {sl.SessionId().decode()}")
print(f"Meshes: {sl.MeshesLength()}")
m = sl.Meshes(0)
print(f"Mesh name: {m.Name().decode()}")
print(f"Vertices: {[m.Vertices(i) for i in range(m.VerticesLength())]}")
print(f"Indices: {[m.Indices(i) for i in range(m.IndicesLength())]}")
print("Round-trip OK!")

