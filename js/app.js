import { createTransaction, ensureVersion, loadData } from "./data.js";
import { bindBalance, initBalanceToggles } from "../modules/balance-page/index.js";
import { bindFriends } from "../modules/friends-page/index.js";
import { bindLogs } from "../modules/logs-page/index.js";
import { bindSettings } from "../modules/settings-page/index.js";
import { bindFriendDetail } from "../modules/subpage/friend.js";
import { initIouActions } from "../modules/components/iou-actions.js";
import { bindSend } from "../modules/subpage/send.js";
import { bindCredit } from "../modules/subpage/credit.js";
import { ensureIconSprite } from "./utils/icons.js";
import { setActiveNav } from "./utils/nav.js";
import { getSlideDirection, swapPage } from "./page-transitions.js";
import { getAppVersion } from "./version.js";

const navButtons = Array.from(document.querySelectorAll(".nav-item[data-page]"));
const contentRoot = document.getElementById("page-content");
const appRoot = document.querySelector(".app");
const navOrder = navButtons.map((button) => button.dataset.page).filter(Boolean);

const pageTitles = {
  balance: "IOU — Balance",
  friends: "IOU — Friends",
  logs: "IOU — Logs",
  settings: "IOU — Settings",
};

const templatePaths = {
  balance: "modules/balance-page/index.html",
  friends: "modules/friends-page/index.html",
  logs: "modules/logs-page/index.html",
  settings: "modules/settings-page/index.html",
  subpage: "modules/subpage/index.html",
  friend: "modules/subpage/friend.html",
  send: "modules/subpage/send.html",
  credit: "modules/subpage/credit.html",
  iouActions: "modules/components/iou-actions.html",
};

const pageBinders = {
  balance: bindBalance,
  friends: bindFriends,
  logs: bindLogs,
  settings: bindSettings,
};

let lastMainPage = "balance";
let currentRoute = null;
let navigationSequence = 0;
const templateCache = new Map();
let appVersion = null;

const fetchTemplate = async (path) => {
  if (templateCache.has(path)) {
    return templateCache.get(path);
  }
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Template not found");
  const html = await response.text();
  templateCache.set(path, html);
  return html;
};

const createPageView = (html) => {
  const page = document.createElement("div");
  page.className = "page-view";
  page.innerHTML = html;
  return page;
};

const parseRoute = () => {
  const hash = window.location.hash.replace("#", "");
  if (!hash) return { type: "page", page: "balance" };
  if (hash.startsWith("friend/")) {
    const friendId = hash.replace("friend/", "");
    return { type: "friend", friendId, mainPage: lastMainPage };
  }
  if (hash.startsWith("send")) {
    const parts = hash.split("/");
    return { type: "send", friendId: parts[1] || null, mainPage: lastMainPage };
  }
  if (hash.startsWith("credit/")) {
    const friendId = hash.replace("credit/", "");
    return { type: "credit", friendId, mainPage: lastMainPage };
  }
  return templatePaths[hash] ? { type: "page", page: hash } : { type: "page", page: "balance" };
};

const loadPage = async (route) => {
  const isSubpage = route.type !== "page";
  const target = isSubpage
    ? templatePaths.subpage
    : templatePaths[route.page] || templatePaths.balance;
  const direction = getSlideDirection(currentRoute, route, navOrder);
  const sequence = (navigationSequence += 1);
  try {
    const [html, data] = await Promise.all([fetchTemplate(target), loadData()]);
    if (sequence !== navigationSequence) return;

    const pageView = createPageView(html);
    if (isSubpage) {
      appRoot?.classList.add("is-subpage");
      setActiveNav(navButtons, route.mainPage || lastMainPage);
    } else {
      appRoot?.classList.remove("is-subpage");
      document.title = pageTitles[route.page] || pageTitles.balance;
      setActiveNav(navButtons, route.page);
    }

    if (route.type === "friend") {
      const friendHtml = await fetchTemplate(templatePaths.friend);
      const contentSlot = pageView.querySelector('[data-slot="subpage-content"]');
      if (contentSlot) {
        contentSlot.innerHTML = friendHtml;
      }

      bindFriendDetail(pageView, data, route.friendId);
      const friend = data.connections.find((entry) => entry.person_id === route.friendId);
      if (friend?.person_name) {
        document.title = `IOU — ${friend.person_name}`;
      } else {
        document.title = "IOU — Friend";
      }
      initIouActions(pageView, route.friendId);
      const backButton = pageView.querySelector("[data-back]");
      if (backButton) {
        backButton.addEventListener("click", () => {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.hash = lastMainPage || "balance";
          }
        });
      }
    } else if (route.type === "send") {
      const sendHtml = await fetchTemplate(templatePaths.send);
      const contentSlot = pageView.querySelector('[data-slot="subpage-content"]');
      if (contentSlot) {
        contentSlot.innerHTML = sendHtml;
      }
      const sendHandlers = bindSend(pageView, data, route.friendId);
      document.title = "IOU — Send";
      const backButton = pageView.querySelector("[data-back]");
      if (backButton) {
        backButton.addEventListener("click", () => {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.hash = lastMainPage || "balance";
          }
        });
      }
      if (sendHandlers?.submitEl) {
        sendHandlers.submitEl.addEventListener("click", async () => {
          const payload = sendHandlers.getPayload();
          if (!payload.friendId || !Number.isFinite(payload.amount) || payload.amount <= 0) {
            return;
          }
          await createTransaction(payload);
          window.location.hash = `friend/${payload.friendId}`;
        });
      }
    } else if (route.type === "credit") {
      const creditHtml = await fetchTemplate(templatePaths.credit);
      const contentSlot = pageView.querySelector('[data-slot="subpage-content"]');
      if (contentSlot) {
        contentSlot.innerHTML = creditHtml;
      }
      bindCredit(pageView, data, route.friendId);
      document.title = "IOU — Credit";
      const backButton = pageView.querySelector("[data-back]");
      if (backButton) {
        backButton.addEventListener("click", () => {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.hash = lastMainPage || "balance";
          }
        });
      }
    } else {
      if (route.page === "balance") {
        const actionsSlot = pageView.querySelector('[data-slot="iou-actions"]');
        if (actionsSlot) {
          const actionsHtml = await fetchTemplate(templatePaths.iouActions);
          actionsSlot.innerHTML = actionsHtml;
          initIouActions(pageView, null);
        }
      }
      const binder = pageBinders[route.page];
      if (binder) {
        binder(pageView, data, appVersion);
      }
    }

    initBalanceToggles(pageView);
    await swapPage(contentRoot, pageView, { direction });
    if (sequence !== navigationSequence) return;

    currentRoute = route;
    if (route.type === "page") {
      lastMainPage = route.page;
    }
  } catch (error) {
    if (sequence !== navigationSequence) return;
    const errorView = createPageView(
      `<div class="section"><div class="empty">Failed to load page.</div></div>`
    );
    await swapPage(contentRoot, errorView, { direction: null });
  }
};

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;
    if (!page) return;
    const route = parseRoute();
    if (route.type === "page" && route.page === page) return;
    window.location.hash = page;
  });
});

window.addEventListener("hashchange", () => {
  loadPage(parseRoute());
});

const initApp = async () => {
  await ensureIconSprite();
  appVersion = await getAppVersion();
  ensureVersion(appVersion);
  loadPage(parseRoute());
};

initApp();
