function toUint8(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (input && input.buffer instanceof ArrayBuffer) {
    return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength)
  }
  throw new TypeError('WebP data must be an ArrayBuffer or typed array')
}

function isFourCC(bytes, offset, value) {
  return (
    bytes[offset] === value.charCodeAt(0) &&
    bytes[offset + 1] === value.charCodeAt(1) &&
    bytes[offset + 2] === value.charCodeAt(2) &&
    bytes[offset + 3] === value.charCodeAt(3)
  )
}

function getView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

// 无效数据返回 null, 有效数据返回静态或动画 WebP 的信息.
function inspect(input) {
  var bytes
  try {
    bytes = toUint8(input)
  } catch (e) {
    return null
  }

  if (
    bytes.length < 12 ||
    !isFourCC(bytes, 0, 'RIFF') ||
    !isFourCC(bytes, 8, 'WEBP')
  ) {
    return null
  }

  var view = getView(bytes)
  var offset = 12
  var frameCount = 0
  var totalMs = 0
  var durations = []
  var loopCount = null

  while (offset + 8 <= bytes.length) {
    var size = view.getUint32(offset + 4, true)
    var payload = offset + 8
    var next = payload + size + (size & 1)
    if (next > bytes.length) return null

    if (isFourCC(bytes, offset, 'ANIM') && size >= 6) {
      loopCount = view.getUint16(payload + 4, true)
    } else if (isFourCC(bytes, offset, 'ANMF') && size >= 16) {
      var duration =
        bytes[payload + 12] |
        (bytes[payload + 13] << 8) |
        (bytes[payload + 14] << 16)
      frameCount++
      durations.push(duration)
      totalMs += duration
    }

    offset = next
  }

  return {
    isWebP: true,
    animated: frameCount > 0,
    frameCount: frameCount,
    totalMs: totalMs,
    durations: durations,
    loopCount: loopCount,
  }
}

// 将 WebP 解码为与 loadAPNG 相同的 { images, delays } 结构。
// 动画 WebP 使用 WebCodecs 逐帧解码后转为 PNG，供现有 canvas 播放器使用。
function loadWEBP(blob) {
  var bytes = toUint8(blob)
  var info = inspect(bytes)
  if (!info) return Promise.reject(new Error('不是 WebP 文件'))

  var toPNGImage = function (source, width, height) {
    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    var context = canvas.getContext('2d')
    if (!context) return Promise.reject(new Error('无法创建 WebP 解码画布'))
    context.drawImage(source, 0, 0, width, height)

    return new Promise(function (resolve, reject) {
      var image = new Image()
      image.onload = function () {
        resolve(image)
      }
      image.onerror = reject
      image.src = canvas.toDataURL('image/png')
    })
  }

  // 静态 WebP 可由浏览器原生 Image 解码；动画帧则必须依赖 WebCodecs。
  if (typeof ImageDecoder !== 'function') {
    if (info.animated) {
      return Promise.reject(
        new Error('当前 Chromium 不支持 ImageDecoder，无法拆分动态 WebP 帧')
      )
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }))
      var image = new Image()
      image.onload = function () {
        URL.revokeObjectURL(url)
        toPNGImage(image, image.naturalWidth, image.naturalHeight)
          .then(function (pngImage) {
            resolve({ images: [pngImage], delays: [0] })
          })
          .catch(reject)
      }
      image.onerror = function (error) {
        URL.revokeObjectURL(url)
        reject(error)
      }
      image.src = url
    })
  }

  return (async function () {
    var decoder = new ImageDecoder({
      data: bytes.slice(),
      type: 'image/webp',
      preferAnimation: true,
    })
    try {
      await decoder.tracks.ready
      var track = decoder.tracks.selectedTrack
      var frameCount = Math.max(
        Number(track && track.frameCount) || info.frameCount || 1,
        1
      )
      var images = []
      var delays = []

      for (var index = 0; index < frameCount; index++) {
        var result = await decoder.decode({ frameIndex: index })
        var frame = result.image
        try {
          images.push(
            await toPNGImage(frame, frame.displayWidth, frame.displayHeight)
          )
          var duration = Number(frame.duration)
          delays.push(
            Number.isFinite(duration) && duration > 0
              ? duration / 1000
              : info.durations[index] || 100
          )
        } finally {
          frame.close()
        }
      }

      return { images: images, delays: delays }
    } finally {
      decoder.close()
    }
  })()
}

// WebP ANIM 块: 前 4 字节为背景色, 后 2 字节为小端循环次数.
// 0 表示无限循环, 非零表示首次播放后的重复次数.
function setLoopCount(input, count) {
  var bytes
  try {
    bytes = toUint8(input)
  } catch (e) {
    return false
  }
  if (
    bytes.length < 12 ||
    !isFourCC(bytes, 0, 'RIFF') ||
    !isFourCC(bytes, 8, 'WEBP')
  ) {
    return false
  }

  var view = getView(bytes)
  var offset = 12
  while (offset + 8 <= bytes.length) {
    var size = view.getUint32(offset + 4, true)
    var payload = offset + 8
    var next = payload + size + (size & 1)
    if (next > bytes.length) return false
    if (isFourCC(bytes, offset, 'ANIM') && size >= 6) {
      view.setUint16(payload + 4, Math.max(0, Math.min(65535, Number(count) || 0)), true)
      return true
    }
    offset = next
  }
  return false
}

window.TyranoWebP = {
  inspect: inspect,
  isWebP: function (input) {
    return !!inspect(input)
  },
  setLoopCount: setLoopCount,
}
