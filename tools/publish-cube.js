const { connect, StringCodec } = require('nats');

async function main() {
  const nc = await connect({ servers: 'localhost:4222' });
  const sc = StringCodec();

  // Colored cube: 8 vertices, 12 triangles (36 indices)
  // Each vertex: pos(3) + normal(3) + color(3) = 9 floats
  const s = 0.5;
  const faces = [
    // Front  (z+) - red
    { n: [0,0,1], c: [1,0.2,0.2], verts: [[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]] },
    // Back   (z-) - cyan
    { n: [0,0,-1], c: [0.2,1,1], verts: [[s,-s,-s],[-s,-s,-s],[-s,s,-s],[s,s,-s]] },
    // Right  (x+) - green
    { n: [1,0,0], c: [0.2,1,0.2], verts: [[s,-s,s],[s,-s,-s],[s,s,-s],[s,s,s]] },
    // Left   (x-) - magenta
    { n: [-1,0,0], c: [1,0.2,1], verts: [[-s,-s,-s],[-s,-s,s],[-s,s,s],[-s,s,-s]] },
    // Top    (y+) - yellow
    { n: [0,1,0], c: [1,1,0.2], verts: [[-s,s,s],[s,s,s],[s,s,-s],[-s,s,-s]] },
    // Bottom (y-) - blue
    { n: [0,-1,0], c: [0.2,0.2,1], verts: [[-s,-s,-s],[s,-s,-s],[s,-s,s],[-s,-s,s]] },
  ];

  const vertices = [];
  const indices = [];
  let vi = 0;

  for (const face of faces) {
    for (const v of face.verts) {
      vertices.push(...v, ...face.n, ...face.c);
    }
    indices.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
    vi += 4;
  }

  const msg = JSON.stringify({
    type: 'SceneLoaded',
    session_id: 'cube-test',
    meshes: [{ name: 'colored_cube', vertices, indices }]
  });

  nc.publish('scene.cube.loaded', sc.encode(msg));
  await nc.flush();
  console.log('Published cube:', vertices.length/9, 'vertices,', indices.length, 'indices');
  await nc.close();
}

main().catch(console.error);

