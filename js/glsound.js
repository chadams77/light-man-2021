// WebGL Sound: GPU Mixer
// By Chris Adams (C) 2021

window.GLS_GPUMixer = function (args) {

    this.args = args || {};

    let AudioContext = window.AudioContext || window.webkitAudioContext;
    this.actx = this.args.audioContext || (new AudioContext());

    this.gpu = this.args.gpu || (new GPU());

    this.onLoad = this.args.onLoad;

    this.samples = [];
    this.sampleIndex = {};
    this.maxTotalGPUSampleLengthSeconds = 60.0;
    this.maxSamples = 64;

    this.time = 0.0;
    this.sampleRate = this.actx.sampleRate;

    this.bufferLengthSeconds = this.args.bufferLengthSeconds || 0.04;
    this.bufferSize = Math.round(this.sampleRate * this.bufferLengthSeconds);
    this.bufferLengthSeconds = this.bufferSize / this.sampleRate;

    this.maxGPUSounds = this.args.maxSounds || 1024;
    this.behindLowPassFrequencyCutoff = this.args.behindLowPassFrequencyCutoff || 100;

    this.gpuLoadCacheMeta = this.gpu.createKernel(function(meta){
        return meta[this.thread.x];
    }, {
        tactic: 'speed',
        output: [ this.maxSamples * 2 ],
        pipeline: true
    });

    this.position = {
        x: 0,
        y: 0,
        angle: -Math.PI*0.5,
        range: 400,
        behindPercent: 0.0
    };

    this.generatePrimitives();
    
    ///

    this.gpuMixer = this.gpu.createKernel(function(startTime, sampCache, sampBehindCache, sampMeta, sounds, lx, ly, langle, lrange, lbhp) {
        let time = startTime + Math.floor(this.thread.x / 2) * (1. / this.constants.sampleRate);
        let dt = 1 * (1. / this.constants.sampleRate);
        let channel = this.thread.x % 2;

        let value = 0.0;
        let numSounds = 0.;

        let soff = 0;
        for (let i=0; i<this.constants.maxGPUSounds; i+=1) {
            let index = sounds[soff+0];
            if (index > -0.5) {
                let soundStartTime = sounds[soff+1];
                let playbackRate = sounds[soff+2];
                let position = Math.floor((time - soundStartTime) * playbackRate * this.constants.sampleRate);
                if (position >= 0.) {
                    let duration = sampMeta[index+index+1];
                    if (position < duration) {
                        let px = sounds[soff+4];
                        let py = sounds[soff+5];
                        let dx = px - lx, dy = py - ly;
                        let distF = 1. - Math.min(1., Math.sqrt(dx*dx+dy*dy) / lrange);
                        let volume = sounds[soff+3] * Math.pow(distF, 2.);

                        let sx = -Math.PI;
                        if (channel == 1) {
                            sx = Math.PI;
                        }

                        let ang = langle - Math.atan(dy, dx);
                        let angDiff = Math.atan(Math.sin(ang), Math.cos(ang));
                        let angT = Math.pow(Math.max(0., Math.min(Math.abs(angDiff) / Math.PI, 1.0) - 0.5) * 2., 0.2) * lbhp;

                        let panf = (Math.abs(sx - angDiff) / (Math.PI * 2.)) * 0.5 + 0.5;
                        let tStart = Math.min((position / (duration-1)) * 20, 1.);
                        let tEnd = Math.min((1. - position / (duration-1)) * 20, 1.);
                        
                        let offset = sampMeta[index+index+0];
                        let cval = sampCache[offset+position*2+channel] * panf;
                        let lval = sampBehindCache[offset+position*2+channel] * panf * 10.;

                        let f = volume * tStart * tEnd;
                        value += ((lval)*angT + (1.-angT)*cval) * Math.pow(f, 0.1);
                        numSounds += f * 0.25 + 0.75;
                    }
                }               
            }
            soff += 6;
        }

        return value;// / Math.pow(Math.max(numSounds, 1.), 1./1.5);
    }, {
        constants: {
            sampleRate: this.sampleRate,
            bufferSize: this.bufferSize,
            maxGPUSounds: this.maxGPUSounds
        },
        loopMaxIterations: this.maxGPUSounds,
        output: [ this.bufferSize*2 ],
        tactic: 'speed',
        immutable: true
    });

    this.gpuInitSounds = this.gpu.createKernel(function() {
        return -1000.0;
    }, {
        output: [ this.maxGPUSounds * 6 ],
        tactic: 'speed',
        pipeline: true,
        immutable: true
    });

    this.gpuAddSoundIndex = this.gpu.createKernel(function(sounds, idx, a, b, c, d, e, f) {
        let jdx = Math.floor(this.thread.x / 6);
        if (jdx === idx) {
            let attr = this.thread.x % 6;
            if (attr === 0) { return a; }
            else if (attr === 1) { return b; }
            else if (attr === 2) { return c; }
            else if (attr === 3) { return d; }
            else if (attr === 4) { return e; }
            else { return f; }
        }
        else {
            return sounds[this.thread.x];
        }
    }, {
        output: [ this.maxGPUSounds * 6 ],
        tactic: 'speed',
        pipeline: true,
        immutable: true
    });

    this.soundsTex = this.gpuInitSounds();
    this.newSoundIndex = 0;

    this.buffers = [
        this.actx.createBuffer(2, this.bufferSize, this.sampleRate),
        this.actx.createBuffer(2, this.bufferSize, this.sampleRate),
        this.actx.createBuffer(2, this.bufferSize, this.sampleRate),
        this.actx.createBuffer(2, this.bufferSize, this.sampleRate),
        this.actx.createBuffer(2, this.bufferSize, this.sampleRate),
        this.actx.createBuffer(2, this.bufferSize, this.sampleRate),
        this.actx.createBuffer(2, this.bufferSize, this.sampleRate)
    ];
    this.cur = 0;

    let toLoad = 0;
    for (let key in args.loadSamplesGPU) {

        toLoad += 1;

        let request = new XMLHttpRequest();
        request.open('GET', '' + args.loadSamplesGPU[key], true);
        request.responseType = 'arraybuffer';
        request.onload = (req) => {
            this.actx.decodeAudioData(req.target.response, (buffer) => {
                this.loadSamplesFromBufferGPU(key, buffer, true);
                toLoad -= 1;
                window.totalLoaded += 1;
                if (toLoad <= 0) {
                    this.loadSoundCacheGPU();

                    this.nextBuffer(this.buffers[this.cur]);
                    this.nxtTime = this.actx.currentTime + 0.005;
                    this.waTimeOffset = this.time - this.actx.currentTime;
                    //this.swapBuffers();

                    setInterval(this.tick.bind(this), 1);

                    if (this.onLoad) {
                        this.onLoad();
                    }
                }
            });
        };
        request.send();
    }

};

