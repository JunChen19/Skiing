// Physical metres and active-run seconds. Menu time, pause and crash time are excluded by the caller.
function raceDifficulty(distance, elapsed) {
  return 0.58 * U.smoothstep(0, 1500, distance) + 0.42 * U.smoothstep(0, 100, elapsed);
}

function makeRocks(scene, seed) {
  // A wind-scoured erratic: a long exposed toe, a broken shoulder and an
  // off-centre summit. Collision samples the same sloping triangles as the mesh.
  const sites = [];
  const slices = 15;
  const layers = [
    [1, -0.26, 0], [0.99, 0.15, 0.16], [0.82, 0.43, 0.24],
    [0.62, 0.67, 0.22], [0.34, 0.87, 0.11], [0.15, 0.959, 0.032],
  ];
  for (let j = 0; j < layers.length; j++) {
    const [radius, height, relief] = layers[j];
    for (let i = 0; i < slices; i++) {
      const a = (i + 0.13 * Math.sin(i * 1.4)) * 2 * Math.PI / slices;
      const shape = 0.91 + 0.09 * Math.cos(3*a - 0.8) + 0.06 * Math.sin(5*a + 0.4);
      const ledge = 0.42 * Math.sin(2*a - 0.8) + 0.37 * Math.cos(3*a + j * 0.48)
        + 0.19 * Math.sin(5*a + 0.7);
      const r = radius * shape * (1 + 0.08 * Math.sin(3*a + j*0.72));
      sites.push(new THREE.Vector3(-0.16*(1-radius) + r*Math.cos(a), height + relief*ledge,
        0.08*(1-radius) + r*Math.sin(a)));
    }
  }
  const peak = sites.push(new THREE.Vector3(-0.125, 1, 0.074)) - 1;
  const indices = [];
  for (let j = 0; j < layers.length; j++) {
    for (let i = 0; i < slices; i++) {
      const a = j*slices + i, b = j*slices + (i+1)%slices;
      if (j === layers.length - 1) indices.push(a, peak, b);
      else {
        const c = a+slices, d = b+slices;
        if ((i+j)%2) indices.push(a,c,d, a,d,b);
        else indices.push(a,c,b, b,c,d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sites.flatMap(p => [p.x,p.y,p.z]), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Plane coefficients permit exact vertical ray hits against each irregular
  // triangle without a render raycaster. The bounds reject almost all faces.
  const surface = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = sites[indices[i]], b = sites[indices[i+1]], c = sites[indices[i+2]];
    const ux=b.x-a.x, uz=b.z-a.z, vx=c.x-a.x, vz=c.z-a.z;
    const det=ux*vz-uz*vx;
    if (det >= -0.00001) continue;
    surface.push({
      minX:Math.min(a.x,b.x,c.x), maxX:Math.max(a.x,b.x,c.x),
      minZ:Math.min(a.z,b.z,c.z), maxZ:Math.max(a.z,b.z,c.z),
      x:a.x, z:a.z, y:a.y, by:b.y-a.y, cy:c.y-a.y,
      bu:vz/det, bv:-vx/det, cu:-uz/det, cv:ux/det,
    });
  }

  // Store three spatial scales in one reusable mipmapped texture. The shader
  // can resolve granular minerals nearby and smooth them out on distant rocks.
  const texSize = 128, bits = new Uint8Array(texSize * texSize * 4);
  function tileNoise(x, y, cells, salt) {
    const gx=x*cells/texSize, gy=y*cells/texSize;
    const ix=Math.floor(gx), iy=Math.floor(gy);
    const fx=U.smoothstep(0,1,gx-ix), fy=U.smoothstep(0,1,gy-iy);
    const at=(dx,dy) => hash2i((ix+dx)%cells,(iy+dy)%cells,salt);
    return U.lerp(U.lerp(at(0,0),at(1,0),fx),U.lerp(at(0,1),at(1,1),fx),fy);
  }
  for (let y=0; y<texSize; y++) {
    for (let x=0; x<texSize; x++) {
      const i=4*(y*texSize+x);
      bits[i]=255*(0.72*tileNoise(x,y,5,37)+0.28*tileNoise(x,y,12,53));
      bits[i+1]=255*tileNoise(x,y,26,139);
      bits[i+2]=255*hash2i(x,y,119);
      bits[i+3]=255;
    }
  }
  const granite = new THREE.DataTexture(bits, texSize, texSize);
  granite.wrapS = granite.wrapT = THREE.RepeatWrapping;
  granite.generateMipmaps = true;
  granite.minFilter = THREE.LinearMipMapLinearFilter;
  granite.magFilter = THREE.LinearFilter;
  granite.needsUpdate = true;
  const material = new THREE.MeshLambertMaterial();
  material.onBeforeCompile = shader => {
    shader.uniforms.granite = { value: granite };
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vRockPosition; varying float vRockSlope;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockPosition = position; vRockSlope = normal.y;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vRockPosition; varying float vRockSlope; uniform sampler2D granite;')
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        vec3 p = vRockPosition;
        vec2 bed = vec2(p.x + .37*p.z, p.z + .83*p.y - .19*p.x);
        vec3 field = texture2D(granite, bed*.77 + vec2(.31,.6)).rgb;
        vec3 grit = texture2D(granite, bed*2.6 + field.rg*.06).rgb;
        float vein = 1.-smoothstep(.009,.043,abs(field.r + grit.g*.048 - .47));
        float feldspar = smoothstep(.63,.81,grit.b*.62 + grit.g*.38);
        vec3 mineral = mix(vec3(.048,.055,.062), vec3(.22,.21,.19), field.r*.64+grit.g*.36);
        mineral = mineral*(.72+.47*grit.b)*(1.-.57*vein) + feldspar*vec3(.12,.11,.095);
        float pocket = .34*(field.r-.5) + .17*(grit.g-.5) + .09*(grit.b-.5);
        float cover = smoothstep(.64,.76, vRockSlope + pocket + .12*p.y + .11*vein);
        vec3 frost = mix(vec3(.52,.65,.73),vec3(.90,.96,1.), .48*field.r+.52*grit.b);
        diffuseColor.rgb *= mix(mineral,frost,cover);
      `);
  };

  const batches = new Map(), rocks = [];
  const ahead = CFG.CHUNKS_AHEAD + 1;
  // At most four rocks per chunk, with one retained chunk behind the player.
  const mesh = new THREE.InstancedMesh(geo,material,4*(ahead+2));
  mesh.name = 'Trail boulders';
  mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = mesh.castShadow = true;
  scene.add(mesh);
  const mat = new THREE.Matrix4(), normal = new THREE.Vector3(), lane = {};
  let activeChunk = -1;
  function rock(x,d,h,rx,rz,yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    terrainNormalAt(x,-d,seed,normal);
    return {x,z:-d,h,rx,rz,c,s,ground:terrainHeight(x,-d,seed),sx:-normal.x/normal.y,sz:-normal.z/normal.y};
  }
  function chunk(k,elapsed,playerD) {
    const items = [];
    for (let slot=0; slot<2; slot++) {
      const rng = mulberry32(Math.floor(hash2i(k,slot+921,seed)*2147483647));
      const first = k===0 && slot===1;
      if (k===0 && !first) continue;
      const d = first ? 34 : k*CFG.CHUNK_LEN + (slot ? 0.74 : 0.25)*CFG.CHUNK_LEN + (rng()-0.5)*3;
      // A row commits when it first enters the far fog. Project time to the
      // row, so the first few visible chunks have a gradual difficulty curve.
      const level = raceDifficulty(d,elapsed + Math.max(0,d-playerD)/25);
      const required = slot===1 && k%2===0;
      if (!required && rng() > 0.04 + level*(slot ? 0.80 : 0.67)) continue;
      courseAt(d,seed,lane);
      const sign = hash2i(0,13,seed) < 0.5 ? -1 : 1;
      const center = first ? 0 : lane.x + sign*(rng()*0.68-0.20);
      const h = first ? 0.54 : 0.49 + level*0.33 + rng()*0.12;
      const radius = first ? 1.02 : 0.86 + level*0.28 + rng()*0.22;
      items.push(rock(center,d,h,radius,radius*0.77,rng()*Math.PI));
      // Group on the same side. The other half of the tree-free marked lane
      // remains a continuous bypass for players who stay on the snow.
      if (!first && rng() < level*0.86) {
        items.push(rock(lane.x+sign*2.8,d+0.4,h*0.77,0.91,0.67,rng()*Math.PI));
      }
    }
    return items;
  }

  function sync(playerZ, elapsed = 0) {
    const distance = Math.max(0, -playerZ);
    const current = Math.floor(distance / CFG.CHUNK_LEN);
    if (current === activeChunk) return;
    activeChunk = current;
    const lo = Math.max(0, current - 1), hi = current + ahead;
    for (const k of batches.keys()) {
      if (k < lo || k > hi) batches.delete(k);
    }
    rocks.length = 0;
    for (let k = lo; k <= hi; k++) {
      if (!batches.has(k)) batches.set(k, chunk(k, elapsed, distance));
      rocks.push(...batches.get(k));
    }
    mesh.count = rocks.length;
    for (let i = 0; i < rocks.length; i++) {
      const b = rocks[i];
      const xx = b.c * b.rx, xz = -b.s * b.rx;
      const zx = b.s * b.rz, zz = b.c * b.rz;
      // Shear the base to the local snow plane while keeping height vertical.
      mat.set(
        xx, 0, zx, b.x,
        b.sx * xx + b.sz * xz, b.h, b.sx * zx + b.sz * zz, b.ground,
        xz, 0, zz, b.z,
        0, 0, 0, 1
      );
      mesh.setMatrixAt(i, mat);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function hits(x, z, jumpHeight = 0) {
    const skierRadius = 0.28;
    const k = Math.floor(-z / CFG.CHUNK_LEN);
    // Rows are inset from both chunk edges by more than any rock footprint.
    const rows = batches.get(k);
    if (!rows) return false;
    for (const b of rows) {
      const dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx) > 2 || Math.abs(dz) > 2) continue;
      const lx = (b.c * dx - b.s * dz) / b.rx;
      const lz = (b.s * dx + b.c * dz) / b.rz;
      // Sample the ski contact patch, including its nearest point towards the
      // summit. Interpolate actual rendered triangle heights at each sample.
      const length = Math.hypot(dx, dz);
      const inset = length ? Math.min(1, skierRadius / length) : 0;
      const summitX = -0.125, summitZ = 0.074;
      const towards = Math.hypot((lx-summitX)*b.rx, (lz-summitZ)*b.rz);
      const reach = towards ? Math.min(1, skierRadius / towards) : 0;
      const required = (jumpHeight + terrainHeight(x,z,seed) - b.ground - b.sx*dx - b.sz*dz) / b.h;
      if (required > 1) continue;
      for (let sample = 0; sample < 3; sample++) {
        const px = sample === 0 ? lx : sample === 1 ? lx*(1-inset) : U.lerp(lx,summitX,reach);
        const pz = sample === 0 ? lz : sample === 1 ? lz*(1-inset) : U.lerp(lz,summitZ,reach);
        for (const t of surface) {
          if (px<t.minX || px>t.maxX || pz<t.minZ || pz>t.maxZ) continue;
          const x0=px-t.x, z0=pz-t.z;
          const u=t.bu*x0+t.bv*z0, v=t.cu*x0+t.cv*z0;
          if (u>=-1e-6 && v>=-1e-6 && u+v<=1.000001 && required<t.y+u*t.by+v*t.cy) return true;
        }
      }
    }
    return false;
  }

  const next = { distance: 0, x: 0, z: 0, height: 0 };
  function nextRock(x, z, vx = 0, vz = -1) {
    const speed = Math.hypot(vx, vz);
    if (!speed) return null;
    const fx = vx / speed, fz = vz / speed;
    let nearest = null, range = 65;
    for (const b of rocks) {
      const dx = b.x - x, dz = b.z - z;
      const distance = dx * fx + dz * fz;
      if (distance <= 0 || distance > range || Math.abs(dx * fz - dz * fx) > b.rx + 1.7) continue;
      nearest = b;
      range = distance;
    }
    if (!nearest) return null;
    next.distance = range;
    next.x = nearest.x;
    next.z = nearest.z;
    next.height = nearest.h;
    return next;
  }

  function reset(newSeed) {
    seed = newSeed;
    activeChunk = -1;
    rocks.length = 0;
    batches.clear();
    mesh.count = 0;
  }
  return { reset, sync, hits, nextRock, setVisible(visible) { mesh.visible = visible; } };
}
