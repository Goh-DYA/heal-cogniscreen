import { test } from "node:test";
import assert from "node:assert/strict";
import * as serverModule from "../server.js";
import * as clientRoutes from "../public/routes.js";

test("app routes resolve to the SPA entrypoint with or without trailing slash", () => {
  assert.equal(serverModule.resolveStaticRoutePath("/"), "/index.html");
  assert.equal(serverModule.resolveStaticRoutePath("/patient"), "/index.html");
  assert.equal(serverModule.resolveStaticRoutePath("/patient/"), "/index.html");
  assert.equal(serverModule.resolveStaticRoutePath("/admin"), "/index.html");
  assert.equal(serverModule.resolveStaticRoutePath("/admin/"), "/index.html");
  assert.equal(serverModule.resolveStaticRoutePath("/report"), "/index.html");
  assert.equal(serverModule.resolveStaticRoutePath("/report/"), "/index.html");
  assert.equal(serverModule.resolveStaticRoutePath("/log/"), "/index.html");
  assert.equal(serverModule.resolveStaticRoutePath("/app.js"), "/app.js");
});

test("client routes ignore trailing slashes", () => {
  assert.equal(clientRoutes.viewForPath("/"), "patient");
  assert.equal(clientRoutes.viewForPath("/patient"), "patient");
  assert.equal(clientRoutes.viewForPath("/patient/"), "patient");
  assert.equal(clientRoutes.viewForPath("/admin"), "admin");
  assert.equal(clientRoutes.viewForPath("/admin/"), "admin");
  assert.equal(clientRoutes.viewForPath("/report"), "report");
  assert.equal(clientRoutes.viewForPath("/report/"), "report");
  assert.equal(clientRoutes.viewForPath("/log/"), "log");
});
