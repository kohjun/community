# Sliper sharing image font

Source: [Google Fonts Noto Sans KR](https://github.com/google/fonts/tree/main/ofl/notosanskr).

The upstream variable TTF was converted to a static weight-600 TTF using FontTools 4.66.1. The font keeps its Korean, Latin, and CJK glyph coverage so user-written Korean and Hanja titles render without a runtime font request. The resulting file is 6.2 MB and is read from disk only by the server's sharing-image handler, not imported into the client bundle.

The font remains licensed under SIL Open Font License 1.1; see NotoSansKR-OFL.txt. The font is not sold separately.

SliperShareSans-coverage.json contains the font's Unicode code points. Characters absent from the font (such as color emoji) are replaced with a local placeholder in the image only. The normal page title keeps them. This prevents the image engine from fetching external fonts or emoji assets with the title text.

# Sliper interface font

The interface uses the original, unmodified Pretendard Variable v1.3.9 WOFF2 (2,057,688 bytes), self-hosted through `next/font/local` in `src/app/layout.tsx`. The weight range `45 920` follows the upstream Next.js guidance, including WebKit weight rendering. `display: swap` shows the system fallback while the font loads. `--font-pretendard` is shared by the body and Tailwind `font-sans`; controls and rich text inherit it. The separate sharing-image Noto font remains unchanged.

Source: [Official Pretendard v1.3.9 release](https://github.com/orioncactus/pretendard/releases/tag/v1.3.9), archive `Pretendard-1.3.9.zip`, entry `web/variable/woff2/PretendardVariable.woff2`.

License: SIL Open Font License 1.1, copied unmodified from the release as `Pretendard-OFL.txt`. The font is not sold separately. No runtime font CDN or Google Fonts request is made.

Font SHA-256: `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`
