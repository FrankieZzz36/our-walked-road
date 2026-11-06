/* ============================================================
   我们一起走过的路 · 访问密码
   - 仅在 http / https 下要求密码；本地 file:// 使用 local-key.js
   - PBKDF2-SHA256 校验密码，并解开 AES-GCM 数据密钥
   - 数据密钥只保存在当前标签页的 sessionStorage
   - 修改密码：运行 tools/set_password.py
   ============================================================ */

(() => {
  "use strict";

  const PASSWORD_CONFIG = {
    salt: "71be454a668c01f9b63f2c78f3c1c4b2",
    iterations: 210000,
    hash: "a478bc4cc352b83d6455c0954847945b75bd7a7c64f0d6caf005625a300dfc7e",
    wrappedKey: "pl57UqMuXhMeJZRN6RNXCmogTYySf45Fx0JTmtgck+hqlFK71DgHfZO7i7iVCL3kQKCbZoxiK3YGlPQL",
  };

  const STORAGE_KEY = "ourroad.dataKey";
  const LEGACY_KEY = "ourroad.unlocked";
  const HEX = "0123456789abcdef";
  const isFile = window.location.protocol === "file:";

  const root = document.documentElement;
  const screen = document.getElementById("lockScreen");
  const form = document.getElementById("lockForm");
  const input = document.getElementById("lockInput");
  const submit = document.getElementById("lockSubmit");
  const error = document.getElementById("lockError");

  const listeners = [];
  let locked = root.classList.contains("is-locked");
  let initialized = false;

  try {
    window.sessionStorage.removeItem(LEGACY_KEY);
  } catch (err) {
    /* 忽略不可用的 sessionStorage */
  }

  function notifyReady() {
    while (listeners.length) {
      const callback = listeners.shift();
      try {
        callback();
      } catch (err) {
        console.error("[lock]", err);
      }
    }
  }

  function markInitialized() {
    initialized = true;
    if (!locked) {
      notifyReady();
    }
  }

  function hideScreen(immediate) {
    if (!screen) {
      return;
    }

    if (immediate) {
      screen.style.display = "none";
      return;
    }

    screen.classList.add("is-leaving");
    window.setTimeout(() => {
      screen.style.display = "none";
    }, 720);
  }

  function showLockScreen(message) {
    locked = true;
    root.classList.add("is-locked");
    if (screen) {
      screen.classList.remove("is-leaving");
      screen.style.display = "grid";
    }
    if (message && error) {
      error.textContent = message;
    }
    markInitialized();
    window.setTimeout(() => {
      if (input) {
        input.focus();
      }
    }, 120);
  }

  async function finishUnlock(keyBytes, persist) {
    if (!window.OurRoadPrivate || typeof window.OurRoadPrivate.init !== "function") {
      throw new Error("private module missing");
    }

    await window.OurRoadPrivate.init(keyBytes);

    if (persist) {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, bytesToB64(keyBytes));
      } catch (err) {
        /* 隐私模式下可能无法写入，本次标签页内仍然有效 */
      }
    }

    locked = false;
    root.classList.remove("is-locked");
    if (error) {
      error.textContent = "";
    }
    hideScreen(false);
    markInitialized();
  }

  function bytesToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let output = "";
    for (let index = 0; index < bytes.length; index += 1) {
      output += HEX[bytes[index] >> 4] + HEX[bytes[index] & 15];
    }
    return output;
  }

  function sameHash(left, right) {
    if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
      return false;
    }

    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
      difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
  }

  function hexToBytes(hex) {
    if (typeof hex !== "string" || hex.length % 2 !== 0) {
      return new Uint8Array(0);
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      const pair = hex.slice(index * 2, index * 2 + 2);
      const value = Number.parseInt(pair, 16);
      if (Number.isNaN(value)) {
        return new Uint8Array(0);
      }
      bytes[index] = value;
    }
    return bytes;
  }

  function b64ToBytes(text) {
    const binary = window.atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function bytesToB64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return window.btoa(binary);
  }

  async function derivePassword(password) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("unsupported");
    }

    const encoder = new TextEncoder();
    const key = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await window.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: hexToBytes(PASSWORD_CONFIG.salt),
        iterations: PASSWORD_CONFIG.iterations,
        hash: "SHA-256",
      },
      key,
      512
    );
    const bytes = new Uint8Array(bits);
    return {
      verifyHash: bytesToHex(bytes.slice(0, 32)),
      wrappingKey: bytes.slice(32, 64),
    };
  }

  async function unwrapDataKey(wrappingKey) {
    const wrappingCryptoKey = await window.crypto.subtle.importKey(
      "raw",
      wrappingKey,
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const wrapped = b64ToBytes(PASSWORD_CONFIG.wrappedKey);
    const plaintext = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrapped.slice(0, 12) },
      wrappingCryptoKey,
      wrapped.slice(12)
    );
    const keyBytes = new Uint8Array(plaintext);
    if (keyBytes.length !== 32) {
      throw new Error("invalid key");
    }
    return keyBytes;
  }

  async function verifyPassword(password) {
    const derived = await derivePassword(password);
    if (!sameHash(derived.verifyHash, PASSWORD_CONFIG.hash)) {
      return null;
    }
    return unwrapDataKey(derived.wrappingKey);
  }

  function readSessionKey() {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return null;
      }
      const bytes = b64ToBytes(stored);
      return bytes.length === 32 ? bytes : null;
    } catch (err) {
      return null;
    }
  }

  function readLocalKey() {
    if (!window.OURROAD_LOCAL_KEY) {
      return null;
    }
    try {
      const bytes = b64ToBytes(window.OURROAD_LOCAL_KEY);
      return bytes.length === 32 ? bytes : null;
    } catch (err) {
      return null;
    }
  }

  function showError(message) {
    if (error) {
      error.textContent = message;
    }
    if (form) {
      form.classList.remove("is-error");
      void form.offsetWidth;
      form.classList.add("is-error");
    }
    if (input) {
      input.select();
    }
  }

  if (form && input && submit) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const password = input.value;
      if (!password) {
        showError("请输入访问密码");
        input.focus();
        return;
      }

      submit.disabled = true;
      submit.classList.add("is-busy");
      if (error) {
        error.textContent = "";
      }

      try {
        const keyBytes = await verifyPassword(password);
        if (keyBytes) {
          input.value = "";
          await finishUnlock(keyBytes, true);
        } else {
          showError("密码不正确，请再试一次");
        }
      } catch (err) {
        showError(
          err && err.message === "unsupported"
            ? "当前浏览器无法验证密码，请换用现代浏览器或 HTTPS 打开"
            : "验证失败，请稍后重试"
        );
      } finally {
        submit.disabled = false;
        submit.classList.remove("is-busy");
        window.setTimeout(() => {
          if (locked && input) {
            input.focus();
          }
        }, 60);
      }
    });
  }

  window.starseaLock = {
    isLocked() {
      return locked;
    },
    whenReady(callback) {
      if (typeof callback !== "function") {
        return;
      }
      if (initialized && !locked) {
        callback();
      } else {
        listeners.push(callback);
      }
    },
  };

  async function initialize() {
    if (isFile) {
      const localKey = readLocalKey();
      if (localKey) {
        try {
          await finishUnlock(localKey, false);
          return;
        } catch (err) {
          console.error("[lock] local key failed", err);
          showLockScreen("本地密钥无效，请输入访问密码");
          return;
        }
      }

      showLockScreen("未找到本地密钥，请输入访问密码");
      return;
    }

    const sessionKey = readSessionKey();
    if (sessionKey) {
      try {
        await finishUnlock(sessionKey, false);
        return;
      } catch (err) {
        console.error("[lock] session key failed", err);
        try {
          window.sessionStorage.removeItem(STORAGE_KEY);
        } catch (storageError) {
          /* 忽略 */
        }
      }
    }

    showLockScreen();
  }

  initialize().catch((err) => {
    console.error("[lock]", err);
    showLockScreen("初始化失败，请刷新页面重试");
  });
})();
