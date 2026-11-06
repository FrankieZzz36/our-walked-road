/* ============================================================
   我们一起走过的路 · 交互脚本
   - 开场视频播放完 → 背景循环虚化 + 时钟缓慢浮现
   - 循环播放背景音乐《素颜》，右上角可暂停 / 继续
   - I / VIII 星徽 → 人物档案弹窗
   ============================================================ */

(() => {
  "use strict";

  const app = document.getElementById("app");
  const introVideo = document.getElementById("introVideo");
  const bgVideo = document.getElementById("bgVideo");
  const skipButton = document.getElementById("skipIntro");
  const hint = document.getElementById("hint");
  const enterGate = document.getElementById("enterGate");
  const bgm = document.getElementById("bgm");
  const musicToggle = document.getElementById("musicToggle");
  const modal = document.getElementById("modal");
  const closeButton = modal.querySelector(".modal__close");
  const hotspots = Array.from(document.querySelectorAll(".hotspot"));

  const params = new URLSearchParams(window.location.search);
  const isPreview = params.get("preview") === "1";
  const isIntroTest = params.get("introTest") === "1";
  const modalOnLoad = params.get("modal");

  const MUSIC_VOLUME = 0.46;
  const MUSIC_PREF_KEY = "starsea.music.muted";

  let introDone = false;
  let fallbackTimer = 0;
  let lastFocusedElement = null;
  let musicMuted = false;
  let musicBlocked = false;
  let musicFadeToken = 0;
  let musicUnlockBound = false;
  let introMusicStarted = false;
  let booted = false;

  try {
    musicMuted = window.localStorage.getItem(MUSIC_PREF_KEY) === "1";
  } catch (error) {
    musicMuted = false;
  }

  const log = (...args) => {
    console.log("[starsea]", ...args);
  };

  /* ==========================================================
     背景音乐：素颜 · 许嵩 / 何曼婷
     ========================================================== */

  function updateMusicUI() {
    if (!musicToggle) {
      return;
    }

    const paused = musicMuted || musicBlocked;
    musicToggle.classList.toggle("is-paused", paused);
    musicToggle.setAttribute("aria-pressed", String(!paused));
    musicToggle.setAttribute(
      "aria-label",
      paused ? "播放背景音乐：素颜" : "暂停背景音乐：素颜"
    );
    musicToggle.title = paused ? "播放背景音乐" : "暂停背景音乐";
  }

  function fadeMusicTo(target, duration = 2200, onDone) {
    if (!bgm) {
      return;
    }

    const token = ++musicFadeToken;
    const from = bgm.volume;
    const start = performance.now();

    const step = (now) => {
      if (token !== musicFadeToken) {
        return;
      }

      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      bgm.volume = Math.min(
        1,
        Math.max(0, from + (target - from) * eased)
      );

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else if (typeof onDone === "function") {
        onDone();
      }
    };

    window.requestAnimationFrame(step);
  }

  function bindMusicUnlock() {
    if (musicUnlockBound) {
      return;
    }

    musicUnlockBound = true;
    const unlock = () => {
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      musicUnlockBound = false;
      if (!musicMuted) {
        playMusic();
      }
    };

    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
  }

  function playMusic() {
    if (!bgm || musicMuted) {
      return;
    }

    bgm.volume = 0;
    const playPromise = bgm.play();

    if (!playPromise || typeof playPromise.then !== "function") {
      musicBlocked = false;
      updateMusicUI();
      fadeMusicTo(MUSIC_VOLUME);
      return;
    }

    playPromise
      .then(() => {
        if (musicMuted) {
          bgm.pause();
          bgm.volume = 0;
          return;
        }

        musicBlocked = false;
        updateMusicUI();
        log("background music playing", bgm.duration);
        fadeMusicTo(MUSIC_VOLUME);
      })
      .catch((error) => {
        if (error && error.name === "AbortError") {
          return;
        }

        log("background music blocked:", error && error.name, error && error.message);
        if (error && error.name === "NotAllowedError") {
          musicBlocked = true;
          updateMusicUI();
          bindMusicUnlock();
        }
      });
  }

  function pauseMusic() {
    if (!bgm) {
      return;
    }

    fadeMusicTo(0, 420, () => {
      if (musicMuted || musicBlocked) {
        bgm.pause();
      }
    });
  }

  function setMusicMuted(muted) {
    musicMuted = muted;

    try {
      if (muted) {
        window.localStorage.setItem(MUSIC_PREF_KEY, "1");
      } else {
        window.localStorage.removeItem(MUSIC_PREF_KEY);
      }
    } catch (error) {
      /* 本地存储不可用时，仅在本次运行中生效 */
    }

    if (muted) {
      pauseMusic();
    } else {
      playMusic();
    }

    updateMusicUI();
  }

  if (musicToggle) {
    musicToggle.addEventListener("click", () => {
      if (musicMuted) {
        setMusicMuted(false);
      } else if (musicBlocked) {
        playMusic();
      } else {
        setMusicMuted(true);
      }
    });
  }

  if (bgm) {
    bgm.addEventListener("error", () => {
      log("background music error", bgm.error);
    });
  }

  /* ==========================================================
     人物档案数据
     公开页面不含姓名、文案和照片；解锁后从加密文件读取。
     修改 private/profiles.json 后运行 tools/encrypt_private.py。
     ========================================================== */

  const CONSTELLATIONS = {
    pisces: `
      <g class="const-line">
        <path d="M36 96 L72 66 L100 84 L126 56 L158 72 L186 52" />
        <path d="M36 96 L56 124 L86 111 L114 136 L146 121 L184 133" />
        <path d="M100 84 L114 136" opacity=".35" />
        <path d="M126 56 L158 72" opacity=".35" />
      </g>
      <g class="const-star">
        <circle cx="36" cy="96" r="2.7" />
        <circle cx="72" cy="66" r="2.2" />
        <circle cx="100" cy="84" r="1.8" />
        <circle cx="126" cy="56" r="2.2" />
        <circle cx="158" cy="72" r="1.8" />
        <circle cx="186" cy="52" r="2.5" />
        <circle cx="56" cy="124" r="1.8" />
        <circle cx="86" cy="111" r="1.6" />
        <circle cx="114" cy="136" r="2.3" />
        <circle cx="146" cy="121" r="1.8" />
        <circle cx="184" cy="133" r="2" />
      </g>
      <g class="const-star const-star--dim">
        <circle cx="18" cy="58" r="1" />
        <circle cx="206" cy="30" r="1.2" />
        <circle cx="202" cy="166" r="1" />
      </g>
    `,
    leo: `
      <g class="const-line">
        <path d="M62 134 L49 98 L60 64 L86 47 L111 59 L114 88 L92 103 L72 94" />
        <path d="M114 88 L146 107 L184 100" />
        <path d="M146 107 L157 137" opacity=".35" />
      </g>
      <g class="const-star">
        <circle cx="62" cy="134" r="2.6" />
        <circle cx="49" cy="98" r="2" />
        <circle cx="60" cy="64" r="1.8" />
        <circle cx="86" cy="47" r="2.4" />
        <circle cx="111" cy="59" r="2.1" />
        <circle cx="114" cy="88" r="2.8" />
        <circle cx="92" cy="103" r="1.8" />
        <circle cx="72" cy="94" r="1.6" />
        <circle cx="146" cy="107" r="2.2" />
        <circle cx="184" cy="100" r="2.5" />
        <circle cx="157" cy="137" r="1.6" />
      </g>
      <g class="const-star const-star--dim">
        <circle cx="24" cy="38" r="1" />
        <circle cx="198" cy="44" r="1.1" />
        <circle cx="188" cy="158" r="1" />
      </g>
    `,
  };

  const PROFILES = {};

  function applyProfiles(data) {
    Object.keys(PROFILES).forEach((key) => {
      delete PROFILES[key];
    });

    Object.entries(data || {}).forEach(([key, profile]) => {
      profile.constellation = CONSTELLATIONS[key] || "";
      PROFILES[key] = profile;
    });

    log("private profiles loaded", Object.keys(PROFILES));
  }

  async function loadProfiles() {
    if (!window.OurRoadPrivate || typeof window.OurRoadPrivate.load !== "function") {
      log("private profile module unavailable");
      return;
    }

    try {
      applyProfiles(await window.OurRoadPrivate.load());
    } catch (error) {
      log("private profile decryption failed", error);
    }
  }

  /* ==========================================================
     开场视频 → 主画面
     ========================================================== */

  function markRevealed(reason) {
    if (!booted || introDone) {
      return;
    }

    introDone = true;
    window.clearTimeout(fallbackTimer);

    if (!introMusicStarted) {
      startIntroMusic();
    }

    log("reveal", reason, "duration:", introVideo.duration);
    app.classList.add("revealed");
    skipButton.classList.add("is-hidden");
    skipButton.setAttribute("aria-hidden", "true");
    musicToggle.tabIndex = 0;

    bgVideo.muted = true;
    bgVideo.play().catch((error) => {
      if (error && error.name !== "AbortError") {
        log("background video could not start:", error);
      }
    });

    window.setTimeout(() => {
      introVideo.pause();
      introVideo.classList.add("is-gone");
    }, 1800);

    hotspots.forEach((hotspot) => {
      hotspot.tabIndex = 0;
    });
  }

  function showEnterGate() {
    enterGate.classList.add("is-visible");
    enterGate.focus({ preventScroll: true });
    log("autoplay blocked; waiting for a tap");
  }

  function startIntro() {
    introVideo.muted = true;
    introVideo.volume = 0;

    const playPromise = introVideo.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        if (error && error.name === "AbortError") {
          return;
        }
        log("intro play() rejected:", error);
        showEnterGate();
      });
    }
  }

  function startIntroMusic() {
    if (introMusicStarted) {
      return;
    }

    introMusicStarted = true;
    if (!musicMuted) {
      playMusic();
    }
  }

  // 开场视频真正开始播放的同一时刻启动背景音乐，避免固定延时造成不同步。
  introVideo.addEventListener("playing", startIntroMusic);

  function armFallbackTimer() {
    if (!booted) {
      return;
    }

    const duration = Number.isFinite(introVideo.duration)
      ? introVideo.duration
      : 16;
    window.clearTimeout(fallbackTimer);
    fallbackTimer = window.setTimeout(
      () => markRevealed("fallback-timer"),
      (duration + 2.2) * 1000
    );
  }

  introVideo.addEventListener("loadedmetadata", () => {
    log("intro metadata", introVideo.duration, introVideo.videoWidth, introVideo.videoHeight);
    if (isIntroTest) {
      introVideo.currentTime = Math.max(0, introVideo.duration - 1.4);
    }
    armFallbackTimer();
  });

  introVideo.addEventListener("ended", () => markRevealed("ended"));
  introVideo.addEventListener("error", () => {
    log("intro video error", introVideo.error);
    window.setTimeout(() => markRevealed("video-error"), 900);
  });

  bgVideo.addEventListener("error", () => {
    log("background video error", bgVideo.error);
  });

  enterGate.addEventListener("click", () => {
    enterGate.classList.remove("is-visible");
    if (!introMusicStarted) {
      introMusicStarted = true;
      if (!musicMuted) {
        playMusic();
      }
    }
    startIntro();
  });

  skipButton.addEventListener("click", () => {
    app.classList.add("is-skipping");
    markRevealed("skip");
  });

  /* ==========================================================
     人物档案弹窗
     ========================================================== */

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function openProfile(key, trigger) {
    const profile = PROFILES[key];
    if (!profile) {
      return;
    }

    lastFocusedElement = trigger || document.activeElement;

    modal.dataset.sign = key;
    setText("modalArchive", `ZODIAC ARCHIVE · ${profile.id}`);
    setText("modalGlyph", profile.glyph);
    setText("modalSign", `${profile.sign} · ${profile.id}`);
    setText("modalName", profile.name);
    setText("modalTitle", profile.title);
    setText("modalQuote", `“${profile.quote}”`);
    setText("modalCoords", profile.coords);
    setText("modalElement", `${profile.element}象 · ${profile.planet}`);
    setText("modalDesc", profile.desc);
    setText("modalBond", profile.bond);

    const portrait = document.getElementById("modalPortrait");
    if (portrait) {
      portrait.src =
        profile.portraitUrl ||
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
      portrait.alt = `${profile.sign}人物肖像`;
    }

    const tagBox = document.getElementById("modalTags");
    tagBox.replaceChildren(
      ...profile.tags.map((tag) => {
        const item = document.createElement("span");
        item.className = "modal__tag";
        item.textContent = tag;
        return item;
      })
    );

    const stats = [
      ["年龄", profile.age],
      ["元素", profile.element],
      ["守护星", profile.planet],
      ["星轨", profile.coordsShort],
    ];
    const statBox = document.getElementById("modalStats");
    statBox.replaceChildren(
      ...stats.map(([label, value]) => {
        const wrap = document.createElement("div");
        wrap.className = "modal__stat";
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        wrap.append(dt, dd);
        return wrap;
      })
    );

    document.getElementById("modalConstellation").innerHTML =
      profile.constellation;

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    window.setTimeout(() => {
      closeButton.focus({ preventScroll: true });
      const content = modal.querySelector(".modal__content");
      if (content) {
        content.scrollTop = 0;
      }
    }, 120);
  }

  function closeProfile() {
    if (!modal.classList.contains("is-open")) {
      return;
    }

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus({ preventScroll: true });
    }
    lastFocusedElement = null;
  }

  function trapFocus(event) {
    const focusable = Array.from(
      modal.querySelectorAll(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.getClientRects().length > 0);

    if (!focusable.length) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener("keydown", (event) => {
    if (!modal.classList.contains("is-open")) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeProfile();
    } else if (event.key === "Tab") {
      trapFocus(event);
    }
  });

  hotspots.forEach((hotspot) => {
    hotspot.tabIndex = -1;
    hotspot.addEventListener("click", () => {
      openProfile(hotspot.dataset.sign, hotspot);
    });
  });

  modal.querySelectorAll("[data-close]").forEach((element) => {
    element.addEventListener("click", closeProfile);
  });

  /* ==========================================================
     初始化 / 预览模式
     ========================================================== */

  function boot() {
    booted = true;
    updateMusicUI();

    if (params.get("spots") === "1") {
      app.classList.add("show-hotspots");
    }

    if (isPreview) {
      introVideo.pause();
      introVideo.classList.add("is-gone");
      bgVideo.muted = true;
      bgVideo.currentTime = 0.12;
      bgVideo.play().catch(() => {});
      app.classList.add("revealed");
      hotspots.forEach((hotspot) => {
        hotspot.tabIndex = 0;
      });
      skipButton.classList.add("is-hidden");
      musicToggle.tabIndex = 0;
      log("preview mode");

      if (!musicMuted) {
        window.setTimeout(playMusic, 350);
      }

      if (modalOnLoad && PROFILES[modalOnLoad]) {
        window.setTimeout(() => {
          openProfile(modalOnLoad, hotspots[0]);
        }, 700);
      }
      return;
    }

    startIntro();
    armFallbackTimer();
    log("intro started");
  }

  /* 供调试 / 后续扩展使用 */
  window.starSea = {
    reveal: markRevealed,
    openProfile,
    closeProfile,
    profiles: PROFILES,
    music: {
      play: playMusic,
      pause: () => setMusicMuted(true),
      toggle: () => setMusicMuted(!musicMuted),
      get state() {
        return {
          muted: musicMuted,
          blocked: musicBlocked,
          paused: bgm.paused,
          currentTime: bgm.currentTime,
          duration: bgm.duration,
          volume: bgm.volume,
        };
      },
    },
    get state() {
      return { introDone, preview: isPreview };
    },
  };

  async function startAfterUnlock() {
    await loadProfiles();
    boot();
  }

  function ready() {
    if (window.starseaLock && typeof window.starseaLock.whenReady === "function") {
      window.starseaLock.whenReady(startAfterUnlock);
    } else {
      startAfterUnlock();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
})();
