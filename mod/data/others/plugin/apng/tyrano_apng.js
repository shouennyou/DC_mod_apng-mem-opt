/*
 * 使用例:
 * [load_apng folder="fgimage" storage="default/apng.png" name="myapng1"]
 *
 * folder: フォルダ名（"image"などにもできる）
 * storage: folderのフォルダ配下のファイルパス
 * name: 名前
 * wait: ロード完了を待機する場合はtrue
 */
TYRANO.kag.dc = {
  ...TYRANO.kag.dc,
  apng: {
    // registry 只保存路径；WebP 分流传入的 buffer 不保留，避免形成常驻副本。
    registry: {},
    apngs: {},
    loading: {},
    loadingRejectors: {},
    workers: {},
    frames: {},
    played: {},
    playbacks: {},
    releaseTimers: {},
    cacheLifetime: 30 * 1000,
    addToLoadQueue: function (path, name, buffer) {
      // WebP 分类阶段已经读取过完整文件；在启用 APNG 预加载时复用它，
      // 避免随后进入 Worker 前再次按路径读取同一资源。
      this.register(path, name, this.shouldPreload() ? buffer : undefined)
    },
    register: function (path, name, buffer) {
      if (this.registry[name]?.path !== path) this.dispose(name)
      const registration = this.registry[name] || { path }
      registration.path = path
      if (buffer) registration.buffer = buffer
      this.registry[name] = registration
    },
    shouldPreload: function () {
      return window.__dcApngMemoryOptimizerConfig?.shouldPreload('apng') === true
    },
    preloadRegistered: function () {
      if (!this.shouldPreload()) return Promise.resolve()
      return Promise.all(
        Object.keys(this.registry).map(name =>
          this.ensureLoaded(name)
            .catch(error => {
              console.error(`APNG 预加载失败: ${name}`, error)
            })
        )
      )
    },
    // 保留 load_apng 标签兼容；默认帧解码延后到首次 play_apng。
    load: function () {
      return this.preloadRegistered()
    },
    cancelRelease: function (name) {
      if (this.releaseTimers[name]) clearTimeout(this.releaseTimers[name])
      delete this.releaseTimers[name]
    },
    getReleaseDelay: function () {
      const config = window.__dcApngMemoryOptimizerConfig
      return config ? config.getReleaseDelay('apng') : this.cacheLifetime
    },
    scheduleRelease: function (name) {
      // 启动预加载复刻原版 load_apng：帧缓存常驻，完全忽略 APNG 释放配置。
      if (this.shouldPreload()) {
        this.cancelRelease(name)
        return
      }
      const asset = this.apngs[name]
      if (!asset) return
      this.cancelRelease(name)
      const delay = this.getReleaseDelay()
      if (delay === null) return
      this.releaseTimers[name] = setTimeout(() => {
        delete this.releaseTimers[name]
        // 仅释放安排计时时的缓存，且绝不打断新的播放。
        if (this.apngs[name] === asset && !this.playbacks[name]) {
          this.releaseFrames(name, asset)
        }
      }, delay)
    },
    applyReleasePolicy: function () {
      if (this.shouldPreload()) {
        Object.keys(this.releaseTimers).forEach(name => this.cancelRelease(name))
        this.preloadRegistered()
        return
      }
      const delay = this.getReleaseDelay()
      this.preloadRegistered()
      if (delay === null) {
        Object.keys(this.releaseTimers).forEach(name => this.cancelRelease(name))
        return
      }
      Object.keys(this.apngs).forEach(name => {
        if (!this.playbacks[name]) this.scheduleRelease(name)
      })
    },
    ensureLoaded: function (name) {
      if (this.apngs[name]) {
        this.cancelRelease(name)
        return Promise.resolve(this.apngs[name])
      }
      if (this.loading[name]) return this.loading[name]
      const registration = this.registry[name]
      if (!registration) return Promise.reject(new Error(`未注册 APNG: ${name}`))
      const useOriginalPreloadDecoder = this.shouldPreload()

      let rejectLoading
      const promise = new Promise((resolve, reject) => {
        let active = true
        let worker
        const cleanUpWorker = () => {
          if (!worker) return
          worker.terminate()
          if (this.workers[name] === worker) delete this.workers[name]
          worker = null
        }
        const fail = error => {
          if (!active) return
          active = false
          cleanUpWorker()
          reject(error)
        }
        rejectLoading = fail
        this.loadingRejectors[name] = fail
        try {
          worker = new Worker('./tyrano/libs/apng.js')
          this.workers[name] = worker
          worker.onmessage = e => {
            const { frames, delays, error } = e.data || {}
            if (error) return fail(new Error(error))
            cleanUpWorker()
            if (!Array.isArray(frames) || !Array.isArray(delays)) {
              return fail(new Error(`无法解析 APNG: ${name}`))
            }
            const decodedImages = []
            Promise.all(
              frames.map(frame =>
                this.decodeFrame(frame.blob, useOriginalPreloadDecoder).then(image => {
                  if (!active) {
                    this.releaseImage(image)
                    return image
                  }
                  decodedImages.push(image)
                  return image
                })
              )
            )
              .then(images => {
                if (!active) {
                  decodedImages.forEach(image => this.releaseImage(image))
                  return
                }
                resolve({ images, delays })
              })
              .catch(error => {
                decodedImages.forEach(image => this.releaseImage(image))
                fail(error)
              })
          }
          worker.onerror = error => fail(error)
          // prepare() 提供的 buffer 只属于本次 Worker 解码。发送时 transfer
          // 所有权，随后不再由注册表持有；未预加载或直接注册时才回退为读取路径。
          const source = registration.buffer
          if (source) delete registration.buffer
          const sourcePromise = source
            ? Promise.resolve(source)
            : readAsArrayBuffer(registration.path)
          sourcePromise
            .then(buffer => {
              if (!active) return
              const transferable =
                buffer instanceof ArrayBuffer ? buffer : buffer.buffer
              worker.postMessage(buffer, [transferable])
            })
            .catch(error => fail(error))
        } catch (error) {
          fail(error)
        }
      })
        .then(apng => {
          this.apngs[name] = apng
          return apng
        })
        .finally(() => {
          if (this.loading[name] === promise) delete this.loading[name]
          if (this.loadingRejectors[name] === rejectLoading) {
            delete this.loadingRejectors[name]
          }
        })
      this.loading[name] = promise
      return promise
    },
    decodeFrame: function (blob, useOriginalPreloadDecoder) {
      if (useOriginalPreloadDecoder) return this.decodeFrameAsOriginalImage(blob)
      if (typeof createImageBitmap === 'function') {
        return createImageBitmap(blob).catch(() => this.decodeFrameAsImage(blob))
      }
      return this.decodeFrameAsImage(blob)
    },
    // 与原版 tyrano_apng.js 相同的 FileReader → Data URL → Image 解码路径。
    decodeFrameAsOriginalImage: function (blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.onerror = error => reject(error)
          image.crossOrigin = 'anonymous'
          image.src = reader.result
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
    },
    decodeFrameAsImage: function (blob) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob)
        const image = new Image()
        image.onload = () => {
          URL.revokeObjectURL(url)
          resolve(image)
        }
        image.onerror = error => {
          URL.revokeObjectURL(url)
          reject(error)
        }
        image.src = url
      })
    },
    stopPlayback: function (name, token = null) {
      const playback = this.playbacks[name]
      if (!playback || (token && playback.token !== token)) return false
      playback.cancel()
      delete this.playbacks[name]
      return true
    },
    releaseFrames: function (name, expectedAsset = null) {
      const asset = this.apngs[name]
      if (!asset || (expectedAsset && asset !== expectedAsset)) return false
      asset.images.forEach(image => this.releaseImage(image))
      delete this.apngs[name]
      delete this.frames[name]
      return true
    },
    releaseImage: function (image) {
      if (typeof image.close === 'function') image.close()
      else image.removeAttribute?.('src')
    },
    dispose: function (name) {
      this.cancelRelease(name)
      const rejectLoading = this.loadingRejectors[name]
      delete this.loading[name]
      delete this.loadingRejectors[name]
      rejectLoading?.(new Error(`APNG 加载已取消: ${name}`))
      this.stopPlayback(name)
      this.workers[name]?.terminate()
      delete this.workers[name]
      if (this.played[name]?.canvas) $(this.played[name].canvas).remove()
      delete this.played[name]
      this.releaseFrames(name)
    },
    getFrameIndex: function (name) {
      return this.frames[name]
    },
  },
}

