(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["apngJs"] = factory();
	else
		root["apngJs"] = factory();
})(this, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

	'use strict';

	Object.defineProperty(exports, "__esModule", {
	    value: true
	});
	exports.isNotPNG = isNotPNG;
	exports.isNotAPNG = isNotAPNG;
	exports.default = parseAPNG;

	var _crc = __webpack_require__(1);

	var _crc2 = _interopRequireDefault(_crc);

	var _structs = __webpack_require__(2);

	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	var errNotPNG = new Error('Not a PNG');
	var errNotAPNG = new Error('Not an animated PNG');

	function isNotPNG(err) {
	    return err === errNotPNG;
	}
	function isNotAPNG(err) {
	    return err === errNotAPNG;
	}

	// '\x89PNG\x0d\x0a\x1a\x0a'
	var PNGSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

	/**
	 * Parse APNG data
	 * @param {ArrayBuffer} buffer
	 * @return {APNG|Error}
	 */
	function parseAPNG(buffer) {
	    var bytes = new Uint8Array(buffer);

	    if (Array.prototype.some.call(PNGSignature, function (b, i) {
	        return b !== bytes[i];
	    })) {
	        return errNotPNG;
	    }

	    // fast animation test
	    var isAnimated = false;
	    eachChunk(bytes, function (type) {
	        return !(isAnimated = type === 'acTL');
	    });
	    if (!isAnimated) {
	        return errNotAPNG;
	    }

	    var preDataParts = [],
	        postDataParts = [];
	    var headerDataBytes = null,
	        frame = null,
	        frameNumber = 0,
	        apng = new _structs.APNG();

	    eachChunk(bytes, function (type, bytes, off, length) {
	        var dv = new DataView(bytes.buffer);
	        switch (type) {
	            case 'IHDR':
	                headerDataBytes = bytes.subarray(off + 8, off + 8 + length);
	                apng.width = dv.getUint32(off + 8);
	                apng.height = dv.getUint32(off + 12);
	                break;
	            case 'acTL':
	                apng.numPlays = dv.getUint32(off + 8 + 4);
	                break;
	            case 'fcTL':
	                if (frame) {
	                    apng.frames.push(frame);
	                    frameNumber++;
	                }
	                frame = new _structs.Frame();
	                frame.width = dv.getUint32(off + 8 + 4);
	                frame.height = dv.getUint32(off + 8 + 8);
	                frame.left = dv.getUint32(off + 8 + 12);
	                frame.top = dv.getUint32(off + 8 + 16);
	                var delayN = dv.getUint16(off + 8 + 20);
	                var delayD = dv.getUint16(off + 8 + 22);
	                if (delayD === 0) {
	                    delayD = 100;
	                }
	                frame.delay = 1000 * delayN / delayD;
	                // https://bugzilla.mozilla.org/show_bug.cgi?id=125137
	                // https://bugzilla.mozilla.org/show_bug.cgi?id=139677
	                // https://bugzilla.mozilla.org/show_bug.cgi?id=207059
	                if (frame.delay <= 10) {
	                    frame.delay = 100;
	                }
	                apng.playTime += frame.delay;
	                frame.disposeOp = dv.getUint8(off + 8 + 24);
	                frame.blendOp = dv.getUint8(off + 8 + 25);
	                frame.dataParts = [];
	                if (frameNumber === 0 && frame.disposeOp === 2) {
	                    frame.disposeOp = 1;
	                }
	                break;
	            case 'fdAT':
	                if (frame) {
	                    frame.dataParts.push(bytes.subarray(off + 8 + 4, off + 8 + length));
	                }
	                break;
	            case 'IDAT':
	                if (frame) {
	                    frame.dataParts.push(bytes.subarray(off + 8, off + 8 + length));
	                }
	                break;
	            case 'IEND':
	                postDataParts.push(subBuffer(bytes, off, 12 + length));
	                break;
	            default:
	                preDataParts.push(subBuffer(bytes, off, 12 + length));
	        }
	    });

	    if (frame) {
	        apng.frames.push(frame);
	    }

	    if (apng.frames.length == 0) {
	        return errNotAPNG;
	    }

	    var preBlob = new Blob(preDataParts),
	        postBlob = new Blob(postDataParts);

	    apng.frames.forEach(function (frame) {
	        var bb = [];
	        bb.push(PNGSignature);
	        headerDataBytes.set(makeDWordArray(frame.width), 0);
	        headerDataBytes.set(makeDWordArray(frame.height), 4);
	        bb.push(makeChunkBytes('IHDR', headerDataBytes));
	        bb.push(preBlob);
	        frame.dataParts.forEach(function (p) {
	            return bb.push(makeChunkBytes('IDAT', p));
	        });
	        bb.push(postBlob);
	        frame.imageData = new Blob(bb, { 'type': 'image/png' });
	        delete frame.dataParts;
	        bb = null;
	    });

	    return apng;
	}

	/**
	 * @param {Uint8Array} bytes
	 * @param {function(string, Uint8Array, int, int): boolean} callback
	 */
	function eachChunk(bytes, callback) {
	    var dv = new DataView(bytes.buffer);
	    var off = 8,
	        type = void 0,
	        length = void 0,
	        res = void 0;
	    do {
	        length = dv.getUint32(off);
	        type = readString(bytes, off + 4, 4);
	        res = callback(type, bytes, off, length);
	        off += 12 + length;
	    } while (res !== false && type != 'IEND' && off < bytes.length);
	}

	/**
	 *
	 * @param {Uint8Array} bytes
	 * @param {number} off
	 * @param {number} length
	 * @return {string}
	 */
	function readString(bytes, off, length) {
	    var chars = Array.prototype.slice.call(bytes.subarray(off, off + length));
	    return String.fromCharCode.apply(String, chars);
	}

	/**
	 *
	 * @param {string} x
	 * @return {Uint8Array}
	 */
	function makeStringArray(x) {
	    var res = new Uint8Array(x.length);
	    for (var i = 0; i < x.length; i++) {
	        res[i] = x.charCodeAt(i);
	    }
	    return res;
	}

	/**
	 * @param {Uint8Array} bytes
	 * @param {int} start
	 * @param {int} length
	 * @return {Uint8Array}
	 */
	function subBuffer(bytes, start, length) {
	    var a = new Uint8Array(length);
	    a.set(bytes.subarray(start, start + length));
	    return a;
	}

	/**
	 * @param {string} type
	 * @param {Uint8Array} dataBytes
	 * @return {Uint8Array}
	 */
	var makeChunkBytes = function makeChunkBytes(type, dataBytes) {
	    var crcLen = type.length + dataBytes.length;
	    var bytes = new Uint8Array(crcLen + 8);
	    var dv = new DataView(bytes.buffer);

	    dv.setUint32(0, dataBytes.length);
	    bytes.set(makeStringArray(type), 4);
	    bytes.set(dataBytes, 8);
	    var crc = (0, _crc2.default)(bytes, 4, crcLen);
	    dv.setUint32(crcLen + 4, crc);
	    return bytes;
	};

	var makeDWordArray = function makeDWordArray(x) {
	    return new Uint8Array([x >>> 24 & 0xff, x >>> 16 & 0xff, x >>> 8 & 0xff, x & 0xff]);
	};

/***/ }),
/* 1 */
/***/ (function(module, exports) {

	"use strict";

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});

	exports.default = function (bytes) {
	  var start = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
	  var length = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : bytes.length - start;

	  var crc = -1;
	  for (var _i = start, l = start + length; _i < l; _i++) {
	    crc = crc >>> 8 ^ table[(crc ^ bytes[_i]) & 0xFF];
	  }
	  return crc ^ -1;
	};

	var table = new Uint32Array(256);

	for (var i = 0; i < 256; i++) {
	  var c = i;
	  for (var k = 0; k < 8; k++) {
	    c = (c & 1) !== 0 ? 0xEDB88320 ^ c >>> 1 : c >>> 1;
	  }
	  table[i] = c;
	}

	/**
	 *
	 * @param {Uint8Array} bytes
	 * @param {number} start
	 * @param {number} length
	 * @return {number}
	 */