GLS_GPUMixer.prototype.generatePrimitives = function() {

    /*let sine = new Float32Array(this.sampleRate);
    for (let i=0; i<sine.length; i++) {
        sine[i] = Math.sin(Math.PI*2*i/sine.length);
    }

    let saw = new Float32Array(this.sampleRate);
    for (let i=0; i<saw.length; i++) {
        let t = i / (saw.length*0.5);
        if (t > 1.0) {
            t = 1. + (1. - t)
        }
        saw[i] = t * 2. - 1;
    }

    let square = new Float32Array(this.sampleRate);
    for (let i=0; i<square.length; i++) {
        let s = Math.sin(Math.PI*i/square.length);
        square[i] = s > 0 ? 1. : -1.;
    }

    let sineP = new Float32Array(this.sampleRate);
    for (let i=0; i<sineP.length; i++) {
        sineP[i] = Math.sin(440*Math.PI*i/sineP.length) * (1. - Math.pow(i / sineP.length, 1.));
    }

    let sawP = new Float32Array(this.sampleRate);
    for (let i=0; i<sawP.length; i++) {
        let t = ((i*440)%sineP.length) / (sawP.length*0.5);
        if (t > 1.0) {
            t = 1. + (1. - t)
        }
        sawP[i] = (t * 2. - 1) * (1. - Math.pow(i / sawP.length, 4.));
    }

    let squareP = new Float32Array(this.sampleRate);
    for (let i=0; i<squareP.length; i++) {
        let s = Math.sin(440*Math.PI*2*i/squareP.length);
        squareP[i] = (s > 0 ? 1. : -1.) * (1. - Math.pow(i / squareP.length, 4.));
    }

    this.loadSoundGPU('sine', sine, this.sampleRate, true, true);
    this.loadSoundGPU('saw', saw, this.sampleRate, true, true);
    this.loadSoundGPU('square', square, this.sampleRate, true, true);
    this.loadSoundGPU('sine-pluck', sineP, this.sampleRate, true, true);
    this.loadSoundGPU('saw-pluck', sawP, this.sampleRate, true, true);
    this.loadSoundGPU('square-pluck', squareP, this.sampleRate, true, true);*/

};

GLS_GPUMixer.prototype.loadSoundGPU = function(name, samples, sampleRate, mono, cacheOnly) {

    let channels = mono ? 1 : 2;
    let inSampleCount = samples.length / channels;
    let numSamples = Math.round(this.sampleRate * (inSampleCount / sampleRate));
    let S = {
        samples: new Float32Array(numSamples*2),
        lengthInSeconds: numSamples / this.sampleRate
    };
    let step = inSampleCount / numSamples;
    let j = 0;
    for (let i=0; i<S.samples.length; i+=2) {
        if (mono) {
            S.samples[i] = S.samples[i+1] = (samples[j] || 0.);
        }
        else {
            S.samples[i] = (samples[Math.floor(j)*2] || 0.);
            S.samples[i+1] = (samples[Math.floor(j)*2+1] || 0.);
        }
        j += step;
    }

    this.samples.push(S);
    this.sampleIndex[name] = this.samples.length-1;

    if (!cacheOnly) {
        this.loadSoundCacheGPU();
    }

};

