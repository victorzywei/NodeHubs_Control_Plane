import { onRequestGet as __api_nodes__nid__install_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\nodes\\[nid]\\install.js"
import { onRequestPost as __api_auth_login_js_onRequestPost } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\auth\\login.js"
import { onRequestGet as __api_profiles_registry_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\profiles\\registry.js"
import { onRequestDelete as __api_nodes__nid__js_onRequestDelete } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\nodes\\[nid].js"
import { onRequestGet as __api_nodes__nid__js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\nodes\\[nid].js"
import { onRequestPatch as __api_nodes__nid__js_onRequestPatch } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\nodes\\[nid].js"
import { onRequestDelete as __api_profiles__pid__js_onRequestDelete } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\profiles\\[pid].js"
import { onRequestGet as __api_profiles__pid__js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\profiles\\[pid].js"
import { onRequestPatch as __api_profiles__pid__js_onRequestPatch } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\profiles\\[pid].js"
import { onRequestDelete as __api_subscriptions__token__js_onRequestDelete } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\subscriptions\\[token].js"
import { onRequestGet as __api_subscriptions__token__js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\subscriptions\\[token].js"
import { onRequestPatch as __api_subscriptions__token__js_onRequestPatch } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\subscriptions\\[token].js"
import { onRequestPost as __agent_apply_result_js_onRequestPost } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\agent\\apply-result.js"
import { onRequestGet as __agent_install_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\agent\\install.js"
import { onRequestGet as __agent_plan_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\agent\\plan.js"
import { onRequestGet as __agent_version_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\agent\\version.js"
import { onRequestGet as __api_debug_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\debug.js"
import { onRequestPost as __api_deploy_js_onRequestPost } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\deploy.js"
import { onRequestGet as __api_deploys_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\deploys.js"
import { onRequestGet as __api_nodes_index_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\nodes\\index.js"
import { onRequestPost as __api_nodes_index_js_onRequestPost } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\nodes\\index.js"
import { onRequestGet as __api_profiles_index_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\profiles\\index.js"
import { onRequestPost as __api_profiles_index_js_onRequestPost } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\profiles\\index.js"
import { onRequestPost as __api_rollback_js_onRequestPost } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\rollback.js"
import { onRequestGet as __api_subscriptions_index_js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\subscriptions\\index.js"
import { onRequestPost as __api_subscriptions_index_js_onRequestPost } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\api\\subscriptions\\index.js"
import { onRequestGet as __sub__token__js_onRequestGet } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\sub\\[token].js"
import { onRequest as ___middleware_js_onRequest } from "C:\\Users\\victo\\Desktop\\nodeservs\\functions\\_middleware.js"

export const routes = [
    {
      routePath: "/api/nodes/:nid/install",
      mountPath: "/api/nodes/:nid",
      method: "GET",
      middlewares: [],
      modules: [__api_nodes__nid__install_js_onRequestGet],
    },
  {
      routePath: "/api/auth/login",
      mountPath: "/api/auth",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_login_js_onRequestPost],
    },
  {
      routePath: "/api/profiles/registry",
      mountPath: "/api/profiles",
      method: "GET",
      middlewares: [],
      modules: [__api_profiles_registry_js_onRequestGet],
    },
  {
      routePath: "/api/nodes/:nid",
      mountPath: "/api/nodes",
      method: "DELETE",
      middlewares: [],
      modules: [__api_nodes__nid__js_onRequestDelete],
    },
  {
      routePath: "/api/nodes/:nid",
      mountPath: "/api/nodes",
      method: "GET",
      middlewares: [],
      modules: [__api_nodes__nid__js_onRequestGet],
    },
  {
      routePath: "/api/nodes/:nid",
      mountPath: "/api/nodes",
      method: "PATCH",
      middlewares: [],
      modules: [__api_nodes__nid__js_onRequestPatch],
    },
  {
      routePath: "/api/profiles/:pid",
      mountPath: "/api/profiles",
      method: "DELETE",
      middlewares: [],
      modules: [__api_profiles__pid__js_onRequestDelete],
    },
  {
      routePath: "/api/profiles/:pid",
      mountPath: "/api/profiles",
      method: "GET",
      middlewares: [],
      modules: [__api_profiles__pid__js_onRequestGet],
    },
  {
      routePath: "/api/profiles/:pid",
      mountPath: "/api/profiles",
      method: "PATCH",
      middlewares: [],
      modules: [__api_profiles__pid__js_onRequestPatch],
    },
  {
      routePath: "/api/subscriptions/:token",
      mountPath: "/api/subscriptions",
      method: "DELETE",
      middlewares: [],
      modules: [__api_subscriptions__token__js_onRequestDelete],
    },
  {
      routePath: "/api/subscriptions/:token",
      mountPath: "/api/subscriptions",
      method: "GET",
      middlewares: [],
      modules: [__api_subscriptions__token__js_onRequestGet],
    },
  {
      routePath: "/api/subscriptions/:token",
      mountPath: "/api/subscriptions",
      method: "PATCH",
      middlewares: [],
      modules: [__api_subscriptions__token__js_onRequestPatch],
    },
  {
      routePath: "/agent/apply-result",
      mountPath: "/agent",
      method: "POST",
      middlewares: [],
      modules: [__agent_apply_result_js_onRequestPost],
    },
  {
      routePath: "/agent/install",
      mountPath: "/agent",
      method: "GET",
      middlewares: [],
      modules: [__agent_install_js_onRequestGet],
    },
  {
      routePath: "/agent/plan",
      mountPath: "/agent",
      method: "GET",
      middlewares: [],
      modules: [__agent_plan_js_onRequestGet],
    },
  {
      routePath: "/agent/version",
      mountPath: "/agent",
      method: "GET",
      middlewares: [],
      modules: [__agent_version_js_onRequestGet],
    },
  {
      routePath: "/api/debug",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_debug_js_onRequestGet],
    },
  {
      routePath: "/api/deploy",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_deploy_js_onRequestPost],
    },
  {
      routePath: "/api/deploys",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_deploys_js_onRequestGet],
    },
  {
      routePath: "/api/nodes",
      mountPath: "/api/nodes",
      method: "GET",
      middlewares: [],
      modules: [__api_nodes_index_js_onRequestGet],
    },
  {
      routePath: "/api/nodes",
      mountPath: "/api/nodes",
      method: "POST",
      middlewares: [],
      modules: [__api_nodes_index_js_onRequestPost],
    },
  {
      routePath: "/api/profiles",
      mountPath: "/api/profiles",
      method: "GET",
      middlewares: [],
      modules: [__api_profiles_index_js_onRequestGet],
    },
  {
      routePath: "/api/profiles",
      mountPath: "/api/profiles",
      method: "POST",
      middlewares: [],
      modules: [__api_profiles_index_js_onRequestPost],
    },
  {
      routePath: "/api/rollback",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_rollback_js_onRequestPost],
    },
  {
      routePath: "/api/subscriptions",
      mountPath: "/api/subscriptions",
      method: "GET",
      middlewares: [],
      modules: [__api_subscriptions_index_js_onRequestGet],
    },
  {
      routePath: "/api/subscriptions",
      mountPath: "/api/subscriptions",
      method: "POST",
      middlewares: [],
      modules: [__api_subscriptions_index_js_onRequestPost],
    },
  {
      routePath: "/sub/:token",
      mountPath: "/sub",
      method: "GET",
      middlewares: [],
      modules: [__sub__token__js_onRequestGet],
    },
  {
      routePath: "/",
      mountPath: "/",
      method: "",
      middlewares: [___middleware_js_onRequest],
      modules: [],
    },
  ]