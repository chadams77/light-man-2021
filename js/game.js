window.GSZ = 1024;
window.NUM_PRT = 8192;
window.dt = 1/60;

window.totalToLoad = 0;
window.totalLoaded = 0;

function Time() {
    return new Date().getTime() / 1000.;
}

function GPUHash(gpu, gpuCanvas, gpuContext, tjsRenderer) {
    this.gpu = gpu;
    this.gpuCanvas = gpuCanvas;
    this.gpuContext = gpuContext;

    this.encodePositions = this.gpu.createKernel(function(
        prtPos,
        prtAttr
    ) {
        let i = this.thread.x + this.thread.y * 1024;
        if (Math.floor(i/2) < this.constants.NUM_PRT) {
            let idx = Math.floor(i/2);
            let hp = prtAttr[idx*5+4];
            if (hp > 0) {
                let xy = prtPos[i];
                let ci = Math.round(xy/2);

                this.color(
                    Math.max(0, Math.min(1, Math.floor(ci / 256) / 255.0)),
                    Math.max(0, Math.min(1, (ci % 256) / 255.0)),
                    (prtAttr[idx*5+0] === 2 ? 0.5 : 0) + 0.1 * Math.min(prtAttr[idx*5+1], 1) + 0.2,
                    1
                );
            }
            else {
                this.color(0, 0, 0, 0);    
            }
        }
        else {
            this.color(0, 0, 0, 0);
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        tactic: 'speed',
        immutable: true,
    }).setOutput([1024, 1024]).setGraphical(true);

    this.tjsRenderer = tjsRenderer;
    this.inTexture = new THREE.CanvasTexture(this.encodePositions.canvas, undefined, undefined, undefined, THREE.NearestFilter, THREE.NearestFilter);

    let verts = [];
    for (let i=0; i<NUM_PRT; i++) {
        verts.push((i*2)/16);
        verts.push((i*2+1)/16);
        verts.push(i);
    }
    
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.material = new THREE.ShaderMaterial({
        uniforms: {
            vertexTex: { type: 't', value: this.inTexture }
        },
        vertexShader: `
            uniform sampler2D vertexTex;

            varying float alpha, index;

            void main() {
                float xi = position.x * 16.;
                float yi = position.y * 16.;

                vec2 xv = vec2(mod(floor(xi), 1024.), floor(xi / 1024.)) / 1024.;
                vec2 yv = vec2(mod(floor(yi), 1024.), floor(yi / 1024.)) / 1024.;

                vec4 xt = texture2D(vertexTex, xv);
                vec4 yt = texture2D(vertexTex, yv);

                alpha = max(xt.a, yt.a);
                index = position.z;

                vec2 xy = vec2(
                    floor(xt.r * 255. * 256.0 + xt.g * 255.),
                    floor(yt.r * 255. * 256.0 + yt.g * 255.)
                );

                vec4 mvPosition = viewMatrix * vec4(-xy.x, xy.y, -xt.b, 1.0);
                gl_PointSize = 1.0;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying float alpha, index;

            void main() {
                gl_FragColor = vec4(
                    floor(index / 256.) / 255., mod(index, 256.) / 255., 0., alpha
                );
            }
        `,
    });
    this.mesh = new THREE.Points(this.geometry, this.material);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, GSZ*0.5, 0, GSZ*0.5, 0, 1000);
    this.camera.position.set(0, 0, -500);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.mesh.updateMatrixWorld(true);
    this.mesh.frustumCulled = false;
    this.mesh.depthTest = false;
    this.mesh.depthWrite = false;
    this.mesh.needsUpdate = true;
    this.scene.add(this.mesh);

}

GPUHash.prototype.update = function(prtPos, prtAttr) {
    this.encodePositions(prtPos, prtAttr);
    this.inTexture.needsUpdate = true;
    this.tjsRenderer.clear(true, true);
    this.tjsRenderer.render(this.scene, this.camera);
};

function AUDIOEngine(sounds, onLoad) {

    if (window.webkitAudioContext) {
        this.actx = new window.webkitAudioContext();
    } else {
        this.actx = new window.AudioContext();
    }

    this.loaded = false;

    reverbjs.extend(this.actx);

    this.buffers = {};
    this.onLoad = () => {
        this.loaded = true;
        onLoad();
    }
    let toLoad = 1;

    for (let key in sounds) {

        toLoad += 1;

        let request = new XMLHttpRequest();
        request.open('GET', 'sfx' + sounds[key], true);
        request.responseType = 'arraybuffer';
        request.onload = (req) => {
            this.actx.decodeAudioData(req.target.response, (buffer) => {
                this.buffers[key] = buffer;
                toLoad -= 1;
                window.totalLoaded += 1;
                if (toLoad <= 0) {
                    this.onLoad();
                }
            });
        };
        request.send();
    }

    this.gain = this.actx.createGain();
    this.gain.connect(this.actx.destination);

    this.reverbNode = this.actx.createReverbFromUrl("sfx/R1NuclearReactorHall.m4a", () => {
        this.reverbNode.connect(this.gain);
        window.totalLoaded += 1;
        toLoad -= 1;
        if (toLoad <= 0) {
            this.onLoad();
        }
    });

    window.totalToLoad += toLoad;

    this.setVolume(0.5);

};

AUDIOEngine.prototype.setVolume = function(vol) {
    vol = vol || 0;
    this.gain.gain.setValueAtTime(vol, this.actx.currentTime);
}

function SOUND(eng, key, desc) {
    this.eng = eng;
    this.actx = eng.actx;
    this.source = this.actx.createBufferSource();
    this.source.buffer = eng.buffers[key];
    if (desc.loop) {
        this.source.loop = true;
    }
    else {
        window.setTimeout(() => {
            this.destroy();
        }, Math.ceil(1050 * this.source.buffer.duration));
    }
    this.gain = this.actx.createGain();
    this.panner = this.actx.createStereoPanner();
    this.rate = desc.rate || 1;
    this.volume = desc.volume || 0;
    this.source.playbackRate.value = this.rate;
    this.pan = Math.max(-1, Math.min(1, desc.pan || 0)) * 0.5;
    this.gain.gain.setValueAtTime(this.volume, this.actx.currentTime);
    this.panner.pan.setValueAtTime(this.pan, this.actx.currentTime);
    this.source.connect(this.panner);
    this.panner.connect(this.gain);
    this.gain.connect(eng.reverbNode);
    if (desc.randomOffset) {
        this.source.start(desc.offset || 0, Math.random() * this.source.buffer.duration);
    }
    else {
        this.source.start(desc.offset || 0);
    }
};

SOUND.prototype.update = function(gain, rate, pan) {
    this.volume = gain || 0;
    this.pan = Math.max(-1, Math.min(1, pan || 0)) * 0.5;
    this.gain.gain.value = this.volume;
    this.source.playbackRate.value = this.source.playbackRate.value * 0.25 + (rate || 1) * 0.75;
    this.panner.pan.value = this.pan;
};

SOUND.prototype.destroy = function() {
    this.source.stop();
    this.source.buffer = null;
    this.source = null;
    this.gain = null;
    this.eng = null;
    this.actx = null;
};

AUDIOEngine.prototype.playSound = function(key, vol, rate, offset) {
    if (vol === undefined) {
        vol = 1;
    }
    if (vol < 0) {
        return;
    }
    rate = rate || 1;
    if (rate < 0.05) {
        return;
    }
    rate += Math.random() * 0.05 - 0.025;
    this.createSound(key, {
        rate: rate,
        volume: vol,
        loop: false,
        offset: offset || 0
    });
};

AUDIOEngine.prototype.playSound2d = function(key, sx, sy, px, py, vol, rate, offset) {
    if (vol === undefined) {
        vol = 1;
    }
    rate = rate || 1;
    if (rate < 0.05) {
        return;
    }

    let dx = sx - px, dy = sy - py;
    let pan = dx * 0.1;
    vol /= (1. + (dx*dx+dy*dy)*0.01);

    if (vol > 2.0) {
        vol = 2.0;
    }

    if (vol < 0) {
        return;
    }

    rate += Math.random() * 0.05 - 0.025;
    this.createSound(key, {
        rate: rate,
        volume: vol,
        pan: pan,
        loop: false,
        offset: offset || 0
    });
};

AUDIOEngine.prototype.createSound = function(key, desc) {
    desc = desc || {};

    return new SOUND(this, key, desc);
};

