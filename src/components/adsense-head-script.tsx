import type { AdSenseConfiguration } from "@/domain/advertising";
import { adSenseScriptSource } from "@/lib/adsense-runtime";
/** The owner's verification snippet is present in initial head HTML.
 * Loading the library does not enable Sliper's manual ad units.
 */
export function AdSenseHeadScript({ config }: { config: AdSenseConfiguration }) {
  const source = config.clientId && config.siteOrigin ? adSenseScriptSource(config.clientId) : null;
  return source ? <script id="sliper-adsense" async src={source} crossOrigin="anonymous" /> : null;
}
