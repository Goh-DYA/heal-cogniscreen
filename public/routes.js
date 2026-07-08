export const appRoutes = {
  "/": "patient",
  "/patient": "patient",
  "/admin": "admin",
  "/report": "report",
  "/log": "log"
};

export function normalizeRoutePath(pathname) {
  if (pathname === "/") {
    return "/";
  }
  return String(pathname || "/").replace(/\/+$/, "") || "/";
}

export function viewForPath(pathname) {
  return appRoutes[normalizeRoutePath(pathname)] || "patient";
}

export function resolveStaticRoutePath(pathname) {
  return Object.hasOwn(appRoutes, normalizeRoutePath(pathname)) ? "/index.html" : pathname;
}
