(() => {
  const root = document.querySelector('[data-command-simulator]');
  if (!root) return;

  const initial = () => ({
    commandId: '—',
    cloud: 'idle',
    journal: 'empty',
    physical: 720,
    verification: 'not started',
    phase: 0,
    logs: ['Simulator ready. Desk height = 720 mm.'],
  });

  let state = initial();
  const el = (name) => root.querySelector(`[data-sim-${name}]`);
  const buttons = {
    create: el('create'),
    approve: el('approve'),
    fault: el('fault'),
    retry: el('retry'),
    reconcile: el('reconcile'),
    reset: el('reset'),
  };

  function log(message) {
    state.logs.push(message);
  }

  function render() {
    el('command').textContent = state.commandId;
    el('cloud').textContent = state.cloud;
    el('journal').textContent = state.journal;
    el('physical').textContent = `${state.physical} mm`;
    el('verification').textContent = state.verification;
    el('log').innerHTML = state.logs.map((item) => `<li>${item}</li>`).join('');

    buttons.create.disabled = state.phase !== 0;
    buttons.approve.disabled = state.phase !== 1;
    buttons.fault.disabled = state.phase !== 2;
    el('decision').classList.toggle('visible', state.phase === 3);
  }

  buttons.create.addEventListener('click', () => {
    state.commandId = 'cmd_desk_0042';
    state.cloud = 'awaiting_approval';
    state.phase = 1;
    log('TaskSpec validated; motion policy requires approval.');
    render();
  });

  buttons.approve.addEventListener('click', () => {
    state.cloud = 'dispatched';
    state.journal = 'accepted · cmd_desk_0042';
    state.phase = 2;
    log('Approval recorded with expiry.');
    log('Station validates version=108 and persists command before effect.');
    render();
  });

  buttons.fault.addEventListener('click', () => {
    state.cloud = 'executing · no terminal event';
    state.journal = 'executing · result unknown';
    state.physical = 760;
    state.verification = 'not observed';
    state.phase = 3;
    log('Actuator reaches 760 mm.');
    log('FAULT: terminal ACK is dropped before cloud receives it.');
    render();
  });

  buttons.retry.addEventListener('click', () => {
    el('feedback').textContent =
      '风险选择：物理效果未知时不应先重试。幂等键是安全网，但系统仍需读取真实状态来关闭不确定性。';
    log('Retry attempted with same idempotency key; station returns existing in-flight record.');
    render();
  });

  buttons.reconcile.addEventListener('click', () => {
    state.cloud = 'completed';
    state.journal = 'succeeded · verified';
    state.verification = '760 mm matches target';
    state.phase = 4;
    el('decision').classList.remove('visible');
    el('feedback').textContent = '正确：重新读取设备状态，确认目标已达到，因此不再执行第二次移动。';
    log('Reconciliation reads desk.height = 760 mm.');
    log('Verification passes; journal and workflow become terminal.');
    render();
  });

  buttons.reset.addEventListener('click', () => {
    state = initial();
    el('feedback').textContent = '';
    render();
  });

  render();
})();
