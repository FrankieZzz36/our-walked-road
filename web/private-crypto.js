/* ============================================================
   我们一起走过的路 · 私有数据解密
   - 数据密钥由 lock.js 在密码验证后提供
   - 解密姓名/档案 JSON 与人物肖像，生成临时 Blob URL
   ============================================================ */

(() => {
  "use strict";

  let dataKey = null;
  let loadPromise = null;
  const objectUrls = [];

  function b64ToBytes(text) {
    const binary = window.atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function decryptPayload(payload) {
    if (!dataKey) {
      throw new Error("private data is locked");
    }

    const raw = b64ToBytes(payload);
    const plaintext = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12) },
      dataKey,
      raw.slice(12)
    );
    return new Uint8Array(plaintext);
  }

  function releaseUrls() {
    while (objectUrls.length) {
      window.URL.revokeObjectURL(objectUrls.pop());
    }
  }

  async function init(keyBytes) {
    if (!keyBytes || keyBytes.length !== 32) {
      throw new Error("invalid data key");
    }
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("WebCrypto unavailable");
    }

    releaseUrls();
    loadPromise = null;
    dataKey = await window.crypto.subtle.importKey(
      "raw",
      keyBytes,
      "AES-GCM",
      false,
      ["decrypt"]
    );
  }

  async function load() {
    if (!dataKey) {
      throw new Error("private data is locked");
    }
    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = (async () => {
      if (!window.OURROAD_PROFILES_ENC || !window.OURROAD_PORTRAITS_ENC) {
        throw new Error("encrypted assets missing");
      }

      const decoder = new TextDecoder();
      const profileBytes = await decryptPayload(window.OURROAD_PROFILES_ENC);
      const profiles = JSON.parse(decoder.decode(profileBytes));
      const encryptedPortraits = window.OURROAD_PORTRAITS_ENC;
      const result = {};

      for (const [key, profile] of Object.entries(profiles)) {
        const portrait = encryptedPortraits[profile.portraitKey];
        if (portrait) {
          const imageBytes = await decryptPayload(portrait.data);
          const url = window.URL.createObjectURL(
            new Blob([imageBytes], { type: portrait.type || "image/jpeg" })
          );
          objectUrls.push(url);
          profile.portraitUrl = url;
        } else {
          profile.portraitUrl = "";
        }
        result[key] = profile;
      }

      return result;
    })();

    try {
      return await loadPromise;
    } catch (error) {
      loadPromise = null;
      throw error;
    }
  }

  window.OurRoadPrivate = {
    init,
    load,
    isReady() {
      return Boolean(dataKey);
    },
  };
})();