/***/ }),
/* 2 */
/***/ (function(module, exports, __webpack_require__) {

	'use strict';

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.Frame = exports.APNG = undefined;

	var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

	var _player = __webpack_require__(3);

	var _player2 = _interopRequireDefault(_player);

	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

	/**
	 * @property {number} currFrameNumber
	 * @property {Frame} currFrame
	 * @property {boolean} paused
	 * @property {boolean} ended
	 */
	var APNG = exports.APNG = function () {
	  function APNG() {
	    _classCallCheck(this, APNG);

	    this.width = 0;
	    this.height = 0;
	    this.numPlays = 0;
	    this.playTime = 0;
	    this.frames = [];
	  }
	  /** @type {number} */

	  /** @type {number} */

	  /** @type {number} */

	  /** @type {number} */

	  /** @type {Frame[]} */


	  _createClass(APNG, [{
	    key: 'createImages',


	    /**
	     *
	     * @return {Promise.<*>}
	     */
	    value: function createImages() {
	      return Promise.all(this.frames.map(function (f) {
	        return f.createImage();
	      }));
	    }

	    /**
	     *
	     * @param {CanvasRenderingContext2D} context
	     * @param {boolean} autoPlay
	     * @return {Promise.<Player>}
	     */

	  }, {
	    key: 'getPlayer',
	    value: function getPlayer(context) {
	      var autoPlay = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

	      var _this = this;

	      var width = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;
	      var height = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : null;

	      return this.createImages().then(function () {
	        return new _player2.default(_this, context, autoPlay, width, height);
	      });
	    }
	  }]);

	  return APNG;
	}();

	var Frame = exports.Frame = function () {
	  function Frame() {
	    _classCallCheck(this, Frame);

	    this.left = 0;
	    this.top = 0;
	    this.width = 0;
	    this.height = 0;
	    this.delay = 0;
	    this.disposeOp = 0;
	    this.blendOp = 0;
	    this.imageData = null;
	    this.imageElement = null;
	  }
	  /** @type {number} */

	  /** @type {number} */

	  /** @type {number} */

	  /** @type {number} */

	  /** @type {number} */

	  /** @type {number} */

	  /** @type {number} */

	  /** @type {Blob} */

	  /** @type {HTMLImageElement} */


	  _createClass(Frame, [{
	    key: 'createImage',
	    value: function createImage() {
	      var _this2 = this;

	      if (this.imageElement) {
	        return Promise.resolve();
	      }
	      return new Promise(function (resolve, reject) {
	        var url = URL.createObjectURL(_this2.imageData);
	        _this2.imageElement = document.createElement('img');
	        _this2.imageElement.onload = function () {
	          URL.revokeObjectURL(url);
	          resolve();
	        };
	        _this2.imageElement.onerror = function () {
	          URL.revokeObjectURL(url);
	          _this2.imageElement = null;
	          reject(new Error('Image creation error'));
	        };
	        _this2.imageElement.src = url;
	      });
	    }
	  }]);

	  return Frame;
	}();

/***/ }),
/* 3 */
/***/ (function(module, exports, __webpack_require__) {

	'use strict';

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});

	var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

	var _events = __webpack_require__(4);

	var _events2 = _interopRequireDefault(_events);

	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

	function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

	function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

	var _class = function (_EventEmitter) {
	  _inherits(_class, _EventEmitter);

	  /**
	   * @param {APNG} apng
	   * @param {CanvasRenderingContext2D} context
	   * @param {boolean} autoPlay
	   */

	  /** @type {number} */


	  /** @type {boolean} */

	  /** @type {Frame} */

	  /** @type {ImageData} */

	  /** @type {number|null} */


	  /** @type {APNG} */

	  /** @type {CanvasRenderingContext2D} */
	  function _class(apng, context, autoPlay, width, height) {
	    _classCallCheck(this, _class);

	    var _this = _possibleConstructorReturn(this, (_class.__proto__ || Object.getPrototypeOf(_class)).call(this));

	    _this.playbackRate = 1.0;
	    _this._width = null;
	    _this._height = null;
	    _this._currentFrameNumber = 0;
	    _this._ended = false;
	    _this._paused = true;
	    _this._numPlays = 0;
	    _this._rafId = null;

	    _this._apng = apng;
	    _this._width = width;
	    _this._height = height;
	    _this.context = context;
	    _this.stop();
	    if (autoPlay) {
	      _this.play();
	    }
	    return _this;
	  }

	  /**
	   *
	   * @return {number}
	   */

	  /** @type {number|null} */

	  /** @type {boolean} */

	  /** @type {number} */

	  /** @type {number|null} */

	  /** @type {number} */


	  _createClass(_class, [{
	    key: 'renderNextFrame',
	    value: function renderNextFrame() {
	      this._currentFrameNumber = (this._currentFrameNumber + 1) % this._apng.frames.length;
	      if (this._currentFrameNumber === this._apng.frames.length - 1) {
	        this._numPlays++;
	        if (this._apng.numPlays !== 0 && this._numPlays >= this._apng.numPlays) {
	          this._ended = true;
	          this._paused = true;
	        }
	      }

	      if (this._prevFrame && this._prevFrame.disposeOp == 1) {
	        this.context.clearRect(this._prevFrame.left, this._prevFrame.top, this._prevFrame.width, this._prevFrame.height);
	      } else if (this._prevFrame && this._prevFrame.disposeOp == 2) {
	        this.context.putImageData(this._prevFrameData, this._prevFrame.left, this._prevFrame.top);
	      }

	      var frame = this.currentFrame;
	      this._prevFrame = frame;
	      this._prevFrameData = null;
	      if (frame.disposeOp == 2) {
	        this._prevFrameData = this.context.getImageData(frame.left, frame.top, frame.width, frame.height);
	      }
	      if (frame.blendOp == 0) {
	        this.context.clearRect(frame.left, frame.top, frame.width, frame.height);
	      }

	      var width = this._width || frame.width;
	      var height = this._height || frame.height;
	      this.context.drawImage(frame.imageElement, frame.left, frame.top, width, height);

	      this.emit('frame', this._currentFrameNumber);
	      if (this._ended) {
	        this.emit('end');
	      }
	    }

	    // playback

	  }, {
	    key: 'play',
	    value: function play() {
	      var _this2 = this;

	      if (this._rafId) {
	        cancelAnimationFrame(this._rafId);
	      }

	      this.emit('play');

	      if (this._ended) {
	        this.stop();
	      }
	      this._paused = false;

	      var nextRenderTime = performance.now() + this.currentFrame.delay / this.playbackRate;
	      var tick = function tick(now) {
	        if (_this2._ended || _this2._paused) {
	          return;
	        }
	        if (now >= nextRenderTime) {
	          while (now - nextRenderTime >= _this2._apng.playTime / _this2.playbackRate) {
	            nextRenderTime += _this2._apng.playTime / _this2.playbackRate;
	            _this2._numPlays++;
	          }
	          do {
	            _this2.renderNextFrame();
	            nextRenderTime += _this2.currentFrame.delay / _this2.playbackRate;
	          } while (!_this2._ended && !_this2._paused && now > nextRenderTime);
	        }
	        _this2._rafId = requestAnimationFrame(tick);
	      };
	      this._rafId = requestAnimationFrame(tick);
	    }
	  }, {
	    key: 'pause',
	    value: function pause() {
	      if (!this._paused) {
	        if (this._rafId) {
	          cancelAnimationFrame(this._rafId);
	          this._rafId = null;
	        }
	        this.emit('pause');
	        this._paused = true;
	      }
	    }
	  }, {
	    key: 'stop',
	    value: function stop() {
	      if (this._rafId) {
	        cancelAnimationFrame(this._rafId);
	        this._rafId = null;
	      }
	      this.emit('stop');
	      this._numPlays = 0;
	      this._ended = false;
	      this._paused = true;
	      // render first frame
	      this._currentFrameNumber = -1;
	      this.context.clearRect(0, 0, this._apng.width, this._apng.height);
	      this.renderNextFrame();
	    }
	  }, {
	    key: 'currentFrameNumber',
	    get: function get() {
	      return this._currentFrameNumber;
	    }

	    /**
	     *
	     * @return {Frame}
	     */

	  }, {
	    key: 'currentFrame',
	    get: function get() {
	      return this._apng.frames[this._currentFrameNumber];
	    }
	  }, {
	    key: 'paused',
	    get: function get() {
	      return this._paused;
	    }
	  }, {
	    key: 'ended',
	    get: function get() {
	      return this._ended;
	    }
	  }]);

	  return _class;
	}(_events2.default);

	exports.default = _class;

