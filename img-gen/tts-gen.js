const { RaymarchedImage, THREE, ITERATE } = require('./raymarch/raymarch.js');
const shaders = require('./shaders.js');

const bgGen = async () => {

  const lightVec = new THREE.Vector3(-1, 1, -5).normalize().multiplyScalar(10.);

  const lights = [{
    position: new THREE.Vector3(lightVec.x * 335.410196, lightVec.y * 335.410196, lightVec.z * 335.410196),
    radius: 18000.,
    ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
    diffuse: new THREE.Vector4(0.5*8, 0.4*8, 0.35*8, 2.0)
  }];

  const bgtex = new RaymarchedImage({
    simplex: true,
    perlin: true,
    worley: true,
    usePerlinForRandom: true,
    scale: 150,
    depth: 1000,
    maxIterations: 1500,
    minDist: 0.000001,
    seed: 1,
    normalDist: 0.00001,
    shadowIterations: 512,
    shadowSharpness: 1.5,
    shadowStrength: 1.0,
    fogIterations: 512,
    fogShadowIterations: 128,
    fogShadowFactor: 1.0,
    fogShadowMaxDist: 30,
    preShadows: true,
    preLight: [
      ...lights
    ],
    background: `
      // in vec2 uv
      // in vec2 uv01
      // out vec4 ret

      ret = vec4(0., 0., 0., 1.);
    `,
    customGLSL: `
      float rockH(vec3 p) {
        p *= 0.5;
        return (pow(
          pnoise(p * 0.080) * 2.1 +
          pnoise(p * 0.137) * 1.2 +
          pnoise(p * 0.537) * 0.75 +
          pnoise(p * 1.318) * 0.35 +
          pnoise(p * 3.127) * 0.25
        , 3.) + 0.75) * 3.;
      } 
    `,
    objects: [
      {
        distance: `
          float rockDist (vec3 p) {
            p.xy *= 1. + (p.z + 50.) * 0.01;
            float z = rockH(p) * 2.0 - 0.5;
            float box = max(abs(p.x), abs(p.y));
            float circle = length(p.xy);
            return distance(p, vec3(p.xy / (box * 0.6 + circle * 0.4) * 75., p.z)) - (10. * (1. + (p.z + 50.) * 0.01) + z * 0.25);
          }
        `,
        color: `
          vec4 rockColor (vec3 p) {
            p.xy *= 1. + (p.z + 50.) * 0.01;
            float z = rockH(p);
            return vec4(vec3(.5, 0.4, 0.35) * (max(z+1.0, 0.)) * 0.2 / (1. + (p.z + 50.) * 0.01), 1.);
          }
        `,
        specular: `
          vec4 rockSpec (vec3 p) {
            return vec4(0.1, 0.2,0.6, 0.25);
          }
        `,
        emissive: `
          vec4 rockEm (vec3 p) {
            p.xy *= 1. + (p.z + 50.) * 0.01;
            float z = -(rockH(p)+3.0);
            return vec4(vec3(.8, 0.2, 0.025) * pow(max(z, 0.), 3.0) * 0.1, 1.);
          }
        `
      }
    ]
  });

  await bgtex.render({
    width: 2048,
    height: 2048,
    blueNoiseRes: 2048 * 8,
    DSAA: true
  });

  bgtex.save(`game-bg`);
};

