/* webos-support.js
   Handles webOS-specific features:
   - Magic Remote / IR Remote key mapping
   - Back button (closes app gracefully)
   - Network status via Luna Service
   - PalmSystem integration
   - Spatial navigation (Arrow keys + OK/Enter) for standard remote
*/

(function() {
  'use strict';

  // ── PalmSystem integration ──────────────────────────────
  if (window.PalmSystem) {
    // Signal app is ready to display
    PalmSystem.stageReady();

    // Prevent default webOS back-gesture from killing app instantly
    document.addEventListener('webOSRelaunch', function(e) {
      console.log('App relaunched:', e.detail);
    });
  }

  // ── Key codes for webOS Magic Remote / IR ──────────────
  const KEYS = {
    BACK:        461,
    RED:         403,
    GREEN:       404,
    YELLOW:      405,
    BLUE:        406,
    PLAY:        415,
    PAUSE:       19,
    STOP:        413,
    FF:          417,
    RW:          412,
    UP:          38,
    DOWN:        40,
    LEFT:        37,
    RIGHT:       39,
    ENTER:       13,
    EXIT:        1001,
    CH_UP:       427,
    CH_DOWN:     428,
    VOL_UP:      447,
    VOL_DOWN:    448,
    MUTE:        449,
    NUM_0:       48,
    INFO:        457,
    MENU:        18,
    HOME:        36,
  };

  // ── Remote key handler ──────────────────────────────────
  document.addEventListener('keydown', function(e) {
    const code = e.keyCode;

    // Prevent default for remote keys to avoid browser shortcuts
    const remoteKeys = Object.values(KEYS);
    if (remoteKeys.includes(code)) e.preventDefault();

    // Only handle when app screen is active
    const appActive = document.getElementById('app-screen')?.classList.contains('active');
    const setupActive = document.getElementById('setup-screen')?.classList.contains('active');
    const fsActive = document.getElementById('fullscreen-player')?.classList.contains('active');

    // ── BACK button ──
    if (code === KEYS.BACK) {
      if (fsActive) {
        if (window.closeFullscreen) closeFullscreen();
      } else if (appActive) {
        // Ask confirm before exit
        if (confirm('هل تريد الخروج من التطبيق؟')) {
          if (window.PalmSystem) PalmSystem.close();
          else window.close();
        }
      } else if (setupActive) {
        if (window.PalmSystem) PalmSystem.close();
        else window.close();
      }
      return;
    }

    // ── زر OK / Enter ──
    if (code === KEYS.ENTER) {
      const activeEl = document.activeElement;
      if (activeEl && typeof activeEl.click === 'function') {
        activeEl.click();
      }
      return;
    }

    // ── الأسهم (التنقل المكاني) ──
    // نظام webOS يقوم بالتنقل الأصلي إذا كانت العناصر تمتلك tabindex
    // لكن في حال علق التركيز، نرجعه إلى أول عنصر
    if ([KEYS.UP, KEYS.DOWN, KEYS.LEFT, KEYS.RIGHT].includes(code)) {
      if (!document.activeElement || document.activeElement === document.body) {
        const firstFocusable = document.querySelector('.focusable');
        if (firstFocusable) firstFocusable.focus();
      }
    }

    // ── Channel UP/DOWN ──
    if (code === KEYS.CH_UP) {
      if (appActive && window.prevChannel) prevChannel();
      return;
    }
    if (code === KEYS.CH_DOWN) {
      if (appActive && window.nextChannel) nextChannel();
      return;
    }

    // ── Play / Pause ──
    if (code === KEYS.PLAY || code === KEYS.PAUSE) {
      if (appActive && window.togglePlay) togglePlay();
      return;
    }

    // ── Stop ──
    if (code === KEYS.STOP) {
      const v = document.getElementById('video-player');
      if (v) { v.pause(); v.src = ''; }
      return;
    }

    // ── Mute ──
    if (code === KEYS.MUTE) {
      if (appActive && window.toggleMute) toggleMute();
      return;
    }

    // ── Fullscreen via GREEN ──
    if (code === KEYS.GREEN) {
      if (appActive && window.openFullscreen) openFullscreen();
      if (fsActive && window.closeFullscreen) closeFullscreen();
      return;
    }

    // ── Favorites via RED ──
    if (code === KEYS.RED) {
      if (appActive && window.setMode) setMode('favorites');
      return;
    }

    // ── Search via BLUE ──
    if (code === KEYS.BLUE) {
      if (appActive) {
        const s = document.getElementById('search-input');
        if (s) s.focus();
      }
      return;
    }

    // ── Settings via YELLOW ──
    if (code === KEYS.YELLOW) {
      if (appActive && window.openSettings) openSettings();
      return;
    }

    // ── INFO button ──
    if (code === KEYS.INFO) {
      const ch = window.state?.currentChannel;
      if (ch) showToast(`📺 ${ch.name}`, 'info');
      return;
    }

  }, false);

  // ── Network status monitoring ────────────────────────────
  function checkNetwork() {
    if (window.navigator.onLine === false) {
      if (window.showToast) showToast('⚠️ لا يوجد اتصال بالإنترنت', 'error');
    }
  }

  window.addEventListener('offline', function() {
    if (window.showToast) showToast('❌ انقطع الاتصال بالإنترنت', 'error');
  });

  window.addEventListener('online', function() {
    if (window.showToast) showToast('✅ تم استعادة الاتصال', 'success');
  });

  // ── Luna Service: Network fetch proxy ──────────────────
  // On webOS, cross-origin requests may be blocked.
  // This wraps fetch() to use Luna's com.webos.service.network if available.
  const _originalFetch = window.fetch.bind(window);

  window.fetch = function(url, options) {
    // Always try native fetch first
    return _originalFetch(url, options).catch(function(err) {
      // If CORS or network error, try Luna bridge if available
      if (window.webOS && window.webOS.service) {
        return lunaFetch(url, options);
      }
      throw err;
    });
  };

  function lunaFetch(url, options) {
    return new Promise(function(resolve, reject) {
      const method = (options && options.method) || 'GET';
      const headers = (options && options.headers) || {};

      webOS.service.request('luna://com.webos.service.network', {
        method: 'getStatus',
        parameters: {},
        onSuccess: function() {
          // Network is available, retry with relaxed mode
          _originalFetch(url, { ...options, mode: 'no-cors' })
            .then(resolve)
            .catch(reject);
        },
        onFailure: function(e) {
          reject(new Error('Luna network error: ' + JSON.stringify(e)));
        }
      });
    });
  }

  // ── webOS TV Info ───────────────────────────────────────
  if (window.webOS) {
    webOS.deviceInfo(function(info) {
      console.log('webOS Device:', info.modelName, '| OS:', info.sdkVersion);
      // Adjust UI for older webOS versions
      if (info.sdkVersion && parseFloat(info.sdkVersion) < 3) {
        // Disable CSS features not supported in older webOS
        document.documentElement.style.setProperty('--radius', '4px');
      }
    });
  }

  // ── Focus management for Magic Remote ──────────────────
  // Ensures spatial navigation works correctly for both
  // Magic Remote (pointer mode) and standard IR remote (arrow keys)
  document.addEventListener('mouseover', function(e) {
    const focusable = e.target.closest('button, .channel-card, .channel-list-item, .category-item, .profile-item, .vod-card, .focusable');
    if (focusable) focusable.focus();
  });

  console.log('[webOS Support] Loaded successfully');

})();
