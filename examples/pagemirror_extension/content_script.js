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
let startTime = 0

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
    const time = new Date().getTime()
    let message = {
      type,
      time,
      elapsed: time - startTime,
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
  startTime = new Date().getTime()
  postMessage({
    type: "start",
    args: {
      base: location.href.match(/^(.*\/)[^\/]*$/)[1],
      sessionId,
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

  // マウス移動
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

  // クリック
  const clickEventListener = (e) => {
    postMessage({
      type: 'click',
      args: {
        clientX: e.clientX,
        clientY: e.clientY,
      }
    })
  }
  window.addEventListener("click", clickEventListener, true)
  eventListeners.push(["click", clickEventListener, true])

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

  // Input入力
  const postInputEvent = (target, value) => {
    const node = mirrorClient.serializeNode(target)
    if (!node) {
      return
    }
    postMessage({
      type: 'input',
      args: {
        target: node.id,
        value,
      }
    })
  }

  // JSで入力されたとき
  // const jsInputHandler = function (target, before, after) {
  //   // チェックボックスとラジオボタンは描画できるので、ひとまず除外
  //   // イベントを取得するという意味ではとった方が良いが、イベントが多すぎる
  //   if (target.type === "checkbox" || target.type === "radio") {
  //     return
  //   }
  //   if (before == after) {
  //     return
  //   }
  //   console.log(after)
  //   postInputEvent(target, after)
  // };
  const code = `(function (target, property, callback) {
    const pd = Object.getOwnPropertyDescriptor(target, property);
    if (!(pd && pd.configurable && pd.set)) {
      return
    }
    Object.defineProperty(target, property, {
      configurable: pd.configurable,
      enumerable: pd.enumerable,
      get: pd.get,
      set: function (v) {
        const _target = this;
        const before = this.value
        pd.set.call(this, v);

        window.setTimeout(function () {
          if (_target.type === "checkbox" || _target.type === "radio") {
            return
          }
          if (before == v) {
            return
          }
          const e = new Event('input', {
            'bubbles': true,
            'cancelable': true
          });
          _target.dispatchEvent(e);
          // callback(_target, before, v)
        }, 0)
      }
    })
  })(HTMLInputElement.prototype, "value");`
  // })(HTMLInputElement.prototype, "value", jsInputHandler);

  const script = document.createElement('script');
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.parentNode.removeChild(script);

  // ユーザが入力したとき
  const userInputHandler = (e) => {
    const target = e.target
    if (target.type === "checkbox" || target.type === "radio") {
      return
    }
    postInputEvent(target, target.value)
  }
  window.addEventListener("input", userInputHandler, true)
  eventListeners.push(["input", userInputHandler])

  port.onDisconnect.addListener(function () {
    mirrorClient.disconnect();
    eventListeners.forEach(el => window.removeEventListener.apply(window, el))
    eventListeners = []
  });

});