const uuid = () => {
  let chars = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".split("");
  for (let i = 0, len = chars.length; i < len; i++) {
    switch (chars[i]) {
      case "x":
        chars[i] = Math.floor(Math.random() * 16).toString(16);
        break;
      case "y":
        chars[i] = (Math.floor(Math.random() * 4) + 8).toString(16);
        break;
    }
  }
  return chars.join("");
}

// 変数
const sessionId = uuid()

const throttleInterval = 50
const lastTime = {
  scroll: 0,
  mousemove: 0,
  resize: 0,
}

let eventListeners = []

chrome.extension.onConnect.addListener(function (port) {

  const throttle = (type, cb) => {
    const now = new Date().getTime()
    if (lastTime[type] + throttleInterval <= now) {
      lastTime[type] = now
      cb()
    }
  }

  const postMessage = ({ type, args }) => {
    // 別タブにメッセージを送信
    let message = {
      type,
      time: new Date().getTime(),
      sessionId,
      eventId: uuid(),
      divided: false,
      args: null,
    }

    // データを1MBを目安に分割
    const divided = divide(args)

    // 分割がない場合
    if (divided.length === 1) {
      message.args = divided[0]
      port.postMessage(message)
      return
    }

    // 分割する場合
    for (let index = 0; index < divided.length; index++) {
      message.divided = {
        index,
        size: divided.length,
      }
      message.args = divided[index]
      port.postMessage(message)
    }

  }

  const divide = (args) => {
    // エンコード済みのargs
    // 1MB ずつ分割
    return JSON.stringify(args).match(/[\s\S]{1,500000}/g)
  }

  // 開始イベント
  postMessage({
    type: "start",
    args: {
      base: location.href.match(/^(.*\/)[^\/]*$/)[1],
    }
  });

  // TreeMirrorからのイベント
  const mirrorClient = new TreeMirrorClient(document, {
    initialize: function (rootId, children) {
      postMessage({
        type: 'initialize',
        args: [rootId, children]
      });
    },

    applyChanged: function (removed, addedOrMoved, attributes, text) {
      postMessage({
        type: 'applyChanged',
        args: [removed, addedOrMoved, attributes, text]
      });
    }
  });

  // 独自のイベント
  // スクロール
  const scrollEventListener = (e) => {
    // スクロールの対象がHTMLの場合、
    // スクロールイベントのターゲットはdocumentになる(chromeだけ？)
    // しかし、mirror側ではbodyがスクロールイベントにする必要があるため、(iframeの仕様？)
    // HTMLのスクロールかどうかを渡してあげる必要がある
    const target = e.target === document ? document.scrollingElement : e.target
    const isScrollingElement = target === document.scrollingElement
    const node = mirrorClient.serializeNode(target)
    if (!node) {
      return
    }

    throttle("scroll", () => {
      postMessage({
        type: 'scroll',
        args: {
          target: node.id,
          isScrollingElement,
          top: target.scrollTop,
          left: target.scrollLeft,
        }
      })
    })
  }
  window.addEventListener("scroll", scrollEventListener, true)
  eventListeners.push(["scroll", scrollEventListener, true])

  // マウス
  const mousemoveEventListener = (e) => {
    throttle("mousemove", () => {
      postMessage({
        type: 'mousemove',
        args: {
          clientX: e.clientX,
          clientY: e.clientY,
        }
      })
    })
  }
  window.addEventListener("mousemove", mousemoveEventListener)
  eventListeners.push(["mousemove", mousemoveEventListener])

  // リサイズ
  const resizeEventListener = () => {
    throttle("resize", () => {
      postMessage({
        type: 'resize',
        args: {
          height: window.innerHeight,
          width: window.innerWidth,
        }
      })
    });
  }
  resizeEventListener()
  window.addEventListener("resize", resizeEventListener)
  eventListeners.push(["resize", resizeEventListener])

  port.onDisconnect.addListener(function () {
    mirrorClient.disconnect();
    eventListeners.forEach(el => window.removeEventListener.apply(window, el))
    eventListeners = []
  });

});