const pipeGen = async (water) => {

  const lightVec = new THREE.Vector3(-5, 5, -5).normalize().multiplyScalar(10.);

  const lights = [{
    position: new THREE.Vector3(lightVec.x * 335.410196, lightVec.y * 335.410196, lightVec.z * 335.410196),
    radius: 18000.,
    ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
    diffuse: new THREE.Vector4(0.5*8, 0.4*8, 0.35*8, 2.0)
  },
  {position: new THREE.Vector3(0, 0, 0),
    radius: 250.,
    ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
    diffuse: new THREE.Vector4(0.5*1, 0.4*1, 0.35*1, 2.0)
  }];

  const pipeImg = new RaymarchedImage({
    simplex: true,
    perlin: true,
    worley: true,
    usePerlinForRandom: true,
    scale: 150,
    depth: 1000,
    maxIterations: 1500,
    minDist: 0.000001,
    seed: water ? 2 : 3,
    normalDist: 0.00001,
    shadowIterations: 512,
    shadowSharpness: 1.5,
    shadowStrength: 1.0,
    fogIterations: 512,
    fogShadowIterations: 128,
    fogShadowFactor: 1.0,
    fogShadowMaxDist: 30,
    preShadows: true,
    preLight: [
      ...lights
    ],
    background: `
      // in vec2 uv
      // in vec2 uv01
      // out vec4 ret

      ret = vec4(0., 0., 0., 0.);
      if (length(uv.xy) < 50.) {
        ret = ${water ? `vec4(0., 0., 0.2, 1.)` : `vec4(0.4, 0., 0., 1.)`};
      }
    `,
    customGLSL: `
      float rockH(vec3 p) {
        //p.x += ${water ? '1231.531' : '3425.341'};
        p *= 0.2;
        return (pow(
          snoise(p * 0.080) * 2.1 +
          snoise(p * 0.137) * 1.2 +
          snoise(p * 0.537) * 0.75 +
          snoise(p * 1.318) * 0.35 +
          snoise(p * 3.127) * 0.25
        , 3.) + 0.75) * 3.;
      } 
    `,
    objects: [
      {
        distance: `
          float rockDist (vec3 p) {
            p.xy *= 1. + (p.z + 50.) * 0.01;
            float z = rockH(p) * 2.0 - 0.5;
            float box = max(abs(p.x), abs(p.y));
            float circle = length(p.xy);
            return distance(p, vec3(p.xy / (circle * 0.5) * 75., clamp(p.z, 100., 1000.))) - (5. * (1. + (p.z + 50.) * 0.01) + z * 0.075);
          }
        `,
        color: `
          vec4 rockColor (vec3 p) {
            p.xy *= 1. + (p.z + 50.) * 0.01;
            float z = rockH(p);
            return vec4(vec3(0.1, 0.075, 0.075) + 4. * vec3(.5, 0.4, 0.35) * (max(z+1.0, 0.)) * 0.2 / (0.5 + pow(max(p.z, 0.) / 10., 2.0)), 1.);
          }
        `,
        specular: `
          vec4 rockSpec (vec3 p) {
            return vec4(0.1, 0.2,0.6, 0.75);
          }
        `,
        emissive: `
          vec4 rockEm (vec3 p) {
            p.xy *= 1. + (p.z + 50.) * 0.01;
            float z = -(rockH(p)+3.0);
            return vec4(${water ? 'vec3(.025, 0.2, 4.)' : 'vec3(4., 0.05, 0.05)'}* pow(max(z, 0.), 3.0) * 0.1, 1.);
          }
        `
      }
    ]
  });

  await pipeImg.render({
    width: 512,
    height: 512,
    blueNoiseRes: 512 * 8,
    DSAA: true
  });

  pipeImg.save(water ? `pipe-water` : 'pipe-lava');
};


