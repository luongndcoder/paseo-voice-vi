import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { VoiceViScreen } from "./client/voice-vi-screen";

function VoiceViSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Mic"
      active={currentScreen?.screenId === "voice-vi"}
      onPress={() => openScreen({ screenId: "voice-vi" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "voice-vi", title: "Vietnamese voice", Component: VoiceViScreen });
  client.addSidebarHeaderItem({
    id: "voice-vi",
    title: "Vietnamese voice",
    Component: VoiceViSidebarItem,
  });
  client.addCommandCenterItem({
    id: "open-voice-vi",
    title: "Open Vietnamese voice setup",
    icon: "Mic",
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "voice-vi" });
    },
  });
  return () => {};
}
