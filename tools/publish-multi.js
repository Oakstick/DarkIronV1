const { connect, StringCodec } = require('nats');

function makeCube(name, color, pos, rot, scl) {
  const s = 0.5;
  const faces = [
    { n:[0,0,1],  c:color, v:[[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]] },
    { n:[0,0,-1], c:color.map(c=>c*0.7), v:[[s,-s,-s],[-s,-s,-s],[-s,s,-s],[s,s,-s]] },
    { n:[1,0,0],  c:color.map(c=>c*0.9), v:[[s,-s,s],[s,-s,-s],[s,s,-s],[s,s,s]] },
    { n:[-1,0,0], c:color.map(c=>c*0.8), v:[[-s,-s,-s],[-s,-s,s],[-s,s,s],[-s,s,-s]] },
    { n:[0,1,0],  c:color, v:[[-s,s,s],[s,s,s],[s,s,-s],[-s,s,-s]] },
    { n:[0,-1,0], c:color.map(c=>c*0.5), v:[[-s,-s,-s],[s,-s,-s],[s,-s,s],[-s,-s,s]] },
  ];
  const vertices = [], indices = [];
  let vi = 0;
  for (const f of faces) {
    for (const v of f.v) { vertices.push(...v, ...f.n, ...f.c); }
    indices.push(vi,vi+1,vi+2, vi,vi+2,vi+3);
    vi += 4;
  }
  return { name, vertices, indices, transform: { position: pos, rotation: rot, scale: scl } };
}

async function main() {
  const nc = await connect({ servers: 'localhost:4222' });
  const sc = StringCodec();

  const scene = {
    type: 'SceneLoaded',
    session_id: 'multi-test',
    meshes: [
      makeCube('red_cube',     [1,0.2,0.2], [0,0.5,0],    [0,0,0],    [1,1,1]),
      makeCube('green_cube',   [0.2,1,0.2], [2,0.5,0],    [0,45,0],   [0.8,0.8,0.8]),
      makeCube('blue_cube',    [0.2,0.3,1], [-2,0.5,0],   [0,-30,0],  [1,1.5,1]),
      makeCube('yellow_cube',  [1,1,0.2],   [0,0.5,2],    [0,0,0],    [0.6,0.6,0.6]),
      makeCube('magenta_cube', [1,0.2,1],   [0,0.5,-2],   [15,60,0],  [1,0.5,1]),
      makeCube('big_cube',     [0.4,0.4,0.4],[0,1.5,0],   [0,0,0],    [0.4,0.4,0.4]),
    ]
  };

  nc.publish('scene.multi.loaded', sc.encode(JSON.stringify(scene)));
  await nc.flush();
  console.log('Published', scene.meshes.length, 'meshes with transforms');
  await nc.close();
}

main().catch(console.error);

