export default function Head() {
  const shouldInject =
    typeof process !== "undefined" && process.env.NODE_ENV !== "production";

  if (!shouldInject) {
    return null;
  }

  return (
    <>
      <link rel="stylesheet" href="/_next/static/css/app/layout.css" />
      {/* Fallback CDN Tailwind for cases where local dev CSS is blocked */}
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/tailwindcss@3.4.1/dist/tailwind.min.css"
      />
    </>
  );
}
