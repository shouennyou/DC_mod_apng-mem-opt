'use strict'

;(function initializeMemoryOptimizerConfig(global) {
  const CONFIG_PATH = 'config/apng-mem-opt.json'
  const POLL_INTERVAL = 1000
  const defaults = Object.freeze({
    apngPreload: false,
    apngReleaseMode: 'delayed',
    apngReleaseSeconds: 30,
    webpPreload: false,
    webpReleaseMode: 'delayed',
    webpReleaseSeconds: 30,
  })
  const listeners = []
  let lastContent = null
  let reading = false

  function normalize(input) {
    const next = Object.assign({}, defaults)
    if (!input || typeof input !== 'object' || Array.isArray(input)) return next
    ;['apng', 'webp'].forEach(kind => {
      const preloadKey = `${kind}Preload`
      const modeKey = `${kind}ReleaseMode`
      const secondsKey = `${kind}ReleaseSeconds`
      if (typeof input[preloadKey] === 'boolean') {
        next[preloadKey] = input[preloadKey]
      }
      if (['keep', 'immediate', 'delayed'].includes(input[modeKey])) {
        next[modeKey] = input[modeKey]
      }
      const seconds = Number(input[secondsKey])
      if (Number.isFinite(seconds) && seconds >= 0) {
        next[secondsKey] = Math.min(seconds, 24 * 60 * 60)
      }
    })
    return next
  }

  function notify() {
    listeners.slice().forEach(listener => {
      try {
        listener()
      } catch (error) {
          console.error('[内存优化] 配置更新回调失败', error)
      }
    })
  }

  const controller = {
    settings: Object.assign({}, defaults),
    getReleaseDelay: function (kind) {
      const mode = this.settings[`${kind}ReleaseMode`]
      if (mode === 'keep') return null
      if (mode === 'immediate') return 0
      return Math.round(this.settings[`${kind}ReleaseSeconds`] * 1000)
    },
    shouldPreload: function (kind) {
      return this.settings[`${kind}Preload`] === true
    },
    subscribe: function (listener) {
      if (typeof listener !== 'function') return
      listeners.push(listener)
      listener()
    },
  }
  global.__dcApngMemoryOptimizerConfig = controller

  function apply(content) {
    const parsed = content ? JSON.parse(content) : null
    controller.settings = normalize(parsed)
    notify()
  }

  function loadSync() {
    const api = global.modloader
    if (!api || typeof api.readFileSync !== 'function') return
    try {
      lastContent = api.readFileSync(CONFIG_PATH)
      apply(lastContent)
    } catch (error) {
      console.error('[内存优化] 配置读取失败，使用默认值', error)
    }
  }

  function poll() {
    const api = global.modloader
    if (reading || !api || typeof api.readFile !== 'function') return
    reading = true
    Promise.resolve(api.readFile(CONFIG_PATH))
      .then(content => {
        if (content === lastContent) return
        lastContent = content
        try {
          apply(content)
        } catch (error) {
          console.error('[内存优化] 配置格式无效，保留现有设置', error)
        }
      })
      .catch(error => {
        console.error('[内存优化] 配置刷新失败', error)
      })
      .then(() => {
        reading = false
      })
  }

  loadSync()
  global.setInterval(poll, POLL_INTERVAL)
})(window)