window.__dcApngMemoryOptimizerConfig?.subscribe(() => {
  TYRANO.kag.dc.apng.applyReleasePolicy()
})

TYRANO.kag.ftag.master_tag.register_apng = {
  kag: TYRANO.kag,
  vital: ['storage', 'name'],

  pm: {
    folder: 'fgimage',
    storage: '',
    name: '',
  },

  start: function ({ folder, storage, name }) {
    const path = `./data/${folder}/${storage}`
    this.kag.dc.apng.addToLoadQueue(path, name)
    this.kag.ftag.nextOrder()
  },
}

TYRANO.kag.ftag.master_tag.load_apng = {
  kag: TYRANO.kag,
  start: function () {
    this.kag.dc.apng.load().then(() => {
      this.kag.ftag.nextOrder()
    })
  },
}

/*
 * 使用例:
 * [play_apng name="myapng1" layer="0" x="0" y="0" width="300" height="300" page="fore"]
 * [play_apng name="myapng1" x="0" y="0" width="300" height="300" mode="screen"]
 *
 * name: 名前
 * layer: レイヤー
 * x: X座標
 * y: Y座標
 * width: 幅
 * height: 高さ
 * page: "fore" | "back"
 * mode: 合成モード（指定した場合、layerとpageは無効）
 * zindex: z-index
 * free: 再生後に消去するかどうか
 */
