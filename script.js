const anomalyDefinitions = [
  { className: 'anomaly-sign', label: '右上の出口看板が逆さまになっていました。' },
  { className: 'anomaly-number', label: '出口番号の8が別の記号に変わっていました。' },
  { className: 'anomaly-light', label: '奥の照明が赤く光っていました。' },
  { className: 'anomaly-poster', label: '左の青いポスターの文字が変わっていました。' },
  { className: 'anomaly-door', label: '右の点検扉のノブが消えていました。' },
  { className: 'anomaly-tile', label: '床タイルが一枚抜けていました。' },
  { className: 'anomaly-npc', label: '通路の男の頭が逆さまになっていました。' },
  { className: 'anomaly-vent', label: '右壁の換気口の位置が下がっていました。' },
];

const state = {
  exitCount: 0,
  currentAnomaly: null,
  locked: false,
};

const elements = {
  scene: document.querySelector('#scene'),
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
  const hasAnomaly = Math.random() < 0.62;
  state.currentAnomaly = hasAnomaly
    ? anomalyDefinitions[Math.floor(Math.random() * anomalyDefinitions.length)]
    : null;

  elements.scene.className = 'scene';
  if (state.currentAnomaly) {
    elements.scene.classList.add(state.currentAnomaly.className);
  }
}

function render() {
  elements.exitCount.textContent = `${state.exitCount} / 8`;
  elements.streak.textContent = state.locked ? '移動中' : '観察中';
}

function setMessage(text, tone = '') {
  elements.message.className = `message${tone ? ` is-${tone}` : ''}`;
  elements.message.textContent = text;
}

function animateTransition(answeredAnomaly) {
  elements.scene.classList.add(answeredAnomaly ? 'walk-back' : 'walk-forward', 'flash');
}

function advanceScene(text, tone, answeredAnomaly) {
  state.locked = true;
  render();
  setMessage(text, tone);
  animateTransition(answeredAnomaly);

  window.setTimeout(() => {
    elements.scene.className = 'scene';
    chooseNextScene();
    setMessage('異変がなければ前へ進む。異変を見つけたらすぐ引き返す。');
    state.locked = false;
    render();
  }, 900);
}

function resetGame(reason, answeredAnomaly) {
  state.exitCount = 0;
  advanceScene(`${reason} 出口0へ戻されました。`, 'bad', answeredAnomaly);
}

function completeGame(answeredAnomaly) {
  state.exitCount = 0;
  advanceScene('脱出成功！ 出口8に到達しました。もう一度、出口0から挑戦できます。', 'good', answeredAnomaly);
}

function handleAnswer(answeredAnomaly) {
  if (state.locked) return;

  const actuallyAnomaly = Boolean(state.currentAnomaly);
  const isCorrect = answeredAnomaly === actuallyAnomaly;

  if (!isCorrect) {
    const reason = actuallyAnomaly
      ? `見落としです。${state.currentAnomaly.label}`
      : '異変はありませんでした。進むべき通路でした。';
    resetGame(reason, answeredAnomaly);
    return;
  }

  state.exitCount += 1;

  if (state.exitCount >= 8) {
    completeGame(answeredAnomaly);
    return;
  }

  const detail = actuallyAnomaly ? state.currentAnomaly.label : '異変なし。正しく前へ進みました。';
  advanceScene(`正解。${detail}`, 'good', answeredAnomaly);
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
