/*
 * APNG 插件的动画 WebP 支持.
 *
 * 本文件不修改 APNG 解析和 canvas 播放器.
 * 它提供 register_webp/load_webp/play_webp/free_webp, 并检查每个
 * 已注册文件的字节, 因此不会通过扩展名判断 APNG 或 WebP.
 */
var webp = {
  loads: [],
  assets: {},
  known: {},
  cacheLifetime: 30 * 1000,
  releaseTimers: {},
  frames: {},
  played: {},
  timers: {},
  generations: {},

  addToLoadQueue: function (path, name, webpOnly) {
    this.loads.push({ path: path, name: name, webpOnly: !!webpOnly })
  },

  has: function (name) {
    return !!this.assets[name]
  },

  isWebP: function (name) {
    return !!this.known[name]
  },

  shouldPreload: function () {
    return window.__dcApngMemoryOptimizerConfig?.shouldPreload('webp') === true
  },

  touchAsset: function (name) {
    this.cancelAssetRelease(name)
  },

  cancelAssetRelease: function (name) {
    if (this.releaseTimers[name]) clearTimeout(this.releaseTimers[name])
    delete this.releaseTimers[name]
  },

  getReleaseDelay: function () {
    var config = window.__dcApngMemoryOptimizerConfig
    return config ? config.getReleaseDelay('webp') : this.cacheLifetime
  },

  scheduleAssetRelease: function (name) {
    // 启动预加载时资源常驻，忽略 WebP 释放配置。
    if (this.shouldPreload()) {
      this.cancelAssetRelease(name)
      return
    }
    var that = this
    var asset = this.assets[name]
    if (!asset) return
    this.cancelAssetRelease(name)
    var delay = this.getReleaseDelay()
    if (delay === null) return
    this.releaseTimers[name] = setTimeout(function () {
      delete that.releaseTimers[name]
      // 仅释放安排倒计时时的资产. 同名资源重新加载后不受旧倒计时影响.
      if (that.assets[name] === asset) that.releaseAsset(name)
    }, delay)
  },

  applyReleasePolicy: function () {
    if (this.shouldPreload()) {
      Object.keys(this.releaseTimers).forEach(function (name) {
        this.cancelAssetRelease(name)
      }, this)
      this.preloadKnown()
      return
    }
    var delay = this.getReleaseDelay()
    this.preloadKnown()
    if (delay === null) {
      Object.keys(this.releaseTimers).forEach(function (name) {
        this.cancelAssetRelease(name)
      }, this)
      return
    }
    Object.keys(this.assets).forEach(function (name) {
      this.scheduleAssetRelease(name)
    }, this)
  },

  preloadKnown: function () {
    if (!this.shouldPreload()) return Promise.resolve()
    var that = this
    return Promise.all(
      Object.keys(this.known).map(function (name) {
        if (that.assets[name] || that.known[name].loading) return null
        return that.ensureAsset(name)
      })
    )
  },

  releaseAsset: function (name) {
    this.cancelAssetRelease(name)
    delete this.assets[name]
  },

  preloadImage: function (blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob)
      var image = new Image()
      image.onload = function () {
        URL.revokeObjectURL(url)
        resolve()
      }
      image.onerror = function () {
        URL.revokeObjectURL(url)
        reject(new Error('browser cannot decode WebP'))
      }
      image.src = url
    })
  },

  createAsset: function (name, path, data, info) {
    var that = this
    var record = this.known[name] || {}
    record.path = path
    record.status = 'loading'
    this.known[name] = record
    if (info.animated && TyranoWebP.setLoopCount(data, 1)) {
      info.loopCount = 1
    }
    var blob = new Blob([data], { type: 'image/webp' })
    var task = this.preloadImage(blob)
      .then(function () {
        var asset = { blob: blob, info: info }
        that.assets[name] = asset
        record.status = 'ready'
        record.loading = null
        that.scheduleAssetRelease(name)
        return asset
      })
      .catch(function (error) {
        record.status = 'failed'
        record.loading = null
        console.error('[webp] load failed: ' + path, error)
        return null
      })
    record.loading = task
    return task
  },

  ensureAsset: function (name) {
    var that = this
    var asset = this.assets[name]
    if (asset) {
      this.touchAsset(name)
      return Promise.resolve(asset)
    }
    var record = this.known[name]
    if (!record) return Promise.resolve(null)
    if (record.loading) return record.loading
    return readAsArrayBuffer(record.path)
      .then(function (data) {
        var info = TyranoWebP.inspect(data)
        if (!info) throw new Error('not a WebP file')
        return that.createAsset(name, record.path, data, info)
      })
      .catch(function (error) {
        record.status = 'failed'
        console.error('[webp] reload failed: ' + record.path, error)
        return null
      })
  },

  // 读取并分类队列中的每个文件. 此处会启动 WebP 图片预载,
  // 但不会立即等待它完成, 以便与 APNG Worker 解码并行.
  prepare: function () {
    var that = this
    var items = this.loads.splice(0)
    var preloads = []
    return Promise.all(
      items.map(function (item) {
        return readAsArrayBuffer(item.path)
          .then(function (data) {
            var info = TyranoWebP.inspect(data)
            if (!info) {
              if (item.webpOnly) throw new Error('not a WebP file')
              // 将已读取的字节交回未改动的 APNG 加载器.
              // 其 Worker 仍负责全部 APNG 解码.
              TYRANO.kag.dc.apng.addToLoadQueue(item.path, item.name, data)
              return
            }

            // 将原始无限循环改为有限的 WebP 循环次数.
            if (that.shouldPreload()) {
              preloads.push(that.createAsset(item.name, item.path, data, info))
            } else {
              var record = that.known[item.name] || {}
              record.path = item.path
              record.info = info
              record.status = 'registered'
              record.loading = null
              that.known[item.name] = record
            }
          })
          .catch(function (error) {
            console.error('[webp] load failed: ' + item.path, error)
          })
      })
    ).then(function () {
      return { preloads: Promise.all(preloads) }
    })
  },

  load: function () {
    return this.prepare().then(function (result) {
      return result.preloads
    })
  },

  elements: function (name) {
    var result = []
    var nodes = document.querySelectorAll('[data-tyrano-webp-name]')
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-tyrano-webp-name') === String(name)) {
        result.push(nodes[i])
      }
    }
    return $(result)
  },

  clearTimer: function (name) {
    if (this.timers[name]) clearTimeout(this.timers[name])
    delete this.timers[name]
  },

  removeElements: function (elements) {
    elements.each(function () {
      if (this.__tyranoWebpUrl) URL.revokeObjectURL(this.__tyranoWebpUrl)
      this.__tyranoWebpUrl = null
      $(this).stop(true, true).remove()
    })
  },

  remove: function (name, releaseAsset, skipSchedule) {
    this.clearTimer(name)
    this.removeElements(this.elements(name))
    delete this.played[name]
    delete this.frames[name]
    if (releaseAsset) this.releaseAsset(name)
    else if (!skipSchedule) this.scheduleAssetRelease(name)
  },

  getFrameIndex: function (name) {
    var playback = this.frames[name]
    if (!playback) return undefined
    var info = playback.info
    if (!info.animated || !info.totalMs) return 0

    var elapsed = Date.now() - playback.startedAt
    if (playback.duration !== Infinity && elapsed >= playback.duration) {
      return info.durations.length - 1
    }
    elapsed %= info.totalMs
    var total = 0
    for (var i = 0; i < info.durations.length; i++) {
      total += info.durations[i]
      if (elapsed < total) return i
    }
    return info.durations.length - 1
  },

  playbackDuration: function (info) {
    if (!info || !info.animated || !info.totalMs) return 0
    // WebP 将其定义为首次播放后的重复次数.
    // 0 表示无限循环, 缺少 ANIM 块时按播放一次处理.
    if (info.loopCount === 0) return Infinity
    if (typeof info.loopCount !== 'number' || info.loopCount < 0) {
      return info.totalMs
    }
    return info.totalMs * (info.loopCount + 1)
  },

  startFrameClock: function (name, info, generation) {
    var that = this
    var startedAt = Date.now()
    var duration = this.playbackDuration(info)
    this.clearTimer(name)
    this.frames[name] = {
      startedAt: startedAt,
      info: info,
      duration: duration,
      generation: generation,
    }
    if (!info.animated || !info.totalMs || duration === Infinity) return
    this.timers[name] = setTimeout(function () {
      delete that.timers[name]
      if (that.generations[name] !== generation) {
        return
      }
      that.scheduleAssetRelease(name)
    }, Math.max(duration, 1))
  },
}