const exitGen = async (glow) => {

  const lightVec = new THREE.Vector3(-5, 5, -5).normalize().multiplyScalar(10.);

  const lights = [{
    position: new THREE.Vector3(lightVec.x * 335.410196, lightVec.y * 335.410196, lightVec.z * 335.410196),
    radius: 18000.,
    ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
    diffuse: new THREE.Vector4(0.5*8, 0.4*8, 0.35*8, 2.0)
  },
  {position: new THREE.Vector3(0, 0, 0),
    radius: 250.,
    ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
    diffuse: new THREE.Vector4(0.5*1, 0.4*1, 0.35*1, 2.0)
  }];

  const exGen = new RaymarchedImage({
    simplex: true,
    perlin: true,
    worley: true,
    usePerlinForRandom: true,
    scale: 150,
    depth: 1000,
    maxIterations: 1500,
    minDist: 0.000001,
    seed: 5,
    normalDist: 0.00001,
    shadowIterations: 512,
    shadowSharpness: 1.5,
    shadowStrength: 1.0,
    fogIterations: 512,
    fogShadowIterations: 128,
    fogShadowFactor: 1.0,
    fogShadowMaxDist: 30,
    preShadows: true,
    preLight: [
      ...lights
    ],
    background: `
      // in vec2 uv
      // in vec2 uv01
      // out vec4 ret

      ret = vec4(0., 0., 0., 0.);
      if (length(uv.xy) < 50. || (abs(uv.x) < 50. && uv.y < -20.)) {
        ret = vec4(0.4, 1.0, 0.4, 1.) * ${glow ? '1.' : 'vec4(vec3(0.25), 1.)'};
      }
    `,
    customGLSL: `
      float rockH(vec3 p) {
        p *= 0.2;
        return (pow(
          snoise(p * 0.080) * 2.1 +
          snoise(p * 0.137) * 1.2 +
          snoise(p * 0.537) * 0.75 +
          snoise(p * 1.318) * 0.35 +
          snoise(p * 3.127) * 0.25
        , 3.) + 0.75) * 3.;
      } 
    `,
    objects: [
      {
        distance: `
          float rockDist (vec3 p) {
            p.xy *= 1. + (p.z + 50.) * 0.01;
            if (p.y < -30.) {
              p.y = -30. + (p.y - -30.) * 0.025;
            }
            float z = rockH(p) * 2.0 - 0.5;
            float box = max(abs(p.x), abs(p.y));
            float circle = length(p.xy);
            circle = box * 0.75 + circle * 0.25;
            return distance(p, vec3(p.xy / (circle * 0.5) * 75., clamp(p.z, 100., 1000.))) - (5. * (1. + (p.z + 50.) * 0.01) + z * 0.075);
          }
        `,
        color: `
          vec4 rockColor (vec3 p) {
            p.xy *= 1. + (p.z + 50.) * 0.01;
            float z = rockH(p);
            vec4 ret = vec4(vec3(0.1, 0.075, 0.075) + 4. * vec3(.5, 0.4, 0.35) * (max(z+1.0, 0.)) * 0.2 / (0.5 + pow(max(p.z, 0.) / 10., 2.0)), 1.);
            ret = mix(ret, vec4(vec3(0.4, 1.0, 0.4) * ${glow ? '1.' : '0.25'}, 1.), clamp((p.z - 150.) * 0.05, 0., 1.));
            return ret;
          }
        `,
        specular: `
          vec4 rockSpec (vec3 p) {
            return vec4(0.1, 0.2,0.6, 0.75);
          }
        `,
        emissive: `
          vec4 rockEm (vec3 p) {
            return mix(vec4(0.), vec4(0.4, 1.0, 0.4, ${glow ? '1.' : '0.05'}), pow(clamp((p.z - 150.) * ${glow ? '0.1' : '0.01'}, 0., 1.), 2.5));
          }
        `
      }
    ]
  });

  await exGen.render({
    width: 512,
    height: 512,
    blueNoiseRes: 512 * 8,
    DSAA: true
  });

  exGen.save('exit' + (glow ? '-glow' : ''));
};


const rockTexGen = async () => {

  const lightVec = new THREE.Vector3(-10, -10, -50).normalize().multiplyScalar(10.);

  const lights = [{
    position: new THREE.Vector3(lightVec.x * 335.410196, lightVec.y * 335.410196, lightVec.z * 335.410196),
    radius: 10000.,
    ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
    diffuse: new THREE.Vector4(0.5*2, 0.4*2, 0.35*2, 2.0)
  }];

  const bgtex = new RaymarchedImage({
    simplex: true,
    perlin: true,
    worley: true,
    usePerlinForRandom: true,
    scale: 150,
    depth: 200,
    maxIterations: 1500,
    minDist: 0.001,
    seed: 1,
    normalDist: 0.1,
    shadowIterations: 512,
    shadowSharpness: 1.5,
    shadowStrength: 1.0,
    fogIterations: 512,
    fogShadowIterations: 128,
    fogShadowFactor: 1.0,
    fogShadowMaxDist: 30,
    preShadows: true,
    preLight: [
      ...lights
    ],
    background: `
      // in vec2 uv
      // in vec2 uv01
      // out vec4 ret

      ret = vec4(0.0, 0.0, 0., 1.);
    `,
    customGLSL: `
      float rockH(vec3 p) {
        p *= 5.0;
        return 
          (snoise(p * 0.080) * 2.1 +
          snoise(p * 0.137) * 1.2 +
          snoise(p * 0.537) * 0.75 +
          snoise(p * 1.318) * 0.35 +
          snoise(p * 3.127) * 0.25) * 2.;
      } 
    `,
    objects: [
      {
        distance: `
          float rockDist (vec3 p) {
            float z = rockH(p);
            return distance(vec3(p.xy, 6.), p) - z * 0.8;
          }
        `,
        color: `
          vec4 rockColor (vec3 p) {
            return vec4(vec3(.5, 0.4, 0.35) * (-p.z+4.), 1.);
          }
        `,
        specular: `
          vec4 rockSpec (vec3 p) {
            return vec4(0.1, 0.2,0.6, 0.1);
          }
        `,
        emissive: `
          vec4 rockEm (vec3 p) {
            return vec4(0.25, 0.1, 0.02, 1. / max(-p.z+4., 1.));
          }
        `
      }
    ]
  });

  await bgtex.render({
    width: 2048,
    height: 2048,
    blueNoiseRes: 2048 * 8,
    DSAA: true
  });

  bgtex.save(`rock-tex`);
};

