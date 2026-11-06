"use client";
import { TownEntry } from "./town-entry";
import type { ToastMode } from "@/domain/toast-game";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  Gamepad2,
  Link2,
  Search,
  UsersRound,
  ShieldCheck,
} from "lucide-react";
import { useSession } from "./session-provider";
import { appRequest } from "@/lib/api-client";
import {
  WORD_CATEGORIES,
  WORD_MODE_LABELS,
  type WordCategory,
  type WordMode,
} from "@/domain/word-liar";
import styles from "./game-room.module.css";
import { GameTutorial } from "./game-tutorial";
import { GameCover } from "./game-cover";
import {
  GAME_CATALOG,
  GAME_GENRES,
  type CatalogGameId,
  type GameGenre,
} from "@/domain/game-catalog";
import catalog from "./game-catalog.module.css";
import { useSavedGames } from "@/lib/saved-games";
export function GameRoomCreate() {
  const { session, ready } = useSession(),
    router = useRouter();
  const [title, setTitle] = useState("MBTI 자기소개 게임"),
    [capacity, setCapacity] = useState(8),
    [minPlayers, setMinPlayers] = useState(3);
  const [gameType, setGameType] = useState<CatalogGameId>("mbti-intro"),
    [showSetup, setShowSetup] = useState(false),
    [query, setQuery] = useState(""),
    [genre, setGenre] = useState<GameGenre>("전체"),
    [savedOnly, setSavedOnly] = useState(false),
    [maxRounds, setMaxRounds] = useState(5);
  const setupHeading = useRef<HTMLHeadingElement>(null),
    catalogHeading = useRef<HTMLHeadingElement>(null),
    settingsHeading = useRef<HTMLHeadingElement>(null);
  const selected = GAME_CATALOG.find((game) => game.id === gameType)!;
  const [savedGames, toggleSavedGame] = useSavedGames();
  const games = GAME_CATALOG.filter(
    (game) =>
      (genre === "전체" || game.genre === genre) &&
      (!savedOnly || savedGames.includes(game.id)) &&
      [game.title, game.summary, game.genre, ...game.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  function reveal(target: typeof setupHeading) {
    requestAnimationFrame(() => {
      target.current?.focus({ preventScroll: true });
      target.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
    });
  }
  function chooseGame(id: CatalogGameId) {
    const next = GAME_CATALOG.find((game) => game.id === id)!;
    setGameType(id);
    if (id !== "lobby") {
      setCapacity((value) => Math.max(3, value));
      setMinPlayers((value) => Math.max(3, value));
    }
    setAuctionRounds((rounds) => Math.max(rounds, capacity + 1));
    setTitle(next.roomTitle);
    setError("");
    setShowSetup(true);
    reveal(setupHeading);
  }
  const [toastMode, setToastMode] = useState<ToastMode>("basic"),
    [toastRounds, setToastRounds] = useState(2),
    [toastAnswerSeconds, setToastAnswerSeconds] = useState(30);
  const [auctionRounds, setAuctionRounds] = useState(12),
    [auctionInitialMoney, setAuctionInitialMoney] = useState(1000),
    [auctionBidSeconds, setAuctionBidSeconds] = useState(60);
  const [wordCategory, setWordCategory] = useState<WordCategory>("food"),
    [wordMode, setWordMode] = useState<WordMode>("classic");
  const [fromTown, setFromTown] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    setFromTown(query.get("from") === "town");
    const id = query.get("game");
    if (GAME_CATALOG.some((game) => game.id === id)) chooseGame(id as CatalogGameId);
  }, []);
  const [recent, setRecent] = useState<{ id: string; title: string; phase: string }[]>([]);
  useEffect(() => {
    if (!ready || !session?.authenticated || session.restricted) {
      setRecent([]);
      return;
    }
    const controller = new AbortController();
    void appRequest<typeof recent>("/api/games", "GET", undefined, controller.signal)
      .then(setRecent)
      .catch(() => {});
    return () => controller.abort();
  }, [ready, session?.authenticated, session?.restricted]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const room = await appRequest<{ id: string }>("/api/games", "POST", {
        gameType,
        toastMode,
        toastRounds,
        toastAnswerSeconds,
        auctionRounds,
        auctionInitialMoney,
        auctionBidSeconds,
        maxRounds,
        wordCategory,
        wordMode,
        title,
        capacity,
        minPlayers,
      });
      router.push(`/games/${room.id}?host=1${fromTown ? "&from=town" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "방을 만들지 못했어요.");
      setBusy(false);
    }
  }
  return (
    <div className={styles.screen}>
      <header className={catalog.hero}>
        <div>
          <span className={styles.eyebrow}>
            <Gamepad2 size={17} /> SLIPER PLAY
          </span>
          <h1>오늘은 어떤 게임을 할까요?</h1>
          <p>마음에 드는 게임을 골라요. 각자의 휴대폰이 우리만의 게임판이 돼요.</p>
          <div className={catalog.heroFacts}>
            <span>
              <Link2 size={14} /> 링크·QR로 초대
            </span>
            <span>
              <UsersRound size={14} /> 참가자 가입 없이
            </span>
            <span>
              <Check size={14} /> 설치 없이 플레이
            </span>
          </div>
        </div>
        {recent.length > 0 && (
          <a href="#my-game-rooms" className={catalog.myRooms}>
            내 게임방 <ArrowRight size={15} />
          </a>
        )}
      </header>
      <TownEntry />
      <section aria-labelledby="game-catalog-heading" className={catalog.library}>
        <div className={catalog.catalogHeader}>
          <h2 id="game-catalog-heading" ref={catalogHeading} tabIndex={-1}>
            함께할 게임 찾기 <small>{GAME_CATALOG.length}</small>
          </h2>
          <label className={catalog.search}>
            <Search size={17} />
            <input
              type="search"
              aria-label="게임 검색"
              placeholder="게임 이름, 취향으로 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className={catalog.filters} role="group" aria-label="게임 장르">
          {GAME_GENRES.map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={genre === item}
              onClick={() => setGenre(item)}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            className={catalog.savedFilter}
            aria-pressed={savedOnly}
            onClick={() => setSavedOnly((value) => !value)}
          >
            <Bookmark size={14} fill={savedOnly ? "currentColor" : "none"} aria-hidden="true" />
            찜한 게임 {savedGames.length > 0 && <small>{savedGames.length}</small>}
          </button>
        </div>
        <div className={catalog.gameGrid}>
          {games.map((game) => (
            <div key={game.id} className={catalog.gameItem}>
              <button
                type="button"
                className={catalog.gameCard}
                disabled={busy}
                aria-label={`${game.title} 선택`}
                aria-pressed={showSetup && gameType === game.id}
                aria-controls="game-setup"
                onClick={() => chooseGame(game.id)}
              >
                <GameCover game={game.id} />
                <div className={catalog.cardBody}>
                  <span className={catalog.genre}>{game.genre}</span>
                  <h3>{game.title}</h3>
                  <p>{game.summary}</p>
                  <div className={catalog.tags}>
                    {game.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <div className={catalog.cardBottom}>
                    <span>
                      <UsersRound size={14} /> {game.players}
                    </span>
                    <span>
                      {showSetup && gameType === game.id ? "선택한 게임" : "자세히 보기"}{" "}
                      <ArrowRight size={14} />
                    </span>
                  </div>
                </div>
              </button>
              <button
                type="button"
                className={catalog.save}
                aria-label={game.title + " 찜하기"}
                aria-pressed={savedGames.includes(game.id)}
                onClick={() => toggleSavedGame(game.id)}
              >
                <Bookmark
                  size={17}
                  fill={savedGames.includes(game.id) ? "currentColor" : "none"}
                  aria-hidden="true"
                />
              </button>
            </div>
          ))}
        </div>
        {games.length === 0 && (
          <div className={catalog.empty} role="status">
            <Search size={25} />
            <h3>
              {savedOnly && !savedGames.length
                ? "아직 찜한 게임이 없어요"
                : "맞는 게임을 찾지 못했어요"}
            </h3>
            <p>
              {savedOnly && !savedGames.length
                ? "게임 카드의 북마크를 눌러 찜해두세요."
                : "다른 검색어나 장르로 찾아보세요."}
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setGenre("전체");
                setSavedOnly(false);
              }}
            >
              전체 게임 보기
            </button>
          </div>
        )}
        <p className={catalog.catalogNote}>게임 카드를 누르면 소개와 방 만들기 설정이 열려요.</p>
      </section>
      {showSetup && (
        <section id="game-setup" className={catalog.setup} aria-labelledby="game-setup-heading">
          <button
            type="button"
            className={catalog.back}
            onClick={() => {
              setShowSetup(false);
              reveal(catalogHeading);
            }}
          >
            <ArrowLeft size={16} /> 다른 게임 고르기
          </button>
          <div className={catalog.detailGrid}>
            <div className={catalog.detail}>
              <GameCover game={gameType} large />
              <div className={catalog.detailBody}>
                <span className={catalog.detailEyebrow}>{selected.eyebrow}</span>
                <h2 id="game-setup-heading" ref={setupHeading} tabIndex={-1}>
                  {selected.title}
                </h2>
                <p className={catalog.hook}>{selected.hook}</p>
                <div className={catalog.detailFacts}>
                  <span>
                    <UsersRound size={15} /> {selected.players}
                  </span>
                  <span>{selected.format}</span>
                  <span>진행자 별도</span>
                </div>
                <button
                  type="button"
                  className={catalog.openSettings}
                  onClick={() => reveal(settingsHeading)}
                >
                  이 게임으로 방 만들기 <ArrowRight size={16} />
                </button>
                <h3>이렇게 플레이해요</h3>
                <ol className={catalog.highlights}>
                  {selected.highlights.map((text, index) => (
                    <li key={text}>
                      <span>{index + 1}</span>
                      <p>{text}</p>
                    </li>
                  ))}
                </ol>
                <GameTutorial game={gameType} wordMode={wordMode} audience="host" />
              </div>
            </div>
            <section
              className={`${styles.card} ${catalog.settings}`}
              aria-label={`${selected.title} 방 설정`}
            >
              <div className={styles.sectionTitle}>
                <h2 ref={settingsHeading} tabIndex={-1} className={catalog.settingsHeading}>
                  게임방 열기
                </h2>
                <span className={styles.pill}>진행자 전용</span>
              </div>
              <p className={catalog.settingsIntro}>
                게임을 골랐나요? 인원과 규칙을 정하고 친구들을 초대해요.
              </p>
              <form onSubmit={submit} className={styles.form}>
                {gameType === "toast" && (
                  <>
                    <label>
                      게임 모드
                      <select
                        aria-label="건배 게임 모드"
                        value={toastMode}
                        onChange={(e) => setToastMode(e.target.value as ToastMode)}
                      >
                        <option value="basic">기본 · 건배 인원 맞히기</option>
                        <option value="target">심화 · 목표 인원에 맞는 질문 만들기</option>
                      </select>
                    </label>
                    <div className={styles.fields}>
                      <label>
                        라운드 수
                        <select
                          aria-label="건배 라운드 수"
                          value={toastRounds}
                          onChange={(e) => setToastRounds(Number(e.target.value))}
                        >
                          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>
                              {n}라운드
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        선택 제한시간
                        <select
                          aria-label="건배 선택 제한시간"
                          value={toastAnswerSeconds}
                          onChange={(e) => setToastAnswerSeconds(Number(e.target.value))}
                        >
                          {[15, 30, 60, 90].map((n) => (
                            <option key={n} value={n}>
                              {n}초
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <small className={styles.muted}>
                      모두 한 번씩 질문하면 1라운드예요. 정원 기준 총 {toastRounds * capacity}차례,
                      한 사람당 {toastRounds}번 질문해요. 미응답은 패스, 개인 선택은 끝까지
                      비공개예요.
                    </small>
                  </>
                )}
                {gameType === "auction" && (
                  <>
                    <label>
                      총 경매 라운드
                      <input
                        aria-label="총 경매 라운드"
                        type="number"
                        min={capacity + 1}
                        max={120}
                        required
                        value={auctionRounds}
                        onChange={(e) => setAuctionRounds(Number(e.target.value))}
                      />
                    </label>
                    <div className={styles.fields}>
                      <label>
                        시작 게임 머니
                        <select
                          aria-label="시작 게임 머니"
                          value={auctionInitialMoney}
                          onChange={(e) => setAuctionInitialMoney(Number(e.target.value))}
                        >
                          {[500, 1000, 2000, 5000, 10000].map((v) => (
                            <option key={v} value={v}>
                              {v.toLocaleString()}G
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        물건당 입찰 시간
                        <select
                          aria-label="물건당 입찰 시간"
                          value={auctionBidSeconds}
                          onChange={(e) => setAuctionBidSeconds(Number(e.target.value))}
                        >
                          {[30, 60, 90, 120].map((v) => (
                            <option key={v} value={v}>
                              {v}초
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <small className={styles.muted}>
                      라운드는 실제 참가자 수보다 많아야 해요. 순서대로 판매하고, 현금 + 구입한
                      물건의 감정가로 순위를 정해요. 실제 결제는 없어요.
                    </small>
                  </>
                )}
                {gameType === "word-liar" && (
                  <>
                    <label>
                      제시어 카테고리
                      <select
                        aria-label="제시어 카테고리"
                        value={wordCategory}
                        onChange={(e) => setWordCategory(e.target.value as WordCategory)}
                      >
                        {WORD_CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      라이어 방식
                      <select
                        aria-label="라이어 방식"
                        value={wordMode}
                        onChange={(e) => setWordMode(e.target.value as WordMode)}
                      >
                        {Object.entries(WORD_MODE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <small className={styles.muted}>
                      {wordMode === "classic"
                        ? "라이어는 제시어 없이 자신의 정체만 알아요. 다른 사람들의 설명을 듣고 자연스럽게 섞여보세요."
                        : "라이어도 같은 카테고리의 다른 제시어를 받아요. 정체를 알려줄지는 모드에 따라 달라요."}
                    </small>
                  </>
                )}
                {gameType === "mbti-intro" && (
                  <>
                    <label>
                      진행 라운드 수
                      <select
                        aria-label="진행 라운드 수"
                        value={maxRounds}
                        onChange={(e) => setMaxRounds(Number(e.target.value))}
                      >
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                          <option value={n} key={n}>
                            {n}라운드
                          </option>
                        ))}
                      </select>
                    </label>
                    <small className={styles.muted}>
                      전원을 먼저 맞히면 즉시 종료해요. 마지막 라운드가 끝나면 정답자가 없어도
                      모두의 MBTI를 공개해요.
                    </small>
                  </>
                )}
                <label>
                  방 이름
                  <input
                    maxLength={60}
                    minLength={2}
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="어떤 게임을 함께할까요?"
                  />
                </label>
                <div className={styles.fields}>
                  <label>
                    참가 정원
                    <select
                      aria-label="참가 정원"
                      value={capacity}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setCapacity(value);
                        setAuctionRounds((rounds) => Math.max(rounds, value + 1));
                        if (minPlayers > value) setMinPlayers(value);
                      }}
                    >
                      {Array.from(
                        { length: gameType !== "lobby" ? 28 : 29 },
                        (_, i) => i + (gameType !== "lobby" ? 3 : 2),
                      ).map((n) => (
                        <option key={n} value={n}>
                          {n}명
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    시작 최소 인원
                    <select
                      aria-label="시작 최소 인원"
                      value={minPlayers}
                      onChange={(e) => setMinPlayers(Number(e.target.value))}
                    >
                      {Array.from(
                        { length: capacity - (gameType !== "lobby" ? 2 : 1) },
                        (_, i) => i + (gameType !== "lobby" ? 3 : 2),
                      ).map((n) => (
                        <option key={n} value={n}>
                          {n}명부터
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className={styles.muted}>
                  호스트는 진행만 맡아요. 참가 정원에는 포함되지 않아요.
                </p>
                {error && (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                )}
                {!ready ? (
                  <button className={styles.primary} disabled>
                    로그인 확인 중…
                  </button>
                ) : session?.authenticated && !session.restricted ? (
                  <button className={styles.primary} disabled={busy}>
                    {busy ? "방을 여는 중…" : "게임방 만들기"}
                    <ArrowRight size={18} />
                  </button>
                ) : (
                  <Link className={styles.primary} href="/login?returnTo=%2Fgames">
                    로그인하고 방 만들기
                    <ArrowRight size={18} />
                  </Link>
                )}
                <small className={styles.muted}>
                  참가자는 회원가입 없이 링크로 들어올 수 있어요. 방은 24시간 동안 이용할 수 있어요.
                </small>
              </form>
            </section>
          </div>
          <div className={catalog.startGuide}>
            {[
              {
                icon: Link2,
                heading: "링크·QR로 모이기",
                text: "접속한 순서대로 입장하고, 정원이 차면 기다려요.",
              },
              {
                icon: UsersRound,
                heading: "닉네임 정하고 준비",
                text: "각자 휴대폰에서 준비 완료를 눌러요.",
              },
              {
                icon: Check,
                heading: "진행자가 시작",
                text: "최소 인원이 모이고 모두 준비하면 시작해요.",
              },
            ].map(({ icon: Icon, heading, text }) => (
              <div key={heading}>
                <Icon size={18} />
                <div>
                  <h3>{heading}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
          <p className={catalog.safety}>
            <ShieldCheck size={15} /> 같은 와이파이에서도 각 브라우저를 구분해요. 같은 브라우저의
            여러 탭은 한 참가자로 연결돼요.
          </p>
          <p className={styles.templateNote}>
            {gameType === "toast"
              ? "건배 버튼은 질문에 대한 선택이에요. 음주는 자유이며 물이나 음료로도 함께할 수 있어요."
              : gameType === "mbti-intro"
                ? "참가자가 입력한 MBTI는 게임 종료 후 해당 게임 참가자들에게 공개돼요."
                : gameType === "auction"
                  ? "게임 머니는 현금으로 교환할 수 없어요. 판매자는 음수 잔액으로 진행할 수 있고, 유찰이면 매입금을 환급해요."
                  : gameType === "word-liar"
                    ? "제시어를 직접 말하지 말고 특징이나 경험으로 설명해보세요. 실제 개인 MBTI는 입력하지 않아요."
                    : "호스트가 규칙을 직접 안내하는 대기실이에요. 자동 문제·점수·승패 집계는 제공하지 않아요."}
          </p>
        </section>
      )}
      {recent.length > 0 && (
        <section id="my-game-rooms" className={styles.card} style={{ marginTop: 32 }}>
          <div className={styles.sectionTitle}>
            <h2>내가 연 게임방</h2>
            <small>최근 24시간</small>
          </div>
          <div className={styles.recent}>
            {recent.map((item) => (
              <Link key={item.id} href={`/games/${item.id}?host=1`}>
                <span>{item.title}</span>
                <small>
                  {item.phase === "lobby"
                    ? "준비 중"
                    : item.phase === "playing"
                      ? "진행 중"
                      : item.phase === "finished"
                        ? "라운드 종료"
                        : "종료"}
                </small>
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
