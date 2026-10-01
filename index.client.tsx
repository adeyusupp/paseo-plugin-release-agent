import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReleaseSurface } from "./client/release";

export default function contribute(client: PluginClientContext) {
  client.addSurface("release", ReleaseSurface);
  client.addSidebarItem({ id: "release", title: "Release Agent Session", icon: "MemoryStick", surface: "release" });
  return () => {};
}
