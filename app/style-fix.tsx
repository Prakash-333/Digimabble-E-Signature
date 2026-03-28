"use client";

import { useEffect } from "react";

const STYLE_FIX_ID = "smartdocs-style-fix";

const findCssHref = () => {
  const link = document.querySelector<HTMLLinkElement>(
    'link[rel="stylesheet"][href*="/_next/static/css/"]'
  );
  return link?.href ?? null;
};

export default function StyleFix() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (document.getElementById(STYLE_FIX_ID)) return;

    const href = findCssHref() ?? "/_next/static/css/app/layout.css";

    fetch(href)
      .then((res) => (res.ok ? res.text() : null))
      .then((cssText) => {
        if (!cssText) return;
        const style = document.createElement("style");
        style.id = STYLE_FIX_ID;
        style.textContent = cssText;
        document.head.appendChild(style);
      })
      .catch(() => {
        // If this fails, the browser is likely blocking CSS requests; nothing else to do here.
      });
  }, []);

  return null;
}
