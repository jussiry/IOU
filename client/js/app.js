/*
This module is the entry point for the client app. It parses hash routes, loads HTML templates, binds page-specific UI logic, and swaps pages with the transition controller.

It also coordinates shared startup concerns such as icon sprite injection, version-gated local data resets, navigation state, and the realtime transport bootstrap so all page modules stay focused on rendering.
*/

import {
  createFriend,
  createTransaction,
  createUser,
  ensureVersion,
  hasUserData,
  loadData,
  subscribeToDataChanges,
  updateCreditLimit,
} from "./data.js";
import { bindBalance, initBalanceToggles } from "../modules/balance-page/index.js";
import { bindFriends } from "../modules/friends-page/index.js";
import { bindLogs } from "../modules/logs-page/index.js";
import { bindSettings } from "../modules/settings-page/index.js";
import { bindWelcome } from "../modules/welcome-page/index.js";
import { bindFriendDetail } from "../modules/subpage/friend.js";
import { bindAddFriend } from "../modules/subpage/add-friend.js";
import { initIouActions } from "../modules/components/iou-actions.js";
import { bindSend } from "../modules/subpage/send.js";
import { bindCredit } from "../modules/subpage/credit.js";
import { createRealtimeClient } from "./realtime/client.js";
import { subscribeToPeerStatusChanges } from "./realtime/peer-status.js";
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
  welcome: "modules/welcome-page/index.html",
  balance: "modules/balance-page/index.html",
  friends: "modules/friends-page/index.html",
  logs: "modules/logs-page/index.html",
  settings: "modules/settings-page/index.html",
  subpage: "modules/subpage/index.html",
  friend: "modules/subpage/friend.html",
  addFriend: "modules/subpage/add-friend.html",
  send: "modules/subpage/send.html",
  credit: "modules/subpage/credit.html",
  creditLimitField: "modules/subpage/credit-limit-field.html",
  creditExplainer: "modules/subpage/credit-explainer.html",
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
let routeRefreshTimer = null;

const scheduleRouteRefresh = () => {
  if (routeRefreshTimer) {
    return;
  }

  routeRefreshTimer = window.setTimeout(() => {
    routeRefreshTimer = null;
    void loadActiveRoute();
  }, 0);
};

const setRouteUiState = (route) => {
  const isWelcome = route.type === "welcome";
  appRoot?.classList.toggle("is-welcome", isWelcome);
  document.body.classList.toggle("is-welcome", isWelcome);

  if (isWelcome) {
    appRoot?.classList.remove("is-subpage");
    document.title = "IOU — Welcome";
    setActiveNav(navButtons, null);
    return;
  }

  if (route.type !== "page") {
    appRoot?.classList.add("is-subpage");
    setActiveNav(navButtons, route.mainPage || lastMainPage);
    return;
  }

  appRoot?.classList.remove("is-subpage");
  document.title = pageTitles[route.page] || pageTitles.balance;
  setActiveNav(navButtons, route.page);
};

const setFallbackBackNavigation = (pageView) => {
  const backButton = pageView.querySelector("[data-back]");
  if (!backButton) return;

  backButton.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.hash = lastMainPage || "balance";
    }
  });
};

const renderSubpageContent = (pageView, html) => {
  const contentSlot = pageView.querySelector('[data-slot="subpage-content"]');
  if (contentSlot) {
    contentSlot.innerHTML = html;
  }
  return contentSlot;
};

const renderTemplateIntoSlots = (root, slotName, html) => {
  root.querySelectorAll(`[data-slot="${slotName}"]`).forEach((slot) => {
    slot.innerHTML = html;
  });
};

const createSubpageRoute = (type, friendId = null) => ({
  type,
  friendId,
  mainPage: lastMainPage,
});

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
  if (hash === "welcome") {
    return { type: "welcome" };
  }
  if (hash.startsWith("friend/")) {
    const friendId = hash.replace("friend/", "");
    return createSubpageRoute("friend", friendId);
  }
  if (hash === "add-friend") {
    return createSubpageRoute("add-friend");
  }
  if (hash.startsWith("send")) {
    const parts = hash.split("/");
    return createSubpageRoute("send", parts[1] || null);
  }
  if (hash.startsWith("credit/")) {
    const friendId = hash.replace("credit/", "");
    return createSubpageRoute("credit", friendId);
  }
  return pageTitles[hash] ? { type: "page", page: hash } : { type: "page", page: "balance" };
};

const resolveRouteForUserState = async (route) => {
  const userExists = await hasUserData();

  if (!userExists) {
    if (route.type !== "welcome") {
      window.location.hash = "welcome";
      return null;
    }
    return route;
  }

  if (route.type === "welcome") {
    window.location.hash = "balance";
    return null;
  }

  return route;
};