function init (editor, tester) {

    let canvas = document.getElementById('c2d');
    let ctx = canvas.getContext('2d');

    let W = canvas.width, H = canvas.height;

    let initEditor = !!editor;

    let inMenu = !editor && !tester;

    if (inMenu) { editor = false; }

    let loadStatusRender = () => {

        let aspect = window.innerWidth / window.innerHeight;
        H = canvas.height = Math.min(window.innerHeight, 1024);
        W = canvas.width = H * aspect;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        ctx.font = (H*0.1) + 'px Roboto';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(`${Math.round(100*totalLoaded/totalToLoad)}%`, W*0.5, H*0.5+H*0.1*0.4);
        ctx.textAlign = 'left';

        if (totalLoaded < totalToLoad) {
            window.setTimeout(loadStatusRender, 1000/60);
        }
    }

    window.totalLoaded = 0;
    window.totalToLoad = 1;

    window.setTimeout(loadStatusRender, 1000/60);

    let toLoad = 1;
    let imgLoaded = () => { toLoad -= 1; window.totalLoaded += 1; if (toLoad <= 0) { afterLoadInit(); } };
    let loadImage = (file) => { let img = new Image(); toLoad += 1; window.totalToLoad += 1; img.src = 'img/' + file; img.onload = imgLoaded; return img; }

    let menuGradImg = loadImage('menu-grad.png');
    let gameBgImg = loadImage('game-bg.png');
    let gameBgOverImg = loadImage('game-bg-over.png');
    let rockTexImg = loadImage('rock-tex.png');
    let playerImg = loadImage('player.png');
    let moveRangeImg = loadImage('move-range.png');
    let bombRangeImg = loadImage('bomb-range.png');
    let iBombRangeImg = loadImage('ice-bomb-range.png');
    let exit1Img = loadImage('exit-1.png');
    let exit2Img = loadImage('exit-2.png');
    let pipeWaterImg = loadImage('pipe-water.png');
    let pipeLavaImg = loadImage('pipe-lava.png');
    let pipeBioImg = loadImage('pipe-bio.png');
    let bombPickUpImg = loadImage('bomb-pickup.png');
    let bombOnImg = loadImage('bomb-on.png');
    let bombOffImg = loadImage('bomb-off.png');
    let iBombPickUpImg = loadImage('ice-bomb-pickup.png');
    let iBombOnImg = loadImage('ice-bomb-on.png');
    let iBombOffImg = loadImage('ice-bomb-off.png');
    let gemImg = loadImage('gem.png');
    let gemNGImg = loadImage('gem-not-got.png');
    let starImg = loadImage('gold-star.png');
    let lightManImg = loadImage('lightman.png');
    let levelIconImg = loadImage('level-icon.png');
    let levelDisIconImg = loadImage('level-dis-icon.png');
    let levelSelIconImg = loadImage('level-sel-icon.png');
    let levelCheckIconImg = loadImage('level-check-icon.png');
    let bossIconImg = loadImage('boss-icon.png');
    let bossDisIconImg = loadImage('boss-dis-icon.png');
    let bossSelIconImg = loadImage('boss-sel-icon.png');
    let enemyNormalImg = loadImage('enemy-normal.png');
    let enemyFireImg = loadImage('enemy-fire.png');
    let enemyDieImg = loadImage('enemy-die.png');
    let bossNormalImg = loadImage('boss-normal.png');
    let bossFireImg = loadImage('boss-fire.png');
    let bossDieImg = loadImage('boss-die.png');
    let fireBallImg = loadImage('fireball.png');
    let iceBallImg = loadImage('iceball.png');

    let AUDIO = new AUDIOEngine({
        'water': '/water-loop.mp3',
        'lava': '/lava-loop.mp3',
        'bio': '/bio-loop.mp3',
        'explosion': '/explosion.mp3',
        'hover': '/hover.mp3',
        'click': '/click.mp3',
        'move': '/move.mp3',
        'grab': '/grab.mp3',
        'get-bomb': '/get-bomb.mp3',
        'note1': '/note1.mp3',
        'note2': '/note2.mp3',
        'note3': '/note3.mp3',
        'note4': '/note4.mp3',
        'note5': '/note5.mp3',
        'note6': '/note6.mp3',
        'note7': '/note7.mp3',
        'hurt-die': '/hurt-die.mp3'
    }, () => {
        imgLoaded();
    });

    let mouseX = 0, mouseY = 0;
    let mouseGX = 0, mouseGY = 0;
    let mouseLeft = false, mouseRight = false;
    let pMouseLeft = false, pMouseRight = false;

    const PX = (x) => ( x * (H/GSZ) + W/2-H/2 );
    const PY = (y) => ( y * (H/GSZ) + 0 );
    const PSZ = (sz) => ( sz * (H/GSZ) );

    let gpuCanvas = document.createElement('canvas');
    let gpuContext = gpuCanvas.getContext('webgl2', { premultipliedAlpha: false });
    let canvas2 = document.createElement('canvas');
    canvas2.width = canvas2.height = GSZ * 0.5;
    let tjsRenderer = new THREE.WebGLRenderer({canvas: canvas2, premultipliedAlpha: false, alpha: true});
    tjsRenderer.setClearColor(0, 0);
    const gpu = new GPU({
        canvas: gpuCanvas,
        context: gpuContext,
        mode: 'gpu'
    });

    gpu.addNativeFunction('rand2D',
        `float rand2D(float sequence, float seed) {
          return fract(sin(dot(vec2(seed, sequence), vec2(12.9898, 78.233))) * 43758.5453);
        }`
    );

    let hash = new GPUHash(gpu, gpuCanvas, gpuContext, tjsRenderer);

    let test_initParticlePositions = gpu.createKernel(function(
    ) {
        if ((this.thread.x % 2) > 0.) {
            return Math.random() * this.constants.GSZ * 0.4 + this.constants.GSZ * 0.6;
        }
        else {
            if ((Math.floor(this.thread.x/2)%2) > 0) {
                return Math.random() * this.constants.GSZ * 0.2;
            }
            else {
                return this.constants.GSZ - Math.random() * this.constants.GSZ * 0.2;
            }
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: NUM_PRT,
        output: [ NUM_PRT*2 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true,
    });

    let test_initParticleAttributes = gpu.createKernel(function(
        positions
    ) {
        let i = Math.floor(this.thread.x / 5);
        let attr = this.thread.x - (i*5);
        let px = positions[i*2], py = positions[i*2+1];

        let heat = rand2D(i / 8., 0.) * 0.1 - 0.05;

        let radius = 3.2;
        let type = 0;
        let visc = 6.0 / (1.0001 + heat);

        if (px < this.constants.GSZ*0.5) {
            heat += 0.05;
            type = 1;
            radius = 4.2;
            visc = 9.0 / (1.0001 + heat);
        }
        else {
            heat += 0.05;
            heat *= 0.75;
            if (px < this.constants.GSZ*0.9) {
                heat = -1.;
            }
        }

        if (attr === 0) {
            return type;
        }
        else if (attr === 1) {
            return heat;
        }
        else if (attr === 2) {
            return radius;
        }
        else if (attr === 3) {
            return visc;
        }
        else if (attr === 4) {
            return 1.;
        }
        else
        {
            return 0.;
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: NUM_PRT,
        output: [ NUM_PRT*5 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true,
    });

    let test_initParticleVelocities = gpu.createKernel(function(
    ) {
        return 0.;
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: NUM_PRT,
        output: [ NUM_PRT*2 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true,
    });

    let initParticlePositions = gpu.createKernel(function(
    ) {
        return 0.;
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: NUM_PRT,
        output: [ NUM_PRT*2 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true,
    });

    let initParticleAttributes = gpu.createKernel(function(
        positions
    ) {
        return 0.;
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: NUM_PRT,
        output: [ NUM_PRT*5 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true,
    });

    let initParticleVelocities = gpu.createKernel(function(
    ) {
        return 0.;
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: NUM_PRT,
        output: [ NUM_PRT*2 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true,
    });

    let initAirHeatMap = gpu.createKernel(function(
    ) {
        return 0.;
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: NUM_PRT,
        output: [ GSZ/2, GSZ/2 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true,
    });

    let copyAR2 = gpu.createKernel(function(arr2){
        return arr2[this.thread.x];
    }, {
        output: [ NUM_PRT * 2 ],
        tactic: 'speed',
        pipeline: true,
        immutable: true
    });

    let serializeAR2 = gpu.createKernel(function(arr2){
        return arr2[this.thread.x];
    }, {
        output: [ NUM_PRT * 2 ],
        tactic: 'speed'
    });

    let loadAR2 = gpu.createKernel(function(arr2){
        return arr2[this.thread.x];
    }, {
        output: [ NUM_PRT * 2 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true
    });

    let serializeAR5 = gpu.createKernel(function(arr5){
        return arr5[this.thread.x];
    }, {
        output: [ NUM_PRT * 5 ],
        tactic: 'speed'
    });

    let loadAR5 = gpu.createKernel(function(arr5){
        return arr5[this.thread.x];
    }, {
        output: [ NUM_PRT * 5 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true
    });

    let prtPos = initParticlePositions();
    let prtVel = initParticleVelocities();
    let prtAttr = initParticleAttributes(prtPos);
    let airHeatMap = initAirHeatMap();
    let lPrtVel = copyAR2(prtVel);

    let addParticleFindEmptyIndex = gpu.createKernel(function(
        attribs
    ) {
        let fi = -1;
        for (let i=0; i<this.constants.NUM_PRT; i++) {
            if (fi < 0 && attribs[i*5+4] <= 0.) {
                fi = i;
            }
        }
        return fi;
    }, {
        constants: {
            NUM_PRT: NUM_PRT
        },
        output: [ 1 ],
        tactic: 'speed',
        loopMaxIterations: NUM_PRT
    });

    let addParticleStep1 = gpu.createKernel(function(
        positions, attribs,
        x, y, type, heat, fi
    ) {
        let idx = Math.floor(this.thread.x / 2);
        if (fi === idx) {
            if ((this.thread.x % 2) > 0.5) {
                return y;
            }
            else {
                return x;
            }
        }
        else {
            return positions[this.thread.x];
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        output: [ NUM_PRT * 2 ],
        pipeline: true,
        loopMaxIterations: 1,
        tactic: 'speed',
        immutable: true
    });

    let addParticleStep2 = gpu.createKernel(function(
        positions, velocities, attribs,
        x, y, type, heat, down, fi
    ) {
        let idx = Math.floor(this.thread.x / 2);
        if (fi === idx) {
            if (down > 0.5 && (this.thread.x%2) === 1) {
                return 100.;
            }
            else {
                return 0.;
            }
        }
        else {
            return velocities[this.thread.x];
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        output: [ NUM_PRT * 2 ],
        pipeline: true,
        loopMaxIterations: 1,
        tactic: 'speed',
        immutable: true
    });

    let addParticleStep3 = gpu.createKernel(function(
        positions, attribs,
        x, y, type, heat, fi
    ) {
        let idx = Math.floor(this.thread.x / 5);
        let attrib = this.thread.x % 5;
        if (fi === idx) {
            if (attrib === 0) {
                return type;
            }
            else if (attrib === 1) {
                return heat;
            }
            else if (attrib === 2) {
                return 3.0;
            }
            else if (attrib === 3) {
                if (type === 0) {
                    return 1.0;
                }
                else if (type === 1) {
                    return 6.0;
                }
                else {
                    return 1.0;
                }
            }
            else if (attrib === 4) {
                return 1.0;
            }
        }
        else {
            return attribs[this.thread.x];
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        output: [ NUM_PRT * 5 ],
        pipeline: true,
        loopMaxIterations: 1,
        tactic: 'speed',
        immutable: true
    });

    let clearParticlesInRange = gpu.createKernel(function(
        positions, attribs,
        x, y, r, type1, type2, type3, type4, type5
    ) {
        let i = Math.floor(this.thread.x / 5);
        let attr = this.thread.x - (i*5);
        let px = positions[i*2], py = positions[i*2+1];

        let dx = px - x, dy = py - y;
        let dist = Math.sqrt(dx*dx+dy*dy);

        let allow = 0.;
        let type = attribs[i*5+0];

        if (type1 > 0.5 && type === 0) {
            allow = 1.;
        }
        else if (type2 > 0.5 && type === 1) {
            allow = 1.;
        }
        else if (type3 > 0.5 && type === 2) {
            allow = 1.;
        }
        else if (type4 > 0.5 && type === 3) {
            allow = 1.;
        }
        else if (type5 > 0.5 && type === 4) {
            allow = 1.;
        }

        if (dist <= r && allow > 0.5) {

            if (attr === 0) {
                return 2;
            }
            else if (attr === 1) {
                return 0;
            }
            else if (attr === 2) {
                return 3.2;
            }
            else if (attr === 3) {
                return 1.0;
            }
            else if (attr === 4) {
                return -1;
            }
            else
            {
                return 0.;
            }

        }
        else {

            return attribs[this.thread.x];

        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        output: [ NUM_PRT * 5 ],
        pipeline: true,
        loopMaxIterations: 128,
        tactic: 'speed',
        immutable: true
    });

    let clearPrtAtHash = gpu.createKernel(function(
        positions, attribs,
        x, y
    ) {
        let i = Math.floor(this.thread.x / 5);
        let attr = this.thread.x - (i*5);
        let px = positions[i*2], py = positions[i*2+1];

        let dx = px - x, dy = py - y;
        let dist = (dx*dx+dy*dy);

        if (dist <= 1.99*1.99) {

            if (attr === 0) {
                return 2;
            }
            else if (attr === 1) {
                return 0;
            }
            else if (attr === 2) {
                return 3.2;
            }
            else if (attr === 3) {
                return 1.0;
            }
            else if (attr === 4) {
                return -1;
            }
            else
            {
                return 0.;
            }

        }
        else {

            return attribs[this.thread.x];

        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        output: [ NUM_PRT * 5 ],
        pipeline: true,
        loopMaxIterations: 128,
        tactic: 'speed',
        immutable: true
    });

    let addParticles = function(x, y, r, type, heat, down) {
        heat = (heat || 0);

        if (type !== 2) {
            for (let i=0; i<1; i++) {
                let a = Math.random() * Math.PI * 2;
                let r2 = Math.random() * r * 2;
                let x2 = x + Math.cos(a) * r2;
                let y2 = y + Math.sin(a) * r2;
                x2 = Math.round(x2);
                y2 = Math.round(y2);
                prtAttr = clearParticlesInRange(
                    prtPos,
                    prtAttr,
                    x2, y2, 0.5,
                    type === 0 ? 1 : 0,
                    type === 1 ? 1 : 0,
                    type === 2 ? 1 : 0,
                    type === 3 ? 1 : 0,
                    type === 4 ? 1 : 0
                );
                let fi = addParticleFindEmptyIndex(prtAttr)[0];
                prtPos = addParticleStep1(
                    prtPos, prtAttr,
                    x2, y2, type, heat, fi
                );
                prtVel = addParticleStep2(
                    prtPos, prtVel, prtAttr,
                    x2, y2, type, heat, down ? 1 : 0, fi
                );
                prtAttr = addParticleStep3(
                    prtPos, prtAttr,
                    x2, y2, type, heat, fi
                );
            }
            return;
        }

        let ix = Math.round(x/2), iy = Math.round(y/2);
        let ir = Math.ceil(r/2);

        for (let xx=-ir; xx<=ir; xx+=2) {
            for (let yy=-ir; yy<=ir; yy+=2) {
                let x = (xx + ix) * 2 + 1, y = (yy + iy) * 2 + 1;
                let dx = x/2 - ix, dy = y/2 - iy;
                if ((dx*dx+dy*dy) <= (ir*ir)) {
                    prtAttr = clearPrtAtHash(
                        prtPos, prtAttr,
                        Math.round(x), Math.round(y)
                    );
                    let fi = addParticleFindEmptyIndex(prtAttr)[0];
                    prtPos = addParticleStep1(
                        prtPos, prtAttr,
                        Math.round(x), Math.round(y), type, heat, fi
                    );
                    prtVel = addParticleStep2(
                        prtPos, prtVel, prtAttr,
                        Math.round(x), Math.round(y), type, heat, 0.0, fi
                    );
                    prtAttr = addParticleStep3(
                        prtPos, prtAttr,
                        Math.round(x), Math.round(y), type, heat, fi
                    );
                }
            }
        }
    };

    let deleteParticles = function(x, y, r, type) {
        prtAttr = clearParticlesInRange(
            prtPos,
            prtAttr,
            x, y, r,
            type === 0 ? 1 : 0,
            type === 1 ? 1 : 0,
            type === 2 ? 1 : 0,
            type === 3 ? 1 : 0,
            type === 4 ? 1 : 0
        );
    };

    let updateVelocities = gpu.createKernel(function(
        positions,
        velocities,
        attribs,
        pHash,
        dt,
        playerX,
        playerY
    ) {
        let idx = Math.floor(this.thread.x / 2);
        let px = positions[idx*2], py = positions[idx*2+1];
        let vx = velocities[idx*2], vy = velocities[idx*2+1];
        let type   = attribs[idx*5+0];
        let heat   = attribs[idx*5+1];
        let radius = attribs[idx*5+2];
        let visc   = attribs[idx*5+3];
        let hp     = attribs[idx*5+4];

        if (hp <= 0.) {
            return velocities[this.thread.x];
        }
        if (type === 2) {
            return 0.;
        }

        if (type === 0 || type === 4) {
            vx *= 0.991 * (1. - Math.max(0., -heat) * 0.9999);
            vy *= 0.991 * (1. - Math.max(0., -heat) * 0.9999);
        }
        vy += dt * 100.;

        if ((type === 0 || type===4) && heat > 0) {
            vy -= dt * 500. * heat;
            vy *= 0.991;
        }
        if (type === 1 || type === 4) {
            vx *= 0.991 * (1. - Math.max(0., heat) * 0.05);
            vy *= 0.991 * (1. - Math.max(0., heat) * 0.05);
        }

        let ivx = vx, ivy = vy;

        for (let ix=-5; ix<=5; ix+=1) {
            for (let iy=-5; iy<=5; iy+=1) {
                let fy = 511. - Math.floor(py*0.5 + iy);
                let fx = Math.floor(px*0.5 + ix);
                if (fx >= 0 && fy >= 0 && fx < this.constants.GSZ*0.5 && fy < this.constants.GSZ*0.5) {
                    let hClr = pHash[fy][fx];
                    if (hClr[3] > 0.5) {
                        let i = Math.floor(hClr[0] * 255. * 256. + hClr[1] * 255.);
                        if (i != idx && i < this.constants.NUM_PRT && i >= 0) {
                            let wx = positions[i*2], wy = positions[i*2+1];
                            let wvx = velocities[i*2], wvy = velocities[i*2+1];
                            let dx = px - wx, dy = py - wy;
                            let dsq = dx*dx + dy*dy;
                            let wtype   = attribs[i*5+0]
                            let wheat   = attribs[i*5+1];
                            let wradius = attribs[i*5+2];
                            let wvisc   = attribs[i*5+3];
                            let F = 1. - dsq / Math.pow(radius + wradius, 2.0);
                            if (F > 0. && (wtype !== 3 || type === 3)) {
                                F = Math.pow(F, 2.0);
                                let F2 = 1.;
                                if (type === 0 && wtype === 0) {
                                    F2 = 250.;
                                }
                                else if ((type === 1 || type === 4) && wtype === 0) {
                                    F2 = 25.;
                                }
                                else if (type === 0 && (wtype === 1 || wtype === 4)) {
                                    F2 = 200.;
                                }
                                else if ((type === 1 || type === 4) && (wtype === 1 || wtype === 4)) {
                                    F2 = 250.;
                                }
                                else if (type === 3 && wtype === 3) {
                                    F2 = 500.;
                                }
                                else if (wtype === 2) {
                                    F2 = 250.;
                                }
                                F2 *= 4.;
                                vx += dx * F * dt * F2;
                                vy += dy * F * dt * F2;
                                if (wtype !== 2) {
                                    let a = Math.min(1., F * (visc + wvisc) * dt);
                                    vx += (wvx - ivx) * a;
                                    vy += (wvy - ivy) * a;
                                    vx += wvx * dt * 0.1;
                                    vy += wvy * dt * 0.1;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (type === 0 || type === 4) {
            let wx = playerX, wy = playerY;
            let dx = px - wx, dy = py - wy;
            let dsq = dx*dx + dy*dy;
            let wradius = 4.0;
            let F = 1. - dsq / Math.pow(radius + wradius, 2.0);
            if (F > 0.) {
                F = Math.pow(F, 2.0);
                let F2 = 5.;
                F2 *= 8.;
                vx += dx * F * dt * F2;
                vy += dy * F * dt * F2;
            }
        }

        if ((px < 1. && vx < 0.) || (px >= (this.constants.GSZ-1) && vx > 0.)) {
            vx = -vx * 0.95;
        }

        if ((this.thread.x % 2) > 0) {
            return vy;
        }
        else {
            return vx;
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: 128,
        output: [ NUM_PRT*2 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true,
    });

    let updateAirHeatMap = gpu.createKernel(function(
        heatMap,
        pHash,
        positions,
        velocities,
        attribs,
        dt
    ) {
        let x = this.thread.x * 2, y = this.thread.y * 2;
        let heat = heatMap[this.thread.y][this.thread.x];
        let UH = 0., LH = 0., DH = 0., RH = 0.;
        if (this.thread.x > 1.) {
            LH = heatMap[this.thread.y][this.thread.x-1];
        }
        if (this.thread.y > 1.) {
            UH = heatMap[this.thread.y-1][this.thread.x];
        }
        if (this.thread.x < 511) {
            RH = heatMap[this.thread.y][this.thread.x+1];
        }
        if (this.thread.y < 511) {
            DH = heatMap[this.thread.y+1][this.thread.x];
        }
        let addHeat = 0.;
        for (let ix=0; ix<=0; ix++) {
            for (let iy=0; iy<=0; iy++) {
                let fy = 511. - Math.floor(y*0.5 + iy);
                let fx = Math.floor(x*0.5 + ix);
                if (fx >= 0 && fy >= 0 && fx < this.constants.GSZ*0.5 && fy < this.constants.GSZ*0.5) {
                    let hClr = pHash[fy][fx];
                    if (hClr[3] > 0.5) {
                        let j = Math.floor(hClr[0] * 255. * 256. + hClr[1] * 255.);
                        if (j < this.constants.NUM_PRT && j >= 0) {
                            addHeat += attribs[j*5+1];
                            if (attribs[j*5+0] === 1) {
                                addHeat += 2;
                                addHeat *= 8;
                            }
                            if (attribs[j*5+0] === 0 || attribs[j*5+0] === 4) {
                                addHeat += 0.1;
                            }
                        }
                    }
                }
            }
        }
        let dt2 = dt * 0.25;
        let retHeat = heat + addHeat * dt2 * 2.;
        retHeat += (DH - heat) * dt2 * 2.;
        retHeat += (LH - heat) * dt2 * 1.;
        retHeat += (RH - heat) * dt2 * 1.;
        retHeat += (UH - heat) * dt2 * 0.6;
        retHeat -= retHeat * dt2 * 0.8;
        return retHeat;
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: 128,
        output: [ GSZ/2, GSZ/2 ],
        pipeline: true,
        tactic: 'speed',
        immutable: true,
    });

    let updateAttributes = gpu.createKernel(function(attribs, positions, velocities, pHash, heatMap, dt) {
        let i = Math.floor(this.thread.x / 5);
        let attr = this.thread.x - (i*5);
        let px = positions[i*2],  py = positions[i*2+1];
        let vx = velocities[i*2], vy = velocities[i*2+1];

        let type   = attribs[i*5+0];
        let heat   = attribs[i*5+1];
        let radius = attribs[i*5+2];
        let visc   = attribs[i*5+3];
        let hp     = attribs[i*5+4];

        if (hp <= 0. || type === 2 || type === 3) {
            if (hp > 0.) {
                if (attr === 4 && type === 2) {
                    return hp + (1. - hp) * dt * 3;
                }
                else if (attr === 2 && type === 2) {
                    if (heat > 0.5) {
                        return 1.25;
                    }
                    else {
                        return 3.4;
                    }
                }
                else if (type === 3 && attr === 4) {
                    return hp - dt;
                }

            }
            return attribs[this.thread.x];
        }

        if (py >= (this.constants.GSZ-1)) {
            hp = -69;
        }

        let retHeat = heat;
        let airHeat = 0.;

        let maxFBio = 0.;

        if (hp > 0) {
        
            // diffuse heat
            let sameCount = 0;
            for (let ix=-3; ix<=3; ix+=1) {
                for (let iy=-3; iy<=3; iy+=1) {
                    let fy = 511. - Math.floor(py*0.5 + iy);
                    let fx = Math.floor(px*0.5 + ix);
                    if (fx >= 0 && fy >= 0 && fx < this.constants.GSZ*0.5 && fy < this.constants.GSZ*0.5) {
                        let hClr = pHash[fy][fx];
                        airHeat = Math.max(airHeat, heatMap[511. - Math.floor(fy/2)][Math.floor(fx/2)] * 0.25);
                        if (hClr[3] > 0.5) {
                            let j = Math.floor(hClr[0] * 255. * 256. + hClr[1] * 255.);
                            if (j != i && j < this.constants.NUM_PRT && j >= 0) {
                                let wx = positions[j*2], wy = positions[j*2+1];
                                let wvx = velocities[j*2], wvy = velocities[j*2+1];
                                let dx = px - wx, dy = py - wy;
                                let dsq = dx*dx + dy*dy;
                                let wradius = attribs[j*5+2];
                                let F = 1. - dsq / Math.pow((wradius+radius)*2, 2.);
                                let wtype   = attribs[j*5+0]
                                if (type === wtype && type !== 2) {
                                    sameCount += 1;
                                }
                                if (F > 0.95 && wtype === 2) {
                                    hp = 0.;
                                }
                                if ((type === 0 && wtype === 4) || (wtype === 0 && type === 4)) {
                                    maxFBio = Math.max(maxFBio, F);
                                }
                                if (F > 0. && wtype !== 2) {
                                    let wheat   = attribs[j*5+1];
                                    let wvisc   = attribs[j*5+3];
                                    F = Math.pow(F, 2.0);
                                    let a = F * dt;
                                    if ((type === 0 || type === 4) && (wtype === 0 || wtype === 4)) {
                                        a *= 3.0;
                                        if (wheat > 0.5 && heat < -0.1) {
                                            a *= 7.5;
                                        }
                                        a = Math.min(a, 0.5);
                                        let f3 = 0;
                                        /*if (type === 0 && wtype === 4) {
                                            f3 = -5;
                                            a *= 2;
                                        }*/
                                        retHeat += (f3 + wheat - heat) * a;
                                    }
                                    else if (type === 1 && wtype === 1) {
                                        a *= 0.5;
                                        if (wheat < -0.25) {
                                            a *= 16.;
                                            wheat -= 1.;
                                        }
                                        a = Math.min(a, 0.5);
                                        retHeat += (wheat - heat) * a;
                                    }
                                    else if (type === 0 && (wtype === 1 || wtype === 4)) {
                                        a *= 4.0;
                                        if (heat > -0.01) {
                                            a *= 0.1;
                                        }
                                        if (wtype === 1) {
                                            a *= 4.0;
                                        }
                                        a = Math.min(a, 0.5);
                                        retHeat += ((wheat+5.) - heat) * a;
                                    }
                                    else if (type === 1 && wtype === 0) {
                                        a *= 24.0;
                                        a = Math.min(a, 0.5);
                                        retHeat += ((wheat-1.) - heat) * a;
                                    }
                                    else if (type === 1 && wtype === 4) {
                                        a *= 0.1;
                                        a = Math.min(a, 0.5);
                                        retHeat += ((wheat-5.) - heat) * a;
                                    }
                                    else if (type === 4 && wtype === 1) {
                                        a *= 24.0;
                                        a = Math.min(a, 0.5);
                                        retHeat += ((wheat+5.) - heat) * a;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if ((sameCount < 1 || hp < 0.75) && Math.abs(vx) < 10 && Math.abs(vy) < 10) {
                hp -= dt;
            }
            else if (hp < 0.75) {
                hp -= dt;
            }

            if ((type === 0 || type === 4) && retHeat > 0.1) {
                hp -= dt * retHeat * 2.0;
                retHeat *= (1. + dt * 2.);
            }
            else if (type === 1 && retHeat < -0.1) {
                retHeat *= (1. + dt * 2.);
            }
            else if (type === 0 || type === 4) {
                if (heat > 0.) {
                    retHeat += (0. - retHeat) * dt * 0.25;
                }
            }

            if (type === 0) {
                if (heat < -0.1) {
                    retHeat += Math.max(0., airHeat - 2.5) * dt * 15.;
                }
                else {
                    retHeat += Math.max(0., airHeat - 2.5) * dt * 0.5;
                }
            }
            else if (type === 4) {
                if (heat < -0.1) {
                    retHeat += Math.max(0., airHeat - 2.5) * dt * 15.;
                }
                else {
                    retHeat += Math.max(0., airHeat - 2.5) * dt * 5.;
                }
            }

            if (retHeat > 10.) {
                retHeat = 10.;
            }
            if (retHeat < -1.) {
                retHeat = -1.;
            }

            if (py < 0) {
                hp -= dt * 4.;
            }
            if (type === 1 && retHeat < -0.9) {
                type = 2;
                hp = 0.01;
                heat = retHeat = 0.;
            }
            if (type === 0 && maxFBio > 0.5) {
                type = 4;
                heat = retHeat = 0.;
            }
            else if (type === 4 && maxFBio > 0.5) {
                hp -= dt * 4.;
                if (hp <= 0.1) {
                    hp = 1.0;
                    type = 0;
                }
            }
        }

        if (attr === 0) {
            return type;
        }
        else if (attr === 1) {
            if (type === 0) {
                if (heat < 0) {
                    heat = retHeat * 0.9 + heat * 0.1;
                }
                else {
                    heat = retHeat * 0.5 + heat * 0.5;
                }
            }
            else {
                heat = retHeat * 0.1 + heat * 0.9;
            }
            if (type === 1 && heat > 0) {
                heat = 0;
            }
            return heat;
        }
        else if (attr === 2) {
            if (type === 0) {
                return 3.2;
            }
            else if (type === 1 || type === 4) {
                return 3.5;
            }
            else {
                return radius;
            }
        }
        else if (attr === 3) {
            if (type === 0) {
                return 1.0;
            }
            else if (type === 1) {
                return 6.0;
            }
            else if (type === 4) {
                return 12.0;
            }
            return visc;
        }
        else if (attr === 4) {
            return hp;
        }
        else {
            return attribs[i];
        }

    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        output: [ NUM_PRT * 5 ],
        pipeline: true,
        loopMaxIterations: 128,
        tactic: 'speed',
        immutable: true
    });

    let updatePositions = gpu.createKernel(function(positions, velocities, dt) {
        return positions[this.thread.x] + velocities[this.thread.x] * dt;
    }, {
        output: [ NUM_PRT * 2 ],
        pipeline: true,
        loopMaxIterations: 128,
        tactic: 'speed',
        immutable: true,
    });

    let countParticles = gpu.createKernel(function(attribs) {
        let count0 = 0, count1 = 0, count2 = 0, count3 = 0, count4 = 0;
        for (let i=0; i<this.constants.NUM_PRT; i++) {
            let type = attribs[i*5+0];
            let hp = attribs[i*5+4];
            if (hp > 0.) {
                if (type === 0) {
                    count0 += 1;
                }
                else if (type === 1) {
                    count1 += 1;
                }
                else if (type === 2) {
                    count2 += 1;
                }
                else if (type === 3) {
                    count3 += 1;
                }
                else if (type === 4) {
                    count4 += 1;
                }
            }
        }
        if (this.thread.x === 0) {
            return count0;
        }
        else if (this.thread.x === 1) {
            return count1;
        }
        else if (this.thread.x === 2) {
            return count2;
        }
        else if (this.thread.x === 3) {
            return count3;
        }
        else if (this.thread.x === 4) {
            return count4;
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT
        },
        output: [ 5 ],
        pipeline: false,
        loopMaxIterations: NUM_PRT,
        tactic: 'speed',
        immutable: true
    });

    let countTypeNear = gpu.createKernel(function(px, py, radius, type, positions, attribs) {
        let count = 0;
        for (let i=0; i<this.constants.NUM_PRT; i++) {
            if (attribs[i*5+0] == type) {
                let dx = px - positions[i*2+0], dy = py - positions[i*2+1];
                let dist = Math.sqrt(dx*dx+dy*dy);
                if (dist <= radius) {
                    count += 1;
                }
            }
        }
        return count;
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        output: [ 1 ],
        loopMaxIterations: 512,
        tactic: 'speed'
    });

    let collidePlayerClosest = gpu.createKernel(function(px, py, positions, velocities, attribs, pHash) {
        let idx = -1;
        let minDist = 1000.;
        for (let ix=-15; ix<=15; ix+=1) {
            for (let iy=-15; iy<=15; iy+=1) {
                let fy = 511. - Math.floor(py*0.5 + iy);
                let fx = Math.floor(px*0.5 + ix);
                if (fx >= 0 && fy >= 0 && fx < this.constants.GSZ*0.5 && fy < this.constants.GSZ*0.5) {
                    let hClr = pHash[fy][fx];
                    if (hClr[3] > 0.5) {
                        let i = Math.floor(hClr[0] * 255. * 256. + hClr[1] * 255.);
                        let x = positions[i*2], y = positions[i*2+1];
                        let dx = x - px, dy = y - py;
                        let dist = Math.sqrt(dx*dx+dy*dy);
                        if (attribs[i*5+4] > 0.75 && (dist < minDist || idx < 0)) {
                            idx = i;
                            minDist = dist;
                        }
                    }
                }
            }
        }

        if (idx < 0) {
            return -1.;
        }
        else {
            if (this.thread.x === 0) {
                return positions[idx*2];
            }
            else if (this.thread.x === 1) {
                return positions[idx*2+1];
            }
            else if (this.thread.x === 2) {
                return attribs[idx*5+0];
            }
            else if (this.thread.x === 3) {
                return attribs[idx*5+1];
            }
            else if (this.thread.x === 4) {
                return attribs[idx*5+2];
            }
            else if (this.thread.x === 5) {
                return velocities[idx*2];
            }
            else if (this.thread.x === 6) {
                return velocities[idx*2+1];
            }
            else {
                return minDist;
            }
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        output: [ 8 ],
        loopMaxIterations: 512,
        tactic: 'speed'
    });

    let sampleLiquidSoundInfo = gpu.createKernel(function(_px, _py, positions, velocities, lVelocities, attribs, pHash) {

        let i2 = Math.floor(this.thread.x/3);
        let xx = (i2 % 17) - 8;
        let yy = Math.floor(i2 / 17) - 8;
        let px = _px + xx * 30., py = _py + yy * 30.;
        let total = 0.;
        let density = 0.;
        let totalV = 0.;
        let avgSpeed = 0.;
        let type0c = 0., type1c = 0., type4c = 0.;
        for (let ix=-7; ix<=7; ix+=1) {
            for (let iy=-7; iy<=7; iy+=1) {
                total += 1.;
                let fy = 511. - Math.floor(py*0.5 + iy);
                let fx = Math.floor(px*0.5 + ix);
                if (fx >= 0 && fy >= 0 && fx < this.constants.GSZ*0.5 && fy < this.constants.GSZ*0.5) {
                    let hClr = pHash[fy][fx];
                    if (hClr[3] > 0.5) {
                        let i = Math.floor(hClr[0] * 255. * 256. + hClr[1] * 255.);
                        let x = positions[i*2], y = positions[i*2+1];
                        let type = attribs[i*5+0];
                        if (type === 3) {
                            type = 1;
                        }
                        if (type === 0) {
                            type0c += 1.;
                        }
                        else if (type === 1) {
                            type1c += 1.;
                        }
                        else if (type === 4) {
                            type4c += 1.;
                        }
                        if (type === 0 || type === 1 || type === 4) {
                            let dx = x - px, dy = y - py;
                            let dist = Math.sqrt(dx*dx+dy*dy);
                            let F = Math.pow(Math.max(1. - dist / 12., 0.), 0.15);
                            let heat = attribs[i*5+1];
                            if (type !== 1) {
                                F *= 1. + 24 * Math.max(0., heat);
                                density -= heat * F * 0.5;
                                avgSpeed += Math.max(0., heat) * 500 * F;
                            }
                            density += F;
                            totalV += F;
                            avgSpeed += Math.pow(Math.pow(velocities[i*2]-lVelocities[i*2], 2.) + Math.pow(velocities[i*2+1]-lVelocities[i*2+1], 2.), 0.1) * F * 10;
                        }
                    }
                }
            }
        }

        if (total > 0.) {
            density /= (total);
        }
        if (totalV > 0.) {
            avgSpeed /= (totalV);
        }

        if ((this.thread.x%3) === 0) {
            return density;
        }
        else if ((this.thread.x%3) === 1) {
            return avgSpeed;
        }
        else if ((this.thread.x%3) === 2) {
            if (type0c >= type1c && type0c >= type4c) {
                return 0.;
            }
            else if (type1c >= type0c && type1c >= type4c) {
                return 1.;
            }
            else if (type4c >= type1c && type4c >= type0c) {
                return 0.;
            }
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        output: [ 3*17*17 ],
        loopMaxIterations: 1024,
        tactic: 'speed'
    });

    let renderLayers = gpu.createKernel(function(
            positions, attribs, pHash,
            _r0, _g0, _b0, _a0,  _re0, _ge0, _be0, _ae0,
            _r1, _g1, _b1, _a1,  _re1, _ge1, _be1, _ae1,
            _r2, _g2, _b2, _a2,  _re2, _ge2, _be2, _ae2,
            _r3, _g3, _b3, _a3,  _re3, _ge3, _be3, _ae3,
            texture
        ) {
        let density0 = 0.0;
        let density1 = 0.0;
        let density2 = 0.0;
        let density3 = 0.0;
        let thready = 1023. - this.thread.y;
        let iheat0 = 0.;
        let iheat1 = 0.;
        let iheat2 = 0.;
        let iheat3 = 0.;
        let ihp0 = 0.;
        let ihp1 = 0.;
        let ihp2 = 0.;
        let ihp3 = 0.;
        let ihcount0 = 0.;
        let ihcount1 = 0.;
        let ihcount2 = 0.;
        let ihcount3 = 0.;
        let type1 = 0;
        let type2 = 0;
        let type3 = 0;
        let type4 = 0;
        let type5 = 0;

        for (let ix=-4; ix<=4; ix+=1) {
            for (let iy=-4; iy<=4; iy+=1) {
                let fy = Math.floor(this.thread.y*0.5) + iy*2;
                let fx = Math.floor(this.thread.x*0.5) + ix*2;
                if (fx >= 0 && fy >= 0 && fx < (this.constants.GSZ) && fy < (this.constants.GSZ)) {
                    let hClr = pHash[Math.floor(fy*0.5)][Math.floor(fx*0.5)];
                    if (hClr[3] > 0.5) {
                        let i = Math.floor(hClr[0] * 255. * 256. + hClr[1] * 255.);
                        let type = attribs[i*5+0];
                        let radius = attribs[i*5+2];
                        let x = positions[i*2], y = positions[i*2+1];
                        let heat = attribs[i*5+1];
                        let dx = x - this.thread.x, dy = y - thready;
                        let dsq = dx*dx+dy*dy;
                        let F = 1. - dsq / (Math.pow(radius*2, 2.) * (70. / 40.));
                        if (F > 0.) {
                            if (type === 0) {
                                density0 += F * 0.4275;
                                iheat0 += heat * F;
                                ihp0 += attribs[i*5+4] * F;
                                ihcount0 += F;
                                type1 += F;
                            }
                            else if (type === 1 || type === 3) {
                                density1 += F * 0.4275;
                                iheat1 += heat * F;
                                ihp1 += attribs[i*5+4] * F;
                                ihcount1 += F;
                                if (type === 1) {
                                    type2 += F;
                                }
                                else if (type === 3) {
                                    type4 += F;
                                }
                            }
                            else if (type === 2) {
                                density2 += F * 0.4275;
                                iheat2 += heat * F;
                                ihp2 += attribs[i*5+4] * F;
                                ihcount2 += F;
                                type3 += F;
                            }
                            else if (type === 4) {
                                density3 += F * 0.4275;
                                iheat3 += heat * F;
                                ihp3 += attribs[i*5+4] * F;
                                ihcount3 += F;
                                type5 += F;
                            }
                        }
                    }
                }
            }
        }

        if (ihcount0 > 0.) {
            iheat0 /= ihcount0;
            ihp0 /= ihcount0;
        }
        if (ihcount1 > 0.) {
            iheat1 /= ihcount1;
            ihp1 /= ihcount1;
        }
        if (ihcount2 > 0.) {
            iheat2 /= ihcount2;
            ihp2 /= ihcount2;
        }
        if (ihcount3 > 0.) {
            iheat3 /= ihcount3;
            ihp3 /= ihcount3;
        }

        if ((type1 <= 0 && type2 <= 0 && type3 <= 0 && type4 <= 0 && type5 <= 0)) {
            this.color(0., 0., 0., 0.);
        }
        else {

            let oclr = [0., 0., 0., 0.];

            if (density0 >= 0.4) {
                if (density0 > 1.0) {
                    density0 = 1.0;
                }
                let clr = [0., 0., 0., 0.];
                clr[0] = density0 * _re0;
                clr[1] = density0 * _ge0;
                clr[2] = density0 * _be0;
                clr[3] = density0 * _ae0;
                clr[0] = Math.min(clr[0], 1.);
                clr[1] = Math.min(clr[1], 1.);
                clr[2] = Math.min(clr[2], 1.);
                clr[3] = Math.min(clr[3], 1.);
                let clr2 = [0., 0., 0., 0.];

                clr2[0] = density0 * _r0;
                clr2[1] = density0 * _g0;
                clr2[2] = density0 * _b0;
                clr2[3] = density0 * _a0;

                clr2[0] = Math.min(clr2[0], 1.);
                clr2[1] = Math.min(clr2[1], 1.);
                clr2[2] = Math.min(clr2[2], 1.);
                clr2[3] = Math.min(clr2[3], 1.);

                clr[0] = clr[0] * (1. - clr2[3]) + clr2[0] * clr[3];
                clr[1] = clr[1] * (1. - clr2[3]) + clr2[1] * clr[3];
                clr[2] = clr[2] * (1. - clr2[3]) + clr2[2] * clr[3];
                clr[3] = clr[3] * (1. - clr2[3]) + clr2[3] * clr[3];

                if (type1 > 0) {
                    clr[3] -= Math.min(iheat0, 1) * 0.8;
                    clr[3] = Math.min(1., Math.max(0., clr[3]));
                    clr[3] = Math.pow(clr[3], 6.);
                    let ff = Math.max(-iheat0, 0.);
                    clr[1] += ff * 0.5;
                    clr[1] = Math.min(1., Math.max(0., clr[1]));
                }

                clr[3] *= ihp0;

                let at = this.thread.x / 1023.;
                let at2 = this.thread.y / 1023.;
                let a1 = Math.pow(1. - max(at - 0.985, 0.) / 0.015, 2.0);
                let a2 = Math.pow(1. - max((1. - at) - 0.985, 0.) / 0.015, 2.0);
                let a3 = Math.pow(1. - max((1. - at2) - 0.9925, 0.) / 0.0075, 2.0);
                clr[3] *= a1 * a2 * a3;

                oclr[0] = oclr[0] * (1. - clr[3]) + clr[0] * clr[3];
                oclr[1] = oclr[1] * (1. - clr[3]) + clr[1] * clr[3];
                oclr[2] = oclr[2] * (1. - clr[3]) + clr[2] * clr[3];
                oclr[3] = oclr[3] * (1. - clr[3]) + clr[3] * clr[3];
            }

            if (density1 >= 0.4) {
                if (density1 > 1.0) {
                    density1 = 1.0;
                }
                let clr = [0., 0., 0., 0.];
                clr[0] = density1 * _re1;
                clr[1] = density1 * _ge1;
                clr[2] = density1 * _be1;
                clr[3] = density1 * _ae1;
                clr[0] = Math.min(clr[0], 1.);
                clr[1] = Math.min(clr[1], 1.);
                clr[2] = Math.min(clr[2], 1.);
                clr[3] = Math.min(clr[3], 1.);
                let clr2 = [0., 0., 0., 0.];

                clr2[0] = density1 * _r1;
                clr2[1] = density1 * _g1;
                clr2[2] = density1 * _b1;
                clr2[3] = density1 * _a1;
                clr2[0] += type4;

                clr2[0] = Math.min(clr2[0], 1.);
                clr2[1] = Math.min(clr2[1], 1.);
                clr2[2] = Math.min(clr2[2], 1.);
                clr2[3] = Math.min(clr2[3], 1.);

                clr[0] = clr[0] * (1. - clr2[3]) + clr2[0] * clr[3];
                clr[1] = clr[1] * (1. - clr2[3]) + clr2[1] * clr[3];
                clr[2] = clr[2] * (1. - clr2[3]) + clr2[2] * clr[3];
                clr[3] = clr[3] * (1. - clr2[3]) + clr2[3] * clr[3];

                if (type2 > 0) {
                    let ff = Math.max(-iheat1, 0.);
                    clr[0] = ff * 0.11 + (1. - ff) * clr[0];
                    clr[1] = ff * 0.105 + (1. - ff) * clr[1];
                    clr[2] = ff * 0.1 + (1. - ff) * clr[2];
                    clr[0] = Math.min(1., Math.max(0., clr[0]));
                    clr[1] = Math.min(1., Math.max(0., clr[1]));
                    clr[2] = Math.min(1., Math.max(0., clr[2]));
                }

                clr[3] *= ihp1;

                let at = this.thread.x / 1023.;
                let at2 = this.thread.y / 1023.;
                let a1 = Math.pow(1. - max(at - 0.985, 0.) / 0.015, 2.0);
                let a2 = Math.pow(1. - max((1. - at) - 0.985, 0.) / 0.015, 2.0);
                let a3 = Math.pow(1. - max((1. - at2) - 0.9925, 0.) / 0.0075, 2.0);
                clr[3] *= a1 * a2 * a3;

                oclr[0] = oclr[0] * (1. - clr[3]) + clr[0] * clr[3];
                oclr[1] = oclr[1] * (1. - clr[3]) + clr[1] * clr[3];
                oclr[2] = oclr[2] * (1. - clr[3]) + clr[2] * clr[3];
                oclr[3] = oclr[3] * (1. - clr[3]) + clr[3] * clr[3];
            }

            if (density3 >= 0.4) {
                if (density3 > 1.0) {
                    density3 = 1.0;
                }
                let clr = [0., 0., 0., 0.];
                clr[0] = density3 * _re3;
                clr[1] = density3 * _ge3;
                clr[2] = density3 * _be3;
                clr[3] = density3 * _ae3;
                clr[0] = Math.min(clr[0], 1.);
                clr[1] = Math.min(clr[1], 1.);
                clr[2] = Math.min(clr[2], 1.);
                clr[3] = Math.min(clr[3], 1.);
                let clr2 = [0., 0., 0., 0.];

                clr2[0] = density3 * _r3;
                clr2[1] = density3 * _g3;
                clr2[2] = density3 * _b3;
                clr2[3] = density3 * _a3;

                clr2[0] = Math.min(clr2[0], 1.);
                clr2[1] = Math.min(clr2[1], 1.);
                clr2[2] = Math.min(clr2[2], 1.);
                clr2[3] = Math.min(clr2[3], 1.);

                clr[0] = clr[0] * (1. - clr2[3]) + clr2[0] * clr[3];
                clr[1] = clr[1] * (1. - clr2[3]) + clr2[1] * clr[3];
                clr[2] = clr[2] * (1. - clr2[3]) + clr2[2] * clr[3];
                clr[3] = clr[3] * (1. - clr2[3]) + clr2[3] * clr[3];

                if (type5 > 0) {
                    clr[3] -= Math.min(iheat3, 1) * 0.3;
                    clr[3] = Math.min(1., Math.max(0., clr[3]));
                    clr[3] = Math.pow(clr[3], 6.);
                    let ff = Math.max(iheat3, 0.);
                    clr[0] += ff * 0.5;
                    clr[1] += ff * 0.5;
                    clr[0] = Math.min(1., Math.max(0., clr[1]));
                }

                clr[3] *= ihp3;

                let at = this.thread.x / 1023.;
                let at2 = this.thread.y / 1023.;
                let a1 = Math.pow(1. - max(at - 0.985, 0.) / 0.015, 2.0);
                let a2 = Math.pow(1. - max((1. - at) - 0.985, 0.) / 0.015, 2.0);
                let a3 = Math.pow(1. - max((1. - at2) - 0.9925, 0.) / 0.0075, 2.0);
                clr[3] *= a1 * a2 * a3;

                oclr[0] = oclr[0] * (1. - clr[3]) + clr[0] * clr[3];
                oclr[1] = oclr[1] * (1. - clr[3]) + clr[1] * clr[3];
                oclr[2] = oclr[2] * (1. - clr[3]) + clr[2] * clr[3];
                oclr[3] = oclr[3] * (1. - clr[3]) + clr[3] * clr[3];
            }

            if (density2 >= 0.4) {
                if (density2 > 1.0) {
                    density2 = 1.0;
                }
                let clr = [0., 0., 0., 0.];
                clr[0] = density2 * _re2;
                clr[1] = density2 * _ge2;
                clr[2] = density2 * _be2;
                clr[3] = density2 * _ae2;
                clr[0] += iheat2 * 16;
                clr[1] -= iheat2 * 16;
                clr[2] -= iheat2 * 16;
                clr[0] = Math.max(0., Math.min(clr[0], 1.));
                clr[1] = Math.max(0., Math.min(clr[1], 1.));
                clr[2] = Math.max(0., Math.min(clr[2], 1.));
                clr[3] = Math.max(0., Math.min(clr[3], 1.));
                let clr2 = [0., 0., 0., 0.];
                
                let texClr = texture[this.thread.y][this.thread.x];
                clr2[0] = density2 * texClr[0];
                clr2[1] = density2 * texClr[1];
                clr2[2] = density2 * texClr[2];
                clr2[3] = density2 * _a2;
                clr2[0] += iheat2 * 0.75;
                clr2[1] += iheat2 * 0.75;
                clr2[2] += iheat2 * 0.75;
                
                clr[0] = Math.max(0., Math.min(clr[0], 1.));
                clr[1] = Math.max(0., Math.min(clr[1], 1.));
                clr[2] = Math.max(0., Math.min(clr[2], 1.));
                clr[3] = Math.max(0., Math.min(clr[3], 1.));

                clr[0] = clr[0] * (1. - clr2[3]) + clr2[0] * clr[3];
                clr[1] = clr[1] * (1. - clr2[3]) + clr2[1] * clr[3];
                clr[2] = clr[2] * (1. - clr2[3]) + clr2[2] * clr[3];
                clr[3] = clr[3] * (1. - clr2[3]) + clr2[3] * clr[3];

                clr[3] *= ihp2;

                let at = this.thread.x / 1023.;
                let at2 = this.thread.y / 1023.;
                let a1 = Math.pow(1. - max(at - 0.985, 0.) / 0.015, 2.0);
                let a2 = Math.pow(1. - max((1. - at) - 0.985, 0.) / 0.015, 2.0);
                let a3 = Math.pow(1. - max((1. - at2) - 0.9925, 0.) / 0.0075, 2.0);
                clr[3] *= a1 * a2 * a3;

                oclr[0] = oclr[0] * (1. - clr[3]) + clr[0] * clr[3];
                oclr[1] = oclr[1] * (1. - clr[3]) + clr[1] * clr[3];
                oclr[2] = oclr[2] * (1. - clr[3]) + clr[2] * clr[3];
                oclr[3] = oclr[3] * (1. - clr[3]) + clr[3] * clr[3];
            }

            this.color(oclr[0], oclr[1], oclr[2], oclr[3]);
        }
    }, {
        constants: {
            NUM_PRT: NUM_PRT,
            GSZ: GSZ
        },
        loopMaxIterations: 128
    }).setOutput([GSZ, GSZ]).setGraphical(true);

    const toArr = (ina, len) => {
        let arr = [];
        for (let i=0; i<len; i++) {
            arr.push(ina[i]);
        }
        return arr;
    };

    const serialize = () => {
        return JSON.stringify({
            player: initPlayerAt(player.x, player.y),
            exit: { ...levelExit },
            pickUps: [ ...pickUps ],
            enemies: [ ...enemies ],
            pipes: [ ...pipes ],
            prtPos: toArr(serializeAR2(prtPos), NUM_PRT * 2),
            prtVel: toArr(serializeAR2(prtVel), NUM_PRT * 2),
            prtAttr: toArr(serializeAR5(prtAttr), NUM_PRT * 5)
        });
    };

    const loadLevel = (obj) => {
        player = initPlayerAt(obj.player.x, obj.player.y);
        setStandAtt(player);
        updateArmAtts(player);

        enemies = obj.enemies || [];

        musicTempo = Math.random() * 0.5 + 0.75;
        if (currentLevel >= 16) {
            musicTempo = 8.0;
        }

        numBombs = numGems = numIceBombs = 0;
        lastBomb = 0;

        deathFade = false;
        deathFadeT = 0.;

        bombs = [];
        fiballs = [];
        pickUps = obj.pickUps;
        pipes = obj.pipes;
        levelExit = obj.exit;
        if (!obj.prtPos.length) {
            obj.prtPos.length = NUM_PRT * 2;
            obj.prtVel.length = NUM_PRT * 2;
            obj.prtAttr.length = NUM_PRT * 5;
        }
        prtPos = loadAR2(new Float32Array(obj.prtPos));
        prtVel = loadAR2(new Float32Array(obj.prtVel));
        prtAttr = loadAR5(new Float32Array(obj.prtAttr));

        window.localStorage.setItem('curLevel', serialize());
    };

    canvas.onmousemove = (e) => {
        e = e || window.event;
        mouseX = e.pageX || 0; mouseY = e.pageY || 0;
        let w2 = window.innerWidth, h2 = window.innerHeight;
        mouseGX = (mouseX - (w2/2-h2/2)) / (h2/GSZ);
        mouseGY = (mouseY - 0) / (h2/GSZ);
    };

    let soundInit = false;

    let fluidSoundsW = [], fluidSoundsL = [], fluidSoundsB = [];
    let fsCache = [];

    canvas.onclick = (e) => {
        if (!soundInit && AUDIO.loaded) {
            soundInit = true;
            for (let i=0; i<24; i++) {
                fluidSoundsW.push(AUDIO.createSound('water', {rate: 1, volume: 0, loop: true, randomOffset: true}));
                fluidSoundsL.push(AUDIO.createSound('lava', {rate: 1, volume: 0, loop: true, randomOffset: true}));
                fluidSoundsB.push(AUDIO.createSound('bio', {rate: 1, volume: 0, loop: true, randomOffset: true}));
            }
        }
    }

    canvas.onmousedown = (e) => {
        e = e || window.event;
        if (e.button === 0) {
            mouseLeft = true;
        }
        else if (e.button === 2) {
            mouseRight = true;
        }
        e.preventDefault();
        return false;
    };

    canvas.onmouseup = (e) => {
        e = e || window.event;
        if (e.button === 0) {
            mouseLeft = false;
        }
        else if (e.button === 2) {
            mouseRight = false;
        }
        e.preventDefault();
        return false;
    };

    let QDown = false, WDown = false, EDown = false, RDown = false, IDown = false, TDown = false, SPCDown = false, ADown = false, SDown = false, TDDown = false;
    let XDown = false, BDown = false, XWasDown = false, BWasDown = false;
    let NumDown = [ false, false, false, false, false, false, false, false, false, false ];
    let NumWasDown = [ false, false, false, false, false, false, false, false, false, false ];

    document.body.onkeydown = (e) => {
        if (inMenu) {
            return;
        }
        e = e || window.event;
        if (e.which === 81) { // Q
            QDown = true;
        }
        else if (e.which === 87) { // W
            WDown = true;
        }
        else if (e.which === 69) { // E
            EDown = true;
        }
        else if (e.which === 65) { // A
            ADown = true;
        }
        else if (e.which === 66) { // B(oss)
            BDown = true;
        }
        else if (e.which === 82) { // R
            RDown = true;
        }
        else if (e.which === 83) { // S
            SDown = true;
        }
        else if (e.which === 84) { // T
            TDown = true;
        }
        else if (e.which === 88) { // X (enemy)
            XDown = true;
        }
        else if (e.which === 73) { // I
            IDown = true;
        }
        else if (e.which === 32) { // Space
            SPCDown = true;
        }
        else if (e.which >= 48 && e.which <= 57) { // 0...9
            NumDown[e.which-48] = true;
        }
        else if (e.which === 192) {
            TDDown = true;
        }
    };

    document.body.onkeyup = (e) => {
        if (inMenu) {
            return;
        }
        e = e || window.event;
        if (e.which === 81) { // Q
            QDown = false;
        }
        else if (e.which === 87) { // W
            WDown = false;
        }
        else if (e.which === 69) { // E
            EDown = false;
        }
        else if (e.which === 65) { // A
            ADown = false;
        }
        else if (e.which === 66) { // B(oss)
            BDown = false;
        }
        else if (e.which === 82) { // R
            RDown = false;
            if (!editor && !inMenu && !tester) {
                player.hp = 0;
            }
        }
        else if (e.which === 83) { // S
            SDown = false;
        }
        else if (e.which === 84) { // T
            TDown = false;
        }
        else if (e.which === 88) { // X (enemy)
            XDown = false;
        }
        else if (e.which === 73) { // I
            IDown = false;
        }
        else if (e.which === 32) { // Space
            SPCDown = false;
        }
        else if (e.which >= 48 && e.which <= 57) { // 0...9
            NumDown[e.which-48] = false;
        }
        else if (e.which === 192) {
            TDDown = false;
        }
        else if (e.which === 27 && !initEditor && !tester && !editor && !inMenu && !player.ascended && (fadeInT > 0.99)) {
            tinyxhr(parseInt(window.localStorage.getItem('lastLevelCleared') || 0) > 15 ? "lvl/menu-cleared.json" : "lvl/menu.json", (err,data,xhr) => {
                loadLevel(JSON.parse(data));
                gotoLevel = false;
                gotoLevelT = 0;
                fadeIn = true;
                fadeInT = 0;
                inMenu = true;
            });
        }
        if (editor && e.which === 68) { // D(ownload)
            let json = [serialize()];
            let blob = new Blob(json, { type: "text/plain;charset=utf-8" });
            let url = window.URL || window.webkitURL;
            let link = url.createObjectURL(blob);
            let a = document.createElement("a");
            a.download = "level-save.json";
            a.href = link;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    canvas.ondrop = (e) => {
        e.preventDefault();
        let file = e.dataTransfer.items[0].getAsFile();
        const reader = new FileReader()
        reader.onload = (e) => {
            loadLevel(JSON.parse(e.target.result));
        }
        reader.readAsText(file);
        return false;
    };

    canvas.ondragover = (e) => {
        e.preventDefault();
        return false;
    };

    canvas.oncontextmenu = (e) => {
        e.preventDefault();
        return false;
    };

    let lTime = Time();

    let rockTexture = null;
    let copyTexture = gpu.createKernel(function(
        tex
    ) {
        let clr = tex[this.thread.y][this.thread.x];
        this.color(clr[0], clr[1], clr[2], clr[3]);
    }, {
        tactic: 'speed',
        immutable: true,
        pipeline: true
    }).setOutput([1024, 1024]).setGraphical(true);

    let setStandAtt = (p) => {
        p.attachedTo = { x: p.x, y: p.y + 80, r: 60 };
        p.armAtts = [
            {...(p.attachedTo)},
            {...(p.attachedTo)},
            {...(p.attachedTo)},
            {...(p.attachedTo)}
        ];
        return p;
    }
    let setMoveAtt = (p, ox, oy) => {
        p.attachedTo = { x: p.x + (ox-p.x) * 1, y: p.y + (oy-p.y) * 1, r: 60 };
        p.armAtts = [
            {...(p.attachedTo)},
            {...(p.attachedTo)},
            {...(p.attachedTo)},
            {...(p.attachedTo)}
        ];
        return p;
    };
    let updateArmAtts = (p) => {
        let IR = 15 * 2;
        let limbs = [
            {x: p.x+IR*0.25, y: p.y-IR*0.25, r: IR*0.8 },
            {x: p.x-IR*0.25, y: p.y-IR*0.25, r: IR*0.8 },
            {x: p.x+IR*0.05, y: p.y+IR*0.2, r: IR*1.05 },
            {x: p.x-IR*0.05, y: p.y+IR*0.2, r: IR*1.05 }
        ];
        p.armAtts = [];
        for (let i=0; i<limbs.length; i++) {
            const L = limbs[i];
            let _ret = collidePlayerClosest(L.x, L.y, prtPos, prtVel, prtAttr, canvas2);
            let ret = { x: _ret[0], y: _ret[1], type: _ret[2], heat: _ret[3], radius: _ret[4], vx: _ret[5], vy: _ret[6], dist: _ret[7] };
            if ((ret.type === 2 || (ret.type === 0 && ret.heat < -0.5)) && ret.dist < (IR+ret.radius*1.5)) {
                let dx0 = p.x - L.x;
                let dy0 = p.y - L.y;
                let dlen0 = Math.sqrt(dx0*dx0+dy0*dy0);
                let dx = ret.x - L.x;
                let dy = ret.y - L.y;
                let dlen = Math.sqrt(dx*dx+dy*dy);
                dx /= dlen; dy /= dlen;
                p.armAtts.push({ x: ret.x, y: ret.y, r: ret.radius });
            }
            else {
                p.armAtts.push({ x: p.x, y: p.y + 80, r: 60 });
            }
        }
    };
    let initPlayerAt = (x, y) => {
        return {
            x: x,
            y: y,
            oldPos: [],
            attachedTo: null,
            moveTime: 0.,
            armAtts: [],
            moveToX: x,
            moveToY: y,
            vy: 0,
            vx: 0,
            hp: 100,
            floating: 0,
            ascendT: 0,
            ascended: false
        };
    }
    let player = initPlayerAt(128, 128);
    setStandAtt(player);
    updateArmAtts(player);

    let levelExit = {
        x: 1023 - 128,
        y: 128,
        r: 48,
        t: 0
    };

    let pipes = [];
    let pickUps = [];
    let bombs = [];
    let enemies = [];
    let fiballs = [];

    let musicTime = 0.;

    let drawMoveRange = (x, y, r, alpha) => {
        let oa = ctx.globalAlpha;
        ctx.globalAlpha = alpha * (0.075 + 0.025 * Math.sin(Time()*Math.PI/1.5));
        let dx = mouseGX - x, dy = mouseGY - y;
        let dist = Math.sqrt(dx*dx+dy*dy);
        if (dist <= r && mouseGX >= 0 && mouseGY >= 0 && mouseGX < GSZ && mouseGY < GSZ) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#FFF';
            ctx.globalAlpha *= 2;
            let ang = Math.atan2(mouseGY-y, mouseGX-x);
            let gx = x + Math.cos(ang) * Math.max(dist-6, 0.);
            let gy = y + Math.sin(ang) * Math.max(dist-6, 0.);
            ctx.beginPath();
            ctx.moveTo(PX(x), PY(y));
            ctx.lineTo(PX(gx), PY(gy));
            ctx.moveTo(PX(gx), PY(gy));
            ctx.lineTo(PX(gx + 15 * Math.cos(ang-Math.PI*0.75)), PY(gy + 15 * Math.sin(ang-Math.PI*0.75)));
            ctx.moveTo(PX(gx), PY(gy));
            ctx.lineTo(PX(gx + 15 * Math.cos(ang+Math.PI*0.75)), PY(gy + 15 * Math.sin(ang+Math.PI*0.75)));
            ctx.stroke();
            ctx.globalAlpha /= 2;
            ctx.lineWidth = 1;
            ctx.globalAlpha *= 2.5;
        }
        let R = PSZ(r);
        ctx.drawImage(moveRangeImg, PX(x)-R, PY(y)-R, R*2, R*2);
        ctx.globalAlpha = oa;
    }

    let drawBombRange = (x, y, r, alpha, ice) => {
        let oa = ctx.globalAlpha;
        ctx.globalAlpha = alpha * (0.075 + 0.025 * Math.sin(Time()*Math.PI/1.5)) * 1.5;
        let R = PSZ(r);
        ctx.drawImage(ice ? iBombRangeImg : bombRangeImg, PX(x)-R, PY(y)-R, R*2, R*2);
        ctx.globalAlpha *= 1.25;
        let R2 = ((Math.floor(Time()*1000) % 1000) / 1000.) * R;
        ctx.drawImage(ice ? iBombRangeImg : bombRangeImg, PX(x)-R2, PY(y)-R2, R2*2, R2*2);
        ctx.globalAlpha = oa;
    }

    let drawPlayer = (x, y, att, hp) => {

        if (hp === undefined) {
            hp = 100;
        }

        hp = Math.max(0, Math.min(1, hp / 100));

        y += Math.sin(Time() * Math.PI) * 0.5;

        let oa = ctx.globalAlpha;
        ctx.globalAlpha *= Math.pow(hp, 0.05);

        let IR = PSZ(15);
        ctx.drawImage(playerImg, PX(x)-IR, PY(y)-IR, IR*2, IR*2);

        ctx.fillStyle = ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.;

        let limbs = [
            {x: PX(x)+IR*0.25, y: PY(y)-IR*0.25, r: IR*0.8, att: att[0] },
            {x: PX(x)-IR*0.25, y: PY(y)-IR*0.25, r: IR*0.8, att: att[1] },
            {x: PX(x)+IR*0.05, y: PY(y)+IR*0.2, r: IR*1.05, att: att[2] },
            {x: PX(x)-IR*0.05, y: PY(y)+IR*0.2, r: IR*1.05, att: att[3] }
        ];

        for (let i=0; i<limbs.length; i++) {
            let L = limbs[i];
            ctx.beginPath();
            ctx.moveTo(L.x, L.y);
            let AX = PX(L.att ? L.att.x : L.x), AY = PY(L.att ? L.att.y : L.y);
            let ATR = PSZ(L.att ? L.att.r : L.r);
            let dx = AX - L.x, dy = AY - L.y;
            let dist = Math.max(0.1, Math.sqrt(dx*dx+dy*dy));
            dx /= dist; dy /= dist;

            if (i>=2 && dy < 0) {
                dy = -dy;
            }
            if (((i%2) && dx > 0) || (!(i%2) && dx < 0)) {
                dx = -dx * 0.5;
            }

            if (Math.abs(dx) < 0.2) {
                if (!(i%2)) {
                    dx = 0.2;
                }
                else {
                    dx = -0.2;
                }
            }

            let x2 = L.x + dx * L.r,
                y2 = L.y + dy * L.r;

            ctx.lineTo(
                x2, y2
            );
            ctx.stroke();
        }

        ctx.lineWidth = 1.;
        ctx.globalAlpha = oa;

    };

    let tWasDown = false, SPCWasDown = false, tdWasDown = false;
    let numBombs = 0;
    let numIceBombs = 0;
    let numGems = 0;
    let useBombType = 0;
    let gotoLevelT = 0;
    let gotoLevel = false;
    let fadeIn = true;
    let fadeInT = 0;
    let deathFade = false;
    let deathFadeT = 0.;

    let lastMove = Time();

    const afterLoadInit = () => {
        if (inMenu) {
            tinyxhr(parseInt(window.localStorage.getItem('lastLevelCleared') || 0) > 15 ? "lvl/menu-cleared.json" : "lvl/menu.json", (err,data,xhr) => {
                loadLevel(JSON.parse(data));
                gotoLevel = false;
                gotoLevelT = 0;
                fadeIn = true;
                fadeInT = 0;
                renderFrame();
            });
            return;
        }
        if (tester) {
            loadLevel(JSON.parse(window.localStorage.getItem('editorTestLevel')));
        }
        if (false) {
            let ctmp = document.createElement('canvas');
            ctmp.width = lightManImg.width;
            ctmp.height = lightManImg.height;
            let ctxtmp = ctmp.getContext('2d');
            ctxtmp.drawImage(lightManImg, 0, 0, lightManImg.width, lightManImg.height);
            let tmpData = ctxtmp.getImageData(0, 0, ctmp.width, ctmp.height).data;
            for (let i=0; i<tmpData.length; i+=4) {
                let alpha = tmpData[i+3] / 255.;
                let heat = 0.;//Math.pow(alpha * tmpData[i+0] / 255., 4.0);
                if (alpha > 0.5) {
                    let j = Math.floor(i/4);
                    let x = j % lightManImg.width;
                    let y = (j - x) / lightManImg.width;
                    if ((x%2)||!(y%2)) {
                        continue;
                    }
                    x *= 2;
                    y *= 2;
                    let type = 2;
                    setTimeout(((x,y,type,heat) => {
                        return () => {
                            prtPos = addParticleStep1(
                                prtPos, prtAttr,
                                x, y, type, heat
                            );
                            prtVel = addParticleStep2(
                                prtPos, prtVel, prtAttr,
                                x, y, type, heat, 0.0
                            );
                            prtAttr = addParticleStep3(
                                prtPos, prtAttr,
                                x, y, type, heat
                            );
                        }
                    })(x,y,type,heat), Math.random() * 20000+1);
                    console.log(x, y);
                }
            }
        }
        renderFrame();
    };

    let lastHover = -1;
    let musicTempo = 0.75 + Math.random() * 0.5;
    let lastBomb = 0;

    function updateFluidSfx() {
        let slist = [];

        if (Math.random() < 0.25) {
            fsCache = sampleLiquidSoundInfo(inMenu ? (player.x*0.25 + pickUps[0].x*0.75) : player.x, inMenu ? (player.y*0.25 + pickUps[0].y*0.75) : player.y, prtPos, prtVel, lPrtVel, prtAttr, canvas2);
        }
        for (let x=-8; x<=8; x++) {
            for (let y=-8; y<=8; y++) {
                let xx = x + 8, yy = y + 8;
                let o = (xx + yy * 17) * 3;
                let ret = [ fsCache[o] || 0, fsCache[o+1] || 0, fsCache[o+2] || 0 ];
                let vol = 0.5 * Math.pow(ret[0]*Math.max(0., (ret[1]-10)*2), 0.2) / ((1+x*x+y*y)*0.2);
                let freq = 0.5 + Math.pow(Math.max(0., (ret[1]-10)*2), 0.05) * (vol * 0.2 + 0.8);
                slist.push({vol, freq, w: 0.5 + vol * (0.5 + Math.abs(freq - 1)), type: ret[2], x: x/3});
            }
        }
        slist.sort((a,b)=>(b.w - a.w));
        let slW = [], slL = [], slB = [];
        for (let i=0; i<slist.length; i++) {
            if (slist[i].type === 0) {
                slW.push(slist[i]);
            }
            else if (slist[i].type === 1) {
                slL.push(slist[i]);
            }
            else if (slist[i].type === 4) {
                slB.push(slist[i]);
            }
        }
        for (let i=0; i<fluidSoundsW.length; i++) {
            if (i < slW.length) {
                fluidSoundsW[i].update(slW[i].vol, slW[i].freq * (1. - player.floating*2) * 0.5, slW[i].x);
            }
            else {
                fluidSoundsW[i].update(0., 0.5, 0.);
            }
        }
        for (let i=0; i<fluidSoundsL.length; i++) {
            if (i < slL.length) {
                fluidSoundsL[i].update(slL[i].vol * 0.35, slL[i].freq * (1. - player.floating*2) * 0.25, slL[i].x);
            }
            else {
                fluidSoundsL[i].update(0., 0.25, 0.);
            }
        }
        for (let i=0; i<fluidSoundsB.length; i++) {
            if (i < slB.length) {
                fluidSoundsB[i].update(slB[i].vol * 0.5, slB[i].freq * (1. - player.floating*2) * 0.25, slB[i].x);
            }
            else {
                fluidSoundsB[i].update(0., 0.25, 0.);
            }
        }
    }

    function tickMusic() {
        if (player.ascended && !inMenu) {
            musicTempo += (4. - musicTempo) * dt * 4;
        }
        musicTime += dt * musicTempo;
        if (!soundInit) {
            return;
        }
        if (Math.floor(musicTime) !== Math.floor(musicTime-dt*musicTempo)) {
            if (Math.random() < 0.5) {
                let r = Math.random() * 200 + 100;
                let a = Math.random() * Math.PI * 2;
                let dx = Math.cos(a) * r, dy = Math.sin(a) * r;
                AUDIO.playSound2d('note'+Math.floor(1 + (Math.floor(musicTime*3) % 7)), (inMenu ? mouseGX : player.x)+dx, (inMenu ? mouseGY : player.y)+dy, inMenu ? mouseGX : player.x, inMenu ? mouseGY : player.y, 40. + musicTempo * 5., (2.0 + (Math.random() < 0.75 ? 2.0 : 0.))*0.25);
            }
        }
        if (Math.floor(musicTime/3) !== Math.floor((musicTime-dt*musicTempo)/3)) {
            if (Math.random() < 0.5) {
                let r = Math.random() * 200 + 100;
                let a = Math.random() * Math.PI * 2;
                let dx = Math.cos(a) * r, dy = Math.sin(a) * r;
                AUDIO.playSound2d('note'+Math.floor(1 + (Math.floor(musicTime*3) % 7)), (inMenu ? mouseGX : player.x)+dx, (inMenu ? mouseGY : player.y)+dy, inMenu ? mouseGX : player.x, inMenu ? mouseGY : player.y, 40. + musicTempo * 5., 1.0*0.25);
            }
        }
    }

    let levelToLoad = -1, currentLevel = 0;

    function renderFrame () {

        if (!rockTexture) {
            rockTexture = copyTexture(rockTexImg);
        }

        setTimeout(renderFrame, 1000/60);

        dt = 1/60;

        lTime = Time();

        let aspect = window.innerWidth / window.innerHeight;

        H = canvas.height = Math.min(window.innerHeight, 1024);
        W = canvas.width = H * aspect;

        ctx.fillStyle = '#040404';
        ctx.fillRect(0, 0, W, H);

        ctx.globalAlpha = 1.0;
        ctx.drawImage(gameBgImg, PX(-17), PY(-17), H+PSZ(34), H+PSZ(34));

        lPrtVel = copyAR2(prtVel);
        prtVel = updateVelocities(prtPos, prtVel, prtAttr, canvas2, dt, player.x, player.y);
        prtAttr = updateAttributes(prtAttr, prtPos, prtVel, canvas2, airHeatMap, dt);
        prtPos = updatePositions(prtPos, prtVel, dt);
        airHeatMap = updateAirHeatMap(airHeatMap, canvas2, prtPos, prtVel, prtAttr, dt);
        hash.update(prtPos, prtAttr);

        for (let i=0; i<pipes.length; i++) {
            let P = pipes[i];
            let PR = PSZ(P.r) * 1.1;
            ctx.drawImage(P.bio ? pipeBioImg : P.water ? pipeWaterImg : pipeLavaImg, PX(P.x) - PR, PY(P.y) - PR, PR*2, PR*2);
            addParticles(P.x, P.y + P.r * 0.25, P.r * 0.2, P.bio ? 4 : P.water ? 0 : 1, 0., true);
        }

        if (!editor) {
            if (numBombs === 0 && numIceBombs > 0) {
                useBombType = 1;
            }
            else if (numIceBombs === 0 && numBombs > 0) {
                useBombType = 0;
            }
            else if (NumDown[1] && numBombs > 0) {
                useBombType = 0;
            }
            else if (NumDown[2] && numIceBombs > 0) {
                useBombType = 1;
            }
        }

        for (let i=0; i<pickUps.length; i++) {
            let P = pickUps[i];
            if (!P.picked) {
                let dx = P.x - player.x, dy = P.y - player.y;
                let dist = Math.sqrt(dx*dx+dy*dy);
                if (dist < (P.r+5)) {
                    P.picked = true;
                    P.t = 1.0;
                    if (P.bomb) {
                        if (P.iceBomb) {
                            numIceBombs += 1;
                        }
                        else {
                            numBombs += 1;
                        }
                        AUDIO.playSound('get-bomb', 1.5, 1.5);
                    }
                    else {
                        AUDIO.playSound('note5', 0.5, 1.0);
                        AUDIO.playSound('note6', 0.5, 2.0);
                        AUDIO.playSound('note7', 0.5, 4.0);
                        numGems += 1;
                    }
                }
            }
            if (P.t > 0.01) {
                let PR = PSZ(P.r) * (1.05 + Math.sin(Time() * Math.PI) * 0.05) / Math.min(1, P.t * 0.5 + 0.5);
                ctx.globalAlpha = Math.pow(P.t, 1.0);
                let star = parseInt(window.localStorage.getItem('lastLevelCleared') || 0) > 15 && inMenu;
                if (star) {
                    PR *= 1.6;
                }
                ctx.drawImage(star ? starImg : P.iceBomb ? iBombPickUpImg : P.bomb ? bombPickUpImg : gemImg, PX(P.x) - PR, PY(P.y*Math.pow(P.t, 0.25) - 2.5 + Math.sin(Time() * Math.PI) * 2.5) - PR, PR*2, PR*2);
                ctx.globalAlpha = 1.0;
            }
            if (P.picked) {
                P.t -= dt * 3;
            }
        }

        for (let i=0; i<enemies.length; i++) {
            let E = enemies[i];
            E.animT = E.animT || 0;
            if (!E.dead) {
                let dx = E.x - player.x, dy = E.y - player.y;
                let dist = Math.sqrt(dx*dx+dy*dy);
                if (dist < (E.r+5) && !player.ascended) {
                    player.hp = 0;
                }
                let R = PSZ(E.r) * (1.25 + 0.125*0.5 + 0.5*0.125 * Math.sin(2 * E.animT * Math.PI + E.x + E.y));
                let maxt = E.boss ? 10. : 5.;
                if (dist < (((E.boss ? 30 : 22.5) * 8)+80) && !editor) {
                    E.t += dt;
                    if (E.t >= maxt) {
                        E.t -= maxt;
                        let dx2 = -dx / dist, dy2 = -dy / dist;
                        fiballs.push({
                            ice: E.boss,
                            r: (E.boss ? 25. : 15.0) * 0.6,
                            x: E.x, y: E.y,
                            vx: dx2 * (E.boss ? 25 : 15) * 5,
                            vy: dy2 * (E.boss ? 25 : 15) * 5,
                            t: (E.boss ? 4 : 2) * 3,
                            trail: []
                        });
                        AUDIO.playSound2d('explosion', E.x, E.y, player.x, player.y, 50., E.boss ? 2.0 : 4.0);
                    }
                }
                else {
                    E.t -= dt;
                    if (E.t <= 0) {
                        E.t = 0.;
                    }
                }
                let t = E.t / maxt;
                E.animT += (1 + t * 5) * dt;
                let rx = (Math.random() * 2 - 1) / Math.max(0.5, E.hp);
                let ry = (Math.random() * 2 - 1) / Math.max(0.5, E.hp);
                ctx.drawImage(E.boss ? bossNormalImg : enemyNormalImg, PX(E.x)-R+rx, PY(E.y)-R+ry, R*2, R*2);
                ctx.globalAlpha = Math.pow(t, 2.0);
                ctx.drawImage(E.boss ? bossFireImg : enemyFireImg, PX(E.x)-R+rx, PY(E.y)-R+ry, R*2, R*2);
                ctx.globalAlpha = 1.0;
                if (E.hp <= 0) {
                    E.dead = true;
                }
            }
            else {
                E.deathT += dt * (E.boss ? 0.25 : 1.0);
                if (E.deathT < 1) {
                    if (Math.random() < 1/15) {
                        AUDIO.playSound2d('explosion', E.x, E.y, player.x, player.y, 50. * (E.boss ? 2 : 1), (E.boss ? 2.0 : 4.0) * (0.25 + Math.random() * 0.25));
                    }
                    let R = PSZ(E.r) * 1.25;
                    let t = 0.;
                    let rx = (Math.random() * 2 - 1) / Math.max(0.5, E.hp);
                    let ry = (Math.random() * 2 - 1) / Math.max(0.5, E.hp);
                    ctx.globalAlpha = (1. - E.deathT);
                    ctx.drawImage(E.boss ? bossNormalImg : enemyNormalImg, PX(E.x)-R+rx, PY(E.y)-R+ry, R*2, R*2);
                    ctx.globalAlpha = Math.pow(t, 0.5) * (1. - E.deathT);
                    ctx.drawImage(E.boss ? bossFireImg : enemyFireImg, PX(E.x)-R+rx, PY(E.y)-R+ry, R*2, R*2);
                    ctx.globalAlpha = Math.pow(E.deathT, 0.25) * Math.pow(1. - E.deathT, 0.1);
                    ctx.drawImage(E.boss ? bossDieImg : enemyDieImg, PX(E.x)-R+rx, PY(E.y)-R+ry, R*2, R*2);
                    ctx.globalAlpha = 1.0;
                }
                else {
                    AUDIO.playSound2d('explosion', E.x, E.y, player.x, player.y, 50. * (E.boss ? 3 : 1.5), (E.boss ? 2.0 : 4.0) * (0.25 + Math.random() * 0.25));
                    enemies.splice(i, 1);
                    i --;
                    continue;
                }
            }
        }

        for (let i=0; i<fiballs.length; i++) {
            const F = fiballs[i];
            F.t -= dt;
            if (F.t <= 0.) {
                fiballs.splice(i, 1);
                i--;
                continue;
            }
            F.trail.push({x: F.x, y: F.y, t:Math.pow(Math.min(1, F.t), 0.5)*Math.random(), r: F.r});
            F.x += F.vx * dt;
            F.y += F.vy * dt;
            if (F.x < F.r && F.vx < 0)  {
                F.vx = -F.vx;
            }
            else if (F.x > (GSZ-F.r) && F.vx > 0) {
                F.vx = -F.vx;
            }
            if (F.y < F.r && F.vy < 0)  {
                F.vy = -F.vy;
            }
            else if (F.y > (GSZ-F.r) && F.vy > 0) {
                F.vy = -F.vy;
            }
            let R = PSZ(F.r) * 1.25;
            for (let j=0; j<F.trail.length; j++) {
                const FT = F.trail[j];
                FT.t -= dt;
                if (FT.t <= 0.) {
                    F.trail.splice(j, 1);
                    j--;
                    continue;
                }
                let FTR = PSZ(FT.r * FT.t) * 1.25;
                ctx.globalAlpha = Math.pow(Math.min(1, FT.t), 2.0) * 0.75;
                ctx.drawImage(F.ice ? iceBallImg : fireBallImg, PX(FT.x)-FTR, PY(FT.y)-FTR, FTR*2, FTR*2);
                ctx.globalAlpha = 1.0;
            }
            ctx.globalAlpha = Math.pow(Math.min(1, F.t), 0.5);
            ctx.drawImage(F.ice ? iceBallImg : fireBallImg, PX(F.x)-R, PY(F.y)-R, R*2, R*2);
            ctx.globalAlpha = 1.0;

            if (Math.random() < 0.25) {
                let _ret = collidePlayerClosest(F.x, F.y, prtPos, prtVel, prtAttr, canvas2);
                let ret = { x: _ret[0], y: _ret[1], type: _ret[2], heat: _ret[3], radius: _ret[4], vx: _ret[5], vy: _ret[6], dist: _ret[7] };
                let exp = false;
                if (ret.type >= 0 && ret.dist < (ret.radius + F.r)) {
                    exp = true;
                }
                else {
                    let dx = F.x - player.x, dy = F.y - player.y;
                    let dist = Math.sqrt(dx*dx+dy*dy);
                    if (dist < (F.r+5)) {
                        if (!player.ascended) {
                            player.hp = 0;
                        }
                        exp = true;
                    }
                }
                if (exp) {
                    AUDIO.playSound2d('explosion', F.x, F.y, player.x, player.y, F.ice ? 100 : 35, F.ice ? 0.5 : 1.5);
                    if (!F.ice) {
                        F.r *= 2.0;
                    }
                    else {
                        F.r *= 1.5;
                    }
                    deleteParticles(F.x, F.y, F.r, 2);
                    deleteParticles(F.x, F.y, F.r*0.5, 1);
                    deleteParticles(F.x, F.y, F.r*0.5, 0);
                    deleteParticles(F.x, F.y, F.r*0.5, 4);
                    if (F.ice) {
                        for (let k=0; k<32; k++) {
                            addParticles(F.x, F.y, 8, 4, 0);
                        }
                    }
                    else {
                        deleteParticles(F.x, F.y, F.r*0.75, 0);
                        for (let k=0; k<8; k++) {
                            addParticles(F.x, F.y, 8, 3, 1.5);
                        }
                    }
                    
                    for (let k=0; k<bombs.length; k++) {
                        let dx = bombs[k].x - F.x, dy = bombs[k].y - F.y;
                        let dist = Math.sqrt(dx*dx+dy*dy);
                        if (dist < (F.r*0.95 + F.r/5.5)) {
                            bombs[k].t = Math.min(bombs[k].t, 0.35);
                        }
                    }

                    fiballs.splice(i, 1);
                    i--;
                    continue;
                }
            }
        }

        if (levelExit) {
            let boss = null;
            for (let i=0; i<enemies.length; i++) {
                if (enemies[i].boss) {
                    boss = enemies[i];
                }
            }

            let ER = PSZ(levelExit.r);
            ctx.globalAlpha = boss ? (initEditor ? (boss.deathT*0.9+0.1) : boss.deathT) : 1;
            ctx.drawImage(exit1Img, PX(levelExit.x) - ER, PY(levelExit.y) - ER, ER*2, ER*2);
            levelExit.t += dt * Math.PI;
            ctx.globalAlpha = (0.5 + 0.5 * Math.sin(levelExit.t)) * (boss ? (boss.deathT) : 1);
            ctx.drawImage(exit2Img, PX(levelExit.x) - ER, PY(levelExit.y) - ER, ER*2, ER*2);
            ctx.globalAlpha = 1.0;

            if (player.hp > 0 && !player.ascended && !inMenu && !boss) {
                let dx = levelExit.x - player.x, dy = levelExit.y - player.y;
                let dist = Math.sqrt(dx*dx+dy*dy);
                if (dist < levelExit.r * 0.8) {
                    player.ascended = true;
                    player.ascendT = 1.0;
                    AUDIO.playSound('note1', 1.15, 0.5, 0.0);
                    AUDIO.playSound('note2', 1.15, 0.5, 0.5);
                    AUDIO.playSound('note3', 1.15, 1.0, 1.0);
                    AUDIO.playSound('note4', 1.15, 1.0, 1.5);
                    AUDIO.playSound('note5', 1.15, 2.0, 2.0);
                }
            }
        }

        renderLayers(
            prtPos, prtAttr, canvas2,
            0.05, 0.1, 1., 0.85,                 8., 8., 8., 8.,
            1., 0.05, 0.01, 0.95,                8.,  2., 0.5, 8.,
            0.15*0.1, 0.14*0.1, 0.13*0.1, 0.99,  8., 8., 0.25, 2.,
            0.05, 0.5, 0.01, 0.95,               1.,  4., 0.5, 8.,
            rockTexture
        );
        ctx.drawImage(renderLayers.canvas, PX(0), PY(0), H, H);

        ctx.drawImage(gameBgOverImg, PX(-72), PY(-72), H+PSZ(144), H+PSZ(144));

        if (!inMenu) {
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.fillStyle = 'rgba(255, 255, 0, 0.05)';
            ctx.beginPath();
            ctx.rect(PX(8), PY(24), PSZ(128), PSZ(16));
            ctx.fill();
            ctx.beginPath();
            ctx.rect(PX(8), PY(24), PSZ(128*(1 - Math.max(0, Math.min(1, player.hp/100)))), PSZ(16));
            ctx.fillStyle = 'rgba(255, 48, 0, 0.95)';
            ctx.fill();
            ctx.beginPath();
            ctx.rect(PX(8), PY(24), PSZ(128), PSZ(16));
            ctx.stroke();
            ctx.beginPath();
        }

        drawPlayer(player.x, player.y, player.armAtts, player.hp);

        updateFluidSfx();
        tickMusic();

        for (let i=0; i<bombs.length; i++) {
            const B = bombs[i];
            B.t -= dt;
            if (Math.floor(B.t) !== Math.floor(B.t+dt) && B.t > 0) {
                AUDIO.playSound2d('get-bomb', B.x, B.y, player.x, player.y, 50., 4.0);
            }
            if (B.iceBomb && (B.t - dt * 10) <= 0) {
                for (let k=0; k<8; k++) {
                    addParticles(B.x, B.y, 8, 0, -1);
                }
            }
            if (B.t <= 0) {
                AUDIO.playSound2d('explosion', B.x, B.y, player.x, player.y, 50., B.iceBomb ? 1.5 : 1);
                deleteParticles(B.x, B.y, B.r, 2);
                deleteParticles(B.x, B.y, B.r*0.5, 1);
                if (B.iceBomb) {
                }
                else {
                    deleteParticles(B.x, B.y, B.r*0.75, 0);
                    for (let k=0; k<16; k++) {
                        addParticles(B.x, B.y, 8, 3, 1.5);
                    }
                }
                if (!B.iceBomb) {
                    for (let k=0; k<bombs.length; k++) {
                        if (k !== i) {
                            let dx = bombs[k].x - B.x, dy = bombs[k].y - B.y;
                            let dist = Math.sqrt(dx*dx+dy*dy);
                            if (dist < (B.r*0.95 + B.r/5.5)) {
                                bombs[k].t = Math.min(bombs[k].t, 0.35);
                            }
                        }
                    }
                    for (let k=0; k<enemies.length; k++) {
                        if (!enemies[k].dead) {
                            let dx = enemies[k].x - B.x, dy = enemies[k].y - B.y;
                            let dist = Math.sqrt(dx*dx+dy*dy);
                            if (dist < (B.r*1.25 + enemies[k].r)) {
                                enemies[k].hp -= 10.01;
                                enemies[k].t = 0.;
                            }
                        }
                    }
                    if (player.hp > 0) {
                        let dx = player.x - B.x, dy = player.y - B.y;
                        let dist = Math.sqrt(dx*dx+dy*dy);
                        if (dist < (B.r + 1)) {
                            player.hp = -1;
                        }
                    }
                }
                bombs.splice(i, 1);
                i --;
                continue;
            }
            if (B.t < 1) {
                B.aspeed += dt * 8.;
            }
            else {
                B.aspeed += dt * 2.;
            }
            B.anim += B.aspeed * dt * Math.PI;
            let a1 = Math.sin(B.anim) * 0.5 + 0.5;
            if (B.t < 0.25) {
                a1 = (0.25-B.t)/0.25 + (1. - (0.25-B.t)/0.25) * a1;
            }
            let RB = PSZ(B.r / 5) + 6 + 3 * a1;
            ctx.globalAlpha = 1.;
            ctx.drawImage(B.iceBomb ? iBombOffImg : bombOffImg, PX(B.x)-RB, PY(B.y)-RB, RB*2, RB*2);
            ctx.globalAlpha = a1;
            ctx.drawImage(B.iceBomb ? iBombOnImg : bombOnImg, PX(B.x)-RB, PY(B.y)-RB, RB*2, RB*2);
            if (B.t < 0.25) {
                ctx.globalAlpha = Math.pow((0.25-B.t)/0.25, 0.5);
                let R2 = Math.pow((0.25-B.t)/0.25, 2.0) * PSZ(B.r);
                ctx.drawImage(B.iceBomb ? iBombRangeImg : bombRangeImg, PX(B.x)-R2, PY(B.y)-R2, R2*2, R2*2);
                if (!B.iceBomb) {
                    addParticles(B.x, B.y, 8, 3, 1.5);
                }
                if (B.t < 0.125 && !B.iceBomb) {
                    addParticles(B.x, B.y, 8, 3, 1.5);
                }
            }
            ctx.globalAlpha = 1.;
        }

        if (editor && !inMenu) {
            if (NumWasDown[1] && !NumDown[1]) {
                player = initPlayerAt(mouseGX, mouseGY);
                setStandAtt(player);
                updateArmAtts(player);
            }
            if (NumWasDown[2] && !NumDown[2]) {
                levelExit.x = mouseGX;
                levelExit.y = mouseGY;
            }
            if (NumDown[3] || NumDown[4] || NumDown[5]) {
                if (!mouseLeft && pMouseLeft) {
                    pipes.push({
                        water: NumDown[3],
                        bio: NumDown[5] && !NumDown[3],
                        x: mouseGX, y: mouseGY,
                        r: 36
                    });
                }
                if (!mouseRight && pMouseRight) {
                    for (let i=0; i<pipes.length; i++) {
                        let dx = pipes[i].x - mouseGX, dy = pipes[i].y - mouseGY;
                        let dist = Math.sqrt(dx*dx+dy*dy);
                        if (dist < pipes[i].r) {
                            pipes.splice(i, 1);
                            i --;
                            continue;
                        }
                    }
                }
            }
            else if (NumDown[6] || NumDown[7] || NumDown[8]) {
                if (!mouseLeft && pMouseLeft) {
                    pickUps.push({
                        bomb: NumDown[6] || NumDown[7],
                        iceBomb: NumDown[7],
                        x: mouseGX, y: mouseGY,
                        r: 18,
                        picked: false,
                        t: 1
                    });
                }
                if (!mouseRight && pMouseRight) {
                    for (let i=0; i<pickUps.length; i++) {
                        let dx = pickUps[i].x - mouseGX, dy = pickUps[i].y - mouseGY;
                        let dist = Math.sqrt(dx*dx+dy*dy);
                        if (dist < pickUps[i].r) {
                            pickUps.splice(i, 1);
                            i --;
                            continue;
                        }
                    }
                }
            }
            else if (NumDown[9] || NumDown[0]) {
                if (!mouseLeft && pMouseLeft) {
                    enemies.push({
                        boss: NumDown[0],
                        x: mouseGX, y: mouseGY,
                        r: NumDown[0] ? 70 : 22.5,
                        hp: NumDown[0] ? 40 : 10,
                        t: 0,
                        dead: false,
                        deathT: 0
                    })
                }
                if (!mouseRight && pMouseRight) {
                    for (let i=0; i<enemies.length; i++) {
                        let dx = enemies[i].x - mouseGX, dy = enemies[i].y - mouseGY;
                        let dist = Math.sqrt(dx*dx+dy*dy);
                        if (dist < enemies[i].r) {
                            enemies.splice(i, 1);
                            i --;
                            continue;
                        }
                    }
                }
            }
            else if (mouseLeft) {
                let type = 2;
                let heat = 0.;
                if (WDown || IDown) {
                    type = 0;
                    if (IDown) {
                        heat = -1.;
                    }
                }
                else if (EDown) {
                    type = 1;
                }
                else if (ADown) {
                    type = 4;
                }
                else if (SDown) {
                    heat = 1.;
                }
                addParticles(mouseGX, mouseGY, SDown ? 1 : 4, type, heat, type === 0 || type === 1 || type === 4);
            }
            else if (mouseRight) {
                let type = 2;
                if (WDown || IDown) {
                    type = 0;
                }
                else if (EDown) {
                    type = 1;
                }
                else if (ADown) {
                    type = 4;
                }
                deleteParticles(mouseGX, mouseGY, 12, type);
            }
        }
        else if (!inMenu) {

            if (player.hp <= 0 && !player.ascended) {
                player.canMove = false;
                player.vx = player.vy = 0;
                if (!player.exp) {
                    for (let k=0; k<16; k++) {
                        addParticles(player.x, player.y, 4, 3, 1.5);
                    }
                    AUDIO.playSound('hurt-die', 1.25, 1.1);
                }
                player.exp = true;
            }
            else if (player.ascended) {
                player.hp = Math.max(player.hp, 1);
                player.moveTime = 0;
                player.moveToX = player.x;
                player.moveToY = player.y;
                player.canMove = false;
                player.vx = player.vy = 0;
                player.ascendT -= dt / 3.;
                if (player.ascendT < 0) {
                    player.ascendT = 0;
                }
            }

            if (player.y > GSZ) {
                player.hp -= 100 * dt * 2;
            }

            for (let i=0; i<player.oldPos.length; i++) {
                const P = player.oldPos[i];
                P.t -= dt * 2;
                if (P.t <= 0) {
                    player.oldPos.splice(i, 1);
                    i --;
                    continue;
                }
                else {
                    ctx.globalAlpha = P.t;
                    drawPlayer(P.x, P.y, player.armAtts, player.hp);
                    ctx.globalAlpha = 1.0;
                }
            }

            if (player.moveTime <= 0) {
                if (player.canMove) {
                    let range = player.floating > 0.25 ? 64 : 128;
                    drawMoveRange(player.x, player.y, range, 1.0);
                    if (numBombs > 0 && useBombType === 0) {
                        drawBombRange(player.x, player.y, 50, 1.0);
                        if (SPCWasDown && !SPCDown && (Time() - lastBomb) > 0.5) {
                            lastBomb = Time();
                            AUDIO.playSound('get-bomb', 1.5, 2.0);
                            bombs.push({
                                x: player.x,
                                y: player.y,
                                r: 50,
                                t: 5,
                                aspeed: 1,
                                anim: 0
                            });
                            numBombs -= 1;
                        }
                    }
                    else if (numIceBombs > 0 && useBombType === 1) {
                        drawBombRange(player.x, player.y, 50, 1.0, true);
                        if (SPCWasDown && !SPCDown) {
                            AUDIO.playSound('get-bomb', 1.5, 2.0);
                            bombs.push({
                                x: player.x,
                                y: player.y,
                                r: 50,
                                t: 5,
                                iceBomb: true,
                                aspeed: 1,
                                anim: 0
                            });
                            numIceBombs -= 1;
                        }
                    }

                    let ox = Math.random()*5-2.5, oy = Math.random()*5-2.5;
                    let X = {
                        x: player.x+ox, y: player.y+oy,
                        attachedTo: {...player.attachedTo, x: player.attachedTo.x+ox, y: player.attachedTo.y+oy},
                        armAtts: [...player.armAtts],
                        t: 0.2
                    }
                    player.oldPos.push(X);

                    let dx = mouseGX - player.x, dy = mouseGY - player.y;
                    let dist = Math.sqrt(dx*dx+dy*dy);
                    if (dist <= range && mouseGX >= 0 && mouseGY >= 0 && mouseGX < GSZ && mouseGY < GSZ) {
                        if (!mouseLeft && pMouseLeft && (Time()-0.1) > lastMove) {
                            lastMove = Time();
                            AUDIO.playSound('move', 0.5);
                            player.moveToX = mouseGX + (mouseGX - player.x) * 0.05;
                            player.moveToY = mouseGY + (mouseGY - player.y) * 0.05;
                            player.moveTime = (dist / range) * 0.75;
                            player.tMoveTime = player.moveTime;
                            player.canMove = false;
                        }
                    }
                }
            }
            else {
                let range = player.floating > 0.25 ? 64 : 128;
                let t = Math.pow(player.moveTime / player.tMoveTime, 2.0);
                if (player.canMove) {
                    drawMoveRange(player.x, player.y, range, 1. - Math.pow(t, 0.5));
                }
                player.oldPos.push({
                    x: player.x, y: player.y,
                    attachedTo: {...player.attachedTo},
                    armAtts: [...player.armAtts],
                    t: 0.5
                });
                player.moveTime -= dt;
                if (player.moveTime < 0.) {
                    player.moveTime = 0;
                }
                player.x = player.x * t + player.moveToX * (1-t);
                player.y = player.y * t + player.moveToY * (1-t);
                let tmp = setMoveAtt({x: player.moveToX, y: player.moveToY, attachedTo: null}, player.x, player.y);
                player.attachedTo.x = player.attachedTo.x * t + tmp.attachedTo.x * (1-t);
                player.attachedTo.y = player.attachedTo.y * t + tmp.attachedTo.y * (1-t);
            }

            let _ret = collidePlayerClosest(player.x, player.y, prtPos, prtVel, prtAttr, canvas2);
            let ret = { x: _ret[0], y: _ret[1], type: _ret[2], heat: _ret[3], radius: _ret[4], vx: _ret[5], vy: _ret[6], dist: _ret[7] };
            let liquidCountNear = countTypeNear(ret.x, ret.y, 20, ret.type, prtPos, prtAttr);
            if (player.hp <= 0 || ((ret.type === 0 || ret.type === 1 || ret.type === 4) && liquidCountNear < 4)) {
                ret.type = -1;
            }
            if (ret.type === 0 && ret.heat < -0.5) {
                ret.type = 2;
                ret.heat = 0;
            }
            if (ret.type === 1 && ret.heat < -0.75) {
                ret.type = 2;
                ret.heat = 0;
            }
            if (ret.type === 2 && ret.heat > 0.5 && ret.dist < 20) {
                ret.type = -1;
                let dx = ret.x - player.x, dy = ret.y - player.y;
                let dlen = Math.sqrt(dx*dx+dy*dy);
                dx /= dlen; dy /= dlen;
                player.vx -= dx * 32;
                player.vy -= dy * 32;
                player.moveTime = 0.;
                player.hp -= 10;
                AUDIO.playSound('hurt-die', 0.5, 1.25);
            }
            if (ret.type === 2) {
                let mdx = player.moveToX - player.x, mdy = player.moveToY - player.y;
                let mdlen = Math.sqrt(mdx*mdx+mdy*mdy);
                mdx /= mdlen; mdy /= mdlen;
                let dx = ret.x - player.x, dy = ret.y - player.y;
                let dlen = Math.sqrt(dx*dx+dy*dy);
                dx /= dlen; dy /= dlen;
                let ddx = dx - mdx, ddy = dy - mdy;
                let ddlen = Math.sqrt(ddx*ddx+ddy*ddy);
                if ((ddlen < 1.414 || player.floating > 0.25) && (ret.dist*0.25 < ret.radius)) {
                    player.x = ret.x - dx * ret.radius * 5.0;
                    player.y = ret.y - dy * ret.radius * 5.0;
                    player.moveToX = player.x;
                    player.moveToY = player.y;
                    player.vx -= player.vx * dt * 8;
                    player.vy -= player.vy * dt * 8;
                    player.moveTime = 0.;
                }
            }
            player.isHanging = false;
            if (player.moveTime <= 0 || (player.tMoveTime - player.moveTime) > 0.1) {
                if (ret.type === 2 && ret.dist < (15+ret.radius*1.5)) {
                    if (player.floating > 0.25) {
                        let F = Math.max(0, Math.pow(1. - (ret.dist / (ret.radius * 1.5)), 0.5));
                        if (F > 0) {
                            player.vx += 16 * F * (player.x - ret.x) / ret.dist;
                            player.vy += 16 * F * (player.y - ret.y) / ret.dist;
                        }
                    }
                    else if (!player.isHanging) {
                        if (!player.canMove && !player.ascended && player.hp > 0) {
                            AUDIO.playSound('grab', 1.5);
                        }
                        player.isHanging = true;
                        player.moveTime -= dt * 8;
                        player.moveToX = player.x;
                        player.moveToY = player.y;
                        player.attachedTo = { x: ret.x, y: ret.y, r: ret.radius*1.5 };
                        player.vy *= 0.5;
                        player.vx *= 0.5;
                        player.canMove = true;
                        updateArmAtts(player);
                    }
                }
            }
            if ((ret.type === 0 || ret.type === 1 || ret.type === 4) && liquidCountNear >= 4) {
                player.floating += dt * 4;
                if (player.floating > 0.45) {
                    player.isHanging = false;
                    player.inWater = true;
                    player.canMove = true;
                    player.floating = 1.0;
                    player.oldPos.push({
                        x: player.x, y: player.y,
                        attachedTo: {...player.attachedTo},
                        armAtts: [...player.armAtts],
                        t: 0.5
                    });
                    let F = Math.max(0, Math.pow(1. - (ret.dist / (ret.radius * 1.5)), 0.5));
                    if (F > 0) {
                        player.vx += 1 * F * (player.x - ret.x) / ret.dist + ret.vx * dt * 1.5;
                        player.vy += 1 * F * (player.y - ret.y) / ret.dist + ret.vy * dt * 1.5;
                        player.vy -= 150 * dt;
                    }
                    if (ret.type === 1 || ret.type === 4) {
                        player.hp -= 100 * dt;
                        if (Math.random() < 0.2) {
                            AUDIO.playSound('hurt-die', 0.25, 1.25);
                        }
                    }
                }
                player.vx *= 0.995;
                if (player.vy > 0) {
                    player.vy *= 0.95;
                }
            }
            else {
                player.floating -= dt * 2.0;
            }
            if (player.floating > 0.5) {
                player.floating = 0.5;
            }
            else if (player.floating < 0) {
                player.floating = 0;
            }
            if (!player.isHanging && player.moveTime <= 0) {
                player.vy += 100 * dt;
                player.vy *= 0.995;
                player.vx *= 0.995;
                player.y += player.vy * dt;
                player.x += player.vx * dt;
            }
        }

        if (!inMenu) {
            if (numBombs > 0 || numIceBombs > 0) {
                let x = 0, y = 0;
                let R = PSZ(24);
                x = -55;
                y = 24 * 1.5;
                for (let i=0; i<numBombs; i++) {
                    ctx.drawImage(bombPickUpImg, PX(x)-R, PY(y)-R, R*2, R*2);
                    if (useBombType === 0 && i === (numBombs-1)) {
                        ctx.strokeStyle = 'rgba(255, 255, 32, 0.75)';
                        ctx.lineWidth = 2.;
                        ctx.strokeRect(PX(x)-R, PY(y)-R, R*2, R*2);
                        ctx.lineWidth = 1.;
                    }
                    y += R * 1.25
                }
                y += R * 1.25;
                for (let i=0; i<numIceBombs; i++) {
                    ctx.drawImage(iBombPickUpImg, PX(x)-R, PY(y)-R, R*2, R*2);
                    if (useBombType === 1 && i === (numIceBombs-1)) {
                        ctx.strokeStyle = 'rgba(32, 192, 255, 0.75)';
                        ctx.lineWidth = 2.;
                        ctx.strokeRect(PX(x)-R, PY(y)-R, R*2, R*2);
                        ctx.lineWidth = 1.;
                    }
                    y += R * 1.25
                }
            }

            if (numGems > 0 || pickUps.length > 0) {
                let x = 0, y = 0;
                let R = PSZ(24);
                x = GSZ + 55;
                y = 24 * 1.5;
                for (let i=0; i<numGems; i++) {
                    ctx.drawImage(gemImg, PX(x)-R, PY(y)-R, R*2, R*2);
                    y += R * 1.25
                }
                ctx.globalAlpha = 0.75;
                for (let i=0; i<pickUps.length; i++) {
                    if (!pickUps[i].bomb && !pickUps[i].picked) {
                        ctx.drawImage(gemNGImg, PX(x)-R, PY(y)-R, R*2, R*2);
                        y += R * 1.25
                    }
                }
                ctx.globalAlpha = 1.0;
            }
        }

        if (inMenu) {
            ctx.drawImage(menuGradImg, 0, 0, W, H);
            ctx.drawImage(lightManImg, PX(0), PY(0), H, H);
            ctx.globalAlpha = 0.5 + Math.sin(Time() * Math.PI / 4 * musicTempo) * 0.5;
            ctx.drawImage(lightManImg, PX(0), PY(0), H, H);
            ctx.globalAlpha = 1.;

            let tHover = -1;

            let lastLevelCleared = parseInt(window.localStorage.getItem('lastLevelCleared') || 0);

            for (let i=0; i<Math.min(16, lastLevelCleared+2); i++) {
                let disabled = i > lastLevelCleared || gotoLevel || (fadeInT < 0.05);
                let current = i === lastLevelCleared;
                let r = (GSZ/10) * 0.45;
                let isBoss = (i+1) === 16;
                let IR = PSZ(r);
                let y = GSZ * 0.5 + Math.floor(i/4) * IR * 2.1;
                let x = GSZ * 0.5 + ((i%4)-1.5-0.125) * IR * 2.25;
                let dist = Math.sqrt(Math.pow(x-mouseGX,2) + Math.pow(y-mouseGY,2));
                let hover = false;
                if (!disabled && dist < (r * 0.8)) {
                    hover = true;
                    tHover = i;
                    if (!mouseLeft) {
                        IR *= 1.05;
                        if (pMouseLeft) {
                            AUDIO.playSound('click', 0.5);
                            gotoLevel = true;
                            gotoLevelT = 1.0;
                            levelToLoad = i+1;
                        }
                    }
                }
                IR *= (current ? 0.05 * Math.sin(Time() * Math.PI) : 0) + 1;
                let gemScore = 0;
                let totalGems = 0;
                IR = IR * (isBoss ? 1.5 : 1.);
                if (disabled) {
                    ctx.globalAlpha = 0.8;
                }
                else if (!current) {
                    gemScore = parseInt(window.localStorage.getItem('bestGemsL' + (i+1)) || 0);
                    totalGems = parseInt(window.localStorage.getItem('maxGemsL' + (i+1)) || 0);
                }
                if (disabled) {
                    ctx.drawImage(isBoss ? bossDisIconImg : levelDisIconImg, PX(x)-IR, PY(y)-IR, IR*2, IR*2);
                }
                else {
                    ctx.drawImage(isBoss ? (hover ? bossSelIconImg : bossIconImg) : (hover ? levelSelIconImg : levelIconImg), PX(x)-IR, PY(y)-IR, IR*2, IR*2);
                }
                if (!disabled && !current) {
                    ctx.drawImage(gemScore >= totalGems ? starImg : levelCheckIconImg, PX(x)-IR, PY(y)-IR+IR*0.125*Math.sin((Time()+i*0.5)*Math.PI/2), IR*2, IR*2);
                }
                ctx.globalAlpha = 0.75;
                for (let j=0; j<totalGems; j++) {
                    ctx.drawImage(j < gemScore ? gemImg : gemNGImg, PX(x) - IR*totalGems*0.5*0.15 + IR*0.15 * (j-0.5), PY(y) - IR, IR*0.3, IR*0.3);
                }
                ctx.globalAlpha = 1.0;
            }

            if (tHover >= 0 && lastHover !== tHover) {
                AUDIO.playSound('hover', 1.0);
            }

            lastHover = tHover;

        }

        /*let counts = countParticles(prtAttr);
        ctx.font = (H*0.02) + 'px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText(`water: ${counts[0]}, lava: ${counts[1]}, rock: ${counts[2]}, fire: ${counts[3]}, bio: ${counts[4]}`, H*0.05, H*0.1);*/

        if (!editor && player.ascended) {
            ctx.globalAlpha = 1. - player.ascendT;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = Math.pow(1. - player.ascendT, 6.0);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = 1.0;
        }
        if (gotoLevel) {
            gotoLevelT -= dt / 1.;
            if (gotoLevelT < 0 && levelToLoad > 0) {
                currentLevel = levelToLoad;
                tinyxhr("lvl/level-" + levelToLoad + ".json", (err,data,xhr) => {
                    loadLevel(JSON.parse(data));
                    inMenu = false;
                    gotoLevel = false;
                    gotoLevelT = 0;
                    fadeIn = true;
                    fadeInT = 0;
                });
                levelToLoad = -1;
                gotoLevelT = 0;
            }
            ctx.globalAlpha = 1. - gotoLevelT;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = Math.pow(1. - gotoLevelT, 6.0);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = 1.0;
        }
        if (fadeIn) {
            if (!initEditor && !tester && !soundInit) {
                fadeInT = 0.;
            }
            else {
                fadeInT += (1. - fadeInT) * dt * 4;
            }
            ctx.globalAlpha = 1. - fadeInT;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            if (!initEditor && !tester && !soundInit) {
                ctx.fillStyle = '#FFF';
                ctx.globalAlpha = Math.pow(1. - fadeInT, 3.);
                ctx.beginPath();
                let R = H*0.05;
                ctx.moveTo(W*0.5 - R, H*0.5 - R*0.75);
                ctx.lineTo(W*0.5 + R, H*0.5);
                ctx.lineTo(W*0.5 - R, H*0.5 + R*0.75);
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
        }
        if (!editor) {
            let odt = deathFadeT;
            if (player.hp <= 0.) {
                deathFadeT += (1. - deathFadeT) * dt * 2;
            }
            else {
                deathFadeT += (0. - deathFadeT) * dt * 4;
            }
            ctx.globalAlpha = deathFadeT;
            ctx.fillStyle = '#400';
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = Math.pow(deathFadeT, 6.0);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = 1.0;
            if (deathFadeT > 0.99 && odt <= 0.99) {
                loadLevel(JSON.parse(window.localStorage.getItem('curLevel')));
            }
        }

        pMouseLeft = mouseLeft;
        pMouseRight = mouseRight;

        if (tWasDown && !TDown && initEditor) {
            window.localStorage.setItem('editorTestLevel', serialize());
            window.open('test.html', '_blank');
            //editor = !editor;
        }
        if (((tdWasDown && !TDDown) || (player.ascendT <= 0.001 && player.ascended)) && (initEditor || !tester)) {
            if (editor) {
                window.localStorage.setItem('editorQTestLevel', serialize());
                loadLevel(JSON.parse(window.localStorage.getItem('editorQTestLevel')));
                editor = false;
            }
            else if (initEditor) {
                loadLevel(JSON.parse(window.localStorage.getItem('editorQTestLevel')));
                editor = true;
            }
            else if (player.ascended) {
                let lastLevelCleared = parseInt(window.localStorage.getItem('lastLevelCleared') || 0);
                lastLevelCleared = Math.max(lastLevelCleared, currentLevel);
                if (currentLevel > 15) {
                    AUDIO.playSound('note3', 1.25, 0.5*0.5, 0.0);
                    AUDIO.playSound('note4', 1.25, 0.5*0.5, 0.5);
                    AUDIO.playSound('note5', 1.25, 1.0*0.5, 1.0);
                    setTimeout(() => {
                        AUDIO.playSound('note7', 1.25, 0.5*1, 0.0);
                        AUDIO.playSound('note6', 1.25, 0.5*1, 0.5);
                        AUDIO.playSound('note5', 1.25, 1.0*1, 1.0);
                    }, 500);
                    setTimeout(() => {
                        AUDIO.playSound('note3', 1.25, 0.5*2, 0.0);
                        AUDIO.playSound('note4', 1.25, 0.5*2, 0.5);
                        AUDIO.playSound('note5', 1.25, 1.0*2, 1.0);
                    }, 1000);
                    setTimeout(() => {
                        AUDIO.playSound('note3', 1.25, 0.5*4, 0.0);
                        AUDIO.playSound('note4', 1.25, 0.5*4, 0.5);
                        AUDIO.playSound('note5', 1.25, 1.0*4, 1.0);
                    }, 1500);
                }
                window.localStorage.setItem('lastLevelCleared', lastLevelCleared);
                let prevGems = parseInt(window.localStorage.getItem('bestGemsL' + currentLevel) || 0);
                window.localStorage.setItem('bestGemsL' + currentLevel, Math.max(prevGems, numGems));
                let totalGems = numGems;
                for (let i=0; i<pickUps.length; i++) {
                    if (!pickUps[i].bomb && !pickUps[i].picked) {
                        totalGems += 1;
                    }
                }
                if (totalGems === numGems && currentLevel <= 15) {
                    AUDIO.playSound('note1', 1.25, 0.5*2, 0.0);
                    AUDIO.playSound('note2', 1.25, 0.5*2, 0.5);
                    AUDIO.playSound('note3', 1.25, 1.0*2, 1.0);
                    AUDIO.playSound('note4', 1.25, 1.0*2, 1.5);
                    AUDIO.playSound('note5', 1.25, 2.0*2, 2.0);
                }
                window.localStorage.setItem('maxGemsL' + currentLevel, totalGems);

                tinyxhr(parseInt(window.localStorage.getItem('lastLevelCleared') || 0) > 15 ? "lvl/menu-cleared.json" : "lvl/menu.json", (err,data,xhr) => {
                    loadLevel(JSON.parse(data));
                    gotoLevel = false;
                    gotoLevelT = 0;
                    fadeIn = true;
                    fadeInT = 0;
                    inMenu = true;
                });
            }
        }
        tWasDown = TDown;
        tdWasDown = TDDown;
        SPCWasDown = SPCDown;
        for (let i=0; i<=9; i++) {
            NumWasDown[i] = NumDown[i];
        }

        window.fps = 1 / (Time() - lTime);

    }

}