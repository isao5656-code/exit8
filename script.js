const anomalyDefinitions = [
  { key: 'signFlip', label: '右上の出口8看板が上下逆になっていました。' },
  { key: 'wrongNumber', label: '出口番号が8ではなく9になっていました。' },
  { key: 'redLight', label: '奥の蛍光灯が赤く点灯していました。' },
  { key: 'posterText', label: '左壁の青いポスターが「戻れ」に変わっていました。' },
  { key: 'missingHandle', label: '右壁の点検扉からノブが消えていました。' },
  { key: 'floorHole', label: '床タイルが一枚抜けて黒い穴になっていました。' },
  { key: 'npcHead', label: '通行人の頭が逆さまになっていました。' },
  { key: 'ventMoved', label: '右壁の換気口の位置が低くなっていました。' },
  { key: 'guideMissing', label: '黄色い点字ブロックが途中で途切れていました。' },
];

const state = {
  exitCount: 0,
  currentAnomaly: null,
  locked: false,
  yaw: 0,
  pitch: 0,
  targetYaw: 0,
  targetPitch: 0,
  move: null,
};

const elements = {
  canvas: document.querySelector('#gameCanvas'),
  message: document.querySelector('#message'),
  exitCount: document.querySelector('#exitCount'),
  statusText: document.querySelector('#statusText'),
  turnBackButton: document.querySelector('#turnBackButton'),
  goForwardButton: document.querySelector('#goForwardButton'),
  helpButton: document.querySelector('#helpButton'),
  helpDialog: document.querySelector('#helpDialog'),
  closeHelpButton: document.querySelector('#closeHelpButton'),
};

const gl = elements.canvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) {
  setMessage('この端末ではWebGLが使えないため、3D表示を開始できません。', 'bad');
}

const vertexShaderSource = `
attribute vec3 aPosition;
attribute vec2 aUv;
uniform mat4 uMvp;
varying vec2 vUv;
void main() {
  gl_Position = uMvp * vec4(aPosition, 1.0);
  vUv = aUv;
}`;

const fragmentShaderSource = `
precision mediump float;
uniform sampler2D uTexture;
uniform vec4 uColor;
uniform float uUseTexture;
uniform float uFade;
varying vec2 vUv;
void main() {
  vec4 tex = texture2D(uTexture, vUv);
  vec4 base = mix(uColor, tex * uColor, uUseTexture);
  gl_FragColor = vec4(base.rgb * uFade, base.a);
}`;

const meshes = [];
const objects = {};
const cameraBase = { x: 0, y: 1.62, z: 5.8 };
let program;
let locations;
let whiteTexture;
let projectionMatrix = identity();
let lastTime = performance.now();

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram() {
  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  const linkedProgram = gl.createProgram();
  gl.attachShader(linkedProgram, vertexShader);
  gl.attachShader(linkedProgram, fragmentShader);
  gl.linkProgram(linkedProgram);
  if (!gl.getProgramParameter(linkedProgram, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(linkedProgram));
  }
  return linkedProgram;
}

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0,
  ]);
}

