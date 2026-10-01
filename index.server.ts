import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listAgents, releaseAgent, releaseAll, startAutoRelease } from "./server/release";
import { listRpc, releaseAllRpc, releaseRpc } from "./shared/release";

export default function contribute(server: PluginServerContext) {
  server.handle(listRpc, listAgents);
  server.handle(releaseRpc, releaseAgent);
  server.handle(releaseAllRpc, releaseAll);
  return startAutoRelease(server);
}
