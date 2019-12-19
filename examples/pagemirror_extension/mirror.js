import AWS from "aws-sdk"

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

  // フレーム内スタイルを追加
  const frameStyle = frameDocument.createElement("style")
  frameStyle.type = "text/css"
  frameStyle.textContent = `
    .ripple-effect {
      position: fixed;
      z-index: 99999998;
      background: #000;
      width: 50px;
      height: 50px;
      border-radius: 100%;
      transform: scale(1, 1);
      opacity: 0;
      animation: ripple-effect .6s linear;
      transition: 0.3s linear;
    }

    @keyframes ripple-effect {
      0% {
        opacity: 0.5;
        transform: scale(0, 0);
      }
    }
  `

  while (frameDocument.firstChild) {
    frameDocument.removeChild(frameDocument.firstChild);
  }

  let base = "";
  let sessionId = "";

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
  mouse.innerHTML = `
      <svg style="width:30px;height:30px" x="0px" y="0px" viewBox="0 0 28 28" enable-background="new 0 0 28 28" >
          <polygon fill="#FFFFFF" points="8.2,20.9 8.2,4.9 19.8,16.5 13,16.5 12.6,16.6 "/>
          <polygon fill="#FFFFFF" points="17.3,21.6 13.7,23.1 9,12 12.7,10.5 "/>
          <rect x="12.5" y="13.6" transform="matrix(0.9221 -0.3871 0.3871 0.9221 -5.7605 6.5909)" width="2" height="8"/>
          <polygon points="9.2,7.3 9.2,18.5 12.2,15.6 12.6,15.5 17.4,15.5 "/>
      </svg>
      `
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
    if (msg.dividedEvent) {
      !events[msg.eventId] && (events[msg.eventId] = [])
      events[msg.eventId].push({ index: msg.dividedEvent.index, args: msg.args })

      // 分割してるイベントの途中はなにもしない
      if (events[msg.eventId].length < msg.dividedEvent.size) {
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

    if (msg.eventType === "start") {
      base = args.base;
      sessionId = args.sessionId;

    } else if (msg.eventType === "initialize") {
      mirror.initialize.apply(mirror, args);

      frameDocument.head.appendChild(frameStyle)
      frameDocument.body.appendChild(mouse)

    } else if (msg.eventType === "applyChanged") {
      mirror.applyChanged.apply(mirror, args);

    } else if (msg.eventType === "scroll") {
      const id = args.target
      const node = args.isScrollingElement ? frameDocument.scrollingElement : mirror.idMap[id]
      node.scrollTo(args.left, args.top)

    } else if (msg.eventType === "mousemove") {
      mouse.style.top = args.clientY - 6 // SVGの余白の関係上ずらす
      mouse.style.left = args.clientX - 8 // SVGの余白の関係上ずらす

    } else if (msg.eventType === "click") {
      const ripple = frameDocument.createElement("div")
      ripple.classList.add("ripple-effect")
      ripple.style.top = args.clientY - 25
      ripple.style.left = args.clientX - 25
      frameDocument.body.appendChild(ripple)

      setTimeout(() => {
        frameDocument.body.removeChild(ripple)
      }, 1000);

    } else if (msg.eventType === "resize") {
      frame.style.height = args.height
      frame.style.width = args.width

    } else if (msg.eventType === "input") {
      const id = args.target
      const node = mirror.idMap[id]
      node.value = args.value

    } else {
      console.error("対応するイベントタイプがないよ。")
    }

  })

  port.onDisconnect.addListener(function (msg) {
    const blob = new Blob([ JSON.stringify(receivedMessages) ], { "type" : "application/json" })
    window.URL = window.URL || window.webkitURL
    const a = document.createElement("a")
    a.textContent = "download"
    a.href = window.URL.createObjectURL(blob)
    a.download = sessionId
    document.body.appendChild(a)

    // window.close()
  })
})