const gemGen = async () => {

  const lightVec = new THREE.Vector3(-5, 5, -5).normalize().multiplyScalar(10.);

  const lights = [{
    position: new THREE.Vector3(lightVec.x * 335.410196, lightVec.y * 335.410196, lightVec.z * 335.410196),
    radius: 10000.,
    ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
    diffuse: new THREE.Vector4(0.5*2, 0.4*2, 0.35*2, 2.0)
  },{
    position: new THREE.Vector3(0., 0., 0.),
    radius: 500.,
    ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
    diffuse: new THREE.Vector4(0.5*1, 0.4*1, 0.35*1, 2.0)
  }];

  const gemImg = new RaymarchedImage({
    simplex: true,
    perlin: true,
    worley: true,
    usePerlinForRandom: true,
    scale: 50,
    depth: 50,
    maxIterations: 1024,
    minDist: 0.001,
    seed: 1,
    normalDist: 0.001,
    shadowIterations: 512,
    shadowSharpness: 1.5,
    shadowStrength: 1.0,
    fogIterations: 256,
    fogShadowIterations: 128,
    fogShadowFactor: 1.0,
    fogShadowMaxDist: 30,
    preShadows: true,
    preLight: [
      ...lights
    ],
    background: `
      // in vec2 uv
      // in vec2 uv01
      // out vec4 ret

      ret = vec4(0., 0., 0., 0.);
    `,
    customGLSL: `
      float gemFn(vec3 p) {
        return sdDiamond(p, 20.);
      }
    `,
    objects: [
      {
        distance: `
          float gemDist (vec3 p) {
            return gemFn(p);
          }
        `,
        color: `
          vec4 gemColor (vec3 p) {
            return vec4(1., 0.5, 0.1, 1.0);
          }
        `,
        specular: `
          vec4 gemSpec (vec3 p) {
            return vec4(1., 0.5, 0.1, 1.0);
          }
        `
      }
    ]
  });

  await gemImg.render({
    width: 512,
    height: 512,
    blueNoiseRes: 512 * 8,
    DSAA: true
  });

  gemImg.save(`gem`);
};