const loadPage = async (route) => {
  const isWelcome = route.type === "welcome";
  const isSubpage = !isWelcome && route.type !== "page";
  const target = isWelcome
    ? templatePaths.welcome
    : isSubpage
    ? templatePaths.subpage
    : templatePaths[route.page] || templatePaths.balance;
  const direction =
    isWelcome || currentRoute?.type === "welcome"
      ? null
      : getSlideDirection(currentRoute, route, navOrder);
  const sequence = (navigationSequence += 1);

  try {
    const [html, data] = await Promise.all([
      fetchTemplate(target),
      isWelcome ? Promise.resolve(null) : loadData(),
    ]);
    if (sequence !== navigationSequence) return;
    if (!isWelcome && !data) {
      window.location.hash = "welcome";
      return;
    }

    const pageView = createPageView(html);
    setRouteUiState(route);

    if (route.type === "welcome") {
      bindWelcome(pageView, {
        onCreateUser: async (name) => {
          await createUser(name);
          window.location.hash = "balance";
        },
      });
    } else if (route.type === "friend") {
      const friendHtml = await fetchTemplate(templatePaths.friend);
      renderSubpageContent(pageView, friendHtml);

      bindFriendDetail(pageView, data, route.friendId);
      const friend = data.connections.find((entry) => entry.person_id === route.friendId);
      if (friend?.person_name) {
        document.title = `IOU — ${friend.person_name}`;
      } else {
        document.title = "IOU — Friend";
      }
      initIouActions(pageView, route.friendId);
      setFallbackBackNavigation(pageView);
    } else if (route.type === "add-friend") {
      const [addFriendHtml, creditLimitFieldHtml, creditExplainerHtml] = await Promise.all([
        fetchTemplate(templatePaths.addFriend),
        fetchTemplate(templatePaths.creditLimitField),
        fetchTemplate(templatePaths.creditExplainer),
      ]);
      renderSubpageContent(pageView, addFriendHtml);
      renderTemplateIntoSlots(pageView, "credit-limit-field", creditLimitFieldHtml);
      renderTemplateIntoSlots(pageView, "credit-explainer", creditExplainerHtml);

      const addFriendHandlers = bindAddFriend(pageView, data);
      document.title = "IOU — Add a friend";
      setFallbackBackNavigation(pageView);
      if (addFriendHandlers?.submitEl) {
        addFriendHandlers.submitEl.addEventListener("click", async () => {
          const payload = addFriendHandlers.getPayload();
          if (!payload.friendId || payload.friendId === data.you.id) {
            return;
          }
          await createFriend(payload);
          window.location.hash = `friend/${payload.friendId}`;
        });
      }
    } else if (route.type === "send") {
      const sendHtml = await fetchTemplate(templatePaths.send);
      renderSubpageContent(pageView, sendHtml);
      const sendHandlers = bindSend(pageView, data, route.friendId);
      document.title = "IOU — Send";
      setFallbackBackNavigation(pageView);
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
      const [creditHtml, creditLimitFieldHtml, creditExplainerHtml] = await Promise.all([
        fetchTemplate(templatePaths.credit),
        fetchTemplate(templatePaths.creditLimitField),
        fetchTemplate(templatePaths.creditExplainer),
      ]);
      renderSubpageContent(pageView, creditHtml);
      renderTemplateIntoSlots(pageView, "credit-limit-field", creditLimitFieldHtml);
      renderTemplateIntoSlots(pageView, "credit-explainer", creditExplainerHtml);
      const creditHandlers = bindCredit(pageView, data, route.friendId);
      document.title = "IOU — Credit";
      setFallbackBackNavigation(pageView);
      if (creditHandlers?.submitEl && route.friendId) {
        creditHandlers.submitEl.addEventListener("click", async () => {
          const limit = creditHandlers.limitInput
            ? parseFloat(creditHandlers.limitInput.value)
            : NaN;
          if (!Number.isFinite(limit) || limit < 0) {
            return;
          }
          await updateCreditLimit(route.friendId, limit);
          window.location.hash = `friend/${route.friendId}`;
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

    if (!isWelcome) {
      initBalanceToggles(pageView);
    }
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

const loadActiveRoute = async () => {
  const parsedRoute = parseRoute();
  const resolvedRoute = await resolveRouteForUserState(parsedRoute);
  if (!resolvedRoute) return;
  await loadPage(resolvedRoute);
};

window.addEventListener("hashchange", () => {
  void loadActiveRoute();
});

const initApp = async () => {
  await ensureIconSprite();
  appVersion = await getAppVersion();
  await ensureVersion(appVersion);
  subscribeToDataChanges(scheduleRouteRefresh);
  subscribeToPeerStatusChanges(scheduleRouteRefresh);
  createRealtimeClient();
  await loadActiveRoute();
};

void initApp();
