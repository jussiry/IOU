import { loadData } from "./data.js";
import {
  bindBalance,
  bindFriendDetail,
  bindFriends,
  initBalanceToggles,
  setActiveNav,
} from "./ui.js";

const navButtons = Array.from(document.querySelectorAll(".nav-item[data-page]"));
const contentRoot = document.getElementById("page-content");
const appRoot = document.querySelector(".app");

const pageTitles = {
  balance: "IOU — Balance",
  friends: "IOU — Friends",
  logs: "IOU — Logs",
  settings: "IOU — Settings",
};

const templatePaths = {
  balance: "templates/balance.html",
  friends: "templates/friends.html",
  logs: "templates/logs.html",
  settings: "templates/settings.html",
  subpage: "templates/subpage.html",
};

const pageBinders = {
  balance: bindBalance,
  friends: bindFriends,
};

let lastMainPage = "balance";

const parseRoute = () => {
  const hash = window.location.hash.replace("#", "");
  if (!hash) return { type: "page", page: "balance" };
  if (hash.startsWith("friend/")) {
    const friendId = hash.replace("friend/", "");
    return { type: "friend", friendId };
  }
  return templatePaths[hash] ? { type: "page", page: hash } : { type: "page", page: "balance" };
};

const loadPage = async (route) => {
  const target =
    route.type === "friend" ? templatePaths.subpage : templatePaths[route.page] || templatePaths.balance;
  try {
    const response = await fetch(target, { cache: "no-store" });
    if (!response.ok) throw new Error("Template not found");
    const html = await response.text();
    contentRoot.innerHTML = html;
    if (route.type === "friend") {
      appRoot?.classList.add("is-subpage");
      setActiveNav(navButtons, null);
    } else {
      appRoot?.classList.remove("is-subpage");
      document.title = pageTitles[route.page] || pageTitles.balance;
      setActiveNav(navButtons, route.page);
      lastMainPage = route.page;
    }

    const data = await loadData();
    if (route.type === "friend") {
      bindFriendDetail(contentRoot, data, route.friendId);
      const friend = data.connections.find((entry) => entry.person_id === route.friendId);
      if (friend?.person_name) {
        document.title = `IOU — ${friend.person_name}`;
      } else {
        document.title = "IOU — Friend";
      }
      const backButton = contentRoot.querySelector("[data-back]");
      if (backButton) {
        backButton.addEventListener("click", () => {
          window.location.hash = lastMainPage || "balance";
        });
      }
    } else {
      const binder = pageBinders[route.page];
      if (binder) {
        binder(contentRoot, data);
      }
    }

    initBalanceToggles(contentRoot);
  } catch (error) {
    contentRoot.innerHTML = `<div class="section"><div class="empty">Failed to load page.</div></div>`;
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

loadPage(parseRoute());
