// TJP AI Studio — Custom High-Performance WebSR Core
// Native U-Net (katana/unet-u24) + CNN-28 + Auto-Sync Buffer Protection
const WebSR = (() => {
  "use strict";
  var t = {
    23: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(297);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.num_work_groups = 8;
        }
        createStandardShader(t) {
          return this.device.createShaderModule({
            label: `${this.label}-shader`,
            code: `\n              ${this.computeShaderInputs()}\n              \n              ${t}\n        `
          });
        }
        computeShaderInputs() {
          const t = [];
          for (let e = 0; e < this.inputs.length; e++)
            if (this.inputs[e] instanceof GPUTexture)
              t.push(`@group(0) @binding(${e}) var inputTexture${e}: texture_2d<f32>;`);
            else if (this.inputs[e] instanceof GPUExternalTexture)
              t.push(`@group(0) @binding(${e}) var inputTexture${e}: texture_external;`);
            else {
              if (!(this.inputs[e] instanceof GPUBuffer))
                throw new Error("Input is undefined or non of the correct input type");
              t.push(`@group(0) @binding(${e}) var<storage, read_write> inputBuffer${e}: array<vec4f>;`);
            }
          return this.uniforms.forEach(((e, i) => {
            t.push(`@group(0) @binding(${i + this.inputs.length}) var <uniform> ${e.name}: ${e.type};`);
          })), t.push(`@group(0) @binding(${this.inputs.length + this.uniforms.length}) var <storage, read_write> outputBuffer: array<vec4f>;`), t.join("\n");
        }
        defaultPipelineConfig() {
          return { label: `${this.label}-pipeline`, layout: "auto", compute: { module: this.shader, entryPoint: "main" } };
        }
        defaultSetup() {
          this.pipeline = this.device.createComputePipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup();
        }
        lazyLoadSetup() {}
        run() {
          const t = this.device.createCommandEncoder({ label: this.label });
          this.pipeline || this.lazyLoadSetup();
          const e = t.beginComputePass({ label: this.label });
          e.setPipeline(this.pipeline), this.hasExternalTexture() && (this.bindGroup = this.defaultBindGroup()), this.bindGroup && e.setBindGroup(0, this.bindGroup), e.dispatchWorkgroups(Math.floor(this.resolution.width / this.num_work_groups), Math.floor(this.resolution.height / this.num_work_groups)), e.end(), this.device.queue.submit([t.finish()]);
        }
      }
      e.default = n;
    },
    38: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(200);
      class n extends r.default {
        constructor(t, e) {
          super(t, e), this.label = "SR2XSDisplay", this.vertexScale = { width: 1, height: 1 }, this.sampler = this.device.createSampler({ addressModeU: "repeat", addressModeV: "repeat", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
        }
        lazyLoadSetup() {
          const t = this.inputs[1] instanceof GPUExternalTexture,
            e = t ? "textureSampleBaseClampToEdge(inputTexture, ourSampler, input.tex_coord)" : "textureSample(inputTexture, ourSampler, input.tex_coord)";
          this.shader = this.device.createShaderModule({
            label: `${this.label}-shader`,
            code: `\n                ${this.defaultVertexShader()}\n                @group(0) @binding(0) var<storage, read_write> inputBuffer0: array<vec4f>;\n                @group(0) @binding(1) var inputTexture: ${t ? "texture_external" : "texture_2d<f32>"};\n                @group(0) @binding(2) var ourSampler: sampler;\n\n                @fragment fn fragmentMain(input: VertexShaderOutput) -> @location(0) vec4f {\n                    let x = ${this.resolution.width}.0 * (input.tex_coord.x);\n                    let y = ${this.resolution.height}.0 * (input.tex_coord.y);\n                    let lr_x = u32(floor(x));\n                    let lr_y = u32(floor(y));\n                    let lr_idx = lr_y * ${Math.floor(this.resolution.width)}u + lr_x;\n                    let x_floor = u32(fract(x) * 2.0);\n                    let y_floor = u32(fract(y) * 2.0);\n                    let sub: u32 = x_floor + y_floor * 2u;\n                    let r_residual = inputBuffer0[lr_idx * 4u + 0u][sub];\n                    let g_residual = inputBuffer0[lr_idx * 4u + 1u][sub];\n                    let b_residual = inputBuffer0[lr_idx * 4u + 2u][sub];\n                    let bilinear = ${e};\n                    return bilinear + vec4f(r_residual, g_residual, b_residual, 0.0);\n                }\n            `
          }), this.pipeline = this.device.createRenderPipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup(), this.renderPassDescriptor = this.defaultRenderPassDescriptor();
        }
        defaultBindGroup() {
          const t = [];
          return this.inputs.forEach(((e, i) => {
            e instanceof GPUExternalTexture ? t.push({ binding: i, resource: e }) : e instanceof GPUTexture ? t.push({ binding: i, resource: e.createView() }) : e instanceof GPUBuffer && t.push({ binding: i, resource: { buffer: e } });
          })), t.push({ binding: this.inputs.length, resource: this.sampler }), this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: t });
        }
      }
      e.default = n;
    },
    49: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(200);
      class n extends r.default {
        constructor(t, e) {
          super(t, e), this.label = "DisplayLayer3C", this.vertexScale = { width: 1, height: 1 }, this.sampler = this.device.createSampler({ addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", magFilter: "nearest", minFilter: "nearest" });
        }
        lazyLoadSetup() {
          const t = this.inputs[3] instanceof GPUExternalTexture;
          this.pipeline && this._builtForExternal === t || (this._builtForExternal = t, this.shader = this.device.createShaderModule({
            label: `${this.label}-shader`,
            code: `\n                   ${this.defaultVertexShader()}\n                   @group(0) @binding(0) var<storage, read_write> inputBuffer0: array<vec4f>;\n                   @group(0) @binding(1) var<storage, read_write> inputBuffer1: array<vec4f>;\n                   @group(0) @binding(2) var<storage, read_write> inputBuffer2: array<vec4f>;\n                   @group(0) @binding(3) var inputTexture: ${t ? "texture_external" : "texture_2d<f32>"};\n                   @group(0) @binding(4) var ourSampler: sampler;\n                   \n                   fn bicubic_weight(t: f32) -> f32 {\n                        let abs_t = abs(t);\n                        if (abs_t >= 2.0) { return 0.0; }\n                        let t2 = t * t;\n                        let t3 = abs_t * t2;\n                        if (abs_t <= 1.0) { return 1.5 * t3 - 2.5 * t2 + 1.0; }\n                        else { return -0.5 * t3 + 2.5 * t2 - 4.0 * abs_t + 2.0; }\n                   }\n                   \n                   fn sampleBicubic(texture: ${t ? "texture_external" : "texture_2d<f32>"}, sampler: sampler, tex_coord: vec2<f32>) -> vec4<f32> {\n                        let tex_size = vec2<f32>(textureDimensions(texture));\n                        let pixel_coord = tex_coord * tex_size - 0.5;\n                        let base_coord = floor(pixel_coord);\n                        let fract_coord = pixel_coord - base_coord;\n                        var result = vec3<f32>(0.0);\n                        var weight_sum = 0.0;\n                        for (var y = -1; y <= 2; y = y + 1) {\n                            for (var x = -1; x <= 2; x = x + 1) {\n                                let sample_coord = (base_coord + vec2<f32>(f32(x), f32(y)) + 0.5) / tex_size;\n                                let sample_color = ${t ? "textureSampleBaseClampToEdge(texture, sampler, sample_coord).rgb" : "textureSample(texture, sampler, sample_coord).rgb"};\n                                let weight_x = bicubic_weight(fract_coord.x - f32(x));\n                                let weight_y = bicubic_weight(fract_coord.y - f32(y));\n                                let weight = weight_x * weight_y;\n                                result += sample_color * weight;\n                                weight_sum += weight;\n                            }\n                        }\n                        if (weight_sum > 0.0) { result = result / weight_sum; }\n                        return vec4<f32>(result, 1.0);\n                   }\n                  \n                   @fragment fn fragmentMain(input: VertexShaderOutput) -> @location(0) vec4f {\n                        let x = ${this.resolution.width}.0*(input.tex_coord.x);\n                        let y = ${this.resolution.height}.0*(input.tex_coord.y);\n                        let y2 = u32(floor(y));\n                        let x2 = u32(floor(x));\n                        let i = y2*${Math.floor(this.resolution.width)} + x2;\n                        let x_floor = u32(fract(x)*2.0);\n                        let y_floor = u32(fract(y)*2.0);\n                        let c_index: u32 = x_floor + y_floor*2;\n                        let value = f32(inputBuffer0[i][c_index]);\n                        let value1 = f32(inputBuffer1[i][c_index]);\n                        let value2 = f32(inputBuffer2[i][c_index]);\n                        let bicubic = sampleBicubic(inputTexture, ourSampler, input.tex_coord);\n                        return bicubic + vec4f(value, value1, value2, 1.0);\n                   }\n            `
          }), this.pipeline = this.device.createRenderPipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup(), this.renderPassDescriptor = this.defaultRenderPassDescriptor());
        }
        defaultPipelineConfig() {
          return { label: `${this.label}-pipeline`, layout: "auto", vertex: { module: this.shader, entryPoint: "vertexMain" }, fragment: { module: this.shader, entryPoint: "fragmentMain", targets: [{ format: this.output.format }] } };
        }
        defaultBindGroup() {
          const t = [];
          return this.inputs.forEach((function (e, i) {
            e instanceof GPUExternalTexture ? t.push({ binding: i, resource: e }) : e instanceof GPUTexture ? t.push({ binding: i, resource: e.createView() }) : e instanceof GPUBuffer && t.push({ binding: i, resource: { buffer: e } });
          })), t.push({ binding: this.inputs.length, resource: this.sampler }), this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: t });
        }
      }
      e.default = n;
    },
    58: function (t, e) {
      Object.defineProperty(e, "__esModule", { value: !0 }), e.default = class {
        constructor(t, e, i, r, n, s, o, a) {
          this.device = t, this.precision = null != a ? a : "auto", this.canvas = r, this.processResolution = e, this.canvasResolution = i, this.outputResolution = null != o ? o : { width: i.width * n, height: i.height * n }, this.textures = {}, this.buffers = {}, this.destroyed = !1, this.scale = n, this.debug = s;
          let l = this.canvas.getContext("webgpu");
          if (!(l instanceof GPUCanvasContext)) throw new Error("Unable to load WebGPU context");
          this.context = l, this.textureUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, this.bufferUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, this.context.configure({ device: this.device, format: navigator.gpu.getPreferredCanvasFormat(), usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST }), this.debug && (this.bufferUsage = this.bufferUsage | GPUBufferUsage.COPY_SRC), this.textures.output = this.context.getCurrentTexture();
        }
        async readBuffer(t) {
          if (!this.buffers[t]) throw new Error(`No buffer with name ${t}`);
          const e = this.device.createCommandEncoder({ label: `Read ${t} buffer encoder` }), i = this.buffers[t], r = this.device.createBuffer({ label: "result buffer", size: i.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
          e.copyBufferToBuffer(i, 0, r, 0, r.size), this.device.queue.submit([e.finish()]), await r.mapAsync(GPUMapMode.READ);
          return new Float32Array(r.getMappedRange());
        }
        cleanup() {
          for (const t of Object.keys(this.buffers)) {
            try { this.buffers[t].destroy(); } catch (e) {}
            delete this.buffers[t];
          }
          for (const t of Object.keys(this.textures)) {
            try { this.textures[t].destroy(); } catch (e) {}
            delete this.textures[t];
          }
        }
        destroy() {
          this.cleanup();
          this.destroyed = !0;
        }
        useF16() {
          var t;
          const e = !!(null === (t = this.device.features) || void 0 === t ? void 0 : t.has("shader-f16")) && "undefined" != typeof Float16Array;
          return "f32" !== this.precision && e;
        }
        buffer(t, e) {
          if (!this.buffers[t]) {
            const i = (e = e || {}).width || this.processResolution.width, r = e.height || this.processResolution.height, n = e.channels || 4, s = e.bitdepth || 4;
            this.buffers[t] = this.device.createBuffer({ label: t, size: i * r * n * s, usage: this.bufferUsage });
          }
          return this.buffers[t];
        }
        texture(t, e) {
          return this.textures[t] || (e = e || {}, this.textures[t] = this.device.createTexture({ label: t, size: [e.width || this.processResolution.width, e.height || this.processResolution.height], format: e.format || "rgba32float", usage: this.textureUsage })), this.textures[t];
        }
      };
    },
    67: function (t, e, i) {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const n = i(200), s = i(181), o = i(548), a = i(269), l = i(471);
      class c extends s.default {
        constructor(t) { super(t); }
        model() {
          const t = this.context, e = [], i = t.useF16(), r = i ? 2 : 4,
            n = t.buffer("x4v3_input", { channels: 4, bitdepth: r }),
            s = t.buffer("x4v3_act_a", { channels: 64, bitdepth: r }),
            c = t.buffer("x4v3_act_b", { channels: 64, bitdepth: r }),
            u = t.buffer("x4v3_final", { channels: 48, bitdepth: r }),
            d = this.weights.layers;
          e.push(new a.default(t.input, n, i));
          for (let t = 0; t < d.length - 1; t++) {
            const r = d[t], a = 0 === t ? n : t % 2 == 1 ? s : c, l = t % 2 == 0 ? s : c;
            e.push(new o.default(a, l, r, i));
          }
          const h = d.length - 1, p = d[h], f = (h - 1) % 2 == 0 ? s : c;
          return e.push(new o.default(f, u, p, i)), e.push(new l.default([u, t.input], t.texture("output"), i)), e;
        }
        async feedForward(t, e) {
          this.context.input = t;
          const i = this.layers[0], r = this.layers[this.layers.length - 1];
          i.inputs[0] = t, r.inputs[1] = t, i.lazyLoadSetup(), r instanceof n.default && r.setOutput(e), r.lazyLoadSetup(), this.layers.forEach((t => t.run()));
        }
      }
      e.default = c;
    },
    82: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "Anime4KConv16x4";
          const r = i.weights, n = i.bias;
          this.createUniform("kernel_offsets", "array<vec4f, 9>"), this.createUniform("kernels", "array<mat4x4f, 36>"), this.createUniform("bias", "vec4f"),
          this.shader = this.createStandardShader(`\n          @compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n                let x = id.x;\n                let y = id.y;\n                let i = id.y*${this.resolution.width} + x;\n                var result = vec4f(0.0, 0.0, 0.0, 0.0);\n                let coord = vec2<i32>(i32(x), i32(y));\n                 for(var k = 0u; k < 9u; k++){\n                   let pixel_loc = coord + vec2<i32>(kernel_offsets[k].xy);\n                   if (pixel_loc.x >= 0 && pixel_loc.x < ${this.resolution.width} && pixel_loc.y >= 0 && pixel_loc.y < ${this.resolution.height}) {\n                     let buff_ind = pixel_loc.y*${this.resolution.width} + pixel_loc.x;\n                     let pix_val0 = inputBuffer0[buff_ind];\n                     let pix_val1 = inputBuffer1[buff_ind];\n                     result += kernels[k]*max(pix_val0, vec4f(0.0));\n                     result += kernels[k+9u]*max(pix_val1, vec4f(0.0));\n                     result += kernels[k+18u]*max(-1.0*pix_val0, vec4f(0.0));\n                     result += kernels[k+27u]*max(-1.0*pix_val1, vec4f(0.0));\n                   }\n                 }\n                result += bias;\n                outputBuffer[i] = result;\n          }\n        `),
          this.setUniform("kernel_offsets", new Float32Array([-1, -1, 0, 0, -1, 0, 0, 0, -1, 1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0])),
          this.setUniform("kernels", new Float32Array(r)), this.setUniform("bias", new Float32Array(n)), this.defaultSetup();
        }
      }
      e.default = n;
    },
    98: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(200);
      class n extends r.default {
        constructor(t, e, i = !1) {
          super(t, e), this.label = "UNetOutput", this.useF16 = i;
        }
        lazyLoadSetup() {
          const t = this.inputs[1] instanceof GPUExternalTexture;
          if (this.pipeline && this._builtForExternal === t) return;
          this._builtForExternal = t;
          const e = this.resolution.width, i = this.resolution.height,
            r = t ? "texture_external" : "texture_2d<f32>",
            n = t ? "textureLoad(inputTexture, c)" : "textureLoad(inputTexture, c, 0)",
            s = this.useF16 ? "vec4<f16>" : "vec4f",
            o = this.useF16 ? "vec4f" : "";
          this.shader = this.device.createShaderModule({
            label: `${this.label}-shader`,
            code: `${this.useF16 ? "enable f16;\n" : ""}\n              ${this.defaultVertexShader()}\n\n              @group(0) @binding(0) var<storage, read> outBuf: array<${s}>;\n              @group(0) @binding(1) var inputTexture: ${r};\n\n              fn cr_weight(t: f32) -> f32 {\n                  let a = abs(t);\n                  if (a <= 1.0) { return 1.5 * a * a * a - 2.5 * a * a + 1.0; }\n                  if (a < 2.0)  { return -0.5 * a * a * a + 2.5 * a * a - 4.0 * a + 2.0; }\n                  return 0.0;\n              }\n\n              fn src(x: i32, y: i32) -> vec3f {\n                  let c = vec2<i32>(clamp(x, 0, ${e - 1}), clamp(y, 0, ${i - 1}));\n                  return ${n}.rgb;\n              }\n\n              @fragment fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {\n                  let ox = u32(pos.x);\n                  let oy = u32(pos.y);\n                  let lx = ox / 2u;\n                  let ly = oy / 2u;\n                  let sub = (oy % 2u) * 2u + (ox % 2u);\n                  let base = (ly * ${e}u + lx) * 3u;\n                  let r = ${o}(outBuf[base + 0u])[sub];\n                  let g = ${o}(outBuf[base + 1u])[sub];\n                  let b = ${o}(outBuf[base + 2u])[sub];\n\n                  let px = (f32(ox) + 0.5) * 0.5 - 0.5;\n                  let py = (f32(oy) + 0.5) * 0.5 - 0.5;\n                  let bx = floor(px);\n                  let by = floor(py);\n                  let fx = px - bx;\n                  let fy = py - by;\n                  var acc = vec3f(0.0);\n                  var wsum = 0.0;\n                  for (var j = -1; j <= 2; j = j + 1) {\n                      let wy = cr_weight(fy - f32(j));\n                      for (var i = -1; i <= 2; i = i + 1) {\n                          let w = cr_weight(fx - f32(i)) * wy;\n                          acc = acc + src(i32(bx) + i, i32(by) + j) * w;\n                          wsum = wsum + w;\n                      }\n                  }\n                  return vec4f(vec3f(r, g, b) + acc / wsum, 1.0);\n              }\n            `
          }), this.pipeline = this.device.createRenderPipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup(), this.renderPassDescriptor = this.defaultRenderPassDescriptor();
        }
        defaultBindGroup() {
          const t = [];
          return this.inputs.forEach(((e, i) => {
            e instanceof GPUExternalTexture ? t.push({ binding: i, resource: e }) : e instanceof GPUTexture ? t.push({ binding: i, resource: e.createView() }) : e instanceof GPUBuffer && t.push({ binding: i, resource: { buffer: e } });
          })), this.device.createBindGroup({ label: `${this.label}-bg`, layout: this.pipeline.getBindGroupLayout(0), entries: t });
        }
      }
      e.default = n;
    },
    116: (t, e) => {
      function i(t) { return "undefined" != typeof HTMLVideoElement && t instanceof HTMLVideoElement; }
      function r(t) { return "undefined" != typeof HTMLImageElement && t instanceof HTMLImageElement; }
      function n(t) { return "undefined" != typeof ImageBitmap && t instanceof ImageBitmap; }
      function s(t) { return "undefined" != typeof VideoFrame && t instanceof VideoFrame; }
      Object.defineProperty(e, "__esModule", { value: !0 }), e.isHTMLVideoElement = i, e.isHTMLImageElement = r, e.isImageBitmap = n, e.isVideoFrame = s,
      e.getSourceWidth = function (t) { return i(t) ? t.videoWidth : r(t) ? t.naturalWidth : s(t) ? t.displayWidth : n(t) ? t.width : 0; },
      e.getGPUTier = function (t) { if (!t) return 1; let e = t.tier; return e ? (t.isMobile && (e = Math.max(e - 1, 1)), e) : 1; },
      e.getSourceHeight = function (t) { return i(t) ? t.videoHeight : r(t) ? t.naturalHeight : s(t) ? t.displayHeight : n(t) ? t.height : 0; },
      e.externalTexturesSupported = function (t, e) {
        let i = o.get(t);
        if (void 0 === i) {
          try { t.importExternalTexture({ source: e }), i = !0; } catch (t) { i = !1; }
          o.set(t, i);
        }
        return i;
      };
      const o = new WeakMap;
    },
    145: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i, r) {
          super(t, e, i), this.label = "Anime4KConv112x4";
          const n = i.weights;
          this.createUniform("kernels", "array<mat4x4f, 28>");
          let s = "";
          for (let t = 0; t < 7; t++) s += r ? `\n                let pixel_val${t} = inputBuffer${t}[buff_ind];\n                result += kernels[${4 * t}]*max(pixel_val${t}, vec4f(0.0));\n                result += kernels[${4 * t + 2}]*max(-1.0*pixel_val${t}, vec4f(0.0));\n            ` : `\n                let pixel_val${t} = inputBuffer${t}[buff_ind];\n                result += kernels[${4 * t + 1}]*max(pixel_val${t}, vec4f(0.0));\n                result += kernels[${4 * t + 3}]*max(-1.0*pixel_val${t}, vec4f(0.0));`;
          this.shader = this.createStandardShader(`\n          @compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n                let x = id.x;\n                let y = id.y;\n                let i = id.y*${this.resolution.width} + x;\n                var result = vec4f(0.0, 0.0, 0.0, 0.0);\n                let coord = vec2<i32>(i32(x), i32(y));\n                let buff_ind = coord.y*${this.resolution.width} + coord.x;\n                ${s}\n                outputBuffer[i] = result;\n          }\n        `), this.setUniform("kernels", new Float32Array(n)), this.defaultSetup();
        }
        defaultPipelineConfig() {
          return { label: `${this.label}-pipeline`, layout: "auto", compute: { module: this.shader, entryPoint: "main" } };
        }
        defaultBindGroup() {
          const t = [];
          return this.inputs.forEach((function (e, i) {
            e instanceof GPUExternalTexture ? t.push({ binding: i, resource: e }) : e instanceof GPUTexture ? t.push({ binding: i, resource: e.createView() }) : e instanceof GPUBuffer && t.push({ binding: i, resource: { buffer: e } });
          })), this.uniforms.forEach(((e, i) => {
            t.push({ binding: i + this.inputs.length, resource: { buffer: this.buffers[e.name] } });
          })), this.output instanceof GPUBuffer && t.push({ binding: this.inputs.length + this.uniforms.length, resource: { buffer: this.output } }), 0 === t.length ? null : this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: t });
        }
      }
      e.default = n;
    },
    168: function (t, e, i) {
      Object.defineProperty(e, "__esModule", { value: !0 }), e.levelResolution = h;
      const n = i(200), s = i(181), o = i(269), a = i(177), l = i(98), c = i(646), u = i(704);
      class d extends o.default {
        run() {
          this.pipeline || this.lazyLoadSetup();
          const t = this.device.createCommandEncoder({ label: this.label }), e = t.beginComputePass({ label: this.label });
          e.setPipeline(this.pipeline), this.hasExternalTexture() && (this.bindGroup = this.defaultBindGroup()), e.setBindGroup(0, this.bindGroup), e.dispatchWorkgroups(Math.ceil(this.resolution.width / 16), Math.ceil(this.resolution.height / 16)), e.end(), this.device.queue.submit([t.finish()]);
        }
      }
      function h(t, e) {
        let { width: i, height: r } = t;
        for (let t = 0; t < e; t++) i = Math.ceil(i / 2), r = Math.ceil(r / 2);
        return { width: i, height: r };
      }
      class p extends s.default {
        constructor(t) { super(t); }
        model() {
          if (!(0, u.isUNetWeights)(this.weights)) throw new Error("UNetCNN needs weights from WebSR.parseUNetWeights()");
          const t = this.weights, e = t.meta, i = this.context, r = i.device, n = i.useF16(), s = n ? 2 : 4;
          this.weightsUNet = t, this.folds = [];
          const o = {};
          for (const t of Object.keys(e.buffers)) {
            const r = e.buffers[t], n = h(i.processResolution, r.level);
            o[t] = i.buffer(`unet_${t}`, { width: n.width, height: n.height, channels: 4 * r.vec4s, bitdepth: s });
          }
          const p = (t, e, n, s = 0) => {
            const o = n ? new Float16Array(e) : e, a = r.createBuffer({ label: t, size: o.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | s });
            return r.queue.writeBuffer(a, 0, o), i.buffers[t] = a, a;
          };
          this.foldPipeline = r.createComputePipeline({ label: "UNetFold", layout: "auto", compute: { module: r.createShaderModule({ code: (0, c.foldShader)(n) }), entryPoint: "main" } }),
          this.alphaBuf = r.createBuffer({ label: "unet-alpha", size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
          i.buffers.unetw_alpha = this.alphaBuf;
          const f = [];
          return f.push(new d(i.input, o.in, n)), e.layers.forEach((r => {
            const s = t.tensor(r.weights), l = t.tensor(r.bias);
            let c, u;
            r.banked ? (c = this.bankedTensor(`unetw_${r.name}_k`, s, e.banks, n, p), u = this.bankedTensor(`unetw_${r.name}_b`, l, e.banks, n, p)) : (c = p(`unetw_${r.name}_k`, s, n), u = p(`unetw_${r.name}_b`, l, n));
            const d = e.buffers[r.in_buf], m = e.buffers[r.out_buf];
            f.push(new a.default(r, o[r.in_buf], o[r.out_buf], c, u, { out: h(i.processResolution, r.level), in: h(i.processResolution, r.in_level), inStride: d.vec4s, outStride: m.vec4s }, n));
          })), f.push(new l.default([o.out, i.input], i.texture("output"), n)), this.applyAlpha(new Float32Array(e.default_alpha)), f;
        }
        bankedTensor(t, e, i, r, n) {
          const s = this.context.device, o = e.length / i / 4, a = n(`${t}_banks`, e, !1), l = n(t, e.subarray(0, 4 * o), r),
            c = s.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          return s.queue.writeBuffer(c, 0, new Uint32Array([o, i, 0, 0])), this.context.buffers[`${t}_params`] = c, this.folds.push({
            banks: a, out: l, params: c, len: o,
            bindGroup: s.createBindGroup({ layout: this.foldPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: a } }, { binding: 1, resource: { buffer: l } }, { binding: 2, resource: { buffer: c } }, { binding: 3, resource: { buffer: this.alphaBuf } }] })
          }), l;
        }
        get banks() { return this.weightsUNet.meta.banks; }
        applyAlpha(t) {
          if (t.length !== this.banks) throw new Error(`applyAlpha: expected ${this.banks} values, got ${t.length}`);
          const e = this.context.device, i = new Float32Array(8);
          i.set(t), e.queue.writeBuffer(this.alphaBuf, 0, i);
          const r = e.createCommandEncoder({ label: "UNetFold" }), n = r.beginComputePass();
          n.setPipeline(this.foldPipeline);
          for (const t of this.folds) n.setBindGroup(0, t.bindGroup), n.dispatchWorkgroups(Math.ceil(t.len / 64));
          n.end(), e.queue.submit([r.finish()]), this.alpha = Float32Array.from(t);
        }
        async feedForward(t, e) {
          this.context.input = t;
          const i = this.layers[0], r = this.layers[this.layers.length - 1];
          i.inputs[0] = t, r.inputs[1] = t, i.lazyLoadSetup(), r instanceof n.default && r.setOutput(e), r.lazyLoadSetup(), this.layers.forEach((t => t.run()));
        }
      }
      e.default = p;
    },
    177: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23), n = { same: 0, s2: 1, up: 2 };
      function s(t) {
        const e = t ? "vec4<f16>" : "vec4f", i = t ? "vec4<f16>(0.0h)" : "vec4f(0.0)";
        return `${t ? "enable f16;\n" : ""}struct Params {\n    out_w: u32, out_h: u32, in_w: u32, in_h: u32,\n    in_stride: u32, in_offset: u32, in_vec4s: u32,\n    out_stride: u32, out_offset: u32, out_vec4s: u32,\n    crelu: u32, mode: u32,\n}\n\n@group(0) @binding(0) var<storage, read> input: array<${e}>;\n@group(0) @binding(1) var<storage, read_write> output: array<${e}>;\n@group(0) @binding(2) var<storage, read> kernels: array<${t ? "mat4x4<f16>" : "mat4x4f"}>;\n@group(0) @binding(3) var<storage, read> bias: array<${e}>;\n@group(0) @binding(4) var<uniform> p: Params;\n\nfn src_index(ox: i32, oy: i32, dx: i32, dy: i32) -> i32 {\n    var sx: i32; var sy: i32;\n    if (p.mode == 1u) {\n        sx = ox * 2 + dx; sy = oy * 2 + dy;\n        if (sx < 0 || sy < 0 || sx >= i32(p.in_w) || sy >= i32(p.in_h)) { return -1; }\n    } else if (p.mode == 2u) {\n        let ux = ox + dx; let uy = oy + dy;\n        if (ux < 0 || uy < 0 || ux >= i32(p.out_w) || uy >= i32(p.out_h)) { return -1; }\n        sx = i32((u32(ux) * p.in_w) / p.out_w);\n        sy = i32((u32(uy) * p.in_h) / p.out_h);\n    } else {\n        sx = ox + dx; sy = oy + dy;\n        if (sx < 0 || sy < 0 || sx >= i32(p.in_w) || sy >= i32(p.in_h)) { return -1; }\n    }\n    return sy * i32(p.in_w) + sx;\n}\n\n@compute @workgroup_size(16, 16)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n    let ox = gid.x;\n    let oy = gid.y;\n    if (ox >= p.out_w || oy >= p.out_h) { return; }\n    let IV = select(p.in_vec4s, p.in_vec4s * 2u, p.crelu != 0u);\n    let OV = p.out_vec4s;\n    for (var ob = 0u; ob < OV; ob = ob + 4u) {\n        let h1 = (ob + 1u) < OV;\n        let h2 = (ob + 2u) < OV;\n        let h3 = (ob + 3u) < OV;\n        let o0 = ob;\n        let o1 = select(ob, ob + 1u, h1);\n        let o2 = select(ob, ob + 2u, h2);\n        let o3 = select(ob, ob + 3u, h3);\n        var a0 = ${i}; var a1 = ${i}; var a2 = ${i}; var a3 = ${i};\n        for (var ky = 0; ky < 3; ky = ky + 1) {\n            for (var kx = 0; kx < 3; kx = kx + 1) {\n                let s = src_index(i32(ox), i32(oy), kx - 1, ky - 1);\n                if (s < 0) { continue; }\n                let tap = u32(ky * 3 + kx);\n                let px = u32(s) * p.in_stride + p.in_offset;\n                for (var g = 0u; g < p.in_vec4s; g = g + 1u) {\n                    let v = input[px + g];\n                    if (p.crelu != 0u) {\n                        let vp = max(v, ${i});\n                        let vn = max(-v, ${i});\n                        let bp = (tap * IV + g) * OV;\n                        let bn = (tap * IV + g + p.in_vec4s) * OV;\n                        a0 = a0 + kernels[bp + o0] * vp + kernels[bn + o0] * vn;\n                        a1 = a1 + kernels[bp + o1] * vp + kernels[bn + o1] * vn;\n                        a2 = a2 + kernels[bp + o2] * vp + kernels[bn + o2] * vn;\n                        a3 = a3 + kernels[bp + o3] * vp + kernels[bn + o3] * vn;\n                    } else {\n                        let b = (tap * IV + g) * OV;\n                        a0 = a0 + kernels[b + o0] * v;\n                        a1 = a1 + kernels[b + o1] * v;\n                        a2 = a2 + kernels[b + o2] * v;\n                        a3 = a3 + kernels[b + o3] * v;\n                    }\n                }\n            }\n        }\n        let base = (oy * p.out_w + ox) * p.out_stride + p.out_offset;\n        output[base + o0] = a0 + bias[o0];\n        if (h1) { output[base + o1] = a1 + bias[o1]; }\n        if (h2) { output[base + o2] = a2 + bias[o2]; }\n        if (h3) { output[base + o3] = a3 + bias[o3]; }\n    }\n}\n`;
      }
      const o = new WeakMap;
      class a extends r.default {
        constructor(t, e, i, r, a, l, c) {
          super([e], i), this.label = `UNetConv-${t.name}`, this.geom = l;
          this.pipeline = function (t, e) {
            let i = o.get(t);
            i || (i = new Map, o.set(t, i));
            let r = i.get(e);
            return r || (r = t.createComputePipeline({ label: "UNetConv-" + (e ? "f16" : "f32"), layout: "auto", compute: { module: t.createShaderModule({ code: s(e) }), entryPoint: "main" } }), i.set(e, r)), r;
          }(this.device, c);
          const u = new Uint32Array([l.out.width, l.out.height, l.in.width, l.in.height, l.inStride, t.in_offset, t.in_vec4s, l.outStride, t.out_offset, t.out_vec4s, t.crelu ? 1 : 0, n[t.mode]]),
            d = this.device.createBuffer({ label: `${this.label}/params`, size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          this.device.queue.writeBuffer(d, 0, u), this.bindGroup = this.device.createBindGroup({ label: `${this.label}-bg`, layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: e } }, { binding: 1, resource: { buffer: i } }, { binding: 2, resource: { buffer: r } }, { binding: 3, resource: { buffer: a } }, { binding: 4, resource: { buffer: d } }] });
        }
        run() {
          const t = this.device.createCommandEncoder({ label: this.label }), e = t.beginComputePass({ label: this.label });
          e.setPipeline(this.pipeline), e.setBindGroup(0, this.bindGroup), e.dispatchWorkgroups(Math.ceil(this.geom.out.width / 16), Math.ceil(this.geom.out.height / 16)), e.end(), this.device.queue.submit([t.finish()]);
        }
      }
      e.default = a;
    },
    181: function (t, e) {
      Object.defineProperty(e, "__esModule", { value: !0 }), e.default = class {
        constructor(t) {
          this.weights = t, this.context = globalThis.context, this.layers = this.model();
        }
        model() { return []; }
        lastLayer() { return this.layers[this.layers.length - 1]; }
        async feedForward() { this.layers.forEach((t => t.run())); }
      };
    },
    200: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(297);
      class n extends r.default {
        constructor(t, e, i) { super(t, e, i), this.vertexScale = this.context.processResolution; }
        defaultVertexShader() {
          return `struct VertexShaderOutput {\n  @builtin(position) position: vec4f,\n  @location(0) tex_coord: vec2f,\n};\n@vertex\nfn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexShaderOutput {\n  let pos = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));\n  var vsOutput: VertexShaderOutput;\n  let xy = pos[vertexIndex];\n  vsOutput.position = vec4f(xy, 0.0, 1.0);\n  vsOutput.tex_coord = xy * 0.5 + 0.5;\n  vsOutput.tex_coord.y = 1.0 - vsOutput.tex_coord.y;\n  vsOutput.tex_coord.x = vsOutput.tex_coord.x * ${this.vertexScale.width};\n  vsOutput.tex_coord.y = vsOutput.tex_coord.y * ${this.vertexScale.height};\n  return vsOutput;\n}`;
        }
        defaultPipelineConfig() {
          return { label: `${this.label}-pipeline`, layout: "auto", vertex: { module: this.shader, entryPoint: "vertexMain" }, fragment: { module: this.shader, entryPoint: "fragmentMain", targets: [{ format: this.output.format }] } };
        }
        defaultSetup() {
          this.pipeline = this.device.createRenderPipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup(), this.renderPassDescriptor = this.defaultRenderPassDescriptor();
        }
        defaultRenderPassDescriptor() {
          return { label: `${this.label}-render-pass`, colorAttachments: [{ view: this.output.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }] };
        }
        run() {
          const t = this.device.createCommandEncoder({ label: this.label });
          this.pipeline || this.lazyLoadSetup();
          const e = t.beginRenderPass(this.renderPassDescriptor);
          e.setPipeline(this.pipeline), this.hasExternalTexture() && (this.bindGroup = this.defaultBindGroup()), this.bindGroup && e.setBindGroup(0, this.bindGroup), e.draw(6), e.end(), this.device.queue.submit([t.finish()]);
        }
        setOutput(t) { this.output = t, this.renderPassDescriptor = this.defaultRenderPassDescriptor(); }
      }
      e.default = n;
    },
    201: function (t, e, i) {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const n = i(181), s = i(200), o = i(844), a = i(49), l = i(244), c = i(541), u = i(461);
      class d extends n.default {
        constructor(t) { super(t); }
        model() {
          const t = [], e = this.weights.layers, i = this.context;
          t.push(new o.default([i.input], i.buffer("conv2d_tf"), e.conv2d_tf)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf1"), e.conv2d_tf1)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf2"), e.conv2d_tf2)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf3"), e.conv2d_tf3));
          for (let r = 1; r < 7; r++) {
            let n = 1 == r ? "conv2d_tf" : `conv2d_${r - 1}_tf`;
            const s = [];
            for (let t = 0; t < 4; t++) 0 == t ? s.push(i.buffer(n)) : s.push(i.buffer(n + `${t}`));
            for (let n = 0; n < 4; n++) 0 == n ? t.push(new l.default(s, i.buffer(`conv2d_${r}_tf`), e[`conv2d_${r}_tf`])) : t.push(new l.default(s, i.buffer(`conv2d_${r}_tf${n}`), e[`conv2d_${r}_tf${n}`]));
          }
          for (let r = 0; r < 3; r++) {
            const n = [], s = [], o = [], a = [];
            for (let t = 0; t < 7; t++) {
              let e = 0 == t ? "conv2d_tf" : `conv2d_${t}_tf`;
              n.push(i.buffer(e)), s.push(i.buffer(e + "1")), o.push(i.buffer(e + "2")), a.push(i.buffer(e + "3"));
            }
            const l = 0 == r ? "conv2d_last_tf" : `conv2d_last_tf${r}`;
            t.push(new u.default(n, i.buffer(`conv2d_last_${r}_pt1`), e[l], 0)),
            t.push(new u.default(s, i.buffer(`conv2d_last_${r}_pt2`), e[l], 1)),
            t.push(new u.default(o, i.buffer(`conv2d_last_${r}_pt3`), e[l], 2)),
            t.push(new u.default(a, i.buffer(`conv2d_last_${r}_pt4`), e[l], 3)),
            t.push(new c.default([i.buffer(`conv2d_last_${r}_pt1`), i.buffer(`conv2d_last_${r}_pt2`), i.buffer(`conv2d_last_${r}_pt3`), i.buffer(`conv2d_last_${r}_pt4`)], i.buffer(l), e[l]));
          }
          const r = new a.default([i.buffer("conv2d_last_tf"), i.buffer("conv2d_last_tf1"), i.buffer("conv2d_last_tf2"), i.input], i.texture("output"));
          return t.push(r), t;
        }
        async feedForward(t, e) {
          this.context.input = t;
          this.layers[0].inputs[0] = t, this.layers[1].inputs[0] = t, this.layers[2].inputs[0] = t, this.layers[3].inputs[0] = t,
          this.layers[this.layers.length - 1].inputs[3] = t;
          for (let i = 0; i < 4; i++) this.layers[i].lazyLoadSetup();
          const i = this.lastLayer();
          i instanceof s.default && i.setOutput(e), this.layers[this.layers.length - 1].lazyLoadSetup(), this.layers.forEach((t => t.run()));
        }
      }
      e.default = d;
    },
    242: (t, e) => {
      Object.defineProperty(e, "__esModule", { value: !0 }), e.default = class {
        constructor(t, e) {
          this.context = globalThis.context, this.device = this.context.device, this.sampler = this.device.createSampler({ addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", magFilter: "linear", minFilter: "linear" });
          const i = this.device.createShaderModule({
            label: "downscale-shader",
            code: "struct VertexShaderOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f };\n@vertex\nfn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexShaderOutput {\n  let pos = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));\n  var vsOutput: VertexShaderOutput;\n  let xy = pos[vertexIndex];\n  vsOutput.position = vec4f(xy, 0.0, 1.0);\n  vsOutput.tex_coord = xy * 0.5 + 0.5;\n  vsOutput.tex_coord.y = 1.0 - vsOutput.tex_coord.y;\n  return vsOutput;\n}\n@group(0) @binding(0) var inputTexture: texture_2d<f32>;\n@group(0) @binding(1) var ourSampler: sampler;\n@fragment\nfn fragmentMain(input: VertexShaderOutput) -> @location(0) vec4f {\n  return textureSample(inputTexture, ourSampler, input.tex_coord);\n}"
          });
          this.pipeline = this.device.createRenderPipeline({ label: "downscale-pipeline", layout: "auto", vertex: { module: i, entryPoint: "vertexMain" }, fragment: { module: i, entryPoint: "fragmentMain", targets: [{ format: e.format }] } });
          this.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: t.createView() }, { binding: 1, resource: this.sampler }] });
          this.renderPassDescriptor = { label: "downscale-render-pass", colorAttachments: [{ view: e.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }] };
        }
        setOutput(t) { this.renderPassDescriptor = { label: "downscale-render-pass", colorAttachments: [{ view: t.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }] }; }
        run() {
          const t = this.device.createCommandEncoder({ label: "downscale" }), e = t.beginRenderPass(this.renderPassDescriptor);
          e.setPipeline(this.pipeline), e.setBindGroup(0, this.bindGroup), e.draw(6), e.end(), this.device.queue.submit([t.finish()]);
        }
      };
    },
    244: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "Anime4KConv32x4";
          const r = i.weights, n = i.bias;
          this.createUniform("kernel_offsets", "array<vec4f, 9>"), this.createUniform("kernels", "array<mat4x4f, 72>"), this.createUniform("bias", "vec4f"),
          this.shader = this.createStandardShader(`\n          @compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n                let x = id.x;\n                let y = id.y;\n                let i = id.y*${this.resolution.width} + x;\n                var result = vec4f(0.0, 0.0, 0.0, 0.0);\n                let coord = vec2<i32>(i32(x), i32(y));\n                 for(var k = 0u; k < 9u; k++){\n                   let pixel_loc = coord + vec2<i32>(kernel_offsets[k].xy);\n                   if (pixel_loc.x >= 0 && pixel_loc.x < ${this.resolution.width} && pixel_loc.y >= 0 && pixel_loc.y < ${this.resolution.height}) {\n                     let buff_ind = pixel_loc.y*${this.resolution.width} + pixel_loc.x;\n                     let pix_val0 = inputBuffer0[buff_ind];\n                     let pix_val1 = inputBuffer1[buff_ind];\n                     let pix_val2 = inputBuffer2[buff_ind];\n                     let pix_val3 = inputBuffer3[buff_ind];\n                     result += kernels[k]*max(pix_val0, vec4f(0.0));\n                     result += kernels[k+9u]*max(pix_val1, vec4f(0.0));\n                     result += kernels[k+18u]*max(pix_val2, vec4f(0.0));\n                     result += kernels[k+27u]*max(pix_val3, vec4f(0.0));\n                     result += kernels[k+36u]*max(-1.0*pix_val0, vec4f(0.0));\n                     result += kernels[k+45u]*max(-1.0*pix_val1, vec4f(0.0));\n                     result += kernels[k+54u]*max(-1.0*pix_val2, vec4f(0.0));\n                     result += kernels[k+63u]*max(-1.0*pix_val3, vec4f(0.0));\n                   }\n                 }\n                result += bias;\n                outputBuffer[i] = result;\n          }\n        `),
          this.setUniform("kernel_offsets", new Float32Array([-1, -1, 0, 0, -1, 0, 0, 0, -1, 1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0])),
          this.setUniform("kernels", new Float32Array(r)), this.setUniform("bias", new Float32Array(n)), this.defaultSetup();
        }
      }
      e.default = n;
    },
    269: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i = !1) {
          super([t], e), this.label = "RealESRGANIngest", this.num_work_groups = 16, this.useF16 = i;
        }
        lazyLoadSetup() {
          const t = this.inputs[0] instanceof GPUExternalTexture;
          if (this.pipeline && this._builtForExternal === t) return;
          this._builtForExternal = t;
          const e = t ? "texture_external" : "texture_2d<f32>",
            i = t ? "textureLoad(inputTexture0, coord)" : "textureLoad(inputTexture0, coord, 0)",
            r = this.useF16 ? "vec4<f16>" : "vec4f",
            n = this.useF16 ? "enable f16;\n" : "",
            s = this.useF16 ? "vec4<f16>(vec3<f16>(v.rgb), 0.0h)" : "vec4f(v.rgb, 0.0)";
          this.shader = this.device.createShaderModule({
            label: `${this.label}-shader`,
            code: `${n}\n          @group(0) @binding(0) var inputTexture0: ${e};\n          @group(0) @binding(1) var<storage, read_write> outputBuffer: array<${r}>;\n\n          @compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups})\n          fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n              if (id.x >= ${this.resolution.width}u || id.y >= ${this.resolution.height}u) { return; }\n              let coord = vec2<i32>(i32(id.x), i32(id.y));\n              let v = ${i};\n              let idx = id.y * ${this.resolution.width}u + id.x;\n              outputBuffer[idx] = ${s};\n          }\n        `
          }), this.pipeline = this.device.createComputePipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup();
        }
      }
      e.default = n;
    },
    277: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "Anime4KConv56x4";
          const r = i.weights, n = i.bias;
          this.createUniform("kernel_offsets", "array<vec4f, 9>"), this.createUniform("kernels", "array<mat4x4f, 126>"), this.createUniform("bias", "vec4f"),
          this.shader = this.createStandardShader(`\n          @compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n                let x = id.x;\n                let y = id.y;\n                let i = id.y*${this.resolution.width} + x;\n                var result = vec4f(0.0, 0.0, 0.0, 0.0);\n                let coord = vec2<i32>(i32(x), i32(y));\n                 for(var k = 0u; k < 9u; k++){\n                   let pixel_loc = coord + vec2<i32>(kernel_offsets[k].xy);\n                   if (pixel_loc.x >= 0 && pixel_loc.x < ${this.resolution.width} && pixel_loc.y >= 0 && pixel_loc.y < ${this.resolution.height}) {\n                     let buff_ind = pixel_loc.y*${this.resolution.width} + pixel_loc.x;\n                     let pix_val0 = inputBuffer0[buff_ind];\n                     let pix_val1 = inputBuffer1[buff_ind];\n                     let pix_val2 = inputBuffer2[buff_ind];\n                     let pix_val3 = inputBuffer3[buff_ind];\n                     let pix_val4 = inputBuffer4[buff_ind];\n                     let pix_val5 = inputBuffer5[buff_ind];\n                     let pix_val6 = inputBuffer6[buff_ind];\n                     result += kernels[k]*max(pix_val0, vec4f(0.0));\n                     result += kernels[k+9u]*max(pix_val1, vec4f(0.0));\n                     result += kernels[k+18u]*max(pix_val2, vec4f(0.0));\n                     result += kernels[k+27u]*max(pix_val3, vec4f(0.0));\n                     result += kernels[k+36u]*max(-1.0*pix_val0, vec4f(0.0));\n                     result += kernels[k+45u]*max(-1.0*pix_val1, vec4f(0.0));\n                     result += kernels[k+54u]*max(-1.0*pix_val2, vec4f(0.0));\n                     result += kernels[k+63u]*max(-1.0*pix_val3, vec4f(0.0));\n                     result += kernels[k+72u]*max(-1.0*pix_val4, vec4f(0.0));\n                     result += kernels[k+81u]*max(-1.0*pix_val5, vec4f(0.0));\n                     result += kernels[k+90u]*max(-1.0*pix_val6, vec4f(0.0));\n                     result += kernels[k+99u]*max(-1.0*pix_val0, vec4f(0.0));\n                     result += kernels[k+108u]*max(-1.0*pix_val1, vec4f(0.0));\n                     result += kernels[k+117u]*max(-1.0*pix_val2, vec4f(0.0));\n                   }\n                 }\n                result += bias;\n                outputBuffer[i] = result;\n          }\n        `),
          this.setUniform("kernel_offsets", new Float32Array([-1, -1, 0, 0, -1, 0, 0, 0, -1, 1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0])),
          this.setUniform("kernels", new Float32Array(r)), this.setUniform("bias", new Float32Array(n)), this.defaultSetup();
        }
      }
      e.default = n;
    },
    297: (t, e) => {
      Object.defineProperty(e, "__esModule", { value: !0 }), e.default = class {
        constructor(t, e, i) {
          this.context = globalThis.context, this.device = this.context.device, this.resolution = this.context.processResolution, this.inputs = t, this.output = e, this.uniforms = [], this.buffers = {}, this.weights = i;
        }
        createUniform(t, e) { this.uniforms.push({ name: t, type: e }); }
        setUniform(t, e) {
          const i = this.device.createBuffer({ label: `layer-${this.label}-buffer-${t}`, size: e.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          this.device.queue.writeBuffer(i, 0, e), this.buffers[t] = i;
        }
        defaultBindGroup() {
          const t = [];
          return this.inputs.forEach((function (e, i) {
            e instanceof GPUExternalTexture ? t.push({ binding: i, resource: e }) : e instanceof GPUTexture ? t.push({ binding: i, resource: e.createView() }) : e instanceof GPUBuffer && t.push({ binding: i, resource: { buffer: e } });
          })), this.uniforms.forEach(((e, i) => {
            t.push({ binding: i + this.inputs.length, resource: { buffer: this.buffers[e.name] } });
          })), this.output instanceof GPUBuffer && t.push({ binding: this.inputs.length + this.uniforms.length, resource: { buffer: this.output } }), 0 === t.length ? null : this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: t });
        }
        hasExternalTexture() {
          for (const t of this.inputs) if (t instanceof GPUExternalTexture) return !0;
          return !1;
        }
        lazyLoadSetup() {}
        run() {}
      };
    },
    334: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "SR2XSPointwise";
          const r = i.weights, n = i.bias;
          this.createUniform("kernels", "array<mat4x4f, 32>"), this.createUniform("bias", "array<vec4f, 4>"), this.setUniform("kernels", new Float32Array(r)), this.setUniform("bias", new Float32Array(n));
        }
        lazyLoadSetup() {
          const t = this.resolution.width;
          this.shader = this.createStandardShader(`\n          @compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups})\n          fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n                let x = id.x;\n                let y = id.y;\n                let pix_base = (y * ${t}u + x) * 4u;\n                for (var o = 0u; o < 4u; o++) {\n                    var result = vec4f(0.0);\n                    for (var i = 0u; i < 4u; i++) {\n                        let pix = inputBuffer0[pix_base + i];\n                        result += kernels[o * 4u + i] * max(pix, vec4f(0.0));\n                        result += kernels[16u + o * 4u + i] * max(-pix, vec4f(0.0));\n                    }\n                    result += bias[o];\n                    outputBuffer[pix_base + o] = result;\n                }\n          }\n        `), this.pipeline = this.device.createComputePipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup();
        }
      }
      e.default = n;
    },
    386: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 }), e.NetworkTilePadding = e.NetworkTileAlign = e.NetworkMaxBufferBytesPerPixel = e.NetworkBytesPerPixel = e.NetworkBufferCounts = e.NetworkScales = e.NetworkList = void 0;
      const r = i(892), n = i(201), s = i(728), o = i(67), a = i(975), l = i(168);
      e.NetworkList = { "anime4k/cnn-2x-l": r.default, "anime4k/cnn-2x-16": n.default, "anime4k/cnn-2x-28": s.default, "realesrgan/x4v3": o.default, "sr2/cnn-2x-xs": a.default, "katana/unet-u24": l.default, "katana/unet-u32": l.default },
      e.NetworkScales = { "anime4k/cnn-2x-l": 2, "anime4k/cnn-2x-16": 2, "anime4k/cnn-2x-28": 2, "realesrgan/x4v3": 4, "sr2/cnn-2x-xs": 2, "katana/unet-u24": 2, "katana/unet-u32": 2 },
      e.NetworkBufferCounts = { "anime4k/cnn-2x-l": 23, "anime4k/cnn-2x-16": 43, "anime4k/cnn-2x-28": 73, "realesrgan/x4v3": 8, "sr2/cnn-2x-xs": 5, "katana/unet-u24": 1, "katana/unet-u32": 1 },
      e.NetworkBytesPerPixel = { "anime4k/cnn-2x-l": 16, "anime4k/cnn-2x-16": 16, "anime4k/cnn-2x-28": 16, "realesrgan/x4v3": 512, "sr2/cnn-2x-xs": 64, "katana/unet-u24": 544, "katana/unet-u32": 704 },
      e.NetworkMaxBufferBytesPerPixel = { "katana/unet-u24": 192, "katana/unet-u32": 256 },
      e.NetworkTileAlign = { "katana/unet-u24": 4, "katana/unet-u32": 4 },
      e.NetworkTilePadding = { "anime4k/cnn-2x-l": 12, "anime4k/cnn-2x-16": 12, "anime4k/cnn-2x-28": 12, "realesrgan/x4v3": 34, "sr2/cnn-2x-xs": 4, "katana/unet-u24": 36, "katana/unet-u32": 36 };
    },
    403: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i, r) {
          super(t, e, i), this.label = "Anime4KConv392x4";
          const n = i.weights;
          this.createUniform("kernels", "array<mat4x4f, 98>");
          let s = "";
          for (let t = 0; t < 7; t++) s += `\nlet pixel_val${t} = inputBuffer${t}[buff_ind];\nresult += kernels[${14 * t + r}]*max(pixel_val${t}, vec4f(0.0));\nresult += kernels[${14 * t + 7 + r}]*max(-1.0*pixel_val${t}, vec4f(0.0));`;
          this.shader = this.createStandardShader(`\n@compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n  let x = id.x;\n  let y = id.y;\n  let i = id.y*${this.resolution.width} + x;\n  var result = vec4f(0.0, 0.0, 0.0, 0.0);\n  let coord = vec2<i32>(i32(x), i32(y));\n  let buff_ind = coord.y*${this.resolution.width} + coord.x;\n  ${s}\n  outputBuffer[i] = result;\n}\n`), this.setUniform("kernels", new Float32Array(n)), this.defaultSetup();
        }
        defaultPipelineConfig() { return { label: `${this.label}-pipeline`, layout: "auto", compute: { module: this.shader, entryPoint: "main" } }; }
        defaultBindGroup() {
          const t = [];
          return this.inputs.forEach((function (e, i) {
            e instanceof GPUExternalTexture ? t.push({ binding: i, resource: e }) : e instanceof GPUTexture ? t.push({ binding: i, resource: e.createView() }) : e instanceof GPUBuffer && t.push({ binding: i, resource: { buffer: e } });
          })), this.uniforms.forEach(((e, i) => {
            t.push({ binding: i + this.inputs.length, resource: { buffer: this.buffers[e.name] } });
          })), this.output instanceof GPUBuffer && t.push({ binding: this.inputs.length + this.uniforms.length, resource: { buffer: this.output } }), 0 === t.length ? null : this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: t });
        }
      }
      e.default = n;
    },
    461: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i, r) {
          super(t, e, i), this.label = "Anime4KConv224x4";
          const n = i.weights;
          this.createUniform("kernels", "array<mat4x4f, 56>");
          let s = "";
          for (let t = 0; t < 7; t++) s += `\nlet pixel_val${t} = inputBuffer${t}[buff_ind];\nresult += kernels[${8 * t + r}]*max(pixel_val${t}, vec4f(0.0));\nresult += kernels[${8 * t + 4 + r}]*max(-1.0*pixel_val${t}, vec4f(0.0));`;
          this.shader = this.createStandardShader(`\n@compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n  let x = id.x;\n  let y = id.y;\n  let i = id.y*${this.resolution.width} + x;\n  var result = vec4f(0.0, 0.0, 0.0, 0.0);\n  let coord = vec2<i32>(i32(x), i32(y));\n  let buff_ind = coord.y*${this.resolution.width} + coord.x;\n  ${s}\n  outputBuffer[i] = result;\n}\n`), this.setUniform("kernels", new Float32Array(n)), this.defaultSetup();
        }
        defaultPipelineConfig() { return { label: `${this.label}-pipeline`, layout: "auto", compute: { module: this.shader, entryPoint: "main" } }; }
        defaultBindGroup() {
          const t = [];
          return this.inputs.forEach((function (e, i) {
            e instanceof GPUExternalTexture ? t.push({ binding: i, resource: e }) : e instanceof GPUTexture ? t.push({ binding: i, resource: e.createView() }) : e instanceof GPUBuffer && t.push({ binding: i, resource: { buffer: e } });
          })), this.uniforms.forEach(((e, i) => {
            t.push({ binding: i + this.inputs.length, resource: { buffer: this.buffers[e.name] } });
          })), this.output instanceof GPUBuffer && t.push({ binding: this.inputs.length + this.uniforms.length, resource: { buffer: this.output } }), 0 === t.length ? null : this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: t });
        }
      }
      e.default = n;
    },
    471: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(200);
      class n extends r.default {
        constructor(t, e, i = !1) {
          super(t, e), this.label = "RealESRGANOutputX4", this.useF16 = i, this.vertexScale = { width: 1, height: 1 }, this.sampler = this.device.createSampler({ addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", magFilter: "nearest", minFilter: "nearest" });
        }
        lazyLoadSetup() {
          const t = this.inputs[1] instanceof GPUExternalTexture;
          if (this.pipeline && this._builtForExternal === t) return;
          this._builtForExternal = t;
          const e = t ? "texture_external" : "texture_2d<f32>",
            i = t ? "textureSampleBaseClampToEdge(inputTexture, ourSampler, in.tex_coord)" : "textureSample(inputTexture, ourSampler, in.tex_coord)",
            r = this.useF16 ? "enable f16;\n" : "",
            n = this.useF16 ? "vec4<f16>" : "vec4f",
            s = this.useF16 ? "f32(" : "",
            o = this.useF16 ? ")" : "";
          this.shader = this.device.createShaderModule({
            label: `${this.label}-shader`,
            code: `${r}\n              ${this.defaultVertexShader()}\n\n              @group(0) @binding(0) var<storage, read> inputBuffer0: array<${n}>;\n              @group(0) @binding(1) var inputTexture: ${e};\n              @group(0) @binding(2) var ourSampler: sampler;\n\n              @fragment fn fragmentMain(in: VertexShaderOutput) -> @location(0) vec4f {\n                  let x = ${this.resolution.width}.0 * in.tex_coord.x;\n                  let y = ${this.resolution.height}.0 * in.tex_coord.y;\n                  let ix = u32(floor(x));\n                  let iy = u32(floor(y));\n                  let sub_x = u32(floor(fract(x) * 4.0));\n                  let sub_y = u32(floor(fract(y) * 4.0));\n                  let pixel_base = (iy * ${this.resolution.width}u + ix) * 12u;\n                  let r = ${s}inputBuffer0[pixel_base + sub_y][sub_x]${o};\n                  let g = ${s}inputBuffer0[pixel_base + 4u + sub_y][sub_x]${o};\n                  let b = ${s}inputBuffer0[pixel_base + 8u + sub_y][sub_x]${o};\n                  let res = ${i};\n                  return vec4f(r + res.r, g + res.g, b + res.b, 1.0);\n              }\n            `
          }), this.pipeline = this.device.createRenderPipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup(), this.renderPassDescriptor = this.defaultRenderPassDescriptor();
        }
        defaultBindGroup() {
          const t = [];
          return this.inputs.forEach(((e, i) => {
            e instanceof GPUExternalTexture ? t.push({ binding: i, resource: e }) : e instanceof GPUTexture ? t.push({ binding: i, resource: e.createView() }) : e instanceof GPUBuffer && t.push({ binding: i, resource: { buffer: e } });
          })), t.push({ binding: this.inputs.length, resource: this.sampler }), this.device.createBindGroup({ label: `${this.label}-bg`, layout: this.pipeline.getBindGroupLayout(0), entries: t });
        }
      }
      e.default = n;
    },
    518: function (t, e, i) {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const n = i(242), s = i(968), o = i(116);
      e.default = class {
        constructor(t, e, i = 12, r) {
          if (this.context = globalThis.context, this.network = t, this.source = r, this.active = !1, this.nominalTileResolution = null != e ? e : this.context.processResolution, this.tilePadding = i, this.tiles = this.calculateTileGrid(), this.needsDownscale()) {
            const t = this.context.scale, e = this.context.canvasResolution.width * t, i = this.context.canvasResolution.height * t,
              r = this.context.texture("upscaled_intermediate", { width: e, height: i, format: navigator.gpu.getPreferredCanvasFormat() }),
              s = this.context.context.getCurrentTexture();
            this.downscaleLayer = new n.default(r, s);
          }
          console.log(`[WebGPU Renderer]: Configured with ${this.tiles.length} tiles`);
        }
        switchNetwork(t) { this.network = t; }
        needsDownscale() {
          const t = this.context.scale, e = this.context.outputResolution;
          return e.width !== this.context.canvasResolution.width * t || e.height !== this.context.canvasResolution.height * t;
        }
        isTiling() { return this.tiles.length > 1; }
        calculateTileGrid() {
          const t = [], e = this.context.scale, i = this.nominalTileResolution.width, r = this.nominalTileResolution.height,
            n = this.context.canvasResolution.width, s = this.context.canvasResolution.height;
          for (let o = 0; o < s; o += r)
            for (let a = 0; a < n; a += i) {
              const l = Math.min(i, n - a), c = Math.min(r, s - o), u = Math.min(this.tilePadding, a), d = Math.min(this.tilePadding, o),
                h = Math.min(this.tilePadding, n - (a + l)), p = Math.min(this.tilePadding, s - (o + c));
              t.push({ srcX: a - u, srcY: o - d, srcW: l + u + h, srcH: c + d + p, cropX: u * e, cropY: d * e, dstX: a * e, dstY: o * e, dstW: l * e, dstH: c * e });
            }
          return t;
        }
        async render(t, e) {
          let i, r = null != t ? t : this.source;
          !(0, o.isVideoFrame)(r) && !(0, o.isHTMLVideoElement)(r) || (0, o.externalTexturesSupported)(this.context.device, r) || (r = i = await createImageBitmap(r));
          try {
            const t = this.resampleIfNeeded(r);
            this.isTiling() ? await this.renderTiled(r, e, t) : await this.renderSingle(r, e, t);
            if (this.downscaleLayer) {
              const t = this.context.context.getCurrentTexture();
              this.downscaleLayer.setOutput(t), this.downscaleLayer.run();
            }
          } finally {
            null == i || i.close();
          }
        }
        resampleIfNeeded(t) {
          const e = (0, o.getSourceWidth)(t), i = (0, o.getSourceHeight)(t), { width: r, height: n } = this.context.canvasResolution;
          if (e !== r || i !== n) return this.resampler().run(t, e, i, r, n);
        }
        resampler() {
          return this.resampleLayer || (this.resampleLayer = new s.default), this.resampleLayer;
        }
        async renderSingle(t, e, i) {
          let r;
          if (i) r = i;
          else if ((0, o.isHTMLVideoElement)(t) || (0, o.isVideoFrame)(t)) r = this.context.device.importExternalTexture({ source: t });
          else {
            const e = (0, o.isImageBitmap)(t) ? t : await createImageBitmap(t), i = (0, o.getSourceWidth)(t), n = (0, o.getSourceHeight)(t);
            this.context.device.queue.copyExternalImageToTexture({ source: e }, { texture: this.context.texture("input", { format: "rgba8unorm" }) }, [i, n]), r = this.context.texture("input");
          }
          if (this.downscaleLayer) {
            const t = this.context.texture("upscaled_intermediate");
            await this.network.feedForward(r, t);
          } else {
            const t = this.context.context.getCurrentTexture();
            await this.network.feedForward(r, t);
          }
          e && (await this.context.device.queue.onSubmittedWorkDone(), e(1, 1));
        }
        async renderTiled(t, e, i) {
          const r = null != i ? i : await this.materializeInput(t), n = this.context.scale,
            s = !this.downscaleLayer && !!e,
            o = this.downscaleLayer ? this.context.texture("upscaled_intermediate") : s ? this.context.texture("stitched_output", { width: this.context.canvasResolution.width * n, height: this.context.canvasResolution.height * n, format: navigator.gpu.getPreferredCanvasFormat() }) : this.context.context.getCurrentTexture(),
            a = this.context.texture("input", { format: "rgba8unorm" }),
            l = this.context.processResolution.width * n, c = this.context.processResolution.height * n,
            u = this.context.texture("tile_output", { width: l, height: c, format: navigator.gpu.getPreferredCanvasFormat() });
          for (let t = 0; t < this.tiles.length; t++) {
            const i = this.tiles[t], n = this.context.device.createCommandEncoder();
            n.beginRenderPass({ colorAttachments: [{ view: a.createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }] }).end(),
            n.copyTextureToTexture({ texture: r, origin: { x: i.srcX, y: i.srcY } }, { texture: a }, { width: i.srcW, height: i.srcH }),
            this.context.device.queue.submit([n.finish()]),
            await this.network.feedForward(a, u);
            const s = this.context.device.createCommandEncoder();
            s.copyTextureToTexture({ texture: u, origin: { x: i.cropX, y: i.cropY } }, { texture: o, origin: { x: i.dstX, y: i.dstY } }, { width: i.dstW, height: i.dstH }),
            this.context.device.queue.submit([s.finish()]),
            e && (await this.context.device.queue.onSubmittedWorkDone(), e(t + 1, this.tiles.length));
          }
        }
        destroy() { this.context.destroy(); }
      };
    },
    242: (t, e) => {
      Object.defineProperty(e, "__esModule", { value: !0 }), e.default = class {
        constructor(t, e) {
          this.context = globalThis.context, this.device = this.context.device, this.sampler = this.device.createSampler({ addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", magFilter: "linear", minFilter: "linear" });
          const i = this.device.createShaderModule({
            label: "downscale-shader",
            code: "struct VertexShaderOutput { @builtin(position) position: vec4f, @location(0) tex_coord: vec2f };\n@vertex\nfn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexShaderOutput {\n  let pos = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));\n  var vsOutput: VertexShaderOutput;\n  let xy = pos[vertexIndex];\n  vsOutput.position = vec4f(xy, 0.0, 1.0);\n  vsOutput.tex_coord = xy * 0.5 + 0.5;\n  vsOutput.tex_coord.y = 1.0 - vsOutput.tex_coord.y;\n  return vsOutput;\n}\n@group(0) @binding(0) var inputTexture: texture_2d<f32>;\n@group(0) @binding(1) var ourSampler: sampler;\n@fragment\nfn fragmentMain(input: VertexShaderOutput) -> @location(0) vec4f {\n  return textureSample(inputTexture, ourSampler, input.tex_coord);\n}"
          });
          this.pipeline = this.device.createRenderPipeline({ label: "downscale-pipeline", layout: "auto", vertex: { module: i, entryPoint: "vertexMain" }, fragment: { module: i, entryPoint: "fragmentMain", targets: [{ format: e.format }] } });
          this.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: t.createView() }, { binding: 1, resource: this.sampler }] });
          this.renderPassDescriptor = { label: "downscale-render-pass", colorAttachments: [{ view: e.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }] };
        }
        setOutput(t) { this.renderPassDescriptor = { label: "downscale-render-pass", colorAttachments: [{ view: t.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }] }; }
        run() {
          const t = this.device.createCommandEncoder({ label: "downscale" }), e = t.beginRenderPass(this.renderPassDescriptor);
          e.setPipeline(this.pipeline), e.setBindGroup(0, this.bindGroup), e.draw(6), e.end(), this.device.queue.submit([t.finish()]);
        }
      };
    },
    535: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "SR2XSStem";
          const r = i.weights, n = i.bias;
          this.createUniform("kernel_offsets", "array<vec4f, 9>"), this.createUniform("kernels", "array<mat4x4f, 36>"), this.createUniform("bias", "array<vec4f, 4>"),
          this.setUniform("kernel_offsets", new Float32Array([-1, -1, 0, 0, -1, 0, 0, 0, -1, 1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0])),
          this.setUniform("kernels", new Float32Array(r)), this.setUniform("bias", new Float32Array(n));
        }
        lazyLoadSetup() {
          const t = this.inputs[0] instanceof GPUExternalTexture ? "textureLoad(inputTexture0, coord + offset)" : "textureLoad(inputTexture0, coord + offset, 0)";
          this.shader = this.createStandardShader(`\n          @compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups})\n          fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n                let x = id.x;\n                let y = id.y;\n                let coord = vec2<i32>(i32(x), i32(y));\n                let pix_base = (y * ${this.resolution.width}u + x) * 4u;\n                for (var o = 0u; o < 4u; o++) {\n                    var result = vec4f(0.0);\n                    for (var k = 0u; k < 9u; k++) {\n                        let offset = vec2<i32>(kernel_offsets[k].xy);\n                        result += kernels[k * 4u + o] * ${t};\n                    }\n                    result += bias[o];\n                    outputBuffer[pix_base + o] = result;\n                }\n          }\n        `), this.pipeline = this.device.createComputePipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup();
        }
      }
      e.default = n;
    },
    540: function (t, e, i) {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const n = i(58), s = i(518), o = i(386), a = i(116), l = i(704);
      class d {
        constructor(t) {
          if (this.initialized = !1, this.alphaCache = new WeakMap, !o.NetworkList[t.network_name])
            throw Error(`Network ${t.network_name} is not defined or implemented`);
          this.params = t, this.canvas = t.canvas, this.scale = o.NetworkScales[t.network_name], this.debug = t.debug, this.tier = (0, a.getGPUTier)(t.tier);
        }
        initialize() {
          var t;
          if (!this.processResolution || !this.canvasResolution) throw new Error("Cannot initialize without resolution");
          const e = null !== (t = this.params.outputResolution) && void 0 !== t ? t : { width: this.canvasResolution.width * this.scale, height: this.canvasResolution.height * this.scale };
          this.canvas.width = e.width, this.canvas.height = e.height,
          this.context = new n.default(this.params.gpu, this.processResolution, this.canvasResolution, this.canvas, this.scale, this.debug, e, this.params.precision),
          globalThis.context = this.context;
          
          // Auto-normalize weights so missing .layers never crashes with undefined conv2d_tf
          let w = this.params.weights;
          if (w && !w.layers && !w.format && (w.conv2d_tf || w.conv2d_tf1)) {
            w = { name: "", layers: w };
          }

          this.network = new o.NetworkList[this.params.network_name](w),
          this.renderer = new s.default(this.network, this.nominalTileResolution, o.NetworkTilePadding[this.params.network_name]);
          this.initialized = !0;
        }
        async switchNetwork(t, e) {
          // AWAIT GPU FLUSH before cleaning up buffers to prevent "used in submit while destroyed" error!
          if (this.params.gpu && this.params.gpu.queue) {
            try { await this.params.gpu.queue.onSubmittedWorkDone(); } catch (err) {}
          }
          this.params = Object.assign(Object.assign({}, this.params), { network_name: t, weights: e }),
          this.context && this.context.cleanup(),
          this.planTiles(this.canvasResolution.width, this.canvasResolution.height),
          this.initialize();
        }
        planTiles(t, e) {
          var i;
          const r = this.params.network_name, n = o.NetworkTilePadding[r],
            s = null !== (i = o.NetworkTileAlign[r]) && void 0 !== i ? i : 1,
            a = o.NetworkMaxBufferBytesPerPixel[r],
            l = this.params.gpu.limits.maxStorageBufferBindingSize;
          let c = d.computeMaxTilePixels(r, this.tier, l);
          for (let i = 0; ; i++) {
            let r = d.computeOptimalGrid(t, e, c);
            const o = r.width < t || r.height < e;
            o && s > 1 && (r = { width: Math.ceil(r.width / s) * s, height: Math.ceil(r.height / s) * s });
            const u = o ? { width: r.width + 2 * n, height: r.height + 2 * n } : r;
            if (!a || u.width * u.height * a <= l || i >= 12)
              return this.nominalTileResolution = r, void (this.processResolution = u);
            c = Math.floor(.85 * c);
          }
        }
        setOutputResolution(t) {
          this.params = Object.assign(Object.assign({}, this.params), { outputResolution: t }),
          this.context && this.context.cleanup(),
          this.initialize();
        }
        static async initWebGPU() {
          if (!navigator.gpu) return !1;
          const t = await navigator.gpu.requestAdapter();
          if (!t) return !1;
          const e = t.features.has("shader-f16") ? ["shader-f16"] : [];
          return (await t.requestDevice({ requiredFeatures: e })) || !1;
        }
        static computeMaxTilePixels(t, e = 1, i = 134217728) {
          const r = o.NetworkBufferCounts[t], n = o.NetworkBytesPerPixel[t];
          let s = 1e8;
          s = 3 == e ? 1e9 : 2 == e ? 25e7 : 1 == e ? 1e8 : 5e7;
          let a = Math.floor(s / (r * n));
          const l = o.NetworkMaxBufferBytesPerPixel[t];
          return l && (a = Math.min(a, Math.floor(i / l))), a;
        }
        static computeOptimalGrid(t, e, i) {
          if (t * e <= i) return { width: t, height: e };
          let r = t, n = e;
          for (let s = 1; s <= t; s++) {
            const o = Math.ceil(t / s), a = Math.floor(i / o);
            if (a <= 0) break;
            const l = Math.ceil(e / a);
            if (o * Math.ceil(e / l) <= i && s * l < r * n && (r = s, n = l), 1 === l) break;
          }
          return { width: Math.ceil(t / r), height: Math.ceil(e / n) };
        }
        async render(t, e) {
          if (!t) throw new Error("render() requires a source parameter");
          const i = this.params.inputScale && this.params.inputScale > 0 ? this.params.inputScale : 1,
            r = { width: Math.max(1, Math.round((0, a.getSourceWidth)(t) / i)), height: Math.max(1, Math.round((0, a.getSourceHeight)(t) / i)) };
          this.initialized || (this.planTiles(r.width, r.height), this.canvasResolution = r, this.initialize()),
          this.pendingCalibration && (await this.pendingCalibration, this.pendingCalibration = void 0),
          await this.renderer.render(t, e);
        }
        async destroy() { 
          if (this.params.gpu && this.params.gpu.queue) {
            try { await this.params.gpu.queue.onSubmittedWorkDone(); } catch (err) {}
          }
          this.context && this.context.cleanup(); 
        }
      }
      d.parseBinaryWeights = l.parseBinaryWeights,
      d.parseUNetWeights = l.parseUNetWeights,
      e.default = d;
    },
    541: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "Anime4KConcat4", this.createUniform("bias", "vec4f");
          const r = i.bias;
          this.shader = this.createStandardShader(`\n@compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n  let x = id.x;\n  let y = id.y;\n  let i = id.y*${this.resolution.width} + x;\n  let coord = vec2<i32>(i32(x), i32(y));\n  let buff_ind = coord.y*${this.resolution.width} + coord.x;\n  outputBuffer[buff_ind] = inputBuffer0[buff_ind] + inputBuffer1[buff_ind] + inputBuffer2[buff_ind] + inputBuffer3[buff_ind] + bias;\n}\n`), this.setUniform("bias", new Float32Array(r)), this.defaultSetup();
        }
      }
      e.default = n;
    },
    548: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      function n(t) {
        const e = t ? "vec4<f16>" : "vec4f", i = t ? "vec4<f16>(0.0)" : "vec4f(0.0)";
        return `${t ? "enable f16;\n" : ""}struct Params {\n  width: u32, height: u32, in_vec4s: u32, out_vec4s: u32, apply_prelu: u32\n};\n@group(0) @binding(0) var<storage, read> input: array<${e}>;\n@group(0) @binding(1) var<storage, read_write> output: array<${e}>;\n@group(0) @binding(2) var<storage, read> kernels: array<${t ? "mat4x4<f16>" : "mat4x4f"}>;\n@group(0) @binding(3) var<storage, read> bias: array<${e}>;\n@group(0) @binding(4) var<storage, read> prelu_alpha: array<${e}>;\n@group(0) @binding(5) var<uniform> params: Params;\n\nfn act(v: ${e}, ov: u32) -> ${e} {\n  var r = v + bias[ov];\n  if (params.apply_prelu != 0u) {\n    let s = prelu_alpha[ov];\n    r = max(r, ${i}) + s * min(r, ${i});\n  }\n  return r;\n}\n@compute @workgroup_size(16, 16)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let ox = gid.x; let oy = gid.y;\n  if (ox >= params.width || oy >= params.height) { return; }\n  let IO = params.in_vec4s * params.out_vec4s;\n  for (var ob = 0u; ob < params.out_vec4s; ob = ob + 4u) {\n    let h1 = (ob + 1u) < params.out_vec4s;\n    let h2 = (ob + 2u) < params.out_vec4s;\n    let h3 = (ob + 3u) < params.out_vec4s;\n    let o0 = ob;\n    let o1 = select(ob, ob + 1u, h1);\n    let o2 = select(ob, ob + 2u, h2);\n    let o3 = select(ob, ob + 3u, h3);\n    var a0 = ${i}; var a1 = ${i}; var a2 = ${i}; var a3 = ${i};\n    for (var in_vec = 0u; in_vec < params.in_vec4s; in_vec = in_vec + 1u) {\n      for (var ky = 0u; ky < 3u; ky = ky + 1u) {\n        for (var kx = 0u; kx < 3u; kx = kx + 1u) {\n          let gx = i32(ox) + i32(kx) - 1; let gy = i32(oy) + i32(ky) - 1;\n          var v = ${i};\n          if (gx >= 0 && gx < i32(params.width) && gy >= 0 && gy < i32(params.height)) {\n            v = input[(u32(gy) * params.width + u32(gx)) * params.in_vec4s + in_vec];\n          }\n          let base = (ky * 3u + kx) * IO + in_vec * params.out_vec4s;\n          a0 = a0 + kernels[base + o0] * v;\n          a1 = a1 + kernels[base + o1] * v;\n          a2 = a2 + kernels[base + o2] * v;\n          a3 = a3 + kernels[base + o3] * v;\n        }\n      }\n    }\n    let rowBase = (oy * params.width + ox) * params.out_vec4s;\n    output[rowBase + o0] = act(a0, o0);\n    if (h1) { output[rowBase + o1] = act(a1, o1); }\n    if (h2) { output[rowBase + o2] = act(a2, o2); }\n    if (h3) { output[rowBase + o3] = act(a3, o3); }\n  }\n}\n`;
      }
      function s(t) { return t instanceof Float32Array ? t : Array.isArray(t) && t.length > 0 && Array.isArray(t[0]) ? new Float32Array([].concat.apply([], t)) : new Float32Array(t); }
      function o(t, e) { return e ? new Float16Array(t) : t; }
      class a extends r.default {
        constructor(t, e, i, r = !1) {
          super([t], e, i), this.label = "RealESRGANConv2DPReLU", this.num_work_groups = 16, this.inputBuf = t, this.outBuf = e, this.inVec4s = i.in_vec4s, this.outVec4s = i.out_vec4s, this.applyPReLU = "conv_prelu" === i.type;
          const a = o(s(i.matrices), r);
          this.kernelsBuf = this.device.createBuffer({ label: `${i.name}/kernels`, size: a.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), this.device.queue.writeBuffer(this.kernelsBuf, 0, a);
          const l = o(s(i.bias), r);
          this.biasBuf = this.device.createBuffer({ label: `${i.name}/bias`, size: l.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), this.device.queue.writeBuffer(this.biasBuf, 0, l);
          const c = o(this.applyPReLU ? s(i.alpha) : new Float32Array(4 * this.outVec4s), r);
          this.alphaBuf = this.device.createBuffer({ label: `${i.name}/alpha`, size: c.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), this.device.queue.writeBuffer(this.alphaBuf, 0, c);
          const u = new Uint32Array([this.resolution.width, this.resolution.height, this.inVec4s, this.outVec4s, this.applyPReLU ? 1 : 0]);
          this.paramsBuf = this.device.createBuffer({ label: `${i.name}/params`, size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), this.device.queue.writeBuffer(this.paramsBuf, 0, u),
          this.shader = this.device.createShaderModule({ label: `${this.label}-shader`, code: n(r) }),
          this.pipeline = this.device.createComputePipeline({ label: `${this.label}-pipeline`, layout: "auto", compute: { module: this.shader, entryPoint: "main" } }),
          this.bindGroup = this.device.createBindGroup({ label: `${this.label}-bg`, layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.inputBuf } }, { binding: 1, resource: { buffer: this.outBuf } }, { binding: 2, resource: { buffer: this.kernelsBuf } }, { binding: 3, resource: { buffer: this.biasBuf } }, { binding: 4, resource: { buffer: this.alphaBuf } }, { binding: 5, resource: { buffer: this.paramsBuf } }] });
        }
      }
      e.default = a;
    },
    612: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "Anime4KConcat7", this.createUniform("bias", "vec4f");
          const r = i.bias;
          this.shader = this.createStandardShader(`\n@compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n  let x = id.x;\n  let y = id.y;\n  let i = id.y*${this.resolution.width} + x;\n  let coord = vec2<i32>(i32(x), i32(y));\n  let buff_ind = coord.y*${this.resolution.width} + coord.x;\n  outputBuffer[buff_ind] = inputBuffer0[buff_ind] + inputBuffer1[buff_ind] + inputBuffer2[buff_ind] + inputBuffer3[buff_ind] + inputBuffer4[buff_ind] + inputBuffer5[buff_ind] + inputBuffer6[buff_ind] + bias;\n}\n`), this.setUniform("bias", new Float32Array(r)), this.defaultSetup();
        }
      }
      e.default = n;
    },
    646: function (t, e, i) {
      Object.defineProperty(e, "__esModule", { value: !0 }), e.MAX_THUMBNAILS = e.THUMB = void 0, e.thumbShader = o;
      e.foldShader = function (t) {
        return `${t ? "enable f16;\n" : ""}struct P { len: u32, banks: u32, _a: u32, _b: u32 }\n@group(0) @binding(0) var<storage, read> banks: array<vec4f>;\n@group(0) @binding(1) var<storage, read_write> out: array<${t ? "vec4<f16>" : "vec4f"}>;\n@group(0) @binding(2) var<uniform> p: P;\n@group(0) @binding(3) var<uniform> alpha: array<vec4f, 2>;\n\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n    let i = gid.x;\n    if (i >= p.len) { return; }\n    var acc = vec4f(0.0);\n    for (var b = 0u; b < p.banks; b = b + 1u) {\n        acc = acc + alpha[b / 4u][b % 4u] * banks[b * p.len + i];\n    }\n    out[i] = ${t ? "vec4<f16>(acc)" : "acc"};\n}`;
      };
      e.THUMB = 32;
      const s = 3 * e.THUMB * e.THUMB;
      function o(t) {
        const i = t ? "textureLoad(frame, vec2<u32>(x, y))" : "textureLoad(frame, vec2<u32>(x, y), 0)";
        return `struct P { w: u32, h: u32, slot: u32, _pad: u32 }\n@group(0) @binding(0) var frame: ${t ? "texture_external" : "texture_2d<f32>"};\n@group(0) @binding(1) var<uniform> p: P;\n@group(0) @binding(2) var<storage, read_write> thumbs: array<f32>;\n@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let j = gid.x; let i = gid.y;\n  if (i >= ${e.THUMB}u || j >= ${e.THUMB}u) { return; }\n  let y0 = (i * p.h) / ${e.THUMB}u;\n  let y1 = ((i + 1u) * p.h + ${e.THUMB - 1}u) / ${e.THUMB}u;\n  let x0 = (j * p.w) / ${e.THUMB}u;\n  let x1 = ((j + 1u) * p.w + ${e.THUMB - 1}u) / ${e.THUMB}u;\n  var acc = vec3f(0.0);\n  for (var y = y0; y < y1; y = y + 1u) {\n    for (var x = x0; x < x1; x = x + 1u) { acc = acc + ${i}.rgb; }\n  }\n  let m = acc / f32((y1 - y0) * (x1 - x0));\n  let base = p.slot * ${s}u + i * ${e.THUMB}u + j;\n  thumbs[base] = m.r; thumbs[base + ${e.THUMB * e.THUMB}u] = m.g; thumbs[base + ${2 * e.THUMB * e.THUMB}u] = m.b;\n}`;
      }
    },
    704: (t, e) => {
      Object.defineProperty(e, "__esModule", { value: !0 }),
      e.parseBinaryWeights = function (t) {
        const e = new DataView(t);
        let r = 0;
        const n = e.getUint32(r, !0);
        if (r += 4, 5649496 !== n) throw new Error(`parseBinaryWeights: unknown magic 0x${n.toString(16)} (expected X4V\\0)`);
        const s = e.getUint32(r, !0);
        r += 4;
        const o = e.getUint32(r, !0);
        r += 4, r += 4;
        const a = new TextDecoder, l = [];
        for (let i = 0; i < o; i++) {
          const i = e.getUint32(r, !0); r += 4;
          const n = a.decode(new Uint8Array(t, r, i)); r += i;
          const s = e.getUint32(r, !0); r += 4;
          const o = e.getUint32(r, !0); r += 4;
          const c = e.getUint32(r, !0); r += 4;
          const u = e.getUint32(r, !0); r += 4;
          const d = e.getUint32(r, !0); r += 4;
          const h = e.getUint32(r, !0); r += 4;
          const p = new Float32Array(t.slice(r, r + 4 * u)); r += 4 * u;
          const f = new Float32Array(t.slice(r, r + 4 * d)); r += 4 * d;
          const m = h > 0 ? new Float32Array(t.slice(r, r + 4 * h)) : void 0; r += 4 * h;
          l.push({ name: n, type: 1 === s ? "conv_prelu" : "conv", in_channels: o, out_channels: c, in_vec4s: Math.ceil(o / 4), out_vec4s: Math.ceil(c / 4), matrices: p, bias: f, alpha: m });
        }
        return { version: s, layers: l };
      },
      e.isUNetWeights = function (t) { return !(!t || "unet" !== t.format); },
      e.parseUNetWeights = function (t) {
        const e = new DataView(t), i = e.getUint32(0, !0);
        if (5525077 !== i) throw new Error(`parseUNetWeights: unknown magic 0x${i.toString(16)} (expected UNT\\0)`);
        const n = e.getUint32(4, !0);
        if (1 !== n) throw new Error(`parseUNetWeights: unsupported version ${n}`);
        const s = e.getUint32(8, !0),
          o = JSON.parse((new TextDecoder).decode(new Uint8Array(t, 12, s))),
          a = new Float32Array(t, 12 + s);
        return { format: "unet", meta: o, tensor: t => a.subarray(t.offset, t.offset + t.count) };
      };
    },
    728: function (t, e, i) {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const n = i(181), s = i(200), o = i(844), a = i(49), l = i(277), c = i(403), u = i(612);
      class d extends n.default {
        constructor(t) { super(t); }
        model() {
          const t = [], e = this.weights.layers, i = this.context;
          t.push(new o.default([i.input], i.buffer("conv2d_tf"), e.conv2d_tf)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf1"), e.conv2d_tf1)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf2"), e.conv2d_tf2)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf3"), e.conv2d_tf3)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf4"), e.conv2d_tf4)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf5"), e.conv2d_tf5)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf6"), e.conv2d_tf6));
          for (let r = 1; r < 7; r++) {
            let n = 1 == r ? "conv2d_tf" : `conv2d_${r - 1}_tf`;
            const s = [];
            for (let t = 0; t < 7; t++) 0 == t ? s.push(i.buffer(n)) : s.push(i.buffer(n + `${t}`));
            for (let n = 0; n < 7; n++) 0 == n ? t.push(new l.default(s, i.buffer(`conv2d_${r}_tf`), e[`conv2d_${r}_tf`])) : t.push(new l.default(s, i.buffer(`conv2d_${r}_tf${n}`), e[`conv2d_${r}_tf${n}`]));
          }
          for (let r = 0; r < 3; r++) {
            const n = [], s = [], o = [], a = [], l = [], d = [], h = [];
            for (let t = 0; t < 7; t++) {
              let e = 0 == t ? "conv2d_tf" : `conv2d_${t}_tf`;
              n.push(i.buffer(e)), s.push(i.buffer(e + "1")), o.push(i.buffer(e + "2")), a.push(i.buffer(e + "3")), l.push(i.buffer(e + "4")), d.push(i.buffer(e + "5")), h.push(i.buffer(e + "6"));
            }
            const p = 0 == r ? "conv2d_last_tf" : `conv2d_last_tf${r}`;
            t.push(new c.default(n, i.buffer(`conv2d_last_${r}_pt1`), e[p], 0)),
            t.push(new c.default(s, i.buffer(`conv2d_last_${r}_pt2`), e[p], 1)),
            t.push(new c.default(o, i.buffer(`conv2d_last_${r}_pt3`), e[p], 2)),
            t.push(new c.default(a, i.buffer(`conv2d_last_${r}_pt4`), e[p], 3)),
            t.push(new c.default(l, i.buffer(`conv2d_last_${r}_pt5`), e[p], 4)),
            t.push(new c.default(d, i.buffer(`conv2d_last_${r}_pt6`), e[p], 5)),
            t.push(new c.default(h, i.buffer(`conv2d_last_${r}_pt7`), e[p], 6)),
            t.push(new u.default([i.buffer(`conv2d_last_${r}_pt1`), i.buffer(`conv2d_last_${r}_pt2`), i.buffer(`conv2d_last_${r}_pt3`), i.buffer(`conv2d_last_${r}_pt4`), i.buffer(`conv2d_last_${r}_pt5`), i.buffer(`conv2d_last_${r}_pt6`), i.buffer(`conv2d_last_${r}_pt7`)], i.buffer(p), e[p]));
          }
          const r = new a.default([i.buffer("conv2d_last_tf"), i.buffer("conv2d_last_tf1"), i.buffer("conv2d_last_tf2"), i.input], i.texture("output"));
          return t.push(r), t;
        }
        async feedForward(t, e) {
          this.context.input = t;
          for (let i = 0; i < 7; i++) this.layers[i].inputs[0] = t, this.layers[i].lazyLoadSetup();
          this.layers[this.layers.length - 1].inputs[3] = t;
          const i = this.lastLayer();
          i instanceof s.default && i.setOutput(e), this.layers[this.layers.length - 1].lazyLoadSetup(), this.layers.forEach((t => t.run()));
        }
      }
      e.default = d;
    },
    844: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "Anime4KConv3x4";
          const r = i.weights, n = i.bias;
          this.createUniform("kernel_offsets", "array<vec4f, 9>"), this.createUniform("kernels", "array<mat4x4f, 9>"), this.createUniform("bias", "vec4f"),
          this.shader = this.createStandardShader(`\n@compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n  let x = id.x;\n  let y = id.y;\n  let i = id.y*${this.resolution.width} + x;\n  var result = vec4f(0.0, 0.0, 0.0, 0.0);\n  let coord = vec2<i32>(i32(x), i32(y));\n  for(var k = 0u; k < 9u; k++){\n    let offset = vec2<i32>(kernel_offsets[k].xy);\n    result += kernels[k]*vec4f(${this.inputs[0] instanceof GPUExternalTexture ? "textureLoad(inputTexture0, coord + offset)" : "textureLoad(inputTexture0, coord + offset, 0)"});\n  }\n  result += bias;\n  outputBuffer[i] = result;\n}\n`),
          this.setUniform("kernel_offsets", new Float32Array([-1, -1, 0, 0, -1, 0, 0, 0, -1, 1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0])),
          this.setUniform("kernels", new Float32Array(r)), this.setUniform("bias", new Float32Array(n)), this.defaultSetup();
        }
      }
      e.default = n;
    },
    889: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "SR2XSDepthwise";
          const r = i.weights, n = i.bias;
          this.createUniform("kernel_offsets", "array<vec4f, 9>"), this.createUniform("kernels", "array<vec4f, 72>"), this.createUniform("bias", "array<vec4f, 4>"),
          this.setUniform("kernel_offsets", new Float32Array([-1, -1, 0, 0, -1, 0, 0, 0, -1, 1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0])),
          this.setUniform("kernels", new Float32Array(r)), this.setUniform("bias", new Float32Array(n));
        }
        lazyLoadSetup() {
          const t = this.resolution.width, e = this.resolution.height;
          this.shader = this.createStandardShader(`\n@compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups})\nfn main(@builtin(global_invocation_id) id: vec3<u32>) {\n  let x = id.x; let y = id.y;\n  let coord = vec2<i32>(i32(x), i32(y));\n  let pix_base = (y * ${t}u + x) * 4u;\n  for (var g = 0u; g < 4u; g++) {\n    var result = vec4f(0.0);\n    for (var k = 0u; k < 9u; k++) {\n      let p = coord + vec2<i32>(kernel_offsets[k].xy);\n      if (p.x < 0 || p.y < 0 || p.x >= ${t} || p.y >= ${e}) { continue; }\n      let in_idx = (u32(p.y) * ${t}u + u32(p.x)) * 4u + g;\n      let pix = inputBuffer0[in_idx];\n      result += kernels[k * 4u + g] * max(pix, vec4f(0.0));\n      result += kernels[36u + k * 4u + g] * max(-pix, vec4f(0.0));\n    }\n    result += bias[g];\n    outputBuffer[pix_base + g] = result;\n  }\n}\n`), this.pipeline = this.device.createComputePipeline(this.defaultPipelineConfig()), this.bindGroup = this.defaultBindGroup();
        }
      }
      e.default = n;
    },
    892: function (t, e, i) {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const n = i(181), s = i(200), o = i(844), a = i(49), l = i(82), c = i(145), u = i(991);
      class d extends n.default {
        constructor(t) { super(t); }
        model() {
          const t = [], e = this.weights.layers, i = this.context;
          t.push(new o.default([i.input], i.buffer("conv2d_tf"), e.conv2d_tf)),
          t.push(new o.default([i.input], i.buffer("conv2d_tf1"), e.conv2d_tf1));
          for (let r = 1; r < 7; r++) {
            let n = 1 == r ? "conv2d_tf" : `conv2d_${r - 1}_tf`;
            t.push(new l.default([i.buffer(n), i.buffer(n + "1")], i.buffer(`conv2d_${r}_tf`), e[`conv2d_${r}_tf`])),
            t.push(new l.default([i.buffer(n), i.buffer(n + "1")], i.buffer(`conv2d_${r}_tf1`), e[`conv2d_${r}_tf1`]));
          }
          for (let r = 0; r < 3; r++) {
            const n = [], s = [];
            for (let t = 0; t < 7; t++) {
              let e = 0 == t ? "conv2d_tf" : `conv2d_${t}_tf`;
              n.push(i.buffer(e)), s.push(i.buffer(e + "1"));
            }
            const o = 0 == r ? "conv2d_last_tf" : `conv2d_last_tf${r}`;
            t.push(new c.default(n, i.buffer(`conv2d_last_${r}_pt1`), e[o], !0)),
            t.push(new c.default(s, i.buffer(`conv2d_last_${r}_pt2`), e[o], !1)),
            t.push(new u.default([i.buffer(`conv2d_last_${r}_pt1`), i.buffer(`conv2d_last_${r}_pt2`)], i.buffer(o), e[o]));
          }
          const r = new a.default([i.buffer("conv2d_last_tf"), i.buffer("conv2d_last_tf1"), i.buffer("conv2d_last_tf2"), i.input], i.texture("output"));
          return t.push(r), t;
        }
        async feedForward(t, e) {
          this.context.input = t;
          this.layers[0].inputs[0] = t, this.layers[1].inputs[0] = t,
          this.layers[this.layers.length - 1].inputs[3] = t;
          this.layers[0].lazyLoadSetup(), this.layers[1].lazyLoadSetup();
          const i = this.lastLayer();
          i instanceof s.default && i.setOutput(e), this.layers[this.layers.length - 1].lazyLoadSetup(), this.layers.forEach((function (t) { t.run(); }));
        }
      }
      e.default = d;
    },
    968: (t, e) => {
      Object.defineProperty(e, "__esModule", { value: !0 }), e.default = class {
        constructor() {
          this.pipelines = {}, this.context = globalThis.context, this.device = this.context.device;
        }
        run(t, e, i, r, n) {
          return this.context.texture("resample_out", { width: r, height: n, format: "rgba8unorm" });
        }
      };
    },
    975: function (t, e, i) {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const n = i(200), s = i(181), o = i(535), a = i(889), l = i(334), c = i(38);
      class u extends s.default {
        constructor(t) { super(t); }
        model() {
          const t = [], e = this.weights.layers, i = this.context, r = t => i.buffer(t, { channels: 16 });
          t.push(new o.default([i.input], r("stem"), e.stem));
          let n = "stem";
          for (let i = 0; e[`block${i}_dw`]; i++) {
            const s = `block${i}_dw`, o = `block${i}_pw`;
            t.push(new a.default([r(n)], r(s), e[s])), t.push(new l.default([r(s)], r(o), e[o])), n = o;
          }
          return e.projection && (t.push(new l.default([r(n)], r("projection"), e.projection)), n = "projection"), t.push(new c.default([r(n), i.input], i.texture("output"))), t;
        }
        async feedForward(t, e) {
          this.context.input = t;
          const i = this.layers[0], r = this.layers[this.layers.length - 1];
          i.inputs[0] = t, r.inputs[1] = t, i.lazyLoadSetup(), r instanceof n.default && r.setOutput(e), r.lazyLoadSetup(), this.layers.forEach((t => t.run()));
        }
      }
      e.default = u;
    },
    991: (t, e, i) => {
      Object.defineProperty(e, "__esModule", { value: !0 });
      const r = i(23);
      class n extends r.default {
        constructor(t, e, i) {
          super(t, e, i), this.label = "Anime4KConcat2", this.createUniform("bias", "vec4f");
          const r = i.bias;
          this.shader = this.createStandardShader(`\n@compute @workgroup_size(${this.num_work_groups}, ${this.num_work_groups}) fn main(@builtin(global_invocation_id) id: vec3<u32>) {\n  let x = id.x;\n  let y = id.y;\n  let i = id.y*${this.resolution.width} + x;\n  let coord = vec2<i32>(i32(x), i32(y));\n  let buff_ind = coord.y*${this.resolution.width} + coord.x;\n  outputBuffer[buff_ind] = inputBuffer0[buff_ind] + inputBuffer1[buff_ind] + bias;\n}\n`), this.setUniform("bias", new Float32Array(r)), this.defaultSetup();
        }
      }
      e.default = n;
    }
  };
  var e = {};
  return function i(r) {
    var n = e[r];
    if (void 0 !== n) return n.exports;
    var s = e[r] = { exports: {} };
    return t[r].call(s.exports, s, s.exports, i), s.exports;
  }(540).default;
})();

export default WebSR;