TYRANO.kag.ftag.master_tag.play_apng = {
  kag: TYRANO.kag,
  vital: ['name'],

  pm: {
    layer: '0',
    name: '',
    x: 0,
    y: 0,
    width: 300,
    height: 300,
    page: 'fore',
    mode: null,
    zindex: 0,
    free: false,
  },

  start: function (pm) {
    const apng = this.kag.dc.apng
    apng
      .ensureLoaded(pm.name)
      .then(loadedApng => {
        const layer = pm.mode ? 'fix' : pm.layer
        const targetLayer = this.kag.layer.getLayer(layer, pm.page)
        const previous = apng.played[pm.name]
        // 旧 free_apng 正在淡出时，必须新建 canvas，避免旧回调删掉新播放。
        if (
          !previous ||
          previous.layer !== layer ||
          previous.releasing ||
          !previous.canvas ||
          !document.contains(previous.canvas)
        ) {
          targetLayer.append(
            `<canvas class="${pm.name}" width="${this.kag.config.scWidth}" height="${this.kag.config.scHeight}">`
          )
        }
        const canvas = previous && !previous.releasing && previous.canvas
          ? $(previous.canvas)
          : targetLayer.find(`canvas.${pm.name}`).last()
        canvas
          .css('position', 'absolute')
          .css('z-index', pm.mode ? 1000000 : pm.zindex)
        if (pm.mode) canvas.css('mix-blend-mode', pm.mode)

        apng.stopPlayback(pm.name)
        const token = Symbol(pm.name)
        const cancel = playAPNG(
          loadedApng,
          canvas[0],
          pm.x,
          pm.y,
          pm.width,
          pm.height,
          false,
          () => {
            if (apng.playbacks[pm.name]?.token !== token) return
            apng.stopPlayback(pm.name, token)
            if (pm.free) {
              if (apng.played[pm.name]?.token === token) delete apng.played[pm.name]
              canvas.remove()
            }
            apng.scheduleRelease(pm.name)
          },
          index => {
            if (apng.playbacks[pm.name]?.token === token) {
              apng.frames[pm.name] = index
            }
          }
        )
        apng.playbacks[pm.name] = { token, cancel, canvas: canvas[0] }
        if (!pm.free) {
          apng.played[pm.name] = {
            layer,
            page: pm.mode ? null : pm.page,
            token,
            canvas: canvas[0],
            releasing: false,
          }
        } else {
          delete apng.played[pm.name]
        }
        this.kag.ftag.nextOrder()
      })
      .catch(error => {
        console.error(`APNG 加载失败: ${pm.name}`, error)
        this.kag.ftag.nextOrder()
      })
  },
}

/*
 * 使用例:
 * [free_apng name="myapng1"]
 *
 * name: 名前
 * time: フェードアウト待ち時間
 * wait: フェードアウトを待つかどうか
 */
TYRANO.kag.ftag.master_tag.free_apng = {
  kag: TYRANO.kag,
  vital: ['name'],

  pm: {
    name: '',
    time: 0,
    wait: false,
    stop: false,
  },

  start: function (pm) {
    const apng = this.kag.dc.apng
    const target = apng.played[pm.name]
    if (!target) {
      if (!pm.stop) this.kag.ftag.nextOrder()
      return
    }

    target.releasing = true
    const canvas = $(target.canvas)
    const finish = () => {
      canvas.remove()
      // 旧 free 只能清理它调用时对应的播放实例。
      if (apng.played[pm.name]?.token === target.token) {
        apng.stopPlayback(pm.name, target.token)
        delete apng.played[pm.name]
        apng.scheduleRelease(pm.name)
      }
      if (pm.wait && !pm.stop) this.kag.ftag.nextOrder()
    }
    const time = Math.max(Number(pm.time) || 0, 0)
    if (time) canvas.fadeOut(time, finish)
    else finish()
    if (!pm.wait && !pm.stop) this.kag.ftag.nextOrder()
  },
}
