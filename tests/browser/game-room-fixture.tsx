import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GameRoomLobby } from "../../src/components/game-room-lobby";
import { GameRoomCreate } from "../../src/components/game-room-create";
import { SessionProvider } from "../../src/components/session-provider";
const id = location.pathname.split("/")[2];
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      {id ? (
        <GameRoomLobby
          roomId={id}
          host={new URLSearchParams(location.search).get("host") === "1"}
        />
      ) : (
        <GameRoomCreate />
      )}
    </SessionProvider>
  </StrictMode>,
);

(window as typeof window & { __decodeGameQr: (source: string) => Promise<string> }).__decodeGameQr =
  async (source) => {
    const { BrowserQRCodeReader } = await import("@zxing/browser");
    return (await new BrowserQRCodeReader().decodeFromImageUrl(source)).getText();
  };
