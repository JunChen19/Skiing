/* ================= sky.js ================= */
'use strict';

function makeSky(scene) {
  const sunDir = new THREE.Vector3(-0.34, 0.52, 0.78).normalize();
  // Panoramic photograph by Tobi 87, CC BY-SA 3.0. Resized, compressed,
  // projected onto a dome and blended with the valley haze. Source and license:
  // https://commons.wikimedia.org/wiki/File:Panorama_vom_Gornergrat_-_Monte_Rosa-Liskamm-Castor-Pollux-Breithorn-Kl._Matterhorn.jpg
  // https://creativecommons.org/licenses/by-sa/3.0/
  const panorama = new THREE.TextureLoader().load('__SKY_PANORAMA__', () => {
    material.uniforms.photoReady.value = 1;
  });

  // The photo is a partial cylindrical panorama. Longitude runs across the
  // downhill hemisphere, with the return arc behind the player. Align both
  // folds to meridians in the geometry so interpolation never crosses a seam.
  const dome = new THREE.SphereGeometry(1500, 64, 40);
  const uv = dome.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    uv.setX(i, 1 - Math.abs(2 * u - 1));
  }

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      photo: { value: panorama },
      photoReady: { value: 0 },
      haze: { value: scene.fog.color },
      sun: { value: sunDir },
    },
    vertexShader: `
      varying vec2 atlas;
      varying vec3 skyDir;
      void main() {
        atlas = uv;
        skyDir = position;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: `
      uniform sampler2D photo;
      uniform vec3 haze, sun;
      uniform float photoReady;
      varying vec2 atlas;
      varying vec3 skyDir;
      void main() {
        float elevation = (atlas.y - 0.5) * 180.;
        vec3 dir = normalize(skyDir);
        vec3 upperSky = mix(vec3(.30,.52,.79), vec3(.075,.21,.42),
                            smoothstep(3.,55.,elevation));
        float glow = max(dot(dir,sun),0.);
        upperSky += vec3(1.,.90,.72) * (.18*pow(glow,10.) + 2.8*smoothstep(.9997,.99996,glow));

        // The cropped atlas covers -11 to +21 degrees; terrain haze hides its base.
        float v = clamp((elevation + 11.) / 32., 0., 1.);
        vec3 encoded = texture2D(photo, vec2(atlas.x,v)).rgb;
        // Approximate scene-linear radiance before the common filmic pass.
        vec3 rockSnow = encoded * encoded * 1.50;
        float skyBlend = smoothstep(19.5, 34., elevation);
        vec3 valley = mix(rockSnow, upperSky, max(skyBlend, 1.-photoReady));
        float mist = mix(.09, 1., 1.-smoothstep(-11., 5.,elevation));
        gl_FragColor = vec4(mix(valley,haze,mist),1.);
      }`,
  });
  const mesh = new THREE.Mesh(dome, material);
  // Drawing at the far depth after other opaque geometry avoids shading the
  // photograph underneath the piste, skier and trees.
  mesh.renderOrder = 100;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    sunDir,
    update(camera) { mesh.position.copy(camera.position); },
  };
}
