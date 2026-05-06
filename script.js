const anomalyDefinitions = [
  { className: 'anomaly-sign', label: '出口サインが逆さまになっていました。' },
  { className: 'anomaly-poster', label: '右のポスターの文言が変わっていました。' },
  { className: 'anomaly-light', label: '中央の照明が赤く光っていました。' },
  { className: 'anomaly-door', label: '左のドアノブが消えていました。' },
  { className: 'anomaly-tile', label: '床のタイルが一枚抜けていました。' },
  { className: 'anomaly-pipe', label: '右の配管の位置がずれていました。' },
  { className: 'anomaly-poster-left', label: '左のポスターが傾いていました。' },
];

const state = {
  exitCount: 0,
  streak: 0,
  currentAnomaly: null,
  locked: false,
};

const elements = {
  corridor: document.querySelector('#corridor'),
  message: document.querySelector('#message'),
  exitCount: document.querySelector('#exitCount'),
  streak: document.querySelector('#streak'),
  turnBackButton: document.querySelector('#turnBackButton'),
  goForwardButton: document.querySelector('#goForwardButton'),
  helpButton: document.querySelector('#helpButton'),
  helpDialog: document.querySelector('#helpDialog'),
  closeHelpButton: document.querySelector('#closeHelpButton'),
};

function chooseNextScene() {
  const hasAnomaly = Math.random() < 0.68;
  state.currentAnomaly = hasAnomaly
    ? anomalyDefinitions[Math.floor(Math.random() * anomalyDefinitions.length)]
    : null;

  elements.corridor.className = 'corridor';
  if (state.currentAnomaly) {
    elements.corridor.classList.add(state.currentAnomaly.className);
  }
}

function render() {
  elements.exitCount.textContent = `${state.exitCount} / 8`;
  elements.streak.textContent = state.streak;
}

function setMessage(text, tone = '') {
  elements.message.className = `message${tone ? ` is-${tone}` : ''}`;
  elements.message.textContent = text;
}

function advanceScene(text, tone) {
  state.locked = true;
  setMessage(text, tone);
  elements.corridor.classList.add('flash');

  window.setTimeout(() => {
    elements.corridor.classList.remove('flash');
    chooseNextScene();
    setMessage('通路をよく観察して、異変があれば「引き返す」。なければ「進む」。');
    state.locked = false;
    render();
  }, 900);
}

function resetGame(reason) {
  state.exitCount = 0;
  state.streak = 0;
  render();
  advanceScene(`${reason} 最初の通路に戻されました。`, 'bad');
}

function handleAnswer(answeredAnomaly) {
  if (state.locked) return;

  const actuallyAnomaly = Boolean(state.currentAnomaly);
  const isCorrect = answeredAnomaly === actuallyAnomaly;

  if (!isCorrect) {
    const reason = actuallyAnomaly
      ? `見落としです。${state.currentAnomaly.label}`
      : '異変はありませんでした。';
    resetGame(reason);
    return;
  }

  state.exitCount += 1;
  state.streak += 1;

  if (state.exitCount >= 8) {
    state.exitCount = 0;
    state.streak = 0;
    render();
    advanceScene('脱出成功！ 8つ目の出口にたどり着きました。もう一度挑戦できます。', 'good');
    return;
  }

  const detail = actuallyAnomaly ? state.currentAnomaly.label : '何も変わっていませんでした。';
  advanceScene(`正解。${detail}`, 'good');
}

function openHelp() {
  if (typeof elements.helpDialog.showModal === 'function') {
    elements.helpDialog.showModal();
  }
}

function closeHelp() {
  elements.helpDialog.close();
}

elements.turnBackButton.addEventListener('click', () => handleAnswer(true));
elements.goForwardButton.addEventListener('click', () => handleAnswer(false));
elements.helpButton.addEventListener('click', openHelp);
elements.closeHelpButton.addEventListener('click', closeHelp);

chooseNextScene();
render();
