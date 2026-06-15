const DEV_SERVER_URL = "http://127.0.0.1:18659";
const APP_ORIGIN = "app://-";

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isAllowedAppNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === DEV_SERVER_URL ||
      (parsed.protocol === "app:" && parsed.hostname === "-")
    );
  } catch {
    return false;
  }
}

export { APP_ORIGIN, DEV_SERVER_URL };
