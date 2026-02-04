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

const setActiveNav = (page) => {
  navButtons.forEach((button) => {
    const isActive = button.dataset.page === page;
    button.classList.toggle("active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });
};

const closePanel = (button, panel) => {
  if (!panel || button.getAttribute("aria-expanded") !== "true") return;
  panel.style.height = `${panel.getBoundingClientRect().height}px`;
  requestAnimationFrame(() => {
    panel.style.height = "0px";
    panel.style.opacity = "0";
  });
  const onEnd = (event) => {
    if (event.propertyName !== "height") return;
    button.setAttribute("aria-expanded", "false");
    panel.removeEventListener("transitionend", onEnd);
  };
  panel.addEventListener("transitionend", onEnd);
};

const openPanel = (button, panel) => {
  if (!panel || button.getAttribute("aria-expanded") === "true") return;
  button.setAttribute("aria-expanded", "true");
  panel.style.height = "0px";
  panel.style.opacity = "0";
  requestAnimationFrame(() => {
    panel.style.height = `${panel.scrollHeight}px`;
    panel.style.opacity = "1";
  });
  const onEnd = (event) => {
    if (event.propertyName !== "height") return;
    panel.style.height = `${panel.scrollHeight}px`;
    panel.removeEventListener("transitionend", onEnd);
  };
  panel.addEventListener("transitionend", onEnd);
};

const closeDetail = (detail, wrap) => {
  if (!wrap || !detail.hasAttribute("open")) return;
  wrap.style.height = `${wrap.getBoundingClientRect().height}px`;
  requestAnimationFrame(() => {
    wrap.style.height = "0px";
    wrap.style.opacity = "0";
  });
  const onEnd = (event) => {
    if (event.propertyName !== "height") return;
    detail.removeAttribute("open");
    wrap.removeEventListener("transitionend", onEnd);
  };
  wrap.addEventListener("transitionend", onEnd);
};

const openDetail = (detail, wrap) => {
  if (!wrap || detail.hasAttribute("open")) return;
  detail.setAttribute("open", "");
  wrap.style.height = "0px";
  wrap.style.opacity = "0";
  requestAnimationFrame(() => {
    wrap.style.height = `${wrap.scrollHeight}px`;
    wrap.style.opacity = "1";
  });
  const onEnd = (event) => {
    if (event.propertyName !== "height") return;
    wrap.style.height = `${wrap.scrollHeight}px`;
    wrap.removeEventListener("transitionend", onEnd);
  };
  wrap.addEventListener("transitionend", onEnd);
};

const initBalanceToggles = (root) => {
  const toggleButtons = Array.from(root.querySelectorAll(".pill.toggle"));
  if (!toggleButtons.length) return;

  toggleButtons.forEach((button) => {
    const panel = button.querySelector(".sub-card");
    if (!panel) return;
    button.setAttribute("aria-expanded", "false");
    panel.style.height = "0px";
    panel.style.opacity = "0";

    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      toggleButtons.forEach((other) => {
        if (other === button) return;
        closePanel(other, other.querySelector(".sub-card"));
      });
      if (isOpen) {
        closePanel(button, panel);
      } else {
        openPanel(button, panel);
      }
    });
  });
};

const initAccordion = (root) => {
  const containers = Array.from(root.querySelectorAll(".accordion"));
  containers.forEach((container) => {
    const friendDetails = Array.from(container.querySelectorAll(".friend"));
    friendDetails.forEach((detail) => {
      const summary = detail.querySelector("summary");
      const wrap = detail.querySelector(".tx-wrap");
      if (!summary || !wrap) return;

      summary.addEventListener("click", (event) => {
        event.preventDefault();
        const isOpen = detail.hasAttribute("open");
        friendDetails.forEach((other) => {
          if (other === detail) return;
          closeDetail(other, other.querySelector(".tx-wrap"));
        });
        if (isOpen) {
          closeDetail(detail, wrap);
        } else {
          openDetail(detail, wrap);
        }
      });
    });
  });
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
    setActiveNav(page);
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