/***/ }),
/* 4 */
/***/ (function(module, exports) {

	// Copyright Joyent, Inc. and other Node contributors.
	//
	// Permission is hereby granted, free of charge, to any person obtaining a
	// copy of this software and associated documentation files (the
	// "Software"), to deal in the Software without restriction, including
	// without limitation the rights to use, copy, modify, merge, publish,
	// distribute, sublicense, and/or sell copies of the Software, and to permit
	// persons to whom the Software is furnished to do so, subject to the
	// following conditions:
	//
	// The above copyright notice and this permission notice shall be included
	// in all copies or substantial portions of the Software.
	//
	// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
	// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
	// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
	// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
	// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
	// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
	// USE OR OTHER DEALINGS IN THE SOFTWARE.

	function EventEmitter() {
	  this._events = this._events || {};
	  this._maxListeners = this._maxListeners || undefined;
	}
	module.exports = EventEmitter;

	// Backwards-compat with node 0.10.x
	EventEmitter.EventEmitter = EventEmitter;

	EventEmitter.prototype._events = undefined;
	EventEmitter.prototype._maxListeners = undefined;

	// By default EventEmitters will print a warning if more than 10 listeners are
	// added to it. This is a useful default which helps finding memory leaks.
	EventEmitter.defaultMaxListeners = 10;

	// Obviously not all Emitters should be limited to 10. This function allows
	// that to be increased. Set to zero for unlimited.
	EventEmitter.prototype.setMaxListeners = function(n) {
	  if (!isNumber(n) || n < 0 || isNaN(n))
	    throw TypeError('n must be a positive number');
	  this._maxListeners = n;
	  return this;
	};

	EventEmitter.prototype.emit = function(type) {
	  var er, handler, len, args, i, listeners;

	  if (!this._events)
	    this._events = {};

	  // If there is no 'error' event listener then throw.
	  if (type === 'error') {
	    if (!this._events.error ||
	        (isObject(this._events.error) && !this._events.error.length)) {
	      er = arguments[1];
	      if (er instanceof Error) {
	        throw er; // Unhandled 'error' event
	      } else {
	        // At least give some kind of context to the user
	        var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
	        err.context = er;
	        throw err;
	      }
	    }
	  }

	  handler = this._events[type];

	  if (isUndefined(handler))
	    return false;

	  if (isFunction(handler)) {
	    switch (arguments.length) {
	      // fast cases
	      case 1:
	        handler.call(this);
	        break;
	      case 2:
	        handler.call(this, arguments[1]);
	        break;
	      case 3:
	        handler.call(this, arguments[1], arguments[2]);
	        break;
	      // slower
	      default:
	        args = Array.prototype.slice.call(arguments, 1);
	        handler.apply(this, args);
	    }
	  } else if (isObject(handler)) {
	    args = Array.prototype.slice.call(arguments, 1);
	    listeners = handler.slice();
	    len = listeners.length;
	    for (i = 0; i < len; i++)
	      listeners[i].apply(this, args);
	  }

	  return true;
	};

	EventEmitter.prototype.addListener = function(type, listener) {
	  var m;

	  if (!isFunction(listener))
	    throw TypeError('listener must be a function');

	  if (!this._events)
	    this._events = {};

	  // To avoid recursion in the case that type === "newListener"! Before
	  // adding it to the listeners, first emit "newListener".
	  if (this._events.newListener)
	    this.emit('newListener', type,
	              isFunction(listener.listener) ?
	              listener.listener : listener);

	  if (!this._events[type])
	    // Optimize the case of one listener. Don't need the extra array object.
	    this._events[type] = listener;
	  else if (isObject(this._events[type]))
	    // If we've already got an array, just append.
	    this._events[type].push(listener);
	  else
	    // Adding the second element, need to change to array.
	    this._events[type] = [this._events[type], listener];

	  // Check for listener leak
	  if (isObject(this._events[type]) && !this._events[type].warned) {
	    if (!isUndefined(this._maxListeners)) {
	      m = this._maxListeners;
	    } else {
	      m = EventEmitter.defaultMaxListeners;
	    }

	    if (m && m > 0 && this._events[type].length > m) {
	      this._events[type].warned = true;
	      console.error('(node) warning: possible EventEmitter memory ' +
	                    'leak detected. %d listeners added. ' +
	                    'Use emitter.setMaxListeners() to increase limit.',
	                    this._events[type].length);
	      if (typeof console.trace === 'function') {
	        // not supported in IE 10
	        console.trace();
	      }
	    }
	  }

	  return this;
	};

	EventEmitter.prototype.on = EventEmitter.prototype.addListener;

	EventEmitter.prototype.once = function(type, listener) {
	  if (!isFunction(listener))
	    throw TypeError('listener must be a function');

	  var fired = false;

	  function g() {
	    this.removeListener(type, g);

	    if (!fired) {
	      fired = true;
	      listener.apply(this, arguments);
	    }
	  }

	  g.listener = listener;
	  this.on(type, g);

	  return this;
	};

	// emits a 'removeListener' event iff the listener was removed
	EventEmitter.prototype.removeListener = function(type, listener) {
	  var list, position, length, i;

	  if (!isFunction(listener))
	    throw TypeError('listener must be a function');

	  if (!this._events || !this._events[type])
	    return this;

	  list = this._events[type];
	  length = list.length;
	  position = -1;

	  if (list === listener ||
	      (isFunction(list.listener) && list.listener === listener)) {
	    delete this._events[type];
	    if (this._events.removeListener)
	      this.emit('removeListener', type, listener);

	  } else if (isObject(list)) {
	    for (i = length; i-- > 0;) {
	      if (list[i] === listener ||
	          (list[i].listener && list[i].listener === listener)) {
	        position = i;
	        break;
	      }
	    }

	    if (position < 0)
	      return this;

	    if (list.length === 1) {
	      list.length = 0;
	      delete this._events[type];
	    } else {
	      list.splice(position, 1);
	    }

	    if (this._events.removeListener)
	      this.emit('removeListener', type, listener);
	  }

	  return this;
	};

	EventEmitter.prototype.removeAllListeners = function(type) {
	  var key, listeners;

	  if (!this._events)
	    return this;

	  // not listening for removeListener, no need to emit
	  if (!this._events.removeListener) {
	    if (arguments.length === 0)
	      this._events = {};
	    else if (this._events[type])
	      delete this._events[type];
	    return this;
	  }

	  // emit removeListener for all listeners on all events
	  if (arguments.length === 0) {
	    for (key in this._events) {
	      if (key === 'removeListener') continue;
	      this.removeAllListeners(key);
	    }
	    this.removeAllListeners('removeListener');
	    this._events = {};
	    return this;
	  }

	  listeners = this._events[type];

	  if (isFunction(listeners)) {
	    this.removeListener(type, listeners);
	  } else if (listeners) {
	    // LIFO order
	    while (listeners.length)
	      this.removeListener(type, listeners[listeners.length - 1]);
	  }
	  delete this._events[type];

	  return this;
	};

	EventEmitter.prototype.listeners = function(type) {
	  var ret;
	  if (!this._events || !this._events[type])
	    ret = [];
	  else if (isFunction(this._events[type]))
	    ret = [this._events[type]];
	  else
	    ret = this._events[type].slice();
	  return ret;
	};

	EventEmitter.prototype.listenerCount = function(type) {
	  if (this._events) {
	    var evlistener = this._events[type];

	    if (isFunction(evlistener))
	      return 1;
	    else if (evlistener)
	      return evlistener.length;
	  }
	  return 0;
	};

	EventEmitter.listenerCount = function(emitter, type) {
	  return emitter.listenerCount(type);
	};

	function isFunction(arg) {
	  return typeof arg === 'function';
	}

	function isNumber(arg) {
	  return typeof arg === 'number';
	}

	function isObject(arg) {
	  return typeof arg === 'object' && arg !== null;
	}

	function isUndefined(arg) {
	  return arg === void 0;
	}


/***/ })
/******/ ])
});
;



