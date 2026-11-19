'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const THREE = require('../vendor/three.min.js');
const modules = ['config','utils','physics','rocks','skier'].map(name =>
  readFileSync(join(__dirname, '../src', name + '.js'), 'utf8')).join('\n');
const { makePhysics, makeRocks, buildSkier } = vm.runInNewContext(
  modules + '\n;({makePhysics,makeRocks,buildSkier})', { window: {}, THREE });
const dt = 1 / 120;

test('a timed flip clears the first real boulder, while a straight or premature run hits it', () => {
  for (const takeoff of [0, 16, 29]) {
    const run = makePhysics(42), rocks = makeRocks(new THREE.Scene(), 42);
    let launched = false, hit = false;
    for (let i = 0; i < 1200 && run.st.dist < 40; i++) {
      rocks.sync(run.st.z, i * dt);
      const jump = takeoff > 0 && !launched && run.st.dist >= takeoff;
      run.step(dt, 0, jump);
      launched ||= jump;
      if (rocks.hits(run.st.x, run.st.z, run.st.jumpHeight)) { hit = true; break; }
    }
    assert.equal(hit, takeoff !== 29);
    if (!hit) assert.ok(run.st.dist >= 40);
  }
});

test('the whole rig turns upside down, lands once and resets between runs', () => {
  const run = makePhysics(42), skier = buildSkier(new THREE.Scene(), 42);
  let peak = 0, inverted = false;
  for (let i = 0; i < 155; i++) {
    run.step(dt, 0, i === 0 || i === 65);
    skier.update(run.st, dt, i * dt);
    peak = Math.max(peak, run.st.jumpHeight);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(skier.root.quaternion);
    if (up.y < -0.9 && run.st.jumpHeight > 1.5) inverted = true;
  }
  assert.ok(inverted && peak > 1.6 && peak <= 1.65);
  assert.equal(run.st.jumpHeight, 0);
  assert.equal(run.st.jumpPhase, 0);
  run.step(dt, 0, true);
  run.reset(7);
  assert.equal(run.st.jumpHeight, 0);
  run.crash();
  run.step(dt, 0, true);
  assert.equal(run.st.jumpPhase, 0);
});