TYRANO.kag.dc = Object.assign({}, TYRANO.kag.dc, { webp: webp })

window.__dcApngMemoryOptimizerConfig?.subscribe(function () {
  webp.applyReleasePolicy()
})

function layerFor(tag, pm) {
  var layer = pm.mode ? 'fix' : pm.layer
  return { layer: layer, target: tag.kag.layer.getLayer(layer, pm.page) }
}

function continueScenario(tag, pm) {
  if (!pm.stop) tag.kag.ftag.nextOrder()
}

function startWebPPlayback(tag, pm, asset) {
  webp.touchAsset(pm.name)
  var info = asset.info
  var place = layerFor(tag, pm)
  // 新建 object URL 和元素, 强制 Chromium 从第 0 帧重新播放.
  webp.remove(pm.name, false, true)
  var generation = (webp.generations[pm.name] || 0) + 1
  webp.generations[pm.name] = generation
  var image = document.createElement('img')
  var url = URL.createObjectURL(asset.blob)
  image.__tyranoWebpUrl = url
  image.__tyranoWebpGeneration = generation
  image.setAttribute('data-tyrano-webp-name', pm.name)
  image.className = pm.name
  image.style.position = 'absolute'
  image.style.left = Number(pm.x) + 'px'
  image.style.top = Number(pm.y) + 'px'
  image.style.width = Number(pm.width) + 'px'
  image.style.height = Number(pm.height) + 'px'
  image.style.zIndex = pm.mode ? 1000000 : Number(pm.zindex) || 0
  image.style.mixBlendMode = pm.mode || 'normal'
  image.style.pointerEvents = 'none'

  image.onload = function () {
    if (!image.parentNode || webp.generations[pm.name] !== generation) return
    webp.startFrameClock(pm.name, info, generation)
    // 静态 WebP 没有播放结束计时器，也应恢复空闲缓存释放。
    if (!info.animated || !info.totalMs) webp.scheduleAssetRelease(pm.name)
    if (pm.free && info.animated) {
      var lifetime = webp.playbackDuration(info)
      if (lifetime === Infinity) return
      setTimeout(function () {
        if (
          image.parentNode &&
          webp.generations[pm.name] === generation
        ) {
          webp.remove(pm.name)
        }
      }, Math.max(lifetime, 1) + 120)
    }
  }
  image.onerror = function () {
    console.error('[webp] browser cannot play: ' + pm.name)
    if (image.parentNode && webp.generations[pm.name] === generation) {
      webp.remove(pm.name)
    }
  }

  image.src = url
  place.target.append(image)
  webp.played[pm.name] = {
    layer: place.layer,
    page: pm.mode ? null : pm.page,
    generation: generation,
  }
  tag.kag.ftag.nextOrder()
}