/*
 * 拍照插件 WebP 兼容层.
 *
 * 拍照插件会对所有照片资源调用 parseAPNG. 当转换后的 WebP 仍使用 .png
 * 文件名时, 原 apng-js 会返回 Not a PNG 错误对象. 拍照插件仅检查
 * isNotAPNG, 随后会调用 createImages, 因而触发 TypeError.
 *
 * 本文件只包装 apngJs.default. 真正的 PNG 仍完全交给官方 apng-js 解析.
 * WebP 则使用 webp.js 暴露的 loadWEBP, 并适配为拍照插件所需的接口.
 *
 * 此代码必须紧随 apng-js bundle，以便 index.html 中的
 * `var parseAPNG = apngJs.default` 取得包装后的函数。
 */
;(function installWebPPhotoCompatibility(global) {
  'use strict'

  function bytesOf(input) {
    if (input instanceof ArrayBuffer) return new Uint8Array(input)
    if (input && input.buffer instanceof ArrayBuffer) {
      return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength)
    }
    return null
  }

  function isWebP(input) {
    var bytes = bytesOf(input)
    return !!(
      bytes &&
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 &&
      bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 &&
      bytes[10] === 0x42 && bytes[11] === 0x50
    )
  }

  function waitForWebPDecoder() {
    if (typeof global.loadWEBP === 'function') return Promise.resolve(global.loadWEBP)

    return new Promise(function (resolve, reject) {
      var timeout = global.setTimeout(function () {
        global.clearInterval(timer)
        reject(new Error('WebP 解码器 loadWEBP 未加载'))
      }, 10000)
      var timer = global.setInterval(function () {
        if (typeof global.loadWEBP === 'function') {
          global.clearInterval(timer)
          global.clearTimeout(timeout)
          resolve(global.loadWEBP)
        }
      }, 16)
    })
  }

  function WebPPhotoAsset(buffer) {
    this._buffer = buffer
    this._loadPromise = null
    this.width = 0
    this.height = 0
    this.numPlays = 0
    this.playTime = 0
    this.frames = []
  }

  WebPPhotoAsset.prototype.createImages = function () {
    var asset = this
    if (asset._loadPromise) return asset._loadPromise

    asset._loadPromise = waitForWebPDecoder()
      .then(function (loadWEBP) {
        return loadWEBP(asset._buffer)
      })
      .then(function (decoded) {
        if (!decoded || !Array.isArray(decoded.images) || decoded.images.length === 0) {
          throw new Error('WebP 解码器未返回图像帧')
        }

        var info = global.TyranoWebP && global.TyranoWebP.inspect
          ? global.TyranoWebP.inspect(asset._buffer)
          : null
        asset.numPlays = info && Number(info.loopCount) > 0 ? Number(info.loopCount) + 1 : 0
        asset.frames = decoded.images.map(function (image, index) {
          var delay = Number(decoded.delays && decoded.delays[index])
          return {
            left: 0,
            top: 0,
            width: image.naturalWidth || image.width || 0,
            height: image.naturalHeight || image.height || 0,
            delay: Number.isFinite(delay) && delay > 0 ? delay : 100,
            disposeOp: 0,
            blendOp: 0,
            imageData: null,
            imageElement: image,
          }
        })
        asset.width = asset.frames[0].width
        asset.height = asset.frames[0].height
        asset.playTime = asset.frames.reduce(function (total, frame) {
          return total + frame.delay
        }, 0)
        return asset.frames
      })

    return asset._loadPromise
  }

  WebPPhotoAsset.prototype.getPlayer = function (context, autoPlay, width, height) {
    return this.createImages().then(function () {
      return new WebPPhotoPlayer(this, context, !!autoPlay, width, height)
    }.bind(this))
  }

  function WebPPhotoPlayer(asset, context, autoPlay, width, height) {
    this._asset = asset
    this.context = context
    this._width = width || null
    this._height = height || null
    this._currentFrameNumber = 0
    this._completedPlays = 0
    this._paused = true
    this._ended = false
    this._timer = null
    this.stop()
    if (autoPlay) this.play()
  }

  WebPPhotoPlayer.prototype._drawCurrentFrame = function () {
    var frame = this._asset.frames[this._currentFrameNumber]
    if (!frame || !this.context || !this.context.canvas) return
    var canvas = this.context.canvas
    this.context.clearRect(0, 0, canvas.width, canvas.height)
    this.context.drawImage(
      frame.imageElement,
      0,
      0,
      this._width || frame.width,
      this._height || frame.height
    )
  }

  WebPPhotoPlayer.prototype._scheduleNextFrame = function () {
    var player = this
    if (player._paused || player._ended || player._asset.frames.length <= 1) return
    var frame = player._asset.frames[player._currentFrameNumber]
    player._timer = global.setTimeout(function () {
      if (player._paused || player._ended) return
      player._currentFrameNumber += 1
      if (player._currentFrameNumber >= player._asset.frames.length) {
        player._completedPlays += 1
        if (player._asset.numPlays && player._completedPlays >= player._asset.numPlays) {
          player._currentFrameNumber = player._asset.frames.length - 1
          player._ended = true
          player._paused = true
          player._drawCurrentFrame()
          return
        }
        player._currentFrameNumber = 0
      }
      player._drawCurrentFrame()
      player._scheduleNextFrame()
    }, Math.max(frame.delay, 1))
  }

  WebPPhotoPlayer.prototype.play = function () {
    if (this._ended) this.stop()
    if (!this._paused) return
    this._paused = false
    this._scheduleNextFrame()
  }

  WebPPhotoPlayer.prototype.pause = function () {
    if (this._timer) global.clearTimeout(this._timer)
    this._timer = null
    this._paused = true
  }

  WebPPhotoPlayer.prototype.stop = function () {
    this.pause()
    this._currentFrameNumber = 0
    this._completedPlays = 0
    this._ended = false
    this._drawCurrentFrame()
  }

  if (!global || !global.apngJs || typeof global.apngJs.default !== 'function') {
    console.error('[WebP] apng-js 未加载，无法安装拍照兼容层')
    return
  }
  if (global.apngJs.__photoWebPCompatibilityInstalled) return

  var originalParseAPNG = global.apngJs.default
  global.apngJs.default = function parseAPNGWithWebPCompatibility(buffer) {
    return isWebP(buffer) ? new WebPPhotoAsset(buffer) : originalParseAPNG(buffer)
  }
  global.apngJs.__photoWebPCompatibilityInstalled = true
  global.__dcWebPPhotoCompatibilityInstalled = true
})(typeof window !== 'undefined' ? window : this)
