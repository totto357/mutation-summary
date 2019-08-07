
window.addEventListener('DOMContentLoaded', function () {
  if (typeof WebKitMutationObserver !== 'function') {
    var h1 = document.body.appendChild(document.createElement('h3'));
    h1.textContent = 'This example requires Mutation Observers';

    var a = document.body.appendChild(document.createElement('a'));
    a.textContent = 'Try the Chrome Canary build';
    a.href = 'http://tools.google.com/dlpage/chromesxs';
    return;
  }

  var tabId = Number(location.href.match(/\?tabId=([0-9]*$)/)[1]);
  if (isNaN(tabId)) {
    return;
  }

  const frame = document.getElementById("mirror-frame")
  if (!frame) {
    return;
  }
  const frameDocument = frame.contentDocument

  while (frameDocument.firstChild) {
    frameDocument.removeChild(frameDocument.firstChild);
  }

  let base = "";

  var mirror = new TreeMirror(frameDocument, {
    createElement: function (tagName) {
      /* Somewhere outside the function (no need to recreate this every time an element is created */

      // SVG関係
      // TODO useタグで宣言されているものは難しい
      const svgElems = ["altGlyph", "altGlyphDef", "altGlyphItem", "animate", "animateColor", "animateMotion", "animateTransform", "circle", "clipPath", "color-profile", "cursor", "defs", "desc", "discard", "ellipse", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence", "filter", "font", "font-face", "font-face-format", "font-face-name", "font-face-src", "font-face-uri", "foreignObject", "g", "glyph", "glyphRef", "hatch", "hatchpath", "hkern", "image", "line", "linearGradient", "marker", "mask", "mesh", "meshgradient", "meshpatch", "meshrow", "metadata", "missing-glyph", "mpath", "path", "pattern", "polygon", "polyline", "radialGradient", "rect", "set", "solidcolor", "stop", "svg", "use", "switch", "symbol", "text", "textPath", "tref", "tspan", "unknown", "view", "vkern"].join("|")
      const svgMatch = new RegExp(`^(${svgElems})$`)

      if (svgMatch.test(tagName)) {
        const node = frameDocument.createElementNS(
          "http://www.w3.org/2000/svg",
          tagName
        )
        return node
      }

      if (tagName == 'SCRIPT') {
        var node = frameDocument.createElement('NO-SCRIPT')
        node.style.display = 'none'
        return node
      }

      if (tagName == 'HEAD') {
        var node = frameDocument.createElement('HEAD')
        node.appendChild(frameDocument.createElement('BASE'))
        node.firstChild.href = base
        return node
      }
    }
  });

  let mouse = frameDocument.createElement("div")
  mouse.innerHTML = `<svg style="width:24px;height:24px" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M13.64,21.97C13.14,22.21 12.54,22 12.31,21.5L10.13,16.76L7.62,18.78C7.45,18.92 7.24,19 7,19A1,1 0 0,1 6,18V3A1,1 0 0,1 7,2C7.24,2 7.47,2.09 7.64,2.23L7.65,2.22L19.14,11.86C19.57,12.22 19.62,12.85 19.27,13.27C19.12,13.45 18.91,13.57 18.7,13.61L15.54,14.23L17.74,18.96C18,19.46 17.76,20.05 17.26,20.28L13.64,21.97Z" />
                    </svg>`
  mouse.style = `position: fixed;
                 z-index: 99999999;
                 top: -100px; left: -100px;
                 color: #999;
                `

  const port = chrome.tabs.connect(tabId)
  let events = {}
  const receivedMessages = []

  port.onMessage.addListener(function (msg) {
    receivedMessages.push(msg)

    let args = null
    if (msg.divided) {
      !events[msg.eventId] && (events[msg.eventId] = [])
      events[msg.eventId].push({ index: msg.divided.index, args: msg.args })

      // 分割してるイベントの途中はなにもしない
      if (events[msg.eventId].length < msg.divided.size) {
        return
      }

      const _args = events[msg.eventId].sort((a, b) => {
        if (a.index < b.index) return -1
        if (a.index > b.index) return 1
        return 0
      }).map(e => e.args).join("")

      args = JSON.parse(_args)
      delete events[msg.eventId]

    } else {
      args = JSON.parse(msg.args)
    }

    if (msg.type === "start") {
      base = args.base;

    } else if (msg.type === "initialize") {
      mirror.initialize.apply(mirror, args);
      frameDocument.body.appendChild(mouse)

    } else if (msg.type === "applyChanged") {
      mirror.applyChanged.apply(mirror, args);

    } else if (msg.type === "scroll") {
      const id = args.target
      const node = args.isScrollingElement ? frameDocument.scrollingElement : mirror.idMap[id]
      node.scrollTo(args.left, args.top)

    } else if (msg.type === "mousemove") {
      mouse.style.top = args.clientY
      mouse.style.left = args.clientX

    } else if (msg.type === "resize") {
      frame.style.height = args.height
      frame.style.width = args.width

    } else {
      console.error("対応するイベントタイプがないよ。")
    }

  })

  port.onDisconnect.addListener(function (msg) {
    const blob = new Blob([ JSON.stringify(receivedMessages) ], { "type" : "text/plain" })
    window.URL = window.URL || window.webkitURL
    const a = document.createElement("a")
    a.textContent = "ダウンロード"
    a.href = window.URL.createObjectURL(blob)
    document.body.appendChild(a)

    // window.close()
  })
})