GLS_GPUMixer.prototype.loadSamplesFromBufferGPU = function(name, bfr, cacheOnly) {

    let left = bfr.getChannelData(0);
    let right = bfr.numberOfChannels > 1 ? bfr.getChannelData(1) : left;

    let samples = new Float32Array(2 * bfr.length);
    let j = 0;
    for (let i=0; i<bfr.length; i++) {
        samples[j] = left[i]; j++;
        samples[j] = right[i]; j++;
    }

    return this.loadSoundGPU(name, samples, bfr.sampleRate, false, cacheOnly);

};

GLS_GPUMixer.prototype.loadSoundCacheGPU = function() {

    let sampLen = 0;
    for (let i=0; i<this.samples.length; i++) {
        let S = this.samples[i];
        sampLen += S.samples.length / 2;
    }

    let samples = new Float32Array(sampLen * 2);
    let samplesBehind = new Float32Array(sampLen * 2);
    let meta = new Float32Array(this.maxSamples * 2);
    let off = 0;
    let mj = 0;
    for (let i=0; i<this.samples.length; i++) {
        let S = this.samples[i];
        meta[mj] = off; mj++;
        meta[mj] = S.samples.length / 2; mj++;
        let start = off;
        for (let j=0; j<S.samples.length; j++) {
            samples[off] = S.samples[j];
            samplesBehind[off] = S.samples[j];
            off += 1;
        }

        let rc = 1.0 / (this.behindLowPassFrequencyCutoff * 2 * Math.PI);
        let dt = 1.0 / this.sampleRate;
        let alpha = dt / (rc + dt);
        let lval = [ samplesBehind[start], samplesBehind[start+1] ];
        for (let j=0; j<S.samples.length; j++) {
            let ch = j%2;
            lval[ch] += alpha * (samplesBehind[start + j] - lval[ch]);
            samplesBehind[start + j] = lval[ch];
        }
    }

    if (this.gpuLoadCacheSamples) {
        this.gpuLoadCacheSamples.destroy();
    }

    this.gpuLoadCacheSamples = this.gpu.createKernel(function(samples){
        return samples[this.thread.x];
    }, {
        tactic: 'speed',
        output: [ sampLen * 2 ],
        pipeline: true
    });

    this.gpuLoadCacheSamplesBehind = this.gpu.createKernel(function(samples){
        return samples[this.thread.x];
    }, {
        tactic: 'speed',
        output: [ sampLen * 2 ],
        pipeline: true
    });

    this.sampTex = this.gpuLoadCacheSamples(samples);
    this.sampBehindTex = this.gpuLoadCacheSamplesBehind(samplesBehind);
    this.sampMetaTex = this.gpuLoadCacheMeta(meta);

};

GLS_GPUMixer.prototype.playSoundGPU = function(name, volume, rate, position) {

    let idx = this.newSoundIndex;

    this.soundsTex = this.gpuAddSoundIndex(
        this.soundsTex,
        idx,
        this.sampleIndex[name],
        Math.max(this.time, this.actx.currentTime + this.waTimeOffset + (1/this.sampleRate)),
        Math.max(rate || 0, 0.01),
        Math.max(volume || 0, 0.),
        position.x || 0,
        position.y || 0
    )
    this.newSoundIndex = (this.newSoundIndex + 1) % this.maxGPUSounds;

    return idx;

};

GLS_GPUMixer.prototype.getSoundsArrayTexture = function() {

    return {
        texture: this.soundsTex,
        attributes: 6,
        maxSounds: this.maxGPUSounds,
        time: Math.max(this.time, this.actx.currentTime + this.waTimeOffset + (1/this.sampleRate))
    };

};

GLS_GPUMixer.prototype.updateAllSoundsGPU = function(soundsTex) {

    this.soundsTex = soundsTex;
    this.newSoundIndex = 0;

};

GLS_GPUMixer.prototype.tick = function() {

    if (this.actx.currentTime >= (this.nxtTime + this.bufferLengthSeconds * 3)) {
        this.time = this.actx.currentTime;
        this.nxtTime = this.actx.currentTime + 0.005;
        this.waTimeOffset = 0.;
    }
    if (this.actx.currentTime >= (this.nxtTime - this.bufferLengthSeconds * 3)) {
        this.swapBuffers();
    }

};

GLS_GPUMixer.prototype.swapBuffers = function() {

    let node = this.actx.createBufferSource();
    node.buffer = this.buffers[this.cur];
    node.connect(this.args.destinationNode || this.actx.destination);
    node.start(this.nxtTime);

    this.nxtTime += this.bufferLengthSeconds;
    this.cur = (this.cur + 1) % this.buffers.length;
    this.nextBuffer(this.buffers[this.cur]);

};

GLS_GPUMixer.prototype.nextBuffer = function(bfr) {

    let left = bfr.getChannelData(0);
    let right = bfr.getChannelData(1);
    let st = this.actx.currentTime;
    let out = this.gpuMixer(this.time, this.sampTex, this.sampBehindTex, this.sampMetaTex, this.soundsTex, this.position.x, this.position.y, this.position.angle, this.position.range, this.position.behindPercent);
    let o = 0;
    for (let i=0; i<this.bufferSize; i++, o++) {
        left[i] = out[o];
        o ++;
        right[i] = out[o];
    }
    this.time += this.bufferLengthSeconds;

};