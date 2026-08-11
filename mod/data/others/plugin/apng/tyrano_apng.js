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
    registry: {},
    apngs: {},
    loading: {},
    loadingRejectors: {},
    workers: {},
    frames: {},
    played: {},
    playbacks: {},
    addToLoadQueue: function (path, name) {
      this.register(path, name)
    },
    register: function (path, name) {
      if (this.registry[name]?.path !== path) {
        this.release(name)
      }
      this.registry[name] = { path }
    },
    load: function () {
      // 保留 load_apng 标签的调用兼容, 实际解码延后到 play_apng.
      return Promise.resolve()
    },
    ensureLoaded: function (name) {
      if (this.apngs[name]) {
        return Promise.resolve(this.apngs[name])
      }
      if (this.loading[name]) {
        return this.loading[name]
      }

      const registration = this.registry[name]
      if (!registration) {
        return Promise.reject(new Error(`未注册 APNG: ${name}`))
      }

      let rejectLoading
      const promise = new Promise((resolve, reject) => {
        let active = true
        const worker = new Worker('./tyrano/libs/apng.js')
        this.workers[name] = worker
        const cleanUpWorker = () => {
          worker.terminate()
          if (this.workers[name] === worker) {
            delete this.workers[name]
          }
        }
        const fail = error => {
          if (!active) return
          active = false
          cleanUpWorker()
          reject(error)
        }
        rejectLoading = fail
        this.loadingRejectors[name] = fail

        worker.onmessage = e => {
          const { frames, delays, error } = e.data || {}
          if (error) {
            fail(new Error(error))
            return
          }
          cleanUpWorker()
          if (!Array.isArray(frames) || !Array.isArray(delays)) {
            fail(new Error(`无法解析 APNG: ${name}`))
            return
          }

          const decodedImages = []
          Promise.all(
            frames.map(frame =>
              this.decodeFrame(frame.blob).then(image => {
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
        worker.onerror = error => {
          fail(error)
        }

        readAsArrayBuffer(registration.path)
          .then(buffer => {
            if (!active) return
            const transferable =
              buffer instanceof ArrayBuffer ? buffer : buffer.buffer
            worker.postMessage(buffer, [transferable])
          })
          .catch(error => {
            fail(error)
          })
      })
        .then(apng => {
          this.apngs[name] = apng
          return apng
        })
        .finally(() => {
          if (this.loading[name] === promise) {
            delete this.loading[name]
          }
          if (this.loadingRejectors[name] === rejectLoading) {
            delete this.loadingRejectors[name]
          }
        })

      this.loading[name] = promise
      return promise
    },
    decodeFrame: function (blob) {
      if (typeof createImageBitmap == 'function') {
        return createImageBitmap(blob).catch(() => this.decodeFrameAsImage(blob))
      }
      return this.decodeFrameAsImage(blob)
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
    stopPlayback: function (name) {
      const playback = this.playbacks[name]
      if (playback) {
        playback.cancel()
        delete this.playbacks[name]
      }
    },
    release: function (name, token = null) {
      const playback = this.playbacks[name]
      if (token && playback && playback.token !== token) {
        return false
      }

      const rejectLoading = this.loadingRejectors[name]
      delete this.loading[name]
      delete this.loadingRejectors[name]
      rejectLoading?.(new Error(`APNG 加载已取消: ${name}`))
      this.stopPlayback(name)
      this.workers[name]?.terminate()
      delete this.workers[name]
      this.releaseFrames(name)
      return true
    },
    releaseFrames: function (name) {
      this.apngs[name]?.images.forEach(image => this.releaseImage(image))
      delete this.apngs[name]
      delete this.frames[name]
    },
    releaseImage: function (image) {
      if (typeof image.close == 'function') {
        image.close()
      } else {
        image.removeAttribute?.('src')
      }
    },
    getFrameIndex: function (name) {
      return this.frames[name]
    },
  },
}

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
        // mix-blend-modeを有効にするために #tyrano_base に直にcanvasを置く必要がある
        const targetLayer = this.kag.layer.getLayer(layer, pm.page)

        // 再生していない・別レイヤーで再生している・一度消されている場合は新しくcanvasを作成
        if (
          !apng.played[pm.name] ||
          apng.played[pm.name].layer !== layer ||
          targetLayer.find(`canvas.${pm.name}`).length == 0
        ) {
          const canvasTag = `<canvas class="${pm.name}" width="${this.kag.config.scWidth}" height="${this.kag.config.scHeight}">`
          targetLayer.append(canvasTag)
        }

        const canvas = targetLayer
          .find(`canvas.${pm.name}`)
          .css('position', 'absolute')
          .css('z-index', pm.mode ? 1000000 : pm.zindex)

        pm.mode && canvas.css('mix-blend-mode', pm.mode ? pm.mode : 'normal')

        const previousPlayback = apng.playbacks[pm.name]
        if (previousPlayback && previousPlayback.canvas !== canvas[0]) {
          $(previousPlayback.canvas).remove()
        }
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
            if (pm.free) {
              delete apng.played[pm.name]
              canvas.remove()
              apng.release(pm.name, token)
            } else if (apng.playbacks[pm.name]?.token === token) {
              apng.stopPlayback(pm.name)
              apng.releaseFrames(pm.name)
            }
          },
          index => {
            apng.frames[pm.name] = index
          }
        )
        apng.playbacks[pm.name] = { token, cancel, canvas: canvas[0] }

        if (!pm.free) {
          apng.played[pm.name] = {
            layer,
            page: pm.mode ? null : pm.page,
            token,
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
    const targetApng = apng.played[pm.name]
    if (!targetApng) {
      if (!pm.stop) this.kag.ftag.nextOrder()
      return
    }

    const targetLayer = this.kag.layer.getLayer(
      targetApng.layer,
      targetApng.page
    )
    const canvas = targetLayer.find(`canvas.${pm.name}`)
    canvas.fadeOut(pm.time, () => {
      canvas.remove()
      const released = apng.release(pm.name, targetApng.token)
      if (released && apng.played[pm.name]?.token === targetApng.token) {
        delete apng.played[pm.name]
      }
      if (pm.wait) {
        if (!pm.stop) this.kag.ftag.nextOrder()
      }
    })

    if (!pm.wait) {
      delete apng.played[pm.name]
      if (!pm.stop) this.kag.ftag.nextOrder()
    }
  },
}
