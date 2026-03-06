const fs = require('fs');

function makeCube(s, color) {
  const faces = [
    {n:[0,0,1],  v:[[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]]},
    {n:[0,0,-1], v:[[s,-s,-s],[-s,-s,-s],[-s,s,-s],[s,s,-s]]},
    {n:[1,0,0],  v:[[s,-s,s],[s,-s,-s],[s,s,-s],[s,s,s]]},
    {n:[-1,0,0], v:[[-s,-s,-s],[-s,-s,s],[-s,s,s],[-s,s,-s]]},
    {n:[0,1,0],  v:[[-s,s,s],[s,s,s],[s,s,-s],[-s,s,-s]]},
    {n:[0,-1,0], v:[[-s,-s,-s],[s,-s,-s],[s,-s,s],[-s,-s,s]]},
  ];
  const vertices = [], indices = [];
  let vi = 0;
  for (const f of faces) {
    for (const v of f.v) { vertices.push(...v, ...f.n, ...color); }
    indices.push(vi,vi+1,vi+2,vi,vi+2,vi+3);
    vi += 4;
  }
  return { vertices, indices };
}

// Translation matrix (column-major)
function translate(x, y, z) {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
}

// Scale + translate
function scaleTranslate(sx, sy, sz, tx, ty, tz) {
  return [sx,0,0,0, 0,sy,0,0, 0,0,sz,0, tx,ty,tz,1];
}

const red   = [0.9, 0.2, 0.2];
const green = [0.2, 0.8, 0.3];
const blue  = [0.2, 0.3, 0.9];
const yellow= [0.9, 0.85,0.1];
const gray  = [0.5, 0.5, 0.5];
const brown = [0.6, 0.35,0.15];

const bigCube = makeCube(0.5, red);
const smallCube = makeCube(0.5, green);
const tallCube = makeCube(0.5, blue);
const flatCube = makeCube(0.5, yellow);
const tinyCube = makeCube(0.5, gray);
const brownCube = makeCube(0.5, brown);

const scene = {
  "meshes": [
    // Main building (center)
    { name: "building_main", ...bigCube, transform: scaleTranslate(1.0,1.5,1.0, 0,0.75,0) },
    // Small house (left)
    { name: "house_left", ...smallCube, transform: scaleTranslate(0.7,0.8,0.7, -2.5,0.4,-1) },
    // Tall tower (right)
    { name: "tower_right", ...tallCube, transform: scaleTranslate(0.5,2.0,0.5, 2.5,1.0,0) },
    // Flat platform
    { name: "platform", ...flatCube, transform: scaleTranslate(5.0,0.05,5.0, 0,-0.025,0) },
    // Small box near tower
    { name: "crate_1", ...tinyCube, transform: scaleTranslate(0.3,0.3,0.3, 1.5,0.15,1.2) },
    // Another box
    { name: "crate_2", ...brownCube, transform: scaleTranslate(0.25,0.25,0.25, -1.0,0.125,2.0) },
  ]
};

fs.writeFileSync('D:/DarkIron/darkiron/assets/village.json', JSON.stringify(scene, null, 2));
console.log('Scene written with', scene.meshes.length, 'objects');