const bombGen = async (on) => {

  const lightVec = new THREE.Vector3(-5, 5, -5).normalize().multiplyScalar(10.);

  const lights = [
    {
      position: new THREE.Vector3(-10, 10, -20),
      radius: 10000.,
      ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
      diffuse: new THREE.Vector4(0.5*2, 0.4*2, 0.35*2, 2.0)
    }
  ];

  const bombImg = new RaymarchedImage({
    simplex: true,
    perlin: true,
    worley: true,
    usePerlinForRandom: true,
    scale: 50,
    depth: 50,
    maxIterations: 1024,
    minDist: 0.001,
    seed: 1,
    normalDist: 0.001,
    shadowIterations: 512,
    shadowSharpness: 1.5,
    shadowStrength: 1.0,
    fogIterations: 256,
    fogShadowIterations: 128,
    fogShadowFactor: 1.0,
    fogShadowMaxDist: 30,
    preShadows: true,
    preLight: [
      ...lights
    ],
    background: `
      // in vec2 uv
      // in vec2 uv01
      // out vec4 ret

      ret = vec4(0., 0., 0., 0.);
    `,
    customGLSL: `
    `,
    objects: [
      {
        distance: `
          float bombDist (vec3 p) {
            return opUnion(
              opSubtraction(length(p) - 15., length(p - vec3(0., 0., -15.)) - 4.),
              opIntersection(length(vec2(length(p.xz) - 5., clamp(p.y, -17.5, 0.))), length(p) - 19.5)
            );
          }
        `,
        emissive: on ? `
          vec4 bombEmm (vec3 p) {
            return vec4(0.35, 0.01, 0.01, 1.0);
          }
        ` : undefined,
        color: `
          vec4 bombColor (vec3 p) {
            return vec4(0.1, 0.1, 0.1, 1.0);
          }
        `,
        specular: `
          vec4 bombSpec (vec3 p) {
            return vec4(4., 4., 4., 1.0);
          }
        `
      },
      {
        distance: `
          float lghtDist (vec3 p) {
            return length(p - vec3(0., 0., -15.)) - 3.;
          }
        `,
        color: `
          vec4 lghtColor (vec3 p) {
            return ${on ? `vec4(0.5, 0.1, 0.1, 1.0)` : `vec4(0.1, 0.05, 0.05, 1.0)`};
          }
        `,
        emissive: `
          vec4 lghtEmm (vec3 p) {
            return ${on ? `vec4(1.0, 0.1, 0.1, 1.0)` : `vec4(0.1, 1.0, 0.1, 1.0)`};
          }
        `,
        specular: `
          vec4 lghtSpec (vec3 p) {
            return vec4(4., 4., 4., 0.1);
          }
        `
      }
    ]
  });

  await bombImg.render({
    width: 512,
    height: 512,
    blueNoiseRes: 512 * 8,
    DSAA: true
  });

  bombImg.save(on ? `bomb-on` : 'bomb-off');
};

const enemyGen = async (on) => {

  const lightVec = new THREE.Vector3(-5, 5, -5).normalize().multiplyScalar(10.);

  const lights = [
    {
      position: new THREE.Vector3(-10, 10, -20),
      radius: 10000.,
      ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
      diffuse: new THREE.Vector4(0.5*2, 0.4*2, 0.35*2, 2.0)
    }
  ];

  const enemyImg = new RaymarchedImage({
    simplex: true,
    perlin: true,
    worley: true,
    usePerlinForRandom: true,
    scale: 50,
    depth: 50,
    maxIterations: 1024,
    minDist: 0.001,
    seed: 1,
    normalDist: 0.001,
    shadowIterations: 512,
    shadowSharpness: 1.5,
    shadowStrength: 1.0,
    fogIterations: 256,
    fogShadowIterations: 128,
    fogShadowFactor: 1.0,
    fogShadowMaxDist: 30,
    preShadows: true,
    preLight: [
      ...lights
    ],
    background: `
      // in vec2 uv
      // in vec2 uv01
      // out vec4 ret

      ret = vec4(0., 0., 0., 0.);
    `,
    customGLSL: `
    `,
    objects: [
      {
        distance: `
          float bombDist (vec3 p) {
            float a = sin(atan(p.y, p.x) * 20.) * 0.5 + 0.5;
            return
              opSubtraction(length(p) - (15. + a*2.), length(p - vec3(0., 0., -15.)) - 8.)
            ;
          }
        `,
        emissive: on ? `
          vec4 bombEmm (vec3 p) {
            if (length(p.xy) < 8. || length(p.xy) > 15.) {
              return vec4(0.7, 0.01, 0.01, 1.0);
            }
            else {
              return vec4(0.);
            }
          }
        ` : undefined,
        color: `
          vec4 bombColor (vec3 p) {
            return vec4(0.5, 0.1, 0.5, 1.0);
          }
        `,
        specular: `
          vec4 bombSpec (vec3 p) {
            return vec4(4., 4., 4., 1.0);
          }
        `
      },
      {
        distance: `
          float lghtDist (vec3 p) {
            return length(p - vec3(0., 0., -15.)) - 3.;
          }
        `,
        color: `
          vec4 lghtColor (vec3 p) {
            if (length(p.xy) < 8.) {
              return ${on ? `vec4(0.5, 0.1, 0.1, 1.0)` : `vec4(0.05, 0.05, 0.05, 1.0)`};
            }
            else {
              return vec4(0.05, 0.05, 0.05, 1.0);
            }
          }
        `,
        emissive: `
          vec4 lghtEmm (vec3 p) {
            if (length(p.xy) < 8.) {
              return ${on ? `vec4(1.0, 0.1, 0.1, 1.0)` : `vec4(0.1, 0.1, 0.1, 1.0)`};
            }
            else {
              return vec4(0.1, 0.1, 0.1, 1.0);
            }
          }
        `,
        specular: `
          vec4 lghtSpec (vec3 p) {
            return vec4(4., 4., 4., 0.1);
          }
        `
      }
    ]
  });

  await enemyImg.render({
    width: 512,
    height: 512,
    blueNoiseRes: 512 * 8,
    DSAA: true
  });

  enemyImg.save(on ? `enemy-on` : 'enemy-off');
};