var webpTags = {
  register: {
    kag: TYRANO.kag,
    vital: ['storage', 'name'],
    pm: { folder: 'fgimage', storage: '', name: '' },
    start: function (pm) {
      webp.addToLoadQueue('./data/' + pm.folder + '/' + pm.storage, pm.name, true)
      this.kag.ftag.nextOrder()
    },
  },

  load: {
    kag: TYRANO.kag,
    start: function () {
      var tag = this
      webp.load().then(function () {
        tag.kag.ftag.nextOrder()
      })
    },
  },

  play: {
    kag: TYRANO.kag,
    vital: ['name'],
    pm: {
      layer: '0', name: '', x: 0, y: 0, width: 300, height: 300,
      page: 'fore', mode: null, zindex: 0, free: false,
    },
    start: function (pm) {
      var tag = this
      webp.ensureAsset(pm.name).then(function (asset) {
        if (!asset) {
          console.error('[webp] 无法加载 WebP 资源: ' + pm.name)
          tag.kag.ftag.nextOrder()
          return
        }
        startWebPPlayback(tag, pm, asset)
      })
    },
  },

  free: {
    kag: TYRANO.kag,
    vital: ['name'],
    pm: { name: '', time: 0, wait: false, stop: false },
    start: function (pm) {
      var tag = this
      var elements = webp.elements(pm.name)
      var generation = webp.generations[pm.name]
      if (!elements.length) {
        webp.remove(pm.name)
        continueScenario(this, pm)
        return
      }

      var finished = false
      var finish = function () {
        if (finished) return
        finished = true
        // 仅移除调用 free_apng 时已存在的元素.
        // 同名 play_apng 可能已经创建了更新的实例.
        webp.removeElements(elements)
        if (webp.generations[pm.name] === generation) {
          webp.clearTimer(pm.name)
          delete webp.played[pm.name]
          delete webp.frames[pm.name]
          webp.scheduleAssetRelease(pm.name)
        }
        if (pm.wait) continueScenario(tag, pm)
      }
      var time = Math.max(Number(pm.time) || 0, 0)
      if (time) elements.fadeOut(time, finish)
      else finish()
      setTimeout(finish, time + 1500)
      if (!pm.wait) continueScenario(this, pm)
    },
  },
}

