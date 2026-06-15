"use client";

// _global-error MUST be a client component with its own <html><body>.
// It replaces the root layout entirely when the root layout errors.
// Keep this minimal — no context providers, no imports that use useContext.
// https://nextjs.org/docs/app/api-reference/file-conventions/error-handling

export default function GlobalError() {
  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#e5e5e5",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h2 style={{ marginBottom: "0.5rem" }}>Application Error</h2>
          <p style={{ color: "#a3a3a3" }}>
            A critical error occurred. Please restart the application.
          </p>
        </div>
      </body>
    </html>
  );
}
