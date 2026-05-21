/*
 * webOSTV.js - Compatibility stub
 *
 * On a real LG webOS TV, this file is provided automatically by the platform.
 * This stub allows the app to run in a browser/emulator without errors.
 *
 * Real file location on device: /usr/palm/frameworks/webOSTV.js
 * Docs: https://webostv.developer.lge.com/api/webos-service-api/
 */

(function(global) {
  'use strict';

  // Only define stub if real webOS SDK is not present
  if (global.webOS) return;

  global.webOS = {
    // Device info
    deviceInfo: function(cb) {
      if (typeof cb === 'function') {
        cb({
          modelName: 'LG WebOS TV (Emulator)',
          sdkVersion: '4.0',
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        });
      }
    },

    // Platform info
    platform: {
      tv: true,
    },

    // Luna service bridge stub
    service: {
      request: function(uri, params) {
        console.warn('[webOS stub] Luna service call:', uri, params);
        if (params && params.onFailure) {
          params.onFailure({ errorCode: -1, errorText: 'Stub: Luna not available' });
        }
      }
    },

    // System info
    systemInfo: function(cb) {
      if (typeof cb === 'function') cb({ country: 'DZ', timezone: 'Africa/Algiers' });
    },

    // App info
    fetchAppInfo: function(cb) {
      if (typeof cb === 'function') {
        cb({ id: 'com.iptvplayer.lite', version: '1.0.0', title: 'IPTV Player' });
      }
    },
  };

  // PalmSystem stub
  if (!global.PalmSystem) {
    global.PalmSystem = {
      stageReady: function() { console.log('[webOS stub] stageReady()'); },
      close: function() { console.log('[webOS stub] close()'); window.close(); },
      launchParams: '{}',
      identifier: 'com.iptvplayer.lite',
    };
  }

  console.log('[webOSTV.js] Running in stub/emulator mode');

})(window);
