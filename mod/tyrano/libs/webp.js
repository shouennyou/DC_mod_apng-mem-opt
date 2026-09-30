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
