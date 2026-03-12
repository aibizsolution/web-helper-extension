/**
 * Content Progress Module
 * - 타이머/진행 푸시/활성 요청 수 관리
 */
(function progressModule() {
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;
    const C = (WPT.Constants && WPT.Constants.PORT_MESSAGES) || { PROGRESS: 'progress' };

    let activeMs = 0;
    let lastTick = null;
    let timerId = null;
    let inflight = 0;
    let portRef = WPT.__portRef || null;
    let getStatus = typeof WPT.__statusGetter === 'function' ? WPT.__statusGetter : null;

    function setPort(port) {
      portRef = port || null;
      try { WPT.__portRef = portRef; } catch (_) {}
    }

    function clearPort() {
      portRef = null;
      try { WPT.__portRef = null; } catch (_) {}
    }

    function setStatusGetter(fn) {
      getStatus = typeof fn === 'function' ? fn : null;
      try { WPT.__statusGetter = getStatus; } catch (_) {}
    }

    function getActiveMs() {
      return activeMs;
    }

    function tick() {
      const now = performance.now();
      if (lastTick !== null) {
        activeMs += now - lastTick;
      }
      lastTick = now;
    }

    function startTimer() {
      if (timerId) {
        return;
      }
      lastTick = performance.now();
      timerId = setInterval(() => {
        tick();
        pushProgress();
      }, 1000);
    }

    function stopTimer() {
      if (!timerId) {
        return;
      }
      clearInterval(timerId);
      timerId = null;
      tick();
      lastTick = null;
      pushProgress();
    }

    function onBatchStart() {
      inflight += 1;
      if (inflight === 1) {
        startTimer();
      }
      updateActiveRequests();
    }

    function onBatchEnd() {
      inflight = Math.max(0, inflight - 1);
      if (inflight === 0) {
        stopTimer();
      }
      updateActiveRequests();
    }

    function updateActiveRequests() {
      if (!getStatus) {
        return;
      }
      const status = getStatus();
      if (status) {
        status.activeRequests = inflight;
      }
    }

    function pushProgress() {
      if (!portRef || !getStatus) {
        return;
      }

      try {
        const status = getStatus();
        portRef.postMessage({
          type: C.PROGRESS,
          data: Object.assign({}, status, { activeMs })
        });
      } catch (_) {
        portRef = null;
      }
    }

    function reset() {
      try {
        stopTimer();
      } catch (_) {
        // no-op
      }
      activeMs = 0;
      inflight = 0;
      updateActiveRequests();
    }

    WPT.Progress = {
      setPort,
      clearPort,
      setStatusGetter,
      startTimer,
      stopTimer,
      reset,
      onBatchStart,
      onBatchEnd,
      pushProgress,
      getActiveMs
    };
  } catch (_) {
    // no-op
  }
})();