const bossGen = async (on) => {

  const lightVec = new THREE.Vector3(-5, 5, -5).normalize().multiplyScalar(50.);

  const lights = [
    {
      position: new THREE.Vector3(-10*3, 10*3, -20*6),
      radius: 10000.,
      ambient: new THREE.Vector4(0.2, 0.15, 0.1, 0.5),
      diffuse: new THREE.Vector4(0.5*4, 0.4*4, 0.35*4, 4.0)
    }
  ];

  const bossImg = new RaymarchedImage({
    simplex: true,
    perlin: true,
    worley: true,
    usePerlinForRandom: true,
    scale: 150,
    depth: 150,
    maxIterations: 1024,
    minDist: 0.001,
    seed: 1,
    normalDist: 0.001,
    shadowIterations: 512,
    shadowSharpness: 1.5,
    shadowStrength: 1.0,
    fogIterations: 256,
    fogShadowIterations: 128,
    fogShadowFactor: 1.0,
    fogShadowMaxDist: 30,
    preShadows: true,
    preLight: [
      ...lights
    ],
    background: `
      // in vec2 uv
      // in vec2 uv01
      // out vec4 ret

      ret = vec4(0., 0., 0., 0.);
    `,
    customGLSL: `
    `,
    objects: [
      {
        distance: `
          float bombDist (vec3 p) {
            float a = sin(atan(p.y, p.x) * 35.) * 0.5 + 0.5;
            return
              opSubtraction(length(p) - (15.*3. + a*8.), length(p - vec3(0., 0., -15.*3.)) - 8. * 3.)
            ;
          }
        `,
        emissive: on ? `
          vec4 bombEmm (vec3 p) {
            if (length(p.xy) < 8.*3. || length(p.xy) > 15.*3.) {
              return vec4(0.01, 0.01, 0.7, 1.0);
            }
            else {
              return vec4(0.);
            }
          }
        ` : undefined,
        color: `
          vec4 bombColor (vec3 p) {
            return vec4(0.1, 0.1, 0.5, 1.0);
          }
        `,
        specular: `
          vec4 bombSpec (vec3 p) {
            return vec4(4., 4., 4., 1.0);
          }
        `
      },
      {
        distance: `
          float lghtDist (vec3 p) {
            return length(p - vec3(0., 0., -15.)) - 3.;
          }
        `,
        color: `
          vec4 lghtColor (vec3 p) {
            if (length(p.xy) < 8.*3.) {
              return ${on ? `vec4(0.1, 0.1, 0.5, 1.0)` : `vec4(0.05, 0.05, 0.05, 1.0)`};
            }
            else {
              return vec4(0.05, 0.05, 0.05, 1.0);
            }
          }
        `,
        emissive: `
          vec4 lghtEmm (vec3 p) {
            if (length(p.xy) < 8.*3.) {
              return ${on ? `vec4(0.0, 0.1, 1.0, 1.0)` : `vec4(0.1, 0.1, 0.1, 1.0)`};
            }
            else {
              return vec4(0.1, 0.1, 0.1, 1.0);
            }
          }
        `,
        specular: `
          vec4 lghtSpec (vec3 p) {
            return vec4(4., 4., 4., 0.1);
          }
        `
      }
    ]
  });

  await bossImg.render({
    width: 1024,
    height: 1024,
    blueNoiseRes: 1024 * 8,
    DSAA: true
  });

  bossImg.save(on ? `boss-on` : 'boss-off');
};

//bgGen();
//rockTexGen();
//gemGen();
//bombGen(true);
//bombGen(false);
//pipeGen(true);
//pipeGen(false);
//exitGen(false);
//exitGen(true);
enemyGen(true);
enemyGen(false);
bossGen(true);
bossGen(false);