import { loadData } from "./data.js";
import {
  bindBalance,
  bindFriends,
  initAccordion,
  initBalanceToggles,
  setActiveNav,
} from "./ui.js";

const navButtons = Array.from(document.querySelectorAll(".nav-item[data-page]"));
const contentRoot = document.getElementById("page-content");

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
};

const pageBinders = {
  balance: bindBalance,
  friends: bindFriends,
};

const getPageFromHash = () => {
  const page = window.location.hash.replace("#", "");
  return templatePaths[page] ? page : "balance";
};

const loadPage = async (page) => {
  const target = templatePaths[page] || templatePaths.balance;
  try {
    const response = await fetch(target, { cache: "no-store" });
    if (!response.ok) throw new Error("Template not found");
    const html = await response.text();
    contentRoot.innerHTML = html;
    document.title = pageTitles[page] || pageTitles.balance;
    setActiveNav(navButtons, page);

    const data = await loadData();
    const binder = pageBinders[page];
    if (binder) {
      binder(contentRoot, data);
    }

    initBalanceToggles(contentRoot);
    initAccordion(contentRoot);
  } catch (error) {
    contentRoot.innerHTML = `<div class="section"><div class="empty">Failed to load page.</div></div>`;
  }
};

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;
    if (!page) return;
    if (getPageFromHash() === page) return;
    window.location.hash = page;
  });
});

window.addEventListener("hashchange", () => {
  loadPage(getPageFromHash());
});

loadPage(getPageFromHash());
