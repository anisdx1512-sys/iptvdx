/**
 * hls.js - Lightweight HLS Player
 * Compatible with webOS 2+ (Chromium 38+), ES5 only
 * Supports: HLS live streams, M3U8 playlists, TS segments
 */
(function(global) {
  'use strict';

  var VERSION = 'webos-lite-1.0';

  // ── Event names ──────────────────────────────────────────
  var Events = {
    MEDIA_ATTACHED:   'hlsMediaAttached',
    MANIFEST_PARSED:  'hlsManifestParsed',
    ERROR:            'hlsError',
    LEVEL_LOADED:     'hlsLevelLoaded',
    FRAG_LOADED:      'hlsFragLoaded',
  };

  var ErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR:   'mediaError',
    OTHER_ERROR:   'otherError',
  };

  // ── Simple XHR helper ────────────────────────────────────
  function xhr(url, type, cb) {
    var req = new XMLHttpRequest();
    req.open('GET', url, true);
    req.responseType = type || 'text';
    req.timeout = 15000;
    req.onload = function() {
      if (req.status >= 200 && req.status < 300) {
        cb(null, req.response);
      } else {
        cb(new Error('HTTP ' + req.status));
      }
    };
    req.onerror   = function() { cb(new Error('Network error')); };
    req.ontimeout = function() { cb(new Error('Timeout')); };
    req.send();
    return req;
  }

  // ── Parse M3U8 manifest ──────────────────────────────────
  function parseM3U8(text, baseUrl) {
    var lines = text.split('\n');
    var segments = [];
    var isLive = true;
    var targetDuration = 5;
    var sequence = 0;
    var duration = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line.indexOf('#EXT-X-ENDLIST') === 0) {
        isLive = false;
      } else if (line.indexOf('#EXT-X-TARGETDURATION:') === 0) {
        targetDuration = parseInt(line.split(':')[1]) || 5;
      } else if (line.indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) {
        sequence = parseInt(line.split(':')[1]) || 0;
      } else if (line.indexOf('#EXTINF:') === 0) {
        duration = parseFloat(line.split(':')[1]) || targetDuration;
      } else if (line.charAt(0) !== '#' && line.length > 0) {
        var segUrl = line;
        if (segUrl.indexOf('http') !== 0) {
          // Relative URL
          var base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
          segUrl = base + segUrl;
        }
        segments.push({ url: segUrl, duration: duration, sn: sequence++ });
        duration = 0;
      }
    }

    return { segments: segments, isLive: isLive, targetDuration: targetDuration };
  }

  // ── Parse master playlist (multi-quality) ────────────────
  function parseMasterPlaylist(text, baseUrl) {
    var lines = text.split('\n');
    var levels = [];
    var bandwidth = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
        var bwMatch = line.match(/BANDWIDTH=(\d+)/);
        bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
      } else if (line.charAt(0) !== '#' && line.length > 0) {
        var levelUrl = line;
        if (levelUrl.indexOf('http') !== 0) {
          var base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
          levelUrl = base + levelUrl;
        }
        levels.push({ url: levelUrl, bandwidth: bandwidth });
        bandwidth = 0;
      }
    }
    return levels;
  }

  // ── Main Hls class ───────────────────────────────────────
  function Hls(config) {
    this.config = config || {};
    this._media = null;
    this._url = null;
    this._listeners = {};
    this._segments = [];
    this._segIndex = 0;
    this._isLive = true;
    this._targetDuration = 5;
    this._playlistTimer = null;
    this._destroyed = false;
    this._mediaSource = null;
    this._sourceBuffer = null;
    this._queue = [];
    this._appending = false;
    this._started = false;
    this._retryCount = 0;
    this._maxRetry = 3;
    this._loadedSNs = {};
  }

  Hls.isSupported = function() {
    return !!(
      global.MediaSource &&
      global.MediaSource.isTypeSupported &&
      (
        global.MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"') ||
        global.MediaSource.isTypeSupported('video/mp4; codecs="avc1.64001f,mp4a.40.2"')
      )
    );
  };

  Hls.Events    = Events;
  Hls.ErrorTypes = ErrorTypes;

  var proto = Hls.prototype;

  // ── Event system ─────────────────────────────────────────
  proto.on = function(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  };

  proto.off = function(event, cb) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(function(f) { return f !== cb; });
  };

  proto._emit = function(event, data) {
    var cbs = this._listeners[event] || [];
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](event, data || {}); } catch(e) {}
    }
  };

  // ── Load source ──────────────────────────────────────────
  proto.loadSource = function(url) {
    this._url = url;
  };

  // ── Attach media ─────────────────────────────────────────
  proto.attachMedia = function(video) {
    this._media = video;
    this._emit(Events.MEDIA_ATTACHED, { media: video });
    this._start();
  };

  proto._start = function() {
    var self = this;
    if (!self._url || !self._media) return;

    // Check if native HLS works first (webOS TV supports it)
    var v = self._media;
    var canNative = v.canPlayType('application/vnd.apple.mpegurl') ||
                    v.canPlayType('application/x-mpegurl');

    if (canNative) {
      // Use native playback — just set src
      v.src = self._url;
      v.load();
      var onCanPlay = function() {
        self._emit(Events.MANIFEST_PARSED, { levels: [{ url: self._url }], firstLevel: 0 });
        v.removeEventListener('canplay', onCanPlay);
        v.removeEventListener('error', onError);
      };
      var onError = function() {
        v.removeEventListener('canplay', onCanPlay);
        v.removeEventListener('error', onError);
        // Fall back to fetch-based approach
        self._fetchAndParse();
      };
      v.addEventListener('canplay', onCanPlay);
      v.addEventListener('error', onError);
      return;
    }

    // Fetch-based approach for browsers without native HLS
    self._fetchAndParse();
  };

  proto._fetchAndParse = function() {
    var self = this;
    xhr(self._url, 'text', function(err, text) {
      if (self._destroyed) return;
      if (err) {
        self._emitError(ErrorTypes.NETWORK_ERROR, 'manifestLoadError', err.message, true);
        return;
      }
      self._parseAndPlay(text);
    });
  };

  proto._parseAndPlay = function(text) {
    var self = this;

    // Check if master playlist (contains #EXT-X-STREAM-INF)
    if (text.indexOf('#EXT-X-STREAM-INF') !== -1) {
      var levels = parseMasterPlaylist(text, self._url);
      if (!levels.length) {
        self._emitError(ErrorTypes.OTHER_ERROR, 'manifestParsingError', 'No levels', true);
        return;
      }
      // Pick lowest bandwidth level for stability
      levels.sort(function(a,b) { return a.bandwidth - b.bandwidth; });
      self._url = levels[0].url;
      xhr(self._url, 'text', function(err, text2) {
        if (self._destroyed) return;
        if (err) { self._emitError(ErrorTypes.NETWORK_ERROR, 'levelLoadError', err.message, true); return; }
        self._parseMediaPlaylist(text2);
      });
      return;
    }

    self._parseMediaPlaylist(text);
  };

  proto._parseMediaPlaylist = function(text) {
    var self = this;
    var parsed = parseM3U8(text, self._url);
    self._segments = parsed.segments;
    self._isLive = parsed.isLive;
    self._targetDuration = parsed.targetDuration;
    self._segIndex = Math.max(0, self._segments.length - 3); // start near end for live

    self._emit(Events.MANIFEST_PARSED, {
      levels: [{ url: self._url }],
      firstLevel: 0,
      totalduration: self._segments.reduce(function(s,seg){ return s+seg.duration; }, 0),
    });

    self._setupMSE();
  };

  // ── MSE Setup ────────────────────────────────────────────
  proto._setupMSE = function() {
    var self = this;
    var video = self._media;

    if (!global.MediaSource || !Hls.isSupported()) {
      // MSE not available — try blob approach or direct
      self._emitError(ErrorTypes.OTHER_ERROR, 'mseNotSupported', 'MediaSource not supported', true);
      return;
    }

    var ms = new MediaSource();
    self._mediaSource = ms;
    video.src = URL.createObjectURL(ms);

    ms.addEventListener('sourceopen', function() {
      if (self._destroyed) return;
      var mimeType = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
      if (!MediaSource.isTypeSupported(mimeType)) {
        mimeType = 'video/mp4; codecs="avc1.64001f,mp4a.40.2"';
      }
      if (!MediaSource.isTypeSupported(mimeType)) {
        self._emitError(ErrorTypes.MEDIA_ERROR, 'codecsNotSupported', 'No supported codec', true);
        return;
      }
      try {
        self._sourceBuffer = ms.addSourceBuffer(mimeType);
        self._sourceBuffer.addEventListener('updateend', function() {
          self._appending = false;
          self._drainQueue();
        });
        self._loadSegments();
      } catch(e) {
        self._emitError(ErrorTypes.MEDIA_ERROR, 'sbAddError', e.message, true);
      }
    });
  };

  // ── Load & append segments ───────────────────────────────
  proto._loadSegments = function() {
    var self = this;
    if (self._destroyed) return;

    if (self._segIndex >= self._segments.length) {
      if (self._isLive) {
        // Refresh playlist
        self._playlistTimer = setTimeout(function() {
          self._refreshPlaylist();
        }, self._targetDuration * 1000);
      } else {
        // VOD end
        if (self._mediaSource && self._mediaSource.readyState === 'open') {
          try { self._mediaSource.endOfStream(); } catch(e) {}
        }
      }
      return;
    }

    var seg = self._segments[self._segIndex];
    if (self._loadedSNs[seg.sn]) {
      self._segIndex++;
      self._loadSegments();
      return;
    }

    xhr(seg.url, 'arraybuffer', function(err, data) {
      if (self._destroyed) return;
      if (err) {
        self._retryCount++;
        if (self._retryCount > self._maxRetry) {
          self._emitError(ErrorTypes.NETWORK_ERROR, 'fragLoadError', err.message, true);
        } else {
          setTimeout(function() { self._loadSegments(); }, 2000);
        }
        return;
      }
      self._retryCount = 0;
      self._loadedSNs[seg.sn] = true;
      self._segIndex++;
      self._queue.push(data);
      self._drainQueue();
      self._emit(Events.FRAG_LOADED, { frag: seg });
      // Load next
      self._loadSegments();
    });
  };

  proto._drainQueue = function() {
    var self = this;
    if (self._appending || !self._queue.length || !self._sourceBuffer) return;
    if (self._sourceBuffer.updating) return;

    var data = self._queue.shift();
    self._appending = true;
    try {
      self._sourceBuffer.appendBuffer(data);
    } catch(e) {
      self._appending = false;
      if (e.name === 'QuotaExceededError') {
        // Remove old data
        if (self._media && self._media.currentTime > 30) {
          self._sourceBuffer.remove(0, self._media.currentTime - 10);
        }
      }
    }
  };

  // ── Refresh live playlist ────────────────────────────────
  proto._refreshPlaylist = function() {
    var self = this;
    if (self._destroyed) return;
    xhr(self._url, 'text', function(err, text) {
      if (self._destroyed || err) return;
      var parsed = parseM3U8(text, self._url);
      // Add only new segments
      var lastSN = self._segments.length ? self._segments[self._segments.length-1].sn : -1;
      var newSegs = parsed.segments.filter(function(s) { return s.sn > lastSN; });
      self._segments = self._segments.concat(newSegs);
      self._loadSegments();
    });
  };

  // ── Error emitter ────────────────────────────────────────
  proto._emitError = function(type, details, reason, fatal) {
    this._emit(Events.ERROR, {
      type: type,
      details: details,
      reason: reason,
      fatal: !!fatal,
    });
  };

  // ── Recovery ─────────────────────────────────────────────
  proto.startLoad = function() {
    if (this._segments.length) this._loadSegments();
    else this._start();
  };

  proto.recoverMediaError = function() {
    var self = this;
    var video = self._media;
    if (!video) return;
    video.pause();
    video.load();
    setTimeout(function() { video.play().catch(function(){}); }, 500);
  };

  // ── Destroy ──────────────────────────────────────────────
  proto.destroy = function() {
    this._destroyed = true;
    if (this._playlistTimer) clearTimeout(this._playlistTimer);
    if (this._sourceBuffer && this._mediaSource && this._mediaSource.readyState === 'open') {
      try { this._mediaSource.endOfStream(); } catch(e) {}
    }
    if (this._media && this._media.src && this._media.src.indexOf('blob:') === 0) {
      URL.revokeObjectURL(this._media.src);
      this._media.src = '';
    }
    this._segments = [];
    this._queue = [];
    this._listeners = {};
    this._media = null;
  };

  // ── Export ───────────────────────────────────────────────
  global.Hls = Hls;

})(window);