function translation(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function rotationX(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotationY(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotationZ(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeTransform({ position = [0, 0, 0], rotation = [0, 0, 0] } = {}) {
  let matrix = identity();
  matrix = multiply(matrix, translation(position[0], position[1], position[2]));
  matrix = multiply(matrix, rotationX(rotation[0]));
  matrix = multiply(matrix, rotationY(rotation[1]));
  matrix = multiply(matrix, rotationZ(rotation[2]));
  return matrix;
}

function isPowerOfTwo(value) {
  return (value & (value - 1)) === 0;
}

function makeTexture(source, repeat = false) {
  const texture = gl.createTexture();
  const canRepeat = repeat && isPowerOfTwo(source.width) && isPowerOfTwo(source.height);
  const canMipmap = isPowerOfTwo(source.width) && isPowerOfTwo(source.height);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, canMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, canRepeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, canRepeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  if (canMipmap) gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
}

function makeSolidTexture(r, g, b, a = 255) {
  const data = new Uint8Array([r, g, b, a]);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

function createTextCanvas({ width = 512, height = 256, background = '#ffffff', color = '#111111', lines }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.24)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, width - 10, height - 10);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  lines.forEach((line) => {
    ctx.font = `${line.weight || 800} ${line.size}px system-ui, sans-serif`;
    ctx.fillText(line.text, line.x ?? width / 2, line.y);
  });
  return canvas;
}

function createTileCanvas(base, line, cells = 8) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  const step = size / cells;
  for (let i = 0; i <= cells; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }
  return canvas;
}

function createMesh(vertices, indices, options = {}) {
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  const mesh = {
    vertexBuffer,
    indexBuffer,
    count: indices.length,
    texture: options.texture || whiteTexture,
    color: options.color || [1, 1, 1, 1],
    useTexture: options.texture ? 1 : 0,
    position: options.position || [0, 0, 0],
    rotation: options.rotation || [0, 0, 0],
    visible: options.visible !== false,
    fade: options.fade || 1,
  };
  meshes.push(mesh);
  return mesh;
}

function addPlane(width, height, options = {}) {
  const u = options.uRepeat || 1;
  const v = options.vRepeat || 1;
  return createMesh([
    -width / 2, -height / 2, 0, 0, 0,
    width / 2, -height / 2, 0, u, 0,
    width / 2, height / 2, 0, u, v,
    -width / 2, height / 2, 0, 0, v,
  ], [0, 1, 2, 0, 2, 3], options);
}

function addBox(width, height, depth, options = {}) {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const vertices = [
    -x, -y, z, 0, 0, x, -y, z, 1, 0, x, y, z, 1, 1, -x, y, z, 0, 1,
    x, -y, -z, 0, 0, -x, -y, -z, 1, 0, -x, y, -z, 1, 1, x, y, -z, 0, 1,
    -x, y, z, 0, 0, x, y, z, 1, 0, x, y, -z, 1, 1, -x, y, -z, 0, 1,
    -x, -y, -z, 0, 0, x, -y, -z, 1, 0, x, -y, z, 1, 1, -x, -y, z, 0, 1,
    x, -y, z, 0, 0, x, -y, -z, 1, 0, x, y, -z, 1, 1, x, y, z, 0, 1,
    -x, -y, -z, 0, 0, -x, -y, z, 1, 0, -x, y, z, 1, 1, -x, y, -z, 0, 1,
  ];
  const indices = [];
  for (let i = 0; i < 6; i += 1) {
    const offset = i * 4;
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return createMesh(vertices, indices, options);
}

function buildWorld() {
  const wallTexture = makeTexture(createTileCanvas('#d9dddb', '#8b9294'), true);
  const floorTexture = makeTexture(createTileCanvas('#c7cbc9', '#81878a'), true);
  const ceilingTexture = makeTexture(createTileCanvas('#b8bcbc', '#7b8286'), true);

  addPlane(6, 34, { texture: floorTexture, position: [0, 0, -9], rotation: [-Math.PI / 2, 0, 0], uRepeat: 5, vRepeat: 18 });
  addPlane(6, 34, { texture: ceilingTexture, position: [0, 3.2, -9], rotation: [Math.PI / 2, 0, 0], uRepeat: 4, vRepeat: 14, fade: 0.92 });
  addPlane(34, 3.2, { texture: wallTexture, position: [-3, 1.6, -9], rotation: [0, Math.PI / 2, 0], uRepeat: 18, vRepeat: 3 });
  addPlane(34, 3.2, { texture: wallTexture, position: [3, 1.6, -9], rotation: [0, -Math.PI / 2, 0], uRepeat: 18, vRepeat: 3 });
  addPlane(6, 3.2, { texture: wallTexture, position: [0, 1.6, -25.8], rotation: [0, 0, 0], uRepeat: 4, vRepeat: 3, fade: 0.72 });

  objects.guideBlocks = [];
  for (let i = 0; i < 22; i += 1) {
    objects.guideBlocks.push(addBox(0.34, 0.035, 0.52, { color: [0.86, 0.69, 0.13, 1], position: [-1.25, 0.03, 4.4 - i * 0.9] }));
  }
  objects.floorHole = addPlane(0.72, 0.72, { color: [0.005, 0.01, 0.02, 1], position: [1.05, 0.035, -5.4], rotation: [-Math.PI / 2, 0, 0], visible: false });

  objects.normalExitTexture = makeTexture(createTextCanvas({
    width: 640,
    height: 360,
    background: '#ffe34d',
    color: '#050505',
    lines: [
      { text: '出口', x: 170, y: 118, size: 82, weight: 900 },
      { text: 'Exit', x: 170, y: 226, size: 54, weight: 800 },
      { text: '8', x: 470, y: 178, size: 190, weight: 900 },
    ],
  }));
  objects.wrongExitTexture = makeTexture(createTextCanvas({
    width: 640,
    height: 360,
    background: '#ffe34d',
    color: '#050505',
    lines: [
      { text: '出口', x: 170, y: 118, size: 82, weight: 900 },
      { text: 'Exit', x: 170, y: 226, size: 54, weight: 800 },
      { text: '9', x: 470, y: 178, size: 190, weight: 900 },
    ],
  }));
  objects.exitSign = addPlane(1.7, 0.95, { texture: objects.normalExitTexture, position: [2.96, 2.35, 1.2], rotation: [0, -Math.PI / 2, 0] });

  const overheadTexture = makeTexture(createTextCanvas({
    width: 640,
    height: 160,
    background: '#fff56a',
    color: '#111111',
    lines: [{ text: '↑ 出口 8', y: 80, size: 58, weight: 900 }],
  }));
  addPlane(2.35, 0.58, { texture: overheadTexture, position: [0, 2.72, 2.2] });

  objects.normalPosterTexture = makeTexture(createTextCanvas({
    width: 360,
    height: 520,
    background: '#1e7892',
    color: '#ffffff',
    lines: [
      { text: 'アルバイト', y: 120, size: 48, weight: 900 },
      { text: 'パート', y: 210, size: 48, weight: 900 },
      { text: '大募集', y: 320, size: 58, weight: 900 },
    ],
  }));
  objects.anomalyPosterTexture = makeTexture(createTextCanvas({
    width: 360,
    height: 520,
    background: '#111827',
    color: '#facc15',
    lines: [{ text: '戻れ', y: 260, size: 86, weight: 900 }],
  }));
  objects.poster = addPlane(0.8, 1.16, { texture: objects.normalPosterTexture, position: [-2.96, 1.55, 0.6], rotation: [0, Math.PI / 2, 0] });

  const creamPoster = makeTexture(createTextCanvas({
    width: 280,
    height: 420,
    background: '#f4ebcf',
    color: '#1f2937',
    lines: [{ text: '地下通路', y: 140, size: 38, weight: 800 }, { text: '案内', y: 240, size: 52, weight: 900 }],
  }));
  addPlane(0.62, 0.92, { texture: creamPoster, position: [-2.96, 1.52, -3.2], rotation: [0, Math.PI / 2, 0] });

  objects.door = addBox(0.05, 1.85, 0.82, { color: [0.74, 0.78, 0.77, 1], position: [2.97, 0.98, -2.8] });
  objects.handle = addBox(0.07, 0.07, 0.07, { color: [0.26, 0.31, 0.38, 1], position: [2.91, 0.98, -2.55] });
  objects.vent = addBox(0.05, 0.52, 0.7, { color: [0.13, 0.16, 0.2, 1], position: [2.97, 2.25, -0.6] });

  objects.tubeLights = [];
  [-1.2, -6.4, -11.6, -16.8, -22].forEach((z) => {
    objects.tubeLights.push(addBox(1.75, 0.055, 0.2, { color: [1, 1, 0.82, 1], position: [0, 3.03, z] }));
  });

  buildNpc();
}

function buildNpc() {
  objects.npcHeadParts = [];
  objects.npcHeadParts.push(addBox(0.34, 0.42, 0.26, { color: [0.72, 0.52, 0.41, 1], position: [0.05, 1.86, -5.8] }));
  objects.npcHeadParts.push(addBox(0.35, 0.08, 0.27, { color: [0.14, 0.09, 0.08, 1], position: [0.05, 2.1, -5.8] }));
  addBox(0.16, 0.16, 0.16, { color: [0.68, 0.45, 0.34, 1], position: [0.05, 1.58, -5.8] });
  addBox(0.58, 0.86, 0.22, { color: [0.73, 0.82, 0.85, 1], position: [0.05, 1.12, -5.8] });
  addBox(0.58, 0.08, 0.23, { color: [0.03, 0.04, 0.07, 1], position: [0.05, 0.68, -5.8] });
  addBox(0.13, 0.82, 0.15, { color: [0.72, 0.82, 0.85, 1], position: [-0.34, 1.08, -5.8], rotation: [0, 0, 0.14] });
  addBox(0.13, 0.82, 0.15, { color: [0.72, 0.82, 0.85, 1], position: [0.44, 1.08, -5.8], rotation: [0, 0, -0.14] });
  addBox(0.16, 0.82, 0.17, { color: [0.03, 0.04, 0.07, 1], position: [-0.1, 0.28, -5.8] });
  addBox(0.16, 0.82, 0.17, { color: [0.03, 0.04, 0.07, 1], position: [0.2, 0.28, -5.8] });
  addBox(0.22, 0.42, 0.1, { color: [0.02, 0.025, 0.035, 1], position: [-0.5, 0.72, -5.76] });
}

function resetAnomalies() {
  objects.exitSign.texture = objects.normalExitTexture;
  objects.exitSign.rotation = [0, -Math.PI / 2, 0];
  objects.poster.texture = objects.normalPosterTexture;
  objects.handle.visible = true;
  objects.floorHole.visible = false;
  objects.vent.position = [2.97, 2.25, -0.6];
  objects.tubeLights.forEach((light) => {
    light.color = [1, 1, 0.82, 1];
  });
  objects.npcHeadParts[0].position = [0.05, 1.86, -5.8];
  objects.npcHeadParts[1].position = [0.05, 2.1, -5.8];
  objects.guideBlocks.forEach((block) => {
    block.visible = true;
  });
}

function applyAnomaly(key) {
  if (key === 'signFlip') objects.exitSign.rotation = [0, -Math.PI / 2, Math.PI];
  if (key === 'wrongNumber') objects.exitSign.texture = objects.wrongExitTexture;
  if (key === 'redLight') objects.tubeLights[2].color = [1, 0.08, 0.08, 1];
  if (key === 'posterText') objects.poster.texture = objects.anomalyPosterTexture;
  if (key === 'missingHandle') objects.handle.visible = false;
  if (key === 'floorHole') objects.floorHole.visible = true;
  if (key === 'npcHead') {
    objects.npcHeadParts[0].position = [0.05, 2.1, -5.8];
    objects.npcHeadParts[1].position = [0.05, 1.72, -5.8];
  }
  if (key === 'ventMoved') objects.vent.position = [2.97, 1.55, -0.6];
  if (key === 'guideMissing') {
    objects.guideBlocks.slice(8, 13).forEach((block) => {
      block.visible = false;
    });
  }
}

function chooseNextScene() {
  resetAnomalies();
  const hasAnomaly = Math.random() < 0.62;
  state.currentAnomaly = hasAnomaly
    ? anomalyDefinitions[Math.floor(Math.random() * anomalyDefinitions.length)]
    : null;
  if (state.currentAnomaly) applyAnomaly(state.currentAnomaly.key);
}

function renderHud() {
  elements.exitCount.textContent = state.exitCount;
  elements.statusText.textContent = state.locked ? '移動中' : '観察中';
}

function setMessage(text, tone = '') {
  elements.message.className = `message${tone ? ` is-${tone}` : ''}`;
  elements.message.textContent = text;
}

function startMove(answeredAnomaly, onDone) {
  state.locked = true;
  renderHud();
  state.move = { elapsed: 0, duration: 0.9, direction: answeredAnomaly ? -1 : 1, onDone };
}

function resetGame(reason, answeredAnomaly) {
  state.exitCount = 0;
  setMessage(`${reason} 出口0に戻されました。`, 'bad');
  startMove(answeredAnomaly, chooseNextScene);
}

function completeGame(answeredAnomaly) {
  state.exitCount = 0;
  setMessage('脱出成功。出口8に到達しました。もう一度、出口0から始まります。', 'good');
  startMove(answeredAnomaly, chooseNextScene);
}

function handleAnswer(answeredAnomaly) {
  if (state.locked) return;
  const actuallyAnomaly = Boolean(state.currentAnomaly);
  const isCorrect = answeredAnomaly === actuallyAnomaly;
  if (!isCorrect) {
    const reason = actuallyAnomaly ? `見落としです。${state.currentAnomaly.label}` : '異変はありませんでした。前へ進むべきでした。';
    resetGame(reason, answeredAnomaly);
    return;
  }
  state.exitCount += 1;
  if (state.exitCount >= 8) {
    completeGame(answeredAnomaly);
    return;
  }
  const detail = actuallyAnomaly ? state.currentAnomaly.label : '異変なし。正しく前へ進みました。';
  setMessage(`正解。${detail}`, 'good');
  startMove(answeredAnomaly, chooseNextScene);
}

function resize() {
  if (!gl) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(window.innerWidth * dpr);
  const height = Math.floor(window.innerHeight * dpr);
  elements.canvas.width = width;
  elements.canvas.height = height;
  elements.canvas.style.width = `${window.innerWidth}px`;
  elements.canvas.style.height = `${window.innerHeight}px`;
  gl.viewport(0, 0, width, height);
  projectionMatrix = perspective((68 * Math.PI) / 180, width / height, 0.1, 80);
}

function viewMatrix(cameraPosition) {
  let matrix = identity();
  matrix = multiply(matrix, rotationX(-state.pitch));
  matrix = multiply(matrix, rotationY(-state.yaw));
  matrix = multiply(matrix, translation(-cameraPosition.x, -cameraPosition.y, -cameraPosition.z));
  return matrix;
}

function update(delta) {
  state.yaw += (state.targetYaw - state.yaw) * Math.min(1, delta * 8);
  state.pitch += (state.targetPitch - state.pitch) * Math.min(1, delta * 8);
  const cameraPosition = { ...cameraBase };
  if (state.move) {
    state.move.elapsed += delta;
    const progress = Math.min(1, state.move.elapsed / state.move.duration);
    const eased = 1 - (1 - progress) ** 3;
    cameraPosition.z = cameraBase.z - state.move.direction * eased * 3.1;
    state.targetYaw = state.move.direction < 0 ? Math.sin(progress * Math.PI) * 0.26 : 0;
    if (progress >= 1) {
      const onDone = state.move.onDone;
      state.move = null;
      state.targetYaw = 0;
      onDone();
      setMessage('3D通路を見回して、異変がなければ進む。異変があれば引き返す。');
      state.locked = false;
      renderHud();
    }
  }
  return cameraPosition;
}

function draw(cameraPosition) {
  gl.clearColor(0.02, 0.025, 0.032, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(locations.texture, 0);

  const vp = multiply(projectionMatrix, viewMatrix(cameraPosition));
  meshes.forEach((mesh) => {
    if (!mesh.visible) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.uv, 2, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(locations.uv);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
    gl.bindTexture(gl.TEXTURE_2D, mesh.texture || whiteTexture);
    gl.uniformMatrix4fv(locations.mvp, false, multiply(vp, makeTransform(mesh)));
    gl.uniform4fv(locations.color, mesh.color);
    gl.uniform1f(locations.useTexture, mesh.useTexture);
    gl.uniform1f(locations.fade, mesh.fade);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  });
}

function animate(now) {
  const delta = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const cameraPosition = update(delta);
  draw(cameraPosition);
  requestAnimationFrame(animate);
}

function bindLookControls() {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  elements.canvas.addEventListener('pointerdown', (event) => {
    elements.canvas.setPointerCapture(event.pointerId);
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  elements.canvas.addEventListener('pointermove', (event) => {
    if (!dragging || state.locked) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    state.targetYaw = clamp(state.targetYaw - dx * 0.0022, -0.42, 0.42);
    state.targetPitch = clamp(state.targetPitch - dy * 0.0018, -0.18, 0.16);
  });
  elements.canvas.addEventListener('pointerup', () => {
    dragging = false;
  });
  elements.canvas.addEventListener('pointercancel', () => {
    dragging = false;
  });
}

function openHelp() {
  if (typeof elements.helpDialog.showModal === 'function') elements.helpDialog.showModal();
}

function closeHelp() {
  elements.helpDialog.close();
}

if (gl) {
  program = createProgram();
  locations = {
    position: gl.getAttribLocation(program, 'aPosition'),
    uv: gl.getAttribLocation(program, 'aUv'),
    mvp: gl.getUniformLocation(program, 'uMvp'),
    texture: gl.getUniformLocation(program, 'uTexture'),
    color: gl.getUniformLocation(program, 'uColor'),
    useTexture: gl.getUniformLocation(program, 'uUseTexture'),
    fade: gl.getUniformLocation(program, 'uFade'),
  };
  whiteTexture = makeSolidTexture(255, 255, 255);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  buildWorld();
  chooseNextScene();
  renderHud();
  resize();
  bindLookControls();
  requestAnimationFrame(animate);
}

elements.turnBackButton.addEventListener('click', () => handleAnswer(true));
elements.goForwardButton.addEventListener('click', () => handleAnswer(false));
elements.helpButton.addEventListener('click', openHelp);
elements.closeHelpButton.addEventListener('click', closeHelp);
window.addEventListener('resize', resize);