var tags = TYRANO.kag.ftag.master_tag
tags.register_webp = webpTags.register
tags.load_webp = webpTags.load
tags.play_webp = webpTags.play
tags.free_webp = webpTags.free

// 保持现有剧本不变. 所有数据都会在加载时检测, 因此重命名后的 WebP 文件
// 包括仍使用 *.png 名称的文件, 都会进入 WebP 路径.
var originalRegister = tags.register_apng
var originalLoad = tags.load_apng
var originalPlay = tags.play_apng
var originalFree = tags.free_apng
var originalGetFrameIndex = TYRANO.kag.dc.apng.getFrameIndex

tags.register_apng = Object.assign({}, originalRegister, {
  start: function (pm) {
    webp.addToLoadQueue('./data/' + pm.folder + '/' + pm.storage, pm.name, false)
    this.kag.ftag.nextOrder()
  },
})

tags.load_apng = Object.assign({}, originalLoad, {
  start: function () {
    var tag = this
    webp.prepare()
      .then(function (result) {
        return Promise.all([result.preloads, TYRANO.kag.dc.apng.load()])
      })
      .then(function () {
        tag.kag.ftag.nextOrder()
      })
  },
})

tags.play_apng = Object.assign({}, originalPlay, {
  start: function (pm) {
    if (webp.isWebP(pm.name)) return webpTags.play.start.call(this, pm)
    return originalPlay.start.call(this, pm)
  },
})

tags.free_apng = Object.assign({}, originalFree, {
  start: function (pm) {
    if (webp.isWebP(pm.name)) return webpTags.free.start.call(this, pm)
    return originalFree.start.call(this, pm)
  },
})

TYRANO.kag.dc.apng.getFrameIndex = function (name) {
  return webp.isWebP(name) ? webp.getFrameIndex(name) : originalGetFrameIndex.call(this, name)
}
