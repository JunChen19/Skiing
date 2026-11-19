'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const THREE = require('../vendor/three.min.js');

const source = ['config', 'utils', 'rocks'].map(name =>
  readFileSync(path.join(__dirname, '../src', name + '.js'), 'utf8')
).join('\n');
const { makeRocks, raceDifficulty, courseAt, hash2i, CFG } = vm.runInNewContext(source +
  '\n;({ makeRocks, raceDifficulty, courseAt, hash2i, CFG })', { window: {}, THREE });

function course(seed) {
  const scene = new THREE.Scene();
  const rocks = makeRocks(scene, seed);
  const mesh = scene.children[0];
  function instances() {
    const matrix = new THREE.Matrix4();
    return Array.from({ length: mesh.count }, (_, index) => {
      mesh.getMatrixAt(index, matrix);
      return { x: matrix.elements[12], z: matrix.elements[14], height: matrix.elements[5] };
    });
  }
  return { rocks, mesh, instances };
}

test('race difficulty grows with active time and distance and stays bounded', () => {
  assert.equal(raceDifficulty(0, 0), 0);
  assert.ok(raceDifficulty(0, 45) > raceDifficulty(0, 1));
  assert.ok(raceDifficulty(800, 20) > raceDifficulty(100, 20));
  assert.equal(raceDifficulty(5000, 300), 1);
});

test('the first stone teaches a ground hit, air clearance and a side bypass', () => {
  const { rocks } = course(42);
  rocks.sync(-2, 0);
  const first = rocks.nextRock(0, -2);
  assert.equal(first.distance, 32);
  assert.equal(first.z, -34);
  assert.equal(rocks.hits(first.x, first.z, 0), true);
  assert.equal(rocks.hits(first.x, first.z, first.height - 0.03), true);
  assert.equal(rocks.hits(first.x, first.z, first.height + 0.03), false);
  assert.equal(rocks.hits(2, first.z, 0), false);
  assert.equal(rocks.nextRock(0, -2, 0, 1), null);
});

test('visible stones keep their transforms as active time and the streaming window advance', () => {
  const { rocks, instances } = course(219);
  rocks.sync(-2, 0);
  const initial = instances();
  rocks.sync(-2, 75);
  assert.deepEqual(instances(), initial);
  rocks.sync(-CFG.CHUNK_LEN - 2, 81);
  const shared = instances().filter(row => row.z >= -(CFG.CHUNKS_AHEAD + 2) * CFG.CHUNK_LEN);
  assert.deepEqual(shared, initial);
  rocks.reset(219);
  rocks.sync(-2, 0);
  assert.deepEqual(instances(), initial);
});

test('late stone groups grow in density and leave a continuous grounded route within the forest gap', () => {
  let earlyCount = 0, lateCount = 0;
  const lane = {};
  for (const seed of [7, 42, 219, 2026]) {
    const { rocks, mesh, instances } = course(seed);
    rocks.sync(-2, 0);
    earlyCount += mesh.count;
    const sign = hash2i(0, 13, seed) < 0.5 ? -1 : 1;
    for (let k = 0; k < 65; k++) {
      const start = k * CFG.CHUNK_LEN;
      rocks.sync(-start, start / 19);
      if (k === 50) lateCount += mesh.count;
      assert.ok(mesh.count <= mesh.instanceMatrix.count);
      for (let d = start; d < start + CFG.CHUNK_LEN; d += 0.33) {
        courseAt(d, seed, lane);
        // 60% of the half-width leaves enough space on the outside for a pair of skis.
        const x = lane.x - sign * lane.width * 0.60;
        assert.equal(rocks.hits(x, -d, 0), false);
      }
      for (const row of instances().filter(r => r.z <= -start && r.z > -start - CFG.CHUNK_LEN)) {
        assert.ok(rocks.hits(row.x, row.z, 0));
        assert.equal(rocks.hits(row.x, row.z, 1.65), false);
      }
    }
  }
  assert.ok(lateCount > earlyCount * 1.5);
});

test('the first boulder has a lower toe that can be cleared below summit height', () => {
  const { rocks, mesh } = course(42);
  rocks.sync(-2, 0);
  const pose = new THREE.Matrix4();
  mesh.getMatrixAt(0, pose);
  const toe = new THREE.Vector3(0.85, 0, 0).applyMatrix4(pose);
  const summit = new THREE.Vector3(-0.125, 1, 0.074).applyMatrix4(pose);
  assert.equal(rocks.hits(toe.x, toe.z, 0), true);
  assert.equal(rocks.hits(toe.x, toe.z, 0.50), false);
  assert.equal(rocks.hits(summit.x, summit.z, 0.50), true);
});
