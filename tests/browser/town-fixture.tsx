import { createRoot } from "react-dom/client";
import { SessionProvider } from "../../src/components/session-provider";
import { TownClient } from "../../src/components/town-client";
import "../../src/app/globals.css";
import "../../src/app/participation.css";
createRoot(document.getElementById("root")!).render(
  <SessionProvider>
    <main className="participation-page">
      <TownClient />
    </main>
  </SessionProvider>,
);
